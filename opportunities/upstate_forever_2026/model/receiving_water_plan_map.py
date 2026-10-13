"""Fit a Spatial review to exact retained Receiving plan geometries.

This read service uses the existing SpatialReview catalogue and verified vector
reader. It does not prepare plans, modify geometry, measure area differences or
run a native model. Original implementation: TokenJunkieLabs.
"""
from __future__ import annotations

from copy import deepcopy
import math

from .common import digest, identifier
from . import receiving_waters

SCHEMA = "upstate.receiving-water-plan-map/v1"
_ROLES = (
    ("contribution_geometry", "contribution", "Selected contribution area"),
    ("receptor_geometry", "receptor", "Original receiving-water feature"),
)


def _plan(workspace, key, expected):
    key, expected = identifier(key), identifier(expected)
    plan = receiving_waters.inspect_plan(workspace, key, verify=False)
    if plan.get("state") != "complete":
        raise ValueError("Choose a completed original receiving-water plan")
    if plan["record_sha256"] != expected:
        raise ValueError("The displayed receiving-water plan changed; reopen its comparison")
    return plan


def _subject(plan, subject_id):
    rows = [row for row in plan["receptors"] if row["id"] == subject_id]
    if len(rows) > 1:
        raise ValueError("The retained plan has duplicate receptor IDs")
    return rows[0] if rows else None


def _source_identity(source):
    if not isinstance(source, dict):
        return {}
    result = {key: deepcopy(source[key]) for key in (
        "source_collection_id", "source_id", "body_sha256", "body_bytes",
        "uri", "vintage", "title", "role",
    ) if key in source}
    if isinstance(source.get("selection"), dict):
        result["selection_sha256"] = digest(source["selection"])
    return result


def _header(plan, receptor):
    return {
        "id": plan["id"], "title": plan["title"],
        "record_sha256": plan["record_sha256"], "present": receptor is not None,
        "analysis_crs": plan["analysis_crs"],
        "analysis_crs_name": plan.get("analysis_crs_name"),
        "subject_title": receptor["title"] if receptor else None,
        "relationship_precision": receptor.get("relationship_precision") if receptor else None,
        "source_identities": [
            _source_identity(source)
            for source in plan["identity"].get("source_identities", [])
        ],
    }


def _layer(workspace, layers, plan, receptor, key, role):
    descriptor = receptor[key]
    matches = [record for record in layers.values() if (
        record["public"].get("group") == "receiving-water-plan"
        and record["public"].get("owner_id") == plan["id"]
        and record["public"].get("receiving_water_plan_id") == plan["id"]
        and record["public"].get("subject_id") == receptor["id"]
        and record["public"].get("geometry_role") == role
        and record["public"].get("statistic") == key
    )]
    if len(matches) != 1:
        raise ValueError("Reopen Spatial review after retaining the exact plan geometry catalogue")
    record = matches[0]
    public = record["public"]
    if (public.get("kind") != "vector"
            or public.get("native_layer") != "receiving_water"
            or public.get("sha256") != descriptor.get("sha256")
            or public.get("bytes") != descriptor.get("bytes")
            or record.get("source") is not None
            or record.get("file") != descriptor
            or record.get("scope") != workspace.root / "receiving-water-plans" / plan["id"]):
        raise ValueError("The Spatial layer does not match the exact retained plan geometry")
    # Use the original catalogue ID; never reconstruct its identity formula.
    return {"layer_id": public["id"], "layer": public["native_layer"], "where": {}}, record


def _extent(spatial, choice, record, expected_crs, target):
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform

    bounds, native_ids = [], []
    with spatial._vector(choice, record) as (source, native, layer):
        if layer != choice["layer"] or native != CRS.from_user_input(expected_crs):
            raise ValueError("The retained plan geometry no longer has its original declared CRS/layer")
        projection = None if native == target else Transformer.from_crs(native, target, always_xy=True)
        for feature in source:
            raw = feature["geometry"]
            if raw is None:
                raise ValueError("A retained plan geometry feature is empty")
            geometry = shape(raw)
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("A retained plan geometry is empty or invalid; reopen its original plan")
            if projection is not None:
                geometry = transform(
                    lambda x, y, z=None: projection.transform(x, y, z, errcheck=True), geometry,
                )
            box = tuple(float(value) for value in geometry.bounds)
            if len(box) != 4 or not all(math.isfinite(value) for value in box):
                raise ValueError("The retained plan geometry has no finite common display extent")
            if box[0] > box[2] or box[1] > box[3]:
                raise ValueError("The retained plan geometry has an invalid display extent")
            bounds.append(box)
            native_ids.append(str(feature.id))
        if not bounds:
            raise ValueError("The retained plan geometry contains no features")
        return {
            "bounds": [min(box[0] for box in bounds), min(box[1] for box in bounds),
                       max(box[2] for box in bounds), max(box[3] for box in bounds)],
            "native_crs": native.to_string(), "native_crs_wkt": native.to_wkt(),
            "retained_geometry_feature_ids": native_ids,
            "display_reprojected": projection is not None,
        }


def read(workspace, selection, *, spatial=None):
    """Read one exact receptor across two immutable plans, with either side absent.

    Selection: reference_plan_id, candidate_plan_id, subject_id,
    reference_record_sha256, candidate_record_sha256. Only the selected 2-4
    original vector members are opened. Self-comparison reuses identical reads.
    """
    from pyproj import CRS

    if not isinstance(selection, dict):
        raise ValueError("Choose the original reference and candidate plans")
    subject_id = selection.get("subject_id")
    if not isinstance(subject_id, str) or receiving_waters._safe_label(subject_id) != subject_id:
        raise ValueError("Choose one exact retained receptor ID")
    reference = _plan(workspace, selection.get("reference_plan_id"),
                      selection.get("reference_record_sha256"))
    candidate = _plan(workspace, selection.get("candidate_plan_id"),
                      selection.get("candidate_record_sha256"))
    reference_subject, candidate_subject = _subject(reference, subject_id), _subject(candidate, subject_id)
    if reference_subject is None and candidate_subject is None:
        raise ValueError("The exact receptor ID is absent from both selected plans")
    target = CRS.from_user_input(reference["analysis_crs"])
    if (not target.is_projected or len(target.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in target.axis_info[:2])):
        raise ValueError("Use the original reference plan's projected metre CRS")

    if spatial is None:
        from .spatial import SpatialReview
        spatial = SpatialReview(workspace)
    if spatial.workspace.root != workspace.root or spatial.workspace.project["id"] != workspace.project["id"]:
        raise ValueError("The Spatial catalogue belongs to another original workspace")
    layers = spatial._layers()
    bounds, overlays, bindings, inspected = [], [], [], {}
    for side, plan, receptor in (
        ("reference", reference, reference_subject),
        ("candidate", candidate, candidate_subject),
    ):
        if receptor is None:
            continue
        for key, role, label in _ROLES:
            choice, record = _layer(workspace, layers, plan, receptor, key, role)
            cache_key = (choice["layer_id"], choice["layer"])
            if cache_key not in inspected:
                inspected[cache_key] = _extent(spatial, choice, record, plan["analysis_crs"], target)
            extent = inspected[cache_key]
            bounds.append(extent["bounds"])
            overlays.append({
                "selection": deepcopy(choice),
                "label": (side.title() + " / " + label + " / " + receptor["title"])[:500].strip(),
                "visible": True, "style": "dash" if side == "reference" else "solid",
                "width": 1.25 if role == "contribution" else 2.5, "opacity": 1,
            })
            bindings.append({
                "selection": deepcopy(choice), "kind": "vector",
                "sha256": receptor[key]["sha256"], "bytes": receptor[key]["bytes"],
                "plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
                "subject_id": subject_id, "geometry_role": role, "side": side,
                "geometry_file": deepcopy(receptor[key]),
                "source_identity": _source_identity(receptor.get("source")),
                "relationship_precision": receptor.get("relationship_precision"),
                **deepcopy(extent),
            })
    exact = [min(box[0] for box in bounds), min(box[1] for box in bounds),
             max(box[2] for box in bounds), max(box[3] for box in bounds)]
    # Padding is only a fitted display viewport in the reference CRS's metres.
    # Original geometries and their saved identities remain unchanged.
    pad_x, pad_y = max((exact[2] - exact[0]) * .03, 1), max((exact[3] - exact[1]) * .03, 1)
    view_bounds = [exact[0] - pad_x, exact[1] - pad_y, exact[2] + pad_x, exact[3] + pad_y]
    if not all(math.isfinite(value) for value in view_bounds):
        raise ValueError("The common display viewport is not finite")

    # Immutable names alone do not authorize a record changed during this read.
    _plan(workspace, reference["id"], reference["record_sha256"])
    _plan(workspace, candidate["id"], candidate["record_sha256"])
    present = "both"
    if reference_subject is None:
        present = "candidate_only"
    elif candidate_subject is None:
        present = "reference_only"
    return {
        "schema": SCHEMA, "project_id": workspace.project["id"], "subject_id": subject_id,
        "reference": _header(reference, reference_subject),
        "candidate": _header(candidate, candidate_subject), "presence": present,
        "title": "Receiving-water geography / " + subject_id,
        "view": {"crs": target.to_string(), "bounds": view_bounds},
        "geometry_bounds": exact,
        "extent_method": "Bounds of actual retained feature vertices in the reference plan CRS; 3% or 1 metre display padding",
        "overlays": overlays, "bindings": bindings,
        "notes": (
            "Reference plan " + reference["id"] + " (record SHA-256 " + reference["record_sha256"] + "). "
            "Candidate plan " + candidate["id"] + " (record SHA-256 " + candidate["record_sha256"] + "). "
            "Exact receiving-water ID: " + subject_id + ". "
            "Reference boundaries are dashed; candidate boundaries are solid. "
            "The wider lines identify the original receiving-water feature and the thinner lines its selected contribution area. "
            "A water absent on one side remains explicitly absent. Reprojection fits the shared display only; "
            "all original geometry files, source identities and coordinate systems remain retained. "
            "This view compares saved boundaries and does not calculate geographic gain/loss or modeled quantities."
        ),
    }
