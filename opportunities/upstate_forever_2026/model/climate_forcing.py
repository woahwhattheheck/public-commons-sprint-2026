"""Spatial forcing studies on original native NDR/SDR runs.

Only declared forcing editions change. Terrain, land cover, erodibility, lattice,
model domain, reporting geometry, parameters and scenario remain original.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import hashlib
import html
import io
import math
from pathlib import Path
import re
import zipfile

from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical,
                     describe_file, digest, file_digest, held, identifier, now, read_json,
                     verify_file)
from .model_selection import (grid_models, run_models, required_outputs,
                              validate_completed_run)
from .native_versions import comparison_versions
from . import forcing_sources, rasters
from .reuse import copy_verified

SCHEMA = "upstate.climate-forcing-study/v1"
REPORT_SCHEMA = "upstate.climate-forcing-report/v1"
ROOT = "climate-forcing-studies"
VERSION = 1
FIXED_FILES = ("DEM", "NLCD", "K_FACTOR", "model_domain",
               "reporting_area", "reporting_mask")
LIMITATIONS = [
    "These are annual steady-state native NDR/SDR forcing comparisons, not an event, seasonal flow or intake concentration model.",
    "NDR uses the retained profile's runoff_proxy_av when provided; otherwise its own valid model-domain proxy mean. A uniform multiplier may cancel.",
    "SDR rainfall erosivity is an independent declared input. Annual precipitation is not converted into R without a separate sourced method.",
    "Same model lattice and unchanged terrain, land cover, erodibility, model/reporting geometries and model parameters are required.",
    "Comparison totals use only common finite annual mass pixels. Independent totals and valid-support counts remain visible.",
]


def _text(value, label, limit=4000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Supply " + label)
    return value.strip()


def _body(value):
    return {name: value[name] for name in ("bytes", "sha256")}


def _directory(ws, key):
    return ws.root / ROOT / identifier(key)


def _source_rows(ws):
    rows = {"PRECIPITATION": [], "R_FACTOR": []}
    for collection in ws.sources():
        for entry in collection["entries"]:
            if entry.get("kind") != "raster":
                continue
            row = {name: deepcopy(entry.get(name)) for name in (
                "title", "units", "role", "uri", "vintage", "temporal_support",
                "source_resolution", "native_grid", "derived_from", "conversion")}
            row.update(source_collection_id=collection["id"], source_id=entry["id"],
                       body={name: entry["body"].get(name)
                             for name in ("bytes", "sha256", "filename")})
            role = entry.get("role")
            candidates = (["PRECIPITATION"] if role == "RUNOFF_PROXY" else
                          [role] if role in rows else [])
            for selected in candidates:
                rows[selected].append(deepcopy(row))
    return rows


def _reporting_rows(ws):
    return [{"source_collection_id": collection["id"], "source_id": entry["id"],
             **{name: deepcopy(entry.get(name)) for name in ("title", "layer", "uri", "vintage")}}
            for collection in ws.sources() for entry in collection["entries"]
            if entry.get("kind") == "vector"]


def list_studies(ws):
    """Read only retained forcing studies for ordinary operator refresh."""
    return [get(ws, identifier(path.parent.name))
            for path in sorted((ws.root / ROOT).glob("*/study.json"))]


def catalog(ws):
    runs = []
    for path in sorted((ws.root / "runs").glob("*/run.json")):
        run = ws.inspect_run(identifier(path.parent.name))
        if run.get("state") != "complete":
            continue
        scenario = ws._get("scenarios", run["selection"]["scenario_id"])
        runs.append({"id": run["id"], "state": run["state"],
                     "selection": deepcopy(run["selection"]),
                     "models": list(run_models(run)), "title": scenario.get("title", run["id"])})
    studies = list_studies(ws)
    return {"schema": "upstate.climate-forcing-catalog/v1",
            "workspace_id": ws.project["id"], "baseline_runs": runs,
            "studies": studies, "sources": _source_rows(ws),
            "reporting_areas": _reporting_rows(ws),
            "limitations": list(LIMITATIONS)}


def _baseline(ws, key):
    run = ws.inspect_run(identifier(key))
    if run.get("state") != "complete":
        raise ValueError("Select an actually completed original baseline run")
    validate_completed_run(run)
    grid = ws.get_grid(run["selection"]["grid_id"])
    profile = ws._get("profiles", run["selection"]["profile_id"])
    scenario = ws._get("scenarios", run["selection"]["scenario_id"])
    if not set(run_models(run)).issubset(grid_models(grid)):
        raise ValueError("The retained baseline grid lacks its native model scope")
    # New cases use the installed original native execution adapter. Do not mix
    # a historical version with its successor in one forcing comparison.
    versions = comparison_versions([run], run_models(run))
    if any(v != INVEST_VERSION for v in versions["versions"].values()):
        raise ValueError("Prepare this forcing family from a baseline using the current native model version")
    return run, grid, profile, scenario


def _selection(ws, raw):
    if not isinstance(raw, dict):
        raise ValueError("Supply the complete forcing selection")
    allowed = {"title", "purpose", "baseline_run_id", "cases", "reporting_areas", "difference_maps"}
    if set(raw) - allowed:
        raise ValueError("Unknown forcing selection fields")
    run, grid, profile, scenario = _baseline(ws, raw.get("baseline_run_id"))
    cases = raw.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Select at least one explicit forcing case")
    seen, normalized, previews = set(), [], []
    for case in cases:
        if not isinstance(case, dict) or set(case) - {"id", "label", "overrides"}:
            raise ValueError("Each forcing case needs id, label and explicit role overrides")
        key = case.get("id")
        if (not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", key)
                or key == "baseline" or key in seen):
            raise ValueError("Choose a unique portable case ID other than baseline")
        seen.add(key)
        overrides = case.get("overrides")
        if not isinstance(overrides, dict) or not overrides or set(overrides) - {"PRECIPITATION", "R_FACTOR"}:
            raise ValueError("Select explicit precipitation/runoff or erosivity source editions")
        if "PRECIPITATION" in overrides and "ndr" not in run_models(run):
            raise ValueError("A runoff-proxy case requires NDR in the retained baseline")
        if "R_FACTOR" in overrides and "sdr" not in run_models(run):
            raise ValueError("An erosivity case requires SDR in the retained baseline")
        source = forcing_sources.preview_grid_sources(ws, grid["id"], overrides)
        if "PRECIPITATION" in overrides and (profile.get("ndr") or {}).get("runoff_proxy_av") is not None:
            original = source["bindings"]["baseline_inputs"]["PRECIPITATION"]["entry"]
            original_units = (original.get("conversion") or {}).get("target_units") or original.get("units")
            chosen_units = source["bindings"]["inputs"]["PRECIPITATION"]["source_context"]["effective_units"]
            if not original_units or chosen_units != original_units:
                raise ValueError("A fixed original NDR mean requires the same effective proxy units in every case")
        normalized.append({"id": key, "label": _text(case.get("label"), "a case label", 200),
                           "overrides": deepcopy(overrides)})
        previews.append({"case_id": key, "source": source})
    areas = raw.get("reporting_areas", [])
    if not isinstance(areas, list):
        raise ValueError("Select retained reporting polygons as a list")
    bound_areas, seen_areas = [], set()
    for area in areas:
        if (not isinstance(area, dict) or set(area) -
                {"source_collection_id", "source_id", "name", "layer", "where"}):
            raise ValueError("Use original source-pair reporting selections")
        entry, _ = forcing_sources._retained_entry(ws, area["source_collection_id"], area["source_id"])
        if entry["kind"] != "vector":
            raise ValueError("Reporting selections require original vector sources")
        _text(area.get("name"), "a reporting area name", 200)
        if digest(area) in seen_areas:
            raise ValueError("Select each reporting polygon only once")
        seen_areas.add(digest(area))
        bound_areas.append({"selection": deepcopy(area), "entry": deepcopy(entry)})
    maps = raw.get("difference_maps", True)
    if not isinstance(maps, bool):
        raise ValueError("Choose whether complete output and difference maps are retained")
    selection = {"title": _text(raw.get("title"), "a study title", 300),
                 "purpose": _text(raw.get("purpose"), "the scientific forcing purpose"),
                 "baseline_run_id": run["id"], "cases": normalized,
                 "reporting_areas": deepcopy(areas), "difference_maps": maps}
    versions = comparison_versions([run], run_models(run))
    baseline = {"run_id": run["id"], "run_selection": deepcopy(run["selection"]),
                "artifacts": {k: deepcopy(run["artifacts"][k])
                              for k in required_outputs(run_models(run))},
                "grid": deepcopy(grid), "profile": deepcopy(profile),
                "scenario": deepcopy(scenario), "native_versions": versions,
                "landcover_artifact": deepcopy(run.get("stages", {}).get("landcover", {}).get("artifact"))}
    if scenario["kind"] == "landcover" and not baseline["landcover_artifact"]:
        raise ValueError("The original land-cover scenario lacks its retained native prepared raster")
    identity = {"schema": SCHEMA, "version": VERSION, "workspace_id": ws.project["id"],
                "selection": selection, "baseline": baseline,
                "sources": previews, "reporting_sources": bound_areas}
    canonical(identity)
    return identity, run


def preview(ws, selection):
    identity, run = _selection(ws, selection)
    return {"schema": SCHEMA, "id": digest(identity),
            "workspace_id": ws.project["id"], "selection": identity["selection"],
            "baseline": identity["baseline"], "case_count": 1 + len(identity["sources"]),
            "cases": identity["sources"], "models": list(run_models(run)),
            "pollutants": list(required_outputs(run_models(run))),
            "limitations": list(LIMITATIONS), "identity": identity}


def _check_grid(ws, base, other, overrides, *, verify=False):
    if digest(base["grid"]) != digest(other["grid"]):
        raise ValueError("Forcing comparisons require the exact original model lattice")
    for name in FIXED_FILES:
        if name not in base["files"]:
            if name in other["files"]:
                raise ValueError("The fixed input scope changed: " + name)
            continue
        if name not in other["files"] or _body(base["files"][name]) != _body(other["files"][name]):
            raise ValueError("Forcing preparation changed the fixed " + name)
        if verify:
            verify_file(ws.root / "grids" / base["id"], base["files"][name])
            verify_file(ws.root / "grids" / other["id"], other["files"][name])
    for name in ("PRECIPITATION", "R_FACTOR"):
        if name in base["files"] and name not in overrides:
            if _body(base["files"][name]) != _body(other["files"][name]):
                raise ValueError("An unselected forcing field changed: " + name)
    if float(base["spec"]["upstream_buffer_m"]) != float(other["spec"]["upstream_buffer_m"]):
        raise ValueError("Forcing preparation changed the model context buffer")


def _pair_field(first, second, *, geometry=None, mean=None, normalize=False):
    """Own-domain means first; common-valid comparisons second. No DEM masking."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    totals = {"baseline_count": 0, "case_count": 0, "common_count": 0,
              "baseline_sum": 0.0, "case_sum": 0.0,
              "baseline_minimum": None, "baseline_maximum": None,
              "case_minimum": None, "case_maximum": None}
    with rasterio.open(first) as a, rasterio.open(second) as b:
        rasters.check_same_grid(a, b)
        def values(window):
            aa, bb = a.read(1, window=window, masked=True), b.read(1, window=window, masked=True)
            av, bv = np.ma.getdata(aa).astype("float64"), np.ma.getdata(bb).astype("float64")
            inside = (np.ones(av.shape, dtype=bool) if geometry is None else
                      geometry_mask([geometry.__geo_interface__], out_shape=av.shape,
                                    transform=a.window_transform(window), invert=True, all_touched=False))
            if (np.any(~np.ma.getmaskarray(aa) & ~np.isfinite(av) & inside)
                    or np.any(~np.ma.getmaskarray(bb) & ~np.isfinite(bv) & inside)):
                raise ValueError("A forcing field contains nonfinite unmasked model-domain values")
            va = ~np.ma.getmaskarray(aa) & np.isfinite(av) & inside
            vb = ~np.ma.getmaskarray(bb) & np.isfinite(bv) & inside
            if np.any(av[va] < 0) or np.any(bv[vb] < 0):
                raise ValueError("Forcing inputs require nonnegative physical/proxy values")
            return av, bv, va, vb
        for _, window in a.block_windows(1):
            av, bv, va, vb = values(window)
            totals["common_count"] += int((va & vb).sum())
            for label, data, valid in (("baseline", av, va), ("case", bv, vb)):
                count = int(valid.sum())
                totals[label + "_count"] += count
                totals[label + "_sum"] += float(data[valid].sum(dtype="float64"))
                if count:
                    lo, hi = float(data[valid].min()), float(data[valid].max())
                    old = totals[label + "_minimum"]
                    totals[label + "_minimum"] = lo if old is None else min(old, lo)
                    old = totals[label + "_maximum"]
                    totals[label + "_maximum"] = hi if old is None else max(old, hi)
        for label in ("baseline", "case"):
            if not totals[label + "_count"]:
                raise ValueError("The forcing field has no valid model-domain support")
            totals[label + "_mean"] = totals[label + "_sum"] / totals[label + "_count"]
        if not totals["common_count"]:
            raise ValueError("Forcing fields have no common valid model-domain cells")
        da = float(mean) if mean is not None else totals["baseline_mean"]
        db = float(mean) if mean is not None else totals["case_mean"]
        if not all(math.isfinite(v) and v >= 0 for v in (da, db)):
            raise ValueError("The original runoff normalization denominator is invalid")
        max_raw, sum_raw, max_norm, sum_norm, changed = 0.0, 0.0, 0.0, 0.0, 0
        for _, window in a.block_windows(1):
            av, bv, va, vb = values(window)
            common = va & vb
            x, y = av[common], bv[common]
            if not x.size:
                continue
            delta = np.abs(y - x)
            max_raw = max(max_raw, float(delta.max()))
            sum_raw += float(delta.sum(dtype="float64"))
            if normalize:
                x = x / da if da else x
                y = y / db if db else y
            difference = np.abs(y - x)
            max_norm = max(max_norm, float(difference.max()))
            sum_norm += float(difference.sum(dtype="float64"))
            changed += int((~np.isclose(x, y, rtol=1e-6, atol=1e-7)).sum())
    return {**totals,
            "support_changed": totals["common_count"] != totals["baseline_count"] or
                               totals["common_count"] != totals["case_count"],
            "maximum_absolute_raw_change": max_raw,
            "mean_absolute_raw_change": sum_raw / totals["common_count"],
            "normalization": "fixed_original_profile_mean" if mean is not None else
                             "each_original_proxy_own_domain_mean" if normalize else "none",
            "baseline_denominator": da if normalize else None,
            "case_denominator": db if normalize else None,
            "maximum_absolute_compared_change": max_norm,
            "mean_absolute_compared_change": sum_norm / totals["common_count"],
            "changed_cells": changed, "pattern_equal_within_tolerance": changed == 0,
            "tolerance": {"relative": 1e-6, "absolute": 1e-7}}


def _forcing_diagnostics(ws, baseline, candidate, profile, overrides):
    domain = verify_file(ws.root / "grids" / baseline["id"], baseline["files"]["model_domain"])
    rows, crs = rasters.vector_geometry(domain)
    geometry = rasters.polygon_union(rows)
    output = {}
    for role in overrides:
        a = verify_file(ws.root / "grids" / baseline["id"], baseline["files"][role])
        b = verify_file(ws.root / "grids" / candidate["id"], candidate["files"][role])
        supplied = (profile.get("ndr") or {}).get("runoff_proxy_av") if role == "PRECIPITATION" else None
        supplied = float(supplied) if supplied else None
        result = _pair_field(a, b, geometry=geometry, mean=supplied, normalize=role == "PRECIPITATION")
        result.update(role=role, basis="Prepared aligned field on original model-domain pixel centres; native output indexes are reported separately.",
                      source_selection=deepcopy(overrides[role]),
                      baseline_file=deepcopy(baseline["files"][role]),
                      case_file=deepcopy(candidate["files"][role]))
        if result["support_changed"]:
            raise ValueError("Forcing source valid support changes within the model domain; prepare complete comparable source fields first")
        output[role] = result
    if all(value["pattern_equal_within_tolerance"] for value in output.values()):
        for value in output.values():
            value["no_effect_expected"] = True
            value["interpretation_warning"] = ("The actual retained forcing has no compared spatial-input change "
                "at the stated tolerance. Under automatic NDR normalization uniform scaling may cancel; "
                "retain the native zero-response result without attributing an invented climate effect.")
    return output


def prepare(ws, selection, expected_id=None):
    shown = preview(ws, selection)
    key, identity = shown["id"], shown["identity"]
    if expected_id is not None and expected_id != key:
        raise ValueError("The original forcing preview changed; review its current source edition")
    # Validate actual polygon/layer selections before preparing any new grid or
    # native case. Use the maintained area reader and original baseline CRS.
    from .parameter_studies import _areas
    import rasterio
    baseline = identity["baseline"]
    first_output = next(iter(baseline["artifacts"].values()))
    first_path = verify_file(ws.root / "runs" / baseline["run_id"], first_output)
    with rasterio.open(first_path) as source:
        _areas(ws, identity["selection"]["reporting_areas"], source.crs, baseline["grid"]["id"])
    directory = _directory(ws, key)
    with held(directory / ".study.lock", blocking=False):
        spec_path, state_path = directory / "selection.json", directory / "study.json"
        atomic_json(spec_path, identity, immutable=True)
        if state_path.exists():
            state = _read(ws, key)
        else:
            baseline = identity["baseline"]
            state = {"schema": SCHEMA, "id": key, "workspace_id": ws.project["id"],
                     "title": identity["selection"]["title"], "selection": identity["selection"],
                     "created_at": now(), "state": "preparing", "latest_report": None,
                     "cases": [{"id": "baseline", "label": "Original baseline", "baseline": True,
                                "grid_id": baseline["grid"]["id"], "run_id": baseline["run_id"],
                                "run_selection": baseline["run_selection"], "state": "complete",
                                "overrides": {}}]}
            atomic_json(state_path, state)
        try:
            for case, bound in zip(identity["selection"]["cases"], identity["sources"]):
                prior = next((x for x in state["cases"] if x["id"] == case["id"]), None)
                if prior is not None:
                    _check_case(ws, identity, prior)
                    continue
                source = forcing_sources.prepare_grid_sources(
                    ws, identity["baseline"]["grid"]["id"], case["overrides"],
                    expected_id=bound["source"]["id"])
                grid = ws.prepare_grid(source["spec"])
                _check_grid(ws, identity["baseline"]["grid"], grid, case["overrides"], verify=True)
                diagnostics = _forcing_diagnostics(
                    ws, identity["baseline"]["grid"], grid, identity["baseline"]["profile"], case["overrides"])
                run = ws.prepare_run({**identity["baseline"]["run_selection"], "grid_id": grid["id"]})
                row = {**deepcopy(case), "baseline": False, "grid_id": grid["id"],
                       "run_id": run["id"], "run_selection": deepcopy(run["selection"]),
                       "state": run["state"], "source_preview_id": bound["source"]["id"],
                       "source_collection_id": source["source_collection_id"],
                       "forcing_diagnostics": diagnostics}
                state["cases"].append(row)
                state.update(updated_at=now(), state="preparing")
                atomic_json(state_path, state)
            state.update(state="prepared", updated_at=now())
            state.pop("error", None)
            atomic_json(state_path, state)
        except Exception as error:
            state.update(state="preparation_failed", updated_at=now(), error=str(error))
            atomic_json(state_path, state)
            raise
    return get(ws, key)


def _read(ws, key):
    directory = _directory(ws, key)
    identity = read_json(directory / "selection.json")
    state = read_json(directory / "study.json")
    if (digest(identity) != key or identity.get("schema") != SCHEMA
            or identity.get("workspace_id") != ws.project["id"]
            or state.get("id") != key or state.get("schema") != SCHEMA
            or state.get("workspace_id") != ws.project["id"]
            or state.get("selection") != identity["selection"]):
        raise ValueError("The retained forcing study changed identity")
    return state


def _check_case(ws, identity, row, *, verify=False):
    run = ws.inspect_run(identifier(row["run_id"]))
    expected = {**identity["baseline"]["run_selection"], "grid_id": row["grid_id"]}
    if run["selection"] != expected or row["run_selection"] != expected:
        raise ValueError("A forcing case changed its original profile, scenario or model selection")
    grid = ws.get_grid(row["grid_id"])
    if row["id"] == "baseline":
        if (not row.get("baseline") or row["run_id"] != identity["baseline"]["run_id"]
                or grid["id"] != identity["baseline"]["grid"]["id"]
                or row["overrides"]):
            raise ValueError("The original baseline case changed identity")
        return run
    case = next((x for x in identity["selection"]["cases"] if x["id"] == row["id"]), None)
    source = next((x for x in identity["sources"] if x["case_id"] == row["id"]), None)
    if (case is None or source is None or row.get("baseline")
            or row["label"] != case["label"] or row["overrides"] != case["overrides"]
            or row.get("source_preview_id") != source["source"]["id"]):
        raise ValueError("The prepared forcing case changed source identity")
    selected = source["source"]
    collection = ws._get("sources", identifier(row["source_collection_id"]))
    if (collection.get("scope", {}).get("selection_id") != selected["id"]
            or collection["scope"].get("bindings") != selected["bindings"]):
        raise ValueError("The composed forcing collection changed its frozen selection")
    wanted = [*selected["bindings"]["inputs"].values(),
              selected["bindings"]["model_domain"], selected["bindings"]["reporting_area"]]
    entries = {entry["id"]: entry for entry in collection["entries"]}
    if len(entries) != len(collection["entries"]) or set(entries) != {item["prepared_source_id"] for item in wanted}:
        raise ValueError("The forcing collection changed its original input membership")
    for item in wanted:
        entry = entries[item["prepared_source_id"]]
        origin = {**item["selection"], "entry_sha256": item["entry_sha256"],
                  "original_manifest": item["original_manifest"]}
        if (entry.get("forcing_origin") != origin
                or forcing_sources._native_identity(entry) != forcing_sources._native_identity(item["entry"])):
            raise ValueError("A composed original input changed metadata, bytes or companions")
    expected_spec = deepcopy(selected["base_grid"]["spec"])
    expected_spec.update(source_collection_id=collection["id"], base_grid_id=selected["base_grid"]["id"],
                         input_sources={role: item["prepared_source_id"]
                                        for role, item in selected["bindings"]["inputs"].items()})
    for name in ("model_domain", "reporting_area"):
        expected_spec[name]["source_id"] = selected["bindings"][name]["prepared_source_id"]
    if grid["spec"] != expected_spec:
        raise ValueError("A forcing grid changed its complete frozen native preparation specification")
    for role, item in selected["bindings"]["inputs"].items():
        if grid["inputs"][role]["source_sha256"] != item["entry"]["body"]["sha256"]:
            raise ValueError("A prepared forcing input no longer matches its original source")
    _check_grid(ws, identity["baseline"]["grid"], grid, case["overrides"], verify=verify)
    return run


def get(ws, key):
    state = _read(ws, key)
    identity = read_json(_directory(ws, key) / "selection.json")
    rows, seen = [], set()
    for row in state["cases"]:
        if row["id"] in seen:
            raise ValueError("A forcing case is repeated")
        seen.add(row["id"])
        run = _check_case(ws, identity, row)
        rows.append({**deepcopy(row), "state": run["state"],
                     "stages": deepcopy(run.get("stages", {})),
                     "artifacts": deepcopy(run.get("artifacts", {}))})
    expected_order = ["baseline", *[case["id"] for case in identity["selection"]["cases"]]]
    if [case["id"] for case in rows] != expected_order[:len(rows)]:
        raise ValueError("The prepared forcing case order changed")
    total = len(expected_order)
    completed = sum(row["state"] == "complete" for row in rows)
    progress = {"total": total, "prepared": len(rows), "completed": completed,
                "failed": sum(row["state"] in ("failed", "interrupted") for row in rows)}
    display = "complete" if completed == total else state["state"]
    return {**state, "state": display, "cases": rows, "progress": progress,
            "models": list(run_models({"selection": identity["baseline"]["run_selection"]})),
            "limitations": list(LIMITATIONS)}


def _native_proxy(ws, baseline, candidate):
    def original(run, name):
        stage = run.get("stages", {}).get("ndr", {})
        item = stage.get("files", {}).get(name)
        if item is None:
            return None
        return verify_file(ws.root / "runs" / run["id"], item)
    fields = {}
    for name in ("masked_runoff_proxy", "runoff_proxy_index"):
        a, b = original(baseline, name), original(candidate, name)
        if a is None or b is None:
            fields[name] = {"available": False, "reason": "This original native registry did not retain that intermediate; no proxy diagnostic is invented."}
            continue
        fields[name] = {"available": True, **_pair_field(a, b),
                        "baseline_file": deepcopy(baseline["stages"]["ndr"]["files"][name]),
                        "case_file": deepcopy(candidate["stages"]["ndr"]["files"][name]),
                        "basis": "Actual retained native3.20 masked proxy/index; each original hash verified."}
    return fields


def _csv(rows):
    if not rows:
        return ""
    fields = list(dict.fromkeys(key for row in rows for key in row))
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        safe = {}
        for key in fields:
            value = row.get(key)
            if isinstance(value, (dict, list)):
                value = canonical(value).decode("utf-8")
            # Human-readable CSV: retain exact text in results.json.
            if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
                value = "'" + value
            safe[key] = value
        writer.writerow(safe)
    return output.getvalue()


def _html(result):
    esc = lambda value: html.escape(str(value if value is not None else "—"), quote=True)
    def number(value):
        return format(value, ".8g") if type(value) in (int, float) and math.isfinite(value) else "—"
    def table(columns, rows):
        return ("<div class='scroll'><table><thead><tr>" +
                "".join("<th>" + esc(title) + "</th>" for title in columns) +
                "</tr></thead><tbody>" + "".join(
                "<tr>" + "".join("<td>" + esc(value) + "</td>" for value in row) + "</tr>"
                for row in rows) + "</tbody></table></div>")
    names = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
             "sediment_export": "Sediment"}
    mass_rows = []
    for row in result["rows"]:
        units = row["units"].replace("metric_tonnes", "metric tonnes")
        change = number(row.get("change"))
        if type(row.get("change")) in (int, float) and row["change"] > 0:
            change = "+" + change
        mass_rows.append([row["case"], row["area"], names.get(row["pollutant"], row["pollutant"]),
                          units, number(row.get("baseline_mass")), number(row.get("case_mass")),
                          change, number(row.get("percent_change")), number(row.get("paired_area_ha"))])
    case_rows = []
    for case in result["cases"]:
        overrides = case.get("overrides") or {}
        if not overrides:
            case_rows.append([case["label"], "Retained baseline", "Original input periods",
                              "Original profile and scenario", case["state"]])
        for role, source in overrides.items():
            case_rows.append([case["label"], "Precipitation / runoff proxy" if role == "PRECIPITATION" else "Rainfall erosivity",
                              source.get("period_label"), source.get("temporal_basis"),
                              case["state"]])
    normal_rows = []
    for case_id, diagnostics in result.get("forcing_diagnostics", {}).items():
        for role, field in diagnostics.get("prepared_fields", {}).items():
            mode = {"fixed_original_profile_mean": "Fixed mean from original profile",
                    "each_original_proxy_own_domain_mean": "Each proxy's own domain mean",
                    "none": "No proxy normalization"}.get(field.get("normalization"), field.get("normalization"))
            normal_rows.append([case_id, "Precipitation / runoff proxy" if role == "PRECIPITATION" else "Rainfall erosivity",
                                mode, (field.get("baseline_file") or {}).get("units", "Recorded in snapshot"),
                                number(field.get("baseline_mean")), number(field.get("case_mean")),
                                number(field.get("baseline_denominator")), number(field.get("case_denominator")),
                                field.get("changed_cells"), field.get("common_count")])
    reuse_rows = []
    for case in result["cases"]:
        observed = result.get("native_reuse", {}).get(case["id"], {})
        for model, stage in observed.get("models", {}).items():
            donor = stage.get("source") or {}
            outcome = {"reused_original_stage": "Verified original stage reused",
                       "completed_without_reuse_record": "Completed; no stage-reuse record",
                       "not_complete": "Not complete"}.get(stage.get("outcome"), stage.get("outcome"))
            reuse_rows.append([case["label"], model.upper(), outcome,
                               donor.get("run_id", "—"), (stage.get("transfer") or {}).get("bytes", "—")])
    version_rows = []
    version_record = result.get("native_versions") or {}
    for model, version in (version_record.get("versions") or {}).items():
        version_rows.append([str(model).upper(), version])
    support_rows = [[row["case"], row["area"], names.get(row["pollutant"], row["pollutant"]),
                     row.get("baseline_valid_cells"), row.get("case_valid_cells"), row.get("paired_valid_cells"),
                     number(row.get("baseline_full_mass")), number(row.get("case_full_mass"))]
                    for row in result["rows"]]
    source_details = canonical({"selection": result["selection"], "cases": result["cases"],
                                "forcing_diagnostics": result["forcing_diagnostics"],
                                "native_versions": result["native_versions"],
                                "native_reuse": result.get("native_reuse", {})}).decode("utf-8")
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + esc(result["title"]) + "</title><style>"
            "body{font:15px/1.5 system-ui;color:#222;max-width:1200px;margin:2rem auto;padding:0 1rem}"
            "h1{font-size:26px}h2{font-size:20px;margin-top:28px}p{max-width:100ch}"
            "table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}"
            "td,th{padding:.6rem;border:1px solid #bbb;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
            "th{background:#eee}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f4f4f4;padding:12px}"
            ".summary{border:1px solid #999;padding:12px 16px;background:#f7f7f7}summary{cursor:pointer;font-weight:600}details{margin:18px 0}"
            "@media(max-width:650px){body{margin:1rem auto}td,th{padding:.45rem}}"
            "@media print{body{max-width:none;margin:0;font-size:11px}.scroll{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}details{display:block}}"
            "</style></head><body><header><h1>" + esc(result["title"]) + "</h1><p>" +
            esc(result["selection"]["purpose"]) + "</p></header><div class='summary'><strong>" +
            esc(result["completed_cases"]) + " of " + esc(result["total_cases"]) +
            " native cases complete</strong><p>These results compare modeled annual mass delivered to streams, using the same watershed configuration and explicitly selected forcing source editions.</p></div>"
            "<h2>Annual export on common finite support</h2><p>Positive change means greater export in the alternative case; negative change means less. Each row uses its stated common finite area. A dash for percentage means that the baseline or finite support cannot define a percentage.</p>" +
            table(["Case", "Reporting area", "Export", "Units", "Baseline mass", "Case mass",
                   "Change: case minus baseline", "Change (%)", "Common area (ha)"], mass_rows) +
            "<h2>Case periods and native progress</h2>" +
            table(["Case", "Changed input", "Period / edition", "Annual temporal basis", "Run state"], case_rows) +
            "<h2>Prepared-grid forcing checks (preflight)</h2><p>Input means and denominators are in the selected field's effective units. With automatic NDR normalization, the denominator comes from that proxy's valid model-domain cells. A fixed mean remains the original profile setting. Reporting-area averages do not set the native denominator.</p>" +
            table(["Case", "Input", "Normalization", "Effective input units", "Baseline field mean", "Case field mean",
                   "Baseline denominator", "Case denominator", "Changed compared cells", "Common input cells"], normal_rows) +
            "<p>The retained native masked-proxy and index diagnostics, where present, are available in the complete source detail and JSON.</p>"
            "<h2>Observed native stage reuse</h2><p>A requested baseline donor is only a candidate. The original native runner compares the actual model inputs, effective land cover and runtime before reuse; otherwise it computes that stage. Reused original outputs retain their donor and verified hashes. Logical transferred bytes are not a runtime-savings estimate.</p>" +
            table(["Case", "Model", "Observed outcome", "Original donor run", "Logical transferred bytes"], reuse_rows) +
            "<h2>Native model versions</h2>" + table(["Model", "Comparison version"], version_rows) +
            "<details><summary>Valid support and independent full-area totals</summary><p>The main results compare paired finite cells. These independent totals preserve the context when input or output coverage differs.</p>" +
            table(["Case", "Reporting area", "Export", "Baseline valid cells", "Case valid cells",
                   "Paired finite cells", "Baseline independent mass", "Case independent mass"], support_rows) + "</details>"
            "<h2>Scientific interpretation</h2><ul>" + "".join("<li>" + esc(x) + "</li>" for x in result["limitations"]) +
            "</ul><h2>Open the editable scientific result</h2><p>The accompanying <a href='results.csv'>results.csv</a> and <a href='results.json'>results.json</a> retain the complete scientific table. <a href='snapshot.json'>snapshot.json</a> retains the frozen publisher source metadata, baseline periods and source bindings. Difference rasters use alternative minus baseline. The original workspace retains the input source editions, model selections, native outputs and saved study.</p>"
            "<p>Open the complete application and workspace delivery to change source selections, run further native cases and regenerate a report. Existing completed cases and reports remain available.</p>"
            "<details><summary>Selected cases and normalization diagnostics</summary><pre>" + esc(source_details) +
            "</pre></details><footer><p>CSV protects formula-leading text; the companion JSON preserves the exact original text. Study " +
            esc(result["study_id"]) + " · Report " + esc(result["id"]) + "</p></footer></body></html>")


def _report_record(ws, directory, *, verify=True):
    record = read_json(directory / "record.json")
    if (record.get("schema") != REPORT_SCHEMA or record.get("workspace_id") != ws.project["id"]
            or record.get("id") != directory.name or digest(record["identity"]) != record["id"]
            or record.get("study_id") != directory.parent.parent.name
            or record.get("directory") != directory.relative_to(ws.root).as_posix()):
        raise ValueError("The retained forcing report changed identity")
    if record["identity"]["study_identity"] != read_json(directory.parent.parent / "selection.json"):
        raise ValueError("The report belongs to another frozen study edition")
    pair = record["source"]
    collection = ws._get("sources", identifier(pair["source_collection_id"]))
    if (pair["source_id"] != "climate-forcing-report"
            or collection.get("scope", {}).get("study_id") != record["study_id"]
            or collection["scope"].get("report_id") != record["id"]):
        raise ValueError("The retained report source belongs to another scientific selection")
    entries = [entry for entry in collection["entries"] if entry["id"] == pair["source_id"]]
    if len(entries) != 1:
        raise ValueError("The saved report source has no unique original primary")
    entry = entries[0]
    if (entry.get("kind") != "document" or entry.get("role") != "CLIMATE_FORCING_STUDY"
            or entry.get("source") != {"study_id": record["study_id"], "report_id": record["id"]}):
        raise ValueError("The original report source changed its role or identity")
    manifest = record["files"].get("sources.json")
    if manifest is None or _body(collection["original_manifest"]) != _body(manifest):
        raise ValueError("The report lost its complete original source manifest")
    original_members = [entry["body"], *entry.get("companions", [])]
    expected_members = [record["files"]["report.html"],
                        *[item for name, item in record["files"].items()
                          if name not in ("report.html", "sources.json")]]
    # JSON files mappings are canonicalized, but the declared companion list
    # retains its original construction order. Compare complete keyed membership
    # while validating uniqueness, so duplicate-content distinct members survive.
    def signature(item, source=False):
        return (item["source_path"] if source else item["path"], item["bytes"], item["sha256"])
    actual = [signature(item, True) for item in original_members]
    expected = [signature(item) for item in expected_members]
    if (len({item[0] for item in actual}) != len(actual)
            or len({item[0] for item in expected}) != len(expected)
            or sorted(actual) != sorted(expected)
            or signature(entry["body"], True) != signature(record["files"]["report.html"])):
        raise ValueError("The report files differ from its complete original source membership")
    if verify:
        for item in record["files"].values():
            verify_file(directory, item)
        ws.source_file(pair["source_collection_id"], pair["source_id"])
        original_source = read_json(directory / "sources.json")
        primary = next((item for item in original_source["entries"] if item["id"] == pair["source_id"]), None)
        if (primary is None
                or [item["path"] for item in primary["companions"]]
                != [item["source_path"] for item in entry["companions"]]):
            raise ValueError("The original report companion order changed")
        if read_json(directory / "snapshot.json") != record["identity"]:
            raise ValueError("The forcing report snapshot changed")
        result = read_json(directory / "results.json")
        if any(record.get(key) != value for key, value in result.items()):
            raise ValueError("The forcing report differs from its retained results")
    return record


def _publish_report(ws, key, record):
    with held(_directory(ws, key) / ".study.lock", blocking=False):
        current = _read(ws, key)
        current["latest_report"] = {
            "id": record["id"], "directory": record["directory"],
            "files": record["files"], "source": record["source"]}
        atomic_json(_directory(ws, key) / "study.json", current)
    return record


def get_report(ws, study_id, report_id=None, verify=True):
    """Read a saved report; never aggregate, export or change the saved selection."""
    state = _read(ws, identifier(study_id))
    if report_id is None:
        latest = state.get("latest_report")
        if not latest:
            raise ValueError("This study has no saved native comparison report")
        report_id = latest["id"]
    directory = _directory(ws, study_id) / "reports" / identifier(report_id)
    return _report_record(ws, directory, verify=verify)


def verify_all(ws):
    """Validate every retained study and immutable report after native restore."""
    studies, reports = [], []
    for path in sorted((ws.root / ROOT).glob("*/study.json")):
        key = identifier(path.parent.name)
        studies.append(get(ws, key)["id"])
        for saved in sorted((path.parent / "reports").glob("*/record.json")):
            reports.append(get_report(ws, key, identifier(saved.parent.name))["id"])
    return {"schema": "upstate.climate-forcing-verification/v1",
            "workspace_id": ws.project["id"], "studies": studies, "reports": reports}


def report(ws, key):
    from .parameter_studies import _areas, _paired
    from . import parameter_studies
    from .parameter_pair_cache import PairResults
    state = get(ws, key)
    study_dir = _directory(ws, key)
    identity = read_json(study_dir / "selection.json")
    completed = [case for case in state["cases"] if case["state"] == "complete"]
    if not completed or completed[0]["id"] != "baseline" or len(completed) < 2:
        raise ValueError("Complete the original baseline and at least one prepared forcing case")
    runs = {case["run_id"]: ws.inspect_run(case["run_id"]) for case in completed}
    baseline = runs[completed[0]["run_id"]]
    if (baseline["selection"] != identity["baseline"]["run_selection"]
            or {k: baseline["artifacts"][k] for k in required_outputs(run_models(baseline))}
            != identity["baseline"]["artifacts"]):
        raise ValueError("The original baseline output edition changed")
    active, outputs = run_models(baseline), required_outputs(run_models(baseline))
    versions = comparison_versions(list(runs.values()), active)
    for case in completed:
        _check_case(ws, identity, case, verify=True)
    for run in runs.values():
        if run_models(run) != active:
            raise ValueError("A forcing case changed the selected native output scope")
    landcover_binding = {}
    if identity["baseline"]["scenario"]["kind"] == "landcover":
        expected_lulc = identity["baseline"]["landcover_artifact"]
        for run in runs.values():
            actual_lulc = run.get("stages", {}).get("landcover", {}).get("artifact")
            if actual_lulc is None or _body(actual_lulc) != _body(expected_lulc):
                raise ValueError("Forcing-only comparisons require the same actual native prepared land cover")
            verify_file(ws.root / "runs" / run["id"], actual_lulc)
            landcover_binding[run["id"]] = deepcopy(actual_lulc)
    for source in identity["reporting_sources"]:
        entry, _ = forcing_sources._retained_entry(ws, source["selection"]["source_collection_id"],
                                                   source["selection"]["source_id"])
        if entry != source["entry"]:
            raise ValueError("The original reporting source edition changed")
    context = {"schema": REPORT_SCHEMA, "version": VERSION, "study_id": key,
               "workspace_id": ws.project["id"], "study_identity": identity,
               "runs": deepcopy(runs), "native_versions": versions,
               "case_snapshot": deepcopy(state["cases"]), "progress": deepcopy(state["progress"]),
               "landcover_binding": landcover_binding,
               "implementation": {"forcing_sha256": file_digest(Path(__file__)),
                                  "paired_sha256": file_digest(Path(parameter_studies.__file__))}}
    report_id = digest(context)
    directory = study_dir / "reports" / report_id
    with held(directory / ".report.lock", blocking=False):
        if (directory / "record.json").is_file():
            return _publish_report(ws, key, _report_record(ws, directory))
        atomic_json(directory / "snapshot.json", context, immutable=True)
        base_paths = {name: verify_file(ws.root / "runs" / baseline["id"], baseline["artifacts"][name])
                      for name in outputs}
        import rasterio
        with rasterio.open(base_paths[outputs[0]]) as source:
            areas = _areas(ws, state["selection"]["reporting_areas"], source.crs, baseline["selection"]["grid_id"])
        cache = PairResults(directory, workspace_id=ws.project["id"], experiment_id=key,
                            engine_path=Path(__file__), areas=areas,
                            total_pairs=(len(completed) - 1) * len(outputs))
        rows, diagnostics, maps = [], {}, {}
        copied = {}
        def copy_run(case, name):
            member = "native-outputs/" + case["id"] + "/" + name + ".tif"
            descriptor = copy_verified(ws.root / "runs" / case["run_id"],
                                       runs[case["run_id"]]["artifacts"][name], directory, path=member)
            copied[member] = descriptor
        for case in completed:
            if state["selection"]["difference_maps"]:
                for name in outputs:
                    copy_run(case, name)
            for model, stage in runs[case["run_id"]].get("stages", {}).items():
                if model in active and stage.get("arguments"):
                    member = "native-arguments/" + case["id"] + "/" + model + ".json"
                    copied[member] = copy_verified(ws.root / "runs" / case["run_id"], stage["arguments"], directory, path=member)
            if case["id"] == "baseline":
                continue
            run = runs[case["run_id"]]
            diagnostics[case["id"]] = {"prepared_fields": case.get("forcing_diagnostics", {})}
            if "ndr" in active:
                diagnostics[case["id"]]["native_ndr"] = _native_proxy(ws, baseline, run)
            for name in outputs:
                path = verify_file(ws.root / "runs" / run["id"], run["artifacts"][name])
                values = cache.evaluate(
                    case_id=case["id"], run_id=run["id"], pollutant=name,
                    baseline=baseline["artifacts"][name], alternative=run["artifacts"][name],
                    calculate=lambda checkpoint, p=path, n=name: _paired(base_paths[n], p, areas, pollutant=n, checkpoint=checkpoint))
                for area in areas:
                    rows.append({"case_id": case["id"], "case": case["label"], "run_id": run["id"],
                                 "grid_id": case["grid_id"], "area_id": area["id"], "area": area["name"],
                                 "pollutant": name, "units": rasters.MASS_UNITS[name].replace("/pixel", ""),
                                 **values[area["id"]]})
                if state["selection"]["difference_maps"]:
                    member = "differences/" + case["id"] + "/" + name + ".tif"
                    target = directory / member
                    target.parent.mkdir(parents=True, exist_ok=True)
                    retained = target.with_suffix(".json")
                    map_identity = {"baseline": baseline["artifacts"][name], "case": run["artifacts"][name],
                                    "direction": "alternative minus baseline"}
                    if retained.exists():
                        old = read_json(retained)
                        if old["identity"] != map_identity:
                            raise ValueError("A retained forcing difference changed input edition")
                        verify_file(directory, old["file"])
                    else:
                        summary = rasters.difference(base_paths[name], path, target)
                        atomic_json(retained, {"identity": map_identity, "summary": summary,
                                              "file": describe_file(directory, target, units=rasters.MASS_UNITS[name])}, immutable=True)
                    maps[member] = read_json(retained)
                    copied[member] = maps[member]["file"]
                    sidecar = describe_file(directory, retained)
                    copied[sidecar["path"]] = sidecar
        aggregation = cache.finish()
        result = {"schema": REPORT_SCHEMA, "id": report_id, "study_id": key,
                  "workspace_id": ws.project["id"], "title": state["title"],
                  "selection": state["selection"], "cases": [{k: deepcopy(v) for k, v in case.items()
                                                              if k not in ("stages", "artifacts")}
                                                             for case in state["cases"]],
                  "completed_cases": len(completed), "total_cases": state["progress"]["total"],
                  "rows": rows, "areas": [{k: v for k, v in a.items() if k != "geometry"} for a in areas],
                  "forcing_diagnostics": diagnostics, "native_versions": versions,
                  "landcover_binding": landcover_binding,
                  "native_reuse": {case["id"]: _native_reuse(runs[case["run_id"]]) for case in completed},
                  "aggregation": aggregation, "difference_maps": maps, "limitations": list(LIMITATIONS),
                  "comparison_basis": "Alternative minus original baseline on common finite retained annual-mass pixels.",
                  "mean_basis": "Native own valid full model-domain proxy support; reporting-mask totals never define NDR normalization."}
        if (directory / "results.json").exists():
            retained_result = read_json(directory / "results.json")
            stable = lambda value: {k: v for k, v in value.items() if k != "aggregation"}
            if stable(retained_result) != stable(result):
                raise ValueError("A retained partial report changed its scientific result")
            result = retained_result
        atomic_json(directory / "results.json", result, immutable=True)
        atomic_bytes(directory / "results.csv", _csv(rows).encode("utf-8"), immutable=True)
        atomic_bytes(directory / "report.html", _html(result).encode("utf-8"), immutable=True)
        base_grid = identity["baseline"]["grid"]
        copied["reporting-area.gpkg"] = copy_verified(ws.root / "grids" / base_grid["id"],
            base_grid["files"]["reporting_area"], directory, path="reporting-area.gpkg")
        members = {name: describe_file(directory, directory / name)
                   for name in ("snapshot.json", "results.json", "results.csv", "report.html")}
        members.update(copied)
        context_path = directory / result["aggregation"]["context"]
        members[context_path.relative_to(directory).as_posix()] = describe_file(directory, context_path)
        for path in sorted(context_path.parent.glob("*.json")):
            if path.name.endswith(".partial.json"):
                continue
            members[path.relative_to(directory).as_posix()] = describe_file(directory, path)
        atomic_json(directory / "MANIFEST.json", {"schema": "upstate.climate-forcing-files/v1",
                    "report_id": report_id, "workspace_id": ws.project["id"], "files": members}, immutable=True)
        members["MANIFEST.json"] = describe_file(directory, directory / "MANIFEST.json")
        archive = directory / "climate-forcing-results.zip"
        if not archive.exists():
            temporary = directory / ".archive-candidate.zip"
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as output:
                for name, member in sorted(members.items()):
                    verified = verify_file(directory, member)
                    stamp = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                    stamp.compress_type = zipfile.ZIP_DEFLATED
                    with verified.open("rb") as source, output.open(stamp, "w", force_zip64=True) as target:
                        import shutil
                        shutil.copyfileobj(source, target, 1024 * 1024)
            temporary.replace(archive)
        with zipfile.ZipFile(archive) as retained_zip:
            names = retained_zip.namelist()
            if len(names) != len(set(names)) or set(names) != set(members):
                raise ValueError("The retained forcing archive changed its complete membership")
            for name, member in members.items():
                fingerprint, size = hashlib.sha256(), 0
                with retained_zip.open(name) as body:
                    for block in iter(lambda: body.read(1024 * 1024), b""):
                        fingerprint.update(block)
                        size += len(block)
                if size != member["bytes"] or fingerprint.hexdigest() != member["sha256"]:
                    raise ValueError("The retained forcing archive changed an original member")
        members["climate-forcing-results.zip"] = describe_file(directory, archive)
        uri = "workspace:" + ws.project["id"] + "/" + ROOT + "/" + key + "/reports/" + report_id
        source_id = "climate-forcing-report"
        entries = [{"id": source_id, "title": state["title"], "kind": "document",
                    "path": "report.html", "sha256": members["report.html"]["sha256"],
                    "uri": uri, "vintage": state["created_at"],
                    "role": "CLIMATE_FORCING_STUDY", "source": {"study_id": key, "report_id": report_id},
                    "companions": [deepcopy(v) for k, v in members.items() if k != "report.html"]},
                   {"id": "climate-forcing-values", "title": state["title"] + " — exact native comparison",
                    "kind": "table", "path": "results.csv", "sha256": members["results.csv"]["sha256"],
                    "uri": uri, "vintage": state["created_at"], "units": None,
                    "quantities_note": "N/P kg/year; sediment metric tonnes/year; areas hectares; see explicit columns.",
                    "companions": [members["results.json"], members["snapshot.json"]]},
                   {"id": "climate-forcing-reporting-area", "title": "Original unchanged reporting area",
                    "kind": "vector", "path": "reporting-area.gpkg",
                    "sha256": members["reporting-area.gpkg"]["sha256"],
                    "uri": uri, "vintage": state["created_at"], "layer": "reporting_area"}]
        for name, member in copied.items():
            if name.endswith(".tif"):
                entries.append({"id": "climate-map-" + digest(name)[:20], "title": name,
                                "kind": "raster", "path": member["path"], "sha256": member["sha256"],
                                "uri": uri, "vintage": state["created_at"],
                                "units": member.get("units"), "role": "CLIMATE_FORCING_OUTPUT",
                                "source": {"study_id": key, "report_id": report_id, "member": name}})
        atomic_json(directory / "sources.json", {"schema": "upstate.sources/v1",
                    "title": state["title"], "entries": entries, "captured_at": state["created_at"],
                    "scope": {"study_id": key, "report_id": report_id,
                              "models": list(active), "completed_run_ids": list(runs)}}, immutable=True)
        collection = ws.import_sources(directory / "sources.json")
        members["sources.json"] = describe_file(directory, directory / "sources.json")
        record = {**result, "identity": context, "files": members,
                  "directory": directory.relative_to(ws.root).as_posix(),
                  "source": {"source_collection_id": collection["id"], "source_id": source_id}}
        atomic_json(directory / "record.json", record, immutable=True)
        return _publish_report(ws, key, _report_record(ws, directory))


def native_case_context(ws, study_id, case_id):
    """Bind an ordinary native request to one original forcing case and donor.

    This is a read-only eligibility request. The original native input matcher
    remains responsible for each actual model-stage reuse decision, including
    effective land cover, runtime, native flags and every selected input.
    """
    state = get(ws, identifier(study_id))
    case = next((row for row in state["cases"] if row["id"] == case_id), None)
    if case is None or case.get("baseline") or case_id == "baseline":
        raise ValueError("Select a prepared alternative forcing case, preserving the completed baseline")
    identity = read_json(_directory(ws, study_id) / "selection.json")
    donor = ws.inspect_run(identity["baseline"]["run_id"])
    validate_completed_run(donor)
    if donor["state"] != "complete" or donor["selection"] != identity["baseline"]["run_selection"]:
        raise ValueError("The original completed forcing baseline changed selection")
    active = run_models(donor)
    artifacts = {name: deepcopy(donor["artifacts"][name]) for name in required_outputs(active)}
    if artifacts != identity["baseline"]["artifacts"]:
        raise ValueError("The original forcing donor changed its captured annual mass edition")
    versions = comparison_versions([donor], active)
    if versions != identity["baseline"]["native_versions"]:
        raise ValueError("The original forcing donor changed native model provenance")
    stages = {}
    for model in active:
        stage = donor.get("stages", {}).get(model)
        if not isinstance(stage, dict) or not stage.get("completed_at") or not stage.get("files"):
            raise ValueError("The original forcing donor lost a completed native stage")
        stages[model] = digest(stage)
    if identity["baseline"]["scenario"]["kind"] == "landcover":
        actual = donor.get("stages", {}).get("landcover", {}).get("artifact")
        expected = identity["baseline"]["landcover_artifact"]
        if actual is None or _body(actual) != _body(expected):
            raise ValueError("The original forcing donor changed its effective native land cover")
    roles = sorted(case["overrides"])
    unchanged = [model for model in active
                 if (model == "ndr" and "PRECIPITATION" not in roles)
                 or (model == "sdr" and "R_FACTOR" not in roles)]
    return {"schema": "upstate.climate-forcing-native-case/v1",
            "workspace_id": ws.project["id"], "study_id": state["id"], "case_id": case_id,
            "run_id": case["run_id"], "run_selection": deepcopy(case["run_selection"]),
            "baseline_run_id": donor["id"], "baseline_selection": deepcopy(donor["selection"]),
            "baseline_stages": stages, "baseline_artifacts": artifacts,
            "source_preview_id": case["source_preview_id"],
            "forcing_roles": roles, "expected_unchanged_models": unchanged}


def run_request(ws, study_id, case_id):
    """Return the complete payload for the original run.start action."""
    context = native_case_context(ws, study_id, case_id)
    if context["run_id"] == context["baseline_run_id"]:
        raise ValueError("A forcing alternative cannot execute its original baseline")
    return {"run_id": context["run_id"],
            "reuse_source_run_ids": [context["baseline_run_id"]],
            "climate_forcing_context": context}


def _native_reuse(run):
    """Describe observed original stages without claiming a requested reuse."""
    observed = {}
    for model in run_models(run):
        stage = run.get("stages", {}).get(model)
        if stage is None:
            observed[model] = {"outcome": "not_complete"}
            continue
        original = stage.get("reused_from")
        observed[model] = {
            "outcome": "reused_original_stage" if original else "completed_without_reuse_record",
            "completed_at": stage.get("completed_at"),
            "started_at": stage.get("started_at"),
            "reuse_started_at": stage.get("reuse_started_at"),
            "reused_at": stage.get("reused_at"),
            "source": deepcopy(original),
            "input_signature": deepcopy(stage.get("input_signature")),
            "arguments": deepcopy(stage.get("arguments")),
            "requested_arguments": deepcopy(stage.get("requested_arguments")),
            "runtime": deepcopy(stage.get("runtime") or run.get("runtime")),
            "transfer": deepcopy(stage.get("transfer")),
            "reuse_lookup": deepcopy(stage.get("reuse_lookup")),
        }
    return {"run_id": run["id"],
            "requested_source_run_ids": deepcopy(run.get("reuse_source_run_ids", [])),
            "models": observed,
            "rejected_candidates": deepcopy(run.get("reuse_observations", {})),
            "interpretation": "Requested donors are candidates only. Original native input/runtime "
                              "matching decides each stage; all retained output bodies are verified."}


def run_case(ws, key, case_id):
    """CLI continuation of one existing prepared native run; no alternate engine."""
    payload = run_request(ws, key, case_id)
    return ws.run(payload["run_id"], reuse_source_run_ids=payload["reuse_source_run_ids"])


def verify(ws, key):
    """Reopen the original study/report from the same or restored Workspace."""
    state = get(ws, key)
    if state.get("latest_report"):
        record = get_report(ws, key)
        if record["study_id"] != key:
            raise ValueError("The latest report belongs to another forcing study")
    return state
