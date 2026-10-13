#!/usr/bin/env python3
"""Continue the completed Conservation browser journey through the original editor.

Use the same original operator receipt and conservation-browser receiving.json.
Explicit land-cover codes/reason define this receiving alternative. The script
prepares the already-saved plan, opens its original embedded Scenario Design
project, creates/reopens one named alternative, downloads the complete native
handover, receives that ZIP through the real binary upload and original queue,
then reloads its saved scenario and optional prepared run. It captures the complete
Workspace through its existing backup form, receives that original archive into
an independent Workspace, and reopens the exact editor Store project/revision,
alternative and native records captured in the archive. Native execution stays
with the existing run owner.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import math
from pathlib import Path
import sqlite3
import time
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
import zipfile

from conservation_browser_receiving import file_record, read_json, require

SCHEMA = "upstate.conservation-design-browser-receiving/v1"


def body_identity(value):
    """Retain the original SQLite TEXT/BLOB distinction and complete body bytes."""
    require(isinstance(value, (str, bytes)), "Keep the original editor body as TEXT or BLOB.")
    raw = value.encode("utf-8") if isinstance(value, str) else value
    return {"body_bytes": len(raw), "body_sha256": hashlib.sha256(raw).hexdigest(),
            "body_storage": "text" if isinstance(value, str) else "blob"}


def captured_editor(archive_path, output, project_id, alternative_id, expected_baseline):
    """Read the exact original Store record from the retained Workspace snapshot."""
    member = "workspace/conservation-design/editor/projects.sqlite"
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("ARCHIVE.json"))
        require(manifest.get("schema") == "upstate.scientific-workspace-archive/v1",
                "Use the original full scientific Workspace archive.")
        expected = manifest.get("members", {}).get(member)
        snapshot = manifest.get("database_snapshots", {}).get(member)
        require(isinstance(expected, dict) and isinstance(snapshot, dict),
                "The archive must retain the original editor database and its snapshot record.")
        require(snapshot.get("method") in ("sqlite-online-backup", "verified-frozen-snapshot"),
                "The editor database must use the original committed SQLite snapshot path.")
        require(not any(member + suffix in manifest["members"] for suffix in ("-wal", "-shm", "-journal")),
                "The original editor snapshot must be self-contained.")
        database = output / "captured-editor.sqlite"
        pending = database.with_suffix(".sqlite.pending")
        digest = hashlib.sha256()
        size = 0
        try:
            with archive.open(member) as source, pending.open("wb") as target:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(block)
                    digest.update(block)
                    size += len(block)
            require(size == expected["bytes"] and digest.hexdigest() == expected["sha256"],
                    "The captured original editor database differs from its archive member identity.")
            pending.replace(database)
        finally:
            pending.unlink(missing_ok=True)
    uri = database.resolve().as_uri() + "?mode=ro&immutable=1"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        row = connection.execute("SELECT title,revision,updated,body FROM projects WHERE id=?", (project_id,)).fetchone()
        require(row is not None, "The original prepared editor project is absent from the captured Store.")
        title, revision, updated, body = row
        database_projects = [item[0] for item in connection.execute("SELECT id FROM projects ORDER BY id")]
        current_identity = {"title": title, "revision": revision, "updated": updated, **body_identity(body)}
        project = json.loads(body)
        history_body = connection.execute(
            "SELECT body FROM revisions WHERE project_id=? AND revision=?", (project_id, revision)).fetchone()
        require(history_body is not None and json.loads(history_body[0]) == project,
                "The captured current project differs from its original saved revision.")
        history = [{"revision": item[0], "saved_at": item[1], "bytes": item[2]} for item in
                   connection.execute(
                       "SELECT revision,saved,LENGTH(body) FROM revisions WHERE project_id=? ORDER BY revision DESC",
                       (project_id,))]
    require(project.get("id") == project_id and project.get("baseline") == expected_baseline,
            "The captured project changed its original saved-plan geometry or project identity.")
    alternatives = [row for row in project.get("alternatives", []) if row.get("id") == alternative_id]
    require(len(alternatives) == 1, "The exact received alternative is absent from the captured original project.")
    return {
        "manifest_project": manifest["project"],
        "database_member": member, "database": file_record(database),
        "database_snapshot": snapshot,
        "editor": {"revision": revision, "project": project},
        "history": history, "alternative": alternatives[0],
        "database_projects": database_projects, "current_identity": current_identity,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-receipt", required=True, type=Path)
    parser.add_argument("--conservation-receiving", required=True, type=Path)
    parser.add_argument("--from-codes", required=True, nargs="+", type=int)
    parser.add_argument("--to-code", required=True, type=int)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--alternative-title", default="Saved portfolio land-cover alternative")
    parser.add_argument("--exclude-feature-key",
                        help="Optional exact original editor feature key to exclude from this alternative.")
    parser.add_argument("--geometry-role", default="reporting_units",
                        choices=("reporting_units", "whole_units", "reporting_union", "whole_unit_union"))
    parser.add_argument("--grid-id")
    parser.add_argument("--profile-id")
    parser.add_argument("--models", nargs="+", choices=("ndr", "sdr"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--task-timeout", type=float, default=300)
    parser.add_argument("--record-video", action="store_true")
    parser.add_argument("--selected-study", action="store_true",
                        help="Continue the same saved design through selected Study export and independent receiving.")
    args = parser.parse_args()
    require(math.isfinite(args.task_timeout) and args.task_timeout > 0, "Use a finite positive task timeout.")
    require(len(set(args.from_codes)) == len(args.from_codes), "Use unique explicit original land-cover codes.")
    require(args.reason.strip() and len(args.reason) <= 5000, "Supply the intended land-cover change reason.")
    require(args.alternative_title.strip() and len(args.alternative_title) <= 180, "Use a nonempty alternative title of at most 180 characters.")
    require(bool(args.grid_id) == bool(args.profile_id), "Select both the original grid and profile, or neither.")
    require(not args.models or args.grid_id, "Native model names require an original grid and profile.")
    require(not args.models or len(set(args.models)) == len(args.models), "Select unique original native model names.")

    original = read_json(args.conservation_receiving)
    connection = read_json(args.operator_receipt)
    require(original.get("schema") == "upstate.conservation-browser-receiving/v1"
            and original.get("state") == "complete" and original.get("plan_id"),
            "Continue a completed original Conservation browser receiving result.")
    workspace, plan_id, study_id = original["workspace_key"], original["plan_id"], original["study_id"]
    require(connection.get("workspace_key") == workspace, "Use the original plan's operator Workspace.")
    parsed = urlsplit(connection["operator_url"])
    require(parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1"),
            "Use the local original operator startup receipt.")
    capability = parse_qs(parsed.fragment).get("token", [None])[0]
    require(capability, "The private startup receipt needs its original operator capability.")
    origin = parsed.scheme + "://" + parsed.netloc
    choice = {"workspace_key": workspace, "plan_id": plan_id, "study_id": study_id,
              "geometry_role": args.geometry_role, "from_codes": args.from_codes, "to_code": args.to_code,
              "reason": args.reason.strip(), "alternative_title": args.alternative_title.strip(),
              "exclude_feature_key": args.exclude_feature_key,
              "prepare_run": ({"grid_id": args.grid_id, "profile_id": args.profile_id,
                               **({"models": args.models} if args.models else {})} if args.grid_id else None)}
    fingerprint = hashlib.sha256(json.dumps(choice, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    alternative_title = args.alternative_title.strip() + " [" + fingerprint[:12] + "]"
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "receiving.json"
    report = read_json(report_path) if report_path.exists() else {
        "schema": SCHEMA, "selection": choice, "selection_sha256": fingerprint,
        "original_conservation_receiving": file_record(args.conservation_receiving),
        "state": "ready", "task_ids": {}, "pending_operations": {},
        "design_alternative_title": alternative_title,
        "screenshots": [], "console_errors": [], "page_errors": [],
    }
    require(report.get("schema") == SCHEMA and report.get("selection_sha256") == fingerprint
            and report.get("selection") == choice,
            "Use a different output directory for another original plan or design selection.")

    def clean(value):
        return str(value).replace(capability, "[private capability]")

    def persist():
        temporary = report_path.with_suffix(".json.tmp")
        temporary.write_text(clean(json.dumps(report, ensure_ascii=False, indent=2)) + "\n", encoding="utf-8")
        temporary.replace(report_path)

    def complete_output():
        print(clean(json.dumps({"state": report["state"], "plan_id": plan_id, "study_id": study_id,
              "preparation_id": report.get("preparation_id"), "receiving_id": report.get("receiving_id"),
              "scenario_id": report.get("scenario_id"), "run_id": report.get("run_id"),
              "handover": report.get("handover"),
              "restored_workspace": report.get("workspace_transfer", {}).get("workspace_key"),
              "captured_editor_revision": report.get("workspace_transfer", {}).get("captured_editor", {}).get("revision"),
              "workspace_archive": report.get("workspace_transfer", {}).get("archive"),
              "selected_study_transfer": report.get("selected_study_transfer"),
              "receiving_path": str(report_path)})), flush=True)

    if (report["state"] == "complete" and report.get("workspace_transfer", {}).get("state") == "complete"
            and (not args.selected_study or report.get("selected_study_transfer", {}).get("state") == "complete")):
        for field in ("editable_project", "handover"):
            expected = report[field]
            actual = file_record(expected["path"])
            require(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"],
                    "The retained original " + field + " changed.")
        for field in ("archive",):
            expected = report["workspace_transfer"][field]
            require(file_record(expected["path"]) == expected, "The retained complete Workspace archive changed.")
        if args.selected_study:
            for field in ("archive", "captured_record"):
                expected = report["selected_study_transfer"][field]
                require(file_record(expected["path"]) == expected,
                        "The retained selected Study " + field + " changed.")
        complete_output()
        return

    from playwright.sync_api import sync_playwright, expect

    if report.get("error"):
        report.setdefault("earlier_attempts", []).append({
            "state": report["state"], "error": report["error"],
            "console_errors": report.get("console_errors", []), "page_errors": report.get("page_errors", [])})
    report.update(state="running", receiving_workflow_version=3, console_errors=[], page_errors=[])
    report.pop("error", None)
    persist()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True)
        options = {"viewport": {"width": 1880, "height": 1160}, "accept_downloads": True, "locale": "en-US"}
        if args.record_video:
            options.update(record_video_dir=str(output / "video"),
                           record_video_size={"width": 1880, "height": 1160})
        context = browser.new_context(**options)
        page = context.new_page()
        page.set_default_timeout(45000)
        video = page.video if args.record_video else None
        page.on("pageerror", lambda error: report["page_errors"].append(clean(error)))
        page.on("console", lambda message: report["console_errors"].append(clean(message.text))
                if message.type == "error" else None)

        request_scope = None

        def request_record(request):
            if request.method != "POST" or urlsplit(request.url).path != "/api/actions":
                return
            value = request.post_data_json
            if (isinstance(value, dict) and value.get("workspace") == workspace
                    and value.get("action") in ("conservation.design.prepare", "conservation.design.receive",
                                              "workspace.backup", "workspace.restore", "study.export")):
                report["pending_operations"][request_scope or value["action"]] = value
                persist()

        page.on("request", request_record)

        def api(path, value=None, **query):
            query.setdefault("workspace", workspace)
            url = origin + path + "?" + urlencode(query)
            headers = {"Authorization": "Bearer " + capability}
            response = (context.request.get(url, headers=headers, timeout=45000) if value is None else
                        context.request.post(url, headers=headers, data=value, timeout=45000))
            body = response.json()
            if not response.ok:
                message = body.get("error", {}).get("message") if isinstance(body, dict) else None
                raise ValueError(message or "Original operator request failed.")
            return body

        def task(task_id, expected_action):
            deadline = time.monotonic() + args.task_timeout
            resumed = False
            while True:
                value = api("/api/task", id=task_id)
                require(value.get("workspace") == workspace and value.get("action") == expected_action,
                        "The retained task belongs to another original Workspace operation.")
                if value["state"] == "complete":
                    return value
                if value["state"] == "interrupted" and not resumed:
                    api("/api/task/resume", {"id": task_id})
                    resumed = True
                elif value["state"] in ("failed", "cancelled", "interrupted"):
                    raise ValueError("Original task " + task_id + ": " + json.dumps(value.get("error") or value["state"]))
                if time.monotonic() >= deadline:
                    raise TimeoutError("Original task remains active: " + task_id)
                time.sleep(1)

        def action(control, expected_action, report_key, pending_key=None):
            existing = report["task_ids"].get(report_key)
            if existing:
                return task(existing, expected_action)
            request = report["pending_operations"].get(pending_key or expected_action)
            if request:
                submitted = api("/api/actions", request)
            else:
                with page.expect_response(lambda response: urlsplit(response.url).path == "/api/actions"
                                          and response.request.method == "POST") as pending:
                    control.click()
                response = pending.value
                submitted = response.json()
                require(response.status == 202, json.dumps(submitted.get("error") or submitted))
            require(submitted.get("id") and submitted.get("action") == expected_action
                    and submitted.get("workspace") == workspace, "The browser submitted a different operation.")
            report["task_ids"][report_key] = submitted["id"]
            persist()
            return task(submitted["id"], expected_action)

        def screenshot(filename):
            path = output / filename
            page.screenshot(path=str(path), full_page=True, animations="disabled")
            report["screenshots"] = [item for item in report["screenshots"] if item["path"] != str(path)] + [file_record(path)]
            persist()

        def open_operation(kind, key):
            page.locator('[data-design-action="refresh"]').click()
            control = page.locator('[data-design-action="open"][data-kind=' + json.dumps(kind) +
                                   "][data-id=" + json.dumps(key) + "]")
            expect(control).to_be_visible()
            control.click()
            expect(page.locator('[aria-label="Retained design result"]')).to_contain_text(key)

        def download_original(record, name, filename):
            expected = record["files"][name]
            tickets = [item for item in record.get("_downloads", []) if item.get("sha256") == expected["sha256"]]
            require(len(tickets) == 1, "Choose the unique original " + name + " download ticket.")
            link = page.locator('.cd-downloads a[href=' + json.dumps(tickets[0]["url"] + "?download=1") + "]")
            expect(link).to_be_visible()
            with page.expect_download() as pending:
                link.click()
            download = pending.value
            require(download.failure() is None, "The complete original download failed.")
            path = output / filename
            download.save_as(str(path))
            actual = file_record(path)
            require(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"],
                    "The downloaded " + name + " differs from its original file.")
            with zipfile.ZipFile(path) as archive:
                require(archive.testzip() is None, "An original ZIP member failed CRC verification.")
            return actual


        def close_dialogs():
            form_close = page.locator('#form-dialog[open] [data-action="form-close"]')
            if form_close.count():
                form_close.click()
                expect(page.locator("#form-dialog[open]")).to_have_count(0)
            detail_close = page.locator('#detail-dialog[open] [data-action="detail-close"]')
            if detail_close.count():
                detail_close.click()
                expect(page.locator("#detail-dialog[open]")).to_have_count(0)
            panel = page.locator("#task-panel")
            if panel.count() and panel.is_visible():
                page.locator('#task-panel [data-action="tasks-close"]').click()

        def download_archive(completed, transfer_key="workspace_transfer", filename="scientific-workspace.zip"):
            expected = completed["result"]
            tickets = [item for item in completed.get("_downloads", [])
                       if item.get("bytes") == expected["bytes"] and item.get("sha256") == expected["sha256"]]
            require(len(tickets) == 1, "Choose the original completed Workspace archive ticket.")
            ticket = tickets[0]
            target = urlsplit(origin + ticket["url"])
            require(target.scheme + "://" + target.netloc == origin
                    and target.path.startswith("/api/file/"),
                    "Use the original same-operator archive download.")
            archive_path = output / filename
            retained = report.get(transfer_key, {}).get("archive")
            if retained:
                require(file_record(retained["path"]) == retained
                        and retained["bytes"] == expected["bytes"] and retained["sha256"] == expected["sha256"],
                        "The retained original Workspace archive changed.")
                return retained
            close_dialogs()
            page.locator('.top-actions [data-action="tasks"]').click()
            control = page.locator('[data-action="task-open"][data-id=' + json.dumps(completed["id"]) + "]")
            if control.count():
                control.click()
                link = page.locator('#detail-dialog a[href=' + json.dumps(ticket["url"] + "?download=1") + "]")
                expect(link).to_be_visible()
                with page.expect_download() as pending:
                    link.click()
                download = pending.value
                require(download.failure() is None, "The complete original Workspace archive download failed.")
                download.save_as(str(archive_path))
                report[transfer_key]["download_route"] = "original_task_file_control"
            else:
                # An old task can be outside the current visible task window.
                # Its original authenticated file ticket still resolves the same archive.
                request = Request(origin + ticket["url"], headers={"Authorization": "Bearer " + capability})
                pending = archive_path.with_suffix(".zip.pending")
                try:
                    with urlopen(request, timeout=args.task_timeout) as source, pending.open("wb") as target_file:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            target_file.write(block)
                    pending.replace(archive_path)
                finally:
                    pending.unlink(missing_ok=True)
                report[transfer_key]["download_route"] = "original_authenticated_task_ticket"
            actual = file_record(archive_path)
            require(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"],
                    "The downloaded Workspace archive differs from its retained native result.")
            return actual

        def retain_workspace():
            transfer = report.setdefault("workspace_transfer", {"state": "ready"})
            close_dialogs()
            if report["task_ids"].get("workspace_backup"):
                captured = task(report["task_ids"]["workspace_backup"], "workspace.backup")
            else:
                page.locator('.sidebar-footer [data-action="backup"]').click()
                form = page.locator("#operation-form")
                expect(form).to_be_visible()
                form.locator('[name="include_intermediates"]').check()
                captured = action(form.locator('button[type="submit"]'), "workspace.backup", "workspace_backup")
            require(captured["result"]["project_id"] == original_state["data"]["project"]["id"],
                    "The archive belongs to another original scientific project.")
            transfer.update(state="captured", capture_task_id=captured["id"])
            persist()
            transfer["archive"] = download_archive(captured)
            snapshot = captured_editor(
                transfer["archive"]["path"], output, preparation["project_id"],
                received["alternative_id"], original_project["baseline"])
            require(snapshot["manifest_project"] == original_state["data"]["project"],
                    "The captured Workspace changed its original scientific project identity.")
            require(snapshot["alternative"]["title"] == alternative_title
                    and snapshot["alternative"]["description"] == args.reason.strip(),
                    "The captured alternative differs from this original design course.")
            editor_file = output / "captured-editor-project.json"
            editor_file.write_text(json.dumps({
                "editor": snapshot["editor"], "history": snapshot["history"],
                "alternative": snapshot["alternative"]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            transfer["captured_editor"] = {
                "project_id": preparation["project_id"], "revision": snapshot["editor"]["revision"],
                "alternative_id": received["alternative_id"], "record": file_record(editor_file),
                "history_count": len(snapshot["history"]),
                "database_member": snapshot["database_member"], "database": snapshot["database"],
                "database_snapshot": snapshot["database_snapshot"],
            }
            persist()
            screenshot("06-original-workspace-archive.png")
            close_dialogs()
            if report["task_ids"].get("workspace_restore"):
                restored_task = task(report["task_ids"]["workspace_restore"], "workspace.restore")
            else:
                limit = int(original_state.get("limits", {}).get("upload_bytes") or 0)
                require(limit == 0 or transfer["archive"]["bytes"] <= limit,
                        "The complete archive exceeds this operator's configured original upload limit.")
                page.locator('.sidebar-footer [data-action="restore"]').click()
                form = page.locator("#operation-form")
                expect(form).to_be_visible()
                form.locator('[name="restore_file"]').set_input_files(transfer["archive"]["path"])
                restored_task = action(form.locator('button[type="submit"]'), "workspace.restore", "workspace_restore")
            restored = restored_task["result"]
            restored_key = restored.get("workspace_key")
            require(restored.get("schema") == "upstate.scientific-workspace-receiving/v1"
                    and restored.get("identity") == "MATCH" and restored_key and restored_key != workspace
                    and restored.get("archive_sha256") == transfer["archive"]["sha256"]
                    and restored.get("project") == snapshot["manifest_project"],
                    "The independent Workspace receiving differs from the original archive.")
            transfer.update(state="received", restore_task_id=restored_task["id"],
                            workspace_key=restored_key, workspace=restored["workspace"],
                            application=restored["application"], directory=restored["directory"],
                            archive_sha256=restored["archive_sha256"])
            persist()
            close_dialogs()
            page.locator("#workspace-select").select_option(restored_key)
            expect(page.locator("#workspace-select")).to_have_value(restored_key)
            page.locator('[data-view="conservation-design"]').click()
            expect(page.locator(".cd-root")).to_be_visible()
            restored_state = api("/api/state", workspace=restored_key)
            require(restored_state.get("workspace_key") == restored_key
                    and restored_state["data"]["project"] == snapshot["manifest_project"],
                    "The registered receiving Workspace changed the captured project identity.")
            restored_plan = api("/api/conservation/plan", plan_id=plan_id, workspace=restored_key)
            require(restored_plan["selected_ids"] == report["original_selected_ids"]
                    and restored_plan["summary"] == report["original_plan_summary"],
                    "The independent Workspace changed the original saved Conservation plan.")
            restored_preparation = api("/api/conservation-design/preparation",
                                       id=preparation["id"], workspace=restored_key)
            require(all(restored_preparation.get(name) == preparation.get(name) for name in
                        ("id", "project_id", "plan_id", "study_id", "binding_id", "geometry_role", "files")),
                    "The restored editable preparation differs from its original saved reference.")
            restored_receiving = api("/api/conservation-design/receiving", id=received["id"], workspace=restored_key)
            require(before == {name: restored_receiving.get(name) for name in before},
                    "The independent Workspace changed the retained native design receiving.")
            editor_record = api("/api/conservation-design/editor",
                                {"workspace": restored_key, "path": "/api/projects/" + preparation["project_id"]},
                                workspace=restored_key)
            history = api("/api/conservation-design/editor",
                          {"workspace": restored_key, "path": "/api/projects/" + preparation["project_id"] + "/history"},
                          workspace=restored_key)
            require(editor_record == snapshot["editor"] and history == snapshot["history"],
                    "The restored editor differs from the exact project/revision/history captured in its SQLite snapshot.")
            open_operation("preparation", preparation["id"])
            page.locator('[data-design-action="edit"]').click()
            restored_editor = page.frame_locator("iframe[data-design-editor]")
            expect(restored_editor.locator("#project-title")).to_have_value(snapshot["editor"]["project"]["title"])
            alternative = restored_editor.locator("#alternative-list button.alternative").filter(
                has=restored_editor.get_by_text(snapshot["alternative"]["title"], exact=True))
            require(alternative.count() == 1, "Reopen the exact retained receiving alternative in the restored editor.")
            alternative.click()
            expect(restored_editor.locator("#alt-title")).to_have_value(snapshot["alternative"]["title"])
            expect(restored_editor.locator("#alt-description")).to_have_value(snapshot["alternative"]["description"])
            screenshot("07-restored-original-editor-revision.png")
            # Re-read after opening: opening the retained project must not create a replacement revision.
            reopened_editor = api("/api/conservation-design/editor",
                                  {"workspace": restored_key, "path": "/api/projects/" + preparation["project_id"]},
                                  workspace=restored_key)
            require(reopened_editor == snapshot["editor"],
                    "Opening the restored original editor changed its captured saved revision.")
            page.reload(wait_until="domcontentloaded")
            page.locator("#workspace-select").select_option(restored_key)
            expect(page.locator("#workspace-select")).to_have_value(restored_key)
            page.locator('[data-view="conservation-design"]').click()
            open_operation("receiving", received["id"])
            scenario_button = page.locator('[aria-label="Retained design result"] [data-action="item"]'
                                           '[data-kind="scenarios"][data-id=' + json.dumps(received["scenario_id"]) + "]")
            expect(scenario_button).to_be_visible()
            scenario_button.click()
            expect(page.locator("#detail-dialog[open]")).to_be_visible()
            restored_scenario = api("/api/item", kind="scenarios", id=received["scenario_id"], workspace=restored_key)
            require(restored_scenario["id"] == scenario["id"],
                    "The restored native scenario changed its original identity.")
            if received.get("run_id"):
                restored_run = api("/api/item", kind="runs", id=received["run_id"], workspace=restored_key)
                require(restored_run["id"] == received["run_id"]
                        and restored_run["selection"] == run["selection"],
                        "The restored native run changed its original prepared selection.")
            screenshot("08-restored-native-design.png")
            transfer.update(state="complete", reopened_project_id=preparation["project_id"],
                            reopened_revision=editor_record["revision"],
                            reopened_alternative_id=received["alternative_id"],
                            reopened_preparation_id=preparation["id"], reopened_plan_id=plan_id,
                            reopened_scenario_id=received["scenario_id"], reopened_run_id=received.get("run_id"),
                            history_matches=True, snapshot_project_matches=True,
                            completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            persist()


        def retain_selected_study():
            """Use the original Study desk and restore path for this SAME saved plan."""
            nonlocal request_scope
            transfer = report.setdefault("selected_study_transfer", {"state": "ready"})
            expected_root = {"kind": "conservation-plans", "id": plan_id}
            expected_title = "Saved design Study " + plan_id
            close_dialogs()
            page.locator("#workspace-select").select_option(workspace)
            expect(page.locator("#workspace-select")).to_have_value(workspace)
            page.locator('[data-view="study-transfer"]').click()
            expect(page.locator(".study-transfer")).to_be_visible()
            if not report["task_ids"].get("selected_study_export"):
                clear = page.locator('[data-study-action="clear-all"]')
                if clear.is_enabled():
                    clear.click()
                page.locator('[data-study-field="selected-only"]').uncheck()
                page.locator('[data-study-field="kind"]').select_option("conservation-plans")
                page.locator('[data-study-field="query"]').fill(plan_id)
                root_control = page.locator('[data-study-root=' + json.dumps("conservation-plans:" + plan_id) + "]")
                expect(root_control).to_be_visible()
                root_control.check()
                page.locator('[data-study-field="title"]').fill(expected_title)
                page.locator('[data-study-field="related"]').check()
            request_scope = "selected_study_export"
            try:
                exported = action(page.locator('[data-study-action="export"]'), "study.export",
                                  "selected_study_export", pending_key=request_scope)
            finally:
                request_scope = None
            receipt = exported["result"].get("study")
            identity = receipt.get("identity") if isinstance(receipt, dict) else None
            require(isinstance(identity, dict)
                    and exported["result"].get("project_id") == original_state["data"]["project"]["id"]
                    and identity.get("project_id") == original_state["data"]["project"]["id"]
                    and identity.get("selection", {}).get("roots") == [expected_root]
                    and identity["selection"].get("title") == expected_title
                    and identity["selection"].get("include_related_results") is True,
                    "The selected Study export changed its exact original portfolio selection.")
            retained_history = identity.get("conservation_design_history")
            require(isinstance(retained_history, dict)
                    and retained_history.get("schema") == "upstate.conservation-design-study-history/v1"
                    and retained_history.get("project_id") == original_state["data"]["project"]["id"]
                    and plan_id in retained_history.get("selected_plan_ids", []),
                    "Install the original editor selected-Study snapshot join before receiving this course.")
            transfer.update(state="captured", export_task_id=exported["id"],
                            study_transfer_id=receipt["id"], selection=identity["selection"],
                            original_editor_history=retained_history)
            persist()
            transfer["archive"] = download_archive(
                exported, "selected_study_transfer", "selected-scientific-study.zip")
            capture_directory = output / "selected-study-capture"
            capture_directory.mkdir(exist_ok=True)
            snapshot = captured_editor(
                transfer["archive"]["path"], capture_directory, preparation["project_id"],
                received["alternative_id"], original_project["baseline"])
            require(snapshot["manifest_project"] == original_state["data"]["project"],
                    "The selected Study archive changed its original project.")
            require(snapshot["database_projects"] == sorted(retained_history["editor_project_ids"]),
                    "The selected snapshot contains a different original editor project cohort.")
            require(snapshot["database"]["bytes"] == retained_history["database"]["bytes"]
                    and snapshot["database"]["sha256"] == retained_history["database"]["sha256"],
                    "The selected Study archive changed its frozen original Store bytes.")
            require(snapshot["alternative"]["title"] == alternative_title
                    and snapshot["alternative"]["description"] == args.reason.strip(),
                    "The selected capture differs from this course's original alternative.")
            with zipfile.ZipFile(transfer["archive"]["path"]) as archive:
                manifest = json.loads(archive.read("ARCHIVE.json"))
                member = "workspace/study-transfers/" + receipt["id"] + ".json"
                raw = archive.read(member)
                descriptor = manifest["members"].get(member, {})
                require(len(raw) == descriptor.get("bytes")
                        and hashlib.sha256(raw).hexdigest() == descriptor.get("sha256")
                        and json.loads(raw) == receipt,
                        "The archived selected Study receipt differs from its original task result.")
            uri = Path(snapshot["database"]["path"]).resolve().as_uri() + "?mode=ro&immutable=1"
            with closing(sqlite3.connect(uri, uri=True)) as database:
                for retained in retained_history["projects"]:
                    current = database.execute(
                        "SELECT title,revision,updated,body FROM projects WHERE id=?", (retained["id"],)).fetchone()
                    require(current is not None
                            and current[:3] == (retained["title"], retained["revision"], retained["updated"])
                            and body_identity(current[3]) == {
                                key: retained[key] for key in ("body_bytes", "body_sha256", "body_storage")},
                            "A captured selected editor current row differs from its original retained identity.")
                    rows = [
                        {"revision": revision, "saved": saved, **body_identity(body)}
                        for revision, saved, body in database.execute(
                            "SELECT revision,saved,body FROM revisions WHERE project_id=? ORDER BY revision",
                            (retained["id"],))]
                    require(rows == retained["history"],
                            "The selected Study lost a complete original editor revision body.")
            captured_record = capture_directory / "captured-project-and-history.json"
            captured_record.write_text(json.dumps({
                "editor": snapshot["editor"], "history": snapshot["history"],
                "alternative": snapshot["alternative"], "selected_history": retained_history,
                "study_receipt": receipt}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            transfer["captured_record"] = file_record(captured_record)
            transfer["captured_editor_revision"] = snapshot["editor"]["revision"]
            persist()
            screenshot("09-selected-study-export.png")
            close_dialogs()
            page.locator("#workspace-select").select_option(workspace)
            expect(page.locator("#workspace-select")).to_have_value(workspace)
            if not report["task_ids"].get("selected_study_restore"):
                limit = int(original_state.get("limits", {}).get("upload_bytes") or 0)
                require(limit == 0 or transfer["archive"]["bytes"] <= limit,
                        "The complete selected Study exceeds the original configured upload limit.")
                page.locator('.sidebar-footer [data-action="restore"]').click()
                form = page.locator("#operation-form")
                expect(form).to_be_visible()
                form.locator('[name="restore_file"]').set_input_files(transfer["archive"]["path"])
                restore_control = form.locator('button[type="submit"]')
            else:
                restore_control = page.locator('.sidebar-footer [data-action="restore"]')
            request_scope = "selected_study_restore"
            try:
                restored_task = action(restore_control, "workspace.restore", "selected_study_restore",
                                       pending_key=request_scope)
            finally:
                request_scope = None
            restored = restored_task["result"]
            restored_key = restored.get("workspace_key")
            require(restored.get("schema") == "upstate.scientific-workspace-receiving/v1"
                    and restored.get("identity") == "MATCH"
                    and restored_key not in (None, workspace, report["workspace_transfer"]["workspace_key"])
                    and restored.get("archive_sha256") == transfer["archive"]["sha256"]
                    and restored.get("project") == snapshot["manifest_project"],
                    "The selected Study did not reopen as the original independent project.")
            transfer.update(state="received", restore_task_id=restored_task["id"],
                            workspace_key=restored_key, workspace=restored["workspace"],
                            application=restored["application"], directory=restored["directory"],
                            archive_sha256=restored["archive_sha256"])
            persist()
            close_dialogs()
            page.locator("#workspace-select").select_option(restored_key)
            expect(page.locator("#workspace-select")).to_have_value(restored_key)
            page.locator('[data-view="conservation-design"]').click()
            expect(page.locator(".cd-root")).to_be_visible()
            selected_plan = api("/api/conservation/plan", plan_id=plan_id, workspace=restored_key)
            require(selected_plan["selected_ids"] == report["original_selected_ids"]
                    and selected_plan["summary"] == report["original_plan_summary"],
                    "The selected Study changed the original saved portfolio.")
            selected_preparation = api("/api/conservation-design/preparation",
                                       id=preparation["id"], workspace=restored_key)
            require(all(selected_preparation.get(name) == preparation.get(name) for name in
                        ("id", "project_id", "plan_id", "study_id", "binding_id", "geometry_role", "files")),
                    "The selected Study changed the original editable preparation.")
            selected_receiving = api("/api/conservation-design/receiving",
                                     id=received["id"], workspace=restored_key)
            require(before == {name: selected_receiving.get(name) for name in before},
                    "The selected Study changed the original native design receiving.")
            editor_record = api("/api/conservation-design/editor",
                                {"workspace": restored_key, "path": "/api/projects/" + preparation["project_id"]},
                                workspace=restored_key)
            history = api("/api/conservation-design/editor",
                          {"workspace": restored_key, "path": "/api/projects/" + preparation["project_id"] + "/history"},
                          workspace=restored_key)
            require(editor_record == snapshot["editor"] and history == snapshot["history"],
                    "The independently received selected Study changed the captured original editor history.")
            for row in snapshot["history"]:
                historical = api("/api/conservation-design/editor", {
                    "workspace": restored_key,
                    "path": "/api/projects/" + preparation["project_id"] + "/revisions/" + str(row["revision"])},
                    workspace=restored_key)
                with closing(sqlite3.connect(uri, uri=True)) as database:
                    source_body = database.execute(
                        "SELECT body FROM revisions WHERE project_id=? AND revision=?",
                        (preparation["project_id"], row["revision"])).fetchone()[0]
                require(historical == json.loads(source_body),
                        "An original editor revision did not reopen from the selected Study.")
            open_operation("preparation", preparation["id"])
            page.locator('[data-design-action="edit"]').click()
            selected_editor = page.frame_locator("iframe[data-design-editor]")
            expect(selected_editor.locator("#project-title")).to_have_value(snapshot["editor"]["project"]["title"])
            alternative = selected_editor.locator("#alternative-list button.alternative").filter(
                has=selected_editor.get_by_text(snapshot["alternative"]["title"], exact=True))
            require(alternative.count() == 1, "Choose the exact original selected-Study alternative.")
            alternative.click()
            expect(selected_editor.locator("#alt-title")).to_have_value(snapshot["alternative"]["title"])
            expect(selected_editor.locator("#alt-description")).to_have_value(snapshot["alternative"]["description"])
            screenshot("10-selected-study-original-editor.png")
            require(api("/api/conservation-design/editor", {
                "workspace": restored_key, "path": "/api/projects/" + preparation["project_id"]},
                workspace=restored_key) == snapshot["editor"],
                "Opening the selected original editor created a different revision.")
            page.reload(wait_until="domcontentloaded")
            page.locator("#workspace-select").select_option(restored_key)
            expect(page.locator("#workspace-select")).to_have_value(restored_key)
            page.locator('[data-view="conservation-design"]').click()
            open_operation("receiving", received["id"])
            selected_scenario = api("/api/item", kind="scenarios", id=received["scenario_id"], workspace=restored_key)
            require(selected_scenario["id"] == scenario["id"],
                    "The selected Study changed the original native scenario.")
            if received.get("run_id"):
                selected_run = api("/api/item", kind="runs", id=received["run_id"], workspace=restored_key)
                require(selected_run["id"] == received["run_id"] and selected_run["selection"] == run["selection"],
                        "The selected Study changed the original prepared native run.")
            screenshot("11-selected-study-native-design.png")
            transfer.update(state="complete", reopened_project_id=preparation["project_id"],
                            reopened_revision=editor_record["revision"],
                            reopened_alternative_id=received["alternative_id"], reopened_plan_id=plan_id,
                            reopened_preparation_id=preparation["id"], reopened_scenario_id=received["scenario_id"],
                            reopened_run_id=received.get("run_id"), history_matches=True,
                            captured_project_cohort_matches=True,
                            completed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            persist()


        try:
            page.goto(connection["operator_url"], wait_until="domcontentloaded")
            expect(page.locator("#workspace-select")).to_have_value(workspace)
            page.locator('[data-view="conservation-design"]').click()
            expect(page.locator(".cd-root")).to_be_visible()
            original_state = api("/api/state")
            require(original_state.get("workspace_key") == workspace, "Use the original selected Workspace.")
            plan = api("/api/conservation/plan", plan_id=plan_id)
            require(plan["id"] == plan_id and plan["study_id"] == study_id and plan["state"] == "complete",
                    "Continue the completed original saved portfolio.")
            report["original_selected_ids"] = plan["selected_ids"]
            report["original_plan_summary"] = plan["summary"]
            page.locator('[data-design-field="planId"]').select_option(plan_id)
            page.locator('[data-design-field="role"]').select_option(args.geometry_role)
            page.locator('[data-design-field="title"]').fill("Saved portfolio design " + plan_id)
            prepared_task = action(page.locator('[data-design-action="prepare"]'),
                                   "conservation.design.prepare", "prepare")
            preparation = api("/api/conservation-design/preparation", id=prepared_task["result"]["id"])
            require(preparation["plan_id"] == plan_id and preparation["study_id"] == study_id
                    and preparation["geometry_role"] == args.geometry_role,
                    "The editable project is bound to another original selection.")
            report["preparation_id"] = preparation["id"]
            open_operation("preparation", preparation["id"])
            report["editable_project"] = download_original(preparation, "editable_project", "editable-project.zip")
            persist()
            screenshot("01-original-saved-plan.png")

            if not report.get("handover"):
                # The maintained operator opens the same original Store project.
                page.locator('[data-design-action="edit"]').click()
                editor = page.frame_locator("iframe[data-design-editor]")
                expect(editor.locator("#project-title")).to_have_value(preparation["title"])
            with zipfile.ZipFile(report["editable_project"]["path"]) as archive:
                original_project = json.loads(archive.read("project.json"))
            require(original_project["baseline"]["source"]["conservation"]["source_reference"]["plan_id"] == plan_id,
                    "The original editable project lost its saved-plan binding.")
            keys = original_project["baseline"]["feature_keys"]
            if args.exclude_feature_key:
                require(args.exclude_feature_key in keys and len(keys) > 1,
                        "Exclude one actual original feature key while retaining a nonempty footprint.")

            if not report.get("handover"):
                title = alternative_title
                # Exact title disambiguates this retained alternative without assuming
                # spacing between the original button's separate title/status spans.
                alternative = editor.locator("#alternative-list button.alternative").filter(
                    has=editor.get_by_text(title, exact=True))
                if alternative.count() == 0:
                    editor.locator("#add-alt").click()
                    editor.locator("#name-input").fill(title)
                    editor.locator('#name-form button[type="submit"], #name-form button.primary').last.click()
                else:
                    require(alternative.count() == 1, "Choose the unique retained receiving alternative.")
                    alternative.click()
                expect(editor.locator("#alt-title")).to_have_value(title)
                editor.locator("#alt-description").fill(args.reason.strip())
                editor.locator("#alt-description").dispatch_event("change")
                if args.exclude_feature_key:
                    # Search affects rendering only; the original exact key selects the actual polygon.
                    editor.locator("#field-search").fill(args.exclude_feature_key)
                    feature = editor.locator("#field-list button[title=" + json.dumps(args.exclude_feature_key) + "]")
                    expect(feature).to_be_visible()
                    feature.click()
                    editor.locator("#exclude-field").check()
                editor.locator("#save").click()
                expect(editor.locator("#save-state")).to_contain_text("Saved")
                screenshot("02-original-geometry-alternative.png")
                editor.locator("#upstate-plan").click()
                editor.locator("#upstate-from").fill(",".join(map(str, args.from_codes)))
                editor.locator("#upstate-to").fill(str(args.to_code))
                editor.locator("#upstate-reason").fill(args.reason.strip())
                if args.grid_id:
                    editor.locator("#upstate-dialog summary").click()
                    editor.locator("#upstate-grid").fill(args.grid_id)
                    editor.locator("#upstate-profile").fill(args.profile_id)
                    editor.locator("#upstate-models").fill(",".join(args.models or []))
                with page.expect_download() as pending:
                    editor.locator('#upstate-form button[type="submit"]').click()
                download = pending.value
                require(download.failure() is None, "The original editor handover download failed.")
                handover_path = output / "native-handover.zip"
                download.save_as(str(handover_path))
                report["handover"] = file_record(handover_path)
                persist()

            handover_path = Path(report["handover"]["path"])
            require(file_record(handover_path) == report["handover"], "The retained native handover changed.")
            with zipfile.ZipFile(handover_path) as archive:
                require(archive.testzip() is None, "The complete handover ZIP failed CRC verification.")
                selection = json.loads(archive.read("native-selection.json"))
                binding = json.loads(archive.read("conservation-binding.json"))
                geometry = json.loads(archive.read("design.geojson"))
            require(selection["design_source_reference"]["plan_id"] == plan_id
                    and selection["design_source_reference"]["study_id"] == study_id
                    and selection["from_codes"] == args.from_codes and selection["to_code"] == args.to_code
                    and selection["reason"] == args.reason.strip()
                    and selection["title"] == alternative_title
                    and selection["project_id"] == preparation["project_id"]
                    and selection["geometry_role"] == args.geometry_role
                    and selection["prepare_run"] == choice["prepare_run"],
                    "The downloaded native handover differs from the explicit original design selection.")
            require(binding["source_reference"]["selected_ids"] == plan["selected_ids"],
                    "The complete handover changed the original portfolio reference.")
            expected_geometry = dict(original_project["baseline"]["collection"])
            expected_geometry.pop("bbox", None)
            expected_geometry["features"] = [
                feature for key, feature in zip(keys, original_project["baseline"]["collection"]["features"])
                if key != args.exclude_feature_key]
            require(geometry == expected_geometry,
                    "The handover footprint differs from the exact selected original geometry and explicit exclusion.")
            report["native_design_selection"] = selection
            report["design_feature_count"] = len(geometry["features"])
            persist()

            # Return to the same registered desk so the native raw-file upload is visible.
            page.reload(wait_until="domcontentloaded")
            page.locator('[data-view="conservation-design"]').click()
            expect(page.locator(".cd-root")).to_be_visible()
            page.locator('[data-design-field="inputMode"]').select_option("upload")
            page.locator('[data-design-field="file"]').set_input_files(str(handover_path))
            received_task = action(page.locator('[data-design-action="receive"]'),
                                   "conservation.design.receive", "receive")
            received = api("/api/conservation-design/receiving", id=received_task["result"]["id"])
            require(received["plan_id"] == plan_id and received["study_id"] == study_id
                    and received["input"]["sha256"] == report["handover"]["sha256"],
                    "The original queue received another design ZIP or saved plan.")
            upload = received_task["result"].get("operator_upload", {})
            require(upload.get("sha256") == report["handover"]["sha256"]
                    and upload.get("bytes") == report["handover"]["bytes"],
                    "The original task lost its complete streamed-upload identity.")
            report.update(receiving_id=received["id"], scenario_id=received["scenario_id"],
                          run_id=received.get("run_id"), operator_upload=upload)
            open_operation("receiving", received["id"])
            screenshot("03-received-native-design.png")
            before = {name: received.get(name) for name in (
                "id", "plan_id", "study_id", "scenario_id", "run_id", "source_reference",
                "design_revision_id", "alternative_id", "input", "files", "model_domain_coverage")}
            page.reload(wait_until="domcontentloaded")
            page.locator('[data-view="conservation-design"]').click()
            open_operation("receiving", received["id"])
            reopened = api("/api/conservation-design/receiving", id=received["id"])
            require(before == {name: reopened.get(name) for name in before},
                    "The saved design or native result identity changed after reopening.")
            current_plan = api("/api/conservation/plan", plan_id=plan_id)
            require(current_plan["selected_ids"] == report["original_selected_ids"]
                    and current_plan["summary"] == report["original_plan_summary"],
                    "The original saved plan changed during its design continuation.")
            scenario_button = page.locator('[aria-label="Retained design result"] [data-action="item"]'
                                           '[data-kind="scenarios"][data-id=' + json.dumps(received["scenario_id"]) + "]")
            expect(scenario_button).to_be_visible()
            scenario_button.click()
            expect(page.locator("#detail-dialog[open]")).to_be_visible()
            scenario = api("/api/item", kind="scenarios", id=received["scenario_id"])
            require(scenario["id"] == received["scenario_id"], "The original scenario did not reopen.")
            screenshot("04-original-native-scenario.png")
            report["reopened_scenario_id"] = scenario["id"]
            if received.get("run_id"):
                page.locator('#detail-dialog [data-action="detail-close"]').click()
                expect(page.locator("#detail-dialog[open]")).to_have_count(0)
                run_button = page.locator('[aria-label="Retained design result"] [data-action="item"]'
                                          '[data-kind="runs"][data-id=' + json.dumps(received["run_id"]) + "]")
                expect(run_button).to_be_visible()
                run_button.click()
                expect(page.locator("#detail-dialog[open]")).to_be_visible()
                run = api("/api/item", kind="runs", id=received["run_id"])
                require(run["selection"]["scenario_id"] == received["scenario_id"],
                        "The prepared original run belongs to another scenario.")
                report["reopened_run_id"] = run["id"]
                screenshot("05-original-prepared-run.png")
            retain_workspace()
            if args.selected_study:
                retain_selected_study()
            report["page_errors"] = list(dict.fromkeys(report["page_errors"]))
            require(not report["page_errors"], "Inspect the retained JavaScript exception before continuing.")
            report["state"] = "complete"
            report["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            persist()
        except Exception as error:
            report["state"] = "failed"
            report["error"] = clean(type(error).__name__ + ": " + str(error))
            try:
                screenshot("failure.png")
            except Exception:
                pass
            persist()
            raise RuntimeError(report["error"]) from None
        finally:
            context.close()
            if video:
                report["video"] = file_record(video.path())
                persist()
            browser.close()
    complete_output()


if __name__ == "__main__":
    main()
