"""Derive a separate simulated programme from one retained native footprint.

Uses the maintained footprint compiler and original programme pricing.
Does not run NDR/SDR, change the base programme, or save an Economic edition.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import date
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys

APP = Path(__file__).resolve().parents[1]
for location in (str(APP), str(APP / "operator")):
    if location not in sys.path:
        sys.path.insert(0, location)

from model import scenario_footprint
from model.common import describe_file, held
from model.implementation_schema import canonical_bytes, document_digest
from source_tools import apply_simulated_restoration_programme as original

SCHEMA = "upstate.native-restoration-programme-derivation/v1"
EDITION = "native-footprint-programme-20261013-v1"
TASKS = ("review", "design-layout", "site-preparation", "planting", "contingency", "maintenance")


def _date(value):
    original.require(isinstance(value, str), "Choose an explicit ISO start date.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Choose an explicit YYYY-MM-DD start date.") from exc
    original.require(parsed.isoformat() == value, "Use an exact YYYY-MM-DD start date.")
    return value


def _durations(value):
    original.require(isinstance(value, dict) and set(value) == set(TASKS),
                     "Declare all six task durations, with no unknown task IDs.")
    return {key: original.integer(value[key], "Duration for " + key) for key in TASKS}


def derive(workspace, base_programme, *, run_id, scenario_role, title,
           base_source_sha256, inherit_schedule=False, start_date=None,
           task_duration_days=None, footprint_id=None, catalogue=None):
    """Return a new design plus complete source records; no Economic/plan commit."""
    original.require(isinstance(title, str) and title.strip() and len(title) <= 300,
                     "Supply a nonblank programme title of at most 300 characters.")
    original.require(scenario_role in {"riparian_restoration", "matched_control"},
                     "Explicitly choose riparian_restoration or matched_control.")
    original.require(isinstance(base_source_sha256, str) and len(base_source_sha256) == 64
                     and all(ch in "0123456789abcdef" for ch in base_source_sha256),
                     "Retain the exact original base programme file SHA-256.")
    original.require(isinstance(inherit_schedule, bool), "Schedule inheritance must be explicit.")
    catalogue = catalogue if catalogue is not None else original.read(APP / original.CATALOGUE)
    # Validate the complete original assumptions/catalogue before deriving quantities.
    original.pricing(base_programme, catalogue)
    base = deepcopy(base_programme)
    if inherit_schedule:
        original.require(start_date is None and task_duration_days is None,
                         "Choose inherited schedule or explicit replacements, not both.")
        chosen_date = _date(base["programme"]["start_date"])
        chosen_durations = _durations(base["programme"]["task_duration_days"])
        schedule_basis = "Explicitly retain the original authored simulated schedule unchanged."
    else:
        chosen_date = _date(start_date)
        chosen_durations = _durations(task_duration_days)
        schedule_basis = "Explicit newly authored simulated schedule; no completed work is implied."

    footprint = (scenario_footprint.get_footprint(workspace, footprint_id)
                 if footprint_id else scenario_footprint.preview_run(workspace, run_id))
    run = workspace.inspect_run(run_id)
    original.require(footprint["run_id"] == run_id
                     and footprint["selection"] == run["selection"],
                     "The verified footprint belongs to a different original run selection.")
    grid = workspace.get_grid(run["selection"]["grid_id"])
    resolution = original.number(grid["grid"]["resolution_m"], "Native grid resolution", True)
    original.require(resolution == Decimal("30"), "This authored planting derivation requires a 30 m native grid.")
    summary = footprint["summary"]
    changed_cells = original.integer(summary["net_changed_cells"], "Native changed cells", True)
    changed_hectares = original.number(summary["net_changed_hectares"], "Native treatment hectares", True)
    transitions = []
    for row in footprint["transitions"]:
        source = original.integer(row["from_code"], "Original land-cover code")
        target = original.integer(row["to_code"], "Target land-cover code")
        cells = original.integer(row["cells"], "Transition cells")
        if source == target or not cells:
            continue
        original.require(source in {81, 82} and target == 41,
                         "This derivation admits only actual 81/82 to 41 transitions; review another design separately.")
        transitions.append({"from_code": source, "to_code": target, "cells": cells})
    transitions.sort(key=lambda row: (row["from_code"], row["to_code"]))
    original.require(transitions and len({(r["from_code"], r["to_code"]) for r in transitions}) == len(transitions),
                     "The retained transition table is empty or repeats a changed transition.")
    original.require(sum(row["cells"] for row in transitions) == changed_cells,
                     "The original transition counts differ from the net-change summary.")
    original.require(abs(changed_hectares - Decimal(changed_cells) * resolution * resolution / 10000)
                     <= Decimal("0.000000001"),
                     "The native changed-cell area is inconsistent with the 30 m grid.")
    native = {
        "project_id": workspace.project["id"], "run_id": run_id,
        "selection": deepcopy(run["selection"]), "footprint_id": footprint["id"],
        "footprint_files": deepcopy(footprint["files"]),
        "footprint_request": deepcopy(footprint["request"]),
        "footprint_summary": deepcopy(summary),
        "grid": deepcopy(grid), "source_transitions": deepcopy(footprint["transitions"]),
        "coefficient_columns": deepcopy(footprint.get("coefficient_columns", [])),
        "coefficient_rows": deepcopy(footprint.get("coefficient_rows", [])),
    }
    choice = {"scenario_role": scenario_role, "title": title,
              "schedule_mode": "inherited" if inherit_schedule else "explicit",
              "start_date": chosen_date, "task_duration_days": chosen_durations}
    identity = {"schema": SCHEMA, "edition": EDITION,
                "producer_sha256": original.sha(Path(__file__)),
                "binder_sha256": original.sha(Path(original.__file__)),
                "footprint_producer_sha256": original.sha(Path(scenario_footprint.__file__)),
                "base_source_sha256": base_source_sha256,
                "base_programme_sha256": document_digest(base),
                "catalogue_sha256": document_digest(catalogue),
                "native": native, "choice": choice}
    key = document_digest(identity)
    programme = deepcopy(base)
    programme["id"] = "native-restoration-" + key[:32]
    programme["title"] = title
    programme["version"] = EDITION
    programme["status"] = "authored_simulated_design_derived_from_verified_native_footprint"
    programme["scenario_role"] = scenario_role
    programme["role_interpretation"] = (
        "Explicit authored simulated role. The native footprint confirms selected cell transitions, "
        "not riparian width, site suitability, programme eligibility or work completion.")
    programme["expected_footprint"] = {
        "resolution_m": 30, "net_changed_cells": changed_cells,
        "net_changed_hectares": str(changed_hectares),
        "basis": "Verified net-change footprint of the exact selected native run; reporting-zone area is not a treatment quantity.",
        "source_reference": "scenario-footprints/" + footprint["id"],
        "changed_transitions": transitions,
    }
    programme["programme"]["title"] = title
    programme["programme"]["start_date"] = chosen_date
    programme["programme"]["task_duration_days"] = chosen_durations
    programme["programme"]["date_basis"] = schedule_basis
    programme["programme"]["monitoring_note"] = (
        "Original annual modeled outputs describe an established land-cover endpoint annual-equivalent. "
        "They do not describe first-year seedlings; establishment lag, mortality and site suitability "
        "are not modeled by this authored cost design.")
    if not inherit_schedule:
        programme["programme"]["maintenance_recurrence"] = (
            "Initial inspection duration is explicitly set to " + str(chosen_durations["maintenance"]) +
            " days. Recurring maintenance remains a separately planned activity within the inherited "
            "annual allowance; no recurring dates, completed visits or actual expenses are implied. "
            "The original recurrence wording is retained in native_derivation.base_programme.")
    if scenario_role == "matched_control":
        programme["programme"]["benchmark_applicability"] = (
            "The retained FY25 391 planting row is an explicitly authored comparative planting benchmark "
            "for this matched control. It does not establish riparian location, minimum buffer width, "
            "practice eligibility, available assistance or a current installed quote.")
    programme["native_derivation"] = {
        "schema": SCHEMA, "operation_id": key, "identity": identity,
        "base_programme": base,
        "inherited_assumptions": [
            "Original planting method, density/species allocation and historical catalogue sources.",
            "Original authored preparation/layout, contingency and annual maintenance assumptions.",
            "Original exclusions, horizon and real discount rate; no actual expense or assistance deduction.",
        ],
        "meaning": "A separate source-bound simulated design. The original programme and completed model outputs are unchanged.",
    }
    priced = original.pricing(programme, catalogue)
    # The existing binder independently enforces its unchanged public footprint contract.
    checked = original._footprint(workspace, run_id, programme, footprint["id"])
    original.require(checked["id"] == footprint["id"], "The retained native footprint changed during derivation.")
    return {"schema": SCHEMA, "edition": EDITION, "operation_id": key, "identity": identity,
            "programme": programme, "pricing": priced, "footprint": deepcopy(footprint),
            "base_programme": base, "catalogue": deepcopy(catalogue),
            "meaning": "Ready for the original binder's explicit report/zone/run preview. No Economic edition, plan or model execution was created."}


def retain(workspace, result, directory):
    """Retain one immutable complete derivation in a separate output directory."""
    root = Path(directory).resolve()
    destination = root / result["operation_id"]
    members = {
        "programme.json": result["programme"], "base-programme.json": result["base_programme"],
        "footprint.json": result["footprint"], "pricing.json": result["pricing"],
        "catalogue.json": result["catalogue"], "derivation.json": result["identity"],
    }
    with held(root / (result["operation_id"] + ".lock")):
        original.require(not destination.is_symlink(), "The derived programme directory cannot be a symlink.")
        for name, value in members.items():
            path = destination / name
            original.require(not path.is_symlink(), "A retained derivation member cannot be a symlink.")
            if path.exists():
                original.require(path.is_file() and path.read_bytes() == canonical_bytes(value) + b"\n",
                                 "A different derivation member already exists: " + str(path))
        for name, value in members.items():
            original.save(destination / name, value)
        files = [describe_file(destination, destination / name) for name in sorted(members)]
    return {"schema": SCHEMA, "state": "retained", "operation_id": result["operation_id"],
            "project_id": workspace.project["id"], "run_id": result["identity"]["native"]["run_id"],
            "footprint_id": result["identity"]["native"]["footprint_id"],
            "programme_path": str(destination / "programme.json"), "directory": str(destination),
            "files": files, "scenario_role": result["programme"]["scenario_role"],
            "expected_footprint": result["programme"]["expected_footprint"],
            "schedule": result["identity"]["choice"], "pricing": result["pricing"],
            "next": "Use programme_path with the unchanged apply_simulated_restoration_programme report/zone/run preview, then apply only its exact returned operation_id."}


def main(argv=None):
    from model.workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--footprint-id")
    parser.add_argument("--base-programme", default=str(APP / original.DEFAULT))
    parser.add_argument("--catalogue", default=str(APP / original.CATALOGUE))
    parser.add_argument("--scenario-role", required=True, choices=("riparian_restoration", "matched_control"))
    parser.add_argument("--title", required=True)
    schedule = parser.add_mutually_exclusive_group(required=True)
    schedule.add_argument("--inherit-schedule", action="store_true",
                          help="Explicitly retain the base programme's authored start date and all six durations.")
    schedule.add_argument("--start-date", help="Explicit new YYYY-MM-DD start date; requires all six --task-duration values.")
    parser.add_argument("--task-duration", action="append", default=[], metavar="TASK=DAYS")
    parser.add_argument("--output-directory", required=True, help="Separate derived-programme collection; never overwrites the base.")
    args = parser.parse_args(argv)
    durations = None
    if args.task_duration:
        durations = {}
        for item in args.task_duration:
            name, separator, value = item.partition("=")
            original.require(separator and name not in durations, "Use each TASK=DAYS once.")
            durations[name] = original.integer(value, "Duration for " + name)
    base_path = Path(args.base_programme)
    raw = base_path.read_bytes()
    programme = json.loads(raw.decode("utf-8-sig"))
    ws = Workspace(args.workspace)
    result = derive(ws, programme, run_id=args.run_id, scenario_role=args.scenario_role,
                    title=args.title, base_source_sha256=hashlib.sha256(raw).hexdigest(),
                    inherit_schedule=args.inherit_schedule, start_date=args.start_date,
                    task_duration_days=durations, footprint_id=args.footprint_id,
                    catalogue=original.read(args.catalogue))
    print(json.dumps(retain(ws, result, args.output_directory), indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
