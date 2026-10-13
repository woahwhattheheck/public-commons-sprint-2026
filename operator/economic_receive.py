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


def extract_edition(archive_path, destination):
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
                target.write_bytes(archive.read(item))
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == "upstate.decision-delivery/v1",
            "The downloaded package is not the original decision delivery")
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

            with journal.stage("choose_native_report_and_zone") as step:
                reports = catalog["reports"]
                selected = next((item for item in reports if item["id"] == args.report_id), None) if args.report_id else next(
                    (item for item in reports if item["alternative_count"] and item["ready_zones"]), None)
                require(selected is not None, "Choose a completed native report with available alternatives and a common-support zone")
                report_id = selected["id"]
                source = get("/api/economic-desk/source", workspace=workspace, report_id=report_id)
                zones = source["zones"]
                zone = next((item for item in zones if item["zone_id"] == args.zone_id), None) if args.zone_id else next(
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
                chosen = next((item for item in candidates if item["run_id"] == args.run_id), None) if args.run_id else next(
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
            if args.implementation:
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


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--operator-url-file", help="Text file with the original printed URL, or JSON containing url")
    result.add_argument("--operator-url-env", default="UPSTATE_OPERATOR_URL", help="Existing URL environment variable when no file is supplied")
    result.add_argument("--output", required=True, help="Directory receiving a new timestamped journey for each invocation")
    result.add_argument("--application", default=str(Path(__file__).resolve().parent.parent), help="Existing complete application root")
    result.add_argument("--workspace-key")
    result.add_argument("--report-id")
    result.add_argument("--zone-id")
    result.add_argument("--selection", help="Original economic selection; supplied costs include explicit footprint scope")
    result.add_argument("--run-id")
    result.add_argument("--implementation", action="store_true",
                        help="Carry the selected original scenario through a new native implementation plan and report")
    result.add_argument("--notes", default="Reviewed in the original operator receiving walkthrough.")
    result.add_argument("--browser-executable")
    result.add_argument("--timeout-seconds", type=float, default=30)
    result.add_argument("--task-timeout-seconds", type=float, default=900)
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    journal = None
    started = time.perf_counter()
    try:
        require(args.timeout_seconds > 0 and args.task_timeout_seconds > 0, "Use positive browser and queue timeouts")
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
        print(json.dumps(journal.clean(result), indent=2), flush=True)
        return code
    except Exception as error:
        message = journal.clean(str(error)) if journal else str(error)
        print(json.dumps({"status": "input_error", "error": type(error).__name__, "message": message}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
