"""Operate the exact matcher on the retained original demonstration sources.

This source-bound comparison does not edit a Workspace, launch InVEST, or replace
an accepted mask. It writes complete pair data and an offline operating report.
"""
from __future__ import annotations
import argparse
import csv
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import time

import numpy as np

HERE = Path(__file__).resolve().parent
APP = HERE.parent if HERE.name == "source_tools" else HERE
# Both the native application tree and a flat, independently received package
# load this exact adjacent kernel without depending on the sender's sys.path.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from precipitation_matching import match_precipitation, METHOD

ORIGINALS = {
    "generate-inputs.mjs": "f1acf0f2a1470e059ad5f5b8231178ae59876954",
    "generate-matched-control.mjs": "7d778123ef8305fdd17c1637192c69399c5efac5",
}
FIELDS = ("from_code", "target_index", "control_index", "legacy_control_index",
          "target_row", "target_col", "control_row", "control_col",
          "target_precipitation_mm_year", "control_precipitation_mm_year",
          "precipitation_residual_mm_year", "legacy_precipitation_residual_mm_year")


def descriptor(path: Path) -> dict:
    body = path.read_bytes()
    return {"path": path.name, "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "git_blob": hashlib.sha1(f"blob {len(body)}\0".encode() + body).hexdigest()}


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def operate(source: Path, output: Path, *, node: str = "node") -> dict:
    source = source.resolve(strict=True)
    output = output.resolve()
    originals = {}
    for name, expected in ORIGINALS.items():
        info = descriptor(source / name)
        if info["git_blob"] != expected:
            raise ValueError(f"Original source changed: {name}; explicitly review a successor before replay")
        originals[name] = info
    # Create-only delivery protects an earlier operated edition or another seat's files.
    output.mkdir(parents=True, exist_ok=False)
    for name in ORIGINALS:
        shutil.copyfile(source / name, output / name)
    for name in ("precipitation_matching.py", "precipitation_matching_course.py", "precipitation_matching_report.html"):
        shutil.copyfile(Path(__file__).with_name(name), output / name)
    for name in ("CURRENT_OWNER_DIRECTION.md", "MATCHED_CONTROL_MATCHING.md"):
        companion = APP / name
        if companion.is_file():
            shutil.copyfile(companion, output / name)
    script = r'''
import fs from 'node:fs';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
const root=process.argv[1];
const {buildInputs}=await import(pathToFileURL(root+'/generate-inputs.mjs'));
const {buildMatchedControl}=await import(pathToFileURL(root+'/generate-matched-control.mjs'));
const recipe=buildInputs(), text=JSON.stringify(recipe,null,2)+'\n';
fs.writeFileSync(root+'/input-recipe.json',text);
const sha=crypto.createHash('sha256').update(text).digest('hex');
const began=performance.now();const legacy=buildMatchedControl(recipe,sha);
const elapsed=(performance.now()-began)/1000;
fs.writeFileSync(root+'/legacy-control.json',JSON.stringify(legacy,null,2)+'\n');
console.log(JSON.stringify({elapsed_seconds:elapsed,node:process.version,recipe_sha256:sha}));
'''
    proc = subprocess.run([node, "--input-type=module", "-e", script, str(output)],
                          capture_output=True, text=True, check=True)
    native = json.loads(proc.stdout)
    recipe = json.loads((output / "input-recipe.json").read_text())
    legacy = json.loads((output / "legacy-control.json").read_text())
    lc = np.asarray(recipe["arrays"]["NLCD"])
    rainfall = np.asarray(recipe["arrays"]["PRECIPITATION"], dtype=np.float64)
    corridor = np.asarray(recipe["arrays"]["RESTORATION_MASK"])
    width = recipe["grid"]["width"]
    pairs, classes = [], []
    for code in recipe["scenario"]["from_codes"]:
        targets = np.flatnonzero((lc == code) & (corridor == 1))
        candidates = np.flatnonzero((lc == code) & (corridor == 0))
        started = time.perf_counter()
        result = match_precipitation(rainfall[targets], rainfall[candidates],
                                     target_ids=targets, candidate_ids=candidates)
        elapsed = time.perf_counter() - started
        controls = candidates[result.candidate_positions]
        previous = {row["target_index"]: row for row in legacy["matching"]["pairs"] if row["from_code"] == code}
        old_cost = sum((abs(Fraction(row["control_precipitation_mm_year"]) - Fraction(row["target_precipitation_mm_year"]))
                        for row in previous.values()), Fraction(0))
        exact_cost = Fraction(result.objective_integer) * Fraction(2) ** result.objective_binary_exponent
        if exact_cost != old_cost:
            raise ArithmeticError(f"Exact original objective differs for class {code}: {exact_cost} vs {old_cost}")
        if len(np.unique(controls)) != targets.size or np.any(corridor[controls] != 0) or np.any(lc[controls] != code):
            raise ArithmeticError("Original disjoint class/area support was not preserved")
        residual = rainfall[controls] - rainfall[targets]
        for target, control in zip(targets.tolist(), controls.tolist()):
            old = previous[target]
            pairs.append({"from_code": code, "target_index": target, "control_index": control,
                          "legacy_control_index": old["control_index"],
                          "target_row": target // width, "target_col": target % width,
                          "control_row": control // width, "control_col": control % width,
                          "target_precipitation_mm_year": float(rainfall[target]),
                          "control_precipitation_mm_year": float(rainfall[control]),
                          "precipitation_residual_mm_year": float(rainfall[control] - rainfall[target]),
                          "legacy_precipitation_residual_mm_year": old["precipitation_residual_mm_year"]})
        classes.append({**result.metadata(), "from_code": code,
                        "changed_area_ha": targets.size * recipe["grid"]["pixel_area_ha"],
                        "mean_absolute_residual_mm_year": math.fsum(np.abs(residual)) / targets.size if targets.size else 0,
                        "maximum_absolute_residual_mm_year": float(np.abs(residual).max(initial=0)),
                        "precipitation_sum_residual_mm_year": math.fsum(residual),
                        "legacy_objective_equal_exactly": True,
                        "legacy_objective_sum_absolute_mm_year": float(old_cost),
                        "retained_legacy_selected_cells": len(set(controls.tolist()) & {p["control_index"] for p in previous.values()}),
                        "elapsed_seconds": elapsed})
    selected = {r["control_index"] for r in pairs}
    if len(selected) != recipe["input_summary"]["changed_cells"]:
        raise ArithmeticError("Combined exact control differs from the original changed area")
    with (output / "pairs.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader(); writer.writerows(pairs)
    summary = {"schema": "upstate.exact-rainfall-matching-comparison/v1", "method": METHOD,
               "title": "Exact matched-control input comparison",
               "classification": recipe["classification"], "demo_id": recipe["demo_id"],
               "original_sources": originals, "input_recipe": descriptor(output / "input-recipe.json"),
               "kernel": descriptor(output / "precipitation_matching.py"),
               "grid": recipe["grid"], "changed_cells": len(selected),
               "changed_area_ha": len(selected) * recipe["grid"]["pixel_area_ha"],
               "corridor_overlap_cells": 0, "classes": classes,
               "legacy_execution": native, "python": sys.version, "numpy": np.__version__,
               "current_owner_direction": {"path": "CURRENT_OWNER_DIRECTION.md", "version": "2026-10-13.3"},
               "interpretation": [
                   "Retained simulated Piedmont input case: 120 by 120 cells, 30 m, 1,296 hectares.",
                   "Targets, original land-cover counts, area and complete corridor exclusion stay fixed.",
                   "Each class minimizes total absolute precipitation mismatch using exact original float64 values.",
                   "The method's explicit symbolic tie convention can select different cells at equal minimum cost. Existing saved controls remain unchanged.",
                   "Rainfall matching does not match soil, erosivity, terrain, stream distance, routing, shape or upstream area.",
                   "Input mismatch statistics are not native NDR/SDR stream-load outputs. Regional native execution is a separate retained operation."]}
    write_json(output / "comparison.json", summary)
    data = {"summary": summary, "pairs": pairs, "corridor": recipe["arrays"]["RESTORATION_MASK"],
            "landcover": recipe["arrays"]["NLCD"]}
    template = (output / "precipitation_matching_report.html").read_text(encoding="utf-8")
    payload = json.dumps(data, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    (output / "report.html").write_text(template.replace("__MATCHING_DATA__", payload), encoding="utf-8")
    write_json(output / "delivery.json", {"schema": "upstate.complete-matching-course/v1",
               "method": METHOD, "entrypoint": "report.html",
               "files": [descriptor(p) for p in sorted(output.iterdir()) if p.is_file()]})
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=(HERE if (HERE / "generate-inputs.mjs").is_file() else APP / "source" / "simulated_headwaters_20261013"))
    parser.add_argument("--output", type=Path, required=True, help="New directory for complete recipient files")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    result = operate(args.source, args.output, node=args.node)
    print(json.dumps({"output": str(args.output.resolve()), "changed_cells": result["changed_cells"],
                      "classes": result["classes"]}, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
