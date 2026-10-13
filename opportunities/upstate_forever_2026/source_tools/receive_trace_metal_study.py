"""Import original trace observations, save a cohort and receive its editable scientific report."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

from model.common import atomic_json, describe_file, digest, held, identifier, read_json, verify_file
from model.workspace import Workspace
from measurement_workspace.published_studies import PublishedStudyStore
from measurement_workspace.study_reviews import PublishedStudyReviews
from measurement_workspace import trace_metal_observations as trace
from model import published_review_report_source as scientific


def _require(value, message):
    if not value:
        raise ValueError(message)


def _original_source(output, application):
    source = output / "original-study"
    checkpoint = output / "original-study-source.json"
    if checkpoint.exists():
        captured = read_json(checkpoint)
        _require(captured.get("schema") == "upstate.trace-study-source-capture/v1",
                 "Continue the original trace source capture.")
        for item in captured["files"]:
            verify_file(source, item)
    else:
        files = trace.build_files(application)
        source.mkdir(parents=True, exist_ok=True)
        for name, body in sorted(files.items()):
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            _require(not path.exists() or path.read_bytes() == body,
                     "An interrupted source capture contains different original bytes: " + name)
            if not path.exists():
                path.write_bytes(body)
        captured = {"schema": "upstate.trace-study-source-capture/v1",
                    "study_id": trace.BUILTIN_ID, "counts": trace.COUNTS,
                    "files": [describe_file(source, source / name) for name in sorted(files)]}
        atomic_json(checkpoint, captured, immutable=True)
    _require(captured.get("study_id") == trace.BUILTIN_ID,
             "The captured original source belongs to another study.")
    return source, captured


def _selected_review(workspace, output, request, source, capture):
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    checkpoint = output / "original-study-import.json"
    with held(workspace.root / ".workspace.lock", blocking=False):
        if checkpoint.exists():
            captured = read_json(checkpoint)
            complete = store.get_study(captured["study_id"], captured["version_id"])
            record = complete["record"]
            _require(record["bundle_sha256"] == captured["bundle_sha256"]
                     and record["source_collection_id"] == captured["source_collection_id"],
                     "The retained imported trace edition changed.")
        else:
            imported = store.import_source(source, make_current=False,
                operation_id="trace-native-" + digest(request))
            record = imported["record"] if "record" in imported else imported
            complete = store.get_study(record["study_id"], record["version_id"])
            record = complete["record"]
            captured = {key: record[key] for key in (
                "study_id", "version_id", "bundle_sha256", "source_collection_id")}
            atomic_json(checkpoint, captured, immutable=True)
        expected = {item["path"]: (item["bytes"], item["sha256"]) for item in capture["files"]}
        actual = {item["path"]: (item["bytes"], item["sha256"]) for item in record["source_files"]}
        _require(actual == expected, "The native import changed the complete captured original source.")
        rows = complete["observation_rows"]
        _require(len(rows) == 204 and record["counts"]["original_activity_count"] == 17,
                 "Retain all 153 metal results and 51 original same-activity chemistry results.")
        raw = [row["raw_cells"] for row in rows]
        _require(len({row["TraceRecordIdentity"] for row in raw}) == 204
                 and sum(row["TraceCohort"] == "trace_metal" for row in raw) == 153
                 and sum(row["TraceCohort"] == "same_activity_chemistry" for row in raw) == 51,
                 "The imported native rows lost their exact original source identities.")
        below = [row for row in raw if row["TraceCohort"] == "trace_metal"
                 and row["ResultDetectionConditionText"] == "Present Below Quantification Limit"]
        _require(len(below) == 115 and all(not row["ResultMeasureValue"]
                 and not row["ResultMeasure/MeasureUnitCode"]
                 and row["DetectionQuantitationLimitMeasure/MeasureValue"] for row in below),
                 "Original below-limit measured cells must remain blank.")
        reviews = PublishedStudyReviews(store)
        review_path = output / "saved-review.json"
        if review_path.exists():
            captured_review = read_json(review_path)
            saved = reviews.get(captured_review["id"])
            _require(saved["review"] == captured_review, "The saved original review changed.")
        else:
            known = {row["site_id"] for row in complete["available_stations"]}
            _require(not set(request["selection"]["site_ids"]) - known,
                     "Select original native station identifiers from this study.")
            context = store.context(record["study_id"], record["version_id"], **request["selection"])
            _require(context["observations"]["rows"], "Choose a trace cohort with original observed records.")
            saved = reviews.save({"study_id": record["study_id"], "version_id": record["version_id"],
                "title": request["title"], "table": "observed", "selection": request["selection"],
                "notes": "Original measured and reporting-limit cells, laboratory methods and source comments are retained. Full-source figures are labeled separately from this selected cohort."})
            saved = reviews.get(saved["review"]["id"])
            atomic_json(review_path, saved["review"], immutable=True)
        binding = saved["review"]["content"]["binding"]
        _require(binding["study_id"] == record["study_id"]
                 and binding["version_id"] == record["version_id"],
                 "The review must retain this exact imported study edition.")
    return record, saved


def _prepared_source(workspace, output, review):
    source_path, preview_path = output / "review-scientific-source.json", output / "review-scientific-preview.json"
    with held(workspace.root / ".workspace.lock", blocking=False):
        if source_path.exists():
            captured = read_json(source_path)
            result = scientific.inspect(workspace, captured["id"])
            _require(result["source_choice"] == captured["source_choice"]
                     and result["review_id"] == captured["review_id"],
                     "The retained selected scientific source changed.")
        else:
            preview = read_json(preview_path) if preview_path.exists() else None
            complete = (workspace.root / scientific.FOLDER / identifier(preview["id"]) / "result.json"
                        if preview else None)
            if complete is not None and complete.exists():
                result = scientific.inspect(workspace, preview["id"])
            else:
                preview = scientific.preview(workspace, review["id"])
                atomic_json(preview_path, preview)
                result = scientific.prepare(workspace, review["id"], expected_preview_id=preview["id"],
                                            expected_review_sha256=preview["review_sha256"])
            _require(result["review_id"] == review["id"], "Prepare the original saved trace review.")
            atomic_json(source_path, {key: result[key] for key in (
                "id", "review_id", "source_choice", "title")}, immutable=True)
    _require(result["review_id"] == review["id"], "The source selects another original review.")
    return result


def _reopened(path, review, source, record, selected_id=None):
    from model import study_transfer
    ws = Workspace(path)
    store = PublishedStudyStore(ws, ws.root / "published_studies")
    actual_review = PublishedStudyReviews(store).get(review["id"])
    _require(actual_review["review"] == review, "Receiving changed the original trace review.")
    actual_source = scientific.inspect(ws, source["id"])
    _require(actual_source["review_id"] == review["id"]
             and actual_source["source_choice"] == source["source_choice"],
             "Receiving changed the selected trace scientific source.")
    actual_record = store.get_study(record["study_id"], record["version_id"])["record"]
    _require(actual_record["bundle_sha256"] == record["bundle_sha256"]
             and actual_record["source_files"] == record["source_files"],
             "Receiving changed the complete original trace observation edition.")
    if selected_id is not None:
        _require(any(item["id"] == selected_id for item in study_transfer.verify_received_studies(ws)),
                 "The selected editable Study lost its original receipt.")
    return {"workspace": str(ws.root), "project_id": ws.project["id"], "review_id": review["id"],
            "study_id": record["study_id"], "version_id": record["version_id"],
            "source_edition_id": source["id"], "original_review_matches": True,
            "original_source_files_match": True}


def receive(workspace, *, output, site_ids=None, parameters=None, months=None, title=None,
            resume=False, prepare_only=False, timeout=1800, upload_limit_gib=4,
            browser_node=None, video=False):
    application = Path(__file__).resolve().parents[1]
    output = Path(output).expanduser().resolve()
    _require(not output.is_relative_to(workspace.root) and not workspace.root.is_relative_to(output)
             and not output.is_relative_to(application) and not application.is_relative_to(output),
             "Keep application, original Workspace and receiving output in separate trees.")
    _require(math.isfinite(timeout) and timeout > 0 and 1 <= upload_limit_gib <= 64,
             "Use positive task time and upload capacity from 1 to 64 GiB.")
    _require(not video or browser_node is not None, "Video requires the original browser course.")
    chosen_parameters = sorted(set(parameters if parameters is not None else trace.METALS))
    _require(chosen_parameters and not set(chosen_parameters) - set(trace.METALS + trace.CHEMISTRY),
             "Select the original metal or same-activity chemistry names.")
    chosen_months = sorted(set(months or []))
    _require(all(type(value) is int and 1 <= value <= 12 for value in chosen_months),
             "Choose original calendar months from 1 through 12.")
    selection = {"site_ids": sorted(set(site_ids or [])), "parameters": chosen_parameters,
                 "strata": [], "year": 2023, "months": chosen_months}
    request = {"schema": "upstate.trace-native-receiving-request/v1",
               "project_id": workspace.project["id"], "workspace": str(workspace.root),
               "application": str(application), "study_id": trace.BUILTIN_ID, "selection": selection,
               "title": title or "Eighteenmile 2023 — selected original trace observations",
               "prepare_only": bool(prepare_only), "selected_study": not prepare_only,
               "browser_node": str(Path(browser_node).resolve()) if browser_node else None, "video": bool(video)}
    if output.exists():
        _require(resume and output.is_dir(), "Use --resume for the same retained trace receiving directory.")
    else:
        _require(not resume, "Start this trace receiving output before using --resume.")
        output.mkdir(parents=True)
    with held(output / ".trace-native-receiving.lock", blocking=False):
        request_path = output / "trace-native-request.json"
        if request_path.exists():
            _require(read_json(request_path) == request,
                     "Resume the original project, exact cohort and report options.")
        else:
            _require(not any(path.name != ".trace-native-receiving.lock" for path in output.iterdir()),
                     "Use an empty new output or the existing original trace receiving directory.")
            atomic_json(request_path, request, immutable=True)
        original, capture = _original_source(output, application)
        record, saved = _selected_review(workspace, output, request, original, capture)
        review = saved["review"]
        source = _prepared_source(workspace, output, review)
        selected_rows = saved["context"]["observations"]["rows"]
        result = {"schema": "upstate.trace-native-receiving/v1", "state": "source_prepared",
                  "project_id": workspace.project["id"], "workspace": str(workspace.root),
                  "study_id": record["study_id"], "version_id": record["version_id"],
                  "review_id": review["id"], "source_edition_id": source["id"],
                  "source_choice": source["source_choice"], "selection": review["content"]["selection"],
                  "selected_result_count": len(selected_rows),
                  "selected_original_record_ids": [row["raw_cells"]["TraceRecordIdentity"] for row in selected_rows],
                  "complete_source_counts": trace.COUNTS,
                  "original_source_capture": describe_file(output, output / "original-study-source.json")}
        atomic_json(output / "trace-native-source-receiving.json", result)
        if prepare_only:
            return result
        report_selection = {"title": source["title"], "sources": [source["source_choice"]]}
        selection_path = output / "scientific-selection.json"
        atomic_json(selection_path, report_selection, immutable=True)
        report_output = output / "scientific-report"
        receipt_path = report_output / "scientific-report-receiving.json"
        browser_path = report_output / "browser" / "scientific-report-browser.json"
        browser_complete = False
        if browser_node and receipt_path.exists() and browser_path.exists():
            observed, prior = read_json(browser_path), read_json(receipt_path)
            browser_complete = (observed.get("state") == "complete"
                and observed.get("operation_id") == prior.get("operation_id")
                and observed.get("edition_id") == prior.get("edition_id")
                and (not video or bool(observed.get("video"))))
        if not receipt_path.exists() or browser_node and not browser_complete:
            receiver = application / "source" / "observed-report-20261013" / "receive_operator.py"
            _require(receiver.is_file(), "Receive the maintained original scientific-report course.")
            command = [sys.executable, "-B", str(receiver), "--workspace", str(workspace.root),
                       "--selection", str(selection_path), "--output", str(report_output),
                       "--selected-study", "--timeout", str(timeout), "--upload-limit-gib", str(upload_limit_gib)]
            if report_output.exists():
                command.append("--resume")
            if browser_node:
                command.extend(["--browser-node", str(Path(browser_node).resolve())])
            if video:
                command.append("--video")
            subprocess.run(command, check=True, cwd=application)
        report = read_json(receipt_path)
        native_request = read_json(report_output / "receiving-selection.json")
        _require(native_request.get("sources") == report_selection["sources"]
                 and native_request.get("title") == report_selection["title"]
                 and native_request.get("contact") is None
                 and native_request.get("selected_study") is True
                 and native_request.get("project_id") == workspace.project["id"]
                 and native_request.get("workspace") == str(workspace.root)
                 and report.get("operation_id") == digest(native_request),
                 "The native course changed the frozen trace source or report options.")
        _require(report.get("schema") == "upstate.scientific-report-receiving-workflow/v1"
                 and report.get("state") == "complete"
                 and report.get("project_id") == workspace.project["id"]
                 and report.get("original_workspace") == str(workspace.root)
                 and report.get("sources") == report_selection["sources"],
                 "The completed report receipt differs from the original trace operation.")
        selected_study = report.get("selected_study_receiving")
        _require(isinstance(selected_study, dict)
                 and selected_study.get("edition_id") == report["edition_id"],
                 "Complete the selected editable trace Study in the same course.")
        full = _reopened(report["restored_workspace"], review, source, record)
        subset = _reopened(selected_study["workspace"], review, source, record, selected_study["study_id"])
        _require(full["project_id"] == workspace.project["id"] == subset["project_id"],
                 "Receiving changed the original project identity.")
        for item in (report["report_archive"], report["workspace_archive"], selected_study["archive"]):
            path = Path(item["path"]).resolve(strict=True)
            _require(path.is_relative_to(output), "The retained archive escaped this receiving operation.")
            verify_file(output, {**item, "path": str(path.relative_to(output))})
        if browser_node:
            observed = read_json(browser_path)
            _require(observed.get("state") == "complete" and observed.get("operation_id") == report["operation_id"]
                     and observed.get("edition_id") == report["edition_id"]
                     and (not video or bool(observed.get("video"))),
                     "Complete the original report browser continuation.")
        result.update(state="complete", scientific_edition_id=report["edition_id"],
                      restored_project=full, restored_selected_study=subset,
                      scientific_receiving=describe_file(output, receipt_path),
                      browser_receiving=describe_file(output, browser_path) if browser_node else None,
                      report_archive=report["report_archive"], workspace_archive=report["workspace_archive"],
                      study_archive=selected_study["archive"])
        atomic_json(output / "trace-native-receiving.json", result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--station", action="append", help="Original native station ID, e.g. SV-245")
    parser.add_argument("--parameter", action="append", help="Original characteristic; defaults to all nine metals")
    parser.add_argument("--month", action="append", type=int)
    parser.add_argument("--title")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--prepare-only", action="store_true", help="Retain import, selected review and scientific source")
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--upload-limit-gib", type=int, default=4)
    parser.add_argument("--browser-node")
    parser.add_argument("--video", action="store_true")
    args = parser.parse_args(argv)
    result = receive(Workspace(args.workspace), output=args.output, site_ids=args.station,
        parameters=args.parameter, months=args.month, title=args.title, resume=args.resume,
        prepare_only=args.prepare_only, timeout=args.timeout, upload_limit_gib=args.upload_limit_gib,
        browser_node=args.browser_node, video=args.video)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
