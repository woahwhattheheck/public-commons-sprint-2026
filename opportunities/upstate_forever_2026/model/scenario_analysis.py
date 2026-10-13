"""Compare selected native outputs on a fixed scale and quantify planning sensitivity.

The original InVEST engines produce the physical inputs. This module streams those
retained annual-mass rasters; it does not execute or approximate either engine.
"""
from __future__ import annotations

from contextlib import ExitStack
import csv
import hashlib
import io
import math
from pathlib import Path
import re
import tempfile
from time import monotonic

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     finite, held, now, read_json, verify_file)
from . import rasters
from .native_versions import POLICY as NATIVE_VERSION_POLICY, comparison_versions, models_for_outputs

SCHEMA = "upstate.scenario-analysis/v1"
ALGORITHM = "fixed-reference-common-support-v1"
SELECTED_MODEL_ALGORITHM = "fixed-reference-selected-model-common-support-v1"
POLLUTANTS = tuple(rasters.MASS_UNITS)
SUM_UNITS = {name: unit.replace("/pixel", "") for name, unit in rasters.MASS_UNITS.items()}


def _percent(reference, value):
    if reference is None or value is None:
        return None, "no_common_cells"
    if reference == 0:
        return None, "both_zero" if value == 0 else "zero_reference"
    return 100.0 * (value - reference) / reference, "defined"


def _weights(value):
    if not isinstance(value, dict) or set(value) != set(POLLUTANTS):
        raise ValueError("Each weight set must name nitrogen_export, phosphorus_export and sediment_export")
    result = {name: finite(value[name], name + " weight", minimum=0) for name in POLLUTANTS}
    total = finite(sum(result.values()), "Weight sum", positive=True)
    return result, {name: result[name] / total for name in POLLUTANTS}


def _weight_sets(selection, pollutants=POLLUTANTS):
    if not isinstance(selection.get("weight_sets", []), list):
        raise ValueError("weight_sets must be a list of explicit planning-weight selections")
    available = set(pollutants)
    values, ratios = _weights(selection.get("weights", {name: int(name in available) for name in POLLUTANTS}))
    result = [{"id": "selected", "title": "Selected planning weights",
               "weights": values, "normalized_weights": ratios}]
    seen = {"selected"}
    for original in selection.get("weight_sets", []):
        key = original.get("id")
        if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", key) or key in seen:
            raise ValueError("Additional weight sets need unique portable IDs other than selected")
        seen.add(key)
        values, ratios = _weights(original["weights"])
        result.append({"id": key, "title": str(original.get("title") or key),
                       "weights": values, "normalized_weights": ratios})
    for item in result:
        unavailable = [name for name, weight in item["weights"].items()
                       if weight > 0 and name not in available]
        if unavailable:
            raise ValueError("Use zero planning weight for outputs outside the common native model selection: "
                             + ", ".join(unavailable))
    return result



def _native_version(run):
    """Retain observed and requested provenance; label old requested-only records."""
    def text(value):
        return value.strip() if isinstance(value, str) and value.strip() else None
    requested = text(run.get("selection", {}).get("invest_version"))
    observed = text((run.get("runtime") or {}).get("version"))
    return {"requested": requested, "observed": observed,
            "comparison_version": observed or requested,
            "basis": "observed_runtime" if observed else "requested_legacy" if requested else "unavailable",
            "differs_from_requested": bool(observed and requested and observed != requested)}


def _comparison_scope(runs):
    """Resolve the maintained native-stage contract; preserve complete legacy studies."""
    try:
        from .model_selection import common_comparison_outputs, validate_completed_run
    except ModuleNotFoundError as error:
        if error.name != __package__ + ".model_selection":
            raise
        if any(run["selection"].get("models") for run in runs):
            raise ValueError("Receive the current selected-native-model source before comparing partial runs") from error
        scopes = {}
        for run in runs:
            available = [name for name in POLLUTANTS if name in run.get("artifacts", {})]
            if len(available) != len(POLLUTANTS):
                raise ValueError("Complete the retained native stages and original annual-mass exports")
            scopes[run["id"]] = {
                "selected_models": ["ndr", "sdr"],
                "completed_models": ["ndr", "sdr"], "omitted_models": [],
                "expected_artifacts": list(POLLUTANTS), "available_artifacts": available,
                "selected_models_complete": True, "full_model_outputs": True}
        return POLLUTANTS, scopes
    pollutants = common_comparison_outputs(runs)
    scopes = {run["id"]: validate_completed_run(run) for run in runs}
    return tuple(name for name in POLLUTANTS if name in pollutants), scopes


def _regions(workspace, grid, choices):
    from pyproj import CRS
    from shapely.ops import unary_union
    crs = CRS.from_user_input(grid["grid"]["crs"])
    if not crs.is_projected or any(not math.isclose(axis.unit_conversion_factor, 1.0)
                                   for axis in crs.axis_info[:2]):
        raise ValueError("Analysis geography requires the selected projected metre grid")
    grid_root = workspace.root / "grids" / grid["id"]
    path = verify_file(grid_root, grid["files"]["reporting_area"])
    rows, _ = rasters.vector_geometry(path, target_crs=crs)
    reporting = rasters.polygon_union(rows)
    original = grid["spec"]["reporting_area"]
    collection_id = grid["spec"]["source_collection_id"]
    _, original_entry = workspace.source_file(collection_id, original["source_id"])
    def source(entry, choice):
        return {"title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
                "sha256": entry["body"]["sha256"], "selection": choice,
                "scope": entry.get("scope"), "role": entry.get("role")}
    result = [{"id": "reporting_area", "title": "Full reporting area", "rank_group": None,
               "map_family": None, "geometry": reporting, "area_ha": reporting.area / 10000.0,
               "selected_cells": 0, "source_features": len(rows), "buffer_m": 0.0,
               "source": source(original_entry, {**original, "source_collection_id": collection_id})}]
    seen = {"reporting_area"}
    for choice in choices:
        key = choice.get("id")
        if not isinstance(key, str) or not key or key in seen:
            raise ValueError("Each analysis zone needs a unique nonempty ID other than reporting_area")
        seen.add(key)
        path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if entry["kind"] != "vector":
            raise ValueError("Analysis zones must select retained original vector sources")
        rows, _ = rasters.vector_geometry(path, layer=choice.get("layer") or entry.get("layer"),
                                          where=choice.get("where"), target_crs=crs)
        geometry = unary_union([row["geometry"] for row in rows])
        buffer_m = finite(choice.get("buffer_m", 0), "Zone buffer in metres", minimum=0)
        if buffer_m:
            geometry = geometry.buffer(buffer_m)
        elif geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("A line or point context zone requires an explicit positive buffer_m")
        geometry = geometry.intersection(reporting)
        if geometry.geom_type == "GeometryCollection":
            geometry = unary_union([part for part in geometry.geoms
                                    if part.geom_type in ("Polygon", "MultiPolygon")])
        elif geometry.geom_type not in ("Polygon", "MultiPolygon"):
            geometry = unary_union([])
        if not geometry.is_empty and not geometry.is_valid:
            raise ValueError("The selected source/buffer produced an invalid analysis zone")
        family = choice.get("map_family")
        if family not in (None, "critical_drinking_water", "high_quality_waters"):
            raise ValueError("A context zone map_family must be critical_drinking_water or high_quality_waters")
        group = choice.get("rank_group")
        if group is not None and (not isinstance(group, str) or not group):
            raise ValueError("Use a nonempty rank_group for scientifically comparable zones")
        result.append({"id": key, "title": str(choice.get("title") or entry["title"]),
                       "rank_group": group, "map_family": family, "geometry": geometry,
                       "area_ha": geometry.area / 10000.0, "selected_cells": 0,
                       "source_features": len(rows), "buffer_m": buffer_m,
                       "source": source(entry, choice)})
    return result, crs


def _block_count(source):
    """Exact block_windows count for a single-band Rasterio dataset."""
    rows, columns = source.block_shapes[0]
    return ((source.height + rows - 1) // rows
            * ((source.width + columns - 1) // columns))


def _reference_caps(opened, reporting_mask, selection, directory, *, progress=None):
    """Exact positive-cell percentile using a disk-backed in-place partition."""
    import numpy as np

    def report(completed=None, total=None, detail=None, *, force=False):
        if progress is not None:
            progress.update("normalization", "Derive fixed baseline caps",
                            completed, total, "raster blocks" if completed is not None else None,
                            detail=detail, force=force)

    report(detail="Read the selected physical normalization")
    supplied = selection.get("caps")
    if supplied is not None:
        common = set(opened)
        if not isinstance(supplied, dict) or set(supplied) not in (common, set(POLLUTANTS)):
            raise ValueError("Explicit normalization caps must cover the common native pollutants or all three named pollutants")
        checked = {name: finite(value, name + " cap", minimum=0) for name, value in supplied.items()}
        caps = {name: checked[name] for name in opened}
        if progress is not None:
            progress.update("normalization", "Use selected fixed physical caps",
                            len(caps), len(caps), "caps",
                            detail="The same physical caps apply to every selected run", force=True)
        return caps, None
    percentile = finite(selection.get("percentile", 95), "Normalization percentile", positive=True)
    if percentile > 100:
        raise ValueError("Normalization percentile must be at most 100")

    def positives(src, window):
        array = src.read(1, window=window, masked=True)
        raw = np.asarray(array.data, dtype="float64")
        valid = ((reporting_mask.read(1, window=window) == 1)
                 & ~np.ma.getmaskarray(array) & np.isfinite(raw) & (raw > 0))
        return raw[valid]

    # The count pass discovers which second passes are actually needed. Until
    # that is known, report the real count with no estimated denominator.
    counts, visited = {}, 0
    blocks = {name: _block_count(src) for name, src in opened.items()}
    for name, src in opened.items():
        count = 0
        for _, window in src.block_windows(1):
            count += positives(src, window).size
            visited += 1
            report(visited, detail="Count positive " + name.replace("_", " ") + " pixels")
        counts[name] = count
    total = visited + sum(blocks[name] for name, count in counts.items() if count)
    report(visited, total, "Positive-cell counts complete", force=True)

    caps = {}
    with tempfile.TemporaryDirectory(prefix=".percentile-", dir=directory) as temporary:
        for name, src in opened.items():
            count = counts[name]
            if not count:
                caps[name] = 0.0
                continue
            values = np.memmap(Path(temporary) / (name + ".bin"), dtype="float64", mode="w+", shape=(count,))
            try:
                offset = 0
                for _, window in src.block_windows(1):
                    block = positives(src, window)
                    values[offset:offset + block.size] = block
                    offset += block.size
                    visited += 1
                    report(visited, total, "Retain positive " + name.replace("_", " ") + " pixels")
                if offset != count:
                    raise ValueError("Baseline valid cells changed while computing normalization")
                report(visited, total, "Select the exact " + name.replace("_", " ") + " percentile", force=True)
                index = (count - 1) * percentile / 100.0
                lower, upper = math.floor(index), math.ceil(index)
                values.partition((lower, upper))
                caps[name] = float(values[lower] + (values[upper] - values[lower]) * (index - lower))
                values.flush()
            finally:
                del values
    report(visited, total, "Fixed baseline caps ready", force=True)
    return caps, percentile

def _kind(reference, alternative):
    scenario_changed = reference["selection"]["scenario_id"] != alternative["selection"]["scenario_id"]
    profile_changed = reference["selection"]["profile_id"] != alternative["selection"]["profile_id"]
    scope_changed = set(reference["selection"].get("models", ("ndr", "sdr"))) != set(
        alternative["selection"].get("models", ("ndr", "sdr")))
    if scope_changed and (scenario_changed or profile_changed):
        return "mixed"
    if scope_changed:
        return "native_model_scope"
    if scenario_changed and profile_changed:
        return "mixed"
    if profile_changed:
        return "parameter_sensitivity"
    if scenario_changed:
        return "landcover"
    return "same_selection"


def _profile_changes(workspace, baseline, alternative):
    if baseline["selection"]["profile_id"] == alternative["selection"]["profile_id"]:
        return []
    a = workspace._get("profiles", baseline["selection"]["profile_id"])
    b = workspace._get("profiles", alternative["selection"]["profile_id"])
    result = []
    for model in ("ndr", "sdr"):
        for name in sorted(set(a.get(model, {})) | set(b.get(model, {}))):
            av, bv = a.get(model, {}).get(name), b.get(model, {}).get(name)
            if av != bv:
                result.append({"parameter": model + "." + name, "baseline": av, "alternative": bv})
    if a["table_summary"]["sha256"] != b["table_summary"]["sha256"]:
        result.append({"parameter": "biophysical_table_sha256",
                       "baseline": a["table_summary"]["sha256"], "alternative": b["table_summary"]["sha256"]})
    return result


def _physical_accumulator():
    return {"valid_cells": 0, "own_sum": 0.0, "common_sum": 0.0, "common_valid_cells": 0,
            "increase_sum": 0.0, "decrease_sum": 0.0, "increasing_cells": 0,
            "decreasing_cells": 0, "unchanged_cells": 0}


def _priority_accumulator():
    return {"count": 0, "sum": 0.0, "minimum": None, "maximum": None}


def _rank(priority, regions):
    groups = {r["id"]: r["rank_group"] for r in regions}
    buckets = {}
    for row in priority:
        row["rank_group"] = groups[row["region_id"]]
        row["rank"] = None
        if row["mean"] is not None and row["rank_group"]:
            buckets.setdefault((row["run_id"], row["weight_set_id"], row["rank_group"]), []).append(row)
    for rows in buckets.values():
        previous, rank = None, 0
        for index, row in enumerate(sorted(rows, key=lambda r: (-r["mean"], r["region_id"]))):
            if row["mean"] != previous:
                rank = index + 1
                previous = row["mean"]
            row["rank"] = rank


def _csv_file(directory, name, rows):
    text = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(text, fieldnames=list(rows[0]), extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: (canonical(value).decode("utf-8") if isinstance(value, (list, dict)) else value)
                             for key, value in row.items()})
    path = directory / name
    atomic_bytes(path, text.getvalue().encode("utf-8"))
    return describe_file(directory, path)


def _region_file(directory, regions, crs):
    import fiona
    from shapely.geometry import MultiPolygon, mapping
    path = directory / "regions.gpkg"
    path.unlink(missing_ok=True)
    schema = {"geometry": "MultiPolygon", "properties": {
        "region_id": "str", "title": "str", "rank_group": "str", "map_family": "str",
        "area_ha": "float", "buffer_m": "float", "source": "str"}}
    with rasters.vector_environment(), fiona.open(
            path, "w", driver="GPKG", layer="analysis_regions", crs_wkt=crs.to_wkt(), schema=schema) as out:
        for region in regions:
            geometry = region["geometry"]
            if geometry.is_empty or geometry.area <= 0:
                continue
            if geometry.geom_type == "Polygon":
                geometry = MultiPolygon([geometry])
            elif geometry.geom_type == "GeometryCollection":
                parts = []
                for part in geometry.geoms:
                    if part.geom_type == "Polygon":
                        parts.append(part)
                    elif part.geom_type == "MultiPolygon":
                        parts.extend(part.geoms)
                geometry = MultiPolygon(parts)
            properties = {key: region[key] for key in schema["properties"] if key not in ("region_id", "source")}
            properties.update(region_id=region["id"], source=canonical(region["source"]).decode("utf-8"))
            out.write({"geometry": mapping(geometry), "properties": properties})
    return describe_file(directory, path)


def _summary(result):
    names = ("schema", "id", "title", "state", "created_at", "completed_at",
             "baseline_run_id", "run_ids", "grid_id", "runs", "selection",
             "region_count", "normalization", "error")
    # Earlier complete analyses remain reusable with their original summary.
    if "progress" in result:
        names += ("updated_at", "progress")
    for name in ("comparison_pollutants", "model_scope"):
        if name in result:
            names += (name,)
    return {name: result.get(name) for name in names}


def _summary_body(result):
    return canonical(_summary(result)) + b"\n"


def _summary_descriptor(body):
    return {"path": "summary.json", "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest()}


def _persist_summary(directory, result):
    body = _summary_body(result)
    atomic_bytes(directory / "summary.json", body)
    result["files"]["summary_json"] = _summary_descriptor(body)


def _persist(directory, result):
    body = _summary_body(result)
    result["files"]["summary_json"] = _summary_descriptor(body)
    # The full record is available before the overview can expose completion.
    atomic_json(directory / "analysis.json", result)
    atomic_bytes(directory / "summary.json", body)


def _recover_summary(directory, result):
    expected = result["files"]["summary_json"]
    try:
        verify_file(directory, expected)
    except (ValueError, OSError):
        # Continue the final publication if a process ended between the two
        # atomic writes. Reproduce only the summary declared by this record.
        body = _summary_body(result)
        if _summary_descriptor(body) != expected:
            raise ValueError("The completed analysis cannot reproduce its retained summary")
        atomic_bytes(directory / "summary.json", body)


class _Progress:
    """Retain real phase counts without rewriting the quantitative record."""
    def __init__(self, directory, result, started):
        self.directory, self.result, self.started = directory, result, started
        self.phase = None
        self.phase_started = started
        self.pending = None
        self.last_write = float("-inf")
        self.before_finish = None

    def update(self, phase, label, completed=None, total=None, unit=None, *, detail=None, force=False):
        clock = monotonic()
        changed = phase != self.phase
        if changed:
            self.phase, self.phase_started = phase, clock
        self.pending = (phase, label, completed, total, unit, detail)
        if force or changed or clock - self.last_write >= 2.0:
            self._record(clock)
            _persist_summary(self.directory, self.result)
            self.last_write = clock

    def _record(self, clock):
        if self.pending is None:
            return
        phase, label, completed, total, unit, detail = self.pending
        stamp = now()
        percent = 100.0 * completed / total if completed is not None and total is not None and total > 0 else None
        self.result["progress"] = {
            "phase": phase, "label": label, "completed": completed,
            "total": total, "unit": unit, "percent": percent,
            "elapsed_seconds": round(clock - self.started, 3),
            "phase_elapsed_seconds": round(clock - self.phase_started, 3),
            "updated_at": stamp, "detail": detail}
        self.result["updated_at"] = stamp

    def finish(self, completed, total, detail):
        # Let _persist publish the full complete record before its summary.
        self.before_finish = (self.phase, self.phase_started, self.pending)
        clock = monotonic()
        self.phase, self.phase_started = "complete", clock
        self.pending = ("complete", "Scenario analysis complete",
                        completed, total, "raster blocks", detail)
        self._record(clock)

    def failed(self):
        # Keep the last actual phase/count; result.state carries the failure.
        if self.before_finish is not None:
            self.phase, self.phase_started, self.pending = self.before_finish
        self._record(monotonic())

def _response(directory, result, *, reused=False):
    return {**result, "reused": reused,
            "analysis_artifact": describe_file(directory, directory / "analysis.json")}


def analyze(workspace, selection):
    """Retain one fixed-reference analysis of completed original native runs.

    selection binds baseline_run_id, scenario_run_ids, weights, optional caps or
    percentile, explicit weight_sets and source-bound zones. Zone rank_group is
    opt-in; unlike geographies are never put into one ranking implicitly.
    """
    started = monotonic()
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.windows import bounds as window_bounds

    selection = read_json(selection) if isinstance(selection, (str, Path)) else dict(selection)
    # Serialize now to reject nonportable values and keep an independent selection.
    import json
    selection = json.loads(canonical(selection))
    if not isinstance(selection.get("zones", []), list):
        raise ValueError("zones must be a list of source-bound geography selections")
    alternatives = selection.get("scenario_run_ids", [])
    if not isinstance(alternatives, list):
        raise ValueError("scenario_run_ids must be a list of retained run IDs")
    ids = [selection["baseline_run_id"]] + alternatives
    if len(set(ids)) != len(ids):
        raise ValueError("Each selected run must be distinct")
    runs = [workspace.inspect_run(key) for key in ids]
    if any(run["state"] != "complete" for run in runs):
        raise ValueError("Complete the selected original native runs before analysis")
    baseline = runs[0]
    if any(run["selection"]["grid_id"] != baseline["selection"]["grid_id"] for run in runs):
        raise ValueError("Scenario analysis requires one retained grid and reporting mask")
    native_versions = {run["id"]: _native_version(run) for run in runs}
    pollutants, scopes = _comparison_scope(runs)
    native_models = comparison_versions(runs, models_for_outputs(pollutants))
    distinct_versions = set(native_models["versions"].values())
    baseline_version = next(iter(distinct_versions)) if len(distinct_versions) == 1 else None
    algorithm = ALGORITHM if pollutants == POLLUTANTS else SELECTED_MODEL_ALGORITHM
    grid = workspace.get_grid(baseline["selection"]["grid_id"])
    weight_sets = _weight_sets(selection, pollutants=pollutants)
    active = {name for item in weight_sets for name, weight in item["weights"].items() if weight > 0}
    regions, crs = _regions(workspace, grid, selection.get("zones", []))
    paths, binding, run_details = {}, [], []
    for index, run in enumerate(runs):
        paths[run["id"]] = {}
        selected = {}
        for name in pollutants:
            artifact = run["artifacts"][name]
            if artifact.get("units") != rasters.MASS_UNITS[name]:
                raise ValueError("Select original annual-mass output for " + name)
            selected[name] = {"sha256": artifact["sha256"], "bytes": artifact["bytes"],
                              "units": artifact["units"]}
        scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
        run_details.append({"id": run["id"], "title": scenario["title"],
                            "scenario_kind": scenario["kind"], "scenario_reason": scenario.get("reason"),
                            "comparison_kind": "baseline" if index == 0 else _kind(baseline, run),
                            "selection": run["selection"], "model_scope": scopes[run["id"]],
                            "native_version": native_versions[run["id"]],
                            "model_versions": native_models["runs"][run["id"]],
                            "parameter_changes": [] if index == 0 else _profile_changes(workspace, baseline, run)})
        binding.append({"run_id": run["id"], "selection": run["selection"], "artifacts": selected,
                        "native_version": native_versions[run["id"]]})
    # Preserve ordinary retained-analysis identities. A stage-aware digest is
    # needed only when the authoritative vector differs from the prior scalar
    # execution identity; ordinary same-version runs keep their original key.
    if any(value["comparison_version"] != native_versions[run["id"]]["comparison_version"]
           for run in runs for value in native_models["runs"][run["id"]].values()):
        for item in binding:
            item["model_versions"] = native_models["runs"][item["run_id"]]
    basis = {"algorithm": algorithm, "selection": selection, "inputs": binding,
             "regions": [{key: value for key, value in r.items() if key != "geometry"} for r in regions],
             "reporting_mask": grid["files"]["reporting_mask"]}
    key = digest(basis)
    directory = workspace.root / "analyses" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "analysis.json"
    with held(workspace.root / ".workspace.lock", blocking=False), held(directory / ".analysis.lock", blocking=False):
        if state_path.exists():
            previous = read_json(state_path)
            if previous.get("state") == "complete":
                _recover_summary(directory, previous)
                for item in previous["files"].values():
                    verify_file(directory, item)
                return _response(directory, previous, reused=True)
        result = {"schema": SCHEMA, "id": key, "state": "building", "algorithm": algorithm,
                  "created_at": now(), "title": str(selection.get("title") or "Scenario and priority analysis"),
                  "selection": selection, "baseline_run_id": ids[0], "region_count": len(regions),
                  "run_ids": ids, "grid_id": grid["id"], "runs": run_details, "files": {},
                  "input_binding": binding, "progress": None,
                  "comparison_pollutants": list(pollutants),
                  "native_version": {"comparison_version": baseline_version,
                                     "policy": NATIVE_VERSION_POLICY,
                                     "comparison_versions": native_models["versions"],
                                     "comparison_models": native_models["models"],
                                     "requested_fallback_run_ids": [
                                         run["id"] for run in runs
                                         if any(value["basis"] == "requested_legacy"
                                                for value in native_models["runs"][run["id"]].values())]},
                  "model_scope": {"comparison_pollutants": list(pollutants),
                                  "full_model_outputs": pollutants == POLLUTANTS,
                                  "runs": [{"run_id": run["id"], **scopes[run["id"]]} for run in runs]}}
        _persist(directory, result)
        progress = _Progress(directory, result, started)
        try:
            source_total = len(ids) * len(pollutants)
            source_completed = 0
            progress.update("source", "Read selected native export files", 0, source_total, "files",
                            detail="Check the retained annual-mass artifacts")
            for run in runs:
                root = workspace.root / "runs" / run["id"]
                for name in pollutants:
                    paths[run["id"]][name] = verify_file(root, run["artifacts"][name])
                    source_completed += 1
                    progress.update("source", "Read selected native export files",
                                    source_completed, source_total, "files",
                                    detail="Read " + name.replace("_", " ") + " for run " + run["id"][:12])
            progress.update("source", "Read selected native export files",
                            source_completed, source_total, "files",
                            detail="Selected annual-mass files ready", force=True)
            physical = {(region["id"], run_id, name): _physical_accumulator()
                        for region in regions for run_id in ids for name in pollutants}
            priority = {(region["id"], run_id, item["id"]): _priority_accumulator()
                        for region in regions for run_id in ids for item in weight_sets}
            output_paths = {}
            with ExitStack() as stack:
                opened = {run_id: {name: stack.enter_context(rasterio.open(path))
                                   for name, path in pollutions.items()} for run_id, pollutions in paths.items()}
                first = opened[ids[0]][pollutants[0]]
                reporting_mask = stack.enter_context(rasterio.open(verify_file(
                    workspace.root / "grids" / grid["id"], grid["files"]["reporting_mask"])))
                rasters.check_same_grid(first, reporting_mask)
                for sources in opened.values():
                    for src in sources.values():
                        rasters.check_same_grid(first, src)
                pixel_area_ha = abs(first.transform.a * first.transform.e - first.transform.b * first.transform.d) / 10000.0
                caps, percentile = _reference_caps(opened[ids[0]], reporting_mask, selection, directory,
                                                   progress=progress)
                result["normalization"] = {
                    "reference_run_id": ids[0], "caps": caps,
                    "cap_units": {name: rasters.MASS_UNITS[name] for name in pollutants},
                    "percentile": percentile, "weight_sets": weight_sets,
                    "method": "sum(normalized_weight * clip(annual_mass / fixed_baseline_cap, 0, 1))",
                    "reference_support": "Baseline valid positive reporting pixels, before alternative common-support restriction",
                    "zero_cap": "An all-zero pollutant contributes zero; new positive export requires an explicit positive cap"}
                result["coverage"] = {
                    "physical": "Each pollutant uses the intersection of valid reporting cells across every selected run",
                    "priority": "Every weight set uses the same intersection of all active pollutant cells across every selected run",
                    "geography": "Pixel-centre selection in the retained reporting mask; source zones clipped to reporting area",
                    "pixel_area_ha": pixel_area_ha,
                    "active_pollutants": sorted(active)}
                _persist(directory, result)
                comparison_total, comparison_completed = _block_count(first), 0
                progress.update("comparison", "Compare scenarios on common raster cells",
                                comparison_completed, comparison_total, "raster blocks",
                                detail="Physical exports and fixed-scale planning priorities")
                profile = dict(first.profile)
                profile.update(driver="GTiff", dtype="float64", count=1, nodata=float("nan"),
                               compress="deflate", predictor=3)
                outputs = {}
                for run_id in ids:
                    for prefix in ("priority", "weight_spread"):
                        name = prefix + "_" + run_id
                        path = directory / (name + ".tif")
                        output_paths[name] = path
                        outputs[name] = stack.enter_context(rasterio.open(path, "w", **profile))
                        outputs[name].update_tags(
                            units="dimensionless", baseline_run_id=ids[0], run_id=run_id,
                            method=algorithm, normalization_caps=canonical(caps).decode("utf-8"),
                            weight_sets=canonical(weight_sets).decode("utf-8"),
                            interpretation=("Selected fixed-reference planning score" if prefix == "priority"
                                            else "Range across selected planning-weight sets"))
                    if run_id != ids[0]:
                        for name in pollutants:
                            output_id = "delta_" + run_id + "_" + name
                            path = directory / (output_id + ".tif")
                            output_paths[output_id] = path
                            outputs[output_id] = stack.enter_context(rasterio.open(path, "w", **profile))
                            outputs[output_id].update_tags(
                                units=rasters.MASS_UNITS[name], direction="alternative minus baseline",
                                baseline_run_id=ids[0], run_id=run_id,
                                support="Common valid reporting cells across all selected runs for this pollutant")
                for _, window in first.block_windows(1):
                    reporting = reporting_mask.read(1, window=window) == 1
                    values, valid = {}, {}
                    for run_id in ids:
                        values[run_id], valid[run_id] = {}, {}
                        for name, src in opened[run_id].items():
                            array = src.read(1, window=window, masked=True)
                            raw = np.asarray(array.data, dtype="float64")
                            good = reporting & ~np.ma.getmaskarray(array) & np.isfinite(raw)
                            if np.any(raw[good] < 0):
                                raise ValueError("Original annual physical export contains negative values")
                            values[run_id][name], valid[run_id][name] = raw, good
                    common = {name: np.logical_and.reduce([valid[run_id][name] for run_id in ids])
                              for name in pollutants}
                    score_good = np.logical_and.reduce([common[name] for name in sorted(active)])
                    west, south, east, north = window_bounds(window, first.transform)
                    zone_masks = {}
                    for region in regions:
                        if region["id"] == "reporting_area":
                            inside = reporting
                        else:
                            geometry = region["geometry"]
                            if geometry.is_empty:
                                continue
                            left, bottom, right, top = geometry.bounds
                            if right < west or left > east or top < south or bottom > north:
                                continue
                            inside = geometry_mask([geometry.__geo_interface__], out_shape=reporting.shape,
                                                   transform=first.window_transform(window), invert=True,
                                                   all_touched=False) & reporting
                        count = int(np.count_nonzero(inside))
                        region["selected_cells"] += count
                        if count:
                            zone_masks[region["id"]] = inside
                    for run_id in ids:
                        differences = {}
                        for name in pollutants:
                            difference = np.zeros(reporting.shape, dtype="float64")
                            difference[common[name]] = (values[run_id][name][common[name]]
                                                       - values[ids[0]][name][common[name]])
                            differences[name] = difference
                            if run_id != ids[0]:
                                outputs["delta_" + run_id + "_" + name].write(
                                    np.where(common[name], difference, np.nan), 1, window=window)
                        scaled = {}
                        for name in active:
                            raw = values[run_id][name]
                            if caps[name] > 0:
                                scaled[name] = np.clip(np.where(score_good, raw, 0.0) / caps[name], 0.0, 1.0)
                            else:
                                if np.any(raw[score_good] > 0):
                                    raise ValueError("Baseline has no positive " + name +
                                                     "; select an explicit positive physical cap for its new alternative export")
                                scaled[name] = np.zeros(reporting.shape, dtype="float64")
                        minimum_score, maximum_score = None, None
                        for weight_set in weight_sets:
                            score = np.zeros(reporting.shape, dtype="float64")
                            for name in active:
                                score += weight_set["normalized_weights"][name] * scaled[name]
                            score = np.clip(score, 0.0, 1.0)
                            if weight_set["id"] == "selected":
                                outputs["priority_" + run_id].write(
                                    np.where(score_good, score, np.nan), 1, window=window)
                            minimum_score = score.copy() if minimum_score is None else np.minimum(minimum_score, score)
                            maximum_score = score.copy() if maximum_score is None else np.maximum(maximum_score, score)
                            for region_id, inside in zone_masks.items():
                                usable = inside & score_good
                                count = int(np.count_nonzero(usable))
                                if count:
                                    selected_score = score[usable]
                                    row = priority[(region_id, run_id, weight_set["id"])]
                                    row["count"] += count
                                    row["sum"] += float(selected_score.sum(dtype="float64"))
                                    lo, hi = float(selected_score.min()), float(selected_score.max())
                                    row["minimum"] = lo if row["minimum"] is None else min(row["minimum"], lo)
                                    row["maximum"] = hi if row["maximum"] is None else max(row["maximum"], hi)
                        outputs["weight_spread_" + run_id].write(
                            np.where(score_good, maximum_score - minimum_score, np.nan), 1, window=window)
                        for region_id, inside in zone_masks.items():
                            for name in pollutants:
                                row = physical[(region_id, run_id, name)]
                                own, shared = inside & valid[run_id][name], inside & common[name]
                                row["valid_cells"] += int(np.count_nonzero(own))
                                row["common_valid_cells"] += int(np.count_nonzero(shared))
                                row["own_sum"] += float(values[run_id][name][own].sum(dtype="float64"))
                                row["common_sum"] += float(values[run_id][name][shared].sum(dtype="float64"))
                                delta = differences[name][shared]
                                positive, negative = delta > 0, delta < 0
                                row["increase_sum"] += float(delta[positive].sum(dtype="float64"))
                                row["decrease_sum"] -= float(delta[negative].sum(dtype="float64"))
                                row["increasing_cells"] += int(np.count_nonzero(positive))
                                row["decreasing_cells"] += int(np.count_nonzero(negative))
                                row["unchanged_cells"] += int(np.count_nonzero(delta == 0))
                    comparison_completed += 1
                    progress.update("comparison", "Compare scenarios on common raster cells",
                                    comparison_completed, comparison_total, "raster blocks",
                                    detail=str(len(ids)) + " selected runs on shared reporting pixels")
                progress.update("comparison", "Compare scenarios on common raster cells",
                                comparison_completed, comparison_total, "raster blocks",
                                detail="Raster calculation complete", force=True)
            # Raster writers are closed before their hashes and byte sizes are retained.
            export_total, export_completed = len(output_paths) + 5, 0
            progress.update("export", "Export scenario results",
                            export_completed, export_total, "files",
                            detail="Retain finished rasters, geography and quantitative tables")
            for name, path in output_paths.items():
                units = ("dimensionless" if not name.startswith("delta_")
                         else rasters.MASS_UNITS[next(p for p in pollutants if name.endswith("_" + p))])
                result["files"][name] = describe_file(directory, path, units=units)
                export_completed += 1
                progress.update("export", "Export scenario results",
                                export_completed, export_total, "files",
                                detail="Retained " + path.name)
            result["regions"] = [{key: value for key, value in r.items() if key != "geometry"} for r in regions]
            result["physical"], result["priority"], result["sensitivity"], result["pairs"], result["pareto"] = [], [], [], [], []
            for region_index, region in enumerate(regions, 1):
                region_id, selected_count = region["id"], region["selected_cells"]
                for run_id in ids:
                    for name in pollutants:
                        source = physical[(region_id, run_id, name)]
                        reference = physical[(region_id, ids[0], name)]
                        common_count = source["common_valid_cells"]
                        baseline_sum = reference["common_sum"] if common_count else None
                        total = source["common_sum"] if common_count else None
                        pct, pct_status = _percent(baseline_sum, total)
                        common_area = common_count * pixel_area_ha
                        row = {"region_id": region_id, "run_id": run_id, "pollutant": name,
                               "units": SUM_UNITS[name], "valid_cells": source["valid_cells"],
                               "valid_fraction": source["valid_cells"] / selected_count if selected_count else None,
                               "common_valid_cells": common_count,
                               "common_coverage_fraction": common_count / selected_count if selected_count else None,
                               "own_sum": source["own_sum"] if source["valid_cells"] else None,
                               "common_sum": total, "baseline_common_sum": baseline_sum,
                               "change": total - baseline_sum if common_count else None,
                               "percent_change": pct, "percent_change_status": pct_status,
                               "increase_sum": source["increase_sum"] if common_count else None,
                               "decrease_sum": source["decrease_sum"] if common_count else None,
                               "increasing_cells": source["increasing_cells"],
                               "decreasing_cells": source["decreasing_cells"],
                               "unchanged_cells": source["unchanged_cells"],
                               "common_area_ha": common_area,
                               "mean_mass_per_ha": total / common_area if common_count else None,
                               "mean_mass_per_ha_units": SUM_UNITS[name].replace("/year", "/ha/year")}
                        result["physical"].append(row)
                    for weight_set in weight_sets:
                        source = priority[(region_id, run_id, weight_set["id"])]
                        result["priority"].append({
                            "region_id": region_id, "run_id": run_id, "weight_set_id": weight_set["id"],
                            "common_cells": source["count"],
                            "coverage_fraction": source["count"] / selected_count if selected_count else None,
                            "mean": source["sum"] / source["count"] if source["count"] else None,
                            "minimum": source["minimum"], "maximum": source["maximum"],
                            "rank": None, "rank_group": region["rank_group"]})
                for from_index, from_run in enumerate(runs):
                    for to_run in runs[from_index + 1:]:
                        for name in pollutants:
                            left = physical[(region_id, from_run["id"], name)]
                            right = physical[(region_id, to_run["id"], name)]
                            count = left["common_valid_cells"]
                            a, b = (left["common_sum"], right["common_sum"]) if count else (None, None)
                            pct, pct_status = _percent(a, b)
                            result["pairs"].append({
                                "region_id": region_id, "from_run_id": from_run["id"], "to_run_id": to_run["id"],
                                "comparison_kind": _kind(from_run, to_run), "pollutant": name, "units": SUM_UNITS[name],
                                "common_valid_cells": count, "from_sum": a, "to_sum": b,
                                "change": b - a if count else None, "percent_change": pct,
                                "percent_change_status": pct_status})
                comparable = [run for run in runs
                              if run["selection"]["profile_id"] == baseline["selection"]["profile_id"]
                              and all(physical[(region_id, run["id"], name)]["common_valid_cells"] for name in pollutants)]
                dominators = {}
                for target in comparable:
                    tv = [physical[(region_id, target["id"], name)]["common_sum"] for name in pollutants]
                    dominators[target["id"]] = []
                    for candidate in comparable:
                        if candidate["id"] == target["id"]:
                            continue
                        cv = [physical[(region_id, candidate["id"], name)]["common_sum"] for name in pollutants]
                        if all(a <= b for a, b in zip(cv, tv)) and any(a < b for a, b in zip(cv, tv)):
                            dominators[target["id"]].append(candidate["id"])
                result["pareto"].append({
                    "region_id": region_id, "comparable_run_ids": [r["id"] for r in comparable],
                    "non_dominated_run_ids": [r["id"] for r in comparable if not dominators[r["id"]]],
                    "dominated_by": dominators})
                progress.update("export", "Export scenario results",
                                export_completed, export_total, "files",
                                detail="Summarized region " + str(region_index) + " of " + str(len(regions)))
            _rank(result["priority"], result["regions"])
            baseline_priorities = {(row["region_id"], row["weight_set_id"]): row
                                   for row in result["priority"] if row["run_id"] == ids[0]}
            for row in result["priority"]:
                reference = baseline_priorities[(row["region_id"], row["weight_set_id"])]
                row["baseline_mean"] = reference["mean"]
                row["score_change"] = (row["mean"] - reference["mean"]
                                       if row["mean"] is not None and reference["mean"] is not None else None)
                row["baseline_rank"] = reference["rank"]
                row["rank_change"] = (row["rank"] - reference["rank"]
                                      if row["rank"] is not None and reference["rank"] is not None else None)
            for region in regions:
                for run_id in ids:
                    rows = [row for row in result["priority"]
                            if row["region_id"] == region["id"] and row["run_id"] == run_id]
                    scores = [row["mean"] for row in rows if row["mean"] is not None]
                    ranks = [row["rank"] for row in rows if row["rank"] is not None]
                    result["sensitivity"].append({
                        "region_id": region["id"], "run_id": run_id, "rank_group": region["rank_group"],
                        "score_min": min(scores) if scores else None, "score_max": max(scores) if scores else None,
                        "score_range": max(scores) - min(scores) if scores else None,
                        "best_rank": min(ranks) if ranks else None, "worst_rank": max(ranks) if ranks else None,
                        "rank_span": max(ranks) - min(ranks) if ranks else None, "weight_set_count": len(rows)})
            result["files"]["regions_gpkg"] = _region_file(directory, regions, crs)
            export_completed += 1
            progress.update("export", "Export scenario results",
                            export_completed, export_total, "files",
                            detail="Retained source-bound analysis geography")
            for name, rows in (("physical", result["physical"]), ("pairwise", result["pairs"]),
                               ("priority", result["priority"]), ("sensitivity", result["sensitivity"])):
                result["files"][name + "_csv"] = _csv_file(directory, name + "-summary.csv", rows)
                export_completed += 1
                progress.update("export", "Export scenario results",
                                export_completed, export_total, "files",
                                detail="Retained " + name + " quantities")
            progress.update("export", "Export scenario results",
                            export_completed, export_total, "files",
                            detail="All scenario outputs retained", force=True)
            result["source_artifacts"] = [
                {"run_id": run["id"], "pollutant": name, "scope": "workspace",
                 **{**run["artifacts"][name], "path": (Path("runs") / run["id"] / run["artifacts"][name]["path"]).as_posix()}}
                for run in runs for name in pollutants]
            future_ids = [run["id"] for run in run_details
                          if run["comparison_kind"] == "landcover" and run["scenario_kind"] == "landcover"]
            result["map_families"] = {
                "current_nutrient_export": {"run_id": ids[0], "source_pollutants": ["nitrogen_export", "phosphorus_export"]},
                "current_sediment_export": {"run_id": ids[0], "source_pollutants": ["sediment_export"]},
                "future_nutrient_runoff": {"alternatives": [
                    {"run_id": run_id, "files": ["delta_" + run_id + "_" + name for name in ("nitrogen_export", "phosphorus_export")]}
                    for run_id in future_ids]},
                "future_sediment_loss": {"alternatives": [
                    {"run_id": run_id, "files": ["delta_" + run_id + "_sediment_export"]} for run_id in future_ids]},
                "critical_drinking_water": {"regions": [r["id"] for r in regions if r["map_family"] == "critical_drinking_water"],
                                            "file": "priority_" + ids[0]},
                "high_quality_waters": {"regions": [r["id"] for r in regions if r["map_family"] == "high_quality_waters"],
                                        "file": "priority_" + ids[0]},
                "combined_pollutant_export": {"files": ["priority_" + run_id for run_id in ids],
                                              "weight_spread_files": ["weight_spread_" + run_id for run_id in ids]}}
            if pollutants != POLLUTANTS:
                for names, current_family, future_family in (
                    (("nitrogen_export", "phosphorus_export"), "current_nutrient_export", "future_nutrient_runoff"),
                    (("sediment_export",), "current_sediment_export", "future_sediment_loss")):
                    if not set(names).issubset(pollutants):
                        reason = "These outputs are outside the native models shared by every selected run"
                        result["map_families"][current_family] = {
                            "available": False, "reason": reason, "source_pollutants": []}
                        result["map_families"][future_family] = {
                            "available": False, "reason": reason, "alternatives": []}
                result["map_families"]["combined_pollutant_export"]["source_pollutants"] = list(pollutants)
            result["interpretation"] = {
                "physical_change": "Alternative minus baseline; positive means increased modeled export",
                "decrease_sum": "Positive magnitude of decreases, retained separately from increases and net change",
                "priority": "Dimensionless planning score on frozen baseline caps; annual pollutant masses remain separate",
                "weight_spread": "Sensitivity to the supplied decision weights, with physical model outputs unchanged",
                "ranking": "Descending mean planning score within explicitly shared rank_group; exact ties share competition rank",
                "rank_span": "Highest minus lowest rank over supplied weight sets",
                "rank_change": "Alternative minus baseline rank; negative means moving toward higher export priority",
                "score_range": "Range of the region mean score across supplied weight sets; pixel weight-spread rasters describe each cell separately",
                "pareto": "Same-profile selections for which no other selection has lower or equal export of every compared pollutant and strictly lower export of at least one",
                "model_scope": "Quantities, comparisons and Pareto axes use the native pollutant outputs shared by every selected run; each original run retains its additional available exports",
                "geography": "Source-zone overlap and declared buffers describe location; legal classifications and downstream influence retain their original source meanings",
                "region_totals": "Zones may overlap; their totals are independent and must not be added as a basin mass balance",
                "percent_change": "Undefined with zero baseline or no common cells; percentage status is retained",
                "mixed": "Changing both land cover and parameter profile is a joint experiment; the result is not assigned to one cause"}
            result.update(state="complete", completed_at=now())
            progress.finish(comparison_completed, comparison_total,
                            str(export_completed) + " output files; " + str(len(ids)) +
                            " runs; " + str(len(regions)) + " reporting regions")
            # The original project JSON serializer rejects nonfinite output sums.
            _persist(directory, result)
            return _response(directory, result)
        except BaseException as error:
            progress.failed()
            result.update(state="failed", updated_at=now(),
                          error={"type": type(error).__name__, "message": str(error)})
            _persist(directory, result)
            raise
