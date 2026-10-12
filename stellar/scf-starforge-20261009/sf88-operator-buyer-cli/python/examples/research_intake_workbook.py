#!/usr/bin/env python3
"""One saved Research selection -> original browser intake -> workbook -> restore.

This is a receiving continuation for an existing Research workspace/output.
It reuses the original research_document_workbook.Workflow for the immutable
query/export/workbook/archive chain and its cold receiving checks. It does not
acquire another document purchase or submit/poll a provider job.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import uuid

from research_document_workbook import Workflow, WORKBOOK_COLUMNS, canonical, need, pin
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace, serve
from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.research_documents import ResearchDocumentSource
from stellar_forge_buyer.response_documents import document_path
from stellar_forge_buyer.storage import dump, lock, parse, private_directory, read

SCHEMA = "stellar-forge.research-intake-workbook-operation.v1"
BROWSER_SCHEMA = "stellar-forge.analysis-research-browser-receiving.v1"
_SOURCE = "document_elements"
_SELECTION_FIELDS = {"connection", "expected_workspace_id", "dossier_id", "family",
                     "selection", "expected_edition_sha256", "name", "title"}


def selection_file(path):
    value = parse(read(Path(path).expanduser().absolute(), 1024 * 1024))
    need(isinstance(value, dict) and set(value) == _SELECTION_FIELDS,
         "RESEARCH_INTAKE_SELECTION_FIELDS_INVALID")
    patterns = {
        "connection": r"[A-Za-z][A-Za-z0-9_-]{0,63}",
        "expected_workspace_id": r"research_[a-f0-9]{64}",
        "dossier_id": r"d_[a-f0-9-]{36}",
        "expected_edition_sha256": r"[a-f0-9]{64}",
    }
    for key, pattern in patterns.items():
        need(isinstance(value[key], str) and re.fullmatch(pattern, value[key]),
             "RESEARCH_INTAKE_SELECTION_ID_INVALID:" + key)
    need(value["family"] in {"documents", "pipelines"} and value["name"] == _SOURCE,
         "RESEARCH_INTAKE_ORIGINAL_WORKBOOK_SOURCE_REQUIRED")
    title = value["title"]
    need(isinstance(title, str) and 1 <= len(title) <= 160 and title.strip() and
         all(ord(char) >= 32 and ord(char) != 127 for char in title),
         "RESEARCH_INTAKE_SOURCE_TITLE_INVALID")
    chosen = value["selection"]
    need(isinstance(chosen, dict), "RESEARCH_INTAKE_ONE_SELECTION_REQUIRED")
    fields = set(chosen)
    permitted = ((fields == {"editionId"}) or
                 (value["family"] == "documents" and fields == {"purchaseId"}) or
                 (value["family"] == "pipelines" and fields == {"operationId", "outputId"}))
    need(permitted, "RESEARCH_INTAKE_ONE_SELECTION_REQUIRED")
    for key, item in chosen.items():
        prefix = {"editionId": "e_", "purchaseId": "u_", "operationId": "up_", "outputId": "out_"}[key]
        need(isinstance(item, str) and re.fullmatch(prefix + r"[a-f0-9]{64}", item),
             "RESEARCH_INTAKE_ORIGINAL_SELECTION_REQUIRED")
    return value


class IntakeWorkflow(Workflow):
    def __init__(self, *args, research_connections=None, playwright=None, chromium=None,
                 temporary_root=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.research_connections = research_connections
        self.playwright = str(Path(playwright).expanduser().resolve()) if playwright else None
        self.chromium = str(Path(chromium).expanduser().resolve()) if chromium else None
        self.temporary_root = Path(temporary_root).expanduser().resolve() if temporary_root else (
            Path("/dev") if sys.platform == "linux" else Path(tempfile.gettempdir()))
        need(self.temporary_root.is_dir(), "RESEARCH_INTAKE_TEMPORARY_ROOT_REQUIRED")
        self.browser_directory = private_directory(self.root / "browser")

    def read_operation(self):
        value = parse(read(self.root / "operation.json", 1024 * 1024))
        need(value.get("schema") == SCHEMA and isinstance(value.get("selection"), dict),
             "RESEARCH_INTAKE_OPERATION_CHANGED")
        self.operation = value
        return value

    def operation_for(self, selection):
        operation_file = self.root / "operation.json"
        if operation_file.is_file():
            self.read_operation()
            need(self.operation["selection"] == selection, "RESEARCH_INTAKE_SELECTION_CHANGED")
        else:
            self.operation = {
                "schema": SCHEMA, "id": uuid.uuid4().hex,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "selection": selection,
                # Capture/preview/import IDs come from the actual original
                # browser requests and are joined once after their admission.
                "capture_id": None,
                "jobs": {name: None if name in {"preview", "import"} else uuid.uuid4().hex
                         for name in ("preview", "import", "query", "query_export", "workbook", "workspace_export")},
                "workbook_definition_request": uuid.uuid4().hex,
                "restore_operation": uuid.uuid4().hex,
            }
            dump(operation_file, self.operation, exclusive=True)
        return self.operation

    def workspace(self, *, connected=False, directory=None):
        return AnalysisWorkspace(directory or self.root / "analysis",
            checkout=self.checkout, node=self.node,
            research_connections=self.research_connections if connected else None)

    def source(self):
        capture = self.saved("capture")
        source = ResearchDocumentSource(document_path(self.root / "analysis", capture["result"]["document_id"]).parent)
        selected = self.operation["selection"]
        need(source.document_id == capture["result"]["document_id"] and
             source.receipt["identity"]["editionSha256"] == selected["expected_edition_sha256"] and
             source.manifest["title"] == selected["title"],
             "RESEARCH_INTAKE_REGISTERED_SOURCE_CHANGED")
        source.verify()
        return source

    def _browser(self, workspace, *, restore=False, expected_capture=None):
        need(self.playwright and self.chromium, "RESEARCH_INTAKE_EXISTING_BROWSER_RUNTIME_REQUIRED")
        need(Path(self.playwright).is_file() and Path(self.chromium).is_file(),
             "RESEARCH_INTAKE_EXISTING_BROWSER_RUNTIME_REQUIRED")
        server, control, url = serve(workspace, port=0)
        owner = threading.Thread(target=server.serve_forever, name="analysis-research-receiving-host")
        owner.start()
        try:
            with tempfile.TemporaryDirectory(prefix="analysis-research-", dir=self.temporary_root) as temporary:
                os.chmod(temporary, 0o700)
                config = {
                    "url": url, "directory": str(self.browser_directory),
                    "selection": self.operation["selection"], "analysisWorkspaceId": workspace.identity,
                    "waitSeconds": self.wait_seconds, "restore": restore, "expectedCapture": expected_capture,
                    "playwright": self.playwright, "chromium": self.chromium,
                    "temporaryDirectory": temporary,
                }
                environment = {**os.environ, "TMPDIR": temporary, "TMP": temporary, "TEMP": temporary}
                # The launch capability lives only in this original private
                # process pipe. Saved browser request/storage records exclude it.
                process = subprocess.Popen(
                    [self.node, str(Path(__file__).with_name("research_intake_browser.mjs"))],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, env=environment, start_new_session=True,
                )
                try:
                    stdout, stderr = process.communicate(json.dumps(config),
                        timeout=(1 if restore else 3) * self.wait_seconds + 180)
                except BaseException:
                    # This is the process group created by this Popen, not a
                    # remembered host PID or another operation's browser.
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        process.communicate(timeout=15)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.communicate()
                    raise
                phase = "restored" if restore else "capture"
                # Native helper failures contain source/request codes; avoid
                # retaining a launch URL in an accidental browser stack trace.
                diagnostic = stderr.replace(url, "[original Analysis capability]")
                if process.returncode:
                    dump(self.records / ("browser-" + phase + "-interruption.json"), {
                        "returncode": process.returncode, "error": diagnostic[-12000:],
                        "operation_id": self.operation["id"],
                    })
                    raise StateError("RESEARCH_INTAKE_BROWSER_INTERRUPTED:" + str(process.returncode))
                result = json.loads(stdout)
                need(result.get("schema") == BROWSER_SCHEMA and
                     result.get("workspace_id") == workspace.identity,
                     "RESEARCH_INTAKE_BROWSER_RESULT_CHANGED")
                return result
        finally:
            server.shutdown()
            owner.join()
            server.server_close()
            # The original serve() owns this launch capability. A later open
            # writes its own current capability for the same workspace.
            try:
                current = parse(read(control, 1024 * 1024))
                if current.get("pid") == os.getpid() and current.get("url") == url:
                    control.unlink()
            except FileNotFoundError:
                pass

    def intake(self, selection):
        self.operation_for(selection)
        with closing(self.workspace(connected=True)) as workspace:
            self.bind_workspace(workspace)
            completed_path = self.browser_directory / "browser-complete.json"
            if completed_path.is_file():
                browser = parse(read(completed_path, 32 * 1024 * 1024))
                need(browser.get("schema") == BROWSER_SCHEMA and browser["workspace_id"] == workspace.identity,
                     "RESEARCH_INTAKE_BROWSER_RESULT_CHANGED")
            else:
                browser = self._browser(workspace)
            capture = workspace.job(browser["capture_id"])
            preview = workspace.job(browser["preview_id"])
            imported = workspace.job(browser["import_id"])
            need(all(job["status"] == "COMPLETE" for job in (capture, preview, imported)),
                 "RESEARCH_INTAKE_COMPLETE_NATIVE_JOBS_REQUIRED")
            need(capture["kind"] == "research-capture" and preview["kind"] == "response-preview"
                 and imported["kind"] == "response-import", "RESEARCH_INTAKE_NATIVE_JOB_KINDS_CHANGED")
            for key in _SELECTION_FIELDS:
                need(capture["request"].get(key) == selection[key], "RESEARCH_INTAKE_CAPTURE_SELECTION_CHANGED")
            need(all(browser["requests"][job["kind"]] == job["request"] for job in (capture, preview, imported)),
                 "RESEARCH_INTAKE_NATIVE_REQUEST_CHANGED")
            result = capture["result"]
            need(result["registration_current"] and preview["request"]["source"] == _SOURCE and
                 preview["request"]["source_revision"] == result["source"]["revision"] and
                 preview["request"]["mapping"] == result["mapping"],
                 "RESEARCH_INTAKE_CAPTURE_MAPPING_CHANGED")
            need(imported["request"]["preview_id"] == preview["id"] and
                 imported["request"]["preview_sha256"] == preview["result"]["preview_sha256"] and
                 imported["request"]["allow_incomplete"] is False and
                 imported["result"]["version"]["row_count"] == result["receipt"]["rowCount"],
                 "RESEARCH_INTAKE_IMPORTED_SCOPE_CHANGED")
            ids = {"capture_id": capture["id"], "preview": preview["id"], "import": imported["id"]}
            need(self.operation["capture_id"] in {None, ids["capture_id"]} and
                 all(self.operation["jobs"][name] in {None, ids[name]} for name in ("preview", "import")),
                 "RESEARCH_INTAKE_SAVED_JOB_IDS_CHANGED")
            self.operation["capture_id"] = capture["id"]
            for name in ("preview", "import"):
                self.operation["jobs"][name] = ids[name]
            dump(self.root / "operation.json", self.operation)
            self.receipt("capture", {key: capture[key] for key in ("id", "kind", "request", "result", "finished_at")})
            self.receipt("browser-capture", browser)
            source = self.source()
            self.receipt("registration", result["source"])
            self.receipt("source", {
                "document_id": source.document_id, "provider": source.receipt["identity"]["provider"],
                "edition_sha256": source.receipt["identity"]["editionSha256"],
                "row_count": source.receipt["rowCount"], "mapping": source.mapping,
            })
            reviewed = {
                "operation_id": self.operation["id"], "workspace_id": workspace.identity,
                "document_id": source.document_id, "source": result["source"],
                "preview_id": preview["id"], "preview_sha256": preview["result"]["preview_sha256"],
                "preview": preview["result"], "mapping": source.mapping,
                "source_complete": source.manifest["complete"], "source_rows": source.receipt["rowCount"],
                "originals": source.receipt["archives"], "workbook_columns": list(WORKBOOK_COLUMNS),
                "text_preview": source.receipt.get("workbookTextPreview"),
            }
            self.receipt("review", reviewed)
            # The base workflow reopens this exact imported job before its
            # original complete query/export/workbook/archive operations.
            return reviewed

    def reopen_browser(self, target=None):
        self.read_operation()
        capture = self.saved("capture")
        target = Path(target).expanduser().absolute() if target else self.root / "restored-analysis"
        with closing(AnalysisWorkspace(target)) as workspace:
            need(workspace.identity == self.saved("workspace")["workspace_id"], "RESEARCH_INTAKE_RESTORED_WORKSPACE_CHANGED")
            observed = workspace.job(capture["id"])
            need(observed["status"] == "COMPLETE" and observed["request"] == capture["request"] and
                 observed["result"]["document_id"] == capture["result"]["document_id"],
                 "RESEARCH_INTAKE_RESTORED_CAPTURE_CHANGED")
            result = self._browser(workspace, restore=True, expected_capture={
                "id": capture["id"], "document_id": capture["result"]["document_id"],
                "edition_sha256": capture["result"]["edition_sha256"]})
            return self.receipt("browser-restored", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--checkout", help="Full original maintained source for capture/import/workbook")
    parser.add_argument("--node", default="node")
    parser.add_argument("--research-connections", help="Private original named registry")
    parser.add_argument("--playwright", help="Actual installed Playwright ESM entry")
    parser.add_argument("--chromium", help="Actual installed Chromium executable")
    parser.add_argument("--temporary-root", help="Existing private runtime filesystem; Linux default /dev")
    parser.add_argument("--wait-seconds", type=int, default=900)
    commands = parser.add_subparsers(dest="command", required=True)
    receive = commands.add_parser("receive", help="Continue the same saved Research output through browser and complete original workbook receiving")
    receive.add_argument("--selection", required=True, help="Exact reviewed safe source selection JSON")
    finish = commands.add_parser("finish", help="Complete retained browser selection through original exports")
    finish.add_argument("--preview-sha256", required=True)
    reopen = commands.add_parser("reopen", help="Receive the same complete archive with its original IDs")
    reopen.add_argument("--target")
    commands.add_parser("inspect")
    args = parser.parse_args()
    need(1 <= args.wait_seconds <= 3600, "RESEARCH_INTAKE_WAIT_INVALID")
    workflow = IntakeWorkflow(args.directory, checkout=args.checkout, node=args.node,
        research_connections=args.research_connections, playwright=args.playwright,
        chromium=args.chromium, temporary_root=args.temporary_root, wait_seconds=args.wait_seconds)
    try:
        with lock(workflow.root):
            if args.command == "receive":
                reviewed = workflow.intake(selection_file(args.selection))
                complete = workflow.finish(preview_sha256=reviewed["preview_sha256"], allow_incomplete=False)
                reopened = workflow.reopen()
                result = {"schema": SCHEMA, "operation_id": workflow.operation["id"],
                    "browser": workflow.saved("browser-capture"), "complete": complete,
                    "reopen": reopened, "browser_restored": workflow.reopen_browser()}
            elif args.command == "finish":
                complete = workflow.finish(preview_sha256=args.preview_sha256, allow_incomplete=False)
                result = {"complete": complete, "reopen": workflow.reopen(),
                          "browser_restored": workflow.reopen_browser()}
            elif args.command == "reopen":
                result = {"reopen": workflow.reopen(args.target),
                          "browser_restored": workflow.reopen_browser(args.target)}
            else:
                result = {"operation": workflow.read_operation(),
                    "receipts": sorted(path.name for path in workflow.records.glob("*.json"))}
            dump(workflow.root / "result.json", result)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    except (StateError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"ok": False, "error": getattr(error, "code", type(error).__name__),
                          "message": str(error), "directory": str(workflow.root)}, sort_keys=True))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
