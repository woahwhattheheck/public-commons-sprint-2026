"""Receive an actual completed Source Update through Reports, Review and Study."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path

from model import portable, reviews, scientific_report_editions, scientific_report_review, source_refresh, study_transfer
from model import source_refresh_report_source as report_source
from model.common import atomic_json, describe_file, digest, file_digest, held, now, read_json
from model.workspace import Workspace


def _outside(path, root):
    if path.is_relative_to(root) or root.is_relative_to(path):
        raise ValueError("Use a receiving output directory separate from the Workspace and application")


def run(args):
    workspace = Workspace(Path(args.workspace).resolve(strict=True))
    output = Path(args.output_dir).resolve()
    app = Path(__file__).resolve().parent.parent
    _outside(output, workspace.root.resolve())
    _outside(output, app)
    selection_path = Path(args.selection).resolve(strict=True)
    selection_bytes = selection_path.read_bytes()
    spec = report_source._spec(json.loads(selection_bytes))
    review_draft = (read_json(args.review_selection) if args.review_selection else {
        "title": spec["title"],
        "purpose": spec["rationale"],
        "requirements": [
            {"id": "source-editions", "title": "Review the selected source replacements",
             "detail": "Check original and replacement editions, changed body/companion bytes and the stated scientific reason."},
            {"id": "native-results", "title": "Review completed model stages and comparison support",
             "detail": "Check actual executed/reused model versions, original output units, common support and unavailable comparisons."},
        ],
        "notes": spec["notes"],
    })
    # Use the original review validator before creating any capture.
    review_draft = scientific_report_review._draft(review_draft)
    identity = {"schema": "upstate.source-refresh-report-receiving/v1",
                "project_id": workspace.project["id"], "selection": spec,
                "review_selection": review_draft}
    operation_id = digest(identity)
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".source-refresh-report-receiving.lock", blocking=False):
        admission_path = output / "admission.json"
        if admission_path.exists():
            admission = read_json(admission_path)
            if admission.get("identity") != identity:
                raise ValueError("This receiving directory belongs to another source-update selection")
        else:
            admission = {"id": operation_id, "identity": identity, "created_at": now()}
            atomic_json(admission_path, admission, immutable=True)
        state_path = output / "progress.json"
        state = read_json(state_path) if state_path.exists() else {"operation_id": operation_id}
        def save(phase, **values):
            state.update(values)
            state.update(phase=phase, updated_at=now())
            atomic_json(state_path, state)
            print(json.dumps({"operation_id": operation_id, "phase": phase}, sort_keys=True), flush=True)

        save("capture")
        if state.get("source_id"):
            source = report_source.get(workspace, state["source_id"])
            if source["selection"]["selection"] != spec or source["plan_id"] != spec["plan_id"]:
                raise ValueError("The retained report source belongs to another receiving selection")
        else:
            source = report_source.prepare(workspace, spec)
        save("report", source_id=source["id"], source=source["source"])
        payload = {"sources": [source["source"]], "title": source["title"]}
        prepared_path = output / "report-preview.json"
        if prepared_path.exists():
            prepared = read_json(prepared_path)
            scientific_report_editions.validate_request(workspace, payload, prepared["render_identity"])
        else:
            prepared = scientific_report_editions.preview(workspace, payload)
            atomic_json(prepared_path, prepared, immutable=True)
        rendered = scientific_report_editions.render(workspace, {**payload, "preview_id": prepared["id"]})
        edition_id = rendered["scientific_report_edition_id"]
        edition, edition_directory, rendered_result = scientific_report_editions.inspect(workspace, edition_id)
        save("customer-review", scientific_report_edition_id=edition_id)
        preview = scientific_report_review.preview_review(workspace, edition_id, review_draft)
        review = scientific_report_review.create_review(
            workspace, edition_id, review_draft,
            expected_operation_id=preview["operation_id"], created_at=admission["created_at"])
        current_review = reviews.show_review(workspace, review["review_id"], previews=False)
        review_dir, review_archive = output / "customer-review", output / "customer-review.zip"
        if review_dir.exists():
            exported_review = reviews.describe_export(review_dir)
            if exported_review["review_id"] != review["review_id"]:
                raise ValueError("The retained review export belongs to another source update")
            if not review_archive.exists():
                reviews.archive_packet(review_dir, review_archive)
            exported_review = reviews.describe_export(review_dir, archive=review_archive)
        else:
            exported_review = reviews.export_review(
                workspace, review["review_id"], review_dir, archive=review_archive,
                expected_response_id=current_review["latest_response_id"])
        save("editable-study", customer_review_id=review["review_id"],
             review_export=exported_review)
        study_selection = {
            "schema": study_transfer.SELECTION_SCHEMA, "title": source["title"],
            "roots": [{"kind": "scientific-report-editions", "id": edition_id},
                      {"kind": "reviews", "id": review["review_id"]}],
            "include_related_results": True,
        }
        planned = study_transfer.preview(workspace, study_selection)
        lineage = planned.get("scientific_report_sources", [])
        if not any(row.get("source_refresh_report_source_id") == source["id"] for row in lineage):
            raise ValueError("Install the maintained Source Updates report-to-Study include_source hook before editable receiving")
        atomic_json(output / "study-selection.json", study_selection, immutable=True)
        archive = output / "editable-study.zip"
        transfer = study_transfer.export_study(
            workspace, archive, study_selection,
            progress=lambda value: print(json.dumps({"study": value}, sort_keys=True), flush=True))
        save("cold-reopen", archive=describe_file(output, archive), study_id=transfer["id"])
        restored = output / "restored"
        received = (portable.resume_restore(archive, restored,
                    expected_archive_sha256=file_digest(archive))
                    if restored.exists() else portable.restore(archive, restored))
        reopened = Workspace(received["workspace"])
        retained_source = report_source.get(reopened, source["id"])
        if retained_source != {key: value for key, value in source.items() if key != "reused"}:
            raise ValueError("The restored scientific report source differs from its original capture")
        restored_edition, restored_directory, restored_result = scientific_report_editions.inspect(reopened, edition_id)
        if restored_edition != edition:
            raise ValueError("The restored report edition differs from its actual original rendering")
        restored_plan = source_refresh.get_plan(reopened, spec["plan_id"])
        if restored_plan["id"] != spec["plan_id"]:
            raise ValueError("The original source update was not retained for editable reopening")
        checked_studies = study_transfer.verify_received_studies(reopened)
        if not any(row.get("id") == transfer["id"] for row in checked_studies):
            raise ValueError("The selected editable Study did not reopen its retained identity")
        reopened_review = reviews.show_review(reopened, review["review_id"], previews=False)
        if reopened_review["review"] != current_review["review"]:
            raise ValueError("The original customer review request changed on receiving")
        result = {
            "schema": identity["schema"], "id": operation_id, "state": "complete",
            "project_id": workspace.project["id"], "plan_id": spec["plan_id"],
            "source_report_id": source["id"], "source": source["source"],
            "scientific_report_edition_id": edition_id, "customer_review_id": review["review_id"],
            "study_id": transfer["id"], "review_export": exported_review,
            "archive": describe_file(output, archive), "receiving": received,
            "reopened_plan_engine": restored_plan["engine"],
            "reopened_review_response_id": reopened_review["latest_response_id"],
            "completed_at": now(),
            "operator_course": "Open populated Source Updates and saved Scientific Reports at desktop and narrow widths; inspect the actual rendered pages before presentation.",
        }
        atomic_json(output / "receiving.json", result)
        save("complete", result=result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--selection", required=True, help="Actual {plan_id,title,rationale,notes} JSON")
    parser.add_argument("--review-selection", help="Optional original {title,purpose,requirements,notes} review draft")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    print(json.dumps(run(args), indent=2, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
