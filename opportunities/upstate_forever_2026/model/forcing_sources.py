"""Compose retained annual forcing sources for an unchanged native model grid.

Preview reads immutable source records and completed grid metadata only. Preparation
verifies the selected original files through Workspace, imports one ordinary source
manifest, and returns an original Workspace.prepare_grid spec. It does not execute
a grid, invent a rainfall field, change model parameters, or run a scientific model.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from .common import atomic_json, canonical, digest, identifier
from .model_selection import grid_models, required_roles

SCHEMA = "upstate.forcing-grid-sources/v1"
FORCING_ROLES = ("PRECIPITATION", "R_FACTOR")
R_UNITS = "MJ*mm/(ha*h*year)"


def _copy(value):
    return json.loads(canonical(value))


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Retain an explicit " + name)
    return value


def _selection(value):
    names = {"source_collection_id", "source_id", "period_label",
             "temporal_basis", "interpretation"}
    if not isinstance(value, dict) or set(value) != names:
        raise ValueError("A forcing choice needs its original collection/source, period label, "
                         "temporal basis and interpretation")
    return {
        "source_collection_id": identifier(value["source_collection_id"]),
        "source_id": _text(value["source_id"], "forcing source ID"),
        "period_label": _text(value["period_label"], "source-period label"),
        "temporal_basis": _text(value["temporal_basis"], "annual temporal basis"),
        "interpretation": _text(value["interpretation"], "annual forcing interpretation"),
    }


def _retained_entry(workspace, collection_id, source_id):
    collection = workspace._get("sources", identifier(collection_id))
    rows = [row for row in collection["entries"] if row["id"] == source_id]
    if len(rows) != 1:
        raise ValueError("Select an exact retained source in its original collection: " + source_id)
    return _copy(rows[0]), _copy(collection.get("original_manifest"))


def _native_identity(entry):
    """Match the existing grid_reuse identity, preserving native sidecar layout."""
    def body(value):
        return {"bytes": value["bytes"], "sha256": value["sha256"],
                "view_path": value.get("view_path", value["filename"])}
    return {
        "kind": entry["kind"], "body": body(entry["body"]),
        "companions": sorted((body(row) for row in entry.get("companions", [])),
                             key=lambda row: row["view_path"]),
        "layer": entry.get("layer"), "units": entry.get("units"),
        "conversion": entry.get("conversion"), "resampling": entry.get("resampling"),
    }


def _forcing_context(role, entry):
    if entry.get("kind") != "raster":
        raise ValueError(role + " needs a retained single-band scientific raster")
    declared_role = entry.get("role")
    allowed = {role}
    if role == "PRECIPITATION":
        allowed.add("RUNOFF_PROXY")
    if declared_role not in allowed:
        raise ValueError("Original source role differs from the selected forcing: " + role)
    native_units = _text(entry.get("units"), role + " source units")
    conversion = entry.get("conversion")
    effective_units = native_units
    if conversion is not None:
        if not isinstance(conversion, dict):
            raise ValueError("Keep the original explicit unit conversion")
        try:
            factor = float(conversion["factor"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("The retained forcing conversion needs a finite positive factor") from None
        if not math.isfinite(factor) or factor <= 0:
            raise ValueError("The retained forcing conversion needs a finite positive factor")
        _text(conversion.get("reference"), "unit-conversion source reference")
        effective_units = _text(conversion.get("target_units"), "converted forcing units")
    if role == "R_FACTOR" and effective_units != R_UNITS:
        raise ValueError("Rainfall erosivity requires " + R_UNITS + " after its declared conversion")
    if entry.get("resampling", "bilinear") not in {"bilinear", "average", "nearest"}:
        raise ValueError("A continuous forcing field needs bilinear, average or nearest resampling")
    return {
        "native_units": native_units, "effective_units": effective_units,
        "conversion": _copy(conversion), "vintage": _text(entry.get("vintage"), "source vintage"),
        "uri": _text(entry.get("uri"), "original source URI"),
        "source_resolution": _copy(entry.get("source_resolution")),
        "temporal_support": _copy(entry.get("temporal_support")),
        "source_period": _copy(entry.get("source_period")),
        "metadata": _copy(entry.get("metadata", {})),
        "native_grid": _copy(entry.get("native_grid")),
        "derived_from": _copy(entry.get("derived_from")),
        "lineage": _copy(entry.get("lineage")),
        "meaning": ("A source-period annual runoff-pattern sensitivity; NDR normalizes the "
                    "proxy using its selected native mean. This is not an event hydrograph "
                    "or an attributed climate trend."
                    if role == "PRECIPITATION" else
                    "An independent annual rainfall-erosivity input to SDR; precipitation "
                    "ratios are not used to invent rainfall erosivity."),
    }


def preview_grid_sources(workspace, base_grid_id, overrides):
    """Freeze original selections without source-view creation or raster hashing.

    Human period/interpretation fields are explicitly supplied annotations. They do
    not replace the separately retained publisher vintage/temporal support.
    """
    if (not isinstance(overrides, dict) or not overrides
            or set(overrides) - set(FORCING_ROLES)):
        raise ValueError("Select original PRECIPITATION and/or R_FACTOR source editions")
    base_grid_id = identifier(base_grid_id)
    base = workspace.get_grid(base_grid_id)
    spec = _copy(base["spec"])
    active = grid_models(base)
    roles = required_roles(active)
    inputs = spec.get("input_sources")
    if not isinstance(inputs, dict) or any(not inputs.get(role) for role in roles):
        raise ValueError("Retain the base grid's complete original input selections")
    if any(role not in roles for role in overrides):
        raise ValueError("Select a forcing role used by the base grid's native models")
    normalized = {role: _selection(overrides[role]) for role in FORCING_ROLES if role in overrides}
    source_records = {}
    def binding(collection_id, source_id):
        entry, manifest = _retained_entry(workspace, collection_id, source_id)
        original = {"source_collection_id": collection_id, "source_id": source_id}
        key = digest(original)
        row = {"selection": original, "entry": entry, "entry_sha256": digest(entry),
               "original_manifest": manifest,
               "prepared_source_id": "forcing-source-" + digest({
                   "selection": original, "entry": entry})[:32]}
        if key in source_records and source_records[key] != row:
            raise ValueError("An original forcing source changed during selection")
        source_records[key] = row
        return row
    baseline_collection = identifier(spec["source_collection_id"])
    baseline_inputs, selected_inputs, changed = {}, {}, []
    for role, source_id in sorted(inputs.items()):
        original = binding(baseline_collection, source_id)
        baseline_inputs[role] = original
        if role in normalized:
            selected = normalized[role]
            chosen = binding(selected["source_collection_id"], selected["source_id"])
            chosen = {**chosen, "annotation": _copy(selected),
                      "source_context": _forcing_context(role, chosen["entry"])}
            if digest(_native_identity(chosen["entry"])) != digest(_native_identity(original["entry"])):
                changed.append(role)
            selected_inputs[role] = chosen
        else:
            selected_inputs[role] = original
    if not changed:
        raise ValueError("The selected forcing has the same original scientific inputs as the base grid")
    geometry = {}
    for name in ("model_domain", "reporting_area"):
        selection = spec.get(name)
        if not isinstance(selection, dict) or not selection.get("source_id"):
            raise ValueError("Keep the base grid's exact " + name + " selection")
        geometry[name] = {**binding(baseline_collection, selection["source_id"]),
                          "geometry_selection": _copy(selection)}
    base_snapshot = {"id": base_grid_id, "spec": spec, "grid": _copy(base["grid"]),
                     "files": _copy(base["files"]), "inputs": _copy(base["inputs"])}
    bindings = {"baseline_inputs": baseline_inputs, "inputs": selected_inputs, **geometry}
    # The source list includes exact baseline forcing for interpretation but only
    # selected input/geometry entries are admitted to the composed grid collection.
    value = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "base_grid": base_snapshot, "models": list(active), "overrides": normalized,
        "changed_roles": changed,
        "unchanged_roles": [role for role in roles if role not in changed],
        "bindings": bindings,
        "preview_scope": "Immutable source records and grid metadata; native pixels are verified during preparation.",
    }
    return {**value, "id": digest(value)}


def _manifest_entry(workspace, binding):
    selected = binding["selection"]
    path, current = workspace.source_file(selected["source_collection_id"], selected["source_id"])
    if digest(current) != binding["entry_sha256"] or current != binding["entry"]:
        raise ValueError("The selected original source edition changed before preparation")
    root = workspace.root.resolve()
    view = root / "source-views" / selected["source_collection_id"] / digest(selected["source_id"])
    path = Path(path).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_relative_to(view.resolve()):
        raise ValueError("The original scientific source view escaped its Workspace")
    entry = _copy(current)
    body = entry.pop("body")
    companions = entry.pop("companions", [])
    entry.update(id=binding["prepared_source_id"], path=path.relative_to(root).as_posix(),
                 bytes=body["bytes"], sha256=body["sha256"])
    entry["companions"] = []
    for member in companions:
        member_path = view / member.get("view_path", member["filename"])
        if member_path.is_symlink() or not member_path.resolve(strict=True).is_relative_to(view.resolve()):
            raise ValueError("An original source companion escaped its native source view")
        entry["companions"].append({
            "path": member_path.relative_to(root).as_posix(),
            "bytes": member["bytes"], "sha256": member["sha256"]})
    entry["forcing_origin"] = {
        **_copy(selected), "entry_sha256": binding["entry_sha256"],
        "original_manifest": _copy(binding["original_manifest"]),
    }
    return entry


def prepare_grid_sources(workspace, base_grid_id, overrides, expected_id):
    """Verify originals and import a complete source edition; return native spec.

    Unchanged prepared rasters are reused by the maintained base_grid_id path.
    Changed forcing is aligned by Workspace.prepare_grid exactly once using the
    original conversion. The caller checks prepared finite/nonnegative values and
    scientific support before issuing the original native run.
    """
    selected = preview_grid_sources(workspace, base_grid_id, overrides)
    if selected["id"] != identifier(expected_id):
        raise ValueError("The reviewed forcing source selection changed; reopen its preview")
    wanted = [*selected["bindings"]["inputs"].values(),
              selected["bindings"]["model_domain"], selected["bindings"]["reporting_area"]]
    records, seen = [], set()
    for binding in wanted:
        alias = binding["prepared_source_id"]
        if alias in seen:
            continue
        seen.add(alias)
        records.append(_manifest_entry(workspace, binding))
    if preview_grid_sources(workspace, base_grid_id, overrides)["id"] != selected["id"]:
        raise ValueError("The original base grid/source records changed during preparation")
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Retained annual forcing source composition " + selected["id"][:16],
        "entries": records,
        "scope": {"schema": SCHEMA, "selection_id": selected["id"],
                  "project_id": workspace.project["id"], "base_grid_id": base_grid_id,
                  "changed_roles": selected["changed_roles"],
                  "bindings": _copy(selected["bindings"])},
        "notes": [
            "Every raster/vector and ordered companion comes from the selected immutable original source.",
            "Original source IDs remain in forcing_origin; composed aliases disambiguate separate collections.",
            "Native grid geometry, domain, reporting mask and all unselected input sources stay unchanged.",
            "Period labels are supplied interpretation alongside the unmodified publisher metadata.",
        ],
    }
    # The manifest is rooted at Workspace so all source-view paths remain
    # ordinary portable relative paths without '..'. import_sources retains its
    # complete body in the original content-addressed object store.
    manifest_path = workspace.root / ("forcing-sources-" + selected["id"] + ".json")
    atomic_json(manifest_path, manifest, immutable=True)
    collection = workspace.import_sources(manifest_path)
    spec = _copy(selected["base_grid"]["spec"])
    spec["source_collection_id"] = collection["id"]
    spec["base_grid_id"] = base_grid_id
    spec["input_sources"] = {
        role: binding["prepared_source_id"]
        for role, binding in selected["bindings"]["inputs"].items()}
    for name in ("model_domain", "reporting_area"):
        spec[name]["source_id"] = selected["bindings"][name]["prepared_source_id"]
    return {"schema": SCHEMA, "id": selected["id"], "identity": _copy(selected),
            "bindings": _copy(selected["bindings"]), "spec": spec,
            "source_collection_id": collection["id"]}
