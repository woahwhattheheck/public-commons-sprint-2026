"""Receive a saved geographic cohort into the original Published studies review workflow."""
from __future__ import annotations

import argparse
from pathlib import Path

from model.common import atomic_json, describe_file, digest, identifier, read_json, verify_file
from model.workspace import Workspace
from measurement_workspace.published_studies import PublishedStudyStore
from measurement_workspace.study_reviews import PublishedStudyReviews
from measurement_workspace import geographic_study_selection as geographic


def receive(workspace, *, geography_id, study_id, output, version_id=None,
            site_ids=None, allow_partial=False, title=None):
    output = Path(output).resolve()
    record = workspace._get(geographic.KIND, identifier(geography_id))
    if site_ids is None:
        files = record["files"]
        if isinstance(files, dict):
            files = list(files.values())
        candidates = [item for item in files if Path(item["path"]).name == "analysis.json"]
        if len(candidates) != 1:
            raise ValueError("The saved geography must retain one original analysis.")
        analysis = read_json(verify_file(workspace.root, candidates[0]))
        site_ids = [row["station_id"] for row in analysis["stations"]]
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    study = store.get_study(study_id, version_id)["record"]
    payload = {"geography_id": geography_id, "site_ids": site_ids,
               "view": {"scope": "Original geographic cohort selected by native receiving"},
               "study_id": study["study_id"], "version_id": study["version_id"],
               "expected_source_manifest_sha256": study["source_manifest"]["sha256"]}
    resolved = geographic.resolve(workspace, store, payload)
    candidate = resolved["candidate"]
    if candidate["missing_site_ids"] and not allow_partial:
        raise ValueError("This original study is missing requested stations; inspect the exact IDs "
                         "and use --allow-partial to select the matched subset: " +
                         ", ".join(candidate["missing_site_ids"]))
    selected = {**resolved["review"], "study_id": study["study_id"],
                "version_id": study["version_id"]}
    if title is not None:
        selected["title"] = title
    reviews = PublishedStudyReviews(store)
    saved = reviews.save(selected)
    review_id = saved["review"]["id"]
    # Use the retained JSON representation for the original export/reopen check.
    # Newly calculated seasonal support may contain tuples before first saving.
    saved = reviews.get(review_id)
    directory = output / review_id
    exported = reviews.export(review_id, directory)
    # Reopen through independent objects and the normal complete review importer.
    reopened_workspace = Workspace(workspace.root)
    reopened_store = PublishedStudyStore(reopened_workspace, reopened_workspace.root / "published_studies")
    reopened_reviews = PublishedStudyReviews(reopened_store)
    imported = reopened_reviews.receive(
        directory / "saved-review.zip", operation_id="geographic-review-" + digest(
            {"project": workspace.project["id"], "review": review_id}))
    reopened = reopened_reviews.get(imported["review"]["id"])
    if reopened["review"]["content"] != saved["review"]["content"]:
        raise ValueError("The reopened study review differs from the original geographic selection.")
    result = {
        "schema": "upstate.geographic-study-review-receiving/v1",
        "workspace_project_id": workspace.project["id"],
        "geographic_source": resolved["source"],
        "study_id": study["study_id"], "version_id": study["version_id"],
        "source_collection_id": study["source_collection_id"],
        "review_id": review_id, "selection": saved["review"]["content"]["selection"],
        "matched_site_ids": candidate["matched_site_ids"],
        "missing_site_ids": candidate["missing_site_ids"],
        "observed_row_count": candidate["observed_row_count"],
        "original_result_row_count": candidate["original_result_row_count"],
        "reopened_review_matches": True,
        "files": [describe_file(output, path) for path in exported["files"]],
    }
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "geographic-study-review-receiving.json", result)
    return result



def _require(value, message):
    if not value:
        raise ValueError(message)


def _resolved_geography(workspace, store, request, version_id):
    record = workspace._get(geographic.KIND, identifier(request["geography_id"]))
    sites = request["site_ids"]
    if sites is None:
        files = record["files"]
        files = list(files.values()) if isinstance(files, dict) else files
        candidates = [item for item in files if Path(item["path"]).name == "analysis.json"]
        _require(len(candidates) == 1, "The saved geography must retain one original analysis.")
        analysis = read_json(verify_file(workspace.root, candidates[0]))
        sites = [row["station_id"] for row in analysis["stations"]]
    study = store.get_study(request["study_id"], version_id)["record"]
    return geographic.resolve(workspace, store, {
        "geography_id": request["geography_id"], "site_ids": sites,
        "view": {"scope": "Original geographic cohort selected by native receiving"},
        "study_id": study["study_id"], "version_id": study["version_id"],
        "expected_source_manifest_sha256": study["source_manifest"]["sha256"],
    })


def _original_review(workspace, output, request, version_id):
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    resolved = _resolved_geography(workspace, store, request, version_id)
    candidate = resolved["candidate"]
    _require(request["allow_partial"] or not candidate["missing_site_ids"],
             "The original study is missing requested stations; explicitly select --allow-partial.")
    path = output / "geographic-study-review-receiving.json"
    if path.exists():
        record = read_json(path)
    else:
        record = receive(
            workspace, geography_id=request["geography_id"], study_id=request["study_id"],
            version_id=version_id, output=output, site_ids=request["site_ids"],
            allow_partial=request["allow_partial"], title=request["title"])
    _require(record.get("schema") == "upstate.geographic-study-review-receiving/v1"
             and record.get("workspace_project_id") == workspace.project["id"]
             and record.get("study_id") == request["study_id"]
             and record.get("version_id") == version_id
             and record.get("geographic_source") == resolved["source"]
             and record.get("selection") == candidate["selection"]
             and record.get("matched_site_ids") == candidate["matched_site_ids"]
             and record.get("missing_site_ids") == candidate["missing_site_ids"],
             "The retained review receipt differs from this original geographic cohort.")
    for descriptor in record["files"]:
        verify_file(output, descriptor)
    reviews = PublishedStudyReviews(store)
    saved = reviews.get(record["review_id"])
    content = saved["review"]["content"]
    _require(content["selection"] == record["selection"]
             and content["binding"]["study_id"] == request["study_id"]
             and content["binding"]["version_id"] == version_id
             and content["binding"]["source_collection_id"] == record["source_collection_id"]
             and (request["title"] is None or content["title"] == request["title"].strip()),
             "The retained saved review changed its original source or authored title.")
    originals = [item for item in record["files"] if Path(item["path"]).name == "review.json"]
    _require(len(originals) == 1
             and read_json(verify_file(output, originals[0])) == saved["review"],
             "The original exported review differs from the retained review.")
    return record, saved


def _prepared_source(workspace, output, review):
    from model import published_review_report_source as scientific
    from model.common import held

    source_path = output / "review-scientific-source.json"
    preview_path = output / "review-scientific-preview.json"
    with held(workspace.root / ".workspace.lock", blocking=False):
        if source_path.exists():
            captured = read_json(source_path)
            result = scientific.inspect(workspace, captured["id"])
            _require(result["source_choice"] == captured["source_choice"]
                     and result["review_id"] == captured["review_id"],
                     "The retained scientific source checkpoint changed.")
        else:
            # Recover a producer completed before the outer checkpoint. Source
            # upgrades may replace an unsubmitted preview, never a saved source.
            preview = read_json(preview_path) if preview_path.exists() else None
            complete = (workspace.root / scientific.FOLDER / identifier(preview["id"]) / "result.json"
                        if preview else None)
            if complete is not None and complete.exists():
                result = scientific.inspect(workspace, preview["id"])
            else:
                preview = scientific.preview(workspace, review["id"])
                atomic_json(preview_path, preview)
                result = scientific.prepare(
                    workspace, review["id"], expected_preview_id=preview["id"],
                    expected_review_sha256=preview["review_sha256"])
            _require(result["review_id"] == review["id"],
                     "The scientific source does not select the original saved review.")
            atomic_json(source_path, {
                "schema": "upstate.geographic-review-scientific-source/v1",
                "id": result["id"], "review_id": result["review_id"],
                "source_choice": result["source_choice"], "title": result["title"],
            }, immutable=True)
    _require(result["review_id"] == review["id"],
             "The scientific source selects another saved review.")
    return result


def _reopened_review(path, review, source_id, *, selected_study_id=None):
    from model import published_review_report_source as scientific
    from model import study_transfer

    reopened = Workspace(path)
    store = PublishedStudyStore(reopened, reopened.root / "published_studies")
    saved = PublishedStudyReviews(store).get(review["id"])
    _require(saved["review"] == review, "Receiving changed the original saved observation review.")
    source = scientific.inspect(reopened, source_id)
    _require(source["review_id"] == review["id"],
             "The reopened scientific source changed its original saved review.")
    if selected_study_id is not None:
        received = study_transfer.verify_received_studies(reopened)
        _require(any(item["id"] == selected_study_id for item in received),
                 "The reopened selected Study lost its complete original receipt.")
    return {
        "workspace": str(reopened.root), "project_id": reopened.project["id"],
        "review_id": review["id"], "source_edition_id": source["id"],
        "source_choice": source["source_choice"],
        "study_id": review["content"]["binding"]["study_id"],
        "version_id": review["content"]["binding"]["version_id"],
        "original_review_matches": True,
    }


def receive_scientific(workspace, *, geography_id, study_id, output, version_id=None,
                       site_ids=None, allow_partial=False, title=None, resume=False,
                       contact=None, timeout=1800, upload_limit_gib=4,
                       browser_node=None, video=False):
    """Continue one exact review through the original scientific receiving queue."""
    import math
    import subprocess
    import sys
    from model.common import held

    application = Path(__file__).resolve().parents[1]
    output = Path(output).resolve()
    _require(not output.is_relative_to(workspace.root) and not workspace.root.is_relative_to(output)
             and not output.is_relative_to(application) and not application.is_relative_to(output),
             "Keep application, Workspace and receiving output in separate trees.")
    _require(math.isfinite(timeout) and timeout > 0 and 1 <= upload_limit_gib <= 64,
             "Use positive task time and upload capacity from 1 to 64 GiB.")
    _require(contact is None or isinstance(contact, dict), "Report contact must be an object.")
    _require(not video or browser_node is not None, "Video requires the existing native browser course.")
    requested = {
        "schema": "upstate.geographic-scientific-receiving-request/v1",
        "project_id": workspace.project["id"], "workspace": str(workspace.root),
        "application": str(application), "geography_id": identifier(geography_id),
        "study_id": study_id, "requested_version_id": version_id,
        "site_ids": sorted(set(site_ids)) if site_ids is not None else None,
        "allow_partial": bool(allow_partial), "title": title, "contact": contact,
        "selected_study": True,
        "browser_node": str(Path(browser_node).resolve()) if browser_node else None,
        "video": bool(video),
    }
    if output.exists():
        _require(resume and output.is_dir(), "Use --resume for this retained receiving output.")
    else:
        _require(not resume, "Start this receiving output before using --resume.")
        output.mkdir(parents=True)
    with held(output / ".geographic-scientific-receiving.lock", blocking=False):
        request_path = output / "geographic-scientific-request.json"
        if request_path.exists():
            frozen = read_json(request_path)
            _require(frozen.get("request") == requested,
                     "Resume the original Workspace, geography, study, cohort and report options.")
            selected_version = frozen["version_id"]
        else:
            prior = output / "geographic-study-review-receiving.json"
            if prior.exists():
                old = read_json(prior)
                selected_version = old["version_id"]
                _require(version_id is None or version_id == selected_version,
                         "Continue the original retained study version.")
            else:
                _require(not any(path.name != ".geographic-scientific-receiving.lock"
                                 for path in output.iterdir()),
                         "Choose the original review receiving output or an empty new directory.")
                store = PublishedStudyStore(workspace, workspace.root / "published_studies")
                selected_version = store.get_study(study_id, version_id)["record"]["version_id"]
            # Resolve original source and cohort before freezing a new operation.
            store = PublishedStudyStore(workspace, workspace.root / "published_studies")
            resolved = _resolved_geography(workspace, store, requested, selected_version)
            _require(allow_partial or not resolved["candidate"]["missing_site_ids"],
                     "The original study is missing requested stations; explicitly select --allow-partial.")
            atomic_json(request_path, {"request": requested, "version_id": selected_version,
                                      "geographic_source": resolved["source"]}, immutable=True)
            frozen = read_json(request_path)
        review_receipt, saved = _original_review(workspace, output, requested, selected_version)
        _require(review_receipt["geographic_source"] == frozen["geographic_source"],
                 "The original geographic source changed after this operation was accepted.")
        source = _prepared_source(workspace, output, saved["review"])
        selection = {"title": source["title"], "sources": [source["source_choice"]]}
        if contact is not None:
            selection["contact"] = contact
        selection_path = output / "scientific-selection.json"
        atomic_json(selection_path, selection, immutable=True)
        report_output = output / "scientific-report"
        native_receipt = report_output / "scientific-report-receiving.json"
        browser_receipt = report_output / "browser" / "scientific-report-browser.json"
        browser_complete = False
        if browser_node and native_receipt.exists() and browser_receipt.exists():
            browser_result = read_json(browser_receipt)
            prior_report = read_json(native_receipt)
            browser_complete = (browser_result.get("state") == "complete"
                                and browser_result.get("operation_id") == prior_report.get("operation_id")
                                and browser_result.get("edition_id") == prior_report.get("edition_id")
                                and (not video or bool(browser_result.get("video"))))
        if not native_receipt.exists() or browser_node and not browser_complete:
            receiver = application / "source" / "observed-report-20261013" / "receive_operator.py"
            _require(receiver.is_file(), "Receive the maintained scientific-report course into this application.")
            command = [
                sys.executable, "-B", str(receiver), "--workspace", str(workspace.root),
                "--selection", str(selection_path), "--output", str(report_output),
                "--selected-study", "--timeout", str(timeout),
                "--upload-limit-gib", str(upload_limit_gib),
            ]
            if report_output.exists():
                command.append("--resume")
            if browser_node:
                command.extend(["--browser-node", str(Path(browser_node).resolve())])
            if video:
                command.append("--video")
            subprocess.run(command, check=True, cwd=application)
        report = read_json(native_receipt)
        native_request = read_json(report_output / "receiving-selection.json")
        _require(native_request.get("sources") == selection["sources"]
                 and native_request.get("title") == selection["title"]
                 and native_request.get("contact") == contact
                 and native_request.get("selected_study") is True
                 and native_request.get("project_id") == workspace.project["id"]
                 and native_request.get("workspace") == str(workspace.root)
                 and report.get("operation_id") == digest(native_request),
                 "The native report operation changed the frozen review source or report options.")
        _require(report.get("schema") == "upstate.scientific-report-receiving-workflow/v1"
                 and report.get("state") == "complete"
                 and report.get("project_id") == workspace.project["id"]
                 and report.get("original_workspace") == str(workspace.root)
                 and report.get("sources") == selection["sources"],
                 "The scientific receiving receipt differs from this original saved review source.")
        selected = report.get("selected_study_receiving")
        _require(isinstance(selected, dict) and selected.get("edition_id") == report["edition_id"],
                 "Complete the selected editable Study in this original receiving operation.")
        full = _reopened_review(report["restored_workspace"], saved["review"], source["id"])
        subset = _reopened_review(selected["workspace"], saved["review"], source["id"],
                                  selected_study_id=selected["study_id"])
        _require(full["project_id"] == workspace.project["id"] == subset["project_id"],
                 "Receiving changed the original project identity.")
        for item in (report["report_archive"], report["workspace_archive"], selected["archive"]):
            path = Path(item["path"]).resolve(strict=True)
            _require(path.is_relative_to(output), "The retained archive escaped this receiving operation.")
            verify_file(output, {**item, "path": str(path.relative_to(output))})
        browser_descriptor = None
        if browser_node:
            observed = read_json(browser_receipt)
            _require(observed.get("state") == "complete"
                     and observed.get("operation_id") == report["operation_id"]
                     and observed.get("edition_id") == report["edition_id"]
                     and (not video or bool(observed.get("video"))),
                     "Complete the original report browser continuation before closing this course.")
            browser_descriptor = describe_file(output, browser_receipt)
        result = {
            "schema": "upstate.geographic-scientific-receiving/v1", "state": "complete",
            "project_id": workspace.project["id"], "workspace": str(workspace.root),
            "geography_id": geography_id, "study_id": study_id, "version_id": selected_version,
            "review_id": saved["review"]["id"], "source_edition_id": source["id"],
            "source_choice": source["source_choice"], "scientific_edition_id": report["edition_id"],
            "matched_site_ids": review_receipt["matched_site_ids"],
            "missing_site_ids": review_receipt["missing_site_ids"],
            "restored_project": full, "restored_selected_study": subset,
            "scientific_receiving": describe_file(output, native_receipt),
            "original_review_receiving": describe_file(
                output, output / "geographic-study-review-receiving.json"),
            "browser_receiving": browser_descriptor,
            "report_archive": report["report_archive"],
            "workspace_archive": report["workspace_archive"], "study_archive": selected["archive"],
        }
        atomic_json(output / "geographic-scientific-receiving.json", result)
        return result

def main(argv=None):
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--geography", required=True, help="Exact saved station-geographies record")
    parser.add_argument("--study", required=True, help="Original Published studies identifier")
    parser.add_argument("--version", help="Exact retained study version; initially defaults to its current edition")
    parser.add_argument("--station", action="append", help="Original station identifier; repeat for a subset")
    parser.add_argument("--allow-partial", action="store_true", help="Explicitly use matched stations when this study lacks others")
    parser.add_argument("--title", help="Optional authored review title")
    parser.add_argument("--output", required=True)
    parser.add_argument("--scientific-report", action="store_true",
                        help="Continue through the original report queue, full restore and selected editable Study")
    parser.add_argument("--resume", action="store_true", help="Resume the same scientific receiving directory")
    parser.add_argument("--contact-json", help="Optional original scientific-report contact object")
    parser.add_argument("--timeout", type=float, default=1800, help="Seconds per maintained native task")
    parser.add_argument("--upload-limit-gib", type=int, default=4)
    parser.add_argument("--browser-node", help="Node interpreter for the maintained report browser continuation")
    parser.add_argument("--video", action="store_true")
    args = parser.parse_args(argv)
    common = dict(geography_id=args.geography, study_id=args.study, version_id=args.version,
                  output=args.output, site_ids=args.station, allow_partial=args.allow_partial,
                  title=args.title)
    workspace = Workspace(args.workspace)
    if args.scientific_report:
        result = receive_scientific(
            workspace, **common, resume=args.resume,
            contact=read_json(Path(args.contact_json)) if args.contact_json else None,
            timeout=args.timeout, upload_limit_gib=args.upload_limit_gib,
            browser_node=args.browser_node, video=args.video)
    else:
        if args.resume or args.contact_json or args.browser_node or args.video:
            parser.error("Scientific receiving options require --scientific-report.")
        result = receive(workspace, **common)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
