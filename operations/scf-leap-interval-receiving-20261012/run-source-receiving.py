#!/usr/bin/env python3
"""MIT. Complete standalone Leap receiving using its original CLI and HTTP owner."""
from __future__ import annotations
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import quote, urlencode, urlsplit
from uuid import uuid4
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("leap_original_receiving", HERE / "run-receiving.py")
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
need, read_json, atomic_json = original.need, original.read_json, original.atomic_json
identity, verify, private_directory = original.identity, original.verify, original.private_directory
copy_exact, stamp, json_bytes = original.copy_exact, original.stamp, original.json_bytes
OPERATION = "LEAP-SOURCE-APPLICATION-RECEIVING-20261012-1FB3"
BASE = "stellar/scf-starforge-20261009"
COLLECTIONS = ("imports", "mappings", "batches", "missing_snapshots", "api_receipts",
               "meters", "original_files", "files", "exports")
DATA_COLLECTIONS = tuple(name for name in COLLECTIONS if name != "exports")


class SourceReceiving:
    save = original.Receiving.save
    command = original.Receiving.command
    cli = original.Receiving.cli
    owner = original.Receiving.owner
    http_json = staticmethod(original.Receiving.http_json)
    export_cli = original.Receiving.export_cli
    restore_cli = original.Receiving.restore_cli

    def __init__(self, configuration):
        self.config = configuration
        need(configuration.get("operationId", OPERATION) == OPERATION, "Keep this standalone receiving operation.")
        self.output = private_directory(configuration["outputDirectory"])
        self.artifacts = private_directory(self.output / "delivery")
        self.source = Path(configuration["sourceRoot"]).absolute()
        self.python = str(Path(configuration["pythonExecutable"]).absolute())
        self.node = str(Path(configuration["nodeExecutable"]).absolute())
        self.workspace = self.output / "workspace"
        self.cold = self.output / "restored-workspace"
        self.journal_path = self.output / "source-receiving-journal.json"
        self.completion = self.output / "source-completed-delivery.json"
        self.finalization = self.output / "source-finalization.json"
        self.report_path = self.output / "Leap_Source_Application_Operation.json"
        self.owner_process = None
        self.original_command = [self.python, str(self.source / BASE / "sf30-seller-sdk/leap-intervals/cli.py")]
        self.env = {**os.environ, "CODEX_PRIMARY_RUNTIME_PYTHON": self.python,
                    "STARFORGE_PYTHON": self.python, "PYTHONDONTWRITEBYTECODE": "1"}
        self.input = configuration["input"]
        need(isinstance(self.input, dict) and all(isinstance(self.input.get(name), list)
             and self.input[name] for name in ("sources", "mappings", "batches")),
             "Use the complete reviewed input portfolio.")
        need(not self.input.get("missingScopes"), "This local functional run performs no provider missing-window request.")
        need(all(not row.get("providerActions") for row in self.input["batches"]),
             "This local functional run performs no provider action.")
        self.state = read_json(self.journal_path) if self.journal_path.exists() else {
            "schema": "stellar-forge.leap-source-application-receiving.v1",
            "operationId": OPERATION, "executionKind": "standalone-source-application",
            "createdAt": stamp(), "phases": {}, "actions": {}, "mappings": {}, "batches": {},
            "owners": [], "attempts": [], "providerActionsRequested": 0,
            "providerIngestionCompleted": None, "installedRuntime": None,
        }
        need(self.state.get("operationId") == OPERATION, "The retained journal is a different receiving operation.")
        semantic = {
            "configuration": self.input["configuration"],
            "sources": [{k: v for k, v in row.items() if k != "path"} for row in self.input["sources"]],
            "mappings": self.input["mappings"], "batches": self.input["batches"],
            "deliveryBatchKey": self.input.get("deliveryBatchKey"),
        }
        self.reviewed_input = semantic
        fingerprint = hashlib.sha256(json_bytes(semantic)).hexdigest()
        need(self.state.get("inputSha256", fingerprint) == fingerprint, "Continue the same complete reviewed inputs.")
        self.state["inputSha256"] = fingerprint
        self.state["attempts"].append({"at": stamp(), "previousStatus": self.state.get("status"),
                                      "previousError": self.state.get("error")})
        self.state.pop("error", None)
        self.save()

    def event(self, name, **values):
        print(json.dumps({"event": name, "operationId": OPERATION, **values}), flush=True)

    def preflight(self):
        manifest_path = Path(self.config["sourceManifest"]).absolute()
        manifest = read_json(manifest_path)
        need(manifest.get("schema") == "stellar-forge.leap-standalone-source.v1"
             and manifest["sourceCommit"] == self.config["sourceCommit"],
             "Use the exact standalone source declaration.")
        rows = []
        for row in manifest["files"]:
            relative = Path(row["path"])
            need(not relative.is_absolute() and ".." not in relative.parts, "Invalid source member.")
            rows.append({"path": row["path"], **verify(self.source / relative, row)})
        if self.state.get("source"):
            need(rows == self.state["source"]["members"], "The original application source changed during this run.")
        self.state["source"] = {
            "sourceCommit": manifest["sourceCommit"], "executionKind": "standalone-source-application",
            "manifest": {"path": str(manifest_path), **identity(manifest_path)},
            "members": rows, "verifiedAt": stamp(), "uiRevision": manifest.get("uiRevision"),
            "entrypoint": str(self.source / BASE / "sf30-seller-sdk/leap-intervals/cli.py"),
            "selectedBuild": None, "installedRuntime": None,
        }
        for row in self.input["sources"]:
            verify(row["path"], row)
        self.command([*self.original_command, "--workspace", str(self.workspace), "--help"],
                     "source-command-help", json_result=False)
        self.state["phases"]["source"] = {"status": "COMPLETE", "at": stamp(), "files": len(rows)}
        self.save()
        self.event("SOURCE_APPLICATION_VERIFIED", files=len(rows), sourceCommit=manifest["sourceCommit"])

    @staticmethod
    def connection(path):
        url = urlsplit(Path(path).read_text(encoding="utf-8").strip())
        need(url.scheme == "http" and url.hostname == "127.0.0.1" and url.fragment
             and not url.username and not url.password, "Use the original private loopback owner.")
        return url

    def api(self, connection, path, method="GET", body=None, headers=None):
        url = self.connection(connection)
        client = http.client.HTTPConnection(url.hostname, url.port, timeout=300)
        request_headers = {"Authorization": "Bearer " + url.fragment, "Host": url.netloc,
                           "Origin": "http://" + url.netloc, **(headers or {})}
        if body is not None:
            request_headers["Content-Length"] = str(len(body))
        try:
            client.request(method, path, body=body, headers=request_headers)
            response = client.getresponse()
            raw = response.read(64 * 1024 * 1024 + 1)
            need(len(raw) <= 64 * 1024 * 1024, "The original complete JSON response exceeded 64 MiB.")
            value = json.loads(raw)
            if not 200 <= response.status < 300:
                error = RuntimeError("Original HTTP " + str(response.status) + ": " + str(value.get("error", value)))
                error.status = response.status
                error.original = value
                raise error
            return value
        finally:
            client.close()

    def mutation(self, connection, key, action, payload, source=None):
        semantic = {"action": action, "payload": payload,
                    "source": ({k: v for k, v in source.items() if k != "path"} if source else None)}
        fingerprint = hashlib.sha256(json_bytes(semantic)).hexdigest()
        step = self.state["actions"].get(key)
        if step:
            need(step["fingerprint"] == fingerprint, "A saved action key belongs to different reviewed input.")
            if step["status"] == "COMPLETE":
                return step["reply"]
            try:
                operation = self.api(connection, "/api/operation?" + urlencode({"id": step["requestId"]}))
            except RuntimeError as error:
                value = getattr(error, "original", {})
                if getattr(error, "status", None) != 404 or value.get("error", {}).get("code") != "LOCAL_OPERATION_NOT_FOUND":
                    raise
                current = self.api(connection, "/api/state")
                need(current["workspace_id"] == self.state["workspaceId"]
                     and current["revision"] == step["expectedRevision"],
                     "The unaccepted original action needs review at its saved workspace revision.")
                step["absenceReadback"] = {"code": "LOCAL_OPERATION_NOT_FOUND",
                    "workspaceId": current["workspace_id"], "revision": current["revision"], "at": stamp()}
                self.save()
                operation = None
            if operation and operation.get("status") == "COMPLETED":
                step.update(status="COMPLETE", reply={"request_id": step["requestId"],
                            "revision": operation["revision"], "result": operation["result"]},
                            recoveredAt=stamp(), originalOperation=operation)
                self.save()
                return step["reply"]
            need(operation is None or (operation.get("status") == "INTERRUPTED" and operation.get("recoverable") is True),
                 "Retain the original uncertain action; it has no confirmed same-UUID local continuation.")
        else:
            state = self.api(connection, "/api/state")
            step = {"requestId": str(uuid4()), "expectedRevision": state["revision"],
                    "status": "PREPARED", "fingerprint": fingerprint,
                    "reviewed": semantic, "preparedAt": stamp()}
            self.state["actions"][key] = step
            self.save()
        if source:
            path = Path(source["path"])
            verify(path, source)
            body = path.read_bytes()
            headers = {"X-Leap-Name": quote(source.get("name", path.name), safe=""),
                       "X-Leap-Format": source["format"], "X-Leap-Revision": str(step["expectedRevision"]),
                       "X-Leap-Request-Id": step["requestId"], "X-Leap-Sha256": source["sha256"]}
            route = "/api/upload"
        else:
            body = json_bytes({"action": action, "payload": payload,
                               "expected_revision": step["expectedRevision"], "request_id": step["requestId"]})
            headers, route = {"Content-Type": "application/json"}, "/api/action"
        reply = self.api(connection, route, "POST", body, headers)
        need(reply.get("request_id") == step["requestId"], "The original action returned another request identity.")
        step.update(status="COMPLETE", reply=reply, completedAt=stamp())
        self.save()
        self.event("ORIGINAL_ACTION_COMPLETE", action=action, key=key, revision=reply["revision"])
        return reply

    def page_all(self, connection, path, parameters):
        items, total, pages = [], None, 0
        while True:
            reply = self.api(connection, path + "?" + urlencode({**parameters, "offset": len(items), "limit": 500}))
            need(isinstance(reply.get("items"), list) and isinstance(reply.get("total"), int)
                 and reply.get("offset") == len(items), "The original page contract changed.")
            if total is None:
                total = reply["total"]
            need(reply["total"] == total, "The retained collection changed during complete receiving.")
            items.extend(reply["items"])
            pages += 1
            if len(items) == total:
                return items, pages
            need(reply["items"] and len(items) < total, "The complete original collection ended before its total.")

    def receive_pages(self, connection, path, parameters, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = destination.with_name(destination.name + "." + str(uuid4()) + ".tmp")
        count, total, pages = 0, None, 0
        with open(temporary, "xb") as out:
            os.chmod(temporary, 0o600)
            while True:
                reply = self.api(connection, path + "?" + urlencode({**parameters, "offset": count, "limit": 500}))
                need(isinstance(reply.get("items"), list) and reply.get("offset") == count, "The original row page changed.")
                if total is None:
                    total = reply["total"]
                need(reply["total"] == total, "The original row total changed during receiving.")
                for row in reply["items"]:
                    out.write((json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n").encode())
                count += len(reply["items"])
                pages += 1
                if count == total:
                    break
                need(reply["items"] and count < total, "The complete row sequence ended before its total.")
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, destination)
        return {"path": str(destination), "count": count, "pages": pages, **identity(destination)}

    def receive_file(self, connection, metadata, folder):
        need(isinstance(metadata, dict) and re.fullmatch("[a-f0-9]{64}", metadata.get("sha256", ""))
             and isinstance(metadata.get("bytes"), int), "Use the original complete file identity.")
        folder = private_directory(folder)
        name = re.sub("[^A-Za-z0-9._-]", "_", metadata.get("name", "source"))[:140] or "source"
        destination = folder / (metadata["sha256"] + "-" + name)
        if destination.exists():
            return {**metadata, "path": str(destination), **verify(destination, metadata)}
        base = self.connection(connection)
        target = urlsplit(metadata["download_url"])
        need((not target.scheme or (target.scheme == "http" and target.netloc == base.netloc))
             and target.path in {"/api/file", "/api/export"} and not target.fragment,
             "Receive the retained original owner's file route.")
        client = http.client.HTTPConnection(base.hostname, base.port, timeout=300)
        temporary = destination.with_name(destination.name + "." + str(uuid4()) + ".tmp")
        try:
            client.request("GET", target.path + ("?" + target.query if target.query else ""),
                           headers={"Authorization": "Bearer " + base.fragment, "Host": base.netloc})
            response = client.getresponse()
            need(response.status == 200, "The original file returned HTTP " + str(response.status))
            if response.getheader("Content-Length") is not None:
                need(int(response.getheader("Content-Length")) == metadata["bytes"], "Original file length differs.")
            with open(temporary, "xb") as out:
                os.chmod(temporary, 0o600)
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
            verify(temporary, metadata)
            os.replace(temporary, destination)
            return {**metadata, "path": str(destination), **identity(destination)}
        finally:
            client.close()

    def inspect_complete(self, connection, label):
        folder = private_directory(self.output / label)
        start = self.api(connection, "/api/state")
        records, counts = {}, {}
        for name in COLLECTIONS:
            listed, pages = self.page_all(connection, "/api/list", {"collection": name})
            complete = [self.api(connection, "/api/item?" + urlencode({"collection": name, "id": row.get("id", row.get("job_id"))}))
                        for row in listed]
            destination = folder / "records" / (name + ".json")
            atomic_json(destination, complete)
            records[name] = complete
            counts[name] = {"count": len(complete), "pages": pages, "path": str(destination), **identity(destination)}
        batches = {}
        for batch in records["batches"]:
            rows = self.receive_pages(connection, "/api/rows", {"batch_id": batch["id"]}, folder / "rows" / (batch["id"] + ".ndjson"))
            issues = self.receive_pages(connection, "/api/issues", {"batch_id": batch["id"]}, folder / "issues" / (batch["id"] + ".ndjson"))
            need(rows["count"] == batch["row_count"] and issues["count"] == batch["issue_count"],
                 "The complete original batch differs from its retained totals.")
            batches[batch["id"]] = {"batch": batch, "rows": rows, "issues": issues}
        missing = []
        for snapshot in records["missing_snapshots"]:
            missing.append(self.receive_pages(connection, "/api/missing", {"snapshot_id": snapshot["id"]},
                           folder / "missing" / (snapshot["id"] + ".ndjson")))
        files = [self.receive_file(connection, meta, folder / "original-files") for meta in records["files"]]
        end = self.api(connection, "/api/state")
        need(start["workspace_id"] == end["workspace_id"] and start["revision"] == end["revision"],
             "Read-only receiving changed the original logical workspace.")
        report = {"workspaceId": end["workspace_id"], "revision": end["revision"], "state": end,
                  "collections": counts, "batches": batches, "files": files, "missing": missing}
        atomic_json(folder / "inspection.json", report)
        return report, records

    def use_browser(self):
        if not self.config.get("playwright") or not self.config.get("chromium"):
            return {"enabled": False, "reason": "No existing browser runtime was selected."}
        paths = [Path(self.config[name]) for name in ("playwright", "chromium")]
        if not all(path.is_file() for path in paths):
            return {"enabled": False, "reason": "The selected existing browser files are unavailable."}
        current_path, maximum_path = Path("/sys/fs/cgroup/memory.current"), Path("/sys/fs/cgroup/memory.max")
        observation = {}
        if current_path.exists() and maximum_path.exists():
            current, maximum = current_path.read_text().strip(), maximum_path.read_text().strip()
            observation = {"currentBytes": int(current), "limitBytes": int(maximum) if maximum != "max" else None}
            if maximum != "max" and int(maximum) - int(current) < 384 * 1024 * 1024:
                return {"enabled": False, "reason": "Observed shared memory cannot accommodate the existing browser process.",
                        "memory": observation}
        return {"enabled": True, "memory": observation}

    def inspect_browser(self, connection, report, label):
        decision = self.use_browser()
        self.state.setdefault("browserDecisions", {})[label] = decision
        self.save()
        if not decision["enabled"]:
            self.event("SOURCE_BROWSER_UNAVAILABLE", phase=label, **decision)
            return {"status": "NOT_RUN", **decision}
        expected = {"workspaceId": report["workspaceId"], "deliveryBatchId": self.state["deliveryBatchId"],
                    "batches": sorted([{"id": value["batch"]["id"], "upload": value["batch"]["upload"]["sha256"],
                       "row_count": value["batch"]["row_count"], "mapping_id": value["batch"]["mapping_id"]}
                       for value in report["batches"].values()], key=lambda row: row["id"])}
        config = {"connectionFile": str(connection), "outputDirectory": str(self.output / label),
                  "input": self.input, "mode": "inspect", "expected": expected,
                  "playwright": self.config["playwright"], "chromium": self.config["chromium"]}
        path = self.output / "private-process" / (label + ".json")
        atomic_json(path, config)
        result = self.command([self.node, "--max-old-space-size=384", str(HERE / "run-browser.mjs"), str(path)],
                              label, timeout=3600)
        need(result.get("passed") is True and result.get("browserClosed") is True, "The original rendered review did not close successfully.")
        return {"status": "PASS", "coverage": "complete read-only original UI and downloads", **result}

    def reconcile_owner_history(self, workspace, logical_id, command_label):
        # The preceding original CLI completed after acquiring and releasing this exact lease.
        # A stale PID or connection descriptor alone is never closure evidence.
        expected = Path(workspace).resolve()
        changed = False
        for owner in self.state.get("owners", []):
            if owner.get("closed") is True or owner.get("closureReconciled"):
                continue
            launch = owner.get("launch", {})
            if launch.get("workspace") and Path(launch["workspace"]).resolve() == expected:
                need(launch.get("workspace_id") == logical_id, "The previous owner belongs to a different logical workspace.")
                owner["closureReconciled"] = {
                    "originalLeaseReacquired": True, "at": stamp(), "workspaceId": logical_id,
                    "workspace": str(expected), "originalCliCommand": command_label,
                    "basis": "The later original CLI successfully acquired and released this same exclusive workspace lease.",
                }
                changed = True
        if changed:
            self.save()

    def operate_http(self, connection):
        self.mutation(connection, "configuration", "configuration.save", self.input["configuration"])
        for index, source in enumerate(self.input["sources"]):
            reply = self.mutation(connection, "source-" + str(index), "source.register",
                                  {"format": source["format"], "sha256": source["sha256"]}, source=source)
            need(reply["result"]["id"] == source["sha256"], "The original input identity changed.")
        for mapping in self.input["mappings"]:
            reply = self.mutation(connection, "mapping-" + mapping["key"], "mapping.save", mapping["value"])
            self.state["mappings"][mapping["key"]] = reply["result"]["id"]
            self.save()
        for item in self.input["batches"]:
            payload = {**item["prepare"], "mapping_id": self.state["mappings"][item["mappingKey"]]}
            if item.get("correctionOfKey"):
                payload["correction_of"] = self.state["batches"][item["correctionOfKey"]]["id"]
            reply = self.mutation(connection, "batch-" + item["key"], "batch.prepare", payload)
            batch = self.api(connection, "/api/item?" + urlencode({"collection": "batches", "id": reply["result"]["id"]}))
            for key, expected in item.get("expected", {}).items():
                need(batch.get(key) == expected, "Original " + item["key"] + " " + key + ": " + str(batch.get(key)) + " != " + str(expected))
            self.state["batches"][item["key"]] = batch
            self.save()
        key = self.input.get("deliveryBatchKey", self.input["batches"][-1]["key"])
        self.state["deliveryBatchId"] = self.state["batches"][key]["id"]
        self.save()
        exported = self.mutation(connection, "http-export", "package.export", {"batch_id": self.state["deliveryBatchId"]})
        self.state["httpPortable"] = self.receive_file(connection, exported["result"], self.output / "http-export")
        self.save()
        self.event("SOURCE_HTTP_PORTFOLIO_COMPLETE", batches=len(self.state["batches"]), deliveryBatchId=self.state["deliveryBatchId"])

    def cold_reexport(self):
        phase = self.state["phases"].setdefault("coldReexport", {"requestId": str(uuid4()), "status": "PREPARED"})
        destination = self.output / "Leap_Interval_Reexport.zip"
        if phase["status"] == "COMPLETE":
            verify(destination, phase["file"])
            return phase
        state = self.cli(self.cold, ["status"], "cold-before-reexport")
        if "expectedRevision" not in phase:
            phase["expectedRevision"] = state["revision"]
            self.save()
        reply = self.cli(self.cold, ["export", "--batch-id", self.state["deliveryBatchId"], "--out", str(destination),
                        "--request-id", phase["requestId"], "--expected-revision", str(phase["expectedRevision"])],
                         "cold-original-reexport")
        with zipfile.ZipFile(destination) as archive:
            need(archive.testzip() is None, "The full re-export failed its original ZIP CRC check.")
            members = [{"name": row.filename, "bytes": row.file_size, "crc32": format(row.CRC, "08x")}
                       for row in archive.infolist()]
        phase.update(status="COMPLETE", result=reply, file={"path": str(destination), **verify(destination, reply["result"])}, members=members)
        self.save()
        return phase

    def finish(self):
        if self.finalization.exists():
            frozen = read_json(self.finalization)
            need(frozen.get("operationId") == OPERATION and frozen.get("inputSha256") == self.state["inputSha256"],
                 "Keep the original completed source receiving and reviewed input.")
            report, customer = frozen["report"], private_directory(frozen["customerDirectory"])
        else:
            need(self.state["phases"].get("coldReexport", {}).get("status") == "COMPLETE",
                 "Complete cold receiving and re-export before finalizing.")
            self.state.update(status="COMPLETE", productPassed=True, completedAt=self.state.get("completedAt", stamp()))
            self.save()
            report = {**self.state, "sourceExecutionComplete": True, "providerActionsRequested": 0,
                      "providerIngestionCompleted": None, "installedRuntime": None,
                      "scope": "Original standalone Python/HTTP application, full functional source inputs, correction, export, cold restore and re-export."}
            customer = self.artifacts / "Leap_Source_Application_Delivery"
            copies = []
            for name in ("Leap_Interval_Workspace.zip", "Leap_Interval_Reexport.zip"):
                copies.append((self.output / name, customer / name))
            for name in ("live", "cold", "http-export", "live-browser", "cold-browser"):
                folder = self.output / name
                if folder.exists():
                    for path in sorted(folder.rglob("*")):
                        if path.is_file() and not path.is_symlink() and not path.name.endswith(".tmp"):
                            copies.append((path, customer / name / path.relative_to(folder)))
            for source in self.input["sources"]:
                verify(source["path"], source)
                copies.append((Path(source["path"]), customer / "original-inputs" / Path(source["path"]).name))
            copies.append((Path(self.config["sourceManifest"]), customer / "source-manifest.json"))
            need(len({str(target) for _, target in copies}) == len(copies), "Customer member names must be distinct.")
            frozen = {
                "schema": "stellar-forge.leap-source-application-finalization.v1",
                "operationId": OPERATION, "inputSha256": self.state["inputSha256"],
                "report": report, "reviewedInput": self.reviewed_input, "customerDirectory": str(customer),
                "copies": [{"source": str(source), "destination": str(target), **identity(source)} for source, target in copies],
            }
            atomic_json(self.finalization, frozen)
            customer = private_directory(customer)
        atomic_json(self.report_path, report)
        copy_exact(self.report_path, customer / self.report_path.name)
        for row in frozen["copies"]:
            copy_exact(row["source"], row["destination"], row)
        atomic_json(customer / "reviewed-input.json", frozen["reviewedInput"])
        text = ("# Leap standalone application receiving\n\n"
                "This package records the original Python/HTTP source application at " + self.config["sourceCommit"] + ".\n\n"
                "It includes the literal published 2024 input, separately labeled local functional device inputs, both mappings, "
                "all three batches, complete original rows and issues, exact source downloads, correction lineage, "
                "the original CLI export, cold restore and cold re-export. No Leap provider action was requested. "
                "An installed Starforge runtime is not asserted by this source operation.\n\n"
                "Open Leap_Source_Application_Operation.json for actual source identities, original action UUIDs, "
                "batch totals, owner close results and browser observations. The nested workspace ZIP is received by "
                "the original leap-intervals/cli.py --workspace NEW_PRIVATE_DIRECTORY restore --file ZIP command.\n")
        readme = customer / "RECEIVING.md"
        if not readme.exists():
            with open(readme, "x", encoding="utf-8") as out:
                out.write(text)
                out.flush()
                os.fsync(out.fileno())
        else:
            need(readme.read_text(encoding="utf-8") == text, "The completed receiving guide changed.")
        members = [customer / self.report_path.name, customer / "reviewed-input.json", readme,
                   *(Path(row["destination"]) for row in frozen["copies"])]
        files = {path.relative_to(customer).as_posix(): identity(path) for path in sorted(members)}
        atomic_json(customer / "delivery-manifest.json", {
            "schema": "stellar-forge.leap-source-application-handoff.v1", "operationId": OPERATION,
            "workspaceId": report["workspaceId"], "deliveryBatchId": report["deliveryBatchId"], "files": files})
        archive = self.artifacts / "Leap_Source_Application_Delivery.zip"
        temporary = archive.with_name(archive.name + "." + str(uuid4()) + ".tmp")
        with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as out:
            for path in sorted([*members, customer / "delivery-manifest.json"]):
                out.write(path, path.relative_to(customer).as_posix())
        with open(temporary, "rb") as original_file:
            os.fsync(original_file.fileno())
        with zipfile.ZipFile(temporary) as complete:
            need(complete.testzip() is None, "The full customer ZIP failed its CRC check.")
        os.replace(temporary, archive)
        completed = {"operationId": OPERATION, "status": "COMPLETE", "sourceExecutionComplete": True,
                     "providerActionsRequested": 0, "installedRuntime": None,
                     "report": {"path": str(self.report_path), **identity(self.report_path)},
                     "workspace": {"path": str(self.output / "Leap_Interval_Workspace.zip"), **identity(self.output / "Leap_Interval_Workspace.zip")},
                     "reexport": {"path": str(self.output / "Leap_Interval_Reexport.zip"), **identity(self.output / "Leap_Interval_Reexport.zip")},
                     "delivery": {"path": str(archive), **identity(archive)},
                     "declaredFiles": len(files) + 1}
        atomic_json(self.completion, completed)
        self.state.update(status="COMPLETE", completion=completed)
        self.save()
        self.event("SOURCE_APPLICATION_COMPLETE", **{k: v for k, v in completed.items() if k != "operationId"})
        return completed

    def run(self):
        if self.completion.exists():
            completed = read_json(self.completion)
            need(completed.get("operationId") == OPERATION, "The retained completion belongs to a different operation.")
            for name in ("report", "workspace", "reexport", "delivery"):
                verify(completed[name]["path"], completed[name])
            return completed
        if self.finalization.exists():
            return self.finish()
        self.preflight()
        initial = self.cli(self.workspace, ["status" if self.state.get("workspaceId") else "init"], "original-source-workspace")
        need(self.state.get("workspaceId", initial["workspace_id"]) == initial["workspace_id"], "The original source workspace changed.")
        self.state["workspaceId"] = initial["workspace_id"]
        self.reconcile_owner_history(self.workspace, initial["workspace_id"], "original-source-workspace")
        self.save()
        if self.state["phases"].get("live", {}).get("status") != "COMPLETE":
            with self.owner(self.workspace, "source-application") as (connection, launch):
                self.operate_http(connection)
                live, records = self.inspect_complete(connection, "live")
                browser = self.inspect_browser(connection, live, "live-browser")
            self.state["phases"]["live"] = {"status": "COMPLETE", "result": live, "browser": browser, "at": stamp()}
            self.save()
        else:
            live = self.state["phases"]["live"]["result"]
        portable = self.export_cli(self.state["deliveryBatchId"])
        self.restore_cli(portable["file"]["path"])
        restored_status = self.cli(self.cold, ["status"], "cold-status-before-owner")
        need(restored_status["workspace_id"] == self.state["workspaceId"], "The cold receiver has a different logical workspace.")
        self.reconcile_owner_history(self.cold, restored_status["workspace_id"], "cold-status-before-owner")
        if self.state["phases"].get("cold", {}).get("status") != "COMPLETE":
            with self.owner(self.cold, "cold-source-receiver") as (connection, launch):
                need(launch["workspace_id"] == self.state["workspaceId"], "Cold restore changed the logical workspace identity.")
                cold, records = self.inspect_complete(connection, "cold")
                comparisons = {}
                for name in DATA_COLLECTIONS:
                    before = read_json(live["collections"][name]["path"])
                    need(before == records[name], "Cold restore changed original retained " + name + ".")
                    comparisons[name] = {"exact": True, "count": len(before)}
                for identifier, original_batch in live["batches"].items():
                    received = cold["batches"][identifier]
                    need(original_batch["batch"] == received["batch"], "Cold restore changed an original batch.")
                    for kind in ("rows", "issues"):
                        need(original_batch[kind]["sha256"] == received[kind]["sha256"]
                             and original_batch[kind]["bytes"] == received[kind]["bytes"],
                             "Cold receiving changed original " + kind + ".")
                browser = self.inspect_browser(connection, cold, "cold-browser")
            self.state["phases"]["cold"] = {"status": "COMPLETE", "result": cold, "comparisons": comparisons,
                                           "browser": browser, "at": stamp()}
            self.save()
        self.cold_reexport()
        self.preflight()
        need(all(row.get("closed") is True or row.get("closureReconciled", {}).get("originalLeaseReacquired") is True
                 for row in self.state["owners"]), "An original listener has no observed or native-reconciled closure.")
        return self.finish()


def main():
    need(len(sys.argv) == 2, "Use run-source-receiving.py /private/leap-source-receiving.json")
    receiver = SourceReceiving(read_json(sys.argv[1]))
    try:
        result = receiver.run()
        print(json.dumps(result), flush=True)
        return 0
    except BaseException as error:
        receiver.state["status"] = "INCOMPLETE"
        receiver.state["error"] = {"type": type(error).__name__, "message": str(error), "at": stamp()}
        receiver.save()
        print(json.dumps({"operationId": OPERATION, "status": "INCOMPLETE", "journal": str(receiver.journal_path),
                          "error": receiver.state["error"]}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
