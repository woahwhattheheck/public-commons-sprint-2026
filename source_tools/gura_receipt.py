"""Continue an original Gura Workspace run through the shared programme workflow.

The original receiving driver owns archive ingestion and native execution.
This adapter binds its retained source records and run to the existing Gura
class-comparison receipt without copying inputs or changing the native selection.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path

from model.common import (atomic_bytes, atomic_json, describe_file,
                          file_digest, held, identifier, read_json, selected_models)
from model.compute_programme import ComputeProgrammes
from model.profiles import checked_parameters
from model.model_selection import TABLE_FIELDS
from model.workspace import Workspace

SCHEMA = "upstate.gura-original-receiving/v1"
SOURCE_STATE_SCHEMA = "upstate.gura-receiving/v1"
ARCHIVES = {
    "ndr": {"sha256": "df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d",
            "bytes": 701988,
            "uri": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip"},
    "sdr": {"sha256": "34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779",
            "bytes": 726334,
            "uri": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip"},
}
PARAMETERS = {
    "ndr": ("threshold_flow_accumulation", "k_param", "flow_dir_algorithm",
            "subsurface_critical_length_n", "subsurface_eff_n"),
    "sdr": ("threshold_flow_accumulation", "k_param", "flow_dir_algorithm",
            "sdr_max", "ic_0_param", "l_max"),
}


def _rows(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        rows = {}
        for row in reader:
            key = int(row["lucode"])
            if key in rows:
                raise ValueError("The original coefficient table repeats a land-cover code")
            rows[key] = row
    if not rows:
        raise ValueError("The original coefficient table is empty")
    return rows


def prepare(workspace, *, run_id=None, receiving_state=None, output=None):
    """Bind an actual original-driver Workspace baseline to the shared receipt."""
    ws = workspace if isinstance(workspace, Workspace) else Workspace(workspace)
    state_path = Path(receiving_state) if receiving_state is not None else (
        ws.root / "gura-receiving" / "gura-receiving-state.json")
    state_path = state_path.resolve(strict=True)
    from hashlib import sha256
    original_state_bytes = state_path.read_bytes()
    original_state = json.loads(original_state_bytes)
    if (original_state.get("schema") != SOURCE_STATE_SCHEMA
            or original_state.get("workspace_id") != ws.project["id"]):
        raise ValueError("Select the original Gura receiving state for this Workspace")
    record = original_state.get("workspace_baseline") or {}
    chosen_run = identifier(run_id if run_id is not None else record.get("run_id"))
    run = ws.inspect_run(chosen_run)
    selection = run["selection"]
    if (record.get("run_id") != run["id"]
            or any(record.get(name) != selection[name]
                   for name in ("grid_id", "profile_id", "scenario_id"))):
        raise ValueError("The original receiving state names another Workspace baseline")
    models = selected_models(selection)
    grid = ws.get_grid(selection["grid_id"])
    profile = ws._get("profiles", selection["profile_id"])
    baseline = ws._get("scenarios", selection["scenario_id"])
    collection_id = profile["source_collection_id"]
    collection = ws._get("sources", collection_id)
    if (grid.get("state") != "complete" or baseline.get("kind") != "baseline"
            or baseline.get("patches")
            or grid["spec"]["source_collection_id"] != collection_id
            or baseline["source_collection_id"] != collection_id
            or selected_models(profile) != models
            or selected_models(grid["spec"]) != models):
        raise ValueError("Retain the original completed grid, baseline and selected-model profile")
    if "Gura" not in ws.project["title"]:
        raise ValueError("The original Gura receiving record needs its retained study title")
    table_path, table_entry = ws.source_file(collection_id, profile["biophysical_source_id"])
    if file_digest(table_path) != profile["table_summary"]["sha256"]:
        raise ValueError("The baseline profile differs from its retained coefficient table")
    combined = _rows(table_path)
    source_ids = {"GURA_BIOPHYSICAL": profile["biophysical_source_id"]}
    originals, original_tables, argument_sources = {}, {}, {}
    parameters = {"title": profile["title"], "references": profile["references"],
                  "models": models}
    for model in models:
        source = original_state.get("original_sources", {}).get(model)
        if not isinstance(source, dict):
            raise ValueError("Retain the original " + model.upper() + " archive receipt")
        archive = source.get("archive", {})
        expected = ARCHIVES[model]
        if archive.get("sha256") != expected["sha256"] or archive.get("size") != expected["bytes"]:
            raise ValueError("The original receiving state names another " + model.upper() + " archive")
        source_id = "gura_" + model + "_biophysical"
        original_table, entry = ws.source_file(collection_id, source_id)
        rows = _rows(original_table)
        for code, joined in combined.items():
            if code not in rows:
                raise ValueError("The joined coefficient profile has a class absent from its original table")
            for field in TABLE_FIELDS[model]:
                if field == "lucode":
                    continue
                if str(joined.get(field, "")).strip() != str(rows[code].get(field, "")).strip():
                    raise ValueError("The baseline coefficient differs from its original table: "
                                     + model + "." + field + " / " + str(code))
        source_ids["GURA_" + model.upper() + "_TABLE"] = source_id
        original_tables[model] = {"source_id": source_id,
                                 "sha256": file_digest(original_table),
                                 "bytes": original_table.stat().st_size,
                                 "uri": entry["uri"]}
        argument_id = "gura_" + model + "_original_arguments"
        argument_path, argument_entry = ws.source_file(collection_id, argument_id)
        document = read_json(argument_path)
        if (document.get("model_name") != "natcap.invest." + model + "." + model
                or document.get("args") != source.get("original_arguments")):
            raise ValueError("Retained original arguments differ from the receiving source record")
        native = {name: document["args"][name] for name in PARAMETERS[model]}
        native["flow_dir_algorithm"] = str(native["flow_dir_algorithm"]).lower()
        if model == "ndr" and document["args"].get("runoff_proxy_av"):
            native["runoff_proxy_av"] = document["args"]["runoff_proxy_av"]
        parameters[model] = native
        argument_sources[model] = {"source_id": argument_id,
                                   "sha256": file_digest(argument_path),
                                   "embedded_invest_version": document.get("invest_version"),
                                   "uri": argument_entry["uri"]}
        originals[model] = dict(expected)
    if checked_parameters(parameters) != checked_parameters(profile):
        raise ValueError("The baseline parameters differ from the original archive argument selection")
    reporting = grid["spec"]["reporting_area"]
    watershed_id = reporting["source_id"]
    if watershed_id != "gura_" + models[0] + "_watershed":
        raise ValueError("Select the original Gura reporting watershed")
    ws.source_file(collection_id, watershed_id)
    source_ids["GURA_WATERSHED"] = watershed_id
    resolution = float(grid["grid"]["resolution_m"])
    buffer_m = float(grid["spec"]["upstream_buffer_m"])
    if not math.isfinite(resolution) or resolution <= 0 or not math.isfinite(buffer_m) or buffer_m < 0:
        raise ValueError("Retain the actual finite native grid and nonnegative context buffer")
    native_grid = {**grid["grid"], "resolution_m": resolution, "upstream_buffer_m": buffer_m}
    target = (Path(output).resolve() if output is not None else
              ws.root / "gura-receiving" / "programmes" / chosen_run / "receiving.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    with held(target.parent / ".receiving-adapter.lock", blocking=False):
        if target.exists():
            previous = read_json(target)
            if (previous.get("schema") != SCHEMA
                    or previous.get("workspace_id") != ws.project["id"]
                    or previous.get("baseline_run_id") != chosen_run
                    or previous.get("source_ids") != source_ids
                    or previous.get("original_tables") != original_tables
                    or previous.get("native_grid") != native_grid):
                raise ValueError("The receiving destination already selects another original Gura case")
            retained = ComputeProgrammes(ws).status(previous["programme_id"])
            if (retained["selection"]["grid_id"] != grid["id"]
                    or len(retained["runs"]) != 1
                    or retained["runs"][0]["run_id"] != chosen_run):
                raise ValueError("The retained receiving programme has another original native selection")
            return {**previous, "receiving_path": str(target)}
        reference = "upstate.original-gura-run:" + chosen_run
        row = {"key": "original-gura", "title": ws.project["title"] + ": original baseline",
               "profile_id": profile["id"], "scenario_id": baseline["id"]}
        if models != ["ndr", "sdr"]:
            row["models"] = models
        programme_selection = {
            "schema": "upstate.compute-programme-selection/v1",
            "title": ws.project["title"], "grid_id": grid["id"],
            "baseline_run": "original-gura", "runs": [row],
            "source_reference": reference,
        }
        manager = ComputeProgrammes(ws)
        programme = manager.create(programme_selection)
        if len(programme["runs"]) != 1 or programme["runs"][0]["run_id"] != chosen_run:
            raise ValueError("The ordinary programme must reuse the exact original native run")
        state_copy = (target.parent / "original-receiving-states" /
                      (sha256(original_state_bytes).hexdigest() + ".json"))
        atomic_bytes(state_copy, original_state_bytes, immutable=True)
        selection_path = target.parent / "programme-selection.json"
        atomic_json(selection_path, programme_selection, immutable=True)
        receipt = {
            "schema": SCHEMA, "study": ws.project["title"],
            "workspace": str(ws.root), "workspace_id": ws.project["id"],
            "source_directory": str(target.parent), "source_edition": "Original archived Gura datastack",
            "archives": originals, "original_tables": original_tables,
            "original_arguments": argument_sources, "table_source_policy": "original-archive-datastack",
            "source_ids": source_ids, "native_grid": native_grid,
            "source_collection_id": collection_id,
            "source_manifest_sha256": collection["original_manifest"]["sha256"],
            "grid_id": grid["id"], "profile_id": profile["id"], "scenario_id": baseline["id"],
            "models": models, "baseline_run_id": chosen_run,
            "programme_id": programme["id"], "selection_path": str(selection_path),
            "receiving_origin": {"schema": SOURCE_STATE_SCHEMA,
                                 "state": describe_file(target.parent, state_copy)},
        }
        atomic_json(target, receipt, immutable=True)
        return {**receipt, "receiving_path": str(target)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--run-id", help="Existing original Workspace baseline run ID")
    parser.add_argument("--receiving-state", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    result = prepare(args.workspace, run_id=args.run_id,
                     receiving_state=args.receiving_state, output=args.output)
    print(json.dumps(result, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
