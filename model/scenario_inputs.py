"""Explain paired native model input changes on their actual retained cell grid."""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
import copy
import csv
from decimal import Decimal
import json
import math
import os
from pathlib import Path
import shutil
import tempfile

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, verify_file)
from .model_selection import (TABLE_FIELDS, common_comparison_outputs, run_models)
from .profiles import inspect_table, NDR_KEYS, SDR_KEYS

VERSION = "1.1.0"
KIND = "scenario-input-audits"
OUTPUT_ROOT = "scenario-input-files"
SCHEMA = "upstate.scenario-input-effects/v1"
MODEL_KEYS = {"ndr": NDR_KEYS, "sdr": SDR_KEYS}
METRIC_MODEL = {"nitrogen_export": "ndr", "phosphorus_export": "ndr",
                "sediment_export": "sdr"}
TEXT_FIELDS = {"load_type_n", "load_type_p", "flow_dir_algorithm"}
GUIDES = {
    "ndr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
    "sdr": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
}
LEGEND = {
    "0": "same land-cover code and selected model coefficients",
    "1": "different land-cover code; same selected model coefficients",
    "2": "same land-cover code; different selected model coefficients",
    "3": "different land-cover code and selected model coefficients",
    "255": "outside the native domain or either land-cover raster is invalid",
}


def _value(field, value):
    if field in TEXT_FIELDS:
        return str(value).strip()
    # Decimal avoids treating 1 and 1.0 as different coefficients.
    number = Decimal(str(value).strip())
    if not number.is_finite():
        raise ValueError("Selected native parameter is nonfinite: " + field)
    return number


def _normalized(field, value):
    if field in TEXT_FIELDS:
        return str(value).strip()
    number = _value(field, value)
    if number == 0:
        return "0"
    text = format(number, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _table(workspace, profile, models):
    path, entry = workspace.source_file(profile["source_collection_id"],
                                       profile["biophysical_source_id"])
    if entry["body"]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("The native table differs from its retained profile")
    inspected = inspect_table(path, selected_models=models)
    fields = tuple(dict.fromkeys(field for model in models
                                for field in TABLE_FIELDS[model] if field != "lucode"))
    rows = {int(row["lucode"]): {field: _normalized(field, row[field])
                                for field in fields}
            for row in inspected["rows"]}
    source = {key: copy.deepcopy(entry[key]) for key in
              ("id", "title", "uri", "vintage", "body") if key in entry}
    source["source_collection_id"] = profile["source_collection_id"]
    return rows, source


def _actual_arguments(workspace, run, models):
    directory = workspace.root / "runs" / run["id"]
    result, sources = {}, {}
    for model in models:
        stage = run["stages"][model]
        source = stage.get("arguments")
        if not source:
            raise ValueError("Retain the actual " + model.upper() + " argument file")
        path = verify_file(directory, source)
        arguments = read_json(path)
        result[model] = {
            key: {"present": key in arguments,
                  "value": _normalized(key, arguments[key]) if key in arguments else None}
            for key in sorted(MODEL_KEYS[model])
        }
        sources[model] = copy.deepcopy(source)
    return result, sources


def _lulc(workspace, run, grid):
    scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
    if scenario["kind"] == "landcover":
        item = run.get("stages", {}).get("landcover", {}).get("artifact")
        if not item:
            raise ValueError("Finish and retain the actual compiled land-cover stage")
        path = verify_file(workspace.root / "runs" / run["id"], item)
    else:
        item = grid["files"]["NLCD"]
        path = verify_file(workspace.root / "grids" / grid["id"], item)
    return path, {**copy.deepcopy(item), "scenario_id": scenario["id"],
                  "scenario_kind": scenario["kind"]}


def _valid(raster, window):
    import numpy as np
    value = raster.read(1, window=window, masked=True)
    data = np.ma.getdata(value)
    return data, ~np.ma.getmaskarray(value) & np.isfinite(data)


def _area_and_grid(reference, declared):
    from pyproj import CRS
    from rasterio.transform import Affine
    crs = CRS.from_user_input(reference.crs)
    if (not crs.is_projected or len(crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-12
                   for axis in crs.axis_info[:2])):
        raise ValueError("Input-effect area requires the original projected metre grid")
    if (reference.width != declared["width"] or reference.height != declared["height"]
            or reference.transform != Affine(*declared["transform"])
            or crs != CRS.from_user_input(declared["crs"])):
        raise ValueError("Native land-cover raster differs from its retained grid")
    transform = reference.transform
    area = abs(transform.a * transform.e - transform.b * transform.d) / 10000
    if not math.isfinite(area) or area <= 0:
        raise ValueError("The native affine grid has no finite cell area")
    return area


def _counter():
    return {"extent_cells": 0, "paired_lulc_cells": 0,
            "baseline_only_cells": 0, "alternative_only_cells": 0,
            "neither_lulc_cells": 0, "pairs": Counter()}


def _accumulate(summary, scope, av, bv, valid_a, valid_b):
    import numpy as np
    both = scope & valid_a & valid_b
    summary["extent_cells"] += int(scope.sum())
    summary["paired_lulc_cells"] += int(both.sum())
    summary["baseline_only_cells"] += int((scope & valid_a & ~valid_b).sum())
    summary["alternative_only_cells"] += int((scope & ~valid_a & valid_b).sum())
    summary["neither_lulc_cells"] += int((scope & ~valid_a & ~valid_b).sum())
    if both.any():
        pairs, counts = np.unique(np.column_stack((av[both], bv[both])),
                                  axis=0, return_counts=True)
        summary["pairs"].update({(int(a), int(b)): int(count)
                                 for (a, b), count in zip(pairs, counts)})


def _transition(a, b, tables, models):
    fields = tuple(dict.fromkeys(field for model in models
                                for field in TABLE_FIELDS[model] if field != "lucode"))
    try:
        before, after = tables[0][a], tables[1][b]
    except KeyError as exc:
        raise ValueError("A native land-cover class lacks its actual selected table row: "
                         + str(exc.args[0])) from exc
    changed = [field for field in fields
               if _value(field, before[field]) != _value(field, after[field])]
    by_model = {model: [field for field in TABLE_FIELDS[model]
                        if field != "lucode" and field in changed]
                for model in models}
    return {"baseline_code": a, "alternative_code": b,
            "landcover_code_changed": a != b,
            "baseline_coefficients": before, "alternative_coefficients": after,
            "changed_fields": changed, "changed_fields_by_model": by_model}


def _summarize_scope(value, transitions, models, area):
    result = {key: count for key, count in value.items() if key != "pairs"}
    result["hectares"] = {key.removesuffix("_cells") + "_ha": count * area
                          for key, count in result.items() if key.endswith("_cells")}
    result["landcover_changed_cells"] = sum(count for (a, b), count in value["pairs"].items() if a != b)
    result["landcover_changed_ha"] = result["landcover_changed_cells"] * area
    result["models"] = {}
    for model in models:
        categories = {"same_code_same_coefficients": 0, "code_only": 0,
                      "coefficient_only": 0, "code_and_coefficients": 0}
        fields = Counter({field: 0 for field in TABLE_FIELDS[model] if field != "lucode"})
        for pair, count in value["pairs"].items():
            row = transitions[pair]
            code_changed = row["landcover_code_changed"]
            changed = row["changed_fields_by_model"][model]
            category = ("code_and_coefficients" if code_changed and changed else
                        "code_only" if code_changed else
                        "coefficient_only" if changed else "same_code_same_coefficients")
            categories[category] += count
            fields.update({field: count for field in changed})
        changed_cells = categories["coefficient_only"] + categories["code_and_coefficients"]
        result["models"][model] = {
            "categories": {name: {"cells": count, "hectares": count * area}
                           for name, count in categories.items()},
            "coefficient_changed_cells": changed_cells,
            "coefficient_changed_ha": changed_cells * area,
            "fields": {field: {"cells": count, "hectares": count * area}
                       for field, count in fields.items()},
        }
    return result


def analyze_inputs(workspace, baseline_run_id, alternative_run_id):
    """Audit completed native operands; preserve the existing output comparison."""
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from shapely.geometry import mapping
    from . import rasters
    from . import scenario_response

    ids = [identifier(baseline_run_id), identifier(alternative_run_id)]
    if ids[0] == ids[1]:
        raise ValueError("Choose distinct completed native runs")
    runs = [workspace.inspect_run(key) for key in ids]
    outputs = common_comparison_outputs(runs)
    models = tuple(model for model in ("ndr", "sdr")
                   if all(model in run_models(run) for run in runs))
    grid_id = runs[0]["selection"]["grid_id"]
    if runs[1]["selection"]["grid_id"] != grid_id:
        raise ValueError("Input-effect accounting requires the same retained native grid")
    grid = workspace.get_grid(grid_id)
    grid_directory = workspace.root / "grids" / grid_id
    profiles = [workspace._get("profiles", run["selection"]["profile_id"]) for run in runs]
    tables_and_sources = [_table(workspace, profile, models) for profile in profiles]
    tables = [item[0] for item in tables_and_sources]
    table_sources = [item[1] for item in tables_and_sources]
    arguments_and_sources = [_actual_arguments(workspace, run, models) for run in runs]
    arguments = [item[0] for item in arguments_and_sources]
    lulc = [_lulc(workspace, run, grid) for run in runs]
    domain_path = verify_file(grid_directory, grid["files"]["model_domain"])
    reporting_path = verify_file(grid_directory, grid["files"]["reporting_mask"])
    # The existing native comparator owns annual outcome deltas and their support.
    comparison = workspace.compare_runs(ids)
    comparison_directory = workspace.root / "comparisons" / comparison["id"]
    differences = comparison["alternatives"][0]["artifacts"]
    difference_paths = {name: verify_file(comparison_directory, differences[name])
                        for name in outputs}
    request = {
        "schema": "upstate.scenario-input-effects-request/v1",
        "version": VERSION, "compiler_sha256": file_digest(Path(__file__)),
        "response_compiler_sha256": file_digest(Path(scenario_response.__file__)),
        "runs": [{"id": run["id"], "selection": run["selection"],
                  "runtime": run.get("runtime"),
                  "lulc": source, "coefficient_source": table_source,
                  "argument_sources": args_source}
                 for run, (_, source), table_source, (_, args_source)
                 in zip(runs, lulc, table_sources, arguments_and_sources)],
        "models": list(models), "selected_table_fields": {model: list(TABLE_FIELDS[model]) for model in models},
        "grid_id": grid_id,
        "model_domain": grid["files"]["model_domain"],
        "reporting_mask": grid["files"]["reporting_mask"],
        "comparison_id": comparison["id"],
        "comparison_artifacts": {name: differences[name] for name in outputs},
    }
    key = digest(request)
    base = workspace.root / OUTPUT_ROOT
    base.mkdir(parents=True, exist_ok=True)
    directory = base / key
    with held(workspace.root / ".workspace.lock"), held(base / (key + ".lock")):
        if (directory / "complete.json").exists():
            manifest = read_json(directory / "complete.json")
            if manifest["request"] != request:
                raise ValueError("Retained input-effect selection differs")
            return _retain(workspace, directory, manifest)
        if directory.exists():
            raise ValueError("An unrelated incomplete directory occupies this input report")
        staging = base / "source-views"
        staging.mkdir(exist_ok=True)
        for old in staging.glob(key + "-*"):
            if old.is_dir() and not old.is_symlink():
                shutil.rmtree(old)
        staged = Path(tempfile.mkdtemp(prefix=key + "-", dir=staging))
        try:
            domain_rows, _ = rasters.vector_geometry(domain_path, layer="model_domain",
                                                     target_crs=grid["grid"]["crs"])
            domain = mapping(rasters.polygon_union(domain_rows))
            scopes = {"native_domain": _counter(), "reporting_area": _counter(),
                      **{name: _counter() for name in outputs}}
            transition_cache = {}
            with ExitStack() as stack:
                a, b = [stack.enter_context(rasterio.open(path)) for path, _ in lulc]
                reporting = stack.enter_context(rasterio.open(reporting_path))
                outcome = {name: stack.enter_context(rasterio.open(path))
                           for name, path in difference_paths.items()}
                area = _area_and_grid(a, grid["grid"])
                for raster in [b, reporting, *outcome.values()]:
                    rasters.check_same_grid(a, raster)
                profile = dict(a.profile)
                profile.update(driver="GTiff", count=1, dtype="uint8", nodata=255,
                               compress="deflate", predictor=1)
                effect_rasters = {model: stack.enter_context(rasterio.open(
                    staged / (model + "-input-effects.tif"), "w", **profile))
                    for model in models}
                for _, window in a.block_windows(1):
                    av, valid_a = _valid(a, window)
                    bv, valid_b = _valid(b, window)
                    for values, valid in ((av, valid_a), (bv, valid_b)):
                        if np.any(values[valid] != np.floor(values[valid])):
                            raise ValueError("Native land-cover raster contains noninteger classes")
                        if np.any((values[valid] < np.iinfo("int32").min) | (values[valid] > np.iinfo("int32").max)):
                            raise ValueError("Native land-cover class exceeds the original int32 grid")
                    av = np.where(valid_a, av, 0).astype("int64")
                    bv = np.where(valid_b, bv, 0).astype("int64")
                    domain_mask = rasterize(
                        [(domain, 1)], out_shape=av.shape, transform=a.window_transform(window),
                        fill=0, all_touched=False, dtype="uint8") == 1
                    rv, rvalid = _valid(reporting, window)
                    scope_masks = {"native_domain": domain_mask,
                                   "reporting_area": domain_mask & rvalid & (rv == 1)}
                    for name, raster in outcome.items():
                        _, valid = _valid(raster, window)
                        scope_masks[name] = domain_mask & rvalid & (rv == 1) & valid
                    for name, mask in scope_masks.items():
                        _accumulate(scopes[name], mask, av, bv, valid_a, valid_b)
                    paired = domain_mask & valid_a & valid_b
                    classifications = {model: np.full(av.shape, 255, dtype="uint8") for model in models}
                    if paired.any():
                        pairs = np.unique(np.column_stack((av[paired], bv[paired])), axis=0)
                        for acode, bcode in pairs:
                            pair = (int(acode), int(bcode))
                            if pair not in transition_cache:
                                transition_cache[pair] = _transition(*pair, tables, models)
                            row = transition_cache[pair]
                            matching = paired & (av == acode) & (bv == bcode)
                            for model in models:
                                changed = bool(row["changed_fields_by_model"][model])
                                classifications[model][matching] = int(acode != bcode) + 2 * int(changed)
                    for model, out in effect_rasters.items():
                        out.write(classifications[model], 1, window=window)
                for model, out in effect_rasters.items():
                    out.update_tags(model=model, units="input-change category",
                                    legend=json.dumps(LEGEND, sort_keys=True),
                                    baseline_run_id=ids[0], alternative_run_id=ids[1])
            summaries = {name: _summarize_scope(value, transition_cache, models, area)
                         for name, value in scopes.items()}
            transitions = [{
                **row, "support": {name: {"cells": value["pairs"].get(pair, 0),
                                          "hectares": value["pairs"].get(pair, 0) * area}
                                  for name, value in scopes.items()}}
                for pair, row in sorted(transition_cache.items())]
            parameter_changes = {
                model: [{"name": name, "baseline": arguments[0][model][name],
                          "alternative": arguments[1][model][name]}
                         for name in sorted(MODEL_KEYS[model])
                         if arguments[0][model][name] != arguments[1][model][name]]
                for model in models}
            response = scenario_response.build_response(
                difference_paths, differences,
                {model: staged / (model + "-input-effects.tif") for model in models},
                [path for path, _ in lulc], grid["grid"], parameter_changes, staged)
            used = [{pair[index] for pair in scopes["native_domain"]["pairs"]} for index in (0, 1)]
            report = {
                "schema": SCHEMA, "version": VERSION,
                "title": "Native input changes: " + profiles[0]["title"] + " to " + profiles[1]["title"],
                "created_at": now(), "request": request,
                "baseline_run_id": ids[0], "alternative_run_id": ids[1],
                "grid_id": grid_id, "models": list(models), "pixel_area_ha": area,
                "scopes": summaries, "transitions": transitions, "response": response,
                "native_parameters": {"baseline": arguments[0], "alternative": arguments[1],
                                      "changes": parameter_changes},
                "coefficient_sources": table_sources,
                "used_coefficient_rows": {
                    "baseline": [{"lucode": code, **tables[0][code]} for code in sorted(used[0])],
                    "alternative": [{"lucode": code, **tables[1][code]} for code in sorted(used[1])]},
                "unused_table_codes": {
                    "baseline": sorted(set(tables[0]) - used[0]),
                    "alternative": sorted(set(tables[1]) - used[1])},
                "outcome_comparison": {
                    "id": comparison["id"], "direction": comparison["direction"],
                    "artifacts": {name: copy.deepcopy(differences[name]) for name in outputs},
                    "directory": str(comparison_directory.relative_to(workspace.root))},
                "runtime_changed": runs[0].get("runtime") != runs[1].get("runtime"),
                "legend": LEGEND, "guides": {model: GUIDES[model] for model in models},
                "method": {
                    "input_effect": "Comparison of the selected native coefficient vectors at paired valid cells",
                    "scope": "Pixel centres in the retained native domain; reporting and outcome supports are explicit subsets",
                    "coefficient_only": "Same land-cover code, different selected coefficient values",
                    "code_only": "Different land-cover code, identical selected coefficient values",
                    "parameters": "Actual retained native argument values; omitted values remain explicitly omitted",
                    "routing": "Downstream output effects may extend beyond changed input cells",
                    "global_parameters": "Changes affect model configuration; no local changed-area allocation is assigned",
                    "outcomes": "Original paired output comparison; annual mass deltas are preserved in their original units",
                    "interpretation": "Input changes describe model operands and do not assign causal shares of export change",
                },
            }
            atomic_json(staged / "input-effects.json", report)
            _write_csv(staged / "input-transitions.csv",
                       ["scope", "baseline_code", "alternative_code", "cells", "hectares",
                        "model", "changed_fields"],
                       [{"scope": scope, "baseline_code": row["baseline_code"],
                         "alternative_code": row["alternative_code"], **value,
                         "model": model, "changed_fields": "|".join(row["changed_fields_by_model"][model])}
                        for row in transitions for scope, value in row["support"].items()
                        for model in models if value["cells"]])
            _write_csv(staged / "coefficient-changes.csv",
                       ["baseline_code", "alternative_code", "field", "baseline_value", "alternative_value"],
                       [{"baseline_code": row["baseline_code"], "alternative_code": row["alternative_code"],
                         "field": field, "baseline_value": row["baseline_coefficients"][field],
                         "alternative_value": row["alternative_coefficients"][field]}
                        for row in transitions for field in row["changed_fields"]])
            _write_csv(staged / "parameter-changes.csv",
                       ["model", "parameter", "baseline_present", "baseline_value",
                        "alternative_present", "alternative_value"],
                       [{"model": model, "parameter": row["name"],
                         "baseline_present": row["baseline"]["present"],
                         "baseline_value": row["baseline"]["value"],
                         "alternative_present": row["alternative"]["present"],
                         "alternative_value": row["alternative"]["value"]}
                        for model, rows in parameter_changes.items() for row in rows])
            names = {"report": "input-effects.json", "transitions": "input-transitions.csv",
                     "coefficients": "coefficient-changes.csv", "parameters": "parameter-changes.csv",
                     **{model + "_map": model + "-input-effects.tif" for model in models},
                     **response["files"]}
            files = {name: describe_file(staged, staged / filename)
                     for name, filename in names.items()}
            manifest = {"schema": "upstate.scenario-input-files/v1", "request": request, "files": files}
            atomic_json(staged / "complete.json", manifest)
            os.replace(staged, directory)
            return _retain(workspace, directory, manifest)
        finally:
            if staged.exists():
                shutil.rmtree(staged)


def _write_csv(path, fields, rows):
    with open(path, "w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _retain(workspace, directory, manifest):
    for item in manifest["files"].values():
        verify_file(directory, item)
    report = read_json(directory / "input-effects.json")
    if report["request"] != manifest["request"]:
        raise ValueError("Retained input-effect report selection differs")
    files = {name: {**item, "path": str((directory / item["path"]).relative_to(workspace.root))}
             for name, item in manifest["files"].items()}
    return workspace._save(KIND, {**report, "files": files})


def get_report(workspace, report_id, *, verify=True):
    value = workspace._get(KIND, identifier(report_id))
    if verify:
        for item in value["files"].values():
            verify_file(workspace.root, item)
    return value


def list_reports(workspace):
    return workspace._list(KIND)


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--baseline-run", required=True)
    parser.add_argument("--alternative-run", required=True)
    args = parser.parse_args(argv)
    print(json.dumps(analyze_inputs(Workspace(args.workspace), args.baseline_run,
                                   args.alternative_run), ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
