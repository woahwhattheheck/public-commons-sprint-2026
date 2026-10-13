"""Prepare original Decision studies from retained common-support diagnostics.

Only saved annual mass totals are received. Native rasters and models are not
recomputed. The existing OPT12 paired receiver checks the resulting explicit
profile/candidate matrix before the original DecisionWorkspace stores it.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path

from model import experiment_diagnostics
from model.common import (
    atomic_bytes, atomic_json, describe_file, digest, identifier, now,
    read_json, verify_file,
)
from .native import from_experiment

CONTRACT = "ES26/diagnostic-common-support/v1"
BINDING_SCHEMA = "upstate.decision-diagnostic-binding/v1"
REVISION_SCHEMA = "upstate.decision-diagnostic-revision/v1"
UNITS = {
    "nitrogen_export": "kg/year", "phosphorus_export": "kg/year",
    "sediment_export": "t/year",
}


def _id(value, name):
    try:
        return identifier(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(name + " must be an original 64-character identity") from exc


def _finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError(name + " must be a retained finite annual mass")
    return float(value)


def _positive_count(value, name):
    if type(value) is not int or value <= 0:
        raise ValueError(name + " must be a positive retained cell count")
    return value


def _revision_folder(ws, diagnostic_id, report_sha256):
    return (Path(ws.root) / "robust_decisions" / "diagnostic-revisions"
            / _id(diagnostic_id, "Diagnostic") / _id(report_sha256, "Report SHA-256"))


def _read_revision(ws, diagnostic_id, report_sha256):
    folder = _revision_folder(ws, diagnostic_id, report_sha256)
    manifest_path = folder / "manifest.json"
    if not manifest_path.exists():
        return None
    manifest = read_json(manifest_path)
    expected_path = (folder / "report.json").relative_to(ws.root).as_posix()
    descriptor = manifest.get("report", {})
    if (manifest.get("schema") != REVISION_SCHEMA
            or manifest.get("project_id") != ws.project["id"]
            or manifest.get("diagnostic_id") != diagnostic_id
            or manifest.get("report_sha256") != report_sha256
            or descriptor.get("path") != expected_path
            or descriptor.get("sha256") != report_sha256):
        raise ValueError("The retained diagnostic revision has a different identity")
    path = verify_file(ws.root, descriptor)
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != report_sha256 or len(body) != descriptor["bytes"]:
        raise ValueError("The retained diagnostic report changed while its bytes were read")
    report = json.loads(body)
    return report, body, descriptor, manifest


def _load(ws, diagnostic_id, report_sha256=None):
    diagnostic_id = _id(diagnostic_id, "Diagnostic")
    if report_sha256 is not None:
        report_sha256 = _id(report_sha256, "Report SHA-256")
        retained = _read_revision(ws, diagnostic_id, report_sha256)
        if retained is not None:
            report, body, descriptor, _ = retained
            if report.get("id") != diagnostic_id or report.get("schema") != experiment_diagnostics.SCHEMA:
                raise ValueError("The retained report names another diagnostic")
            return report, body, descriptor
        # A stopped preparation may have retained the exact report before its
        # adjacent manifest was committed. Recover those pinned bytes even if
        # the live diagnostic has since advanced; only _retain creates metadata.
        orphan = _revision_folder(ws, diagnostic_id, report_sha256) / "report.json"
        if orphan.is_file():
            if not orphan.resolve().is_relative_to(Path(ws.root).resolve()):
                raise ValueError("The unfinished diagnostic revision leaves its workspace")
            body = orphan.read_bytes()
            if hashlib.sha256(body).hexdigest() != report_sha256:
                raise ValueError("The unfinished diagnostic revision differs from its pinned SHA-256")
            descriptor = {
                "path": orphan.relative_to(ws.root).as_posix(),
                "bytes": len(body), "sha256": report_sha256,
            }
            verify_file(ws.root, descriptor)
            report = json.loads(body)
            if report.get("id") != diagnostic_id or report.get("schema") != experiment_diagnostics.SCHEMA:
                raise ValueError("The unfinished report names another diagnostic")
            return report, body, descriptor
    inspected = experiment_diagnostics.inspect(ws, diagnostic_id)
    descriptor = inspected.get("artifacts", {}).get("report_json")
    if not isinstance(descriptor, dict):
        raise ValueError("Choose a diagnostic with a committed scientific report")
    path = verify_file(ws.root, descriptor)
    expected = Path(ws.root) / "experiment-diagnostics" / diagnostic_id / "report.json"
    if path.resolve() != expected.resolve():
        raise ValueError("The diagnostic report leaves its original saved identity")
    body = path.read_bytes()
    actual_sha = hashlib.sha256(body).hexdigest()
    if actual_sha != descriptor["sha256"] or len(body) != descriptor["bytes"]:
        raise ValueError("The saved diagnostic report changed while it was read")
    if report_sha256 is not None and actual_sha != report_sha256:
        raise ValueError("The diagnostic report advanced; reopen its configuration before preparing this study")
    report = json.loads(body)
    if (report.get("schema") != experiment_diagnostics.SCHEMA
            or report.get("id") != diagnostic_id):
        raise ValueError("Choose the original common-support diagnostic report")
    return report, body, descriptor


def _identity(report):
    selection = report.get("selection", {})
    grid_id = _id(selection.get("grid_id"), "Grid")
    baseline = _id(selection.get("baseline_scenario_id"), "Baseline scenario")
    profiles = selection.get("expected_profile_ids")
    scenarios = selection.get("scenario_ids")
    if (not isinstance(profiles, list) or not profiles
            or not isinstance(scenarios, list) or len(scenarios) < 2):
        raise ValueError("The diagnostic needs declared profiles, a baseline and at least one alternative")
    for values, label in ((profiles, "Profile"), (scenarios, "Scenario")):
        if len(values) != len(set(values)):
            raise ValueError("The diagnostic repeats a declared " + label.lower())
        for value in values:
            _id(value, label)
    if baseline not in scenarios:
        raise ValueError("The diagnostic baseline is outside its declared scenario matrix")
    return selection, grid_id, baseline, profiles, [sid for sid in scenarios if sid != baseline]


def configuration(report):
    """Expose every declared choice; operator costs and preferences remain empty."""
    selection, grid_id, baseline, profiles, scenarios = _identity(report)
    profile_titles = {
        row["profile_id"]: row.get("title") or row["profile_id"]
        for row in report.get("profiles", [])
    }
    scenario_titles = report.get("scenario_titles", {})
    profile_records = {row["profile_id"]: row for row in report.get("profiles", [])}
    supports = report.get("common_support", {})
    if isinstance(supports, list):
        supports = {row["metric"]: row for row in supports}
    metrics = []
    for metric, units in UNITS.items():
        support = supports.get(metric)
        if support is None or support.get("state") == "model_not_selected":
            continue
        metrics.append({
            "id": metric, "label": metric.replace("_", " "), "units": units,
            "scale": None, "weight": None, "guaranteed_gain": None,
        })
    if not metrics:
        raise ValueError("The retained diagnostic has no selected annual export metrics")
    return {
        "schema_version": "ecosci.robust-study/1",
        "title": selection.get("title") or "Decision study from scientific diagnostics",
        "mode": "native_packages", "additive_basis": None,
        "metrics": metrics,
        "candidates": [
            {"id": sid, "label": scenario_titles.get(sid) or sid,
             "cost": None, "capacity": None, "group": None,
             "required": False, "excluded": False, "source": {"scenario_id": sid}}
            for sid in scenarios
        ],
        "profiles": [
            {"id": pid, "label": profile_titles.get(pid) or pid,
             "probability": None, "source": {
                 "profile_id": pid,
                 "structural_group_id": profile_records.get(pid, {}).get("structural_group_id"),
                 "structural_factors": deepcopy(profile_records.get(pid, {}).get("structural_factors"))}}
            for pid in profiles
        ],
        "budget": None, "cost_units": "", "capacity": None, "group_limits": {},
        "source": {
            "diagnostic_id": report["id"], "grid_id": grid_id,
            "baseline_scenario_id": baseline,
            "diagnostic_design": {"structural_mode": "single_group", "structural_reason": ""},
        },
        "notes": "",
    }


def preview(ws, diagnostic_id):
    """Read the committed report and its exact SHA without creating a revision."""
    report, _, descriptor = _load(ws, diagnostic_id)
    return {
        "diagnostic_id": report["id"], "report_sha256": descriptor["sha256"],
        "configuration": configuration(report),
        "coverage": report.get("coverage", {}),
        "results_state": report.get("results_state", report.get("state")),
        "source_stamp": report.get("source_stamp", {}),
        "common_support": report.get("common_support", {}),
    }


def _declared(values, allowed, name):
    if not isinstance(values, list) or not values:
        raise ValueError("Supply explicit " + name + " choices")
    ids = []
    for value in values:
        if not isinstance(value, dict) or value.get("id") not in allowed:
            raise ValueError("A requested " + name + " is outside the saved diagnostic")
        if value["id"] in ids:
            raise ValueError("A requested " + name + " is repeated")
        ids.append(value["id"])
    return ids


def _structural_design(report, profile_ids, configuration_value):
    records = {row["profile_id"]: row for row in report.get("profiles", [])}
    groups = {}
    for profile_id in profile_ids:
        row = records.get(profile_id)
        if not row or not isinstance(row.get("structural_factors"), dict):
            raise ValueError("The saved diagnostic lacks the structural model identity for profile " + profile_id)
        group_id = _id(row.get("structural_group_id"), "Structural group")
        if digest(row["structural_factors"]) != group_id:
            raise ValueError("The retained structural model factors have a different group identity")
        groups.setdefault(group_id, {
            "profiles": [], "factors": deepcopy(row["structural_factors"]),
            "declared_membership_known": row.get("structural_membership_known") is True,
        })
        groups[group_id]["profiles"].append(profile_id)
    choice = configuration_value.get("source", {}).get("diagnostic_design", {})
    mode = choice.get("structural_mode", "single_group")
    if mode not in ("single_group", "explicit_structural_ensemble"):
        raise ValueError("Choose one structural group or an explicit structural-model ensemble")
    reason = choice.get("structural_reason", "")
    if not isinstance(reason, str):
        raise ValueError("Describe the structural comparison in text")
    if len(groups) > 1 and (mode != "explicit_structural_ensemble" or not reason.strip()):
        raise ValueError("Selected profiles use different routing, periods or model scopes. "
                         "Choose one structural group or explicitly describe the structural-model comparison.")
    return {"structural_mode": mode, "structural_reason": reason.strip(),
            "structural_groups": groups,
            "interpretation": ("explicit structural-model design; profiles are named model hypotheses"
                               if len(groups) > 1 else "one retained structural model group")}


def _run_selection(row, grid_id, profile_id, scenario_id):
    models = row.get("models")
    if models not in (["ndr"], ["sdr"], ["ndr", "sdr"]):
        raise ValueError("The diagnostic native run has no resolved model selection")
    retained = row.get("selection")
    if retained is None:
        # Earlier reports contain only canonical 3.20.0 native identities.
        # Preserve their exact original reconstruction and resulting bindings.
        selection = {
            "schema": "upstate.run-selection/v1", "grid_id": grid_id,
            "profile_id": profile_id, "scenario_id": scenario_id,
            "invest_version": "3.20.0",
        }
        if models != ["ndr", "sdr"]:
            selection["models"] = list(models)
    else:
        if not isinstance(retained, dict):
            raise ValueError("The diagnostic lost its retained native selection")
        selection = deepcopy(retained)
        if (
            selection.get("schema") != "upstate.run-selection/v1"
            or selection.get("grid_id") != grid_id
            or selection.get("profile_id") != profile_id
            or selection.get("scenario_id") != scenario_id
            or selection.get("models", ["ndr", "sdr"]) != models
            or not isinstance(selection.get("invest_version"), str)
            or not selection["invest_version"].strip()
        ):
            raise ValueError("The retained diagnostic selection differs from its native matrix cell")
    if digest(selection) != row.get("run_id"):
        raise ValueError("The diagnostic's native run selection does not match its original content ID")
    return selection


def _bundle(report, configuration_value, project_id, report_sha256):
    selection, grid_id, baseline, declared_profiles, declared_scenarios = _identity(report)
    profiles = _declared(configuration_value.get("profiles"), declared_profiles, "profile")
    scenarios = _declared(configuration_value.get("candidates"), declared_scenarios, "candidate")
    metrics = _declared(configuration_value.get("metrics"), UNITS, "metric")
    structural_design = _structural_design(report, profiles, configuration_value)
    supports = report.get("common_support", {})
    if isinstance(supports, list):
        supports = {row["metric"]: row for row in supports}
    matrix = {}
    for row in report.get("run_matrix", []):
        key = (row.get("profile_id"), row.get("scenario_id"))
        if key in matrix:
            raise ValueError("The diagnostic repeats a native matrix cell")
        matrix[key] = row
    values = {}
    for row in report.get("metric_values", []):
        key = (row.get("metric"), row.get("profile_id"), row.get("scenario_id"))
        if key in values:
            raise ValueError("The diagnostic repeats a physical metric cell")
        values[key] = row
    cases, support_records = [], {}
    for metric in metrics:
        support = supports.get(metric)
        if not isinstance(support, dict) or support.get("state") != "complete":
            raise ValueError("Metric " + metric + " has no complete common footprint in this report")
        if support.get("units") != UNITS[metric] or support.get("grid_id") != grid_id:
            raise ValueError("The common-support metric has different annual units or grid")
        versions = support.get("native_versions")
        if versions is not None and (
            not isinstance(versions, dict) or versions.get("state") != "compatible"
        ):
            raise ValueError("The metric has no compatible producing-version cohort: " + metric)
        count = _positive_count(support.get("valid_cells"), metric + " common support")
        cells = _positive_count(support.get("grid_cells"), metric + " grid")
        if count > cells:
            raise ValueError("The common footprint exceeds the original model grid")
        mask = support.get("mask", {})
        support_sha = _id(mask.get("sha256"), "Common support SHA-256")
        if mask.get("valid_cells") != count:
            raise ValueError("The common footprint descriptor has a different cell count")
        run_ids = support.get("run_ids")
        if not isinstance(run_ids, list) or len(run_ids) != len(set(run_ids)):
            raise ValueError("The common footprint lacks its exact native run roster")
        for run_id in run_ids:
            _id(run_id, "Native run")
        support_records[metric] = {
            "sha256": support_sha, "paired_cells": count,
            "coverage_fraction": count / cells,
            "coverage_denominator": "diagnostic model grid cells",
            "grid_cells": cells, "run_ids": list(run_ids), "mask": deepcopy(mask),
        }
        if versions is not None:
            support_records[metric]["native_versions"] = deepcopy(versions)
    for profile_id in profiles:
        base = matrix.get((profile_id, baseline))
        if not base or base.get("state") != "complete":
            raise ValueError("Baseline native run is incomplete for profile " + profile_id)
        baseline_id = _id(base.get("run_id"), "Baseline run")
        _run_selection(base, grid_id, profile_id, baseline)
        for scenario_id in scenarios:
            alternative = matrix.get((profile_id, scenario_id))
            if not alternative or alternative.get("state") != "complete":
                raise ValueError("Alternative native run is incomplete for " + profile_id + "/" + scenario_id)
            alternative_id = _id(alternative.get("run_id"), "Alternative run")
            if alternative_id == baseline_id:
                raise ValueError("The saved diagnostic requires distinct baseline and alternative runs")
            received_metrics = {}
            for metric in metrics:
                common = support_records[metric]
                if baseline_id not in common["run_ids"] or alternative_id not in common["run_ids"]:
                    raise ValueError("The selected native pair is missing from the metric's retained common footprint")
                pair = []
                for sid, run_id in ((baseline, baseline_id), (scenario_id, alternative_id)):
                    value = values.get((metric, profile_id, sid))
                    if (not value or value.get("run_id") != run_id
                            or value.get("grid_id") != grid_id
                            or value.get("units") != UNITS[metric]
                            or value.get("support_sha256") != common["sha256"]
                            or value.get("common_valid_cells") != common["paired_cells"]):
                        raise ValueError("A requested physical outcome lacks the exact retained common support: "
                                         + metric + "/" + profile_id + "/" + sid)
                    mass = _finite(value.get("common_mass_total"), metric + " common mass")
                    if mass < 0:
                        raise ValueError("An annual native export mass is negative")
                    _id(value.get("artifact_sha256"), "Original mass artifact SHA-256")
                    pair.append((mass, value))
                base_mass, alt_mass = pair[0][0], pair[1][0]
                delta = alt_mass - base_mass
                received_metrics[metric] = {
                    "units": UNITS[metric], "baseline_total": base_mass,
                    "alternative_total": alt_mass, "delta": delta, "reduction": -delta,
                    "relative_change_pct": 100 * delta / base_mass if base_mass else None,
                    "paired_cells": common["paired_cells"],
                    "coverage_fraction": common["coverage_fraction"],
                    "coverage_denominator": common["coverage_denominator"],
                    "support_sha256": common["sha256"],
                    "source_baseline_artifact_sha256": pair[0][1]["artifact_sha256"],
                    "source_alternative_artifact_sha256": pair[1][1]["artifact_sha256"],
                    "source_diagnostic_id": report["id"],
                    "source_report_sha256": report_sha256,
                }
            native_selection = _run_selection(alternative, grid_id, profile_id, scenario_id)
            case_identity = {
                "diagnostic_id": report["id"], "report_sha256": report_sha256,
                "profile_id": profile_id, "scenario_id": scenario_id,
            }
            cases.append({
                "id": digest(case_identity), "kind": "landcover", "state": "complete",
                "profile_id": profile_id, "scenario_id": scenario_id,
                "baseline_run_id": baseline_id, "run_id": alternative_id,
                "selection": native_selection, "metrics": received_metrics,
                "source_trace": {
                    "schema": CONTRACT, **case_identity,
                    "case_identity_kind": "derived diagnostic pair",
                    "baseline_scenario_id": baseline,
                    "metric_support": deepcopy(support_records),
                },
            })
    return {
        "grid_id": grid_id, "workspace_id": project_id, "cases": cases,
        "diagnostic_id": report["id"], "report_sha256": report_sha256,
    }, support_records, structural_design


def _retain(ws, diagnostic_id, report_sha256, report, body):
    folder = _revision_folder(ws, diagnostic_id, report_sha256)
    retained = _read_revision(ws, diagnostic_id, report_sha256)
    if retained is not None:
        _, old_body, descriptor, manifest = retained
        if old_body != body:
            raise ValueError("The retained report revision has different original bytes")
    else:
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / "report.json"
        atomic_bytes(target, body, immutable=True)
        descriptor = describe_file(ws.root, target)
        if descriptor["sha256"] != report_sha256:
            raise ValueError("The retained original report SHA-256 differs")
        manifest = {
            "schema": REVISION_SCHEMA, "project_id": ws.project["id"],
            "diagnostic_id": diagnostic_id, "report_sha256": report_sha256,
            "report": descriptor, "source_stamp": deepcopy(report.get("source_stamp", {})),
            "selection": deepcopy(report["selection"]), "created_at": now(),
        }
        atomic_json(folder / "manifest.json", manifest, immutable=True)
    return {
        "schema": BINDING_SCHEMA, "project_id": ws.project["id"],
        "diagnostic_id": diagnostic_id, "report_sha256": report_sha256,
        "report": descriptor, "manifest": describe_file(ws.root, folder / "manifest.json"),
    }


def from_workspace(ws, diagnostic_id, report_sha256, configuration_value):
    """Receive exact saved metrics and retain their report before study creation."""
    if not isinstance(configuration_value, dict):
        raise ValueError("Supply the complete explicit decision configuration")
    report, body, descriptor = _load(ws, diagnostic_id, report_sha256)
    bundle, supports, structural_design = _bundle(report, configuration_value, ws.project["id"], descriptor["sha256"])
    study = from_experiment(bundle, configuration_value)
    binding = _retain(ws, diagnostic_id, descriptor["sha256"], report, body)
    study.source.update({
        "pair_contract": CONTRACT, "workspace_id": ws.project["id"],
        "diagnostic_id": diagnostic_id, "diagnostic_report_sha256": descriptor["sha256"],
        "diagnostic_binding": binding,
        "baseline_scenario_id": report["selection"]["baseline_scenario_id"],
        "support_by_metric": supports,
        "diagnostic_design": structural_design,
        "gain_sign": "baseline minus alternative",
        "diagnostic_source_stamp": deepcopy(report.get("source_stamp", {})),
        "declared_diagnostic_profile_ids": list(report["selection"]["expected_profile_ids"]),
        "declared_diagnostic_scenario_ids": list(report["selection"]["scenario_ids"]),
    })
    # The diagnostic is its own native root. Do not label its content ID as an
    # experiment ID. An actual campaign binding is supplied only by the original
    # diagnostic selection and remains separately named.
    study.source.pop("experiment_id", None)
    if report["selection"].get("campaign_id"):
        study.source["diagnostic_campaign_id"] = report["selection"]["campaign_id"]
    return study


def verify_binding(ws, source):
    """Verify exact local report records during native workspace receiving.

    Independent decision-project JSON may retain an explicitly external source
    project. Its original gains/provenance remain readable in that workflow.
    """
    if source.get("pair_contract") != CONTRACT:
        return None
    binding = source.get("diagnostic_binding")
    if not isinstance(binding, dict) or binding.get("schema") != BINDING_SCHEMA:
        raise ValueError("The decision diagnostic source binding is missing")
    diagnostic_id = _id(binding.get("diagnostic_id"), "Diagnostic")
    report_sha256 = _id(binding.get("report_sha256"), "Report SHA-256")
    if (source.get("diagnostic_id") != diagnostic_id
            or source.get("diagnostic_report_sha256") != report_sha256
            or source.get("workspace_id") != binding.get("project_id")):
        raise ValueError("The decision source has conflicting diagnostic identities")
    if binding.get("project_id") != ws.project["id"]:
        return {"state": "external", "project_id": binding.get("project_id"),
                "diagnostic_id": diagnostic_id, "report_sha256": report_sha256}
    folder = _revision_folder(ws, diagnostic_id, report_sha256)
    for key, name in (("report", "report.json"), ("manifest", "manifest.json")):
        descriptor = binding.get(key, {})
        expected_path = (folder / name).relative_to(ws.root).as_posix()
        if descriptor.get("path") != expected_path:
            raise ValueError("The diagnostic source record leaves its derived revision path")
        verify_file(ws.root, descriptor)
    retained = _read_revision(ws, diagnostic_id, report_sha256)
    if retained is None or retained[2] != binding["report"]:
        raise ValueError("The decision lost its exact retained diagnostic report")
    return {"state": "local", "diagnostic_id": diagnostic_id,
            "report_sha256": report_sha256}
