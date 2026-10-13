"""Paired land-cover robustness on the maintained native experiment engines.

Parameter studies supply the original profile design. Experiments execute every
landscape under each profile. Scenario decisions supply one common valid support
across all completed matched cohorts on each grid. No numerical solver lives here.
"""
from __future__ import annotations
import copy
import csv
import html
import io
import math
import os
from pathlib import Path
import socket
import sys
from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, selected_models, verify_file)

SCHEMA = "upstate.paired-robustness-selection/v1"
STATE_SCHEMA = "upstate.paired-robustness/v1"
METHOD = "paired-robustness/1"
GUIDES = [
 "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
 "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html",
]
REVIEW_FIELDS = ("id", "schema", "table_summary", "approved", "approved_at",
 "approved_by", "approval", "approvals", "scientific_approval", "scientific_signoff",
 "review_status", "calibration_results", "calibration_status")

def _number(value, name, *, zero=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(name + " must be a finite number")
    if not math.isfinite(value) or value < 0 or (value == 0 and not zero):
        raise ValueError(name + " is outside its physical range")
    return float(value)

def normalize(ws, value):
    allowed = {"schema", "title", "purpose", "baseline_run_id", "scenario_ids",
               "axes", "threshold_factors", "spatial_variants", "zones", "source_binding"}
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError("Use only declared paired robustness selection fields")
    if value.get("schema", SCHEMA) != SCHEMA:
        raise ValueError("Select " + SCHEMA)
    result = copy.deepcopy(value)
    result["schema"] = SCHEMA
    for name in ("title", "purpose"):
        text = result.get(name)
        if not isinstance(text, str) or not text.strip() or "\x00" in text:
            raise ValueError("Provide the scientific " + name)
        result[name] = text.strip()
    baseline = ws.inspect_run(identifier(result["baseline_run_id"]))
    if baseline["state"] != "complete":
        raise ValueError("Complete the actual original baseline before preparing this continuation")
    selection = baseline["selection"]
    reference = ws._get("scenarios", selection["scenario_id"])
    if reference["kind"] != "baseline":
        raise ValueError("The paired reference must be the retained baseline landscape")
    ids = result.get("scenario_ids")
    if not isinstance(ids, list) or not ids or len(set(ids)) != len(ids):
        raise ValueError("Select distinct actual land-cover scenarios")
    for key in ids:
        scenario = ws._get("scenarios", identifier(key))
        if scenario["kind"] != "landcover":
            raise ValueError("Each selected alternative must be an actual land-cover scenario")
        ws.prepare_run({**selection, "scenario_id": key})
    axes = result.get("axes", [])
    if not isinstance(axes, list):
        raise ValueError("Parameter axes must use the maintained parameter-study selection")
    result["axes"] = axes
    factors = result.get("threshold_factors", [0.5, 2.0])
    if not isinstance(factors, list):
        raise ValueError("threshold_factors must be an explicit numeric list")
    checked_factors = [_number(v, "Stream-initiation area factor") for v in factors]
    result["threshold_factors"] = list(dict.fromkeys(v for v in checked_factors if v != 1))
    variants = result.get("spatial_variants", [])
    if not isinstance(variants, list):
        raise ValueError("Spatial variants must be explicit resolution/buffer selections")
    normalized = []
    for row in variants:
        if not isinstance(row, dict) or set(row) - {"name", "resolution_m", "upstream_buffer_m"}:
            raise ValueError("Each grid variant accepts name, resolution_m and upstream_buffer_m")
        if not isinstance(row.get("name"), str) or not row["name"].strip():
            raise ValueError("Name each requested grid variant")
        item = {"name": row["name"].strip()}
        for name in ("resolution_m", "upstream_buffer_m"):
            if name in row:
                item[name] = _number(row[name], name, zero=name == "upstream_buffer_m")
        if len(item) == 1:
            raise ValueError("A spatial variant needs a changed resolution or domain buffer")
        normalized.append(item)
    if len({v["name"] for v in normalized}) != len(normalized) or any(v["name"] == "Original grid" for v in normalized):
        raise ValueError("Use distinct spatial variant names")
    result["spatial_variants"] = normalized
    result.setdefault("zones", [])
    # Validate original zone and native-study contracts through the existing reader.
    from . import scenario_decisions
    scenario_decisions.selection({"schema": scenario_decisions.SELECTION_SCHEMA,
        "title": result["title"], "run_ids": [baseline["id"]], "zones": result["zones"]})
    result.setdefault("source_binding", {})
    return result, baseline

def _directory(ws, key):
    return ws.root / "paired-robustness" / identifier(key)

def _software():
    root = Path(__file__).resolve().parent.parent
    names = ["model/paired_robustness.py", "model/experiments.py",
             "model/parameter_studies.py", "model/scenario_decisions.py",
             "model/native.py", "model/workspace.py", "model/rasters.py", "model/reuse.py"]
    return [describe_file(root, root / name) for name in names]

def prepare(ws, selection):
    selection, baseline = normalize(ws, selection)
    identity = {"schema": STATE_SCHEMA, "method": METHOD, "workspace_id": ws.project["id"],
                "selection": selection, "baseline_selection": baseline["selection"]}
    key = digest(identity)
    directory = _directory(ws, key)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".operation.lock", blocking=False):
        atomic_json(directory / "selection.json", identity, immutable=True)
        source = _software()
        atomic_json(directory / "software" / (digest(source) + ".json"), source, immutable=True)
        if not (directory / "state.json").exists():
            atomic_json(directory / "state.json", {
                **identity, "id": key, "state": "prepared", "created_at": now(),
                "families": [{"name": "Original grid", "variant": {}, "state": "pending"}] +
                    [{"name": v["name"], "variant": v, "state": "pending"}
                     for v in selection["spatial_variants"]], "files": {}})
    return inspect(ws, key)

def inspect(ws, key):
    directory = _directory(ws, key)
    identity = read_json(directory / "selection.json")
    if digest(identity) != key or identity["workspace_id"] != ws.project["id"]:
        raise ValueError("The retained robustness selection belongs to another project")
    state = read_json(directory / "state.json")
    if state["id"] != key or any(state.get(k) != v for k, v in identity.items()):
        raise ValueError("The robustness checkpoint differs from its immutable selection")
    for item in state.get("files", {}).values():
        verify_file(directory, item)
    return state

def _save(directory, state, **updates):
    state.update(updates, updated_at=now(), worker={
        "hostname": socket.gethostname(), "pid": os.getpid(), "python": sys.executable})
    atomic_json(directory / "state.json", state)

def _profile(ws, base, grid, original_grid, *, factor=1.0):
    original_area = _number(original_grid["grid"]["pixel_area_ha"], "Original pixel area")
    current_area = _number(grid["grid"]["pixel_area_ha"], "Current pixel area")
    ratio = original_area / current_area * factor
    if math.isclose(ratio, 1.0, rel_tol=1e-12, abs_tol=0):
        return base
    changed = copy.deepcopy(base)
    for name in REVIEW_FIELDS:
        changed.pop(name, None)
    changed.update(title=base["title"] + " / physical stream area x" + str(factor)
                   + " on " + grid["id"][:12],
                   status="working", scientific_status="working")
    binding = []
    for model in selected_models(base):
        old = _number(base[model]["threshold_flow_accumulation"], model + " threshold")
        threshold = old * ratio
        changed[model]["threshold_flow_accumulation"] = threshold
        binding.append({"model": model, "original_threshold_pixels": old,
                        "original_pixel_area_ha": original_area,
                        "selected_initiation_area_ha": old * original_area * factor,
                        "current_pixel_area_ha": current_area,
                        "threshold_flow_accumulation": threshold,
                        "threshold_units": "upstream pixels"})
    changed["robustness_derivation"] = {"method": METHOD, "original_profile_id": base["id"],
        "grid_id": grid["id"], "factor": factor, "thresholds": binding,
        "references": GUIDES}
    with held(ws.root / ".workspace.lock", blocking=False):
        return ws.save_profile(changed)

def _resolution_sources(ws, directory, original_grid, resolution):
    """Retain a derived categorical reference through the original alignment API.

    grid_definition requires the reference raster to already have the requested
    lattice. Derive only that reference, keeping all physical inputs original.
    """
    import rasterio
    from pyproj import CRS
    from . import rasters
    from .reuse import copy_verified
    collection_id = original_grid["spec"]["source_collection_id"]
    source_id = original_grid["spec"]["input_sources"]["NLCD"]
    reference, entry = ws.source_file(collection_id, source_id)
    with rasterio.open(reference) as source:
        transform = source.transform
        crs = CRS.from_user_input(source.crs)
        if (not crs.is_projected or len(crs.axis_info) < 2
                or any(not math.isclose(a.unit_conversion_factor, 1.0, rel_tol=0, abs_tol=1e-12)
                       for a in crs.axis_info[:2])):
            raise ValueError("Resolution experiments require the original projected metre CRS")
        if (source.count != 1 or transform.b or transform.d
                or not all(math.isfinite(v) for v in list(transform)[:6])
                or transform.a <= 0 or transform.e >= 0
                or not math.isclose(transform.a, -transform.e, rel_tol=1e-9, abs_tol=1e-12)):
            raise ValueError("Retain the original single-band, square, north-up reference")
        if math.isclose(transform.a, resolution, rel_tol=1e-9, abs_tol=1e-12):
            return collection_id, None
        # Retain the original upper-left anchor and cover its full source extent.
        target_grid = {"crs": crs.to_wkt(), "crs_name": crs.to_string(),
            "transform": [resolution, 0.0, transform.c, 0.0, -resolution, transform.f],
            "width": math.ceil(source.width * transform.a / resolution),
            "height": math.ceil(source.height * -transform.e / resolution),
            "resolution_m": resolution, "pixel_area_ha": resolution * resolution / 10000,
            "reference_alignment": "Requested categorical lattice at original reference upper-left origin"}
        original_lattice = {"transform": list(transform)[:6], "width": source.width,
                            "height": source.height, "crs": crs.to_wkt(),
                            "nodata": source.nodata, "dtype": source.dtypes[0]}
    source_identity = {"collection_id": collection_id, "source_id": source_id,
                       "body": entry["body"], "companions": entry["companions"]}
    identity = {"schema": "upstate.paired-resolution-source/v1", "method": METHOD,
        "original_grid_id": original_grid["id"], "source": source_identity,
        "source_lattice": original_lattice, "target_lattice": target_grid,
        "resampling": "nearest", "align_source_sha256": file_digest(Path(rasters.__file__)),
        "rasterio_version": rasterio.__version__, "gdal_version": rasterio.__gdal_version__,
        "proj_version": getattr(rasterio, "__proj_version__", None)}
    key = digest(identity)
    package = directory / "references" / key
    receipt_path = package / "reference.json"
    with held(ws.root / ".workspace.lock", blocking=False):
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt["identity"] != identity:
                raise ValueError("Derived reference differs from its original source/lattice")
            for descriptor in receipt["files"]:
                verify_file(package, descriptor)
            collection = ws._get("sources", receipt["source_collection_id"])
            primary, selected = ws.source_file(collection["id"], source_id)
            if selected["body"]["sha256"] != receipt["derived_source"]["sha256"]:
                raise ValueError("The imported categorical reference changed")
            return collection["id"], receipt
        atomic_json(package / "selection.json", identity, immutable=True)
        target = package / "reference" / "lulc.tif"
        alignment = rasters.align_source(
            reference, target, target_grid, categorical=True, resampling="nearest",
            checkpoint_directory=package / ".alignment", source_identity=source_identity)
        derived = describe_file(package, target, units="class")
        derivation = {**identity, "derived_source": derived, "alignment": alignment,
            "interpretation": "Nearest-neighbor categorical selection on a declared numerical grid. "
                "Original classes are retained; class areas/patch footprints can change with cell centres. "
                "Continuous model inputs are aligned from their original sources by Workspace.prepare_grid."}
        atomic_json(package / "derivation.json", derivation)
        original_collection = ws._get("sources", collection_id)
        required_ids = {v for v in original_grid["spec"]["input_sources"].values()
                        if isinstance(v, str) and v}
        required_ids.update(original_grid["spec"][role]["source_id"]
                            for role in ("reporting_area", "model_domain"))
        available = {row["id"]: row for row in original_collection["entries"]}
        missing = required_ids - set(available)
        if missing:
            raise ValueError("Original grid sources are absent: " + ", ".join(sorted(missing)))
        entries, retained_files = [], [describe_file(package, package / "selection.json"),
                                      describe_file(package, package / "derivation.json"), derived]
        for sid in sorted(required_ids):
            original = available[sid]
            paths = []
            for body in [original["body"]] + original["companions"]:
                view = body.get("view_path", body["filename"])
                native_path = Path(view)
                if native_path.is_absolute() or ".." in native_path.parts or "\\" in view or "\x00" in view:
                    raise ValueError("Retain portable native source-sidecar paths")
                relative = (Path("originals") / digest(sid) / native_path).as_posix()
                descriptor = {"path": body["object"], "bytes": body["bytes"], "sha256": body["sha256"]}
                copied = copy_verified(ws.root, descriptor, package, path=relative)
                retained_files.append(copied)
                paths.append({"path": relative, "sha256": body["sha256"]})
            row = {k: copy.deepcopy(v) for k, v in original.items() if k not in ("body", "companions")}
            row["metadata"] = {**(row.get("metadata") or {}),
                "original_source_collection_id": collection_id, "original_source_id": sid}
            if sid == source_id:
                # A derived TIFF has its own dimensions, nodata and class encoding.
                # Keep the exact source declaration in provenance, not as stale output metadata.
                original_declaration = copy.deepcopy(row)
                row = {"id": sid, "kind": "raster", "path": "reference/lulc.tif",
                    "sha256": derived["sha256"],
                    "title": original["title"] + " / declared " + str(resolution) + " m nearest grid",
                    "uri": "urn:upstate:paired-resolution:" + key, "vintage": original["vintage"],
                    "units": "class", "resampling": "nearest", "source_crs": target_grid["crs"],
                    "companions": paths + [{"path": "selection.json",
                        "sha256": file_digest(package / "selection.json")},
                        {"path": "derivation.json", "sha256": file_digest(package / "derivation.json")}],
                    "metadata": {"original_source_collection_id": collection_id,
                        "original_source_id": sid, "original_source_declaration": original_declaration,
                        "original_uri": original["uri"], "derivation_id": key,
                        "original_lattice": original_lattice, "target_lattice": target_grid,
                        "dtype": "int32", "nodata": -2147483648}}
                if "role" in original:
                    row["role"] = original["role"]
            else:
                row.update(path=paths[0]["path"], sha256=paths[0]["sha256"], companions=paths[1:])
            entries.append(row)
        manifest = {"schema": "upstate.sources/v1",
            "title": "Declared " + str(resolution) + " m reference from original Gura sources",
            "captured_at": original_collection.get("captured_at"),
            "scope": {"original_source_collection_id": collection_id, "derivation_id": key,
                      "original_grid_id": original_grid["id"], "requested_resolution_m": resolution},
            "notes": ["Original upper-left anchor and projected metre CRS retained.",
                      "Only the categorical reference is derived; other native input/source bodies and sidecars are exact originals."],
            "entries": entries}
        atomic_json(package / "sources.json", manifest)
        retained_files.append(describe_file(package, package / "sources.json"))
        collection = ws.import_sources(package / "sources.json")
        receipt = {"identity": identity, "source_collection_id": collection["id"],
                   "derived_source": derived, "files": retained_files}
        atomic_json(receipt_path, receipt, immutable=True)
        return collection["id"], receipt

def _baseline(ws, reference, grid, profile, *, execute):
    run = ws.prepare_run({**reference["selection"], "grid_id": grid["id"],
                          "profile_id": profile["id"]})
    if run["state"] != "complete":
        if not execute:
            return run
        with held(ws.root / ".native-model-batch.lock", blocking=False):
            ws.run(run["id"], reuse_source_run_ids=[reference["id"]])
        run = ws.inspect_run(run["id"])
    if execute and run["state"] != "complete":
        raise ValueError("The selected grid reference has not completed: " + run["id"])
    return run

def _design(ws, selection, baseline):
    from . import parameter_studies
    if not selection["axes"]:
        return None, [baseline["selection"]["profile_id"]]
    study = parameter_studies.prepare(ws, {
        "title": selection["title"] + " / native parameter design",
        "purpose": selection["purpose"], "baseline_run_id": baseline["id"],
        "design": "factorial", "axes": selection["axes"],
        "reporting_areas": [], "difference_maps": False})
    return study["id"], list(dict.fromkeys(c["profile_id"] for c in study["cases"]))

def _cohorts(ws, summary, required_scenarios):
    groups = {}
    for case in summary["rows"]:
        if case["state"] != "complete":
            continue
        run = ws.inspect_run(case["run_id"])
        if run["state"] != "complete":
            continue
        actual = run["selection"]
        if any(actual[k] != case[k] for k in ("profile_id", "scenario_id")):
            raise ValueError("Completed native case does not match its saved profile/scenario")
        groups.setdefault(case["profile_id"], {})[case["scenario_id"]] = run["id"]
    complete, incomplete = {}, {}
    for profile, rows in groups.items():
        missing = [sid for sid in required_scenarios if sid not in rows]
        if missing:
            incomplete[profile] = missing
        else:
            complete[profile] = {sid: rows[sid] for sid in required_scenarios}
    return complete, incomplete

def paired_rows(report, cohorts, baseline_scenario, alternatives):
    """Use original common masses, pairing within profiles instead of global baseline."""
    output = []
    run_details = {row["id"]: row for row in report["runs"]}
    for zone in report["zones"]:
        for pollutant, values in zone["pollutants"].items():
            coverage = values["coverage"]
            valid = coverage["common_valid_cells"] > 0
            for profile_id, runs in cohorts.items():
                base_id = runs[baseline_scenario]
                base = values["runs"][base_id]["common_mass"]
                for sid in alternatives:
                    run_id = runs[sid]
                    alt = values["runs"][run_id]["common_mass"]
                    benefit = base - alt if valid else None
                    pct = (100 * benefit / base if valid and base != 0 else None)
                    output.append({
                        "grid_id": report["grid_id"], "decision_report_id": report["id"],
                        "zone_id": zone["id"], "zone_title": zone["title"],
                        "pollutant": pollutant, "units": report["outputs"][pollutant]["units"],
                        "profile_id": profile_id, "profile_title": run_details[base_id]["profile_title"],
                        "scenario_id": sid, "scenario_title": run_details[run_id]["scenario_title"],
                        "baseline_run_id": base_id, "alternative_run_id": run_id,
                        "baseline_common_mass": base if valid else None,
                        "alternative_common_mass": alt if valid else None,
                        "avoided_export_mass": benefit, "avoided_export_percent": pct,
                        "direction": ("no_common_support" if not valid else
                                      "lower_export" if benefit > 0 else
                                      "higher_export" if benefit < 0 else "unchanged"),
                        "common_valid_cells": coverage["common_valid_cells"],
                        "common_valid_area_ha": coverage["common_valid_area_ha"],
                        "common_valid_fraction": coverage["common_valid_fraction"],
                        "selected_cells": coverage["selected_cells"],
                        "unresolved_common_cells": coverage["unresolved_common_cells"],
                        "support_id": digest({"report_id": report["id"], "zone": zone["id"],
                                              "pollutant": pollutant}),
                    })
    return output

def interpretation(rows):
    """Finite evaluated-profile envelopes, separate for every grid/common support."""
    groups = {}
    for row in rows:
        key = tuple(row[k] for k in ("grid_id", "zone_id", "pollutant", "support_id"))
        groups.setdefault(key, []).append(row)
    results = []
    for key, items in groups.items():
        scenario_ids = list(dict.fromkeys(r["scenario_id"] for r in items))
        profiles = list(dict.fromkeys(r["profile_id"] for r in items))
        ranges, wins, ties = {}, {sid: 0 for sid in scenario_ids}, 0
        for sid in scenario_ids:
            values = [r["avoided_export_mass"] for r in items
                      if r["scenario_id"] == sid and r["avoided_export_mass"] is not None]
            ranges[sid] = {"scenario_title": next(r["scenario_title"] for r in items if r["scenario_id"] == sid),
                          "evaluated_profiles": len(values),
                          "minimum_avoided_export": min(values) if values else None,
                          "maximum_avoided_export": max(values) if values else None,
                          "lower_export_cases": sum(v > 0 for v in values),
                          "higher_export_cases": sum(v < 0 for v in values),
                          "unchanged_cases": sum(v == 0 for v in values)}
        for pid in profiles:
            values = {r["scenario_id"]: r["avoided_export_mass"] for r in items
                      if r["profile_id"] == pid}
            if set(values) != set(scenario_ids) or any(v is None for v in values.values()):
                continue
            best = max(values.values())
            leaders = [sid for sid, v in values.items() if math.isclose(
                v, best, rel_tol=1e-12, abs_tol=1e-12)]
            if len(leaders) > 1:
                ties += 1
            else:
                wins[leaders[0]] += 1
        results.append({"grid_id": key[0], "zone_id": key[1], "pollutant": key[2],
            "support_id": key[3], "units": items[0]["units"], "profiles": len(profiles),
            "scenario_ranges": ranges, "strict_best_counts": wins, "tied_best_profiles": ties,
            "common_valid_area_ha": items[0]["common_valid_area_ha"],
            "common_valid_fraction": items[0]["common_valid_fraction"],
            "interpretation": "Counts over the explicitly evaluated finite profile set; no probability weights. "
                "Mass envelopes share one support across every retained profile and alternative on this grid. "
                "Different grids remain separate. Positive avoided export means lower modeled stream export."})
    return results

def _publish(directory, state):
    rows = []
    for family in state["families"]:
        if family.get("paired_file"):
            rows.extend(read_json(verify_file(directory, family["paired_file"]))["rows"])
    report = {"schema": "upstate.paired-robustness-report/v1", "id": state["id"],
              "state": state["state"], "selection": state["selection"], "families": state["families"],
              "generated_at": now(), "rows": rows, "interpretation": interpretation(rows),
              "notes": [
                  "Every avoided export pairs a baseline and alternative with identical profile and grid.",
                  "Common support includes every completed matched cohort used by this grid report.",
                  "Partial results retain expected/missing profile cohorts and native failures.",
                  "Across grids inspect sign/rank stability and coverage separately; never pool absolute masses.",
                  "Domain changes retain the profile's original runoff normalization choice. If automatic, "
                  "the native mean changes with the valid domain; these are total domain sensitivities.",
                  "Class changes are explicitly authored counterfactuals, not demonstrated intervention effects.",
                  "No observed calibration, costs or scientific approval is inferred from these experiments."]}
    generation = directory / "generations" / digest(report)
    atomic_json(generation / "report.json", report, immutable=True)
    csv_text = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(csv_text, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    atomic_bytes(generation / "paired-benefits.csv", csv_text.getvalue().encode("utf-8"), immutable=True)
    esc = lambda value: html.escape(str(value))
    sections = []
    for item in report["interpretation"]:
        table = "".join("<tr><td>" + esc(value["scenario_title"]) + "<br><small>" + esc(sid) + "</small></td><td>" +
                        esc(value["minimum_avoided_export"]) + "</td><td>" +
                        esc(value["maximum_avoided_export"]) + "</td><td>" +
                        esc(item["strict_best_counts"][sid]) + "</td></tr>"
                        for sid, value in item["scenario_ranges"].items())
        sections.append("<section><h2>" + esc(item["zone_id"] + " / " + item["pollutant"]) +
            "</h2><p>Grid " + esc(item["grid_id"]) + "; shared valid area " +
            esc(item["common_valid_area_ha"]) + " ha; units " + esc(item["units"]) +
            ".</p><table><thead><tr><th>Scenario</th><th>Minimum avoided export</th>"
            "<th>Maximum avoided export</th><th>Strict best profiles</th></tr></thead><tbody>" +
            table + "</tbody></table><p>" + esc(item["interpretation"]) + "</p></section>")
    page = "<!doctype html><meta charset=utf-8><title>Paired robustness</title><style>" + (
        "body{font:15px system-ui;max-width:1100px;margin:32px auto;color:#222;padding:0 20px}"
        "table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left}"
        "td{overflow-wrap:anywhere}section{margin:24px 0}h1{font-size:25px}") + "</style><h1>" + (
        esc(state["selection"]["title"]) + "</h1><p>" + esc(state["selection"]["purpose"]) +
        "</p><p>State: " + esc(state["state"]) + "</p><p><a href=report.json>Complete source-bound report</a> · "
        "<a href=paired-benefits.csv>Paired benefits CSV</a></p>" + "".join(sections) +
        "<h2>Interpretation</h2><ul>" + "".join("<li>" + esc(x) + "</li>" for x in report["notes"]) +
        "</ul><h2>Actual cases and pending work</h2><pre>" +
        esc(__import__("json").dumps(state["families"], indent=2)) + "</pre>")
    atomic_bytes(generation / "index.html", page.encode("utf-8"), immutable=True)
    state["files"] = {name: describe_file(directory, generation / path) for name, path in (
        ("json", "report.json"), ("csv", "paired-benefits.csv"), ("html", "index.html"))}
    _save(directory, state)
    # This convenience alias is never trusted for recovery; state.files pins a complete generation.
    relative = state["files"]["html"]["path"]
    atomic_bytes(directory / "index.html", (
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' +
        html.escape(relative, quote=True) + '"><a href="' + html.escape(relative, quote=True) +
        '">Open the retained robustness report</a>').encode("utf-8"))

def execute(ws, key, *, completed_only=False, progress=None):
    from . import experiments, scenario_decisions
    directory = _directory(ws, key)
    with held(directory / ".operation.lock", blocking=False):
        state = inspect(ws, key)
        selection, reference = normalize(ws, state["selection"])
        original_grid = ws.get_grid(reference["selection"]["grid_id"])
        original_profile = ws._get("profiles", reference["selection"]["profile_id"])
        source = _software()
        atomic_json(directory / "software" / (digest(source) + ".json"), source, immutable=True)
        state.pop("error", None)
        _save(directory, state, state="running")
        try:
            for family in state["families"]:
                if progress:
                    progress({"id": key, "family": family["name"], "state": "starting"})
                variant = family["variant"]
                spec = copy.deepcopy(original_grid["spec"])
                spec.update({k: v for k, v in variant.items() if k != "name"})
                if "resolution_m" in variant:
                    derived_collection, source_receipt = _resolution_sources(
                        ws, directory, original_grid, variant["resolution_m"])
                    spec["source_collection_id"] = derived_collection
                    family["resolution_source"] = source_receipt
                grid = original_grid if not variant else ws.prepare_grid(spec)
                profile = _profile(ws, original_profile, grid, original_grid)
                family.update(grid_id=grid["id"], profile_id=profile["id"], grid_spec=grid["spec"],
                              pixel_area_ha=grid["grid"]["pixel_area_ha"],
                              runoff_normalization=profile.get("ndr", {}).get("runoff_proxy_av", "native domain mean"))
                baseline = _baseline(ws, reference, grid, profile, execute=not completed_only)
                family["baseline_run_id"] = baseline["id"]
                if baseline["state"] != "complete":
                    family.update(state="pending", pending_reason="Complete this grid's native baseline")
                    _save(directory, state)
                    continue
                study_id, profile_ids = _design(ws, selection, baseline)
                family["parameter_study_id"] = study_id
                threshold_profiles = [
                    _profile(ws, original_profile, grid, original_grid, factor=f)["id"]
                    for f in selection["threshold_factors"]]
                profile_ids = list(dict.fromkeys(profile_ids + threshold_profiles))
                experiment = experiments.prepare(ws, {
                    "title": selection["title"] + " / " + family["name"],
                    "reason": selection["purpose"], "baseline_run_id": baseline["id"],
                    "scenario_ids": selection["scenario_ids"],
                    "profile_ids": [p for p in profile_ids if p != profile["id"]],
                    "design": "factorial", "axes": []})
                family.update(experiment_id=experiment["id"], profile_ids=profile_ids,
                              expected_profiles=len(profile_ids), state="running")
                _save(directory, state)
                current = experiments.execute(ws, experiment["id"], completed_only=completed_only)
                summary = experiments.read_summary(ws, experiment["id"])
                if summary is None:
                    summary = experiments.summarize(ws, experiment["id"])
                required = [baseline["selection"]["scenario_id"]] + selection["scenario_ids"]
                cohorts, missing = _cohorts(ws, summary, required)
                for pid in profile_ids:
                    if pid not in cohorts and pid not in missing:
                        missing[pid] = required
                family.update(progress=current["progress"], completed_profiles=len(cohorts),
                              missing_cohorts=missing,
                              failed_cases=[{"run_id": r["run_id"], "error": r.get("error")}
                                            for r in summary["rows"] if r["state"] == "failed"])
                if cohorts:
                    all_runs = list(dict.fromkeys(rid for group in cohorts.values() for rid in group.values()))
                    anchor = all_runs[0]
                    decision_selection = scenario_decisions.select_cohort(
                        ws, anchor, alternative_run_ids=all_runs[1:],
                        title=selection["title"] + " / common support / " + family["name"],
                        zones=selection["zones"], delivery_mode="native_study",
                        native_study={"title": selection["title"], "purpose": selection["purpose"]})
                    built = scenario_decisions.build(ws, decision_selection, progress=progress)
                    report = scenario_decisions.inspect(ws, built["id"])["report"]
                    rows = paired_rows(report, cohorts, required[0], required[1:])
                    member = "paired/" + digest({"grid": grid["id"], "decision": built["id"]}) + ".json"
                    atomic_json(directory / member, {"report_id": built["id"], "rows": rows}, immutable=True)
                    family.update(decision_report_id=built["id"],
                                  paired_file=describe_file(directory, directory / member))
                family["state"] = "complete" if not missing else "partial"
                _save(directory, state)
                _publish(directory, state)
            state["state"] = "complete" if all(f["state"] == "complete" for f in state["families"]) else "partial"
            _publish(directory, state)
            return state
        except Exception as exc:
            state.update(state="failed", error={"type": type(exc).__name__, "message": str(exc)})
            # Preserve the actual native/storage error if even its receipt cannot be written.
            try:
                _save(directory, state)
                _publish(directory, state)
            except Exception:
                pass
            raise
