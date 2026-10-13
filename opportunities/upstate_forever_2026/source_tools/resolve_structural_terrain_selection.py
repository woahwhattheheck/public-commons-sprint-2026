"""Resolve WO22 terrain selections from the four already completed originals.

Reads the maintained Workspace and original terrain-response records. It never
prepares a grid/profile/run, dispatches a task, or changes the source Workspace.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import stat
import sys

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))

from model.common import atomic_json, canonical, describe_file, digest, read_json
from model.workspace import Workspace
from model.structural_studies import StructuralStudies
from model.verified_files import verified_operation
from source_tools.terrain_conditioning_response import inspect as inspect_response

PROJECT_ID = "1b6a344c-df5a-4986-a5e4-47a2d158324b"
CASE_ID = "658a363d919dcd72d7fd666b588a1862c472d10cbf37e86e62358d3804371a45"
RESPONSE_ID = "f9985d3897c6c806abd7de9279ce4e66ad4748db61d51123dde60ac9d7fc6445"
REFERENCE_RUN = "4b5ea04c911dbbf16a8f214c884a9fbf69c96cc718b2063b1ade9e221aa8e4fc"
CASE_RUNS = {
    "6a8067a5d03e24338204970b1291a18acf6ee94eab99a82e03686b8b417572a9",
    "85ccbc533ed8d1b9896be4825e7e7870b3dee4111393fe416bddc84b61eb483e",
    "b2366163904e5e2795a0fe12a3bbd7ee71e394a10f2315d5d9fa90e71b398f2e",
}
DELIVERY_URL = "https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791913117693809"
SOURCE_GUIDE = ("https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/"
                "bf128ad3580a2b0b68502a868f14b2955adf828f/"
                "opportunities/upstate_forever_2026/source_tools/TERRAIN_CONDITIONING.md")
SCHEMA = "upstate.structural-terrain-original-selection/v1"


def need(condition, message):
    if not condition:
        raise ValueError(message)


def same(left, right):
    return canonical(left) == canonical(right)


class OriginalRecords:
    def __init__(self, root):
        self.root = root
        self.items = {}

    def capture(self, relative):
        path = self.root / relative
        need(path.resolve().is_relative_to(self.root), "Original record escapes the selected Workspace")
        before = path.lstat()
        need(stat.S_ISREG(before.st_mode), "Choose ordinary original metadata: " + relative)
        raw = path.read_bytes()
        after = path.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(identity(before) == identity(after) and len(raw) == after.st_size,
             "Original metadata changed while reading: " + relative)
        value = json.loads(raw.decode("utf-8"))
        item = {"path": relative, "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "content_utf8": raw.decode("utf-8"), "body": value}
        if relative in self.items:
            need(same(self.items[relative], item), "Original metadata changed during selection")
        self.items[relative] = item
        return deepcopy(value)

    def require_result(self, relative, result, *, added_id=None):
        body = self.capture(relative)
        expected = {**body, "id": added_id} if added_id is not None else body
        need(same(expected, result), "Maintained reader and original bytes differ: " + relative)

    def recheck(self):
        for relative in list(self.items):
            self.capture(relative)


@verified_operation
def resolve_originals(workspace_path, output_path):
    workspace_root = Path(workspace_path).resolve()
    output = Path(output_path).resolve()
    need(not output.is_relative_to(workspace_root) and not output.is_relative_to(APP),
         "Keep receiving outputs outside the original Workspace and application")
    need(not workspace_root.is_relative_to(output) and not APP.is_relative_to(output),
         "Choose a dedicated receiving subdirectory, not an ancestor of the original sources")
    ws = Workspace(workspace_root)
    need(ws.project["id"] == PROJECT_ID, "Select the original completed terrain Workspace")
    originals = OriginalRecords(ws.root)
    originals.require_result("workspace.json", ws.project)
    selected = ws._get("terrain-conditioning-responses", RESPONSE_ID)
    originals.require_result("terrain-conditioning-responses/" + RESPONSE_ID + ".json",
                             selected, added_id=RESPONSE_ID)
    need(selected.get("case_id") == CASE_ID and selected.get("baseline_run_id") == REFERENCE_RUN,
         "The retained terrain response names another original case or reference")
    alternatives = selected.get("alternatives")
    need(isinstance(alternatives, list) and len(alternatives) == 3
         and {row.get("run_id") for row in alternatives} == CASE_RUNS,
         "Use the three actual published completed terrain runs once each")
    # The original inspector verifies every retained response/output descriptor.
    response = inspect_response(ws, RESPONSE_ID)
    need(response.get("state") == "complete" and same(response.get("selection"), selected),
         "The original terrain response is not complete or changed its source selection")
    originals.require_result("terrain-conditioning-response-output/" + RESPONSE_ID + "/result.json",
                             response)
    records, cases = {}, []
    for run_id in [REFERENCE_RUN, *[row["run_id"] for row in alternatives]]:
        run = ws.inspect_run(run_id)
        need(run.get("state") == "complete", "Original native run is not complete: " + run_id)
        originals.require_result("runs/" + run_id + "/run.json", run)
        binding = run["selection"]
        grid = ws.get_grid(binding["grid_id"])
        profile = ws._get("profiles", binding["profile_id"])
        scenario = ws._get("scenarios", binding["scenario_id"])
        originals.require_result("grids/" + binding["grid_id"] + "/grid.json", grid)
        originals.require_result("profiles/" + binding["profile_id"] + ".json",
                                 profile, added_id=binding["profile_id"])
        originals.require_result("scenarios/" + binding["scenario_id"] + ".json",
                                 scenario, added_id=binding["scenario_id"])
        records[run_id] = {"run": run, "grid": grid, "profile": profile, "scenario": scenario}
    for row in alternatives:
        run_id = row["run_id"]
        need(isinstance(row.get("variant"), str) and row["variant"].strip(),
             "Retain the original terrain variant label")
        need(isinstance(row.get("burn_depth_m"), (int, float))
             and not isinstance(row["burn_depth_m"], bool) and row["burn_depth_m"] > 0,
             "Retain the actual original positive burn-depth metadata")
        cases.append({
            "id": "terrain-" + run_id[:24],
            "label": row["variant"] + " — original " + str(row["burn_depth_m"]) + " m conditioning",
            "grid_id": records[run_id]["run"]["selection"]["grid_id"],
            "existing_run_id": run_id,
            "reason": ("Compare this already completed " + row["variant"]
                       + " terrain edition with the unchanged original reference. The burn depth "
                       + str(row["burn_depth_m"])
                       + " m comes from the retained response record; it is not inferred from run order."),
            "references": [DELIVERY_URL, SOURCE_GUIDE,
                           "Original terrain case " + CASE_ID + "; response " + RESPONSE_ID],
        })
    selection = {
        "schema": "upstate.structural-study-selection/v1",
        "title": "Original 30 m teaching cohort — completed terrain editions",
        "purpose": ("Inspect source-native terrain sensitivity on the four retained completed runs. "
                    "WO22 uses pairwise geographic valid support; the earlier terrain response uses "
                    "common support across all four runs. Preserve both original results and their "
                    "different support definitions. This simulated teaching cohort does not establish "
                    "empirical predictive improvement or replace the ordinary 30 m production delivery."),
        "family": "terrain", "reference_run_id": REFERENCE_RUN,
        "references": [DELIVERY_URL, SOURCE_GUIDE,
                       "Original teaching/source classification: " + str(response.get("source_classification"))],
        "cases": cases,
    }
    preview = StructuralStudies(ws).preview(selection)
    need(same(preview.get("selection"), selection), "The native preview changed the retained selection")
    # Capture the full verified source editions chosen by every original grid.
    source_ids = sorted({item["grid"]["spec"]["source_collection_id"] for item in records.values()})
    sources = {}
    for source_id in source_ids:
        sources[source_id] = ws._get("sources", source_id)
        originals.require_result("sources/" + source_id + ".json",
                                 sources[source_id], added_id=source_id)
    originals.recheck()
    proof = {
        "schema": SCHEMA, "project_id": PROJECT_ID, "case_id": CASE_ID, "response_id": RESPONSE_ID,
        "selection": selection, "selection_sha256": digest(selection),
        "source_response": response, "source_selection": selected,
        "original_runs": records, "original_source_collections": sources,
        "original_record_bytes": list(originals.items.values()),
        "native_preview": preview,
        "interpretation": {
            "native_model_runs_started": 0,
            "grid_profile_or_run_records_created": 0,
            "depth_to_run_mapping": "Read from the original immutable alternatives; never positional.",
            "support": "Original all-run common support and WO22 pairwise support remain distinct.",
            "receiving": "An eligible preview is a source-readiness observation, not an executed study/report.",
        },
    }
    # Use the maintained atomic immutable writer. An exact repeat reuses these
    # bytes; a different selected source cannot overwrite the first handoff.
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "selection.json", selection, immutable=True)
    atomic_json(output / "original-records-and-preview.json", proof, immutable=True)
    receipt = {"schema": SCHEMA, "state": "SOURCE_SELECTION_READY" if preview["eligible"] else "SOURCE_REVIEW_REQUIRED",
               "project_id": PROJECT_ID, "case_id": CASE_ID, "response_id": RESPONSE_ID,
               "reference_run_id": REFERENCE_RUN, "case_run_ids": [row["run_id"] for row in alternatives],
               "selection_sha256": digest(selection), "eligible": preview["eligible"],
               "issues": preview["issues"], "files": {
                   "selection": describe_file(output, output / "selection.json"),
                   "original_records": describe_file(output, output / "original-records-and-preview.json")}}
    atomic_json(output / "receipt.json", receipt, immutable=True)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    receipt = resolve_originals(args.workspace, args.output)
    print(json.dumps(receipt, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    return 0 if receipt["eligible"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
