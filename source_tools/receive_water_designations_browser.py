"""Run the actual water-designation browser journey against a running operator.

Use the startup JSON/JSONL emitted by operator/server.py and the result from
receive_water_designations.py. The operator URL contains a private capability;
this runner retains only the origin in its report. It uses the normal controls,
task queue and browser downloads in the supplied Workspace.

Example:
  python -B source_tools/receive_water_designations_browser.py \
    --operator-start /path/to/operator-start.jsonl \
    --native-result /path/to/water-designation-receiving.json \
    --browser /usr/bin/chromium --output /path/to/browser-results

The journey follows the registered Map atlas desk, with the original delivery
dialog as fallback. Add --require-delivery-form when this Workspace has the
original completed baseline and alternative runs. Source-only receiving can
inspect the atlas draft; the legacy dialog shows its native run prerequisite.
Supply --delivery-selection /path/to/delivery-selection.json to also fill the
original delivery form with those actual prepared choices and submit its build.
The high-quality-water overlay is the revision saved by this browser journey.

Playwright API references:
https://playwright.dev/python/docs/api/class-page
https://playwright.dev/python/docs/downloads
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, unquote, urlsplit

APPLICATION = Path(__file__).resolve().parents[1]
RULE = {
    "title": "South Carolina R.61-69, Classified Waters",
    "uri": "https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf",
    "edition": "Amended May 26, 2023; Document 5116; retrieved October 13, 2026",
    "section": "Sections E-F and H; PDF pages 4 and 12",
}
DELIVERY_PREREQUISITE = (
    "Complete both NDR and SDR for the original baseline and at least one alternative before "
    "assembling the seven-map delivery."
)
SUCCESS_STATES = {"succeeded", "success", "completed", "complete", "done", "finished"}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def file_info(path):
    data = Path(path).read_bytes()
    return {"path": str(Path(path).resolve()), "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def startup_record(path):
    text = Path(path).read_text(encoding="utf-8")
    try:
        records = [json.loads(text)]
    except json.JSONDecodeError:
        records = []
        for line in text.splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    records = [r for r in records if isinstance(r, dict) and r.get("operator_url")]
    require(records, "The startup file has no emitted operator_url record.")
    return records[-1]


def feature_ids(features, id_field):
    result = []
    for feature in features:
        properties = feature.get("properties") or {}
        value = properties.get(id_field) if id_field in properties else feature.get("id")
        require(value is not None and not isinstance(value, bool) and str(value) != "",
                "A selected feature is missing its bound native identity.")
        result.append(str(value))
    require(len(result) == len(set(result)), "The selected native feature IDs are not unique.")
    return set(result)


def response_path(response):
    return urlsplit(response.url).path


def match_response(path, method=None):
    return lambda response: response_path(response) == path and (
        method is None or response.request.method == method)


def query_value(response, key):
    return parse_qs(urlsplit(response.url).query).get(key, [""])[0]


def response_json(response):
    value = response.json()
    require(response.ok, "HTTP " + str(response.status) + " at " + response_path(response)
            + ": " + str(value.get("message") or value.get("error") or value)[:1200])
    return value


def task_object(value):
    return value.get("task") or value


def task_state(value):
    return str(value.get("state") or value.get("status") or "").lower().replace(" ", "_")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    startup = parser.add_mutually_exclusive_group(required=True)
    startup.add_argument("--operator-start", type=Path,
                         help="Existing server stdout JSON or JSONL; keeps its capability off the command line.")
    startup.add_argument("--operator-url", help="Full emitted URL, including its private token fragment.")
    parser.add_argument("--native-result", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workspace-key", help="Optional explicit operator workspace key.")
    parser.add_argument("--application", type=Path, default=APPLICATION)
    parser.add_argument("--source-geojson", type=Path,
                         help="Exact retained Chattooga/Chauga capture; defaults to the application source bank.")
    parser.add_argument("--browser", help="Chromium executable, for example /usr/bin/chromium.")
    parser.add_argument("--playwright-path", type=Path,
                         help="Parent directory of an existing Python playwright package, if needed.")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--timeout-seconds", type=float, default=180)
    parser.add_argument("--require-delivery-form", action="store_true")
    parser.add_argument("--delivery-selection", type=Path,
                         help="Explicit prepared delivery-selection.json; fill and submit the actual delivery form.")
    parser.add_argument("--title", default="Chattooga and Chauga ORW browser receiving")
    args = parser.parse_args(argv)
    if args.playwright_path:
        sys.path.insert(0, str(args.playwright_path.resolve()))

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "water-designation-browser.json"
    report = {"schema": "upstate.water-designation-browser/v1",
              "started_at": datetime.now(timezone.utc).isoformat(),
              "stage": "prepare", "outcome": "running",
              "milestones": [], "exports": {}, "screenshots": {},
              "page_errors": [], "http_errors": []}
    private_values = []
    browser = context = page = playwright = None

    def redact(value):
        text = str(value)
        for private in private_values:
            if private:
                text = text.replace(private, "[private capability]")
        text = re.sub(r"#token=[^ \t\r\n\"'<>]+", "#token=[private]", text)
        return re.sub(r"/api/file/[^ \t\r\n\"'<>]+", "/api/file/[private]", text)

    def capture(path, timeout=None):
        # A fresh context uses only the supplied capability. Mask any occurrence
        # in rendered error text or form values before retaining a screenshot.
        secrets = list(dict.fromkeys(v for v in private_values if v))
        masks = []
        if secrets:
            masks.append(page.get_by_text(re.compile("|".join(re.escape(v) for v in secrets))))
            fields = page.locator("input, textarea")
            indexes = fields.evaluate_all(
                "(nodes, secrets) => nodes.flatMap((node, index) => "
                "secrets.some(value => String(node.value || '').includes(value)) ? [index] : [])",
                secrets)
            masks.extend(fields.nth(index) for index in indexes)
        options = {"path": path, "animations": "disabled", "mask": masks}
        if timeout is not None:
            options["timeout"] = timeout
        page.screenshot(**options)
        return file_info(path)

    def checkpoint(stage, **detail):
        report["stage"] = stage
        report["milestones"].append({"stage": stage, **detail})
        pending = report_path.with_suffix(".pending")
        pending.write_text(redact(json.dumps(report, ensure_ascii=False, indent=2)) + "\n",
                           encoding="utf-8")
        pending.replace(report_path)
        print(json.dumps({"stage": stage, **detail}, ensure_ascii=False), flush=True)

    try:
        require(args.timeout_seconds > 0, "Set a positive timeout.")
        start = startup_record(args.operator_start) if args.operator_start else {
            "operator_url": args.operator_url}
        operator_url = start["operator_url"]
        parsed = urlsplit(operator_url)
        require(parsed.scheme in {"http", "https"} and parsed.netloc,
                "Use the full HTTP operator_url emitted by the running server.")
        token = parse_qs(parsed.fragment).get("token", [""])[0]
        require(token, "The emitted operator URL must include its token fragment.")
        private_values.extend([operator_url, token, unquote(token)])
        workspace_key = args.workspace_key or start.get("workspace_key")
        native = read_json(args.native_result)
        prepared_delivery = read_json(args.delivery_selection) if args.delivery_selection else None
        if prepared_delivery is not None:
            require(isinstance(prepared_delivery, dict)
                    and prepared_delivery.get("baseline_run_id")
                    and prepared_delivery.get("scenario_run_ids")
                    and prepared_delivery.get("source_roles")
                    and prepared_delivery.get("overlays", {}).get("drinking_water")
                    and prepared_delivery.get("title")
                    and all(prepared_delivery.get("contact", {}).get(key)
                            for key in ("name", "organization", "email")),
                    "Use the complete actual prepared delivery-selection.json with runs, sources and contact.")
            report["prepared_delivery_file"] = file_info(args.delivery_selection)
        require(native.get("schema") == "upstate.water-designation-receiving/v1",
                "Use the completed native water-designation receiving result.")
        source_path = args.source_geojson or (
            args.application / "source/water-designations-case/chattooga_chauga_classified_water.geojson")
        source_info = file_info(source_path)
        require(source_info["sha256"] == native["source_sha256"],
                "The retained source file differs from the native receiving edition.")
        original = read_json(source_path)["features"]
        require(len(original) == native["source_features"] == 377,
                "This journey requires the actual 377-feature named-river capture.")
        report.update({"origin": parsed.scheme + "://" + parsed.netloc,
                       "native_result": str(args.native_result.resolve()),
                       "native_workspace": native["workspace"], "source_file": source_info,
                       "browser_receiving_title": args.title})
        checkpoint("source_edition_loaded", source_features=len(original))

        from playwright.sync_api import sync_playwright, expect
        expect.set_options(timeout=args.timeout_seconds * 1000)
        playwright = sync_playwright().start()
        launch = {"headless": not args.headed, "timeout": args.timeout_seconds * 1000}
        if args.browser:
            launch["executable_path"] = str(Path(args.browser).resolve())
        browser = playwright.chromium.launch(**launch)
        context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1100},
                                      locale="en-US")
        context.set_default_timeout(args.timeout_seconds * 1000)
        page = context.new_page()
        report["browser"] = {"engine": "chromium", "version": browser.version,
                             "viewport": {"width": 1440, "height": 1100}}
        observed = []

        def observe(response):
            path = response_path(response)
            if path in {"/api/task", "/api/actions", "/api/state",
                        "/api/water-designations/item",
                        "/web/water_designations.mjs", "/web/water_designations.css"}:
                observed.append(response)
            if response.status >= 400 and path.startswith("/api/"):
                report["http_errors"].append({"path": path, "status": response.status})

        page.on("response", observe)
        page.on("pageerror", lambda error: report["page_errors"].append(redact(error)))
        page.goto(operator_url, wait_until="domcontentloaded")
        picker = page.locator("#workspace-select")
        expect(picker).to_be_visible()
        if workspace_key:
            expect(picker.locator("option[value=" + json.dumps(str(workspace_key)) + "]")).to_have_count(1)
            if picker.input_value() != workspace_key:
                with page.expect_response(match_response("/api/state", "GET")) as changed:
                    picker.select_option(workspace_key)
                response_json(changed.value)
            expect(picker).to_have_value(workspace_key)
        else:
            workspace_key = picker.input_value()
            require(workspace_key, "The original operator did not select a Workspace.")
        report["workspace_key"] = workspace_key

        navigation = page.locator('.sidebar button[data-view="water-designations"]')
        expect(navigation).to_be_visible()
        with page.expect_response(match_response("/api/water-designations", "GET")) as inventory:
            navigation.click()
        catalog = response_json(inventory.value)
        require(query_value(inventory.value, "workspace") == workspace_key,
                "The designation catalog belongs to a different operator Workspace.")
        desk = page.locator(".wd")
        expect(desk).to_be_visible()
        expect(navigation).to_have_attribute("aria-current", "page")
        retained_id = (prepared_delivery or {}).get("overlays", {}).get(
            "high_quality_waters", {}).get("selection_id") or native["selection_id"]
        existing = next((r for r in catalog["selections"] if r["id"] == retained_id), None)
        require(existing, "The selected Workspace does not contain its supplied native receiving revision.")
        report["receiving_selection_id"] = retained_id
        original_source = existing["source"]
        source = next((r for r in catalog["sources"]
                       if r["source_collection_id"] == original_source["source_collection_id"]
                       and r["source_id"] == original_source["source_id"]
                       and (not r.get("layer") or r["layer"] == original_source.get("layer"))), None)
        require(source, "The original source edition is absent from the designation source choices.")
        source_value = json.dumps([source["source_collection_id"], source["source_id"],
                                   source.get("layer") or ""], ensure_ascii=False, separators=(",", ":"))
        with page.expect_response(match_response("/api/water-designations/inspect", "POST")) as inspected:
            desk.locator('[data-ref="sourceSelect"]').select_option(source_value)
        inspection = response_json(inspected.value)
        require(inspection["source"]["sha256"] == native["source_sha256"]
                and inspection["source"]["layer"] == original_source["layer"],
                "The browser inspector opened a different retained source edition or layer.")
        require(inspection["total_features"] == len(original)
                and len(inspection["features"]) == len(original),
                "The 377-feature source did not load completely in its first native page.")
        id_field, class_field = inspection["id_field"], inspection["class_field"]
        require(id_field == "OBJECTID_1" and class_field == "H2OCLASS",
                "The capture requires its original OBJECTID_1 / H2OCLASS binding.")
        expected_ids = feature_ids([f for f in original if f["properties"][class_field] == "ORW"], id_field)
        require(len(expected_ids) == native["selected_features"] == 332,
                "The retained native source does not contain the expected 332 exact ORW features.")
        require(feature_ids(inspection["features"], id_field) == feature_ids(original, id_field),
                "The browser source page changed the original feature identities.")
        actual_class = next((row for row in inspection["classes"] if row["value"] == "ORW"), None)
        require(actual_class and actual_class["count"] == len(expected_ids),
                "The native class inventory does not report exact ORW membership.")
        expect(desk.locator('[data-ref="loadedCount"]')).to_have_text("377 / 377 loaded")
        report["source"] = inspection["source"]
        checkpoint("source_opened", source_id=source["source_id"], id_field=id_field, class_field=class_field)

        desk.locator('[data-ref="purpose"]').select_option("high_quality_waters")
        desk.locator('[data-mode="classes"]').click()
        desk.locator('[data-action="clear-classes"]').click()
        class_selector = "input[data-class-key=" + json.dumps(json.dumps("ORW")) + "]"
        desk.locator(class_selector).check()
        for ref, value in {"title": args.title, "ruleTitle": RULE["title"], "ruleUri": RULE["uri"],
                           "ruleEdition": RULE["edition"], "ruleSection": RULE["section"],
                           "notes": "Exact ORW classes in the retained Chattooga and Chauga capture. "
                                    "Mapped bank and shoreline linework retains the original feature identities."}.items():
            desk.locator('[data-ref="' + ref + '"]').fill(value)

        def preview(ids):
            with page.expect_response(match_response("/api/water-designations/preview", "POST")) as event:
                desk.locator('[data-action="preview"]').click()
            value = response_json(event.value)
            require(value["summary"]["selected_features"] == len(ids)
                    and feature_ids(value["geojson"]["features"], id_field) == ids,
                    "The browser preview does not match the exact native selection.")
            expect(desk.locator('[data-ref="metricFeatures"]')).to_have_text(str(len(ids)))
            expect(desk.locator('[data-ref="previewState"]')).to_have_text("Current preview")
            return value

        preview(expected_ids)
        excluded_id = sorted(expected_ids)[0]
        desk.locator('[data-ref="featureSearch"]').fill(excluded_id)
        exclusion = desk.locator('[data-ref="featureRows"] [data-action="toggle-exclusion"]'
                                 '[data-key=' + json.dumps(excluded_id) + "]")
        exclusion.click()
        preview(expected_ids - {excluded_id})
        desk.locator('[data-action="clear-exclusions"]').click()
        desk.locator('[data-ref="featureSearch"]').fill("")
        selected_preview = preview(expected_ids)
        report["summary"] = selected_preview["summary"]
        report["measure_notes"] = selected_preview.get("measure_notes", [])
        checkpoint("selection_previewed", selected_features=len(expected_ids),
                   excluded_native_id=excluded_id, excluded_features=len(expected_ids) - 1)

        with page.expect_response(match_response("/api/actions", "POST")) as action:
            desk.locator('[data-action="save"]').click()
        task = task_object(response_json(action.value))
        task_id = task.get("id") or task.get("task_id")
        require(task_id, "The save did not return a native task ID.")
        report["task_id"] = task_id
        checkpoint("save_queued", task_id=task_id)
        page.wait_for_function(
            """expected => {
                const status = document.querySelector('.wd [data-ref="taskStatus"]')?.textContent || '';
                const info = document.querySelector('.wd [data-ref="savedInfo"]')?.textContent || '';
                return info === expected || /failed|unavailable|refresh needed/i.test(status);
            }""", arg="Saved: " + args.title)
        saved_info = desk.locator('[data-ref="savedInfo"]').inner_text()
        require(saved_info == "Saved: " + args.title,
                "The save did not finish reopening its result: " + desk.locator('[data-ref="notice"]').inner_text())
        saved_id = desk.locator('[data-ref="savedSelect"]').input_value()
        require(saved_id, "The completed save did not install its saved revision.")
        completed_task = task if task_state(task) in SUCCESS_STATES else None
        for response in reversed(observed):
            if response_path(response) == "/api/task" and query_value(response, "id") == task_id:
                candidate = task_object(response_json(response))
                if task_state(candidate) in SUCCESS_STATES:
                    completed_task = candidate
                    break
        require(completed_task, "A complete native task response was not observed for this saved revision.")
        report["task_state"] = task_state(completed_task)
        report["selection_id"] = saved_id
        checkpoint("revision_saved", selection_id=saved_id)

        desk.locator('[data-ref="savedSelect"]').select_option(saved_id)
        with page.expect_response(match_response("/api/water-designations/item", "GET")) as reopened:
            with page.expect_response(match_response("/api/water-designations/inspect", "POST")) as reopened_source:
                desk.locator('[data-action="open-saved"]').click()
        record = response_json(reopened.value)
        record = record.get("record") or record.get("item") or record
        require(record["id"] == saved_id and record["state"] == "complete",
                "The reopened record is not the completed saved revision.")
        draft = record["selection"]
        require(draft["selection_mode"] == "classes" and draft["class_values"] == ["ORW"]
                and not draft["exclude_ids"] and draft["purpose"] == "high_quality_waters"
                and draft["rule_reference"] == RULE,
                "The reopened revision changed the selected classes, exclusions, purpose or rule reference.")
        require(response_json(reopened_source.value)["source"]["sha256"] == native["source_sha256"],
                "Reopening changed the retained source edition.")
        expect(desk.locator('[data-ref="savedInfo"]')).to_have_text("Opened " + args.title)
        expect(desk.locator('[data-ref="metricFeatures"]')).to_have_text("332")
        expect(desk.locator('[data-ref="previewState"]')).to_have_text("Current preview")
        expect(desk.locator('[data-action="export-geojson"]')).to_be_enabled()
        expect(desk.locator('[data-ref="mapGeometry"] .wd-map-included')).to_have_count(332)
        report["delivery_overlay"] = record["delivery_overlay"]
        checkpoint("revision_reopened", selected_features=record["summary"]["selected_features"])

        def download(action_name, filename, format=None):
            ticket = None
            with page.expect_download() as transferred:
                if format:
                    with page.expect_response(match_response("/api/water-designations/export", "POST")) as exported:
                        desk.locator('[data-action="' + action_name + '"]').click()
                    ticket = response_json(exported.value)
                else:
                    desk.locator('[data-action="' + action_name + '"]').click()
            download_item = transferred.value
            require(download_item.failure() is None, "The browser download failed.")
            destination = output / filename
            download_item.save_as(destination)
            meta = file_info(destination)
            if ticket:
                require(meta["sha256"] == ticket["sha256"] and meta["bytes"] == ticket["bytes"],
                        "The complete browser download differs from its native export ticket.")
            report["exports"][filename] = meta
            return destination

        selection_path = download("export-selection", "water-selection.json")
        selection_export = read_json(selection_path)
        exported_choice = selection_export["selection"]
        stable_choices = ("source_collection_id", "source_id", "layer", "id_field", "class_field",
                          "selection_mode", "class_values", "feature_ids", "exclude_ids", "purpose",
                          "title", "rule_reference", "expected_source_sha256", "source_context")
        require(selection_export["workspace"] == workspace_key
                and all(exported_choice.get(key) == draft.get(key) for key in stable_choices),
                "The selection download changed the saved source, rule or selection choices.")
        geojson_path = download("export-geojson", "selected-ORW.geojson", "geojson")
        geojson = read_json(geojson_path)
        require(feature_ids(geojson["features"], id_field) == expected_ids
                and all(f["properties"][class_field] == "ORW" for f in geojson["features"]),
                "The complete GeoJSON download differs from the actual ORW source set.")
        csv_path = download("export-csv", "selected-ORW.csv", "csv")
        with csv_path.open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        require(len(rows) == len(expected_ids) and {str(r[id_field]) for r in rows} == expected_ids
                and all(r[class_field] == "ORW" for r in rows),
                "The complete source-row CSV differs from the actual ORW source set.")
        desk.locator('[data-ref="map"]').scroll_into_view_if_needed()
        workbench_image = output / "water-designations-desktop.png"
        report["screenshots"]["workbench"] = capture(workbench_image)
        checkpoint("complete_exports_saved", geojson_features=len(geojson["features"]), csv_rows=len(rows))

        with page.expect_response(match_response("/api/water-designations/apply", "POST")) as applied:
            desk.locator('[data-action="use-delivery"]').click()
        applied_delivery = response_json(applied.value)
        apply_request = applied.value.request.post_data_json
        require(apply_request["selection_id"] == saved_id
                and apply_request["workspace"] == workspace_key
                and apply_request["delivery_selection"] == {},
                "The delivery handoff did not apply the current saved revision in this Workspace.")
        applied_overlay = applied_delivery["overlays"]["high_quality_waters"]
        require(applied_overlay == record["delivery_overlay"]
                and applied_delivery["source_roles"]["HIGH_QUALITY_WATERS"] == applied_overlay,
                "The native handoff lost the saved overlay, rule reference or source-role lineage.")
        for key in ("selection_id", "rule_reference", "native_source_sha256"):
            require(key in applied_overlay, "The saved delivery overlay is missing " + key + ".")
        require(applied_overlay["selection_id"] == saved_id
                and applied_overlay["rule_reference"] == RULE
                and applied_overlay["native_source_sha256"] == native["source_sha256"],
                "The applied choice differs from the saved revision's rule or native source edition.")
        report["applied_delivery_selection"] = applied_delivery
        checkpoint("saved_revision_applied", selection_id=saved_id)

        def submit_delivery(submit_control):
            with page.expect_response(match_response("/api/actions", "POST")) as built:
                submit_control.click()
            build_request = built.value.request.post_data_json
            require(build_request["action"] == "delivery.build"
                    and build_request["workspace"] == workspace_key,
                    "The original form did not submit its native delivery build.")
            submitted = build_request["payload"]
            require(submitted["overlays"]["high_quality_waters"] == applied_overlay
                    and submitted["source_roles"]["HIGH_QUALITY_WATERS"] == applied_overlay,
                    "The original form discarded saved water selection lineage during submission.")
            require(submitted["baseline_run_id"] == prepared_delivery["baseline_run_id"]
                    and set(submitted["scenario_run_ids"]) == set(prepared_delivery["scenario_run_ids"]),
                    "The original form changed the actual prepared baseline or alternatives.")
            require(submitted["source_roles"]["SOURCE_WATER_PROTECTION_AREAS"]
                    == submitted["overlays"]["drinking_water"],
                    "The delivery editor did not retain the selected drinking-water source role.")
            protected_overlay = submitted["overlays"].get("protected_lands")
            if protected_overlay is not None:
                require(submitted["source_roles"].get("PROTECTED_LANDS_OVERLAY") == protected_overlay,
                        "The delivery editor lost the separate protected-land overlay source role.")
            else:
                require("PROTECTED_LANDS_OVERLAY" not in submitted["source_roles"],
                        "A removed protected-land overlay left a stale source role in the delivery.")
            for key in ("source_collection_id", "source_id"):
                require(submitted["source_roles"]["PROTECTED_LANDS"].get(key)
                        == prepared_delivery["source_roles"]["PROTECTED_LANDS"].get(key),
                        "The protected-land overlay replaced the separately selected analysis source.")
            build_task = task_object(response_json(built.value))
            build_id = build_task.get("id") or build_task.get("task_id")
            require(build_id, "The delivery build did not return a native task ID.")
            report["delivery"].update({"task_id": build_id, "submitted_selection": submitted})
            checkpoint("delivery_build_queued", task_id=build_id)
            deadline = time.monotonic() + args.timeout_seconds
            previous_state = None
            while task_state(build_task) not in SUCCESS_STATES:
                state = task_state(build_task)
                require(state not in {"failed", "interrupted", "cancelled", "canceled"},
                        "The native delivery build ended in " + state + ": " + str(build_task.get("error") or ""))
                require(time.monotonic() < deadline, "The native delivery build is still retained as task " + build_id + ".")
                if state != previous_state:
                    checkpoint("delivery_build_running", task_id=build_id, state=state)
                    previous_state = state
                page.wait_for_timeout(1000)
                task_response = context.request.get(
                    report["origin"] + "/api/task",
                    params={"id": build_id, "workspace": workspace_key},
                    headers={"Authorization": "Bearer " + token})
                build_task = task_object(response_json(task_response))
            result = build_task.get("result") or {}
            report["delivery"].update({"outcome": "native_delivery_built",
                                      "task_state": task_state(build_task),
                                      "result_id": result.get("id") or result.get("delivery_id")})
            report["outcome"] = "saved_exported_and_native_delivery_built"
            checkpoint("delivery_build_complete", task_id=build_id, result_id=report["delivery"]["result_id"])

        page.wait_for_function(
            """prerequisite => {
                const dialog = document.querySelector('#form-dialog');
                const atlas = document.querySelector('.map-atlas [data-atlas-form]');
                const open = dialog && (dialog.open || dialog.getAttribute('aria-hidden') === 'false');
                const text = ['.wd [data-ref="notice"]','#global-error','#toast']
                    .map(s => document.querySelector(s)?.textContent || '').join(' ');
                return !!atlas || open || text.includes(prerequisite) || text.includes('Could not open the delivery editor.');
            }""", arg=DELIVERY_PREREQUISITE)
        dialog = page.locator("#form-dialog")
        atlas = page.locator(".map-atlas")
        if atlas.is_visible():
            expect(atlas.locator("h1")).to_have_text("Map atlas and delivery")
            expect(atlas.locator("[data-atlas-form]")).to_have_attribute("data-atlas-workspace", workspace_key)
            complete_choices = atlas.locator('select[name="baseline"] option').evaluate_all(
                "(nodes) => nodes.filter(node => node.value).length")
            report["delivery"] = {"outcome": "editor_opened", "editor": "map-atlas",
                                  "complete_run_choices": complete_choices, "overlay": applied_overlay,
                                  "heading": atlas.locator("h1").inner_text()}
            report["outcome"] = "saved_exported_and_delivery_editor_opened"
            atlas.locator('[data-atlas-action="step"][data-step="1"]').click()
            for name, key in [("collection", "source_collection_id"), ("source", "source_id"), ("layer", "layer")]:
                bound = atlas.locator('[name="overlays__high_quality_waters__' + name + '"]')
                expect(bound).to_have_value(applied_overlay[key])
                expect(bound).to_be_disabled()
            with page.expect_download() as atlas_exported:
                atlas.locator('[data-atlas-action="download-selection"]').click()
            atlas_selection_path = output / "atlas-delivery-selection.json"
            atlas_exported.value.save_as(atlas_selection_path)
            require(atlas_exported.value.failure() is None, "The atlas selection download failed.")
            atlas_choice = read_json(atlas_selection_path)["selection"]
            require(atlas_choice["overlays"]["high_quality_waters"] == applied_overlay
                    and atlas_choice["source_roles"]["HIGH_QUALITY_WATERS"] == applied_overlay,
                    "The atlas lost saved water metadata when retaining its native draft.")
            report["exports"][atlas_selection_path.name] = file_info(atlas_selection_path)
            report["screenshots"]["delivery_context"] = capture(output / "water-designations-atlas-context.png")
            if prepared_delivery is not None:
                joined = json.loads(json.dumps(prepared_delivery))
                joined.setdefault("overlays", {})["high_quality_waters"] = applied_overlay
                joined.setdefault("source_roles", {})["HIGH_QUALITY_WATERS"] = applied_overlay
                joined["notes"] = list(dict.fromkeys(
                    list(joined.get("notes") or []) + list(applied_delivery.get("notes") or [])))
                joined_path = output / "browser-delivery-selection.json"
                joined_path.write_text(json.dumps(joined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                report["prepared_browser_selection"] = file_info(joined_path)
                atlas.locator("[data-atlas-import]").set_input_files(joined_path)
                expect(atlas.locator('[name="title"]')).to_have_value(joined["title"])
                expect(atlas.locator('[name="baseline"]')).to_have_value(joined["baseline_run_id"])
                chosen_runs = atlas.locator('[name="alternatives"]:checked').evaluate_all(
                    "(nodes) => nodes.map(node => node.value)")
                require(chosen_runs == joined["scenario_run_ids"],
                        "The atlas changed the supplied ordered native alternatives.")
                atlas.locator('[data-atlas-action="step"][data-step="1"]').click()
                for name, key in [("collection", "source_collection_id"), ("source", "source_id"), ("layer", "layer")]:
                    expect(atlas.locator('[name="overlays__high_quality_waters__' + name + '"]')).to_have_value(applied_overlay[key])
                atlas.locator('[data-atlas-action="step"][data-step="2"]').click()
                expect(atlas.locator('[name="dpi"]')).to_have_value(str(joined.get("map_settings", {}).get("dpi", 220)))
                atlas.locator('[data-atlas-action="step"][data-step="3"]').click()
                for key in ("name", "organization", "email"):
                    expect(atlas.locator('[name="contact_' + key + '"]')).to_have_value(joined["contact"][key])
                expect(atlas.locator("[data-atlas-problems]")).to_have_text("Ready to submit the complete native delivery.")
                report["screenshots"]["prepared_delivery"] = capture(output / "water-designations-prepared-delivery.png")
                submit_delivery(atlas.locator('[data-atlas-form] button[type="submit"]'))
        elif dialog.is_visible():
            expect(page.locator("#form-title")).to_have_text("Build complete seven-map delivery")
            overlay = applied_overlay
            for name, key in [("collection", "source_collection_id"), ("source", "source_id"), ("layer", "layer")]:
                control = page.locator('#operation-form [name="overlay_high_quality_waters_' + name + '"]')
                expect(control).to_have_value(overlay[key])
            require(overlay["layer"] == "selected_features", "The saved overlay did not retain its native layer.")
            report["delivery"] = {"outcome": "editor_opened", "editor": "original-dialog",
                                  "complete_run_choices": page.locator('#operation-form [name="baseline"] option').evaluate_all(
                                      "(nodes) => nodes.filter(node => node.value).length"), "overlay": overlay,
                                  "heading": page.locator("#form-title").inner_text()}
            report["outcome"] = "saved_exported_and_delivery_editor_opened"
            if prepared_delivery is not None:
                form = page.locator("#operation-form")

                def control(name):
                    return form.locator("[name=" + json.dumps(name) + "]")

                def fill_source(name, choice, filters=False):
                    require(choice and choice.get("source_collection_id") and choice.get("source_id"),
                            "The prepared delivery is missing the actual choice for " + name + ".")
                    control(name + "_collection").select_option(choice["source_collection_id"])
                    control(name + "_source").select_option(choice["source_id"])
                    if filters:
                        control(name + "_layer").fill(choice.get("layer") or "")
                        editor = form.locator("[data-filter=" + json.dumps(name) + "]")
                        while editor.locator('[data-action="row-remove"]').count():
                            editor.locator('[data-action="row-remove"]').first.click()
                        for field, value in (choice.get("where") or {}).items():
                            editor.locator('[data-action="filter-add"]').click()
                            row = editor.locator("[data-filter-row]").last
                            kind = ("null" if value is None else "boolean" if isinstance(value, bool)
                                    else "number" if isinstance(value, (int, float)) else "text")
                            row.locator('[name="filter_field"]').fill(field)
                            row.locator('[name="filter_type"]').select_option(kind)
                            text = "" if value is None else str(value).lower() if isinstance(value, bool) else str(value)
                            row.locator('[name="filter_value"]').fill(text)

                control("title").fill(prepared_delivery["title"])
                control("baseline").select_option(prepared_delivery["baseline_run_id"])
                for option in form.locator('[name="alternatives"]').all():
                    option.uncheck()
                for run_id in prepared_delivery["scenario_run_ids"]:
                    form.locator('[name="alternatives"][value=' + json.dumps(run_id) + "]").check()
                for role in ("PROTECTED_LANDS", "PARCEL", "NHD", "NWI"):
                    fill_source("role_" + role, prepared_delivery["source_roles"].get(role))
                fill_source("overlay_drinking_water", prepared_delivery["overlays"]["drinking_water"], True)
                for name in ("protected_lands", "parcels"):
                    choice = prepared_delivery["overlays"].get(name)
                    control("overlay_" + name + "_enabled").set_checked(bool(choice))
                    if choice:
                        fill_source("overlay_" + name, choice, True)
                settings = prepared_delivery.get("map_settings") or {}
                for pollutant in ("nitrogen_export", "phosphorus_export", "sediment_export"):
                    control("weight_" + pollutant).fill(str(settings.get("weights", {}).get(pollutant, 1)))
                    cap = settings.get("caps", {}).get(pollutant)
                    control("cap_" + pollutant).fill("" if cap is None else str(cap))
                control("dpi").fill(str(settings.get("dpi", 200)))
                control("map_title").fill(settings.get("title") or "")
                for name, key in (("observation_comparisons", "observation_comparison_ids"),
                                  ("spatial_reviews", "spatial_review_ids"),
                                  ("spatial_exports", "spatial_export_ids")):
                    for option in form.locator("[name=" + json.dumps(name) + "]").all():
                        option.uncheck()
                    for item_id in prepared_delivery.get(key, []):
                        form.locator("[name=" + json.dumps(name) + "][value=" + json.dumps(item_id) + "]").check()
                for key in ("name", "organization", "email"):
                    control("contact_" + key).fill(prepared_delivery["contact"][key])
                notes = list(prepared_delivery.get("notes") or [])
                notes.extend(applied_delivery.get("notes") or [])
                control("notes").fill("\n".join(dict.fromkeys(notes)))
                require(form.evaluate("(node) => node.checkValidity()"),
                        "The prepared delivery choices do not complete the actual delivery form.")
                report["screenshots"]["prepared_delivery"] = capture(output / "water-designations-prepared-delivery.png")
                submit_delivery(page.locator("#form-submit"))
        else:
            message = " ".join(page.locator(selector).inner_text()
                               for selector in ['.wd [data-ref="notice"]', "#global-error", "#toast"]
                               if page.locator(selector).count())
            require(DELIVERY_PREREQUISITE in message, "The original delivery action failed: " + message)
            report["delivery"] = {"outcome": "native_model_runs_required", "message": DELIVERY_PREREQUISITE}
            report["outcome"] = "saved_exported_and_native_delivery_prerequisite_shown"
        delivery_image = output / "water-designations-delivery.png"
        report["screenshots"]["delivery"] = capture(delivery_image)
        report["loaded_assets"] = []
        for response in observed:
            if response_path(response) in {"/web/water_designations.mjs", "/web/water_designations.css"} and response.ok:
                content = response.body()
                report["loaded_assets"].append({"path": response_path(response), "bytes": len(content),
                                                 "sha256": hashlib.sha256(content).hexdigest()})
        require(not report["page_errors"], "The browser reported an uncaught application exception.")
        require(not args.require_delivery_form
                or (report["delivery"]["outcome"] in {"editor_opened", "native_delivery_built"}
                    and report["delivery"].get("complete_run_choices", 0) >= 2),
                "This receiving lane requires the original completed baseline and alternative runs.")
        require(not args.delivery_selection or report["delivery"]["outcome"] == "native_delivery_built",
                "The explicitly supplied native delivery selection has not completed its build.")
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        checkpoint("journey_complete", outcome=report["outcome"], selection_id=saved_id)
        print(json.dumps({"report": str(report_path), "outcome": report["outcome"],
                          "selection_id": report["selection_id"]}, ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        report["outcome"] = "failed"
        report["error"] = redact(error)
        if page is not None:
            try:
                failure_image = output / "water-designations-failure.png"
                report["screenshots"]["failure"] = capture(failure_image, timeout=10000)
            except Exception:
                pass
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        checkpoint("failed", error=redact(error))
        print(json.dumps({"report": str(report_path), "error": redact(error)}, ensure_ascii=False),
              file=sys.stderr, flush=True)
        return 1
    finally:
        for resource in (context, browser):
            if resource is not None:
                try:
                    resource.close()
                except Exception:
                    pass
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
