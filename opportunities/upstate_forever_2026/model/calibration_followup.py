"""Retain the scientific design when a selected profile returns for evaluation.

The original calibration and native Parameter study remain immutable. This
module describes reuse of reference records; candidate scoring stays in the
maintained calibration engine.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, identifier

SCHEMA = "upstate.calibration-followup/v1"
FIELDS = {"schema", "calibration_id", "plan_id", "parameter_study_id",
          "parameter_study_selection_sha256"}
DESIGN_FIELDS = (
    "observation_id", "catchments", "observation_record_ids", "catchment_groups",
    "calibration_group_ids", "validation_group_ids", "objective",
    "temporal_weighting", "delivered_external_loads", "leave_group_out",
)


def _selection(spec):
    value = {key: deepcopy(item) for key, item in spec.items() if key not in ("schema", "id")}
    value["schema"] = "upstate.parameter-experiment-selection/v1"
    return value


def resolve(workspace, binding):
    """Resolve exact original records without reading mutable run progress."""
    if (not isinstance(binding, dict) or set(binding) != FIELDS
            or binding.get("schema") != SCHEMA):
        raise ValueError("Retain the complete original calibration follow-up binding")
    report = workspace._get("calibrations", identifier(binding["calibration_id"]))
    plan = workspace._get("calibration-plans", identifier(binding["plan_id"]))
    spec = workspace._get("experiment-specs", identifier(binding["parameter_study_id"]))
    selection = _selection(spec)
    from .parameter_calibration import continuation_origin
    expected = continuation_origin(report, plan, workspace.project["id"])
    if (selection.get("calibration_origin") != expected
            or selection.get("baseline_run_id") != expected["selected_run_id"]
            or digest(selection) != binding["parameter_study_selection_sha256"]):
        raise ValueError("The follow-up changed its original selected-profile study")
    return report, plan, spec


def for_study(workspace, study):
    """Offer the original design to the ordinary editable Calibration form."""
    origin = study["selection"].get("calibration_origin")
    if not origin:
        return None
    binding = {
        "schema": SCHEMA, "calibration_id": origin["calibration_id"],
        "plan_id": origin["plan_id"], "parameter_study_id": study["id"],
        "parameter_study_selection_sha256": digest(study["selection"]),
    }
    report, plan, unused = resolve(workspace, binding)
    selection = deepcopy(plan["selection"])
    selection["title"] = study["selection"]["title"] + " · annual-reference follow-up"
    selection["prior_evaluation"] = binding
    return {
        "selection": selection, "prior_evaluation": binding,
        "title": report["title"],
        "description": (
            "This follow-up starts with the original observations, catchments, "
            "objective and training/validation split. Keep reserved groups outside "
            "parameter selection. Their previously viewed results remain part of "
            "the research history; repeating them is a follow-up evaluation."
        ),
        "original_reference_run_id": plan["selection"].get("reference_run_id"),
        "selected_run_id": report["selected_run_id"],
        "selected_validation": deepcopy(report.get("selected_validation")),
    }


def _records(units, partition, source_sha256):
    # Record IDs are source-local in general importers; identical labels in
    # different CSV bodies do not identify the same original observation.
    return {(source_sha256, record) for unit in units if unit.get("partition") == partition
            for record in unit["observation_record_ids"]}


def _ids(records):
    return sorted(record_id for unused_source, record_id in records)


def describe(workspace, selection, units):
    """Describe exact record reuse across all linked prior evaluations."""
    binding = selection.get("prior_evaluation")
    if binding is None:
        return None
    first = deepcopy(binding)
    history, visited = [], set()
    prior_training, prior_validation = set(), set()
    while binding is not None:
        report, plan, unused = resolve(workspace, binding)
        if report["id"] in visited:
            raise ValueError("The retained calibration history contains a repeated dependency")
        visited.add(report["id"])
        source_sha256 = plan["observations"]["original"]["sha256"]
        training = _records(plan["units"], "calibration", source_sha256)
        validation = _records(plan["units"], "validation", source_sha256)
        prior_training.update(training)
        prior_validation.update(validation)
        history.append({
            "calibration_id": report["id"], "plan_id": plan["id"],
            "parameter_study_id": binding["parameter_study_id"], "title": report["title"],
            "original_reference_run_id": plan["selection"].get("reference_run_id"),
            "selected_run_id": report["selected_run_id"],
            "selected_profile_id": report["selected_profile_id"],
            "observation_id": plan["selection"]["observation_id"],
            "catchments": deepcopy(plan["selection"]["catchments"]),
            "reference_csv_sha256": source_sha256,
            "calibration_record_ids": _ids(training),
            "validation_record_ids": _ids(validation),
            "selected_validation": deepcopy(report.get("selected_validation")),
        })
        if len(history) == 1:
            same_design = all(selection.get(key) == plan["selection"].get(key)
                              for key in DESIGN_FIELDS)
        binding = plan["selection"].get("prior_evaluation")
    observed = workspace._get("observations", selection["observation_id"])
    source_sha256 = observed["original"]["sha256"]
    training = _records(units, "calibration", source_sha256)
    validation = _records(units, "validation", source_sha256)
    repeated_validation = validation & prior_validation
    previous_training = validation & prior_training
    used_in_training = training & prior_validation
    description = (
        "Follow-up of " + history[0]["title"] + ". The retained history contains "
        + str(len(history)) + " earlier evaluation(s). "
    )
    if repeated_validation:
        description += (str(len(repeated_validation)) + " validation reference record(s) "
                        "were already evaluated in earlier holdouts. ")
    if previous_training:
        description += (str(len(previous_training)) + " validation reference record(s) "
                        "were used for earlier parameter selection. ")
    if used_in_training:
        description += (str(len(used_in_training)) + " previously held-out reference record(s) "
                        "now enter training under this edited design. ")
    if not validation:
        description += "This selection has no validation partition. "
    elif not repeated_validation and not previous_training:
        description += ("The current validation record IDs are absent from the linked earlier "
                        "fits; their spatial, period and source independence still needs scientific review. ")
    description += ("Candidate ranking uses only the current declared calibration groups. "
                    "Retain a new independent evaluation when assessing a new scientific claim.")
    return {
        "schema": "upstate.calibration-reference-history/v1",
        "prior_evaluation": first, "same_reference_design": same_design,
        "reference_csv_sha256": source_sha256,
        "matching_method": "Exact original observation CSV body SHA256 plus its source-local record ID. "
                           "Changed exports or different scientific support require source review.",
        "history": history, "description": description,
        "validation_reuses_prior_validation_record_ids": _ids(repeated_validation),
        "validation_reuses_prior_training_record_ids": _ids(previous_training),
        "training_uses_prior_validation_record_ids": _ids(used_in_training),
        "validation_record_ids_absent_from_history": _ids(
            validation - prior_training - prior_validation),
    }
