"""Continue the original Gura intake through native class contrasts and reports.

The observed-class plan explores the response to substituting original source
classes inside the original watershed. Class names and coefficients come from
the retained input tables. The operation preserves the original model grid,
profile, baseline, native engine, and source-file identities.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
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
                          digest, file_digest, held, now, read_json, selected_models, verify_file)
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


def _context(receiving_path, *, workspace=None):
    path = Path(receiving_path).resolve(strict=True)
    receipt = read_json(path)
    if receipt.get("schema") != RECEIVING_SCHEMA:
        raise ValueError("Select the original receive_gura.py receiving.json")
    ws = (workspace if isinstance(workspace, Workspace) else
          Workspace(workspace if workspace is not None else receipt["workspace"]))
    if receipt.get("workspace_id") not in (None, ws.project["id"]):
        raise ValueError("Select the original restored Workspace recorded by Gura receiving")
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


def _zone_source(ws, collection_id, requested_field=None, source_id="GURA_WATERSHED"):
    import fiona
    from model import rasters
    path, entry = ws.source_file(collection_id, source_id)
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
    return {"source_collection_id": collection_id, "source_id": source_id,
            "source": entry, "id_field": chosen, "features": features,
            "layer": entry.get("layer")}


def catalog(receiving_path, *, zone_id_field=None, workspace=None):
    path, receipt, ws, collection, grid, profile, baseline = _context(
        receiving_path, workspace=workspace)
    table_sources, row_sets, columns = {}, {}, {}
    active = selected_models(receipt)
    source_ids = receipt.get("source_ids", {})
    wanted = ["GURA_" + model.upper() + "_TABLE" for model in active] + ["GURA_BIOPHYSICAL"]
    for source_id in wanted:
        source_path, entry = ws.source_file(collection["id"], source_ids.get(source_id, source_id))
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
    source_zones = _zone_source(ws, collection["id"], zone_id_field,
                                source_ids.get("GURA_WATERSHED", "GURA_WATERSHED"))
    # The original programme travels inside the whole Workspace. Its verified
    # selection remains readable after the intake directory moves to another host.
    from model.compute_programme import ComputeProgrammes
    original_programme = ComputeProgrammes(ws).status(receipt["programme_id"])
    original_selection = original_programme["selection"]
    original_reference = [row for row in original_selection["runs"]
                          if row["key"] == original_selection["baseline_run"]]
    if (original_selection["grid_id"] != grid["id"] or len(original_reference) != 1
            or original_reference[0]["profile_id"] != profile["id"]
            or original_reference[0]["scenario_id"] != baseline["id"]
            or selected_models(original_reference[0]) != active):
        raise ValueError("The retained original programme differs from the Gura source selection")
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
    if active != ["ndr", "sdr"]:
        result["models"] = active
    result["id"] = digest(result)
    return result


def make_plan(receiving_path, *, conversions=None, zone_id_field=None, workspace=None):
    inventory = catalog(receiving_path, zone_id_field=zone_id_field, workspace=workspace)
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
                "patches": [{"mask_source_id": inventory["watershed_source"]["source_id"],
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
    if "models" in inventory:
        plan["models"] = inventory["models"]
    plan["id"] = digest(plan)
    return plan


def _check_plan(receiving_path, plan_path, *, workspace=None):
    plan_path = Path(plan_path).resolve(strict=True)
    plan = read_json(plan_path)
    if plan.get("schema") != PLAN_SCHEMA:
        raise ValueError("Select a retained Gura class-contrast plan")
    identity = dict(plan)
    key = identity.pop("id", None)
    if key != digest(identity):
        raise ValueError("The retained contrast plan changed; create its next explicit source selection")
    path, receipt, ws, collection, grid, profile, baseline = _context(
        receiving_path, workspace=workspace)
    expected = {
        "workspace_id": ws.project["id"], "source_collection_id": collection["id"],
        "grid_id": grid["id"], "profile_id": profile["id"],
        "baseline_scenario_id": baseline["id"], "original_programme_id": receipt["programme_id"],
    }
    if (any(plan.get(name) != value for name, value in expected.items())
            or selected_models(plan) != selected_models(receipt)):
        raise ValueError("The contrast plan belongs to another original Gura selection")
    if (plan["receiving"]["sha256"] != file_digest(path)
            or plan["receiving"]["bytes"] != path.stat().st_size):
        raise ValueError("The contrast plan names a different original receiving record")
    inv = plan["inventory"]
    inv_identity = dict(inv)
    inv_id = inv_identity.pop("id", None)
    if inv_id != digest(inv_identity):
        raise ValueError("The retained class/source inventory changed")
    fresh = catalog(receiving_path, zone_id_field=inv["watershed_source"]["id_field"],
                    workspace=ws)
    if fresh["receiving"] != inv["receiving"]:
        if any(fresh["receiving"][name] != inv["receiving"][name]
               for name in ("bytes", "sha256")):
            raise ValueError("The restored receiving copy differs from the original receipt")
        # A restored plan may use its retained original-receiving.json copy.
        # The source bytes already match; preserve the saved logical filename
        # when comparing the original inventory identity.
        fresh["receiving"] = dict(inv["receiving"])
        fresh.pop("id")
        fresh["id"] = digest(fresh)
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


def _progress(directory, record, **updates):
    record.update(updates, updated_at=now())
    record["worker"] = {"hostname": socket.gethostname(), "pid": os.getpid(),
                       "python": sys.executable}
    atomic_json(directory / "progress.json", record)
    print(json.dumps({"operation_id": record["id"], "state": record.get("state"),
                      "phase": record.get("phase"), "programme_id": record.get("programme_id"),
                      "worker": record["worker"], "native_process": record.get("native_process"),
                      "completed_native_runs": record.get("completed_native_runs", 0)},
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


def _economic_destination(directory, zone_id, outcome):
    """Keep completed earlier producer editions beside the current zone result."""
    legacy = directory / "economic" / digest(zone_id)
    if not legacy.exists():
        return legacy
    previous_id = read_json(legacy / "report.json")["id"]
    previous = _reopen_economic(legacy, previous_id)
    if previous.get("physical_source", {}).get("zone", {}).get("id") != zone_id:
        raise ValueError("The saved economic edition belongs to another original reporting zone")
    if previous_id == outcome["id"]:
        return legacy
    return legacy / "editions" / outcome["id"]


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



def _programme_record_matches(record, programme_id):
    if not isinstance(record, dict):
        return False
    argv = record.get("argv")
    return (isinstance(argv, list) and len(argv) >= 2
            and argv[-1] == programme_id
            and "model.compute_programme_cli" in argv)


def _local_child_active(record, programme_id):
    """Inspect an issued local child, without treating another host's PID as local."""
    if (not _programme_record_matches(record, programme_id)
            or record.get("returncode") is not None
            or record.get("hostname") != socket.gethostname()):
        return False
    pid = record.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    proc = Path("/proc") / str(pid)
    try:
        command = [item.decode("utf-8", "surrogateescape")
                   for item in (proc / "cmdline").read_bytes().split(b"\0") if item]
        if command != record["argv"]:
            return False
        if Path(os.readlink(proc / "cwd")).resolve() != Path(record["cwd"]).resolve():
            return False
        saved_start = record.get("process_start_ticks")
        if saved_start is not None:
            fields = (proc / "stat").read_text().rsplit(")", 1)[1].split()
            if fields[19] != str(saved_start):
                return False
        return True
    except FileNotFoundError:
        return False
    except (OSError, ValueError, IndexError) as error:
        raise RuntimeError("Could not inspect the issued local programme child "
                           + str(pid) + ": " + str(error)) from error


def _programme_active(status):
    """Include retained native children that outlive their programme caller."""
    return bool(status["active"] or any(row.get("active") for row in status["runs"]))


def _observe_programme(manager, programme_id, notify, record, *, gate_held=False):
    status = manager.status(programme_id, include_ensemble_candidates=False)
    notice = {"programme_id": programme_id, "state": status["state"],
              "phase": status.get("phase"), "active": status["active"],
              "counts": status["counts"], "observed_at": now(),
              "launch_gate_held": gate_held,
              "active_native_run_ids": [row["run_id"] for row in status["runs"]
                                        if row.get("active")]}
    notify(record, notice)
    return status


def run_retained_programme(manager, programme_id, directory, *,
                           record_name="native-command.json",
                           log_name="native-programme.log", previous_record=None,
                           original_programme_id=None, notify=None):
    """Continue one actual programme while retaining every issued process record.

    The launch descriptor is inherited by the native CLI. Closing a dead
    caller's descriptor therefore leaves the launch gate held by its child
    until that child exits, including the interval before execution-lock entry.
    """
    import fcntl
    import time
    import uuid
    notify = notify or (lambda process, observation: None)
    operation_directory = Path(directory)
    directory = operation_directory / "programme-executions" / programme_id
    directory.mkdir(parents=True, exist_ok=True)
    command_path = directory / record_name
    records = []
    if command_path.exists():
        records.append(read_json(command_path))
    if previous_record is not None and _programme_record_matches(previous_record, programme_id):
        records.append(previous_record)
    records.extend(read_json(path) for path in (directory / "native-attempts").glob("*.json"))
    # Older wrappers kept one operation-wide command ledger. Preserve it and
    # reuse its matching issued child; current source editions get separate
    # ledgers so rebinding cannot overwrite another programme's attempts.
    legacy_paths = [operation_directory / record_name]
    legacy_paths.extend((operation_directory / "native-attempts").glob("*.json"))
    for legacy_path in legacy_paths:
        if legacy_path.exists():
            legacy_record = read_json(legacy_path)
            if _programme_record_matches(legacy_record, programme_id):
                records.append(legacy_record)
    if any(not _programme_record_matches(record, programme_id) for record in records):
        raise ValueError("A retained native command names another programme")
    records.sort(key=lambda row: (row.get("started_at", ""),
                                  row.get("pid") is not None,
                                  row.get("returncode") is not None))
    issued = records[-1] if records else None
    if not command_path.exists() and issued is not None:
        # Preserve a pre-existing wrapper's first process record before its
        # live progress is updated to a later observation or retry.
        atomic_json(command_path, issued, immutable=True)
    programme_directory = manager._directory(programme_id)
    manager._load(programme_id)
    gate_path = programme_directory / ".continuation-launch.lock"
    # Do not explicitly LOCK_UN here: inherited descriptors belong to the
    # surviving native child when its original caller is interrupted.
    with gate_path.open("a+b") as gate:
        last_notice = 0.0
        while True:
            try:
                fcntl.flock(gate.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - last_notice >= 10:
                    _observe_programme(manager, programme_id, notify, issued, gate_held=True)
                    last_notice = time.monotonic()
                time.sleep(1)
        while True:
            status = manager.status(programme_id, include_ensemble_candidates=False)
            if not _programme_active(status) and not _local_child_active(issued, programme_id):
                break
            if time.monotonic() - last_notice >= 10:
                _observe_programme(manager, programme_id, notify, issued)
                last_notice = time.monotonic()
            time.sleep(1)
        if status["state"] == "complete":
            _observe_programme(manager, programme_id, notify, issued)
            return status
        # A new native child must still satisfy the original scientific
        # dependency inventory, grid identity and exact run bindings.
        record = manager._load(programme_id)
        try:
            manager._check_execution(record)
        except ValueError as error:
            if str(error) != (
                    "Programme scientific engine source changed; reopen its retained application or create a new programme"):
                raise
            replacement = _retained_programme(
                manager, record["selection"], require_current_sources=True)
            replacement_id = replacement["programme_id"]
            if replacement_id == programme_id:
                raise
            notify(issued, {"programme_id": replacement_id,
                            "source_programme_id": programme_id,
                            "state": "rebound", "observed_at": now(),
                            "reason": str(error)})
            return run_retained_programme(
                manager, replacement_id, operation_directory,
                record_name=record_name, log_name=log_name,
                original_programme_id=original_programme_id or programme_id,
                notify=notify)
        command = [sys.executable, "-B", "-m", "model.compute_programme_cli",
                   "--workspace", str(manager.workspace.root), "resume", programme_id]
        attempt_directory = directory / "native-attempts"
        attempt_directory.mkdir(exist_ok=True)
        attempt_path = attempt_directory / (uuid.uuid4().hex + ".json")
        command_record = {
            "argv": command, "cwd": str(Path(__file__).resolve().parent.parent),
            "programme_id": programme_id, "original_programme_id": original_programme_id,
            "pending_run_ids_at_start": [row["run_id"] for row in status["runs"]
                                        if row.get("native_state", row.get("state")) != "complete"],
            "hostname": socket.gethostname(), "started_at": now(),
            "log": str(directory / log_name), "attempt_record": str(attempt_path),
            "environment": {name: os.environ.get(name) for name in
                            ("GDAL_CACHEMAX", "GDAL_NUM_THREADS")},
        }
        first_command = not command_path.exists() and issued is None

        def retain_attempt():
            atomic_json(attempt_path, command_record)
            if first_command:
                atomic_json(command_path, command_record)

        retain_attempt()
        with (directory / log_name).open("ab") as log:
            child = subprocess.Popen(command, cwd=command_record["cwd"], stdout=log,
                                     stderr=subprocess.STDOUT, pass_fds=(gate.fileno(),))
            command_record["pid"] = child.pid
            try:
                command_record["process_start_ticks"] = (
                    (Path("/proc") / str(child.pid) / "stat").read_text()
                    .rsplit(")", 1)[1].split()[19])
            except (OSError, IndexError):
                pass
            retain_attempt()
            notify(command_record, {"programme_id": programme_id, "state": "issued",
                                    "observed_at": now(), "launch_gate_held": True})
            returncode = child.wait()
        command_record.update(returncode=returncode, finished_at=now())
        retain_attempt()
        # An older caller may have won the original programme lock during
        # launch. Observe that exact programme to completion, without issuing
        # another child or replacing either caller's retained process record.
        status = manager.status(programme_id, include_ensemble_candidates=False)
        while _programme_active(status):
            _observe_programme(manager, programme_id, notify, command_record)
            time.sleep(2)
            status = manager.status(programme_id, include_ensemble_candidates=False)
        _observe_programme(manager, programme_id, notify, command_record)
        if status["state"] != "complete":
            raise RuntimeError("Original native programme " + programme_id + " is "
                               + status["state"] + " after exit " + str(returncode)
                               + "; its retained command is " + str(attempt_path)
                               + " and log is " + command_record["log"])
        return status


def _retained_programme(manager, selection, preferred=None, *, require_current_sources=False):
    expected = manager.preview(selection)
    normalized = expected["selection"]
    expected_runs = {row["key"]: row["native_selection"] for row in expected["runs"]}

    def matches(status):
        if (status["selection"] != normalized
                or {row["key"]: row["native_selection"] for row in status["runs"]}
                != expected_runs):
            return False
        if require_current_sources:
            try:
                manager._check_execution(manager._load(status["programme_id"]))
            except ValueError as error:
                if str(error) != (
                        "Programme scientific engine source changed; reopen its retained application or create a new programme"):
                    raise
                return False
        return True

    if preferred:
        result = manager.status(preferred, include_ensemble_candidates=False)
        if not matches(result):
            raise ValueError("The retained programme differs from the original contrast selection")
        return result
    candidates = []
    for summary in manager.catalog(include_completed_sources=False)["programmes"]:
        if summary.get("state") == "unavailable":
            continue
        candidate = manager.status(summary["id"], include_ensemble_candidates=False)
        if matches(candidate):
            candidates.append(candidate)
    if candidates:
        candidates.sort(key=lambda row: (not _programme_active(row), row["state"] != "complete",
                                         row["created_at"], row["programme_id"]))
        return candidates[0]
    return manager.create(selection)


def _continuation_directory(workspace, requested_identity, original_plan, receiving_path):
    """Recover the same intent across an orchestrator/source edition upgrade."""
    binding_names = ("plan_id", "plan_sha256", "receiving_sha256", "build_economics")
    binding = {key: requested_identity[key] for key in binding_names}
    root = workspace.root / "gura-comparisons"
    candidates = []
    for candidate in sorted(root.glob("*/source-identity.json")):
        identity = read_json(candidate)
        if any(identity.get(name) != value for name, value in binding.items()):
            continue
        directory = candidate.parent
        if digest(identity) != directory.name:
            raise ValueError("A retained Gura continuation source identity changed")
        if ((directory / "plan.json").read_bytes() != original_plan.read_bytes()
                or (directory / "original-receiving.json").read_bytes() != receiving_path.read_bytes()):
            raise ValueError("A retained Gura continuation has different original plan or receiving bytes")
        progress_path = directory / "progress.json"
        progress = read_json(progress_path) if progress_path.exists() else {}
        if progress and (progress.get("id") != directory.name
                         or progress.get("workspace_id") != workspace.project["id"]):
            raise ValueError("The retained Gura progress belongs to another operation")
        active = False
        if progress.get("programme_id"):
            from model.compute_programme import ComputeProgrammes
            active = _programme_active(ComputeProgrammes(workspace).status(progress["programme_id"]))
        candidates.append((not active, not (directory / "result.json").exists(),
                           not bool(progress.get("programme_id")), progress.get("created_at", ""),
                           directory, identity))
    if candidates:
        candidates.sort(key=lambda item: item[:4] + (str(item[4]),))
        return candidates[0][4], candidates[0][5]
    return root / digest(requested_identity), requested_identity


def _saved_result(directory, workspace, key, plan, receipt, programme_id, runs):
    path = directory / "result.json"
    if not path.exists():
        return None
    result = read_json(path)
    expected = {"schema": RESULT_SCHEMA, "id": key, "workspace_id": workspace.project["id"],
                "original_programme_id": receipt["programme_id"], "programme_id": programme_id,
                "plan_id": plan["id"], "grid_id": plan["grid_id"], "profile_id": plan["profile_id"],
                "baseline_run_id": runs[0]["id"],
                "alternative_run_ids": [run["id"] for run in runs[1:]]}
    if any(result.get(name) != value for name, value in expected.items()):
        raise ValueError("The completed Gura result belongs to another original native selection")
    report_root = workspace.root / "scenario-decisions" / result["native_report"]["id"]
    report_path = verify_file(report_root, result["native_report"]["files"]["json"])
    original_root = Path(result["workspace"])
    if not original_root.is_absolute():
        raise ValueError("The completed Gura result needs its original Workspace location")
    original_report_root = original_root / "scenario-decisions" / result["native_report"]["id"]
    report_relative = report_path.relative_to(report_root)
    if (Path(result["native_report_path"]).resolve()
            != (original_report_root / report_relative).resolve()
            or Path(result["native_report_directory"]).resolve() != original_report_root.resolve()):
        raise ValueError("The completed native report differs from its original Workspace binding")
    rebound_economics = []
    for item in result["economic_editions"]:
        if item.get("state") != "complete":
            rebound_economics.append(dict(item))
            continue
        legacy = directory / "economic" / digest(item["zone_id"])
        expected_directories = (legacy, legacy / "editions" / item["report_id"])
        saved_directory = Path(item["directory"]).resolve()
        selected_directory = next((candidate for candidate in expected_directories
            if saved_directory == (original_root / candidate.relative_to(workspace.root)).resolve()), None)
        if selected_directory is None:
            raise ValueError("The completed economic edition has another original reporting zone")
        if Path(item["desk"]).resolve() != (saved_directory / "index.html").resolve():
            raise ValueError("The completed economic desk belongs to another report edition")
        economic = _reopen_economic(selected_directory, item["report_id"])
        if economic.get("physical_source", {}).get("zone", {}).get("id") != item["zone_id"]:
            raise ValueError("The completed economic report retains another original zone")
        archive = verify_file(directory, item["archive"])
        if archive.resolve() != (selected_directory / "decision-package.zip").resolve():
            raise ValueError("The completed economic archive belongs to another report edition")
        rebound_economics.append({**item, "directory": str(selected_directory),
                                 "desk": str(selected_directory / "index.html")})
    if original_root.resolve() != workspace.root.resolve():
        source_copy = directory / "receiving-results" / (file_digest(path) + ".json")
        atomic_bytes(source_copy, path.read_bytes(), immutable=True)
        previous = {"workspace": str(original_root),
                    "result": describe_file(workspace.root, source_copy)}
        if result.get("workspace_archive"):
            previous["workspace_archive"] = result["workspace_archive"]
        locations = list(result.get("receiving_locations", []))
        if not locations or locations[-1] != previous:
            locations.append(previous)
        result = {**result, "workspace": str(workspace.root),
                  "native_report_directory": str(report_root),
                  "native_report_path": str(report_path),
                  "economic_editions": rebound_economics,
                  "receiving_locations": locations}
        result.pop("workspace_archive", None)
    return result



def execute(receiving_path, plan_path, *, output=None, build_economics=True, backup=None,
            workspace=None):
    path, original_plan, receipt, ws, grid, profile, baseline, plan = _check_plan(
        receiving_path, plan_path, workspace=workspace)
    from model.compute_programme import ComputeProgrammes
    from model import scenario_decisions
    application_root = Path(__file__).resolve().parent.parent
    source_names = ["source_tools/gura_comparison.py", "model/common.py", "model/workspace.py",
                    "model/rasters.py", "model/native.py", "model/portable.py", "model/compute_programme.py",
                    "model/compute_programme_cli.py", "model/scenario_decisions.py",
                    "model/native_study.py"]
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
    requested_identity = identity
    binding = {name: identity[name] for name in
               ("plan_id", "plan_sha256", "receiving_sha256", "build_economics")}
    lock_directory = ws.root / "gura-comparisons" / ".selection-locks"
    lock_directory.mkdir(parents=True, exist_ok=True)
    with ExitStack() as locks:
        locks.enter_context(held(lock_directory / (digest(binding) + ".lock"), blocking=False))
        directory, identity = _continuation_directory(ws, requested_identity, original_plan, path)
        key = directory.name
        directory.mkdir(parents=True, exist_ok=True)
        locks.enter_context(held(directory / ".continuation.lock", blocking=False))
        orchestrators = directory / "orchestrators"
        orchestrators.mkdir(exist_ok=True)
        atomic_json(orchestrators / (digest(requested_identity) + ".json"),
                    {"operation_id": key, "original_source_identity": identity,
                     "orchestrator": requested_identity}, immutable=True)
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
            active = selected_models(receipt)
            native_scope = {"models": active} if active != ["ndr", "sdr"] else {}
            roster = [{"key": "original-gura", "title": receipt["study"] + ": original baseline",
                       "profile_id": profile["id"], "scenario_id": baseline["id"], **native_scope}]
            baseline_run = ws.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                           "scenario_id": baseline["id"], **native_scope})
            state["runs"]["original-gura"] = baseline_run["id"]
            for case in plan["cases"]:
                scenario = ws.save_scenario(case["scenario"])
                prepared = ws.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                           "scenario_id": scenario["id"], **native_scope})
                if state["scenarios"].get(case["key"], scenario["id"]) != scenario["id"]:
                    raise ValueError("Retained scenario identity differs from the original selected case")
                if state["runs"].get(case["key"], prepared["id"]) != prepared["id"]:
                    raise ValueError("Retained native run identity differs from the selected case")
                state["scenarios"][case["key"]] = scenario["id"]
                state["runs"][case["key"]] = prepared["id"]
                roster.append({"key": case["key"], "title": case["title"],
                               "profile_id": profile["id"], "scenario_id": scenario["id"],
                               "reason": case["reason"], **native_scope})
            programme_selection = {
                "schema": "upstate.compute-programme-selection/v1", "title": plan["title"],
                "grid_id": grid["id"], "baseline_run": "original-gura", "runs": roster,
            }
            if plan.get("source_reference"):
                programme_selection["source_reference"] = plan["source_reference"]
            atomic_json(directory / "programme-selection.json", programme_selection, immutable=True)
            manager = ComputeProgrammes(ws)
            programme = _retained_programme(manager, programme_selection, state.get("programme_id"))
            programme_id = programme["programme_id"]
            if state.get("programme_id", programme_id) != programme_id:
                raise ValueError("The retained continuation selects another native programme")
            _progress(directory, state, programme_id=programme_id, phase="native programme")

            def native_progress(process, observation):
                updates = {"native_observation": observation, "phase": "native programme",
                           "programme_id": observation["programme_id"]}
                if process is not None:
                    updates["native_process"] = process
                _progress(directory, state, **updates)

            completed_programme = run_retained_programme(
                manager, programme_id, directory,
                previous_record=state.get("native_process"),
                original_programme_id=receipt["programme_id"], notify=native_progress)
            programme_id = completed_programme["programme_id"]
            _progress(directory, state, programme_id=programme_id,
                      phase="native programme complete")
            runs = [ws.inspect_run(state["runs"][row["key"]]) for row in roster]
            if any(run.get("state") != "complete" for run in runs):
                raise RuntimeError("Continue the retained native programme until every selected run completes")
            if any(run.get("runtime", {}).get("version") != "3.20.0" for run in runs):
                raise ValueError("The original contrast report requires the selected InVEST 3.20.0 runs")
            result = _saved_result(directory, ws, key, plan, receipt, programme_id, runs)
            if result is None:
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
                    title=plan["title"], zones=plan["zones"],
                    delivery_mode="native_study", native_study={
                        "title": plan["study"], "purpose": plan["purpose"],
                        "reference": plan.get("source_reference"),
                    })
                original_selection_path = directory / "report-selection.json"
                if original_selection_path.exists():
                    previous = read_json(original_selection_path)
                    context_fields = {"delivery_mode", "native_study"}
                    if ({name: value for name, value in previous.items() if name not in context_fields}
                            != {name: value for name, value in requested.items() if name not in context_fields}):
                        raise ValueError("The retained Gura report selection differs from the original cohort and zones")
                else:
                    atomic_json(original_selection_path, requested, immutable=True)
                selection_path = directory / "report-selections" / (digest(requested) + ".json")
                atomic_json(selection_path, requested, immutable=True)
                _progress(directory, state, report_selection=describe_file(directory, selection_path))
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
                        destination = _economic_destination(directory, zone_id, outcome)
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
            else:
                native_report = result["native_report"]
                economics = result["economic_editions"]
                completed_at = result["completed_at"]
                result_path = directory / "result.json"
                if read_json(result_path) != result:
                    # A relocated completed result is current even when this
                    # invocation does not request another Workspace archive.
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
    os.environ.setdefault("GDAL_CACHEMAX", "16")
    os.environ.setdefault("GDAL_NUM_THREADS", "1")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("catalog", "plan"):
        command = sub.add_parser(name)
        command.add_argument("--receiving", type=Path, required=True)
        command.add_argument("--workspace", type=Path,
                             help="Restored original Workspace; retain the receiving JSON unchanged")
        command.add_argument("--output", type=Path, required=True)
        command.add_argument("--zone-id-field")
        if name == "plan":
            command.add_argument("--convert", action="append",
                                 help="An explicit original FROM:TO class pair; repeat for multiple native alternatives")
    command = sub.add_parser("execute")
    command.add_argument("--receiving", type=Path, required=True)
    command.add_argument("--workspace", type=Path,
                         help="Restored original Workspace; retain the receiving JSON unchanged")
    command.add_argument("--plan", type=Path, required=True)
    command.add_argument("--output", type=Path)
    command.add_argument("--physical-only", action="store_true",
                         help="Build the original native report before the economic companion is installed")
    command.add_argument("--workspace-backup", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "catalog":
            result = catalog(args.receiving, zone_id_field=args.zone_id_field,
                             workspace=args.workspace)
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
            result = make_plan(args.receiving, conversions=conversions,
                               zone_id_field=args.zone_id_field, workspace=args.workspace)
            atomic_json(args.output, result, immutable=True)
        else:
            result = execute(args.receiving, args.plan, output=args.output,
                             build_economics=not args.physical_only, backup=args.workspace_backup,
                             workspace=args.workspace)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False), flush=True)
        return 0
    except (ValueError, OSError, KeyError, TypeError, ImportError, RuntimeError) as error:
        print(json.dumps({"state": "error", "type": type(error).__name__,
                          "message": str(error)}, sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
