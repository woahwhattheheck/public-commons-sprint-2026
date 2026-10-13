"""Register retained receiving-water artifacts in the existing SpatialReview.

This module only indexes original saved records. SpatialReview opens and verifies
each exact file when it is used; no vector materialization or raster scan occurs
during catalog enumeration.
"""
from __future__ import annotations

from .common import digest
from . import receiving_waters


PLAN_GROUP = "receiving-water-plan"
ANALYSIS_GROUP = "receiving-water-analysis"


def manifest_paths(workspace):
    """Return the exact record paths that invalidate the spatial catalog."""
    paths = list((workspace.root / "receiving-water-plans").glob("*/plan.json"))
    paths.extend(
        (workspace.root / "receiving-water-analyses").glob("*/analysis.json")
    )
    return sorted(paths)


def _source_metadata(source):
    """Keep compact original source identity without copying feature/HUC lists."""
    if not isinstance(source, dict):
        return {}
    result = {}
    for source_key, target_key in (
        ("source_collection_id", "source_collection_id"),
        ("source_id", "source_id"),
        ("uri", "source_uri"),
        ("vintage", "vintage"),
        ("body_sha256", "source_body_sha256"),
    ):
        if source.get(source_key) is not None:
            result[target_key] = source[source_key]
    if isinstance(source.get("selection"), dict):
        result["source_selection_id"] = digest(source["selection"])
    return result


def _subject_metadata(subject):
    result = {
        "subject_id": subject["id"],
        "subject_kind": subject.get("kind", "receptor"),
        "subject_title": subject["title"],
        "family": subject["family"],
        "relationship_precision": subject["relationship_precision"],
    }
    method = subject.get("relation", {}).get("method")
    if method is not None:
        result["relationship_method"] = method
    result.update(_source_metadata(subject.get("source")))
    return result


def _run_metadata(analysis, run_id):
    identity = analysis["identity"]
    if run_id == analysis["baseline_run_id"]:
        selection = identity.get("baseline_selection", {})
    else:
        selection = identity.get("alternative_selections", {}).get(run_id, {})
    result = {"run_id": run_id}
    for name in ("grid_id", "profile_id", "scenario_id", "invest_version"):
        if selection.get(name) is not None:
            result[name] = selection[name]
    return result


def _subject_rasters(analysis, subject):
    """Yield known original artifact roles with their actual run and quantity."""
    files = subject["metrics"].get("files", {})
    baseline_id = analysis["baseline_run_id"]
    for statistic in ("contribution_mask", "current_priority"):
        item = files.get(statistic)
        if item is not None:
            yield statistic, item, statistic, baseline_id, None, None
    pollutants = analysis.get("pollutants")
    if pollutants is None:
        pollutants = analysis["identity"].get("pollutants")
    if pollutants is None:
        pollutants = list(subject["metrics"].get("baseline_physical", {}))
    for run_id in analysis.get("alternative_run_ids", []):
        for statistic, direction in (
            ("current_priority", None),
            ("increased_export_priority", "positive alternative minus baseline"),
            ("avoided_export_priority", "positive baseline minus alternative"),
        ):
            role = run_id + "_" + statistic
            item = files.get(role)
            if item is not None:
                yield role, item, statistic, run_id, None, direction
        for quantity in pollutants:
            role = run_id + "_" + quantity + "_change"
            item = files.get(role)
            if item is not None:
                yield (
                    role, item, "change", run_id, quantity,
                    "alternative minus baseline",
                )


def _plan_layers(workspace, path, add):
    plan = receiving_waters.inspect_plan(
        workspace, path.parent.name, verify=False,
    )
    if plan.get("state") != "complete":
        return 0
    count = 0
    for receptor in plan["receptors"]:
        metadata = {
            "receiving_water_plan_id": plan["id"],
            **_subject_metadata(receptor),
        }
        for key, geometry_role, label in (
            ("receptor_geometry", "receptor", "Original receiving-water feature"),
            ("contribution_geometry", "contribution", "Selected contribution area"),
        ):
            add(
                PLAN_GROUP, plan["id"],
                "receptor/" + receptor["id"] + "/" + key, receptor[key],
                kind="vector", scope=path.parent,
                title=receptor["title"] + " / " + label,
                native_layer="receiving_water",
                geometry_role=geometry_role,
                statistic=key,
                **metadata,
            )
            count += 1
    return count


def _analysis_layers(workspace, path, add):
    analysis = receiving_waters.inspect(
        workspace, path.parent.name, verify=False,
    )
    if analysis.get("state") != "complete":
        return 0, 0
    shared = {
        "receiving_water_plan_id": analysis["plan_id"],
        "receiving_water_analysis_id": analysis["id"],
        "baseline_run_id": analysis["baseline_run_id"],
        "quantity_scope": analysis["quantity_scope"],
        "grid_id": analysis["identity"]["grid_id"],
        "normalization_id": digest(analysis["normalization"]),
    }
    vector_count = raster_count = 0
    summary = analysis.get("files", {}).get("receiving_waters_gpkg")
    if summary is not None:
        add(
            ANALYSIS_GROUP, analysis["id"], "receiving_waters_gpkg", summary,
            kind="vector", scope=path.parent,
            title=analysis["title"] + " / Receiving-water quantities",
            native_layer="receiving_waters", statistic="physical_summary",
            run_id=analysis["baseline_run_id"], **shared,
        )
        vector_count += 1
    for subject in analysis["subjects"]:
        metadata = {**shared, **_subject_metadata(subject)}
        stem = "subject/" + subject["kind"] + "/" + subject["id"] + "/"
        for role, item, statistic, run_id, quantity, direction in _subject_rasters(
            analysis, subject,
        ):
            layer_metadata = {
                **metadata, **_run_metadata(analysis, run_id),
                "statistic": statistic,
            }
            if run_id != analysis["baseline_run_id"]:
                layer_metadata["alternative_run_id"] = run_id
            if quantity is not None:
                layer_metadata["quantity"] = quantity
            if direction is not None:
                layer_metadata["direction"] = direction
            label = {
                "contribution_mask": "Selected contribution cells",
                "current_priority": "Current export priority",
                "increased_export_priority": "Increased export priority",
                "avoided_export_priority": "Avoided export priority",
                "change": (quantity or "").replace("_", " ") + " change",
            }[statistic]
            run_label = (
                "baseline" if run_id == analysis["baseline_run_id"]
                else "alternative " + run_id[:12]
            )
            add(
                ANALYSIS_GROUP, analysis["id"], stem + role, item,
                kind="raster", scope=path.parent,
                title=subject["title"] + " / " + label + " / " + run_label,
                **layer_metadata,
            )
            raster_count += 1
    return vector_count, raster_count


def add_layers(workspace, add):
    """Register completed saved plans and analyses through SpatialReview.add.

    Callback: add(group, owner_id, role, original_file_descriptor, *,
                  kind, title, scope, native_layer=None, **metadata).

    Artifact dictionaries and physical units pass through unchanged. The native
    spatial reader verifies bytes/digest when opening each scoped file. Original
    manifest identity and project membership are checked by inspect_plan/inspect.
    Failed or unfinished analyses do not become selectable spatial results.
    """
    counts = {"plan_vectors": 0, "analysis_vectors": 0, "analysis_rasters": 0}
    for path in manifest_paths(workspace):
        if path.name == "plan.json":
            counts["plan_vectors"] += _plan_layers(workspace, path, add)
        else:
            vectors, rasters = _analysis_layers(workspace, path, add)
            counts["analysis_vectors"] += vectors
            counts["analysis_rasters"] += rasters
    return counts
