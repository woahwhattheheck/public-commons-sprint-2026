"""Continue the original Gura intake through native class contrasts and reports.

The observed-class plan explores the response to substituting original source
classes inside the original watershed. Class names and coefficients come from
the retained input tables. The operation preserves the original model grid,
profile, baseline, native engine, and source-file identities.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from decimal import Decimal, InvalidOperation
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys

from model.common import (atomic_bytes, atomic_json, describe_file,
                          digest, file_digest, held, now, read_json, verify_file)
from model.workspace import Workspace

RECEIVING_SCHEMA = "upstate.gura-original-receiving/v1"
CATALOG_SCHEMA = "upstate.gura-class-catalog/v1"
PLAN_SCHEMA = "upstate.gura-class-contrasts/v1"
RESULT_SCHEMA = "upstate.gura-comparison-continuation/v1"
PURPOSE = (
    "Source-class counterfactual exploration on the original Gura watershed. "
    "Each alternative changes explicitly named original land-cover classes "
    "while retaining the baseline profile, native grid and routing parameters. "
    "The model evaluates the resulting nutrient and sediment exports."
)
SOURCE_IDS = ("GURA_NDR_TABLE", "GURA_SDR_TABLE", "GURA_BIOPHYSICAL")
LABEL_FIELDS = ("description", "lulc_description", "landcover_description",
                "land_use_description", "name", "lulc_name", "landcover",
                "land_use", "lulc", "class_name")


def _integer(value, label):
    if isinstance(value, bool):
        raise ValueError(label + " must be an original integer class code")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation as error:
        raise ValueError(label + " must be an original integer class code") from error
    if not number.is_finite() or number != number.to_integral_value():
        raise ValueError(label + " must be an original integer class code")
    return int(number)


def _context(receiving_path):
    path = Path(receiving_path).resolve(strict=True)
    receipt = read_json(path)
    if receipt.get("schema") != RECEIVING_SCHEMA:
        raise ValueError("Select the original receive_gura.py receiving.json")
    ws = Workspace(receipt["workspace"])
    if ws.project["title"] != receipt["study"] or "Gura" not in receipt["study"]:
        raise ValueError("Continue the original Gura study in its retained workspace")
    collection = ws._get("sources", receipt["source_collection_id"])
    if collection["original_manifest"]["sha256"] != receipt["source_manifest_sha256"]:
        raise ValueError("The original Gura source collection differs from receiving.json")
    grid = ws.get_grid(receipt["grid_id"])
    profile = ws._get("profiles", receipt["profile_id"])
    baseline = ws._get("scenarios", receipt["scenario_id"])
    if (baseline.get("kind") != "baseline"
            or baseline.get("patches")
            or profile["source_collection_id"] != collection["id"]
            or baseline["source_collection_id"] != collection["id"]
            or grid["spec"]["source_collection_id"] != collection["id"]):
        raise ValueError("Retain the original Gura baseline, coefficient profile and grid sources")
    expected_resolution = receipt.get("native_grid", {}).get("resolution_m")
    if (expected_resolution is None
            or not math.isclose(float(grid["grid"]["resolution_m"]),
                                float(expected_resolution), rel_tol=1e-9, abs_tol=1e-8)):
        raise ValueError("The comparison must use the actual native grid retained by Gura receiving")
    return path, receipt, ws, collection, grid, profile, baseline


def _table(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as incoming:
        reader = csv.DictReader(incoming)
        columns = list(reader.fieldnames or [])
        if "lucode" not in columns:
            raise ValueError("The original source table lacks lucode")
        rows = {}
        for row in reader:
            code = _integer(row["lucode"], "Original lucode")
            if code in rows:
                raise ValueError("Original source table repeats lucode " + str(code))
            rows[code] = dict(row)
    if not rows:
        raise ValueError("The original source table is empty")
    return columns, rows


def _source_label(code, row_sets):
    labels = []
    for source_id, rows in row_sets.items():
        row = rows.get(code, {})
        names = {name.casefold(): name for name in row}
        for candidate in LABEL_FIELDS:
            actual = names.get(candidate)
            value = str(row.get(actual, "")).strip() if actual else ""
            if value and value != str(code):
                labels.append({"source_id": source_id, "field": actual, "value": value})
                break
    distinct = list(dict.fromkeys(item["value"] for item in labels))
    return (" / ".join(distinct) if distinct else "Native class " + str(code)), labels


def _zone_source(ws, collection_id, requested_field=None):
    import fiona
    from model import rasters
    path, entry = ws.source_file(collection_id, "GURA_WATERSHED")
    kwargs = {"layer": entry["layer"]} if entry.get("layer") else {}
    with rasters.vector_environment(), fiona.open(rasters.native_vector_path(path), **kwargs) as layer:
        fields = list(layer.schema["properties"])
        features = [{"native_fid": feature.id, "properties": dict(feature["properties"])}
                    for feature in layer]
    if not features:
        raise ValueError("The retained original Gura watershed contains no features")
    candidates = ([requested_field] if requested_field else
                  [name for preferred in ("ws_id", "watershed_id", "id", "fid", "objectid")
                   for name in fields if name.casefold() == preferred]
                  + sorted(fields))
    chosen = None
    for field in dict.fromkeys(candidates):
        if field not in fields:
            continue
        values = [feature["properties"].get(field) for feature in features]
        if all(value is not None and str(value).strip() for value in values):
            identifiers = [str(value) for value in values]
            if len(identifiers) == len(set(identifiers)):
                chosen = field
                break
    if chosen is None:
        raise ValueError("Select an original unique, non-null watershed property with --zone-id-field; available fields: "
                         + ", ".join(fields))
    for feature in features:
        feature["feature_id"] = str(feature["properties"][chosen])
    return {"source_collection_id": collection_id, "source_id": "GURA_WATERSHED",
            "source": entry, "id_field": chosen, "features": features,
            "layer": entry.get("layer")}


def catalog(receiving_path, *, zone_id_field=None):
    path, receipt, ws, collection, grid, profile, baseline = _context(receiving_path)
    table_sources, row_sets, columns = {}, {}, {}
    for source_id in SOURCE_IDS:
        source_path, entry = ws.source_file(collection["id"], source_id)
        fields, rows = _table(source_path)
        table_sources[source_id] = {"entry": entry, "sha256": file_digest(source_path)}
        row_sets[source_id], columns[source_id] = rows, fields
    allowed = set(profile["table_summary"]["lucodes"])
    if set(row_sets["GURA_BIOPHYSICAL"]) != allowed:
        raise ValueError("Original profile lucodes differ from its retained coefficient table")
    if table_sources["GURA_BIOPHYSICAL"]["sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("The original profile coefficient table changed")
    from model import rasters
    import numpy as np
    import rasterio
    grid_root = ws.root / "grids" / grid["id"]
    landcover = verify_file(grid_root, grid["files"]["NLCD"])
    reporting_mask = verify_file(grid_root, grid["files"]["reporting_mask"])
    counts = Counter()
    selected_cells, valid_cells = 0, 0
    with rasterio.open(landcover) as src, rasterio.open(reporting_mask) as mask:
        rasters.check_same_grid(src, mask)
        transform = src.transform
        pixel_area_ha = abs(transform.a * transform.e - transform.b * transform.d) / 10000
        if not math.isfinite(pixel_area_ha) or pixel_area_ha <= 0:
            raise ValueError("Original Gura cells need a positive native area")
        for _, window in src.block_windows(1):
            values = src.read(1, window=window, masked=True)
            selected = mask.read(1, window=window) == 1
            selected_cells += int(selected.sum())
            raw = np.ma.getdata(values)
            valid = selected & ~np.ma.getmaskarray(values) & np.isfinite(raw)
            cells = raw[valid]
            if np.any(cells != np.rint(cells)):
                raise ValueError("The retained Gura land-cover raster contains non-integer source codes")
            ids, amounts = np.unique(cells.astype("int64"), return_counts=True)
            for code, amount in zip(ids, amounts):
                counts[int(code)] += int(amount)
            valid_cells += int(valid.sum())
    if set(counts) - allowed:
        raise ValueError("Observed native source classes are absent from the original profile")
    classes = []
    for code in sorted(allowed):
        label, labels = _source_label(code, row_sets)
        classes.append({"code": code, "label": label, "original_labels": labels,
                        "reporting_cells": counts[code], "reporting_area_ha": counts[code] * pixel_area_ha,
                        "original_rows": {key: rows[code] for key, rows in row_sets.items() if code in rows}})
    source_zones = _zone_source(ws, collection["id"], zone_id_field)
    original_selection = read_json(Path(receipt["selection_path"]))
    result = {
        "schema": CATALOG_SCHEMA, "study": receipt["study"], "purpose": PURPOSE,
        "workspace_id": ws.project["id"], "receiving": describe_file(path.parent, path),
        "original_programme_id": receipt["programme_id"],
        "source_reference": original_selection.get("source_reference"),
        "source_collection_id": collection["id"], "grid_id": grid["id"],
        "profile_id": profile["id"], "baseline_scenario_id": baseline["id"],
        "native_grid": grid["grid"], "pixel_area_ha": pixel_area_ha,
        "source_tables": table_sources, "columns": columns,
        "classes": classes, "watershed_source": source_zones,
        "reporting_support": {"selection": "original reporting-mask pixel centres",
                              "selected_cells": selected_cells, "valid_landcover_cells": valid_cells,
                              "valid_landcover_area_ha": valid_cells * pixel_area_ha,
                              "landcover": grid["files"]["NLCD"], "mask": grid["files"]["reporting_mask"]},
    }
    result["id"] = digest(result)
    return result


def make_plan(receiving_path, *, conversions=None, zone_id_field=None):
    inventory = catalog(receiving_path, zone_id_field=zone_id_field)
    classes = {row["code"]: row for row in inventory["classes"]}
    observed = [row for row in inventory["classes"] if row["reporting_cells"] > 0]
    if not observed:
        raise ValueError("The original Gura reporting mask has no observed land-cover cells")
    dominant = sorted(observed, key=lambda row: (-row["reporting_cells"], row["code"]))[0]
    if conversions is None:
        other = sorted((row for row in observed if row["code"] != dominant["code"]),
                       key=lambda row: (-row["reporting_cells"], row["code"]))
        pairs = [(row["code"], dominant["code"]) for row in other]
        pairs += [(dominant["code"], row["code"]) for row in other]
        strategy = {
            "kind": "observed-class-contrasts",
            "dominant_class": dominant["code"],
            "rule": "The class with the largest original reporting-mask cell count is paired in both directions with every other observed class. Each conversion is a separate modeled scenario.",
            "tie_rule": "For equal cell counts, the smaller original class code is selected.",
        }
    else:
        pairs = [(_integer(left, "Source class"), _integer(right, "Target class"))
                 for left, right in conversions]
        strategy = {"kind": "explicit-source-class-substitutions",
                    "rule": "Each declared original class pair is one separate native scenario."}
    if not pairs:
        raise ValueError("Select at least one distinct original source-class substitution")
    cases, seen = [], set()
    for left, right in pairs:
        if (left, right) in seen:
            raise ValueError("A native class substitution was selected twice")
        seen.add((left, right))
        if left == right or left not in classes or right not in classes:
            raise ValueError("Each substitution needs two distinct original profile class codes")
        if classes[left]["reporting_cells"] <= 0:
            raise ValueError("The selected source class has no cells in the original Gura reporting area: " + str(left))
        before, after = classes[left], classes[right]
        label = str(left) + " " + before["label"] + " to " + str(right) + " " + after["label"]
        reason = ("Original-source class contrast: replace retained class " + str(left)
                  + " (" + before["label"] + ") with original table class " + str(right)
                  + " (" + after["label"] + ") within the original Gura watershed. "
                    "The numeric class pair defines the counterfactual; coefficients remain from the original profile.")
        case = {
            "key": "class-" + str(left) + "-to-" + str(right),
            "title": inventory["study"] + " | source-class contrast | " + label,
            "reason": reason,
            "source_class": before, "target_class": after,
            "planned_source_cells": before["reporting_cells"],
            "planned_source_area_ha": before["reporting_area_ha"],
            "scenario": {
                "title": inventory["study"] + " | source-class contrast | " + label,
                "reason": reason, "kind": "landcover",
                "source_collection_id": inventory["source_collection_id"],
                "patches": [{"mask_source_id": "GURA_WATERSHED",
                             "from_codes": [left], "to_code": right, "reason": reason}],
            },
        }
        cases.append(case)
    source_zones = inventory["watershed_source"]
    zone = {"id": "gura-watershed", "title": inventory["study"] + ": original watershed",
            "source_collection_id": source_zones["source_collection_id"],
            "source_id": source_zones["source_id"], "id_field": source_zones["id_field"],
            "feature_ids": [feature["feature_id"] for feature in source_zones["features"]],
            "scope": "whole"}
    if source_zones["layer"]:
        zone["layer"] = source_zones["layer"]
    plan = {
        "schema": PLAN_SCHEMA, "study": inventory["study"], "purpose": PURPOSE,
        "title": inventory["study"] + " | native source-class counterfactual comparison",
        "receiving": inventory["receiving"], "workspace_id": inventory["workspace_id"],
        "original_programme_id": inventory["original_programme_id"],
        "source_reference": inventory["source_reference"],
        "source_collection_id": inventory["source_collection_id"],
        "grid_id": inventory["grid_id"], "profile_id": inventory["profile_id"],
        "baseline_scenario_id": inventory["baseline_scenario_id"],
        "inventory": inventory, "strategy": strategy, "cases": cases, "zones": [zone],
        "economics": {"costs": [], "notes": [
            "Original Gura source-class counterfactual exploration.",
            "Cost estimates can be entered for a defined scenario and implementation footprint in the economic desk.",
        ]},
    }
    plan["id"] = digest(plan)
    return plan


def _check_plan(receiving_path, plan_path):
    plan_path = Path(plan_path).resolve(strict=True)
    plan = read_json(plan_path)
    if plan.get("schema") != PLAN_SCHEMA:
        raise ValueError("Select a retained Gura class-contrast plan")
    identity = dict(plan)
    key = identity.pop("id", None)
    if key != digest(identity):
        raise ValueError("The retained contrast plan changed; create its next explicit source selection")
    path, receipt, ws, collection, grid, profile, baseline = _context(receiving_path)
    expected = {
        "workspace_id": ws.project["id"], "source_collection_id": collection["id"],
        "grid_id": grid["id"], "profile_id": profile["id"],
        "baseline_scenario_id": baseline["id"], "original_programme_id": receipt["programme_id"],
    }
    if any(plan.get(name) != value for name, value in expected.items()):
        raise ValueError("The contrast plan belongs to another original Gura selection")
    if (plan["receiving"]["sha256"] != file_digest(path)
            or plan["receiving"]["bytes"] != path.stat().st_size):
        raise ValueError("The contrast plan names a different original receiving record")
    inv = plan["inventory"]
    inv_identity = dict(inv)
    inv_id = inv_identity.pop("id", None)
    if inv_id != digest(inv_identity):
        raise ValueError("The retained class/source inventory changed")
    fresh = catalog(receiving_path, zone_id_field=inv["watershed_source"]["id_field"])
    if fresh["id"] != inv_id:
        raise ValueError("Original class/source input changed after the contrast plan")
    cases = plan.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("The native programme needs actual land-cover alternatives")
    names, physical = set(), set()
    for case in cases:
        name = case["key"]
        scenario = case["scenario"]
        if name == "original-gura" or name in names:
            raise ValueError("Keep unique alternative keys beside the original baseline")
        names.add(name)
        if (scenario.get("kind") != "landcover" or not scenario.get("patches")
                or scenario.get("source_collection_id") != collection["id"]):
            raise ValueError("Keep the original Gura source-bound land-cover scenario")
        signature = digest({"source_collection_id": scenario["source_collection_id"],
                            "patches": [{k: v for k, v in p.items() if k != "reason"}
                                        for p in scenario["patches"]]})
        if signature in physical:
            raise ValueError("Two named alternatives repeat the same physical change")
        physical.add(signature)
    return path, plan_path, receipt, ws, grid, profile, baseline, plan


def _progress(directory, state, **updates):
    state.update(updates, updated_at=now())
    state["worker"] = {"hostname": socket.gethostname(), "pid": os.getpid(),
                       "python": sys.executable}
    atomic_json(directory / "progress.json", state)
    print(json.dumps({"operation_id": state["id"], "state": state.get("state"),
                      "phase": state.get("phase"), "programme_id": state.get("programme_id"),
                      "worker": state["worker"], "native_process": state.get("native_process"),
                      "completed_native_runs": state.get("completed_native_runs", 0)},
                     sort_keys=True), flush=True)


def _reopen_economic(destination, report_id):
    from model import decision_analysis as decision
    manifest = decision.read_json(destination / "manifest.json")
    report = decision.read_json(destination / "report.json")
    if (manifest.get("schema") != "upstate.decision-delivery/v1"
            or manifest.get("report_id") != report_id or report.get("id") != report_id):
        raise ValueError("The saved economic result belongs to another native selection")
    for item in manifest["members"]:
        verify_file(destination, item)
    return report


def _recover_archive(archive_path, workspace, identity, result, completion_identity):
    """Finish an archive whose final receipt write was interrupted."""
    from model import portable
    import hashlib
    import zipfile
    manifest = portable.inspect_archive(archive_path, verify=True)
    if (manifest["project"] != workspace.project
            or not manifest["selection"].get("include_intermediates")
            or not manifest["selection"].get("include_deliveries")):
        raise ValueError("Recover the complete original Workspace archive for this study")
    prefix = "workspace/gura-comparisons/" + result["id"] + "/"
    with zipfile.ZipFile(archive_path) as archive:
        archived_identity = json.loads(archive.read(prefix + "source-identity.json"))
        archived_result = json.loads(archive.read(prefix + "result.json"))
        if archived_identity != identity:
            raise ValueError("The existing archive belongs to another retained source operation")
        archived_result.pop("workspace_archive", None)
        expected_result = dict(result)
        expected_result.pop("workspace_archive", None)
        if archived_result != expected_result:
            raise ValueError("The existing archive contains another completed native/economic edition")
        native_descriptor = result["native_report"]["files"]["json"]
        native_body = archive.read("workspace/scenario-decisions/" + result["native_report"]["id"]
                                   + "/" + native_descriptor["path"])
        if (len(native_body) != native_descriptor["bytes"]
                or hashlib.sha256(native_body).hexdigest() != native_descriptor["sha256"]):
            raise ValueError("The archived watershed report differs from the completed native source result")
    return {"schema": manifest["schema"], "project_id": workspace.project["id"],
            "path": str(archive_path), "bytes": archive_path.stat().st_size,
            "sha256": file_digest(archive_path), "members": len(manifest["members"]),
            "selection": manifest["selection"], "completion_identity": completion_identity,
            "recovered_from_archive": True, "recovered_at": now()}


def execute(receiving_path, plan_path, *, output=None, build_economics=True, backup=None):
    path, original_plan, receipt, ws, grid, profile, baseline, plan = _check_plan(receiving_path, plan_path)
    from model.compute_programme import ComputeProgrammes
    from model import scenario_decisions
    application_root = Path(__file__).resolve().parent.parent
    source_names = ["source_tools/gura_comparison.py", "model/common.py", "model/workspace.py",
                    "model/rasters.py", "model/native.py", "model/portable.py", "model/compute_programme.py",
                    "model/compute_programme_cli.py", "model/scenario_decisions.py"]
    if build_economics:
        source_names.extend(["model/decision_analysis.py", "model/decision_cli.py",
                             "model/decision_desk.html"])
    software_sources = [describe_file(application_root, application_root / name)
                        for name in source_names]
    identity = {
        "plan_id": plan["id"], "plan_sha256": file_digest(original_plan),
        "receiving_sha256": file_digest(path),
        "continuation_sha256": file_digest(Path(__file__)),
        "software_sources": software_sources, "build_economics": build_economics,
    }
    key = digest(identity)
    directory = ws.root / "gura-comparisons" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".continuation.lock", blocking=False):
        atomic_bytes(directory / "plan.json", original_plan.read_bytes(), immutable=True)
        atomic_bytes(directory / "original-receiving.json", path.read_bytes(), immutable=True)
        atomic_json(directory / "source-identity.json", identity, immutable=True)
        state_path = directory / "progress.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": RESULT_SCHEMA, "id": key, "workspace_id": ws.project["id"],
            "created_at": now(), "scenarios": {}, "runs": {},
        }
        try:
            state.pop("error", None)
            _progress(directory, state, state="running", phase="scenario selections")
            roster = [{"key": "original-gura", "title": receipt["study"] + ": original baseline",
                       "profile_id": profile["id"], "scenario_id": baseline["id"]}]
            baseline_run = ws.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                           "scenario_id": baseline["id"]})
            state["runs"]["original-gura"] = baseline_run["id"]
            for case in plan["cases"]:
                scenario = ws.save_scenario(case["scenario"])
                prepared = ws.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                           "scenario_id": scenario["id"]})
                if state["scenarios"].get(case["key"], scenario["id"]) != scenario["id"]:
                    raise ValueError("Retained scenario identity differs from the original selected case")
                if state["runs"].get(case["key"], prepared["id"]) != prepared["id"]:
                    raise ValueError("Retained native run identity differs from the selected case")
                state["scenarios"][case["key"]] = scenario["id"]
                state["runs"][case["key"]] = prepared["id"]
                roster.append({"key": case["key"], "title": case["title"],
                               "profile_id": profile["id"], "scenario_id": scenario["id"],
                               "reason": case["reason"]})
            programme_selection = {
                "schema": "upstate.compute-programme-selection/v1", "title": plan["title"],
                "grid_id": grid["id"], "baseline_run": "original-gura", "runs": roster,
            }
            if plan.get("source_reference"):
                programme_selection["source_reference"] = plan["source_reference"]
            atomic_json(directory / "programme-selection.json", programme_selection, immutable=True)
            programme = ComputeProgrammes(ws).create(programme_selection)
            programme_id = programme["programme_id"]
            if state.get("programme_id", programme_id) != programme_id:
                raise ValueError("The retained continuation selects another native programme")
            _progress(directory, state, programme_id=programme_id, phase="native programme")
            pending = [run_id for run_id in state["runs"].values()
                       if ws.inspect_run(run_id).get("state") != "complete"]
            # The established executor reuses completed native runs and also
            # reconciles their programme status/report after an interrupted caller.
            command = [sys.executable, "-B", "-m", "model.compute_programme_cli",
                       "--workspace", str(ws.root), "execute", programme_id]
            command_record = {"argv": command, "cwd": str(application_root),
                              "original_programme_id": receipt["programme_id"],
                              "pending_run_ids_at_start": pending,
                              "hostname": socket.gethostname(), "started_at": now()}
            atomic_json(directory / "native-command.json", command_record)
            with (directory / "native-programme.log").open("ab") as log:
                child = subprocess.Popen(command, cwd=application_root, stdout=log,
                                         stderr=subprocess.STDOUT)
                command_record["pid"] = child.pid
                atomic_json(directory / "native-command.json", command_record)
                _progress(directory, state, native_process=command_record)
                returncode = child.wait()
            command_record.update(returncode=returncode, finished_at=now())
            atomic_json(directory / "native-command.json", command_record)
            _progress(directory, state, native_process=command_record)
            if returncode:
                raise RuntimeError("Original native programme exited " + str(returncode)
                                   + "; resume the retained programme " + programme_id
                                   + " after reading " + str(directory / "native-programme.log"))
            runs = [ws.inspect_run(state["runs"][row["key"]]) for row in roster]
            if any(run.get("state") != "complete" for run in runs):
                raise RuntimeError("Continue the retained native programme until every selected run completes")
            if any(run.get("runtime", {}).get("version") != "3.20.0" for run in runs):
                raise ValueError("The original contrast report requires the selected InVEST 3.20.0 runs")
            changed = {}
            for case, run in zip(plan["cases"], runs[1:]):
                edits = run.get("stages", {}).get("landcover", {}).get("edits", [])
                cells = sum(int(edit.get("changed_cells", 0)) for edit in edits)
                if cells <= 0:
                    raise ValueError("The completed alternative changed no native source cells: " + case["key"])
                changed[case["key"]] = {"run_id": run["id"], "scenario_id": state["scenarios"][case["key"]],
                                        "native_edits": edits, "changed_cells": cells,
                                        "planned_source_cells": case["planned_source_cells"],
                                        "planned_source_area_ha": case["planned_source_area_ha"]}
            _progress(directory, state, completed_native_runs=len(runs), phase="original watershed report")
            requested = scenario_decisions.select_cohort(
                ws, runs[0]["id"], alternative_run_ids=[run["id"] for run in runs[1:]],
                title=plan["title"], zones=plan["zones"])
            atomic_json(directory / "report-selection.json", requested, immutable=True)
            native_report = scenario_decisions.build(ws, requested)
            report_directory = ws.root / "scenario-decisions" / native_report["id"]
            report_path = verify_file(report_directory, native_report["files"]["json"])
            source_report = read_json(report_path)
            explicit_zone_ids = [zone["id"] for zone in source_report["zones"]
                                 if zone["id"].startswith("gura-watershed:")]
            if not explicit_zone_ids:
                raise ValueError("The native report lacks the explicitly retained Gura source-water features")
            economics = []
            if build_economics:
                from model import decision_analysis as decision
                inspected = decision.inspect_scenario_report(report_directory / "decision.json")
                by_zone = {zone["zone_id"]: zone for zone in inspected["zones"]}
                for zone_id in explicit_zone_ids:
                    zone = by_zone[zone_id]
                    if not zone["common_support_available"]:
                        economics.append({"zone_id": zone_id, "state": "no common native export support",
                                          "reasons": zone["reasons"]})
                        continue
                    packet = decision.scenario_report_packet(report_directory / "decision.json", zone_id)
                    selection = {
                        "schema": "upstate.decision-selection/v1",
                        "title": plan["title"] + " | " + zone["title"],
                        "comparison_id": zone["comparison_id"],
                        "costs": [], "targets": {}, "notes": [PURPOSE, *plan["economics"]["notes"]],
                    }
                    outcome = decision.analyze_packet(packet, selection)
                    destination = directory / "economic" / digest(zone_id)
                    if destination.exists():
                        _reopen_economic(destination, outcome["id"])
                    else:
                        decision.export_report(outcome, destination, input_packet=packet)
                    economics.append({"zone_id": zone_id, "state": "complete",
                                      "report_id": outcome["id"], "directory": str(destination),
                                      "desk": str(destination / "index.html"),
                                      "archive": describe_file(directory, destination / "decision-package.zip")})
            result_path = directory / "result.json"
            completed_at = read_json(result_path)["completed_at"] if result_path.exists() else now()
            result = {
                "schema": RESULT_SCHEMA, "id": key, "study": receipt["study"], "purpose": PURPOSE,
                "workspace": str(ws.root), "workspace_id": ws.project["id"],
                "original_programme_id": receipt["programme_id"], "programme_id": programme_id,
                "plan_id": plan["id"], "grid_id": grid["id"], "profile_id": profile["id"],
                "native_resolution_m": grid["grid"]["resolution_m"],
                "native_pixel_area_ha": plan["inventory"]["pixel_area_ha"],
                "baseline_run_id": runs[0]["id"], "alternative_run_ids": [run["id"] for run in runs[1:]],
                "scenario_runs": state["runs"], "actual_landcover_changes": changed,
                "native_report": native_report, "native_report_path": str(report_path),
                "native_report_directory": str(report_directory),
                "original_zone_ids": explicit_zone_ids, "economic_editions": economics,
                "software_sources": software_sources, "completed_at": completed_at,
            }
            atomic_json(result_path, result)
            if backup is not None:
                backup_path = Path(backup).resolve()
                if backup_path.is_relative_to(ws.root):
                    raise ValueError("Store the whole original Workspace archive outside the Workspace directory")
                archive_identity = digest({"operation_id": key, "native_report_id": native_report["id"],
                                           "economic_report_ids": [item.get("report_id") for item in economics]})
                archive_receipt = directory / "workspace-archive.json"
                prior = read_json(archive_receipt) if archive_receipt.exists() else None
                _progress(directory, state, phase="whole original Workspace archive")
                if backup_path.exists():
                    if prior is None:
                        archive = _recover_archive(backup_path, ws, identity, result, archive_identity)
                        atomic_json(archive_receipt, archive)
                    else:
                        if (prior.get("completion_identity") != archive_identity
                                or Path(prior["path"]).resolve() != backup_path
                                or prior["bytes"] != backup_path.stat().st_size
                                or prior["sha256"] != file_digest(backup_path)):
                            raise ValueError("The saved Workspace archive differs from this operation's retained archive record")
                        archive = prior
                else:
                    backup_path.parent.mkdir(parents=True, exist_ok=True)
                    archive = dict(ws.backup(backup_path, include_intermediates=True))
                    archive["completion_identity"] = archive_identity
                    atomic_json(archive_receipt, archive)
                result["workspace_archive"] = archive
                atomic_json(result_path, result)
            if output is not None:
                atomic_json(Path(output), result)
            _progress(directory, state, state="complete", phase="report and economic editions complete",
                      native_report_id=native_report["id"], completed_at=completed_at)
            return result
        except BaseException as error:
            _progress(directory, state, state="interrupted", phase=state.get("phase"),
                      error={"type": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("catalog", "plan"):
        command = sub.add_parser(name)
        command.add_argument("--receiving", type=Path, required=True)
        command.add_argument("--output", type=Path, required=True)
        command.add_argument("--zone-id-field")
        if name == "plan":
            command.add_argument("--convert", action="append",
                                 help="An explicit original FROM:TO class pair; repeat for multiple native alternatives")
    command = sub.add_parser("execute")
    command.add_argument("--receiving", type=Path, required=True)
    command.add_argument("--plan", type=Path, required=True)
    command.add_argument("--output", type=Path)
    command.add_argument("--physical-only", action="store_true",
                         help="Build the original native report before the economic companion is installed")
    command.add_argument("--workspace-backup", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "catalog":
            result = catalog(args.receiving, zone_id_field=args.zone_id_field)
            atomic_json(args.output, result, immutable=True)
        elif args.command == "plan":
            conversions = None
            if args.convert:
                conversions = []
                for value in args.convert:
                    parts = value.split(":")
                    if len(parts) != 2:
                        raise ValueError("Use original FROM:TO integer class pairs")
                    conversions.append(parts)
            result = make_plan(args.receiving, conversions=conversions, zone_id_field=args.zone_id_field)
            atomic_json(args.output, result, immutable=True)
        else:
            result = execute(args.receiving, args.plan, output=args.output,
                             build_economics=not args.physical_only, backup=args.workspace_backup)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__,
                          "message": str(error)}, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
