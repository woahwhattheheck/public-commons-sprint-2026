#!/usr/bin/env python3
"""Continue an actual original Gura class plan through paired robustness."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--application", type=Path, required=True)
    p.add_argument("--receiving", type=Path, required=True)
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--workspace", type=Path)
    p.add_argument("--resolution-m", type=float, action="append", default=[],
                   help="Additional resolutions; original grid is always retained")
    p.add_argument("--buffer-m", type=float, action="append", default=[],
                   help="Additional domain buffers at the original resolution")
    p.add_argument("--threshold-factor", type=float, action="append",
                   help="Physical stream-initiation area factors (default 0.5 and 2)")
    p.add_argument("--original-parameters-only", action="store_true",
                   help="Keep threshold sensitivity without the full native parameter design")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--completed-only", action="store_true")
    p.add_argument("--title", default="Gura paired land-cover robustness")
    p.add_argument("--purpose", default=(
        "Determine whether modeled nitrogen, phosphorus and sediment benefits and the ordering "
        "of explicitly selected land-cover alternatives persist across native parameter choices, "
        "stream-initiation areas and declared spatial grids."))
    p.add_argument("--output", type=Path, help="Copy the source-bound report to a separate directory")
    return p

def main(argv=None):
    args = parser().parse_args(argv)
    if args.execute and args.completed_only:
        raise ValueError("Choose native execution or completed-result synchronization")
    application = args.application.resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model.common import atomic_bytes, atomic_json, describe_file, digest, held
    from model import paired_robustness
    from source_tools import gura_comparison
    from source_tools.receive_gura_studies import axes_for
    receiving_bytes = args.receiving.read_bytes()
    plan_bytes = args.plan.read_bytes()
    workspace = Workspace(args.workspace) if args.workspace else None
    path, plan_path, receipt, ws, grid, profile, baseline, plan = gura_comparison._check_plan(
        args.receiving, args.plan, workspace=workspace)
    if receiving_bytes != path.read_bytes() or plan_bytes != plan_path.read_bytes():
        raise ValueError("Original receiving or class-plan bytes changed during admission")
    if json.loads(plan_bytes) != plan or json.loads(receiving_bytes) != receipt:
        raise ValueError("Selected source bytes differ from the validated original Gura records")
    reference = ws.prepare_run({"grid_id": grid["id"], "profile_id": profile["id"],
                                "scenario_id": baseline["id"],
                                "models": receipt.get("models", ["ndr", "sdr"])})
    if reference["state"] != "complete":
        raise ValueError("Complete the actual first Gura baseline before this continuation: " + reference["id"])
    with held(ws.root / ".workspace.lock", blocking=False):
        scenarios = [ws.save_scenario(row["scenario"])["id"] for row in plan["cases"]]
    models = receipt.get("models", ["ndr", "sdr"])
    scope = "both" if set(models) == {"ndr", "sdr"} else models[0]
    variants = [{"name": "Resolution " + str(v) + " m", "resolution_m": v}
                for v in args.resolution_m]
    variants += [{"name": "Domain buffer " + str(v) + " m", "upstream_buffer_m": v}
                 for v in args.buffer_m]
    selection = {
        "title": args.title, "purpose": args.purpose, "baseline_run_id": reference["id"],
        "scenario_ids": scenarios, "axes": [] if args.original_parameters_only else axes_for(scope),
        "threshold_factors": args.threshold_factor if args.threshold_factor is not None else [0.5, 2],
        "spatial_variants": variants, "zones": plan["zones"],
        "source_binding": {
            "gura_plan_id": plan["id"], "plan_sha256": hashlib.sha256(plan_bytes).hexdigest(),
            "receiving_sha256": hashlib.sha256(receiving_bytes).hexdigest(),
            "workspace_id": ws.project["id"], "source_collection_id": plan["source_collection_id"],
            "original_programme_id": plan["original_programme_id"],
            "cases": [{"key": case["key"], "scenario_id": sid, "source_class": case["source_class"],
                       "target_class": case["target_class"]}
                      for case, sid in zip(plan["cases"], scenarios)]}}
    prepared = paired_robustness.prepare(ws, selection)
    directory = ws.root / "paired-robustness" / prepared["id"]
    with held(directory / ".operation.lock", blocking=False):
        atomic_bytes(directory / "original-receiving.json", receiving_bytes, immutable=True)
        atomic_bytes(directory / "original-class-plan.json", plan_bytes, immutable=True)
    print(json.dumps({"state": "prepared", "id": prepared["id"], "workspace": str(ws.root),
                      "baseline_run_id": reference["id"], "scenario_ids": scenarios}, sort_keys=True), flush=True)
    result = prepared
    if args.execute or args.completed_only:
        result = paired_robustness.execute(ws, prepared["id"], completed_only=args.completed_only,
            progress=lambda value: print(json.dumps(value, sort_keys=True), flush=True))
    if args.output:
        target = args.output.resolve()
        if any(target == protected or target.is_relative_to(protected) or protected.is_relative_to(target)
               for protected in (ws.root.resolve(), application)):
            raise ValueError("Choose an export outside the Workspace and application source trees and their ancestors")
        target.mkdir(parents=True, exist_ok=True)
        with held(directory / ".operation.lock", blocking=False), held(target / ".export.lock", blocking=False):
            marker = target / "export.json"
            if marker.exists() and json.loads(marker.read_bytes()).get("id") != result["id"]:
                raise ValueError("The export destination contains another selected robustness study")
            inventory = []
            for source in sorted(directory.rglob("*")):
                if source.is_file() and not source.name.endswith(".lock"):
                    relative = source.relative_to(directory)
                    atomic_bytes(target / relative, source.read_bytes())
                    inventory.append(describe_file(target, target / relative))
            atomic_json(marker, {"schema": "upstate.paired-robustness-export/v1",
                "id": result["id"], "workspace_id": ws.project["id"],
                "state": result["state"], "files": inventory})
        result = {**result, "output": str(target)}
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0 if result["state"] in ("prepared", "complete") else 2

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr, flush=True)
        raise SystemExit(1)
