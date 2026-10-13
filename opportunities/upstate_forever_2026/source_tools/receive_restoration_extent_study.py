#!/usr/bin/env python3
"""Operate one authored restoration extent study through its original local queue.

This programme consumes real retained inputs. It has no fixture, model substitute,
worker scheduler, or automatic scientific parameter selection.
"""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import zipfile

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "operator"))
from model.common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                          file_digest, held, read_json, verify_file)
from model.workspace import Workspace
from model import portable, restoration_extent_studies as engine
from restoration_extent_cli import Client, selection, submit, wait_task, run_study

SCHEMA = "upstate.restoration-extent-original-course/v1"
EXCLUDED = {".git", "__pycache__", ".pytest_cache", "node_modules"}

def source_manifest(application):
    rows = []
    for path in sorted(application.rglob("*")):
        relative = path.relative_to(application)
        if any(part in EXCLUDED for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError("Select an ordinary immutable application copy: " + str(relative))
        if path.is_file():
            rows.append({"path": relative.as_posix(), "bytes": path.stat().st_size,
                         "sha256": file_digest(path)})
    return rows

def disjoint(*roots):
    for index, first in enumerate(roots):
        for second in roots[index+1:]:
            if first == second or first.is_relative_to(second) or second.is_relative_to(first):
                raise ValueError("Keep source, original Workspace and course output in separate directories.")

def keep(path, value):
    atomic_json(path, value, immutable=True)
    return value

def task_step(client, output, operation, label, action, payload):
    request = selection(client, action, payload,
                        "extent-" + digest({"operation": operation, "label": label}))
    task = submit(client, request, output / "journal")
    completed = wait_task(client, task, output / "journal")
    # Reconcile the exact same original operation after its returned completion.
    replay = submit(client, request, output / "journal")
    if (replay["id"] != completed["id"] or replay["state"] != "complete"
            or replay["result"] != completed["result"]):
        raise ValueError("Original task replay differs from its retained completed operation.")
    keep(output / (label + ".json"), completed)
    return completed

def cold_verify(application, workspace_path, study_id, expected, output):
    """Open the actual received Workspace with the actual received model source."""
    program = (
        "import json,sys; from pathlib import Path; "
        "sys.path.insert(0,sys.argv[1]); "
        "from model.workspace import Workspace; "
        "from model.restoration_extent_studies import inspect_study; "
        "from model.common import atomic_json; "
        "atomic_json(Path(sys.argv[4]),inspect_study(Workspace(sys.argv[2]),sys.argv[3]))"
    )
    process = subprocess.run([sys.executable, "-B", "-c", program, str(application),
                              str(workspace_path), study_id, str(output)], check=False,
                             capture_output=True, text=True)
    atomic_bytes(output.with_suffix(".stdout.txt"), process.stdout.encode())
    atomic_bytes(output.with_suffix(".stderr.txt"), process.stderr.encode())
    if process.returncode:
        raise RuntimeError("The original received model could not reopen its complete study; inspect the retained stderr.")
    value = read_json(output)
    if value != expected:
        raise ValueError("Received source-bound study, run states or native report differ.")
    return value

def verify_result(root, result):
    if result.get("schema") != SCHEMA or result.get("state") != "complete":
        raise ValueError("The retained course completion is not complete.")
    for item in result["outputs"].values():
        verify_file(root, item)
    archive = verify_file(root, result["outputs"]["case"])
    with zipfile.ZipFile(archive) as original:
        manifest = json.loads(original.read("case-manifest.json"))
        for path, expected in manifest["members"].items():
            with original.open(path) as stream:
                h = hashlib.sha256(); count = 0
                for block in iter(lambda: stream.read(1024*1024), b""):
                    h.update(block); count += len(block)
            if count != expected["bytes"] or h.hexdigest() != expected["sha256"]:
                raise ValueError("A completed case member differs: " + path)
    return result

def archive_case(output, names):
    destination = output / "Complete_Restoration_Operated_Case.zip"
    members = {}
    for name in names:
        path = output / name
        if path.is_dir():
            for child in sorted(path.rglob("*")):
                if child.is_file() and not child.is_symlink():
                    members[child.relative_to(output).as_posix()] = describe_file(output, child)
        elif path.is_file():
            members[name] = describe_file(output, path)
    manifest = {"schema": "upstate.restoration-extent-operated-case/v1", "members": members}
    if destination.exists():
        with zipfile.ZipFile(destination) as retained:
            if json.loads(retained.read("case-manifest.json")) != manifest:
                raise ValueError("The completed operated case differs; preserve its original artifacts.")
        return destination
    temporary = output / ".Complete_Restoration_Operated_Case.partial"
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for relative in members:
            archive.write(output / relative, relative)
        archive.writestr("case-manifest.json", canonical(manifest) + b"\n")
    os.replace(temporary, destination)
    return destination

@contextlib.contextmanager
def received_server(application, workspace, private, output):
    """One source-native receiver. Its process owns only the cold received copy."""
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    connection = private / "connection.json"
    port_file = private / "port.json"
    port = read_json(port_file)["port"] if port_file.exists() else 0
    # Execute the received original server, not the donor imported module graph.
    log = (private / "server.stderr.log").open("ab")
    process = subprocess.Popen([sys.executable, "-B", str(application / "operator/server.py"),
        "--workspace", str(workspace), "--operator-state", str(private / "operator-state"),
        "--port", str(port)], stdout=subprocess.PIPE, stderr=log)
    try:
        if process.stdout is None:
            raise RuntimeError("Original received server has no startup return.")
        import selectors
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        try:
            if not selector.select(60):
                raise RuntimeError("Original received server startup did not return; preserve its log.")
            line = process.stdout.readline()
        finally:
            selector.close()
        if not line:
            raise RuntimeError("Original received server ended before its startup receipt.")
        receipt = json.loads(line)
        from urllib.parse import urlsplit
        keep(port_file, {"port": urlsplit(receipt["origin"]).port})
        atomic_json(connection, receipt)
        os.chmod(connection, 0o600)
        yield connection
    finally:
        if process.poll() is None:
            process.terminate()
            # The original server drains its actual queue before releasing its lease.
            process.wait()
        code = process.returncode
        log.close()
        atomic_json(private / "closed.json", {"returncode": code, "pid": process.pid})
        if code not in (0, -signal.SIGTERM):
            raise RuntimeError("Original received server did not close cleanly; its private log is retained.")

def browse(args, output, original_connection, receiving_connection, configuration):
    config_path = output / "Browser_Continuation.json"
    # Connection capabilities live outside the deliverable. Only stable IDs are frozen here.
    keep(config_path, configuration)
    finished = output / "browser" / "result.json"
    if finished.exists():
        result = read_json(finished)
        if result.get("state") != "complete" or result.get("selection_sha256") != file_digest(config_path):
            raise ValueError("The retained browser course belongs to another selected study.")
        for item in result["files"]:
            verify_file(output / "browser", item)
        return result
    command = [args.node, str(APP / "source_tools/restoration_extent_browser.mjs"),
               "--config", str(config_path), "--author-connection", str(original_connection),
               "--receiver-connection", str(receiving_connection), "--output", str(output / "browser"),
               "--browser", args.browser, "--playwright", args.playwright,
               "--profile", str(output / "private/browser-profile")]
    with (output / "browser.stdout.log").open("ab") as stdout, (output / "browser.stderr.log").open("ab") as stderr:
        process = subprocess.Popen(command, stdout=stdout, stderr=stderr)
        try:
            code = process.wait()
        except BaseException:
            if process.poll() is None:
                process.terminate()
                process.wait()
            raise
    if code:
        raise RuntimeError("The original browser course returned a failure; inspect its retained log.")
    result = read_json(finished)
    if result.get("state") != "complete" or result.get("selection_sha256") != file_digest(config_path):
        raise ValueError("The browser did not complete the exact original study selection.")
    for item in result["files"]:
        verify_file(output / "browser", item)
    return result

def run(args):
    application = APP.resolve()
    workspace_root = args.workspace_root.resolve(strict=True)
    output = args.output.resolve()
    disjoint(application, workspace_root, output)
    source = source_manifest(application)
    raw = args.definition.resolve(strict=True).read_bytes()
    authored = json.loads(raw)
    workspace = Workspace(workspace_root)
    workspace_key = digest({"directory": str(workspace_root)})
    if isinstance(authored, dict) and authored.get("schema") == "upstate.restoration-extent-working/v1":
        if (authored.get("project_id") != workspace.project["id"]
                or authored.get("workspace") != workspace_key):
            raise ValueError("The complete working copy belongs to another original project or operator.")
        if authored.get("pending"):
            raise ValueError("Reconcile the exact pending request in the original desk before starting this course.")
        definition = authored.get("spec")
        if authored.get("friendly_error"):
            raise ValueError("Complete the retained source-field selection before preparing the native study.")
    else:
        definition = authored
    if not isinstance(definition, dict) or definition.get("schema") != "upstate.restoration-extent-study-input/v1":
        raise ValueError("Use the actual authored definition or complete original desk working file.")
    binding = {"schema": SCHEMA, "operation": args.operation, "project": workspace.project,
        "workspace_key": workspace_key, "definition_file_sha256": hashlib.sha256(raw).hexdigest(),
        "definition_sha256": digest(definition), "application_source_sha256": digest(source)}
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".restoration-course.lock", blocking=False):
        keep(output / "binding.json", binding)
        keep(output / "Application_Source_Manifest.json", source)
        atomic_bytes(output / "Original_Authored_Definition.json", raw, immutable=True)
        done = output / "result.json"
        if done.exists():
            completed = verify_result(output, read_json(done))
            if completed["binding"] != binding:
                raise ValueError("The complete result belongs to another original course.")
            return completed
        operator = Client(args.connection)
        if operator.workspace != workspace_key:
            raise ValueError("The existing connection selects another original Workspace.")
        catalog = operator.query("/api/restoration-extents/catalog")
        if catalog["project"] != workspace.project:
            raise ValueError("The operator's actual project differs from the selected original source.")
        prepared = task_step(operator, output, args.operation, "prepare", "restoration-extent.prepare", {"spec": definition})
        study_id = prepared["result"]["id"]
        current = operator.query("/api/restoration-extents/inspect", id=study_id)
        if current["record"] != prepared["result"]:
            raise ValueError("The saved study differs from the original preparation result.")
        keep(output / "Prepared_Original_Study.json", current["record"])
        field_preview = operator.query("/api/restoration-extents/source-fields", **{k: v for k, v in definition["stream_source"].items() if k != "where"})
        keep(output / "Original_Stream_Field_Preview.json", field_preview)
        prepare_result = {"schema": SCHEMA, "state": "prepared", "binding": binding,
                          "study_id": study_id, "execution_run_ids": current["record"]["execution_run_ids"]}
        atomic_json(output / "prepared-result.json", prepare_result)
        if args.phase == "prepare":
            return prepare_result
        if not all((args.node, args.browser, args.playwright)):
            raise ValueError("The complete course needs the existing Node, Chromium and Playwright paths.")
        native_path = output / "Native_Run_Receipts.json"
        if native_path.exists():
            native = read_json(native_path)
            if native["study_id"] != study_id or any(
                    workspace.inspect_run(row["run_id"])["state"] != "complete" for row in native["runs"]):
                raise ValueError("Retained native completion differs from the selected original study.")
        else:
            native = run_study(operator, study_id, output / "journal", args.operation)
            keep(native_path, native)
        report_task = task_step(operator, output, args.operation, "response", "restoration-extent.report", {"study_id": study_id})
        report = operator.query("/api/restoration-extents/report", id=study_id)["report"]
        if report["id"] != report_task["result"]["id"]:
            raise ValueError("The selected native response differs from the completed report task.")
        exports = {}
        for ticket in report["_downloads"]:
            path = output / "reports" / ticket["filename"]
            operator.download(ticket, path)
            exports[ticket["artifact_id"]] = describe_file(output, path)
        if "readable_report" not in exports:
            raise ValueError("The exact readable native report is absent from the original report operation.")
        current = operator.query("/api/restoration-extents/inspect", id=study_id)
        keep(output / "Completed_Original_Study.json", current)
        backup_task = task_step(operator, output, args.operation, "workspace", "workspace.backup", {"include_intermediates": True})
        tickets = backup_task.get("_downloads", [])
        selected = [t for t in tickets if t["sha256"] == backup_task["result"]["sha256"]]
        if len(selected) != 1:
            raise ValueError("The original completed Workspace backup has no unique exact download.")
        archive = output / "Complete_Restoration_Workspace.zip"
        operator.download(selected[0], archive)
        received = output / "received"
        result = (portable.resume_restore(archive, received, expected_archive_sha256=file_digest(archive))
                  if received.exists() else portable.restore(archive, received))
        keep(output / "Original_Receiving_Result.json", {k: v for k, v in result.items() if k != "reused_completed_output"})
        receiver_source, receiver_workspace = Path(result["application"]), Path(result["workspace"])
        cold_verify(receiver_source, receiver_workspace, study_id,
                    {k: v for k, v in current.items() if k != "workspace_key"},
                    output / "Received_Original_Study.json")
        browser_config = {"schema": "upstate.restoration-extent-browser/v1",
            "operation": args.operation, "project_id": workspace.project["id"], "study_id": study_id,
            "definition": definition, "study": current["record"], "report": report_task["result"],
            "binding": binding, "report_files": exports,
            "report_request": selection(operator, "restoration-extent.report", {"study_id": study_id},
                "extent-" + digest({"operation": args.operation, "label": "response"})),
            "author_workspace": operator.workspace,
            "receiver_workspace": digest({"directory": str(receiver_workspace.resolve())})}
        if (output / "browser/result.json").exists():
            browser = browse(args, output, args.connection.resolve(), output / "private/connection.json", browser_config)
        else:
            with received_server(receiver_source, receiver_workspace, output / "private", output) as receiver_connection:
                browser = browse(args, output, args.connection.resolve(), receiver_connection, browser_config)
        names = ["binding.json", "Application_Source_Manifest.json", "Original_Authored_Definition.json",
                 "Prepared_Original_Study.json", "Original_Stream_Field_Preview.json",
                 "Native_Run_Receipts.json", "Completed_Original_Study.json",
                 "Original_Receiving_Result.json", "Received_Original_Study.json",
                 "Complete_Restoration_Workspace.zip", "Browser_Continuation.json",
                 "journal", "reports", "browser", "prepare.json", "response.json", "workspace.json"]
        case = archive_case(output, names)
        outputs = {**exports, "workspace": describe_file(output, archive),
                   "case": describe_file(output, case),
                   "browser": describe_file(output, output / "browser/result.json")}
        completed = {"schema": SCHEMA, "state": "complete", "binding": binding,
            "study_id": study_id, "report_id": report["id"], "analysis_id": report["analysis_id"],
            "execution_run_ids": current["record"]["execution_run_ids"],
            "outputs": outputs, "receiver_identity": result["identity"],
            "native_source": "original retained Workspace / selected InVEST models",
            "browser_inspection": browser["state"]}
        atomic_json(done, completed, immutable=True)
        return verify_result(output, completed)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", type=Path, required=True, help="Private existing operator startup JSON")
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--definition", type=Path, required=True, help="Scientist-authored exact original study definition")
    parser.add_argument("--operation", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", choices=["prepare", "complete"], required=True)
    parser.add_argument("--node")
    parser.add_argument("--browser")
    parser.add_argument("--playwright")
    args = parser.parse_args()
    import re
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", args.operation):
        parser.error("Use the same stable original course operation ID.")
    result = run(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
