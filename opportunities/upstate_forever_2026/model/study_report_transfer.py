"""Typed scientific lineage for original report documents in selected studies.

TokenJunkieLabs. Reads retained source objects without materializing source views
or changing the original producer. Each supported producer supplies an explicit
schema, project and original record identity; arbitrary metadata is not followed.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

REPORT_SCHEMA = "upstate.observed-report/v1"
DIAGNOSTIC_SCHEMA = "upstate.experiment-diagnostics/v1"
CAPTURE_SCHEMA = "upstate.diagnostic-report-context/v1/capture"


def _member_name(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Scientific report source needs canonical member paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Scientific report source member must remain relative")
    return value


def _members(entry):
    result = {}
    for item in entry.get("companions", []):
        name = _member_name(item.get("view_path", item["filename"]))
        if name in result:
            raise ValueError("Scientific report source repeats an original companion")
        result[name] = item
    return result


def _read_body(closure, item):
    closure.add_file(item["object"], item)
    return closure.read(item["object"])


def _diagnostic(closure, collection_id, entry, metadata):
    recipe = _read_body(closure, entry["body"])
    if (entry.get("kind") != "document" or recipe.get("schema") != REPORT_SCHEMA
            or recipe.get("report_context_kind") != "experiment_diagnostics"
            or metadata.get("report_schema") != REPORT_SCHEMA):
        raise ValueError("Diagnostic report source differs from its declared producer")
    diagnostic_id = identifier(recipe.get("diagnostic_id"))
    report_sha256 = identifier(recipe.get("report_sha256"))
    if metadata.get("diagnostic_id") != diagnostic_id or metadata.get("report_sha256") != report_sha256:
        raise ValueError("Diagnostic report source metadata names another saved revision")
    source_project = recipe.get("project_id")
    if not isinstance(source_project, str) or not source_project:
        raise ValueError("Diagnostic report source must retain its original project identity")
    members = _members(entry)
    requested = recipe.get("inputs")
    if not isinstance(requested, list):
        raise ValueError("Diagnostic report source must retain its original member descriptors")
    seen = set()
    for descriptor in requested:
        name = _member_name(descriptor["path"])
        item = members.get(name)
        if name in seen or item is None or any(
                descriptor.get(key) != item.get(key) for key in ("sha256", "bytes")):
            raise ValueError("Diagnostic report source lost an exact original companion: " + name)
        seen.add(name)
    report_item = members.get("retained/report.json")
    if report_item is None or "retained/report.json" not in seen or report_item["sha256"] != report_sha256:
        raise ValueError("Diagnostic report source lacks its exact scientific report revision")
    report = _read_body(closure, report_item)
    if (report.get("schema") != DIAGNOSTIC_SCHEMA or report.get("id") != diagnostic_id
            or report.get("selection") != recipe.get("original_selection")
            or report.get("source_stamp") != recipe.get("source_stamp")):
        raise ValueError("Diagnostic report recipe differs from its original scientific result")
    origin = PurePosixPath("experiment-diagnostics") / diagnostic_id
    for artifact in report.get("artifacts", {}).values():
        try:
            relative = PurePosixPath(_member_name(artifact["path"])).relative_to(origin)
        except (KeyError, ValueError) as error:
            raise ValueError("Diagnostic report artifact has another original analysis root") from error
        name = (PurePosixPath("retained") / relative).as_posix()
        item = members.get(name)
        if name not in seen or item is None or any(
                item.get(key) != artifact.get(key) for key in ("bytes", "sha256")):
            raise ValueError("Diagnostic source lost an original scientific export: " + name)
    local = source_project == closure.workspace.project["id"]
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": source_project,
        "report_context_kind": "experiment_diagnostics",
        "diagnostic_id": diagnostic_id, "report_sha256": report_sha256,
        "relationship": "same_project" if local else "external_project",
        "required_records": [{"kind": "experiment-diagnostics", "id": diagnostic_id}] if local else [],
    }
    if local:
        reason = "Original scientific cohort for diagnostic report " + entry["id"]
        closure.need("experiment-diagnostics", diagnostic_id, reason)
        manifest = closure.read((origin / "manifest.json").as_posix())
        identity = manifest.get("identity")
        if (manifest.get("id") != diagnostic_id or not isinstance(identity, dict)
                or digest(identity) != diagnostic_id
                or identity.get("selection") != report["selection"]
                or identity.get("source_stamp") != report["source_stamp"]):
            raise ValueError("The diagnostic source and original editable analysis have different identities")
        capture_prefix = "diagnostic-report-context/" + diagnostic_id + "/" + report_sha256
        capture_path = closure.root / capture_prefix / "capture.json"
        if capture_path.exists() or capture_path.is_symlink():
            capture = closure.read(capture_prefix + "/capture.json")
            if (capture.get("schema") != CAPTURE_SCHEMA
                    or capture.get("project_id") != source_project
                    or capture.get("diagnostic_id") != diagnostic_id
                    or capture.get("report_sha256") != report_sha256
                    or capture.get("source_stamp") != report["source_stamp"]):
                raise ValueError("The retained report capture differs from its scientific source")
            captured = {row["path"]: row for row in capture.get("members", [])}
            for name in seen:
                item = captured.get(name)
                if item is None or any(item.get(key) != members[name].get(key) for key in ("bytes", "sha256")):
                    raise ValueError("The editable diagnostic report capture lost an original companion")
            closure.tree(capture_prefix)
            closure._descriptors(capture.get("members", []), capture_prefix + "/")
    return binding


def include(closure, collection_id, entry):
    """Follow only exact maintained typed report sources in this source edition."""
    if not closure.report_lineage_enabled:
        return
    metadata = entry.get("metadata") or {}
    if metadata.get("report_context_kind") != "experiment_diagnostics":
        return
    binding = _diagnostic(closure, collection_id, entry, metadata)
    key = (collection_id, entry["id"])
    previous = closure.report_source_records.get(key)
    if previous is not None and previous != binding:
        raise ValueError("A scientific report source changed during study selection")
    closure.report_source_records[key] = binding


def receipt(closure):
    return [deepcopy(value) for unused, value in sorted(closure.report_source_records.items())]


def verify_receipt(closure, retained):
    """Original report identities must remain while new work may be appended."""
    actual = {(row["source_collection_id"], row["source_id"]): row for row in receipt(closure)}
    for row in retained:
        key = (row["source_collection_id"], row["source_id"])
        if actual.get(key) != row:
            raise ValueError("The received study lost its original scientific report lineage")

def include_calibration(closure, collection_id, entry):
    """Follow the exact CAL producer only for a selected saved report edition.

    Generic source traversal intentionally remains diagnostic-only, so older
    selected-study receipts do not acquire a new dependency contract on restore.
    """
    from . import calibration_study_transfer as calibration
    from .calibration_uncertainty import _source_stamp

    metadata = entry.get("metadata") or {}
    if metadata.get("producer") != calibration.REPORT_EDITION:
        return
    recipe = _read_body(closure, entry["body"])
    if (entry.get("kind") != "document" or recipe.get("schema") != REPORT_SCHEMA
            or metadata.get("report_schema") != REPORT_SCHEMA
            or recipe.get("edition") != calibration.REPORT_EDITION):
        raise ValueError("Calibration report source differs from its declared producer")
    native = recipe.get("native_calibration_review")
    if not isinstance(native, dict):
        raise ValueError("Calibration report source lost its original review binding")
    for field in ("review_id", "review_selection_id", "calibration_id", "plan_id",
                  "selected_run_id", "selected_profile_id"):
        identifier(native.get(field))
    for field in ("uncertainty_id", "map_id"):
        if native.get(field) is not None:
            identifier(native[field])
    source_project = native.get("workspace_id")
    if (native.get("edition") != calibration.REPORT_EDITION
            or not isinstance(source_project, str) or not source_project):
        raise ValueError("Calibration report source lost its project or producer identity")
    for key, expected in (
        ("calibration_review_id", native["review_id"]),
        ("calibration_id", native["calibration_id"]),
        ("selected_run_id", native["selected_run_id"]),
        ("selected_profile_id", native["selected_profile_id"]),
    ):
        if metadata.get(key) != expected:
            raise ValueError("Calibration source metadata differs from its original review: " + key)
    members = _members(entry)
    requested = recipe.get("inputs")
    if not isinstance(requested, list):
        raise ValueError("Calibration report source must retain its original companions")
    seen = set()
    for descriptor in requested:
        name = _member_name(descriptor["path"])
        item = members.get(name)
        if name in seen or item is None or any(
                descriptor.get(key) != item.get(key) for key in ("bytes", "sha256")):
            raise ValueError("Calibration report source lost a declared companion: " + name)
        seen.add(name)

    def body(name):
        if name not in seen:
            raise ValueError("Calibration source lacks the original dossier member: " + name)
        return _read_body(closure, members[name])

    def original(kind, key):
        value = body("dossier/records/" + kind + ".json")
        if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
            raise ValueError("Calibration dossier record differs from its original identity: " + kind)
        return {**value, "id": key}

    manifest = body("dossier/manifest.json")
    selection = manifest.get("selection")
    if (manifest.get("schema") != "upstate.calibration-review/v1"
            or not isinstance(selection, dict)
            or digest(selection) != native["review_selection_id"]
            or manifest.get("selection_id") != native["review_selection_id"]
            or selection.get("workspace_id") != source_project
            or selection.get("source_stamp") != native.get("source_stamp")):
        raise ValueError("Calibration report and original dossier have different review identities")
    for field in ("calibration_id", "plan_id", "uncertainty_id", "map_id"):
        if selection.get(field) != native.get(field):
            raise ValueError("Calibration dossier changed its original " + field)
    for name, item in manifest.get("files", {}).items():
        name = _member_name(name)
        member = members.get("dossier/" + name)
        if (item.get("path") != name or "dossier/" + name not in seen or member is None
                or any(item.get(field) != member.get(field) for field in ("bytes", "sha256"))):
            raise ValueError("Calibration source lost an original review export: " + name)
    report = original("calibrations", native["calibration_id"])
    plan = original("calibration-plans", native["plan_id"])
    observed = original("observations", plan["selection"]["observation_id"])
    detail = original("calibration-uncertainties", native["uncertainty_id"]) if native.get("uncertainty_id") else None
    atlas = original("calibration-maps", native["map_id"]) if native.get("map_id") else None
    catchment_entry = body("dossier/sources/catchment-entry.json")
    stamp = {
        "science": _source_stamp(report, plan, observed),
        "calibration_sha256": digest(report), "plan_sha256": digest(plan),
        "observation_sha256": digest(observed), "catchment_entry_sha256": digest(catchment_entry),
        "uncertainty_sha256": digest(detail) if detail else None,
        "map_sha256": digest(atlas) if atlas else None,
    }
    if stamp != native["source_stamp"]:
        raise ValueError("The calibration report source stamp differs from its original dossier")
    for field in ("plan_id", "selected_run_id", "selected_profile_id"):
        if report.get(field) != native[field]:
            raise ValueError("Calibration report changed its original nominal " + field)
    for value in (report, plan, detail, atlas):
        if value and value.get("workspace_id") != source_project:
            raise ValueError("Calibration dossier combines different original projects")
    reference = members.get("dossier/sources/original-observations.csv")
    if reference is None or any(reference.get(k) != observed["original"].get(k)
                                for k in ("bytes", "sha256")):
        raise ValueError("Calibration dossier lost its original observation table")
    if catchment_entry["body"]["sha256"] != plan["spatial_groups"]["source"]["sha256"]:
        raise ValueError("Calibration dossier changed its original catchment source")
    for descriptor in [catchment_entry["body"], *catchment_entry.get("companions", [])]:
        name = "dossier/sources/catchments/" + _member_name(descriptor.get("view_path", descriptor["filename"]))
        member = members.get(name)
        if name not in seen or member is None or any(
                member.get(k) != descriptor.get(k) for k in ("bytes", "sha256")):
            raise ValueError("Calibration dossier lost an original catchment member")
    local = source_project == closure.workspace.project["id"]
    required = []
    if local:
        reason = "Original editable calibration review for report " + entry["id"]
        review = calibration.record(closure, "calibration-reviews", native["review_id"], reason)
        if (review["selection"] != selection or review["source_stamp"] != stamp
                or review["selection_id"] != native["review_selection_id"]):
            raise ValueError("The report source and editable calibration review differ")
        for field in ("selected_run_id", "selected_profile_id"):
            if review[field] != native[field]:
                raise ValueError("The editable calibration review changed its nominal selection")
        required.append({"kind": "calibration-reviews", "id": review["id"]})
        producer_selection = {key: native[key] for key in (
            "edition", "workspace_id", "review_id", "review_selection_id", "source_stamp")}
        prefix = "calibration-report-source-exports/" + digest(producer_selection)
        pointer_path = closure.root / prefix / "result.json"
        if pointer_path.exists() or pointer_path.is_symlink():
            pointer = closure.read(prefix + "/result.json")
            producers = [calibration.record(closure, "calibration-report-sources", pointer.get("id"), reason)]
            if pointer != producers[0]:
                raise ValueError("The calibration report producer pointer changed")
        else:
            # The immutable record may have committed just before its recovery
            # pointer. Select only exact original producer records, then read
            # their immutable bytes through the ordinary closure.
            producers = [
                calibration.record(closure, "calibration-report-sources", row["id"], reason)
                for row in closure.workspace._list("calibration-report-sources")
                if row.get("selection") == producer_selection
            ]
        for producer in producers:
            if (producer["selection"] != producer_selection
                    or producer["files"]["observed-report.json"]["sha256"] != entry["body"]["sha256"]):
                raise ValueError("The report source differs from its original editable producer")
            required.append({"kind": "calibration-report-sources", "id": producer["id"]})
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"], "source_project_id": source_project,
        "report_context_kind": "calibration_review", "producer": calibration.REPORT_EDITION,
        "review_id": native["review_id"], "review_selection_id": native["review_selection_id"],
        "calibration_id": native["calibration_id"], "plan_id": native["plan_id"],
        "selected_run_id": native["selected_run_id"], "selected_profile_id": native["selected_profile_id"],
        "uncertainty_id": native.get("uncertainty_id"), "map_id": native.get("map_id"),
        "source_stamp": native["source_stamp"],
        "relationship": "same_project" if local else "external_project",
        "required_records": required,
    }
    key = (collection_id, entry["id"])
    previous = closure.report_source_records.get(key)
    if previous is not None and previous != binding:
        raise ValueError("A calibration report source changed during selected-study capture")
    closure.report_source_records[key] = binding
