"""Receive the retained seven-activity example through the native study workflow.

Run from an installed application with the complete original report source edition:
  python -B examples/selected-microbial-activities-20261013/receive.py \
    --workspace EXISTING_WORKSPACE --source-manifest ORIGINAL_SOURCES_JSON \
    --selection qualified-and-replicate-selection.json --output RECEIVING_DIRECTORY

An interrupted invocation resumes the same request and output directory.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from model.workspace import Workspace
from model.common import atomic_json, held, read_json
from measurement_workspace.published_studies import PublishedStudyStore
from measurement_workspace.study_reviews import PublishedStudyReviews
from measurement_workspace import microbial_selection
from measurement_workspace import source_observations
from measurement_workspace.published_studies import _observation_rows

EXPECTED_SELECTION_SHA = "93c0cffe276ae443409733b8d0ef77306051c862e5fec5557e81ecc34aaf6980"
SOURCE_ID = "assessment-association-report-ddae857afc24b47de43d"


def sha(body):
    return hashlib.sha256(body).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_rows(rows, ids):
    require(len(rows) == 7 and {row["activity_id"] for row in rows} == ids,
            "The selected native study differs from the seven original activities")
    require(len({row["monitoring_location_id"] for row in rows}) == 4,
            "The selected native study differs from the four original stations")
    above = [row for row in rows if row["censor_direction"] == "above"]
    require(len(above) == 6 and all(row["value"] is None for row in above),
            "Original above-limit results must retain their blank measured values")
    require(sorted(row["detection_limit"] for row in above) == [2419.6, 2419.6, 4839.2, 4839.2, 4839.2, 4839.2],
            "Original upper limits differ")
    replicate = [row for row in rows if row["activity_type"] == "Quality Control Sample-Field Replicate"]
    require(len(replicate) == 1 and replicate[0]["activity_id"] == "21GAEPD_WQX-A00428245"
            and replicate[0]["value"] == 21, "The original field replicate differs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    selection = args.selection.read_bytes()
    require(sha(selection) == EXPECTED_SELECTION_SHA, "Choose the exact retained seven-activity example")
    workspace = Workspace(args.workspace)
    output = args.output.resolve()
    request = {"schema": "upstate.microbial-selection-receiving-request/v1",
               "project_id": workspace.project["id"], "workspace": str(workspace.root),
               "source_manifest_sha256": sha(args.source_manifest.read_bytes()),
               "selection_sha256": sha(selection)}
    existed = output.exists()
    if existed and not (output / "request.json").is_file() and any(output.iterdir()):
        raise ValueError("Choose a new output directory or the original receiving request directory")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receive.lock", blocking=False):
        if (output / "request.json").exists():
            require(read_json(output / "request.json") == request,
                    "Continue the original source, selection and Workspace in this output directory")
        else:
            atomic_json(output / "request.json", request, immutable=True)
        _receive(args, output, selection, workspace)


def _receive(args, output, selection, workspace):
    collection = workspace.import_sources(args.source_manifest)
    store = PublishedStudyStore(workspace, workspace.root / "published_studies")
    payload = {"source_collection_id": collection["id"], "source_id": SOURCE_ID,
               "selection_json": selection.decode("utf-8"), "title": "Six original above-limit activities and one field replicate"}
    preview = microbial_selection.preview(workspace, payload)
    require(preview["summary"]["activities"] == 7 and preview["summary"]["stations"] == 4,
            "Original source preview counts differ")
    prepared = microbial_selection.prepare(workspace, store, payload, operation_id="microbial-selected-seven-receive")
    sid, vid = prepared["study_id"], prepared["version_id"]
    again = microbial_selection.prepare(workspace, store, payload, operation_id="microbial-selected-seven-repeat")
    require(again["reused"] and again["study_id"] == sid and again["version_id"] == vid,
            "Preparing the unchanged selection must reuse its native study edition")
    selected = store.get_study(sid, vid)
    ids = set(preview["selected_activity_ids"])
    check_rows(selected["observation_rows"], ids)
    paths = {row["path"] for row in prepared["record"]["source_files"]}
    index = json.loads(store.source_file(sid, source_observations.INDEX, vid)[0].read_bytes())
    require(index["record_count"] == 730 and index["activity_count"] == 730 and len(index["sources"]) == 6,
            "The retained complete observation source index changed")
    require(len([name for name in paths if name.startswith("original/")]) == 22,
            "The complete original 22-file source edition must remain retained")
    # Exercise the cold-read selector with a changed exported value and refreshed
    # descriptor: native original cells must still reject the changed claim.
    retained = source_observations.observation_files(
        lambda name: store.source_file(sid, name, vid)[0].read_bytes(), paths)
    selector = json.loads(retained[source_observations.SELECTION_INDEX])
    selection_path = selector["selection_source"]["path"]
    changed = json.loads(retained[selection_path])
    changed["observations"][0]["result_value"] = "4839.2"
    body = (json.dumps(changed, ensure_ascii=False) + "\n").encode("utf-8")
    retained[selection_path] = body
    selector["selection_source"].update(bytes=len(body), sha256=sha(body))
    retained[source_observations.SELECTION_INDEX] = json.dumps(selector).encode("utf-8")
    try:
        source_observations.load_observations(retained, _observation_rows)
    except ValueError:
        pass
    else:
        raise ValueError("Cold source intake accepted a changed original result claim")
    reviews = PublishedStudyReviews(store)
    review = reviews.save({"study_id": sid, "version_id": vid,
        "title": "Original microbial activity selection", "table": "observed",
        "selection": {}, "notes": "Six original above-limit routine samples and one original field replicate."})["review"]
    export_path = output / "saved-review" / "saved-review.zip"
    if export_path.exists():
        require(read_json(output / "saved-review" / "review.json") == review,
                "The existing export belongs to another saved review")
    else:
        reviews.export(review["id"], output / "saved-review")
    reopened_workspace = Workspace(output / "reopened-workspace", create=True)
    reopened = PublishedStudyStore(reopened_workspace, reopened_workspace.root / "published_studies")
    received = PublishedStudyReviews(reopened).receive(
        output / "saved-review" / "saved-review.zip", operation_id="microbial-selected-seven-reopen")
    reopened_record = reopened._record(sid, vid)
    check_rows(reopened.get_study(sid, vid)["observation_rows"], ids)
    require(reopened_record["bundle_sha256"] == prepared["record"]["bundle_sha256"],
            "Complete selected-study export/reopen changed the original source edition")
    # Continue the same saved review through the maintained scientific composer.
    # The source producer and renderer own their existing native locks and outputs.
    from model import published_review_report_source, scientific_report_editions
    source_checkpoint = output / "scientific-source.json"
    if source_checkpoint.exists():
        retained_source = read_json(source_checkpoint)
        report_source = published_review_report_source.inspect(workspace, retained_source["id"])
    else:
        source_preview = published_review_report_source.preview(workspace, review["id"])
        require(source_preview["counts"]["observation_records"] == 7
                and source_preview["counts"]["observation_activities"] == 7,
                "The scientific source preview must contain the exact selected activities")
        with held(workspace.root / ".workspace.lock", blocking=False):
            report_source = published_review_report_source.prepare(
                workspace, review["id"], expected_preview_id=source_preview["preview_id"],
                expected_review_sha256=source_preview["review_sha256"])
        atomic_json(source_checkpoint, {"id": report_source["id"],
                    "review_id": review["id"], "source_choice": report_source["source_choice"]},
                    immutable=True)
    require(report_source["review_id"] == review["id"]
            and report_source["counts"]["observation_records"] == 7
            and report_source["counts"]["observation_activities"] == 7,
            "The retained scientific source must describe this exact saved review")
    report_payload = {"sources": [report_source["source_choice"]],
                      "title": "Six original above-limit activities and one field replicate",
                      "contact": {}}
    scientific_checkpoint = output / "scientific-edition.json"
    if scientific_checkpoint.exists():
        completed = read_json(scientific_checkpoint)
        edition_id = completed["scientific_report_edition_id"]
        scientific_report_editions.validate_request(
            workspace, report_payload, scientific_report_editions.record(workspace, edition_id)[0]["render_identity"])
    else:
        preview_checkpoint = output / "scientific-preview.json"
        if preview_checkpoint.exists():
            report_preview = read_json(preview_checkpoint)
        else:
            report_preview = scientific_report_editions.preview(workspace, report_payload)
            atomic_json(preview_checkpoint, report_preview, immutable=True)
        completed = scientific_report_editions.render(
            workspace, {**report_payload, "preview_id": report_preview["id"]})
        edition_id = completed["scientific_report_edition_id"]
        atomic_json(scientific_checkpoint, completed, immutable=True)
    edition, report_directory, report_operation = scientific_report_editions.inspect(workspace, edition_id)
    require(edition["source_count"] == 1 and report_operation["state"] == "complete",
            "The scientific report must contain only the deliberately selected review")
    require({"report_pdf", "report_html", "report_data"} <= set(report_operation["files"]),
            "The scientific report must retain PDF, HTML and complete structured data")
    require((report_directory / report_operation["files"]["report_pdf"]["path"]).read_bytes().startswith(b"%PDF-"),
            "The original scientific PDF is missing")
    receipt = {"schema": "upstate.microbial-selection-receiving/v1",
        "source_collection_id": collection["id"], "source_id": SOURCE_ID,
        "study_id": sid, "version_id": vid, "reused": again["reused"],
        "review_id": review["id"], "selection_sha256": sha(selection),
        "summary": preview["summary"], "original_observation_count": 730,
        "original_response_count": 6, "original_source_files": 22,
        "selected_source_files": len(paths), "reopened_bundle_sha256": reopened_record["bundle_sha256"],
        "changed_result_claim_rejected": True,
        "scientific_report_edition_id": edition_id,
        "scientific_report_source": report_source["source_choice"],
        "scientific_report_directory": str(report_directory),
        "scientific_report_files": report_operation["files"],
        "saved_review_zip": str(output / "saved-review" / "saved-review.zip"),
        "selected_html": str(output / "saved-review" / "selected" / "study-report.html")}
    atomic_json(output / "receiving.json", receipt)
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
