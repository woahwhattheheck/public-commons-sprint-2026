"""Inspect an original native-study package on its declared scientific grid."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from pyproj import CRS

# Standalone verification-tool constants copied from the retained application
# model/common.py, model/native_study.py and model/rasters.py contracts.
INVEST_VERSION = "3.20.0"
INVEST_SOURCE = {
    "repository": "https://github.com/natcap/invest",
    "ref": "3.20.0",
    "ndr_blob": "f518b2867d4a327675fcb1c9b4ba56f29b12188d",
    "sdr_blob": "0cac27add172011df367ff8026427dbbdbcda5b2",
}
SCHEMA = "commons.native-study-delivery/v1"
CONTEXT_SCHEMA = "commons.native-study-context/v1"
EXECUTION_EDITION = "native-study-release/3"
EXECUTION_POLICY = "completed_stage_runtime_else_observed_run_else_labeled_requested_legacy"
MAP_FAMILIES = (
    "future_sediment_loss", "future_nutrient_runoff",
    "current_nutrient_export", "current_sediment_export",
    "combined_pollutant_export",
)
MASS_UNITS = {
    "nitrogen_export": "kg/pixel/year", "phosphorus_export": "kg/pixel/year",
    "sediment_export": "metric_tonnes/pixel/year",
}


MAX_JSON_BYTES = 16 * 1024 * 1024


def _read_json(path, *, maximum):
    if type(maximum) is not int or maximum <= 0:
        raise ValueError("The audit JSON byte limit must be a positive integer")
    with Path(path).open("rb") as incoming:
        body = incoming.read(maximum + 1)
    if len(body) > maximum:
        raise ValueError("JSON document exceeds the selected audit byte limit: " + str(maximum))
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("The original study JSON root must be an object")
    return value


def _execution_metadata(context, model, require):
    """Check immutable declared execution sources without importing the app."""
    runs = context["runs"]
    supplied = ("execution" in context or any(
        "model_versions" in run or "stage_execution_sources" in run for run in runs))
    if context.get("edition") != EXECUTION_EDITION and not supplied:
        return
    execution = context.get("execution")
    if not require(isinstance(execution, dict), "execution.context",
                   "This study edition requires its declared execution policy and cohort versions"):
        return
    expected_models = ["ndr", "sdr"]
    if not require(execution.get("policy") == EXECUTION_POLICY
                   and execution.get("models") == expected_models
                   and execution.get("versions") == {name: INVEST_VERSION for name in expected_models},
                   "execution.cohort", "Retain the shared policy and full original-model version cohort"):
        return
    manifest = model.get("native_version_provenance")
    if not require(isinstance(manifest, dict), "execution.manifest",
                   "The manifest must retain the same original execution cohort"):
        return
    require(all(manifest.get(name) == execution.get(name) for name in ("policy", "models", "versions")),
            "execution.manifest", "Manifest and study execution policy or versions differ")
    declared_runs = manifest.get("runs")
    if not require(isinstance(declared_runs, dict), "execution.runs",
                   "Retain the original run/model execution records in the manifest"):
        return
    require(set(declared_runs) == {run["id"] for run in runs},
            "execution.runs", "Execution provenance must cover the same original native cohort")

    def text(value):
        return value.strip() if isinstance(value, str) and value.strip() else None

    for run in runs:
        versions = run.get("model_versions")
        sources = run.get("stage_execution_sources")
        if not require(isinstance(versions, dict) and set(versions) == set(expected_models)
                       and isinstance(sources, dict) and set(sources) == set(expected_models),
                       "execution.sources", "Retain both selected-model records and original stage sources"):
            continue
        require(declared_runs.get(run["id"]) == versions,
                "execution.run." + run["id"], "Manifest and study per-model execution records differ")
        requested = text(run["selection"].get("invest_version"))
        runtime = run.get("runtime")
        observed = text(runtime.get("version")) if isinstance(runtime, dict) else None
        for name in expected_models:
            key = "execution." + run["id"] + "." + name
            info, stage = versions[name], sources[name]
            if not require(isinstance(info, dict) and isinstance(stage, dict)
                           and {"completed_at", "runtime", "reused_from"} <= set(stage),
                           key, "Retain the complete original stage execution fields"):
                continue
            stage_runtime = stage.get("runtime")
            stage_version = (text(stage_runtime.get("version"))
                             if stage.get("completed_at") and isinstance(stage_runtime, dict) else None)
            effective = stage_version or observed or requested
            basis = ("completed_stage_runtime" if stage_version else
                     "observed_run_fallback" if observed else
                     "requested_legacy" if requested else "unavailable")
            expected = {
                "model": name, "comparison_version": effective, "basis": basis,
                "observed_stage_version": stage_version, "observed_run_version": observed,
                "requested_version": requested,
                "differs_from_requested": bool(effective and requested and effective != requested),
                "stage_completed_at": stage.get("completed_at"),
                "reused_from": stage.get("reused_from"),
            }
            require(type(info.get("differs_from_requested")) is bool
                    and all(field in info and info[field] == value for field, value in expected.items()),
                    key + ".metadata", "Declared model provenance differs from its original stage/run sources")
            require(effective == execution.get("versions", {}).get(name),
                    key + ".cohort", "The original producing model differs from the retained cohort version")
            chosen = stage_runtime if stage_version else runtime
            require((run.get("stage_runtimes") or {}).get(name) == chosen,
                    key + ".runtime", "The retained official runtime does not follow completed-stage priority")


def inspect(manifest_path, *, max_manifest_bytes=MAX_JSON_BYTES):
    root = Path(manifest_path).resolve().parent
    findings = []
    summary = {"raster_layers": 0, "map_files": 0, "valid_cells": {},
               "annual_mass": {}, "delivery_mode": "native_study"}

    def add(level, key, detail):
        findings.append({"level": level, "check": key, "detail": str(detail)})

    def require(value, key, detail):
        if not value:
            add("FAIL", key, detail)
        return bool(value)

    def child(value, key):
        if not isinstance(value, str) or not value or Path(value).is_absolute():
            add("FAIL", key, "Retain a nonempty relative artifact path")
            return None
        target = (root / value).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            add("FAIL", key, "Artifact is missing or outside the package: " + value)
            return None
        return target

    def pdf(value, key):
        path = child(value, key)
        if path is None:
            return
        with path.open("rb") as stream:
            if require(stream.read(5) == b"%PDF-", key, "Original PDF signature is missing"):
                if key.startswith("map."):
                    summary["map_files"] += 1

    def exact_file(descriptor, key):
        path = child(descriptor.get("path"), key)
        if path is None:
            return None
        actual = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1048576), b""):
                actual.update(block)
        require(path.stat().st_size == descriptor.get("bytes")
                and actual.hexdigest() == descriptor.get("sha256"),
                key, "Artifact differs from its retained native bytes")
        return path

    try:
        data = _read_json(manifest_path, maximum=max_manifest_bytes)
        if not isinstance(data, dict) or data.get("schema") != SCHEMA:
            raise ValueError("Choose the explicit commons.native-study-delivery/v1 manifest")
        require(data.get("delivery_mode") == "native_study", "mode",
                "Native-study mode must be explicit")
        context = data["native_study"]
        require(context.get("schema") == CONTEXT_SCHEMA, "context", "Native study context schema differs")
        require(bool(context.get("title")) and bool(context.get("purpose")), "scope",
                "Retain the actual original study title and purpose")
        grid = context["grid"]
        transform = tuple(float(v) for v in grid["transform"])
        if len(transform) != 6 or any(not math.isfinite(v) for v in transform):
            raise ValueError("Retain the complete finite original affine transform")
        crs = CRS.from_user_input(grid["crs"])
        factors = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
        require(crs.is_projected and len(factors) == 2 and all(
            math.isclose(float(v), 1.0, rel_tol=0, abs_tol=1e-10) for v in factors),
            "grid.crs", "Native study grid must retain projected metre coordinates")
        a, b, _, d, e, _ = transform
        area = abs(a * e - b * d) / 10000
        require(a > 0 and e < 0 and b == 0 and d == 0 and math.isfinite(area) and area > 0,
                "grid.affine", "Retain the original north-up nondegenerate study grid")
        require(math.isclose(area, float(grid["pixel_area_ha"]), rel_tol=0, abs_tol=1e-12),
                "grid.area", "Declared cell area differs from the original affine")
        require(all(type(grid.get(key)) is int and grid[key] > 0 for key in ("width", "height")),
                "grid.shape", "Original raster width and height must be positive integers")
        buffer = data["model"]["upstream_buffer_m"]
        require(not isinstance(buffer, bool) and isinstance(buffer, (int, float))
                and math.isfinite(buffer) and buffer >= 0, "domain.buffer",
                "Native-study buffer must be finite and nonnegative")
        require(buffer == context["upstream_buffer_m"] == context["grid_spec"]["upstream_buffer_m"],
                "domain.buffer", "Study and manifest context buffers differ")
        require(context["grid_id"] == data["model"]["grid_id"], "grid.identity",
                "Study and manifest grid identities differ")
        summary["resolution_m"] = [a, abs(e)]
        summary["pixel_area_ha"] = area

        context_path = child("native-study/study.json", "context.record")
        if context_path:
            require(_read_json(context_path, maximum=max_manifest_bytes) == context,
                    "context.record", "The manifest and retained original context record differ")
        for key, descriptor in context["files"].items():
            exact_file(descriptor, "context." + key)
        require({"reporting_area", "model_domain", "reporting_mask", "biophysical_table"} <= set(context["files"]),
                "context.sources", "Retain original domain, reporting mask and biophysical table")
        require(context["source_records"] == data["source_data"], "sources",
                "Manifest source editions differ from the retained study context")
        source_roles = {row.get("id") for row in data["source_data"]}
        require({"DEM", "NLCD", "PRECIPITATION", "R_FACTOR", "K_FACTOR",
                 "LS_FACTOR", "REPORTING_AREA", "MODEL_DOMAIN", "BIOPHYSICAL_TABLE"} <= source_roles,
                "sources.roles", "Retain every actual modeled source role and study geometry")
        for row in data["source_data"]:
            require(all(row.get(k) for k in ("id", "title", "uri", "vintage", "sha256")),
                    "sources.lineage", "Every study source needs its original edition and fingerprint")

        cohort = [context["baseline_run_id"], *context["scenario_run_ids"]]
        require(len(cohort) > 1 and len(set(cohort)) == len(cohort), "cohort",
                "Select an original baseline and distinct completed alternatives")
        require(cohort == [data["model"]["baseline_run_id"], *data["model"]["scenario_run_ids"]],
                "cohort", "Manifest and retained study run order differ")
        require([run["id"] for run in context["runs"]] == cohort, "cohort.runs",
                "Retain every ordered native run in the study context")
        for index, run in enumerate(context["runs"]):
            require(run["selection"]["grid_id"] == context["grid_id"]
                    and run["selection"]["profile_id"] == context["profile"]["id"],
                    "cohort.selection", "Native study maps require the same original grid and profile")
            require(run["scenario"]["kind"] == ("baseline" if index == 0 else "landcover"),
                    "cohort.scenario", "Retain baseline and explicit source-bound land-cover changes")
            runtimes = run.get("stage_runtimes")
            if runtimes is None:
                runtimes = {model: run.get("runtime") for model in ("ndr", "sdr")}
            if not isinstance(runtimes, dict) or set(runtimes) != {"ndr", "sdr"}:
                raise ValueError("Retain the original NDR and SDR runtime records")
            for model in ("ndr", "sdr"):
                runtime = runtimes[model]
                if not isinstance(runtime, dict):
                    raise ValueError("Retain the original " + model.upper() + " runtime record")
                require(runtime.get("version") == INVEST_VERSION
                        and runtime.get("declared_source") == INVEST_SOURCE,
                        "native.version." + model, "Retain the original InVEST source and version")
                modules = runtime.get("modules")
                module = modules.get(model) if isinstance(modules, dict) else None
                require(isinstance(module, dict)
                        and module.get("git_blob") == INVEST_SOURCE[model + "_blob"],
                        "native." + model,
                        "Native runtime module differs from its retained official source")

        _execution_metadata(context, data["model"], require)
        if context.get("execution") is not None:
            summary["execution"] = context["execution"]

        maps = data["maps"]
        require(set(context["expected_map_families"]) == set(MAP_FAMILIES),
                "maps.scope", "The native study must declare its complete physical map families")
        require(set(MAP_FAMILIES) <= set(maps), "maps.required",
                "Complete current exports, combined priority and both future-map families")
        for key, value in maps.items():
            pdf(value, "map." + key)
        pdf(data.get("report_pdf"), "report")
        baseline = context["runs"][0]
        for name, units in MASS_UNITS.items():
            item = data["rasters"][name]
            original = baseline["artifacts"][name]
            require(item.get("units") == original.get("units") == units,
                    name + ".units", "Physical pollutant units differ from their native artifact")
            path = child(item.get("path"), name)
            meta = child(item.get("fgdc_xml"), name + ".metadata")
            if meta:
                xml = ET.parse(meta).getroot()
                for field in ("idinfo/citation/citeinfo/title", "idinfo/descript/abstract",
                              "dataqual/lineage", "spref", "metainfo"):
                    node = xml.find(field)
                    require(node is not None and bool("".join(node.itertext()).strip()),
                            name + ".metadata", "Missing original metadata section: " + field)
            if path is None:
                continue
            exact_file({**original, "path": item["path"]}, name + ".native_bytes")
            with rasterio.open(path) as dataset:
                require(dataset.driver == "GTiff" and dataset.count == 1, name + ".format",
                        "Retain the single-band native mass GeoTIFF")
                require(CRS.from_user_input(dataset.crs) == crs
                        and dataset.width == grid["width"] and dataset.height == grid["height"]
                        and all(math.isclose(x, y, rel_tol=0, abs_tol=1e-8)
                                for x, y in zip(tuple(dataset.transform)[:6], transform)),
                        name + ".grid", "Export differs from the declared original study grid")
                require(dataset.tags().get("units") == units, name + ".unit_tag",
                        "Raster unit tag differs from its original annual-mass units")
                count, total = 0, 0.0
                for _, window in dataset.block_windows(1):
                    values = dataset.read(1, window=window, masked=True).compressed().astype("float64")
                    count += values.size
                    require(bool(np.all(np.isfinite(values))) and bool(np.all(values >= 0)),
                            name + ".values", "Native annual export contains negative or nonfinite values")
                    total += float(values.sum(dtype="float64"))
                require(count > 0 and count == original["valid_cells"], name + ".support",
                        "Retained valid-cell support differs from the native artifact")
                require(math.isfinite(total) and math.isclose(
                        total, float(original["sum"]), rel_tol=1e-10, abs_tol=1e-8),
                        name + ".mass", "Raster annual mass differs from its retained native sum")
                summary["valid_cells"][name] = count
                summary["annual_mass"][name] = total
                summary["raster_layers"] += 1
        add("REVIEW", "interpretation",
            "Read the actual modeled study geography, native parameter references, original source editions and paired-cell scenario support with the maps.")
    except (OSError, ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError, ET.ParseError,
            rasterio.errors.RasterioError) as error:
        add("FAIL", "native_study", type(error).__name__ + ": " + str(error))
    failed = sum(item["level"] == "FAIL" for item in findings)
    return {"schema": "commons.native-study-audit/v1",
            "status": "FAIL" if failed else "TECHNICAL_PRECHECK_PASS",
            "failed_checks": failed, "findings": findings, "summary": summary,
            "audit_profile": "original-native-study-grid"}


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--max-manifest-bytes", type=int, default=MAX_JSON_BYTES,
                        help="Maximum bytes for the original manifest and retained study JSON")
    args = parser.parse_args(argv)
    result = inspect(args.manifest, max_manifest_bytes=args.max_manifest_bytes)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["status"] == "TECHNICAL_PRECHECK_PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
