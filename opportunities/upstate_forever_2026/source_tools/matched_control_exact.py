"""Exact, class-stratified, disjoint precipitation matching on an unchanged grid.

This prepares input support only. The maintained Workspace remains responsible
for native NDR/SDR execution and scientific export results.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import html
import json
import math
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import tempfile
import time
from typing import Iterable

import numpy as np

VERSION = "convex-prefix-exact-l1/v1"
HERE = Path(__file__).resolve().parent
PAIR_DTYPE = np.dtype([("target_index", "<u8"), ("control_index", "<u8"), ("residual_integer_units", "<i8")])
INPUT_DTYPE = np.dtype([("value", "<i8"), ("cell", "<u8")])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def compile_matcher(destination: Path) -> Path:
    """Compile this one numerical tool, explicitly requested by its operator."""
    source = HERE / "matched_control_exact.cpp"
    compiler = shutil.which("c++")
    if not compiler:
        raise RuntimeError("A C++17 compiler is needed for --compile; otherwise supply the retained executable with --binary")
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"Preserve the existing executable: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".pending")
    command = [compiler, "-std=c++17", "-O2", "-Wall", "-Wextra", "-o", str(temporary), str(source)]
    started = time.perf_counter()
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
        if completed.returncode:
            raise RuntimeError("Matcher compilation failed: " + completed.stderr[-8000:])
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    write_json(destination.with_suffix(destination.suffix + ".source.json"), {
        "schema": "upstate.exact-matcher-build/v1", "algorithm": VERSION,
        "source_sha256": sha256(source), "binary_sha256": sha256(destination),
        "platform": platform.platform(), "machine": platform.machine(),
        "compiler": subprocess.run([compiler, "--version"], capture_output=True, text=True, check=True).stdout.splitlines()[0],
        "arguments": command, "elapsed_seconds": time.perf_counter() - started,
    })
    return destination


def binary_units(values: np.ndarray) -> tuple[np.ndarray, int]:
    """Losslessly represent positive binary64 values; no decimal quantization."""
    values = np.asarray(values, dtype=np.float64)
    if values.ndim != 1 or not np.isfinite(values).all() or np.any(values <= 0):
        raise ValueError("Matching precipitation must be a finite, positive one-dimensional array")
    if not len(values):
        return np.empty(0, dtype=np.int64), 0
    shift = 53 - int(np.frexp(values.min())[1])
    with np.errstate(over="ignore", under="ignore", invalid="ignore"):
        scaled = np.ldexp(values, shift)
    if not np.isfinite(scaled).all() or np.any(scaled > 2**61) or np.any(scaled != np.floor(scaled)):
        raise ValueError("Precipitation dynamic range exceeds lossless 61-bit binary matching; retain inputs and use a wider-integer implementation")
    integers = scaled.astype(np.int64)
    if not np.array_equal(np.ldexp(integers.astype(np.float64), -shift), values):
        raise ValueError("Precipitation was not preserved by exact binary-unit conversion")
    return integers, shift


def match_points(target_values: np.ndarray, candidate_values: np.ndarray,
                 target_ids: np.ndarray, candidate_ids: np.ndarray,
                 binary: Path, directory: Path) -> tuple[np.ndarray, dict]:
    """Return globally minimum-L1 ordered pairs, without replacement."""
    target_values = np.asarray(target_values, dtype=np.float64)
    candidate_values = np.asarray(candidate_values, dtype=np.float64)
    def original_ids(values: np.ndarray, name: str) -> np.ndarray:
        values = np.asarray(values)
        if values.ndim != 1 or values.dtype.kind not in "iu" or np.any(values < 0):
            raise ValueError(name + " must contain nonnegative original integer cell IDs")
        ids = values.astype(np.uint64, copy=False)
        if len(ids) > 1 and not np.all(ids[1:] > ids[:-1]) and len(np.unique(ids)) != len(ids):
            raise ValueError(name + " repeats an original cell")
        return ids
    target_ids = original_ids(target_ids, "Targets")
    candidate_ids = original_ids(candidate_ids, "Candidates")
    if target_values.ndim != 1 or candidate_values.ndim != 1:
        raise ValueError("Matching precipitation arrays must be one-dimensional")
    if len(target_ids) and len(candidate_ids) and np.isin(target_ids, candidate_ids).any():
        raise ValueError("Target and candidate original cells must be disjoint")
    if len(target_values) != len(target_ids) or len(candidate_values) != len(candidate_ids):
        raise ValueError("Cell identifiers and precipitation lengths differ")
    if len(candidate_ids) < len(target_ids):
        raise ValueError(f"Insufficient eligible controls: {len(candidate_ids)} for {len(target_ids)} targets")
    encoded, shift = binary_units(np.concatenate((target_values, candidate_values)))
    directory.mkdir(parents=True, exist_ok=False)
    input_path, output_path = directory / "matching-input.bin", directory / "matching-pairs.bin"
    with input_path.open("xb") as stream:
        stream.write(b"ECO1D01\n" + struct.pack("<QQ", len(target_ids), len(candidate_ids)))
        offset = 0
        for ids in (target_ids, candidate_ids):
            records = np.empty(len(ids), dtype=INPUT_DTYPE)
            records["cell"] = ids; records["value"] = encoded[offset:offset + len(ids)]
            records.tofile(stream); offset += len(ids)
    del encoded
    started = time.perf_counter()
    result = subprocess.run([str(binary.resolve()), str(input_path), str(output_path)],
                            capture_output=True, text=True, check=False)
    elapsed = time.perf_counter() - started
    if result.returncode:
        raise RuntimeError(f"Exact control matcher failed ({result.returncode}): {result.stderr[-8000:]}")
    native = json.loads(result.stdout)
    with output_path.open("rb") as stream:
        header = stream.read(16)
    if len(header) != 16 or header[:8] != b"ECOPA01\n" or struct.unpack("<Q", header[8:])[0] != len(target_ids):
        raise ValueError("Exact matcher returned a different pair roster")
    if output_path.stat().st_size != 16 + len(target_ids) * PAIR_DTYPE.itemsize:
        raise ValueError("Exact matcher pair bytes are incomplete")
    pairs = np.fromfile(output_path, dtype=PAIR_DTYPE, offset=16)
    if native["algorithm"] != VERSION or native["selected"] != len(target_ids):
        raise ValueError("Unexpected matcher algorithm or selection count")
    if not np.array_equal(np.sort(pairs["target_index"]), np.sort(target_ids)):
        raise ValueError("Matcher did not retain every original target identifier")
    if len(np.unique(pairs["control_index"])) != len(target_ids) or not np.isin(pairs["control_index"], candidate_ids).all():
        raise ValueError("Matcher reused a control or selected a different candidate")
    native.update(binary_scale_exponent=shift, elapsed_seconds=elapsed,
                  objective_sum_absolute_precipitation_residual_mm_year=math.ldexp(int(native["objective_integer_units"]), -shift),
                  input_sha256=sha256(input_path), pairs_sha256=sha256(output_path))
    write_json(directory / "matching-result.json", native)
    return pairs, native


def _mean(values: np.ndarray) -> float | None:
    return float(np.mean(values, dtype=np.float64)) if len(values) else None


def match_arrays(landcover: np.ndarray, precipitation: np.ndarray, corridor: np.ndarray,
                 valid_mask: np.ndarray, *, from_codes: Iterable[int], to_code: int,
                 pixel_area_ha: float, binary: Path, output: Path,
                 reporting_mask: np.ndarray | None = None,
                 reporting_stratified: bool = False,
                 support_fields: dict[str, np.ndarray] | None = None) -> tuple[np.ndarray, dict]:
    """Prepare an exact disjoint control over authoritative model-domain cells.

    Reporting stratification is an explicit new objective constraint. The default
    preserves class-only matching and reports each mask's actual area separately.
    """
    shape = np.asarray(landcover).shape
    arrays = [np.asarray(x) for x in (landcover, precipitation, corridor, valid_mask)]
    if any(a.shape != shape for a in arrays) or len(shape) != 2:
        raise ValueError("Land cover, precipitation, corridor and valid mask must share one unchanged two-dimensional grid")
    if not math.isfinite(pixel_area_ha) or pixel_area_ha <= 0:
        raise ValueError("A positive projected pixel area in hectares is required")
    lc, rain, corr, domain = [a.reshape(-1) for a in arrays]
    if not np.isin(domain, (0, 1)).all():
        raise ValueError("The authoritative valid-domain mask must be binary")
    valid = domain.astype(bool)
    if not valid.any() or not np.isfinite(rain[valid]).all() or np.any(rain[valid] <= 0):
        raise ValueError("Every valid model-domain cell needs positive finite precipitation")
    if not np.isfinite(lc[valid]).all() or not np.equal(lc[valid], np.floor(lc[valid])).all():
        raise ValueError("Valid land-cover classes must be finite integers")
    if not np.isin(corr[valid], (0, 1)).all():
        raise ValueError("The complete restoration corridor must be binary on model support")
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError("Supply the retained exact matcher executable, or explicitly compile it first")
    codes = list(from_codes)
    if not codes or any(not isinstance(c, (int, np.integer)) or isinstance(c, bool) for c in codes):
        raise ValueError("Source land-cover codes must be explicit integers")
    if not isinstance(to_code, (int, np.integer)) or isinstance(to_code, bool):
        raise ValueError("The restoration land-cover code must be an integer")
    if len(set(codes)) != len(codes) or to_code in codes:
        raise ValueError("The source classes and restoration class must be distinct")
    report = None
    if reporting_mask is not None:
        report_array = np.asarray(reporting_mask)
        if report_array.shape != shape or not np.isin(report_array, (0, 1)).all():
            raise ValueError("Reporting mask must retain the same grid and binary values")
        report = report_array.reshape(-1).astype(bool)
    if reporting_stratified and report is None:
        raise ValueError("Explicit reporting stratification requires the original reporting mask")
    support = {}
    for name, field in (support_fields or {}).items():
        field = np.asarray(field)
        if field.shape != shape:
            raise ValueError(f"Support field grid differs: {name}")
        support[name] = field.reshape(-1)
    if output.exists():
        raise FileExistsError(f"Preserve completed/partial source at {output}; choose a new output directory")
    output.mkdir(parents=True)
    selected = np.zeros(lc.size, dtype=np.uint8)
    target_all = valid & (corr == 1) & np.isin(lc, codes)
    strata = (False, True) if reporting_stratified else (None,)
    groups = []
    pair_path = output / "control-pairs.csv"
    with pair_path.open("x", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["from_code", "reporting_stratum", "target_index", "control_index", "target_row", "target_col",
                         "control_row", "control_col", "target_precipitation_mm_year", "control_precipitation_mm_year",
                         "precipitation_residual_mm_year", "residual_integer_units", "binary_scale_exponent"])
        for code in sorted(codes):
            for reporting_stratum in strata:
                member = valid & (lc == code)
                if reporting_stratum is not None:
                    member &= report == reporting_stratum
                targets = np.flatnonzero(member & (corr == 1))
                candidates = np.flatnonzero(member & (corr == 0))
                label = str(code) + ("-reporting" if reporting_stratum is True else "-upstream-only" if reporting_stratum is False else "")
                if len(candidates) < len(targets):
                    raise ValueError(f"Class/stratum {label}: {len(targets)} targets but only {len(candidates)} disjoint eligible cells")
                pairs, native = match_points(rain[targets], rain[candidates], targets, candidates, binary, output / label)
                ti = pairs["target_index"].astype(np.intp); ci = pairs["control_index"].astype(np.intp)
                if np.any(selected[ci]) or np.any(corr[ci] != 0) or np.any(~valid[ci]) or np.any(lc[ti] != lc[ci]):
                    raise ValueError("Control selection lost its original class, corridor or model support")
                selected[ci] = 1
                residual = np.ldexp(pairs["residual_integer_units"].astype(np.float64), -native["binary_scale_exponent"])
                group = {
                    "from_code": int(code), "to_code": int(to_code), "reporting_stratum": reporting_stratum,
                    "target_cells": len(targets), "control_cells": len(ci), "eligible_off_corridor_cells": len(candidates),
                    "area_ha": len(targets) * pixel_area_ha,
                    "target_precipitation_mean_mm_year": _mean(rain[ti]),
                    "control_precipitation_mean_mm_year": _mean(rain[ci]),
                    "precipitation_sum_residual_mm_year": float(math.fsum(residual)),
                    "mean_absolute_paired_precipitation_residual_mm_year": _mean(np.abs(residual)),
                    "max_absolute_paired_precipitation_residual_mm_year": float(np.max(np.abs(residual))) if len(residual) else 0.0,
                    "native": native,
                    "target_reporting_cells": int(report[ti].sum()) if report is not None else None,
                    "control_reporting_cells": int(report[ci].sum()) if report is not None else None,
                    "unmatched_support_fields": {},
                }
                for name, values in support.items():
                    a, b = values[ti], values[ci]
                    af, bf = a[np.isfinite(a)], b[np.isfinite(b)]
                    group["unmatched_support_fields"][name] = {
                        "target_mean": _mean(af), "control_mean": _mean(bf),
                        "target_finite_cells": len(af), "control_finite_cells": len(bf),
                        "matched_by_selector": False,
                    }
                for p, error in zip(pairs, residual):
                    a, b = int(p["target_index"]), int(p["control_index"])
                    writer.writerow((code, "" if reporting_stratum is None else int(reporting_stratum), a, b,
                                     a // shape[1], a % shape[1], b // shape[1], b % shape[1],
                                     repr(float(rain[a])), repr(float(rain[b])), repr(float(error)),
                                     int(p["residual_integer_units"]), native["binary_scale_exponent"]))
                groups.append(group)
    count = int(selected.sum())
    if count != int(target_all.sum()) or np.any((selected == 1) & (corr == 1)):
        raise ValueError("Final control does not preserve the complete disjoint target count")
    result = {
        "schema": "upstate.regional-exact-control/v1", "algorithm": VERSION,
        "matching_constraints": ["original-landcover-class", "whole-model-cell-area", "complete-corridor-exclusion", "valid-model-domain"]
            + (["reporting-mask-membership"] if reporting_stratified else []),
        "objective": "Minimum total absolute paired precipitation difference within every declared stratum",
        "tie_rule": "Exact zero slopes inserted before existing zeros; reverse reconstruction skips the later equal-cost candidate. Original precipitation/cell order is deterministic.",
        "implementation": {"python_sha256": sha256(Path(__file__)), "cpp_sha256": sha256(HERE / "matched_control_exact.cpp"),
                           "binary_sha256": sha256(binary)},
        "grid_shape": list(shape), "model_domain_cells": int(valid.sum()),
        "target_cells": int(target_all.sum()), "control_cells": count,
        "target_area_ha": int(target_all.sum()) * pixel_area_ha, "control_area_ha": count * pixel_area_ha,
        "overlap_cells": 0, "outside_model_domain_cells": int(np.count_nonzero(selected[~valid])),
        "common_grid_precipitation_mean_mm_year": _mean(rain[valid]),
        "target_reporting_area_ha": int(np.count_nonzero(target_all & report)) * pixel_area_ha if report is not None else None,
        "control_reporting_area_ha": int(np.count_nonzero((selected == 1) & report)) * pixel_area_ha if report is not None else None,
        "groups": groups, "pairs": {"path": pair_path.name, "sha256": sha256(pair_path), "bytes": pair_path.stat().st_size},
        "interpretation": [
            "Physical input classification and geographic source identity are inherited from the selected original input edition.",
            "Class counts and changed model-grid area match exactly. Precipitation matching minimizes absolute paired error without candidate reuse or rainfall quantization.",
            "The full original restoration corridor is excluded, including corridor cells whose original class would not change.",
            "Model-domain matching and South Carolina reporting are distinct supports. Reporting areas match only when reporting stratification was explicitly selected.",
            "Soil erodibility, rainfall erosivity, terrain, routing distance, patch shape and upstream area are not matched by this selector; their siting differences remain in the native scenario comparison.",
            "This output prepares a control input. Annual nitrogen/phosphorus kg/year and sediment tonnes/year reaching streams come from the existing native NDR/SDR calculation on paired valid support.",
        ],
    }
    write_json(output / "control-summary.json", result)
    np.save(output / "control-mask.npy", selected.reshape(shape), allow_pickle=False)
    return selected.reshape(shape), result


def write_report(directory: Path, result: dict) -> None:
    """Recipient-facing exact-support overview, with full original pair download."""
    esc = lambda value: html.escape(str(value))
    def number(value):
        return "Not supplied" if value is None else f"{value:,.6g}"
    rows = []
    for group in result["groups"]:
        rows.append("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in (
            group["from_code"], "All model support" if group["reporting_stratum"] is None else "Reporting" if group["reporting_stratum"] else "Upstream only",
            f'{group["target_cells"]:,}', f'{group["control_cells"]:,}', number(group["area_ha"]),
            number(group["mean_absolute_paired_precipitation_residual_mm_year"]),
            number(group["max_absolute_paired_precipitation_residual_mm_year"]),
            number(group["native"]["elapsed_seconds"]))) + "</tr>")
    details = "".join("<p>" + esc(text) + "</p>" for text in result["interpretation"])
    support_rows = []
    for group in result["groups"]:
        for key, values in group["unmatched_support_fields"].items():
            support_rows.append("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in (
                group["from_code"], key, number(values["target_mean"]), number(values["control_mean"]),
                f'{values["target_finite_cells"]:,}', f'{values["control_finite_cells"]:,}')) + "</tr>")
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Matched restoration control | Input support</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#fff;color:#202020;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:32px 24px}h1{font-size:30px;line-height:1.2;margin:8px 0 18px}h2{font-size:21px;margin-top:30px}.tag{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#555}.summary{padding:18px;border:1px solid #aaa;background:#f7f7f7}.summary p{margin:4px 0}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}a,button{font:inherit;color:#202020;background:#fff;border:1px solid #777;border-radius:3px;padding:8px 12px;text-decoration:none;cursor:pointer}a:hover,button:hover{background:#eee}a:focus-visible,button:focus-visible,.table:focus-visible{outline:3px solid #555;outline-offset:3px}.table{overflow-x:auto;border:1px solid #bbb}table{border-collapse:collapse;width:100%;min-width:810px;font-size:14px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #ddd;white-space:nowrap}th{background:#eee;font-weight:600}td{font-variant-numeric:tabular-nums}p,li{overflow-wrap:anywhere}footer{margin-top:32px;padding-top:16px;border-top:1px solid #bbb;color:#555;font-size:13px}@media(max-width:480px){main{padding:22px 16px}h1{font-size:25px}}@media print{nav{display:none}main{max-width:none;padding:0}.table{overflow:visible}table{min-width:0;font-size:10px}th,td{padding:5px;white-space:normal}h2{break-after:avoid}tr{break-inside:avoid}}
</style><main><div class="tag">Ecosystem Sciences / Input comparison</div><h1>Matched restoration control</h1>'''
    page += '<p>' + esc(result.get("input_classification", "Original declared input edition")) + '</p>'
    page += '<div class="summary"><p><strong>' + f'{result["control_cells"]:,}' + ' control cells / ' + number(result["control_area_ha"]) + ' hectares</strong></p>'
    page += '<p>Exact original-class area matching. No corridor overlap. Minimum paired absolute precipitation mismatch.</p>'
    page += '<p>Reporting area: treatment ' + number(result["target_reporting_area_ha"]) + ' ha; control ' + number(result["control_reporting_area_ha"]) + ' ha.</p></div>'
    page += '<nav aria-label="Downloads"><a href="control-pairs.csv" download>Download every matched pair</a><a href="control-summary.json" download>Download full summary</a><a href="control-mask.npy" download>Download original-grid mask</a><button onclick="window.print()">Print</button></nav>'
    page += '<h2>Matching by original class</h2><p>Precipitation differences are in mm/year. Elapsed time is this matching process, not the watershed model.</p><div class="table" tabindex="0" aria-label="Matching table; scroll horizontally"><table><thead><tr><th>Class</th><th>Support</th><th>Treatment cells</th><th>Control cells</th><th>Area ha</th><th>Mean absolute error</th><th>Maximum error</th><th>Matching seconds</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table></div>'
    if support_rows:
        page += '<h2>Other physical inputs</h2><p>These inputs retain their original cell values and are not matching constraints.</p><div class="table" tabindex="0"><table><thead><tr><th>Class</th><th>Field</th><th>Treatment mean</th><th>Control mean</th><th>Treatment finite cells</th><th>Control finite cells</th></tr></thead><tbody>' + ''.join(support_rows) + '</tbody></table></div>'
    page += '<h2>Use in the native comparison</h2>' + details + '<footer>Algorithm: ' + esc(VERSION) + '. Retain this source edition with its original input recipe, class masks and native run selection.</footer></main></html>'
    (directory / "index.html").write_text(page, encoding="utf-8")


def raster_main(args: argparse.Namespace) -> dict:
    import rasterio
    paths = {"landcover": Path(args.landcover), "precipitation": Path(args.precipitation),
             "corridor": Path(args.corridor), "domain": Path(args.domain)}
    if args.reporting:
        paths["reporting"] = Path(args.reporting)
    support_paths = {}
    for item in args.support:
        name, sep, path = item.partition("=")
        if not sep or not name or name in support_paths:
            raise ValueError("Use unique --support NAME=RASTER arguments")
        support_paths[name] = Path(path)
    values = {}; reference = None
    for name, path in {**paths, **{f"support:{k}": v for k,v in support_paths.items()}}.items():
        with rasterio.open(path) as src:
            identity = (src.width, src.height, src.crs, src.transform)
            if reference is None:
                reference = identity; profile = src.profile.copy()
            elif identity != reference:
                raise ValueError(f"Input raster {name} differs in grid, CRS or affine transform; no resampling is performed")
            array = src.read(1, masked=True)
            if name in ("domain", "reporting"):
                values[name] = np.asarray(array.filled(0))
            elif name == "corridor":
                values[name] = np.asarray(array.filled(-9999))
            else:
                values[name] = np.asarray(array.astype(np.float64).filled(np.nan))
    if not reference[2] or not reference[2].is_projected or reference[2].linear_units != "metre":
        raise ValueError("The unchanged model grid must use a projected metre CRS")
    transform = reference[3]
    area = abs(transform.a * transform.e - transform.b * transform.d) / 10000.0
    if not math.isclose(abs(transform.a), 30.0, rel_tol=0, abs_tol=1e-9) or not math.isclose(abs(transform.e), 30.0, rel_tol=0, abs_tol=1e-9) or transform.b != 0 or transform.d != 0:
        raise ValueError("This receiving course requires the owner's unchanged north-up 30 m grid")
    binary = Path(args.binary).resolve()
    if args.compile:
        binary = compile_matcher(binary)
    output = Path(args.output).resolve()
    mask, result = match_arrays(values["landcover"], values["precipitation"], values["corridor"], values["domain"],
        from_codes=args.from_codes, to_code=args.to_code, pixel_area_ha=area, binary=binary, output=output,
        reporting_mask=values.get("reporting"), reporting_stratified=args.reporting_stratified,
        support_fields={name: values["support:" + name] for name in support_paths})
    profile.update(driver="GTiff", count=1, dtype="uint8", nodata=255, compress="deflate")
    path = output / "matched-control-mask.tif"
    final_mask = np.where(values["domain"] == 1, mask, 255).astype(np.uint8)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(final_mask, 1)
        dst.update_tags(role="MATCHED_CONTROL_MASK", algorithm=VERSION, input_manifest_sha256=sha256(Path(args.source_manifest)))
    source_document = json.loads(Path(args.source_manifest).read_text(encoding="utf-8-sig"))
    result["input_classification"] = source_document.get("classification", "Original declared input edition")
    result["grid"] = {"width": reference[0], "height": reference[1], "crs": str(reference[2]),
                      "transform": list(transform)[:6], "pixel_area_ha": area}
    result["input_sources"] = {name: {"path": str(path.resolve()), "sha256": sha256(path)}
                               for name, path in {**paths, **{f"support:{k}":v for k,v in support_paths.items()}}.items()}
    manifest_path = Path(args.source_manifest).resolve(strict=True)
    result["source_manifest"] = {"original_path": str(manifest_path), "sha256": sha256(manifest_path)}
    shutil.copyfile(manifest_path, output / "original-source-manifest.json")
    result["mask_raster"] = {"path": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}
    write_json(output / "control-summary.json", result)
    write_report(output, result)
    write_json(output / "artifacts.json", {"schema":"upstate.control-artifacts/v1", "files":[
        {"path":p.relative_to(output).as_posix(), "bytes":p.stat().st_size, "sha256":sha256(p)}
        for p in sorted(output.rglob("*")) if p.is_file()]})
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("landcover", "precipitation", "corridor", "domain", "source-manifest", "output"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--reporting")
    parser.add_argument("--reporting-stratified", action="store_true")
    parser.add_argument("--support", action="append", default=[])
    parser.add_argument("--from-codes", nargs="+", type=int, default=[81,82])
    parser.add_argument("--to-code", type=int, default=41)
    parser.add_argument("--binary", default=str(HERE / "matched-control-exact"))
    parser.add_argument("--compile", action="store_true")
    args = parser.parse_args()
    started = time.perf_counter()
    try:
        result = raster_main(args)
        print(json.dumps({"state":"complete", "output":str(Path(args.output).resolve()),
                          "algorithm":VERSION, "control_cells":result["control_cells"],
                          "control_area_ha":result["control_area_ha"], "elapsed_seconds":time.perf_counter()-started}, allow_nan=False))
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({"state":"failed", "type":type(error).__name__, "message":str(error)}), file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
