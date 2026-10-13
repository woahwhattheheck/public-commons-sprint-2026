"""Windowed, source-bound multivariate strata using the original exact 1D matcher."""
from __future__ import annotations

from contextlib import ExitStack
import csv
import math
import os
from pathlib import Path
import shutil

import numpy as np

from .common import atomic_json, describe_file, digest, relative_file, verify_file
from source_tools.precipitation_matching import match_precipitation, METHOD

BIN_RULE = "lower-inclusive upper-exclusive; outer bins unbounded; exact boundary enters the higher bin"


class Moments:
    def __init__(self):
        self.n = 0
        self.mean = 0.0
        self.m2 = 0.0
        self.low = None
        self.high = None
        self.abs_sum = 0.0
        self.abs_max = 0.0

    def add(self, values):
        values = np.asarray(values, dtype=np.float64)
        if not values.size:
            return
        if not np.isfinite(values).all():
            raise ValueError("Statistics received an undeclared missing/nonfinite value")
        n = int(values.size)
        mean = float(values.mean())
        m2 = float(np.square(values - mean).sum())
        delta, total = mean - self.mean, self.n + n
        self.m2 += m2 + delta * delta * self.n * n / total
        self.mean += delta * n / total
        self.n = total
        lo, hi = float(values.min()), float(values.max())
        self.low = lo if self.low is None else min(self.low, lo)
        self.high = hi if self.high is None else max(self.high, hi)
        self.abs_sum += float(np.abs(values).sum())
        self.abs_max = max(self.abs_max, float(np.abs(values).max()))

    def value(self, residual=False):
        row = {"count": self.n, "mean": self.mean if self.n else None,
               "population_sd": math.sqrt(max(0, self.m2 / self.n)) if self.n else None,
               "minimum": self.low, "maximum": self.high}
        if residual:
            row.update(mean_absolute=self.abs_sum / self.n if self.n else None,
                       max_absolute=self.abs_max if self.n else None)
        return row


def _valid(values):
    return ~np.ma.getmaskarray(values) & np.isfinite(values.data)


def _same_grid(reference, value, label):
    if (value.count != 1 or value.width != reference.width or value.height != reference.height
            or value.crs != reference.crs or value.transform != reference.transform):
        raise ValueError(label + " must be the exact retained single-band native grid")


def _write_csv(path, fields, rows):
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        stream.flush()
        os.fsync(stream.fileno())


def _stats(role, units, key, target, candidate, control=None, residual=None):
    control, residual = control or Moments(), residual or Moments()
    a, b = target.value(), control.value()
    pooled = (math.sqrt((a["population_sd"] ** 2 + b["population_sd"] ** 2) / 2)
              if a["count"] and b["count"] else None)
    standardized = ((b["mean"] - a["mean"]) / pooled if pooled
                    else (0.0 if pooled == 0 and a["mean"] == b["mean"] else None))
    return {"stratum": key, "role": role, "units": units,
            "target": a, "candidate": candidate.value(), "control": b,
            "residual": residual.value(True),
            "standardized_mean_difference": standardized,
            "population_basis": ("field-finite pre-admission treatment/candidate; control/residual use selected pairs"
                                 if key == "__all__" else "fully admitted exact-stratum target/candidate; selected control pairs")}


def compute(ws, selected, bound, directory, *, progress=None):
    """Complete design or explicit nonacceptance; no source/native mutation."""
    import rasterio
    from rasterio.windows import Window

    root = Path(directory)
    work = root / "work"
    work.mkdir(parents=True, exist_ok=True)
    # Rebuilding this owned scratch roster after interruption cannot overwrite
    # a completed design. prepare holds the design lock and checks it first.
    for path in work.glob("*.bin"):
        path.unlink()
    roles = [r for r in bound["files"] if r not in ("NLCD", "reporting_mask")]
    units = {r: bound["files"][r]["units"] for r in roles}
    dtype = np.dtype([("index", "<u8")] + [(r, "<f8") for r in roles])
    budget = selected["max_working_bytes"]
    window_side = 256
    window_estimate = window_side ** 2 * (len(roles) * 64 + 256) + 16 * 1024 * 1024
    if budget < window_estimate:
        raise MemoryError("Declared working bytes are below this exact window scan requirement: " + str(window_estimate))
    transitions = {}
    for row in bound["restoration_transitions"]:
        before, after = int(row["from_code"]), int(row["to_code"])
        if before == after or not row["cells"]:
            continue
        if before in transitions and transitions[before] != after:
            raise ValueError("This edition requires one destination per original class; select a treatment without competing destination pools")
        transitions[before] = after
    if not transitions:
        raise ValueError("No retained changed transition exists")
    strata, populations = {}, {}
    overall = {r: {p: Moments() for p in ("target", "candidate", "control", "residual")} for r in roles}
    counts = {"original_changed_cells": 0, "reporting_target_cells": 0,
              "outside_reporting_target_cells": 0, "missing_target_cells": 0,
              "eligible_target_cells": 0, "candidate_base_cells": 0,
              "excluded_candidate_cells": 0, "missing_candidate_cells": 0,
              "eligible_candidate_cells": 0, "matched_cells": 0}
    actual_transitions = {}

    def emit(stage, **values):
        if progress:
            progress({"stage": stage, **values})

    def append(key, kind, indices, data, selected_cells):
        path = work / (key + "-" + kind + ".bin")
        records = np.empty(int(selected_cells.sum()), dtype=dtype)
        records["index"] = indices[selected_cells]
        for role in roles:
            records[role] = np.where(_valid(data[role]), data[role].data, np.nan)[selected_cells]
        with path.open("ab") as stream:
            records.tofile(stream)

    with ExitStack() as stack:
        sources = {r: stack.enter_context(rasterio.open(verify_file(ws.root, d)))
                   for r, d in bound["files"].items()}
        baseline = sources["NLCD"]
        if baseline.crs is None or not baseline.crs.is_projected:
            raise ValueError("Use the original projected native grid")
        if not math.isclose(float(baseline.crs.linear_units_factor[1]), 1.0, rel_tol=0, abs_tol=1e-12):
            raise ValueError("The original native grid must use metre coordinates")
        for role, source in sources.items():
            _same_grid(baseline, source, role)
        restoration = stack.enter_context(rasterio.open(verify_file(ws.root, bound["restoration_files"]["scenario_lulc"])))
        _same_grid(baseline, restoration, "Original restoration footprint")
        actual_native = None
        if bound.get("native_landcover"):
            actual_native = stack.enter_context(rasterio.open(verify_file(ws.root, bound["native_landcover"])))
            _same_grid(baseline, actual_native, "Executed restoration land cover")
        exclusion = None
        if bound.get("exclusion_source"):
            body = bound["exclusion_source"]["entry"]["body"]
            exclusion = stack.enter_context(rasterio.open(relative_file(ws.root, body["object"])))
            _same_grid(baseline, exclusion, "Original exclusion raster")
        width, height = baseline.width, baseline.height
        affine = baseline.transform
        pixel_area = abs(affine.a * affine.e - affine.b * affine.d) / 10000
        if not math.isclose(pixel_area, bound["restoration_summary"]["pixel_area_ha"], rel_tol=0, abs_tol=1e-10):
            raise ValueError("Original footprint and native-grid cell areas differ")
        with (root / "unmatched-targets.csv").open("w", encoding="utf-8", newline="") as missing:
            missing_writer = csv.writer(missing)
            missing_writer.writerow(["target_index", "row", "col", "from_code", "to_code", "reason", "missing_roles"])
            for row in range(0, height, window_side):
                for col in range(0, width, window_side):
                    win = Window(col, row, min(window_side, width-col), min(window_side, height-row))
                    data = {r: src.read(1, window=win, masked=True) for r, src in sources.items()}
                    base, restored = data["NLCD"], restoration.read(1, window=win, masked=True)
                    bvalid, rvalid = _valid(base), _valid(restored)
                    if not np.array_equal(bvalid, rvalid):
                        raise ValueError("Restoration changed original categorical NoData support")
                    if np.any(bvalid & ((base.data != np.floor(base.data)) | (restored.data != np.floor(restored.data)))):
                        raise ValueError("Original categorical bands contain noninteger codes")
                    if actual_native is not None:
                        executed = actual_native.read(1, window=win, masked=True)
                        if (not np.array_equal(rvalid, _valid(executed))
                                or not np.array_equal(restored.data[rvalid], executed.data[rvalid])):
                            raise ValueError("Selected footprint differs from the actual executed restoration land cover")
                    report = data["reporting_mask"]
                    rv = _valid(report)
                    if np.any(rv & ~np.isin(report.data, [0, 1])):
                        raise ValueError("The original reporting mask is not binary")
                    reporting = rv & (report.data == 1)
                    changed = bvalid & (base.data != restored.data)
                    counts["original_changed_cells"] += int(changed.sum())
                    counts["reporting_target_cells"] += int((changed & reporting).sum())
                    counts["outside_reporting_target_cells"] += int((changed & ~reporting).sum())
                    if np.any(changed):
                        pairs, frequencies = np.unique(np.column_stack((base.data[changed], restored.data[changed])), axis=0, return_counts=True)
                        for pair, number in zip(pairs, frequencies):
                            key = (int(pair[0]), int(pair[1]))
                            actual_transitions[key] = actual_transitions.get(key, 0) + int(number)
                            if transitions.get(key[0]) != key[1]:
                                raise ValueError("Actual changed cells differ from retained original transition accounting")
                    target = changed & reporting
                    candidate_base = bvalid & reporting & ~changed & np.isin(base.data, list(transitions))
                    counts["candidate_base_cells"] += int(candidate_base.sum())
                    excluded = np.zeros(changed.shape, dtype=bool)
                    if exclusion is not None:
                        ex = exclusion.read(1, window=win, masked=True)
                        ev = _valid(ex)
                        if np.any(ev & ~np.isin(ex.data, [0, 1])):
                            raise ValueError("Original exclusion source must be a binary raster")
                        # Unknown exclusion support is not admitted as an available control.
                        excluded = ~ev | (ex.data == 1)
                    counts["excluded_candidate_cells"] += int((candidate_base & excluded).sum())
                    candidate = candidate_base & ~excluded
                    scalar_valid = {r: _valid(data[r]) for r in roles}
                    scalar_valid["PRECIPITATION"] &= data["PRECIPITATION"].data >= 0
                    # Unselected balance fields do not reduce matching support.
                    admission_roles = list(dict.fromkeys(["PRECIPITATION"] + [r["role"] for r in selected["strata"]]))
                    complete = np.logical_and.reduce([scalar_valid[r] for r in admission_roles])
                    counts["missing_target_cells"] += int((target & ~complete).sum())
                    counts["missing_candidate_cells"] += int((candidate & ~complete).sum())
                    eligible_target, eligible_candidate = target & complete, candidate & complete
                    counts["eligible_target_cells"] += int(eligible_target.sum())
                    counts["eligible_candidate_cells"] += int(eligible_candidate.sum())
                    for role in roles:
                        overall[role]["target"].add(data[role].data[target & scalar_valid[role]])
                        overall[role]["candidate"].add(data[role].data[candidate & scalar_valid[role]])
                    rr, cc = np.indices(changed.shape, dtype=np.uint64)
                    indices = (rr + row) * width + cc + col
                    for bad in (changed & ~reporting, target & ~complete):
                        for y, x in np.argwhere(bad):
                            reason = "outside_original_reporting_support" if not reporting[y, x] else "missing_selected_covariate"
                            missing_roles = [r for r in admission_roles if not scalar_valid[r][y, x]]
                            missing_writer.writerow([int(indices[y, x]), row+int(y), col+int(x),
                                                     int(base.data[y, x]), int(restored.data[y, x]),
                                                     reason, "|".join(missing_roles)])
                    admitted = eligible_target | eligible_candidate
                    if not np.any(admitted):
                        continue
                    bins = [np.searchsorted(s["boundaries"], data[s["role"]].data, side="right")
                            for s in selected["strata"]]
                    matrix = np.column_stack([base.data[admitted].astype(np.int64)] + [b[admitted] for b in bins])
                    for combination in np.unique(matrix, axis=0):
                        from_code = int(combination[0])
                        selected_cells = admitted & (base.data == from_code)
                        for bin_array, index in zip(bins, combination[1:]):
                            selected_cells &= bin_array == index
                        definition = {"from_code": from_code, "to_code": transitions[from_code],
                                      "bins": [int(x) for x in combination[1:]]}
                        key = digest(definition)
                        if key not in strata:
                            strata[key] = {"key": key, **definition, "target_cells": 0,
                                           "eligible_target_cells": 0, "candidate_cells": 0,
                                           "matched_cells": 0, "state": "pending", "reasons": []}
                        for kind, eligible, count_field in (("target", eligible_target, "target_cells"),
                                                           ("candidate", eligible_candidate, "candidate_cells")):
                            choose = selected_cells & eligible
                            number = int(choose.sum())
                            strata[key][count_field] += number
                            if number:
                                append(key, kind, indices, data, choose)
                emit("scan", rows=min(height, row+window_side), total_rows=height, counts=counts)
            missing.flush()
            os.fsync(missing.fileno())
        if counts["original_changed_cells"] != int(bound["restoration_summary"]["net_changed_cells"]):
            raise ValueError("Actual treatment count differs from original complete footprint")
        expected_transitions = {(int(r["from_code"]), int(r["to_code"])): int(r["cells"])
                                for r in bound["restoration_transitions"] if r["from_code"] != r["to_code"] and r["cells"]}
        if actual_transitions != expected_transitions:
            raise ValueError("Actual original categorical transition roster differs")
        masks = {}
        balance = []
        fields = ["stratum", "from_code", "to_code", "target_index", "control_index", "target_row",
                  "target_col", "control_row", "control_col"]
        for role in roles:
            fields.extend(["target_" + role, "control_" + role, "residual_" + role])
        failure = bool(counts["missing_target_cells"] or counts["outside_reporting_target_cells"])
        threshold_failed = False
        with (root / "matched-pairs.csv").open("w", encoding="utf-8", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            for key in sorted(strata):
                item = strata[key]
                n, m = item["target_cells"], item["candidate_cells"]
                item["eligible_target_cells"] = n
                if n == 0:
                    item["state"] = "candidate_only"
                    continue
                required = (256*n + 96*m + 256*1024*1024 + 3*dtype.itemsize*(n+m)
                            if m >= n else window_estimate + 3*dtype.itemsize*(n+m))
                if budget < required:
                    raise MemoryError("Stratum " + key + " requires declared working bytes >= " + str(required))
                targets = np.fromfile(work / (key + "-target.bin"), dtype=dtype)
                candidate_path = work / (key + "-candidate.bin")
                candidates = np.fromfile(candidate_path, dtype=dtype) if candidate_path.exists() else np.empty(0, dtype=dtype)
                if targets.size != n or candidates.size != m:
                    raise ValueError("Retained stratum roster is incomplete")
                local = {role: {name: Moments() for name in ("target", "candidate", "control", "residual")} for role in roles}
                for role in roles:
                    local[role]["target"].add(targets[role][np.isfinite(targets[role])])
                    local[role]["candidate"].add(candidates[role][np.isfinite(candidates[role])])
                if m < n:
                    item["state"] = "infeasible"
                    item["reasons"].append("Insufficient disjoint same-class covariate-stratum candidates")
                    failure = True
                    with (root / "unmatched-targets.csv").open("a", encoding="utf-8", newline="") as missing:
                        missing_writer = csv.writer(missing)
                        for target_id in targets["index"]:
                            target_id = int(target_id)
                            missing_writer.writerow([target_id, target_id//width, target_id%width,
                                item["from_code"], item["to_code"], "insufficient_stratum_candidates:" + key, ""])
                else:
                    required = 256*n + 96*m + 256*1024*1024 + 3*dtype.itemsize*(n+m)
                    if budget < required:
                        raise MemoryError("Stratum " + key + " exact matching requires declared working bytes >= " + str(required))
                    matched = match_precipitation(targets["PRECIPITATION"], candidates["PRECIPITATION"],
                        target_ids=targets["index"], candidate_ids=candidates["index"])
                    chosen = candidates[matched.candidate_positions]
                    if np.unique(chosen["index"]).size != n or np.intersect1d(targets["index"], chosen["index"]).size:
                        raise ValueError("Original matching violated unique disjoint cell identity")
                    maximum = float(np.abs(chosen["PRECIPITATION"] - targets["PRECIPITATION"]).max())
                    item["matching"] = matched.metadata()
                    objective = item["matching"].pop("objective_sum_absolute_precipitation_residual_mm_year")
                    item["matching"].update(objective_sum_absolute_proxy_residual=objective,
                                             proxy_units=units["PRECIPITATION"], optimization="minimum total absolute original runoff-proxy residual within this stratum", matching_scope="this exact original-class/covariate stratum",
                                             caliper_rule="acceptance gate on the selected unconstrained L1 optimum")
                    item["state"] = "matched"
                    if selected["precipitation_caliper"] is not None and maximum > selected["precipitation_caliper"]:
                        item["state"] = "threshold_not_met"
                        item["reasons"].append("Selected unconstrained optimum fails the declared caliper; this does not prove no feasible assignment exists")
                        threshold_failed = True
                    item["matched_cells"] = n
                    counts["matched_cells"] += n
                    mask_key = (item["from_code"], item["to_code"])
                    if mask_key not in masks:
                        path = work / ("mask-%s-%s.bin" % mask_key)
                        masks[mask_key] = np.memmap(path, mode="w+", dtype="uint8", shape=(height, width))
                        stack.callback(masks[mask_key]._mmap.close)
                        masks[mask_key][:] = 0
                    flat = masks[mask_key].reshape(-1)
                    if np.any(flat[chosen["index"]] != 0):
                        raise ValueError("A candidate cell was reused across matching strata")
                    flat[chosen["index"]] = 1
                    for role in roles:
                        # Balance-only NoData was encoded as NaN in the record.
                        valid = np.isfinite(targets[role]) & np.isfinite(chosen[role])
                        local[role]["control"].add(chosen[role][np.isfinite(chosen[role])])
                        local[role]["residual"].add(chosen[role][valid] - targets[role][valid])
                        overall[role]["control"].add(chosen[role][np.isfinite(chosen[role])])
                        overall[role]["residual"].add(chosen[role][valid] - targets[role][valid])
                    for index in range(n):
                        target_id, control_id = int(targets["index"][index]), int(chosen["index"][index])
                        pair = {"stratum": key, "from_code": item["from_code"], "to_code": item["to_code"],
                                "target_index": target_id, "control_index": control_id,
                                "target_row": target_id//width, "target_col": target_id%width,
                                "control_row": control_id//width, "control_col": control_id%width}
                        for role in roles:
                            a, b = float(targets[role][index]), float(chosen[role][index])
                            pair["target_" + role] = a if math.isfinite(a) else ""
                            pair["control_" + role] = b if math.isfinite(b) else ""
                            pair["residual_" + role] = b-a if math.isfinite(a) and math.isfinite(b) else ""
                        writer.writerow(pair)
                for role in roles:
                    balance.append(_stats(role, units[role], key, **local[role]))
                emit("matching", stratum=key, state=item["state"], matched_cells=counts["matched_cells"])
            output.flush()
            os.fsync(output.fileno())
        for role in roles:
            balance.append(_stats(role, units[role], "__all__", **overall[role]))
        state = "infeasible" if failure else ("threshold_not_met" if threshold_failed else "prepared")
        if state == "prepared" and counts["matched_cells"] != counts["original_changed_cells"]:
            raise ValueError("Accepted control must match every original treatment cell")
        mask_files = []
        for pair, data in sorted(masks.items()):
            data.flush()
            if state == "prepared":
                name = "control-%s-to-%s.tif" % pair
                path = root / name
                with rasterio.open(path, "w", driver="GTiff", width=width, height=height,
                        count=1, dtype="uint8", crs=baseline.crs, transform=affine, nodata=255,
                        tiled=True, blockxsize=256, blockysize=256, compress="deflate", BIGTIFF="IF_SAFER") as destination:
                    actual_count = 0
                    for row in range(0, height, window_side):
                        for col in range(0, width, window_side):
                            win = Window(col, row, min(window_side, width-col), min(window_side, height-row))
                            original = baseline.read(1, window=win, masked=True)
                            array = np.array(data[row:row+int(win.height), col:col+int(win.width)])
                            actual_count += int((array == 1).sum())
                            array[~_valid(original)] = 255
                            destination.write(array, 1, window=win)
                    destination.update_tags(role="MULTIVARIATE_CONTROL_MASK",
                        meaning="Analyst-declared matched model scenario, not an observed intervention",
                        from_code=pair[0], to_code=pair[1])
                if actual_count != actual_transitions[pair]:
                    raise ValueError("Final original transition count differs from complete matched mask")
                mask_files.append({"from_code": pair[0], "to_code": pair[1],
                                   "cells": actual_count, "hectares": actual_count*pixel_area,
                                   "file": describe_file(root, path)})
        # Release maps before scratch cleanup, including on Windows recipients.
        masks.clear()
    summary = {**counts, "original_changed_hectares": counts["original_changed_cells"]*pixel_area,
               "matched_hectares": counts["matched_cells"]*pixel_area, "pixel_area_ha": pixel_area,
               "grid_id": bound["grid_id"], "state": state, "bin_rule": BIN_RULE,
               "precipitation_units": units["PRECIPITATION"],
               "selected_dimensions": [s["role"] for s in selected["strata"]],
               "matched_dimensions": ["original class and destination transition"] + [s["role"] for s in selected["strata"] if s["boundaries"]],
               "unmatched_dimensions": [r for r in ("DEM", "K_FACTOR", "R_FACTOR", "SLOPE", "CONNECTIVITY")
                                        if r not in {s["role"] for s in selected["strata"] if s["boundaries"]}],
               "proxy_matching": "Exact unconstrained minimum total absolute residual separately within each declared stratum",
               "caliper": selected["precipitation_caliper"],
               "acceptance": "All treatment cells, enough unique controls in each stratum, and every selected pair passes the declared proxy threshold",
               "native_landcover_verified": bound.get("native_landcover") is not None,
               "unaccepted_reasons": (["Original treatment extends outside the declared reporting support"] if counts["outside_reporting_target_cells"] else []) + (["Original treatment has missing selected covariate support"] if counts["missing_target_cells"] else []) + (["One or more exact strata has fewer candidates than targets"] if any(r["state"] == "infeasible" for r in strata.values()) else []) + (["Selected unconstrained optimum exceeds the declared caliper"] if threshold_failed else []),
               "source_classification": "Original per-input source classifications remain in input-binding.json; no source is promoted to observed"}
    result = {"state": state, "summary": summary, "strata": [strata[k] for k in sorted(strata)],
              "balance": balance, "masks": mask_files}
    atomic_json(root / "matching-result.json", result, immutable=True)
    _write_csv(root / "balance.csv", ["stratum", "role", "units", "population", "count", "mean",
                                     "population_sd", "minimum", "maximum", "mean_absolute", "max_absolute"],
               ({"stratum": r["stratum"], "role": r["role"], "units": r["units"],
                 "population": name, **r[name]} for r in balance
                for name in ("target", "candidate", "control", "residual")))
    _write_csv(root / "strata.csv", ["key", "from_code", "to_code", "bins", "target_cells",
              "candidate_cells", "matched_cells", "state", "reasons"],
              ({k: ("|".join(map(str, r[k])) if isinstance(r[k], list) else r[k])
                for k in ("key", "from_code", "to_code", "bins", "target_cells",
                          "candidate_cells", "matched_cells", "state", "reasons")} for r in result["strata"]))
    # Input integrity is checked after the whole calculation before publication.
    for item in [*bound["files"].values(), *bound["restoration_files"].values()]:
        verify_file(ws.root, item)
    if bound.get("native_landcover"):
        verify_file(ws.root, bound["native_landcover"])
    shutil.rmtree(work)
    return result
