"""Receive original Eighteenmile WQP laboratory results into an actual Workspace.

Uses the published original sample-plan/CSV case and the maintained saved-plan,
laboratory intake, observation registry and report APIs. Re-running reconnects
the same historical base revision and import operation.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import uuid

APPLICATION_ROOT = Path(__file__).resolve().parents[1]
if str(APPLICATION_ROOT) not in sys.path:
    sys.path.insert(0, str(APPLICATION_ROOT))

from model.common import atomic_json, digest, file_digest, held, read_json
from model.workspace import Workspace
from model.implementation import ImplementationStore
from model.implementation_schema import document_digest, validate_plan
from model.implementation_lab_results import preview_lab_results, import_lab_results
from model.implementation_observations import (
    preview_observation_context, import_observation_context,
)

SOURCE_DIRECTORY = APPLICATION_ROOT / "observations/eighteenmile_2023/wqp_20261013"
CASE_DIRECTORY = SOURCE_DIRECTORY / "field-intake"


def receive(workspace_path: Path, source_directory: Path, case_directory: Path,
            *, actor: str = "") -> dict:
    workspace = Workspace(workspace_path)
    store = ImplementationStore(workspace)
    seed_path = case_directory / "plan.json"
    mapping_path = case_directory / "mapping.json"
    coverage_path = case_directory / "coverage.json"
    results_path = source_directory / "three-lake-results-2023-original.csv"
    seed = validate_plan(read_json(seed_path))
    mapping = read_json(mapping_path)
    coverage = read_json(coverage_path)
    if seed["id"] != coverage["plan_id"]:
        raise ValueError("The source plan and original coverage identify different cases")
    for kind, name in {
        "stations": "three-lake-stations-original.csv",
        "activities": "three-lake-activities-2023-original.csv",
        "results": "three-lake-results-2023-original.csv",
    }.items():
        if file_digest(source_directory / name) != coverage["source_hashes"][kind]:
            raise ValueError("The original WQP source changed: " + name)
    identity = {
        "schema": "upstate.wqp-field-receiving/v1",
        "workspace_id": workspace.project["id"],
        "plan_source_sha256": file_digest(seed_path),
        "mapping_sha256": file_digest(mapping_path),
        "coverage_sha256": file_digest(coverage_path),
        "original_source_hashes": coverage["source_hashes"],
    }
    operation_id = digest(identity)
    root = workspace.root / "implementation" / "wqp-receiving" / operation_id
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "operation.lock"):
        atomic_json(root / "identity.json", identity, immutable=True)
        seed_receipt = root / "seed-revision.json"
        if seed_receipt.is_file():
            seed_record = read_json(seed_receipt)
        else:
            imported = store.import_document(seed, expected_revision=0, actor=actor)
            seed_record = {
                "plan_id": seed["id"],
                "revision": imported["applied_revision"],
                "source_document_digest": document_digest(seed),
            }
            atomic_json(seed_receipt, seed_record, immutable=True)
        original = store.get(seed_record["plan_id"], seed_record["revision"])
        # The seed import preserves its original timestamp and fields, changing
        # only native revision zero to the first saved revision.
        expected_seed = dict(seed, revision=seed_record["revision"])
        if original != expected_seed:
            raise ValueError("The historical seed revision differs from its original input")
        preview = preview_lab_results(
            workspace, original, results_path, mapping, filename=results_path.name,
        )
        preview_path = root / "laboratory-preview.json"
        if preview_path.exists():
            if read_json(preview_path).get("operation_id") != preview["operation_id"]:
                raise ValueError("The retained laboratory preview identifies another source operation")
        else:
            atomic_json(preview_path, preview, immutable=True)
        if not preview.get("can_import"):
            raise ValueError("Original laboratory preview requires resolution: " +
                             json.dumps(preview.get("issues", []), ensure_ascii=False))
        imported = import_lab_results(
            workspace, original, results_path, mapping,
            expected_operation_id=preview["operation_id"], actor=actor,
            filename=results_path.name,
        )
        applied = store.get(seed["id"], imported["applied_revision"])
        if document_digest(applied) != imported["applied_document_digest"]:
            raise ValueError("Applied laboratory revision differs from its retained receipt")
        if len(applied["observations"]) != coverage["expected_csv_rows"]:
            raise ValueError("Applied result count differs from the original source")
        result_types = {
            kind: sum(row["result_type"] == kind for row in applied["observations"])
            for kind in ("numeric", "censored", "text", "missing")
        }
        for kind, count in coverage["expected_result_types"].items():
            if result_types[kind] != count:
                raise ValueError("Original result type count changed: " + kind)
        if result_types["text"] or result_types["missing"]:
            raise ValueError("Original three-lake result types changed")
        observed_preview = preview_observation_context(workspace, applied)
        observed = import_observation_context(
            workspace, applied, expected_operation_id=observed_preview["operation_id"],
        )
        report_directory = root / "field-report"
        if report_directory.exists() and not (report_directory / "manifest.json").is_file():
            report_directory.rename(root / ("incomplete-field-report-" + uuid.uuid4().hex))
        if not report_directory.exists():
            store.report(
                seed["id"], report_directory, as_of=seed["created_at"][:10],
                revision=applied["revision"],
            )
        retained_report = store.retain_report(report_directory)
        if (retained_report["plan_id"] != applied["id"] or
                retained_report["revision"] != applied["revision"]):
            raise ValueError("Retained field report differs from the applied revision")
        receipt = {
            "schema": "upstate.wqp-field-receiving-result/v1",
            "operation_id": operation_id, "identity": identity,
            "plan_id": applied["id"], "seed_revision": seed_record["revision"],
            "applied_revision": applied["revision"],
            "applied_document_digest": document_digest(applied),
            "laboratory_operation_id": preview["operation_id"],
            "laboratory_receipt_path": imported["receipt_path"],
            "result_counts": result_types,
            "source_collection_id": observed["source_collection_id"],
            "observation_ids": observed["observation_ids"],
            "observed_report_source": observed["report_source"],
            "retained_field_report": dict(
                retained_report,
                directory=Path(retained_report["directory"]).relative_to(workspace.root).as_posix(),
            ),
            "directory": root.relative_to(workspace.root).as_posix(),
        }
        atomic_json(root / "result.json", receipt, immutable=True)
        return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing original scientific Workspace")
    parser.add_argument("--source-directory", type=Path, default=SOURCE_DIRECTORY)
    parser.add_argument("--case-directory", type=Path, default=CASE_DIRECTORY)
    parser.add_argument("--actor", default="")
    options = parser.parse_args()
    result = receive(
        options.workspace, options.source_directory, options.case_directory,
        actor=options.actor,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
