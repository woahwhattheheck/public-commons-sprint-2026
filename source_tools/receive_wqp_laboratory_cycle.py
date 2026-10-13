"""Run the original Eighteenmile laboratory request-to-report receiving cycle.

Uses the maintained original WQP receiver, native laboratory dispatch and source
report APIs. The explicit request is a current authored receiving demonstration
bound to actual historical source samples and results.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import uuid
import zipfile

APPLICATION_ROOT = Path(__file__).resolve().parents[1]
if str(APPLICATION_ROOT) not in sys.path:
    sys.path.insert(0, str(APPLICATION_ROOT))

from model.common import atomic_json, describe_file, digest, file_digest, held, read_json
from model.workspace import Workspace
from model.implementation import ImplementationStore
from model.implementation_schema import document_digest
from model.implementation_observations import _retain
from model.implementation_lab_dispatch import preview_dispatch, prepare_dispatch, reconcile_dispatch
from model import implementation_dispatch_report as dispatch_report
from model import observed_context, scientific_report
from source_tools.receive_wqp_field_results import (
    receive as receive_original, SOURCE_DIRECTORY, CASE_DIRECTORY,
)

EDITION = "eighteenmile-laboratory-cycle-20261013-v1"
SCHEMA = "upstate.wqp-laboratory-cycle/v1"
REQUEST_SHA256 = "808c6874d007ac2efd2ab05c4076dd1d0aee78f0cce1ebcbb254779513aed795"
RESULT_SHA256 = "5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61"
SUBTITLE = "Original field observations, laboratory requests and retained result sources"
FOOTER = "Original source records and saved field-plan revisions"


def _describe(root, path):
    return describe_file(Path(root), Path(path))


def _member(root, descriptor):
    relative = observed_context._relative(descriptor["path"])
    path = Path(root) / relative
    if (path.is_symlink() or not path.is_file()
            or not path.resolve().is_relative_to(Path(root).resolve())
            or path.stat().st_size != descriptor["bytes"]
            or file_digest(path) != descriptor["sha256"]):
        raise ValueError("Retained cycle member changed: " + descriptor["path"])
    return path


def _request(case_directory, source_directory, seed):
    path = case_directory / "lab-request.json"
    if file_digest(path) != REQUEST_SHA256:
        raise ValueError("Choose the exact explicit current receiving-demonstration request")
    selected = read_json(path)
    result_path = source_directory / "three-lake-results-2023-original.csv"
    if file_digest(result_path) != RESULT_SHA256:
        raise ValueError("The original public WQP result CSV changed")
    with result_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    activities = {row["sample_id"]: row for row in seed["activities"] if row["kind"] == "sample"}
    if len(rows) != 88 or len(activities) != 88 or len(selected["orders"]) != 88:
        raise ValueError("Original request/sample/result coverage changed")
    expected = []
    for index, row in enumerate(rows, 1):
        activity = activities.get(row["ActivityIdentifier"])
        if activity is None or activity["site_id"] != row["MonitoringLocationIdentifier"]:
            raise ValueError("An original result lacks its exact saved sample/site")
        expected.append({
            "activity_id": activity["id"], "parameter": row["CharacteristicName"],
            "unit": row["ResultMeasure/MeasureUnitCode"] or row["DetectionQuantitationLimitMeasure/MeasureUnitCode"],
            "basis": "", "fraction": row["ResultSampleFractionText"],
            "method": row["ResultAnalyticalMethod/MethodIdentifier"],
            "notes": "Current receiving demonstration analysis for original WQP result record " +
                     str(index) + "; sample " + row["ActivityIdentifier"] + ".",
        })
    if selected["orders"] != expected or len({row["activity_id"] for row in expected}) != 88:
        raise ValueError("The explicit request differs from its original source-bound analyses")
    return selected, path


def _checkpoint(path, value):
    if path.exists():
        if read_json(path) != value:
            raise ValueError("The original receiving checkpoint changed: " + str(path))
    else:
        atomic_json(path, value, immutable=True)


def _render(workspace, report_source, root, operation_id, request_path):
    directory = root / "scientific-report"
    manifest_path = directory / "manifest.json"
    selection = report_source["delivery_selection"]
    binding = observed_context.bind(workspace, selection)
    if binding != report_source["binding"]:
        raise ValueError("The original scientific report source binding changed")
    if directory.exists() and not manifest_path.is_file():
        preserved = root / ("interrupted-scientific-report-" + uuid.uuid4().hex)
        directory.rename(preserved)
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        if (manifest.get("schema") != "upstate.wqp-laboratory-scientific-report/v1"
                or manifest.get("operation_id") != operation_id
                or manifest.get("binding") != binding
                or manifest.get("presentation") != {"subtitle": SUBTITLE, "footer": FOOTER}):
            raise ValueError("The retained standalone report belongs to another receiving edition")
        for descriptor in manifest["files"]:
            _member(directory, descriptor)
        return directory, manifest
    directory.mkdir(parents=True, exist_ok=True)
    _retain(request_path, directory / "receiving/lab-request-original.json",
            {"bytes": request_path.stat().st_size, "sha256": REQUEST_SHA256})
    collected = observed_context.collect(workspace, selection, directory, {})
    if collected is None or collected["binding"] != binding:
        raise ValueError("The selected original report did not return its bound sections")
    body_path, entry = workspace.source_file(
        report_source["source_collection_id"], report_source["source_id"],
    )
    recipe = read_json(body_path)
    title = recipe["title"]
    source_records = [{
        "id": entry["id"], "source_id": entry["id"], "title": entry["title"],
        "vintage": entry["vintage"], "uri": entry["uri"],
    }]
    outputs = scientific_report.write_companions(
        directory, title, collected["sections"], contact={},
        source_records=source_records, binding=binding, subtitle=SUBTITLE, footer=FOOTER,
    )
    pdf_path = directory / "report.pdf"
    scientific_report.report_pdf(
        pdf_path, title, collected["sections"], contact={}, source_records=source_records,
        footer=FOOTER,
    )
    for key in ("report_html", "report_markdown", "report_data"):
        _member(directory, outputs[key])
    if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        raise ValueError("The native scientific PDF did not produce its output")
    paths = sorted(path for path in directory.rglob("*") if path.is_file())
    files = [_describe(directory, path) for path in paths]
    manifest = {
        "schema": "upstate.wqp-laboratory-scientific-report/v1",
        "operation_id": operation_id, "binding": binding, "title": title,
        "presentation": {"subtitle": SUBTITLE, "footer": FOOTER},
        "source_records": source_records, "section_count": len(collected["sections"]),
        "outputs": {**outputs, "report_pdf": _describe(directory, pdf_path)},
        "files": files,
    }
    atomic_json(manifest_path, manifest, immutable=True)
    return directory, manifest


def _verify_archive(path, directory, members):
    expected = {item["path"]: item for item in members}
    with zipfile.ZipFile(path, "r") as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise ValueError("The retained report ZIP has another original member set")
        for name, descriptor in expected.items():
            observed = hashlib.sha256()
            count = 0
            with archive.open(name) as source:
                while True:
                    data = source.read(1024 * 1024)
                    if not data:
                        break
                    observed.update(data)
                    count += len(data)
            if count != descriptor["bytes"] or observed.hexdigest() != descriptor["sha256"]:
                raise ValueError("A retained report ZIP member differs: " + name)


def _archive_report(directory, manifest, root):
    members = manifest["files"] + [_describe(directory, directory / "manifest.json")]
    target = root / "scientific-report.zip"
    if target.exists():
        try:
            _verify_archive(target, directory, members)
        except (OSError, ValueError, zipfile.BadZipFile, RuntimeError, EOFError):
            target.rename(root / ("interrupted-scientific-report-" + uuid.uuid4().hex + ".zip"))
        else:
            return target
    with tempfile.NamedTemporaryFile(dir=root, prefix=".scientific-report-", suffix=".zip", delete=False) as handle:
        pending = Path(handle.name)
    with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for descriptor in sorted(members, key=lambda row: row["path"]):
            source_path = _member(directory, descriptor)
            info = zipfile.ZipInfo(descriptor["path"], date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            with source_path.open("rb") as incoming, archive.open(info, "w", force_zip64=True) as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
    _verify_archive(pending, directory, members)
    with pending.open("rb") as handle:
        os.fsync(handle.fileno())
    os.replace(pending, target)
    return target


def _reopen(workspace, root, identity, dispatch, comparison, source_report):
    path = root / "result.json"
    if not path.is_file():
        return None
    result = read_json(path)
    if (result.get("schema") != SCHEMA or result.get("identity") != identity
            or result.get("dispatch_id") != dispatch["dispatch_id"]
            or result.get("reconciliation_sha256") != digest(comparison)
            or result.get("report_source_binding") != source_report["report_source"]["binding"]):
        raise ValueError("The completed laboratory cycle belongs to another original source edition")
    for descriptor in result["files"]:
        _member(workspace.root, descriptor)
    if observed_context.bind(workspace, result["delivery_selection"]) != result["report_source_binding"]:
        raise ValueError("The completed cycle's source report binding changed")
    return {**result, "reused": True}


def receive(workspace_path, source_directory=SOURCE_DIRECTORY, case_directory=CASE_DIRECTORY, *,
            actor="", create_workspace=False,
            workspace_title="Eighteenmile original field observations"):
    source_directory, case_directory = Path(source_directory), Path(case_directory)
    # The maintained receiver reconnects its original imported seed and applied
    # laboratory revision; it never substitutes a later edited working plan.
    baseline = receive_original(
        Path(workspace_path), source_directory, case_directory, actor=actor,
        create_workspace=create_workspace, workspace_title=workspace_title,
    )
    workspace = Workspace(workspace_path)
    store = ImplementationStore(workspace)
    seed = store.get(baseline["plan_id"], revision=baseline["seed_revision"])
    applied = store.get(baseline["plan_id"], revision=baseline["applied_revision"])
    if seed["observations"]:
        raise ValueError("The original request baseline must retain its empty-result seed revision")
    if document_digest(applied) != baseline["applied_document_digest"]:
        raise ValueError("The retained original result revision changed")
    selected, request_path = _request(case_directory, source_directory, seed)
    dispatch_preview = preview_dispatch(workspace, seed, selected)
    if not dispatch_preview["can_prepare"]:
        raise ValueError("The original sample request needs resolution: " +
                         json.dumps(dispatch_preview["issues"], ensure_ascii=False))
    dispatch = prepare_dispatch(
        workspace, seed, selected, expected_operation_id=dispatch_preview["operation_id"], actor=actor,
    )
    comparison = reconcile_dispatch(workspace, applied, dispatch["dispatch_id"])
    if (comparison["summary"]["orders"] != 88 or comparison["summary"]["returned"] != 88
            or any(comparison["summary"][key] for key in ("missing", "ambiguous", "unrequested", "preexisting"))):
        raise ValueError("The original 88-result request/return comparison needs resolution: " +
                         json.dumps(comparison["summary"], ensure_ascii=False))
    prior_selection = baseline["observed_report_source"]["delivery_selection"]
    preview = dispatch_report.preview_dispatch_report(
        workspace, applied, dispatch["dispatch_id"], existing_report_selection=prior_selection,
    )
    source_report = dispatch_report.import_dispatch_report(
        workspace, applied, dispatch["dispatch_id"], expected_operation_id=preview["operation_id"],
        existing_report_selection=prior_selection,
    )
    if (source_report["summary"]["source_result_types"] !=
            {"numeric": 82, "censored": 6, "text": 0, "missing": 0}):
        raise ValueError("The native report changed the original result-type coverage")
    identity = {
        "schema": SCHEMA, "edition": EDITION, "workspace_id": workspace.project["id"],
        "baseline_operation_id": baseline["operation_id"],
        "plan_id": applied["id"], "seed_revision": seed["revision"],
        "seed_document_digest": document_digest(seed),
        "applied_revision": applied["revision"], "applied_document_digest": document_digest(applied),
        "original_results_sha256": RESULT_SHA256, "request_sha256": file_digest(request_path),
        "dispatch_id": dispatch["dispatch_id"], "reconciliation_sha256": digest(comparison),
        "report_operation_id": preview["operation_id"],
        "report_edition": dispatch_report.EDITION,
        "report_source_binding": source_report["report_source"]["binding"],
        "scientific_formatter_sha256": file_digest(Path(scientific_report.__file__)),
        "cycle_source_sha256": file_digest(Path(__file__)),
        "presentation": {"subtitle": SUBTITLE, "footer": FOOTER},
    }
    operation_id = digest(identity)
    root = workspace.root / "implementation" / "receiving" / "wqp-laboratory-cycle" / operation_id
    if root.is_symlink() or not root.resolve().is_relative_to(workspace.root.resolve()):
        raise ValueError("The original laboratory cycle directory escapes its workspace")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "operation.lock"):
        reopened = _reopen(workspace, root, identity, dispatch, comparison, source_report)
        if reopened is not None:
            return reopened
        _checkpoint(root / "identity.json", identity)
        _checkpoint(root / "lab-request.json", selected)
        _retain(request_path, root / "lab-request-original.json",
                {"bytes": request_path.stat().st_size, "sha256": REQUEST_SHA256})
        _checkpoint(root / "dispatch-preview.json", dispatch_preview)
        # Stable original package and report-source receipts omit only the
        # call-specific reconnect flag. Their original identities remain exact.
        original_dispatch = {key: value for key, value in dispatch.items() if key != "status"}
        _checkpoint(root / "dispatch.json", original_dispatch)
        _checkpoint(root / "reconciliation.json", comparison)
        _checkpoint(root / "report-preview.json", preview)
        _checkpoint(root / "report-source.json",
                    {key: value for key, value in source_report.items() if key != "reused"})
        directory, manifest = _render(
            workspace, source_report["report_source"], root, operation_id, request_path,
        )
        archive = _archive_report(directory, manifest, root)
        report_files = [
            _describe(workspace.root, directory / descriptor["path"]) for descriptor in manifest["files"]
        ] + [_describe(workspace.root, directory / "manifest.json"), _describe(workspace.root, archive)]
        local_names = [
            "identity.json", "lab-request.json", "lab-request-original.json", "dispatch-preview.json", "dispatch.json",
            "reconciliation.json", "report-preview.json", "report-source.json",
        ]
        outputs = {
            key: _describe(workspace.root, directory / descriptor["path"])
            for key, descriptor in manifest["outputs"].items()
        }
        result = {
            "schema": SCHEMA, "operation_id": operation_id, "identity": identity,
            "plan_id": applied["id"], "seed_revision": seed["revision"],
            "applied_revision": applied["revision"], "applied_document_digest": document_digest(applied),
            "laboratory_operation_id": baseline["laboratory_operation_id"],
            "dispatch_id": dispatch["dispatch_id"], "dispatch_summary": dispatch["summary"],
            "reconciliation": comparison["summary"], "reconciliation_sha256": digest(comparison),
            "original_result_counts": source_report["summary"]["source_result_types"],
            "observed_source_collection_id": baseline["source_collection_id"],
            "observation_ids": baseline["observation_ids"],
            "source_collection_id": source_report["source_collection_id"],
            "report_operation_id": source_report["operation_id"],
            "report_source_binding": source_report["report_source"]["binding"],
            "delivery_selection": source_report["delivery_selection"],
            "report_source": source_report["report_source"],
            "scientific_outputs": outputs, "scientific_report_zip": _describe(workspace.root, archive),
            "scientific_report_manifest": _describe(workspace.root, directory / "manifest.json"),
            "directory": root.relative_to(workspace.root).as_posix(),
            "files": [_describe(workspace.root, root / name) for name in local_names] + report_files,
        }
        atomic_json(root / "result.json", result, immutable=True)
        return {**result, "reused": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--source-directory", type=Path, default=SOURCE_DIRECTORY)
    parser.add_argument("--case-directory", type=Path, default=CASE_DIRECTORY)
    parser.add_argument("--actor", default="")
    parser.add_argument("--create-workspace", action="store_true",
                        help="Create this dedicated observed-data Workspace if it does not exist")
    parser.add_argument("--workspace-title", default="Eighteenmile original field observations")
    options = parser.parse_args()
    result = receive(
        options.workspace, options.source_directory, options.case_directory, actor=options.actor,
        create_workspace=options.create_workspace, workspace_title=options.workspace_title,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
