"""Decision analysis for completed Upper Savannah model scenarios.

Reads original completed runs or an explicit physical-results packet. It does
not schedule model runs. Each candidate is a whole modeled scenario.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import shutil
import statistics
import tempfile
import zipfile
from contextlib import ExitStack
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath

REPORT_SCHEMA = "upstate.decision-report/v1"
INPUT_SCHEMA = "upstate.decision-input/v1"
SELECTION_SCHEMA = "upstate.decision-selection/v1"
METRICS = ("nitrogen_export", "phosphorus_export", "sediment_export")
UNITS = {"nitrogen_export": "kg/year", "phosphorus_export": "kg/year",
         "sediment_export": "t/year"}
LABELS = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
          "sediment_export": "Sediment"}
TEMPLATE_MARKER = "<!--DECISION_REPORT_DATA-->"


class DecisionError(ValueError):
    """An exact original input or economic selection needs correction."""



def _native_helpers():
    # Keep explicit physical-packet analysis usable without loading GIS/native
    # dependencies. Original workspace/report intake uses this sibling helper.
    if __package__:
        from .native_versions import comparison_versions, model_versions, models_for_outputs
    else:
        import sys
        root = str(Path(__file__).resolve().parent.parent)
        added = root not in sys.path
        if added:
            sys.path.insert(0, root)
        try:
            from model.native_versions import comparison_versions, model_versions, models_for_outputs
        finally:
            if added:
                sys.path.remove(root)
    return comparison_versions, model_versions, models_for_outputs


def _native_cohort(runs, metrics):
    compare, _, models = _native_helpers()
    try:
        return compare(runs, models(metrics))
    except ValueError as error:
        raise DecisionError(str(error)) from error


def _packet_version_vector(item, metrics):
    """Read immutable packet provenance, leaving legacy packets unchanged."""
    versions = item.get("model_versions")
    if versions is None:
        return None
    if not isinstance(versions, dict):
        raise DecisionError("Native model versions must retain their original per-model records")
    selected = (("ndr",) if any(name in metrics for name in ("nitrogen_export", "phosphorus_export")) else ()) + (
                ("sdr",) if "sediment_export" in metrics else ())
    return {name: _text((versions.get(name) or {}).get("comparison_version"),
                        "Retained " + name.upper() + " execution version") for name in selected}


def _packet_pair_versions(base, alternative, metrics):
    before, after = _packet_version_vector(base, metrics), _packet_version_vector(alternative, metrics)
    if before is not None or after is not None:
        if before is None or after is None or before != after:
            raise DecisionError("Each physical alternative needs its baseline's executed versions for the selected native models")


def _version_available_alternatives(base, alternatives, metrics, comparison_id):
    cohort = _native_cohort([base], metrics)
    kept, unavailable = [], []
    for item in alternatives:
        try:
            _native_cohort([base, item["run"]], metrics)
            kept.append(item)
        except DecisionError as error:
            unavailable.append({"comparison_id": comparison_id, "run_id": item["run"]["id"],
                                "reason": str(error), "error_type": type(error).__name__})
    return kept, unavailable, cohort["runs"][base["id"]]

def _metric_names(outputs):
    """Return the declared modeled pollutant axes in their canonical order."""
    if not isinstance(outputs, dict):
        raise DecisionError("Physical outputs must be keyed by their modeled pollutant roles")
    return tuple(metric for metric in METRICS if metric in outputs)


def _item_metrics(item):
    return _metric_names(item.get("outputs", {}))


def _pollutants(value):
    """Validate an explicit nonempty set of original physical output roles."""
    if (not isinstance(value, list) or not value
            or any(not isinstance(name, str) or name not in METRICS for name in value)
            or len(set(value)) != len(value)):
        raise DecisionError("pollutants must select distinct nitrogen_export, phosphorus_export or sediment_export roles")
    return tuple(name for name in METRICS if name in value)


def comparison_metrics(comparison, base, alternatives):
    """Read the original comparison's completed common output scope."""
    common = set(_metric_names(base.get("artifacts", {})))
    declared = comparison.get("common_artifacts")
    if declared is not None:
        common &= set(_pollutants(declared))
    scopes = comparison.get("model_scopes", {})
    for run in [base] + [item["run"] for item in alternatives]:
        common &= set(_metric_names(run.get("artifacts", {})))
        scope = scopes.get(run["id"])
        if isinstance(scope, dict) and "expected_artifacts" in scope:
            common &= set(scope["expected_artifacts"])
    for item in alternatives:
        common &= set(_metric_names(item["original"].get("artifacts", {})))
    return tuple(name for name in METRICS if name in common)


def _workspace_metrics(selection, groups):
    available = [comparison_metrics(original, base, alternatives)
                 for original, base, _, alternatives, _ in groups]
    common = set.intersection(*(set(names) for names in available)) if available else set()
    chosen = _pollutants(selection["pollutants"]) if "pollutants" in selection else tuple(
        name for name in METRICS if name in common)
    if not chosen:
        raise DecisionError("The original comparisons share no completed pollutant output; select a compatible cohort")
    missing = [{"comparison_id": group[0]["id"],
                "unavailable_pollutants": [name for name in chosen if name not in names]}
               for group, names in zip(groups, available) if set(chosen) - set(names)]
    if missing:
        raise DecisionError("Selected pollutants require a retained native output in every comparison: " +
                            json.dumps(missing, sort_keys=True))
    return chosen, {
        "selected": list(chosen), "requested": selection.get("pollutants"),
        "available_by_comparison": {group[0]["id"]: list(names)
                                    for group, names in zip(groups, available)},
        "omitted": [name for name in METRICS if name not in chosen],
        "method": "Original comparison common_artifacts, completed run scopes and retained artifact intersection; explicit selection may narrow this scope.",
    }


def _scoped_packet(packet, selection):
    """Project an explicit pollutant selection without changing the source packet."""
    if "pollutants" not in selection:
        return packet
    chosen = _pollutants(selection["pollutants"])
    result = json.loads(_canonical(packet))
    available = {}
    for group in result.get("comparisons", []):
        members = [group["baseline"]] + group.get("alternatives", [])
        common = set.intersection(*(set(_item_metrics(item)) for item in members))
        if set(chosen) - common:
            raise DecisionError("The original physical packet lacks selected outputs in comparison " + group["id"])
        available[group["id"]] = [name for name in METRICS if name in common]
        for item in members:
            item["outputs"] = {name: item["outputs"][name] for name in chosen}
    prior = result.get("pollutant_selection")
    result["pollutant_selection"] = {
        "selected": list(chosen), "requested": list(chosen),
        "available_by_comparison": available,
        "omitted": [name for name in METRICS if name not in chosen],
        "method": "Explicit subset of retained original physical outputs; source packet and physical-source provenance preserved.",
        "source_selection": prior,
    }
    return result


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hash(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _number(value, label, *, minimum=None, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DecisionError(label + " must be a finite number")
    value = float(value)
    if not math.isfinite(value) or (minimum is not None and value < minimum):
        raise DecisionError(label + " is outside its supported numeric range")
    return value


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise DecisionError(label + " must be nonempty text")
    return value.strip()


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise DecisionError("Use the original 64-character workspace identity")
    return value


def _pairs(rows):
    result = {}
    for key, value in rows:
        if key in result:
            raise DecisionError("JSON contains duplicate key: " + key)
        result[key] = value
    return result


def read_json(path):
    def invalid(value):
        raise DecisionError("JSON contains nonfinite value: " + value)
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      object_pairs_hook=_pairs, parse_constant=invalid)


def _relative(root, name, *, exists=True):
    if not isinstance(name, str) or "\\" in name or ":" in name:
        raise DecisionError("Use an original relative artifact path")
    parts = PurePosixPath(name)
    if parts.is_absolute() or not parts.parts or any(p in ("..", ".") for p in parts.parts):
        raise DecisionError("Artifact path must remain inside its original directory")
    path = root.joinpath(*parts.parts)
    resolved = path.resolve(strict=exists)
    if not resolved.is_relative_to(root.resolve()):
        raise DecisionError("Artifact leaves its original directory: " + name)
    if exists and not resolved.is_file():
        raise DecisionError("Original artifact is not a file: " + name)
    return resolved


def _descriptor(path, root, role):
    body = path.read_bytes()
    return {"role": role, "path": path.relative_to(root).as_posix(),
            "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


class _Reader:
    def __init__(self, workspace):
        self.root = Path(getattr(workspace, "root", workspace)).resolve()
        self.sources = {}
        self.project = self.json("workspace.json", "workspace")
        if not isinstance(self.project.get("id"), str):
            raise DecisionError("Original workspace.json lacks its project identity")

    def json(self, name, role):
        path = _relative(self.root, name)
        result = read_json(path)
        self.sources[name] = _descriptor(path, self.root, role)
        return result

    def run(self, key):
        key = _identifier(key)
        value = self.json("runs/" + key + "/run.json", "completed_run")
        if value.get("id") != key or value.get("state") != "complete":
            raise DecisionError("Select a completed original run: " + key)
        for field in ("grid_id", "scenario_id", "profile_id"):
            _identifier(value["selection"][field])
        return value

    def scenario(self, key):
        key = _identifier(key)
        return {"id": key, **self.json("scenarios/" + key + ".json", "scenario")}

    def comparison(self, key):
        key = _identifier(key)
        value = self.json("comparisons/" + key + "/comparison.json", "comparison")
        if value.get("id") != key or value.get("direction") != "alternative minus baseline":
            raise DecisionError("Select an original alternative-minus-baseline comparison")
        if not value.get("alternatives"):
            raise DecisionError("The comparison needs at least one completed alternative")
        return value

    def raster(self, run, metric):
        artifact = dict(run["artifacts"][metric])
        path = _relative(self.root / "runs" / run["id"], artifact["path"])
        expected_bytes = artifact.get("bytes")
        if expected_bytes is not None and path.stat().st_size != expected_bytes:
            raise DecisionError("Original raster size changed: " + artifact["path"])
        _identifier(artifact["sha256"])
        record = {"role": "modeled_raster", "path": path.relative_to(self.root).as_posix(),
                  "bytes": path.stat().st_size, "sha256": artifact["sha256"],
                  "hash_source": "original completed run record"}
        self.sources[record["path"]] = record
        return path, artifact


def _scenario_key(scenario):
    patches = []
    for patch in scenario.get("patches", []):
        patch = {k: v for k, v in patch.items() if k not in ("title", "reason", "notes")}
        if "from_codes" in patch:
            patch["from_codes"] = sorted(set(patch["from_codes"]))
        patches.append(patch)
    return _hash({"kind": scenario.get("kind"),
                  "source_collection_id": scenario.get("source_collection_id"),
                  "patches": patches})


def _unit(value):
    original = _text(value, "Physical units")
    value = original.lower().replace("_", " ").replace("metric tonnes", "t").replace("metric tonne", "t")
    value = value.replace("tonnes", "t").replace("tonne", "t")
    value = value.replace("kilograms", "kg").replace("kilogram", "kg")
    value = value.replace("years", "year").replace("yr", "year")
    value = value.replace(" per ", "/").replace(" ", "")
    aliases = {}
    for mass in ("kg", "t"):
        for annual in (mass + "/year", mass + "year-1", mass + "year^-1"):
            aliases[annual] = (mass, "annual_mass")
        for denominator, basis in (("pixel", "mass_per_pixel"), ("ha", "density_per_hectare")):
            for spelling in (mass + "/" + denominator + "/year",
                             mass + "/" + denominator + "/year-1",
                             mass + denominator + "-1year-1",
                             mass + denominator + "^-1year^-1"):
                aliases[spelling] = (mass, basis)
    if value not in aliases:
        raise DecisionError("Unsupported or ambiguous physical units: " + original)
    return aliases[value]


def _factor(metric, units, *, pixel_area_ha=None, raster=False, unit_basis=None):
    mass, basis = _unit(units)
    if raster and basis == "annual_mass":
        if unit_basis != "mass_per_pixel":
            raise DecisionError("Raster annual-mass units need explicit mass_per_pixel basis")
        basis = "mass_per_pixel"
    factor = (1000.0 if mass == "t" else 1.0) / (1000.0 if metric == "sediment_export" else 1.0)
    if basis == "density_per_hectare":
        area = _number(pixel_area_ha, "Original cell area in hectares", minimum=0)
        if not area:
            raise DecisionError("Density conversion needs a positive original cell area")
        factor *= area
    return factor, {"input_units": units, "basis": basis, "factor": factor,
                    "pixel_area_ha": pixel_area_ha, "annual_units": UNITS[metric]}


def _summary(artifact, metric):
    units = artifact.get("sum_units") or artifact.get("units")
    if not units:
        raise DecisionError("Original summary needs explicit sum_units or raster units")
    factor, normalization = _factor(metric, units, pixel_area_ha=artifact.get("pixel_area_ha"))
    amount = _number(artifact.get("sum"), "Original " + metric + " sum") * factor
    return {"total": amount, "units": UNITS[metric],
            "valid_cells": artifact.get("valid_cells"),
            "pixel_area_ha": artifact.get("pixel_area_ha"), "normalization": normalization,
            "artifact": {k: artifact[k] for k in ("path", "sha256", "bytes") if k in artifact}}


def _original_group(reader, key):
    comparison = reader.comparison(key)
    base = reader.run(comparison["baseline_run_id"])
    baseline_scenario = reader.scenario(base["selection"]["scenario_id"])
    if baseline_scenario.get("kind") != "baseline":
        raise DecisionError("The selected comparison must start with its original baseline")
    alternatives, unavailable, seen = [], [], set()
    for item in comparison["alternatives"]:
        try:
            run = reader.run(item["run_id"])
            selection = run["selection"]
            if (selection["grid_id"] != base["selection"]["grid_id"] or
                    selection["profile_id"] != base["selection"]["profile_id"]):
                raise DecisionError("Alternative requires its baseline on the same grid and parameter profile")
            scenario = reader.scenario(selection["scenario_id"])
            if scenario.get("kind") != "landcover":
                raise DecisionError("Alternative is not an original land-cover scenario")
            semantic = _scenario_key(scenario)
            if semantic in seen:
                raise DecisionError("Comparison repeats one physical scenario definition")
            seen.add(semantic)
            alternatives.append({"run": run, "scenario": scenario, "original": item,
                                 "scenario_key": semantic})
        except (DecisionError, OSError, KeyError, TypeError, ValueError) as error:
            unavailable.append({"comparison_id": key, "run_id": item.get("run_id"),
                                "reason": str(error), "error_type": type(error).__name__})
    reader.json("grids/" + base["selection"]["grid_id"] + "/grid.json", "grid")
    reader.json("profiles/" + base["selection"]["profile_id"] + ".json", "parameter_profile")
    return comparison, base, baseline_scenario, alternatives, unavailable


def _raster_header(source, artifact, metric):
    """Validate the physical conversion and exact grid before accepting a raster."""
    if source.count != 1 or source.crs is None or not source.crs.is_projected:
        raise DecisionError("Modeled rasters need one band and their original projected CRS")
    if str(source.crs.linear_units).lower() not in ("metre", "meter", "metres", "meters", "m"):
        raise DecisionError("The original grid must declare metre linear units")
    area = abs(source.transform.a * source.transform.e - source.transform.b * source.transform.d) / 10000.0
    if not math.isfinite(area) or area <= 0:
        raise DecisionError("Original raster cell area is not positive")
    conversion = _factor(metric, artifact.get("units"), pixel_area_ha=area,
                         raster=True, unit_basis=artifact.get("unit_basis"))
    return (source.count, source.width, source.height, source.crs, source.transform), area, conversion


def _available_alternatives(reader, comparison, base, alternatives, *, summary_only, metrics=None):
    """Resolve candidate files before forming the common support of available runs."""
    available, unavailable = [], []
    metrics = comparison_metrics(comparison, base, alternatives) if metrics is None else tuple(metrics)
    if not metrics:
        raise DecisionError("The baseline has no completed supported pollutant exports")
    if not summary_only:
        try:
            import rasterio
        except ImportError as error:
            raise DecisionError("Use the existing Rasterio GIS runtime, or choose --summary-only") from error
        references = {}
        for metric in metrics:
            path, artifact = reader.raster(base, metric)
            with rasterio.open(path) as source:
                references[metric], _, _ = _raster_header(source, artifact, metric)
    for item in alternatives:
        try:
            for metric in metrics:
                if summary_only:
                    _summary(item["run"]["artifacts"][metric], metric)
                    _summary(item["original"]["artifacts"][metric], metric)
                else:
                    path, artifact = reader.raster(item["run"], metric)
                    with rasterio.open(path) as source:
                        current, _, _ = _raster_header(source, artifact, metric)
                        if current != references[metric]:
                            raise DecisionError("Alternative raster differs from the baseline dimensions, CRS or cell alignment")
            available.append(item)
        except Exception as error:
            unavailable.append({"comparison_id": comparison["id"], "run_id": item["run"]["id"],
                                "reason": str(error), "error_type": type(error).__name__})
    return available, unavailable


def _raster_group(reader, comparison, base, alternatives, *, metrics=None):
    try:
        import numpy as np
        import rasterio
        from rasterio.windows import Window
    except ImportError as error:
        raise DecisionError("Use the existing Rasterio/NumPy GIS runtime for same-cell analysis, or select --summary-only for the original recorded summaries") from error
    runs = [base] + [item["run"] for item in alternatives]
    baseline_outputs, all_outputs = {}, {run["id"]: {} for run in runs[1:]}
    selected = comparison_metrics(comparison, base, alternatives) if metrics is None else tuple(metrics)
    for metric in selected:
        originals = [reader.raster(run, metric) for run in runs]
        with ExitStack() as stack:
            datasets = [stack.enter_context(rasterio.open(path)) for path, _ in originals]
            first = datasets[0]
            headers = [_raster_header(source, artifact, metric)
                       for source, (_, artifact) in zip(datasets, originals)]
            if any(header[0] != headers[0][0] for header in headers[1:]):
                raise DecisionError("Scenario rasters differ in dimensions, CRS or exact cell alignment")
            area = headers[0][1]
            conversions = [header[2] for header in headers]
            before_stats = [(p.stat().st_size, p.stat().st_mtime_ns) for p, _ in originals]
            own_parts = [[] for _ in runs]
            shared_parts = [[] for _ in runs]
            own_counts, shared_count = [0 for _ in runs], 0
            support = hashlib.sha256(_canonical({"grid_id": base["selection"]["grid_id"],
                "width": first.width, "height": first.height,
                "transform": list(first.transform), "mask_method": "shared-finite-v1"}))
            for row in range(0, first.height, 512):
                for col in range(0, first.width, 512):
                    window = Window(col, row, min(512, first.width - col), min(512, first.height - row))
                    values, masks = [], []
                    for index, source in enumerate(datasets):
                        data = source.read(1, window=window, masked=True)
                        valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
                        if np.any(data.data[valid] < 0):
                            raise DecisionError("Original physical export raster contains negative finite cells")
                        values.append(data.data)
                        masks.append(valid)
                        own_counts[index] += int(np.count_nonzero(valid))
                        own_parts[index].append(float(np.sum(data.data[valid], dtype="float64")) * conversions[index][0])
                    common = np.logical_and.reduce(masks)
                    shared_count += int(np.count_nonzero(common))
                    support.update(_canonical([row, col, int(window.height), int(window.width)]))
                    support.update(np.packbits(common, bitorder="little").tobytes())
                    for index, data in enumerate(values):
                        shared_parts[index].append(float(np.sum(data[common], dtype="float64")) * conversions[index][0])
            after_stats = [(p.stat().st_size, p.stat().st_mtime_ns) for p, _ in originals]
            if before_stats != after_stats:
                raise DecisionError("A modeled raster changed during decision analysis; reopen the completed run")
            if not shared_count:
                raise DecisionError("The selected " + metric + " rasters share no finite supported cells")
            own = [math.fsum(parts) for parts in own_parts]
            shared = [math.fsum(parts) for parts in shared_parts]
            descriptor = {k: originals[0][1][k] for k in ("path", "sha256", "bytes") if k in originals[0][1]}
            baseline_outputs[metric] = {"total": own[0], "units": UNITS[metric],
                "valid_cells": own_counts[0], "pixel_area_ha": area,
                "normalization": conversions[0][1], "artifact": descriptor}
            for index, item in enumerate(alternatives, 1):
                original = item["original"]["artifacts"][metric]
                reduction = shared[0] - shared[index]
                all_outputs[runs[index]["id"]][metric] = {
                    "baseline": shared[0], "alternative": shared[index],
                    "delta": -reduction, "reduction": reduction,
                    "reduction_percent": 100.0 * reduction / shared[0] if shared[0] else None,
                    "units": UNITS[metric], "baseline_valid_cells": own_counts[0],
                    "alternative_valid_cells": own_counts[index],
                    "comparison_valid_cells": shared_count,
                    "baseline_total_all_valid": own[0], "alternative_total_all_valid": own[index],
                    "support": {"status": "paired", "id": support.hexdigest(),
                        "valid_cells": shared_count, "area_ha": shared_count * area,
                        "pixel_area_ha": area,
                        "baseline_fraction": shared_count / own_counts[0] if own_counts[0] else None,
                        "alternative_fraction": shared_count / own_counts[index] if own_counts[index] else None,
                        "members": [run["id"] for run in runs],
                        "detail": "Common finite cells across the baseline and every alternative in this comparison; original reporting-raster pixel support"},
                    "normalization": {"baseline": conversions[0][1], "alternative": conversions[index][1]},
                    "artifact": {k: original[k] for k in ("path", "sha256", "bytes") if k in original}}
    return baseline_outputs, all_outputs


def _summary_group(comparison, base, alternatives, *, metrics=None):
    metrics = comparison_metrics(comparison, base, alternatives) if metrics is None else tuple(metrics)
    baseline_outputs = {metric: _summary(base["artifacts"][metric], metric) for metric in metrics}
    outputs = {}
    for item in alternatives:
        row = {}
        for metric in metrics:
            before = baseline_outputs[metric]
            after = _summary(item["run"]["artifacts"][metric], metric)
            delta = _summary(item["original"]["artifacts"][metric], metric)
            row[metric] = {"baseline": before["total"], "alternative": after["total"],
                "delta": delta["total"], "reduction": -delta["total"], "reduction_percent": None,
                "units": UNITS[metric], "baseline_valid_cells": before["valid_cells"],
                "alternative_valid_cells": after["valid_cells"],
                "comparison_valid_cells": delta["valid_cells"],
                "support": {"status": "summary", "id": None,
                    "detail": "Original saved comparison sums; identical shared support has not been measured in this summary export"},
                "artifact": delta["artifact"]}
        outputs[item["run"]["id"]] = row
    return baseline_outputs, outputs


def workspace_packet(workspace, selection, *, summary_only=False):
    """Read existing comparisons; raster mode makes one shared pass per pollutant."""
    reader = _Reader(workspace)
    ids = [selection["comparison_id"]] + list(selection.get("sensitivity_comparison_ids", []))
    if len(set(ids)) != len(ids):
        raise DecisionError("Select each original comparison once")
    resolved = [_original_group(reader, key) for key in ids]
    metrics, pollutant_selection = _workspace_metrics(selection, resolved)
    groups, unavailable = [], []
    for original, base, scenario, alternatives, missing in resolved:
        unavailable.extend(missing)
        alternatives, missing, baseline_versions = _version_available_alternatives(
            base, alternatives, metrics, original["id"])
        unavailable.extend(missing)
        alternatives, missing = _available_alternatives(reader, original, base, alternatives,
                                                        summary_only=summary_only, metrics=metrics)
        unavailable.extend(missing)
        base_outputs, outputs = (_summary_group(original, base, alternatives, metrics=metrics) if summary_only or not alternatives
                                 else _raster_group(reader, original, base, alternatives, metrics=metrics))
        groups.append({"id": original["id"],
            "baseline": {"run_id": base["id"], "scenario_id": scenario["id"],
                "scenario_key": _scenario_key(scenario), "title": scenario["title"],
                "profile_id": base["selection"]["profile_id"], "grid_id": base["selection"]["grid_id"],
                "invest_version": base["selection"].get("invest_version"),
                "model_versions": baseline_versions, "outputs": base_outputs},
            "alternatives": [{"run_id": item["run"]["id"], "scenario_id": item["scenario"]["id"],
                "scenario_key": item["scenario_key"], "label": item["scenario"]["title"],
                "kind": item["scenario"]["kind"], "profile_id": item["run"]["selection"]["profile_id"],
                "outputs": outputs[item["run"]["id"]],
                "invest_version": item["run"]["selection"].get("invest_version"),
                "model_versions": _native_cohort([item["run"]], metrics)["runs"][item["run"]["id"]],
                "source_edits": item["run"].get("stages", {}).get("landcover", {}).get("edits"),
                "scenario_definition": item["scenario"]}
                for item in alternatives]})
    packet = {"schema": INPUT_SCHEMA, "project": reader.project, "comparisons": groups,
              "sources": list(reader.sources.values()), "unavailable_alternatives": unavailable,
              "pollutant_selection": pollutant_selection}
    if selection.get("delivery_id"):
        packet["parcel_inventory"] = _parcel_input(reader, selection["delivery_id"], groups[0])
        packet["sources"] = list(reader.sources.values())
    return packet


def _parcel_input(reader, delivery_id, comparison):
    delivery_id = _identifier(delivery_id)
    prefix = "deliveries/" + delivery_id + "/"
    state = reader.json(prefix + "delivery-state.json", "delivery")
    if state.get("state") != "complete" or state.get("id") != delivery_id:
        raise DecisionError("Select a complete original parcel delivery")
    chosen = state["selection"]
    if chosen.get("baseline_run_id") != comparison["baseline"]["run_id"]:
        raise DecisionError("Parcel delivery has a different baseline")
    available = set(chosen.get("scenario_run_ids", []))
    if any(item["run_id"] not in available for item in comparison["alternatives"]):
        raise DecisionError("Parcel delivery does not contain every selected alternative")
    inventory = state.get("parcel_priorities")
    if not inventory:
        raise DecisionError("The selected delivery has no original parcel inventory")
    descriptor = state["files"]["parcel_csv"]
    name = prefix + descriptor["path"]
    path = _relative(reader.root, name)
    actual = _descriptor(path, reader.root, "parcel_csv")
    if actual["sha256"] != descriptor["sha256"] or actual["bytes"] != descriptor["bytes"]:
        raise DecisionError("Original parcel CSV changed")
    reader.sources[name] = actual
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    return {"delivery_id": delivery_id, "source": inventory.get("source"),
            "coverage": inventory.get("parcel_coverage"),
            "overlap_handling": inventory.get("overlap_handling"),
            "rows": rows}


def _costs(selection, run_ids):
    result = {}
    for value in selection.get("costs", []):
        run_id = _identifier(value["run_id"])
        if run_id not in run_ids or run_id in result:
            raise DecisionError("Cost entries must each name one selected reference alternative")
        currency = _text(value.get("currency"), "Cost currency").upper()
        if not re.fullmatch("[A-Z]{3}", currency):
            raise DecisionError("Use a three-letter cost currency")
        capital = _number(value.get("capital"), "Capital cost", minimum=0)
        annual = _number(value.get("annual_operating"), "Annual operating cost", minimum=0)
        horizon = _number(value.get("horizon_years"), "Cost horizon", minimum=0)
        rate = _number(value.get("discount_rate"), "Real discount rate", minimum=0)
        if horizon <= 0:
            raise DecisionError("Cost horizon must be positive")
        present_factor = horizon if rate == 0 else -math.expm1(-horizon * math.log1p(rate)) / rate
        if not math.isfinite(present_factor) or present_factor <= 0:
            raise DecisionError("Cost horizon and discount rate do not produce a finite positive present factor")
        annualized = capital / present_factor + annual
        present_value = capital + annual * present_factor
        if not all(math.isfinite(x) for x in (present_factor, annualized, present_value)):
            raise DecisionError("Cost horizon and discount rate overflow the annualization")
        source = value.get("source")
        if not isinstance(source, dict):
            raise DecisionError("Each cost needs its actual source title, reference and as-of date")
        source = {field: _text(source.get(field), "Cost source " + field) for field in ("title", "uri", "as_of")}
        try:
            date.fromisoformat(source["as_of"])
        except ValueError as error:
            raise DecisionError("Cost source as_of must be an ISO calendar date") from error
        result[run_id] = {"currency": currency, "capital": capital, "annual_operating": annual,
            "horizon_years": horizon, "discount_rate": rate, "present_value": present_value,
            "annualized": annualized, "source": source, "note": str(value.get("note", "")),
            "cost_basis": "Capital plus constant annual operating cost; real discount rate; no monetized environmental benefit"}
    return result


def _assessment(selection, metrics=METRICS):
    targets = selection.get("targets") or {}
    if not isinstance(targets, dict) or any(k not in METRICS for k in targets):
        raise DecisionError("Targets use nitrogen_export, phosphorus_export and sediment_export")
    targets = {key: _number(value, key + " reduction target", minimum=0) for key, value in targets.items()}
    budget = selection.get("budget")
    if budget:
        currency = _text(budget.get("currency"), "Budget currency").upper()
        if not re.fullmatch("[A-Z]{3}", currency):
            raise DecisionError("Use a three-letter budget currency")
        limits = {key: _number(budget[key], key, minimum=0)
                  for key in ("capital_limit", "annualized_limit") if key in budget}
        if not limits:
            raise DecisionError("A budget needs a capital or annualized limit")
        budget = {"currency": currency, **limits}
    return {"budget": budget or None, "targets": targets,
            "pareto_objectives": ["maximize_" + metric + "_reduction" for metric in metrics]}


def _scenario_source(path):
    """Read the actual ASTRA-S1 native report and retain its exact source bytes."""
    path = Path(path).resolve()
    body = path.read_bytes()
    def invalid(value):
        raise DecisionError("Native report JSON contains nonfinite value: " + value)
    report = json.loads(body, object_pairs_hook=_pairs, parse_constant=invalid)
    if report.get("schema") != "upstate.scenario-decisions/v1":
        raise DecisionError("Select the original upstate.scenario-decisions/v1 report.json")
    summary_source = None
    if isinstance(report.get("runs"), int) and isinstance(report.get("zones"), int):
        summary, summary_path, summary_body = report, path, body
        artifact = summary.get("files", {}).get("json")
        if not isinstance(artifact, dict):
            raise DecisionError("Select report.json or retain the completed decision.json files.json descriptor")
        path = _relative(summary_path.parent, artifact["path"])
        body = path.read_bytes()
        if (len(body) != artifact["bytes"]
                or hashlib.sha256(body).hexdigest() != _identifier(artifact["sha256"])):
            raise DecisionError("Original native report differs from its completed decision.json descriptor")
        report = json.loads(body, object_pairs_hook=_pairs, parse_constant=invalid)
        if (report.get("schema") != summary["schema"] or report.get("id") != summary["id"]
                or report.get("selection") != summary["selection"]):
            raise DecisionError("Resolved native report differs from its completed summary identity")
        summary_source = {"path": str(summary_path), "bytes": len(summary_body),
                          "sha256": hashlib.sha256(summary_body).hexdigest()}
    if not isinstance(report.get("runs"), list) or not isinstance(report.get("zones"), list):
        raise DecisionError("Native report.json must contain the original run and reporting-zone records")
    _identifier(report.get("id"))
    _identifier(report.get("grid_id"))
    _source_metrics(report)
    ids = report.get("selection", {}).get("run_ids")
    if not isinstance(ids, list) or len(ids) < 2 or len(set(ids)) != len(ids):
        raise DecisionError("Native report needs its ordered distinct baseline and alternatives")
    for key in ids:
        _identifier(key)
    if report.get("baseline_run_id") != ids[0]:
        raise DecisionError("Native report baseline differs from its selected first run")
    details = {item["id"]: item for item in report.get("runs", [])}
    if len(details) != len(report.get("runs", [])) or set(details) != set(ids):
        raise DecisionError("Native report must retain every selected run exactly once")
    zone_ids = [zone.get("id") for zone in report.get("zones", [])]
    if len(set(zone_ids)) != len(zone_ids):
        raise DecisionError("Native report repeats a reporting-zone identity")
    source = {"role": "native_scenario_report", "path": str(path), "bytes": len(body),
              "sha256": hashlib.sha256(body).hexdigest()}
    if summary_source is not None:
        source["resolved_from_completed_summary"] = summary_source
    return report, source, body.decode("utf-8"), details


def _source_metrics(report):
    """Read the source producer's explicit nonempty pollutant selection."""
    outputs = report.get("outputs")
    known = ("nitrogen", "phosphorus", "sediment")
    if not isinstance(outputs, dict) or not outputs or any(key not in known for key in outputs):
        raise DecisionError("Native report must declare its actual supported pollutant outputs")
    selected = tuple(key for key in known if key in outputs)
    declared = report.get("pollutants")
    if declared is not None:
        if (not isinstance(declared, list) or len(set(declared)) != len(declared)
                or set(declared) != set(selected)):
            raise DecisionError("Native report pollutant selection differs from its output descriptors")
    return selected


def _source_comparison_id(report, source, zone_id):
    return _hash({"schema": "upstate.native-zone-decision/v1", "producer_report_id": report["id"],
                  "producer_report_sha256": source["sha256"], "zone_id": zone_id})


def _source_run(detail, report):
    key = _identifier(detail["id"])
    selection = detail["selection"]
    for field in ("grid_id", "profile_id", "scenario_id"):
        _identifier(selection[field])
    if selection["grid_id"] != report["grid_id"]:
        raise DecisionError("Native report run differs from its retained grid")
    scenario = detail["scenario"]
    if scenario.get("id") != selection["scenario_id"] or scenario.get("kind") != detail["scenario_kind"]:
        raise DecisionError("Native report scenario definition differs from its run selection")
    metrics = tuple(name + "_export" for name in _source_metrics(report))
    if detail.get("model_versions") is not None:
        selected_versions = _packet_version_vector(detail, metrics)
        versions = {name: detail["model_versions"][name] for name in selected_versions}
    else:
        # Older original reports retained only the last observed run runtime.
        # Label that fallback; never infer missing completed-stage provenance.
        versions = _native_cohort([detail], metrics)["runs"][key]
    version = selection.get("invest_version")
    # Requested identity and the original observed/stage provenance remain
    # separate. A newer observed execution does not rewrite its declaration.
    return {"run_id": key, "scenario_id": selection["scenario_id"],
            "scenario_key": _scenario_key(scenario), "profile_id": selection["profile_id"],
            "grid_id": selection["grid_id"], "invest_version": version,
            "model_versions": versions,
            "kind": scenario["kind"], "comparison_kind": detail.get("comparison_kind"),
            "label": detail.get("scenario_title") or scenario.get("title") or key,
            "scenario_definition": scenario, "source_edits": detail.get("landcover_edits", [])}


def inspect_scenario_report(path):
    """List actual reporting zones and profile-compatible whole scenario choices."""
    report, source, _, details = _scenario_source(path)
    base = _source_run(details[report["baseline_run_id"]], report)
    if base["kind"] != "baseline":
        raise DecisionError("Economic scenario decisions require the original baseline land cover")
    alternatives, unavailable = [], []
    for key in report["selection"]["run_ids"][1:]:
        try:
            item = _source_run(details[key], report)
            if (item["kind"] != "landcover" or item["comparison_kind"] != "landcover_under_common_profile"
                    or any(item[field] != base[field]
                           for field in ("profile_id", "grid_id"))):
                raise DecisionError("Use the land-cover alternative with its own matching baseline profile")
            _packet_pair_versions(base, item, tuple(name + "_export" for name in _source_metrics(report)))
            alternatives.append({k: item[k] for k in ("run_id", "scenario_id", "scenario_key", "label", "profile_id", "model_versions")})
        except (DecisionError, KeyError, TypeError, ValueError) as error:
            unavailable.append({"run_id": key, "reason": str(error), "error_type": type(error).__name__})
    zones = []
    for zone in report["zones"]:
        coverage = {key: value.get("coverage", {}) for key, value in zone.get("pollutants", {}).items()}
        reasons = ["No common native " + key + " export cells" for key in _source_metrics(report)
                   if not coverage.get(key, {}).get("common_valid_cells")]
        zones.append({"zone_id": zone["id"], "title": zone["title"], "scope": zone["scope"],
                      "area_ha": zone["area_ha"], "original_area_ha": zone["original_area_ha"],
                      "comparison_id": _source_comparison_id(report, source, zone["id"]),
                      "common_support_available": not reasons, "reasons": reasons,
                      "coverage": coverage, "source": zone["source"]})
    return {"producer_report_id": report["id"], "title": report["title"], "source": source,
            "pollutants": list(_source_metrics(report)),
            "project": report["project"], "baseline_run_id": base["run_id"],
            "alternatives": alternatives, "unavailable_alternatives": unavailable, "zones": zones}


def scenario_report_packet(path, zone_id):
    """Adapt one real native reporting zone; annual masses receive no second area conversion."""
    report, source, source_document, details = _scenario_source(path)
    zone_id = _text(zone_id, "Original reporting-zone ID")
    matches = [zone for zone in report["zones"] if zone.get("id") == zone_id]
    if len(matches) != 1:
        raise DecisionError("Select one original zone from scenario-inspect")
    zone = matches[0]
    ids = report["selection"]["run_ids"]
    comparison_id = _source_comparison_id(report, source, zone_id)
    base = _source_run(details[ids[0]], report)
    if base["kind"] != "baseline":
        raise DecisionError("Economic scenario decisions require the original baseline land cover")
    metric_map = {"nitrogen": "nitrogen_export", "phosphorus": "phosphorus_export",
                  "sediment": "sediment_export"}
    prepared, baseline_outputs = {}, {}
    for source_metric in _source_metrics(report):
        metric = metric_map[source_metric]
        unit = report["outputs"][source_metric]["units"]
        if _unit(unit)[1] != "annual_mass":
            raise DecisionError("The native zone report must supply already aggregated annual mass")
        factor, normalization = _factor(metric, unit)
        value = zone["pollutants"][source_metric]
        coverage = value["coverage"]
        count = _number(coverage.get("common_valid_cells"), "Native common valid cells", minimum=0)
        if count <= 0 or not count.is_integer():
            raise DecisionError("Selected zone has no complete shared " + source_metric + " export support")
        area = _number(coverage.get("common_valid_area_ha"), "Native common area", minimum=0)
        cell_area = _number(coverage.get("pixel_area_ha"), "Native cell area", minimum=0)
        if cell_area <= 0 or not math.isclose(area, count * cell_area, rel_tol=1e-9, abs_tol=1e-9):
            raise DecisionError("Native report common area differs from its recorded cell support")
        original_base = value["runs"][ids[0]]
        own_total = _number(original_base.get("all_valid_mass"), "Baseline native annual export", minimum=0) * factor
        common_total = _number(original_base.get("common_mass"), "Baseline common annual export", minimum=0) * factor
        artifact = {**source, "producer_report_id": report["id"], "zone_id": zone_id, "pollutant": source_metric}
        baseline_outputs[metric] = {"total": own_total, "units": UNITS[metric],
            "valid_cells": original_base["valid_cells"], "pixel_area_ha": cell_area,
            "normalization": normalization, "artifact": artifact,
            "source_statistics": original_base, "native_coverage": coverage}
        support_id = _hash({"basis": "producer_all_run_common_valid_support",
            "producer_report_sha256": source["sha256"], "producer_report_id": report["id"],
            "zone_id": zone_id, "pollutant": source_metric, "run_ids": ids})
        pairs = {item["run_id"]: item for item in value["alternatives"]}
        if len(pairs) != len(value["alternatives"]) or set(pairs) != set(ids[1:]):
            raise DecisionError("Native zone pollutant must retain each selected alternative exactly once")
        prepared[metric] = {"source_metric": source_metric, "factor": factor,
            "normalization": normalization, "source_value": value, "coverage": coverage,
            "common_baseline": common_total, "pairs": pairs, "artifact": artifact,
            "support_id": support_id, "count": int(count), "area": area, "cell_area": cell_area}
    alternatives, unavailable, seen = [], [], set()
    for key in ids[1:]:
        try:
            item = _source_run(details[key], report)
            if (item["kind"] != "landcover" or item["comparison_kind"] != "landcover_under_common_profile"
                    or any(item[field] != base[field]
                           for field in ("profile_id", "grid_id"))):
                raise DecisionError("Use the land-cover alternative with its own matching baseline profile")
            _packet_pair_versions(base, item, tuple(name + "_export" for name in _source_metrics(report)))
            if item["scenario_key"] in seen:
                raise DecisionError("The native report repeats one physical scenario definition")
            outputs = {}
            for metric, prepared_value in prepared.items():
                p = prepared_value
                original = p["pairs"][key]
                statistic = p["source_value"]["runs"][key]
                paired_base = _number(original.get("baseline_common_mass"), "Native paired baseline", minimum=0) * p["factor"]
                paired_alt = _number(original.get("alternative_common_mass"), "Native paired alternative", minimum=0) * p["factor"]
                statistic_alt = _number(statistic.get("common_mass"), "Native common alternative", minimum=0) * p["factor"]
                if (not math.isclose(paired_base, p["common_baseline"], rel_tol=1e-10, abs_tol=1e-10)
                        or not math.isclose(paired_alt, statistic_alt, rel_tol=1e-10, abs_tol=1e-10)):
                    raise DecisionError("Native alternative totals differ from its original all-run common statistics")
                baseline_cells = baseline_outputs[metric]["valid_cells"]
                alternative_cells = statistic["valid_cells"]
                support = {"status": "paired", "id": p["support_id"],
                    "id_kind": "producer_report_zone_cohort",
                    "valid_cells": p["count"], "area_ha": p["area"], "pixel_area_ha": p["cell_area"],
                    "baseline_fraction": p["count"] / baseline_cells if baseline_cells else None,
                    "alternative_fraction": p["count"] / alternative_cells if alternative_cells else None,
                    "members": ids, "producer_report_id": report["id"], "zone_id": zone_id,
                    "native_coverage": p["coverage"],
                    "detail": "Original producer guarantees common finite cells across every selected run in this reporting zone. Identity binds this exact source report, zone, pollutant and cohort; it does not equate masks from separate reports."}
                outputs[metric] = {"baseline": paired_base, "alternative": paired_alt,
                    "delta": _number(original.get("change_mass"), "Native export change") * p["factor"],
                    "reduction": _number(original.get("avoided_export_mass"), "Native avoided export") * p["factor"],
                    "reduction_percent": original.get("avoided_export_percent"), "units": UNITS[metric],
                    "baseline_valid_cells": baseline_cells, "alternative_valid_cells": alternative_cells,
                    "comparison_valid_cells": p["count"],
                    "baseline_total_all_valid": baseline_outputs[metric]["total"],
                    "alternative_total_all_valid": _number(statistic.get("all_valid_mass"), "Alternative annual export", minimum=0) * p["factor"],
                    "support": support, "normalization": {"baseline": p["normalization"], "alternative": p["normalization"]},
                    "artifact": p["artifact"], "percent_status": original.get("percent_status"),
                    "source_statistics": statistic, "source_pairwise": original.get("pairwise")}
                # Validate the producer's signs and percentage before retaining this candidate.
                data = outputs[metric]
                reduction = paired_base - paired_alt
                if (not math.isclose(data["reduction"], reduction, rel_tol=1e-10, abs_tol=1e-10)
                        or not math.isclose(data["delta"], -reduction, rel_tol=1e-10, abs_tol=1e-10)):
                    raise DecisionError("Native reported change does not match its common annual masses")
                percent = 100.0 * reduction / paired_base if paired_base else None
                if ((percent is None and data["reduction_percent"] is not None)
                        or (percent is not None and (data["reduction_percent"] is None or not math.isclose(
                            _number(data["reduction_percent"], "Native avoided-export percentage"),
                            percent, rel_tol=1e-10, abs_tol=1e-10)))):
                    raise DecisionError("Native reported percentage differs from its common baseline")
            item["outputs"] = outputs
            seen.add(item["scenario_key"])
            alternatives.append(item)
        except (DecisionError, KeyError, TypeError, ValueError) as error:
            unavailable.append({"comparison_id": comparison_id, "run_id": key,
                                "reason": str(error), "error_type": type(error).__name__})
    group = {"id": comparison_id, "baseline": {k: base[k] for k in
             ("run_id", "scenario_id", "scenario_key", "profile_id", "grid_id", "invest_version", "model_versions")},
             "alternatives": alternatives}
    group["baseline"].update(title=base["label"], outputs=baseline_outputs)
    zone_metadata = {key: value for key, value in zone.items() if key not in ("pollutants", "scenario_tradeoffs")}
    return {"schema": INPUT_SCHEMA, "project": report["project"], "comparisons": [group],
        "sources": [source], "unavailable_alternatives": unavailable,
        "physical_source": {"schema": report["schema"], "id": report["id"], "title": report["title"],
            "implementation": report["implementation"], "selection": report["selection"],
            "pollutants": list(_source_metrics(report)),
            "available_pollutants_by_run": report.get("available_pollutants_by_run"),
            "zone": zone_metadata, "scope_note": report.get("scope_note"),
            "mass_note": report.get("mass_note"), "interpretation": report.get("interpretation"),
            "support_identity_basis": "Exact source report, selected zone, pollutant and original cohort",
            "source": source},
        "source_report_document": source_document}


def _validate_packet(packet, selection):
    if packet.get("schema") != INPUT_SCHEMA:
        raise DecisionError("Select an upstate.decision-input/v1 physical-results packet")
    if selection.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise DecisionError("Select an upstate.decision-selection/v1 decision selection")
    _text(selection.get("title"), "Decision title")
    expected = [selection["comparison_id"]] + list(selection.get("sensitivity_comparison_ids", []))
    if len(expected) != len(set(expected)):
        raise DecisionError("Select each comparison once")
    found = {group["id"]: group for group in packet.get("comparisons", [])}
    if len(found) != len(packet.get("comparisons", [])) or any(key not in found for key in expected):
        raise DecisionError("The packet must contain each selected comparison exactly once")
    groups = [found[key] for key in expected]
    root = groups[0]["baseline"]
    metrics = _item_metrics(root)
    if not metrics:
        raise DecisionError("The packet needs at least one actual modeled pollutant output")
    support_baselines = {}
    for group in groups:
        _identifier(group["id"])
        base = group["baseline"]
        if _item_metrics(base) != metrics:
            raise DecisionError("Sensitivity members must retain the same modeled pollutant axes")
        for field in ("run_id", "scenario_id", "scenario_key", "profile_id", "grid_id"):
            _identifier(base[field])
        if any(base.get(field) != root.get(field) for field in ("scenario_key", "grid_id")):
            raise DecisionError("Sensitivity members need the same baseline definition and grid")
        root_versions, base_versions = _packet_version_vector(root, metrics), _packet_version_vector(base, metrics)
        if root_versions is not None or base_versions is not None:
            if root_versions is None or base_versions is None or root_versions != base_versions:
                raise DecisionError("Sensitivity members need the same executed versions for each selected native model")
        elif base.get("invest_version") != root.get("invest_version"):
            raise DecisionError("Legacy sensitivity members need the same retained declared model version")
        for metric in metrics:
            _number(base["outputs"][metric].get("total"), "Baseline " + metric, minimum=0)
            if base["outputs"][metric].get("units") != UNITS[metric]:
                raise DecisionError("Packet annual mass units must be explicit and canonical")
        seen = set()
        for item in group["alternatives"]:
            if _item_metrics(item) != metrics:
                raise DecisionError("An alternative must retain every pollutant modeled by its baseline")
            for field in ("run_id", "scenario_id", "scenario_key", "profile_id"):
                _identifier(item[field])
            if item["scenario_key"] in seen:
                raise DecisionError("One comparison contains duplicate physical scenario definitions")
            seen.add(item["scenario_key"])
            if item["profile_id"] != base["profile_id"] or item.get("kind") != "landcover":
                raise DecisionError("Each physical alternative needs its matching baseline parameter profile")
            _packet_pair_versions(base, item, metrics)
            for metric in metrics:
                data = item["outputs"][metric]
                if data.get("units") != UNITS[metric]:
                    raise DecisionError("Packet outcome units differ from their physical annual mass axis")
                for field in ("baseline", "alternative", "delta", "reduction"):
                    _number(data.get(field), metric + " " + field)
                if not math.isclose(data["delta"], -data["reduction"], rel_tol=1e-10, abs_tol=1e-10):
                    raise DecisionError("Packet delta must be alternative minus baseline")
                if data["baseline"] < 0 or data["alternative"] < 0:
                    raise DecisionError("Physical baseline and alternative exports must be nonnegative")
                support = data.get("support", {})
                if support.get("status") in ("paired", "same_support"):
                    _identifier(support.get("id"))
                    if not math.isclose(data["baseline"] - data["alternative"], data["reduction"],
                                        rel_tol=1e-10, abs_tol=1e-10):
                        raise DecisionError("Paired physical totals do not reproduce the reported reduction")
                    count = data.get("comparison_valid_cells", support.get("valid_cells"))
                    if _number(count, "Shared finite-cell count", minimum=0) <= 0:
                        raise DecisionError("Paired physical results need positive shared cell coverage")
                    if float(count) != int(count):
                        raise DecisionError("Shared finite-cell count must be an integer")
                    # One original baseline on one exact mask has one mass.
                    # Pairwise signs alone cannot establish that candidates
                    # claiming identical support are physically comparable.
                    key = (base["run_id"], metric, support["id"])
                    previous = support_baselines.get(key)
                    if previous is not None and (
                            previous[1] != count or not math.isclose(
                                previous[0], data["baseline"], rel_tol=1e-10, abs_tol=1e-10)):
                        raise DecisionError("Identical support for the same baseline must retain identical annual mass and finite-cell count")
                    support_baselines[key] = (data["baseline"], count)
                    expected_percent = (100.0 * data["reduction"] / data["baseline"]
                                        if data["baseline"] != 0 else None)
                    if expected_percent is None:
                        if data.get("reduction_percent") is not None:
                            raise DecisionError("A zero baseline has no defined percentage reduction")
                    elif data.get("reduction_percent") is None or not math.isclose(
                            data["reduction_percent"], expected_percent, rel_tol=1e-10, abs_tol=1e-10):
                        raise DecisionError("Packet percentage differs from the same-cell baseline")
                elif data.get("reduction_percent") is not None:
                    raise DecisionError("An unpaired summary must leave percentage reduction undefined")
    if not packet.get("sources"):
        raise DecisionError("Retain original physical-result source references with the packet")
    for source in packet["sources"]:
        _identifier(source.get("sha256"))
        _text(source.get("path"), "Source path or reference")
    return groups


def _supported(item):
    metrics = _item_metrics(item)
    return bool(metrics) and all(item["outputs"][metric].get("support", {}).get("status") in ("paired", "same_support")
               and item["outputs"][metric]["support"].get("id") for metric in metrics)


def _support_key(item):
    return tuple((metric, item["outputs"][metric]["support"].get("id"))
                 for metric in _item_metrics(item))


def _decision(item, assessment):
    supported = _supported(item)
    cost, budget, targets = item["cost"], assessment["budget"], assessment["targets"]
    reasons = []
    if not supported:
        reasons.append("Run same-cell analysis to compare whole scenarios on measured shared support")
    if budget:
        if cost is None or cost["currency"] != budget["currency"]:
            budget_status = "unknown_cost"
            reasons.append("The selected budget needs a source-bound cost in its own currency")
        else:
            excessive = (("capital_limit" in budget and cost["capital"] > budget["capital_limit"])
                         or ("annualized_limit" in budget and cost["annualized"] > budget["annualized_limit"]))
            budget_status = "over_budget" if excessive else "within_budget"
            if excessive:
                reasons.append("Scenario cost exceeds the selected budget")
    else:
        budget_status = "not_set"
    absent = [LABELS[metric] for metric in targets if metric not in item["outputs"]]
    unmet = [LABELS[metric] for metric, target in targets.items()
             if metric in item["outputs"] and item["outputs"][metric]["reduction"] < target]
    target_status = ("unavailable" if absent else "unsupported" if targets and not supported else
                     "unmet" if unmet else "met" if targets else "not_set")
    if absent:
        reasons.append("A selected target has no modeled output: " + ", ".join(absent))
    if unmet:
        reasons.append("Below selected avoided-export target: " + ", ".join(unmet))
    return {"budget_status": budget_status, "target_status": target_status,
            "eligible": bool(supported and budget_status in ("not_set", "within_budget")
                             and target_status in ("not_set", "met")),
            "pareto": None, "dominated_by": [], "reasons": reasons}


def _dominates(left, right, include_cost):
    metrics = _item_metrics(left)
    if metrics != _item_metrics(right):
        return False
    a = [left["outputs"][metric]["reduction"] for metric in metrics]
    b = [right["outputs"][metric]["reduction"] for metric in metrics]
    if include_cost:
        a.append(-left["cost"]["annualized"])
        b.append(-right["cost"]["annualized"])
    return all(x >= y for x, y in zip(a, b)) and any(x > y for x, y in zip(a, b))


def _frontier(alternatives):
    groups = {}
    for item in alternatives:
        if _supported(item):
            groups.setdefault(_support_key(item), []).append(item)
    summary = []
    for key, members in groups.items():
        currencies = {item["cost"]["currency"] for item in members if item["cost"]}
        costs_complete = all(item["cost"] for item in members) and len(currencies) == 1
        for item in members:
            dominated = [other["id"] for other in members
                         if other["id"] != item["id"] and _dominates(other, item, costs_complete)]
            item["decision"].update(pareto=not dominated, dominated_by=dominated,
                                    pareto_basis="annualized_cost_and_selected_exports" if costs_complete else "selected_exports")
        summary.append({"support_ids": dict(key),
            "candidate_ids": [item["id"] for item in members],
            "frontier_ids": [item["id"] for item in members if item["decision"]["pareto"]],
            "basis": "annualized_cost_and_selected_exports" if costs_complete else "selected_exports",
            "currency": next(iter(currencies)) if costs_complete else None})
    return {"candidate_ids": [item["id"] for item in alternatives if _supported(item)],
        "frontier_ids": [item["id"] for item in alternatives if item["decision"]["pareto"]],
        "eligible_ids": [item["id"] for item in alternatives if item["decision"]["eligible"]],
        "groups": summary,
        "ranking_basis": "Compare indivisible modeled scenarios on identical finite-cell support; minimize annualized cost when all compared costs share a known currency; maximize the modeled physical reductions separately; exact ties stay tied"}


def _quantile(values, probability):
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * probability
    lo, hi = math.floor(position), math.ceil(position)
    return values[lo] + (values[hi] - values[lo]) * (position - lo)


def _sensitivity(item, groups):
    metrics = {}
    member_rows = []
    for group in groups:
        match = next((other for other in group["alternatives"]
                      if other["scenario_key"] == item["scenario_key"]), None)
        compatible = bool(match and _supported(match) and _support_key(match) == _support_key(item))
        member_rows.append({"comparison_id": group["id"], "baseline_run_id": group["baseline"]["run_id"],
            "profile_id": group["baseline"]["profile_id"], "run_id": match["run_id"] if match else None,
            "included": compatible,
            "reason": "" if compatible else "Matching scenario and identical comparison support are required"})
    rank_sets = [
        {other["scenario_key"] for other in group["alternatives"]
         if _supported(other) and _support_key(other) == _support_key(item)}
        for group, member in zip(groups, member_rows) if member["included"]]
    rank_keys = set.intersection(*rank_sets) if rank_sets else set()
    for metric in _item_metrics(item):
        values, ranks = [], []
        for group, member in zip(groups, member_rows):
            if not member["included"]:
                continue
            match = next(other for other in group["alternatives"] if other["run_id"] == member["run_id"])
            value = match["outputs"][metric]["reduction"]
            values.append(value)
            comparable = [other for other in group["alternatives"]
                          if other["scenario_key"] in rank_keys and _supported(other)
                          and _support_key(other) == _support_key(match)]
            ranks.append(1 + sum(other["outputs"][metric]["reduction"] > value for other in comparable))
        metrics[metric] = {"minimum_reduction": min(values) if values else None,
            "maximum_reduction": max(values) if values else None, "median_reduction": _quantile(values, .5),
            "q10_reduction": _quantile(values, .1), "q90_reduction": _quantile(values, .9),
            "improved_members": sum(value > 0 for value in values), "member_count": len(values),
            "improved_fraction": sum(value > 0 for value in values) / len(values) if values else None,
            "rank_min": min(ranks) if ranks else None, "rank_max": max(ranks) if ranks else None,
            "rank_candidate_count": len(rank_keys),
            "rank_basis": "Same semantic candidate intersection across every accepted profile member",
            "units": UNITS[metric]}
    count = sum(row["included"] for row in member_rows)
    return {"member_count": count, "requested_member_count": len(groups),
        "complete": count == len(groups), "metrics": metrics, "members": member_rows,
        "rank_candidate_count": len(rank_keys),
        "rank_basis": "Same semantic candidate intersection across every accepted profile member",
        "interpretation": "Sensitivity range across explicitly paired model profiles; quantiles summarize selected profiles and do not imply a calibrated probability distribution"}


def _parcel_number(value, label):
    if value in ("", None):
        return None
    try:
        return _number(float(value), label)
    except (TypeError, ValueError) as error:
        raise DecisionError("Original parcel field is not numeric: " + label) from error


def _parcels(inventory, run_id, top_n, metrics=METRICS):
    if not inventory:
        return {"row_count": 0, "top_targets": [], "coverage": None}
    candidates = {metric: [] for metric in metrics}
    for row in inventory["rows"]:
        changes = row.get("scenario_changes", {})
        if isinstance(changes, str):
            changes = json.loads(changes)
        if run_id not in changes:
            raise DecisionError("Parcel scenario changes omit a selected original run")
        for metric in metrics:
            delta = changes[run_id].get(metric)
            if delta is None:
                continue
            reduction = -_number(delta, "Original parcel change")
            if reduction <= 0:
                continue
            candidates[metric].append({"feature_id": str(row["feature_id"]), "pollutant": metric,
                "reduction": reduction, "units": UNITS[metric],
                **{field: _parcel_number(row.get(field), field) for field in
                   ("coverage_fraction", "reporting_area_ha", "protected_fraction",
                    "source_water", "high_quality_context")}})
    targets = []
    for metric in metrics:
        targets.extend(sorted(candidates[metric], key=lambda value: (-value["reduction"], value["feature_id"]))[:top_n])
    return {"row_count": len(inventory["rows"]), "top_targets": targets, "coverage": inventory.get("coverage"),
            "source": inventory.get("source"), "delivery_id": inventory.get("delivery_id"),
            "interpretation": "Original parcel records are ranked independently within each physical pollutant; overlapping records and their benefits are never added into a combined management result"}


def analyze_packet(packet, selection):
    """Turn source-bound physical results into economics and scenario choices."""
    packet = _scoped_packet(packet, selection)
    groups = _validate_packet(packet, selection)
    primary = groups[0]
    metrics = _item_metrics(primary["baseline"])
    assessment = _assessment(selection, metrics)
    known_run_ids = {item["run_id"] for item in primary["alternatives"]}
    known_run_ids.update(item["run_id"] for item in packet.get("unavailable_alternatives", [])
                         if item.get("comparison_id") == primary["id"] and item.get("run_id"))
    costs = _costs(selection, known_run_ids)
    top_n = selection.get("top_parcels_per_pollutant", 10)
    if isinstance(top_n, bool) or not isinstance(top_n, int) or top_n < 0:
        raise DecisionError("Top parcel count must be a nonnegative integer")
    alternatives = []
    for original in primary["alternatives"]:
        item = json.loads(_canonical(original))
        item["id"] = item["run_id"]
        item["grid_id"] = primary["baseline"]["grid_id"]
        item["cost"] = costs.get(item["run_id"])
        item["economics"] = {}
        for metric in metrics:
            support = item["outputs"][metric]["support"]
            if support.get("status") == "same_support":
                support["original_status"] = "same_support"
                support["status"] = "paired"
        for metric in metrics:
            reduction = item["outputs"][metric]["reduction"]
            cost = item["cost"]
            amount = cost["annualized"] / reduction if cost and reduction > 0 and _supported(item) else None
            mass = "t" if metric == "sediment_export" else "kg"
            item["economics"][metric] = {"annualized_cost_per_unit": amount,
                "units": (cost["currency"] + "/" + mass if cost else None),
                "basis": "Annualized cost divided by annual avoided export; dimensionally currency per mass",
                "capital_cost_per_annual_capacity": cost["capital"] / reduction if cost and reduction > 0 and _supported(item) else None}
        item["decision"] = _decision(item, assessment)
        item["sensitivity"] = _sensitivity(item, groups)
        item["parcels"] = _parcels(packet.get("parcel_inventory"), item["run_id"], top_n, metrics)
        alternatives.append(item)
    frontier = _frontier(alternatives)
    report = {"schema": REPORT_SCHEMA,
        "id": _hash({"packet": packet, "selection": selection}),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": selection["title"], "project": packet["project"],
        "scope": {"comparison_id": primary["id"], "baseline_run_id": primary["baseline"]["run_id"],
            "grid_id": primary["baseline"]["grid_id"],
            "reference_profile_id": primary["baseline"]["profile_id"],
            "benefit_direction": "baseline minus alternative",
            "modeled_metrics": list(metrics),
            "unmodeled_metrics": [metric for metric in METRICS if metric not in metrics],
            "units": {metric: UNITS[metric] for metric in metrics}},
        "assessment": assessment, "baseline": primary["baseline"],
        "alternatives": alternatives, "sensitivity_members": [
            {"comparison_id": group["id"], "baseline_run_id": group["baseline"]["run_id"],
             "profile_id": group["baseline"]["profile_id"], "grid_id": group["baseline"]["grid_id"],
             "invest_version": group["baseline"].get("invest_version"),
             "model_versions": group["baseline"].get("model_versions"),
             "alternatives": group["alternatives"]} for group in groups[1:]],
        "frontier": frontier, "sources": packet["sources"],
        "selection": selection, "unavailable_alternatives": packet.get("unavailable_alternatives", []),
        "methodology": [
            "Every candidate is an original complete modeled land-cover scenario. Parcel changes are not added to predict a combined hydrologic response.",
            "Unavailable or incompatible alternatives are retained with their original IDs and exact input reason. Common support is computed across the available complete candidates.",
            "The default workspace adapter computes annual mass from the actual raster cells on a common finite mask across every scenario in each comparison. The original reporting mask follows native upstream routing.",
            "Per-hectare raster densities multiply by the actual projected cell area once. Per-pixel mass rasters sum directly. Annual-mass vector or summary totals receive no second area conversion.",
            "Only explicitly modeled pollutant outputs enter this assessment. Omitted pollutants remain unmodeled; their quantities are not zero. Nitrogen and phosphorus use kg/year; sediment uses metric tonnes/year.",
            "Export change is alternative minus baseline. Avoided export is baseline minus alternative; negative benefits remain visible. Zero-baseline percentages remain undefined.",
            "Annualized cost equals capital times the capital recovery factor plus annual operating cost. At zero discount it equals capital divided by the selected horizon plus annual operating cost.",
            "Budget and targets screen whole scenario bundles. Pareto dominance uses the actually modeled pollutant axes, requires at least one strict improvement and no deterioration; equal candidates stay tied. A target for an unmodeled pollutant remains unavailable.",
            "Profile sensitivity pairs each physical scenario with its own baseline on the same profile, model version and grid. It summarizes the supplied profile choices rather than assigning probabilities.",
            "Pixel export differences locate changes in modeled source contribution. They do not establish the location of retention service or pollutant removal.",
            "Native overlapping parcel records stay independent, with their original coverage and conservation context."
        ],
        "notes": list(selection.get("notes", []))}
    if packet.get("pollutant_selection"):
        report["scope"]["pollutant_selection"] = packet["pollutant_selection"]
    if packet.get("physical_source"):
        report["physical_source"] = packet["physical_source"]
        report["scope"]["reporting_unit"] = packet["physical_source"]["zone"]
        report["methodology"].append("Native zone intake uses the original producer\'s all-run common annual masses. Its exact source report, geographic selection, original coverage and pairwise details travel with the decision edition.")
    _canonical(report)
    return report


def analyze_workspace(workspace, selection, *, summary_only=False):
    return analyze_packet(workspace_packet(workspace, selection, summary_only=summary_only), selection)


def _safe_cell(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    text = str(value)
    if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r")):
        return "'" + text
    return text


def _write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: _safe_cell(row.get(key)) for key in fields})


def _write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True,
                               indent=2, allow_nan=False) + "\n", encoding="utf-8")


def export_report(report, destination, *, template=None, input_packet=None):
    """Create a fresh complete decision folder, source carrier and ZIP."""
    if report.get("schema") != REPORT_SCHEMA:
        raise DecisionError("Select an original decision report")
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise DecisionError("Choose a new export directory to retain the existing edition")
    template_path = Path(template) if template else Path(__file__).with_name("decision_desk.html")
    if not template_path.is_file():
        raise DecisionError("Place the supplied decision_desk.html beside this module or select --template")
    page = template_path.read_text(encoding="utf-8")
    if page.count(TEMPLATE_MARKER) != 1:
        raise DecisionError("Decision HTML needs its one original data marker")
    safe = json.dumps(report, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    safe = safe.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    safe = safe.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    page = page.replace(TEMPLATE_MARKER, '<script type="application/json" id="decision-report">' + safe + "</script>")
    stage = Path(tempfile.mkdtemp(prefix=".decision-", dir=destination.parent))
    try:
        _write_json(stage / "report.json", report)
        _write_json(stage / "selection.json", report.get("selection", {}))
        if input_packet is not None:
            _write_json(stage / "physical-input.json", input_packet)
            if input_packet.get("source_report_document") is not None:
                document = input_packet["source_report_document"]
                if not isinstance(document, str):
                    raise DecisionError("Native source report document must retain its original JSON text")
                body = document.encode("utf-8")
                original = input_packet["physical_source"]["source"]
                if (len(body) != original["bytes"]
                        or hashlib.sha256(body).hexdigest() != original["sha256"]):
                    raise DecisionError("Retained native report bytes differ from their original source")
                source_inputs = stage / "source-inputs"
                source_inputs.mkdir()
                (source_inputs / "scenario-report.json").write_bytes(body)
        (stage / "index.html").write_text(page, encoding="utf-8")
        alternatives, sensitivities, parcels, costs = [], [], [], []
        for item in report["alternatives"]:
            for metric in _item_metrics(item):
                data, economic = item["outputs"][metric], item["economics"][metric]
                alternatives.append({"run_id": item["run_id"], "scenario": item["label"],
                    "profile_id": item["profile_id"], "pollutant": metric,
                    "baseline": data["baseline"], "alternative": data["alternative"],
                    "export_change": data["delta"], "avoided_export": data["reduction"],
                    "reduction_percent": data["reduction_percent"], "units": data["units"],
                    "support": data["support"]["status"],
                    "valid_cells": data.get("comparison_valid_cells"),
                    "shared_area_ha": data["support"].get("area_ha"),
                    "annualized_cost_per_unit": economic["annualized_cost_per_unit"],
                    "cost_per_unit_units": economic["units"],
                    "budget_status": item["decision"]["budget_status"],
                    "target_status": item["decision"]["target_status"],
                    "eligible": item["decision"]["eligible"], "pareto": item["decision"]["pareto"]})
                sensitivities.append({"run_id": item["run_id"], "scenario": item["label"],
                    "pollutant": metric, **item["sensitivity"]["metrics"][metric]})
            for target in item["parcels"]["top_targets"]:
                parcels.append({"run_id": item["run_id"], "scenario": item["label"], **target})
            if item["cost"]:
                cost = item["cost"]
                costs.append({"run_id": item["run_id"], "scenario": item["label"],
                    **{key: cost[key] for key in ("currency", "capital", "annual_operating",
                        "horizon_years", "discount_rate", "present_value", "annualized", "note")},
                    **{"source_" + key: value for key, value in cost["source"].items()}})
        _write_csv(stage / "alternatives.csv",
            ["run_id", "scenario", "profile_id", "pollutant", "baseline", "alternative",
             "export_change", "avoided_export", "reduction_percent", "units", "support",
             "valid_cells", "shared_area_ha", "annualized_cost_per_unit", "cost_per_unit_units",
             "budget_status", "target_status", "eligible", "pareto"], alternatives)
        _write_csv(stage / "sensitivity.csv",
            ["run_id", "scenario", "pollutant", "minimum_reduction", "maximum_reduction",
             "median_reduction", "q10_reduction", "q90_reduction", "improved_members",
             "member_count", "improved_fraction", "rank_min", "rank_max", "rank_candidate_count",
             "rank_basis", "units"], sensitivities)
        _write_csv(stage / "parcel-targets.csv",
            ["run_id", "scenario", "feature_id", "pollutant", "reduction", "units",
             "coverage_fraction", "reporting_area_ha", "protected_fraction",
             "source_water", "high_quality_context"], parcels)
        _write_csv(stage / "costs.csv",
            ["run_id", "scenario", "currency", "capital", "annual_operating", "horizon_years",
             "discount_rate", "present_value", "annualized", "source_title", "source_uri",
             "source_as_of", "note"], costs)
        _write_csv(stage / "sources.csv", ["role", "path", "sha256", "bytes"], report["sources"])
        application = stage / "application"
        application.mkdir()
        for name in ("decision_analysis.py", "decision_cli.py"):
            source = Path(__file__).with_name(name)
            if not source.is_file():
                raise DecisionError("Complete source companion is missing: " + name)
            shutil.copyfile(source, application / name)
        shutil.copyfile(template_path, application / "decision_desk.html")
        receiver = Path(__file__).with_name("decision_receive.py")
        if receiver.is_file():
            shutil.copyfile(receiver, application / receiver.name)
        for name in ("DECISION_METHODS.md", "DECISION_WALKTHROUGH.md", "DECISION_INTEGRATION.md", "COST_SOURCE_INTAKE.md"):
            source = Path(__file__).with_name(name)
            if source.is_file():
                shutil.copyfile(source, application / name)
        (stage / "README.md").write_text(
            "# " + report["title"] + "\n\n"
            "Open index.html to compare the completed scenarios, save a working view and print the decision report.\n\n"
            "report.json contains the complete quantitative decision edition. selection.json retains the original "
            "comparison, cost sources, targets and budget. The CSV files keep physical pollutants and economic "
            "units separate. application contains the complete decision companion source.\n\n"
            "Recompute against the retained original scientific workspace:\n\n"
            "    python -B application/decision_cli.py build --workspace /path/to/study "
            "--selection selection.json --output /path/to/new-decision-edition\n\n"
            "A physical-input.json, when included, can be reprocessed with the packet subcommand on ordinary Python.\n",
            encoding="utf-8")
        files = sorted(path for path in stage.rglob("*") if path.is_file())
        manifest = {"schema": "upstate.decision-delivery/v1", "report_id": report["id"],
                    "members": [_descriptor(path, stage, "delivery_member") for path in files]}
        _write_json(stage / "manifest.json", manifest)
        with zipfile.ZipFile(stage / "decision-package.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in files + [stage / "manifest.json"]:
                archive.write(path, path.relative_to(stage).as_posix())
        stage.rename(destination)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise
    return {"report_id": report["id"], "directory": str(destination),
            "index": str(destination / "index.html"),
            "archive": str(destination / "decision-package.zip"),
            "candidates": len(report["alternatives"]),
            "eligible_candidates": len(report["frontier"]["eligible_ids"])}


def build(workspace, selection, destination, *, template=None, summary_only=False):
    packet = workspace_packet(workspace, selection, summary_only=summary_only)
    return export_report(analyze_packet(packet, selection), destination,
                         template=template, input_packet=packet)


def inspect_workspace(workspace):
    """List actual source-record choices without reading rasters or running models."""
    reader = _Reader(workspace)
    choices, unavailable_comparisons = [], []
    for path in sorted((reader.root / "comparisons").glob("*/comparison.json")):
        key = path.parent.name
        try:
            comparison, base, _, resolved, unavailable = _original_group(reader, key)
            alternatives = [{"run_id": item["run"]["id"], "scenario_id": item["scenario"]["id"],
                             "title": item["scenario"]["title"], "kind": item["scenario"]["kind"],
                             "profile_id": item["run"]["selection"]["profile_id"]}
                            for item in resolved]
            choices.append({"comparison_id": comparison["id"], "baseline_run_id": base["id"],
                            "grid_id": base["selection"]["grid_id"],
                            "profile_id": base["selection"]["profile_id"],
                            "available_pollutants": list(comparison_metrics(comparison, base, resolved)),
                            "original_common_artifacts": comparison.get("common_artifacts"),
                            "alternatives": alternatives, "unavailable_alternatives": unavailable})
        except (DecisionError, OSError, KeyError, TypeError, ValueError) as error:
            unavailable_comparisons.append({"comparison_id": key, "reason": str(error),
                                            "error_type": type(error).__name__})
    return {"project": reader.project, "comparisons": choices,
            "unavailable_comparisons": unavailable_comparisons}
