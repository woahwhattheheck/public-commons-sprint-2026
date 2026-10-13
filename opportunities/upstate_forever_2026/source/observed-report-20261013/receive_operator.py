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
    args = parser.parse_args()
    if args.course:
        spec = importlib.util.spec_from_file_location(
            "upstate_scientific_report_course", Path(__file__).with_name("receive_course.py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module.run(args, receive, APP, identity)
    return receive(args)


def receive(args):
    """Continue one original operation, including its retained output/task IDs."""
    require(args.timeout > 0 and 1 <= args.upload_limit_gib <= 64,
            "Use positive task time and upload capacity from 1 to 64 GiB.")
    workspace, out = args.workspace.resolve(), args.output.resolve()
    require(not out.is_relative_to(workspace) and not workspace.is_relative_to(out)
            and not out.is_relative_to(APP) and not APP.is_relative_to(out),
            "Keep the original application, Workspace and receiving output in separate trees.")
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
        preview = read("POST", "/api/source-reports/scientific-preview", payload)
        require(preview["workspace_key"] == key
                and [{name: row[name] for name in ("source_collection_id", "source_id")}
                     for row in preview["sources"]] == choices,
                "The preview changed the original ordered scientific sources.")
        saved_preview = out / "report-preview.json"
        if saved_preview.exists():
            stable = lambda value: {name: item for name, item in value.items() if name != "existing"}
            require(stable(read_json(saved_preview)) == stable(preview),
                    "The original scientific preview changed during receiving resume.")
        else:
            atomic_json(saved_preview, preview, immutable=True)
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
            selected_preview = read("POST", "/api/study-transfer/preview", {"selection": selection})
            require(any(row["kind"] == "scientific-report-editions" and row["id"] == edition_id
                        for row in selected_preview["nodes"]),
                    "The selected study preview omitted the original report edition.")
            selection_path = out / "selected-report-selection.json"
            if selection_path.exists():
                retained = read_json(selection_path)
                require({name: value for name, value in retained.items() if name != "preview_token"} == selection,
                        "Resume the original selected report transfer.")
                selection = retained
            else:
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
        checkpoint("complete", receipt=str(out / "scientific-report-receiving.json"),
                   edition_id=edition_id, restored_workspace_key=restored_key)
    except BaseException as error:
        checkpoint("failed", error={"type": type(error).__name__, "message": str(error)})
        raise
    finally:
        operator.close()
    if args.browser_node:
        browser(args, module, workspace, out)
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
