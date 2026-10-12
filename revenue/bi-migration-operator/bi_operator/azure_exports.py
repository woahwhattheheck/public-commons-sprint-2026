"""Complete Azure export acquisition and billing receiving in the original BI workspace."""
from __future__ import annotations

import base64
import copy
import csv
from decimal import Decimal, localcontext
import io
import json
from pathlib import PurePosixPath
import re
import time
from urllib.parse import urlsplit, unquote
import zipfile

from .azure_transfer import (Azure, AzureError, CHUNK_BYTES, MAX_MANIFEST, MAX_PARTITIONS,
    csv_original, month_bounds, native_path, parse_manifest, profile_config)
from .billback import (MAX_INPUT, MAX_ROWS, COST_FIELDS, csv_rows, currency, date_month,
    decimal, month, number, upload)
from .store import Conflict, digest, encoded, identifier, now

KINDS = ("azure_profile", "azure_discovery", "azure_run", "azure_source", "azure_review",
         "azure_import", "azure_delivery", "azure_receive")
RECEIVING_SCHEMA = "commons-bi-azure-receiving/1"


def clean(value):
    return {key: copy.deepcopy(item) for key, item in value.items() if key != "_operation_id"}


def reference(record):
    return {key: record[key] for key in ("kind", "id", "revision")}


def same_reference(left, right):
    return all(left.get(key) == right.get(key) for key in ("kind", "id", "revision"))


def blob_refs(value):
    found = {}
    def visit(item):
        if isinstance(item, dict):
            if re.fullmatch(r"[a-f0-9]{64}", str(item.get("digest", ""))) and type(item.get("bytes")) is int:
                found[item["digest"]] = item
            else:
                for child in item.values():
                    visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)
    visit(value)
    return found


class AzureExports:
    def __init__(self, service):
        self.service, self.store = service, service.store
        self.actions = {
            "azure.profile.save": self.profile_save,
            "azure.discovery.start": self.discovery_start,
            "azure.discovery.advance": self.discovery_advance,
            "azure.run.prepare": self.run_prepare,
            "azure.run.submit": self.run_submit,
            "azure.run.refresh": self.run_refresh,
            "azure.run.select": self.run_select,
            "azure.source.select": self.source_select,
            "azure.source.import": self.source_import,
            "azure.source.receive": self.partition_receive,
            "azure.source.bind": self.source_bind,
            "azure.source.advance": self.source_advance,
            "azure.source.cancel": self.source_cancel,
            "azure.source.resume": self.source_resume,
            "azure.source.review": self.source_review,
            "azure.import.prepare": self.import_prepare,
            "azure.import.advance": self.import_advance,
            "azure.handoff.prepare": self.handoff_prepare,
            "azure.handoff.advance": self.handoff_advance,
            "azure.handoff.receive": self.handoff_receive,
        }

    def write(self, kind, payload, entity_id=None, expected=0):
        return self.service.write(kind, payload, entity_id, expected)

    def get(self, kind, entity_id, revision=None):
        return self.store.get(kind, entity_id, revision)

    def existing(self, kind, entity_id):
        try:
            return self.get(kind, entity_id)
        except KeyError:
            return None

    def current(self, kind, request):
        record = self.get(kind, request["id"])
        if record["revision"] != int(request["expected"]):
            raise Conflict("This Azure record has changed; reopen its current revision before continuing.")
        return record, clean(record["payload"])

    def json_blob(self, value, name):
        return self.store.blob(encoded(value).encode(), name, "application/json")

    def profile(self, request):
        return self.get("azure_profile", request["profile_id"], request.get("profile_revision"))

    def profile_save(self, request):
        old = self.get("azure_profile", request["id"]) if request.get("id") else None
        payload = profile_config(request, old["payload"] if old else None)
        return self.write("azure_profile", payload, old["id"] if old else None, request.get("expected", 0))

    def export_id(self, config, value):
        value = str(value or "")
        prefix = config["scope"] + "/providers/Microsoft.CostManagement/exports/"
        if not value.casefold().startswith(prefix.casefold()):
            raise ValueError("Select an export in this exact saved Azure scope.")
        tail = value[len(prefix):]
        if not tail or "/" in tail or any(c in value for c in "?#%\\") or any(ord(c) < 32 for c in value):
            raise ValueError("The selected export resource ID is invalid.")
        return value

    def metadata(self, result, filename):
        return {"file": self.store.blob(result["raw"], filename, "application/json"),
                "headers": result["headers"], "status": result["status"], "retrieved": now()}

    def failure(self, payload, error):
        payload["error"] = str(error)[:800]
        payload["state"] = "waiting" if isinstance(error, AzureError) and error.status in (0, 429, 500, 502, 503, 504) else "attention"
        payload["retry_at"] = time.time() + (error.retry_after if isinstance(error, AzureError) else 0)
        if isinstance(error, AzureError):
            payload["provider_error"] = {"status": error.status, "code": error.code, "request_id": error.request_id}
        return payload

    def discovery_start(self, request):
        profile = self.profile(request)
        config = profile["payload"]
        category = request.get("category", "exports")
        if category not in {"exports", "runs", "blobs"}:
            raise ValueError("Choose exports, execution history or container files.")
        export_id = self.export_id(config, request.get("export_id")) if category == "runs" else None
        first = config["scope"] + "/providers/Microsoft.CostManagement/exports"
        if category == "runs":
            first = export_id + "/runHistory"
        prefix = str(request.get("prefix", config.get("prefix", "")))
        if prefix:
            native_path(prefix.rstrip("/"), "Export prefix")
        return self.write("azure_discovery", {"label": config["label"] + " — " + category,
            "profile": reference(profile), "category": category, "export_id": export_id, "prefix": prefix,
            "next": "" if category == "blobs" else first, "seen": [], "items": [], "pages": [],
            "state": "ready", "started": now()})

    def discovery_advance(self, request):
        record, payload = self.current("azure_discovery", request)
        if payload["state"] == "complete":
            return record
        if time.time() < payload.get("retry_at", 0):
            raise ValueError("Azure requested a retry after " + str(int(payload["retry_at"] - time.time()) + 1) + " seconds.")
        profile = self.get("azure_profile", payload["profile"]["id"], payload["profile"]["revision"])
        api = Azure(profile["payload"])
        cursor = payload["next"]
        if cursor in payload["seen"]:
            raise ValueError("Azure repeated a completed continuation; reopen the retained response before continuing.")
        try:
            if payload["category"] == "blobs":
                result = api.list_blobs(payload["prefix"], cursor)
                items, following = result["items"], result["next"]
            else:
                result = api.json(cursor)
                items, following = result["data"].get("value", []), result["data"].get("nextLink", "")
                if not isinstance(items, list):
                    raise ValueError("Azure did not return its native value collection.")
                if following:
                    api.arm_url(following)
            if len(payload["items"]) + len(items) > 10000:
                raise ValueError("This selection contains over 10000 entries; use a narrower native scope or prefix.")
            payload["items"].extend(items)
            payload["seen"].append(cursor)
            payload["pages"].append(self.metadata(result, "azure-" + payload["category"] + "-" + str(len(payload["pages"]) + 1) + ".json"))
            payload.update({"next": following, "state": "ready" if following else "complete", "error": "", "retry_at": 0})
        except (AzureError, ValueError) as error:
            self.failure(payload, error)
        return self.write("azure_discovery", payload, record["id"], record["revision"])

    def run_prepare(self, request):
        profile = self.profile(request)
        config = profile["payload"]
        export_id = self.export_id(config, request.get("export_id"))
        period = month(request["period"])
        result = Azure(config).json(export_id)
        if str(result["data"].get("id", "")).casefold() != export_id.casefold():
            raise ValueError("The native export response does not identify the selected resource.")
        return self.write("azure_run", {"label": str(request.get("label") or result["data"].get("name") or "Monthly export")[:300],
            "profile": reference(profile), "export_id": export_id, "period": period,
            "time_period": month_bounds(period), "definition": result["data"],
            "original_definition": self.metadata(result, "azure-export-definition.json"),
            "state": "prepared", "candidates": [], "history_pages": [], "created": now()})

    def run_submit(self, request):
        record, payload = self.current("azure_run", request)
        if payload["state"] != "prepared":
            raise ValueError("This run already has an execution attempt. Refresh its original execution history.")
        profile = self.get("azure_profile", payload["profile"]["id"], payload["profile"]["revision"])
        # Persist the uncertain boundary before the provider POST. An interrupted response
        # reopens this same record and proceeds through run history, never a second POST.
        payload.update({"state": "uncertain", "submitted": now(), "request": {"timePeriod": payload["time_period"]}})
        pending = self.write("azure_run", payload, record["id"], record["revision"])
        try:
            result = Azure(profile["payload"]).json(payload["export_id"] + "/run", "POST", payload["request"])
            payload.update({"state": "submitted", "submission": self.metadata(result, "azure-export-submission.json"), "error": ""})
        except (AzureError, ValueError) as error:
            payload["error"] = str(error)[:800]
            if isinstance(error, AzureError):
                payload["provider_error"] = {"status": error.status, "code": error.code, "request_id": error.request_id}
                payload["retry_at"] = time.time() + error.retry_after
        return self.write("azure_run", payload, record["id"], pending["revision"])

    def run_refresh(self, request):
        record, payload = self.current("azure_run", request)
        if time.time() < payload.get("retry_at", 0):
            raise ValueError("Wait for the provider's retained Retry-After time before refreshing this run.")
        profile = self.get("azure_profile", payload["profile"]["id"], payload["profile"]["revision"])
        api = Azure(profile["payload"])
        cursor = payload.get("history_next") or payload["export_id"] + "/runHistory"
        result = api.json(cursor)
        items = result["data"].get("value", [])
        if not isinstance(items, list):
            raise ValueError("The provider run history is not a collection.")
        candidates = {item["id"]: item for item in payload.get("candidates", []) if item.get("id")}
        for item in items:
            if isinstance(item, dict) and item.get("id"):
                candidates[item["id"]] = item
        payload["candidates"] = list(candidates.values())[-1000:]
        payload["history_pages"].append(self.metadata(result, "azure-run-history-" + str(len(payload["history_pages"]) + 1) + ".json"))
        payload["history_next"] = result["data"].get("nextLink", "")
        if payload["history_next"]:
            api.arm_url(payload["history_next"])
        if payload.get("selected_run"):
            selected = candidates.get(payload["selected_run"]["id"])
            if selected:
                payload["selected_run"] = selected
                payload["native_status"] = selected.get("properties", {}).get("status", "")
                payload["state"] = "completed" if payload["native_status"] == "Completed" else "observed"
        payload["refreshed"] = now()
        return self.write("azure_run", payload, record["id"], record["revision"])

    def run_select(self, request):
        record, payload = self.current("azure_run", request)
        selected = next((item for item in payload["candidates"] if item.get("id") == request["native_run_id"]), None)
        if not selected:
            raise ValueError("Select one of the actual retained native run IDs.")
        properties = selected.get("properties", {})
        if properties.get("startDate", "")[:7] != payload["period"]:
            raise ValueError("The selected native run starts outside the prepared billing month.")
        payload.update({"selected_run": selected, "native_status": properties.get("status", ""),
            "state": "completed" if properties.get("status") == "Completed" else "observed"})
        return self.write("azure_run", payload, record["id"], record["revision"])

    def manifest_name(self, config, value):
        value = str(value or "")
        if value.startswith("https://") or value.startswith("http://"):
            prefix = config["container_url"] + "/"
            if not value.startswith(prefix) or urlsplit(value).query or urlsplit(value).fragment:
                raise ValueError("The run manifest must be in the selected original container.")
            value = unquote(value[len(prefix):])
        return native_path(value, "Manifest path")

    def create_source(self, raw, name, profile=None, origin=None, metadata=None):
        parsed = parse_manifest(raw)
        source_id = "azure_source_" + digest(raw)[:40]
        old = self.existing("azure_source", source_id)
        if old:
            return old
        payload = {**parsed, "label": parsed["export_config"].get("exportName") or name,
            "manifest": self.store.blob(raw, PurePosixPath(name).name, "application/json"), "manifest_path": name,
            "profile": reference(profile) if profile else None, "origin": origin or {"mode": "received-native-files"},
            "manifest_response": metadata, "state": "ready" if parsed["parts"] else "complete", "received_bytes": 0,
            "created": now(), "source_note": "", "error": "", "retry_at": 0}
        return self.write("azure_source", payload, source_id)

    def source_select(self, request):
        profile = self.profile(request)
        config = profile["payload"]
        name = request.get("manifest_path")
        run_ref = None
        if request.get("run_id"):
            run = self.get("azure_run", request["run_id"], request.get("run_revision"))
            if run["payload"]["state"] != "completed":
                raise ValueError("Select a completed native export run.")
            selected = run["payload"]["selected_run"]["properties"]
            name = selected.get("manifestFile")
            run_ref = reference(run)
            destination = selected.get("runSettings", {}).get("deliveryInfo", {}).get("destination", {})
            if not config.get("local_endpoint") and destination.get("resourceId"):
                account = destination["resourceId"].rsplit("/", 1)[-1]
                expected = "https://" + account + ".blob.core.windows.net/" + str(destination.get("container", ""))
                if expected.casefold() != config["container_url"].casefold():
                    raise ValueError("Select the storage container recorded in this exact native run.")
        name = self.manifest_name(config, name)
        api = Azure(config)
        result = api.request("GET", api.blob_url(name), "storage", maximum=MAX_MANIFEST)
        if not result["headers"].get("etag"):
            raise ValueError("The original manifest response needs an ETag for a coherent retained edition.")
        return self.create_source(result["raw"], name, profile,
            {"mode": "local-protocol" if config.get("local_endpoint") else "azure-blob",
             "container_url": config["container_url"], "run": run_ref},
            {"headers": result["headers"], "status": result["status"], "retrieved": now()})

    def retain_part(self, part, data):
        if len(data) != part["bytes"]:
            raise ValueError("The complete partition byte count differs from the original manifest: " + part["name"])
        if part.get("file") and part["file"]["digest"] != digest(data):
            raise ValueError("The selected native edition already has different bytes for this partition.")
        part["chunks"] = [self.store.blob(data[offset:offset + CHUNK_BYTES],
            "azure-part-" + str(part["index"]) + "-" + str(offset) + ".bytes")
            for offset in range(0, len(data), CHUNK_BYTES)]
        part["file"] = self.store.blob(data, PurePosixPath(part["name"]).name)
        part["received"] = len(data)

    def finish_parts(self, payload):
        payload["received_bytes"] = sum(part["received"] for part in payload["parts"])
        if all(part.get("file") for part in payload["parts"]):
            payload["state"] = "complete"
            payload["completed"] = now()

    def source_import(self, request):
        data, filename = upload(request)
        manifest_path = native_path(request.get("manifest_path", "manifest.json"))
        if filename.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as package:
                infos = package.infolist()
                names = [item.filename for item in infos]
                if len(names) != len(set(names)) or len(names) > MAX_PARTITIONS + 20:
                    raise ValueError("The native source ZIP has duplicate names or too many members.")
                if manifest_path not in names:
                    raise ValueError("Select the exact native manifest path within this ZIP.")
                if package.getinfo(manifest_path).file_size > MAX_MANIFEST:
                    raise ValueError("The original manifest exceeds 4 MiB.")
                raw = package.read(manifest_path)
                parsed = parse_manifest(raw)
                prefix = str(request.get("archive_prefix", ""))
                if prefix:
                    native_path(prefix.rstrip("/"), "Archive prefix")
                members = []
                for part in parsed["parts"]:
                    member = prefix + part["name"]
                    if member not in names or package.getinfo(member).file_size != part["bytes"]:
                        raise ValueError("The complete original partition is missing from the ZIP: " + member)
                    if (package.getinfo(member).external_attr >> 16) & 0o170000 not in (0, 0o100000):
                        raise ValueError("Native partition members must be regular files.")
                    members.append((part, member))
                # Decode all complete native members before advancing the source record.
                for part, member in members:
                    self.retain_part(part, package.read(member))
                record = self.create_source(raw, manifest_path)
                payload = clean(record["payload"])
                if payload["state"] == "complete":
                    for old, incoming in zip(payload["parts"], parsed["parts"]):
                        if old["file"]["digest"] != incoming["file"]["digest"]:
                            raise ValueError("The receiving ZIP differs from the saved original edition.")
                    return record
                payload["parts"] = parsed["parts"]
                payload["source_note"] = str(request.get("note", ""))[:10000]
                self.finish_parts(payload)
                return self.write("azure_source", payload, record["id"], record["revision"])
        return self.create_source(data, manifest_path)

    def partition_receive(self, request):
        record, payload = self.current("azure_source", request)
        index = int(request["partition"])
        if not 0 <= index < len(payload["parts"]):
            raise ValueError("Select an original manifest partition.")
        data, _ = upload(request)
        if request.get("native_name") != payload["parts"][index]["name"]:
            raise ValueError("The receiving filename must match the complete original blob name.")
        self.retain_part(payload["parts"][index], data)
        payload.update({"state": "ready", "error": ""})
        self.finish_parts(payload)
        return self.write("azure_source", payload, record["id"], record["revision"])

    def source_bind(self, request):
        record, payload = self.current("azure_source", request)
        profile = self.profile(request)
        origin = payload["origin"].get("container_url")
        if origin and profile["payload"]["container_url"] != origin:
            raise ValueError("Bind credentials for the same retained source container.")
        payload["profile"] = reference(profile)
        if not origin:
            payload["origin"]["container_url"] = profile["payload"]["container_url"]
        return self.write("azure_source", payload, record["id"], record["revision"])

    def source_cancel(self, request):
        record, payload = self.current("azure_source", request)
        if payload["state"] == "complete":
            return record
        payload.update({"state": "canceled", "canceled": now()})
        return self.write("azure_source", payload, record["id"], record["revision"])

    def source_resume(self, request):
        record, payload = self.current("azure_source", request)
        if payload["state"] == "complete":
            return record
        if payload["state"] == "source_changed":
            raise ValueError("Acquire the changed manifest as a new source edition.")
        payload.update({"state": "ready", "error": ""})
        return self.write("azure_source", payload, record["id"], record["revision"])

    def source_advance(self, request):
        record, payload = self.current("azure_source", request)
        if payload["state"] == "complete":
            return record
        if payload["state"] in {"canceled", "source_changed"}:
            raise ValueError("Resume this source or select its new provider edition before transfer.")
        if time.time() < payload.get("retry_at", 0):
            raise ValueError("Honor the retained provider retry time before continuing this transfer.")
        if not payload.get("profile"):
            raise ValueError("Bind the existing source's Azure profile or receive its complete native files.")
        profile = self.get("azure_profile", payload["profile"]["id"], payload["profile"]["revision"])
        config = profile["payload"]
        if payload["origin"].get("container_url") != config["container_url"]:
            raise ValueError("The saved source and selected profile use different containers.")
        api = Azure(config)
        try:
            etag = (payload.get("manifest_response") or {}).get("headers", {}).get("etag")
            result = api.request("GET", api.blob_url(payload["manifest_path"]), "storage",
                headers={"If-Match": etag} if etag else {}, maximum=MAX_MANIFEST)
            if digest(result["raw"]) != payload["manifest"]["digest"]:
                payload.update({"state": "source_changed", "error": "The provider published a different manifest; select that edition."})
                return self.write("azure_source", payload, record["id"], record["revision"])
            payload["manifest_response"] = {"headers": result["headers"], "status": result["status"], "retrieved": now()}
            part = next((part for part in payload["parts"] if not part.get("file")), None)
            if part:
                url = api.blob_url(part["name"])
                if not part.get("etag"):
                    head = api.request("HEAD", url, "storage", maximum=0)
                    if int(head["headers"].get("content-length", -1)) != part["bytes"] or not head["headers"].get("etag"):
                        raise ValueError("The original partition size or ETag differs from its manifest.")
                    part["etag"] = head["headers"]["etag"]
                    part["native_headers"] = head["headers"]
                offset = part["received"]
                if offset != sum(chunk["bytes"] for chunk in part["chunks"]):
                    raise ValueError("The durable partition checkpoint does not reconcile.")
                if offset < part["bytes"]:
                    chunk_bytes = request.get("chunk_bytes", CHUNK_BYTES)
                    if type(chunk_bytes) is not int or not 256 <= chunk_bytes <= CHUNK_BYTES:
                        raise ValueError("A transfer step may request 256 bytes through 4 MiB.")
                    end = min(part["bytes"], offset + chunk_bytes) - 1
                    result = api.request("GET", url, "storage", headers={
                        "Range": f"bytes={offset}-{end}", "If-Match": part["etag"]}, maximum=end - offset + 1)
                    expected_range = f"bytes {offset}-{end}/{part['bytes']}"
                    if (result["status"] != 206 or result["headers"].get("content-range") != expected_range
                            or result["headers"].get("etag") != part["etag"] or len(result["raw"]) != end - offset + 1):
                        raise ValueError("The native partition response did not match its exact requested range.")
                    part["chunks"].append(self.store.blob(result["raw"], "azure-part-" + str(part["index"]) + "-" + str(offset) + ".bytes"))
                    part["received"] += len(result["raw"])
                if part["received"] == part["bytes"]:
                    raw = b"".join(self.store.bytes(chunk["digest"]) for chunk in part["chunks"])
                    part["file"] = self.store.blob(raw, PurePosixPath(part["name"]).name)
                payload.update({"state": "ready", "error": "", "retry_at": 0})
                self.finish_parts(payload)
                if payload["state"] == "complete":
                    final = api.request("GET", api.blob_url(payload["manifest_path"]), "storage",
                        headers={"If-Match": payload["manifest_response"]["headers"]["etag"]}, maximum=MAX_MANIFEST)
                    if digest(final["raw"]) != payload["manifest"]["digest"]:
                        payload.update({"state": "source_changed", "error": "The native manifest changed while its files were acquired."})
            else:
                self.finish_parts(payload)
        except (AzureError, ValueError) as error:
            self.failure(payload, error)
            if isinstance(error, AzureError) and error.status == 412:
                payload["state"] = "source_changed"
                payload["error"] = "The provider changed a pinned manifest or partition. Select its new complete edition."
        return self.write("azure_source", payload, record["id"], record["revision"])

    def preview(self, params):
        record = self.get("azure_source", params["id"], params.get("revision"))
        payload = record["payload"]
        index = int(params.get("partition", 0))
        if not 0 <= index < len(payload["parts"]):
            return {"source": reference(record), "headers": [], "rows": [], "total": 0, "offset": 0}
        part = payload["parts"][index]
        if not part.get("file"):
            raise ValueError("Receive the complete original partition before inspecting its rows.")
        name, data = csv_original(self.store.bytes(part["file"]["digest"]), part, payload)
        body = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(body, newline=""), strict=True)
        headers = reader.fieldnames or []
        offset = max(0, int(params.get("offset", 0)))
        limit = min(200, max(1, int(params.get("limit", 25))))
        rows, total = [], 0
        for ordinal, row in enumerate(reader, 1):
            total = ordinal
            if total > MAX_ROWS:
                raise ValueError("A decoded partition may contain at most 250000 rows.")
            if offset < ordinal <= offset + limit:
                rows.append({"ordinal": ordinal, "values": row})
        suggested = {}
        normal = {re.sub(r"[^a-z0-9]", "", header.lower()): header for header in headers}
        for field, aliases in COST_FIELDS.items():
            suggested[field] = next((normal[re.sub(r"[^a-z0-9]", "", name.lower())]
                for name in aliases if re.sub(r"[^a-z0-9]", "", name.lower()) in normal), "")
        return {"source": reference(record), "partition": index, "native_name": part["name"], "csv_name": name,
                "headers": headers, "suggested": suggested, "rows": rows, "total": total, "offset": offset}

    def source_review(self, request):
        source = self.get("azure_source", request["source_id"], request.get("source_revision"))
        payload = source["payload"]
        if payload["state"] != "complete":
            raise ValueError("Receive the complete selected native export before reviewing its billing mapping.")
        settings = {key: request.get(key, default) for key, default in (
            ("period", ""), ("basis", "actual"), ("allocation_view", "supplier"),
            ("invoice_status", "provisional"), ("invoice_id", ""), ("date_format", "iso"), ("columns", {}))}
        settings["period"] = month(settings["period"])
        settings["invoice_id"] = str(settings["invoice_id"] or "").strip()[:200]
        if settings["basis"] not in {"actual", "amortized"} or settings["allocation_view"] not in {"supplier", "allocated"}:
            raise ValueError("Choose one cost basis and provider-allocation view.")
        if settings["invoice_status"] not in {"provisional", "closed"} or settings["date_format"] not in {"iso", "month_first", "day_first"}:
            raise ValueError("Choose a supported supplier status and billing-period date format.")
        native_basis = {"actualcost": "actual", "amortizedcost": "amortized"}.get(payload["dataset_type"].lower())
        if native_basis is None:
            raise ValueError("Select the original ActualCost or AmortizedCost export for this billing engine; retained " + payload["dataset_type"] + " uses a different dataset contract.")
        if native_basis != settings["basis"]:
            raise ValueError("The selected basis differs from the native export's " + payload["dataset_type"] + " declaration.")
        if not isinstance(settings["columns"], dict):
            raise ValueError("Supply an explicit field-to-header mapping object.")
        from .service import package_files
        review_parts, totals, batches, group = [], {}, [], []
        group_bytes = group_rows = 0

        def flush():
            nonlocal group_bytes, group_rows
            if not group:
                return
            raw = package_files({item["member"]: item["data"] for item in group})
            metadata = self.store.blob(raw, "azure-cost-" + str(len(batches) + 1).zfill(4) + ".zip", "application/zip")
            batches.append({"index": len(batches), "currency": group[0]["currency"], "file": metadata,
                "rows": group_rows, "source_parts": sorted({item["part"] for item in group}),
                "members": [{key: item[key] for key in ("part", "member", "row_count", "native_rows")} for item in group]})
            group.clear()
            group_bytes = group_rows = 0

        def append_input(item):
            nonlocal group_bytes, group_rows
            if group and (item["currency"] != group[0]["currency"]
                    or group_bytes + len(item["data"]) > 48 * 1024 * 1024
                    or group_rows + item["row_count"] > MAX_ROWS):
                flush()
            group.append(item)
            group_bytes += len(item["data"])
            group_rows += item["row_count"]
            if group_bytes >= 48 * 1024 * 1024 or group_rows >= MAX_ROWS:
                flush()

        with localcontext() as context:
            context.prec = 64
            for part in payload["parts"]:
                name, data = csv_original(self.store.bytes(part["file"]["digest"]), part, payload)
                if part["rows"] == 0:
                    text = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
                    reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
                    if next(reader, None) is None:
                        review_parts.append({"index": part["index"], "native_name": part["name"], "row_count": 0,
                                             "headers": reader.fieldnames or [], "columns": {}, "currencies": []})
                        continue
                headers, mapping, rows = csv_rows(data, COST_FIELDS, settings["columns"])
                if not {"amount", "currency"} <= set(mapping):
                    raise ValueError("Map the actual billing amount and billing currency columns.")
                if part["rows"] is not None and len(rows) != part["rows"]:
                    raise ValueError("The decoded native row count differs from its manifest: " + part["name"])
                groups = {}
                for ordinal, row in rows:
                    amount = decimal(row["amount"], "Native cost row " + str(ordinal))
                    code = currency(row["currency"])
                    original_month = date_month(row.get("billing_period_start"), settings["date_format"])
                    if original_month and original_month != settings["period"]:
                        raise ValueError("The complete native input contains billing period " + original_month + " instead of " + settings["period"] + ".")
                    groups.setdefault(code, []).append(ordinal)
                    if not (settings["allocation_view"] == "supplier" and row.get("cost_allocation_rule", "").strip()):
                        totals[code] = totals.get(code, Decimal(0)) + amount
                if "billing_period_start" not in mapping:
                    start = str(payload["run"].get("startDate") or "")
                    end = str(payload["run"].get("endDate") or "")
                    if start and start[:7] != settings["period"]:
                        raise ValueError("The manifest starts outside the chosen month and has no mapped billing-period column.")
                    if end and end[:7] != settings["period"]:
                        # A native exclusive upper boundary at the first instant of the following month is valid.
                        year, mon = map(int, settings["period"].split("-"))
                        following = f"{year + (mon == 12):04d}-{1 if mon == 12 else mon + 1:02d}-01T00:00:00"
                        if not end.rstrip("Z").startswith(following):
                            raise ValueError("The native export spans other months; map its explicit billing-period column.")
                csv_file = self.store.blob(data, PurePosixPath(name).name, "text/csv")
                review_parts.append({"index": part["index"], "native_name": part["name"], "csv": csv_file,
                    "row_count": len(rows), "headers": headers, "columns": mapping, "currencies": list(groups),
                    "sample": [{"ordinal": ordinal, "values": row} for ordinal, row in rows[:5]]})
                originals = None
                if len(groups) > 1:
                    body = data.decode("utf-16") if data.startswith((b"\xff\xfe", b"\xfe\xff")) else data.decode("utf-8-sig")
                    originals = list(csv.DictReader(io.StringIO(body, newline=""), strict=True))
                for code, ordinals in groups.items():
                    selected_data = data
                    if originals is not None:
                        out = io.StringIO(newline="")
                        writer = csv.DictWriter(out, fieldnames=headers, lineterminator="\n")
                        writer.writeheader()
                        for ordinal in ordinals:
                            writer.writerow(originals[ordinal - 1])
                        selected_data = out.getvalue().encode("utf-8")
                    member = str(part["index"]).zfill(4) + "/" + name
                    append_input({"currency": code, "part": part["index"], "member": member, "data": selected_data,
                        "row_count": len(ordinals), "native_rows": ordinals if originals is not None else None})
                del rows, groups, originals
        flush()
        identity = {"source": reference(source), "settings": settings,
                    "inputs": [batch["file"]["digest"] for batch in batches], "note": str(request.get("note", ""))[:10000]}
        review_id = "azure_review_" + digest(encoded(identity).encode())[:40]
        old = self.existing("azure_review", review_id)
        if old:
            return old
        return self.write("azure_review", {"label": payload["label"] + " — " + settings["period"] + " source review",
            "source": reference(source), "manifest": payload["manifest"], "settings": settings,
            "parts": review_parts, "batches": batches, "rows": sum(part["row_count"] for part in review_parts),
            "totals": {code: number(value) for code, value in sorted(totals.items())}, "note": identity["note"],
            "reviewed": now(), "actor": self.service.actor, "state": "reviewed" if batches else "no_data"}, review_id)

    def import_prepare(self, request):
        review = self.get("azure_review", request["review_id"], request.get("review_revision"))
        plan_id = "azure_import_" + digest(encoded(reference(review)).encode())[:40]
        old = self.existing("azure_import", plan_id)
        if old:
            return old
        return self.write("azure_import", {"label": review["payload"]["label"] + " import",
            "review": reference(review), "source": review["payload"]["source"], "imports": [],
            "cursor": 0, "batch_count": len(review["payload"]["batches"]),
            "state": "ready" if review["payload"]["batches"] else "complete", "created": now()}, plan_id)

    def import_advance(self, request):
        record, payload = self.current("azure_import", request)
        if payload["state"] == "complete":
            return record
        review = self.get("azure_review", payload["review"]["id"], payload["review"]["revision"])
        batch = review["payload"]["batches"][payload["cursor"]]
        child_id = "azure_cost_" + digest(encoded({"import": record["id"], "batch": batch["index"],
                                                  "file": batch["file"]["digest"]}).encode())[:40]
        result = self.service.dispatch("billing.cost.import", {**review["payload"]["settings"],
            "label": review["payload"]["label"] + " / " + batch["currency"] + " / " + str(batch["index"] + 1),
            "operation_id": child_id, "filename": batch["file"]["name"],
            "base64": base64.b64encode(self.store.bytes(batch["file"]["digest"])).decode(),
            "azure_origin": {"source": review["payload"]["source"], "review": reference(review), "batch": batch["index"]}})
        payload["imports"].append({"billing": reference(result["record"]), "currency": batch["currency"],
            "rows": batch["rows"], "batch": batch["index"]})
        payload["cursor"] += 1
        payload["state"] = "complete" if payload["cursor"] == payload["batch_count"] else "ready"
        payload["updated"] = now()
        return self.write("azure_import", payload, record["id"], record["revision"])

    def billing_origin(self, supplied, data, request):
        if not isinstance(supplied, dict):
            raise ValueError("Azure origin must identify the exact saved source, review and batch.")
        source_ref, review_ref = supplied["source"], supplied["review"]
        source = self.get("azure_source", source_ref["id"], source_ref["revision"])
        review = self.get("azure_review", review_ref["id"], review_ref["revision"])
        if source_ref.get("kind") != "azure_source" or review_ref.get("kind") != "azure_review":
            raise ValueError("The supplied Azure origin kinds are invalid.")
        if not same_reference(review["payload"]["source"], reference(source)):
            raise ValueError("This review belongs to a different acquired source edition.")
        index = int(supplied["batch"])
        if not 0 <= index < len(review["payload"]["batches"]):
            raise ValueError("Select an actual reviewed batch.")
        settings = review["payload"]["settings"]
        for key, expected in settings.items():
            actual = request.get(key)
            if key == "invoice_id":
                actual = str(actual or "").strip()[:200]
            if actual != expected:
                raise ValueError("The billing " + key + " differs from the saved Azure source review.")
        batch = review["payload"]["batches"][index]
        if digest(data) != batch["file"]["digest"]:
            raise ValueError("The billing input differs from its exact reviewed Azure batch.")
        parts = [source["payload"]["parts"][i] for i in batch["source_parts"]]
        for part in parts:
            self.store.bytes(part["file"]["digest"])
        return {"schema": "commons-bi-azure-billing-origin/1", "source": reference(source),
            "review": reference(review), "manifest": source["payload"]["manifest"],
            "manifest_path": source["payload"]["manifest_path"], "origin": source["payload"]["origin"],
            "dataset_type": source["payload"]["dataset_type"], "data_version": source["payload"]["data_version"],
            "run": source["payload"]["run"], "settings": review["payload"]["settings"],
            "batch": {key: batch[key] for key in ("index", "currency", "file", "members", "source_parts")},
            "parts": [{key: part.get(key) for key in ("index", "name", "bytes", "rows", "etag", "native_headers", "file")} for part in parts]}

    def origin_files(self, origin):
        if origin.get("schema") != "commons-bi-azure-billing-origin/1":
            raise ValueError("The saved billing input has an unsupported upstream source origin.")
        prefix = "sources/azure/" + origin["manifest"]["digest"] + "/"
        files = {prefix + "manifest.json": self.store.bytes(origin["manifest"]["digest"]),
                 prefix + "reviews/" + origin["review"]["id"] + "-" + str(origin["batch"]["index"]) + ".json": encoded(origin).encode()}
        for part in origin["parts"]:
            files[prefix + "parts/" + str(part["index"]).zfill(4) + "/" + native_path(part["name"])] = self.store.bytes(part["file"]["digest"])
        return files

    def handoff_prepare(self, request):
        source = self.get("azure_source", request["source_id"], request.get("source_revision"))
        if source["payload"]["state"] != "complete":
            raise ValueError("Complete the native source before preparing its portable receiving handoff.")
        review = self.get("azure_review", request["review_id"], request.get("review_revision")) if request.get("review_id") else None
        if review and not same_reference(review["payload"]["source"], reference(source)):
            raise ValueError("Choose a review of this exact acquired source edition.")
        identity = {"source": reference(source), "review": reference(review) if review else None}
        delivery_id = "azure_delivery_" + digest(encoded(identity).encode())[:40]
        old = self.existing("azure_delivery", delivery_id)
        if old:
            return old
        content = {"source": {**source, "payload": clean(source["payload"])},
                   "review": {**review, "payload": clean(review["payload"])} if review else None}
        objects, segments = [], {}
        for sha, metadata in sorted(blob_refs(content).items()):
            data = self.store.bytes(sha)
            recipe = []
            for offset in range(0, len(data), CHUNK_BYTES):
                segment = self.store.blob(data[offset:offset + CHUNK_BYTES], "azure-carrier-" + str(offset) + ".bytes")
                segments[segment["digest"]] = segment
                recipe.append(segment)
            objects.append({"file": metadata, "segments": recipe})
        descriptor = {"schema": RECEIVING_SCHEMA, "workspace_id": self.store.setting("workspace_id"),
                      **content, "objects": objects}
        descriptor_file = self.json_blob(descriptor, "AZURE_RECEIVING.json")
        if descriptor_file["bytes"] > MAX_MANIFEST:
            raise ValueError("The complete receiving descriptor exceeds 4 MiB.")
        groups, current, size = [], [], 0
        for sha, segment in segments.items():
            if current and size + segment["bytes"] > 40 * 1024 * 1024:
                groups.append(current)
                current, size = [], 0
            current.append(sha)
            size += segment["bytes"]
        if current or not groups:
            groups.append(current)
        return self.write("azure_delivery", {"label": source["payload"]["label"] + " portable source",
            **identity, "descriptor": descriptor_file, "groups": groups, "segments": segments,
            "volumes": [], "cursor": 0, "state": "ready", "created": now()}, delivery_id)

    def handoff_advance(self, request):
        record, payload = self.current("azure_delivery", request)
        if payload["state"] == "complete":
            return record
        from .service import package_files
        index = payload["cursor"]
        files = {"AZURE_RECEIVING.json": self.store.bytes(payload["descriptor"]["digest"]),
                 "VOLUME.json": encoded({"schema": RECEIVING_SCHEMA, "descriptor_sha256": payload["descriptor"]["digest"],
                     "index": index, "count": len(payload["groups"]), "segments": payload["groups"][index]}).encode(),
                 "OPEN_FIRST.txt": ("Open this ZIP through Azure exports / Receive portable handoff in the original BI Operator. "
                    "Receive all numbered volumes in any order. The operator verifies every segment and reassembles the "
                    "original manifest, native files and reviewed billing inputs. Open the saved source to restore its "
                    "reviewed mapping, then import it into Agency billing. No Azure credential is included.\n").encode()}
        for sha in payload["groups"][index]:
            files["segments/" + sha] = self.store.bytes(sha)
        data = package_files(files)
        filename = "Azure-Source-" + record["id"][-12:] + "-" + str(index + 1).zfill(3) + "-of-" + str(len(payload["groups"])).zfill(3) + ".zip"
        package = self.store.blob(data, filename, "application/zip")
        payload["volumes"].append(package)
        payload["cursor"] += 1
        payload["state"] = "complete" if payload["cursor"] == len(payload["groups"]) else "ready"
        return self.write("azure_delivery", payload, record["id"], record["revision"])

    def handoff_receive(self, request):
        data, _ = upload(request)
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            names = package.namelist()
            if len(names) != len(set(names)) or len(names) > 20000:
                raise ValueError("The receiving volume has duplicate member names or too many entries.")
            if "AZURE_RECEIVING.json" not in names or "VOLUME.json" not in names:
                raise ValueError("Choose an original Azure receiving volume.")
            if package.getinfo("AZURE_RECEIVING.json").file_size > MAX_MANIFEST:
                raise ValueError("The receiving descriptor exceeds 4 MiB.")
            raw = package.read("AZURE_RECEIVING.json")
            descriptor = json.loads(raw)
            volume = json.loads(package.read("VOLUME.json"))
            if descriptor.get("schema") != RECEIVING_SCHEMA or volume.get("schema") != RECEIVING_SCHEMA:
                raise ValueError("The selected volume has an unsupported receiving schema.")
            descriptor_sha = digest(raw)
            if volume.get("descriptor_sha256") != descriptor_sha:
                raise ValueError("This volume does not match its complete original receiving descriptor.")
            source = descriptor.get("source")
            if not isinstance(source, dict) or source.get("kind") != "azure_source" or not isinstance(source.get("payload"), dict):
                raise ValueError("The receiving descriptor has no original acquired source.")
            objects = descriptor.get("objects")
            if not isinstance(objects, list) or len(objects) > 20000:
                raise ValueError("The receiving object closure is invalid.")
            expected_segments, object_ids = {}, {}
            for item in objects:
                metadata = item.get("file", {})
                if not re.fullmatch(r"[a-f0-9]{64}", str(metadata.get("digest", ""))) or type(metadata.get("bytes")) is not int or not 0 <= metadata["bytes"] <= MAX_INPUT:
                    raise ValueError("A receiving object has an invalid complete-file identity.")
                if metadata["digest"] in object_ids:
                    raise ValueError("The receiving closure repeats an original object.")
                object_ids[metadata["digest"]] = metadata["bytes"]
                chunks = item.get("segments")
                if not isinstance(chunks, list) or sum(chunk.get("bytes", -1) for chunk in chunks) != metadata["bytes"]:
                    raise ValueError("A receiving object's complete segment sizes do not reconcile.")
                for chunk in chunks:
                    if (not re.fullmatch(r"[a-f0-9]{64}", str(chunk.get("digest", "")))
                            or type(chunk.get("bytes")) is not int or not 0 < chunk["bytes"] <= CHUNK_BYTES):
                        raise ValueError("A receiving segment identity is invalid.")
                    old = expected_segments.get(chunk["digest"])
                    if old and old["bytes"] != chunk["bytes"]:
                        raise ValueError("The descriptor repeats a segment with different bytes.")
                    expected_segments[chunk["digest"]] = chunk
            closure = blob_refs({"source": source, "review": descriptor.get("review")})
            if set(closure) != set(object_ids) or any(value["bytes"] != object_ids[sha] for sha, value in closure.items()):
                raise ValueError("The receiving descriptor does not carry every referenced original object.")
            received = volume.get("segments")
            if (not isinstance(received, list) or len(received) != len(set(received))
                    or any(sha not in expected_segments for sha in received)):
                raise ValueError("This volume declares unknown or duplicated receiving segments.")
            expected_names = {"AZURE_RECEIVING.json", "VOLUME.json", "OPEN_FIRST.txt"} | {"segments/" + sha for sha in received}
            if set(names) != expected_names:
                raise ValueError("The volume differs from its original complete member list.")
            if sum(package.getinfo(name).file_size for name in names) > 48 * 1024 * 1024:
                raise ValueError("The complete receiving volume exceeds 48 MiB expanded.")
            for sha in received:
                body = package.read("segments/" + sha)
                if len(body) != expected_segments[sha]["bytes"] or digest(body) != sha:
                    raise ValueError("A complete receiving segment failed its original byte identity.")
                self.store.blob(body, expected_segments[sha].get("name", sha))
        receipt_id = "azure_receive_" + descriptor_sha[:40]
        prior = self.existing("azure_receive", receipt_id)
        payload = clean(prior["payload"]) if prior else {
            "label": source["payload"].get("label", "Azure source") + " receiving",
            "descriptor": self.store.blob(raw, "AZURE_RECEIVING.json", "application/json"),
            "sender": {"workspace_id": descriptor.get("workspace_id"), "source": reference(source)},
            "volumes": [], "state": "receiving", "source": None, "created": now()}
        if payload["state"] == "complete":
            return prior
        volume_identity = {"index": volume.get("index"), "count": volume.get("count"), "digest": digest(data)}
        if not any(item["digest"] == volume_identity["digest"] for item in payload["volumes"]):
            payload["volumes"].append(volume_identity)
        missing = []
        for item in objects:
            metadata = item["file"]
            try:
                body = self.store.bytes(metadata["digest"])
                if len(body) != metadata["bytes"]:
                    raise ValueError("An existing receiving object has a different length.")
                continue
            except FileNotFoundError:
                pass
            try:
                body = b"".join(self.store.bytes(chunk["digest"]) for chunk in item["segments"])
            except FileNotFoundError:
                missing.append(metadata["digest"])
                continue
            if len(body) != metadata["bytes"] or digest(body) != metadata["digest"]:
                raise ValueError("A reconstructed original object failed its complete byte identity.")
            self.store.blob(body, metadata.get("name", metadata["digest"]), metadata.get("media_type", "application/octet-stream"))
        payload["missing_objects"] = len(missing)
        if not missing:
            source_payload = source["payload"]
            manifest_raw = self.store.bytes(source_payload["manifest"]["digest"])
            parsed = parse_manifest(manifest_raw)
            for field, value in parsed.items():
                if field != "parts" and source_payload.get(field) != value:
                    raise ValueError("The receiving " + field + " differs from its original native manifest.")
            if source["id"] != "azure_source_" + digest(manifest_raw)[:40]:
                raise ValueError("The receiving source ID differs from its original manifest.")
            for expected, actual in zip(parsed["parts"], source_payload.get("parts", [])):
                if any(expected[key] != actual.get(key) for key in ("name", "bytes", "rows", "index")):
                    raise ValueError("The receiving partition differs from the native manifest.")
                raw_part = self.store.bytes(actual["file"]["digest"])
                if len(raw_part) != expected["bytes"]:
                    raise ValueError("A receiving partition differs from its native byte count.")
            if len(parsed["parts"]) != len(source_payload.get("parts", [])):
                raise ValueError("The receiving source does not contain every native partition.")
            target = self.existing("azure_source", source["id"])
            if target and target["payload"]["state"] == "complete":
                if [part["file"]["digest"] for part in target["payload"]["parts"]] != [part["file"]["digest"] for part in source_payload["parts"]]:
                    raise ValueError("The receiving edition conflicts with the existing original source.")
            else:
                imported = {**clean(source_payload), "profile": None, "state": "complete",
                    "received_from": payload["sender"], "received_review": descriptor.get("review"), "received": now()}
                target = self.write("azure_source", imported, source["id"], target["revision"] if target else 0)
            payload.update({"state": "complete", "source": reference(target), "completed": now()})
        return self.write("azure_receive", payload, receipt_id, prior["revision"] if prior else 0)
