"""Saved scenario assessments over retained native runs and comparison artifacts.

TokenJunkieLabs. This module reads the original Workspace; it never executes
a model or replaces a physical output. Selections and their original operands
are immutable workspace records and travel with the existing portable archive.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path

from .common import canonical, digest, file_digest, held, now, read_json, verify_file
from .workspace import Workspace

KIND = "decision-views"
SCHEMA = "upstate.scenario-decisions-catalog/v1"
METRICS = ("nitrogen_export", "phosphorus_export", "sediment_export")
SELECTION_FIELDS = (
    "baseline_id", "alternative_ids", "metric_ids", "catchment_ids",
    "directions", "priority", "query", "status_filter", "pinned_ids",
    "only_pinned", "sort_key", "sort_direction", "objective_id",
    "table_page", "table_page_size", "method_catchment_id",
)


def methods():
    path = Path(__file__).resolve().parents[1] / "operator" / "decision_methods.json"
    if path.is_file():
        return read_json(path)
    return {"schema": "upstate.decision-methods/v1", "metrics": [
        {"id": "nitrogen_export", "label": "Nitrogen export", "unit": "kg/year"},
        {"id": "phosphorus_export", "label": "Phosphorus export", "unit": "kg/year"},
        {"id": "sediment_export", "label": "Sediment export", "unit": "metric_tonnes/year"},
    ], "objectives": [], "sources": []}


def _run(row):
    keep = {k: deepcopy(row[k]) for k in (
        "id", "selection", "state", "runtime", "started_at", "completed_at",
        "created_at", "artifacts",
    ) if k in row}
    keep["stage_summary"] = {
        name: {k: stage[k] for k in ("state", "started_at", "completed_at") if k in stage}
        for name, stage in row.get("stages", {}).items()
    }
    if not keep["stage_summary"]:
        keep["stage_summary"] = deepcopy(row.get("stage_summary", {}))
    return keep



def _scoped_reports(workspace, selected, report_ids=None):
    """Load saved S1 common-mask reports; retain their original source artifact."""
    result, issues = [], []
    root = workspace.root / "scenario-decisions"
    if not root.is_dir():
        return result, issues
    for path in sorted(root.glob("*/decision.json")):
        if report_ids is not None and path.parent.name not in report_ids:
            continue
        try:
            directory = path.parent.resolve()
            directory.relative_to(workspace.root)
            summary = read_json(path)
            if summary.get("schema") != "upstate.scenario-decisions/v1":
                continue
            original_runs = set(summary.get("selection", {}).get("run_ids", []))
            if not original_runs.intersection(selected):
                continue
            descriptor = summary["files"]["json"]
            report_path = verify_file(directory, descriptor)
            report = read_json(report_path)
            for key in ("schema", "id", "selection", "baseline_run_id"):
                if report.get(key) != summary.get(key):
                    raise ValueError("The report and its retained manifest disagree on " + key + ".")
            if not report.get("grid_id") or not isinstance(report.get("zones"), list):
                raise ValueError("The saved report is missing its grid or reporting zones.")
            if summary["id"] != directory.name:
                raise ValueError("The saved report identifier and directory disagree.")
            source_ref = dict(descriptor)
            source_ref["path"] = report_path.relative_to(workspace.root).as_posix()
            result.append({
                "id": report["id"], "title": report.get("title", summary.get("title", "")),
                "baseline_run_id": report["baseline_run_id"],
                "grid_id": report["grid_id"], "source_ref": source_ref,
                "report": report,
            })
        except (OSError, ValueError, KeyError, TypeError) as error:
            issues.append({"source": path.relative_to(workspace.root).as_posix(), "error": str(error)})
    return result, issues


def _known_scopes(snapshot):
    result = {"reporting-mask:" + row["selection"]["grid_id"] for row in snapshot["runs"]}
    for saved in snapshot.get("scoped_reports", []):
        result.update("watershed-report:" + saved["id"] + ":" + str(zone["id"])
                      for zone in saved["report"]["zones"])
    return result


def _assessment(value, selection, workspace_id):
    if value is None:
        if selection.get("priority", {}).get("enabled"):
            raise ValueError("Include the calculated assessment to preserve its weighted cohort and ranges.")
        return None
    if not isinstance(value, dict) or value.get("schema_version") != "scenario-decisions.comparison.v1":
        raise ValueError("Use the calculated result from the current scenario panel.")
    if value.get("workspace_id") != workspace_id:
        raise ValueError("The calculated assessment belongs to a different workspace.")
    for key in ("baseline_id", "alternative_ids", "metric_ids", "catchment_ids", "directions", "priority"):
        if key == "directions":
            expected = {metric: selection.get("directions", {}).get(metric, "")
                        for metric in selection.get("metric_ids", [])}
        elif key == "priority":
            priority = selection.get("priority", {})
            expected = {"enabled": priority.get("enabled") is True,
                        "weights": {metric: priority.get("weights", {}).get(metric, 0)
                                    for metric in selection.get("metric_ids", [])}}
        else:
            expected = selection.get(key, [])
        actual = value.get("selection", {}).get(key)
        if actual != expected:
            raise ValueError("The calculated assessment and selected " + key + " differ. Reopen the current view and save again.")
    if not isinstance(value.get("rows"), list) or not isinstance(value.get("groups"), list):
        raise ValueError("Retain the physical comparison rows and common-cohort groups.")
    # The isolated task payload or decoded transfer already owns this object.
    # Saving validates its canonical digest before the immutable workspace write.
    return value


def catalog(workspace, *, run_ids=None, scope_ids=None):
    data = workspace.overview()
    wanted = None if run_ids is None else set(run_ids)
    runs = [_run(row) for row in data.get("runs", [])
            if row.get("state") == "complete" and (wanted is None or row["id"] in wanted)]
    if wanted is not None:
        missing = wanted - {row["id"] for row in runs}
        if missing:
            raise ValueError("Complete the selected native run before saving: " + ", ".join(sorted(missing)))
    selected = {row["id"] for row in runs}
    comparisons = []
    for original in data.get("comparisons", []):
        if original.get("baseline_run_id") not in selected:
            continue
        row = deepcopy(original)
        row["alternatives"] = [part for part in row.get("alternatives", [])
                               if part.get("run_id") in selected]
        if row["alternatives"]:
            comparisons.append(row)
    refs = {
        "profiles": {row["selection"].get("profile_id") for row in runs},
        "scenarios": {row["selection"].get("scenario_id") for row in runs},
        "grids": {row["selection"].get("grid_id") for row in runs},
    }
    context = {}
    for kind, keys in refs.items():
        context[kind] = [deepcopy(row) for row in data.get(kind, []) if row.get("id") in keys]
    report_ids = None if scope_ids is None else {
        value.split(":", 2)[1] for value in scope_ids if value.startswith("watershed-report:")
    }
    scoped_reports, scoped_report_issues = _scoped_reports(workspace, selected, report_ids)
    return {
        "schema": SCHEMA,
        "workspace_id": workspace.project["id"],
        "project": deepcopy(workspace.project),
        "runs": runs,
        "comparisons": comparisons,
        "scoped_reports": scoped_reports,
        "scoped_report_issues": scoped_report_issues,
        **context,
        "methods": methods(),
    }


def list_views(workspace):
    from . import decision_index
    return decision_index.list_views(workspace, KIND)


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Save the current scenario selection as a JSON object.")
    result = {key: deepcopy(value[key]) for key in SELECTION_FIELDS if key in value}
    if not isinstance(result.get("baseline_id"), str) or not result["baseline_id"]:
        raise ValueError("Select a retained baseline run.")
    for key in ("alternative_ids", "metric_ids", "catchment_ids", "pinned_ids"):
        rows = result.get(key, [])
        if not isinstance(rows, list) or any(not isinstance(x, str) for x in rows):
            raise ValueError(key + " must be a list of retained identifiers.")
        result[key] = list(dict.fromkeys(rows))
    result["alternative_ids"] = [key for key in result["alternative_ids"]
                                  if key != result["baseline_id"]]
    if not isinstance(result.get("directions", {}), dict):
        raise ValueError("Retain directions as named metric choices.")
    for name, direction in result.get("directions", {}).items():
        if direction not in ("", "minimize", "maximize"):
            raise ValueError("Choose minimize or maximize for " + name + ".")
    priority = result.get("priority", {})
    if not isinstance(priority, dict) or not isinstance(priority.get("weights", {}), dict):
        raise ValueError("Retain priority choices as named metric weights.")
    for name, weight in priority.get("weights", {}).items():
        if isinstance(weight, bool) or not isinstance(weight, (int, float)) or weight < 0:
            raise ValueError("Use a nonnegative numeric weight for " + name + ".")
    canonical(result)
    return result


def save(workspace, value):
    title = str(value.get("title", "")).strip()
    if not title:
        raise ValueError("Give this saved assessment a title.")
    selection = _selection(value.get("selection"))
    run_ids = [selection["baseline_id"], *selection["alternative_ids"]]
    snapshot = catalog(workspace, run_ids=run_ids, scope_ids=selection['catchment_ids'])
    unknown_scopes = set(selection["catchment_ids"]) - _known_scopes(snapshot)
    if unknown_scopes:
        raise ValueError("Reopen the retained reporting source before saving: " + ", ".join(sorted(unknown_scopes)))
    raw_assessment = value.get("assessment")
    reference = value.get("assessment_ref")
    if reference is not None:
        if raw_assessment is not None:
            raise ValueError("Choose the original calculated assessment or its retained transfer.")
        from . import decision_transfer
        raw_assessment = decision_transfer.load(workspace, reference)
    assessment = _assessment(raw_assessment, selection, workspace.project["id"])
    previous = value.get("previous_view_id")
    if previous:
        workspace._get(KIND, previous)
    payload = {
        "title": title,
        "purpose": str(value.get("purpose", "")).strip(),
        "created_at": now(),
        "selection": selection,
        "source_snapshot": snapshot,
        "source_snapshot_sha256": digest(snapshot),
        "assessment": assessment,
        "assessment_sha256": digest(assessment) if assessment is not None else None,
        "calculation_source": {
            "component": "operator/web/scenario_decisions.mjs",
            "component_sha256": file_digest(Path(__file__).resolve().parents[1] / "operator" / "web" / "scenario_decisions.mjs"),
            "method": "min_max_across_common_alternatives",
            "objective_id": selection.get("objective_id", ""),
        },
        "interpretation": {
            "quantities": "Original annual modeled mass summaries; native units remain attached.",
            "paired_changes": "Alternative minus baseline on each retained difference raster's valid support.",
            "ranking": "Directions and optional normalized weights are explicit operator choices.",
            "calendar_year": "Annual model basis from the selected grid; no calendar year is inferred.",
        },
    }
    if previous:
        payload["previous_view_id"] = previous
    with held(workspace.root / ".workspace.lock"):
        result = workspace._save(KIND, payload)
    from . import decision_index
    decision_index.remember(workspace, KIND, result)
    return result


def inspect(workspace, identifier):
    row = workspace._get(KIND, identifier)
    snapshot = row["source_snapshot"]
    if digest(snapshot) != row.get("source_snapshot_sha256"):
        raise ValueError("The saved assessment's source snapshot has changed.")
    if row.get("assessment") is not None and digest(row["assessment"]) != row.get("assessment_sha256"):
        raise ValueError("The saved comparison assessment has changed.")
    if snapshot["workspace_id"] != workspace.project["id"]:
        raise ValueError("Open this assessment in its original or restored scientific workspace.")
    return row


def verify(workspace, row):
    """Verify bound sources when receiving an archive; reuse original run identities."""
    checked = inspect(workspace, row["id"])
    snapshot = checked["source_snapshot"]
    for saved in snapshot["runs"]:
        actual = workspace.inspect_run(saved["id"])
        if actual.get("selection") != saved.get("selection"):
            raise ValueError("Saved assessment run selection changed: " + saved["id"])
        if actual.get("state") != "complete":
            raise ValueError("Saved assessment's completed run is missing: " + saved["id"])
        if actual.get("artifacts") != saved.get("artifacts"):
            raise ValueError("Saved assessment's physical artifact references changed: " + saved["id"])
    current = {item["id"]: item for item in workspace.overview().get("comparisons", [])}
    for saved in snapshot.get("comparisons", []):
        actual = current.get(saved["id"])
        if actual is None or actual.get("baseline_run_id") != saved.get("baseline_run_id"):
            raise ValueError("Saved native comparison is missing: " + saved["id"])
        parts = {part["run_id"]: part for part in actual.get("alternatives", [])}
        for part in saved.get("alternatives", []):
            if parts.get(part["run_id"]) != part:
                raise ValueError("Saved paired physical operands changed: " + part["run_id"])
    for saved in snapshot.get("scoped_reports", []):
        actual = read_json(verify_file(workspace.root, saved["source_ref"]))
        if actual != saved["report"]:
            raise ValueError("Saved watershed comparison operands changed: " + saved["id"])
    return {"id": checked["id"], "run_count": len(snapshot["runs"]),
            "watershed_report_count": len(snapshot.get("scoped_reports", [])), "sources": "MATCH"}


def verify_all(workspace):
    return [verify(workspace, row) for row in workspace._list(KIND)]


def main():
    parser = argparse.ArgumentParser(description="Open or save original-run scenario assessments.")
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog")
    sub.add_parser("list")
    show = sub.add_parser("show")
    show.add_argument("id")
    saving = sub.add_parser("save")
    saving.add_argument("selection_file", help="JSON object with title, purpose and complete UI selection")
    sub.add_parser("verify-receiving")
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.command == "catalog":
        result = catalog(workspace)
    elif args.command == "list":
        result = list_views(workspace)
    elif args.command == "show":
        result = inspect(workspace, args.id)
    elif args.command == "save":
        result = save(workspace, read_json(args.selection_file))
    else:
        result = verify_all(workspace)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
