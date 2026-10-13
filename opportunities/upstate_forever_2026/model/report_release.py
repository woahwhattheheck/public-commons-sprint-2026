"""Carry an existing watershed report into the same-cohort GIS map release."""
from __future__ import annotations

from .common import (INVEST_VERSION, atomic_json, describe_file, digest,
                     identifier, read_json)
from .model_selection import run_scope
from .native_versions import model_versions
from .reuse import copy_verified

SCHEMA = "upstate.report-release/v1"


def _cohort(workspace, report_id, *, packet=None):
    from . import scenario_decisions

    report_id = identifier(report_id)
    if packet is None:
        packet = scenario_decisions.inspect(workspace, report_id, include_report=True)
    summary, report = packet["summary"], packet["report"]
    if report.get("project", {}).get("id") != workspace.project["id"]:
        raise ValueError("Open this watershed report in its original project")
    selected = report.get("selection", {})
    if digest(selected) != digest(summary.get("selection")):
        raise ValueError("The saved report and its original selection differ")
    ids = selected.get("run_ids")
    if (not isinstance(ids, list) or not ids or len(set(ids)) != len(ids)
            or report.get("baseline_run_id") != ids[0]
            or summary.get("baseline_run_id") != ids[0]):
        raise ValueError("Retain the report's complete ordered run selection")
    ids = [identifier(value) for value in ids]
    details = report.get("runs", [])
    if [item.get("id") for item in details] != ids:
        raise ValueError("The saved report's native run cohort differs")

    problems, cases = [], []
    grid_id = details[0]["selection"]["grid_id"]
    profile_id = details[0]["selection"]["profile_id"]

    def issue(code, message, run_id=None):
        problems.append({"code": code, "message": message, "run_id": run_id})

    if len(ids) == 1:
        issue("future_scenario",
              "This report contains the reference only. Complete a land-cover alternative "
              "and save a report containing that reference and the alternative.")

    for index, detail in enumerate(details):
        run_id = detail["id"]
        case = {"id": run_id, "title": detail.get("scenario_title", run_id),
                "role": "reference" if index == 0 else "alternative",
                "profile_id": detail["selection"]["profile_id"],
                "grid_id": detail["selection"]["grid_id"],
                "scenario_kind": detail.get("scenario_kind"),
                "comparison_kind": detail.get("comparison_kind")}
        cases.append(case)
        try:
            run = workspace.inspect_run(run_id)
            if digest(run["selection"]) != digest(detail["selection"]):
                issue("run_selection", "Restore the exact native selection saved by this report.", run_id)
            scope = run_scope(run)
            if not scope["full_model_outputs"]:
                missing = [name.upper() for name in ("ndr", "sdr")
                           if name not in scope["completed_models"]]
                issue("native_models",
                      "Complete " + (", ".join(missing) or "the selected native stages")
                      + " for " + case["title"] + " before building the selected map release.", run_id)
            versions = model_versions(run, ("ndr", "sdr"))
            case["model_versions"] = versions
            unsupported = [model.upper() for model, record in versions.items()
                           if record["comparison_version"] != INVEST_VERSION]
            if unsupported:
                issue("native_version",
                      "Use the original InVEST " + INVEST_VERSION + " " + "/".join(unsupported)
                      + " outputs for " + case["title"] + ".", run_id)
            if run["selection"]["grid_id"] != grid_id:
                issue("grid", "Use the reference grid for every map-release alternative.", run_id)
            if run["selection"]["profile_id"] != profile_id:
                issue("profile",
                      case["title"] + " uses a different parameter profile. Save a common-profile "
                      "land-cover report for the map release; this sensitivity report remains available.", run_id)
            scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
            expected_kind = "baseline" if index == 0 else "landcover"
            if scenario["kind"] != expected_kind:
                issue("scenario_kind",
                      ("Choose an original baseline as the report's first run." if index == 0 else
                       case["title"] + " must contain explicit land-cover changes for the future-service maps."),
                      run_id)
        except (ValueError, OSError, KeyError, TypeError) as error:
            issue("native_run", "Reopen or restore " + case["title"] + ": " + str(error), run_id)

    binding = {
        "schema": SCHEMA,
        "report_id": report_id,
        "report_sha256": summary["files"]["json"]["sha256"],
        "report_title": report["title"],
        "report_created_at": report["created_at"],
        "project_id": workspace.project["id"],
        "baseline_run_id": ids[0],
        "scenario_run_ids": ids[1:],
        "grid_id": grid_id,
        "profile_id": profile_id,
        "pollutants": report.get("pollutants", []),
        "report_kind": report.get("report_kind"),
        "zones": [{"id": zone["id"], "title": zone["title"], "scope": zone["scope"]}
                  for zone in report.get("zones", [])],
        "source_files": summary["files"],
    }
    selection = {
        "source_report_id": report_id,
        "source_report_sha256": binding["report_sha256"],
        "baseline_run_id": ids[0],
        "scenario_run_ids": list(ids[1:]),
        "title": report["title"],
    }
    context = scenario_decisions.delivery_context(selected)
    if context:
        binding["delivery_context"] = context
        selection.update(context)
    return packet, binding, selection, cases, problems


def _releases(workspace, report_id, report_sha256):
    result, issues = [], []
    for path in sorted((workspace.root / "deliveries").glob("*/delivery-state.json")):
        try:
            value = read_json(path)
            selection = value.get("selection", {})
            if selection.get("source_report_id") != report_id:
                continue
            if value.get("schema") != "upstate.delivery/v1" or value.get("id") != path.parent.name:
                raise ValueError("Original release identity differs")
            if selection.get("source_report_sha256") != report_sha256:
                raise ValueError("Release refers to a different report edition")
            result.append({
                "id": value["id"],
                "title": selection.get("title") or value["id"],
                "state": value.get("state"),
                "created_at": value.get("created_at"),
                "completed_at": value.get("completed_at"),
                "baseline_run_id": selection.get("baseline_run_id"),
                "scenario_run_ids": selection.get("scenario_run_ids", []),
                "files": sorted(value.get("files", {})),
            })
        except (ValueError, OSError, KeyError, TypeError) as error:
            issues.append({"release_id": path.parent.name, "message": str(error)})
    result.sort(key=lambda row: (row.get("created_at") or "", row["id"]), reverse=True)
    return result, issues


def describe(workspace, report_id, *, packet=None):
    """Read saved products and original selections; never rerun a calculation."""
    _, binding, selection, cases, issues = _cohort(workspace, report_id, packet=packet)
    releases, release_issues = _releases(workspace, binding["report_id"], binding["report_sha256"])
    from .client_economics import catalog
    economics = catalog(workspace, source_report_id=binding["report_id"],
                        source_report_sha256=binding["report_sha256"],
                        baseline_run_id=binding["baseline_run_id"],
                        scenario_run_ids=binding["scenario_run_ids"])
    return {
        "schema": SCHEMA,
        "source_report": binding,
        "selection": selection,
        "ready": not issues,
        "cases": cases,
        "issues": issues,
        "releases": releases,
        "release_issues": release_issues,
        "economic_editions": economics["editions"],
        "economic_issues": economics["issues"],
        "remaining_choices": [
            "Original source-water and high-quality-water overlays",
            "Responsible GIS metadata contact",
            "Map layout and any explicit priority settings",
            "Optional completed economic edition for this exact cohort",
        ],
    }


def bind_report(workspace, selection):
    """Validate a requested report link before it contributes to release identity.

    Return the exact retained binding, or None for an ordinary unlinked release.
    The caller retains report_sha256 in selection before computing its release ID.
    """
    report_id = selection.get("source_report_id")
    if report_id is None:
        if selection.get("source_report_sha256") is not None:
            raise ValueError("Choose the original watershed report for this report edition")
        return None
    _, binding, requested, _, issues = _cohort(workspace, report_id)
    expected_hash = selection.get("source_report_sha256")
    if expected_hash is not None and expected_hash != binding["report_sha256"]:
        raise ValueError("The saved watershed report edition changed; reopen its release selection")
    if selection.get("baseline_run_id") != requested["baseline_run_id"]:
        raise ValueError("Keep the saved report's exact reference when linking its map release")
    if selection.get("scenario_run_ids") != requested["scenario_run_ids"]:
        raise ValueError("Keep every saved report alternative in its original order, "
                         "or explicitly start an independent map release")
    if issues:
        raise ValueError(" ".join(item["message"] for item in issues))
    return binding


def retain_report(workspace, directory, state, binding):
    """Copy the original report and its tables into the normal GIS package inputs."""
    if binding is None:
        return []
    from . import scenario_decisions

    packet = scenario_decisions.inspect(workspace, binding["report_id"], include_report=False)
    summary = packet["summary"]
    if summary["files"]["json"]["sha256"] != binding["report_sha256"]:
        raise ValueError("The selected watershed report changed before release packaging")
    source = workspace.root / "scenario-decisions" / binding["report_id"]
    prefix = "reports/" + binding["report_id"] + "/"
    files = state.setdefault("files", {})
    retained = []
    for name, descriptor in summary["files"].items():
        key = "source_report_" + name
        copied = copy_verified(source, descriptor, directory,
                               path=prefix + descriptor["path"])
        if key in files and files[key]["sha256"] != copied["sha256"]:
            raise ValueError("The retained release report member differs: " + name)
        files[key] = {**copied, "title": binding["report_title"] + " / " + name,
                      "report_id": binding["report_id"]}
        retained.append(copied["path"])

    original = describe_file(source, source / "decision.json")
    copied = copy_verified(source, original, directory, path=prefix + "decision.json")
    files["source_report_record"] = {**copied, "report_id": binding["report_id"]}
    retained.append(copied["path"])
    link_path = directory / "source-report.json"
    atomic_json(link_path, binding, immutable=True)
    files["source_report_link"] = describe_file(directory, link_path,
                                              title="Original watershed report selection")
    retained.append(files["source_report_link"]["path"])
    state["source_report"] = binding
    return retained
