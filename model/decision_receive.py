"""Build a real decision edition and record its browser receiving journey."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import shlex
import shutil
import sys
import time
import uuid
import zipfile

if __package__:
    from . import decision_analysis as decisions
else:
    import decision_analysis as decisions


class BrowserUnavailable(RuntimeError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat()


def write_record(directory, record):
    target = directory / "journey.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(record, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
                         encoding="utf-8")
    temporary.replace(target)


@contextmanager
def stage(directory, record, name):
    item = {"stage": name, "started_at": now(), "status": "running"}
    record["steps"].append(item)
    write_record(directory, record)
    start = time.perf_counter()
    try:
        yield item
        item["status"] = "complete"
    except Exception as error:
        item.update(status="failed", error={"type": type(error).__name__, "message": str(error)})
        raise
    finally:
        item["seconds"] = round(time.perf_counter() - start, 6)
        write_record(directory, record)


def require(condition, message):
    if not condition:
        raise decisions.DecisionError(message)


def receive_browser(edition, directory, report, args, record):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserUnavailable("Playwright is absent in this Python environment") from error
    page = None
    with sync_playwright() as playwright:
        launch = {"headless": True}
        executable = args.browser_executable
        if not executable and not Path(playwright.chromium.executable_path).is_file():
            executable = next((path for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable")
                               if (path := shutil.which(name))), None)
            if not executable:
                raise BrowserUnavailable("Chromium is absent; select its existing path with --browser-executable")
        if executable:
            executable = str(Path(executable).resolve())
            if not Path(executable).is_file():
                raise BrowserUnavailable("Selected browser executable is missing: " + executable)
            launch["executable_path"] = executable
        with stage(directory, record, "launch_browser"):
            try:
                browser = playwright.chromium.launch(**launch)
            except Exception as error:
                raise BrowserUnavailable("Installed browser launch failed: " + str(error)) from error
            record["browser"] = {"version": browser.version, "playwright": importlib.metadata.version("playwright"),
                                 "executable": executable or playwright.chromium.executable_path}
        context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000},
                                      device_scale_factor=1)
        context.set_default_timeout(args.timeout_seconds * 1000)
        def open_page():
            value = context.new_page()
            value.on("pageerror", lambda error: record["browser_errors"].append(
                {"kind": "pageerror", "message": str(error), "url": value.url}))
            value.on("console", lambda message: record["browser_errors"].append(
                {"kind": "console", "message": message.text, "url": value.url})
                if message.type == "error" else None)
            return value
        def control(name):
            return page.locator("#" + name)
        def capture(name):
            page.screenshot(path=str(directory / name), full_page=True)
        def download(selector, name):
            with page.expect_download() as pending:
                page.locator(selector).click()
            result = pending.value
            failure = result.failure()
            require(not failure, "Browser download failed: " + str(failure))
            result.save_as(str(directory / name))
            return directory / name
        try:
            with stage(directory, record, "open_original_edition") as step:
                page = open_page()
                page.goto((edition / "index.html").as_uri(), wait_until="load")
                control("application").wait_for(state="visible")
                step["title"] = control("report-title").inner_text()
                require(report["id"] in control("footer-state").inner_text(), "Opened desk has a different report identity")
                capture("01-overview.png")
            with stage(directory, record, "choose_complete_scenario") as step:
                control("reset-filters").click()
                candidates = report.get("alternatives", [])
                require(candidates, "This report has no available alternative for the journey")
                chosen = next((item for item in candidates if item["run_id"] == args.run_id), None) if args.run_id else next(
                    (item for item in candidates if item.get("decision", {}).get("eligible")
                     and item.get("decision", {}).get("pareto")), candidates[0])
                require(chosen is not None, "--run-id must name an available original alternative")
                case_id = decisions._identifier(chosen["id"])
                page.locator('#panel-overview tbody button[data-select="' + case_id + '"]').click()
                require(control("panel-detail .scenario-heading .mono").inner_text() == chosen["run_id"],
                        "Chosen case identity differs")
                step.update(run_id=chosen["run_id"], scenario=chosen.get("label"))
                record["selected_run_id"] = chosen["run_id"]
                capture("02-selected-case.png")
            with stage(directory, record, "apply_view_criterion") as step:
                control("tab-overview").click()
                plot_metric = next(iter(chosen["outputs"]))
                control("chart-metric").select_option(plot_metric)
                step["plot_metric"] = plot_metric
                cost = chosen.get("cost")
                if cost:
                    control("currency-filter").select_option(cost["currency"])
                    control("annual-filter").fill(str(cost["annualized"]))
                    control("annual-filter").press("Tab")
                    step["criterion"] = {"annualized_limit": cost["annualized"], "currency": cost["currency"],
                                         "basis": "Selected scenario annualized cost"}
                else:
                    available = next(((metric, value) for metric, value in chosen["outputs"].items()
                                      if value.get("support", {}).get("status") == "paired"
                                      and isinstance(value.get("reduction"), (int, float))
                                      and value["reduction"] > 0), None)
                    if available:
                        metric, value = available
                        field = "#" + metric.replace("_export", "") + "-filter"
                        page.locator(field).fill(str(value["reduction"]))
                        page.locator(field).press("Tab")
                        step["criterion"] = {"pollutant": metric, "minimum_reduction": value["reduction"],
                                             "basis": "Selected scenario positive avoided export"}
                    else:
                        control("status-filter").select_option("frontier")
                        step["criterion"] = {"status": "frontier", "basis": "Prepared frontier"}
                step["visible_summary"] = control("filter-summary").inner_text()
                record["view_controls"] = {key: control(key).input_value() for key in
                    ("status-filter", "currency-filter", "chart-metric", "capital-filter", "annual-filter",
                     "nitrogen-filter", "phosphorus-filter", "sediment-filter")}
                capture("03-filtered-alternatives.png")
                download('[data-action="download-view"]', "filtered-view.csv")
            with stage(directory, record, "notes_and_real_downloads"):
                previous = control("decision-notes").input_value()
                note = args.notes or ("Operator receiving session " + record["started_at"]
                                     + "; selected original run " + chosen["run_id"] + ".")
                note = previous + "\n" + note if previous else note
                control("decision-notes").fill(note)
                record["working_notes"] = note
                download("#export-csv", "all-alternatives.csv")
                exported = download("#download-json", "exported-report.json")
                require(decisions.read_json(exported)["id"] == report["id"], "Browser JSON export changed report identity")
                request = download("#download-selection", "exported-selection.json")
                require(decisions.read_json(request)["comparison_id"] == report["scope"]["comparison_id"],
                        "Browser selection export changed comparison identity")
                control("tab-detail").click()
                saved = download("#save-desk", "saved-decision-desk.html")
            with stage(directory, record, "reopen_saved_desk_through_file_picker"):
                page = open_page()
                page.goto((edition / "index.html").as_uri(), wait_until="load")
                with page.expect_file_chooser() as pending:
                    control("open-button").click()
                pending.value.set_files(str(saved))
                page.wait_for_function("(note) => document.getElementById('decision-notes').value === note", arg=note)
                require(control("panel-detail .scenario-heading .mono").inner_text() == chosen["run_id"],
                        "Saved desk did not restore the selected run")
                for key, value in record["view_controls"].items():
                    current = control(key).input_value()
                    equivalent = current == value or (key not in ("status-filter", "currency-filter", "chart-metric")
                        and current and value and float(current) == float(value))
                    require(equivalent, "Saved desk did not restore " + key)
                capture("04-reopened-desk.png")
            with stage(directory, record, "open_standalone_saved_html_and_print"):
                page = open_page()
                page.goto(saved.as_uri(), wait_until="load")
                control("application").wait_for(state="visible")
                require(control("decision-notes").input_value() == note, "Standalone HTML lost notes")
                require(control("panel-detail .scenario-heading .mono").inner_text() == chosen["run_id"],
                        "Standalone HTML lost the selected case")
                control("tab-methods").click()
                capture("05-methods-and-sources.png")
                control("print-report").click()
                pdf = directory / "decision-report.pdf"
                page.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
                require(pdf.read_bytes().startswith(b"%PDF"), "Browser did not produce a PDF document")
            require(not record["browser_errors"], "Browser errors were recorded in journey.json")
        except Exception:
            if page is not None:
                try:
                    capture("failure-state.png")
                except Exception:
                    pass
            raise
        finally:
            context.close()
            browser.close()


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    source = value.add_mutually_exclusive_group(required=True)
    source.add_argument("--edition", help="Receive an existing completed decision folder")
    source.add_argument("--workspace", help="Build from existing original workspace comparisons")
    source.add_argument("--scenario-report", help="Build from an original native report.json or decision.json")
    value.add_argument("--selection")
    value.add_argument("--zone-id")
    value.add_argument("--output", help="New edition directory when building from original results")
    value.add_argument("--template")
    value.add_argument("--run-id", help="Original alternative to demonstrate; defaults to a prepared eligible frontier case")
    value.add_argument("--notes", help="Working note to append during the actual receiving journey")
    value.add_argument("--browser-executable", help="Existing Chromium/Chrome executable")
    value.add_argument("--timeout-seconds", type=float, default=30)
    return value


def main(argv=None):
    args = parser().parse_args(argv)
    started = time.perf_counter()
    try:
        require(args.timeout_seconds > 0, "Use a positive browser action timeout")
        analysis_start = time.perf_counter()
        if args.edition:
            edition = Path(args.edition).resolve()
        else:
            require(args.selection and args.output, "Building requires --selection and a new --output directory")
            selection = decisions.read_json(args.selection)
            if args.scenario_report:
                require(args.zone_id, "Native report intake requires --zone-id")
                packet = decisions.scenario_report_packet(args.scenario_report, args.zone_id)
                report = decisions.analyze_packet(packet, selection)
                result = decisions.export_report(report, args.output, template=args.template, input_packet=packet)
            else:
                result = decisions.build(args.workspace, selection, args.output, template=args.template)
            edition = Path(result["directory"])
        analysis_seconds = time.perf_counter() - analysis_start
        report = decisions.read_json(edition / "report.json")
        require(report.get("schema") == decisions.REPORT_SCHEMA and (edition / "index.html").is_file(),
                "Edition requires original report.json and index.html")
        directory = edition / "receiving" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
        directory.mkdir(parents=True)
        application = edition / "application"
        application.mkdir(exist_ok=True)
        for name, original in (("decision_receive.py", __file__), ("decision_analysis.py", decisions.__file__)):
            if not (application / name).exists():
                shutil.copyfile(original, application / name)
        resume = [sys.executable, "-B", str(application / "decision_receive.py"), "--edition", str(edition)]
        for name, value in (("--run-id", args.run_id), ("--notes", args.notes),
                            ("--browser-executable", args.browser_executable)):
            if value:
                resume.extend([name, value])

        record = {"schema": "upstate.decision-receiving/v1", "started_at": now(), "status": "running",
                  "report_id": report["id"], "edition": str(edition), "receiving_directory": str(directory),
                  "analysis": {"operation": "open_existing_edition" if args.edition else "build_from_original_results",
                               "seconds": round(analysis_seconds, 6)},
                  "python": platform.python_version(), "platform": platform.platform(),
                  "implementation": {"receiver_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                                     "desk_sha256": hashlib.sha256((edition / "index.html").read_bytes()).hexdigest()},
                  "steps": [], "browser_errors": [], "browser_resume_argv": resume,
                  "browser_resume_command": shlex.join(resume)}
        write_record(directory, record)
        exit_code = 0
        try:
            receive_browser(edition, directory, report, args, record)
            record["status"] = "complete"
        except BrowserUnavailable as error:
            record.update(status="browser_unavailable", error={"type": type(error).__name__, "message": str(error)})
            exit_code = 3
        except Exception as error:
            record.update(status="journey_failed", error={"type": type(error).__name__, "message": str(error)})
            exit_code = 1
        record.update(finished_at=now(), total_seconds=round(time.perf_counter() - started, 6))
        record["artifacts"] = [decisions._descriptor(path, directory, "browser_receiving")
                               for path in sorted(directory.rglob("*")) if path.is_file() and path.name != "journey.json"]
        write_record(directory, record)
        archive = directory / "decision-receiving-package.zip"
        members = [path for path in edition.rglob("*") if path.is_file() and path.suffix != ".zip"
                   and (path.relative_to(edition).parts[0] != "receiving" or path.is_relative_to(directory))]
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(members):
                bundle.write(path, path.relative_to(edition).as_posix())
        print(json.dumps({"status": record["status"], "report_id": report["id"], "edition": str(edition),
                          "journey": str(directory / "journey.json"), "archive": str(archive),
                          "browser_resume_command": record["browser_resume_command"]}, indent=2))
        return exit_code
    except (decisions.DecisionError, OSError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
