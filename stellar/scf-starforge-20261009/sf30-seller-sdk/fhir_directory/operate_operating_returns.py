#!/usr/bin/env python3
"""Complete original returned-procedure receiving on a distinct derived Directory workspace.

Uses the completed Directory JSON and its exact editable packet. Every changed
procedure and choice is explicitly authored for this operation. No command,
provider request, external handover or customer acceptance is performed.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import threading
import urllib.request
import zipfile
from directory_runtime import source, original_workspace, atomic_json, now
from directory_workspace import Workspace
from directory_server import OperatorServer
from directory_operating_returns import RETURN_KIND, retained_return_files
from directory_operating_plans import PLAN_KIND
from operate_operating_plans import Operation as OriginalOperation, private_dir, info, read_json, write_once, require, matches_file

HERE = Path(__file__).resolve().parent
OPERATION = "SCF-DIRECTORY-CUSTOMER-RETURN-450E-20261013"
ACTOR = "450E authored local customer-return receiving"
RESULT_SCHEMA = "stellar-forge.directory-operating-returns-operated.v1"

def source_identity():
    paths = ["directory_operating_returns.py", "directory_operating_return_bridge.mjs",
        "directory-operating-returns-schema.json", "directory_operating_plans.py",
        "directory_operating_plan.mjs", "directory_operating_plan_bridge.mjs",
        "directory_workspace.py", "directory_receiving.py", "directory_schema.py",
        "directory_server.py", "cli.py", "operate_operating_plans.py", "operate_operating_returns.py"]
    selected = [HERE / p for p in paths]
    selected += [HERE.parent.parent / "distribution" / "discovery" / p
        for p in ("operating-plan.mjs", "operating-plan-return.mjs", "catalog.mjs", "load.mjs")]
    rows = []
    for path in selected:
        raw = path.read_bytes()
        rows.append({"file": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "gitBlobSha": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()})
    return rows

class Operation(OriginalOperation):
    def __init__(self, args):
        self.args = args
        self.root = private_dir(args.out)
        self.workspace = Path(args.workspace).expanduser().absolute()
        self.receiving_path = Path(args.receiving).expanduser().absolute()
        basis = info(self.receiving_path)
        require(basis["sha256"] == args.receiving_sha256, "Keep the unchanged completed Directory result")
        self.native = read_json(self.receiving_path)
        require(self.native.get("schema") == "stellar-forge.human-services-directory-operated.v1",
            "Select the actual complete native Directory result")
        self.archive = Path(args.archive).expanduser().absolute() if args.archive else None
        if self.archive:
            require(matches_file(info(self.archive), self.native["workspacePacket"]), "Select its exact completed editable packet")
        self.path = self.root / "OPERATING_RETURNS_JOURNEY.json"
        inputs = {"operation": OPERATION, "workspace": str(self.workspace), "workspaceId": self.native["workspaceId"],
            "receiving": basis, "archive": info(self.archive) if self.archive else None, "source": source_identity()}
        if self.path.exists():
            self.journal = read_json(self.path)
            require(self.journal["inputs"] == inputs, "Resume the same source, original UUID and complete return inputs")
        else:
            self.journal = {"schema": "stellar-forge.directory-operating-returns-journey.v1", "inputs": inputs,
                "createdAt": now(), "steps": {}, "times": {}, "files": {}, "failures": []}
            self.save()
        self.copy_file("original-native-result", self.receiving_path, basis, "Original_Directory_Receiving.json")
        write_once(self.root / "OPERATING_RETURNS_SOURCE.json", inputs["source"])
        private_dir(self.root / "reviews"); private_dir(self.root / "exports")

    def emit(self, stage, **value):
        print(source.lexical_json({"stage": stage, "operation": OPERATION, **value}), flush=True)

    def step(self, key, request, call):
        digest = source.sha(source.jbytes(request))
        old = self.journal["steps"].get(key)
        if old:
            require(old["requestSha256"] == digest, "Keep the complete accepted return request: " + key)
            if old["state"] == "complete": return old["result"]
        else:
            self.journal["steps"][key] = {"state": "prepared", "request": request,
                "requestSha256": digest, "preparedAt": self.at(key)}
            self.save()
        result = call()
        self.journal["steps"][key].update(state="complete", result=result, completedAt=now())
        self.save()
        self.emit("DIRECTORY_RETURN_NATIVE_STEP", key=key,
            recordId=result.get("record", {}).get("id") if isinstance(result, dict) else None)
        return result

    def authored_plan(self, ws, original, key, title, changes):
        request = {"document": original, "title": title, "changes": changes, "savedAt": self.at(key)}
        def author():
            draft = ws._operating_model("draft", {"document": original})
            draft["content"]["title"] = title
            draft["content"]["notes"] += "\n\n" + changes
            require(bool(draft["content"]["steps"]), "The complete original procedure must retain real steps")
            draft["content"]["steps"][0]["instruction"] += "\n" + changes
            return ws._operating_model("save", {"document": original, "draft": draft, "savedAt": request["savedAt"]})["document"]
        return self.step(key, request, author)

    def decide_all(self, ws, prepared, key):
        ident = prepared["id"]
        # Every exact original comparison row is reviewed explicitly in this
        # authored course. Recompute after decisions to preserve order semantics.
        for attempt in range(8):
            comparison = ws.directory_operating_return_comparison(ident)
            if comparison["ready"]: return ws.directory_record(RETURN_KIND, ident)
            selected = set(comparison["unresolved"])
            choices = [{"key": row["key"], "decision": {"take": "incoming",
                "note": "Explicit authored example: retain this complete incoming alternative, including coupled instructions/results."}}
                for row in comparison["rows"] if row["key"] in selected]
            require(choices, "An unresolved original comparison must expose its full decision rows")
            request = {"recordId": ident, "decisions": choices, "actor": ACTOR,
                "note": "Authored local review; no real customer decision is inferred."}
            saved = self.step(key + "-" + str(attempt), request, lambda: ws.revise_directory_operating_return(request))
            ident = saved["record"]["id"]
        raise RuntimeError("The original complete comparison still requires a new explicit review")

    def http_receiving(self, ws, record, replay):
        server = OperatorServer(ws, 0, expected_workspace_id=ws.workspace_id)
        server.__enter__()
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = server.url.split("#", 1)[0].rstrip("/")
        result = {"workspaceId": ws.workspace_id, "requests": []}
        try:
            def request(route, value=None):
                data = source.jbytes(value) if value is not None else None
                headers = {"Authorization": "Bearer " + server.token}
                if data is not None: headers["Content-Type"] = "application/json"
                req = urllib.request.Request(base + route, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=120) as response:
                    raw = response.read()
                    row = {"route": route, "method": "POST" if data is not None else "GET",
                        "status": response.status, "bytes": len(raw), "sha256": source.sha(raw)}
                result["requests"].append(row)
                return raw
            for kind in ("review", "comparison", "input"):
                raw = request("/api/directory/operatingPlanReturns/" + record["id"] + "/" + kind)
                original = getattr(ws, "directory_operating_return_" + kind)(record["id"])
                require(source.json_value(raw) == original, "Full authenticated original return read changed")
                raw_file = request("/api/directory/operatingPlanReturns/" + record["id"] + "/files/" + kind)
                require(source.sha(raw_file) == record["files"][kind]["sha256"] and
                    len(raw_file) == record["files"][kind]["bytes"], "Complete native file download differs")
            offset, total, rows = 0, None, []
            while True:
                page = source.json_value(request("/api/directory/operatingPlanReturns/" + record["id"] +
                    "/rows?offset=" + str(offset) + "&limit=2"))
                require(page["offset"] == offset and (total is None or total == page["total"]), "Keep exact original comparison pages")
                total = page["total"]; rows.extend(page["rows"])
                if page["nextOffset"] is None: break
                require(page["nextOffset"] == offset + len(page["rows"]) and page["nextOffset"] > offset,
                    "Advance through every complete original comparison row")
                offset = page["nextOffset"]
            require(len(rows) == total and rows == ws.directory_operating_return_comparison(record["id"])["rows"],
                "The authenticated comparison lost a full original row")
            saved = source.json_value(request("/api/directory/operating-returns/apply", replay))
            require(saved["record"]["id"] == record["id"] and saved["reused"], "Exact HTTP replay changed the original applied receipt")
            result["rows"] = len(rows); result["sameRequestReused"] = True
        finally:
            server.shutdown(); thread.join(timeout=10); server.__exit__(None, None, None)
        return result

    def operate(self):
        with Workspace(self.workspace, create=not self.workspace.exists()) as ws:
            originals = self.receive_original(ws)
            create = self.create_input()
            create.update(id="directory-return-course-450e-20261013", title="Complete Directory returned procedure",
                owner=ACTOR, actor=ACTOR, savedAt=self.at("02-original-preview"),
                note="Explicitly authored local return course over the unchanged completed Directory basis.")
            preview = self.step("02-original-preview", create, lambda: ws.preview_directory_operating_plan(create))
            accepted = {**create, "previewRecordId": preview["record"]["id"]}
            initial = self.step("03-original-plan", accepted, lambda: ws.create_directory_operating_plan(accepted))["record"]
            base = ws.directory_operating_plan_document(initial["id"])
            fork_request = {"document": base, "id": base["id"] + "-returned-copy",
                "savedAt": self.at("04-customer-copy")}
            fork = self.step("04-customer-copy", fork_request, lambda: ws._operating_model("copy", fork_request))["document"]
            incoming = self.authored_plan(ws, fork, "05-authored-return",
                "Customer review — complete directory handover",
                "Authored incoming alternative: the receiving owner reviews every source warning before agreeing the next cycle.")
            local_document = self.authored_plan(ws, base, "06-authored-local",
                "Operator revision — current directory handover",
                "Authored current alternative: retain the current local procedure while returned work is being reviewed.")
            local_request = {"document": local_document, "expectedRecordId": initial["id"],
                "actor": ACTOR, "note": "Explicit local divergence before return preparation."}
            current = self.step("07-save-current", local_request,
                lambda: ws.receive_directory_operating_plan(local_request))["record"]
            prepare = {"recordId": current["id"], "incoming": incoming,
                "id": "directory-customer-review-450e-20261013", "createdAt": self.at("08-prepare-return"),
                "reviewer": ACTOR, "notes": "Controlled local return course, not an external customer response.",
                "actor": ACTOR, "note": "Original complete current and returned-copy histories are retained."}
            prepared = self.step("08-prepare-return", prepare, lambda: ws.prepare_directory_operating_return(prepare))["record"]
            compared = ws.directory_operating_return_comparison(prepared["id"])
            require(compared["relationship"] == "returned-copy" and compared["summary"]["conflicts"] > 0,
                "The authored example must exercise the original divergent returned-copy review")
            reviewed = self.decide_all(ws, prepared, "09-review-original-choices")
            complete = {"recordId": reviewed["id"], "savedAt": self.at("10-complete-review"),
                "actor": ACTOR, "note": "Persist full original review intent before saving the native plan."}
            intent = self.step("10-complete-review", complete, lambda: ws.complete_directory_operating_return(complete))["record"]
            full_review = ws.directory_operating_return_review(intent["id"])
            require(full_review["completion"] is not None, "The original completed intent must be durable first")
            apply = {"recordId": intent["id"], "expectedRecordId": current["id"], "actor": ACTOR,
                "note": "Receive this exact completed review through the unchanged native plan receiver."}
            native_request = {"document": full_review["completion"]["plan"], "expectedRecordId": current["id"],
                "actor": apply["actor"], "note": apply["note"]}
            # Deliberately reach the recoverable boundary through the real
            # native receiver, before creating its separate applied-return row.
            received = self.step("11-native-plan-before-return-receipt", native_request,
                lambda: ws.receive_directory_operating_plan(native_request))
            applied = self.step("12-reconcile-applied-receipt", apply, lambda: ws.apply_directory_operating_return(apply))
            require(applied["plan"]["id"] == received["record"]["id"] and
                applied["record"]["addedRevisions"] == received["addedRevisions"],
                "The applied receipt must recover the exact earlier native plan transaction")
            later = ws.directory_operating_plan_draft(applied["plan"]["id"])
            later["content"]["notes"] += "\n\nLater explicitly authored local note after the completed returned review."
            later_request = {"recordId": applied["plan"]["id"], "draft": later,
                "savedAt": self.at("13-later-current-history"), "actor": ACTOR, "note": "Retain the full completed return as a historical prefix."}
            advanced = self.step("13-later-current-history", later_request,
                lambda: ws.save_directory_operating_plan(later_request))["record"]
            replayed = ws.apply_directory_operating_return(apply)
            require(replayed["reused"] and replayed["record"]["id"] == applied["record"]["id"] and
                ws._operating_head(current["planId"])["id"] == advanced["id"],
                "The exact original replay cannot replace a later saved head")
            historical_request = {**apply, "expectedRecordId": advanced["id"],
                "note": "Read-only receiving of the completed result already present in the full later history."}
            historical = self.step("14-receive-historical-completion", historical_request,
                lambda: ws.apply_directory_operating_return(historical_request))
            require(historical["record"]["alreadyPresent"] and historical["record"]["addedRevisions"] == 0 and
                historical["plan"]["id"] == advanced["id"], "Historical completion should not add another revision")
            receive_review = {"currentRecordId": current["id"], "review": full_review, "actor": ACTOR,
                "note": "Receive the unchanged complete editable customer review with original basis binding."}
            portable = self.step("15-receive-complete-review", receive_review,
                lambda: ws.receive_directory_operating_return(receive_review))["record"]
            require(ws.directory_operating_return_review(portable["id"]) == full_review, "Complete returned-review intake changed")
            exports = []
            for fmt in ("json", "html", "plan"):
                request = {"recordId": applied["record"]["id"], "format": fmt, "actor": ACTOR,
                    "note": "Full local editable/readable customer receiving."}
                exported = self.step("16-export-" + fmt, request, lambda request=request: ws.export_directory_operating_return(request))
                path, descriptor = ws._directory_file_path(exported["file"]), exported["file"]
                copied = self.copy_file("return-export-" + fmt, path, descriptor, "exports/" + exported["name"])
                exports.append({"record": exported, "file": copied, "input": request})
            records = ws.directory_records(RETURN_KIND)
            for record in records:
                for kind, descriptor in record["files"].items():
                    self.copy_file(record["id"] + "-" + kind, ws._directory_file_path(descriptor), descriptor,
                        "reviews/" + record["id"] + "/" + kind + ".json")
            http = self.step("17-original-http-and-replay", {"recordId": applied["record"]["id"], "input": apply},
                lambda: self.http_receiving(ws, applied["record"], apply))
            cli_output = self.root / "CLI_Original_Review.json"
            def run_cli():
                argv = [sys.executable, str(HERE / "cli.py"), "operating-return-review",
                    "--workspace", str(self.workspace), "--id", applied["record"]["id"]]
                proc = subprocess.run(argv, capture_output=True, timeout=180)
                require(proc.returncode == 0, "Original native CLI review failed: " + proc.stderr.decode(errors="replace"))
                require(source.json_value(proc.stdout) == full_review, "Original CLI changed the complete review")
                if cli_output.exists(): require(cli_output.read_bytes() == proc.stdout, "Keep the complete original CLI response")
                else: original_workspace.private_write(cli_output, proc.stdout)
                return {"argv": argv, "exitCode": proc.returncode, "file": info(cli_output)}
            cli = self.step("18-original-cli", {"recordId": applied["record"]["id"]}, run_cli)
            require(self.native_records(ws) == originals, "The return course changed an original Directory record")
            packet_path = self.root / "Directory_Customer_Return_Complete_Editable_Workspace.zip"
            record_ids = {kind: [r["id"] for r in ws.directory_records(kind)] for kind in
                ws.directory_state()["collections"] if kind != "receives"}
            def export_packet():
                if not packet_path.exists(): ws.export_workspace(packet_path)
                with zipfile.ZipFile(packet_path) as archive:
                    registry = source.json_value(archive.read("directory-registry.json"))
                for kind, ids in record_ids.items():
                    actual = "acquisitions" if kind == "operations" else kind
                    require([r["id"] for r in registry["records"].get(actual, [])] == ids,
                        "Full exported return workspace lost a collection: " + kind)
                return info(packet_path)
            packet = self.step("19-full-workspace-export", {"recordIds": record_ids}, export_packet)
            with zipfile.ZipFile(packet_path) as archive:
                registry = source.json_value(archive.read("directory-registry.json"))
            write_once(self.root / "EXPORTED_RETURN_REGISTRY.json", registry)
        restored = self.root / "received-workspace"
        with Workspace(restored, create=not restored.exists()) as target:
            restoration = self.step("20-full-customer-workspace-receive", packet, lambda: self._receive(target, packet_path))
            for kind, rows in registry["records"].items():
                if kind != "receives":
                    require(target.directory_records(kind) == rows, "Complete received return collection differs: " + kind)
            plans_check = target._verify_operating_plans_received(registry)
            returns_check = target._verify_operating_returns_received(registry)
            require(returns_check["count"] == len(records), "Verify every original return and accepted request")
            require(self.native_records(target) == originals, "The customer copy lost original Directory records")
        with Workspace(restored, create=False) as target:
            require(target.directory_operating_return_review(applied["record"]["id"]) == full_review,
                "Reopened customer review differs")
            require(target._operating_head(current["planId"])["id"] == advanced["id"],
                "Reopening lost the actual later saved history")
        self.journal.setdefault("completedAt", now()); self.save()
        result = {"schema": RESULT_SCHEMA, "operation": OPERATION, "completedAt": self.journal["completedAt"],
            "workspace": str(self.workspace), "workspaceId": self.native["workspaceId"], "sourceRoot": str(HERE),
            "originalDirectoryReceiving": self.journal["inputs"]["receiving"],
            "originalDirectoryPacket": self.native["workspacePacket"], "originalDirectoryRecordHashes": originals,
            "initialPlanRecordId": initial["id"], "currentPlanRecordId": current["id"],
            "appliedPlanRecordId": applied["plan"]["id"], "latestPlanRecordId": advanced["id"],
            "preparedReturnId": prepared["id"], "reviewedReturnId": reviewed["id"], "completedReturnId": intent["id"],
            "appliedReturnId": applied["record"]["id"], "historicalReturnId": historical["record"]["id"],
            "receivedReturnId": portable["id"], "returnRecordIds": [r["id"] for r in records],
            "recordIds": {k: [r["id"] for r in rows] for k, rows in registry["records"].items()},
            "comparison": compared, "summary": applied["record"]["summary"], "http": http, "cli": cli,
            "exports": exports, "files": self.journal["files"], "workspacePacket": packet,
            "connectedInputs": {"prepare": prepare, "complete": complete, "apply": apply,
                "historicalApply": historical_request, "receive": receive_review,
                "revisions": [step["request"] for key, step in self.journal["steps"].items() if key.startswith("09-review-original-choices")]},
            "restoration": {**restoration, "workspace": str(restored), "plans": plans_check,
                "returns": returns_check, "reopened": True, "allOriginalRecordsEqual": True},
            "journal": str(self.path),
            "meaning": "Explicitly authored local customer-return review using the unchanged original model. Completed intent, native plan save and applied receipt are separately retained and recoverable; no external response or human acceptance is inferred."}
        descriptor = write_once(self.root / "OPERATED_DIRECTORY_OPERATING_RETURNS.json", result)
        self.journal["result"] = descriptor; self.save()
        self.emit("DIRECTORY_OPERATING_RETURNS_COMPLETE", result=descriptor, workspacePacket=packet)
        return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("receiving", "receiving-sha256", "workspace", "out"): parser.add_argument("--" + flag, required=True)
    parser.add_argument("--archive")
    operation = Operation(parser.parse_args(argv))
    try: operation.operate(); return 0
    except BaseException as error:
        import traceback
        operation.journal["failures"].append({"at": now(), "type": type(error).__name__,
            "message": str(error), "traceback": traceback.format_exc()})
        operation.save(); operation.emit("DIRECTORY_OPERATING_RETURNS_INTERRUPTED", journal=str(operation.path),
            error={"type": type(error).__name__, "message": str(error)})
        raise
if __name__ == "__main__": raise SystemExit(main())
