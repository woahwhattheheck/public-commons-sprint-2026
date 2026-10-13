"""Management benefits across retained annual forcing periods.

Reads completed original NDR/SDR mass outputs. Never prepares grids or runs models.
One common finite reporting support per metric spans every selected period/role.
"""
from __future__ import annotations

from contextlib import ExitStack
from copy import deepcopy
import csv
import hashlib
import html
import io
import math
from pathlib import Path
import re
import shutil
import zipfile

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, read_json, verify_file)
from .model_selection import run_models, required_outputs, validate_completed_run
from .native_versions import comparison_versions
from .reuse import copy_verified
from . import climate_forcing, forcing_sources, rasters

ROOT = "climate-management-reports"
SCHEMA = "upstate.climate-management-report/v1"
VERSION = 1
SOURCE_ID = "climate-management-report"
LIMITATIONS = [
    "Annual steady-state model comparisons; not an event hydrograph, seasonal flow, intake concentration or causal field estimate.",
    "A positive management benefit is reference minus treatment export. Optional control-adjusted benefit is control minus treatment.",
    "A climate interaction is the selected period benefit minus the explicitly selected reference-period benefit on the same finite cells.",
    "The reference, treatment and control are explicitly selected original scenarios. Calling a scenario control does not establish empirical or covariate matching.",
    "Each metric uses one intersection of valid reporting pixels across ALL selected period and scenario runs. Independent totals and exclusions remain separate.",
    "The original Workspace already converted retained annual export rates to mass per pixel once. This report sums mass and does not multiply by pixel area again.",
    "NDR automatic runoff-proxy normalization can cancel a uniform multiplier. A fixed positive runoff_proxy_av changes that interpretation.",
    "Precipitation and rainfall erosivity are separate original source selections; no precipitation-to-erosivity conversion is inferred.",
    "Publisher periods, processing methods and source networks may differ. Annual-pattern sensitivity is not an attributed climate trend.",
]


def _copy(value):
    return deepcopy(value)


def _body(value):
    return {name: value[name] for name in ("bytes", "sha256")}


def _directory(ws, key):
    return ws.root / ROOT / identifier(key)


def _label(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply " + name)
    return value.strip()


def _key(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", value):
        raise ValueError("Supply a portable " + name)
    return value


def _choice(value):
    if not isinstance(value, dict) or set(value) != {"study_id", "case_id"}:
        raise ValueError("Each role needs an explicit original study_id and case_id")
    return {"study_id": identifier(value["study_id"]),
            "case_id": _key(value["case_id"], "original forcing case ID")}


def _source_inputs(identity, row):
    if row["id"] != "baseline":
        match = next(x for x in identity["sources"] if x["case_id"] == row["id"])
        source = match["source"]
        return {role: {name: _copy(value[name]) for name in (
                    "selection", "entry", "entry_sha256", "original_manifest",
                    "annotation", "source_context") if name in value}
                for role, value in source["bindings"]["inputs"].items()
                if role in ("PRECIPITATION", "R_FACTOR")}
    grid = identity["baseline"]["grid"]
    # Baseline source entries are read separately by _resolve; no synthetic period
    # labels are substituted for the original publisher metadata.
    return {}


def _resolve(ws, choice, cache, *, verify=False):
    key = choice["study_id"]
    if key not in cache:
        state = climate_forcing._read(ws, key)
        identity = read_json(ws.root / climate_forcing.ROOT / key / "selection.json")
        if identity["baseline"]["grid"] != ws.get_grid(identity["baseline"]["grid"]["id"]):
            raise ValueError("The forcing family's original base grid changed")
        cache[key] = (state, identity)
    state, identity = cache[key]
    matches = [item for item in state["cases"] if item["id"] == choice["case_id"]]
    if len(matches) != 1:
        raise ValueError("Select an actually prepared case from its original forcing study")
    case = matches[0]
    run = climate_forcing._check_case(ws, identity, case, verify=verify)
    if run.get("state") != "complete":
        raise ValueError("Every selected period/scenario case must be actually complete")
    validate_completed_run(run)
    grid = ws.get_grid(case["grid_id"])
    baseline = identity["baseline"]
    if run["selection"]["profile_id"] != baseline["profile"]["id"]:
        raise ValueError("The original scenario changed its retained parameter profile")
    if ws._get("profiles", baseline["profile"]["id"]) != baseline["profile"]:
        raise ValueError("The original native parameter profile changed")
    if ws._get("scenarios", baseline["scenario"]["id"]) != baseline["scenario"]:
        raise ValueError("The original management scenario changed")
    source_inputs = _source_inputs(identity, case)
    if case["id"] == "baseline":
        if ({name: run["artifacts"][name] for name in required_outputs(run_models(run))}
                != baseline["artifacts"]):
            raise ValueError("The original baseline changed its retained mass outputs")
        spec = grid["spec"]
        for role in ("PRECIPITATION", "R_FACTOR"):
            if role not in spec["input_sources"]:
                continue
            pair = {"source_collection_id": spec["source_collection_id"],
                    "source_id": spec["input_sources"][role]}
            entry, manifest = forcing_sources._retained_entry(ws, **{
                "collection_id": pair["source_collection_id"], "source_id": pair["source_id"]})
            source_inputs[role] = {"selection": pair, "entry": entry,
                                  "entry_sha256": digest(entry), "original_manifest": manifest}
    actual_lulc = run.get("stages", {}).get("landcover", {}).get("artifact")
    if baseline["scenario"]["kind"] == "landcover":
        frozen = baseline.get("landcover_artifact")
        if frozen is None or actual_lulc is None or _body(actual_lulc) != _body(frozen):
            raise ValueError("A management role changed its original prepared land cover between periods")
        if verify:
            verify_file(ws.root / "runs" / run["id"], actual_lulc)
    if verify:
        for name in required_outputs(run_models(run)):
            verify_file(ws.root / "runs" / run["id"], run["artifacts"][name])
    return {"study_id": key, "case_id": case["id"], "run_id": run["id"],
            "grid_id": grid["id"], "scenario_id": baseline["scenario"]["id"],
            "scenario": _copy(baseline["scenario"]), "profile": _copy(baseline["profile"]),
            "case": _copy(case), "grid": _copy(grid), "run": _copy(run),
            "source_inputs": source_inputs, "landcover_artifact": _copy(actual_lulc)}


def _forcing_signature(cell):
    """Compare exact editions and actual aligned fields, allowing composed aliases."""
    result = {}
    for role, value in cell["source_inputs"].items():
        result[role] = {
            "selection": value["selection"], "entry_sha256": value["entry_sha256"],
            "body": _body(value["entry"]["body"]),
            "effective_units": (value["entry"].get("conversion") or {}).get("target_units")
                               or value["entry"].get("units"),
            "aligned": _body(cell["grid"]["files"][role]),
        }
    return result


def _selection(ws, raw, *, verify=False):
    allowed = {"title", "purpose", "reference_period_id", "periods",
               "reporting_areas", "difference_maps"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ValueError("Supply the complete explicit climate-management selection")
    periods = raw.get("periods")
    if not isinstance(periods, list) or len(periods) < 2:
        raise ValueError("Select at least two original forcing periods for an interaction")
    controlled = "control" in periods[0] if isinstance(periods[0], dict) else False
    roles = ("reference", "treatment", "control") if controlled else ("reference", "treatment")
    normalized, cells, seen, studies = [], [], set(), {}
    role_studies, role_scenarios, role_cases = {}, {}, {role: set() for role in roles}
    base_grid = profile = models = None
    for supplied in periods:
        if not isinstance(supplied, dict) or set(supplied) != {"id", "label", *roles}:
            raise ValueError("Every period needs the same explicitly selected scenario roles")
        period_id = _key(supplied["id"], "period ID")
        if period_id in seen:
            raise ValueError("Select each period ID once")
        seen.add(period_id)
        period = {"id": period_id, "label": _label(supplied["label"], "a period label")}
        period_cells = {}
        for role in roles:
            choice = _choice(supplied[role])
            period[role] = choice
            cell = _resolve(ws, choice, studies, verify=verify)
            if role in role_studies and role_studies[role] != cell["study_id"]:
                raise ValueError("Each management role must use one original forcing study across periods")
            if choice["case_id"] in role_cases[role]:
                raise ValueError("Do not relabel one original case as multiple forcing periods")
            role_cases[role].add(choice["case_id"])
            role_studies[role], role_scenarios[role] = cell["study_id"], cell["scenario_id"]
            original_grid = studies[cell["study_id"]][1]["baseline"]["grid"]
            if base_grid is None:
                base_grid, profile, models = original_grid, cell["profile"], list(run_models(cell["run"]))
            if original_grid != base_grid or cell["profile"] != profile or list(run_models(cell["run"])) != models:
                raise ValueError("All scenarios need the same original physical base grid, profile and native models")
            climate_forcing._check_grid(ws, base_grid, cell["grid"],
                                        {"PRECIPITATION": True, "R_FACTOR": True}, verify=verify)
            for name in required_outputs(models):
                if cell["run"]["artifacts"][name].get("units") != rasters.MASS_UNITS[name]:
                    raise ValueError("Compare only original converted annual mass-per-pixel artifacts")
            cell.update(period_id=period_id, period=period["label"], role=role)
            period_cells[role] = cell
            cells.append(cell)
        if len({cell["scenario_id"] for cell in period_cells.values()}) != len(roles):
            raise ValueError("Reference, treatment and control must name distinct original scenarios")
        first = _forcing_signature(period_cells["reference"])
        if any(_forcing_signature(cell) != first for cell in period_cells.values()):
            raise ValueError("All management roles within a period need identical original forcing editions and aligned fields")
        normalized.append(period)
    reference = _key(raw.get("reference_period_id"), "reference period ID")
    if reference not in seen:
        raise ValueError("Choose the explicit reference period from this selection")
    areas = raw.get("reporting_areas", [])
    if not isinstance(areas, list):
        raise ValueError("Choose original reporting polygons as a list")
    reporting_sources, area_ids = [], set()
    for area in areas:
        if not isinstance(area, dict) or set(area) - {"name", "source_collection_id", "source_id", "layer", "where"}:
            raise ValueError("Use an original source-pair reporting polygon selection")
        _label(area.get("name"), "a reporting area name")
        entry, manifest = forcing_sources._retained_entry(ws, area["source_collection_id"], area["source_id"])
        if entry["kind"] != "vector" or digest(area) in area_ids:
            raise ValueError("Choose each original vector reporting selection once")
        area_ids.add(digest(area))
        reporting_sources.append({"selection": _copy(area), "entry": entry, "original_manifest": manifest})
    maps = raw.get("difference_maps", True)
    if not isinstance(maps, bool):
        raise ValueError("Choose whether to retain native outputs and benefit maps")
    selection = {"title": _label(raw.get("title"), "a report title"),
                 "purpose": _label(raw.get("purpose"), "the management question"),
                 "reference_period_id": reference, "periods": normalized,
                 "reporting_areas": _copy(areas), "difference_maps": maps}
    versions = comparison_versions([cell["run"] for cell in cells], models)
    # No mutable latest-report pointer or unrelated prepared case is included in
    # the scientific identity. The complete parent families travel via Study.
    identity = {"schema": SCHEMA, "version": VERSION, "workspace_id": ws.project["id"],
                "selection": selection, "roles": list(roles), "models": models,
                "outputs": list(required_outputs(models)), "base_grid": _copy(base_grid),
                "profile": _copy(profile), "cells": cells,
                "studies": {key: _copy(value[1]) for key, value in sorted(studies.items())},
                "reporting_sources": reporting_sources, "native_versions": versions,
                "support_mode": "all-selected-period-role-common-finite-per-metric",
                "implementation": {"model_sha256": file_digest(__file__)}}
    return identity


def preview(ws, selection):
    identity = _selection(ws, selection)
    periods = []
    for period in identity["selection"]["periods"]:
        row = {"id": period["id"], "label": period["label"]}
        for cell in identity["cells"]:
            if cell["period_id"] == period["id"]:
                row[cell["role"]] = {key: cell[key] for key in (
                    "study_id", "case_id", "run_id", "grid_id", "scenario_id")}
        periods.append(row)
    return {"schema": "upstate.climate-management-preview/v1", "id": digest(identity),
            "workspace_id": ws.project["id"], "title": identity["selection"]["title"],
            "selection": identity["selection"], "identity": identity, "periods": periods,
            "models": identity["models"], "outputs": identity["outputs"],
            "limitations": list(LIMITATIONS)}


def list_reports(ws):
    return [get_report(ws, path.parent.name, verify=False)
            for path in sorted((ws.root / ROOT).glob("*/record.json"))]


def catalogue(ws):
    return {"schema": "upstate.climate-management-catalogue/v1",
            "workspace_id": ws.project["id"], "studies": climate_forcing.list_studies(ws),
            "reports": list_reports(ws), "reporting_areas": climate_forcing._reporting_rows(ws),
            "limitations": list(LIMITATIONS)}


def _csv(rows):
    columns = list(dict.fromkeys(key for row in rows for key in row))
    def cell(value):
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return canonical(value).decode("utf-8")
        if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
            return "'" + value
        return value
    target = io.StringIO(newline="")
    writer = csv.DictWriter(target, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows({key: cell(value) for key, value in row.items()} for row in rows)
    return target.getvalue().encode("utf-8")


def _valid(array):
    import numpy as np
    return ~np.ma.getmaskarray(array) & np.isfinite(np.ma.getdata(array))


def _sum(values):
    import numpy as np
    total = float(np.sum(values, dtype="float64"))
    if not math.isfinite(total):
        raise ValueError("A native annual mass sum exceeds finite numerical range")
    return total


def _number(value):
    return "Not available" if value is None else format(value, ",.8g") if isinstance(value, (float, int)) else str(value)


def _measure(ws, identity, directory):
    """Read original converted output rasters in windows, preserving one cohort mask."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    from shapely.geometry import mapping
    from .parameter_studies import _areas

    cells = identity["cells"]
    outputs = identity["outputs"]
    grid = identity["base_grid"]
    grid_root = ws.root / "grids" / grid["id"]
    mask_path = verify_file(grid_root, grid["files"]["reporting_mask"])
    first_cell = cells[0]
    first_path = verify_file(ws.root / "runs" / first_cell["run_id"],
                             first_cell["run"]["artifacts"][outputs[0]])
    with rasterio.open(first_path) as first:
        if first.crs is None or not first.crs.is_projected:
            raise ValueError("Area reporting requires the original projected model CRS")
        factor = float(first.crs.linear_units_factor[1])
        area_m2 = abs(first.transform.a * first.transform.e -
                      first.transform.b * first.transform.d) * factor * factor
        if not math.isfinite(area_m2) or area_m2 <= 0:
            raise ValueError("The retained model lattice has invalid cell area")
        areas = _areas(ws, identity["selection"]["reporting_areas"], first.crs, grid["id"])
        for area in areas:
            area["source_area_ha"] *= factor * factor
            area["reporting_intersection_ha"] *= factor * factor
        grid_signature = {"crs_wkt": first.crs.to_wkt(), "transform": list(first.transform),
                          "width": first.width, "height": first.height, "cell_area_m2": area_m2}
    independent, support, rows, files = [], [], [], {}
    periods = identity["selection"]["periods"]
    reference_period = identity["selection"]["reference_period_id"]
    roles = identity["roles"]
    lookup = {(cell["period_id"], cell["role"]): index for index, cell in enumerate(cells)}
    for metric in outputs:
        with ExitStack() as opened:
            readers = []
            for cell in cells:
                descriptor = cell["run"]["artifacts"][metric]
                path = verify_file(ws.root / "runs" / cell["run_id"], descriptor)
                reader = opened.enter_context(rasterio.open(path))
                if reader.tags().get("units") != rasters.MASS_UNITS[metric]:
                    raise ValueError("The actual retained raster does not declare the selected annual mass unit")
                readers.append(reader)
            native_mask = opened.enter_context(rasterio.open(mask_path))
            first = readers[0]
            for reader in [*readers[1:], native_mask]:
                rasters.check_same_grid(first, reader)
                # The native helper's tolerance is useful generally; the selected
                # forcing family requires the exact retained affine lattice.
                if tuple(first.transform) != tuple(reader.transform):
                    raise ValueError("Climate-management outputs need the exact original affine lattice")
            counts = {a["id"]: {"reporting": 0, "common": 0,
                      "valid": [0] * len(cells), "independent": [[] for _ in cells],
                      "shared": [[] for _ in cells], "excluded": [[] for _ in cells]} for a in areas}
            profile = first.profile.copy()
            profile.update(driver="GTiff", count=1, dtype="float64", nodata=-1.7976931348623157e308,
                           compress="deflate", predictor=3)
            # Common-support rasters are always retained so every table denominator
            # is independently inspectable, even when full result maps are omitted.
            mask_member = "common-support/" + metric + ".tif"
            mask_target = directory / mask_member
            mask_target.parent.mkdir(parents=True, exist_ok=True)
            mask_temporary = mask_target.with_name(".writing-" + mask_target.name)
            mask_profile = profile.copy()
            mask_profile.update(dtype="uint8", nodata=0, predictor=1)
            mask_writer = opened.enter_context(rasterio.open(mask_temporary, "w", **mask_profile))
            writers, temporary_maps = {}, []
            if identity["selection"]["difference_maps"]:
                for period in periods:
                    kinds = ["benefit", "interaction"]
                    if "control" in roles:
                        kinds += ["control-adjusted-benefit", "control-adjusted-interaction"]
                    for kind in kinds:
                        member = "maps/" + period["id"] + "/" + kind + "-" + metric + ".tif"
                        target = directory / member
                        target.parent.mkdir(parents=True, exist_ok=True)
                        temporary = target.with_name(".writing-" + target.name)
                        writer = opened.enter_context(rasterio.open(temporary, "w", **profile))
                        writers[(period["id"], kind)] = writer
                        temporary_maps.append((member, target, temporary))
            for _, window in first.block_windows(1):
                values = [reader.read(1, window=window, masked=True).astype("float64") for reader in readers]
                original = native_mask.read(1, window=window, masked=True)
                reporting = _valid(original) & (original.filled(0) > 0)
                finite = [_valid(value) for value in values]
                common = reporting.copy()
                for valid in finite:
                    common &= valid
                mask_writer.write(common.astype("uint8"), 1, window=window)
                raw = [value.filled(np.nan) for value in values]
                for area in areas:
                    domain = reporting
                    if area["geometry"] is not None:
                        inside = geometry_mask([mapping(area["geometry"])], out_shape=reporting.shape,
                            transform=first.window_transform(window), all_touched=False, invert=True)
                        domain = reporting & inside
                    paired = common & domain
                    counter = counts[area["id"]]
                    counter["reporting"] += int(domain.sum())
                    counter["common"] += int(paired.sum())
                    for index, array in enumerate(raw):
                        valid = domain & finite[index]
                        excluded = valid & ~paired
                        counter["valid"][index] += int(valid.sum())
                        counter["independent"][index].append(_sum(array[valid]))
                        counter["shared"][index].append(_sum(array[paired]))
                        counter["excluded"][index].append(_sum(array[excluded]))
                if writers:
                    def benefit(period_id, control=False):
                        before = lookup[(period_id, "control" if control else "reference")]
                        after = lookup[(period_id, "treatment")]
                        return raw[before] - raw[after]
                    for period in periods:
                        pid = period["id"]
                        maps = {"benefit": benefit(pid),
                                "interaction": benefit(pid) - benefit(reference_period)}
                        if "control" in roles:
                            maps["control-adjusted-benefit"] = benefit(pid, True)
                            maps["control-adjusted-interaction"] = benefit(pid, True) - benefit(reference_period, True)
                        for kind, value in maps.items():
                            if not np.isfinite(value[common]).all():
                                raise ValueError("A management contrast exceeds finite numerical range")
                            writers[(pid, kind)].write(np.where(common, value, profile["nodata"]), 1, window=window)
            # Close all writers before publishing complete deterministic files.
        mask_temporary.replace(mask_target)
        files[mask_member] = describe_file(directory, mask_target, units="1=common finite selected cohort; 0=excluded")
        for member, target, temporary in temporary_maps:
            temporary.replace(target)
            files[member] = describe_file(directory, target, units=rasters.MASS_UNITS[metric])
        units = rasters.MASS_UNITS[metric].replace("/pixel", "")
        for area in areas:
            counter = counts[area["id"]]
            common_n = counter["common"]
            support.append({"area_id": area["id"], "area": area["name"], "pollutant": metric,
                "reporting_cells": counter["reporting"], "common_cells": common_n,
                "common_hectares": common_n * area_m2 / 10000,
                "excluded_from_common_cells": counter["reporting"] - common_n,
                "common_percent_of_reporting": (100 * common_n / counter["reporting"] if counter["reporting"] else None),
                "selected_run_count": len(cells), "mask": mask_member,
                "status": "available" if common_n else "no-common-finite-support"})
            shared = []
            for index, cell in enumerate(cells):
                n = counter["valid"][index]
                common_total = math.fsum(counter["shared"][index]) if common_n else None
                if common_total is not None and not math.isfinite(common_total):
                    raise ValueError("The common annual mass total is not finite")
                shared.append(common_total)
                independent.append({"period_id": cell["period_id"], "period": cell["period"],
                    "role": cell["role"], "run_id": cell["run_id"], "study_id": cell["study_id"],
                    "case_id": cell["case_id"], "area_id": area["id"], "area": area["name"],
                    "pollutant": metric, "units": units, "valid_cells": n,
                    "valid_hectares": n * area_m2 / 10000,
                    "independent_total": math.fsum(counter["independent"][index]) if n else None,
                    "common_total": common_total, "common_cells": common_n,
                    "excluded_finite_cells": n - common_n,
                    "excluded_finite_total": math.fsum(counter["excluded"][index]) if n else None,
                    "missing_reporting_cells": counter["reporting"] - n})
            def total(pid, role):
                return shared[lookup[(pid, role)]]
            def percentage(value, denominator):
                if value is None or denominator in (None, 0):
                    return None
                answer = 100 * (value / denominator)
                if not math.isfinite(answer):
                    raise ValueError("The benefit percentage exceeds finite numerical range")
                return answer
            def difference(a, b):
                value = a - b if a is not None and b is not None else None
                if value is not None and not math.isfinite(value):
                    raise ValueError("An annual benefit or interaction is not finite")
                return value
            reference_benefit = difference(total(reference_period, "reference"), total(reference_period, "treatment"))
            reference_control = (difference(total(reference_period, "control"), total(reference_period, "treatment"))
                                 if "control" in roles else None)
            for period in periods:
                pid = period["id"]
                before, after = total(pid, "reference"), total(pid, "treatment")
                control = total(pid, "control") if "control" in roles else None
                avoided = difference(before, after)
                adjusted = difference(control, after)
                rows.append({"period_id": pid, "period": period["label"],
                    "reference_period_id": reference_period, "area_id": area["id"], "area": area["name"],
                    "pollutant": metric, "units": units, "common_cells": common_n,
                    "common_hectares": common_n * area_m2 / 10000,
                    "reference_total": before, "treatment_total": after, "control_total": control,
                    "benefit": avoided, "control_adjusted_benefit": adjusted,
                    "benefit_percent_of_reference": percentage(avoided, before),
                    "interaction": difference(avoided, reference_benefit),
                    "control_adjusted_interaction": difference(adjusted, reference_control)})
    return rows, support, independent, files, [
        {key: value for key, value in area.items() if key != "geometry"} for area in areas], grid_signature


def _table(columns, rows):
    return {"kind": "table", "columns": columns, "rows": [[_number(x) for x in row] for row in rows]}


def _sections(result):
    selection = result["selection"]
    rows = result["rows"]
    sections = [
        ["Question and original selection", [
            selection["purpose"],
            "Explicit reference period: " + selection["reference_period_id"] +
            ". Values are annual modeled exports reaching streams on common finite reporting cells.",
            "Positive benefit means lower modeled export with treatment. A positive interaction means "
            "a greater benefit in the selected period than in the reference period. No observational causation is inferred.",
            _table(["Period", "Role", "Original study", "Original case", "Original run"],
                   [[cell["period"], cell["role"], cell["study_id"], cell["case_id"], cell["run_id"]]
                    for cell in result["cohort"]])]],
        ["Management benefits on shared support", [
            _table(["Period", "Area", "Metric / annual unit", "Reference", "Treatment",
                    "Reference minus treatment", "Control minus treatment", "Common hectares"],
                   [[row["period"], row["area"], row["pollutant"] + " / " + row["units"],
                     row["reference_total"], row["treatment_total"], row["benefit"],
                     row["control_adjusted_benefit"], row["common_hectares"]] for row in rows])]],
        ["Change in benefit relative to the reference period", [
            "All selected periods and scenario roles use one common finite mask per metric. "
            "This avoids confusing a support change with a management interaction.",
            _table(["Period", "Area", "Metric / annual unit", "Benefit interaction",
                    "Control-adjusted interaction", "Benefit / reference export (%)"],
                   [[row["period"], row["area"], row["pollutant"] + " / " + row["units"],
                     row["interaction"], row["control_adjusted_interaction"],
                     row["benefit_percent_of_reference"]] for row in rows])]],
        ["Finite support and excluded data", [
            "Zero common support and zero percentage denominators remain unavailable. "
            "Independent totals describe each original run on its own valid reporting cells; "
            "they are not used to calculate cross-period benefit.",
            _table(["Area", "Metric", "Reporting cells", "Common cells", "Common hectares", "Status"],
                   [[r["area"], r["pollutant"], r["reporting_cells"], r["common_cells"],
                     r["common_hectares"], r["status"]] for r in result["support"]]),
            _table(["Period", "Role", "Area", "Metric / annual unit", "Independent total",
                    "Common total", "Excluded finite total", "Missing reporting cells"],
                   [[r["period"], r["role"], r["area"], r["pollutant"] + " / " + r["units"],
                     r["independent_total"], r["common_total"], r["excluded_finite_total"],
                     r["missing_reporting_cells"]] for r in result["independent_totals"]])]],
        ["Forcing editions and model interpretation", [
            _table(["Period", "Role", "Input", "Publisher vintage", "Native units", "Source URI",
                    "Original collection", "Original source"],
                   [[cell["period"], cell["role"], role, value["entry"].get("vintage"),
                     value["entry"].get("units"), value["entry"].get("uri"),
                     value["selection"]["source_collection_id"], value["selection"]["source_id"]]
                    for cell in result["cohort"] for role, value in cell["source_inputs"].items()]),
            "NDR normalization: " + result["normalization"]["mode"] +
            "; retained runoff_proxy_av = " + _number(result["normalization"]["runoff_proxy_av"]) + ".",
            "A uniform multiplier cancels only under automatic normalization with unchanged valid support. "
            "The retained profile and original native arguments remain authoritative. "
            "Independent R-factor source editions are never inferred from precipitation."]],
        ["Scientific limits and retained originals", [*result["limitations"],
            "CSV text beginning with a spreadsheet formula character is apostrophe-prefixed. "
            "Exact original strings and numbers remain in JSON and the retained source records.",
            {"kind": "links", "items": [{"title": name, "path": name} for name in
                ("results.json", "benefits.csv", "independent-totals.csv", "support.csv", "snapshot.json")]}]],
    ]
    return sections


def _html(result):
    out = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
           "<title>" + html.escape(result["title"]) + "</title>",
           "<style>body{font:16px/1.55 system-ui,sans-serif;max-width:1200px;margin:auto;padding:28px;color:#192927;background:#fbfcfa}"
           "h1{line-height:1.2}h2{margin-top:2.2em}table{border-collapse:collapse;width:100%;font-size:14px}"
           "th,td{padding:9px;text-align:left;border-bottom:1px solid #cbd6d1;vertical-align:top}th{background:#e9f0ec}"
           ".scroll{overflow:auto}p{max-width:85ch}a{color:#135f49}code{overflow-wrap:anywhere}"
           "@media(max-width:600px){body{padding:16px}th,td{padding:7px}}</style>",
           "<h1>" + html.escape(result["title"]) + "</h1>",
           '<p><a href="climate-management-results.zip">Complete original results ZIP</a> · '
           '<a href="observed-report.json">Scientific Report source</a> · <a href="MANIFEST.json">Original file inventory</a></p>']
    for heading, blocks in _sections(result):
        out.append("<section><h2>" + html.escape(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                out.append("<p>" + html.escape(block) + "</p>")
            elif block["kind"] == "table":
                out.append('<div class="scroll"><table><thead><tr>' +
                           "".join("<th>" + html.escape(str(x)) + "</th>" for x in block["columns"]) +
                           "</tr></thead><tbody>")
                for row in block["rows"]:
                    out.append("<tr>" + "".join("<td>" + html.escape(str(x)) + "</td>" for x in row) + "</tr>")
                out.append("</tbody></table></div>")
            else:
                out.append("<p>" + " · ".join('<a href="' + html.escape(item["path"], quote=True) + '">' +
                           html.escape(item["title"]) + "</a>" for item in block["items"]) + "</p>")
        out.append("</section>")
    out.append("<p>Original project <code>" + html.escape(result["workspace_id"]) +
               "</code>; retained report <code>" + html.escape(result["id"]) + "</code>.</p></html>")
    return "".join(out)


def _archive(directory, members, path):
    if not path.exists():
        temporary = path.with_name(".archive-candidate.zip")
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for name, item in sorted(members.items()):
                verified = verify_file(directory, item)
                stamp = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                stamp.compress_type = zipfile.ZIP_DEFLATED
                with verified.open("rb") as source, output.open(stamp, "w", force_zip64=True) as target:
                    shutil.copyfileobj(source, target, 1024 * 1024)
        temporary.replace(path)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != set(members):
            raise ValueError("The original management ZIP changed its full member list")
        for name, item in members.items():
            checksum, size = hashlib.sha256(), 0
            with archive.open(name) as incoming:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                    size += len(chunk)
                    checksum.update(chunk)
            if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                raise ValueError("An original management ZIP member changed")


def build(ws, selection, expected_id):
    shown = preview(ws, selection)
    key = identifier(expected_id)
    if shown["id"] != key:
        raise ValueError("The reviewed climate-management source selection changed; open a fresh preview")
    directory = _directory(ws, key)
    # Selected source studies use their original lock order. No native solver is
    # started or resumed. Completed reports have a separate immutable output lock.
    with ExitStack() as locks:
        for study_id in sorted(shown["identity"]["studies"]):
            locks.enter_context(held(ws.root / climate_forcing.ROOT / study_id / ".study.lock", blocking=False))
        locks.enter_context(held(directory / ".report.lock", blocking=False))
        if (directory / "record.json").is_file():
            return get_report(ws, key)
        identity = _selection(ws, selection, verify=True)
        if digest(identity) != key:
            raise ValueError("The original scientific inputs changed after the reviewed preview")
        atomic_json(directory / "snapshot.json", identity, immutable=True)
        rows, support, independent, copied, areas, lattice = _measure(ws, identity, directory)
        cells = identity["cells"]
        profile = identity["profile"]
        mean = (profile.get("ndr") or {}).get("runoff_proxy_av")
        result = {
            "schema": SCHEMA, "id": key, "version": VERSION,
            "workspace_id": ws.project["id"], "title": identity["selection"]["title"],
            "selection": identity["selection"], "models": identity["models"],
            "outputs": identity["outputs"], "roles": identity["roles"],
            "rows": rows, "support": support, "independent_totals": independent,
            "areas": areas, "lattice": lattice, "native_versions": identity["native_versions"],
            "cohort": [{name: _copy(cell[name]) for name in (
                "period_id", "period", "role", "study_id", "case_id", "run_id", "grid_id",
                "scenario_id", "source_inputs", "landcover_artifact")} for cell in cells],
            "forcing_diagnostics": [{"period_id": cell["period_id"], "role": cell["role"],
                "original_case_diagnostics": _copy(cell["case"].get("forcing_diagnostics", {}))}
                for cell in cells],
            "normalization": {"mode": ("fixed native runoff-proxy mean" if mean else
                                       "automatic own-valid-model-domain runoff-proxy mean"),
                              "runoff_proxy_av": mean,
                              "profile_id": profile["id"]},
            "support_mode": identity["support_mode"],
            "benefit_direction": "reference minus treatment",
            "control_adjusted_direction": "control minus treatment",
            "interaction_direction": "selected period benefit minus reference-period benefit",
            "limitations": list(LIMITATIONS),
        }
        # Frozen selection is rechecked after the pixel pass, before any complete
        # record is published. A partial directory remains resumable at the same ID.
        if digest(_selection(ws, selection, verify=True)) != key:
            raise ValueError("The selected original cohort changed during report calculation")
        atomic_json(directory / "results.json", result, immutable=True)
        atomic_bytes(directory / "benefits.csv", _csv(rows), immutable=True)
        atomic_bytes(directory / "independent-totals.csv", _csv(independent), immutable=True)
        atomic_bytes(directory / "support.csv", _csv(support), immutable=True)
        atomic_bytes(directory / "report.html", _html(result).encode("utf-8"), immutable=True)
        copied["reporting-area.gpkg"] = copy_verified(
            ws.root / "grids" / identity["base_grid"]["id"],
            identity["base_grid"]["files"]["reporting_area"], directory, path="reporting-area.gpkg")
        for cell in cells:
            prefix = cell["period_id"] + "/" + cell["role"]
            if identity["selection"]["difference_maps"]:
                for metric in identity["outputs"]:
                    name = "native-outputs/" + prefix + "/" + metric + ".tif"
                    copied[name] = copy_verified(ws.root / "runs" / cell["run_id"],
                        cell["run"]["artifacts"][metric], directory, path=name)
            for model in identity["models"]:
                stage = cell["run"].get("stages", {}).get(model, {})
                if stage.get("arguments"):
                    name = "native-arguments/" + prefix + "/" + model + ".json"
                    copied[name] = copy_verified(ws.root / "runs" / cell["run_id"],
                                                stage["arguments"], directory, path=name)
        members = {name: describe_file(directory, directory / name) for name in (
            "snapshot.json", "results.json", "benefits.csv", "independent-totals.csv", "support.csv", "report.html")}
        members.update(copied)
        recipe = {
            "schema": "upstate.observed-report/v1",
            "edition": "climate-management-" + key, "title": result["title"],
            "report_context_kind": "climate-management-comparison",
            "selection": _copy(result["selection"]), "report_id": key,
            "project_id": ws.project["id"], "sections": _sections(result),
            "inputs": [_copy(item) for _, item in sorted(members.items())],
            "source_links": [{"title": "Original climate-management report", "path": "report.html"},
                             {"title": "Exact benefits and interactions", "path": "benefits.csv"},
                             {"title": "Original run, source and parameter identity", "path": "snapshot.json"}],
        }
        atomic_json(directory / "observed-report.json", recipe, immutable=True)
        members["observed-report.json"] = describe_file(directory, directory / "observed-report.json")
        atomic_json(directory / "MANIFEST.json", {
            "schema": "upstate.climate-management-files/v1", "report_id": key,
            "workspace_id": ws.project["id"], "files": members}, immutable=True)
        members["MANIFEST.json"] = describe_file(directory, directory / "MANIFEST.json")
        archive = directory / "climate-management-results.zip"
        _archive(directory, members, archive)
        members[archive.name] = describe_file(directory, archive)
        uri = "workspace:" + ws.project["id"] + "/" + ROOT + "/" + key
        # A stable scientific edition label, not a fabricated observation date.
        vintage = "Retained annual management comparison " + key[:16]
        entries = [{
            "id": SOURCE_ID, "title": result["title"], "kind": "document",
            "path": "observed-report.json", "sha256": members["observed-report.json"]["sha256"],
            "uri": uri, "vintage": vintage, "role": "OBSERVED_CONTEXT",
            "source": {"report_id": key, "project_id": ws.project["id"]},
            "companions": [_copy(item) for name, item in sorted(members.items())
                           if name != "observed-report.json"],
        }, {
            "id": "climate-management-benefits", "title": result["title"] + " — annual benefits and interactions",
            "kind": "table", "path": "benefits.csv", "sha256": members["benefits.csv"]["sha256"],
            "uri": uri, "vintage": vintage, "units": None,
            "quantities_note": "N/P kg/year; sediment metric tonnes/year; hectares and percent have explicit columns.",
            "companions": [members["results.json"], members["snapshot.json"],
                           members["independent-totals.csv"], members["support.csv"]],
        }, {
            "id": "climate-management-reporting-area", "title": "Original reporting area",
            "kind": "vector", "path": "reporting-area.gpkg",
            "sha256": members["reporting-area.gpkg"]["sha256"], "uri": uri,
            "vintage": vintage, "layer": "reporting_area",
        }]
        for name, item in sorted(copied.items()):
            if name.endswith(".tif"):
                entries.append({"id": "management-map-" + digest(name)[:24],
                    "title": name, "kind": "raster", "path": name, "sha256": item["sha256"],
                    "uri": uri, "vintage": vintage, "units": item.get("units"),
                    "role": "CLIMATE_MANAGEMENT_OUTPUT",
                    "source": {"report_id": key, "project_id": ws.project["id"], "member": name}})
        atomic_json(directory / "sources.json", {"schema": "upstate.sources/v1",
            "title": result["title"], "entries": entries,
            "scope": {"schema": SCHEMA, "report_id": key, "project_id": ws.project["id"],
                      "selection": identity["selection"], "run_ids": [cell["run_id"] for cell in cells]}},
            immutable=True)
        collection = ws.import_sources(directory / "sources.json")
        members["sources.json"] = describe_file(directory, directory / "sources.json")
        record = {**result, "identity": identity, "files": members,
                  "directory": directory.relative_to(ws.root).as_posix(),
                  "source": {"source_collection_id": collection["id"], "source_id": SOURCE_ID}}
        atomic_json(directory / "record.json", record, immutable=True)
        return get_report(ws, key)


def _member_name(name):
    from pathlib import PurePosixPath
    value = PurePosixPath(name)
    if (not isinstance(name, str) or "\\" in name or value.is_absolute() or
            value.as_posix() != name or any(part in ("", ".", "..") for part in value.parts)):
        raise ValueError("A retained report member escaped its original directory")
    return name


def get_report(ws, report_id, verify=True):
    """Open the saved edition without recomputing statistics or discovering runs."""
    key = identifier(report_id)
    directory = _directory(ws, key)
    record = read_json(directory / "record.json")
    identity = record["identity"]
    if (record.get("schema") != SCHEMA or identity.get("schema") != SCHEMA
            or record.get("id") != key or digest(identity) != key
            or record.get("workspace_id") != ws.project["id"]
            or identity.get("workspace_id") != ws.project["id"]
            or record.get("selection") != identity["selection"]
            or record.get("directory") != directory.relative_to(ws.root).as_posix()):
        raise ValueError("The retained management report changed its original identity")
    files = record["files"]
    required = {"snapshot.json", "results.json", "benefits.csv", "independent-totals.csv",
                "support.csv", "report.html", "observed-report.json", "MANIFEST.json",
                "climate-management-results.zip", "sources.json", "reporting-area.gpkg"}
    if not isinstance(files, dict) or not required.issubset(files):
        raise ValueError("The saved management report lost its complete original files")
    for name, item in files.items():
        if _member_name(name) != item.get("path") or not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
            raise ValueError("The retained management member changed its original descriptor")
        if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("The original management member has no SHA256 identity")
    for name in ("snapshot.json", "results.json", "MANIFEST.json", "sources.json", "observed-report.json"):
        verify_file(directory, files[name])
    if read_json(directory / "snapshot.json") != identity:
        raise ValueError("The management snapshot differs from its immutable report")
    results = read_json(directory / "results.json")
    if any(record.get(name) != value for name, value in results.items()):
        raise ValueError("The management record differs from its complete original results")
    manifest = read_json(directory / "MANIFEST.json")
    expected_manifest = {name: item for name, item in files.items()
                         if name not in ("MANIFEST.json", "climate-management-results.zip", "sources.json")}
    if (manifest.get("report_id") != key or manifest.get("workspace_id") != ws.project["id"]
            or manifest.get("files") != expected_manifest):
        raise ValueError("The original management report manifest changed")
    source = record["source"]
    collection = ws._get("sources", identifier(source["source_collection_id"]))
    scope = collection.get("scope", {})
    if (source.get("source_id") != SOURCE_ID or scope.get("schema") != SCHEMA
            or scope.get("report_id") != key or scope.get("project_id") != ws.project["id"]
            or scope.get("selection") != record["selection"]
            or scope.get("run_ids") != [cell["run_id"] for cell in identity["cells"]]
            or _body(collection["original_manifest"]) != _body(files["sources.json"])):
        raise ValueError("The ordinary report source changed its scientific selection")
    entries = [entry for entry in collection["entries"] if entry["id"] == SOURCE_ID]
    if len(entries) != 1:
        raise ValueError("The original Scientific Report document is missing or ambiguous")
    primary = entries[0]
    if (primary.get("kind") != "document" or primary.get("role") != "OBSERVED_CONTEXT"
            or primary.get("source") != {"report_id": key, "project_id": ws.project["id"]}):
        raise ValueError("The ordinary Scientific Report source changed its native role")
    def source_signature(item):
        return (item["source_path"], item["bytes"], item["sha256"])
    actual = [source_signature(primary["body"]), *map(source_signature, primary.get("companions", []))]
    expected = [(name, item["bytes"], item["sha256"]) for name, item in files.items() if name != "sources.json"]
    if (len({row[0] for row in actual}) != len(actual) or sorted(actual) != sorted(expected)
            or actual[0] != ("observed-report.json", files["observed-report.json"]["bytes"],
                             files["observed-report.json"]["sha256"])):
        raise ValueError("The report source lost an exact original companion or primary")
    original_manifest = read_json(directory / "sources.json")
    primaries = [item for item in original_manifest["entries"] if item["id"] == SOURCE_ID]
    if (len(primaries) != 1 or [item["path"] for item in primaries[0]["companions"]]
            != [item["source_path"] for item in primary.get("companions", [])]):
        raise ValueError("The original report companion order changed")
    if verify:
        for item in files.values():
            verify_file(directory, item)
        ws.source_file(source["source_collection_id"], SOURCE_ID)
        archive_members = {name: item for name, item in files.items()
                           if name not in ("sources.json", "climate-management-results.zip")}
        _archive(directory, archive_members, directory / "climate-management-results.zip")
    return record


def verify_all(ws):
    return [get_report(ws, path.parent.name)
            for path in sorted((ws.root / ROOT).glob("*/record.json"))]
