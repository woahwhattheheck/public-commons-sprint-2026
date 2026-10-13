#!/usr/bin/env python3
"""Exercise and record the original parcel source desk in the running application.

Use the real operator launch JSON, an original capture directory, and a receiving
output directory. Re-run with --edition-id against a separately restored operator
to open the same saved source edition without the original acquisition directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name("." + path.name + ".pending")
    pending.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    pending.replace(path)


def fact(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": h.hexdigest()}


def run(args):
    launch_path = Path(args.operator_url_file)
    launch = None
    with launch_path.open("r", encoding="utf-8") as stream:
        for line in stream:
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict) and candidate.get("operator_url"):
                launch = candidate
                break
    if launch is None:
        launch = json.loads(launch_path.read_text(encoding="utf-8"))
    operator_url = launch["operator_url"]
    parts = urlsplit(operator_url)
    token = parse_qs(parts.fragment).get("token", [None])[0]
    if not token or parts.scheme not in ("http", "https"):
        raise ValueError("Use the actual original operator launch JSON with its startup URL")
    origin = parts.scheme + "://" + parts.netloc
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    receipt = {
        "schema": "upstate.parcel-source-receiving/v1",
        "operation": "ECO-PARCEL-DESK-D4065-20261013",
        "origin": origin, "opening_fragment": "#parcel-sources",
        "state": "running", "stages": [], "screenshots": [], "downloads": [],
        "browser_errors": [], "receiving_mode": "saved_edition" if args.edition_id else "original_capture",
        "source": fact(__file__),
    }
    started = time.perf_counter()
    receipt_file = output / "parcel-source-journey.json"

    def persist():
        receipt["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        write(receipt_file, receipt)

    def stage(name, function):
        row = {"name": name, "state": "running"}
        receipt["stages"].append(row)
        start = time.perf_counter()
        persist()
        try:
            value = function()
        except Exception as error:
            row.update(state="failed", error=str(error).replace(token, "[operator capability]"),
                       error_type=type(error).__name__, elapsed_seconds=round(time.perf_counter() - start, 3))
            receipt["state"] = "failed"
            persist()
            raise
        row.update(state="complete", elapsed_seconds=round(time.perf_counter() - start, 3))
        persist()
        print(json.dumps({"stage": name, "state": row["state"], "elapsed_seconds": row["elapsed_seconds"]}), flush=True)
        return value

    persist()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, **(
            {"executable_path": args.chromium_executable} if args.chromium_executable else {}))
        context = browser.new_context(viewport={"width": 1440, "height": 1000},
                                      accept_downloads=True, record_video_dir=str(output / "video"),
                                      record_video_size={"width": 1440, "height": 1000})
        page = context.new_page()
        videos = []

        def observe(current):
            current.on("pageerror", lambda error: receipt["browser_errors"].append(
                str(error).replace(token, "[operator capability]")))
            if current.video:
                videos.append(current.video)
        observe(page)

        def api(path, payload=None, *, allow_error=False):
            method = context.request.get if payload is None else context.request.post
            options = {"headers": {"Authorization": "Bearer " + token}, "timeout": 120000}
            if payload is not None:
                options["data"] = payload
            response = method(origin + path, **options)
            value = response.json()
            if not response.ok and not allow_error:
                raise RuntimeError(value.get("error", {}).get("message", "Original API returned HTTP " + str(response.status)))
            return value

        workspace_key = args.workspace_key or launch.get("workspace_key")
        def read(name, **payload):
            return api("/api/parcel-sources/" + name, {"workspace": workspace_key, **payload})

        def screenshot(name):
            path = output / (name + ".png")
            page.screenshot(path=str(path), full_page=True)
            receipt["screenshots"].append(fact(path))
            persist()

        def close_details():
            if page.locator("#detail-dialog").is_visible():
                page.locator('#detail-dialog [data-action="detail-close"]').click()

        def open_desk():
            page.goto(operator_url, wait_until="domcontentloaded")
            page.locator('[data-view="parcel-sources"]').wait_for(state="visible", timeout=120000)
            if args.workspace_key:
                page.locator("#workspace-select").select_option(args.workspace_key)
            page.locator('[data-view="parcel-sources"]').click()
            page.get_by_role("heading", name="Parcel sources", exact=True).wait_for()

        def wait_task(task):
            deadline = time.monotonic() + args.timeout_seconds
            prior = None
            while True:
                value = api("/api/task?id=" + task["id"])
                state = value["state"]
                if state != prior:
                    print(json.dumps({"task_id": task["id"], "state": state}), flush=True)
                    prior = state
                if state == "complete":
                    return value
                if state not in ("queued", "running"):
                    raise RuntimeError("Original operation " + task["id"] + " is " + state + ": " + json.dumps(value.get("error")))
                if time.monotonic() >= deadline:
                    raise TimeoutError("The original operation is retained as " + task["id"] + "; continue it in Operations")
                time.sleep(2)

        def click_queue(action, control):
            with page.expect_response(lambda response:
                    response.url == origin + "/api/actions"
                    and response.request.method == "POST"
                    and response.request.post_data_json.get("action") == action, timeout=120000) as incoming:
                control.click()
            response = incoming.value
            task = response.json()
            if not response.ok:
                raise RuntimeError(task.get("error", {}).get("message", "The original queue rejected the selected operation"))
            return task

        try:
            stage("Open authenticated parcel desk", open_desk)
            catalog = read("catalog")
            workspace_key = catalog["workspace_key"]
            receipt["workspace_key"] = workspace_key
            receipt["project_id"] = catalog["project_id"]
            edition_id = args.edition_id
            if not edition_id:
                capture_path = Path(args.capture_directory).expanduser().resolve(strict=True)
                roots = [(row, Path(row["label"])) for row in catalog["roots"]
                         if capture_path.is_relative_to(Path(row["label"]))]
                if not roots:
                    raise ValueError("Register the actual capture directory with this operator's --source-root option")
                selected, selected_path = max(roots, key=lambda row: len(row[1].parts))
                relative = capture_path.relative_to(selected_path).as_posix()
                relative = "" if relative == "." else relative
                locator = {"root_id": selected["id"], "path": relative}
                capture = read("capture", **locator)
                if not capture["complete_counties"]:
                    raise ValueError("Continue the original county acquisition to retain a complete source, then rerun this journey")
                receipt["input_selection"] = capture["selection"]

                def choose_capture():
                    def change_directory(control):
                        with page.expect_response(lambda response:
                                response.url == origin + "/api/parcel-sources/directories"
                                and response.request.method == "POST") as incoming:
                            control()
                        response = incoming.value
                        value = response.json()
                        if not response.ok:
                            raise RuntimeError(value.get("error", {}).get("message", "The source directory could not be opened"))
                        return value
                    current = change_directory(lambda: page.locator('[name="rootId"]').select_option(selected["id"]))
                    traversed = []
                    for part in (Path(relative).parts if relative else []):
                        traversed.append(part)
                        path = "/".join(traversed)
                        while not any(row["path"] == path for row in current["directories"]):
                            if current["next_offset"] is None:
                                raise ValueError("The actual original capture directory disappeared from its source root")
                            current = change_directory(lambda: page.locator('[data-parcel-action="directory-next"]').click())
                        selector = '[data-parcel-action="directory"][data-path=' + json.dumps(path) + ']'
                        current = change_directory(lambda: page.locator(selector).click())
                    page.locator('[data-parcel-action="choose-capture"]').click()
                    page.get_by_role("heading", name="Original county capture", exact=True).wait_for()
                    screenshot("01-original-county-capture")
                stage("Open original retained capture and county coverage", choose_capture)

                def prepare():
                    page.locator('[name="title"]').fill(args.title)
                    task = click_queue("parcel.source.prepare", page.locator('[data-parcel-form="prepare"] button[type="submit"]'))
                    receipt["preparation_task_id"] = task["id"]
                    receipt["task_state_before_browser_close"] = task["state"]
                    page.close()
                    return task
                task = stage("Submit original prepare and close the browser view", prepare)
                page = context.new_page()
                observe(page)
                stage("Reopen the application while its original task continues", open_desk)
                task = stage("Complete original source preparation and import", lambda: wait_task(task))
                edition_id = task["result"]["id"]
                receipt["preparation_result"] = {
                    "edition_id": edition_id,
                    "source_collection_id": task["result"]["source_collection_id"],
                    "preparation_method": task["result"]["native_inventory"].get("preparation_method"),
                }

            def open_edition():
                close_details()
                page.locator('[data-parcel-action="tab-editions"]').click()
                page.locator('[data-parcel-action="refresh"]').click()
                page.locator('[data-parcel-action="open-edition"][data-id="' + edition_id + '"]').first.click()
                page.get_by_role("heading", name="Browse the complete source inventory", exact=True).wait_for()
                page.locator('[data-parcel-action="record"]').first.wait_for()
                screenshot("02-saved-parcel-edition")
            stage("Open the saved source edition", open_edition)
            edition = read("edition", edition_id=edition_id)
            receipt["edition_id"] = edition_id
            receipt["source_collection_id"] = edition["source_collection_id"]
            receipt["native_inventory"] = edition["native_inventory"]
            first_page = read("rows", edition_id=edition_id, limit=100)
            if first_page["source_rows"] != edition["native_inventory"]["parcel_count"]:
                raise AssertionError("The searchable parcel table differs from the original complete inventory")
            if not first_page["rows"]:
                raise ValueError("The retained provider selection contains no eligible parcel candidate; inspect its native classification")

            def search_original():
                first = first_page["rows"][0]["values"]
                query = first.get("parcel_ref") or first["parcel_id"]
                page.locator('[name="query"]').fill(query)
                with page.expect_response(lambda response:
                        response.url == origin + "/api/parcel-sources/rows"
                        and response.request.method == "POST"
                        and response.request.post_data_json.get("query") == query) as incoming:
                    page.locator('[data-parcel-form="search"] button[type="submit"]').click()
                returned = incoming.value.json()
                if not returned["total"] or not all(query.casefold() in "\n".join(row["values"].values()).casefold()
                                                    for row in returned["rows"]):
                    raise AssertionError("Search must select the original retained parcel text")
                page.locator('[data-parcel-action="record"]').first.click()
                page.get_by_role("heading", name="Original source record", exact=True).wait_for()
                receipt["searched_original"] = {"query": query, "matches": returned["total"], "first_record": first}
                screenshot("03-original-parcel-record")
                page.locator('[data-parcel-action="close-record"]').click()
                page.locator('[name="query"]').fill("")
                with page.expect_response(lambda response:
                        response.url == origin + "/api/parcel-sources/rows"
                        and response.request.post_data_json.get("query") == ""):
                    page.locator('[data-parcel-form="search"] button[type="submit"]').click()
                if first_page["next_offset"] is not None:
                    with page.expect_response(lambda response:
                            response.url == origin + "/api/parcel-sources/rows"
                            and response.request.post_data_json.get("offset") == first_page["next_offset"]) as second:
                        page.locator('[data-parcel-action="next"]').click()
                    value = second.value.json()
                    if value["offset"] != first_page["next_offset"] or not value["rows"]:
                        raise AssertionError("The next page must read the next original inventory rows")
                    receipt["second_page"] = {"offset": value["offset"], "rows": len(value["rows"]), "total": value["total"]}
            stage("Search original IDs and page the full inventory", search_original)

            def download_originals():
                for name, label in (("parcel_csv", "Complete parcel inventory CSV"),
                                    ("report", "Printable parcel source report")):
                    with page.expect_download() as incoming:
                        page.get_by_role("link", name=label, exact=True).click()
                    download = incoming.value
                    path = output / "downloads" / download.suggested_filename
                    path.parent.mkdir(parents=True, exist_ok=True)
                    download.save_as(path)
                    actual = fact(path)
                    if actual["sha256"] != edition["files"][name]["sha256"]:
                        raise AssertionError("The downloaded original parcel output changed")
                    receipt["downloads"].append(actual)
            stage("Download original full inventory and operator report", download_originals)

            def map_view():
                page.get_by_role("button", name="Open parcel map", exact=True).click()
                page.get_by_role("heading", name="Spatial review", exact=True).wait_for()
                page.locator('[data-spatial-map]').first.wait_for(state="visible", timeout=120000)
                page.wait_for_function("""() => {
                    const node=document.querySelector('[data-spatial-status]');
                    return node && /^Map ready ·/.test(node.textContent);
                }""", timeout=120000)
                receipt["map_status"] = page.locator("[data-spatial-status]").inner_text()
                error = page.locator("[data-spatial-error]")
                if error.is_visible():
                    raise RuntimeError(error.inner_text())
                screenshot("04-original-parcel-map")
                page.locator('[data-view="parcel-sources"]').click()
                page.locator('[data-parcel-action="tab-editions"]').click()
                page.locator('[data-parcel-action="open-edition"][data-id="' + edition_id + '"]').first.click()
                page.locator('[data-parcel-form="study"]').wait_for()
            stage("Open the original spatial map and return to the edition", map_view)

            def build_inventory():
                page.locator('[name="studyTitle"]').fill(args.title + " · conservation inventory")
                page.locator('[name="mode"]').select_option("native_model" if args.baseline_run else "source_context")
                if args.baseline_run:
                    page.locator('[name="baseline"]').select_option(args.baseline_run)
                    for run_id in args.alternative_run:
                        page.locator('[name="alternative"][value="' + run_id + '"]').check()
                    page.locator('[name="scoreBasis"]').select_option(args.score_basis)
                    page.locator('[name="scoreScale"]').select_option(args.score_scale)
                    if args.score_basis != "current_export":
                        page.locator('[name="scoreAlternative"]').select_option(args.scoring_alternative)
                    receipt["native_study_selection"] = {
                        "baseline_run_id": args.baseline_run,
                        "alternative_run_ids": args.alternative_run,
                        "score_basis": args.score_basis, "score_scale": args.score_scale,
                        "scoring_alternative": args.scoring_alternative,
                    }
                task = click_queue("conservation.build", page.locator('[data-parcel-form="study"] button[type="submit"]'))
                receipt["conservation_task_id"] = task["id"]
                close_details()
                task = wait_task(task)
                close_details()
                receipt["conservation_study_id"] = task["result"]["id"]
                receipt["conservation_result"] = {
                    key: task["result"].get(key) for key in ("id", "state", "mode", "metric_state", "summary")
                }
                control = page.locator('[data-action="conservation-open-study"][data-study-id="' + task["result"]["id"] + '"]')
                control.first.wait_for(state="visible", timeout=120000)
                control.first.click()
                page.locator(".cons-candidates").wait_for(state="visible", timeout=120000)
                screenshot("05-original-conservation-inventory")
            stage("Build and open the original conservation inventory", build_inventory)

            def reopen():
                page.reload(wait_until="domcontentloaded")
                page.locator('[data-view="parcel-sources"]').wait_for(state="visible", timeout=120000)
                page.locator('[data-view="parcel-sources"]').click()
                page.locator('[data-parcel-action="tab-editions"]').click()
                page.locator('[data-parcel-action="open-edition"][data-id="' + edition_id + '"]').first.click()
                reopened = read("edition", edition_id=edition_id)
                if reopened["source_collection_id"] != edition["source_collection_id"] or reopened["input_selection"] != edition["input_selection"]:
                    raise AssertionError("Reopening must preserve the same original county source selection")
                page.locator('[data-parcel-action="record"]').first.wait_for()
                receipt["reopened_study_draft"] = page.locator('[data-parcel-form="study"]').evaluate(
                    """form => Object.fromEntries([...new FormData(form)].filter(([key]) => key !== 'alternative')
                       .concat([['alternatives',[...form.querySelectorAll('[name="alternative"]:checked')].map(item=>item.value)]]))""")
                screenshot("06-reopened-parcel-edition")
                receipt["reopened_binding"] = reopened["bindings"]
            stage("Close and reopen the retained edition", reopen)
            receipt["state"] = "complete"
        finally:
            context.close()
            for video in videos:
                path = Path(video.path())
                if path.is_file():
                    receipt.setdefault("videos", []).append(fact(path))
            browser.close()
            persist()
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator-url-file", required=True, help="Original private launch JSON; its capability is omitted from the report")
    parser.add_argument("--workspace-key")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--capture-directory")
    selection.add_argument("--edition-id")
    parser.add_argument("--title", default="Upper Savannah original county parcel edition")
    parser.add_argument("--output", required=True)
    parser.add_argument("--chromium-executable")
    parser.add_argument("--timeout-seconds", type=int, default=21600)
    parser.add_argument("--baseline-run", help="Actual completed original NDR+SDR run for the quantitative study")
    parser.add_argument("--alternative-run", action="append", default=[], help="Actual completed same-grid alternative; repeat for each selected run")
    parser.add_argument("--score-basis", choices=("current_export", "scenario_reduction", "disturbance_increase"), default="current_export")
    parser.add_argument("--score-scale", choices=("total", "per_hectare"), default="total")
    parser.add_argument("--scoring-alternative")
    args = parser.parse_args(argv)
    if args.alternative_run and not args.baseline_run:
        parser.error("--alternative-run requires --baseline-run")
    if args.score_basis != "current_export" and (
            not args.baseline_run or args.scoring_alternative not in args.alternative_run):
        parser.error("A change priority requires --baseline-run and --scoring-alternative among the selected --alternative-run values")
    value = run(args)
    print(json.dumps({"state": value["state"], "edition_id": value.get("edition_id"),
                      "output": str(Path(args.output).resolve()), "elapsed_seconds": value["elapsed_seconds"]}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
