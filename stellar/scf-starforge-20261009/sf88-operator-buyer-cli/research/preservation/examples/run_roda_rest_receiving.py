#!/usr/bin/env python3
"""One local HTTP receiving journey for the source-bound RODA ingest client.

Input is the real producer-prepared 169-record public package configured for
http://127.0.0.1:18080. This endpoint implements the reviewed RODA v2 contract
for transport/recovery acceptance; it is not a deployed RODA ingest engine.
"""
import argparse
import base64
import copy
import email.policy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.parse
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def sha(body):
    return hashlib.sha256(body).hexdigest()

def encode(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--client", required=True)
    p.add_argument("--workspace", required=True)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    source = Path(a.client).resolve(strict=True)
    workspace = Path(a.workspace).resolve(strict=True)
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location("roda_client_receiving", source)
    client = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(client)
    import roda as producer
    original = client.read_handoff(workspace)
    handoff = original["handoff"]
    assert handoff["repository"]["baseUrl"].rstrip("/") == "http://127.0.0.1:18080"
    assert not (workspace / "remote" / "plan.json").exists(), "Use the one prepared, unattempted protocol workspace"
    transfer = (workspace / "transfer.zip").read_bytes()
    assert sha(transfer) == handoff["transfer"]["sha256"]
    parent_aip = handoff.get("collection", {}).get("parentAipId")
    config = {"schema": client.SCHEMA, "baseUrl": "http://127.0.0.1:18080",
              "repositoryUsername": "source-contract-operator",
              "auth": {"type": "basic", "passwordEnv": "RODA_CONTRACT_PASSWORD"},
              "allowHttp": True, "timeoutSeconds": 10, "reportPageSize": 1, "maxPages": 100}
    parameters = {"parameter.sip_to_aip_class": client.BAGIT_PLUGIN,
                  "parameter.do_auto_accept": "true"}
    if parent_aip:
        parameters.update({"parameter.parent_id": parent_aip, "parameter.force_parent_id": "true"})
    template = {"name": "Original 169-record RODA source receiving",
                "plugin": "org.roda.core.plugins.base.ingest.v2.ConfigurableIngestPlugin",
                "pluginParameters": parameters, "priority": "MEDIUM", "parallelism": "NORMAL"}
    config_path, template_path = out / "operator-config.json", out / "job-template.json"
    config_path.write_bytes(encode(config))
    template_path.write_bytes(encode(template))
    old_secret = os.environ.get("RODA_CONTRACT_PASSWORD")
    os.environ["RODA_CONTRACT_PASSWORD"] = "source-contract-only"
    expected_auth = "Basic " + base64.b64encode(b"source-contract-operator:source-contract-only").decode()
    state = {"requests": [], "uploadPosts": 0, "jobPosts": 0, "upload": None, "job": None,
             "aip": None, "report": None, "missingAip": False, "movedUpload": None, "stagedDeleted": False, "errors": []}
    ids = {"transfer": "b12b231b-e4c5-4d41-bbe6-706a7ec90a01",
           "job": "b12b231b-e4c5-4d41-bbe6-706a7ec90a02",
           "report": "b12b231b-e4c5-4d41-bbe6-706a7ec90a03",
           "aip": "b12b231b-e4c5-4d41-bbe6-706a7ec90a04",
           "movedTransfer": "b12b231b-e4c5-4d41-bbe6-706a7ec90a05"}

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def log_message(self, *_):
            pass
        def reply(self, value, status=200, binary=False):
            body = value if binary else encode(value)
            self.send_response(status)
            self.send_header("Content-Type", "application/octet-stream" if binary else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
        def fault_after_commit(self):
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
        def dispatch(self):
            assert self.headers.get("Authorization") == expected_auth
            target = urllib.parse.urlsplit(self.path)
            path, query = target.path, urllib.parse.parse_qs(target.query)
            length = int(self.headers.get("Content-Length", "0"))
            assert length <= len(transfer) + 1024 * 1024
            body = self.rfile.read(length)
            state["requests"].append({"method": self.command, "path": self.path,
                                      "bytes": len(body), "sha256": sha(body)})
            if self.command == "GET" and path == "/api/v2/members/users/authenticated":
                return self.reply({"id": "operator-id", "uuid": "operator-uuid",
                                   "name": config["repositoryUsername"], "active": True, "guest": False,
                                   "resetPasswordToken": "TOKEN_MUST_NOT_ENTER_JOURNAL"})
            if self.command == "POST" and path == "/api/v2/transfers/create/resource":
                state["uploadPosts"] += 1
                assert state["uploadPosts"] == 1
                assert query == {"commit": ["true"]}
                message = BytesParser(policy=email.policy.default).parsebytes(
                    b"Content-Type: " + self.headers["Content-Type"].encode() +
                    b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
                parts = list(message.iter_parts())
                assert len(parts) == 1 and parts[0].get_param("name", header="content-disposition") == "resource"
                sent = parts[0].get_payload(decode=True)
                assert sent == transfer
                filename = parts[0].get_filename()
                state["upload"] = {"uuid": ids["transfer"], "id": filename, "relativePath": filename,
                                   "name": filename, "parentUUID": None, "parentId": None,
                                   "size": len(sent), "file": True}
                return self.fault_after_commit()
            if self.command == "POST" and path in {"/api/v2/transfers/find", "/api/v2/jobs/find"}:
                request = json.loads(body)
                filters = request["filter"]["parameters"]
                assert all(f.get("@type") == "SimpleFilterParameter" for f in filters)
                obj = state["upload"] if "/transfers/" in path else state["job"]
                rows = [obj] if obj and all(str(obj.get(f["name"])) == f["value"] for f in filters) else []
                first = request["sublist"]["firstElementIndex"]
                maximum = request["sublist"]["maximumElementCount"]
                return self.reply({"offset": first, "limit": maximum, "totalCount": len(rows),
                                   "results": rows[first:first + maximum]})
            if self.command == "GET" and path.startswith("/api/v2/transfers/"):
                suffix = path[len("/api/v2/transfers/"):]
                uuid = suffix.removesuffix("/download")
                resource = (state["movedUpload"] if uuid == ids["movedTransfer"] else
                            state["upload"] if uuid == ids["transfer"] else None)
                if state["stagedDeleted"] or resource is None or (uuid == ids["transfer"] and state["movedUpload"]):
                    return self.reply({"error": "NOT_FOUND", "message": "Original staging object moved or removed"}, 404)
                if suffix.endswith("/download"):
                    return self.reply(transfer, binary=True)
                return self.reply(resource)
            if self.command == "POST" and path == "/api/v2/jobs":
                state["jobPosts"] += 1
                assert state["jobPosts"] == 1
                request = json.loads(body)
                assert request["sourceObjects"] == {"@type": "SelectedItemsListRequest", "ids": [ids["transfer"]]}
                assert request["sourceObjectsClass"] == client.TRANSFER_CLASS
                # DefaultIngestPlugin writes these three values into the original
                # Job map during service validation, before its persisted clone.
                effective = {**request["pluginParameters"], "parameter.total_steps": "8",
                             "parameter.create_submission": "false",
                             "parameter.reporting_class": request["plugin"]}
                state["job"] = {**request, "pluginParameters": effective,
                                "id": ids["job"], "username": config["repositoryUsername"],
                                "sourceObjects": {"type": "list", "selectedClass": client.TRANSFER_CLASS,
                                                  "ids": [ids["transfer"]]},
                                "state": "STARTED", "jobStats": {
                                    "sourceObjectsCount": 1, "sourceObjectsBeingProcessed": 1,
                                    "sourceObjectsWaitingToBeProcessed": 0,
                                    "sourceObjectsProcessedWithSuccess": 0,
                                    "sourceObjectsProcessedWithPartialSuccess": 0,
                                    "sourceObjectsProcessedWithFailure": 0,
                                    "sourceObjectsProcessedWithSkipped": 0,
                                    "outcomeObjectsWithManualIntervention": 0}}
                return self.fault_after_commit()
            if self.command == "GET" and path == "/api/v2/jobs/" + ids["job"]:
                return self.reply(state["job"])
            if self.command == "GET" and path == "/api/v2/jobs/" + ids["job"] + "/reports":
                assert query["job-just-failed"] == ["false"]
                start, limit = int(query["start"][0]), int(query["limit"][0])
                rows = [{"id": ids["report"], "jobId": ids["job"]}] if state["report"] else []
                return self.reply({"reports": rows[start:start + limit]})
            if self.command == "GET" and path == "/api/v2/jobs/" + ids["job"] + "/report/" + ids["report"]:
                return self.reply(state["report"])
            if self.command == "GET" and path == "/api/v2/aips/" + ids["aip"]:
                if state["missingAip"]:
                    return self.reply({"error": "NOT_FOUND", "message": "Original AIP index not yet visible"}, 404)
                return self.reply(state["aip"])
            raise AssertionError("Unexpected original RODA endpoint: " + self.command + " " + path)
        def do_GET(self):
            self.handle_request()
        def do_POST(self):
            self.handle_request()
        def handle_request(self):
            try:
                self.dispatch()
            except Exception as exc:
                state["errors"].append({"type": type(exc).__name__, "message": str(exc)})
                try:
                    self.reply({"error": "CONTRACT_ASSERTION_FAILED"}, 500)
                except OSError:
                    pass

    server = ThreadingHTTPServer(("127.0.0.1", 18080), Handler)
    thread = threading.Thread(target=server.serve_forever, name="roda-source-contract", daemon=True)
    thread.start()
    started = time.time()
    stages = []
    try:
        planned = client.plan(workspace, config_path, template_path)
        assert planned["status"] == "PREPARED"
        for boundary in ("upload-response-loss", "job-create-response-loss"):
            try:
                client.run(workspace, config_path)
                raise AssertionError("Expected the declared lost-response boundary")
            except client.RodaError as exc:
                assert exc.code == "HTTP_TRANSPORT_FAILED" and exc.details["mutationDispatched"]
                stages.append({"stage": boundary, "error": exc.result(), "status": client.status(workspace)})
        running = client.run(workspace, config_path)
        assert running["status"] == "INGEST_RUNNING"
        assert running["transferUuid"] == ids["transfer"] and running["jobId"] == ids["job"]
        running_body = json.loads((workspace / running["observation"]).read_bytes())
        assert running_body["jobParameters"]["derivedParameters"] == {
            "parameter.total_steps": "8", "parameter.create_submission": "false",
            "parameter.reporting_class": template["plugin"]}
        stages.append({"stage": "same-original-job-reopened-with-server-derived-parameters", "status": running,
                       "jobParameters": running_body["jobParameters"]})
        state["job"]["state"] = "PENDING_APPROVAL"
        approval = client.reconcile(workspace, config_path)
        assert approval["status"] == "JOB_PENDING_APPROVAL"
        stages.append({"stage": "original-job-approval-state", "status": approval})
        state["job"]["state"] = "COMPLETED"
        state["job"]["jobStats"].update({"sourceObjectsBeingProcessed": 0,
                                        "sourceObjectsProcessedWithSuccess": 1})
        state["aip"] = {"id": ids["aip"], "parentId": parent_aip, "state": "UNDER_APPRAISAL"}
        state["report"] = {"id": ids["report"], "jobId": ids["job"],
                           "sourceObjectId": ids["transfer"], "sourceObjectClass": client.TRANSFER_CLASS,
                           "outcomeObjectId": ids["aip"], "outcomeObjectClass": client.AIP_CLASS,
                           "plugin": template["plugin"], "pluginState": "SUCCESS",
                           "pluginIsMandatory": True, "htmlPluginDetails": False, "pluginDetails": "Original object report",
                           "reports": [{"id": "bagit-step", "jobId": ids["job"],
                             "sourceObjectId": ids["transfer"], "sourceObjectClass": client.TRANSFER_CLASS,
                             "outcomeObjectId": ids["aip"], "outcomeObjectClass": client.AIP_CLASS,
                             "plugin": client.BAGIT_PLUGIN, "pluginState": "SUCCESS",
                             "pluginIsMandatory": True, "pluginDetails": "BagIt conversion complete"}]}
        appraisal = client.reconcile(workspace, config_path)
        assert appraisal["status"] == "AIP_UNDER_APPRAISAL"
        stages.append({"stage": "object-appraisal", "status": appraisal})
        state["missingAip"] = True
        waiting = client.reconcile(workspace, config_path)
        assert waiting["status"] == "INGEST_RESULT_INCOMPLETE" and waiting["resultAipIds"] == [ids["aip"]]
        waiting_body = json.loads((workspace / waiting["observation"]).read_bytes())
        assert waiting_body["unresolvedAips"][0]["id"] == ids["aip"]
        stages.append({"stage": "linked-aip-not-yet-readable", "status": waiting})
        state["missingAip"] = False
        state["aip"]["state"] = "ACTIVE"
        state["report"]["reports"][0]["pluginState"] = "FAILURE"
        state["report"]["reports"][0]["pluginDetails"] = "Failure after original AIP creation"
        review = client.reconcile(workspace, config_path)
        assert review["status"] == "INGEST_REVIEW_REQUIRED" and review["resultAipIds"] == [ids["aip"]]
        stages.append({"stage": "failed-step-retains-created-aip", "status": review})
        state["report"]["reports"][0]["pluginState"] = "SUCCESS"
        state["report"]["reports"][0]["pluginDetails"] = "Original object recovery complete"
        active = client.reconcile(workspace, config_path)
        assert active["status"] == "INGESTED_ACTIVE" and active["reportPaginationComplete"] is True
        # The native autoaccept path moves the SIP and rewrites the top report
        # and first child. Another nested report can retain the original UUID.
        original_nested = copy.deepcopy(state["report"]["reports"][0])
        original_nested["id"] = "retained-original-source-step"
        state["report"]["reports"].append(original_nested)
        state["movedUpload"] = {**state["upload"], "uuid": ids["movedTransfer"],
                                "id": "PROCESSED/SUCCESSFULLY_INGESTED/" + state["upload"]["name"],
                                "relativePath": "PROCESSED/SUCCESSFULLY_INGESTED/" + state["upload"]["name"],
                                "parentUUID": "processed-success-parent", "parentId": "PROCESSED/SUCCESSFULLY_INGESTED"}
        state["job"]["sourceObjects"]["ids"] = [ids["movedTransfer"]]
        state["report"]["sourceObjectId"] = ids["movedTransfer"]
        state["report"]["reports"][0]["sourceObjectId"] = ids["movedTransfer"]
        moved = client.reconcile(workspace, config_path)
        assert moved["status"] == "INGESTED_ACTIVE" and moved["currentTransferUuid"] == ids["movedTransfer"]
        moved_body = json.loads((workspace / moved["observation"]).read_bytes())
        assert set(moved_body["verifiedSourceUuids"]) == {ids["transfer"], ids["movedTransfer"]}
        assert moved_body["sourceBinding"]["originalUuid"] == ids["transfer"]
        assert moved_body["sourceBinding"]["resource"]["relativePath"] == state["movedUpload"]["relativePath"]
        assert moved_body["sourceBinding"]["download"]["bodySha256"] == handoff["transfer"]["sha256"]
        assert {row["sourceObjectId"] for row in moved_body["reportRows"]} == {ids["transfer"], ids["movedTransfer"]}
        stages.append({"stage": "native-job-source-move-and-mixed-report-identities", "status": moved,
                       "sourceBindingSha256": moved_body["sourceBinding"]["bindingSha256"]})
        # Preserving derived values does not permit a requested value to change.
        state["job"]["pluginParameters"]["parameter.sip_to_aip_class"] = "changed-parser"
        try:
            client.reconcile(workspace, config_path)
            raise AssertionError("Changed requested parser must be rejected")
        except client.RodaError as exc:
            assert exc.code == "JOB_PARAMETER_MISMATCH"
            stages.append({"stage": "requested-parameter-change-rejected", "error": exc.result()})
        state["job"]["pluginParameters"]["parameter.sip_to_aip_class"] = client.BAGIT_PLUGIN
        active = client.reconcile(workspace, config_path)
        assert active["status"] == "INGESTED_ACTIVE"
        # A later original staging-retention policy may remove the processed
        # file; the saved full-byte movement binding remains usable on reopen.
        state["stagedDeleted"] = True
        snapshot_path = out / "completed-repository-snapshot.zip"
        snapshot = producer.export(workspace, snapshot_path)
        receiving_root = out / "received-package"
        receiving = producer.receive(snapshot_path, receiving_root)
        reopened = Path(receiving["workspace"])
        repeated_receiving = producer.receive(snapshot_path, receiving_root)
        assert repeated_receiving["reused"] is True
        assert repeated_receiving["handoff"]["id"] == handoff["id"]
        received = client.run(reopened, config_path)
        assert received["status"] == "INGESTED_ACTIVE"
        assert received["operationId"] == planned["operationId"]
        assert received["currentTransferUuid"] == ids["movedTransfer"]
        assert state["uploadPosts"] == 1 and state["jobPosts"] == 1
        stages.append({"stage": "full-snapshot-receive-without-new-upload-or-job", "status": received,
                       "snapshot": snapshot, "receivedWorkspace": str(reopened),
                       "sameSnapshotReused": repeated_receiving["reused"]})
        native_json = list((workspace / "remote").rglob("*.json"))
        assert all(b"TOKEN_MUST_NOT_ENTER_JOURNAL" not in p.read_bytes() for p in native_json)
        assert all(b"TOKEN_MUST_NOT_ENTER_JOURNAL" not in p.read_bytes()
                   for p in (workspace / "remote").rglob("response.body"))
        before_requests = len(state["requests"])
        with (reopened / "transfer.zip").open("ab") as stream:
            stream.write(b"\x00")
        rejected = None
        try:
            client.status(reopened)
        except client.RodaError as exc:
            rejected = {"kind": type(exc).__name__, "code": exc.code}
        assert rejected is not None and rejected["code"] == "PREPARED_WORKSPACE_INVALID"
        assert len(state["requests"]) == before_requests
        stages.append({"stage": "changed-transfer-rejected-before-network", "error": rejected})
        assert not state["errors"], state["errors"]
        result = {"schema": "stellar-forge.roda-rest-contract-receiving.v1",
                  "runtime": {"python": sys.version, "executable": sys.executable,
                              "server": "Python ThreadingHTTPServer", "baseUrl": config["baseUrl"]},
                  "source": {"rodaCommit": client.SOURCE_COMMIT, "client": str(source),
                             "clientSha256": sha(source.read_bytes()),
                             "producerSha256": sha((source.parent / "roda.py").read_bytes())},
                  "originalHandoffSha256": original["handoffSha256"],
                  "originalTransfer": handoff["transfer"], "operationId": planned["operationId"],
                  "scope": "original prepared package over source-contract HTTP; no deployed RODA ingest engine",
                  "seconds": time.time() - started, "stages": stages, "ids": ids,
                  "uploadPosts": state["uploadPosts"], "jobPosts": state["jobPosts"],
                  "requestCount": len(state["requests"]), "requests": state["requests"],
                  "serverErrors": state["errors"], "credentialProjectionVerified": True}
        (out / "receiving-result.json").write_bytes(encode(result))
        print(json.dumps({"result": str(out / "receiving-result.json"),
                          "sha256": sha(encode(result)), "operationId": planned["operationId"],
                          "uploadPosts": 1, "jobPosts": 1, "stages": len(stages), "seconds": result["seconds"]}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        if old_secret is None:
            os.environ.pop("RODA_CONTRACT_PASSWORD", None)
        else:
            os.environ["RODA_CONTRACT_PASSWORD"] = old_secret

if __name__ == "__main__":
    main()
