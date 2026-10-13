#!/usr/bin/env python3
"""Operate saved scientific reports, downloads and independent Workspace receiving.

This command uses the application's original registered source import, report,
backup and restore queues. Continue a retained operation with --resume.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import threading
import time
import zipfile

APP = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(APP), str(APP / "operator")]
from model.common import atomic_json, digest, held, read_json, verify_file
from model.workspace import Workspace
from model import scientific_report_editions


def require(value, message):
    if not value:
        raise RuntimeError(message)


def identity(path):
    checksum, size = hashlib.sha256(), 0
    with Path(path).open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            size += len(part)
            checksum.update(part)
    return {"bytes": size, "sha256": checksum.hexdigest()}


def load_operator():
    spec = importlib.util.spec_from_file_location(
        "upstate_scientific_report_operator", APP / "operator/server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", action="append", type=Path,
                        help="Original typed-report manifest; repeat in reading order.")
    source.add_argument("--selection", type=Path,
                        help="JSON with ordered sources, optional title and contact.")
    source.add_argument("--course", type=Path,
                        help="Continue an explicit ordered manifest of original report operations.")
    parser.add_argument("--title")
    parser.add_argument("--contact-json", type=Path)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--selected-study", action="store_true",
                        help="Also export and receive this report with its original editable study history.")
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--upload-limit-gib", type=int, default=4)
    parser.add_argument("--browser-node", type=Path,
                        help="Run the adjacent real browser continuation with this Node interpreter.")
    parser.add_argument("--video", action="store_true")
    parser.add_argument("--assessment-preparation", type=Path,
                        help="Open the completed original assessment preparation in the same browser course.")
    parser.add_argument("--_native-worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    require(not args.assessment_preparation or (args.browser_node and not args.course),
            "The assessment chapter joins one original report browser continuation with --browser-node.")
    require(not args._native_worker or not args.course,
            "The native worker continues one original report operation.")
    if args.course:
        spec = importlib.util.spec_from_file_location(
            "upstate_scientific_report_course", Path(__file__).with_name("receive_course.py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module.run(args, receive, APP, identity)
    return receive(args)


# Native libraries and executor threads cannot be stopped by Future.cancel().
# Keep the existing original operation in one owned process so its deadline also
# bounds shutdown, without changing the shared operator's normal drain behavior.
WORKER_STOP_GRACE = 5.0


def _worker_command(args):
    command = [sys.executable, str(Path(__file__).resolve()), "--_native-worker",
               "--workspace", str(args.workspace.resolve()),
               "--output", str(args.output.resolve()),
               "--timeout", str(args.timeout),
               "--upload-limit-gib", str(args.upload_limit_gib)]
    if args.selection:
        command += ["--selection", str(args.selection.resolve())]
    else:
        for manifest in args.manifest or []:
            command += ["--manifest", str(manifest.resolve())]
    for name, option in (("title", "--title"), ("contact_json", "--contact-json"),
                         ("browser_node", "--browser-node"),
                         ("assessment_preparation", "--assessment-preparation")):
        value = getattr(args, name, None)
        if value is not None:
            command.append(option + "=" + str(value.resolve() if isinstance(value, Path) else value))
    for name, option in (("create_workspace", "--create-workspace"),
                         ("resume", "--resume"), ("selected_study", "--selected-study"),
                         ("video", "--video")):
        if getattr(args, name, False):
            command.append(option)
    return command


def _worker_progress(path, process_id):
    try:
        value = read_json(path)
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) and value.get("process_id") == process_id else None


def _stop_worker(process):
    """Stop only this receiver's process/session, including its own descendants."""
    def signal_worker(force):
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
            elif force:
                process.kill()
            else:
                process.terminate()
        except ProcessLookupError:
            pass
    signal_worker(False)
    try:
        process.wait(timeout=WORKER_STOP_GRACE)
    except subprocess.TimeoutExpired:
        signal_worker(True)
        try:
            process.wait(timeout=WORKER_STOP_GRACE)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("The owned report process did not stop: " + str(process.pid)) from error
    # A native child may outlive the worker or ignore SIGTERM. Its process group
    # was created exclusively for this operation; finish stopping that group.
    if os.name == "posix":
        signal_worker(True)


def _record_worker_interruption(output, process_id, message):
    # The child has exited and released its original operation lock. Do not
    # overwrite a successor that another caller has already resumed.
    if not output.is_dir():
        return
    try:
        with held(output / ".scientific-report-receiving.lock", blocking=False):
            path = output / "receiving-progress.json"
            progress = _worker_progress(path, process_id)
            if progress is None:
                return
            if progress.get("phase") == "failed":
                return  # Preserve the child's exact native exception.
            previous = progress.get("phase")
            progress.update(phase="interrupted", interrupted_phase=previous,
                            error={"type": "TimeoutError", "message": message})
            atomic_json(path, progress)
    except BlockingIOError:
        return


def supervised_receive(args):
    """Run the same retained native receiver with a bounded per-phase lifetime."""
    process = None
    previous_termination = None
    def terminated(number, frame):
        raise SystemExit(128 + number)
    output = args.output.resolve()
    path = output / "receiving-progress.json"
    phase, began, failed_since = None, time.monotonic(), None
    failure = None
    try:
        if threading.current_thread() is threading.main_thread():
            previous_termination = signal.signal(signal.SIGTERM, terminated)
        process = subprocess.Popen(_worker_command(args), start_new_session=os.name == "posix")
        began = time.monotonic()
        while process.poll() is None:
            current = _worker_progress(path, process.pid)
            now = time.monotonic()
            current_phase = ((current.get("phase"), current.get("task_id"))
                             if current is not None else None)
            if current_phase is not None and current_phase != phase:
                phase, began = current_phase, now
            if current is not None and current.get("phase") == "failed":
                if failed_since is None:
                    failed_since, failure = now, current.get("error")
                if now - failed_since >= WORKER_STOP_GRACE:
                    _stop_worker(process)
                    raise RuntimeError("The original report failed and its owned native shutdown "
                                       "did not finish: " + json.dumps(failure, allow_nan=False))
            elif now - began >= args.timeout:
                # Recheck the phase at the deadline before stopping a worker that
                # may just have completed the operation and advanced its receipt.
                latest = _worker_progress(path, process.pid)
                latest_phase = ((latest.get("phase"), latest.get("task_id"))
                                if latest is not None else None)
                if latest_phase != current_phase:
                    continue
                message = ("Resume the original retained report after its " +
                           (str(phase[0]) if phase else "startup") + " phase exceeded " +
                           str(args.timeout) + " seconds; owned process " + str(process.pid))
                _stop_worker(process)
                _record_worker_interruption(output, process.pid, message)
                raise TimeoutError(message)
            time.sleep(0.1)
        return process.returncode
    except BaseException:
        if process is not None and process.poll() is None:
            _stop_worker(process)
        raise
    finally:
        if previous_termination is not None:
            signal.signal(signal.SIGTERM, previous_termination)


def receive(args):
    """Continue one original operation, including its retained output/task IDs."""
    require(args.timeout > 0 and 1 <= args.upload_limit_gib <= 64,
            "Use positive task time and upload capacity from 1 to 64 GiB.")
    workspace, out = args.workspace.resolve(), args.output.resolve()
    require(not out.is_relative_to(workspace) and not workspace.is_relative_to(out)
            and not out.is_relative_to(APP) and not APP.is_relative_to(out),
            "Keep the original application, Workspace and receiving output in separate trees.")
    if not getattr(args, "_native_worker", False):
        return supervised_receive(args)
    if out.exists():
        require(args.resume and out.is_dir(), "Use --resume for the retained receiving output.")
    else:
        require(not args.resume, "The retained output is absent; start this receiving operation first.")
        out.mkdir(parents=True)
    with held(out / ".scientific-report-receiving.lock", blocking=False):
        return operate(args, workspace, out)


def operate(args, workspace, out):
    original = Workspace(workspace, create=args.create_workspace,
                         title="Upper Savannah observed science")
    manifests = [path.resolve(strict=True) for path in (args.manifest or [])]
    supplied = read_json(args.selection.resolve(strict=True)) if args.selection else {}
    require(isinstance(supplied, dict) and set(supplied) <= {"sources", "title", "contact"},
            "Selection JSON accepts the original ordered sources, title and contact.")
    require(not args.selection or isinstance(supplied.get("sources"), list) and supplied["sources"],
            "Provide a nonempty ordered source selection.")
    contact = read_json(args.contact_json.resolve(strict=True)) if args.contact_json else supplied.get("contact")
    title = args.title if args.title is not None else supplied.get("title")
    if title is not None:
        require(isinstance(title, str) and bool(title.strip()), "Enter a nonempty report title.")
    requested = {
        "schema": "upstate.scientific-report-receiving-selection/v1",
        "project_id": original.project["id"], "workspace": str(workspace),
        "manifests": [{"path": str(path), **identity(path)} for path in manifests],
        "sources": supplied.get("sources"), "title": title, "contact": contact,
        "selected_study": args.selected_study,
    }
    request_path = out / "receiving-selection.json"
    if request_path.exists():
        require(read_json(request_path) == requested,
                "Resume with the original sources, order, title, contact and Workspace.")
    else:
        require(not any(path.name != ".scientific-report-receiving.lock" for path in out.iterdir()),
                "The retained output lacks its original source selection.")
        atomic_json(request_path, requested, immutable=True)
    operation = digest(requested)
    progress_path = out / "receiving-progress.json"
    progress = read_json(progress_path) if progress_path.exists() else {
        "schema": "upstate.scientific-report-receiving-progress/v1",
        "operation_id": operation, "tasks": {}}
    require(progress.get("operation_id") == operation, "Reopen the matching receiving checkpoint.")

    def checkpoint(phase, **values):
        progress.update(phase=phase, **values)
        atomic_json(progress_path, progress)
        print(json.dumps({"phase": phase, **values}, sort_keys=True, allow_nan=False), flush=True)

    module = load_operator()
    operator = module.Operator(workspace, out / "operator-state", create=False,
                               source_manifests=manifests,
                               upload_limit=args.upload_limit_gib * 1024**3)
    key = operator.primary
    tasks = {}

    def read(method, path, payload=None, owner=None):
        return operator.extensions.read(method, path, owner or key, payload or {})

    def action(phase, name, payload):
        queued = operator.submit(key, name, payload, "report_receive_" + operation[:24] + "_" + phase)
        progress["tasks"][phase] = {"id": queued["id"], "action": name}
        checkpoint(phase, task_id=queued["id"])
        if args.resume and queued["state"] in {"failed", "interrupted", "cancelled"}:
            operator.resume(queued["id"])
        deadline = time.monotonic() + args.timeout
        while True:
            task = operator.task_view(queued["id"])
            if task["state"] == "complete":
                tasks[phase] = task
                return task
            if task["state"] in {"failed", "interrupted", "cancelled"}:
                raise RuntimeError(json.dumps(task.get("error") or task, allow_nan=False))
            if time.monotonic() >= deadline:
                raise TimeoutError("Resume the original retained report task " + task["id"])
            time.sleep(0.2)

    def download(ticket, name):
        destination = out / name
        expected = {field: ticket[field] for field in ("bytes", "sha256")}
        if destination.exists():
            require(identity(destination) == expected, "Retained download differs: " + name)
            return destination
        stream, record = operator.open_download(ticket["id"])
        temporary = destination.with_name("." + destination.name + ".receiving")
        temporary.unlink(missing_ok=True)
        try:
            require({field: record[field] for field in expected} == expected,
                    "The original file ticket changed: " + name)
            checksum, count = hashlib.sha256(), 0
            with temporary.open("xb") as target:
                for part in iter(lambda: stream.read(1024 * 1024), b""):
                    target.write(part)
                    count += len(part)
                    checksum.update(part)
                target.flush()
                os.fsync(target.fileno())
            require({"bytes": count, "sha256": checksum.hexdigest()} == expected,
                    "The original download changed during transfer: " + name)
            os.link(temporary, destination)
        finally:
            stream.close()
            temporary.unlink(missing_ok=True)
        return destination

    try:
        checkpoint("opening", application=str(APP), workspace_key=key, process_id=os.getpid())
        routes = [
            ("GET", "/api/source-reports/scientific-catalog"),
            ("POST", "/api/source-reports/scientific-preview"),
            ("GET", "/api/source-reports/scientific-edition"),
        ]
        if args.selected_study:
            routes.append(("POST", "/api/study-transfer/preview"))
        require(all(operator.extensions.has_route(*route) for route in routes),
                "Install the complete saved scientific report family before receiving.")
        choices = supplied.get("sources") or []
        if manifests:
            choices = []
            registered = {row["path"]: row for row in operator.registered.values()}
            for index, path in enumerate(manifests):
                preview = operator.preview_source({"registered_id": registered[str(path)]["id"]})
                imported = action("source_%03d" % (index + 1), "source.import",
                                  {"preview_id": preview["id"]})["result"]
                matches = [entry for entry in imported["entries"]
                           if (entry.get("metadata") or {}).get("report_schema") == "upstate.observed-report/v1"]
                require(len(matches) == 1, "Choose one typed report in manifest " + str(path))
                choices.append({"source_collection_id": imported["id"], "source_id": matches[0]["id"]})
        payload = {"sources": choices}
        if title is not None:
            payload["title"] = title
        if contact is not None:
            payload["contact"] = contact
        saved_preview = out / "report-preview.json"
        if saved_preview.exists():
            preview = read_json(saved_preview)
        else:
            preview = read("POST", "/api/source-reports/scientific-preview", payload)
            atomic_json(saved_preview, preview, immutable=True)
        require(preview.get("schema") == "upstate.observed-report-preview/v1"
                and preview.get("workspace_key") == key
                and preview.get("workspace") == str(workspace)
                and preview.get("id") == digest(preview.get("render_identity"))
                and preview.get("operation_id") == "observed-report-" + preview["id"][:20]
                and all(preview.get(name) == preview["render_identity"].get(name)
                        for name in ("title", "selection", "binding", "workspace"))
                and [{name: row[name] for name in ("source_collection_id", "source_id")}
                     for row in preview.get("sources", [])] == choices,
                "The retained preview changed the original scientific report selection.")
        scientific_report_editions.validate_request(original, payload, preview["render_identity"])
        # Submit the exact retained payload. A completed original task reopens
        # directly; a task interrupted after native rendering reconciles that
        # completed edition through the maintained render action.
        rendered = action("render", "source-reports.render", {**payload, "preview_id": preview["id"]})
        edition_id = rendered["result"]["scientific_report_edition_id"]
        require(edition_id == preview["id"], "Rendering changed the prepared scientific identity.")
        before = read("GET", "/api/source-reports/scientific-edition", {"id": edition_id})
        edition = before["edition"]
        require(edition["render_identity"] == preview["render_identity"],
                "The saved report changed the prepared selection.")
        replay = operator.submit(key, "source-reports.render", {**payload, "preview_id": preview["id"]},
                                 "report_receive_" + operation[:24] + "_render")
        require(replay["id"] == rendered["id"] and replay["state"] == "complete",
                "The completed report did not reopen the original queued operation.")
        copied = {}
        for ticket in before["_downloads"]:
            if ticket["label"] in {"report_pdf", "report_html", "report_markdown", "report_data"}:
                path = download(ticket, ticket["filename"])
                copied[ticket["label"]] = {"path": str(path), **identity(path)}
        require({"report_pdf", "report_html", "report_markdown", "report_data"} <= copied.keys(),
                "The original report omitted a complete PDF, HTML, Markdown or data export.")
        zipped = action("report_zip", "source-reports.export", {"id": edition_id})
        complete = read("GET", "/api/source-reports/scientific-edition", {"id": edition_id})
        report_archive = download(complete["archive"], "scientific-report.zip")
        files = {row["path"]: row for row in complete["files"]}
        with zipfile.ZipFile(report_archive) as archive:
            require(set(archive.namelist()) == set(files) and len(archive.namelist()) == len(files),
                    "The report ZIP changed the original complete file set.")
            for name, expected in files.items():
                checksum, count = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    for part in iter(lambda: stream.read(1024 * 1024), b""):
                        count += len(part)
                        checksum.update(part)
                require(count == expected["bytes"] and checksum.hexdigest() == expected["sha256"],
                        "The report ZIP changed original member " + name)
        backup = action("backup", "workspace.backup", {"include_intermediates": True})
        tickets = backup.get("_downloads") or []
        require(len(tickets) == 1, "The original Workspace backup must expose its complete archive.")
        archive_path = download(tickets[0], "scientific-report-workspace.zip")
        with archive_path.open("rb") as stream:
            upload = operator.receive_upload(stream, archive_path.stat().st_size,
                                             archive_path.name, "application/zip")
        restored_task = action("restore", "workspace.restore", {"upload_id": upload["id"]})
        restored_key = restored_task["result"]["workspace_key"]
        restored = operator.ws(restored_key)
        require(restored.project == original.project, "Receiving changed the original project identity.")
        after = read("GET", "/api/source-reports/scientific-edition", {"id": edition_id}, restored_key)
        require(after["edition"] == edition, "Reopening changed the original saved report edition.")
        require(after["edition"]["render_identity"]["workspace"] == str(workspace),
                "Receiving rewrote the original authoring Workspace in the scientific identity.")
        catalog = read("GET", "/api/source-reports/scientific-catalog", owner=restored_key)
        require(any(row["id"] == edition_id for row in catalog["editions"]),
                "The received Sources desk cannot reopen its retained edition.")
        for descriptor in edition["files"].values():
            verify_file(restored.root / "scientific-report-editions" / edition_id, descriptor)
        restored_roles = {ticket["label"]: ticket for ticket in after["_downloads"]}
        for role, expected in copied.items():
            require(all(restored_roles[role][field] == expected[field] for field in ("bytes", "sha256")),
                    "The receiving file ticket changed " + role)
        selected_receiving = None
        if args.selected_study:
            selection = {"title": edition["title"] + " — editable scientific study",
                         "roots": [{"kind": "scientific-report-editions", "id": edition_id}],
                         "include_related_results": True}
            selection_path = out / "selected-report-selection.json"
            if selection_path.exists():
                retained = read_json(selection_path)
                require({name: value for name, value in retained.items() if name != "preview_token"} == selection,
                        "Resume the original selected report transfer.")
                selection = retained
            else:
                selected_preview = read("POST", "/api/study-transfer/preview", {"selection": selection})
                require(any(row["kind"] == "scientific-report-editions" and row["id"] == edition_id
                            for row in selected_preview["nodes"]),
                        "The selected study preview omitted the original report edition.")
                selection["preview_token"] = selected_preview["preview_token"]
                atomic_json(selection_path, selection, immutable=True)
            exported = action("selected_export", "study.export", selection)
            retained = exported["result"]["study"]["identity"]
            require(any(row["id"] == edition_id and row["source_choices"] == choices
                        for row in retained.get("scientific_report_editions", [])),
                    "The selected study archive omitted the ordered original report.")
            selected_tickets = exported.get("_downloads") or []
            require(len(selected_tickets) == 1, "The selected study needs its original complete archive.")
            selected_archive = download(selected_tickets[0], "selected-scientific-report-study.zip")
            with selected_archive.open("rb") as stream:
                selected_upload = operator.receive_upload(stream, selected_archive.stat().st_size,
                                                          selected_archive.name, "application/zip")
            selected_task = action("selected_restore", "workspace.restore", {"upload_id": selected_upload["id"]})
            selected_key = selected_task["result"]["workspace_key"]
            selected_workspace = operator.ws(selected_key)
            require(selected_workspace.project == original.project,
                    "Selected report receiving changed its original project identity.")
            selected_detail = read("GET", "/api/source-reports/scientific-edition",
                                   {"id": edition_id}, selected_key)
            require(selected_detail["edition"] == edition,
                    "Selected study receiving changed the original scientific edition.")
            selected_receiving = {
                "study_id": exported["result"]["id"], "workspace_key": selected_key,
                "workspace": str(selected_workspace.root), "edition_id": edition_id,
                "archive": {"path": str(selected_archive), **identity(selected_archive)},
                "original_nodes": retained["nodes"],
                "scientific_report_editions": retained["scientific_report_editions"],
            }
        outcome = {
            "schema": "upstate.scientific-report-receiving-workflow/v1",
            "state": "complete", "operation_id": operation, "project_id": original.project["id"],
            "edition_id": edition_id, "title": edition["title"], "sources": choices,
            "render_identity": edition["render_identity"], "edition": edition,
            "original_workspace": str(workspace), "original_workspace_key": key,
            "restored_workspace": str(restored.root), "restored_workspace_key": restored_key,
            "operator_state": str(out / "operator-state"), "application": str(APP),
            "selected_study_receiving": selected_receiving,
            "report_files": copied, "report_archive": {"path": str(report_archive), **identity(report_archive)},
            "workspace_archive": {"path": str(archive_path), **identity(archive_path)},
            "tasks": {phase: {"id": task["id"], "action": task["action"], "state": task["state"]}
                      for phase, task in tasks.items()},
            "browser_handoff": {"view": "sources", "workspace_key": restored_key,
                                "edition_id": edition_id, "sources": choices},
        }
        atomic_json(out / "scientific-report-receiving.json", outcome)
        checkpoint("closing", receipt=str(out / "scientific-report-receiving.json"),
                   edition_id=edition_id, restored_workspace_key=restored_key)
    except BaseException as error:
        checkpoint("failed", error={"type": type(error).__name__, "message": str(error)})
        raise
    finally:
        operator.close()
    if args.browser_node:
        checkpoint("browser", receipt=str(out / "scientific-report-receiving.json"))
        try:
            browser(args, module, workspace, out)
        except BaseException as error:
            checkpoint("failed", error={"type": type(error).__name__, "message": str(error)})
            raise
    checkpoint("complete", receipt=str(out / "scientific-report-receiving.json"),
               edition_id=edition_id, restored_workspace_key=restored_key)
    return 0


def browser(args, module, workspace, out):
    server, receipt = module.start_server(workspace, state_directory=out / "operator-state",
                                          upload_limit=args.upload_limit_gib * 1024**3)
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    private_url = out / ".operator-url"
    try:
        descriptor = os.open(private_url, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            target.write(receipt["operator_url"] + "\n")
        serving.start()
        command = [str(args.browser_node.resolve(strict=True)),
                   str(Path(__file__).with_name("receive_browser.mjs")),
                   "--url-file", str(private_url),
                   "--receiving-receipt", str(out / "scientific-report-receiving.json"),
                   "--output", str(out / "browser")]
        if getattr(args, "assessment_preparation", None):
            command += ["--assessment-preparation", str(args.assessment_preparation.resolve(strict=True))]
        if args.video:
            command.append("--video")
        subprocess.run(command, check=True, timeout=args.timeout)
    finally:
        if serving.is_alive():
            server.shutdown()
            serving.join()
        server.server_close()
        server.operator.close()
        private_url.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
