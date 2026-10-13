#!/usr/bin/env python3
"""Receive an actual source cohort through the complete GWMA study workflow.

Run with the original installed application, a real original source CSV, its
matching published profile and a source URI. The course creates one retained
workspace and reuses it on retry. Review exercises are named in the saved study.
"""
import argparse
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model.workspace import Workspace
from model import gwma_study as gwma
from model.common import atomic_json, canonical, file_digest

def require(value, message):
    if not value:
        raise RuntimeError(message)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--source-uri", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--study-title", default="Published reference source — GWMA operator receiving")
    parser.add_argument("--mapping", help="Optional original-source column/constant mapping JSON")
    parser.add_argument("--source-manifest", help="Original API capture/source collection manifest")
    parser.add_argument("--source-id", default="cohort-csv")
    args = parser.parse_args()
    original_path = Path(args.csv).resolve(strict=True)
    original = original_path.read_bytes()
    source_sha = hashlib.sha256(original).hexdigest()
    require(len(original) <= gwma.MAX_UPLOAD, "Choose a coherent actual cohort under 4 MiB for this receiving course")
    original_rows = list(csv.DictReader(io.StringIO(original.decode("utf-8-sig"))))
    require(original_rows, "The actual source cohort has no rows")
    application = Path(__file__).resolve().parent
    plan_template = json.loads((application / "model/gwma_workplan_template.json").read_text())
    root = Path(args.workspace).resolve()
    workspace = Workspace(root, create=True, title="GWMA actual source receiving")
    study_payload = {"title": args.study_title + " — " + source_sha[:12],
                     "watersheds": plan_template["watersheds"],
                     "owners": {"study": args.reviewer, "laboratory": "", "risk": ""},
                     "notes": "Retained operational receiving course with original published observations. "
                              "Named review exercises demonstrate versioned exclusion and correction."}
    study = gwma.save_study(workspace, study_payload)
    require(gwma.save_study(workspace, study_payload)["id"] == study["id"], "Study replay changed identity")
    custom = json.loads(Path(args.mapping).read_text()) if args.mapping else {}
    mapping_payload = {"study_id": study["id"], "title": "Original published source fields",
                       "profile": args.profile, "columns": custom.get("columns", {}),
                       "constants": custom.get("constants", {})}
    mapping = gwma.save_mapping(workspace, mapping_payload)
    intake_payload = {"mapping_id": mapping["id"], "title": "Original published cohort — " + original_path.name,
                      "source_uri": args.source_uri, "filename": original_path.name,
                      "csv_base64": base64.b64encode(original).decode("ascii")}
    if args.source_manifest:
        collection = workspace.import_sources(args.source_manifest)
        intake_payload.pop("csv_base64")
        intake_payload.update({"source_collection_id": collection["id"], "source_id": args.source_id})
    batch = gwma.intake(workspace, intake_payload)
    require(batch["row_count"] == len(original_rows), "Intake lost original rows")
    require(batch["original"]["sha256"] == source_sha, "Intake changed original bytes")
    observed = workspace._get("observations", batch["observation_id"])
    require([row["original"] for row in observed["rows"]] == original_rows, "Intake changed original cells")
    require(gwma.intake(workspace, intake_payload)["id"] == batch["id"], "Exact intake replay changed the batch")
    first = batch["rows"][0]
    review1 = gwma.save_review(workspace, {"batch_id": batch["id"], "reviewer": args.reviewer,
                  "decisions": [{"row_id": first["row_id"], "disposition": "excluded",
                                 "reason": "Receiving exercise: demonstrate explicit exclusion while retaining the entire original record.",
                                 "overrides": {}}]})
    review2 = gwma.save_review(workspace, {"batch_id": batch["id"], "previous_review_id": review1["id"],
                  "reviewer": args.reviewer,
                  "decisions": [{"row_id": first["row_id"], "disposition": "pending",
                                 "reason": "Receiving exercise complete; return this original record to scientific review.",
                                 "overrides": {"qa_note": "Receiving review: original source retained; scientific interpretation pending."}}]})
    require(gwma.item(workspace, "review", review1["id"])["decisions"][0]["disposition"] == "excluded",
            "A successor review changed the original edition")
    reviewed = list(gwma.resolved_rows(workspace, batch["id"], review2["id"]))
    require(reviewed[0]["disposition"] == "pending", "The exact successor review was not applied")
    require(reviewed[0]["fields"]["qa_note"].startswith("Receiving review:"), "The explicit correction was lost")
    require(observed["rows"][0]["original"] == original_rows[0], "Review mutated original source data")
    remapping = gwma.save_mapping(workspace, {**mapping_payload,
                  "title": "Retained source remapping exercise",
                  "constants": {**custom.get("constants", {}), "qa_note": "Mapped receiving review annotation"}})
    remapped = gwma.intake(workspace, {"mapping_id": remapping["id"], "title": "Same original under successor mapping",
                  "source_uri": args.source_uri, "observation_id": batch["observation_id"]})
    require(remapped["original"] == batch["original"] and remapped["observation_id"] == batch["observation_id"],
            "Remapping duplicated or changed the original source")
    require([row["row_id"] for row in remapped["rows"]] == [row["row_id"] for row in batch["rows"]],
            "Remapping changed source-row identities")
    contract = None
    candidate = next((row for row in batch["rows"] if all(row["fields"].get(key)
                      for key in ("parameter", "method", "matrix", "unit"))), None)
    if candidate:
        fields = candidate["fields"]
        contract = gwma.save_contract(workspace, {"study_id": study["id"],
                    "title": "Exact observed concentration receiving contract", "reviewer": args.reviewer,
                    "model": {"name": "GWMA observed concentration handover", "version": "1",
                              "input_schema": "upstate.gwma-batches/v1",
                              "output_schema": "GWMA analytical/model-inputs.csv version 1"},
                    "rules": [{"parameter": fields["parameter"], "method": fields["method"],
                               "matrix": fields["matrix"], "fraction": fields["fraction"],
                               "from_unit": fields["unit"], "to_unit": fields["unit"],
                               "factor": "1", "censoring": "preserve_bounds"}],
                    "notes": "Receiving contract preserves the original measured unit and censor semantics."})
    plan = gwma.save_plan(workspace, {**plan_template, "study_id": study["id"]})
    handover_payload = {"study_id": study["id"], "title": "Complete original source and reviewed study handover",
                        "batch_reviews": [{"batch_id": batch["id"], "review_id": review2["id"]}],
                        "contract_id": contract["id"] if contract else None, "plan_id": plan["id"]}
    handover = gwma.build_handover(workspace, handover_payload)
    archive = root / handover["archive"]["path"]
    with zipfile.ZipFile(archive) as zipped:
        require(zipped.testzip() is None, "An archive member has a CRC error")
        manifest = json.loads(zipped.read("manifest.json"))
        for member in manifest["files"]:
            body = zipped.read(member["path"])
            require(len(body) == member["bytes"] and hashlib.sha256(body).hexdigest() == member["sha256"],
                    "Archive member does not match its complete manifest: " + member["path"])
        require(zipped.read("originals/" + source_sha + ".csv") == original, "Handover changed original CSV")
        all_exported = list(csv.DictReader(io.StringIO(zipped.read("analytical/all-observations.csv").decode())))
        require(len(all_exported) == len(original_rows), "Handover lost full-scope observations")
        require("gwma-reviews/" + review1["id"] + ".json" in zipped.namelist(),
                "Handover omitted original review history")
        archive_members = len(zipped.namelist())
    verification = gwma.verify_all(workspace)
    receiving = root.with_name(root.name + "-reopened")
    staging = root.with_name(root.name + "-reopened.pending")
    stage_identity = {"schema": "gwma.receiving-copy/v1", "source_workspace": str(root),
                      "source_sha256": source_sha, "handover_id": handover["id"]}
    def receive_at(destination):
        reopened = Workspace(destination)
        require(gwma.verify_all(reopened) == verification, "Cold receiving changed retained record counts")
        reopened_handover = gwma.build_handover(reopened, handover_payload)
        require(reopened_handover["id"] == handover["id"] and reopened_handover["archive"] == handover["archive"],
                "Cold receiving changed the complete saved analytical handover")
        require(file_digest(destination / reopened_handover["archive"]["path"]) == handover["archive"]["sha256"],
                "Cold receiving changed archive bytes")
        return reopened_handover
    if receiving.exists():
        receive_at(receiving)
    else:
        staging.mkdir(parents=True, exist_ok=True)
        marker = staging / ".gwma-receiving-copy.json"
        if marker.exists():
            require(json.loads(marker.read_text()) == stage_identity,
                    "Existing receiving copy belongs to a different source or handover")
        else:
            require(not any(staging.iterdir()), "Existing receiving directory has no matching operation identity")
            atomic_json(marker, stage_identity)
        # Reconcile only this retained operation's partial copy. The source
        # workspace is stopped throughout this course and is never replaced.
        shutil.copytree(root, staging, dirs_exist_ok=True)
        receive_at(staging)
        staging.rename(receiving)
        receive_at(receiving)
    # Explicit overlap is rejected before an archive is published.
    try:
        gwma.build_handover(workspace, {**handover_payload,
            "batch_reviews": [{"batch_id": batch["id"]}, {"batch_id": remapped["id"]}]})
    except ValueError as error:
        require("same original CSV" in str(error), "Overlap failed for a different reason")
    else:
        raise RuntimeError("A source file was double-counted through two mapping editions")
    result = {"status": "COMPLETE", "source_uri": args.source_uri, "source_sha256": source_sha,
              "source_bytes": len(original), "source_rows": len(original_rows),
              "workspace": str(root), "reopened_workspace": str(receiving),
              "study_id": study["id"], "mapping_id": mapping["id"], "batch_id": batch["id"],
              "review_ids": [review1["id"], review2["id"]], "remapped_batch_id": remapped["id"],
              "contract_id": contract["id"] if contract else None, "plan_id": plan["id"],
              "handover": handover, "archive_members": archive_members, "receiving": verification}
    atomic_json(root / "gwma-receiving-result.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
