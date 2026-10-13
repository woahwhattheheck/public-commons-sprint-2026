"""Build upstream-connected source-water inventories from an existing study."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from .common import atomic_json, describe_file, digest, held, read_json, verify_file
from .receptors import build_inventory
from . import receptor_execution
from .workspace import Workspace


def build(workspace, selection):
    """Retain a complete native area/scenario export with deterministic identity."""
    source = dict(selection)
    baseline = workspace.inspect_run(source["baseline_run_id"])
    alternatives = [workspace.inspect_run(key) for key in source["scenario_run_ids"]]
    if not alternatives:
        raise ValueError("Select at least one completed scenario run")
    if len({run["id"] for run in [baseline] + alternatives}) != len(alternatives) + 1:
        raise ValueError("Select distinct baseline and scenario runs")
    grid = workspace.get_grid(baseline["selection"]["grid_id"])
    execution = receptor_execution.bind([baseline, *alternatives], grid_id=grid["id"],
                                         pollutants=source.get("comparison_pollutants"))
    identity = {"selection": source, "schema": "upstate.receptor-inventory/v1",
                "product_version": receptor_execution.PRODUCT_VERSION,
                "execution_signature": receptor_execution.signature(execution)}
    key = digest(identity)
    directory = workspace.root / "receptor-inventories" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "result.json"
    with held(directory / ".inventory.lock", blocking=False):
        if state_path.exists():
            result = read_json(state_path)
            if result.get("identity") != identity or result.get("native_execution") != execution:
                raise ValueError("Retained source-water inventory differs from its producing native outputs")
            for item in result["files"].values():
                verify_file(directory, item)
            return result
        priority_path = None
        if source.get("delivery_id"):
            from .common import identifier
            delivery_id = identifier(source["delivery_id"])
            delivery_root = workspace.root / "deliveries" / delivery_id
            delivery = read_json(delivery_root / "delivery-state.json")
            if delivery["selection"]["baseline_run_id"] != baseline["id"]:
                raise ValueError("Priority map delivery must use the selected baseline run")
            priority_path = verify_file(delivery_root, delivery["files"]["combined_priority"])
        product = build_inventory(workspace, source["receptor_spec"], grid, baseline, alternatives,
                                  directory, priority_path=priority_path, execution_binding=execution)
        result = {"id": key, **product["inventory"], "build_selection": source, "identity": identity}
        result["files"] = {**result["files"],
                           "inventory": describe_file(directory, directory / "inventory.json")}
        atomic_json(state_path, result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", help="Existing Upper Savannah scientific workspace")
    parser.add_argument("selection", help="JSON file with baseline_run_id, scenario_run_ids and receptor_spec")
    args = parser.parse_args(argv)
    result = build(Workspace(args.workspace), read_json(Path(args.selection)))
    print(json.dumps({"id": result["id"], "title": result["title"],
                      "areas": len(result["areas"]), "scenario_rows": len(result["scenario_exports"]),
                      "files": result["files"]}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
