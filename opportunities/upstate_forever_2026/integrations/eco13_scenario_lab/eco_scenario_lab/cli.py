"""Customer and integration CLI; complete receiving and retained reports."""
from __future__ import annotations
import argparse
from collections import Counter
from contextlib import contextmanager
import json
from pathlib import Path
import shutil
import sys
import tempfile
from .engine import freeze, revise, run_workspace, verify_plan
from .results import (apply_scenario_costs, build_comparison, inspect_table,
                      rank, render_report)
from .store import (ScenarioError, acquire, atomic_json, exclusive,
                    export_workspace, read_json, receive_workspace)


@contextmanager
def _report_generation(root: Path):
    """Keep the complete prior report edition when new choices fail."""
    reports = root / "reports"
    if reports.is_symlink() or (reports.exists() and not reports.is_dir()):
        raise ScenarioError("Reports must use a regular workspace directory")
    backup = Path(tempfile.mkdtemp(prefix=".report-edition-", dir=root))
    previous, rejected = backup / "previous", backup / "rejected"
    had_previous = reports.exists()
    retain_backup = False
    try:
        if had_previous:
            # Preserve existing symlinks as links, without reading their targets.
            shutil.copytree(reports, previous, symlinks=True)
        try:
            yield
        except BaseException:
            try:
                # Each rename is atomic. Keep generated files until restoration
                # succeeds so a filesystem error cannot destroy either edition.
                if reports.exists() or reports.is_symlink():
                    reports.rename(rejected)
                if had_previous:
                    previous.rename(reports)
            except BaseException as exc:
                retain_backup = True
                raise ScenarioError(
                    "The prior report edition needs recovery from " + str(backup)
                ) from exc
            raise
    finally:
        if not retain_backup:
            shutil.rmtree(backup, ignore_errors=True)


def _status(plan: dict, state: dict) -> dict:
    active = [state["jobs"][i] for i in state.get("active_jobs", {}).values()]
    adopted = plan.get("mode") == "adopted-upstate-experiment"
    planned = (plan["adopted_case_model_slots"] if adopted else
               (len(plan["scenarios"])+1)*len(plan["cases"])*len(plan["models"]))
    if isinstance(planned, bool) or not isinstance(planned, int) or planned < len(active):
        raise ScenarioError("Retained case/model counts do not match the received population")
    statuses = Counter(job["status"] for job in active)
    unrepresented = planned - len(active)
    pending = unrepresented + sum(statuses[name] for name in ("pending", "prepared", "queued"))
    result = {"project_id": plan["project_id"], "setup_id": plan["setup_id"],
              "mode": plan.get("mode", "native-plan"),
              "plan_sha256": plan["plan_sha256"], "pending": pending,
              "preflight": state.get("preflight"), "jobs": active}
    if not adopted:
        result.update(planned_native_runs=planned, status_counts=dict(statuses))
        return result
    original_counts = plan["original_counts"]
    source_runs = original_counts.get("runs")
    if isinstance(source_runs, bool) or not isinstance(source_runs, int) or source_runs < 0:
        raise ScenarioError("Original experiment planned run count is unavailable")
    case_states, run_states = {}, {}
    for job in active:
        for target, key, value in (
                (case_states, job["original_case_id"], job["status"]),
                (run_states, job["original_run_id"], job["native_status"])):
            if key in target and target[key] != value:
                raise ScenarioError("Original case or run states disagree across model slots")
            target[key] = value
    native_statuses = Counter(run_states.values())
    result.update(
        planned_native_runs=source_runs,
        snapshot_case_model_slots=planned,
        snapshot_unrepresented_slots=unrepresented,
        case_model_status_counts=dict(statuses),
        case_status_counts=dict(Counter(case_states.values())),
        native_run_status_counts=dict(native_statuses),
        represented_original_cases=len(case_states),
        observed_native_runs=sum(value != "not_prepared" for value in run_states.values()),
        unmaterialized_native_runs=native_statuses["not_prepared"],
        original_counts=original_counts,
        source_models=list(plan["models"]),
        native_model_available_slots=sum(bool(job.get("native_model_available")) for job in active),
        native_model_retained_slots=sum(bool(job.get("native_model_retained")) for job in active),
        paired_result_available_slots=sum(bool(job.get("paired_result_available")) for job in active),
    )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="eco-scenarios")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("acquire", help="Receive explicit public source files")
    p.add_argument("manifest", type=Path); p.add_argument("destination", type=Path)
    p = commands.add_parser("plan", help="Freeze inputs and prepare all parcel scenarios")
    p.add_argument("specification", type=Path); p.add_argument("workspace", type=Path)
    p = commands.add_parser("adopt", help="Receive an original experiment using a saved selection")
    p.add_argument("selection", type=Path); p.add_argument("workspace", type=Path)
    p = commands.add_parser("adopt-upstate", help="Receive a current original Upstate experiment")
    p.add_argument("source_workspace", type=Path)
    p.add_argument("experiment_id")
    p.add_argument("workspace", type=Path, help="New independent comparison directory")
    p.add_argument("--project-id", required=True)
    p.add_argument("--setup-id", required=True)
    p.add_argument("--currency", required=True)
    p.add_argument("--scenario-costs", type=Path,
                   help="JSON mapping of original alternative IDs to integer cents")
    p.add_argument("--page-size", type=int, default=250)
    p = commands.add_parser("run", help="Execute or resume the original native models")
    p.add_argument("workspace", type=Path); p.add_argument("--python")
    p = commands.add_parser("status", help="Show the complete retained model and case population")
    p.add_argument("workspace", type=Path)
    p = commands.add_parser("inspect", help="Inspect a native result table before binding fields")
    p.add_argument("table", type=Path); p.add_argument("--layer")
    p = commands.add_parser("compare", help="Create complete JSON, CSV and grayscale HTML reports")
    p.add_argument("workspace", type=Path)
    p.add_argument("--objectives", type=Path,
                   help="JSON array of explicit spatial_unit_id/metric pairs; watershed_id is also accepted")
    p.add_argument("--scenario-costs", type=Path,
                   help="Save revised intervention costs without rerunning native models")
    budget_options = p.add_mutually_exclusive_group()
    budget_options.add_argument("--budget-cents", type=int)
    budget_options.add_argument("--clear-budget", action="store_true")
    p.add_argument("--reset-report-options", action="store_true",
                   help="Start a new cost/objective edition instead of reusing saved report choices")
    p = commands.add_parser("export", help="Export all retained inputs, native files and reports")
    p.add_argument("workspace", type=Path); p.add_argument("archive", type=Path)
    p = commands.add_parser("receive", help="Receive an independently editable workspace")
    p.add_argument("archive", type=Path); p.add_argument("workspace", type=Path)
    p = commands.add_parser("revise", help="Create an independent plan revision from retained inputs")
    p.add_argument("workspace", type=Path); p.add_argument("changes", type=Path)
    p.add_argument("destination", type=Path)
    args = parser.parse_args(argv)
    exit_code = 0
    try:
        if args.command == "acquire":
            result = acquire(args.manifest, args.destination)
        elif args.command == "plan":
            result = freeze(args.specification, args.workspace)
        elif args.command == "adopt":
            from .experiment_intake import adopt
            result = adopt(args.selection, args.workspace)
            exit_code = 2 if result.get("status") == "partial" or result.get("incomplete") else 0
        elif args.command == "adopt-upstate":
            from .upstate_intake import adopt_workspace
            costs = read_json(args.scenario_costs) if args.scenario_costs else {}
            result = adopt_workspace(args.source_workspace, args.experiment_id, args.workspace,
                                     project_id=args.project_id, setup_id=args.setup_id,
                                     currency=args.currency, scenario_costs=costs,
                                     page_size=args.page_size)
            exit_code = 2 if result.get("status") == "partial" or result.get("incomplete") else 0
        elif args.command == "run":
            state = run_workspace(args.workspace, python=args.python)
            active = [state["jobs"][i] for i in state["active_jobs"].values()]
            result = {"jobs": len(active), "status_counts": dict(Counter(j["status"] for j in active))}
            exit_code = 2 if any(j["status"] != "complete" for j in active) else 0
        elif args.command == "status":
            with exclusive(args.workspace):
                plan, state = verify_plan(args.workspace)
                result = _status(plan, state)
        elif args.command == "inspect":
            result = inspect_table(args.table, args.layer)
        elif args.command == "compare":
            with exclusive(args.workspace):
                plan, _ = verify_plan(args.workspace)
                with _report_generation(args.workspace):
                    settings_path = args.workspace / "reports" / "report-selection.json"
                    settings = {}
                    if settings_path.is_file() and not args.reset_report_options:
                        settings = read_json(settings_path)
                        if (not isinstance(settings, dict) or settings.get("schema") != 1
                                or settings.get("plan_sha256") != plan["plan_sha256"]):
                            raise ScenarioError("Saved report choices belong to another edition; use --reset-report-options")
                    costs = (read_json(args.scenario_costs) if args.scenario_costs
                             else settings.get("scenario_costs"))
                    objectives = (read_json(args.objectives) if args.objectives
                                  else settings.get("objectives"))
                    budget = (None if args.clear_budget else args.budget_cents
                              if args.budget_cents is not None else settings.get("budget_cents"))
                    if budget is not None and objectives is None:
                        raise ScenarioError("A budget screen needs explicit objectives")
                    comparison = build_comparison(args.workspace)
                    if costs is not None:
                        comparison = apply_scenario_costs(args.workspace, comparison, costs)
                    else:
                        (args.workspace / "reports" / "scenario-costs.json").unlink(missing_ok=True)
                    ranking = rank(comparison, objectives, budget) if objectives is not None else None
                    if ranking is not None:
                        atomic_json(args.workspace / "reports" / "ranking.json", ranking)
                    else:
                        (args.workspace / "reports" / "ranking.json").unlink(missing_ok=True)
                    atomic_json(settings_path,
                                {"schema": 1, "objectives": objectives,
                                 "budget_cents": budget, "scenario_costs": costs,
                                 "plan_sha256": comparison["plan_sha256"]})
                    report = render_report(args.workspace, comparison, ranking)
                    result = {"report": str(report), "paired_records": len(comparison["rows"]),
                              "parameter_records": len(comparison.get("parameter_rows", [])),
                              "source_kind": comparison.get("source_kind", "native-watershed-tables"),
                              "incomplete": comparison["incomplete"], "ranking": ranking}
                    exit_code = 2 if comparison["incomplete"] else 0
        elif args.command == "export":
            result = export_workspace(args.workspace, args.archive)
        elif args.command == "receive":
            result = receive_workspace(args.archive, args.workspace)
        elif args.command == "revise":
            result = revise(args.workspace, args.destination, args.changes)
        else:
            raise ScenarioError("Unknown operation")
        print(json.dumps(result, indent=2, allow_nan=False))
    except (OSError, KeyError, ValueError, ImportError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
