"""Run the original economic operator journey and retain its actual outputs.

Uses installed Playwright/Chromium and the original operator queue. The printed
operator URL is read from a file or environment variable, never a CLI value.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stdout
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
import uuid
import zipfile


class BrowserUnavailable(RuntimeError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_response(response, label):
    if not response.ok:
        raise RuntimeError(label + ": HTTP " + str(response.status) + " " + response.text())


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def descriptor(path, root):
    return {"path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": digest(path)}


def read_url(args):
    raw = Path(args.operator_url_file).read_text(encoding="utf-8-sig").strip() if args.operator_url_file else os.environ.get(args.operator_url_env, "").strip()
    require(raw, "Supply the original operator URL through --operator-url-file or " + args.operator_url_env)
    if raw.startswith("{"):
        value = json.loads(raw)
        raw = value.get("url") or value.get("operator_url") or ""
    parts = urlsplit(raw)
    require(parts.scheme in {"http", "https"} and parts.hostname,
            "The supplied file or environment variable must contain the original HTTP operator URL")
    token = parse_qs(parts.fragment).get("token", [""])[0]
    require(token, "Use the original operator URL printed with its #token= fragment")
    require(not parts.username and not parts.password, "Use the original operator URL without userinfo")
    origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    return raw, origin, token


class Journal:
    def __init__(self, root, token, record):
        self.root, self.token, self.record = root, token, record

    def clean(self, value):
        if isinstance(value, str):
            return value.replace(self.token, "[redacted]") if self.token else value
        if isinstance(value, list):
            return [self.clean(item) for item in value]
        if isinstance(value, dict):
            return {key: self.clean(item) for key, item in value.items()}
        return value

    def save(self):
        target = self.root / "operator-journey.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.clean(self.record), indent=2, ensure_ascii=False,
                                        allow_nan=False) + "\n", encoding="utf-8")
        temporary.replace(target)

    @contextmanager
    def stage(self, name):
        item = {"stage": name, "started_at": now(), "status": "running"}
        self.record["steps"].append(item)
        self.save()
        print(json.dumps({"stage": name, "status": "running"}), flush=True)
        started = time.perf_counter()
        try:
            yield item
            item["status"] = "complete"
        except Exception as error:
            item.update(status="failed", error={"type": type(error).__name__,
                                               "message": self.clean(str(error))})
            raise
        finally:
            item["seconds"] = round(time.perf_counter() - started, 6)
            self.save()


def launch_browser(playwright, args):
    executable = args.browser_executable
    if not executable and not Path(playwright.chromium.executable_path).is_file():
        executable = next((path for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable")
                           if (path := shutil.which(name))), None)
        if not executable:
            raise BrowserUnavailable("No existing Chromium/Chrome executable was found")
    options = {"headless": True}
    if executable:
        options["executable_path"] = executable
    try:
        return playwright.chromium.launch(**options)
    except Exception as error:
        raise BrowserUnavailable("Existing browser could not launch: " + str(error)) from error


def extract_edition(archive_path, destination, *, schema="upstate.decision-delivery/v1"):
    destination.mkdir()
    seen = set()
    with zipfile.ZipFile(archive_path) as archive:
        for item in archive.infolist():
            name = item.filename
            require(name not in seen, "The downloaded edition repeats a member path")
            seen.add(name)
            require("\\" not in name and "\0" not in name and not PurePosixPath(name).is_absolute(),
                    "The downloaded edition needs canonical relative paths")
            parts = name.rstrip("/").split("/")
            require(all(part not in {"", ".", ".."} for part in parts),
                    "The downloaded edition contains a noncanonical member")
            require(not stat.S_ISLNK(item.external_attr >> 16), "The downloaded edition contains a symbolic link")
            target = destination.joinpath(*parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item, "r") as member, target.open("wb") as received:
                    shutil.copyfileobj(member, received, length=1024 * 1024)
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == schema,
            "The downloaded package is not the selected original delivery")
    for member in manifest["members"]:
        relative = PurePosixPath(member["path"])
        path = (destination / relative).resolve()
        require(path.is_relative_to(destination.resolve()), "A manifest member leaves the downloaded edition")
        require(path.stat().st_size == member["bytes"] and digest(path) == member["sha256"],
                "A downloaded edition member differs from its original descriptor: " + member["path"])
    return manifest


def fill_default_inputs(page, notes):
    """Use the native form's actual no-cost state when no saved input is supplied."""
    page.locator('[data-field="currency"]').fill("USD")
    for name in ("capital_limit", "annualized_limit"):
        page.locator('[data-field="' + name + '"]').fill("")
    targets = page.locator('[data-field^="target:"]')
    for index in range(targets.count()):
        targets.nth(index).fill("")
    included = page.locator('[data-cost="enabled"]')
    for index in range(included.count()):
        included.nth(index).uncheck()
    page.locator('[data-field="notes"]').fill(notes or "")


def validate_selection_scope(selection, source, zone):
    require(isinstance(selection, dict)
            and selection.get("schema") == "upstate.decision-selection/v1",
            "Use the original decision-selection/v1 input")
    require(selection.get("comparison_id") == zone["comparison_id"],
            "The supplied selection belongs to another original report or zone")
    for cost in selection.get("costs", []):
        scope = cost.get("scope") or {}
        kind = scope.get("kind")
        require(kind in {"whole_scenario", "reporting_zone", "retained"},
                "Each supplied cost needs its original explicit footprint scope")
        if kind != "whole_scenario":
            require(scope.get("zone_id") == zone["zone_id"]
                    and scope.get("producer_report_id") == source["producer_report_id"],
                    "A supplied local estimate belongs to another native report or zone")


def receive_operator(args, original_url, origin, token, journal):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserUnavailable("Playwright is absent from the selected Python environment") from error
    output = journal.root
    record = journal.record
    page = None
    existing_cost_plan = None
    selected_report_id, selected_zone_id, selected_run_id = args.report_id, args.zone_id, args.run_id
    with sync_playwright() as playwright:
        browser = launch_browser(playwright, args)
        record["browser"] = {"version": browser.version,
                             "configured_executable": args.browser_executable}
        context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
        context.set_default_timeout(args.timeout_seconds * 1000)
        page = context.new_page()
        page.on("pageerror", lambda error: record["browser_errors"].append(
            {"kind": "pageerror", "message": journal.clean(str(error))}))
        page.on("console", lambda message: record["browser_errors"].append(
            {"kind": "console", "message": journal.clean(message.text)}) if message.type == "error" else None)

        def get(path, **query):
            suffix = ("?" + urlencode(query)) if query else ""
            response = context.request.get(origin + path + suffix,
                                           headers={"Authorization": "Bearer " + token},
                                           max_redirects=0)
            check_response(response, "Original operator " + path)
            return response.json()

        def capture(name):
            page.screenshot(path=str(output / name), full_page=True)

        def wait_task(task, action, *, refresh_economics=True):
            key = task["id"]
            record["tasks"].append({"action": action, "id": key, "state": task["state"]})
            journal.save()
            deadline = time.monotonic() + args.task_timeout_seconds
            previous = None
            while task["state"] != "complete":
                if task["state"] != previous:
                    previous = task["state"]
                    record["tasks"][-1]["state"] = previous
                    journal.save()
                    print(json.dumps({"task_id": key, "action": action, "state": previous}), flush=True)
                require(task["state"] not in {"failed", "cancelled", "interrupted"},
                        "Original task " + key + " is " + task["state"] + ": " + json.dumps(task.get("error")))
                require(time.monotonic() < deadline,
                        "Original task " + key + " is still " + task["state"] + "; it remains in the operator queue")
                page.wait_for_timeout(1000)
                task = get("/api/task", id=key)
            record["tasks"][-1].update(state="complete", result_id=task["result"].get("id"))
            journal.save()
            if refresh_economics:
                page.locator('[data-econ="refresh-saved"]').click()
            return task


        def queued_action(action, button):
            with page.expect_response(lambda response: urlsplit(response.url).path == "/api/actions"
                                      and response.request.method == "POST"
                                      and json.loads(response.request.post_data or "{}").get("action") == action) as pending:
                page.locator('[data-econ="' + button + '"]').click()
            response = pending.value
            check_response(response, "Original queue action " + action)
            return wait_task(response.json(), action)

        def receive_implementation(edition, chosen, workspace, source_report_id, zone_id):
            def is_action(response, action):
                return (urlsplit(response.url).path == "/api/actions"
                        and response.request.method == "POST"
                        and json.loads(response.request.post_data or "{}").get("action") == action)

            def close_details():
                close = page.locator('#detail-dialog button[data-action="detail-close"]')
                if close.is_visible():
                    close.click()

            def download(ticket, target):
                relative = ticket.get("url", "")
                require(isinstance(relative, str) and relative.startswith("/") and not relative.startswith("//"),
                        "The retained implementation download must use the original operator")
                response = context.request.get(origin + relative,
                                               headers={"Authorization": "Bearer " + token},
                                               max_redirects=0)
                check_response(response, "Retained implementation file " + target.name)
                target.write_bytes(response.body())
                return target.read_bytes()


            def receive_comparison_report(comparison_result):
                """Use the maintained source composer and Study controls for this saved comparison."""
                comparison_id = comparison_result["id"]
                timeout = args.task_timeout_seconds * 1000
                source_action = "economic.comparison.report-source.import"

                def queue_control(action, control):
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/actions"
                                              and response.request.method == "POST"
                                              and json.loads(response.request.post_data or "{}").get("action") == action) as pending:
                        control.click()
                    response = pending.value
                    check_response(response, "Original " + action + " request")
                    original = json.loads(response.request.post_data)
                    accepted = response.json()
                    accepted = accepted.get("task", accepted)
                    task = wait_task(accepted, action, refresh_economics=False)
                    require(task["id"] == accepted["id"] and task["workspace"] == workspace
                            and task["action"] == action and task["operation_id"] == original["operation_id"]
                            and task["payload"] == original["payload"],
                            "A completed report or Study task differs from its original request")
                    return task, original

                def checked_download(control, path, expected=None):
                    with page.expect_download() as received:
                        control.click()
                    item = received.value
                    require(not item.failure(), "The original report or Study download failed")
                    item.save_as(str(path))
                    require(path.stat().st_size > 0, "The original download is empty")
                    if expected:
                        if expected.get("bytes") is not None:
                            require(path.stat().st_size == expected["bytes"], "The original download size changed")
                        if expected.get("sha256"):
                            require(digest(path) == expected["sha256"], "The original download SHA256 changed")
                    return descriptor(path, output)

                with journal.stage("register_original_comparison_scientific_source") as step:
                    page.locator('[data-econ="compare-editions"]').first.click()
                    comparison_dialog = page.locator("dialog.economic-comparison")
                    comparison_dialog.wait_for(state="visible")
                    saved = comparison_dialog.locator('[data-ec-action="saved"][data-id="' + comparison_id + '"]').first
                    saved.wait_for(state="visible")
                    page.wait_for_function(
                        "(id) => Array.from(document.querySelectorAll('dialog.economic-comparison [data-ec-action=saved]'))"
                        ".some(node => node.dataset.id===id && !node.disabled)", arg=comparison_id)
                    saved.click()
                    comparison_dialog.locator('[data-ec-action="scientific-source"]').click()
                    source_dialog = page.locator("dialog.economic-comparison-source")
                    source_dialog.wait_for(state="visible")
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/economic-comparison/report-source-preview"
                                              and response.request.method == "POST") as pending:
                        source_dialog.locator('[data-ecs-action="preview"]').click()
                    check_response(pending.value, "Preview the exact comparison scientific source")
                    source_preview = pending.value.json()
                    require(source_preview["workspace_key"] == workspace
                            and source_preview["comparison_id"] == comparison_id
                            and source_preview["first"]["id"] == comparison_result["input"]["first_edition_id"]
                            and source_preview["second"]["id"] == comparison_result["input"]["second_edition_id"]
                            and not source_preview["delivery_selection_supplied"],
                            "The scientific source preview differs from the two actual original editions")
                    capture("22-comparison-scientific-source-preview.png")
                    task, original = queue_control(source_action, source_dialog.locator('[data-ecs-action="apply"]'))
                    require(original["payload"] == {
                                "comparison_id": comparison_id,
                                "expected_source_key": source_preview["source_key"],
                                "expected_operation_id": source_preview["operation_id"]},
                            "The source request differs from the reviewed producer identity")
                    receipt = task["result"]
                    require(receipt["comparison_id"] == comparison_id
                            and receipt["source_key"] == source_preview["source_key"]
                            and receipt["operation_id"] == source_preview["operation_id"]
                            and receipt["state"] == "imported" and receipt["source_role"] == "OBSERVED_CONTEXT",
                            "The source registration changed its original comparison identity")
                    replay = context.request.post(origin + "/api/actions",
                                                  headers={"Authorization": "Bearer " + token},
                                                  data=original, max_redirects=0)
                    check_response(replay, "Rejoin original comparison source request")
                    replay_value = replay.json()
                    require(replay_value.get("task", replay_value)["id"] == task["id"],
                            "The source request replay created another task")
                    pair = {"source_collection_id": receipt["source_collection_id"],
                            "source_id": receipt["source_id"]}
                    require(pair in receipt["delivery_selection"]["observed_context_sources"],
                            "The registered source pair is absent from its original report selection")
                    (output / "comparison-scientific-source.json").write_text(
                        json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
                    source_dialog.locator('[data-ecs-action="open-report"][data-mode="replace"]').wait_for(state="visible")
                    page.wait_for_function(
                        "() => !document.querySelector('[data-ecs-action=open-report][data-mode=replace]')?.disabled",
                        timeout=timeout)
                    with page.expect_download() as recovered:
                        source_dialog.locator('[data-ecs-action="recovery-download"]').click()
                    require(not recovered.value.failure(), "The original source recovery file did not download")
                    recovered.value.save_as(str(output / "comparison-source-recovery.json"))
                    step.update(comparison_id=comparison_id, source_key=receipt["source_key"],
                                source_operation_id=receipt["operation_id"], task_id=task["id"], source_pair=pair)
                    record["economic_comparison_report"] = {
                        "comparison_id": comparison_id, "source_key": receipt["source_key"],
                        "source_operation_id": receipt["operation_id"], "source_task_id": task["id"],
                        "source_pair": pair}
                    journal.save()

                with journal.stage("render_original_comparison_in_scientific_reports") as step:
                    source_dialog.locator('[data-ecs-action="open-report"][data-mode="replace"]').click()
                    composer = page.locator(".scientific-report-editions")
                    composer.wait_for(state="visible")
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/source-reports/scientific-preview"
                                              and response.request.method == "POST") as pending:
                        composer.locator('[data-scientific-report-action="preview"]').click()
                    check_response(pending.value, "Preview original comparison report source")
                    report_preview = pending.value.json()
                    report_body = json.loads(pending.value.request.post_data)
                    require(report_body["sources"] == [pair]
                            and [{"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]}
                                 for row in report_preview["sources"]] == [pair],
                            "Replace mode did not select exactly the registered original comparison source")
                    require(report_preview["workspace_key"] == workspace,
                            "The report preview belongs to another Workspace")
                    capture("23-comparison-scientific-report-preview.png")
                    render_task = None
                    if report_preview.get("existing"):
                        composer.locator('[data-scientific-report-action="render"]').click()
                    else:
                        render_task, render_original = queue_control(
                            "source-reports.render", composer.locator('[data-scientific-report-action="render"]'))
                        require(render_original["payload"] == {**report_body, "preview_id": report_preview["id"]},
                                "The report task changed the exact reviewed ordered source selection")
                        close_details()
                        composer.locator('[data-scientific-report-action="refresh"]').click()
                        composer.locator('[data-scientific-report-action="open"][data-id="' + report_preview["id"] + '"]').click()
                    detail = composer.locator('[data-scientific-report-detail]')
                    detail.wait_for(state="visible")
                    report = get("/api/source-reports/scientific-edition", workspace=workspace, id=report_preview["id"])
                    require(report["workspace_key"] == workspace and report["edition"]["id"] == report_preview["id"]
                            and report["edition"]["state"] == "complete",
                            "The completed scientific report differs from its original preview")
                    selection = report["edition"]["render_identity"]["selection"]
                    selected_sources = selection.get("observed_context_sources") or [selection["source_roles"]["OBSERVED_CONTEXT"]]
                    require(selected_sources == [pair], "The rendered report changed its exact ordered source selection")
                    report_iframe = detail.locator("iframe").first
                    report_iframe.wait_for(state="visible")
                    detail.frame_locator("iframe").first.locator("body").wait_for(state="visible")
                    capture("24-comparison-scientific-report-desktop.png")
                    page.set_viewport_size({"width": 390, "height": 844})
                    capture("25-comparison-scientific-report-narrow.png")
                    page.set_viewport_size({"width": 1440, "height": 1000})
                    report_files = []
                    for item in report["files"]:
                        require(isinstance(item.get("path"), str), "A report file needs its original path")
                        url = item["url"] + ("&" if "?" in item["url"] else "?") + "download=1"
                        link = composer.locator('[data-scientific-report-files] a[download][href="' + url + '"]')
                        relative = PurePosixPath(item["path"])
                        require(not relative.is_absolute() and "\\" not in item["path"]
                                and all(part not in {"", ".", ".."} for part in item["path"].split("/")),
                                "The native report file needs its original canonical relative path")
                        destination = output / "comparison-scientific-report" / relative
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        received = checked_download(link, destination, item)
                        received["original_path"] = item["path"]
                        received["original_role"] = item.get("role")
                        report_files.append(received)
                    html = next((row for row in report_files if row["original_role"] == "report_html"), None)
                    require(html is not None, "The complete native scientific report has no HTML file")
                    outgoing = context.new_page(viewport={"width": 1440, "height": 1000})
                    outgoing.goto((output / html["path"]).as_uri(), wait_until="load")
                    outgoing.screenshot(path=str(output / "26-received-scientific-report-desktop.png"), full_page=True)
                    outgoing.set_viewport_size({"width": 390, "height": 844})
                    outgoing.screenshot(path=str(output / "27-received-scientific-report-narrow.png"), full_page=True)
                    outgoing.set_viewport_size({"width": 1440, "height": 1000})
                    outgoing.pdf(path=str(output / "comparison-scientific-report-browser.pdf"),
                                 format="A4", prefer_css_page_size=True, print_background=True)
                    outgoing.close()
                    export_task, export_original = queue_control(
                        "source-reports.export", composer.locator('[data-scientific-report-action="export"]'))
                    require(export_original["payload"] == {"id": report["edition"]["id"]},
                            "The report archive task selected another edition")
                    close_details()
                    composer.locator('[data-scientific-report-action="refresh"]').click()
                    archive_link = detail.get_by_role("link", name="Download report ZIP", exact=True)
                    archive_link.wait_for(state="visible")
                    report = get("/api/source-reports/scientific-edition", workspace=workspace, id=report["edition"]["id"])
                    report_zip = output / "complete-comparison-scientific-report.zip"
                    report_archive = checked_download(archive_link, report_zip, report.get("archive"))
                    with zipfile.ZipFile(report_zip) as archive:
                        require(archive.testzip() is None, "The completed report archive has a damaged original member")
                        require(any(name.lower().endswith(".html") for name in archive.namelist()),
                                "The complete report archive lost its readable report")
                    (output / "comparison-scientific-report-edition.json").write_text(
                        json.dumps(report, indent=2) + "\n", encoding="utf-8")
                    step.update(report_id=report["edition"]["id"],
                                render_task_id=render_task["id"] if render_task else None,
                                export_task_id=export_task["id"], files=report_files, archive=report_archive)
                    record["economic_comparison_report"].update(
                        report_id=report["edition"]["id"], report_files=report_files, report_archive=report_archive)
                    journal.save()

                with journal.stage("transfer_original_comparison_report_study") as step:
                    composer.locator('[data-scientific-report-action="transfer"]').click()
                    study = page.locator(".study-transfer")
                    study.wait_for(state="visible")
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/study-transfer/preview"
                                              and response.request.method == "POST") as pending:
                        study.locator('[data-study-action="preview"]').click()
                    check_response(pending.value, "Preview the exact scientific-report Study")
                    study_preview = pending.value.json()
                    study_body = json.loads(pending.value.request.post_data)
                    root = {"kind": "scientific-report-editions", "id": report["edition"]["id"]}
                    require(root in study_body["selection"]["roots"],
                            "The actual Study selection omitted the saved scientific report")
                    require(any(row["id"] == root["id"] for row in study_preview.get("scientific_report_editions", [])),
                            "The Study preview did not retain the original complete scientific report")
                    capture("28-comparison-report-study-preview.png")
                    study_task, study_original = queue_control("study.export", study.locator('[data-study-action="export"]'))
                    require(study_original["payload"] == {
                                **study_body["selection"], "preview_token": study_preview["preview_token"]},
                            "The Study export differs from its reviewed roots or exact preview token")
                    close_details()
                    task_button = study.locator('[data-study-action="task"][data-study-task="' + study_task["id"] + '"]')
                    task_button.wait_for(state="visible", timeout=timeout)
                    download_link = study.locator(".st-export").filter(has=task_button).locator("a.st-download")
                    download_link.wait_for(state="visible", timeout=timeout)
                    tickets = study_task.get("_downloads") or []
                    require(tickets, "The original Study export returned no complete download")
                    study_zip = output / "comparison-scientific-study.zip"
                    study_file = checked_download(download_link, study_zip, tickets[0])
                    application_root = Path(__file__).resolve().parent.parent
                    if str(application_root) not in sys.path:
                        sys.path.insert(0, str(application_root))
                    from model.study_transfer import inspect_transfer_archive
                    inspected = inspect_transfer_archive(study_zip, verify=True)
                    archive_manifest, study_receipt = inspected["manifest"], inspected["study"]
                    members = archive_manifest["members"]
                    require(archive_manifest["schema"] == "upstate.scientific-workspace-archive/v1"
                            and study_receipt["schema"] == "upstate.study-transfer/v1"
                            and study_receipt["id"] == study_task["result"]["id"],
                            "The received Study differs from its original export identity")
                    require(study_receipt["identity"]["selection"]["roots"] == study_body["selection"]["roots"],
                            "The received Study changed the reviewed original roots")
                    retained_report = next(
                        (row for row in study_receipt["identity"]["scientific_report_editions"]
                         if row["id"] == report["edition"]["id"]), None)
                    require(retained_report is not None and retained_report["source_choices"] == [pair],
                            "The received Study lost the original comparison report source")
                    for item in retained_report["members"]:
                        member = members.get("workspace/" + item["path"])
                        require(member and member["bytes"] == item["bytes"]
                                and member["sha256"] == item["sha256"],
                                "The received Study changed an original scientific report member")
                    require(retained_report["sources"]
                            and all(row.get("body_sha256") for row in retained_report["sources"]),
                            "The received report lacks original typed source body identities")
                    capture("29-comparison-report-study-export.png")
                    (output / "comparison-study-task.json").write_text(
                        json.dumps(study_task, indent=2) + "\n", encoding="utf-8")
                    step.update(study_id=study_task["result"]["id"], task_id=study_task["id"],
                                selection=study_body["selection"], archive=study_file, member_count=len(members))
                    record["economic_comparison_report"].update(
                        study_id=study_task["result"]["id"], study_task_id=study_task["id"],
                        study_selection=study_body["selection"], study_archive=study_file,
                        product_view_status="captured_for_producer_review",
                        visual_artifacts=[
                            "22-comparison-scientific-source-preview.png",
                            "23-comparison-scientific-report-preview.png",
                            "24-comparison-scientific-report-desktop.png",
                            "25-comparison-scientific-report-narrow.png",
                            "26-received-scientific-report-desktop.png",
                            "27-received-scientific-report-narrow.png",
                            "28-comparison-report-study-preview.png",
                            "29-comparison-report-study-export.png"])
                    journal.save()


                with journal.stage("cold_restore_comparison_study_and_reopen_editable_history") as step:
                    original_workspace = workspace
                    received_workspace = None
                    try:
                        study.locator('[data-action="restore"]').click()
                        page.locator('#form-dialog input[name="restore_file"]').set_input_files(str(study_zip))
                        restore_task, restore_original = queue_control("workspace.restore", page.locator("#form-submit"))
                        restored = restore_task["result"]
                        received_workspace = restored["workspace_key"]
                        require(restored["identity"] == "MATCH" and received_workspace != original_workspace
                                and restored["archive_sha256"] == digest(study_zip),
                                "The cold Study receiver did not create the exact original project in a fresh directory")
                        require(restored["project"]["id"] == archive_manifest["project"]["id"],
                                "The cold restored Study changed its original project identity")
                        close_details()
                        page.locator('[data-action="refresh"]').first.click()
                        page.wait_for_function(
                            "(key) => Array.from(document.querySelectorAll('#workspace-select option'))"
                            ".some(option => option.value===key)", arg=received_workspace, timeout=timeout)
                        with page.expect_response(lambda response:
                                                  urlsplit(response.url).path == "/api/state"
                                                  and parse_qs(urlsplit(response.url).query).get("workspace") == [received_workspace]):
                            page.locator("#workspace-select").select_option(received_workspace)
                        page.locator('[data-view="study-transfer"]').click()
                        received_study = page.locator('.study-transfer [data-received-action="open"][data-id="' +
                                                       study_task["result"]["id"] + '"]')
                        received_study.wait_for(state="visible", timeout=timeout)
                        with page.expect_response(lambda response:
                                                  urlsplit(response.url).path == "/api/study-transfer/received-detail"
                                                  and parse_qs(urlsplit(response.url).query).get("study_id") == [study_task["result"]["id"]]
                                                  and parse_qs(urlsplit(response.url).query).get("workspace") == [received_workspace]) as received_response:
                            received_study.click()
                        check_response(received_response.value, "Open original cold received Study")
                        received_detail = received_response.value.json()
                        require(received_detail["workspace_key"] == received_workspace
                                and received_detail["id"] == study_task["result"]["id"]
                                and received_detail["project"]["id"] == archive_manifest["project"]["id"],
                                "The received Study view substituted a different original project")
                        source_rows = received_detail.get("economic_comparison_sources") or []
                        source_index = next((i for i, row in enumerate(source_rows)
                                             if row.get("native_origin", {}).get("comparison_id") == comparison_id
                                             and row.get("source_collection_id") == pair["source_collection_id"]
                                             and row.get("source_id") == pair["source_id"]), None)
                        require(source_index is not None, "The cold received Study omitted its exact Economic comparison source")
                        source_row = source_rows[source_index]
                        require(source_row["relationship"] == "same_project"
                                and source_row["native_comparison"]["id"] == comparison_id,
                                "The original saved comparison was not restored as native editable history")
                        capture("30-cold-received-comparison-study.png")
                        with page.expect_response(lambda response:
                                                  urlsplit(response.url).path == "/api/economic-comparison/detail"
                                                  and parse_qs(urlsplit(response.url).query).get("id") == [comparison_id]
                                                  and parse_qs(urlsplit(response.url).query).get("workspace") == [received_workspace]) as reopened:
                            page.locator('[data-received-action="economic-comparison-open"]'
                                         '[data-economic-comparison-source="' + str(source_index) + '"]').click()
                        check_response(reopened.value, "Open exact saved comparison from received Study")
                        received_comparison = reopened.value.json()
                        require(received_comparison["workspace_key"] == received_workspace
                                and received_comparison["comparison"] == comparison_result["comparison"]
                                and received_comparison["input"] == comparison_result["input"],
                                "The cold received comparison changed either original edition or its complete values")
                        received_dialog = page.locator("dialog.economic-comparison")
                        received_dialog.wait_for(state="visible")
                        received_dialog.get_by_role("link", name="Open complete comparison report", exact=True).wait_for(
                            state="visible")
                        capture("31-cold-received-economic-comparison-desktop.png")
                        page.set_viewport_size({"width": 390, "height": 844})
                        capture("32-cold-received-economic-comparison-narrow.png")
                        page.set_viewport_size({"width": 1440, "height": 1000})
                        received_dialog.locator('[data-ec-action="close"]').click()
                        availability = source_row.get("native_source_availability") or []
                        editable = next((row for row in availability if row.get("state") == "available"
                                         and row.get("new_cost_edition_available") is True
                                         and row.get("verified_source_paths")), None)
                        editable_preview = None
                        if editable is not None:
                            edition_id = editable["edition_id"]
                            with page.expect_response(lambda response:
                                                      urlsplit(response.url).path == "/api/economic-desk/edition"
                                                      and parse_qs(urlsplit(response.url).query).get("edition_id") == [edition_id]) as retained:
                                page.locator('[data-econ="edit-edition"][data-id="' + edition_id + '"]').click()
                            check_response(retained.value, "Reopen retained original Economic input for editing")
                            original_input = retained.value.json()["input"]
                            page.wait_for_function(
                                "(zone) => document.querySelector('[data-zone]')?.value===zone"
                                " && !document.querySelector('[data-econ=preview]')?.disabled",
                                arg=original_input["zone_id"], timeout=timeout)
                            notes = page.locator('[data-field="notes"]')
                            original_notes = notes.input_value()
                            notes.fill(original_notes + "\nCold received Study editable input review.")
                            with page.expect_response(lambda response:
                                                      urlsplit(response.url).path == "/api/economic-desk/preview"
                                                      and response.request.method == "POST") as edited:
                                page.locator('[data-econ="preview"]').click()
                            check_response(edited.value, "Preview editable original Economic input in cold received Study")
                            edited_input = json.loads(edited.value.request.post_data)
                            require(all(edited_input.get(name) == original_input.get(name)
                                        for name in ("report_id", "report_sha256", "zone_id")),
                                    "Editing received notes changed the original physical source binding")
                            original_costs = {row["run_id"]: row for row in original_input["selection"]["costs"]}
                            edited_costs = {row["run_id"]: row for row in edited_input["selection"]["costs"]}
                            require(set(original_costs) == set(edited_costs),
                                    "Editing received notes changed the original costed scenario cohort")
                            for run_id, old_cost in original_costs.items():
                                new_cost = edited_costs[run_id]
                                require(all(new_cost.get(name) == old_cost.get(name)
                                            for name in ("currency", "capital", "annual_operating", "horizon_years",
                                                         "discount_rate", "source")),
                                        "Editing received notes changed an original estimate or its source")
                                require(all(new_cost.get("scope", {}).get(name) == value
                                            for name, value in old_cost.get("scope", {}).items()),
                                        "Editing received notes changed the original estimate footprint")
                                require(all(new_cost.get(name) == value for name, value in old_cost.items()
                                            if name not in {"note", "scope_note", "scope"}),
                                        "Editing received notes lost retained original cost metadata")
                            editable_preview = {"edition_id": edition_id,
                                                "source_identity_preserved": True,
                                                "original_costs_preserved": True,
                                                "new_edition_created": False}
                            capture("33-cold-received-editable-economic-input.png")
                        page.locator('[data-view="study-transfer"]').click()
                        page.locator('[data-received-action="open"][data-id="' + study_task["result"]["id"] + '"]').click()
                        with page.expect_response(lambda response:
                                                  urlsplit(response.url).path == "/api/source-reports/scientific-catalog"):
                            page.locator('[data-received-action="economic-comparison-report"]'
                                         '[data-economic-comparison-source="' + str(source_index) + '"]').click()
                        with page.expect_response(lambda response:
                                                  urlsplit(response.url).path == "/api/source-reports/scientific-preview"
                                                  and response.request.method == "POST") as received_preview:
                            page.locator('[data-scientific-report-action="preview"]').click()
                        check_response(received_preview.value, "Preview original report from cold received Study")
                        received_report_preview = received_preview.value.json()
                        require(received_report_preview["workspace_key"] == received_workspace
                                and [{"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]}
                                     for row in received_report_preview["sources"]] == [pair],
                                "The received Study report opened a different original source pair")
                        received_report = get("/api/source-reports/scientific-edition", workspace=received_workspace,
                                              id=report["edition"]["id"])
                        page.locator('[data-scientific-report-action="open"][data-id="' +
                                     report["edition"]["id"] + '"]').click()
                        page.locator('[data-scientific-report-detail]').wait_for(state="visible")
                        page.locator('[data-scientific-report-detail]').frame_locator("iframe").first.locator("body").wait_for(
                            state="visible")
                        capture("34-cold-received-original-scientific-report.png")
                        require(received_report["edition"]["render_identity"] == report["edition"]["render_identity"],
                                "The cold received scientific report changed its original rendered identity")
                        (output / "cold-received-comparison-study.json").write_text(
                            json.dumps({"restore": restored, "received_study": received_detail,
                                        "comparison": received_comparison, "report": received_report,
                                        "editable_preview": editable_preview}, indent=2) + "\n", encoding="utf-8")
                        step.update(receiving_workspace_key=received_workspace, original_project_id=restored["project"]["id"],
                                    restore_task_id=restore_task["id"], restored_identity="MATCH",
                                    comparison_reopened=True, original_report_reopened=True,
                                    native_source_availability=availability, editable_preview=editable_preview)
                        record["economic_comparison_report"].update(
                            receiving_workspace_key=received_workspace, restore_task_id=restore_task["id"],
                            restored_identity="MATCH", received_comparison_reopened=True,
                            received_scientific_report_reopened=True,
                            native_source_availability=availability, editable_preview=editable_preview)
                        record["economic_comparison_report"]["visual_artifacts"].extend([
                            "30-cold-received-comparison-study.png",
                            "31-cold-received-economic-comparison-desktop.png",
                            "32-cold-received-economic-comparison-narrow.png",
                            "34-cold-received-original-scientific-report.png"])
                        if editable_preview:
                            record["economic_comparison_report"]["visual_artifacts"].append(
                                "33-cold-received-editable-economic-input.png")
                        journal.save()
                    finally:
                        if received_workspace and page.locator("#workspace-select").input_value() != original_workspace:
                            close_details()
                            with page.expect_response(lambda response:
                                                      urlsplit(response.url).path == "/api/state"
                                                      and parse_qs(urlsplit(response.url).query).get("workspace") == [original_workspace]):
                                page.locator("#workspace-select").select_option(original_workspace)

            def receive_saved_comparison(first_edition, second_edition):
                """Operate the maintained comparison using two actual completed editions."""
                action = "economic.comparison.build"
                timeout = args.task_timeout_seconds * 1000
                first_id, second_id = first_edition["id"], second_edition["id"]
                require(first_id != second_id, "The reviewed cost edition must differ from its original edition")
                before_inputs = page.locator(".economic-workbench").evaluate(
                    "(root) => Array.from(root.querySelectorAll('input,select,textarea')).map(node => "
                    "({tag:node.tagName,type:node.type||'',name:node.name||'',"
                    "data:{...node.dataset},value:node.value,checked:!!node.checked}))")
                with journal.stage("preview_original_and_reviewed_economic_editions") as step:
                    close_details()
                    page.locator('[data-econ="compare-editions"][data-id="' + first_id + '"]').click()
                    comparison_dialog = page.locator("dialog.economic-comparison")
                    comparison_dialog.wait_for(state="visible")
                    page.wait_for_function(
                        "(id) => document.querySelector('dialog.economic-comparison [data-ec=first]')?.value===id"
                        " && !document.querySelector('dialog.economic-comparison [data-ec=first]')?.disabled",
                        arg=first_id)
                    comparison_dialog.locator('[data-ec="second"]').select_option(first_id)
                    comparison_dialog.locator('[data-ec-action="preview"]').click()
                    comparison_dialog.locator(".ec-error").wait_for(state="visible")
                    require("two different" in comparison_dialog.locator(".ec-error").inner_text().lower(),
                            "The actual comparison control did not explain an invalid repeated edition")
                    capture("15a-economic-comparison-selection-error.png")
                    comparison_dialog.locator('[data-ec="second"]').select_option(second_id)
                    comparison_dialog.locator('[data-ec="title"]').fill("")
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/economic-comparison/preview"
                                              and response.request.method == "POST") as pending:
                        comparison_dialog.locator('[data-ec-action="preview"]').click()
                    response = pending.value
                    check_response(response, "Original Economic comparison preview")
                    preview = response.json()
                    comparison = preview["comparison"]
                    require(preview["workspace_key"] == workspace
                            and preview["input"]["first_edition_id"] == first_id
                            and preview["input"]["second_edition_id"] == second_id
                            and comparison["first"]["id"] == first_id
                            and comparison["second"]["id"] == second_id,
                            "The visible comparison changed its original edition pair")
                    require(comparison["comparability"]["physical"] is True,
                            "The cost successor changed original physical comparison definitions")
                    originals = ({row["run_id"]: row for row in item["report"]["alternatives"]}
                                 for item in (first_edition, second_edition))
                    first_rows, second_rows = originals
                    require(set(first_rows) == set(second_rows)
                            == {row["run_id"] for row in comparison["scenarios"]},
                            "The comparison changed the original full scenario cohort")
                    for row in comparison["scenarios"]:
                        require(row["first"] == first_rows[row["run_id"]]
                                and row["second"] == second_rows[row["run_id"]],
                                "The comparison changed an original complete scenario")
                    (output / "original-economic-comparison-preview.json").write_text(
                        json.dumps(preview, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    comparison_dialog.locator('[data-ec-action="build"]').wait_for(state="visible")
                    capture("15-economic-comparison-preview-desktop.png")
                    require(comparison["scenarios"], "The original comparison has no scenarios to inspect")
                    run_id = chosen["run_id"]
                    comparison_dialog.locator('[data-ec="search"]').fill(run_id)
                    comparison_dialog.locator('[data-ec="filter"]').select_option("all")
                    comparison_dialog.locator('[data-ec-action="scenario"][data-id="' + run_id + '"]').click()
                    require(run_id in comparison_dialog.locator("[data-ec-scenario]").inner_text(),
                            "The visible scenario details belong to another original run")
                    with page.expect_download() as pending:
                        comparison_dialog.locator('[data-ec-action="matching-download"]').click()
                    downloaded = pending.value
                    require(not downloaded.failure(), "The all-matching original scenario export failed")
                    matching_path = output / "comparison-matching-original-scenarios.json"
                    downloaded.save_as(str(matching_path))
                    matching = json.loads(matching_path.read_text(encoding="utf-8"))
                    expected_matching = [row for row in comparison["scenarios"]
                                         if run_id.lower() in (row["label"] + " " + row["run_id"]).lower()]
                    require(matching["comparison_id"] == preview["comparison_id"]
                            and matching["scenarios"] == expected_matching,
                            "The matching export omitted or changed original scenario records")
                    comparison_dialog.locator('[data-ec="search"]').fill(run_id + "-no-original-match")
                    require(comparison_dialog.locator("[data-ec-scenarios] tbody tr").count() == 0,
                            "The original scenario search did not expose its actual empty matching state")
                    capture("16a-economic-comparison-empty-filter.png")
                    comparison_dialog.locator('[data-ec="search"]').fill("")
                    comparison_dialog.locator('[data-ec="filter"]').select_option("cost")
                    page.set_viewport_size({"width": 720, "height": 1000})
                    capture("16-economic-comparison-cost-changes-narrow.png")
                    page.set_viewport_size({"width": 1440, "height": 1000})
                    comparison_dialog.locator('[data-ec="filter"]').select_option("all")
                    step.update(first_edition_id=first_id, second_edition_id=second_id,
                                comparison_id=preview["comparison_id"],
                                original_scenarios=len(comparison["scenarios"]),
                                matching_export=descriptor(matching_path, output))
                    journal.save()

                with journal.stage("save_and_rejoin_original_economic_comparison") as step:
                    with page.expect_response(lambda response: is_action(response, action),
                                              timeout=timeout) as pending:
                        comparison_dialog.locator('[data-ec-action="build"]').click()
                    response = pending.value
                    check_response(response, "Original comparison queued action")
                    original_request = json.loads(response.request.post_data)
                    require(original_request["payload"] == {
                                **preview["input"], "expected_comparison_id": preview["comparison_id"]},
                            "The queued comparison differs from the actual reviewed preview")
                    task = wait_task(response.json(), action, refresh_economics=False)
                    require(task["workspace"] == workspace and task["action"] == action
                            and task["operation_id"] == original_request["operation_id"]
                            and task["payload"] == original_request["payload"],
                            "The completed task differs from the original comparison request")
                    result = task["result"]
                    require(result["id"] == preview["comparison_id"]
                            and result["input"] == preview["input"]
                            and result["comparison"] == comparison,
                            "The saved comparison changed its original preview or scenario values")
                    replay_response = context.request.post(
                        origin + "/api/actions", headers={"Authorization": "Bearer " + token},
                        data=original_request, max_redirects=0)
                    check_response(replay_response, "Rejoin the same original comparison request")
                    replay = replay_response.json()
                    require(replay["id"] == task["id"],
                            "The same comparison operation created a different native task")
                    fresh = get("/api/economic-comparison/detail", workspace=workspace, id=result["id"])
                    require(fresh["comparison"] == comparison and fresh["input"] == preview["input"],
                            "The reopened native comparison changed its retained original sources")
                    (output / "saved-economic-comparison.json").write_text(
                        json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    comparison_dialog.get_by_role("link", name="Open complete comparison report", exact=True).wait_for(
                        state="visible", timeout=timeout)
                    with page.expect_download() as pending:
                        comparison_dialog.locator('[data-ec-action="recovery-download"]').click()
                    recovered = pending.value
                    require(not recovered.failure(), "The original comparison recovery file did not download")
                    recovery_path = output / "economic-comparison-original-recovery.json"
                    recovered.save_as(str(recovery_path))
                    require(recovery_path.stat().st_size > 0, "The original comparison recovery file is empty")
                    capture("17-complete-economic-comparison-desktop.png")
                    record["economic_comparison"] = {
                        "id": result["id"], "task_id": task["id"],
                        "operation_id": original_request["operation_id"],
                        "first_edition_id": first_id, "second_edition_id": second_id,
                        "input": preview["input"], "summary": comparison["summary"],
                        "physical_comparable": comparison["comparability"]["physical"]}
                    step.update(**record["economic_comparison"])
                    journal.save()

                with journal.stage("receive_complete_comparison_and_both_original_editions") as step:
                    package_descriptor = next(item for item in fresh["files"]
                                              if item["path"] == "comparison-package.zip")
                    package_ticket = next(item for item in fresh["_downloads"]
                                          if item["filename"] == "comparison-package.zip")
                    relative = package_ticket["url"]
                    require(relative.startswith("/") and not relative.startswith("//"),
                            "The complete comparison download must use the original operator")
                    with page.expect_download() as pending:
                        comparison_dialog.locator('a[download][href="' + origin + relative + '"]').click()
                    downloaded = pending.value
                    require(not downloaded.failure(), "The complete comparison package did not download")
                    package_path = output / "complete-original-economic-comparison.zip"
                    downloaded.save_as(str(package_path))
                    require(package_path.stat().st_size == package_descriptor["bytes"]
                            and digest(package_path) == package_descriptor["sha256"],
                            "The outgoing comparison ZIP differs from its exact native descriptor")
                    directory = output / "economic-comparison"
                    manifest = extract_edition(package_path, directory,
                                               schema="upstate.economic-comparison-package/v1")
                    require(manifest["id"] == fresh["id"]
                            and json.loads((directory / "comparison.json").read_text(encoding="utf-8")) == comparison,
                            "The exported comparison changed its identity or complete original values")
                    nested_members = {}
                    for side, edition in (("first", first_edition), ("second", second_edition)):
                        retained = json.loads((directory / (side + "-edition.json")).read_text(encoding="utf-8"))
                        original_report = json.loads((directory / (side + "-report.json")).read_text(encoding="utf-8"))
                        require(retained["id"] == edition["id"] and retained["input"] == edition["input"]
                                and original_report == edition["report"],
                                "The comparison package lost an original edition record or report")
                        nested = extract_edition(directory / (side + "-economic-package.zip"),
                                                 directory / (side + "-economic-edition"))
                        require(nested["report_id"] == edition["report_id"],
                                "A nested original Economic package belongs to another report")
                        nested_members[side] = len(nested["members"])
                    report_page = context.new_page()
                    report_page.goto((directory / "index.html").as_uri(), wait_until="load")
                    require(comparison["title"] == report_page.locator("h1").inner_text()
                            and first_id in report_page.locator("main").inner_text()
                            and second_id in report_page.locator("main").inner_text(),
                            "The outgoing readable comparison opened another original pair")
                    report_page.screenshot(path=str(output / "18-received-economic-comparison-desktop.png"),
                                           full_page=True)
                    report_page.set_viewport_size({"width": 720, "height": 1000})
                    report_page.screenshot(path=str(output / "19-received-economic-comparison-narrow.png"),
                                           full_page=True)
                    report_page.pdf(path=str(output / "economic-comparison-report.pdf"),
                                    prefer_css_page_size=True, print_background=True)
                    require((output / "economic-comparison-report.pdf").read_bytes().startswith(b"%PDF"),
                            "The outgoing comparison report did not produce its PDF")
                    report_page.close()
                    with context.expect_page() as opened:
                        comparison_dialog.get_by_role("link", name="Open complete comparison report", exact=True).click()
                    native_report = opened.value
                    native_report.wait_for_load_state("load")
                    require(native_report.locator("h1").inner_text() == comparison["title"],
                            "The typed original comparison report opened another saved result")
                    native_report.screenshot(path=str(output / "20-typed-economic-comparison.png"), full_page=True)
                    native_report.close()
                    comparison_dialog.locator('[data-ec-action="close"]').click()
                    after_inputs = page.locator(".economic-workbench").evaluate(
                        "(root) => Array.from(root.querySelectorAll('input,select,textarea')).map(node => "
                        "({tag:node.tagName,type:node.type||'',name:node.name||'',"
                        "data:{...node.dataset},value:node.value,checked:!!node.checked}))")
                    require(after_inputs == before_inputs,
                            "The independent comparison changed the underlying Economic input draft")
                    page.reload(wait_until="load")
                    page.locator("#workspace-select").wait_for(state="visible")
                    if page.locator("#workspace-select").input_value() != workspace:
                        with page.expect_response(lambda response:
                                                  urlsplit(response.url).path == "/api/state"
                                                  and parse_qs(urlsplit(response.url).query).get("workspace") == [workspace]):
                            page.locator("#workspace-select").select_option(workspace)
                    page.locator('[data-view="economic-desk"]').click()
                    page.locator('[data-econ="compare-editions"]').first.click()
                    comparison_dialog = page.locator("dialog.economic-comparison")
                    comparison_dialog.wait_for(state="visible")
                    saved_button = comparison_dialog.locator('[data-ec-action="saved"][data-id="' + fresh["id"] + '"]')
                    saved_button.first.wait_for(state="visible")
                    page.wait_for_function(
                        "(id) => Array.from(document.querySelectorAll('dialog.economic-comparison [data-ec-action=saved]'))"
                        ".some(node => node.dataset.id===id && !node.disabled)", arg=fresh["id"])
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/economic-comparison/detail"
                                              and parse_qs(urlsplit(response.url).query).get("id") == [fresh["id"]]) as reopened:
                        saved_button.first.click()
                    check_response(reopened.value, "Reopen the original saved comparison after reload")
                    require(reopened.value.json()["comparison"] == comparison,
                            "Reloading the comparison changed its complete original source values")
                    comparison_dialog.get_by_role("link", name="Open complete comparison report", exact=True).wait_for(
                        state="visible")
                    capture("21-reopened-saved-economic-comparison.png")
                    comparison_dialog.locator('[data-ec-action="close"]').click()
                    step.update(package=descriptor(package_path, output),
                                verified_comparison_members=len(manifest["members"]),
                                original_economic_members=nested_members,
                                original_draft_preserved=True, reopened_after_reload=True)
                    record["economic_comparison"].update(
                        package=descriptor(package_path, output), verified_members=len(manifest["members"]),
                        nested_economic_members=nested_members,
                        product_view_status="captured_for_producer_review",
                        visual_artifacts=[
                            "15-economic-comparison-preview-desktop.png",
                            "16-economic-comparison-cost-changes-narrow.png",
                            "18-received-economic-comparison-desktop.png",
                            "19-received-economic-comparison-narrow.png",
                            "20-typed-economic-comparison.png",
                            "21-reopened-saved-economic-comparison.png"])
                    journal.save()
                if args.comparison_report:
                    receive_comparison_report(fresh)


            def receive_cost_review(plan, candidate, source_edition):
                """Use supplied original forecasts through the populated native UI."""
                source_path = Path(args.cost_review).resolve(strict=True)
                require(source_path.is_file() and source_path.stat().st_size <= 16 * 1024 * 1024,
                        "Choose the original cost review JSON within 16 MiB")
                supplied = json.loads(source_path.read_text(encoding="utf-8-sig"))
                review = supplied.get("review", supplied)
                require(isinstance(review, dict)
                        and review.get("schema") == "upstate.implementation-cost-review-selection/v1",
                        "Supply the explicit reviewed ledger choices, forecast sources and scope")
                retained = output / "original-field-cost-review.json"
                shutil.copyfile(source_path, retained)
                timeout = args.task_timeout_seconds * 1000

                with journal.stage("review_saved_field_costs_in_original_scenario") as step:
                    close_details()
                    page.locator('[data-impl="tab"][data-tab="budget"]').click()
                    page.locator('[data-impl="cost-review"]').click()
                    dialog = page.locator('dialog.iw-cost-review')
                    dialog.wait_for(state="visible")
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/implementation-costs/context"
                                              and response.request.method == "POST") as pending:
                        dialog.locator('[data-cr="candidate"]').select_option(candidate["id"])
                    response = pending.value
                    check_response(response, "Original saved field cost context")
                    cost_context = response.json()
                    require(cost_context["binding"]["plan_id"] == plan["id"]
                            and cost_context["binding"]["revision"] == plan["revision"]
                            and cost_context["binding"]["candidate_id"] == candidate["id"]
                            and cost_context["binding"]["report_id"] == source_report_id
                            and cost_context["binding"]["zone_id"] == zone_id
                            and cost_context["binding"]["run_id"] == chosen["run_id"]
                            and cost_context["binding"]["report_sha256"] == record["source_report_sha256"]
                            and cost_context["binding"]["edition_id"] == source_edition["id"],
                            "The visible cost review has another original source binding")
                    require([row["original_row"] for row in cost_context["ledger_rows"]] == plan["budget_lines"],
                            "The native cost context changed the exact recorded ledger rows")
                    if existing_cost_plan:
                        require(cost_context["binding"] == existing_cost_plan["binding"],
                                "The reviewed existing plan differs from its pinned candidate source")
                    if "binding" in supplied:
                        require(supplied["binding"] == cost_context["binding"],
                                "The supplied bound review belongs to another saved revision or scenario")
                    dialog.locator('[data-cr="review-file"]').set_input_files(str(retained))
                    page.wait_for_function(
                        "() => document.querySelector('.iw-cost-review [role=status]')?.textContent"
                        "?.includes('Original review selection loaded')")
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/implementation-costs/preview"
                                              and response.request.method == "POST") as pending:
                        dialog.locator('[data-cr-action="preview"]').click()
                    response = pending.value
                    check_response(response, "Original native cost review preview")
                    cost_preview = response.json()
                    require(cost_preview.get("can_apply") is True,
                            "Review the exact stated cost choices: " + json.dumps(cost_preview.get("issues")))
                    require(cost_preview["binding"] == cost_context["binding"],
                            "The cost preview changed the original scenario binding")
                    actual = cost_preview["economic_preview"]
                    require(actual["baseline"]["outputs"] == source_edition["report"]["baseline"]["outputs"],
                            "The cost review changed the original physical baseline")
                    before = {row["run_id"]: row["outputs"] for row in source_edition["report"]["alternatives"]}
                    after = {row["run_id"]: row["outputs"] for row in actual["alternatives"]}
                    require(after == before, "Reviewed costs changed the original physical alternatives or support")
                    (output / "field-cost-context.json").write_text(
                        json.dumps(cost_context, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    (output / "field-cost-preview.json").write_text(
                        json.dumps(cost_preview, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    capture("09-original-field-cost-preview-desktop.png")
                    page.set_viewport_size({"width": 720, "height": 1000})
                    dialog.get_by_role("heading", name="Review economic costs", exact=True).wait_for(state="visible")
                    capture("10-original-field-cost-preview-narrow.png")
                    page.set_viewport_size({"width": 1440, "height": 1000})
                    step.update(plan_id=plan["id"], revision=plan["revision"],
                                candidate_id=candidate["id"], operation_id=cost_preview["operation_id"],
                                original_review=descriptor(retained, output),
                                original_economic_edition_id=source_edition["id"],
                                ledger_row_counts={kind: sum(row["kind"] == kind for row in plan["budget_lines"])
                                                   for kind in ("budget", "commitment", "actual")},
                                ledger_totals_minor=cost_context["ledger_totals_minor"],
                                candidate_ledger_totals_minor=cost_context["candidate_ledger_totals_minor"],
                                costed_scenarios=sum(row.get("cost") is not None for row in actual["alternatives"]))

                with journal.stage("save_reviewed_input_and_complete_economic_edition") as step:
                    with page.expect_response(lambda response: is_action(
                            response, "implementation.cost-review.apply"), timeout=timeout) as pending:
                        dialog.locator('[data-cr-action="apply"]').click()
                    response = pending.value
                    check_response(response, "Original cost review queued action")
                    original_request = json.loads(response.request.post_data)
                    task = wait_task(response.json(), "implementation.cost-review.apply", refresh_economics=False)
                    result = task["result"]
                    require(result["operation_id"] == cost_preview["operation_id"]
                            and result["binding"] == cost_preview["binding"],
                            "The completed cost review changed its original preview identity")
                    reviewed = get("/api/economic-desk/edition", workspace=workspace,
                                   edition_id=result["edition"]["id"])
                    require(reviewed["input"] == cost_preview["proposed_input"],
                            "The completed Economic edition differs from the reviewed original input")
                    require(reviewed["report"]["baseline"]["outputs"] == source_edition["report"]["baseline"]["outputs"]
                            and {row["run_id"]: row["outputs"] for row in reviewed["report"]["alternatives"]} == before,
                            "The completed cost review changed physical model quantities")
                    source_review = reviewed["input"]["selection"]["field12_cost_reviews"][result["operation_id"]]
                    require(source_review == cost_preview["source_audit"],
                            "The saved selection lost original ledger rows, allocations or forecast sources")
                    current = get("/api/implementation/detail", workspace=workspace, id=plan["id"])
                    require(current["plan"] == plan, "The cost review changed its original saved field plan")
                    replay_response = context.request.post(
                        origin + "/api/actions", headers={"Authorization": "Bearer " + token},
                        data=original_request, max_redirects=0)
                    check_response(replay_response, "Reopen the same original cost operation")
                    replay = replay_response.json()
                    require(replay["id"] == task["id"], "The repeated original request created another task")
                    original = get("/api/task", id=task["id"])
                    require(original["state"] == "complete"
                            and original["result"]["edition"]["id"] == reviewed["id"],
                            "The original cost task changed its completed Economic edition")
                    fresh = get("/api/implementation-costs/detail", workspace=workspace,
                                operation_id=result["operation_id"])
                    require(fresh["draft"]["id"] == result["draft"]["id"]
                            and fresh["edition"]["id"] == result["edition"]["id"],
                            "The refreshed review receipt replaced its original saved items")
                    (output / "field-cost-receipt.json").write_text(
                        json.dumps(fresh, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    (output / "field-cost-economic-edition.json").write_text(
                        json.dumps(reviewed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    record["implementation"]["cost_review"] = {
                        "operation_id": result["operation_id"], "task_id": task["id"],
                        "draft_id": result["draft"]["id"], "edition_id": reviewed["id"],
                        "original_plan_revision": plan["revision"],
                        "candidate_id": candidate["id"],
                        "original_economic_edition_id": source_edition["id"],
                        "ledger_row_counts": {kind: sum(row["kind"] == kind for row in plan["budget_lines"])
                                              for kind in ("budget", "commitment", "actual")},
                    }
                    step.update(**record["implementation"]["cost_review"])
                    journal.save()

                with journal.stage("open_complete_cost_package_and_reopen_native_edition") as step:
                    ticket = next(item for item in fresh["_downloads"]
                                  if item["filename"] == "cost-review-package.zip")
                    archive_path = output / "original-cost-review-package.zip"
                    data = download(ticket, archive_path)
                    package_record = next(item for item in fresh["files"]
                                          if item["path"].endswith("/cost-review-package.zip"))
                    require(len(data) == package_record["bytes"]
                            and hashlib.sha256(data).hexdigest() == package_record["sha256"],
                            "The downloaded cost package differs from its original retained bytes")
                    directory = output / "field-cost-review"
                    manifest = extract_edition(archive_path, directory,
                                               schema="upstate.implementation-cost-review-package/v1")
                    require(manifest["operation_id"] == result["operation_id"]
                            and manifest["draft_id"] == result["draft"]["id"]
                            and manifest["edition_id"] == reviewed["id"],
                            "The received cost package identifies another review")
                    require(json.loads((directory / "plan.json").read_text(encoding="utf-8")) == plan
                            and json.loads((directory / "source-audit.json").read_text(encoding="utf-8")) == source_review,
                            "The received cost package changed its original plan or source audit")
                    economic_directory = directory / "economic" / "edition"
                    economic_manifest = extract_edition(directory / "economic" / "decision-package.zip",
                                                        economic_directory)
                    require(economic_manifest["report_id"] == reviewed["report_id"],
                            "The nested Economic package belongs to another reviewed edition")
                    received_page = context.new_page()
                    received_page.goto((economic_directory / "index.html").as_uri(), wait_until="load")
                    received_page.locator("#application").wait_for(state="visible")
                    require(reviewed["report_id"] in received_page.locator("#footer-state").inner_text(),
                            "The outgoing offline cost edition opened another report")
                    received_page.screenshot(path=str(output / "11-received-cost-edition-desktop.png"), full_page=True)
                    received_page.set_viewport_size({"width": 720, "height": 1000})
                    received_page.locator("#application").wait_for(state="visible")
                    received_page.screenshot(path=str(output / "12-received-cost-edition-narrow.png"), full_page=True)
                    received_page.locator("#print-report").click()
                    received_page.pdf(path=str(output / "field-cost-economic-report.pdf"),
                                      prefer_css_page_size=True, print_background=True)
                    require((output / "field-cost-economic-report.pdf").read_bytes().startswith(b"%PDF"),
                            "The outgoing reviewed Economic edition could not produce its report PDF")
                    received_page.close()
                    dialog.locator('[data-cr-action="receipt-refresh"]').click()
                    dialog.get_by_role("heading", name="Saved Economic edition", exact=True).wait_for(state="visible")
                    capture("13-saved-field-cost-review-receipt.png")
                    dialog.locator('[data-cr-action="edition"]').click()
                    page.locator("[data-edition-frame]").wait_for(state="visible")
                    page.frame_locator("[data-edition-frame]").locator("#application").wait_for(state="visible")
                    require(reviewed["report_id"] in page.frame_locator("[data-edition-frame]").locator("#footer-state").inner_text(),
                            "The mounted Economic opener selected another completed edition")
                    capture("14-reopened-reviewed-economic-desk.png")
                    step.update(package=archive_path.name, verified_members=len(manifest["members"]),
                                economic_members=len(economic_manifest["members"]), edition_id=reviewed["id"])

                if args.compare_editions:
                    receive_saved_comparison(source_edition, reviewed)

            if existing_cost_plan:
                with journal.stage("reopen_existing_native_plan_with_original_ledger") as step:
                    plan = existing_cost_plan["plan"]
                    candidate = existing_cost_plan["candidate"]
                    source_edition = existing_cost_plan["edition"]
                    binding = existing_cost_plan["binding"]
                    plan_id, revision = plan["id"], plan["revision"]
                    require(source_edition["report"]["baseline"]["run_id"] == edition["report"]["baseline"]["run_id"]
                            and source_edition["report"]["baseline"]["outputs"] == edition["report"]["baseline"]["outputs"]
                            and {row["run_id"]: row["outputs"] for row in source_edition["report"]["alternatives"]}
                                == {row["run_id"]: row["outputs"] for row in edition["report"]["alternatives"]},
                            "The current source journey differs from the saved candidate's physical baseline, cohort or support")
                    require(binding["report_id"] == source_report_id
                            and binding["report_sha256"] == record["source_report_sha256"]
                            and binding["zone_id"] == zone_id
                            and binding["run_id"] == chosen["run_id"],
                            "The existing implementation candidate belongs to another physical source or zone")
                    close_details()
                    page.locator('[data-view="implementation"]').click()
                    selector = page.locator('[data-impl-change="plan"]')
                    selector.wait_for(state="visible")
                    page.wait_for_function(
                        "(id) => Array.from(document.querySelector('[data-impl-change=plan]')?.options||[])"
                        ".some(option => option.value===id)", arg=plan_id)
                    selector.select_option(plan_id)
                    page.wait_for_function(
                        "(id) => document.querySelector('.iw-footer span')?.textContent===id", arg=plan_id)
                    previous_footer = page.locator(".iw-footer").element_handle()
                    with page.expect_response(lambda response:
                                              urlsplit(response.url).path == "/api/implementation/detail"
                                              and response.request.method == "GET"
                                              and parse_qs(urlsplit(response.url).query).get("id") == [plan_id]) as pending:
                        page.locator('[data-impl="reopen"]').click()
                    response = pending.value
                    check_response(response, "Reopen the selected saved native plan")
                    detail = response.json()
                    require(detail["plan"] == plan
                            and detail["document_digest"] == binding["document_digest"],
                            "The saved plan changed after source selection; choose and review its current revision again")
                    page.wait_for_function("(element) => !element.isConnected", arg=previous_footer)
                    page.wait_for_function(
                        "(id) => document.querySelector('.iw-footer span')?.textContent===id", arg=plan_id)
                    record["implementation"] = {
                        "mode": "existing_native_plan", "plan_id": plan_id, "revision": revision,
                        "candidate_id": candidate["id"], "binding": binding,
                        "original_economic_edition_id": source_edition["id"],
                        "upstream_receiving_edition_id": edition["id"],
                        "ledger_row_counts": {kind: sum(row["kind"] == kind for row in plan["budget_lines"])
                                              for kind in ("budget", "commitment", "actual")},
                    }
                    journal.save()
                    (output / "implementation-native-plan.json").write_text(
                        json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    step.update(**record["implementation"])
                    capture("07-saved-native-scenario-plan.png")
            else:
                source_edition = edition
                with journal.stage("choose_original_scenario_for_implementation") as step:
                    page.locator('[data-econ="implementation-choose"][data-id="' + edition["id"] + '"]').first.click()
                    page.locator("[data-implementation-run]").wait_for(state="visible")
                    require(page.locator("[data-implementation-run]").input_value() == "",
                            "Implementation choice must begin with explicit scenario selection")
                    page.locator("[data-implementation-run]").select_option(chosen["run_id"])
                    capture("06-original-scenario-implementation-review.png")
                    page.locator('[data-econ="implementation-open"]').click()
                    page.locator('[aria-label="Economic scenario handoff"]').wait_for(state="visible")
                    step.update(edition_id=edition["id"], run_id=chosen["run_id"], zone_id=zone_id)
                    journal.save()

                with journal.stage("create_native_plan_and_import_original_scenario") as step:
                    timeout = args.task_timeout_seconds * 1000
                    with page.expect_response(lambda response: is_action(response, "implementation.source.import"),
                                              timeout=timeout) as imported_response:
                        with page.expect_response(lambda response: is_action(response, "implementation.plan.create"),
                                                  timeout=timeout) as created_response:
                            page.locator('[data-impl="economic-new"]').click()
                        response = created_response.value
                        check_response(response, "Original implementation plan creation")
                        created = wait_task(response.json(), "implementation.plan.create", refresh_economics=False)
                    response = imported_response.value
                    check_response(response, "Original economic scenario source import")
                    imported = wait_task(response.json(), "implementation.source.import", refresh_economics=False)
                    plan_id = imported["result"]["plan_id"]
                    revision = imported["result"]["revision"]
                    require(plan_id == created["result"]["plan_id"],
                            "The economic scenario was imported into another plan")
                    detail = get("/api/implementation/detail", workspace=workspace, id=plan_id, revision=revision)
                    plan = detail["plan"]
                    require(plan["id"] == plan_id and plan["revision"] == revision,
                            "The reopened implementation plan differs from the completed original task")
                    require(len(plan["candidates"]) == 1, "The chosen whole scenario must remain one candidate")
                    candidate = plan["candidates"][0]
                    link = next(item for item in plan["source_links"]
                                if item["id"] == candidate["source"]["source_link_id"])
                    snapshot = link["snapshot"]
                    binding = snapshot["binding"]
                    expected_binding = {"edition_id": edition["id"], "run_id": chosen["run_id"],
                                        "report_id": source_report_id,
                                        "report_sha256": record["source_report_sha256"], "zone_id": zone_id}
                    require(binding == expected_binding,
                            "The native plan lost the original edition, scenario, report, source hash or zone")
                    require(snapshot["economic_report"] == edition["report"],
                            "The plan's retained economic source differs from the selected original edition")
                    original_row = candidate["source"]["row_snapshot"]
                    require(original_row["original_alternative"] == chosen,
                            "The native plan changed the original complete scenario")
                    physical = {item["metric"]: item["output"] for item in candidate["modeled_benefits"]}
                    require(physical == chosen["outputs"],
                            "The native plan changed the original signed modeled quantities or spatial support")
                    original_cost = next((item for item in edition["input"]["selection"].get("costs", [])
                                          if item["run_id"] == chosen["run_id"]), None)
                    require(original_row["original_cost"] == original_cost,
                            "The plan changed the original estimate or its source footprint")
                    page.wait_for_function(
                        "(id) => document.querySelector('.iw-footer span')?.textContent===id && "
                        "document.querySelector('[aria-label=\"Economic scenario handoff\"] h3')?.textContent==='Economic source imported'",
                        arg=plan_id, timeout=timeout)
                    record["implementation"] = {"plan_id": plan_id, "revision": revision,
                                                 "binding": binding, "create_task_id": created["id"],
                                                 "source_import_task_id": imported["id"]}
                    journal.save()
                    (output / "implementation-native-plan.json").write_text(
                        json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    step.update(plan_id=plan_id, revision=revision, source_link_id=link["id"])
                    close_details()
                    capture("07-saved-native-scenario-plan.png")

            with journal.stage("export_original_implementation_plan") as step:
                close_details()
                with page.expect_download() as pending:
                    page.locator('[data-impl="export-json"]').first.click()
                exported = pending.value
                require(not exported.failure(), "The original implementation plan export failed")
                path = output / "implementation-portable-plan.json"
                exported.save_as(str(path))
                require(json.loads(path.read_text(encoding="utf-8-sig")) == plan,
                        "Portable implementation JSON differs from the saved source-linked native revision")
                step.update(plan_id=plan_id, revision=revision, file=path.name)

            with journal.stage("receive_original_implementation_report") as step:
                page.locator('[data-impl="tab"][data-tab="handover"]').click()
                with page.expect_response(lambda response: is_action(response, "implementation.plan.report"),
                                          timeout=args.task_timeout_seconds * 1000) as pending:
                    page.locator('[data-impl="native-report"]').click()
                response = pending.value
                check_response(response, "Original native implementation report action")
                reported = wait_task(response.json(), "implementation.plan.report", refresh_economics=False)
                result = reported["result"]
                require(result["plan_id"] == plan_id and result["revision"] == revision,
                        "The native implementation report selected another plan revision")
                tickets = {item["filename"]: item
                           for item in reported.get("_downloads", result.get("_downloads", []))}
                require("manifest.json" in tickets, "The original task has no retained implementation report manifest")
                directory = output / "implementation-report"
                directory.mkdir()
                manifest = json.loads(download(tickets["manifest.json"], directory / "manifest.json"))
                require(manifest["schema"] == "upstate.implementation-report/v1"
                        and manifest["plan_id"] == plan_id and manifest["revision"] == revision,
                        "The retained implementation manifest names another plan or revision")
                names = set()
                for item in manifest["files"]:
                    name = item["name"]
                    require(isinstance(name, str) and PurePosixPath(name).name == name
                            and name not in {"", ".", ".."} and "\\" not in name and name not in names,
                            "The retained implementation report member name is invalid")
                    names.add(name)
                    require(name in tickets, "The original report task is missing its " + name + " download")
                    data = download(tickets[name], directory / name)
                    require(len(data) == item.get("size_bytes", item.get("bytes"))
                            and hashlib.sha256(data).hexdigest() == item["sha256"],
                            "The retained implementation report member changed: " + name)
                require(json.loads((directory / "plan.json").read_text(encoding="utf-8")) == plan,
                        "The report package changed its original saved implementation plan")
                report_page = context.new_page()
                report_page.goto((directory / "report.html").as_uri(), wait_until="load")
                require(report_page.locator("h1").inner_text() == plan["title"],
                        "The native implementation report opened another plan")
                require(report_page.get_by_role("heading", name="Selected economic scenarios", exact=True).count() == 1,
                        "The report is missing its readable original economic scenario section")
                report_page.screenshot(path=str(output / "08-native-implementation-report.png"), full_page=True)
                report_page.pdf(path=str(output / "implementation-report.pdf"),
                                prefer_css_page_size=True, print_background=True)
                report_page.close()
                require((output / "implementation-report.pdf").read_bytes().startswith(b"%PDF"),
                        "The native implementation report did not produce its PDF")
                record["implementation"].update(report_task_id=reported["id"], report_directory=directory.name,
                                                 report_document_digest=manifest["document_digest"])
                step.update(plan_id=plan_id, revision=revision, verified_members=len(names),
                            document_digest=manifest["document_digest"])
            if args.cost_review:
                receive_cost_review(plan, candidate, source_edition)

        try:
            with journal.stage("open_original_operator") as step:
                page.goto(original_url, wait_until="load")
                page.locator('[data-view="economic-desk"]').wait_for(state="visible")
                if args.workspace_key and page.locator("#workspace-select").input_value() != args.workspace_key:
                    with page.expect_response(lambda response: urlsplit(response.url).path == "/api/state"
                                              and parse_qs(urlsplit(response.url).query).get("workspace") == [args.workspace_key]) as switched:
                        page.locator("#workspace-select").select_option(args.workspace_key)
                    check_response(switched.value, "Original workspace selection")
                workspace = page.locator("#workspace-select").input_value()
                require(workspace, "The original operator has no selected workspace")
                page.locator('[data-view="economic-desk"]').click()
                page.locator("[data-report]").wait_for(state="visible")
                extensions = get("/api/extensions", workspace=workspace)
                (output / "registered-extensions.json").write_text(json.dumps(extensions, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                catalog = get("/api/economic-desk/catalog", workspace=workspace)
                record["workspace_key"] = workspace
                step.update(workspace_key=workspace, completed_native_reports=len(catalog["reports"]))

            if args.cost_plan_id:
                with journal.stage("pin_existing_cost_plan_and_source_candidate") as step:
                    detail = get("/api/implementation/detail", workspace=workspace, id=args.cost_plan_id)
                    plan = detail["plan"]
                    require(plan["id"] == args.cost_plan_id and plan["revision"] > 0
                            and re.fullmatch(r"[0-9a-f]{64}", detail.get("document_digest", "")),
                            "Choose an actual saved native implementation plan with its retained digest")
                    cost_catalog = get("/api/implementation-costs/catalog", workspace=workspace,
                                       plan_id=plan["id"], revision=plan["revision"],
                                       document_digest=detail["document_digest"])
                    require(cost_catalog["workspace_key"] == workspace
                            and cost_catalog["plan"]["id"] == plan["id"]
                            and cost_catalog["plan"]["revision"] == plan["revision"]
                            and cost_catalog["plan"]["document_digest"] == detail["document_digest"],
                            "The cost catalogue differs from the selected saved plan")
                    (output / "existing-cost-plan-catalog.json").write_text(
                        json.dumps(cost_catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    matches = [
                        item for item in cost_catalog["candidates"]
                        if (not args.cost_candidate_id or item["id"] == args.cost_candidate_id)
                        and (not args.report_id or item["binding"]["report_id"] == args.report_id)
                        and (not args.zone_id or item["binding"]["zone_id"] == args.zone_id)
                        and (not args.run_id or item["binding"]["run_id"] == args.run_id)
                    ]
                    require(matches, "No valid original economic candidate matches the saved plan and supplied source filters. "
                            + json.dumps({"candidates": cost_catalog["candidates"],
                                          "issues": cost_catalog.get("issues", [])}))
                    require(len(matches) == 1,
                            "Choose --cost-candidate-id explicitly from the matching original candidates: "
                            + json.dumps([{"id": item["id"], "label": item["label"], "binding": item["binding"]}
                                          for item in matches]))
                    selected_candidate = matches[0]
                    binding = selected_candidate["binding"]
                    require(binding["plan_id"] == plan["id"]
                            and binding["revision"] == plan["revision"]
                            and binding["document_digest"] == detail["document_digest"],
                            "The selected candidate catalogue lost its exact saved-plan binding")
                    candidate = next(item for item in plan["candidates"] if item["id"] == selected_candidate["id"])
                    link = next(item for item in plan["source_links"]
                                if item["id"] == candidate["source"]["source_link_id"])
                    snapshot = link["snapshot"]
                    source_edition = get("/api/economic-desk/edition", workspace=workspace,
                                         edition_id=binding["edition_id"])
                    require(source_edition["id"] == binding["edition_id"]
                            and source_edition["input"] == snapshot["edition"]["input"]
                            and source_edition["report"] == snapshot["economic_report"]
                            and source_edition["producer_report_id"] == binding["report_id"]
                            and source_edition["zone_id"] == binding["zone_id"],
                            "The completed historical economic edition differs from the candidate's original snapshot")
                    require(all(source_edition["input"].get(key) == binding[key]
                                for key in ("report_id", "report_sha256", "zone_id")),
                            "The historical economic input differs from its original report hash or reporting zone")
                    source_alternative = next((row for row in source_edition["report"]["alternatives"]
                                               if row["run_id"] == binding["run_id"]), None)
                    require(source_alternative is not None
                            and candidate["source"]["row_snapshot"]["original_alternative"] == source_alternative
                            and {item["metric"]: item["output"] for item in candidate["modeled_benefits"]}
                                == source_alternative["outputs"],
                            "The saved candidate differs from its original physical alternative and support")
                    existing_cost_plan = {"plan": plan, "candidate": candidate, "binding": binding,
                                          "edition": source_edition}
                    selected_report_id, selected_zone_id, selected_run_id = (
                        binding["report_id"], binding["zone_id"], binding["run_id"])
                    (output / "existing-cost-plan-original.json").write_text(
                        json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    (output / "existing-cost-source-edition.json").write_text(
                        json.dumps(source_edition, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    record["existing_cost_plan"] = {
                        "plan_id": plan["id"], "revision": plan["revision"],
                        "document_digest": detail["document_digest"], "candidate_id": candidate["id"],
                        "binding": binding,
                        "ledger_row_counts": {kind: sum(row["kind"] == kind for row in plan["budget_lines"])
                                              for kind in ("budget", "commitment", "actual")},
                    }
                    step.update(**record["existing_cost_plan"])
                    journal.save()

            with journal.stage("choose_native_report_and_zone") as step:
                reports = catalog["reports"]
                selected = next((item for item in reports if item["id"] == selected_report_id), None) if selected_report_id else next(
                    (item for item in reports if item["alternative_count"] and item["ready_zones"]), None)
                require(selected is not None, "Choose a completed native report with available alternatives and a common-support zone")
                report_id = selected["id"]
                source = get("/api/economic-desk/source", workspace=workspace, report_id=report_id)
                if existing_cost_plan:
                    require(source["source"]["sha256"] == existing_cost_plan["binding"]["report_sha256"],
                            "The available native report bytes differ from the existing candidate's retained source")
                zones = source["zones"]
                zone = next((item for item in zones if item["zone_id"] == selected_zone_id), None) if selected_zone_id else next(
                    (item for item in zones if item["common_support_available"]), None)
                require(zone is not None and zone["common_support_available"],
                        "Choose a native zone with shared export support in this report")
                page.locator("[data-report]").select_option(report_id)
                page.wait_for_function("(id) => Array.from(document.querySelector('[data-zone]')?.options||[]).some(o=>o.value===id)",
                                       arg=zone["zone_id"])
                page.locator("[data-zone]").select_option(zone["zone_id"])
                page.locator('[data-econ="preview"]').wait_for(state="visible")
                selection = json.loads(Path(args.selection).read_text(encoding="utf-8-sig")) if args.selection else {}
                if args.selection:
                    validate_selection_scope(selection, source, zone)
                    retained_path = output / "original-selection.json"
                    shutil.copyfile(Path(args.selection), retained_path)
                    record["supplied_selection"] = descriptor(retained_path, output)
                    response = context.request.post(
                        origin + "/api/actions", headers={"Authorization": "Bearer " + token},
                        data={"workspace": workspace, "action": "economic.draft.save",
                              "payload": {"report_id": report_id,
                                          "report_sha256": source["source"]["sha256"],
                                          "zone_id": zone["zone_id"], "selection": selection},
                              "operation_id": uuid.uuid4().hex}, max_redirects=0)
                    check_response(response, "Import original input through the existing queue")
                    imported = wait_task(response.json(), "economic.draft.save")
                    imported_id = imported["result"]["id"]
                    expected_notes = "\n".join(imported["result"]["input"]["selection"].get("notes", []))
                    with page.expect_response(lambda response: urlsplit(response.url).path == "/api/economic-desk/draft"
                                              and parse_qs(urlsplit(response.url).query).get("draft_id") == [imported_id]) as opened:
                        page.locator('[data-econ="open-draft"][data-id="' + imported_id + '"]').click()
                    check_response(opened.value, "Open the original imported workspace inputs")
                    page.wait_for_function("(value) => document.querySelector('[data-field=notes]')?.value===value",
                                           arg=expected_notes)
                    require(page.locator("[data-zone]").input_value() == zone["zone_id"],
                            "Imported original inputs selected another native zone")
                    if args.notes:
                        page.locator('[data-field="notes"]').fill(
                            expected_notes + ("\n" if expected_notes else "") + args.notes)
                    step["imported_draft_id"] = imported_id
                else:
                    fill_default_inputs(page, args.notes)
                record.update(producer_report_id=report_id, zone_id=zone["zone_id"],
                              source_report_sha256=source["source"]["sha256"])
                step.update(title=source["title"], zone_title=zone["title"],
                            actual_pollutants=source["pollutants"], supplied_costs=len(selection.get("costs", [])))
                capture("01-native-report-zone-and-inputs.png")

            with journal.stage("calculate_native_decision_preview") as step:
                with page.expect_response(lambda response: urlsplit(response.url).path == "/api/economic-desk/preview"
                                          and response.request.method == "POST") as pending:
                    page.locator('[data-econ="preview"]').click()
                response = pending.value
                check_response(response, "Original decision preview")
                preview = response.json()["report"]
                page.locator("[data-preview]").wait_for(state="visible")
                step.update(report_id=preview["id"], modeled_metrics=list(preview["baseline"]["outputs"]),
                            alternatives=len(preview["alternatives"]))
                require(preview["scope"]["comparison_id"] == zone["comparison_id"],
                        "The preview belongs to another native reporting zone")
                (output / "native-preview.json").write_text(json.dumps(preview, indent=2, ensure_ascii=False) + "\n",
                                                            encoding="utf-8")
                capture("02-native-decision-preview.png")

            with journal.stage("save_and_reopen_original_inputs") as step:
                task = queued_action("economic.draft.save", "save-draft")
                draft_id = task["result"]["id"]
                expected_notes = "\n".join(task["result"]["input"]["selection"].get("notes", []))
                page.locator('[data-field="notes"]').fill("Unsaved receiving edit; reopen the saved workspace inputs.")
                page.locator('[data-econ="open-draft"][data-id="' + draft_id + '"]').click()
                page.wait_for_function("(value) => document.querySelector('[data-field=notes]')?.value===value",
                                       arg=expected_notes)
                require(page.locator('[data-zone]').input_value() == zone["zone_id"],
                        "Reopened original inputs selected another native zone")
                step["draft_id"] = draft_id
                capture("03-reopened-source-bound-inputs.png")

            with journal.stage("build_through_original_queue") as step:
                task = queued_action("economic.edition.build", "build")
                edition_id = task["result"]["id"]
                edition = get("/api/economic-desk/edition", workspace=workspace, edition_id=edition_id)
                require(edition["producer_report_id"] == report_id and edition["zone_id"] == zone["zone_id"],
                        "The completed operator edition belongs to another native report or zone")
                require(edition["report"]["id"] == preview["id"],
                        "Saved and reopened operator inputs changed the preview's decision identity")
                record.update(edition_id=edition_id, report_id=edition["report_id"])
                step.update(edition_id=edition_id, report_id=edition["report_id"])
                (output / "operator-edition.json").write_text(json.dumps(edition, indent=2, ensure_ascii=False) + "\n",
                                                              encoding="utf-8")
                page.locator('[data-econ="open-edition"][data-id="' + edition_id + '"]').click()

            with journal.stage("open_typed_embedded_desk_and_save") as step:
                page.locator("[data-edition-frame]").scroll_into_view_if_needed()
                desk = page.frame_locator("[data-edition-frame]")
                desk.locator("#application").wait_for(state="visible")
                require(edition["report_id"] in desk.locator("#footer-state").inner_text(),
                        "The typed embedded preview opened another report")
                desk.locator("#reset-filters").click()
                candidates = edition["report"]["alternatives"]
                chosen = next((item for item in candidates if item["run_id"] == selected_run_id), None) if selected_run_id else next(
                    (item for item in candidates if item.get("decision", {}).get("eligible")
                     and item.get("decision", {}).get("pareto")), candidates[0] if candidates else None)
                require(chosen is not None and re.fullmatch(r"[0-9a-f]{64}", chosen["id"]),
                        "Choose an available original scenario for the embedded journey")
                desk.locator('#panel-overview tbody button[data-select="' + chosen["id"] + '"]').click()
                require(desk.locator("#panel-detail .scenario-heading .mono").inner_text() == chosen["run_id"],
                        "The embedded selected case has another native run identity")
                previous_notes = desk.locator("#decision-notes").input_value()
                embedded_notes = previous_notes + ("\n" if previous_notes else "") + "Operator walkthrough selected original run " + chosen["run_id"] + "."
                desk.locator("#decision-notes").fill(embedded_notes)
                with page.expect_download() as pending:
                    desk.locator("#save-desk").click()
                downloaded = pending.value
                require(not downloaded.failure(), "The typed embedded desk could not save its working HTML")
                saved_path = output / "embedded-saved-desk.html"
                downloaded.save_as(str(saved_path))
                step.update(run_id=chosen["run_id"], saved_desk=saved_path.name)
                record["selected_run_id"] = chosen["run_id"]
                capture("04-live-typed-economic-desk.png")
                saved_page = context.new_page()
                saved_page.goto(saved_path.as_uri(), wait_until="load")
                saved_page.locator("#application").wait_for(state="visible")
                require(saved_page.locator("#decision-notes").input_value() == embedded_notes,
                        "The HTML saved from the typed preview lost its working notes")
                require(saved_page.locator("#panel-detail .scenario-heading .mono").inner_text() == chosen["run_id"],
                        "The HTML saved from the typed preview lost its native scenario")
                saved_page.screenshot(path=str(output / "05-reopened-embedded-desk.png"), full_page=True)
                saved_page.locator("#print-report").click()
                saved_page.pdf(path=str(output / "embedded-decision-report.pdf"),
                               prefer_css_page_size=True, print_background=True)
                require((output / "embedded-decision-report.pdf").read_bytes().startswith(b"%PDF"),
                        "The saved embedded desk did not produce its PDF")
                saved_page.close()

            with journal.stage("receive_original_complete_package") as step:
                ticket = next(item for item in edition["_downloads"] if item["filename"] == "decision-package.zip")
                response = context.request.get(origin + ticket["url"],
                                               headers={"Authorization": "Bearer " + token}, max_redirects=0)
                check_response(response, "Original complete package download")
                data = response.body()
                expected = edition["files"]["complete_package"]
                require(len(data) == expected["bytes"] and hashlib.sha256(data).hexdigest() == expected["sha256"],
                        "The downloaded complete package differs from its retained source descriptor")
                archive_path = output / "original-decision-package.zip"
                archive_path.write_bytes(data)
                destination = output / "decision-edition"
                manifest = extract_edition(archive_path, destination)
                require(manifest["report_id"] == edition["report_id"],
                        "The verified complete package belongs to another economic report")
                step.update(bytes=len(data), sha256=expected["sha256"],
                            verified_members=len(manifest["members"]))
            if args.implementation or args.cost_review:
                receive_implementation(edition, chosen, workspace, report_id, zone["zone_id"])
            return destination
        except Exception:
            if page is not None:
                try:
                    capture("operator-failure-state.png")
                    record["visible_operator_status"] = page.locator("[data-status]").inner_text()
                except Exception:
                    pass
            raise
        finally:
            context.close()
            browser.close()



class PhaseJournal(Journal):
    """Durable request journal for the phased operation; old course unchanged."""
    def save(self):
        target = self.root / "operator-journey.json"
        temporary = target.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(self.clean(self.record), handle, indent=2, ensure_ascii=False, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
        if os.name != "nt":
            handle = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(handle)
            finally:
                os.close(handle)


class NativeHTTPError(RuntimeError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class NativeHTTP:
    """Original authenticated API only; never forward its capability on redirects."""
    def __init__(self, origin, token, timeout):
        from urllib.request import build_opener, HTTPRedirectHandler
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        self.origin, self.token, self.timeout = origin, token, timeout
        self.opener = build_opener(NoRedirect())
        self.resume_interrupted_tasks = False

    def _url(self, path, query=None):
        require(isinstance(path, str) and path.startswith("/") and not path.startswith("//")
                and not urlsplit(path).scheme and not urlsplit(path).netloc,
                "Use a relative endpoint on the original authenticated operator.")
        return self.origin + path + (("?" + urlencode(query)) if query else "")

    def open(self, path, *, method="GET", body=None, raw=None, workspace=None,
             filename=None, query=None, length=None):
        from urllib.request import Request
        from urllib.error import HTTPError
        headers = {"Authorization": "Bearer " + self.token}
        if workspace:
            headers["X-Workspace"] = workspace
        if body is not None:
            raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if filename:
            from urllib.parse import quote
            headers["X-Upload-Filename"] = quote(filename, safe="")
            headers["Content-Type"] = "application/octet-stream"
        if length is not None:
            headers["Content-Length"] = str(length)
        try:
            return self.opener.open(Request(self._url(path, query), data=raw,
                                           headers=headers, method=method), timeout=self.timeout)
        except HTTPError as error:
            text = error.read(65536).decode("utf-8", errors="replace").replace(self.token, "[redacted]")
            raise NativeHTTPError(error.code, "Original operator HTTP " + str(error.code) + ": " + text) from error

    def json(self, path, **options):
        with self.open(path, **options) as response:
            return json.load(response)

    def get(self, path, **query):
        return self.json(path, query=query)

    def post(self, path, body, workspace):
        return self.json(path, method="POST", body=body, workspace=workspace)

    def download(self, item, target, *, expected=None):
        expected = expected or item
        require(isinstance(item.get("url"), str), "The original operator returned no download URL.")
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and expected.get("sha256"):
            if target.stat().st_size == expected.get("bytes") and digest(target) == expected["sha256"]:
                return
        pending = target.with_name("." + target.name + ".receiving")
        try:
            with self.open(item["url"]) as response, pending.open("wb") as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            require(pending.stat().st_size > 0, "The original download is empty.")
            if expected.get("bytes") is not None:
                require(pending.stat().st_size == expected["bytes"], "The downloaded original byte count changed.")
            if expected.get("sha256"):
                require(digest(pending) == expected["sha256"], "The downloaded original SHA256 changed.")
            pending.replace(target)
        finally:
            pending.unlink(missing_ok=True)


def _phase_save(journal, name, value):
    path = journal.root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(journal.clean(value), ensure_ascii=False, sort_keys=True,
                      indent=2, allow_nan=False) + "\n"
    if path.is_file():
        require(json.loads(path.read_text(encoding="utf-8")) == journal.clean(value),
                "The retained native receiving member changed: " + name)
    else:
        temporary = path.with_name("." + path.name + ".receiving")
        with temporary.open("w", encoding="utf-8") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    return descriptor(path, journal.root)


def _native_queue(api, journal, name, workspace, action, payload, timeout):
    """Persist the original outer queue operation ID before its first POST."""
    requests = journal.record.setdefault("native_requests", {})
    if name in requests:
        slot = requests[name]
        request = slot["request"]
        require(request["workspace"] == workspace and request["action"] == action
                and request["payload"] == payload,
                "The retained task request changed; do not replace its original operation.")
    else:
        request = {"workspace": workspace, "action": action, "payload": payload,
                   "operation_id": uuid.uuid4().hex}
        slot = {"request": request, "created_at": now(), "state": "prepared"}
        requests[name] = slot
        journal.save()
    task = None
    if slot.get("task_id"):
        # An existing failed/interrupted task is retained for its native recovery;
        # do not issue a replacement operation or repeat its model work.
        task = api.get("/api/task", id=slot["task_id"])
    if task is None:
        slot["state"] = "submitting"
        journal.save()
        result = api.post("/api/actions", request, workspace)
        task = result.get("task", result)
        slot.update(task_id=task["id"], state=task["state"])
        journal.save()
    deadline = time.monotonic() + timeout
    resumed = False
    while True:
        require(task["workspace"] == workspace and task["action"] == action
                and task["id"] == slot["task_id"] and task["payload"] == payload,
                "The original queued task differs from its retained request.")
        slot["state"] = task["state"]
        journal.save()
        if task["state"] == "complete":
            break
        if task["state"] in {"failed", "cancelled", "interrupted"}:
            require(api.resume_interrupted_tasks and not resumed,
                    "Original task " + task["id"] + " is " + task["state"] +
                    "; repair the cause, then resume this journey with --resume-interrupted-tasks: " +
                    json.dumps(task.get("error")))
            slot.setdefault("resume_attempts", []).append({"at": now(), "task_id": task["id"],
                                                         "previous_state": task["state"]})
            journal.save()
            result = api.post("/api/task/resume", {"id": task["id"]}, workspace)
            task = result.get("task", result)
            resumed = True
            continue
        require(time.monotonic() < deadline,
                "Original task " + task["id"] + " remains " + task["state"] +
                "; resume this same journey to rejoin it.")
        time.sleep(1)
        task = api.get("/api/task", id=task["id"])
    # POST submit/resume returns a raw stored task; GET applies the existing
    # download decorators even when a completed response was being recovered.
    task = api.get("/api/task", id=slot["task_id"])
    require(task["id"] == slot["task_id"] and task["workspace"] == workspace
            and task["action"] == action and task["payload"] == payload and task["state"] == "complete",
            "The completed original task changed before decorated reopening.")
    slot["result"] = task["result"]
    slot["finished_at"] = slot.get("finished_at") or now()
    journal.save()
    return task


def _native_member(api, journal, item, name, *, expected=None):
    path = journal.root / name
    api.download(item, path, expected=expected)
    return descriptor(path, journal.root)


def _native_ticket(items, filename):
    matches = [item for item in items if item.get("filename") == filename
               or PurePosixPath(item.get("path", "")).name == filename]
    require(len(matches) == 1, "Choose the exact original download: " + filename)
    return matches[0]


def _native_validate_physical(first, second):
    require(first["report"]["baseline"]["outputs"] == second["report"]["baseline"]["outputs"]
            and {row["run_id"]: row["outputs"] for row in first["report"]["alternatives"]}
                == {row["run_id"]: row["outputs"] for row in second["report"]["alternatives"]},
            "The completed reviewed edition changed original physical quantities or support.")


def _native_relative(value):
    require(isinstance(value, str) and value and "\\" not in value and "\0" not in value
            and not PurePosixPath(value).is_absolute()
            and all(part not in {"", ".", ".."} for part in value.split("/")),
            "Use the exact canonical original relative member path.")
    return PurePosixPath(value)


def _phase_extract(archive_path, destination, *, schema="upstate.decision-delivery/v1"):
    """Verify and reuse completed extraction; never erase an interrupted original."""
    if destination.exists():
        manifest_path = destination / "manifest.json"
        require(manifest_path.is_file(), "The retained extraction lacks its original manifest.")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        require(manifest.get("schema") == schema, "The retained package schema changed.")
        for item in manifest["members"]:
            path = destination / _native_relative(item["path"])
            require(path.is_file() and not path.is_symlink()
                    and path.stat().st_size == item["bytes"] and digest(path) == item["sha256"],
                    "An extracted original package member changed: " + item["path"])
        return manifest
    staging = destination.with_name("." + destination.name + "-" + uuid.uuid4().hex + ".receiving")
    manifest = extract_edition(archive_path, staging, schema=schema)
    staging.replace(destination)
    return manifest


def _native_report_selection(report):
    selection = report["edition"]["render_identity"]["selection"]
    return selection.get("observed_context_sources") or [selection["source_roles"]["OBSERVED_CONTEXT"]]


def _native_report_snapshot(report):
    return {"edition": report["edition"],
            "files": [{key: item[key] for key in ("role", "path", "bytes", "sha256")}
                      for item in report["files"]]}


def _native_report_files(api, journal, report):
    result = []
    for item in report["files"]:
        relative = _native_relative(item["path"])
        value = _native_member(api, journal, item,
                               "comparison-scientific-report/" + relative.as_posix())
        value.update(original_path=item["path"], original_role=item["role"])
        result.append(value)
    require(any(item["original_role"] == "report_html" for item in result),
            "The original scientific report has no retained HTML output.")
    return result


def _native_check_received(api, workspace, record):
    value = record["economic_comparison_report"]
    detail = api.get("/api/study-transfer/received-detail", workspace=workspace, study_id=value["study_id"])
    require(detail["workspace_key"] == workspace and detail["id"] == value["study_id"]
            and detail["project"]["id"] == record["project_id"],
            "The received Study changed its original project or selection.")
    pair = value["source_pair"]
    rows = detail.get("economic_comparison_sources") or []
    matches = [(index, row) for index, row in enumerate(rows)
               if row.get("native_origin", {}).get("comparison_id") == value["comparison_id"]
               and all(row.get(key) == field for key, field in pair.items())]
    require(len(matches) == 1, "The received Study omitted or repeated its original Economic comparison source.")
    index, row = matches[0]
    require(row["relationship"] == "same_project"
            and row["native_comparison"]["id"] == value["comparison_id"],
            "The original comparison was not restored as native history.")
    comparison = api.get("/api/economic-comparison/detail", workspace=workspace, id=value["comparison_id"])
    require(comparison["input"] == record["economic_comparison"]["input"],
            "The received comparison selected different original editions.")
    report = api.get("/api/source-reports/scientific-edition", workspace=workspace, id=value["report_id"])
    require(report["edition"]["id"] == value["report_id"] and report["edition"]["state"] == "complete"
            and _native_report_selection(report) == _phase_report_choices(record),
            "The restored scientific report changed its saved original sources.")
    return detail, index, row, comparison, report



def _phase_json(journal, name, build):
    path = journal.root / name
    files = journal.record.setdefault("native_files", {})
    if path.is_file():
        if name in files:
            item = files[name]
            require(path.stat().st_size == item["bytes"] and digest(path) == item["sha256"],
                    "A retained native receiving response changed: " + name)
        value = json.loads(path.read_text(encoding="utf-8"))
    else:
        value = build()
        _phase_save(journal, name, value)
    files[name] = descriptor(path, journal.root)
    journal.save()
    return value



def _phase_plan_choice(selected):
    return selected.get("implementation_report", {"enabled": False, "as_of": None})


def _phase_report_choices(record):
    value = record["economic_comparison_report"]
    return value.get("source_pairs") or [value["source_pair"]]


def _native_plan_source(args, api, journal, workspace, selected):
    """Use the original report producer; never replace or edit the selected plan."""
    binding = selected["binding"]
    choice = _phase_plan_choice(selected)
    task = _native_queue(api, journal, "implementation_plan_report", workspace,
                         "implementation.plan.report",
                         {"id": binding["plan_id"], "revision": binding["revision"],
                          "as_of": choice["as_of"]}, args.task_timeout_seconds)
    result = task["result"]
    require(result["plan_id"] == binding["plan_id"] and result["revision"] == binding["revision"]
            and result["as_of"] == choice["as_of"], "The plan report changed its pinned revision or date.")
    preview = _phase_json(journal, "implementation-plan-source-preview.json", lambda:
        api.post("/api/implementation/report-source-preview",
                 {"plan_id": binding["plan_id"], "report_id": result["report_id"]}, workspace))
    wanted = {"plan_id": binding["plan_id"], "revision": binding["revision"],
              "document_digest": binding["document_digest"]}
    require(all(preview["plan_binding"][key] == value for key, value in wanted.items())
            and preview["as_of"] == choice["as_of"] and not preview["delivery_selection_supplied"],
            "The whole-plan scientific source changed its original saved revision.")
    imported = _native_queue(api, journal, "implementation_plan_source", workspace,
        "implementation.report-source.import",
        {"plan_id": binding["plan_id"], "report_id": result["report_id"],
         "expected_operation_id": preview["operation_id"]}, args.task_timeout_seconds)
    source = api.get("/api/implementation/report-source-detail", workspace=workspace,
                     source_key=imported["result"]["source_key"], operation_id=preview["operation_id"])
    require(source["state"] == "imported" and source["operation_id"] == preview["operation_id"]
            and source["report_id"] == result["report_id"]
            and all(source["plan_binding"][key] == value for key, value in wanted.items())
            and all(source[key] == imported["result"][key] for key in
                    ("source_key", "source_collection_id", "source_id")),
            "The retained whole-plan report source changed its accepted identity.")
    pair = {key: source[key] for key in ("source_collection_id", "source_id")}
    journal.record["implementation_plan_handoff"] = {
        "binding": wanted, "as_of": choice["as_of"], "report_id": result["report_id"],
        "report_task_id": task["id"], "source_task_id": imported["id"],
        "source_key": source["source_key"], "source_operation_id": source["operation_id"],
        "source_pair": pair, "source_identity": preview["source_identity"]}
    _phase_save(journal, "implementation-plan-source.json",
                {key: value for key, value in source.items() if key != "_downloads"})
    journal.save()
    return pair


def _native_plan_field(detail, record):
    value = record["implementation_plan_handoff"]
    pair, wanted = value["source_pair"], value["binding"]
    rows = [(index, row) for index, row in enumerate(detail.get("field_sources", []))
            if all(row.get(key) == item for key, item in pair.items())]
    require(len(rows) == 1, "The received Study lost or repeated its whole-plan source.")
    index, row = rows[0]
    native = row.get("native_plan") or {}
    require(row["source_family"] == "report"
            and row["source_identity"] == value["source_identity"]
            and native.get("plan_id") == wanted["plan_id"]
            and native.get("selected_revision") == wanted["revision"]
            and native.get("selected_document_digest") == wanted["document_digest"]
            and native.get("selected_report_id") == value["report_id"],
            "The received Study lost its exact original editable plan revision.")
    return index, row


def _native_check_plan(api, journal, workspace, detail):
    index, row = _native_plan_field(detail, journal.record)
    wanted = journal.record["implementation_plan_handoff"]["binding"]
    selected = api.get("/api/implementation/detail", workspace=workspace,
                       id=wanted["plan_id"], revision=wanted["revision"])
    original = json.loads((journal.root / "existing-cost-plan-original.json").read_text(encoding="utf-8"))
    require(selected["document_digest"] == wanted["document_digest"] and selected["plan"] == original,
            "The received original plan, source metadata, tasks or budgets changed.")
    current = api.get("/api/implementation/detail", workspace=workspace, id=wanted["plan_id"])
    require(current["plan"]["id"] == wanted["plan_id"]
            and current["plan"]["revision"] >= wanted["revision"],
            "The received current plan is missing its original revision history.")
    return index, row, selected, current


def _native_capture_plan_lineage(api, journal, workspace, study):
    value = journal.record["implementation_plan_handoff"]
    pair, wanted = value["source_pair"], value["binding"]
    rows = [row for row in study["identity"].get("implementation_report_sources", [])
            if all(row.get(key) == item for key, item in pair.items())]
    require(len(rows) == 1, "The Study archive omitted its complete native Implementation lineage.")
    row = rows[0]
    native = row.get("native_plan") or {}
    require(row["source_identity"] == value["source_identity"]
            and native.get("plan_id") == wanted["plan_id"]
            and native.get("selected_revision") == wanted["revision"]
            and native.get("selected_document_digest") == wanted["document_digest"]
            and native.get("selected_report_id") == value["report_id"],
            "The captured editable work plan differs from its original source report.")
    captured = api.get("/api/implementation/detail", workspace=workspace,
                       id=wanted["plan_id"], revision=native["revision"])
    require(captured["document_digest"] == native["document_digest"],
            "The Study's captured current plan differs from its original saved revision.")
    _phase_save(journal, "implementation-plan-captured-current.json", captured["plan"])
    value["captured_native_plan"] = native
    journal.save()


def _receiving_plan_change(before, after, task_id, note, *, saved):
    """Permit only this receiving note and the native revision/time stamps."""
    expected = json.loads(json.dumps(before))
    matches = [row for row in expected["tasks"] if row["id"] == task_id]
    require(len(matches) == 1, "The receiving note no longer names its original work task.")
    matches[0]["notes"] = note
    ignored = {"updated_at"}
    if saved:
        require(after["revision"] == before["revision"] + 1, "The receiving edit must commit one revision.")
        ignored.add("revision")
    require({key: value for key, value in after.items() if key not in ignored}
            == {key: value for key, value in expected.items() if key not in ignored},
            "The receiving edit changed more than its explicit note; quantities and source definitions must stay exact.")

def receive_native_phase(args, api, journal):
    """Complete the existing provider workflow without a browser dependency."""
    record, output = journal.record, journal.root
    workspace = record.get("workspace_key") or args.workspace_key
    require(workspace, "The native phase requires the original --workspace-key.")
    require(args.cost_plan_id or record.get("native_input") or (output / "native-input.json").is_file(),
            "The native phase uses --cost-plan-id from the completed original programme binder.")
    record["workspace_key"] = workspace
    journal.save()
    with journal.stage("native_pin_original_plan_and_cost_review"):
        def pin():
            require(args.cost_review, "Supply the original --cost-review JSON.")
            detail = api.get("/api/implementation/detail", workspace=workspace, id=args.cost_plan_id)
            plan = detail["plan"]
            catalog = api.get("/api/implementation-costs/catalog", workspace=workspace,
                              plan_id=plan["id"], revision=plan["revision"],
                              document_digest=detail["document_digest"])
            candidates = [
                row for row in catalog["candidates"]
                if (not args.cost_candidate_id or row["id"] == args.cost_candidate_id)
                and all(not getattr(args, key) or row["binding"][key] == getattr(args, key)
                        for key in ("report_id", "zone_id", "run_id"))
            ]
            require(len(candidates) == 1,
                    "Select one exact original candidate with --cost-candidate-id: " +
                    json.dumps([{"id": row["id"], "binding": row["binding"]} for row in candidates]))
            candidate = candidates[0]
            binding = candidate["binding"]
            require(binding["plan_id"] == plan["id"] and binding["revision"] == plan["revision"]
                    and binding["document_digest"] == detail["document_digest"],
                    "The original cost catalogue changed its saved-plan identity.")
            source_path = Path(args.cost_review).resolve(strict=True)
            require(source_path.is_file() and source_path.stat().st_size <= 16 * 1024 * 1024,
                    "Choose the original cost review JSON within 16 MiB.")
            supplied = json.loads(source_path.read_text(encoding="utf-8-sig"))
            raw_path = output / "original-field-cost-review-source.json"
            if raw_path.exists():
                require(raw_path.stat().st_size == source_path.stat().st_size
                        and digest(raw_path) == digest(source_path), "The original review source bytes changed.")
            else:
                temporary = output / ".original-field-cost-review-source.receiving"
                with source_path.open("rb") as incoming, temporary.open("wb") as target:
                    shutil.copyfileobj(incoming, target, length=1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                temporary.replace(raw_path)
            if "binding" in supplied:
                require(supplied["binding"] == binding, "The review names another saved plan.")
            review = supplied.get("review", supplied)
            require(review.get("schema") == "upstate.implementation-cost-review-selection/v1",
                    "Use the explicit original cost-review selection.")
            _phase_save(journal, "original-field-cost-review.json", supplied)
            _phase_save(journal, "existing-cost-plan-original.json", plan)
            return {"workspace_key": workspace, "binding": binding,
                    "review": review, "plan_id": plan["id"], "candidate_id": candidate["id"],
                    "review_source": descriptor(raw_path, output), "review_source_path": str(source_path),
                    "implementation_report": {
                        "enabled": args.include_implementation_plan,
                        "as_of": (args.implementation_report_as_of or review.get("as_of"))
                                  if args.include_implementation_plan else None}}
        selected = _phase_json(journal, "native-input.json", pin)
        record["native_input"] = selected
        report_choice = _phase_plan_choice(selected)
        require(not args.include_implementation_plan or report_choice["enabled"],
                "This original journey did not select editable plan transfer; start a separate explicit journey.")
        if args.implementation_report_as_of:
            require(report_choice["enabled"] and args.implementation_report_as_of == report_choice["as_of"],
                    "The resumed whole-plan report date differs from its pinned selection.")
        if report_choice["enabled"]:
            require(isinstance(report_choice["as_of"], str)
                    and re.fullmatch(r"\d{4}-\d{2}-\d{2}", report_choice["as_of"]) is not None
                    and datetime.strptime(report_choice["as_of"], "%Y-%m-%d").strftime("%Y-%m-%d") == report_choice["as_of"],
                    "Choose an explicit original plan report date as YYYY-MM-DD.")
        binding = selected["binding"]
        retained_review = selected["review_source"]
        retained_path = output / _native_relative(retained_review["path"])
        require(retained_path.stat().st_size == retained_review["bytes"]
                and digest(retained_path) == retained_review["sha256"],
                "The retained original review bytes changed.")
        require(selected["workspace_key"] == workspace,
                "Resume the native phase in its original operator Workspace.")
        if args.cost_plan_id:
            require(args.cost_plan_id == selected["plan_id"], "The resumed plan differs.")
        if args.cost_candidate_id:
            require(args.cost_candidate_id == selected["candidate_id"], "The resumed candidate differs.")
        if args.cost_review:
            supplied_path = Path(args.cost_review).resolve()
            if supplied_path.exists():
                require(supplied_path.is_file() and supplied_path.stat().st_size == retained_review["bytes"]
                        and digest(supplied_path) == retained_review["sha256"],
                        "The resumed original cost review bytes changed.")
                supplied = json.loads(supplied_path.read_text(encoding="utf-8-sig"))
                require(supplied.get("review", supplied) == selected["review"],
                        "The resumed original cost review changed.")
            else:
                require(str(supplied_path) == selected["review_source_path"],
                        "A missing replacement review is not the retained original source path.")
                # Its pinned exact bytes were verified above; staging may have
                # been retired after the original input was accepted.
        base = {key: binding[key] for key in ("plan_id", "revision", "document_digest", "candidate_id")}
        original = api.get("/api/economic-desk/edition", workspace=workspace, edition_id=binding["edition_id"])
        require(original["id"] == binding["edition_id"]
                and all(original["input"][key] == binding[key]
                        for key in ("report_id", "report_sha256", "zone_id")),
                "The original source edition no longer matches the candidate binding.")
        plan = api.get("/api/implementation/detail", workspace=workspace,
                       id=binding["plan_id"], revision=binding["revision"])
        require(plan["document_digest"] == binding["document_digest"],
                "The retained original saved plan changed.")
        candidate = next(row for row in plan["plan"]["candidates"] if row["id"] == binding["candidate_id"])
        link = next(row for row in plan["plan"]["source_links"]
                    if row["id"] == candidate["source"]["source_link_id"])
        snapshot = link["snapshot"]
        alternative = next(row for row in original["report"]["alternatives"] if row["run_id"] == binding["run_id"])
        require(original["input"] == snapshot["edition"]["input"]
                and original["report"] == snapshot["economic_report"]
                and candidate["source"]["row_snapshot"]["original_alternative"] == alternative
                and {row["metric"]: row["output"] for row in candidate["modeled_benefits"]} == alternative["outputs"],
                "The saved candidate changed its original Economic snapshot or physical support.")
        _phase_save(journal, "existing-cost-source-edition.json",
                    {key: value for key, value in original.items() if key != "_downloads"})
        record.update(producer_report_id=binding["report_id"], zone_id=binding["zone_id"],
                      selected_run_id=binding["run_id"], edition_id=original["id"],
                      project_id=original["report"]["project"]["id"])
        journal.save()

    with journal.stage("native_review_and_complete_original_cost_operation"):
        context = _phase_json(journal, "field-cost-context.json", lambda:
            api.post("/api/implementation-costs/context", base, workspace))
        require(context["binding"] == binding, "The cost context changed its source binding.")
        preview = _phase_json(journal, "field-cost-preview.json", lambda:
            api.post("/api/implementation-costs/preview", {**base, "review": selected["review"]}, workspace))
        require(preview["can_apply"] and preview["binding"] == binding,
                "The original cost review has unresolved errors or changed its binding.")
        _native_validate_physical(original, {"report": preview["economic_preview"]})
        payload = {**base, "review": selected["review"], "expected_operation_id": preview["operation_id"]}
        task = _native_queue(api, journal, "cost_review", workspace,
                             "implementation.cost-review.apply", payload, args.task_timeout_seconds)
        receipt = api.get("/api/implementation-costs/detail", workspace=workspace,
                          operation_id=preview["operation_id"])
        require(receipt["operation_id"] == preview["operation_id"] and receipt["binding"] == binding
                and task["result"]["edition"]["id"] == receipt["edition"]["id"],
                "The original cost receipt changed its saved edition.")
        reviewed = api.get("/api/economic-desk/edition", workspace=workspace,
                           edition_id=receipt["edition"]["id"])
        require(reviewed["input"] == preview["proposed_input"]
                and reviewed["input"]["selection"]["field12_cost_reviews"][preview["operation_id"]] == preview["source_audit"],
                "The reviewed edition differs from the exact accepted forecast.")
        _native_validate_physical(original, reviewed)
        _phase_save(journal, "field-cost-economic-edition.json",
                    {key: value for key, value in reviewed.items() if key != "_downloads"})
        record["implementation"] = {"plan_id": binding["plan_id"], "candidate_id": binding["candidate_id"],
            "revision": binding["revision"], "cost_review": {
                "operation_id": preview["operation_id"], "task_id": task["id"],
                "draft_id": receipt["draft"]["id"], "edition_id": reviewed["id"],
                "original_economic_edition_id": original["id"], "original_plan_revision": binding["revision"]}}
        ticket = _native_ticket(receipt["_downloads"], "cost-review-package.zip")
        record["native_cost_package"] = _native_member(api, journal, ticket, "complete-cost-review-package.zip")
        journal.save()

    with journal.stage("native_complete_original_economic_comparison"):
        preview = _phase_json(journal, "original-economic-comparison-preview.json", lambda:
            api.post("/api/economic-comparison/preview",
                     {"first_edition_id": original["id"], "second_edition_id": reviewed["id"]}, workspace))
        require(preview["comparison"]["comparability"]["physical"]
                and preview["input"]["first_edition_id"] == original["id"]
                and preview["input"]["second_edition_id"] == reviewed["id"],
                "The comparison preview changed the original pair or its physical support.")
        task = _native_queue(api, journal, "comparison", workspace, "economic.comparison.build",
                             {**preview["input"], "expected_comparison_id": preview["comparison_id"]},
                             args.task_timeout_seconds)
        comparison = api.get("/api/economic-comparison/detail", workspace=workspace, id=preview["comparison_id"])
        require(task["result"]["id"] == comparison["id"]
                and comparison["comparison"] == preview["comparison"]
                and comparison["input"] == preview["input"],
                "The completed comparison changed the original values.")
        record["economic_comparison"] = {"id": comparison["id"], "task_id": task["id"],
            "first_edition_id": original["id"], "second_edition_id": reviewed["id"],
            "input": comparison["input"], "physical_comparable": True}
        ticket = _native_ticket(comparison["_downloads"], "comparison-package.zip")
        record["native_comparison_package"] = _native_member(api, journal, ticket, "complete-economic-comparison.zip")
        _phase_json(journal, "saved-economic-comparison.json", lambda:
                    {key: value for key, value in comparison.items() if key not in {"_downloads", "viewer_url"}})
        journal.save()

    with journal.stage("native_register_original_comparison_source"):
        preview = _phase_json(journal, "comparison-source-preview.json", lambda:
            api.post("/api/economic-comparison/report-source-preview",
                     {"comparison_id": comparison["id"]}, workspace))
        require(preview["comparison_id"] == comparison["id"] and not preview["delivery_selection_supplied"],
                "The source preview changed its original comparison or ordered source selection.")
        task = _native_queue(api, journal, "comparison_source", workspace,
                             "economic.comparison.report-source.import",
                             {"comparison_id": comparison["id"], "expected_source_key": preview["source_key"],
                              "expected_operation_id": preview["operation_id"]},
                             args.task_timeout_seconds)
        source = task["result"]
        require(source["state"] == "imported" and source["operation_id"] == preview["operation_id"]
                and source["source_key"] == preview["source_key"]
                and source["comparison_id"] == comparison["id"],
                "The scientific source changed its accepted identity.")
        pair = {key: source[key] for key in ("source_collection_id", "source_id")}
        require(pair in source["delivery_selection"]["observed_context_sources"],
                "The original scientific source pair is absent from its selection.")
        record.setdefault("economic_comparison_report", {}).update({
            "comparison_id": comparison["id"], "source_key": source["source_key"],
            "source_operation_id": source["operation_id"], "source_task_id": task["id"], "source_pair": pair})
        journal.save()


    with journal.stage("native_verify_original_cost_and_comparison_packages"):
        cost_directory = output / "field-cost-review"
        cost_manifest = _phase_extract(output / record["native_cost_package"]["path"], cost_directory,
                                       schema="upstate.implementation-cost-review-package/v1")
        require(cost_manifest["operation_id"] == record["implementation"]["cost_review"]["operation_id"]
                and cost_manifest["edition_id"] == reviewed["id"],
                "The original complete cost package changed its operation or edition.")
        require(json.loads((cost_directory / "plan.json").read_text(encoding="utf-8")) == plan["plan"]
                and json.loads((cost_directory / "source-audit.json").read_text(encoding="utf-8"))
                    == json.loads((output / "field-cost-preview.json").read_text(encoding="utf-8"))["source_audit"],
                "The cost package changed its original saved plan or reviewed audit.")
        economic_manifest = _phase_extract(cost_directory / "economic" / "decision-package.zip",
                                           cost_directory / "economic" / "edition")
        require(economic_manifest["report_id"] == reviewed["report_id"],
                "The nested cost package belongs to another Economic report.")
        comparison_directory = output / "economic-comparison"
        manifest = _phase_extract(output / record["native_comparison_package"]["path"], comparison_directory,
                                  schema="upstate.economic-comparison-package/v1")
        require(manifest["id"] == comparison["id"]
                and json.loads((comparison_directory / "comparison.json").read_text(encoding="utf-8"))
                    == comparison["comparison"],
                "The complete comparison changed its original values.")
        for side, edition in (("first", original), ("second", reviewed)):
            retained = json.loads((comparison_directory / (side + "-edition.json")).read_text(encoding="utf-8"))
            retained_report = json.loads((comparison_directory / (side + "-report.json")).read_text(encoding="utf-8"))
            require(retained["id"] == edition["id"] and retained["input"] == edition["input"]
                    and retained_report == edition["report"], "A complete original Economic edition changed.")
            nested = _phase_extract(comparison_directory / (side + "-economic-package.zip"),
                                    comparison_directory / (side + "-economic-edition"))
            require(nested["report_id"] == edition["report_id"], "A nested original report identity changed.")

    choices = [pair]
    if _phase_plan_choice(selected)["enabled"]:
        with journal.stage("native_retain_original_editable_plan_report"):
            choices.append(_native_plan_source(args, api, journal, workspace, selected))
    record["economic_comparison_report"]["source_pairs"] = choices
    journal.save()

    with journal.stage("native_render_and_export_original_scientific_report"):
        report_request = {"sources": choices, "contact": {}}
        report_preview = _phase_json(journal, "scientific-report-preview.json", lambda:
            api.post("/api/source-reports/scientific-preview", report_request, workspace))
        require(report_preview["workspace_key"] == workspace
                and [{"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]}
                     for row in report_preview["sources"]] == choices,
                "The original scientific preview changed its exact source choice.")
        # A previously complete edition is opened without asking the installed
        # renderer to generate a new source identity.
        if not report_preview["existing"]:
            task = _native_queue(api, journal, "scientific_report", workspace, "source-reports.render",
                                 {**report_request, "preview_id": report_preview["id"]},
                                 args.task_timeout_seconds)
            require(task["result"]["scientific_report_edition_id"] == report_preview["id"],
                    "The completed scientific report differs from its original preview.")
        report = api.get("/api/source-reports/scientific-edition", workspace=workspace, id=report_preview["id"])
        require(report["edition"]["id"] == report_preview["id"] and report["edition"]["state"] == "complete"
                and _native_report_selection(report) == choices,
                "The retained scientific report changed its original ordered source.")
        _phase_save(journal, "comparison-scientific-report-edition.json", _native_report_snapshot(report))
        report_files = _native_report_files(api, journal, report)
        export_task = _native_queue(api, journal, "scientific_report_export", workspace, "source-reports.export",
                                    {"id": report["edition"]["id"]}, args.task_timeout_seconds)
        require(export_task["result"]["scientific_report_edition_id"] == report["edition"]["id"],
                "The report export selected another original edition.")
        report = api.get("/api/source-reports/scientific-edition", workspace=workspace, id=report["edition"]["id"])
        require(report.get("archive"), "The completed original report has no archive.")
        report_archive = _native_member(api, journal, report["archive"], "complete-comparison-scientific-report.zip")
        with zipfile.ZipFile(output / report_archive["path"]) as archive:
            require(archive.testzip() is None, "The native scientific archive has a damaged member.")
        record["economic_comparison_report"].update(
            report_id=report["edition"]["id"], report_files=report_files, report_archive=report_archive,
            report_render_request=report_request, report_export_task_id=export_task["id"])
        journal.save()

    with journal.stage("native_export_original_scientific_study"):
        selection = {"schema": "upstate.study-selection/v1",
                     "title": "Economic comparison " + comparison["id"][:12],
                     "roots": [{"kind": "scientific-report-editions", "id": report["edition"]["id"]}],
                     "include_related_results": True}
        preview = _phase_json(journal, "comparison-study-preview.json", lambda:
            api.post("/api/study-transfer/preview", {"workspace": workspace, "selection": selection}, workspace))
        require(any(row["id"] == report["edition"]["id"] for row in preview.get("scientific_report_editions", [])),
                "The original Study preview omitted the saved scientific report.")
        task = _native_queue(api, journal, "study_export", workspace, "study.export",
                             {**selection, "preview_token": preview["preview_token"]}, args.task_timeout_seconds)
        tickets = task.get("_downloads") or []
        require(len(tickets) == 1, "Choose the exact complete original Study download.")
        study_file = _native_member(api, journal, tickets[0], "comparison-scientific-study.zip")
        from model.study_transfer import inspect_transfer_archive
        inspected = inspect_transfer_archive(output / study_file["path"], verify=True)
        manifest, study = inspected["manifest"], inspected["study"]
        require(manifest["schema"] == "upstate.scientific-workspace-archive/v1"
                and study["schema"] == "upstate.study-transfer/v1" and study["id"] == task["result"]["id"]
                and manifest["project"]["id"] == record["project_id"]
                and study["identity"]["selection"]["roots"] == selection["roots"],
                "The original Study archive changed its project, roots or native identity.")
        retained = next((row for row in study["identity"]["scientific_report_editions"]
                         if row["id"] == report["edition"]["id"]), None)
        require(retained and retained["source_choices"] == choices and retained["sources"]
                and all(row.get("body_sha256") for row in retained["sources"]),
                "The original Study lost its complete scientific report or source bodies.")
        for item in retained["members"]:
            member = manifest["members"].get("workspace/" + item["path"])
            require(member and all(member[key] == item[key] for key in ("bytes", "sha256")),
                    "The original Study changed a scientific report member.")
        if record.get("implementation_plan_handoff"):
            _native_capture_plan_lineage(api, journal, workspace, study)
        _phase_save(journal, "comparison-study-inspection.json", inspected)
        record["economic_comparison_report"].update(study_id=study["id"], study_task_id=task["id"],
                                                   study_selection=selection, study_archive=study_file)
        journal.save()

    with journal.stage("native_cold_restore_original_study"):
        study_path = output / record["economic_comparison_report"]["study_archive"]["path"]
        intent = {"workspace": workspace, "filename": study_path.name,
                  "media_type": "application/octet-stream", "bytes": study_path.stat().st_size,
                  "sha256": digest(study_path)}
        _phase_save(journal, "study-upload-intent.json", intent)
        def upload():
            # The original server derives the upload ID from exact
            # SHA256/filename/media_type. Repeating an uncertain response
            # reconnects that upload; it never submits another restore task.
            with study_path.open("rb") as stream:
                return api.json("/api/upload", method="POST", raw=stream, workspace=workspace,
                                filename=intent["filename"], length=intent["bytes"])
        uploaded = _phase_json(journal, "study-upload.json", upload)
        require(uploaded["sha256"] == intent["sha256"] and uploaded["bytes"] == intent["bytes"]
                and uploaded["filename"] == intent["filename"],
                "The original upload changed the complete Study bytes or filename.")
        task = _native_queue(api, journal, "study_restore", workspace, "workspace.restore",
                             {"upload_id": uploaded["id"]}, args.task_timeout_seconds)
        restored = task["result"]
        received_workspace = restored["workspace_key"]
        require(received_workspace != workspace and restored["identity"] == "MATCH"
                and restored["archive_sha256"] == intent["sha256"]
                and restored["project"]["id"] == record["project_id"],
                "The original Study was not restored unchanged into a fresh Workspace.")
        record["economic_comparison_report"].update(
            received_workspace_key=received_workspace, restore_task_id=task["id"],
            restore_upload_id=uploaded["id"], restore_archive_sha256=intent["sha256"])
        journal.save()
        detail, index, row, cold_comparison, cold_report = _native_check_received(api, received_workspace, record)
        require(cold_comparison["comparison"] == comparison["comparison"]
                and _native_report_snapshot(cold_report) == _native_report_snapshot(report),
                "Cold reopening changed original comparison values or scientific report files.")
        if record.get("implementation_plan_handoff"):
            field_index, field, original_plan, received_plan = _native_check_plan(
                api, journal, received_workspace, detail)
            captured = json.loads((output / "implementation-plan-captured-current.json").read_text(encoding="utf-8"))
            captured_revision = api.get("/api/implementation/detail", workspace=received_workspace,
                                        id=captured["id"], revision=captured["revision"])
            require(captured_revision["plan"] == captured,
                    "The fresh Workspace changed the captured current work plan, tasks, budgets or source metadata.")
            _phase_save(journal, "cold-received-implementation-plan.json", captured_revision["plan"])
            record["implementation_plan_handoff"]["received_source_index"] = field_index
        # Retain source availability separately from captured comparison lineage.
        _phase_save(journal, "cold-received-economic-source.json", row)
        record["economic_comparison_report"].update(
            received_source_index=index, native_source_availability=row.get("native_source_availability") or [],
            product_view_status="native_complete_visual_pending")
        record["native_completed_at"] = record.get("native_completed_at") or now()
        journal.save()
    return record["economic_comparison_report"]




def _browser_receive_plan(args, api, journal, page, workspace, capture):
    """Operate the existing received-plan controls and save one separate receiving note."""
    record, output = journal.record, journal.root
    value = record["implementation_plan_handoff"]
    study_id = record["economic_comparison_report"]["study_id"]
    detail = api.get("/api/study-transfer/received-detail", workspace=workspace, study_id=study_id)
    index, row, selected, current = _native_check_plan(api, journal, workspace, detail)
    wanted = value["binding"]
    sender = None
    unavailable = None
    if api.origin == record["operator_origin"]:
        require(workspace != record["workspace_key"], "Edit only the independently restored Workspace.")
        try:
            observed_sender = api.get("/api/implementation/detail", workspace=record["workspace_key"],
                                      id=wanted["plan_id"])
            original = api.get("/api/implementation/detail", workspace=record["workspace_key"],
                               id=wanted["plan_id"], revision=wanted["revision"])
        except NativeHTTPError as error:
            if error.status != 404:
                raise
            unavailable = {"status": 404, "message": journal.clean(str(error)),
                           "original_workspace_key": record["workspace_key"],
                           "browser_origin": api.origin, "browser_workspace_key": workspace}
        else:
            require(original["document_digest"] == wanted["document_digest"]
                    and original["plan"] == selected["plan"], "The sender's selected source revision changed.")
            sender = observed_sender
    receiving = record.setdefault("implementation_receiving", {})
    receiving["sender_verification"] = (
        "Original sender accessible: current and selected revisions checked before and after receiving."
        if sender is not None else
        "Original sender is unavailable on this browser operator; exact native capture is retained. "
        "Live sender verification must be completed by its original worker; this browser does not claim access.")
    if unavailable:
        receiving.setdefault("sender_unavailable_observations", []).append(unavailable)
    journal.save()
    page.locator('[data-view="study-transfer"]').click()
    control = page.locator('.study-transfer [data-received-action="open"][data-id="' + study_id + '"]')
    control.wait_for(state="visible")
    with page.expect_response(lambda response: urlsplit(response.url).path == "/api/study-transfer/received-detail"
                              and parse_qs(urlsplit(response.url).query).get("study_id") == [study_id]):
        control.click()
    action = "current" if row["native_plan"]["revision"] != row["native_plan"]["selected_revision"] else "plan"
    card_revision = row["native_plan"]["revision"] if action == "current" else row["native_plan"]["selected_revision"]
    with page.expect_response(lambda response: urlsplit(response.url).path == "/api/implementation/detail"
                              and parse_qs(urlsplit(response.url).query).get("id") == [wanted["plan_id"]]
                              and parse_qs(urlsplit(response.url).query).get("workspace") == [workspace]
                              and parse_qs(urlsplit(response.url).query).get("revision") == [str(card_revision)]) as opened:
        page.locator('[data-received-action="' + action + '"][data-index="' + str(index) + '"]').click()
    check_response(opened.value, "Open the retained editable Implementation plan")
    opened_plan = opened.value.json()["plan"]
    require(opened_plan["id"] == wanted["plan_id"] and opened_plan["revision"] == card_revision,
            "The plan card opened another plan or native revision.")
    workbench = page.locator(".iw")
    workbench.get_by_text(
        "Opened the original saved plan at native revision " + str(opened_plan["revision"]) +
        ". Its retained reports and source files are available below.", exact=True).wait_for(state="visible")
    require(workbench.locator('[data-impl-change="plan"]').input_value() == wanted["plan_id"]
            and workbench.locator(".iw-footer span").first.inner_text() == wanted["plan_id"]
            and re.search(r"\brevision " + str(opened_plan["revision"]) + r"(?:\D|$)", workbench.locator(".iw-header .iw-muted").inner_text()) is not None,
            "The editable workbench has not adopted the selected original plan revision.")
    previous_footer = workbench.locator(".iw-footer").element_handle()
    require(previous_footer is not None, "The native plan view has no mounted footer.")
    with page.expect_response(lambda response: urlsplit(response.url).path == "/api/implementation/detail"
                              and parse_qs(urlsplit(response.url).query).get("id") == [wanted["plan_id"]]) as reopened:
        workbench.locator('[data-impl="reopen"]').click()
    check_response(reopened.value, "Reopen the current received plan")
    page.wait_for_function("(node) => !node.isConnected", arg=previous_footer)
    previous_footer.dispose()
    reopened_plan = reopened.value.json()["plan"]
    require(workbench.locator('[data-impl-change="plan"]').input_value() == reopened_plan["id"] == wanted["plan_id"]
            and re.search(r"\brevision " + str(reopened_plan["revision"]) + r"(?:\D|$)", workbench.locator(".iw-header .iw-muted").inner_text()) is not None,
            "The reopened controller has not adopted its current native revision.")
    workbench.locator('[data-impl="tab"][data-tab="tasks"]').click()
    capture("phase-browser-received-work-plan-desktop.png")
    page.set_viewport_size({"width": 390, "height": 844})
    capture("phase-browser-received-work-plan-narrow.png")
    page.set_viewport_size({"width": 1440, "height": 1000})
    workbench.locator('[data-impl="tab"][data-tab="budget"]').click()
    capture("phase-browser-received-plan-costs-desktop.png")
    page.set_viewport_size({"width": 390, "height": 844})
    capture("phase-browser-received-plan-costs-narrow.png")
    page.set_viewport_size({"width": 1440, "height": 1000})

    def intent():
        current = api.get("/api/implementation/detail", workspace=workspace, id=wanted["plan_id"])
        plan = current["plan"]
        require(plan["tasks"], "This work-plan receiving course requires an actual retained task.")
        task = plan["tasks"][0]
        note = (task.get("notes") or "") + (
            "\n\nReceiving note: opened the original work plan in an independent restored Workspace. "
            "No task quantity, cost forecast, ledger classification or scientific source was changed.")
        return {"workspace_key": workspace, "operator_origin": api.origin,
                "plan": plan, "document_digest": current["document_digest"],
                "task_id": task["id"], "note": note}
    edit = _phase_json(journal, "received-plan-edit-intent.json", intent)
    require(edit["workspace_key"] == workspace and edit["operator_origin"] == api.origin,
            "Resume this receiving edit on its original restored Workspace and operator.")
    name = "browser_received_plan_note"
    requests = record.setdefault("native_requests", {})
    if name not in requests:
        fresh = api.get("/api/implementation/detail", workspace=workspace, id=wanted["plan_id"])
        require(fresh["document_digest"] == edit["document_digest"] and fresh["plan"] == edit["plan"],
                "The received plan changed after the note was reviewed; retain that edit and do not overwrite it.")
        workbench.locator('[data-impl="tab"][data-tab="tasks"]').click()
        workbench.locator('[data-impl="edit"][data-collection="tasks"][data-id="' + edit["task_id"] + '"]').click()
        form = workbench.locator('dialog[open] [data-impl-form="tasks"]')
        form.wait_for(state="visible")
        form.locator('[name="notes"]').fill(edit["note"])
        form.locator('button[type="submit"]').click()
        workbench.locator("dialog[open]").wait_for(state="hidden")

        def capture_request(route, request):
            if request.method != "POST" or urlsplit(request.url).path != "/api/actions":
                route.continue_()
                return
            try:
                actual = request.post_data_json
                require(actual["workspace"] == workspace and actual["action"] == "implementation.plan.save",
                        "The receiving control attempted another native action.")
                payload = actual["payload"]
                require(payload["expected_revision"] == edit["plan"]["revision"],
                        "The receiving save selected another base revision.")
                _receiving_plan_change(edit["plan"], payload["document"], edit["task_id"], edit["note"], saved=False)
                require(re.fullmatch(r"[A-Za-z0-9_-]{16,100}", actual["operation_id"]) is not None,
                        "The receiving save omitted its original queue request identity.")
                slot = {"request": actual, "created_at": now(), "state": "prepared",
                        "captured_from": "Original Implementation Save native revision control"}
                previous = requests.get(name)
                require(previous is None or previous["request"] == actual,
                        "The receiving control replaced its original save request.")
                requests[name] = previous or slot
                journal.save()  # Persist exact native request before allowing the POST.
                route.continue_()
            except Exception:
                route.abort()
                raise

        page.route("**/api/actions", capture_request)
        try:
            with page.expect_response(lambda response: urlsplit(response.url).path == "/api/actions"
                                      and response.request.method == "POST") as accepted:
                workbench.locator('[data-impl="save"]').click()
            check_response(accepted.value, "Save one independent received-plan note")
            result = accepted.value.json()
            task = result.get("task", result)
            require(name in requests, "The native save was not journaled before submission.")
            requests[name].update(task_id=task["id"], state=task["state"])
            journal.save()
        finally:
            page.unroute("**/api/actions", capture_request)
    request = requests[name]["request"]
    task = _native_queue(api, journal, name, workspace, request["action"], request["payload"],
                         args.task_timeout_seconds)
    saved = api.get("/api/implementation/detail", workspace=workspace, id=wanted["plan_id"],
                    revision=edit["plan"]["revision"] + 1)
    _receiving_plan_change(edit["plan"], saved["plan"], edit["task_id"], edit["note"], saved=True)
    require(task["result"]["plan"] == saved["plan"], "The receiving task returned a different saved revision.")
    _phase_save(journal, "received-plan-edited-revision.json", saved["plan"])
    selected_after = api.get("/api/implementation/detail", workspace=workspace,
                             id=wanted["plan_id"], revision=wanted["revision"])
    require(selected_after["plan"] == selected["plan"]
            and selected_after["document_digest"] == wanted["document_digest"],
            "The receiving note changed the original selected report revision.")
    if sender is not None:
        after = api.get("/api/implementation/detail", workspace=record["workspace_key"], id=wanted["plan_id"])
        original_after = api.get("/api/implementation/detail", workspace=record["workspace_key"],
                                 id=wanted["plan_id"], revision=wanted["revision"])
        require(after["plan"] == sender["plan"] and after["document_digest"] == sender["document_digest"]
                and original_after["plan"] == selected["plan"],
                "The independent receiving edit changed the sender's plan.")
        _phase_save(journal, "sender-plan-observed-" + after["document_digest"] + ".json", after["plan"])
    close = page.locator('#detail-dialog button[data-action="detail-close"]')
    if close.is_visible():
        close.click()
    previous_footer = workbench.locator(".iw-footer").element_handle()
    require(previous_footer is not None, "The edited plan view has no mounted footer.")
    with page.expect_response(lambda response: urlsplit(response.url).path == "/api/implementation/detail"
                              and parse_qs(urlsplit(response.url).query).get("id") == [wanted["plan_id"]]) as reopened:
        workbench.locator('[data-impl="reopen"]').click()
    check_response(reopened.value, "Reopen the saved receiving note")
    page.wait_for_function("(node) => !node.isConnected", arg=previous_footer)
    previous_footer.dispose()
    reopened_plan = reopened.value.json()["plan"]
    require(reopened_plan["revision"] >= saved["plan"]["revision"]
            and workbench.locator('[data-impl-change="plan"]').input_value() == reopened_plan["id"] == wanted["plan_id"]
            and re.search(r"\brevision " + str(reopened_plan["revision"]) + r"(?:\D|$)", workbench.locator(".iw-header .iw-muted").inner_text()) is not None,
            "The received workbench has not adopted its reopened saved revision.")
    workbench.locator('[data-impl="tab"][data-tab="tasks"]').click()
    capture("phase-browser-received-plan-note-reopened.png")
    record["implementation_receiving"].update(
        workspace_key=workspace, plan_id=wanted["plan_id"], original_revision=wanted["revision"],
        applied_revision=saved["plan"]["revision"], document_digest=saved["document_digest"],
        task_id=task["id"], note_task_id=edit["task_id"],
        original_selected_revision_unchanged=True, sender_verified_live=sender is not None,
        completed_at=now())
    journal.save()

def receive_browser_phase(args, original_url, api, journal):
    """Inspect saved IDs; optional plan receiving commits only its separate reviewed note."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserUnavailable("Playwright is absent from the selected Python environment") from error
    record, output = journal.record, journal.root
    require(record.get("native_completed_at"), "Complete this same journey's native phase before browser receiving.")
    value = record["economic_comparison_report"]
    workspace = args.workspace_key or value["received_workspace_key"]
    # Another operator may expose a separately restored copy. Require exactly the
    # same project, report, comparison, source pair, and all retained bytes.
    detail, index, row, comparison, report = _native_check_received(api, workspace, record)
    saved_comparison = json.loads((output / "saved-economic-comparison.json").read_text(encoding="utf-8"))
    saved_report = json.loads((output / "comparison-scientific-report-edition.json").read_text(encoding="utf-8"))
    require(comparison["comparison"] == saved_comparison["comparison"]
            and _native_report_snapshot(report) == saved_report,
            "The browser destination does not contain the same original native results.")
    with sync_playwright() as playwright:
        browser = launch_browser(playwright, args)
        record["browser"] = {"version": browser.version, "configured_executable": args.browser_executable}
        context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
        context.set_default_timeout(args.timeout_seconds * 1000)
        page = context.new_page()
        page.on("pageerror", lambda error: record["browser_errors"].append(
            {"kind": "pageerror", "message": journal.clean(str(error))}))
        page.on("console", lambda message: record["browser_errors"].append(
            {"kind": "console", "message": journal.clean(message.text)}) if message.type == "error" else None)
        artifacts = []

        def capture(name):
            path = output / name
            page.screenshot(path=str(path), full_page=True)
            artifacts.append(descriptor(path, output))

        def close_details():
            button = page.locator('#detail-dialog button[data-action="detail-close"]')
            if button.is_visible():
                button.click()

        def checked_download(control, destination, expected):
            destination.parent.mkdir(parents=True, exist_ok=True)
            with page.expect_download() as pending:
                control.click()
            received = pending.value
            require(not received.failure(), "The original browser download failed.")
            received.save_as(str(destination))
            require(destination.stat().st_size == expected["bytes"]
                    and digest(destination) == expected["sha256"],
                    "The browser download differs from the completed native file.")
            artifacts.append(descriptor(destination, output))

        def select_workspace():
            if page.locator("#workspace-select").input_value() != workspace:
                with page.expect_response(lambda response: urlsplit(response.url).path == "/api/state"
                                          and parse_qs(urlsplit(response.url).query).get("workspace") == [workspace]):
                    page.locator("#workspace-select").select_option(workspace)

        try:
            with journal.stage("browser_open_exact_cold_received_study"):
                page.goto(original_url, wait_until="load")
                page.locator("#workspace-select").wait_for(state="visible")
                select_workspace()
                page.locator('[data-view="study-transfer"]').click()
                control = page.locator('.study-transfer [data-received-action="open"][data-id="' +
                                       value["study_id"] + '"]')
                control.wait_for(state="visible")
                with page.expect_response(lambda response:
                                          urlsplit(response.url).path == "/api/study-transfer/received-detail"
                                          and parse_qs(urlsplit(response.url).query).get("study_id") == [value["study_id"]]
                                          and parse_qs(urlsplit(response.url).query).get("workspace") == [workspace]) as opened:
                    control.click()
                check_response(opened.value, "Open the original received Study")
                require(opened.value.json()["project"]["id"] == record["project_id"],
                        "The received Study UI opened a different project.")
                capture("phase-browser-received-study-desktop.png")
                page.set_viewport_size({"width": 390, "height": 844})
                capture("phase-browser-received-study-narrow.png")
                page.set_viewport_size({"width": 1440, "height": 1000})

            with journal.stage("browser_open_original_comparison_from_received_study"):
                with page.expect_response(lambda response:
                                          urlsplit(response.url).path == "/api/economic-comparison/detail"
                                          and parse_qs(urlsplit(response.url).query).get("id") == [comparison["id"]]
                                          and parse_qs(urlsplit(response.url).query).get("workspace") == [workspace]) as opened:
                    page.locator('[data-received-action="economic-comparison-open"]'
                                 '[data-economic-comparison-source="' + str(index) + '"]').click()
                check_response(opened.value, "Open the exact received Economic comparison")
                require(opened.value.json()["comparison"] == saved_comparison["comparison"],
                        "The comparison UI changed original costs, quantities or support.")
                dialog = page.locator("dialog.economic-comparison")
                dialog.wait_for(state="visible")
                dialog.get_by_role("link", name="Open complete comparison report", exact=True).wait_for(state="visible")
                capture("phase-browser-economic-comparison-desktop.png")
                page.set_viewport_size({"width": 390, "height": 844})
                capture("phase-browser-economic-comparison-narrow.png")
                page.set_viewport_size({"width": 1440, "height": 1000})
                # The original completed package is downloaded through its
                # mounted control, without queuing another comparison.
                ticket = _native_ticket(comparison["_downloads"], "comparison-package.zip")
                link = dialog.locator('a[download]').filter(has_text="ZIP")
                if link.count() != 1:
                    from urllib.parse import urljoin
                    relative = urljoin(api.origin + "/", ticket["url"])
                    link = dialog.locator('a[href="' + relative + '"]')
                require(link.count() == 1, "Choose the saved comparison's original complete ZIP control.")
                checked_download(link, output / "browser-downloads" / "comparison-package.zip", ticket)
                dialog.locator('[data-ec-action="close"]').click()

            if record.get("implementation_plan_handoff"):
                with journal.stage("browser_receive_and_independently_edit_original_work_plan"):
                    _browser_receive_plan(args, api, journal, page, workspace, capture)

            with journal.stage("browser_open_saved_scientific_report_and_all_downloads"):
                close_details()
                page.locator('[data-view="sources"]').click()
                composer = page.locator(".scientific-report-editions")
                composer.wait_for(state="visible")
                saved = composer.locator('[data-scientific-report-action="open"][data-id="' + value["report_id"] + '"]')
                saved.wait_for(state="visible")
                with page.expect_response(lambda response:
                                          urlsplit(response.url).path == "/api/source-reports/scientific-edition"
                                          and parse_qs(urlsplit(response.url).query).get("id") == [value["report_id"]]) as opened:
                    saved.click()
                check_response(opened.value, "Open the exact completed scientific report")
                require(_native_report_snapshot(opened.value.json()) == saved_report,
                        "The report UI selected different original members.")
                panel = composer.locator('[data-scientific-report-detail]')
                panel.wait_for(state="visible")
                panel.frame_locator("iframe").first.locator("body").wait_for(state="visible")
                capture("phase-browser-scientific-report-desktop.png")
                page.set_viewport_size({"width": 390, "height": 844})
                capture("phase-browser-scientific-report-narrow.png")
                page.set_viewport_size({"width": 1440, "height": 1000})
                for item in report["files"]:
                    relative = _native_relative(item["path"])
                    url = item["url"] + ("&" if "?" in item["url"] else "?") + "download=1"
                    control = composer.locator('[data-scientific-report-files] a[download][href="' + url + '"]')
                    checked_download(control, output / "browser-downloads" / "scientific-report" / relative, item)
                require(report.get("archive"), "The original saved report lacks its completed archive.")
                checked_download(panel.get_by_role("link", name="Download report ZIP", exact=True),
                                 output / "browser-downloads" / "scientific-report.zip", report["archive"])

            with journal.stage("browser_reopen_exact_downloaded_reports_and_print"):
                html = next(item for item in report["files"] if item["role"] == "report_html")
                local = output / "browser-downloads" / "scientific-report" / _native_relative(html["path"])
                outgoing = context.new_page()
                outgoing.goto(local.as_uri(), wait_until="load")
                outgoing.screenshot(path=str(output / "phase-browser-downloaded-report-desktop.png"), full_page=True)
                outgoing.set_viewport_size({"width": 390, "height": 844})
                outgoing.screenshot(path=str(output / "phase-browser-downloaded-report-narrow.png"), full_page=True)
                outgoing.set_viewport_size({"width": 1440, "height": 1000})
                outgoing.pdf(path=str(output / "phase-browser-downloaded-report.pdf"),
                             format="A4", prefer_css_page_size=True, print_background=True)
                outgoing.close()
                for name in ("phase-browser-downloaded-report-desktop.png",
                             "phase-browser-downloaded-report-narrow.png", "phase-browser-downloaded-report.pdf"):
                    artifacts.append(descriptor(output / name, output))
                # The complete original Economic package already verified by the
                # native phase enters the maintained offline control course.
                from model import decision_receive
                arguments = ["--edition", str(output / "field-cost-review" / "economic" / "edition"),
                             "--run-id", record["selected_run_id"],
                             "--notes", "Received the same native completed cost-review edition.",
                             "--timeout-seconds", str(args.timeout_seconds)]
                if args.browser_executable:
                    arguments.extend(["--browser-executable", args.browser_executable])
                def run_offline():
                    captured = io.StringIO()
                    with redirect_stdout(captured):
                        exit_code = decision_receive.main(arguments)
                    value = {"exit_code": exit_code, "result": json.loads(captured.getvalue())}
                    if exit_code != 0:
                        _phase_save(journal, "offline-attempts/" + uuid.uuid4().hex + ".json", value)
                        raise ValueError("The original offline Economic controls require repair; failed attempt retained.")
                    return value
                result = _phase_json(journal, "phase-browser-offline-economic-result.json", run_offline)
                require(result["exit_code"] == 0,
                        "The original offline Economic controls require repair; see retained result.")

            with journal.stage("browser_reload_and_reopen_same_saved_comparison"):
                page.reload(wait_until="load")
                page.locator("#workspace-select").wait_for(state="visible")
                select_workspace()
                page.locator('[data-view="economic-desk"]').click()
                page.locator('[data-econ="compare-editions"]').first.click()
                dialog = page.locator("dialog.economic-comparison")
                dialog.wait_for(state="visible")
                saved = dialog.locator('[data-ec-action="saved"][data-id="' + comparison["id"] + '"]').first
                saved.wait_for(state="visible")
                with page.expect_response(lambda response:
                                          urlsplit(response.url).path == "/api/economic-comparison/detail"
                                          and parse_qs(urlsplit(response.url).query).get("id") == [comparison["id"]]) as opened:
                    saved.click()
                check_response(opened.value, "Reopen the same original comparison after reload")
                require(opened.value.json()["comparison"] == saved_comparison["comparison"],
                        "Reload changed original native values.")
                capture("phase-browser-reopened-comparison.png")
                dialog.locator('[data-ec-action="close"]').click()
            record["browser_completed_at"] = now()
            record["browser_workspace_key"] = workspace
            record["browser_origin"] = api.origin
            record["visual_artifacts"] = artifacts
            record["product_view_status"] = "captured_for_producer_review"
            record["visual_review_instruction"] = (
                "The producing worker must open and LOOK at the exact saved desktop and 390 px images, "
                "downloaded HTML/PDF/ZIP and original control states; capture alone is not inspection.")
            journal.save()
        finally:
            context.close()
            browser.close()



def phased_main(args, argv=None):
    """Resume one real native operation and its later visual receiving course."""
    journal = None
    started = time.perf_counter()
    try:
        require(args.timeout_seconds > 0 and args.task_timeout_seconds > 0, "Use positive HTTP and queue timeouts.")
        require(args.phase in {"native", "browser"},
                "--resume-journey requires --phase native or --phase browser.")
        require(not args.implementation_report_as_of or args.include_implementation_plan or args.resume_journey,
                "--implementation-report-as-of requires the optional whole-plan receiving selection.")
        original_url, origin, token = read_url(args)
        application = Path(args.application).resolve(strict=True)
        require((application / "model" / "study_transfer.py").is_file(),
                "Select the existing complete application with its original Study transfer implementation.")
        sys.path.insert(0, str(application))
        from model.common import held
        if args.resume_journey:
            path = Path(args.resume_journey).resolve(strict=True)
            require(path.name == "operator-journey.json", "Resume the original operator-journey.json.")
            directory = path.parent
        else:
            require(args.phase == "native", "The browser phase requires --resume-journey from native completion.")
            require(args.workspace_key and args.cost_plan_id and args.cost_review,
                    "Native receiving requires --workspace-key, --cost-plan-id and --cost-review.")
            parent = Path(args.output).resolve()
            parent.mkdir(parents=True, exist_ok=True)
            directory = parent / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
            directory.mkdir()
        with held(directory / ".receiving.lock"):
            path = directory / "operator-journey.json"
            if path.is_file():
                record = json.loads(path.read_text(encoding="utf-8"))
                require(record.get("schema") == "upstate.economic-operator-receiving/v1"
                        and record.get("phase_schema") == "upstate.economic-receiving-phases/v1",
                        "Resume a journal created by this explicit phased receiving course.")
                if args.phase == "native":
                    require(record["operator_origin"] == origin,
                            "Native queue replay must use its original operator origin.")
                    if args.workspace_key:
                        require(args.workspace_key == record["workspace_key"],
                                "Native queue replay must use its original Workspace key.")
            else:
                record = {"schema": "upstate.economic-operator-receiving/v1",
                          "phase_schema": "upstate.economic-receiving-phases/v1",
                          "status": "running", "started_at": now(), "operator_origin": origin,
                          "receiving_directory": str(directory), "workspace_key": args.workspace_key,
                          "receiver_sha256": digest(__file__), "steps": [], "tasks": [],
                          "browser_errors": [], "native_requests": {}}
            journal = PhaseJournal(directory, token, record)
            record["application"] = str(application)
            record["current_receiving_directory"] = str(directory)
            record.setdefault("phase_attempts", []).append(
                {"phase": args.phase, "started_at": now(), "receiver_sha256": digest(__file__),
                 "operator_origin": origin, "resume_interrupted_tasks": args.resume_interrupted_tasks})
            receiver = directory / ("economic_receive-" + digest(__file__)[:16] + ".py")
            if receiver.exists():
                require(digest(receiver) == digest(__file__), "The retained receiver source changed.")
            else:
                shutil.copyfile(__file__, receiver)
            api = NativeHTTP(origin, token, args.timeout_seconds)
            api.resume_interrupted_tasks = args.resume_interrupted_tasks
            journal.save()
            code = 0
            try:
                if args.phase == "native":
                    receive_native_phase(args, api, journal)
                    record["status"] = ("browser_complete_visual_review_pending" if record.get("browser_completed_at")
                                        else "native_complete_visual_pending")
                else:
                    receive_browser_phase(args, original_url, api, journal)
                    record["status"] = "browser_complete_visual_review_pending"
            except BrowserUnavailable as error:
                record.update(status="native_complete_browser_unavailable",
                              error={"type": type(error).__name__, "message": journal.clean(str(error))})
                code = 3
            except Exception as error:
                record.update(status="phase_failed", error={"type": type(error).__name__,
                                                           "message": journal.clean(str(error))})
                code = 1
            record["phase_attempts"][-1].update(
                finished_at=now(), seconds=round(time.perf_counter() - started, 6), exit_code=code)
            if code:
                record["phase_attempts"][-1]["error"] = record.get("error")
            elif "error" in record:
                record.setdefault("resolved_errors", []).append(
                    {"resolved_at": now(), "phase": args.phase, "error": record.pop("error")})
            record["last_finished_at"] = now()
            prefix = [sys.executable, "-B", str(Path(__file__).resolve()),
                      "--application", str(application), "--output", str(directory.parent),
                      "--resume-journey", str(path)]
            if args.operator_url_file:
                prefix.extend(["--operator-url-file", str(Path(args.operator_url_file).resolve())])
            else:
                prefix.extend(["--operator-url-env", args.operator_url_env])
            record["native_resume_command"] = shlex.join(prefix + ["--phase", "native"])
            record["browser_resume_command"] = shlex.join(prefix + ["--phase", "browser"])
            record["next_browser_entry"] = {
                "journey": "operator-journey.json",
                "workspace_key": record.get("economic_comparison_report", {}).get("received_workspace_key"),
                "comparison_id": record.get("economic_comparison", {}).get("id"),
                "report_id": record.get("economic_comparison_report", {}).get("report_id"),
                "study_id": record.get("economic_comparison_report", {}).get("study_id"),
                "instruction": ("Use the authorized original operator URL file. If the complete Study and journey "
                                "were moved to another browser host, supply its current --workspace-key only after "
                                "restoring that exact Study. The browser phase validates original project/results "
                                "and never submits another cost, comparison, render, export or restore task. "
                                "When the optional whole-plan source was selected, it operates the received work-plan "
                                "controls and saves one journaled receiving note in that independent Workspace.")}
            archive_path = directory / "economic-operator-receiving-package.zip"
            artifacts = [descriptor(item, directory) for item in sorted(directory.rglob("*"))
                         if item.is_file() and item not in {path, archive_path}
                         and not any(part.startswith(".") for part in item.relative_to(directory).parts)]
            record["artifacts"] = artifacts
            journal.save()
            temporary = directory / ".economic-operator-receiving-package.receiving"
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for item in [path, *(directory / row["path"] for row in artifacts)]:
                    archive.write(item, item.relative_to(directory).as_posix())
            temporary.replace(archive_path)
            result = {"status": record["status"], "phase": args.phase,
                      "workspace_key": record.get("workspace_key"),
                      "implementation": record.get("implementation"),
                      "economic_comparison": record.get("economic_comparison"),
                      "economic_comparison_report": record.get("economic_comparison_report"),
                      "journey": str(path), "archive": str(archive_path),
                      "native_resume_command": record["native_resume_command"],
                      "browser_resume_command": record["browser_resume_command"],
                      "visual_review_required": True}
            print(json.dumps(journal.clean(result), indent=2), flush=True)
            return code
    except Exception as error:
        print(json.dumps({"status": "input_error", "error": type(error).__name__,
                          "message": journal.clean(str(error)) if journal else str(error)}), file=sys.stderr)
        return 2


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--operator-url-file", help="Text file with the original printed URL, or JSON containing url")
    result.add_argument("--operator-url-env", default="UPSTATE_OPERATOR_URL", help="Existing URL environment variable when no file is supplied")
    result.add_argument("--output", required=True, help="Directory receiving a new timestamped journey for each invocation")
    result.add_argument("--application", default=str(Path(__file__).resolve().parent.parent), help="Existing complete application root")
    result.add_argument("--phase", choices=("all", "native", "browser"), default="all",
                        help="Default original browser course; native completes queued work, browser resumes its exact saved IDs")
    result.add_argument("--resume-journey", help="Exact phased operator-journey.json to rejoin without replacing original requests")
    result.add_argument("--include-implementation-plan", action="store_true",
                        help="With a new native phase, include the exact pinned whole-plan report and editable history in its Study")
    result.add_argument("--implementation-report-as-of",
                        help="Pinned YYYY-MM-DD date for the optional whole-plan report; defaults to the explicit cost review as_of")
    result.add_argument("--resume-interrupted-tasks", action="store_true",
                        help="Explicitly resume each retained failed/interrupted/cancelled original task at most once this invocation")
    result.add_argument("--workspace-key")
    result.add_argument("--report-id")
    result.add_argument("--zone-id")
    result.add_argument("--selection", help="Original economic selection; supplied costs include explicit footprint scope")
    result.add_argument("--run-id")
    result.add_argument("--implementation", action="store_true",
                        help="Carry the selected original scenario through a new native implementation plan and report")
    result.add_argument("--cost-review", help="Explicit original field-cost review selection JSON; includes the native implementation, cost-review and complete package journeys")
    result.add_argument("--cost-plan-id", help="With --cost-review, reopen this saved native plan and retain its actual ledger instead of creating a new plan")
    result.add_argument("--cost-candidate-id", help="Select this original economic candidate in --cost-plan-id; required when matching candidates are ambiguous")
    result.add_argument("--compare-editions", action="store_true",
                        help="With --cost-review, compare its actual original Economic edition and completed reviewed successor through the saved comparison UI and complete package")
    result.add_argument("--comparison-report", action="store_true",
                        help="With --compare-editions, register its original scientific source, render and receive the native report, then export the actual Study selection")
    result.add_argument("--notes", default="Reviewed in the original operator receiving walkthrough.")
    result.add_argument("--browser-executable")
    result.add_argument("--timeout-seconds", type=float, default=30)
    result.add_argument("--task-timeout-seconds", type=float, default=900)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    if args.phase != "all" or args.resume_journey:
        return phased_main(args, argv)
    journal = None
    started = time.perf_counter()
    try:
        require(args.timeout_seconds > 0 and args.task_timeout_seconds > 0, "Use positive browser and queue timeouts")
        require(not args.include_implementation_plan and not args.implementation_report_as_of,
                "Whole-plan Study receiving is an optional --phase native course; the original all phase stays unchanged.")
        require(not args.comparison_report or args.compare_editions,
                "--comparison-report requires the original --compare-editions course")
        require(not args.compare_editions or args.cost_review,
                "--compare-editions requires the original --cost-review journey")
        require(not args.cost_plan_id or args.cost_review,
                "--cost-plan-id requires the explicit original --cost-review JSON")
        require(not args.cost_candidate_id or args.cost_plan_id,
                "--cost-candidate-id requires --cost-plan-id and --cost-review")
        original_url, origin, token = read_url(args)
        parent = Path(args.output).resolve()
        parent.mkdir(parents=True, exist_ok=True)
        directory = parent / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
        directory.mkdir()
        replay = [sys.executable, "-B", str(Path(__file__).resolve()), *(sys.argv[1:] if argv is None else argv)]
        record = {"schema": "upstate.economic-operator-receiving/v1", "status": "running",
                  "started_at": now(), "operator_origin": origin, "receiving_directory": str(directory),
                  "receiver_sha256": digest(__file__), "steps": [], "tasks": [], "browser_errors": [],
                  "resume_command": shlex.join(replay)}
        record["application"] = str(Path(args.application).resolve())
        shutil.copyfile(__file__, directory / "economic_receive.py")
        journal = Journal(directory, token, record)
        journal.save()
        code = 0
        try:
            edition = receive_operator(args, original_url, origin, token, journal)
            with journal.stage("complete_exported_offline_journey") as step:
                application = Path(args.application).resolve(strict=True)
                sys.path.insert(0, str(application))
                from model import decision_receive
                arguments = ["--edition", str(edition), "--run-id", record["selected_run_id"],
                             "--notes", "Received the original complete package through the operator.",
                             "--timeout-seconds", str(args.timeout_seconds)]
                if args.browser_executable:
                    arguments.extend(["--browser-executable", args.browser_executable])
                captured = io.StringIO()
                with redirect_stdout(captured):
                    code = decision_receive.main(arguments)
                value = json.loads(captured.getvalue())
                step.update(exit_code=code, result=value)
                require(code == 0, "The original offline receiver returned " + str(code) + "; its retained result is in this step")
            record["status"] = "complete"
        except BrowserUnavailable as error:
            record.update(status="browser_unavailable", error={"type": type(error).__name__, "message": str(error)})
            code = 3
        except Exception as error:
            record.update(status="journey_failed", error={"type": type(error).__name__, "message": str(error)})
            code = 1
        record.update(finished_at=now(), total_seconds=round(time.perf_counter() - started, 6))
        record["artifacts"] = [descriptor(path, directory) for path in sorted(directory.rglob("*"))
                               if path.is_file() and path.name != "operator-journey.json"]
        journal.save()
        archive_path = directory / "economic-operator-receiving-package.zip"
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(directory.rglob("*")):
                if path.is_file() and path != archive_path:
                    archive.write(path, path.relative_to(directory).as_posix())
        result = {"status": record["status"], "workspace_key": record.get("workspace_key"),
                  "producer_report_id": record.get("producer_report_id"), "zone_id": record.get("zone_id"),
                  "edition_id": record.get("edition_id"), "report_id": record.get("report_id"),
                  "journey": str(directory / "operator-journey.json"), "archive": str(archive_path),
                  "browser_error_count": len(record["browser_errors"]), "resume_command": record["resume_command"]}
        if record.get("implementation"):
            result["implementation"] = record["implementation"]
        if record.get("economic_comparison"):
            result["economic_comparison"] = record["economic_comparison"]
        if record.get("economic_comparison_report"):
            result["economic_comparison_report"] = record["economic_comparison_report"]
        print(json.dumps(journal.clean(result), indent=2), flush=True)
        return code
    except Exception as error:
        message = journal.clean(str(error)) if journal else str(error)
        print(json.dumps({"status": "input_error", "error": type(error).__name__, "message": message}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
