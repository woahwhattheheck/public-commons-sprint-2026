"""One complete source-bound operating and independent receiving programme.

This module consumes selected original local files. Public acquisition remains the
separately selected collector, and no private model or EAM protocol is invented.
"""
from __future__ import annotations
import argparse
import base64
import json
import hashlib
import ctypes
import signal
import time
import os
from pathlib import Path
import subprocess
import sys
import zipfile
from domain import ProgrammeError, require, stable, digest, identifier
from workspace import Workspace, atomic, file_identity, receive_workspace, RUNTIME_FILES, MAX_ARCHIVE, safe_relative
from cli import prepared

SCHEMA = "lake-county.operating-selection/v1"
RESULT_SCHEMA = "lake-county.complete-operating-result/v1"

def selected_file(item):
    path = Path(item["path"]).resolve()
    require(file_identity(path) == {"bytes": item["bytes"], "sha256": item["sha256"]},
            "selected_source", "The complete original source differs from the selected bytes.", {"path": str(path)})
    return path


def checked_archive(path, selection):
    """Read every declared byte before accepting a recovered or browser export."""
    path = Path(path).resolve()
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        require(len(infos) <= 100000 and len({i.filename for i in infos}) == len(infos)
                and sum(i.file_size for i in infos) <= MAX_ARCHIVE,
                "export_members", "Retain a complete bounded archive with unique members.")
        manifest = json.loads(archive.read("manifest.json"))
        require(manifest.get("schema") == "lake-county.complete-workspace-archive/v1"
                and manifest["origin"]["workspace_id"] == selection["workspace_id"]
                and manifest["workspace_revision"] == selection["workspace_revision"]
                and manifest["selected_publication"] == selection["publication"],
                "export_identity", "The archive differs from the original selected native snapshot.")
        entries = manifest["members"]
        require(len({r["path"] for r in entries}) == len(entries)
                and {i.filename for i in infos} == {"manifest.json"} | {r["path"] for r in entries},
                "export_manifest", "Retain every original declared archive member exactly once.")
        runtime = []
        for row in entries:
            safe_relative(row["path"])
            count, calculated = 0, hashlib.sha256()
            with archive.open(row["path"]) as source:
                while chunk := source.read(1024 * 1024):
                    count += len(chunk)
                    calculated.update(chunk)
            require(count == row["bytes"] and calculated.hexdigest() == row["sha256"],
                    "export_member_identity", "An archive member differs from the original full manifest.", {"path":row["path"]})
            if row["path"].startswith("application/"):
                runtime.append({"path":row["path"].removeprefix("application/"),"bytes":count,"sha256":calculated.hexdigest()})
        require(set(manifest.get("application_files", [])) == set(RUNTIME_FILES)
                and sorted(runtime,key=lambda r:r["path"]) == sorted(selection["application"],key=lambda r:r["path"]),
                "export_application", "The complete selected application source must accompany the native workspace.")
    return {"schema":"lake-county.workspace-export-receipt/v1","path":str(path),**file_identity(path),
            "manifest_sha256":digest(manifest),"members":len(entries),
            "workspace_id":selection["workspace_id"],"workspace_revision":selection["workspace_revision"],
            "selected_publication":selection["publication"]}

def parent_bound_child(parent_pid):
    """End this private browser server if its original operating process exits."""
    def before_exec():
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            os._exit(126)
        if os.getppid() != parent_pid:
            os._exit(126)
    return before_exec

class Programme:
    def __init__(self, config):
        require(config.get("schema") == SCHEMA, "selection", "Use the complete operating selection.")
        self.config = config
        self.operation = identifier(config["operation_id"], "Original programme operation")
        self.actor = identifier(config["actor"], "Actual local operator")
        self.output = Path(config["output_root"]).resolve()
        self.root = Path(config["workspace_root"]).resolve()
        self.application = Path(config["application_root"]).resolve()
        self.output.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.selection_path = self.output / "selection.json"
        atomic(self.selection_path, (stable(config) + "\n").encode())
        self.journal_path = self.output / "journal.json"
        self.journal = json.loads(self.journal_path.read_text()) if self.journal_path.exists() else {
            "schema": "lake-county.operating-journal/v1", "operation_id": self.operation,
            "selection_sha256": digest(config), "steps": {}, "exports": {}, "complete": False}
        require(self.journal.get("operation_id") == self.operation
                and self.journal.get("selection_sha256") == digest(config),
                "operation_selection", "Retain the original whole operating selection.", status=409)
        self.save()
        self.w = None
    def save(self):
        atomic(self.journal_path, (stable(self.journal) + "\n").encode(), replace=True)
    def open(self):
        packet = self.config["workshare_source"]
        selected_file(packet)
        if self.root.exists():
            self.w = Workspace(self.root)
            require(self.w.context["case_id"] == self.config["case_id"]
                    and self.w.context["packet_sha256"] == packet["sha256"],
                    "case_source", "The actual workspace belongs to another case or original source.", status=409)
        else:
            self.w = Workspace.create(self.root, case_id=self.config["case_id"],
                                      packet_sha256=packet["sha256"], actor=self.actor)
        if "workspace_id" in self.journal:
            require(self.w.context["workspace_id"] == self.journal["workspace_id"],
                    "workspace_identity", "The original native workspace identity changed.", status=409)
        else:
            self.journal["workspace_id"] = self.w.context["workspace_id"]
            self.save()
    def step(self, key, action, payload):
        identifier(key, "Programme step")
        original = self.output / "requests" / (key + ".json")
        operation = self.operation + "/" + key
        request = prepared(self.w, original, operation_id=operation, actor=self.actor, action=action, payload=payload)
        response = self.w.apply(request)
        response_path = self.output / "responses" / (key + ".json")
        atomic(response_path, (stable(response) + "\n").encode())
        result = {"request": str(original), "request_sha256": digest(request),
                  "response": str(response_path), "response_sha256": digest(response)}
        if key in self.journal["steps"]:
            require(self.journal["steps"][key] == result, "step_identity", "The original native response changed.")
        else:
            self.journal["steps"][key] = result
            self.save()
        return response["result"]
    def retain(self, key, item):
        path = selected_file(item)
        raw = path.read_bytes()
        return self.step("source-" + key, "file.retain", {
            "name": item.get("name") or path.name, "mime": item.get("mime", "application/octet-stream"),
            "bytes": item["bytes"], "sha256": item["sha256"], "base64": base64.b64encode(raw).decode("ascii"),
            "metadata": item["metadata"]})
    def freeze_export(self, publication):
        path = self.output / "Lake_County_Capital_Program_Complete.zip"
        name = "complete_workspace"
        prior = self.journal["exports"].get(name)
        runtime = [{"path": f, **file_identity(self.application / f)} for f in RUNTIME_FILES]
        selection = {"workspace_id": self.w.context["workspace_id"], "workspace_revision": self.w.revision(),
                     "publication": {k: publication[k] for k in ("id", "revision", "sha256")},
                     "application": runtime}
        if prior:
            require(prior["selection"]["publication"] == selection["publication"]
                    and prior["selection"]["workspace_id"] == selection["workspace_id"]
                    and prior["selection"]["application"] == runtime,
                    "export_selection", "Keep the original export and application source selection.", status=409)
            selection = prior["selection"]
        else:
            self.journal["exports"][name] = {"selection": selection, "path": str(path), "receipt": None}
            self.save()
            prior = self.journal["exports"][name]
        if not path.exists():
            require(prior.get("receipt") is None, "export_missing", "The completed original archive is absent; recover its exact bytes.")
            require(self.w.revision() == selection["workspace_revision"], "export_later_edit",
                    "The workspace changed before its original pending export. Preserve the later state and recover the selected snapshot.", status=409)
            self.w.export_workspace(path, publication_id=publication["id"], application_root=self.application)
        receipt = checked_archive(path, selection)
        if prior.get("receipt"):
            require(prior["receipt"] == receipt, "export_identity", "The original complete export bytes changed.")
        else:
            prior["receipt"] = receipt
            self.save()
        return receipt
    def completed_result(self):
        path = self.output / "result.json"
        if not path.exists():
            require(not self.journal.get("complete"), "result_missing", "Recover the original complete result file.")
            return None
        result = json.loads(path.read_text(encoding="utf-8"))
        require(result.get("schema") == RESULT_SCHEMA and result.get("operation_id") == self.operation
                and result.get("selection_sha256") == digest(self.config)
                and result.get("workspace_id") == self.w.context["workspace_id"]
                and result.get("case_id") == self.config["case_id"]
                and result.get("client_acceptance") is False,
                "result_identity", "Retain the complete original operating result and selection.", status=409)
        if self.journal.get("result_sha256"):
            require(self.journal["result_sha256"] == digest(result), "result_identity", "The original result changed.")
        for key in ("report", "export"):
            entry = result[key]
            require(file_identity(entry["path"]) == {k:entry[k] for k in ("bytes","sha256")},
                    "result_file", "The original complete result file is unavailable.", {"kind":key})
        prior_export = self.journal["exports"].get("complete_workspace", {})
        require(prior_export.get("receipt") == result["export"], "result_export", "Keep the original sealed export receipt.")
        received = result["receiving"]
        require(received.get("complete") and received["destination"] == str(Path(self.config["receiving_root"]).resolve())
                and received["archive_sha256"] == result["export"]["sha256"]
                and received["archive_bytes"] == result["export"]["bytes"]
                and received["workspace_id"] == result["workspace_id"],
                "result_receiving", "Retain the original complete receiving identity.")
        receiver = Workspace(Path(received["destination"]) / "workspace")
        try:
            require(receiver.context["workspace_id"] == result["workspace_id"],
                    "result_receiving", "The received workspace identity changed.")
        finally:
            receiver.close()
        for entry in result["independent_readbacks"].values():
            require(file_identity(entry["path"]) == {k:entry[k] for k in ("bytes","sha256")},
                    "result_readback", "Retain the independently executed original application readback.")
        if self.config.get("browser"):
            review = result.get("browser_review")
            require(review and review["complete"] and not review["page_errors"] and not review["overflow"],
                    "result_browser", "Retain the completed actual browser review.")
            for entry in review["screens"] + review["downloads"]:
                require(file_identity(entry["path"]) == {k:entry[k] for k in ("bytes","sha256")},
                        "result_browser_file", "Retain the complete original browser evidence.")
        self.journal["complete"] = True
        self.journal["result_sha256"] = digest(result)
        self.save()
        return result

    def independent_readbacks(self, receiving_root, publication):
        launcher = receiving_root / "application" / "cli.py"
        native_root = receiving_root / "workspace"
        selected = self.journal["exports"]["complete_workspace"]["selection"]
        checks = {
            "status": [sys.executable,"-B",str(launcher),"status","--root",str(native_root)],
            "publication": [sys.executable,"-B",str(launcher),"object","--root",str(native_root),
                            "--kind","publication","--id",publication["id"],"--revision",str(publication["revision"])]
        }
        receipts = {}
        for key, command in checks.items():
            path = self.output / ("independent-" + key + ".json")
            if path.exists():
                raw = path.read_bytes()
            else:
                for entry in selected["application"]:
                    require(file_identity(receiving_root / "application" / entry["path"])
                            == {k:entry[k] for k in ("bytes","sha256")},
                            "received_application", "The selected received source changed before its original independent execution.")
                raw = subprocess.check_output(command)
            body = json.loads(raw)
            if key == "status":
                require(body["context"] == self.w.context and body["revision"] == selected["workspace_revision"],
                        "received_snapshot", "The first independently received status must describe the original snapshot.")
            else:
                require(body["id"] == publication["id"] and body["revision"] == publication["revision"]
                        and body["sha256"] == publication["sha256"] and digest(body["body"]) == publication["sha256"],
                        "received_publication", "The independently launched received publication differs.")
            atomic(path, raw)
            receipts[key] = {"path":str(path),**file_identity(path)}
        return receipts

    def browser_review(self, receiving_root, publication, report):
        selected = self.journal["exports"]["complete_workspace"]["selection"]
        completed_path = self.output / "browser-review.json"
        if completed_path.exists():
            review = json.loads(completed_path.read_text(encoding="utf-8"))
            require(review["complete"] and review["workspace_id"] == self.w.context["workspace_id"]
                    and review["publication_id"] == publication["id"],
                    "browser_identity", "Retain the actual completed review of this received publication.")
            return review
        browser = self.config["browser"]
        require(sys.platform.startswith("linux"), "browser_runtime",
                "This operating browser launcher requires the selected Linux runtime; the application can otherwise be used through its original CLI.")
        # The browser opens the RECEIVED server and assets; the parent source is not substituted.
        for entry in selected["application"]:
            require(file_identity(receiving_root / "application" / entry["path"])
                    == {k:entry[k] for k in ("bytes","sha256")},
                    "browser_application", "The received application source differs from this exact selected handover.")
        attempts = self.journal.setdefault("browser_attempts", [])
        if attempts:
            previous = Path(attempts[-1]["directory"]) / "browser-output.json"
            if previous.exists():
                candidate = json.loads(previous.read_text(encoding="utf-8"))
                if candidate.get("complete"):
                    self.verify_browser(candidate, selected, report)
                    atomic(completed_path, (stable(candidate)+"\n").encode())
                    return candidate
        attempt = self.output / "browser" / ("attempt-" + str(len(attempts)+1).zfill(3))
        require(not attempt.exists(), "browser_attempt", "Retain the original interrupted browser directory.")
        attempts.append({"directory":str(attempt),"state":"prepared","application":selected["application"]})
        self.save()
        attempt.mkdir(parents=True, mode=0o700)
        startup = attempt / "server-startup.json"
        logs = attempt / "private-server.log"
        server = None
        with logs.open("xb") as output:
            os.chmod(logs,0o600)
            try:
                server = subprocess.Popen([sys.executable,"-B",str(receiving_root/"application"/"cli.py"),
                    "serve","--root",str(receiving_root/"workspace"),"--startup-file",str(startup)],
                    stdout=output,stderr=output,preexec_fn=parent_bound_child(os.getpid()))
                deadline = time.monotonic()+30
                while not startup.exists() and server.poll() is None and time.monotonic()<deadline:
                    time.sleep(0.05)
                require(startup.exists() and server.poll() is None, "browser_server",
                        "The received application's private server did not reach its original startup receipt.", {"log":str(logs)})
                opened = json.loads(startup.read_text(encoding="utf-8"))
                require(opened["workspace_id"] == self.w.context["workspace_id"], "browser_workspace", "The received server opened another workspace.")
                token = opened["url"].split("#token=",1)[1]
                control = attempt / "private-browser-selection.json"
                atomic(control,(stable({"origin":opened["origin"],"token":token,
                    "workspace_id":opened["workspace_id"],"publication_id":publication["id"],
                    "report_sha256":report["sha256"]})+"\n").encode())
                run = subprocess.run([browser["node"],str(receiving_root/"application"/"operate_browser.mjs"),
                    "--startup",str(control),"--output",str(attempt/"views"),
                    "--playwright-module",browser["playwright_module"],"--browser-executable",browser["browser_executable"]],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                atomic(attempt/"browser-stderr.txt",run.stderr)
                review = json.loads(run.stdout)
                atomic(attempt/"browser-output.json",run.stdout)
                attempts[-1]["state"] = "complete" if review.get("complete") else "review_required"
                attempts[-1]["result"] = {"path":str(attempt/"browser-output.json"),**file_identity(attempt/"browser-output.json")}
                self.save()
                self.verify_browser(review,selected,report)
                require(run.returncode == 0,"browser_exit","The original browser review did not complete.",{"returncode":run.returncode})
                atomic(completed_path,(stable(review)+"\n").encode())
                return review
            finally:
                if server is not None:
                    if server.poll() is None:
                        server.terminate()
                    try:
                        server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait()

    def verify_browser(self, review, selected, report):
        require(review.get("complete") is True and review["page_errors"] == [] and review["overflow"] == []
                and review["workspace_id"] == selected["workspace_id"]
                and review["publication_id"] == selected["publication"]["id"],
                "browser_review", "Review the retained actual browser findings before delivery.", {"review":review})
        require(len(review["screens"]) == 14, "browser_screens", "Review all seven sections at desktop and phone widths.")
        for entry in review["screens"]+review["downloads"]:
            require(file_identity(entry["path"]) == {k:entry[k] for k in ("bytes","sha256")},
                    "browser_file", "A retained actual browser file differs.")
        reports = [r for r in review["downloads"] if r["kind"] == "report"]
        archives = [r for r in review["downloads"] if r["kind"] == "complete_workspace"]
        require(len(reports) == len(archives) == 1 and reports[0]["sha256"] == report["sha256"],
                "browser_downloads", "Retain the complete original report and workspace browser downloads.")
        checked_archive(archives[0]["path"],selected)

    def finish(self):
        try:
            self.open()
            completed = self.completed_result()
            if completed is not None:
                return completed
            packet = dict(self.config["workshare_source"])
            packet["metadata"] = {"source_kind": "proposed_workshare", "authority": "Original FEA workshare preparation",
                                  "status": "proposed_not_client_accepted"}
            packet["mime"] = "application/json"
            source_files = {"workshare": self.retain("workshare", packet)}
            for item in self.config.get("files", []):
                key = identifier(item["key"], "Original source key")
                require(key not in source_files, "source_key", "Source keys must be unique.")
                source_files[key] = self.retain(key, item)
            editions = {}
            for item in self.config["editions"]:
                key = identifier(item["key"], "Edition key")
                require(key not in editions, "edition_key", "Edition keys must be unique.")
                selections = []
                for selected in item["selections"]:
                    source = source_files[selected["file_key"]]
                    selections.append({"file_id": source["id"], **{k:v for k,v in selected.items() if k != "file_key"}})
                editions[key] = self.step("edition-" + key, "edition.create", {
                    "name": item["name"], "predecessor_id": editions[item["predecessor_key"]]["id"] if item.get("predecessor_key") else None,
                    "selections": selections})
            exchanges = {}
            for item in self.config.get("exchanges", []):
                key = identifier(item["key"], "Exchange key")
                payload = {k:item[k] for k in ("table", "key_fields", "guard_fields", "editable_fields", "model_name", "model_version", "method_note")}
                payload["edition_id"] = editions[item["edition_key"]]["id"]
                payload["model_file_ids"] = [source_files[f]["id"] for f in item["model_file_keys"]]
                original = self.step("exchange-" + key, "exchange.prepare", payload)
                if item.get("return_edition_key"):
                    original = self.step("return-" + key, "exchange.return", {"id": original["id"], "expected_version": original["revision"],
                        "candidate_edition_id": editions[item["return_edition_key"]]["id"], "table": item["table"]})
                    if item.get("adoption"):
                        decision = item["adoption"]
                        original = self.step("adopt-" + key, "exchange.adopt", {
                            "id": original["id"], "expected_version": original["revision"], "comparison_sha256": original["body"]["comparison_sha256"],
                            "status": decision["status"], "note": decision["note"]})
                exchanges[key] = original
            scenarios = {}
            for item in self.config.get("scenarios", []):
                key = identifier(item["key"], "Scenario key")
                spec = dict(item["spec"])
                spec["edition_id"] = editions[item["edition_key"]]["id"]
                # Selection by original source keys is explicit and must be unique.
                if "record_keys" in item:
                    table = "model_outputs" if spec["mode"] == "received_model" else "actions"
                    rows = list(self.w._rows(spec["edition_id"], table))
                    keys = item["record_keys"]
                    require(isinstance(keys, list) and len(set(keys)) == len(keys), "scenario_keys", "Select unique original keys.")
                    selected = []
                    for selected_key in keys:
                        matches = [r for r in rows if r["key"] == selected_key]
                        require(len(matches) == 1, "scenario_identity", "An original selected record key is absent or ambiguous.", {"key": selected_key})
                        selected.append(matches[0]["row_id"])
                    spec["selected_row_ids"] = selected
                if "funding_record_keys" in item:
                    keys = item["funding_record_keys"]
                    require(isinstance(keys,list) and len(set(keys)) == len(keys),
                            "funding_keys","Select unique original funding keys.")
                    rows = list(self.w._rows(spec["edition_id"],"funding"))
                    selected = []
                    for key_value in keys:
                        matches = [r for r in rows if r["key"] == key_value]
                        require(len(matches) == 1,"funding_identity",
                                "An original selected funding key is absent or ambiguous.",{"key":key_value})
                        selected.append(matches[0]["row_id"])
                    spec["funding_row_ids"] = selected
                if item.get("exchange_key"):
                    exchange = exchanges[item["exchange_key"]]
                    spec["model_exchange"] = {k:exchange[k] for k in ("id", "revision", "sha256")}
                scenarios[key] = self.step("scenario-" + key, "scenario.save", {"spec": spec})
            for item in self.config.get("reviews", []):
                kind, key = item["kind"], item["key"]
                selected = editions[key] if kind == "edition" else scenarios[key] if kind == "scenario" else exchanges[key]
                self.step("review-" + kind + "-" + key, "review.save", {
                    "subject_kind": kind, "subject_id": selected["id"], "subject_revision": selected.get("revision"),
                    "subject_sha256": selected["sha256"], "status": item["status"], "note": item["note"],
                    "capacity": item.get("capacity", "internal_operator")})
            publication_selection = self.config["publication"]
            publication = self.step("publication", "publication.create", {
                "name": publication_selection["name"], "edition_id": editions[publication_selection["edition_key"]]["id"],
                "kind": publication_selection["kind"],
                "scenarios": [{k:scenarios[key][k] for k in ("id", "revision", "sha256")}
                              for key in publication_selection.get("scenario_keys", [])]})
            report = self.output / "Lake_County_Capital_Program_Report.html"
            atomic(report, self.w.report(publication["id"]).encode())
            exported = self.freeze_export(publication)
            receiving_root = Path(self.config["receiving_root"]).resolve()
            received = receive_workspace(exported["path"], receiving_root,
                                         expected_sha256=exported["sha256"], expected_bytes=exported["bytes"])
            readbacks = self.independent_readbacks(receiving_root, publication)
            result = {"schema": RESULT_SCHEMA, "operation_id": self.operation, "selection_sha256": digest(self.config),
                      "workspace_id": self.w.context["workspace_id"], "case_id": self.w.context["case_id"],
                      "client_acceptance": False, "source_files": source_files,
                      "editions": {k:{"id":v["id"],"sha256":v["sha256"],"counts":v["counts"],
                                    "issue_count":v["issue_count"],"intake_complete":v["intake_complete"]} for k,v in editions.items()},
                      "publication": {k:publication[k] for k in ("id","revision","sha256")},
                      "report": {"path":str(report),**file_identity(report)}, "export":exported,
                      "receiving": received, "independent_received_application":True, "independent_readbacks":readbacks,
                      "browser_review":None}
            if self.config.get("browser"):
                result["browser_review"] = self.browser_review(receiving_root,publication,result["report"])
            atomic(self.output / "result.json", (stable(result)+"\n").encode())
            self.journal["complete"] = True
            self.journal["result_sha256"] = digest(result)
            self.save()
            return result
        finally:
            if self.w:
                self.w.close()

def main():
    parser=argparse.ArgumentParser(description="Operate the exact selected FEA input and independently receive the complete workspace.")
    parser.add_argument("--selection", required=True)
    args=parser.parse_args()
    config=json.loads(Path(args.selection).read_text(encoding="utf-8"))
    result=Programme(config).finish()
    print(stable(result), flush=True)

if __name__=="__main__":
    try:
        main()
    except ProgrammeError as exc:
        print(stable({"error":exc.code,"message":str(exc),"details":exc.details}), flush=True)
        raise SystemExit(2)
