"""Retain original calibration history for selected scientific report editions.

TokenJunkieLabs. This reader follows maintained immutable record fields and export
inventories. It does not refit parameters, execute models or materialize CAS views.
"""
from __future__ import annotations

from pathlib import PurePosixPath

from .common import digest, identifier
from .calibration_uncertainty import _source_stamp

IMMUTABLE_KINDS = (
    "calibration-plans", "calibrations", "calibration-uncertainties",
    "calibration-maps", "calibration-reviews", "calibration-report-sources",
)
LABELS = {
    "calibration-plans": "Calibration designs",
    "calibrations": "Original calibration results",
    "calibration-uncertainties": "Calibration source-error reviews",
    "calibration-maps": "Calibration residual atlases",
    "calibration-reviews": "Calibration scientific reviews",
    "calibration-report-sources": "Calibration report source editions",
}
EXPORTS = {
    "calibration-maps": ("calibration-map-exports", ".maps.lock"),
    "calibration-reviews": ("calibration-review-exports", ".review.lock"),
    "calibration-report-sources": ("calibration-report-source-exports", ".report-source.lock"),
}
REPORT_EDITION = "native-calibration-review-report-v1"


def _same(actual, expected, label):
    if actual != expected:
        raise ValueError(label + " differs from the original calibration")


def _name(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Calibration members require canonical relative paths")
    part = PurePosixPath(value)
    if not part.parts or part.is_absolute() or ".." in part.parts or part.as_posix() != value:
        raise ValueError("Calibration members must remain in the retained export")
    return value


def record(closure, kind, key, reason):
    """Read the raw immutable record, restoring only Workspace's injected id."""
    key = identifier(key)
    closure.need(kind, key, reason)
    value = closure.read(kind + "/" + key + ".json")
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
        raise ValueError("The original calibration dependency changed: " + kind + "/" + key)
    if kind in IMMUTABLE_KINDS:
        if value.get("version") != 1 or value.get("workspace_id") != closure.workspace.project["id"]:
            raise ValueError("The calibration dependency belongs to another version or project")
    return {**value, "id": key}


def _entry(closure, selection, reason):
    source = record(closure, "sources", selection["source_collection_id"], reason)
    rows = [row for row in source["entries"] if row["id"] == selection["source_id"]]
    if len(rows) != 1:
        raise ValueError("The original calibration source entry is missing or ambiguous")
    entry = rows[0]
    closure._body(entry["body"])
    for companion in entry.get("companions", []):
        closure._body(companion)
    return entry


def _basis(closure, calibration_id, reason):
    report = record(closure, "calibrations", calibration_id, reason)
    if report.get("state") != "complete":
        raise ValueError("The scientific review needs its completed original calibration")
    plan = record(closure, "calibration-plans", report["plan_id"], reason)
    observed = record(closure, "observations", plan["selection"]["observation_id"], reason)
    for field, original in (
        ("reference_units", plan["units"]), ("normalization", plan["normalization"]),
        ("spatial_groups", plan["spatial_groups"]), ("observations", plan["observations"]),
        ("objective", plan["selection"]["objective"]),
    ):
        _same(report[field], original, "Calibration " + field)
    _same(plan["observations"], {
        "id": observed["id"], "metadata": observed["metadata"], "original": observed["original"],
    }, "Original observation edition")
    closure._body(observed["original"])
    return report, plan, observed


def _export(closure, kind, value):
    base, unused_lock = EXPORTS[kind]
    selection_id = identifier(value["selection_id"])
    _same(digest(value["selection"]), selection_id, "Calibration export selection")
    prefix = base + "/" + selection_id
    _same(value["directory"], prefix, "Calibration export directory")
    if value.get("state") != "complete":
        raise ValueError("Retain a completed original calibration export")
    closure.tree(prefix)
    files = value["files"]
    if isinstance(files, dict):
        for name, item in files.items():
            _same(_name(name), item.get("path"), "Calibration export inventory path")
            closure.add_file(prefix + "/" + name, item)
    elif isinstance(files, list):
        for item in files:
            closure.add_file(prefix + "/" + _name(item["path"]), item)
    else:
        raise ValueError("Calibration export lacks its retained inventory")
    for name in ("manifest", "archive"):
        if value.get(name):
            item = value[name]
            closure.add_file(prefix + "/" + _name(item["path"]), item)
    return prefix


def _pointer(closure, prefix, expected):
    path = closure.root / prefix / "result.json"
    if path.exists() or path.is_symlink():
        _same(closure.read(prefix + "/result.json"), expected, "Calibration export result pointer")


def _plan(closure, value, reason):
    selection = value["selection"]
    observed = record(closure, "observations", selection["observation_id"], reason)
    _same(value["observations"], {
        "id": observed["id"], "metadata": observed["metadata"], "original": observed["original"],
    }, "Calibration plan observation edition")
    catchments = _entry(closure, selection["catchments"], reason)
    _same(catchments["body"]["sha256"], value["spatial_groups"]["source"]["sha256"],
          "Calibration catchment source")
    candidates = value["candidates"]
    _same([row["run_id"] for row in candidates], selection["candidate_run_ids"],
          "Calibration candidate order")
    for candidate in candidates:
        run_id = identifier(candidate["run_id"])
        closure.need("runs", run_id, reason)
        run = closure.read("runs/" + run_id + "/run.json")
        _same(run.get("selection"), candidate["selection"], "Original calibration native selection")
        _same(digest(run["selection"]), run_id, "Original calibration native identity")
        for field in ("profile_id", "grid_id", "scenario_id"):
            if field in candidate:
                _same(candidate[field], run["selection"][field], "Calibration candidate " + field)
        closure._native_selection(run["selection"], reason)
    reference = selection.get("reference_run_id")
    if reference is not None:
        if reference not in selection["candidate_run_ids"]:
            raise ValueError("The calibration reference is outside its frozen candidate roster")
        closure.need("runs", reference, reason)
    prefix = "calibration-analysis/" + value["id"]
    progress_path = closure.root / prefix / "progress.json"
    if progress_path.exists() or progress_path.is_symlink():
        progress = closure.read(prefix + "/progress.json")
        if (progress.get("id") != value["id"]
                or progress.get("workspace_id") != closure.workspace.project["id"]
                or progress.get("selection") != selection):
            raise ValueError("Calibration continuation belongs to another original design")
        if progress.get("result_id"):
            result = record(closure, "calibrations", progress["result_id"], reason)
            _same(result["plan_id"], value["id"], "Calibration continuation result")
        for run_id, comparison_id in progress.get("comparison_ids", {}).items():
            if run_id not in selection["candidate_run_ids"]:
                raise ValueError("Calibration continuation names another candidate")
            comparison = record(closure, "observation-comparisons", comparison_id, reason)
            _same(comparison["run_id"], run_id, "Calibration continuation comparison")
            _same(comparison["observation_id"], selection["observation_id"],
                  "Calibration continuation observation")


def _result(closure, value, reason):
    plan = record(closure, "calibration-plans", value["plan_id"], reason)
    if value.get("state") not in ("complete", "no_eligible_candidates"):
        raise ValueError("The retained calibration result has an unsupported state")
    candidate_ids = {row["run_id"] for row in plan["candidates"]}
    for run_id, comparison_id in value.get("comparison_ids", {}).items():
        if run_id not in candidate_ids:
            raise ValueError("The calibration comparison names another candidate")
        comparison = record(closure, "observation-comparisons", comparison_id, reason)
        _same(comparison["run_id"], run_id, "Calibration comparison run")
        _same(comparison["observation_id"], plan["selection"]["observation_id"],
              "Calibration comparison observation")
        _same(comparison["catchment_selection"], plan["selection"]["catchments"],
              "Calibration comparison catchments")
        _same(comparison["catchment_source"]["sha256"], plan["spatial_groups"]["source"]["sha256"],
              "Calibration comparison catchment edition")
    selected = value.get("selected_run_id")
    if selected is not None:
        if selected not in candidate_ids:
            raise ValueError("The original nominal selection is outside the saved design")
        chosen = next(row for row in plan["candidates"] if row["run_id"] == selected)
        _same(value["selected_profile_id"], chosen["profile_id"], "Original nominal profile")
        closure.need("runs", selected, reason)
        closure.need("profiles", value["selected_profile_id"], reason)


def _uncertainty(closure, value, reason):
    report, plan, observed = _basis(closure, value["calibration_id"], reason)
    for field in ("plan_id", "selected_run_id", "selected_profile_id", "objective", "normalization"):
        _same(value[field], report[field], "Calibration uncertainty " + field)
    _same(value["source_stamp"], _source_stamp(report, plan, observed), "Calibration source-error basis")


def _maps(closure, value, reason):
    report, plan, observed = _basis(closure, value["calibration_id"], reason)
    selection = value["selection"]
    ids = selection["candidate_run_ids"]
    eligible = [row["run_id"] for row in report["ranked_candidates"]]
    if not ids or ids != [key for key in eligible if key in ids] or report["selected_run_id"] not in ids:
        raise ValueError("The residual atlas changed its original ranked candidate selection")
    uncertainty_id = value.get("uncertainty_id")
    if uncertainty_id:
        detail = record(closure, "calibration-uncertainties", uncertainty_id, reason)
        _same(detail["calibration_id"], report["id"], "Residual atlas uncertainty")
    expected = {
        "version": 1, "workspace_id": closure.workspace.project["id"],
        "calibration_id": report["id"], "plan_id": plan["id"], "uncertainty_id": uncertainty_id,
        "candidate_run_ids": ids, "selected_run_id": report["selected_run_id"],
        "catchments": plan["selection"]["catchments"], "observation_id": observed["id"],
        "reference_units_sha256": digest(plan["units"]),
        "prediction_rows_sha256": digest(report["prediction_rows"]),
        "output_coordinates": "EPSG:4326", "atlas_coordinates": "original selected model grid",
        "validation_scope": "originally selected candidate only",
    }
    _same(selection, expected, "Residual atlas frozen selection")
    for field in ("plan_id", "selected_run_id", "selected_profile_id"):
        _same(value[field], report[field], "Residual atlas " + field)
    entry = _entry(closure, selection["catchments"], reason)
    _same(value["original_catchments"]["body"]["sha256"], entry["body"]["sha256"],
          "Residual atlas catchment body")
    closure.need("sources", value["source_collection_id"], reason)
    prefix = _export(closure, "calibration-maps", value)
    _pointer(closure, prefix, {"map_id": value["id"]})


def _review(closure, value, reason):
    report, plan, observed = _basis(closure, value["calibration_id"], reason)
    detail = record(closure, "calibration-uncertainties", value["uncertainty_id"], reason) if value.get("uncertainty_id") else None
    atlas = record(closure, "calibration-maps", value["map_id"], reason) if value.get("map_id") else None
    for original in (detail, atlas):
        if original:
            _same(original["calibration_id"], report["id"], "Calibration review supplement")
    if atlas and atlas.get("uncertainty_id"):
        _same(atlas["uncertainty_id"], detail["id"] if detail else None, "Review map source-error edition")
    entry = _entry(closure, plan["selection"]["catchments"], reason)
    stamp = {
        "science": _source_stamp(report, plan, observed),
        "calibration_sha256": digest(report), "plan_sha256": digest(plan),
        "observation_sha256": digest(observed), "catchment_entry_sha256": digest(entry),
        "uncertainty_sha256": digest(detail) if detail else None,
        "map_sha256": digest(atlas) if atlas else None,
    }
    _same(value["source_stamp"], stamp, "Calibration review source stamp")
    _same(value["selection"]["source_stamp"], stamp, "Calibration review frozen source stamp")
    for field in ("calibration_id", "plan_id", "uncertainty_id", "map_id"):
        _same(value[field], value["selection"][field], "Calibration review " + field)
    for field in ("plan_id", "selected_run_id", "selected_profile_id"):
        _same(value[field], report[field], "Calibration review nominal " + field)
    prefix = _export(closure, "calibration-reviews", value)
    manifest = closure.read(prefix + "/" + value["manifest"]["path"])
    _same(manifest.get("schema"), "upstate.calibration-review/v1", "Calibration review manifest schema")
    for field in ("selection", "selection_id", "files"):
        _same(manifest[field], value[field], "Calibration review manifest " + field)
    _pointer(closure, prefix, value)


def _report_source(closure, value, reason):
    review = record(closure, "calibration-reviews", value["review_id"], reason)
    expected = {
        "edition": REPORT_EDITION, "workspace_id": closure.workspace.project["id"],
        "review_id": review["id"], "review_selection_id": review["selection_id"],
        "source_stamp": review["source_stamp"],
    }
    _same(value.get("edition"), REPORT_EDITION, "Calibration report producer")
    _same(value["selection"], expected, "Calibration report source selection")
    for field in ("calibration_id", "plan_id", "selected_run_id", "selected_profile_id"):
        _same(value[field], review[field], "Calibration report source " + field)
    entry = _entry(closure, value, reason)
    _same(value["source_id"], "native-calibration-review", "Calibration report source identity")
    prefix = _export(closure, "calibration-report-sources", value)
    files = value["files"]
    _same(files["observed-report.json"]["sha256"], entry["body"]["sha256"], "Calibration report recipe")
    companions = {item.get("view_path", item["filename"]): item for item in entry.get("companions", [])}
    if set(companions) != set(files) - {"observed-report.json"}:
        raise ValueError("The calibration report companion inventory changed")
    for name, item in companions.items():
        for field in ("bytes", "sha256"):
            _same(item[field], files[name][field], "Calibration report companion " + field)
    _pointer(closure, prefix, value)


def visit(closure, kind, key, value, reason):
    """Return True only for supported original immutable calibration records."""
    if kind not in IMMUTABLE_KINDS:
        return False
    original = record(closure, kind, key, reason)
    _same({k: v for k, v in original.items() if k != "id"}, value, "Calibration closure record")
    dispatch = {
        "calibration-plans": _plan, "calibrations": _result,
        "calibration-uncertainties": _uncertainty, "calibration-maps": _maps,
        "calibration-reviews": _review, "calibration-report-sources": _report_source,
    }
    dispatch[kind](closure, original, reason)
    closure.nodes[(kind, key)]["state"] = original.get("state", "retained")
    return True


def lock_paths(closure):
    """Use the producer's existing locks for the selected complete exports."""
    paths = set()
    for kind, key in closure.nodes:
        if kind == "calibration-plans" and (closure.root / "calibration-analysis" / key / "progress.json").exists():
            paths.add("calibration-analysis/" + key + "/.analysis.lock")
        if kind not in EXPORTS:
            continue
        value = closure.read(kind + "/" + key + ".json")
        base, lock = EXPORTS[kind]
        paths.add(base + "/" + identifier(value["selection_id"]) + "/" + lock)
    return sorted(paths)
