"""Power BI result capture and resumable, existing-item Fabric deployment."""
from __future__ import annotations

import base64
import csv
from decimal import Decimal
import io
import json
import os
from pathlib import PurePosixPath
import re
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from .store import digest, encoded, now

FABRIC = "https://api.fabric.microsoft.com/v1"
POWERBI = "https://api.powerbi.com/v1.0/myorg"


def guid(value):
    return str(uuid.UUID(str(value)))


def environment_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,150}", value):
        raise ValueError("Enter an environment variable name, not an access token.")
    return value


class ApiError(ValueError):
    def __init__(self, status, message, retry_after=0, operation_id=None, request_ids=None):
        self.status = status
        self.retry_after = retry_after
        self.operation_id = operation_id
        self.request_ids = request_ids or {}
        super().__init__(f"Microsoft API HTTP {status}: {message}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ApiError(code, "Unexpected redirect; the bearer token was not forwarded.")


class Microsoft:
    def __init__(self, token_env):
        self.token_env = environment_name(token_env)

    def request(self, method, url, body=None):
        if not (url.startswith(FABRIC + "/") or url.startswith(POWERBI + "/")):
            raise ValueError("Only the native Microsoft Fabric and Power BI API endpoints are supported.")
        token = os.environ.get(self.token_env)
        if not token:
            raise ValueError(f"Set {self.token_env} in the operator process environment, then retry.")
        request = urllib.request.Request(url, method=method, data=encoded(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"})
        opener = urllib.request.build_opener(NoRedirect())
        try:
            with opener.open(request, timeout=30) as response:
                raw = response.read(64 * 1024 * 1024 + 1)
                if len(raw) > 64 * 1024 * 1024:
                    raise ValueError("The native response exceeded the workspace object size limit.")
                # Retain original numeric lexemes when the response is a result table.
                data = json.loads(raw, parse_float=Decimal) if raw else {}
                headers = {k.lower(): v for k, v in response.headers.items()
                           if k.lower() in {"retry-after", "x-ms-operation-id", "requestid", "x-ms-request-id"}}
                return {"status": response.status, "data": data, "raw": raw, "headers": headers}
        except urllib.error.HTTPError as error:
            raw = error.read(32000)
            try:
                detail = json.loads(raw)
                item = detail.get("error", detail)
                message = str(item.get("message", item.get("errorCode", item)))[:1500]
            except Exception:
                message = f"Native request failed ({error.reason})."
            retry = error.headers.get("Retry-After", "0")
            operation_id = error.headers.get("x-ms-operation-id")
            try:
                operation_id = guid(operation_id) if operation_id else None
            except ValueError:
                operation_id = None
            request_ids = {k.lower(): v for k, v in error.headers.items()
                           if k.lower() in {"requestid", "x-ms-request-id"}}
            raise ApiError(error.code, message, int(retry) if retry.isdigit() else 0,
                           operation_id, request_ids) from None

    def item_url(self, target, item):
        family, key = ("semanticModels", "model_id") if item == "model" else ("reports", "report_id")
        return f"{FABRIC}/workspaces/{guid(target['workspace_id'])}/{family}/{guid(target[key])}"

    def get_definition(self, target, item):
        suffix = "?format=TMDL" if item == "model" else ""
        return self.request("POST", self.item_url(target, item) + "/getDefinition" + suffix)

    def update_definition(self, target, item, definition):
        body = {"definition": definition}
        if item == "model":
            body["options"] = {"allowPurgeData": False}
        return self.request("POST", self.item_url(target, item) + "/updateDefinition", body)

    def operation(self, operation_id, result=False):
        return self.request("GET", FABRIC + "/operations/" + guid(operation_id) + ("/result" if result else ""))


def definition_value(response):
    value = response.get("definition")
    if (not isinstance(value, dict) or not isinstance(value.get("parts"), list)
            or not value["parts"] or len(value["parts"]) > 100000):
        raise ValueError("The native response did not contain an item definition.")
    seen = set()
    size = 0
    for part in value["parts"]:
        if not isinstance(part, dict):
            raise ValueError("The native definition contains an invalid part.")
        path = part.get("path")
        if (not isinstance(path, str) or not path or len(path) > 2048 or path in seen
                or any(ord(c) < 32 for c in path) or PurePosixPath(path).is_absolute()
                or ".." in PurePosixPath(path).parts or "\\" in path
                or PurePosixPath(path).as_posix() != path):
            raise ValueError("The native definition contains an invalid or duplicate part path.")
        seen.add(path)
        if part.get("payloadType") != "InlineBase64" or not isinstance(part.get("payload"), str):
            raise ValueError("The native definition has an unsupported part payload type.")
        size += len(base64.b64decode(part["payload"], validate=True))
        if size > 48 * 1024 * 1024:
            raise ValueError("The native item definition exceeds 48 MiB.")
    return value


def definition_digest(value):
    # Order and base64 wrapping do not change the definition's meaning.
    parts = [{"path": p["path"], "sha256": digest(base64.b64decode(p["payload"], validate=True))}
             for p in value["parts"] if p["path"] != ".platform"]
    return digest(encoded(sorted(parts, key=lambda p: p["path"])).encode())


def project_definitions(package, model_id):
    model_parts, report_parts = [], []
    roots = {"model": set(), "report": set()}
    with zipfile.ZipFile(io.BytesIO(package)) as source:
        names = source.namelist()
        if len(names) != len(set(names)) or len(names) > 100000:
            raise ValueError("The built project has duplicate ZIP paths or too many entries.")
        if sum(item.file_size for item in source.infolist()) > 64 * 1024 * 1024:
            raise ValueError("The expanded rollout project exceeds 64 MiB.")
        for info in source.infolist():
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
                raise ValueError("The built project contains an invalid path.")
            if len(path.parts) < 2 or path.name == ".platform" or ".pbi" in path.parts:
                continue
            family = model_parts if path.parts[0].endswith(".SemanticModel") else (
                report_parts if path.parts[0].endswith(".Report") else None)
            if family is None or info.is_dir():
                continue
            roots["model" if family is model_parts else "report"].add(path.parts[0])
            data = source.read(info)
            relative = "/".join(path.parts[1:])
            if family is report_parts and relative == "definition.pbir":
                link = json.loads(data)
                link["datasetReference"] = {"byConnection": {"connectionString": "semanticmodelid=" + guid(model_id)}}
                data = encoded(link).encode()
            family.append({"path": relative, "payload": base64.b64encode(data).decode(), "payloadType": "InlineBase64"})
    if (any(len(value) != 1 for value in roots.values()) or
            not any(x["path"] == "definition.pbism" for x in model_parts) or not any(
        x["path"] == "definition.pbir" for x in report_parts)):
        raise ValueError("The artifact must contain one complete semantic model and report project.")
    return {key: definition_value({"definition": {"parts": parts}})
            for key, parts in (("model", model_parts), ("report", report_parts))}


def capture_results(store, request):
    target = {"workspace_id": guid(request["workspace_id"]), "model_id": guid(request["model_id"])}
    query = str(request["query"]).strip()
    if not query or len(query) > 500000:
        raise ValueError("Enter one DAX query with one result table.")
    api = Microsoft(request["token_env"])
    url = f"{POWERBI}/groups/{target['workspace_id']}/datasets/{target['model_id']}/executeQueries"
    started = time.monotonic()
    response = api.request("POST", url, {"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}})
    data = response["data"]
    if data.get("error") or len(data.get("results", [])) != 1:
        raise ValueError("Power BI did not return one successful query result: " + str(data.get("error", ""))[:700])
    result = data["results"][0]
    if result.get("error") or len(result.get("tables", [])) != 1:
        raise ValueError("Power BI reported an error, truncation or multiple result tables: " + str(result.get("error", ""))[:700])
    table = result["tables"][0]
    if table.get("error"):
        raise ValueError("Power BI reported a table error: " + str(table["error"])[:700])
    rows = table.get("rows", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Power BI returned an invalid row collection.")
    headers = list(dict.fromkeys(key for row in rows for key in row))
    if not headers:
        headers = request.get("empty_columns", [])
        if not headers or not all(isinstance(k, str) and k for k in headers) or len(headers) != len(set(headers)):
            raise ValueError("For a zero-row query, supply its exact column names in empty_columns.")
    null_token = "\\N"
    def cell(value):
        if value is None:
            return null_token
        if isinstance(value, (list, dict)):
            raise ValueError("Power BI returned a nonscalar cell.")
        text = "true" if value is True else "false" if value is False else str(value)
        if text == null_token:
            raise ValueError("A native non-null value equals the reserved CSV null token.")
        return text
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows([cell(row.get(key)) for key in headers] for row in rows)
    native = store.blob(response["raw"], "power-bi-native-result.json", "application/json")
    table_file = store.blob(output.getvalue().encode("utf-8"), "power-bi-result.csv", "text/csv")
    return {"label": request.get("label", "Power BI result"), "target": target, "query": query,
            "parameters": request.get("parameters", {}), "captured": now(), "provider": "power-bi-execute-queries",
            "duration_seconds": round(time.monotonic() - started, 4), "rows": len(rows), "columns": headers,
            "null_token": null_token, "csv": table_file, "native": native, "request_ids": response["headers"],
            "artifact": request.get("artifact"), "scope": request.get("scope", "")}


class Rollouts:
    """Each click advances the original operation; pending writes are never blindly repeated."""
    def __init__(self, service):
        self.service = service
        self.store = service.store

    def create(self, request):
        artifact = self.store.get("artifact", request["artifact_id"], request.get("artifact_revision"))
        plan = self.store.get("plan", artifact["payload"]["plan"]["id"], artifact["payload"]["plan"]["revision"])
        if any(binding.get("kind") == "csv" for binding in plan["payload"]["bindings"].values()):
            raise ValueError("Create a rollout build with SQL or service-accessible Power Query bindings. The local CSV project opens in Desktop.")
        target = {key: guid(request[key]) for key in ("workspace_id", "model_id", "report_id")}
        target["token_env"] = environment_name(request.get("token_env", "FABRIC_ACCESS_TOKEN"))
        definitions = project_definitions(self.store.bytes(artifact["payload"]["package"]["digest"]), target["model_id"])
        desired = {key: self.store.blob(encoded(value).encode(), key + "-desired-definition.json", "application/json")
                   for key, value in definitions.items()}
        return self.service.write("rollout", {"label": request.get("label", "Migration rollout"), "target": target,
            "artifact": self.service.reference(artifact), "desired": desired, "original": {}, "index": 0,
            "state": "ready", "pending": None, "steps": ["capture:model", "capture:report", "update:model", "update:report"],
            "notes": request.get("notes", ""), "history": [], "mode": "deploy"})

    def rollback(self, request):
        original = self.store.get("rollout", request["id"])
        if request.get("expected") is None or original["revision"] != int(request["expected"]):
            raise ValueError("Reload the current rollout before preparing its rollback.")
        payload = original["payload"]
        if (payload.get("pending") or {}).get("phase") in {"sending", "uncertain", "waiting"}:
            raise ValueError("Reconcile the original pending update before rolling back; a running write must finish first.")
        if set(payload["original"]) != {"model", "report"}:
            raise ValueError("This rollout has not captured both original native definitions.")
        return self.service.write("rollout", {"label": "Rollback: " + payload["label"], "target": payload["target"],
            "artifact": payload["artifact"], "desired": payload["original"], "original": {}, "index": 0,
            "state": "ready", "pending": None, "steps": ["capture:model", "capture:report", "update:model", "update:report"],
            "history": [], "mode": "rollback", "from_rollout": self.service.reference(original),
            "notes": request.get("notes", "")})

    def _save(self, record, note):
        payload = record["payload"]
        payload["history"].append({"time": now(), "index": payload["index"], "state": payload["state"], "note": note})
        saved = self.service.write("rollout", payload, record["id"], record["revision"])
        record.update({key: value for key, value in saved.items() if key != "payload"})
        return saved

    def _complete_stage(self, record, response=None):
        payload = record["payload"]
        verb, item = payload["steps"][payload["index"]].split(":")
        if verb == "capture":
            definition = definition_value(response or {})
            payload["original"][item] = self.store.blob(encoded(definition).encode(), item + "-original-definition.json", "application/json")
        payload["index"] += 1
        payload["pending"] = None
        payload["state"] = "complete" if payload["index"] == len(payload["steps"]) else "ready"
        return self._save(record, verb + " " + item + " completed")

    @staticmethod
    def _waiting(response):
        operation_id = response["headers"].get("x-ms-operation-id")
        if not operation_id:
            raise ValueError("A native asynchronous response did not include its operation ID.")
        retry = response["headers"].get("retry-after", "5")
        return {"phase": "waiting", "operation_id": guid(operation_id),
                "not_before": time.time() + (int(retry) if retry.isdigit() else 5)}

    def advance(self, request):
        record = self.store.get("rollout", request["id"])
        if record["revision"] != int(request["expected"]):
            raise ValueError("Reload the current rollout before advancing it.")
        payload = record["payload"]
        if payload["state"] == "complete":
            return record
        api = Microsoft(payload["target"]["token_env"])
        verb, item = payload["steps"][payload["index"]].split(":")
        pending = payload.get("pending") or {}
        if pending.get("not_before", 0) > time.time():
            raise ValueError("Microsoft requested a later poll; wait until the displayed retry time.")
        if pending.get("phase") in {"sending", "uncertain"} and verb == "update":
            payload["state"] = "uncertain"
            return self._save(record, "Inspect the pending native operation or reconcile the current item definition before retrying.")
        try:
            if pending.get("phase") == "waiting":
                status = api.operation(pending["operation_id"])
                state = status["data"].get("status")
                if state == "Succeeded":
                    result = api.operation(pending["operation_id"], result=True)["data"] if verb == "capture" else None
                    return self._complete_stage(record, result)
                if state in {"Failed", "Cancelled", "Canceled"}:
                    payload["state"] = "failed"
                    payload["pending"]["phase"] = "rejected"
                    return self._save(record, "Native operation " + str(state) + ": " + str(status["data"].get("error", ""))[:1000])
                payload["state"] = "waiting"
                retry = status["headers"].get("retry-after", "5")
                payload["pending"]["not_before"] = time.time() + (int(retry) if retry.isdigit() else 5)
                return self._save(record, "Native operation " + str(state))
            # The intent is durable before the provider can accept the write.
            payload["pending"] = {"phase": "sending", "started": now()}
            payload["state"] = "sending"
            self._save(record, verb + " " + item + " request started")
            if verb == "capture":
                response = api.get_definition(payload["target"], item)
            else:
                definition = json.loads(self.store.bytes(payload["desired"][item]["digest"]))
                response = api.update_definition(payload["target"], item, definition)
            if response["status"] == 202:
                payload["pending"] = self._waiting(response)
                payload["state"] = "waiting"
                return self._save(record, "Native operation accepted: " + payload["pending"]["operation_id"])
            if response["status"] != 200:
                raise ValueError("Unexpected native completion status " + str(response["status"]))
            return self._complete_stage(record, response["data"])
        except ApiError as error:
            if error.operation_id and not (payload.get("pending") or {}).get("operation_id"):
                payload["pending"] = {**(payload.get("pending") or {}), "operation_id": error.operation_id}
            if (payload.get("pending") or {}).get("operation_id"):
                payload["pending"]["phase"] = "waiting"
                payload["pending"]["not_before"] = time.time() + max(5, error.retry_after)
                payload["state"] = "waiting"
                return self._save(record, str(error))
            if verb == "update" and (error.status == 408 or error.status >= 500):
                # A server/gateway failure is not proof that the accepted write
                # had no effect. Keep the same intent for native reconciliation.
                payload["pending"] = {**(payload.get("pending") or {}), "phase": "uncertain",
                    "http_status": error.status, "request_ids": error.request_ids,
                    "not_before": time.time() + error.retry_after}
                payload["state"] = "uncertain"
                return self._save(record, str(error))
            payload["pending"] = {"phase": "rejected", "not_before": time.time() + error.retry_after}
            payload["state"] = "failed"
            return self._save(record, str(error))
        except Exception as error:
            if (payload.get("pending") or {}).get("operation_id"):
                payload["pending"]["phase"] = "waiting"
                payload["pending"]["not_before"] = time.time() + 5
                payload["state"] = "waiting"
                return self._save(record, str(error)[:1200])
            payload["state"] = "uncertain" if verb == "update" else "retry_read"
            payload["pending"] = {**(payload.get("pending") or {}), "phase": "uncertain" if verb == "update" else "retry_read"}
            return self._save(record, str(error)[:1200])

    def reconcile(self, request):
        record = self.store.get("rollout", request["id"])
        if record["revision"] != int(request["expected"]):
            raise ValueError("Reload the current rollout before reconciling it.")
        payload = record["payload"]
        if payload["state"] == "complete":
            return record
        verb, item = payload["steps"][payload["index"]].split(":")
        if verb != "update":
            return self.advance(request)
        pending = payload.get("pending") or {}
        # operation_id is the application's action identity, consumed by
        # Service.dispatch. The provider's operation has its own request field.
        if request.get("native_operation_id"):
            native_id = guid(request["native_operation_id"])
            if pending.get("phase") == "waiting" and pending.get("operation_id") != native_id:
                raise ValueError("This update already tracks a different native operation; poll its original identity.")
            payload["pending"] = {"phase": "waiting", "operation_id": native_id, "not_before": pending.get("not_before", 0)}
            payload["state"] = "waiting"
            return self._save(record, "Attached the original native operation ID for continued polling.")
        if pending.get("phase") == "waiting" and pending.get("operation_id"):
            # Do not treat an intermediate item snapshot as completion while
            # the original provider operation can still change it.
            return self.advance(request)
        api = Microsoft(payload["target"]["token_env"])
        probe = payload.get("probe")
        if probe:
            if probe.get("not_before", 0) > time.time():
                raise ValueError("Microsoft requested a later reconciliation poll.")
            response = api.operation(probe["operation_id"])
            state = response["data"].get("status")
            if state != "Succeeded":
                if state in {"Failed", "Cancelled", "Canceled"}:
                    payload.pop("probe", None)
                    return self._save(record, "The definition inspection failed; the original update remains tracked.")
                retry = response["headers"].get("retry-after", "5")
                probe["not_before"] = time.time() + (int(retry) if retry.isdigit() else 5)
                return self._save(record, "The native definition inspection is still running.")
            response = api.operation(probe["operation_id"], result=True)
        else:
            response = api.get_definition(payload["target"], item)
        if response["status"] == 202:
            payload["probe"] = self._waiting(response)
            return self._save(record, "Native definition inspection accepted.")
        current = definition_value(response["data"])
        payload.pop("probe", None)
        observed = self.store.blob(encoded(current).encode(), item + "-observed-definition.json", "application/json")
        payload["observed"] = {"item": item, "definition": observed, "time": now()}
        desired = json.loads(self.store.bytes(payload["desired"][item]["digest"]))
        if definition_digest(current) == definition_digest(desired):
            return self._complete_stage(record)
        if request.get("retry_after_inspection") is True and str(request.get("note", "")).strip():
            payload["pending"] = None
            payload["state"] = "ready"
            return self._save(record, "Operator inspected the native state and requested another definition update: " + request["note"])
        payload["state"] = "uncertain"
        return self._save(record, "Current native definition retained; it differs from the requested definition. Inspect the original operation before requesting another update.")
