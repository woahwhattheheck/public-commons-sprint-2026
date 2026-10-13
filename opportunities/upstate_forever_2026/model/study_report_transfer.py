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
