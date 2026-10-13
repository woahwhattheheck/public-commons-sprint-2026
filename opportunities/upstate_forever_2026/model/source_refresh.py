"""Immutable source-edition refresh planning and resumable native recomputation.

Previewing uses retained source manifests and the Python standard library.
Applying delegates validation, gridding and execution to the existing Workspace:
it never fabricates spatial or model outcomes and never edits an earlier edition.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping

from .common import atomic_json, describe_file, digest, held, identifier, now, read_json, verify_file

PLAN_KIND = "source-refresh-plans"
PREVIEW_SCHEMA = "upstate.source-refresh-preview/v1"
STATE_SCHEMA = "upstate.source-refresh-state/v1"
KINDS = ("profiles", "scenarios", "grids", "runs")
_LINEAGE_FIELDS = frozenset({
    "id", "title", "description", "uri", "url", "vintage", "edition",
    "version", "license", "licence", "attribution", "citation", "citations",
    "notes", "note", "source", "publisher", "provider", "author",
    "captured_at", "retrieved_at", "fetched_at", "downloaded_at",
    "retrieval_timestamp", "accessed_at", "published_at", "last_modified",
    "provenance", "receipt", "receipts", "references", "access", "transport",
    "source_capture_id", "original_archive_sha256", "original_member_sha256", "source_time",
})
_SEMANTIC_TOKENS = frozenset({
    "crs", "srs", "epsg", "units", "unit", "nodata", "no_data", "scale",
    "offset", "conversion", "resampling", "resolution", "band", "layer",
    "where", "driver", "encoding", "cell_size", "cellsize", "axis_order",
    "measurement", "method", "kind", "role", "datum", "projection",
    "factor", "value_field", "area_field", "field_mapping",
})


def _clean(value: Mapping[str, Any]) -> Dict[str, Any]:
    return deepcopy({key: item for key, item in value.items()
                     if key not in ("id", "schema")})


def _sorted_rows(rows: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    return sorted((deepcopy(dict(row)) for row in rows),
                  key=lambda row: str(row.get("id", "")))


def _selection(value: Mapping[str, Any]) -> Dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("Refresh selection must be an object")
    allowed = {"from_collection_id", "to_collection_id", "source_id_map", "title"}
    unexpected = sorted(set(value) - allowed)
    if unexpected:
        raise ValueError("Unknown refresh selection fields: " + ", ".join(unexpected))
    old_id = identifier(value.get("from_collection_id", ""))
    new_id = identifier(value.get("to_collection_id", ""))
    if old_id == new_id:
        raise ValueError("Select two different retained source collections")
    mapping = value.get("source_id_map") or {}
    if not isinstance(mapping, Mapping):
        raise ValueError("source_id_map must map original source IDs to replacement source IDs")
    normalized = {}
    for old, new in mapping.items():
        if not isinstance(old, str) or not old or (new is not None and (not isinstance(new, str) or not new)):
            raise ValueError("Each source_id_map key must be a source ID; values must be source IDs or null")
        normalized[old] = new
    title = value.get("title") or "Source edition refresh"
    if not isinstance(title, str):
        raise ValueError("Refresh title must be text")
    return {"from_collection_id": old_id, "to_collection_id": new_id,
            "source_id_map": dict(sorted(normalized.items())), "title": title}


def _entry_index(collection: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    entries = collection.get("entries")
    if not isinstance(entries, list):
        raise ValueError("A retained source collection must contain an entries list")
    result = {}
    for entry in entries:
        if not isinstance(entry, Mapping) or not isinstance(entry.get("id"), str):
            raise ValueError("A retained source entry has no string source ID")
        key = entry["id"]
        if not key or key in result:
            raise ValueError("A retained source collection contains an empty or duplicate source ID")
        result[key] = deepcopy(dict(entry))
    return result


def _body_fingerprint(body: Mapping[str, Any]) -> Dict[str, Any]:
    if not isinstance(body, Mapping) or not body.get("sha256"):
        raise ValueError("A retained source body has no SHA-256 fingerprint")
    return {"sha256": body["sha256"], "bytes": body.get("bytes")}


def _native_view_name(body: Mapping[str, Any]) -> str:
    # Match Workspace.source_file exactly: view_path is a relative reader layout;
    # source_path is the acquisition location and is not opened by native models.
    name = body.get("view_path", body.get("filename"))
    if not isinstance(name, str) or not name:
        raise ValueError("A retained source body has no native reader filename")
    return Path(name).as_posix()


def _companion_fingerprints(entry: Mapping[str, Any]) -> List[Dict[str, Any]]:
    # Relative native names preserve VRT references, shapefile sidecars and siblings.
    rows = []
    for item in entry.get("companions", []):
        row = _body_fingerprint(item)
        row["native_view_path"] = _native_view_name(item)
        rows.append(row)
    return sorted(rows, key=lambda row: (str(row["native_view_path"]), str(row["sha256"]),
                                        str(row.get("bytes"))))


def _metadata(entry: Mapping[str, Any]) -> Dict[str, Any]:
    return {key: deepcopy(value) for key, value in entry.items()
            if key not in ("id", "body", "companions")}


def _different_fields(old: Any, new: Any, prefix: str = "") -> List[str]:
    if isinstance(old, Mapping) and isinstance(new, Mapping):
        paths = []
        for key in sorted(set(old) | set(new)):
            path = prefix + "." + str(key) if prefix else str(key)
            if key not in old or key not in new:
                paths.append(path)
            else:
                paths.extend(_different_fields(old[key], new[key], path))
        return paths
    return [prefix] if old != new else []


def _semantic(path: str) -> bool:
    tokens = path.lower().replace("-", "_").split(".")
    if any(token in _SEMANTIC_TOKENS for token in tokens):
        return True
    # Unknown metadata is conservatively computational; only recognized
    # provenance fields are treated as lineage-only.
    return not tokens or tokens[0] not in _LINEAGE_FIELDS


def _change(old: Mapping[str, Any], new: Mapping[str, Any] | None) -> Dict[str, Any]:
    if new is None:
        return {"from_source_id": old["id"], "to_source_id": None,
                "status": "unmapped", "reasons": ["No replacement source ID is selected"],
                "body_changed": False, "companions_changed": False,
                "semantic_metadata_changed": False, "lineage_metadata_changed": False,
                "changed_metadata_fields": [], "native_reader_layout_changed": False,
                "requires_native_rerun": False}
    body_changed = _body_fingerprint(old["body"]) != _body_fingerprint(new["body"])
    companions_changed = _companion_fingerprints(old) != _companion_fingerprints(new)
    fields = _different_fields(_metadata(old), _metadata(new))
    body_layout_changed = _native_view_name(old["body"]) != _native_view_name(new["body"])
    companion_layout_changed = sorted(_native_view_name(item) for item in old.get("companions", [])) != sorted(_native_view_name(item) for item in new.get("companions", []))
    if body_layout_changed:
        fields.append("native_reader_layout.body")
    semantic_fields = [path for path in fields if _semantic(path)]
    lineage_fields = [path for path in fields if not _semantic(path)]
    reasons = []
    if body_changed:
        reasons.append("Retained source body bytes changed")
    if companions_changed:
        reasons.append("Companion file contents or filenames changed")
    if semantic_fields:
        reasons.append("Computational metadata changed: " + ", ".join(semantic_fields))
    if lineage_fields:
        reasons.append("Source attribution or edition metadata changed: " + ", ".join(lineage_fields))
    if old["id"] != new["id"]:
        reasons.append("Source ID explicitly remapped")
    physical = body_changed or companions_changed or bool(semantic_fields)
    status = ("content_changed" if body_changed or companions_changed else
              "semantics_changed" if semantic_fields else
              "metadata_changed" if lineage_fields else
              "remapped" if old["id"] != new["id"] else "unchanged")
    return {"from_source_id": old["id"], "to_source_id": new["id"],
            "status": status, "reasons": reasons, "body_changed": body_changed,
            "companions_changed": companions_changed,
            "semantic_metadata_changed": bool(semantic_fields),
            "lineage_metadata_changed": bool(lineage_fields),
            "changed_metadata_fields": fields,
            "native_reader_layout_changed": body_layout_changed or companion_layout_changed,
            "requires_native_rerun": physical,
            "from_fingerprint": {"body": _body_fingerprint(old["body"]),
                                 "body_native_view_path": _native_view_name(old["body"]),
                                 "companions": _companion_fingerprints(old)},
            "to_fingerprint": {"body": _body_fingerprint(new["body"]),
                               "body_native_view_path": _native_view_name(new["body"]),
                               "companions": _companion_fingerprints(new)}}


def _references(kind: str, row: Mapping[str, Any]) -> List[str]:
    if kind == "profiles":
        refs = [row.get("biophysical_source_id")]
    elif kind == "scenarios":
        refs = [patch.get("mask_source_id") for patch in row.get("patches", [])]
    elif kind == "grids":
        spec = row["spec"]
        refs = list((spec.get("input_sources") or {}).values())
        refs += [(spec.get(name) or {}).get("source_id")
                 for name in ("reporting_area", "model_domain")]
    else:
        raise ValueError("Unsupported refresh dependency kind: " + kind)
    return sorted({str(ref) for ref in refs if ref is not None and str(ref)})


def _problem(code: str, message: str, **context: Any) -> Dict[str, Any]:
    return {"code": code, "message": message, **context}


def preview(workspace: Any, selection: Mapping[str, Any]) -> Dict[str, Any]:
    """Compare immutable editions and capture their current downstream dependencies.

    Same source IDs match automatically. Every renamed source requires an
    explicit source_id_map entry. No source is matched by title, role or position.
    Native impact always covers each affected full model domain.
    """
    selected = _selection(selection)
    old_collection = workspace._get("sources", selected["from_collection_id"])
    new_collection = workspace._get("sources", selected["to_collection_id"])
    old_entries, new_entries = _entry_index(old_collection), _entry_index(new_collection)
    explicit = selected["source_id_map"]
    for old, new in explicit.items():
        if old not in old_entries:
            raise ValueError("Mapped original source ID is not in the original collection: " + old)
        if new is not None and new not in new_entries:
            raise ValueError("Mapped replacement source ID is not in the replacement collection: " + new)
    resolved = {}
    for key in old_entries:
        target = explicit.get(key, key)
        if target in new_entries:
            resolved[key] = target
    changes = [_change(old_entries[key], new_entries.get(resolved.get(key)))
               for key in sorted(old_entries)]
    matched = set(resolved.values())
    for key in sorted(set(new_entries) - matched):
        changes.append({"from_source_id": None, "to_source_id": key,
                        "status": "added", "reasons": ["New source has no original dependency"],
                        "body_changed": False, "companions_changed": False,
                        "semantic_metadata_changed": False, "lineage_metadata_changed": False,
                        "changed_metadata_fields": [], "native_reader_layout_changed": False,
                        "requires_native_rerun": False})
    by_source = {row["from_source_id"]: row for row in changes if row["from_source_id"] is not None}
    affected = {kind: [] for kind in KINDS}
    snapshots = {kind: [] for kind in KINDS}
    problems = []
    warnings = []
    current = workspace.overview()
    for kind in ("profiles", "scenarios", "grids"):
        for raw in _sorted_rows(current.get(kind, [])):
            spec = raw.get("spec", {}) if kind == "grids" else raw
            if spec.get("source_collection_id") != selected["from_collection_id"]:
                continue
            try:
                row = (workspace.get_grid(raw["id"]) if kind == "grids"
                       else workspace._get(kind, raw["id"]))
            except Exception as exc:
                problems.append(_problem("unreadable_dependency",
                    "Cannot inspect retained dependency: " + str(exc), kind=kind, id=raw.get("id")))
                continue
            refs = _references(kind, row)
            for ref in refs:
                if ref not in old_entries:
                    problems.append(_problem("missing_original_source",
                        "Dependency refers to a source absent from its original collection",
                        kind=kind, id=row["id"], source_id=ref))
                elif ref not in resolved:
                    problems.append(_problem("missing_source_mapping",
                        "Choose a replacement ID in source_id_map for required source " + ref,
                        kind=kind, id=row["id"], source_id=ref))
                elif old_entries[ref].get("kind") != new_entries[resolved[ref]].get("kind"):
                    problems.append(_problem("source_kind_changed",
                        "Replacement source kind differs from the required original source kind",
                        kind=kind, id=row["id"], source_id=ref))
            changed = [ref for ref in refs if ref in by_source
                       and by_source[ref]["status"] != "unchanged"]
            physical = [ref for ref in refs if ref in by_source
                        and by_source[ref]["requires_native_rerun"]]
            reasons = []
            if physical:
                reasons.append("Full model domain must be recomputed after input changes: " +
                               ", ".join(physical))
            else:
                reasons.append("Rebind retained selection to the replacement source collection")
            affected[kind].append({"id": row["id"], "source_ids": refs,
                                   "changed_source_ids": changed,
                                   "physical_source_ids": physical,
                                   "requires_native_rerun": bool(physical), "reasons": reasons})
            if kind == "grids":
                snapshots[kind].append({"id": row["id"], "spec": deepcopy(row["spec"]),
                                        "grid": deepcopy(row["grid"])})
            else:
                snapshots[kind].append(deepcopy(row))
    affected_indexes = {kind: {row["id"]: row for row in affected[kind]}
                        for kind in ("profiles", "scenarios", "grids")}
    for raw in _sorted_rows(current.get("runs", [])):
        selection_row = raw.get("selection") or {}
        dependencies = {kind: selection_row.get(kind[:-1] + "_id")
                        for kind in ("profiles", "scenarios", "grids")}
        changed_dependencies = {kind: key for kind, key in dependencies.items()
                                if key in affected_indexes[kind]}
        if not changed_dependencies:
            continue
        try:
            run = workspace.inspect_run(raw["id"])
        except Exception as exc:
            problems.append(_problem("unreadable_dependency",
                "Cannot inspect retained run selection: " + str(exc), kind="runs", id=raw.get("id")))
            continue
        physical = any(affected_indexes[kind][key]["requires_native_rerun"]
                       for kind, key in changed_dependencies.items())
        reasons = (["Full native run required for changed source-dependent selections"]
                   if physical else ["Rebind run selection; physical source inputs are unchanged"])
        affected["runs"].append({"id": run["id"], "selection": deepcopy(run["selection"]),
                                  "dependency_ids": changed_dependencies,
                                  "requires_native_rerun": physical, "reasons": reasons})
        snapshots["runs"].append({"id": run["id"], "selection": deepcopy(run["selection"])})
    if not any(affected[kind] for kind in KINDS):
        warnings.append("No saved profiles, scenarios, grids or runs depend on the original collection.")
    inverse = {}
    for old, new in resolved.items():
        inverse.setdefault(new, []).append(old)
    for new, originals in sorted(inverse.items()):
        if len(originals) > 1:
            warnings.append("Explicit mappings consolidate original sources " +
                            ", ".join(sorted(originals)) + " into " + new + ".")
    if any(row["requires_native_rerun"] for row in affected["runs"]):
        warnings.append("NDR/SDR recomputation uses the complete retained model domain; no isolated-HUC shortcut is used.")
    summary = {
        "original_source_count": len(old_entries),
        "replacement_source_count": len(new_entries),
        "unchanged_count": sum(row["status"] == "unchanged" for row in changes),
        "added_count": sum(row["status"] == "added" for row in changes),
        "unmapped_count": sum(row["status"] == "unmapped" for row in changes),
        "content_changed_count": sum(row["body_changed"] or row["companions_changed"] for row in changes),
        "semantic_metadata_changed_count": sum(row["semantic_metadata_changed"] for row in changes),
        "native_reader_layout_changed_count": sum(row["native_reader_layout_changed"] for row in changes),
        "lineage_metadata_changed_count": sum(row["lineage_metadata_changed"] for row in changes),
        "affected_profile_count": len(affected["profiles"]),
        "affected_scenario_count": len(affected["scenarios"]),
        "affected_grid_count": len(affected["grids"]),
        "affected_run_count": len(affected["runs"]),
        "native_rerun_count": sum(row["requires_native_rerun"] for row in affected["runs"]),
        "problem_count": len(problems),
    }
    return {"schema": PREVIEW_SCHEMA, "title": selected["title"], "selection": selected,
            "resolved_source_id_map": dict(sorted(resolved.items())),
            "from_collection": {"id": old_collection["id"], "title": old_collection.get("title", "")},
            "to_collection": {"id": new_collection["id"], "title": new_collection.get("title", "")},
            "changes": changes, "affected": affected, "summary": summary,
            "problems": problems, "warnings": warnings, "snapshots": snapshots,
            "fingerprint_scope": "Retained manifest body and companion SHA-256 fingerprints",
            "recompute_scope": "Complete retained native model domain for every physically affected run"}


def save_plan(workspace: Any, selection: Mapping[str, Any]) -> Dict[str, Any]:
    """Save one immutable dependency snapshot; identical requests deduplicate."""
    report = preview(workspace, selection)
    return workspace._save(PLAN_KIND, {"title": report["title"],
        "selection": report["selection"], "preview": report})


def _state_path(workspace: Any, plan_id: str) -> Path:
    return workspace.root / "source-refresh" / identifier(plan_id) / "state.json"


def _read_state(workspace: Any, plan_id: str) -> Dict[str, Any] | None:
    path = _state_path(workspace, plan_id)
    if not path.exists():
        return None
    state = read_json(path)
    if state.get("schema") != STATE_SCHEMA or state.get("plan_id") != plan_id:
        raise ValueError("Refresh state does not match the retained plan")
    return state


def get_plan(workspace: Any, plan_id: str) -> Dict[str, Any]:
    plan = workspace._get(PLAN_KIND, identifier(plan_id))
    return {**plan, "state": _read_state(workspace, plan["id"])}


def list_plans(workspace: Any) -> List[Dict[str, Any]]:
    results = []
    for plan in workspace._list(PLAN_KIND):
        state = _read_state(workspace, plan["id"])
        report = plan["preview"]
        results.append({"id": plan["id"], "title": plan["title"],
            "from_collection_id": plan["selection"]["from_collection_id"],
            "to_collection_id": plan["selection"]["to_collection_id"],
            "summary": report["summary"], "problem_count": len(report["problems"]),
            "state": state.get("state") if state else "planned",
            "phase": state.get("phase") if state else None,
            "updated_at": state.get("updated_at") if state else None})
    return sorted(results, key=lambda row: (str(row.get("updated_at") or ""), row["id"]), reverse=True)


def _check_snapshot(workspace: Any, plan: Mapping[str, Any]) -> None:
    report = plan["preview"]
    if report.get("schema") != PREVIEW_SCHEMA:
        raise ValueError("Unsupported retained source-refresh preview schema")
    if report["selection"] != plan["selection"]:
        raise ValueError("Retained refresh selection and preview disagree")
    if report.get("problems"):
        messages = "; ".join(problem["message"] for problem in report["problems"])
        raise ValueError("Refresh plan has unresolved input mappings or dependencies: " + messages)
    # These lookups verify the immutable collection and selection digests.
    for key in ("from_collection_id", "to_collection_id"):
        workspace._get("sources", plan["selection"][key])
    for kind in ("profiles", "scenarios"):
        for expected in report["snapshots"][kind]:
            if workspace._get(kind, expected["id"]) != expected:
                raise ValueError("Retained " + kind + " dependency changed: " + expected["id"])
    for expected in report["snapshots"]["grids"]:
        actual = workspace.get_grid(expected["id"])
        if actual["spec"] != expected["spec"] or actual["grid"] != expected["grid"]:
            raise ValueError("Retained grid dependency changed: " + expected["id"])
    for expected in report["snapshots"]["runs"]:
        if workspace.inspect_run(expected["id"])["selection"] != expected["selection"]:
            raise ValueError("Retained run selection changed: " + expected["id"])


def _remapped(kind: str, original: Mapping[str, Any], report: Mapping[str, Any]) -> Dict[str, Any]:
    mapping = report["resolved_source_id_map"]
    target_collection = report["selection"]["to_collection_id"]
    if kind == "grids":
        value = deepcopy(original["spec"])
        value["source_collection_id"] = target_collection
        value["input_sources"] = {key: mapping[source_id]
                                  for key, source_id in value["input_sources"].items()}
        for key in ("reporting_area", "model_domain"):
            value[key]["source_id"] = mapping[value[key]["source_id"]]
        return value
    value = _clean(original)
    value["source_collection_id"] = target_collection
    if kind == "profiles":
        value["biophysical_source_id"] = mapping[value["biophysical_source_id"]]
        # Workspace recalculates the replacement table summary from retained bytes.
        value.pop("table_summary", None)
    elif kind == "scenarios":
        for patch in value.get("patches", []):
            patch["mask_source_id"] = mapping[patch["mask_source_id"]]
    else:
        raise ValueError("Cannot remap dependency kind: " + kind)
    return value


def _expected_fields(actual: Mapping[str, Any], expected: Mapping[str, Any]) -> bool:
    return all(key in actual and actual[key] == value for key, value in expected.items())


def _checkpoint(workspace: Any, state: Dict[str, Any], phase: str | None = None) -> None:
    if phase:
        state["phase"] = phase
    state["updated_at"] = now()
    atomic_json(_state_path(workspace, state["plan_id"]), state)


def _new_state(plan: Mapping[str, Any]) -> Dict[str, Any]:
    timestamp = now()
    return {"schema": STATE_SCHEMA, "plan_id": plan["id"], "state": "applying",
            "phase": "profiles", "mappings": {kind: {} for kind in KINDS},
            "run_ids": [], "run_results": {}, "comparisons": [],
            "comparison_results": {}, "errors": [], "history": [],
            "created_at": timestamp, "updated_at": timestamp}


def _error(state: Dict[str, Any], phase: str, exc: Exception, **context: Any) -> None:
    row = {"phase": phase, "error_type": type(exc).__name__,
           "message": str(exc), **context}
    state["errors"].append(row)
    state["history"].append({"at": now(), "event": "error", **row})


def _load_created(workspace: Any, kind: str, key: str) -> Dict[str, Any]:
    if kind == "grids":
        return workspace.get_grid(key)
    if kind == "runs":
        return workspace.inspect_run(key)
    return workspace._get(kind, key)


def _apply_dependencies(workspace: Any, plan: Mapping[str, Any], state: Dict[str, Any]) -> None:
    report = plan["preview"]
    for kind in ("profiles", "scenarios", "grids"):
        _checkpoint(workspace, state, kind)
        for original in report["snapshots"][kind]:
            original_id = original["id"]
            payload = _remapped(kind, original, report)
            existing_id = state["mappings"][kind].get(original_id)
            saved = None
            if existing_id:
                try:
                    saved = _load_created(workspace, kind, existing_id)
                except FileNotFoundError:
                    saved = None
                if saved is not None:
                    actual = saved["spec"] if kind == "grids" else _clean(saved)
                    if not _expected_fields(actual, payload):
                        raise ValueError("Retained refresh output no longer matches plan: " + existing_id)
            if saved is None:
                if kind == "profiles":
                    saved = workspace.save_profile(payload)
                elif kind == "scenarios":
                    saved = workspace.save_scenario(payload)
                else:
                    saved = workspace.prepare_grid(payload)
                if existing_id and saved["id"] != existing_id:
                    raise ValueError("Recreated refresh output identity changed: " + original_id)
                state["mappings"][kind][original_id] = saved["id"]
                state["history"].append({"at": now(), "event": "dependency_saved",
                    "kind": kind, "from_id": original_id, "to_id": saved["id"]})
                _checkpoint(workspace, state)
    _checkpoint(workspace, state, "runs")
    impacts = {row["id"]: row for row in report["affected"]["runs"]}
    for original in report["snapshots"]["runs"]:
        original_id = original["id"]
        payload = {}
        for kind in ("grids", "profiles", "scenarios"):
            field = kind[:-1] + "_id"
            old_id = original["selection"][field]
            payload[field] = state["mappings"][kind].get(old_id, old_id)
        if "models" in original["selection"]:
            payload["models"] = deepcopy(original["selection"]["models"])
        existing_id = state["mappings"]["runs"].get(original_id)
        saved = None
        if existing_id:
            try:
                saved = workspace.inspect_run(existing_id)
            except FileNotFoundError:
                saved = None
            if saved is not None and not _expected_fields(saved["selection"], payload):
                raise ValueError("Retained refreshed run no longer matches plan: " + existing_id)
        if saved is None:
            saved = workspace.prepare_run(payload)
            if not _expected_fields(saved["selection"], payload):
                raise ValueError("Refreshed run did not preserve the requested selection or selected models")
            if existing_id and saved["id"] != existing_id:
                raise ValueError("Recreated refreshed run identity changed: " + original_id)
            state["mappings"]["runs"][original_id] = saved["id"]
            state["history"].append({"at": now(), "event": "run_prepared",
                "from_id": original_id, "to_id": saved["id"]})
        state["run_results"][original_id] = {
            "from_run_id": original_id, "to_run_id": saved["id"],
            "requires_native_rerun": impacts[original_id]["requires_native_rerun"],
            "state": saved.get("state", "prepared")}
        if saved.get("state") == "complete":
            state["run_results"][original_id].update(
                _completed_run_receipt(workspace, saved["id"], "complete"))
        state["run_ids"] = sorted(set(state["mappings"]["runs"].values()))
        _checkpoint(workspace, state)



class ComparisonIncompatible(ValueError):
    """A source refresh changed the spatial or scientific comparison support."""


def _grid_signature(grid):
    from rasterio.crs import CRS
    definition = grid["grid"]
    required = ("crs", "transform", "width", "height", "resolution_m")
    missing = [key for key in required if key not in definition]
    if missing:
        raise ComparisonIncompatible("Retained grid definition is missing " + ", ".join(missing))
    transform = tuple(float(value) for value in definition["transform"])
    if len(transform) not in (6, 9):
        raise ComparisonIncompatible("Retained grid transform has an unsupported shape")
    return (CRS.from_user_input(definition["crs"]), transform[:6],
            int(definition["width"]), int(definition["height"]),
            float(definition["resolution_m"]))


def _actual_grid(dataset, signature, label):
    if (dataset.crs != signature[0] or tuple(dataset.transform)[:6] != signature[1]
            or dataset.width != signature[2] or dataset.height != signature[3]
            or dataset.count != 1):
        raise ComparisonIncompatible(label + " does not match its retained spatial grid definition")


def _grid_support_file(workspace, grid, name):
    descriptor = grid["files"].get(name)
    if descriptor is None:
        suffix = ".tif" if name == "reporting_mask" else ".gpkg"
        descriptor = grid["files"].get(name + suffix)
    if descriptor is None:
        raise ComparisonIncompatible("Retained grid has no " + name + " support artifact")
    return verify_file(workspace.root / "grids" / grid["id"], descriptor), descriptor


def _equal_reporting_partitions(rasters, original_rows, replacement_rows):
    if len(original_rows) != len(replacement_rows):
        return False
    candidates = {}
    for row in replacement_rows:
        geometry = rasters.polygon_union([row])
        candidates.setdefault(tuple(geometry.bounds), []).append(geometry)
    for row in original_rows:
        geometry = rasters.polygon_union([row])
        bucket = candidates.get(tuple(geometry.bounds), [])
        for index, candidate in enumerate(bucket):
            if geometry.equals(candidate):
                bucket.pop(index)
                break
        else:
            return False
    return True


def _compare_refreshed_runs(workspace, plan, baseline, alternative):
    """Retain a real raster comparison across source-edition grid identities.

    The stock comparison is retained for its supported complete same-grid case.
    The additive path also supports matching partial NDR/SDR artifact sets, but
    requires identical spatial definitions, domain/reporting geometry, reporting
    mask cells and output units. Source-edition NoData differences are quantified
    and the raster delta uses their common finite support.
    """
    from . import rasters
    from .native_versions import comparison_versions, models_for_outputs
    import numpy as np
    import rasterio

    names = sorted(set(baseline.get("artifacts", {})) & set(rasters.MASS_UNITS))
    alternative_names = sorted(set(alternative.get("artifacts", {})) & set(rasters.MASS_UNITS))
    if not names or names != alternative_names:
        raise ComparisonIncompatible("Original and refreshed runs need the same nonempty set of native mass outputs")
    try:
        native_versions = comparison_versions(
            [baseline, alternative], models_for_outputs(names))
    except ValueError as error:
        raise ComparisonIncompatible(str(error)) from error
    for name in names:
        units = rasters.MASS_UNITS[name]
        if (baseline["artifacts"][name].get("units") != units
                or alternative["artifacts"][name].get("units") != units):
            raise ComparisonIncompatible("Original and refreshed " + name + " units must both be " + units)
    ids = [baseline["id"], alternative["id"]]
    original_grid = workspace.get_grid(baseline["selection"]["grid_id"])
    replacement_grid = workspace.get_grid(alternative["selection"]["grid_id"])
    if original_grid["id"] == replacement_grid["id"] and names == sorted(rasters.MASS_UNITS):
        return workspace.compare_runs(ids)

    original_signature = _grid_signature(original_grid)
    replacement_signature = _grid_signature(replacement_grid)
    if original_signature != replacement_signature:
        raise ComparisonIncompatible(
            "Source refresh changed CRS, transform, dimensions or resolution; choose an explicit common spatial domain before comparison")

    support = {}
    support_fingerprints = {}
    for edition, grid in (("original", original_grid), ("replacement", replacement_grid)):
        support[edition] = {}
        support_fingerprints[edition] = {}
        for name in ("model_domain", "reporting_area", "reporting_mask"):
            path, descriptor = _grid_support_file(workspace, grid, name)
            support[edition][name] = path
            support_fingerprints[edition][name] = {
                "sha256": descriptor["sha256"], "bytes": descriptor.get("bytes")}
    paths = {}
    output_fingerprints = {}
    for edition, run in (("original", baseline), ("replacement", alternative)):
        paths[edition] = {}
        output_fingerprints[edition] = {}
        for name in names:
            descriptor = run["artifacts"][name]
            paths[edition][name] = verify_file(workspace.root / "runs" / run["id"], descriptor)
            output_fingerprints[edition][name] = {
                "sha256": descriptor["sha256"], "bytes": descriptor.get("bytes"),
                "units": descriptor["units"]}
    context = {
        "schema": "upstate.source-refresh-comparison-context/v1",
        "from_collection_id": plan["selection"]["from_collection_id"],
        "to_collection_id": plan["selection"]["to_collection_id"],
        "baseline_grid_id": original_grid["id"],
        "alternative_grid_id": replacement_grid["id"],
        "native_artifacts": names,
        "native_version_provenance": native_versions,
        "baseline_models": baseline["selection"].get("models"),
        "alternative_models": alternative["selection"].get("models"),
        "grid_support_fingerprints": support_fingerprints,
        "native_output_fingerprints": output_fingerprints,
        "comparison_scope": "Identical model domain, reporting partitions and reporting mask; alternative minus baseline on common finite output cells with explicit excluded coverage",
    }
    key = digest({"runs": ids, "direction": "alternative minus baseline",
                  "source_refresh_scope": "common-finite-support/v2",
                  "native_version_provenance": native_versions})
    directory = workspace.root / "comparisons" / key
    with held(directory / ".comparison.lock", blocking=False):
        retained_path = directory / "comparison.json"
        if retained_path.exists():
            retained = read_json(retained_path)
            # The original coverage loop used the comparison variable for its
            # final count name. Recover only that exact predecessor after the
            # normal reader verifies every original context/output descriptor.
            if retained.get("id") == "neither_valid_cells":
                from .source_refresh_comparison import validate
                from .reuse import copy_verified
                repaired = {**retained, "id": key}
                validate(workspace, repaired, expected_id=key)
                if repaired.get("source_refresh_context") != context:
                    raise ValueError("The retained predecessor belongs to another source update")
                original_descriptor = describe_file(directory, retained_path)
                copy_verified(directory, original_descriptor, directory,
                              path="history/coverage-key-predecessor-" +
                                   original_descriptor["sha256"] + ".json")
                atomic_json(retained_path, repaired)
                retained = repaired
            alternatives = retained.get("alternatives") or []
            if (retained.get("schema") != "upstate.run-comparison/v1"
                    or retained.get("id") != key
                    or retained.get("baseline_run_id") != ids[0]
                    or len(alternatives) != 1 or alternatives[0].get("run_id") != ids[1]
                    or retained.get("source_refresh_context") != context
                    or sorted(alternatives[0].get("artifacts", {})) != names):
                raise ValueError("Retained source-refresh comparison no longer matches its source selections")
            for descriptor in alternatives[0]["artifacts"].values():
                verify_file(directory, descriptor)
            return retained

        for name in ("model_domain", "reporting_area"):
            before_rows, _ = rasters.vector_geometry(
                support["original"][name], layer=name, target_crs=original_grid["grid"]["crs"])
            after_rows, _ = rasters.vector_geometry(
                support["replacement"][name], layer=name, target_crs=original_grid["grid"]["crs"])
            if not rasters.polygon_union(before_rows).equals(rasters.polygon_union(after_rows)):
                raise ComparisonIncompatible(
                    "Source refresh changed the " + name + " geometry; select a deliberate common support before comparison")
            if name == "reporting_area" and not _equal_reporting_partitions(rasters, before_rows, after_rows):
                raise ComparisonIncompatible(
                    "Source refresh changed reporting-area partitions; reconcile those spatial units before comparison")
        reporting_cells = 0
        with rasterio.open(support["original"]["reporting_mask"]) as a, rasterio.open(support["replacement"]["reporting_mask"]) as b:
            rasters.check_same_grid(a, b)
            _actual_grid(a, original_signature, "Original reporting mask")
            _actual_grid(b, replacement_signature, "Refreshed reporting mask")
            for _, window in a.block_windows(1):
                left = a.read(1, window=window, masked=True)
                right = b.read(1, window=window, masked=True)
                left_valid = (~np.ma.getmaskarray(left)) & (np.asarray(left.data) != 0)
                right_valid = (~np.ma.getmaskarray(right)) & (np.asarray(right.data) != 0)
                if not np.array_equal(left_valid, right_valid):
                    raise ComparisonIncompatible("Original and refreshed reporting masks select different cells")
                reporting_cells += int(np.count_nonzero(left_valid))
        if not reporting_cells:
            raise ComparisonIncompatible("The retained reporting mask contains no valid selected cells")

        transform = original_signature[1]
        coordinate_pixel_area = abs(transform[0] * transform[4] - transform[1] * transform[3])
        if not original_signature[0].is_projected:
            raise ComparisonIncompatible("Native comparison requires a projected grid to report actual constant pixel area")
        coordinate_unit, metres_per_unit = original_signature[0].linear_units_factor
        pixel_area_m2 = coordinate_pixel_area * float(metres_per_unit) ** 2
        if not np.isfinite(pixel_area_m2) or pixel_area_m2 <= 0:
            raise ComparisonIncompatible("Native comparison grid has no positive finite pixel area")
        checks = {"domain_union_equal": True, "reporting_partitions_equal": True,
                  "reporting_mask_cells": reporting_cells, "pixel_area_m2": pixel_area_m2,
                  "coordinate_linear_unit": coordinate_unit,
                  "native_valid_cells": {}, "native_coverage": {}}
        for name in names:
            coverage = {"scope": "Entire aligned native output raster",
                        "common_valid_cells": 0, "baseline_only_cells": 0,
                        "alternative_only_cells": 0, "neither_valid_cells": 0,
                        "baseline_only_mass": 0.0, "alternative_only_mass": 0.0,
                        "summed_mass_units": rasters.MASS_UNITS[name].replace("/pixel", ""),
                        "pixel_area_m2": pixel_area_m2}
            with rasterio.open(paths["original"][name]) as a, rasterio.open(paths["replacement"][name]) as b:
                rasters.check_same_grid(a, b)
                _actual_grid(a, original_signature, "Original " + name)
                _actual_grid(b, replacement_signature, "Refreshed " + name)
                for _, window in a.block_windows(1):
                    left = a.read(1, window=window, masked=True)
                    right = b.read(1, window=window, masked=True)
                    left_data, right_data = np.asarray(left.data), np.asarray(right.data)
                    left_valid = (~np.ma.getmaskarray(left)) & np.isfinite(left_data)
                    right_valid = (~np.ma.getmaskarray(right)) & np.isfinite(right_data)
                    common = left_valid & right_valid
                    baseline_only, alternative_only = left_valid & ~right_valid, right_valid & ~left_valid
                    neither = ~(left_valid | right_valid)
                    for coverage_key, mask in (("common_valid_cells", common),
                                      ("baseline_only_cells", baseline_only),
                                      ("alternative_only_cells", alternative_only),
                                      ("neither_valid_cells", neither)):
                        coverage[coverage_key] += int(np.count_nonzero(mask))
                    coverage["baseline_only_mass"] += float(np.sum(left_data[baseline_only], dtype=np.float64))
                    coverage["alternative_only_mass"] += float(np.sum(right_data[alternative_only], dtype=np.float64))
            if not coverage["common_valid_cells"]:
                raise ComparisonIncompatible("No common finite comparable cells exist for " + name)
            coverage["areas_m2"] = {
                key.removesuffix("_cells"): coverage[key] * pixel_area_m2
                for key in ("common_valid_cells", "baseline_only_cells",
                            "alternative_only_cells", "neither_valid_cells")}
            checks["native_valid_cells"][name] = coverage["common_valid_cells"]
            checks["native_coverage"][name] = coverage
        result = {"schema": "upstate.run-comparison/v1", "id": key,
                  "baseline_run_id": ids[0], "direction": "alternative minus baseline",
                  "native_version_provenance": native_versions,
                  "source_refresh_context": context, "spatial_support": checks, "alternatives": []}
        value = {"run_id": alternative["id"], "selection": deepcopy(alternative["selection"]),
                 "profile_changed": alternative["selection"]["profile_id"] != baseline["selection"]["profile_id"],
                 "artifacts": {}}
        for name in names:
            path = directory / (alternative["id"] + "-" + name + ".tif")
            summary = rasters.difference(paths["original"][name], paths["replacement"][name], path)
            if int(summary.get("valid_cells", -1)) != checks["native_valid_cells"][name]:
                raise ValueError("Native difference support changed during comparison for " + name)
            value["artifacts"][name] = describe_file(directory, path,
                                                    units=rasters.MASS_UNITS[name],
                                                    coverage=checks["native_coverage"][name], **summary)
        result["alternatives"].append(value)
        atomic_json(retained_path, result)
        return result


def _completed_run_receipt(workspace: Any, target_id: str, previous_state: str) -> Dict[str, Any]:
    """Describe actual native stages and exports after the original run completes."""
    from .model_selection import run_models
    current = workspace.inspect_run(target_id)
    if current.get("state") != "complete":
        raise RuntimeError("Refreshed native run has not completed; retained state is " +
                           str(current.get("state")))
    models = {}
    for model in run_models(current):
        stage = current["stages"][model]
        reused = stage.get("reused_from")
        models[model] = {
            "mode": "reused" if isinstance(reused, Mapping) else "native",
            "source_run_id": reused.get("run_id") if isinstance(reused, Mapping) else None,
            "stage_completed_at": stage.get("completed_at"),
            "input_signature_id": (stage.get("input_signature") or {}).get("id"),
        }
    reused_count = sum(row["mode"] == "reused" for row in models.values())
    execution = ("already_complete" if previous_state == "complete" else
                 "reused" if reused_count == len(models) else
                 "mixed" if reused_count else "complete")
    return {"state": "complete", "execution": execution, "model_results": models,
            "reused_model_count": reused_count, "selected_model_count": len(models),
            "artifacts": deepcopy(current["artifacts"]),
            "completed_at": current.get("completed_at")}


def _execute_and_compare(workspace: Any, plan: Mapping[str, Any], state: Dict[str, Any]) -> None:
    _checkpoint(workspace, state, "native")
    from .native_execution import process_interrupted, storage_exhausted
    completed = {}
    for original_id, target_id in sorted(state["mappings"]["runs"].items()):
        try:
            current = workspace.inspect_run(target_id)
            previous_state = current.get("state", "prepared")
            if target_id not in completed:
                original = workspace.inspect_run(original_id)
                candidates = ([original_id] if original.get("state") == "complete"
                              and original_id != target_id else [])
                state["run_results"][original_id].update(
                    execution="running", reuse_source_run_ids=candidates)
                _checkpoint(workspace, state)
                # Every explicitly requested successor must become an ordinary
                # completed run. Reuse eligibility belongs to the maintained
                # native input matcher, not to manifest metadata classifications.
                workspace.run(target_id, reuse_source_run_ids=candidates)
                completed[target_id] = _completed_run_receipt(workspace, target_id, previous_state)
            state["run_results"][original_id].update(deepcopy(completed[target_id]))
        except Exception as exc:
            interrupted = process_interrupted(exc)
            state["run_results"][original_id].update({
                "state": "interrupted" if interrupted else "failed",
                "execution": "interrupted" if interrupted else "failed",
            })
            _error(state, "native", exc, from_run_id=original_id, to_run_id=target_id)
            _checkpoint(workspace, state)
            # A confirmed native process interruption or full disk stops this
            # original coordinator; completed independent branches stay saved.
            if interrupted or storage_exhausted(exc):
                raise
        _checkpoint(workspace, state)
    _checkpoint(workspace, state, "comparisons")
    for original_id, target_id in sorted(state["mappings"]["runs"].items()):
        row = {"from_run_id": original_id, "to_run_id": target_id}
        # A retained older delta remains an immutable Workspace object. Only
        # the current eligible result belongs in the active source-plan report.
        state["comparisons"] = [item for item in state["comparisons"]
                                if item["from_run_id"] != original_id]
        try:
            before = workspace.inspect_run(original_id)
            after = workspace.inspect_run(target_id)
            if before.get("state") != "complete" or after.get("state") != "complete":
                state["comparison_results"][original_id] = {
                    **row, "state": "pending",
                    "reason": "Both original and refreshed native runs must be complete"}
            else:
                result = _compare_refreshed_runs(workspace, plan, before, after)
                if not isinstance(result, Mapping) or not result.get("id"):
                    raise ValueError("Native comparison returned no retained comparison identity")
                completed = {**row, "state": "complete", "comparison_id": result["id"]}
                state["comparison_results"][original_id] = completed
                state["comparisons"] = [item for item in state["comparisons"]
                                        if item["from_run_id"] != original_id] + [completed]
        except ComparisonIncompatible as exc:
            state["comparison_results"][original_id] = {
                **row, "state": "incompatible", "reason": str(exc)}
        except Exception as exc:
            state["comparison_results"][original_id] = {
                **row, "state": "unavailable", "error_type": type(exc).__name__,
                "reason": str(exc)}
        _checkpoint(workspace, state)


def apply_plan(workspace: Any, plan_id: str, run_models: bool = False) -> Dict[str, Any]:
    """Resume an immutable plan, preserving every original source and model object.

    Checkpoints follow every saved dependency and run. run_models=True completes
    every prepared successor through the original native execution and reuse API.
    Per-model input equality determines reuse; metadata classifications describe
    source impact and never stand in for completed outputs. Independent failures
    remain visible; confirmed process interruption or storage exhaustion stops
    further work. Comparisons retain actual eligibility per original run.
    """
    if not isinstance(run_models, bool):
        raise ValueError("run_models must be a boolean")
    plan_id = identifier(plan_id)
    plan = workspace._get(PLAN_KIND, plan_id)
    lock_path = _state_path(workspace, plan_id).parent / ".refresh.lock"
    with held(lock_path, blocking=False):
        _check_snapshot(workspace, plan)
        state = _read_state(workspace, plan_id) or _new_state(plan)
        state["history"].append({"at": now(), "event": "apply_requested",
                                 "run_models": run_models})
        state["state"] = "applying"
        state["native_execution_requested"] = bool(state.get("native_execution_requested")) or run_models
        state["errors"] = []
        _checkpoint(workspace, state)
        try:
            _apply_dependencies(workspace, plan, state)
            if run_models:
                _execute_and_compare(workspace, plan, state)
            native_complete = all(row.get("state") == "complete"
                                  for row in state["run_results"].values())
            state["state"] = ("failed" if state["errors"] else
                              "complete" if state["native_execution_requested"] and native_complete
                              else "prepared")
            state["requested_native_execution"] = run_models
            _checkpoint(workspace, state, "done")
            return deepcopy(state)
        except Exception as exc:
            from .native_execution import process_interrupted
            _error(state, state.get("phase", "apply"), exc)
            state["state"] = "interrupted" if process_interrupted(exc) else "failed"
            _checkpoint(workspace, state)
            raise


from .source_refresh_compat import install_facade as _install_source_refresh_facade
_install_source_refresh_facade(globals())
