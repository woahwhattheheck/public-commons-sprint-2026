"""Prepare a scalable, class-matched control on an original regional raster grid.

Original geographic masks and simulated physical inputs remain declared sources.
This module performs explicitly selected local or exact precipitation matching; native NDR/SDR
and the existing regional producer retain calculation and execution ownership.
"""
from __future__ import annotations
import argparse
import csv
import heapq
import itertools
import json
import math
import os
from pathlib import Path
import shutil
import struct
import sys
import time

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

ROLES = ("NLCD", "PRECIPITATION", "RESTORATION_MASK", "MODEL_DOMAIN_MASK")
OPTIONAL_ROLES = ("RESTORED_NLCD", "REPORTING_MASK")
METHOD = "class-stratified-ascending-target-nearest-available-precipitation/v1"
EXACT_METHOD = "class-stratified-exact-monge-L1-dyadic/v1"
RECORD = struct.Struct("<dQ")
PAIR_FIELDS = ("from_code", "target_index", "target_row", "target_col",
               "control_index", "control_row", "control_col",
               "target_precipitation_mm_year", "control_precipitation_mm_year",
               "precipitation_residual_mm_year")
INTERPRETATION = [
    "Physical fields are explicitly simulated; original geographic source masks retain their selected identities.",
    "Changed cell counts and area match exactly within each original land-cover class. Every restoration-corridor cell is excluded from the control.",
    "Targets are visited by increasing precipitation then original row-major index. Each target selects the nearest still-available same-class precipitation.",
    "This is deterministic local nearest-available matching, not the original small-square global minimum-L1 optimizer.",
    "Equal lower/upper distances select the lower-precipitation side; an equal-valued lower stack selects its last original row-major index. Upper candidates retain ascending original index.",
    "The full per-cell precipitation residual is retained. Erodibility, erosivity, slope, routing distance, shape and contributing area are not matched.",
    "Native annual nitrogen/phosphorus kg/year and sediment tonnes/year are delivery to streams; this input preparation computes no model export or intake concentration."
]


def _sha(path):
    import hashlib
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def _identity(path):
    path = Path(path)
    return {"bytes": path.stat().st_size, "sha256": _sha(path)}


def _descriptor(root, path):
    return {"path": Path(path).relative_to(root).as_posix(), **_identity(path)}


def _json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _check(path, expected):
    actual = _identity(path)
    if any(actual[key] != expected[key] for key in ("bytes", "sha256")):
        raise ValueError("Original retained source differs: " + str(path))
    return actual


def _records(path, block_records=4096):
    with Path(path).open("rb") as stream:
        while True:
            block = stream.read(RECORD.size * block_records)
            if not block:
                break
            if len(block) % RECORD.size:
                raise ValueError("Incomplete retained sort record")
            yield from RECORD.iter_unpack(block)


def _merge(paths, output):
    """A bounded fan-in merge: one small block per sorted input."""
    with Path(output).open("wb") as stream:
        for rain, index in heapq.merge(*(_records(p) for p in paths)):
            stream.write(RECORD.pack(rain, index))
        stream.flush()
        os.fsync(stream.fileno())


def _sorted_records(raw, directory, sort_records, emit):
    import numpy as np
    from model.common import atomic_json
    directory.mkdir(parents=True, exist_ok=True)
    final, receipt = directory / "sorted.bin", directory / "sorted.json"
    original = _identity(raw)
    if receipt.exists():
        saved = _json(receipt)
        if saved["original"] != original:
            raise ValueError("Existing sorted source belongs to another input")
        _check(final, saved["sorted"])
        return final
    # Rebuild only an interrupted owned sort; complete scans/matches remain.
    for item in directory.iterdir():
        if item.is_file():
            item.unlink()
    dtype = np.dtype([("rain", "<f8"), ("index", "<u8")])
    runs = []
    with Path(raw).open("rb") as source:
        while True:
            data = np.fromfile(source, dtype=dtype, count=sort_records)
            if not data.size:
                break
            data.sort(order=["rain", "index"], kind="stable")
            target = directory / ("run-%06d.bin" % len(runs))
            with target.open("wb") as stream:
                data.tofile(stream)
            runs.append(target)
            emit("sorting", input=Path(raw).name, runs=len(runs))
    if not runs:
        final.write_bytes(b"")
    else:
        generation = 0
        while len(runs) > 1:
            next_runs = []
            for number in range(0, len(runs), 32):
                selected = runs[number:number + 32]
                target = directory / ("merge-%03d-%06d.bin" % (generation, number))
                _merge(selected, target)
                for old in selected:
                    old.unlink()
                next_runs.append(target)
            runs = next_runs
            generation += 1
        os.replace(runs[0], final)
    atomic_json(receipt, {"original": original, "sorted": _identity(final)})
    return final


def _match_class(targets, candidates, directory, code, width, emit):
    """O(n+m) after sorting, with a disk stack instead of unbounded RAM."""
    from model.common import atomic_json
    directory.mkdir(parents=True, exist_ok=True)
    completed = directory / "complete.json"
    binding = {"targets": _identity(targets), "candidates": _identity(candidates),
               "class": code, "width": width, "method": METHOD}
    if completed.exists():
        saved = _json(completed)
        if saved["binding"] != binding:
            raise ValueError("Retained matching belongs to another original support")
        for item in saved["files"]:
            _check(directory / item["path"], item)
        return saved
    n = binding["targets"]["bytes"] // RECORD.size
    m = binding["candidates"]["bytes"] // RECORD.size
    if m < n:
        raise ValueError("Insufficient off-corridor class %s cells: %s targets, %s candidates" % (code, n, m))
    pair_path, selected_path = directory / "pairs.csv", directory / "selected.bin"
    stack_path = directory / "lower-candidates.bin"
    candidate_iterator = iter(_records(candidates))
    following = next(candidate_iterator, None)
    top, depth, matched = None, 0, 0
    residual_sum = absolute_sum = target_sum = control_sum = max_absolute = 0.0
    with stack_path.open("w+b") as stack, pair_path.open("w", newline="", encoding="utf-8") as pairs, selected_path.open("wb") as selected:
        writer = csv.writer(pairs)
        writer.writerow(PAIR_FIELDS)
        for target_rain, target_index in _records(targets):
            while following is not None and following[0] <= target_rain:
                stack.seek(depth * RECORD.size)
                stack.write(RECORD.pack(*following))
                depth += 1
                top = following
                following = next(candidate_iterator, None)
            lower_distance = target_rain - top[0] if top is not None else math.inf
            upper_distance = following[0] - target_rain if following is not None else math.inf
            if lower_distance <= upper_distance:
                if top is None:
                    raise ValueError("No original same-class control candidate remains")
                control_rain, control_index = top
                depth -= 1
                if depth:
                    stack.seek((depth - 1) * RECORD.size)
                    top = RECORD.unpack(stack.read(RECORD.size))
                else:
                    top = None
            else:
                control_rain, control_index = following
                following = next(candidate_iterator, None)
            residual = control_rain - target_rain
            selected.write(struct.pack("<Q", control_index))
            writer.writerow((code, target_index, target_index // width, target_index % width,
                             control_index, control_index // width, control_index % width,
                             repr(target_rain), repr(control_rain), repr(residual)))
            target_sum += target_rain
            control_sum += control_rain
            residual_sum += residual
            absolute_sum += abs(residual)
            max_absolute = max(max_absolute, abs(residual))
            matched += 1
            if matched % 100000 == 0:
                emit("matching", from_code=code, matched=matched, targets=n)
        for stream in (pairs, selected):
            stream.flush()
            os.fsync(stream.fileno())
    if matched != n:
        raise ValueError("Original target count changed during matching")
    stack_path.unlink()
    saved = {"binding": binding, "from_code": code, "target_cells": n,
             "control_cells": matched, "eligible_off_corridor_cells": m,
             "target_precipitation_sum_mm_year": target_sum,
             "control_precipitation_sum_mm_year": control_sum,
             "precipitation_sum_residual_mm_year": residual_sum,
             "mean_absolute_paired_precipitation_residual_mm_year": absolute_sum / n if n else None,
             "max_absolute_paired_precipitation_residual_mm_year": max_absolute if n else None,
             "sum_absolute_paired_precipitation_residual_mm_year": absolute_sum,
             "files": [_descriptor(directory, p) for p in (pair_path, selected_path)]}
    atomic_json(completed, saved)
    return saved



def _match_class_exact(targets, candidates, directory, code, width, emit, max_working_bytes):
    """Compose the original exact Monge kernel on retained disk records."""
    import numpy as np
    from model.common import atomic_json
    from source_tools.precipitation_matching import match_precipitation, _binary_unit, METHOD as KERNEL_METHOD
    if KERNEL_METHOD != EXACT_METHOD:
        raise ValueError("Receive the original declared exact-kernel edition before matching")
    directory.mkdir(parents=True, exist_ok=True)
    completed = directory / "complete.json"
    binding = {"targets": _identity(targets), "candidates": _identity(candidates),
               "class": code, "width": width, "method": EXACT_METHOD}
    if completed.exists():
        saved = _json(completed)
        if saved["binding"] != binding:
            raise ValueError("Retained exact matching belongs to another original support")
        for item in saved["files"]:
            _check(directory / item["path"], item)
        return saved
    n = binding["targets"]["bytes"] // RECORD.size
    m = binding["candidates"]["bytes"] // RECORD.size
    if m < n:
        raise ValueError("Insufficient original same-class candidates for exact matching")
    # Covers retained-record pages, dtype/ID conversions, sorting and vectorized
    # separator temporaries conservatively. This is an admission estimate, not
    # a claim that the process/OS enforces an allocation ceiling.
    estimated = 256 * n + 96 * m + 256 * 1024 * 1024 if n else 0
    emit("exact_admission", from_code=code, targets=n, candidates=m,
         estimated_working_bytes=estimated, admitted_working_bytes=max_working_bytes)
    if estimated > max_working_bytes:
        raise ValueError("Exact class %s needs an estimated %s working bytes; admitted %s. "
                         "Choose sufficient native capacity or explicitly select the separate greedy method."
                         % (code, estimated, max_working_bytes))
    if not n:
        pair_path, selected_path = directory / "pairs.csv", directory / "selected.bin"
        with pair_path.open("w", newline="", encoding="utf-8") as pairs:
            csv.writer(pairs).writerow(PAIR_FIELDS)
            pairs.flush()
            os.fsync(pairs.fileno())
        with selected_path.open("wb") as selected:
            selected.flush()
            os.fsync(selected.fileno())
        saved = {"binding": binding, "from_code": code, "target_cells": 0,
                 "control_cells": 0, "eligible_off_corridor_cells": m,
                 "target_precipitation_sum_mm_year": 0.0, "control_precipitation_sum_mm_year": 0.0,
                 "precipitation_sum_residual_mm_year": 0.0,
                 "mean_absolute_paired_precipitation_residual_mm_year": None,
                 "max_absolute_paired_precipitation_residual_mm_year": None,
                 "sum_absolute_paired_precipitation_residual_mm_year": 0.0,
                 "exact_matching": {"method": EXACT_METHOD, "target_cells": 0,
                     "eligible_candidate_cells": m,
                     "exact_objective": {"integer": "0", "binary_exponent": 0},
                     "optimization": "Empty target population has exact zero objective"},
                 "estimated_working_bytes": 0, "admitted_working_bytes": max_working_bytes,
                 "files": [_descriptor(directory, path) for path in (pair_path, selected_path)]}
        atomic_json(completed, saved)
        return saved
    dtype = np.dtype([("rain", "<f8"), ("index", "<u8")])
    a = np.memmap(targets, dtype=dtype, mode="r") if n else np.empty(0, dtype=dtype)
    b = np.memmap(candidates, dtype=dtype, mode="r") if m else np.empty(0, dtype=dtype)
    unit = _binary_unit((a["rain"], b["rain"]), None)
    maximum = max(float(a["rain"].max(initial=0)), float(b["rain"].max(initial=0)))
    try:
        scaled = math.ldexp(maximum, -unit)
    except OverflowError:
        scaled = math.inf
    if scaled > 1 << 61:
        raise ValueError("These exact precipitation exponents require the kernel's Python-integer path. "
                         "This numeric-array memory admission does not cover that allocation; retain the inputs "
                         "and arrange an explicit native capacity plan before running exact matching.")
    ticks = 0
    def check_running():
        nonlocal ticks
        ticks += 1
        emit("exact_matching", from_code=code, targets=n, candidates=m, kernel_check=ticks)
    result = match_precipitation(a["rain"], b["rain"], target_ids=a["index"],
                                candidate_ids=b["index"], check_running=check_running)
    if result.target_count != n or result.candidate_count != m:
        raise ValueError("Exact kernel changed the retained input populations")
    pair_path, selected_path = directory / "pairs.csv", directory / "selected.bin"
    residual_sum = absolute_sum = target_sum = control_sum = max_absolute = 0.0
    with pair_path.open("w", newline="", encoding="utf-8") as pairs, selected_path.open("wb") as selected:
        writer = csv.writer(pairs)
        writer.writerow(PAIR_FIELDS)
        for start in range(0, n, 65536):
            stop = min(n, start + 65536)
            positions = result.candidate_positions[start:stop]
            if np.any(positions < 0) or np.any(positions >= m):
                raise ValueError("Exact kernel returned a candidate outside its original population")
            chosen = b[positions]
            indices = chosen["index"].astype("<u8", copy=False)
            indices.tofile(selected)
            target_block = a[start:stop]
            residual = chosen["rain"] - target_block["rain"]
            target_sum += float(target_block["rain"].sum(dtype="float64"))
            control_sum += float(chosen["rain"].sum(dtype="float64"))
            residual_sum += float(residual.sum(dtype="float64"))
            absolute_sum += float(np.abs(residual).sum(dtype="float64"))
            max_absolute = max(max_absolute, float(np.abs(residual).max(initial=0)))
            writer.writerows((code, int(t["index"]), int(t["index"]) // width, int(t["index"]) % width,
                              int(c["index"]), int(c["index"]) // width, int(c["index"]) % width,
                              repr(float(t["rain"])), repr(float(c["rain"])), repr(float(d)))
                             for t, c, d in zip(target_block, chosen, residual))
            emit("exact_pairs", from_code=code, matched=stop, targets=n)
        for stream in (pairs, selected):
            stream.flush()
            os.fsync(stream.fileno())
    _check(targets, binding["targets"])
    _check(candidates, binding["candidates"])
    saved = {"binding": binding, "from_code": code, "target_cells": n,
             "control_cells": n, "eligible_off_corridor_cells": m,
             "target_precipitation_sum_mm_year": target_sum,
             "control_precipitation_sum_mm_year": control_sum,
             "precipitation_sum_residual_mm_year": residual_sum,
             "mean_absolute_paired_precipitation_residual_mm_year": absolute_sum / n if n else None,
             "max_absolute_paired_precipitation_residual_mm_year": max_absolute if n else None,
             "sum_absolute_paired_precipitation_residual_mm_year": absolute_sum,
             "exact_matching": result.metadata(), "estimated_working_bytes": estimated,
             "admitted_working_bytes": max_working_bytes,
             "files": [_descriptor(directory, path) for path in (pair_path, selected_path)]}
    atomic_json(completed, saved)
    return saved


def _implementation_snapshot():
    retained = {"regional_matched_control.py": Path(__file__).read_bytes()}
    for name, source in (("REGIONAL_MATCHED_CONTROL.md", Path(__file__).with_name("REGIONAL_MATCHED_CONTROL.md")),
                         ("CURRENT_OWNER_DIRECTION.md", APP / "CURRENT_OWNER_DIRECTION.md"),
                         ("geographic_matched_control.py", Path(__file__).with_name("geographic_matched_control.py")),
                         ("precipitation_matching.py", Path(__file__).with_name("precipitation_matching.py")),
                         ("MATCHED_CONTROL_MATCHING.md", Path(__file__).with_name("MATCHED_CONTROL_MATCHING.md"))):
        if source.is_file():
            retained[name] = source.read_bytes()
    return retained


def prepare(configuration, configuration_directory, output, *, progress=None, _retained_code=None):
    import contextlib
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    from model.common import atomic_json, digest, held

    configuration = json.loads(json.dumps(configuration, allow_nan=False))
    retained_code = dict(_retained_code) if _retained_code is not None else _implementation_snapshot()
    import hashlib
    retained_code_identity = {name: {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                              for name, body in retained_code.items()}
    started = time.perf_counter()
    def emit(stage, **values):
        if progress:
            progress({"stage": stage, "elapsed_seconds": time.perf_counter() - started, **values})

    if configuration.get("schema") != "upstate.regional-matched-control-input/v1":
        raise ValueError("Use the explicit regional matched-control input schema")
    method_option = configuration.get("matching_method", "greedy")
    if method_option not in ("greedy", "exact_monge"):
        raise ValueError("Choose an explicit greedy or exact_monge matching method")
    method = EXACT_METHOD if method_option == "exact_monge" else METHOD
    max_working_bytes = configuration.get("max_working_bytes", 1024 * 1024 * 1024)
    if type(max_working_bytes) is not int or max_working_bytes <= 0:
        raise ValueError("Declare positive integer admitted working bytes")
    codes = configuration.get("from_codes", [81, 82])
    to_code = configuration.get("to_code", 41)
    if (not isinstance(codes, list) or not codes or any(type(x) is not int for x in codes)
            or len(set(codes)) != len(codes) or type(to_code) is not int or to_code in codes):
        raise ValueError("Declare distinct integer original classes and a different target class")
    codes = sorted(codes)
    sort_records = configuration.get("sort_records", 262144)
    window_size = configuration.get("window_size", 512)
    if type(sort_records) is not int or not 4096 <= sort_records <= 1048576:
        raise ValueError("sort_records must be 4096..1048576")
    if type(window_size) is not int or not 64 <= window_size <= 2048:
        raise ValueError("window_size must be 64..2048")
    declared = configuration.get("sources", {})
    if set(declared) not in (set(ROLES), set(ROLES + OPTIONAL_ROLES)):
        raise ValueError("Supply the four original roles, optionally with both RESTORED_NLCD and REPORTING_MASK")
    roles = ROLES + OPTIONAL_ROLES if "RESTORED_NLCD" in declared else ROLES
    paths, sources = {}, {}
    for role in roles:
        item = declared[role]
        source = (Path(configuration_directory) / item["path"]).resolve(strict=True)
        if not source.is_file():
            raise ValueError("Original source must be a regular raster file")
        sources[role] = {**item, **_check(source, item), "original_path": str(source)}
        paths[role] = source
    binding = {"schema": "upstate.regional-matched-control-binding/v1",
               "configuration": configuration, "sources": sources,
               "implementation": retained_code_identity["regional_matched_control.py"],
               "retained_implementation": retained_code_identity, "method": method}
    key = digest(binding)
    root = Path(output).resolve() / key
    # Never place an original input inside the owned output tree.
    for original in paths.values():
        if root == original or root in original.parents:
            raise ValueError("Use a control output tree that does not contain original input files")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".prepare.lock", blocking=False):
        final = root / "control-prepared.json"
        if final.exists():
            prior = _json(final)
            if prior["binding"] != binding:
                raise ValueError("Continue the same original source/control binding")
            for item in prior["files"]:
                _check(root / item["path"], item)
            emit("complete", reused=True, changed_cells=prior["summary"]["changed_cells"])
            return prior
        atomic_json(root / "configuration.json", configuration, immutable=True)
        atomic_json(root / "binding.json", binding, immutable=True)
        work = root / "work"
        work.mkdir(exist_ok=True)
        with contextlib.ExitStack() as stack:
            rasters = {role: stack.enter_context(rasterio.open(paths[role])) for role in roles}
            reference = rasters["NLCD"]
            if reference.count != 1 or reference.crs is None or not reference.crs.is_projected:
                raise ValueError("Use the original single-band projected model grid")
            units = reference.crs.linear_units_factor
            if not math.isclose(float(units[1]), 1.0, rel_tol=0, abs_tol=1e-12):
                raise ValueError("The original projected grid must use metres")
            affine = reference.transform
            area = abs(affine.a * affine.e - affine.b * affine.d)
            if (not math.isclose(math.hypot(affine.a, affine.d), 30, abs_tol=1e-8)
                    or not math.isclose(math.hypot(affine.b, affine.e), 30, abs_tol=1e-8)
                    or not math.isclose(affine.a * affine.b + affine.d * affine.e, 0, abs_tol=1e-8)
                    or not math.isclose(area, 900, abs_tol=1e-6)):
                raise ValueError("Use the original orthogonal 30 m RFP model grid")
            width, height = reference.width, reference.height
            for role, raster in rasters.items():
                if (raster.count != 1 or raster.width != width or raster.height != height
                        or raster.crs != reference.crs or raster.transform != affine):
                    raise ValueError("Control inputs need the identical original grid/CRS: " + role)
            grid = {"width": width, "height": height, "crs": reference.crs.to_string(),
                    "transform": list(affine)[:6], "pixel_area_ha": area / 10000,
                    "resolution_m": 30}
            scan_receipt = work / "scan.json"
            if scan_receipt.exists():
                scan = _json(scan_receipt)
                if scan["grid"] != grid:
                    raise ValueError("Retained scan uses a different original grid")
                for item in scan["files"]:
                    _check(work / item["path"], item)
            else:
                raw = {}
                with contextlib.ExitStack() as raw_stack:
                    for code in codes:
                        for kind in ("target", "candidate"):
                            raw[(code, kind)] = raw_stack.enter_context(
                                (work / ("%s-%s.bin" % (code, kind))).open("wb"))
                    counts = {code: {"target": 0, "candidate": 0} for code in codes}
                    domain_cells = 0
                    precipitation_sum = 0.0
                    rows_done = 0
                    dtype = np.dtype([("rain", "<f8"), ("index", "<u8")])
                    for row in range(0, height, window_size):
                        for col in range(0, width, window_size):
                            window = Window(col, row, min(window_size, width-col), min(window_size, height-row))
                            data = {role: raster.read(1, window=window, masked=True) for role, raster in rasters.items()}
                            domain = data["MODEL_DOMAIN_MASK"]
                            dvalid = ~np.ma.getmaskarray(domain)
                            if np.any(dvalid & ~np.isin(domain.data, [0, 1])):
                                raise ValueError("Original computational domain mask is not binary")
                            active = dvalid & (domain.data == 1)
                            for role in roles:
                                if role == "MODEL_DOMAIN_MASK":
                                    continue
                                if np.any(active & (np.ma.getmaskarray(data[role]) | ~np.isfinite(data[role].data))):
                                    raise ValueError("Missing original input inside computational domain: " + role)
                            lulc, rain, corridor = (data[r].data for r in ("NLCD", "PRECIPITATION", "RESTORATION_MASK"))
                            if np.any(active & ((rain <= 0) | (lulc != np.floor(lulc)) | ~np.isin(corridor, [0, 1]))):
                                raise ValueError("Positive precipitation, integer classes and a binary corridor are required")
                            reporting = active
                            actual_change = corridor == 1
                            if "RESTORED_NLCD" in data:
                                restored, report = data["RESTORED_NLCD"].data, data["REPORTING_MASK"].data
                                if np.any(active & ((restored != np.floor(restored)) | ~np.isin(report, [0, 1]))):
                                    raise ValueError("Integer restored classes and binary reporting mask are required")
                                reporting = active & (report == 1)
                                actual_change = active & (restored != lulc)
                                valid_change = np.isin(lulc, codes) & (restored == to_code)
                                if np.any(actual_change & (~reporting | (corridor != 1) | ~valid_change)):
                                    raise ValueError("Actual restoration must change only declared classes inside the reporting area and entire corridor")
                            domain_cells += int(active.sum())
                            precipitation_sum += float(rain[active].sum(dtype="float64"))
                            rr, cc = np.indices(active.shape, dtype="uint64")
                            indices = (rr + row) * width + cc + col
                            for code in codes:
                                support = reporting & (lulc == code)
                                for kind, selected in (("target", support & actual_change),
                                                       ("candidate", support & (corridor == 0) & ~actual_change)):
                                    n = int(selected.sum())
                                    counts[code][kind] += n
                                    records = np.empty(n, dtype=dtype)
                                    records["rain"] = rain[selected]
                                    records["index"] = indices[selected]
                                    records.tofile(raw[(code, kind)])
                        rows_done = min(height, row + window_size)
                        emit("scan", rows=rows_done, total_rows=height, domain_cells=domain_cells)
                    for stream in raw.values():
                        stream.flush()
                        os.fsync(stream.fileno())
                if not domain_cells or not sum(x["target"] for x in counts.values()):
                    raise ValueError("The retained original domain/restoration selection has no changed cells")
                for code in codes:
                    if counts[code]["candidate"] < counts[code]["target"]:
                        raise ValueError("Insufficient disjoint original control support for class %s: %s" % (code, counts[code]))
                scan = {"grid": grid, "counts": counts, "domain_cells": domain_cells,
                        "precipitation_sum_mm_year": precipitation_sum,
                        "domain_precipitation_mean_mm_year": precipitation_sum / domain_cells,
                        "files": [_descriptor(work, work / ("%s-%s.bin" % (c, k)))
                                  for c in codes for k in ("target", "candidate")]}
                atomic_json(scan_receipt, scan)
            classes = []
            for code in codes:
                sorted_paths = {}
                for kind in ("target", "candidate"):
                    sorted_paths[kind] = _sorted_records(work / ("%s-%s.bin" % (code, kind)),
                        work / ("%s-%s-sort" % (code, kind)), sort_records, emit)
                matcher = _match_class_exact if method_option == "exact_monge" else _match_class
                args = (sorted_paths["target"], sorted_paths["candidate"], work / ("%s-matching" % code), code, width, emit)
                classes.append(matcher(*args, max_working_bytes) if method_option == "exact_monge" else matcher(*args))
            # One byte per original cell lives on ordinary disk; no full-grid RAM array.
            mask_path = work / "control-mask.bin"
            mask = np.memmap(mask_path, mode="w+", dtype="uint8", shape=(height, width))
            for row in range(0, height, window_size):
                for col in range(0, width, window_size):
                    win = Window(col, row, min(window_size, width-col), min(window_size, height-row))
                    original = rasters["MODEL_DOMAIN_MASK"].read(1, window=win, masked=True)
                    active = (~np.ma.getmaskarray(original)) & (original.data == 1)
                    mask[row:row+int(win.height), col:col+int(win.width)] = np.where(active, 0, 255)
            flat = mask.reshape(-1)
            for item in classes:
                selected_path = work / ("%s-matching" % item["from_code"]) / "selected.bin"
                with selected_path.open("rb") as stream:
                    while True:
                        indices = np.fromfile(stream, dtype="<u8", count=65536)
                        if not indices.size:
                            break
                        if np.any(indices >= width * height) or np.any(flat[indices] != 0) or len(np.unique(indices)) != len(indices):
                            raise ValueError("Control cell repeats or leaves original domain")
                        flat[indices] = 1
            flat.flush()
            output_raster = root / "control-mask.tif"
            temporary = root / "control-mask.pending.tif"
            with rasterio.open(temporary, "w", driver="GTiff", width=width, height=height,
                    count=1, dtype="uint8", crs=reference.crs, transform=affine, nodata=255,
                    tiled=True, blockxsize=256, blockysize=256, compress="deflate", BIGTIFF="IF_SAFER") as target:
                selected_counts = {code: 0 for code in codes}
                for row in range(0, height, window_size):
                    for col in range(0, width, window_size):
                        win = Window(col, row, min(window_size, width-col), min(window_size, height-row))
                        block = np.asarray(mask[row:row+int(win.height), col:col+int(win.width)])
                        selected = block == 1
                        lulc = rasters["NLCD"].read(1, window=win)
                        corridor = rasters["RESTORATION_MASK"].read(1, window=win)
                        if "REPORTING_MASK" in rasters:
                            report = rasters["REPORTING_MASK"].read(1, window=win, masked=True)
                            restored = rasters["RESTORED_NLCD"].read(1, window=win, masked=True)
                            if np.any(selected & (np.ma.getmaskarray(report) | (report.data != 1)
                                                  | np.ma.getmaskarray(restored) | (restored.data != lulc))):
                                raise ValueError("Control leaves reporting support or overlaps actual restoration")
                        if np.any(selected & ((corridor != 0) | ~np.isin(lulc, codes))):
                            raise ValueError("Prepared control overlaps original corridor or class support")
                        for code in codes:
                            selected_counts[code] += int((selected & (lulc == code)).sum())
                        target.write(block, 1, window=win)
                target.update_tags(classification="SIMULATED", role="MATCHED_CONTROL_MASK",
                                   matching_method=method, source_binding=key, units="mask")
            for item in classes:
                if selected_counts[item["from_code"]] != item["target_cells"]:
                    raise ValueError("Actual final raster differs from the exact class-matched target")
            os.replace(temporary, output_raster)
            del flat, mask
            mask_path.unlink()
        # Recheck originals after all calculations before retaining the complete edition.
        for role in roles:
            _check(paths[role], sources[role])
        with (root / "matched-pairs.csv").open("w", newline="", encoding="utf-8") as target:
            writer = csv.writer(target)
            writer.writerow(PAIR_FIELDS)
            for code in codes:
                with (work / ("%s-matching" % code) / "pairs.csv").open("r", newline="", encoding="utf-8") as source:
                    reader = csv.reader(source)
                    if tuple(next(reader)) != PAIR_FIELDS:
                        raise ValueError("Retained pair columns changed")
                    writer.writerows(reader)
        changed = sum(item["target_cells"] for item in classes)
        summary = {"schema": "upstate.regional-matched-control-summary/v1", "method": method,
                   "matching_method_option": method_option,
                   "classification": "SIMULATED physical inputs / retained original geographic masks",
                   "grid": grid, "changed_cells": changed, "changed_area_ha": changed * grid["pixel_area_ha"],
                   "overlap_with_restoration_corridor_cells": 0,
                   "target_definition": ("Actual RESTORED_NLCD changes inside REPORTING_MASK == 1" if "RESTORED_NLCD" in roles else "Declared classes inside RESTORATION_MASK == 1"),
                   "candidate_definition": ("Unchanged declared classes inside REPORTING_MASK == 1, outside the entire RESTORATION_MASK" if "RESTORED_NLCD" in roles else "Declared classes outside the entire RESTORATION_MASK"),
                   "domain_cells": scan["domain_cells"],
                   "selected_domain_precipitation_mean_mm_year": scan["domain_precipitation_mean_mm_year"],
                   "normalization_scope": "Mean over the original MODEL_DOMAIN_MASK cells; native NDR normalization must use its actual prepared precipitation support.",
                   "by_original_class": [{k: v for k, v in item.items() if k not in ("binding", "files")}
                                         | {"changed_area_ha": item["target_cells"] * grid["pixel_area_ha"],
                                            "to_code": to_code} for item in classes],
                   "interpretation": ([INTERPRETATION[0], INTERPRETATION[1],
                       "The retained exact Monge kernel minimizes total absolute precipitation residual within each original class using exact original IEEE-754 dyadic values.",
                       "Deterministic symbolic secondary ties choose among equal primary objectives; completed historical editions remain unchanged.",
                       *INTERPRETATION[5:]] if method_option == "exact_monge" else INTERPRETATION),
                   "source_binding": configuration.get("source_binding", {}),
                   "owner_direction": "CURRENT_OWNER_DIRECTION.md v2026-10-13.3"}
        atomic_json(root / "matching-summary.json", summary, immutable=True)
        originals = root / "originals"
        originals.mkdir(exist_ok=True)
        for role in roles:
            destination = originals / (role.lower() + ".tif")
            if destination.exists():
                _check(destination, sources[role])
            else:
                pending = destination.with_suffix(".pending")
                with paths[role].open("rb") as source, pending.open("wb") as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
                    target.flush()
                    os.fsync(target.fileno())
                _check(pending, sources[role])
                os.replace(pending, destination)
        for name, body in retained_code.items():
            destination = root / name
            if destination.exists():
                if destination.read_bytes() != body:
                    raise ValueError("Retained implementation snapshot differs: " + name)
            else:
                pending = destination.with_name("." + name + ".pending")
                with pending.open("wb") as target:
                    target.write(body)
                    target.flush()
                    os.fsync(target.fileno())
                os.replace(pending, destination)
        source_id = "SIM_REGIONAL_MATCHED_CONTROL_MASK"
        scenario = {"title": configuration.get("title", "Simulated regional matched-area off-riparian restoration"),
                    "kind": "landcover", "reason": "Same original class and changed area outside the entire retained restoration corridor; inspect retained declared-method precipitation-matching residuals.",
                    "patches": [{"mask_source_id": source_id, "from_codes": codes,
                                 "to_code": to_code, "reason": "Explicit deterministic regional matched-area control"}]}
        atomic_json(root / "scenario-selection.json", scenario, immutable=True)
        members = [_descriptor(root, p) for p in sorted(root.rglob("*"))
                   if p.is_file() and "work" not in p.relative_to(root).parts
                   and p.name not in (".prepare.lock", "sources.json", "control-prepared.json")]
        by_name = {item["path"]: item for item in members}
        definitions = [(source_id, "raster", "MATCHED_CONTROL_MASK", "control-mask.tif"),
                       ("SIM_REGIONAL_MATCHED_CONTROL_SUMMARY", "document", "SCENARIO_ASSUMPTIONS", "matching-summary.json"),
                       ("SIM_REGIONAL_MATCHED_CONTROL_PAIRS", "table", "SCENARIO_MATCHED_PAIRS", "matched-pairs.csv")]
        entries = []
        for sid, kind, role, name in definitions:
            entries.append({"id": sid, "title": scenario["title"] + ": " + role.lower().replace("_", " "),
                "kind": kind, "role": role, **by_name[name],
                "uri": "upstate.simulated-input:regional-matched-control/" + key + "/" + name,
                "vintage": "2026-10-13 explicit regional simulated-input edition",
                "classification": "simulated", "source_binding": key,
                **({"units": "mask", "resampling": "nearest"} if kind == "raster" else {}),
                "companions": [item for item in members if item["path"] != name]})
        atomic_json(root / "sources.json", {"schema": "upstate.sources/v1",
            "source_schema": "upstate.sources/v1", "title": scenario["title"], "entries": entries}, immutable=True)
        result = {"schema": "upstate.regional-matched-control-preparation/v1", "binding": binding,
                  "directory": str(root), "source_manifest": str(root / "sources.json"),
                  "source_id": source_id, "scenario": scenario, "summary": summary,
                  "files": [*members, _descriptor(root, root / "sources.json")],
                  "state": "prepared"}
        atomic_json(final, result, immutable=True)
        emit("complete", reused=False, changed_cells=changed, changed_hectares=summary["changed_area_ha"])
        return result




def _baseline_binding(workspace, prepared, grid_record):
    """Verify source editions and actual computational/reporting support."""
    import contextlib
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from rasterio.windows import Window
    from shapely.geometry import mapping
    from model.rasters import vector_geometry, polygon_union, check_same_grid
    root = Path(prepared["directory"]).resolve(strict=True)
    directory = (workspace.root / "grids" / grid_record["id"]).resolve(strict=True)
    originals = prepared["binding"]["sources"]
    verified = {}
    def grid_file(role):
        entry = grid_record["files"][role]
        path = (directory / entry["path"]).resolve(strict=True)
        if directory not in path.parents:
            raise ValueError("Prepared grid member leaves its retained directory")
        _check(path, entry)
        return path, entry
    domain_path, domain_entry = grid_file("model_domain")
    rows, _ = vector_geometry(domain_path, layer="model_domain", target_crs=grid_record["grid"]["crs"])
    geometry = polygon_union(rows)
    shapes = [(mapping(geometry), 1)]
    with contextlib.ExitStack() as stack:
        domain = stack.enter_context(rasterio.open(root / "originals" / "model_domain_mask.tif"))
        comparisons = []
        for role in ("NLCD", "PRECIPITATION"):
            native_path, descriptor = grid_file(role)
            configured_sha = originals[role]["sha256"]
            original_sha = grid_record["inputs"][role].get("source_sha256")
            if configured_sha not in (descriptor["sha256"], original_sha):
                raise ValueError("Control " + role + " belongs to a different baseline source edition")
            source = stack.enter_context(rasterio.open(root / "originals" / (role.lower() + ".tif")))
            native = stack.enter_context(rasterio.open(native_path))
            check_same_grid(source, native)
            check_same_grid(source, domain)
            # Original-source identity is accepted only with equal prepared values
            # and support; conversion/resampling must not silently change matching.
            comparisons.append((role, source, native))
            verified[role] = {"configured_sha256": configured_sha, "grid_file": descriptor,
                              "original_source_sha256": original_sha,
                              "binding": "prepared-raster" if configured_sha == descriptor["sha256"] else "original-source-and-prepared-dtype-equal-values",
                              "prepared_dtype": native.dtypes[0]}
        report_pair = None
        if "REPORTING_MASK" in originals:
            native_path, descriptor = grid_file("reporting_mask")
            configured = stack.enter_context(rasterio.open(root / "originals" / "reporting_mask.tif"))
            native = stack.enter_context(rasterio.open(native_path))
            check_same_grid(configured, native)
            report_pair = configured, native
            verified["REPORTING_MASK"] = {"grid_file": descriptor, "comparison": "identical selected pixel centres"}
        cells = 0
        for row in range(0, domain.height, 512):
            for col in range(0, domain.width, 512):
                window = Window(col, row, min(512, domain.width-col), min(512, domain.height-row))
                value = domain.read(1, window=window, masked=True)
                actual = ~np.ma.getmaskarray(value) & (value.data == 1)
                expected = rasterize(shapes, out_shape=actual.shape,
                                     transform=domain.window_transform(window), fill=0,
                                     all_touched=False, dtype="uint8") == 1
                if not np.array_equal(actual, expected):
                    raise ValueError("Control computational mask differs from the baseline model_domain polygon")
                cells += int(actual.sum())
                for role, source, native in comparisons:
                    a, b = source.read(1, window=window, masked=True), native.read(1, window=window, masked=True)
                    av, bv = ~np.ma.getmaskarray(a), ~np.ma.getmaskarray(b)
                    if (not np.array_equal(av, bv)
                            or not np.array_equal(a.data[av].astype(b.dtype), b.data[bv], equal_nan=True)):
                        raise ValueError("Prepared baseline values/support differ from matching inputs: " + role)
                if report_pair:
                    a, b = [item.read(1, window=window, masked=True) for item in report_pair]
                    if not np.array_equal((~np.ma.getmaskarray(a)) & (a.data == 1),
                                          (~np.ma.getmaskarray(b)) & (b.data == 1)):
                        raise ValueError("Control reporting mask differs from the actual baseline reporting mask")
    verified["MODEL_DOMAIN_MASK"] = {"grid_file": domain_entry, "selected_cells": cells,
                                    "comparison": "original model_domain polygon, pixel centre, all_touched=False"}
    return verified

def adopt(workspace, prepared, baseline_run_id):
    """Import and prepare the third case against the original grid/profile."""
    from model.common import atomic_json, digest
    from model.scenario_footprint import preview_run
    if prepared.get("schema") != "upstate.regional-matched-control-preparation/v1" or prepared.get("state") != "prepared":
        raise ValueError("Use a completed retained regional control preparation")
    root = Path(prepared["directory"]).resolve(strict=True)
    for item in prepared["files"]:
        _check(root / item["path"], item)
    baseline = workspace.inspect_run(baseline_run_id)
    selection = baseline["selection"]
    grid_record = workspace.get_grid(selection["grid_id"])
    grid = grid_record["grid"]
    original = prepared["summary"]["grid"]
    if (any(grid[key] != original[key] for key in ("width", "height"))
            or len(grid["transform"]) < 6
            or any(not math.isclose(float(a), float(b), rel_tol=0, abs_tol=1e-8)
                   for a, b in zip(grid["transform"][:6], original["transform"]))):
        raise ValueError("Prepared control must use the actual baseline pixel grid")
    import rasterio
    if rasterio.crs.CRS.from_user_input(grid["crs"]) != rasterio.crs.CRS.from_user_input(original["crs"]):
        raise ValueError("Prepared control and original baseline CRS differ")
    verified_binding = _baseline_binding(workspace, prepared, grid_record)
    collection = workspace.import_sources(prepared["source_manifest"])
    scenario = workspace.save_scenario({**prepared["scenario"],
                                       "source_collection_id": collection["id"]})
    chosen = {"grid_id": selection["grid_id"], "profile_id": selection["profile_id"],
              "scenario_id": scenario["id"]}
    if "models" in selection:
        chosen["models"] = selection["models"]
    run = workspace.prepare_run(chosen)
    footprint = preview_run(workspace, run["id"])
    actual = footprint["summary"]
    if (actual["net_changed_cells"] != prepared["summary"]["changed_cells"]
            or not math.isclose(actual["net_changed_hectares"], prepared["summary"]["changed_area_ha"],
                                rel_tol=0, abs_tol=1e-6)):
        raise ValueError("Native scenario footprint differs from the original class-matched control")
    result = {"schema": "upstate.regional-matched-control-adoption/v1",
              "project_id": workspace.project["id"], "baseline_run_id": baseline["id"],
              "source_manifest": _descriptor(root, root / "sources.json"),
              "source_collection_id": collection["id"], "source_id": prepared["source_id"],
              "grid_id": selection["grid_id"], "profile_id": selection["profile_id"],
              "scenario_id": scenario["id"], "run_id": run["id"],
              "footprint_id": footprint["id"], "footprint_summary": actual,
              "matching_summary": prepared["summary"], "verified_baseline_binding": verified_binding,
              "state": "prepared"}
    key = digest({"project_id": result["project_id"], "baseline_run_id": baseline["id"],
                  "source_manifest": result["source_manifest"]})
    # Import and native preparation are content addressed; no solver is issued.
    atomic_json(root / "adoptions" / (key + ".json"), result, immutable=True)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--baseline-run")
    args = parser.parse_args(argv)
    if bool(args.workspace) != bool(args.baseline_run):
        parser.error("Native adoption requires both --workspace and --baseline-run")
    config = args.configuration.resolve(strict=True)
    result = prepare(_json(config), config.parent, args.output,
                     progress=lambda value: print(json.dumps(value, allow_nan=False), file=sys.stderr, flush=True))
    if args.workspace:
        from model.workspace import Workspace
        result = adopt(Workspace(args.workspace), result, args.baseline_run)
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
