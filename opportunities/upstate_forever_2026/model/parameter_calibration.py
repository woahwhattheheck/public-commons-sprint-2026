"""Connect completed parameter-study cases to original annual-load calibration."""
from __future__ import annotations

import argparse
import json

from .common import digest, identifier
from . import calibration, parameter_studies

SCHEMA = "upstate.parameter-study-calibration/v1"


def candidates(workspace, experiment_id, *, candidate_run_ids=None):
    """Read actual study/run identities; never execute models or choose observations."""
    key = identifier(experiment_id)
    study = parameter_studies.inspect(workspace, key)
    baseline = study["baseline_selection"]
    scenario = workspace._get("scenarios", baseline["scenario_id"])
    issues = []
    if scenario.get("kind") != "baseline" or scenario.get("patches"):
        issues.append("This study changes land cover. Annual-load calibration uses the original unchanged baseline scenario.")
    by_run = {}
    for case in study["cases"]:
        row = by_run.setdefault(case["run_id"], {
            "run_id": case["run_id"], "profile_id": case["profile_id"],
            "state": case["state"], "case_ids": [], "labels": [], "overrides": [],
            "is_reference": False,
        })
        row["case_ids"].append(case["id"])
        row["labels"].append(case["label"])
        row["overrides"].append(case.get("overrides", {}))
        row["is_reference"] = row["is_reference"] or case["id"] == "baseline"
    eligible, excluded = [], []
    for row in by_run.values():
        reasons = list(issues)
        if row["state"] != "complete":
            reasons.append("Complete this native run before using its predicted annual loads.")
        if reasons:
            excluded.append({**row, "reasons": reasons})
            continue
        # The producing-stage engine owns native version and physical-output
        # admission. Preserve each original request; it is not an execution label.
        try:
            candidate = calibration._candidates(workspace, {"candidate_run_ids": [row["run_id"]]})[0]
        except (ValueError, KeyError, OSError) as error:
            excluded.append({**row, "reasons": ["Original native candidate: " + str(error)]})
            continue
        native = {name: candidate[name] for name in (
            "native_versions", "native_version_labels", "output_mass_basis",
            "native_outputs", "execution_fingerprint", "execution_issues")
                  if name in candidate}
        retained = {**row, "title": candidate["title"],
                    "selected_models": candidate["selected_models"],
                    "available_parameters": candidate["available_parameters"],
                    "model_period": candidate["model_period"],
                    "run_selection": candidate["selection"], **native}
        if candidate.get("execution_issues"):
            excluded.append({**retained, "reasons": list(candidate["execution_issues"])})
        else:
            eligible.append(retained)
    available_ids = [row["run_id"] for row in eligible]
    if candidate_run_ids is None:
        chosen = available_ids
    else:
        if (not isinstance(candidate_run_ids, list) or not candidate_run_ids
                or any(not isinstance(value, str) for value in candidate_run_ids)
                or len(set(candidate_run_ids)) != len(candidate_run_ids)):
            raise ValueError("Select distinct completed original run IDs from this study.")
        for run_id in candidate_run_ids:
            identifier(run_id)
        if set(candidate_run_ids) - set(available_ids):
            raise ValueError("Every calibration candidate must be a completed unchanged-baseline run in this study.")
        requested = set(candidate_run_ids)
        chosen = [run_id for run_id in available_ids if run_id in requested]
    selected_rows = [row for row in eligible if row["run_id"] in chosen]
    shared = set.intersection(*(set(row["available_parameters"]) for row in selected_rows)) if selected_rows else set()
    common = [parameter for parameter in calibration.PARAMETERS if parameter in shared]
    if selected_rows:
        calibration._candidates(workspace, {"candidate_run_ids": chosen})
    reference = next((row["run_id"] for row in selected_rows if row["is_reference"]), None)
    selection_sha256 = digest(study["selection"])
    note = ("Parameter study " + key + "; retained selection " + selection_sha256
            + "; original baseline " + str(study["selection"]["baseline_run_id"])
            + "; design " + str(study["selection"]["design"]) + ".")
    handoff = {
        "schema": SCHEMA, "study_id": key, "workspace_id": workspace.project["id"],
        "study_selection_sha256": selection_sha256,
        "title": study["selection"]["title"] + " · annual-load calibration",
        "candidate_run_ids": chosen, "grid_id": baseline["grid_id"],
        "scenario_id": baseline["scenario_id"], "notes": [note],
        "common_parameters": common,
    }
    if reference:
        handoff["reference_run_id"] = reference
    return {
        "schema": SCHEMA, "workspace_id": workspace.project["id"], "study_id": key,
        "title": study["selection"]["title"], "study_state": study["state"],
        "selection_sha256": selection_sha256, "baseline_selection": baseline,
        "eligible": eligible, "excluded": excluded, "issues": issues,
        "eligible_count": len(eligible), "excluded_count": len(excluded),
        "case_count": len(study["cases"]), "unique_run_count": len(by_run),
        "selected_count": len(chosen), "common_parameters": common,
        "can_calibrate": bool(chosen and common), "handoff": handoff,
        "method": ("Candidate eligibility uses the completed native run and the producing-stage calibration engine. "
                   "Each original requested version remains separate from its retained execution provenance and "
                   "physical output convention. A case with an unavailable or incompatible output remains visible "
                   "with its own reason while compatible cases remain selectable. "
                   "The original grid, baseline land cover and selected model outputs remain fixed. "
                   "The calibration desk selects original admitted annual observations, catchments, objective weights "
                   "and calibration/validation groups, and checks producing-version compatibility for the "
                   "models used by those positive-weight objectives."),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--study", required=True)
    parser.add_argument("--candidate-run-id", action="append")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    value = candidates(Workspace(args.workspace), args.study, candidate_run_ids=args.candidate_run_id)
    print(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
