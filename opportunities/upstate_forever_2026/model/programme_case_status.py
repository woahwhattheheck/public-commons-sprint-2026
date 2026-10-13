"""Bind original ComputeProgrammes cases to the maintained native case console."""
from __future__ import annotations

from .common import digest, identifier
from .programme_views import DEFAULT_VIEWS
from .parameter_case_status import read_run


def read(workspace, programme_id, run_id, **options):
    """Inspect the exact saved programme case through the shared receipt reader."""
    key, run_id = identifier(programme_id), identifier(run_id)
    record = DEFAULT_VIEWS.record(workspace, key)
    matches = [row for row in record["runs"] if row["run_id"] == run_id]
    if not matches:
        raise ValueError("The native run is outside this original saved programme")
    run = workspace.inspect_run(run_id)
    if any(row["native_selection"] != run["selection"] for row in matches):
        raise ValueError("The native case differs from the programme's original selection")
    context = {"schema": "upstate.programme-case-console-context/v1",
               "programme_id": key, "run_id": run_id,
               "programme_identity_sha256": key,
               "bindings_sha256": digest(matches)}
    value = read_run(workspace, run_id, **options)
    if value["native"]["selection"] != run["selection"]:
        raise ValueError("The original native selection changed while opening its case")
    programme = DEFAULT_VIEWS.read(workspace, key, run_id=run_id)
    selected_cases = [row for row in programme["runs"] if row["run_id"] == run_id]
    if len(selected_cases) != len(matches):
        raise ValueError("The saved programme's original case bindings changed")
    overview = {name: programme.get(name) for name in (
        "state", "recorded_state", "active", "phase", "pause_requested",
        "current_run", "requested_runs", "counts", "updated_at", "completed_at", "error")}
    overview["cases"] = [{name: row.get(name) for name in (
        "key", "title", "run_id", "state", "native_state", "active", "attempts",
        "programme_error", "failure_stage", "error")} for row in selected_cases]
    overview["comparison_errors"] = {row["key"]: programme["comparison_errors"][row["key"]]
        for row in matches if row["key"] in programme.get("comparison_errors", {})}
    cases = [{"id": row["key"], "label": row.get("title") or row["key"], "run_id": run_id,
              "profile_id": row["native_selection"]["profile_id"],
              "scenario_id": row["native_selection"]["scenario_id"],
              "changes": row.get("changes", {})}
             for row in matches]
    return {**value, "schema": "upstate.programme-case-console/v1",
            "programme_id": key, "title": record["selection"]["title"],
            "programme_state": programme["state"], "programme_active": programme["active"],
            "programme": overview, "case_bindings": cases, "context": context,
            "continuation": {"action": "compute.programme.run", "payload": {"programme_id": key},
                             "scope": "The original saved programme and its unfinished runs",
                             "native_run_argv": value["native"]["continue_argv"]}}
