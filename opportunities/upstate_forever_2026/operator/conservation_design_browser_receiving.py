#!/usr/bin/env python3
"""Continue the completed Conservation browser journey through the original editor.

Use the same original operator receipt and conservation-browser receiving.json.
Explicit land-cover codes/reason define this receiving alternative. The script
prepares the already-saved plan, opens its original embedded Scenario Design
project, creates/reopens one named alternative, downloads the complete native
handover, receives that ZIP through the real binary upload and original queue,
then reloads its saved scenario and optional prepared run. Native execution stays
with the existing run owner.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.parse import parse_qs, urlencode, urlsplit
import zipfile

from conservation_browser_receiving import file_record, read_json, require

SCHEMA = "upstate.conservation-design-browser-receiving/v1"


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
              "handover": report.get("handover"), "receiving_path": str(report_path)})), flush=True)

    if report["state"] == "complete":
        for field in ("editable_project", "handover"):
            expected = report[field]
            actual = file_record(expected["path"])
            require(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"],
                    "The retained original " + field + " changed.")
        complete_output()
        return

    from playwright.sync_api import sync_playwright, expect

    if report.get("error"):
        report.setdefault("earlier_attempts", []).append({
            "state": report["state"], "error": report["error"],
            "console_errors": report.get("console_errors", []), "page_errors": report.get("page_errors", [])})
    report.update(state="running", console_errors=[], page_errors=[])
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

        def request_record(request):
            if request.method != "POST" or urlsplit(request.url).path != "/api/actions":
                return
            value = request.post_data_json
            if (isinstance(value, dict) and value.get("workspace") == workspace
                    and value.get("action") in ("conservation.design.prepare", "conservation.design.receive")):
                report["pending_operations"][value["action"]] = value
                persist()

        page.on("request", request_record)

        def api(path, value=None, **query):
            query.setdefault("workspace", workspace)
            url = origin + path + "?" + urlencode(query)
            headers = {"Authorization": "Bearer " + capability}
            response = (context.request.get(url, headers=headers, timeout=45000) if value is None else
                        context.request.post(url, headers=headers, data=value, timeout=45000))
            body = response.json()
            require(response.ok, body.get("error", {}).get("message", "Original operator request failed."))
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

        def action(control, expected_action, report_key):
            existing = report["task_ids"].get(report_key)
            if existing:
                return task(existing, expected_action)
            request = report["pending_operations"].get(expected_action)
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

        try:
            page.goto(connection["operator_url"], wait_until="domcontentloaded")
            expect(page.locator("#workspace-select")).to_have_value(workspace)
            page.locator('[data-view="conservation-design"]').click()
            expect(page.locator(".cd-root")).to_be_visible()
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
