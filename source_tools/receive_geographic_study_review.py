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


def main(argv=None):
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--geography", required=True, help="Exact saved station-geography edition")
    parser.add_argument("--study", required=True, help="Original Published studies identifier")
    parser.add_argument("--version", help="Exact retained study version; default is its current edition")
    parser.add_argument("--station", action="append", help="Original station identifier; repeat for a subset")
    parser.add_argument("--allow-partial", action="store_true", help="Explicitly use matched stations when this study lacks others")
    parser.add_argument("--title", help="Optional authored review title")
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    result = receive(Workspace(args.workspace), geography_id=args.geography,
                     study_id=args.study, version_id=args.version, output=args.output,
                     site_ids=args.station, allow_partial=args.allow_partial, title=args.title)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
