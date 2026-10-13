#!/usr/bin/env python3
"""Operate a complete original Directory procedure and receive its full editable history.

The input is an already completed Directory result and its exact editable packet.
Use a separate private receiving workspace. This operation reads the retained
publisher examples, records an authored local procedure, edits and receives the
original OperatingPlan history, exports all formats and reopens a full workspace.
It does not reacquire directory data, execute a plan step or contact a recipient.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import threading
import urllib.request
import zipfile

from directory_runtime import source, original_workspace, atomic_json, now
from directory_workspace import Workspace
from directory_server import OperatorServer
from directory_operating_plans import PLAN_KIND, retained_operating_files
import directory_schema as schema

OPERATION = "SCF-DIRECTORY-OPERATING-PLANS-450E-20261012"
ACTOR = "450E original Directory procedure receiving"
BASIS_SCHEMA = "stellar-forge.human-services-directory-operated.v1"
RESULT_SCHEMA = "stellar-forge.directory-operating-plans-operated.v1"
MAX_FILE = 2147483648
HERE = Path(__file__).resolve().parent

def require(value, message):
    if not value:
        raise RuntimeError(message)

def private_dir(path):
    path = Path(path).expanduser().absolute()
    missing, current = [], path
    while not current.exists():
        require(not current.is_symlink(), "A private output parent cannot be a symlink")
        missing.append(current); current = current.parent
    for item in reversed(missing):
        item.mkdir(mode=0o700)
    st = path.lstat()
    require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o077,
        "Use a private original directory: " + str(path))
    return path

def info(path):
    path = Path(path).absolute()
    size = original_workspace.regular(path, MAX_FILE).st_size
    return {"file": str(path), "bytes": size, "sha256": original_workspace.file_digest(path, MAX_FILE)}

def read_json(path, maximum=64 * 1024 * 1024):
    original_workspace.regular(Path(path), maximum)
    return source.json_value(Path(path).read_bytes())

def write_once(path, value):
    path = Path(path); raw = source.jbytes(value)
    if path.exists():
        require(original_workspace.regular(path, len(raw)).st_size == len(raw) and path.read_bytes() == raw,
            "Preserve the complete original output: " + str(path))
    else:
        original_workspace.private_write(path, raw)
    return info(path)

def emit(stage, **value):
    print(source.lexical_json({"stage": stage, "operation": OPERATION, **value}), flush=True)

def matches_file(actual, expected):
    return all(actual[k] == expected[k] for k in ("bytes", "sha256"))

def source_identity():
    paths = [
        HERE / "directory-operating-plans-schema.json",
        HERE / "directory_operating_plan.mjs",
        HERE / "directory_operating_plan_bridge.mjs",
        HERE / "directory_operating_plans.py",
        HERE / "directory_schema.py",
        HERE / "directory_workspace.py",
        HERE / "directory_receiving.py",
        HERE / "directory_server.py",
        HERE / "cli.py",
        Path(__file__).resolve(),
        HERE.parent.parent / "distribution" / "discovery" / "operating-plan.mjs",
        HERE.parent.parent / "distribution" / "discovery" / "catalog.mjs",
        HERE.parent.parent / "distribution" / "discovery" / "load.mjs",
    ]
    rows = []
    for path in paths:
        raw = path.read_bytes()
        rows.append({"path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "gitBlobSha": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
    return rows

class Operation:
    def __init__(self, args):
        self.args = args
        self.root = private_dir(args.out)
        self.workspace = Path(args.workspace).expanduser().absolute()
        self.receiving_path = Path(args.receiving).expanduser().absolute()
        native_info = info(self.receiving_path)
        require(native_info["sha256"] == args.receiving_sha256, "Receive the unchanged completed Directory result")
        self.native = read_json(self.receiving_path)
        require(self.native.get("schema") == BASIS_SCHEMA and self.native.get("workspaceId"),
            "Select the completed original Directory receiving JSON")
        self.archive = Path(args.archive).expanduser().absolute() if args.archive else None
        if self.archive:
            require(matches_file(info(self.archive), self.native["workspacePacket"]),
                "Select the exact completed native editable workspace packet")
        self.path = self.root / "OPERATING_PLANS_JOURNEY.json"
        inputs = {"operation": OPERATION, "workspace": str(self.workspace),
            "workspaceId": self.native["workspaceId"], "receiving": native_info,
            "archive": info(self.archive) if self.archive else None,
            "sourceRoot": str(HERE), "source": source_identity()}
        if self.path.exists():
            self.journal = read_json(self.path)
            require(self.journal["inputs"] == inputs,
                "Continue this original procedure with the same complete inputs and source")
        else:
            self.journal = {"schema": "stellar-forge.directory-operating-plans-journey.v1",
                "inputs": inputs, "createdAt": now(), "steps": {}, "times": {}, "files": {}, "failures": []}
            self.save()
        self.copy_file("original-native-result", self.receiving_path, native_info, "Original_Directory_Receiving.json")
        write_once(self.root / "OPERATING_PLANS_SOURCE.json", inputs["source"])

    def save(self):
        self.journal["updatedAt"] = now()
        atomic_json(self.path, self.journal)

    def at(self, key):
        if key not in self.journal["times"]:
            self.journal["times"][key] = now(); self.save()
        return self.journal["times"][key]

    def step(self, key, request, call):
        request_sha = source.sha(source.jbytes(request))
        previous = self.journal["steps"].get(key)
        if previous:
            require(previous["requestSha256"] == request_sha,
                "Keep the exact original prepared procedure request: " + key)
            if previous["state"] == "complete":
                return previous["result"]
        else:
            self.journal["steps"][key] = {"state": "prepared", "request": request,
                "requestSha256": request_sha, "preparedAt": self.at(key)}
            self.save()
        value = call()
        self.journal["steps"][key].update(state="complete", result=value, completedAt=now())
        self.save()
        emit("OPERATING_PLANS_NATIVE_STEP", key=key,
            recordId=value.get("record", {}).get("id") if isinstance(value, dict) else None)
        return value

    def copy_file(self, key, path, expected, name):
        target = self.root / name
        private_dir(target.parent)
        if target.exists():
            actual = info(target)
            require(matches_file(actual, expected), "Keep the complete original file: " + name)
        else:
            fd, pending_name = tempfile.mkstemp(prefix=".operating-plan-", dir=target.parent)
            pending = Path(pending_name)
            try:
                with Path(path).open("rb") as inp, os.fdopen(fd, "wb") as out:
                    os.fchmod(out.fileno(), 0o600)
                    while block := inp.read(65536):
                        out.write(block)
                    out.flush(); os.fsync(out.fileno())
                require(matches_file(info(pending), expected), "The complete original procedure file changed")
                try:
                    os.link(pending, target)
                except FileExistsError:
                    require(matches_file(info(target), expected), "Another original file occupies this destination")
            finally:
                pending.unlink(missing_ok=True)
            actual = info(target)
        old = self.journal["files"].get(key)
        require(old is None or old == actual, "Keep the original completed file identity")
        self.journal["files"][key] = actual; self.save()
        return actual

    def native_records(self, ws):
        rows = {}
        for kind, ids in self.native["recordIds"].items():
            if kind == "receives":
                continue
            for ident in ids:
                record = ws.directory_record(kind, ident)
                rows[kind + "/" + ident] = source.sha(source.jbytes(record))
        return rows

    def receive_original(self, ws):
        if self.archive:
            received = self.step("01-original-workspace-receive",
                {"sha256": self.native["workspacePacket"]["sha256"], "workspaceId": self.native["workspaceId"]},
                lambda: self._receive(ws, self.archive))
            require(received["workspaceId"] == self.native["workspaceId"], "Original native receiving changed its UUID")
        require(ws.workspace_id == self.native["workspaceId"], "Open the same original completed Directory workspace")
        original = self.native_records(ws)
        old = self.journal.get("originalRecords")
        require(old is None or old == original, "An original Directory record changed during this procedure")
        self.journal["originalRecords"] = original; self.save()
        return original

    def _receive(self, ws, path):
        expected = info(path)
        row = ws.directory_record("receives", expected["sha256"], required=False)
        if row is not None:
            require(row.get("archiveSha256") == expected["sha256"] and row.get("kind") == "workspace"
                and row.get("workspaceId") == self.native["workspaceId"],
                "Continue the original selected editable receiving operation")
        result = ws.import_workspace(path)
        row = ws.directory_record("receives", expected["sha256"])
        require(row.get("state") == "complete" and row.get("workspaceId") == self.native["workspaceId"]
            and ws.workspace_id == self.native["workspaceId"], "Complete original workspace receiving was not observed")
        return {"workspaceId": ws.workspace_id, "archiveSha256": expected["sha256"],
            "receiveRecordId": row["id"], "state": row["state"]}

    def create_input(self):
        first = lambda key: self.native.get(key, [None])[0] if self.native.get(key) else None
        basis = {"editionId": self.native["selectedDirectoryEditionId"],
            "mappingId": first("mappingIds"), "previewId": first("mappingPreviewIds"),
            "conversionId": first("conversionIds"), "selectionId": first("selectionIds"),
            "referralJoinId": first("referralJoinIds"), "handoffId": first("handoffIds"),
            "contextSourceIds": self.native.get("sourceIds", []),
            "comparisonIds": self.native.get("comparisonIds", []),
            "receivingReviewIds": self.native["recordIds"].get("receivingReviews", [])}
        # The producer retains the original key joinIds in older completed records.
        if not basis["referralJoinId"]:
            basis["referralJoinId"] = self.native["recordIds"].get("referralJoins", [None])[0]
        basis = {key: value for key, value in basis.items() if value is not None}
        return {"id": "directory-source-service-receiving-450e-20261012",
            "title": "Directory source, service and complete receiving procedure",
            "customer": "Commons Directory implementation receiving",
            "purpose": "Keep the exact publisher examples, reviewed field meanings, service choice and original clinical assignment ready for the receiving team.",
            "period": "Original completed Directory example and its next reviewed local handover",
            "owner": ACTOR,
            "receiving": "The original Directory product receiving owner. Record actual external handover separately if it is later requested.",
            "notes": "This authored procedure observes the retained local example. The five original mapping warnings, historical schedules and stated capacity remain subject to explicit review. No current service reservation or customer acceptance is inferred.",
            "savedAt": self.at("02-preview"), "basis": basis,
            "outputDirectory": str(self.root / "selected-exports"),
            "recorded": True, "continuations": [{
                "id": "review-next-edition-work-order", "title": "Agree the next source edition and receiving work order",
                "instruction": "Choose the next complete original source, owner and review period. Reuse an existing recurring cycle only when its exact completed or pending state is supplied. Keep provider acquisition as a separate explicit operation.",
                "inputs": "Original native Directory result, complete editable archive and retained source comparison.",
                "expectedResult": "An actual selected source/cycle and responsible owner are recorded before new acquisition.",
                "owner": ACTOR
            }], "actor": ACTOR, "note": "Original local receiving; procedure steps do not execute commands."}

    def export_plan(self, ws, record, format_name, key):
        request = {"recordId": record["id"], "format": format_name, "actor": ACTOR,
            "label": "Complete original procedure " + record["planId"],
            "note": "Retain the full saved history and actual original registration snapshots."}
        exported = self.step(key, request, lambda: ws.export_directory_operating_plan(request))
        path = ws._directory_file_path(exported["file"])
        filename = exported["name"]
        return exported, self.copy_file(key, path, exported["file"], "plans/" + filename)

    def native_http(self, ws, record, exported):
        with OperatorServer(ws, 0, expected_workspace_id=ws.workspace_id) as server:
            worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
            worker.start()
            try:
                base = server.url.split("#", 1)[0].rstrip("/")
                routes = [(f"/api/directory/operatingPlans/{record['id']}/{kind}", kind)
                    for kind in ("document", "draft", "input", "basis")]
                routes += [("/api/directory/operating-plans/catalog", "catalog"),
                    ("/api/directory/exports/" + exported["id"] + "/file", "file")]
                results = []
                for route, kind in routes:
                    request = urllib.request.Request(base + route,
                        headers={"Authorization": "Bearer " + server.token})
                    sha, count, parts = hashlib.sha256(), 0, []
                    with urllib.request.urlopen(request, timeout=180) as response:
                        require(response.status == 200, "Original authenticated procedure route failed")
                        while block := response.read(65536):
                            sha.update(block); count += len(block)
                            if kind != "file": parts.append(block)
                    if kind == "file":
                        require(count == exported["file"]["bytes"] and sha.hexdigest() == exported["file"]["sha256"],
                            "Complete original procedure HTTP file changed")
                    else:
                        value = source.json_value(b"".join(parts))
                        if kind == "document": require(value["id"] == record["planId"], "HTTP document identity differs")
                        if kind == "draft": require(value["baseRevision"] == record["revision"], "HTTP draft revision differs")
                        if kind == "basis": require(value["workspaceId"] == ws.workspace_id, "HTTP original basis differs")
                        write_once(self.root / ("HTTP_Operating_" + kind + ".json"), value)
                    results.append({"route": route, "status": 200, "bytes": count, "sha256": sha.hexdigest()})
                return {"workspaceId": ws.workspace_id, "routes": results}
            finally:
                server.shutdown(); worker.join(10)

    def operate(self):
        if not self.workspace.exists():
            require(self.archive is not None, "Receive the exact original editable packet before creating this separate workspace")
            private_dir(self.workspace.parent)
        with Workspace(self.workspace, create=not self.workspace.exists()) as ws:
            original = self.receive_original(ws)
            input_value = self.create_input()
            write_once(self.root / "OPERATING_PLAN_INPUT.json", input_value)
            preview = self.step("02-preview", input_value, lambda: ws.preview_directory_operating_plan(input_value))
            require(preview["record"]["stage"] == "prepared", "The original procedure preview was not retained")
            accepted_input = {**input_value, "previewRecordId": preview["record"]["id"]}
            accepted = self.step("03-accept-exact-preview", accepted_input,
                lambda: ws.create_directory_operating_plan(accepted_input))
            saved = accepted["record"]
            require(ws.directory_operating_plan_document(saved["id"]) == preview["document"],
                "Accepting the preview changed the complete reviewed document")
            accepted_file = ws.directory_operating_plan_input(saved["id"])
            require(accepted_file == {**accepted_input, "continuations": input_value["continuations"]},
                "The saved procedure lost its complete normalized accepted request")
            draft = ws.directory_operating_plan_draft(saved["id"], 1)
            require(draft["baseRevision"] == saved["revision"], "Historical draft must continue from the current saved head")
            step_input = {"id": "receive-procedure-files-locally", "title": "Receive all original procedure files",
                "instruction": "Export complete JSON, Markdown and HTML, verify original hashes, and reopen the full editable Directory workspace.",
                "inputs": "The exact prepared and saved procedure, original Directory result and source-bound editable packet.",
                "expectedResult": "The complete original document and every saved revision reopen with the same Directory UUID.",
                "owner": ACTOR, "status": "in-progress",
                "recordedResult": "This local receiving operation has started; its final file and restoration receipts follow."}
            new_step = self.step("04-prepare-manual-step", step_input, lambda: ws.directory_operating_step(step_input))
            draft["content"]["title"] += " — local operator handover"
            draft["content"]["notes"] += "\n\nThe complete historical draft was reopened through the original model. The local file-receiving step remains in progress until the actual receive receipts are recorded."
            draft["content"]["steps"].insert(0, new_step)
            save_input = {"recordId": saved["id"], "draft": draft, "savedAt": self.at("05-save-edited-history"),
                "actor": ACTOR, "note": "Explicitly authored revision; original publisher records and warnings remain unchanged."}
            edited = self.step("05-save-edited-history", save_input, lambda: ws.save_directory_operating_plan(save_input))["record"]
            require(edited["revision"] == saved["revision"] + 1, "The edited original history did not append one revision")
            before_doc = ws.directory_operating_plan_document(saved["id"])
            prefix_input = {"document": before_doc, "expectedRecordId": edited["id"], "actor": ACTOR,
                "note": "Reopen the exact earlier full prefix against its saved successor."}
            prefix = self.step("06-receive-original-prefix", prefix_input,
                lambda: ws.receive_directory_operating_plan(prefix_input))
            require(prefix["reused"] and prefix["record"]["id"] == edited["id"],
                "Receiving an original historical prefix must retain its actual saved successor")
            copy_input = {"recordId": edited["id"], "id": input_value["id"] + "-customer",
                "title": "Customer receiving copy — original Directory procedure",
                "savedAt": self.at("07-copy-complete-history"), "actor": ACTOR,
                "note": "Keep every original revision and the explicit original plan identity in this receiving copy."}
            copied = self.step("07-copy-complete-history", copy_input,
                lambda: ws.copy_directory_operating_plan(copy_input))["record"]
            copy_document = ws.directory_operating_plan_document(copied["id"])
            require(copy_document["origin"]["id"] == edited["planId"],
                "The customer procedure copy lost its original plan identity")
            external_draft = ws._operating_model("draft", {"document": copy_document})
            external_draft["content"]["receiving"] = "Complete local customer-copy receiving; an external recipient handover remains a separate recorded action."
            external_draft["content"]["notes"] += "\n\nThe complete copy was reopened and reviewed using the unchanged original OperatingPlan model."
            external_document = self.step("08-author-complete-incoming-history",
                {"document": copy_document, "draft": external_draft, "savedAt": self.at("08-author-complete-incoming-history")},
                lambda: ws._operating_model("save", {"document": copy_document, "draft": external_draft,
                    "savedAt": self.at("08-author-complete-incoming-history")}))["document"]
            receive_input = {"document": external_document, "expectedRecordId": copied["id"], "actor": ACTOR,
                "note": "Receive every unchanged shared revision and the explicit authored successor through the original model."}
            received = self.step("09-receive-full-successor", receive_input,
                lambda: ws.receive_directory_operating_plan(receive_input))["record"]
            require(received["revision"] == copied["revision"] + 1,
                "The full incoming original history did not preserve its exact prefix")
            compare_input = {"recordId": received["id"]}
            comparison = self.step("10-compare-actual-registration", compare_input,
                lambda: ws.compare_directory_operating_plan(compare_input))
            require(all(r["state"] == "unchanged" for r in comparison["directoryBinding"]["records"]),
                "An original source record changed while comparing the procedure")
            require(comparison["counts"].get("changed", 0) == 0 and comparison["counts"].get("missing", 0) == 0,
                "The procedure retains a changed or missing command registration")
            plan_exports, file_outputs = [], {}
            for label, record in (("operator", edited), ("customer", received)):
                for format_name in ("json", "markdown", "html"):
                    key = "11-" + label + "-" + format_name
                    exported, copied_file = self.export_plan(ws, record, format_name, key)
                    plan_exports.append(exported); file_outputs[key] = copied_file
                for part in ("document", "draft", "input", "basis"):
                    value = getattr(ws, "directory_operating_plan_" + part)(record["id"])
                    file_outputs[label + "-" + part] = write_once(self.root / "plans" / (label + "-" + part + ".json"), value)
            http = self.step("12-authenticated-complete-reopening",
                {"recordId": received["id"], "exportId": plan_exports[3]["id"]},
                lambda: self.native_http(ws, received, plan_exports[3]))
            all_plans = ws.directory_records(PLAN_KIND)
            for record in all_plans:
                for role, descriptor in record["files"].items():
                    self.copy_file("retained-" + record["id"] + "-" + role,
                        ws._directory_file_path(descriptor), descriptor,
                        "retained/" + record["id"] + "/" + role + ".json")
            write_once(self.root / "OPERATING_PLAN_RECORDS.json", all_plans)
            require(self.native_records(ws) == original, "The original Directory records changed during plan authoring")
            packet_path = self.root / "Directory_Operating_Plans_Complete_Editable_Workspace.zip"
            plan_ids = [record["id"] for record in all_plans]
            def export_workspace():
                if not packet_path.exists():
                    ws.export_workspace(packet_path)
                with zipfile.ZipFile(packet_path) as archive:
                    raw = archive.read("directory-registry.json")
                    manifest = source.json_value(archive.read("manifest.json"))
                    require(source.sha(raw) == manifest["registrySha256"], "Complete exported registry differs")
                    registry = source.json_value(raw)
                require(registry["workspaceId"] == ws.workspace_id and
                    [record["id"] for record in registry["records"][PLAN_KIND]] == plan_ids,
                    "The complete editable packet lacks original procedure histories")
                return info(packet_path)
            packet = self.step("13-export-complete-editable-workspace",
                {"workspaceId": ws.workspace_id, "operatingPlanRecordIds": plan_ids}, export_workspace)
            with zipfile.ZipFile(packet_path) as archive:
                registry_raw = archive.read("directory-registry.json")
                registry = source.json_value(registry_raw)
            record_ids = {kind: [r["id"] for r in rows] for kind, rows in registry["records"].items()}
            write_once(self.root / "EXPORTED_DIRECTORY_REGISTRY.json", registry)
        restored = self.root / "received-workspace"
        with Workspace(restored, create=not restored.exists()) as receiver:
            restoration = self.step("14-receive-complete-editable-workspace",
                {"sha256": packet["sha256"], "workspaceId": self.native["workspaceId"]},
                lambda: self._receive(receiver, packet_path))
            for kind, rows in registry["records"].items():
                require(receiver.directory_records(kind) == rows,
                    "The complete received native collection differs: " + kind)
            verified = receiver._verify_operating_plans_received(registry)
            require(verified["count"] == len(plan_ids), "Receive and inspect every original procedure history")
            require(self.native_records(receiver) == original, "Received original Directory records differ")
        with Workspace(restored, create=False) as reopened:
            for ident in plan_ids:
                require(reopened.directory_record(PLAN_KIND, ident)["id"] == ident,
                    "The complete receiving copy did not reopen its original plan record")
            reopened_document = reopened.directory_operating_plan_document(received["id"])
            require(reopened_document == external_document, "Complete customer history changed after reopening")
        self.journal.setdefault("completedAt", now()); self.save()
        result = {"schema": RESULT_SCHEMA, "operation": OPERATION,
            "completedAt": self.journal["completedAt"], "workspaceId": self.native["workspaceId"],
            "workspace": str(self.workspace), "sourceRoot": str(HERE),
            "originalDirectoryReceiving": self.journal["inputs"]["receiving"],
            "originalDirectoryPacket": self.native["workspacePacket"],
            "originalDirectoryRecordHashes": original,
            "preparedRecordId": preview["record"]["id"], "initialRecordId": saved["id"],
            "planRecordId": edited["id"], "copyRecordId": received["id"],
            "operatingPlanRecordIds": plan_ids, "recordIds": record_ids,
            "planSummary": edited["summary"], "copySummary": received["summary"],
            "comparison": comparison, "http": http,
            "exports": plan_exports, "files": {**self.journal["files"], **file_outputs},
            "workspacePacket": packet,
            "restoration": {**restoration, "workspace": str(restored),
                "registrySha256": source.sha(registry_raw), "allOriginalCollectionsEqual": True,
                "allOriginalPlanHistoriesVerified": True, "reopened": True},
            "connectedInputs": {"preview": input_value, "create": accepted_input,
                "save": save_input, "copy": copy_input, "receivePrefix": prefix_input,
                "receiveSuccessor": receive_input, "step": step_input, "compare": compare_input},
            "journal": str(self.path),
            "meaning": "Authored local procedure over the exact completed Directory example. Native file creation and history receiving are operated; human decisions, future source acquisition and external delivery remain explicit plan steps."}
        result_info = write_once(self.root / "OPERATED_DIRECTORY_OPERATING_PLANS.json", result)
        self.journal["result"] = result_info; self.save()
        emit("DIRECTORY_OPERATING_PLANS_NATIVE_COMPLETE", result=result_info,
            workspaceId=self.native["workspaceId"], workspacePacket=packet,
            originalHistories=len(plan_ids), planRevision=edited["revision"], copyRevision=received["revision"])
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receiving", required=True)
    parser.add_argument("--receiving-sha256", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--archive")
    args = parser.parse_args(argv)
    operation = Operation(args)
    try:
        operation.operate()
        return 0
    except BaseException as error:
        import traceback
        operation.journal["failures"].append({"at": now(), "type": type(error).__name__,
            "message": str(error), "traceback": traceback.format_exc()})
        operation.save()
        emit("DIRECTORY_OPERATING_PLANS_INTERRUPTED", error={"type": type(error).__name__, "message": str(error)},
            journal=str(operation.path))
        raise

if __name__ == "__main__":
    raise SystemExit(main())
