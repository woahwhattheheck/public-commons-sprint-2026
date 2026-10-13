#!/usr/bin/env python3
"""Run one conservation browser journey against the existing regional Workspace.

The existing receiving owner starts the original operator and retains its startup
JSON locally. This script reuses that operator and the regional receiver's study.
It checks two actual units, retains that cohort when the candidate catalog is
available, saves one original portfolio, reopens it after reload, and downloads
the original exported packet. An interrupted run resumes its retained task IDs.

Example:
  /opt/pyvenv/bin/python operator/conservation_browser_receiving.py \
    --operator-receipt /mnt/data/eco12-run/operator-startup.json \
    --regional-receiving WORKSPACE/conservation-receiving/regional-receiving.json \
    --output /mnt/data/eco12-run/receiving/browser-e7a1

Use --study-key protection_upstream or protection_reporting when the regional
result contains the original surface-water protection studies. The default
upstream key preserves the original geographic-context receiving journey.
Add --record-video when the installed Playwright runtime supports video.
Playwright references: https://playwright.dev/python/docs/downloads
                       https://playwright.dev/python/docs/videos
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import zipfile

OPERATION = "UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012-E7A1"
SCHEMA = "upstate.conservation-browser-receiving/v1"
TITLE = "E7A1 real watershed browser receiving"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def file_record(path):
    path = Path(path)
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"path": str(path.resolve()), "bytes": size, "sha256": digest.hexdigest()}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-receipt", required=True, type=Path)
    parser.add_argument("--regional-receiving", required=True, type=Path)
    parser.add_argument("--study-key", default="upstream",
                        help="Existing regional study key, including protection_upstream or protection_reporting.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--task-timeout", type=float, default=240)
    parser.add_argument("--record-video", action="store_true")
    args = parser.parse_args()
    require(math.isfinite(args.task_timeout) and args.task_timeout > 0,
            "Use a finite positive task timeout.")
    connection = read_json(args.operator_receipt)
    regional = read_json(args.regional_receiving)
    require(regional.get("operation") == OPERATION, "Use the E7A1 regional receiving result.")
    studies = regional.get("studies", {})
    require(isinstance(studies, dict), "The regional result needs its original study records.")
    selected_study = studies.get(args.study_key)
    require(isinstance(selected_study, dict) and selected_study.get("study_id"),
            "Choose a completed original regional study key. Available keys: " +
            ", ".join(sorted(studies)))
    operator_url = connection["operator_url"]
    parsed = urlsplit(operator_url)
    require(parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1"),
            "Use the local original operator startup receipt.")
    capability = parse_qs(parsed.fragment).get("token", [None])[0]
    require(capability, "The local startup receipt needs its original operator capability.")
    origin = parsed.scheme + "://" + parsed.netloc
    workspace = connection["workspace_key"]
    study_id = selected_study["study_id"]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "receiving.json"
    report = read_json(report_path) if report_path.exists() else {
        "schema": SCHEMA, "operation": OPERATION, "study_id": study_id,
        "workspace_key": workspace, "workspace": regional.get("workspace"),
        "regional_receiving": file_record(args.regional_receiving),
        "study_key": args.study_key, "screenshots": [], "console_errors": [],
        "page_errors": [], "task_ids": {}, "state": "ready",
    }
    require(report.get("schema") == SCHEMA and report.get("operation") == OPERATION
            and report.get("study_id") == study_id and report.get("workspace_key") == workspace,
            "Use a separate output directory for a different Workspace or study.")

    def clean(value):
        # Startup capabilities stay only in this process and the owner's local receipt.
        return str(value).replace(capability, "[private capability]")

    def persist():
        temporary = report_path.with_suffix(".json.tmp")
        temporary.write_text(clean(json.dumps(report, ensure_ascii=False, indent=2)) + "\n",
                             encoding="utf-8")
        temporary.replace(report_path)

    def say():
        result = {key: report.get(key) for key in
                  ("state", "study_id", "plan_id", "packet", "video")}
        result["receiving_path"] = str(report_path)
        print(clean(json.dumps(result, ensure_ascii=False)), flush=True)

    if report.get("state") == "complete" and report.get("packet"):
        current = file_record(report["packet"]["path"])
        require(current["bytes"] == report["packet"]["bytes"]
                and current["sha256"] == report["packet"]["sha256"],
                "The retained browser packet changed.")
        say()
        return

    action_names = {
        "catalog": "conservation.catalog.prepare",
        "catalog_selection": "conservation.catalog.select",
        "plan": None,
        "export": "conservation.export",
    }
    operations = report.setdefault("operations", {})
    require(isinstance(operations, dict), "Retain the original receiving action records.")
    for key, value in operations.items():
        expected = action_names.get(key)
        allowed = ("conservation.plan.save", "conservation.catalog.plan.save") if key == "plan" else (expected,)
        require(key in action_names and isinstance(value, dict)
                and value.get("workspace") == workspace and value.get("action") in allowed
                and isinstance(value.get("payload"), dict)
                and isinstance(value.get("operation_id"), str) and value["operation_id"].strip(),
                "The retained receiving request identifies another original operation.")

    from playwright.sync_api import sync_playwright, expect

    if report.get("error") or report.get("page_errors") or report.get("console_errors"):
        report.setdefault("earlier_attempts", []).append({
            key: report.get(key) for key in ("state", "error", "page_errors", "console_errors")
        })
    report["state"] = "running"
    report["page_errors"] = []
    report["console_errors"] = []
    report.pop("error", None)
    persist()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True)
        options = {"viewport": {"width": 1880, "height": 1100},
                   "accept_downloads": True, "locale": "en-US"}
        if args.record_video:
            options["record_video_dir"] = str(output / "video")
            options["record_video_size"] = {"width": 1880, "height": 1100}
        context = browser.new_context(**options)
        page = context.new_page()
        page.set_default_timeout(45000)
        video = page.video if args.record_video else None

        def console(message):
            if message.type == "error":
                report["console_errors"].append(clean(message.text))

        page.on("console", console)
        page.on("pageerror", lambda error: report["page_errors"].append(clean(error)))
        pending_action = {}

        def record_action(request):
            if (not pending_action or request.method != "POST"
                    or urlsplit(request.url).path != "/api/actions"):
                return
            value = request.post_data_json
            if (isinstance(value, dict) and value.get("workspace") == workspace
                    and value.get("action") == pending_action["action"]):
                require(isinstance(value.get("payload"), dict)
                        and isinstance(value.get("operation_id"), str) and value["operation_id"].strip(),
                        "The original queued action needs its complete request and operation identity.")
                operations[pending_action["key"]] = value
                persist()

        page.on("request", record_action)

        def get(path, **query):
            query.setdefault("workspace", workspace)
            response = context.request.get(origin + path + "?" + urlencode(query),
                headers={"Authorization": "Bearer " + capability}, timeout=45000)
            value = response.json()
            require(response.ok, value.get("error", {}).get("message", "Operator read failed."))
            return value

        def task(task_id, expected_action, payload=None):
            deadline = time.monotonic() + args.task_timeout
            resumed = False
            while True:
                value = get("/api/task", id=task_id)
                require(value.get("id") == task_id and value.get("workspace") == workspace
                        and value.get("action") == expected_action
                        and (payload is None or value.get("payload") == payload),
                        "The retained task identifies another original Workspace action.")
                if value.get("state") == "complete":
                    return value
                if value.get("state") == "interrupted" and not resumed:
                    response = context.request.post(
                        origin + "/api/task/resume", data={"id": task_id},
                        headers={"Authorization": "Bearer " + capability}, timeout=45000)
                    require(response.ok, "The original interrupted task could not resume.")
                    resumed = True
                    continue
                if value.get("state") in ("failed", "cancelled", "interrupted"):
                    raise ValueError("Workspace task " + task_id + ": " +
                                     json.dumps(value.get("error") or value.get("state")))
                if time.monotonic() >= deadline:
                    raise TimeoutError("Workspace task remains active: " + task_id)
                time.sleep(1)

        def photograph(name):
            path = output / name
            page.screenshot(path=str(path), full_page=True, animations="disabled")
            report["screenshots"] = [item for item in report["screenshots"]
                                     if item["path"] != str(path)] + [file_record(path)]
            persist()

        def remember_response(response, expected_action, report_key):
            submitted = response.json()
            require(response.status == 202 and submitted.get("id"),
                    json.dumps(submitted.get("error") or submitted))
            require(submitted.get("action") == expected_action,
                    "The browser submitted a different Workspace action.")
            report["task_ids"][report_key] = submitted["id"]
            persist()
            return submitted["id"]

        def saved_action(expected_action, report_key):
            original = operations.get(report_key)
            if original is not None:
                require(original["action"] == expected_action,
                        "The retained request belongs to another original receiving phase.")
            existing = report["task_ids"].get(report_key)
            if not existing and original is not None:
                response = context.request.post(
                    origin + "/api/actions", data=original,
                    headers={"Authorization": "Bearer " + capability}, timeout=45000)
                existing = remember_response(response, expected_action, report_key)
            if existing:
                return task(existing, expected_action,
                            original["payload"] if original is not None else None)
            return None

        def action(control, expected_action, report_key):
            retained_task = saved_action(expected_action, report_key)
            if retained_task is not None:
                return retained_task
            pending_action.update(key=report_key, action=expected_action)
            try:
                with page.expect_response(lambda response:
                        urlsplit(response.url).path == "/api/actions"
                        and response.request.method == "POST"
                        and isinstance(response.request.post_data_json, dict)
                        and response.request.post_data_json.get("action") == expected_action) as pending:
                    control.click()
                response = pending.value
                require(report_key in operations,
                        "Retain the original action request before accepting its queue response.")
                task_id = remember_response(response, expected_action, report_key)
            finally:
                pending_action.clear()
            return task(task_id, expected_action, operations[report_key]["payload"])

        def open_retained_task(task_id):
            # A resumed task may already be complete without an open task dialog.
            control = page.locator('[data-action="task-open"][data-id=' +
                                   json.dumps(task_id) + "]")
            if not control.is_visible():
                page.locator('.top-actions [data-action="tasks"]').click()
            expect(control).to_be_visible()
            control.click()
            expect(page.locator("#detail-dialog[open]")).to_be_visible()

        try:
            for key, original in list(operations.items()):
                saved_action(original["action"], key)
            page.goto(operator_url, wait_until="domcontentloaded")
            expect(page.locator("#workspace-select")).to_have_value(workspace)
            page.locator('[data-view="conservation"]').click()
            root = page.locator("#conservation-workspace")
            expect(root).to_be_visible()
            page.locator('[data-action="conservation-open-study"][data-study-id=' +
                         json.dumps(study_id) + "]").click()
            inventory_or_prepare = page.locator(
                '.cons-candidates, [data-action="conservation-catalog-prepare"]')
            expect(inventory_or_prepare.first).to_be_visible()
            prepare_search = page.locator('[data-action="conservation-catalog-prepare"]')
            if prepare_search.is_visible():
                prepared = action(prepare_search, "conservation.catalog.prepare", "catalog")
                require(prepared["result"].get("study_id") == study_id,
                        "Candidate search preparation returned another original study.")
                opener = page.locator(
                    '#detail-dialog [data-action="conservation-open-study"][data-study-id=' +
                    json.dumps(study_id) + "]")
                expect(opener).to_be_visible()
                opener.click()
            expect(page.locator(".cons-candidates")).to_be_visible()
            state = get("/api/conservation/study", study_id=study_id)
            require(state.get("state") == "complete", "Open a completed regional candidate inventory.")
            candidates = state.get("candidates", [])
            require(len(candidates) == selected_study.get("actual_candidate_count"),
                    "The browser inventory differs from the completed regional inventory.")
            report["candidate_count"] = len(candidates)
            report["mode"] = state.get("mode")
            report["metric_state"] = state.get("metric_state")
            report["water_context"] = state.get("spec", {}).get("contexts", {}).get("drinking_water")
            photograph("01-inventory.png")

            eligible = {str(row["id"]): row for row in candidates
                        if row.get("eligible") and row.get("reporting_area_ha", 0) > 0}
            protection_ids = selected_study.get("eligible_positive_protection_overlap_huc12")
            if protection_ids is not None:
                require(isinstance(protection_ids, list),
                        "The original protection study needs its positive-overlap unit inventory.")
                positive = {str(value) for value in protection_ids}
                eligible = {key: row for key, row in eligible.items()
                            if key in positive and isinstance(row.get("source_water_fraction"), (int, float))
                            and row["source_water_fraction"] > 0}
                report["selection_context"] = "Original surface-water protection overlap"
            preferred = [str(value) for value in selected_study.get("selected_original_huc12", [])
                         if str(value) in eligible]
            ordered = list(dict.fromkeys(preferred + sorted(eligible)))
            selected = report.get("selected_ids") or ordered[:2]
            require(len(selected) == 2 and all(value in eligible for value in selected),
                    "This browser journey needs two actual eligible planning units.")
            report["selected_ids"] = selected
            report["selected_candidates"] = [eligible[value] for value in selected]
            report["regional_plan_id"] = selected_study.get("plan_id")
            persist()
            clear = page.locator('[data-action="conservation-clear-selection"]')
            if clear.is_enabled():
                clear.click()
            page.locator('[data-filter="eligibility"]').select_option("all")
            for unit_id in selected:
                page.locator('[data-filter="search"]').fill(unit_id)
                page.locator('input[data-candidate-id=' + json.dumps(unit_id) + "]").check()
            page.locator('[data-filter="search"]').fill("")
            page.locator('[data-filter="eligibility"]').select_option("selected")
            expect(page.locator(".cons-candidates input[data-candidate-id]:checked")).to_have_count(2)
            retain_control = page.locator('[data-action="conservation-select-matching"]')
            catalog_selection_id = report.get("catalog_selection_id")
            use_catalog = bool(retain_control.count()) and (
                not report["task_ids"].get("plan") or bool(catalog_selection_id))
            if use_catalog:
                retained_task = action(retain_control, "conservation.catalog.select", "catalog_selection")
                retained = retained_task["result"]
                require(retained.get("study_id") == study_id and retained.get("count") == len(selected)
                        and retained.get("selection_id"),
                        "Retain exactly the two checked original units from this study.")
                catalog_selection_id = retained["selection_id"]
                report["catalog_selection_id"] = catalog_selection_id
                report["catalog_selection"] = retained
                persist()
                if not page.locator("#detail-dialog[open]").count():
                    open_retained_task(report["task_ids"]["catalog_selection"])
                opener = page.locator(
                    '#detail-dialog [data-action="conservation-open-study"][data-study-id=' +
                    json.dumps(study_id) + "][data-selection-id=" +
                    json.dumps(catalog_selection_id) + "]")
                expect(opener).to_be_visible()
                opener.click()
                expect(page.locator(".cons-help").filter(
                    has_text="Complete retained cohort: " + catalog_selection_id)).to_be_visible()
                expect(page.locator(".cons-candidates")).to_be_visible()
                page.locator('[data-filter="eligibility"]').select_option("selected")
                expect(page.locator(".cons-candidates input[data-candidate-id]:checked")).to_have_count(2)
            photograph("02-selection.png")

            if not report["task_ids"].get("plan"):
                page.locator('[data-action="conservation-new-portfolio"]').click()
                page.locator('[data-field="plan.title"]').fill(TITLE)
                page.locator('[data-field="plan.mode"]').select_option("manual")
                page.locator('[data-field="plan.area_basis"]').select_option("whole_units")
            plan_action = "conservation.catalog.plan.save" if use_catalog else "conservation.plan.save"
            saved_task = action(page.locator('[data-action="conservation-save-plan"]'),
                                plan_action, "plan")
            plan_result = saved_task["result"].get("plan") or saved_task["result"]
            plan_id = plan_result["id"]
            report["plan_id"] = plan_id
            persist()
            if page.locator('#detail-dialog[open]').count():
                opener = page.locator('#detail-dialog [data-action="conservation-open-plan"][data-plan-id=' +
                                      json.dumps(plan_id) + "]")
                expect(opener).to_be_visible()
                opener.click()
            else:
                page.locator('[data-action="conservation-close-study"]').click()
                page.locator('[data-action="conservation-refresh"]').click()
                page.locator('[data-action="conservation-open-plan"][data-plan-id=' +
                             json.dumps(plan_id) + "]").click()
            saved = get("/api/conservation/plan", plan_id=plan_id)
            require(sorted(saved["selected_ids"]) == sorted(selected),
                    "The saved portfolio differs from the checked native units.")
            if use_catalog:
                cohort = saved.get("selection", {}).get("catalog_selection", {})
                require(cohort.get("selection_id") == catalog_selection_id
                        and cohort.get("resolved_count") == len(selected)
                        and not cohort.get("include_ids") and not cohort.get("exclude_ids"),
                        "The saved original portfolio lost its exact retained cohort.")
                report["saved_catalog_selection"] = cohort
            portfolio = page.locator('[aria-label="Saved portfolio"]')
            expect(portfolio).to_be_visible()
            expect(portfolio.get_by_role("heading", name=TITLE, exact=True)).to_be_visible()
            report["summary"] = saved["summary"]
            report["saved_visible_summary"] = portfolio.locator(".cons-summary").inner_text()
            photograph("03-saved-portfolio.png")

            page.reload(wait_until="domcontentloaded")
            expect(page.locator("#conservation-workspace")).to_be_visible()
            page.locator('[data-action="conservation-open-plan"][data-plan-id=' +
                         json.dumps(plan_id) + "]").click()
            expect(page.locator('[aria-label="Saved portfolio"]')).to_be_visible()
            reopened = get("/api/conservation/plan", plan_id=plan_id)
            require(reopened["id"] == saved["id"]
                    and reopened["selected_ids"] == saved["selected_ids"]
                    and reopened["selection"] == saved["selection"]
                    and reopened["summary"] == saved["summary"],
                    "Reopened portfolio identity, selection or quantities changed.")
            report["reopened_plan_id"] = reopened["id"]
            report["reopened_selection_matches"] = True
            report["reopened_visible_summary"] = page.locator(
                '[aria-label="Saved portfolio"] .cons-summary').inner_text()
            require(report["saved_visible_summary"] == report["reopened_visible_summary"],
                    "Saved and reopened visible totals differ.")
            photograph("04-reopened.png")

            export_task = action(page.locator('[data-action="conservation-export-plan"]'),
                                 "conservation.export", "export")
            descriptor = export_task["result"]
            tickets = [item for item in export_task.get("_downloads", [])
                       if item.get("sha256") == descriptor.get("sha256")
                       and str(item.get("filename", "")).endswith(".zip")]
            require(len(tickets) == 1, "The completed export needs its original ZIP download ticket.")
            ticket = tickets[0]
            if not page.locator("#detail-dialog[open]").count():
                task_id = report["task_ids"]["export"]
                button = page.locator('[data-action="task-open"][data-id=' + json.dumps(task_id) + "]")
                if not button.is_visible():
                    page.locator('.top-actions [data-action="tasks"]').click()
                expect(button).to_be_visible()
                button.click()
            download_link = page.locator("#detail-dialog a[href=" +
                                         json.dumps(ticket["url"] + "?download=1") + "]")
            expect(download_link).to_be_visible()
            packet_path = output / "portfolio-packet.zip"
            with page.expect_download() as pending:
                download_link.click()
            download = pending.value
            require(download.failure() is None, "The browser export download failed.")
            download.save_as(str(packet_path))
            actual = file_record(packet_path)
            require(actual["bytes"] == descriptor["bytes"]
                    and actual["sha256"] == descriptor["sha256"],
                    "The browser download differs from the original exported packet.")
            with zipfile.ZipFile(packet_path) as archive:
                require(archive.testzip() is None, "A downloaded packet member failed its CRC check.")
                members = [{"path": item.filename, "bytes": item.file_size}
                           for item in archive.infolist() if not item.is_dir()]
            report["packet"] = {**actual, "members": members}
            report["page_errors"] = list(dict.fromkeys(report["page_errors"]))
            report["console_errors"] = list(dict.fromkeys(report["console_errors"]))
            require(not report["page_errors"], "The browser reported a JavaScript error; inspect receiving.json.")
            report["state"] = "complete"
            report["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            persist()
        except Exception as error:
            report["state"] = "failed"
            report["error"] = clean(type(error).__name__ + ": " + str(error))
            try:
                photograph("failure.png")
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
    say()


if __name__ == "__main__":
    main()
