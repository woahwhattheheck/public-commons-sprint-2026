"""Resolve retained paired inputs for the original paired-raster engine.

Run from the maintained application. This command reads the original selected
study graph and emits the existing upstate.ensemble-input/v1 contract. It never
runs a scientific model or changes a retained analysis.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

from .common import identifier
from .paired_ensemble.ensemble_store import fingerprint
from .paired_ensemble_study_transfer import KIND, _input_key


def describe_inputs(workspace, analysis_id):
    from .study_transfer import _Closure
    key = identifier(analysis_id)
    selection = {"title": "Original paired raster inputs", "include_related_results": False,
                 "roots": [{"kind": KIND, "id": key}]}
    closure = _Closure(workspace, selection).resolve()
    value = closure.read(KIND + "/" + key + "/analysis.json")
    record = deepcopy(closure.paired_ensemble_records[key])
    closure.assert_unchanged()
    record["title"] = value["selection"]["title"]
    record["original_selection"] = deepcopy(value["selection"])
    return record


def input_spec(workspace, analysis_id):
    record = describe_inputs(workspace, analysis_id)
    missing = record["unresolved_input_fingerprints"]
    if missing:
        raise ValueError("Retain the original physical raster inputs before continuing this analysis: "
                         + json.dumps(missing, sort_keys=True))
    selected = record["original_selection"]
    bindings = {_input_key(row): row for row in record["input_bindings"]}

    def source(role, member=None, pollutant=None, side=None):
        row = bindings[(role, member, pollutant, side)]
        path = Path(workspace.root) / row["path"]
        if fingerprint(path) != {name: row[name] for name in ("bytes", "sha256")}:
            raise ValueError("A retained original paired input changed before continuation.")
        return {"path": str(path.resolve()), "bytes": row["bytes"], "sha256": row["sha256"]}

    members = []
    for original in selected["members"]:
        row = {name: original.get(name) for name in
               ("id", "profile_id", "baseline_run_id", "alternative_run_id", "scenario_id")}
        row["rasters"] = {}
        for pollutant in selected["pollutants"]:
            pair = original["rasters"][pollutant]
            row["rasters"][pollutant] = {
                "units": pair["units"],
                "baseline": source("member_raster", original["id"], pollutant, "baseline"),
                "alternative": source("member_raster", original["id"], pollutant, "alternative"),
            }
        members.append(row)
    return {
        "schema": "upstate.ensemble-input/v1", "title": selected["title"],
        "purpose": selected["purpose"], "input_description": selected["input_description"],
        "input_kind": selected.get("input_kind", "explicit paired rasters"),
        "source_references": deepcopy(selected.get("source_references", [])),
        "members": members, "pollutants": deepcopy(selected["pollutants"]),
        "reporting_mask": source("reporting_mask")["path"],
        "quantiles": deepcopy(selected["quantiles"]), "support": selected["support"],
        "planned_member_count": selected["planned_member_count"],
        "improvement_thresholds": deepcopy(selected["improvement_thresholds"]),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--analysis-id", required=True)
    parser.add_argument("--describe", action="store_true",
                        help="Show exact original input availability and source bindings")
    parser.add_argument("--output", help="Write a new JSON file outside the scientific Workspace")
    args = parser.parse_args(argv)
    try:
        from .workspace import Workspace
        workspace = Workspace(args.workspace)
        value = describe_inputs(workspace, args.analysis_id) if args.describe else input_spec(workspace, args.analysis_id)
        body = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"
        if args.output:
            output = Path(args.output).resolve()
            if output.is_relative_to(Path(workspace.root).resolve()):
                raise ValueError("Keep the resolved receiving input file outside its original Workspace.")
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open("x", encoding="utf-8") as stream:
                stream.write(body)
            print(json.dumps({"analysis_id": args.analysis_id, "path": str(output), **fingerprint(output)}))
        else:
            print(body, end="")
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
