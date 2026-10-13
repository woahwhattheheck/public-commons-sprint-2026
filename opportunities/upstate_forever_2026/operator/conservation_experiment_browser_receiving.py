#!/usr/bin/env python3
"""Open and export an existing native conservation experiment in the original UI.

This continuation consumes a completed conservation_browser_receiving.py report.
Its experiment must already belong to a saved scenario of that original study.
It opens the maintained experiment desk, refreshes the completed summary through
the ordinary queue, downloads its original HTML/CSV/JSON reports, and reopens the
same native cases after browser reload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import time
from urllib.parse import parse_qs, urlencode, urlsplit

OPERATION = "UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012-E7A1"
SCHEMA = "upstate.conservation-experiment-browser-receiving/v1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def file_record(path):
    path = Path(path)
    value = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for body in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(body)
            size += len(body)
    return {"path": str(path.resolve()), "bytes": size, "sha256": value.hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-receipt", type=Path, required=True)
    parser.add_argument("--conservation-receiving", type=Path, required=True)
    parser.add_argument("--experiment-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--task-timeout", type=float, default=240)
    parser.add_argument("--record-video", action="store_true")
    args = parser.parse_args()
    require(math.isfinite(args.task_timeout) and args.task_timeout > 0,
            "Choose a finite positive summary-operation timeout.")
    connection = read_json(args.operator_receipt)
    conservation = read_json(args.conservation_receiving)
    require(conservation.get("operation") == OPERATION and conservation.get("state") == "complete",
            "Use the completed original Conservation browser receiving result.")
    require(conservation.get("workspace_key") == connection.get("workspace_key"),
            "The local operator and Conservation receiving result identify different Workspaces.")
    operator_url = connection["operator_url"]
    parsed = urlsplit(operator_url)
    require(parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1"),
            "Use the original local operator startup receipt.")
    capability = parse_qs(parsed.fragment).get("token", [None])[0]
    require(capability, "The original startup receipt needs its local operator capability.")
    origin = parsed.scheme + "://" + parsed.netloc
    workspace = connection["workspace_key"]
    study_id = conservation["study_id"]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "receiving.json"
    report = read_json(report_path) if report_path.exists() else {
        "schema": SCHEMA, "operation": OPERATION, "state": "ready",
        "workspace_key": workspace, "study_id": study_id,
        "experiment_id": args.experiment_id,
        "conservation_receiving": file_record(args.conservation_receiving),
        "manual_browser_plan_id": conservation["plan_id"],
        "screenshots": [], "downloads": [], "task_ids": {},
        "page_errors": [], "console_errors": [],
    }
    require(report.get("schema") == SCHEMA and report.get("workspace_key") == workspace
            and report.get("study_id") == study_id and report.get("experiment_id") == args.experiment_id,
            "Use a separate receiving directory for a different Workspace, study or experiment.")

    def clean(value):
        return str(value).replace(capability, "[private capability]")

    def persist():
        temporary = report_path.with_suffix(".json.tmp")
        temporary.write_text(clean(json.dumps(report, ensure_ascii=False, indent=2)) + "\n",
                             encoding="utf-8")
        temporary.replace(report_path)

    def save_json(name, value):
        path = output / name
        path.write_text(clean(json.dumps(value, ensure_ascii=False, indent=2)) + "\n",
                        encoding="utf-8")
        return file_record(path)

    def say():
        print(clean(json.dumps({
            "state": report["state"], "experiment_id": args.experiment_id,
            "study_id": study_id, "receiving_path": str(report_path),
            "native_plan_ids": report.get("native_plan_ids", []),
            "downloads": report.get("downloads", []),
        }, ensure_ascii=False)), flush=True)

    if report.get("state") == "complete":
        for item in report["downloads"]:
            actual = file_record(item["path"])
            require(actual["bytes"] == item["bytes"] and actual["sha256"] == item["sha256"],
                    "A retained experiment report changed: " + item["path"])
        say()
        return

    from playwright.sync_api import sync_playwright, expect

    if report.get("error"):
        report.setdefault("earlier_attempts", []).append({
            key: report.get(key) for key in ("state", "error", "page_errors", "console_errors")
        })
    report.update(state="running", page_errors=[], console_errors=[])
    report.pop("error", None)
    persist()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True)
        options = {"viewport": {"width": 1880, "height": 1100},
                   "accept_downloads": True, "locale": "en-US"}
        if args.record_video:
            options.update(record_video_dir=str(output / "video"),
                           record_video_size={"width": 1880, "height": 1100})
        context = browser.new_context(**options)
        page = context.new_page()
        page.set_default_timeout(45000)
        video = page.video if args.record_video else None
        page.on("pageerror", lambda error: report["page_errors"].append(clean(error)))
        page.on("console", lambda message: report["console_errors"].append(clean(message.text))
                if message.type == "error" else None)

        def record_summary_request(request):
            if request.method != "POST" or urlsplit(request.url).path != "/api/actions":
                return
            value = request.post_data_json
            if (isinstance(value, dict) and value.get("workspace") == workspace
                    and value.get("action") == "experiment.summarize"
                    and value.get("payload", {}).get("experiment_id") == args.experiment_id
                    and value.get("operation_id")):
                report["summary_operation"] = value
                persist()

        page.on("request", record_summary_request)

        def get(path, **query):
            query.setdefault("workspace", workspace)
            response = context.request.get(
                origin + path + "?" + urlencode(query),
                headers={"Authorization": "Bearer " + capability}, timeout=45000)
            value = response.json()
            require(response.ok, value.get("error", {}).get("message", "Original operator read failed."))
            return value

        def task(key):
            deadline = time.monotonic() + args.task_timeout
            resumed = False
            while True:
                value = get("/api/task", id=key)
                require(value.get("workspace") == workspace
                        and value.get("action") == "experiment.summarize"
                        and value.get("payload", {}).get("experiment_id") == args.experiment_id,
                        "The retained summary task identifies another original operation.")
                if value.get("state") == "complete":
                    return value
                if value.get("state") == "interrupted" and not resumed:
                    response = context.request.post(
                        origin + "/api/task/resume", data={"id": key},
                        headers={"Authorization": "Bearer " + capability}, timeout=45000)
                    require(response.ok, "The original interrupted summary task could not resume.")
                    resumed = True
                    continue
                if value.get("state") in ("failed", "cancelled", "interrupted"):
                    raise ValueError("Original summary operation " + key + ": " +
                                     json.dumps(value.get("error") or value.get("state")))
                if time.monotonic() >= deadline:
                    raise TimeoutError("The retained summary operation remains active: " + key)
                time.sleep(1)

        def photograph(name):
            path = output / name
            page.screenshot(path=str(path), full_page=True, animations="disabled")
            report["screenshots"] = [row for row in report["screenshots"]
                                     if row["path"] != str(path)] + [file_record(path)]
            persist()

        def open_current_experiment():
            if page.locator("#detail-dialog[open]").count():
                page.keyboard.press("Escape")
            page.locator('[data-view="conservation"]').click()
            root = page.locator("#conservation-workspace")
            expect(root).to_be_visible()
            back = root.locator('[data-action="conservation-close-study"]')
            if back.count():
                expect(back).to_be_visible()
                back.click()
            opener = root.locator('[data-action="conservation-open-study"][data-study-id=' +
                                  json.dumps(study_id) + "]")
            expect(opener).to_be_visible()
            opener.click()
            native = root.locator('[data-action="experiment-show"][data-id=' +
                                  json.dumps(args.experiment_id) + "]").first
            expect(native).to_be_visible()
            native.click()
            detail = page.locator("#experiment-detail")
            expect(detail.get_by_role("heading", name=report["title"], exact=True)).to_be_visible()
            expect(page.locator("#experiment-result-tables")).to_be_visible()
            return detail

        try:
            overview = get("/api/conservation/overview")
            bridges = [row for row in overview.get("scenario_bridges", [])
                       if row.get("study_id") == study_id and any(
                           item.get("experiment_id") == args.experiment_id
                           for item in row.get("experiments", []))]
            require(bridges, "Choose a paired experiment retained by a saved scenario of this original study.")
            report["conservation_scenarios"] = bridges
            report["native_plan_ids"] = sorted({row["plan_id"] for row in bridges})
            original = get("/api/experiments/inspect", experiment_id=args.experiment_id, offset=0, limit=100)
            report["native_state"] = original.get("state")
            report["title"] = original["title"]
            report["native_inspection"] = save_json("native-inspection.json", original)
            persist()
            require(original.get("state") == "complete",
                    "The retained native experiment is " + str(original.get("state")) +
                    "; continue its existing Run programmes operation, then resume this same receiving directory.")

            before_record = report.get("native_summary_before_refresh")
            if before_record:
                actual = file_record(before_record["path"])
                require(actual["bytes"] == before_record["bytes"]
                        and actual["sha256"] == before_record["sha256"],
                        "The original pre-refresh scientific summary changed.")
                scientific_before = read_json(before_record["path"])
            else:
                scientific_before = get("/api/experiments/summary", experiment_id=args.experiment_id)
                report["native_summary_before_refresh"] = save_json(
                    "native-summary-before-refresh.json", scientific_before)
                persist()
            require(scientific_before.get("id") == args.experiment_id
                    and scientific_before.get("state") == "complete",
                    "Retain the completed original experiment summary before refreshing it.")

            page.goto(operator_url, wait_until="domcontentloaded")
            expect(page.locator("#workspace-select")).to_have_value(workspace)
            detail = open_current_experiment()
            photograph("01-native-experiment.png")

            summary_task_id = report["task_ids"].get("summary")
            if not summary_task_id:
                original_operation = report.get("summary_operation")
                if original_operation:
                    require(original_operation.get("workspace") == workspace
                            and original_operation.get("action") == "experiment.summarize"
                            and original_operation.get("payload", {}).get("experiment_id") == args.experiment_id
                            and original_operation.get("operation_id"),
                            "The retained summary request identifies another original operation.")
                    response = context.request.post(
                        origin + "/api/actions", data=original_operation,
                        headers={"Authorization": "Bearer " + capability}, timeout=45000)
                else:
                    refresh = detail.locator('[data-action="experiment-report"]').first
                    expect(refresh).to_be_visible()
                    with page.expect_response(lambda response:
                            urlsplit(response.url).path == "/api/actions"
                            and response.request.method == "POST") as pending:
                        refresh.click()
                    response = pending.value
                submitted = response.json()
                require(response.status == 202 and submitted.get("id")
                        and submitted.get("action") == "experiment.summarize",
                        "The native report control must queue or recover the original summary action.")
                summary_task_id = submitted["id"]
                report["task_ids"]["summary"] = summary_task_id
                persist()
            completed_task = task(summary_task_id)
            require(completed_task.get("result", {}).get("id") == args.experiment_id,
                    "The summary operation returned a different experiment.")
            if page.locator("#detail-dialog[open]").count():
                page.keyboard.press("Escape")
            detail = open_current_experiment()
            summary = get("/api/experiments/summary", experiment_id=args.experiment_id)
            require(summary.get("id") == args.experiment_id and summary.get("state") == "complete",
                    "The original experiment summary must identify the completed selected case set.")
            require(summary.get("pairs"), "The completed conservation experiment needs its actual matched land-cover pairs.")
            for name in ("selection", "pairs", "rows", "models", "pollutants"):
                require(summary.get(name) == scientific_before.get(name),
                        "Refreshing the report changed retained native " + name + ".")
            report["refresh_preserved_native_results"] = True
            primary_pairs = {
                (item.get("baseline_run_id"), item.get("alternative_run_id"))
                for bridge in bridges for item in bridge.get("experiments", [])
                if item.get("experiment_id") == args.experiment_id
            }
            actual_pairs = {(item["baseline_run_id"], item["alternative_run_id"])
                            for item in summary["pairs"]}
            require(primary_pairs and primary_pairs <= actual_pairs,
                    "The native summary must contain the saved Conservation bridge baseline/alternative pair.")
            report["primary_native_pairs"] = [list(pair) for pair in sorted(primary_pairs)]
            report["summary"] = save_json("native-summary.json", summary)
            report["pairs"] = summary["pairs"]
            report["models"] = summary.get("models")
            report["pollutants"] = summary.get("pollutants")
            report["counts"] = summary.get("counts")
            report["progress"] = summary.get("progress")
            report_files = [row for row in summary.get("_downloads", [])
                            if Path(row.get("filename", "")).suffix.lower() in (".html", ".csv", ".json")]
            suffixes = {Path(row["filename"]).suffix.lower() for row in report_files}
            require({".html", ".csv", ".json"} <= suffixes,
                    "The completed native summary needs its original HTML, CSV and JSON report tickets.")
            for ticket in report_files:
                expect(detail.locator('a[href=' + json.dumps(ticket["url"] + "?download=1") + "]")).to_be_visible()
            report["native_visible_results"] = page.locator("#experiment-result-tables").inner_text()
            photograph("02-native-results-and-reports.png")
            destination = output / "reports"
            destination.mkdir(exist_ok=True)
            downloaded = []
            for ticket in report_files:
                filename = Path(ticket["filename"]).name
                target = destination / (ticket["sha256"][:12] + "-" + filename)
                anchor = detail.locator('a[href=' + json.dumps(ticket["url"] + "?download=1") + "]")
                expect(anchor).to_be_visible()
                with page.expect_download() as pending:
                    anchor.click()
                received = pending.value
                require(received.failure() is None, "The original experiment report download failed.")
                received.save_as(str(target))
                actual = file_record(target)
                require(actual["bytes"] == ticket["bytes"] and actual["sha256"] == ticket["sha256"],
                        "The received native report differs from its original ticket.")
                downloaded.append({**actual, "filename": filename, "label": ticket.get("label")})
                report["downloads"] = downloaded
                persist()

            page.reload(wait_until="domcontentloaded")
            detail = open_current_experiment()
            reopened = get("/api/experiments/summary", experiment_id=args.experiment_id)
            require(reopened["id"] == summary["id"]
                    and reopened["selection"] == summary["selection"]
                    and reopened["pairs"] == summary["pairs"]
                    and reopened["rows"] == summary["rows"]
                    and reopened.get("models") == summary.get("models")
                    and reopened.get("pollutants") == summary.get("pollutants"),
                    "The reopened native case identities, selections or retained results changed.")
            for ticket in report_files:
                expect(detail.locator('a[href=' + json.dumps(ticket["url"] + "?download=1") + "]")).to_be_visible()
            report["reopened_experiment_id"] = reopened["id"]
            report["reopened_results_match"] = True
            report["reopened_visible_results"] = page.locator("#experiment-result-tables").inner_text()
            photograph("03-reopened-native-experiment.png")
            require(not report["page_errors"], "The native experiment desk reported a JavaScript error; inspect receiving.json.")
            report["state"] = "complete"
            report["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            persist()
        except BaseException as error:
            report["state"] = "failed"
            report["error"] = {"type": type(error).__name__, "message": clean(error)}
            persist()
            raise
        finally:
            try:
                context.close()
                if video:
                    report["video"] = file_record(video.path())
                    persist()
            finally:
                browser.close()
    say()


if __name__ == "__main__":
    main()
