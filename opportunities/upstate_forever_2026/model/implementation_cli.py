"""Native implementation workflow CLI.

Run from the application root:
    python -m model.implementation_cli --workspace /path/to/workspace --help
"""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import sys
import tempfile

from .implementation import (
    COLLECTIONS, MAX_JSON_BYTES, ImplementationError, ImplementationStore,
    RevisionConflict, ValidationError, json_text, load_json, make_plan,
    read_document, render_report_html, report_csv, schedule_plan, summarize_plan,
    utc_now, validate_plan,
)
from .implementation import _safe_output, _fsync_directory


def _duration(value: str):
    if value.lower() in ("unknown", "null"):
        return None
    try:
        result = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a whole workday count or 'unknown'.") from exc
    if result < 0:
        raise argparse.ArgumentTypeError("Duration must be nonnegative.")
    return result


def _working_days(value: str):
    try:
        values = [int(part.strip()) for part in value.split(",")]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use comma-separated ISO weekdays, such as 1,2,3,4,5.") from exc
    if not values or len(set(values)) != len(values) or any(day not in range(1, 8) for day in values):
        raise argparse.ArgumentTypeError("Supply unique ISO weekdays from 1 through 7.")
    return values


def _expected(parser):
    parser.add_argument("--expected-revision", type=int, required=True,
                        help="Revision of the plan being edited.")


def _common_record(parser):
    parser.add_argument("plan_id")
    parser.add_argument("record_id")
    _expected(parser)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Implementation plans, field monitoring, retained sources and portable reports."
    )
    parser.add_argument("--workspace", default=".", help="Workspace root (default: current directory).")
    parser.add_argument("--actor", default="", help="Optional operator name for revision history.")
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="Create a new plan without overwriting an existing ID.")
    create.add_argument("plan_id")
    create.add_argument("--title", required=True)
    create.add_argument("--start-date", required=True)
    create.add_argument("--target-date")
    create.add_argument("--description", default="")
    create.add_argument("--working-days", type=_working_days, default=[1, 2, 3, 4, 5])
    create.add_argument("--holiday", action="append", default=[])

    commands.add_parser("list", help="List the current committed plans.")
    for command in ("show", "history", "schedule", "summary"):
        item = commands.add_parser(command)
        item.add_argument("plan_id")
        if command == "show":
            item.add_argument("--revision", type=int)
        if command in ("schedule", "summary"):
            item.add_argument("--as-of", help="Selected calendar date, YYYY-MM-DD (default: UTC today).")
    validate = commands.add_parser("validate", help="Read and validate a portable JSON plan.")
    validate.add_argument("input")

    for command in ("import", "save"):
        item = commands.add_parser(command)
        item.add_argument("input", help="Portable plan JSON file.")
        item.add_argument("--expected-revision", type=int, required=(command == "save"))

    export = commands.add_parser("export")
    export.add_argument("plan_id")
    export.add_argument("output")
    export.add_argument("--revision", type=int)
    export.add_argument("--overwrite", action="store_true")


    evidence_export = commands.add_parser(
        "evidence-export", help="Retain a complete plan and original-file ZIP; optionally copy it out."
    )
    evidence_export.add_argument("plan_id")
    evidence_export.add_argument("--revision", type=int, help="Exact retained revision (default: current).")
    evidence_export.add_argument("--out", help="Optional destination ZIP outside the implementation bank.")
    evidence_export.add_argument("--overwrite", action="store_true",
                                 help="Replace an existing --out file; otherwise publication is create-only.")

    evidence_import = commands.add_parser(
        "evidence-import", help="Validate original evidence bytes and import their complete plan."
    )
    evidence_import.add_argument("input", help="Complete upstate.implementation-evidence/v1 ZIP.")
    evidence_import.add_argument("--expected-revision", type=int,
                                 help="Optional additional current-revision check; omit for a new plan.")
    evidence_import.add_argument("--plan-id", help="Require the archive's original plan ID.")

    evidence_inspect = commands.add_parser(
        "evidence-inspect", help="Validate a complete evidence ZIP without creating or changing a workspace."
    )
    evidence_inspect.add_argument("input")
    evidence_inspect.add_argument("--include-plan", action="store_true",
                                  help="Include the complete unchanged plan as document in the JSON result.")

    report = commands.add_parser("report", help="Create a new complete HTML/CSV/JSON report directory.")
    report.add_argument("plan_id")
    report.add_argument("--out", required=True)
    report.add_argument("--as-of")

    for command in ("csv", "html"):
        item = commands.add_parser(command)
        item.add_argument("plan_id")
        item.add_argument("--out", required=True)
        item.add_argument("--as-of")
        item.add_argument("--overwrite", action="store_true")
        if command == "csv":
            item.add_argument("--table", required=True, choices=(
                "tasks", "budget", "visits", "observations", "sites",
                "monitoring_plans", "activities",
            ))

    append = commands.add_parser(
        "append", help="Append original records from a JSON object containing a records array."
    )
    append.add_argument("plan_id")
    append.add_argument("collection", choices=COLLECTIONS)
    append.add_argument("input", help='JSON object shaped {"records": [...]}')
    _expected(append)

    attach = commands.add_parser("attach", help="Copy an actual file into the immutable source bank.")
    attach.add_argument("plan_id")
    attach.add_argument("input")
    attach.add_argument("--label", default="")
    _expected(attach)

    task = commands.add_parser("add-task")
    _common_record(task)
    task.add_argument("--title", required=True)
    task.add_argument("--candidate-id")
    task.add_argument("--phase", default="implementation")
    task.add_argument("--assignee", default="")
    task.add_argument("--status", choices=("planned", "in_progress", "complete", "cancelled"),
                      default="planned")
    task.add_argument("--duration", type=_duration, default=None)
    task.add_argument("--progress", type=float, default=0)
    task.add_argument("--start-not-before")
    task.add_argument("--depends-on", action="append", default=[])
    task.add_argument("--notes", default="")
    task.add_argument("--evidence-ref", action="append", default=[])

    edit = commands.add_parser("edit-task")
    _common_record(edit)
    edit.add_argument("--title")
    edit.add_argument("--phase")
    edit.add_argument("--assignee")
    edit.add_argument("--status", choices=("planned", "in_progress", "complete", "cancelled"))
    edit.add_argument("--duration", type=_duration, default=argparse.SUPPRESS)
    edit.add_argument("--progress", type=float)
    edit.add_argument("--start-not-before", help="YYYY-MM-DD, or clear to remove the constraint.")
    dependencies = edit.add_mutually_exclusive_group()
    dependencies.add_argument("--depends-on", action="append", help="Replace the full predecessor list.")
    dependencies.add_argument("--clear-depends", action="store_true")
    edit.add_argument("--notes")
    edit.add_argument("--evidence-ref", action="append", help="Append an original evidence reference.")

    budget = commands.add_parser("add-budget-line")
    _common_record(budget)
    budget.add_argument("--task-id")
    budget.add_argument("--kind", choices=("budget", "commitment", "actual"), required=True)
    budget.add_argument("--label", required=True)
    budget.add_argument("--amount-minor", type=int, required=True, help="Actual entered USD cents.")
    budget.add_argument("--date")
    budget.add_argument("--reference")

    site = commands.add_parser("add-site")
    _common_record(site)
    site.add_argument("--label", required=True)
    site.add_argument("--latitude", type=float)
    site.add_argument("--longitude", type=float)
    site.add_argument("--candidate-id")
    site.add_argument("--source-ref", help="Original source_links ID.")

    monitor = commands.add_parser("add-monitoring-plan")
    _common_record(monitor)
    monitor.add_argument("--title", required=True)
    monitor.add_argument("--objective", default="")
    monitor.add_argument("--site-id", action="append", default=[])
    monitor.add_argument("--parameter", action="append", default=[])
    monitor.add_argument("--method-ref")
    monitor.add_argument("--frequency")
    monitor.add_argument("--notes", default="")

    visit = commands.add_parser("add-visit")
    _common_record(visit)
    visit.add_argument("--site-id", required=True)
    visit.add_argument("--monitoring-plan-id")
    visit.add_argument("--planned-date")
    visit.add_argument("--visited-at")
    visit.add_argument("--observer", default="")
    visit.add_argument("--status", choices=("planned", "complete", "cancelled"), default="planned")
    visit.add_argument("--notes", default="")
    visit.add_argument("--evidence-ref", action="append", default=[])

    complete = commands.add_parser("complete-visit")
    _common_record(complete)
    complete.add_argument("--visited-at", required=True, help="Actual ISO timestamp, including timezone.")
    complete.add_argument("--observer")
    complete.add_argument("--notes")
    complete.add_argument("--evidence-ref", action="append")

    activity = commands.add_parser("add-activity")
    _common_record(activity)
    activity.add_argument("--visit-id", required=True)
    activity.add_argument("--site-id", required=True)
    activity.add_argument("--kind", choices=("sample", "measurement", "inspection", "photo"),
                          required=True)
    activity.add_argument("--sample-id")
    activity.add_argument("--collected-at")
    activity.add_argument("--method")
    activity.add_argument("--custody-ref")
    activity.add_argument("--notes", default="")

    observation = commands.add_parser("add-observation")
    _common_record(observation)
    observation.add_argument("--activity-id", required=True)
    observation.add_argument("--parameter", required=True)
    observation.add_argument("--result-type", choices=("numeric", "censored", "text", "missing"),
                             required=True)
    observation.add_argument("--value", type=float, help="Finite numeric result; omit for all other types.")
    observation.add_argument("--original-text", required=True)
    observation.add_argument("--unit", default="")
    for name in ("basis", "fraction", "qualifier", "method", "qa-status"):
        observation.add_argument("--" + name)
    observation.add_argument("--detection-limit", type=float)
    observation.add_argument("--quantitation-limit", type=float)
    observation.add_argument("--notes", default="")
    return parser


def _optional(record, args, *names):
    for name in names:
        value = getattr(args, name, None)
        if value is not None:
            record[name] = value
    return record


def _record_from_args(args):
    command = args.command
    row = {"id": args.record_id}
    if command == "add-task":
        row.update(title=args.title, phase=args.phase, assignee=args.assignee,
                   status=args.status, duration_days=args.duration,
                   progress_pct=args.progress, depends_on=args.depends_on,
                   notes=args.notes, evidence_refs=args.evidence_ref)
        _optional(row, args, "candidate_id", "start_not_before")
        return "tasks", row
    if command == "add-budget-line":
        row.update(kind=args.kind, label=args.label, amount_minor=args.amount_minor)
        _optional(row, args, "task_id", "date", "reference")
        return "budget_lines", row
    if command == "add-site":
        row["label"] = args.label
        _optional(row, args, "latitude", "longitude", "candidate_id", "source_ref")
        return "sites", row
    if command == "add-monitoring-plan":
        row.update(title=args.title, objective=args.objective, site_ids=args.site_id,
                   parameters=args.parameter, notes=args.notes)
        _optional(row, args, "method_ref", "frequency")
        return "monitoring_plans", row
    if command == "add-visit":
        row.update(site_id=args.site_id, observer=args.observer, status=args.status,
                   notes=args.notes, evidence_refs=args.evidence_ref)
        _optional(row, args, "monitoring_plan_id", "planned_date", "visited_at")
        return "visits", row
    if command == "add-activity":
        row.update(visit_id=args.visit_id, site_id=args.site_id, kind=args.kind, notes=args.notes)
        _optional(row, args, "sample_id", "collected_at", "method", "custody_ref")
        return "activities", row
    if command == "add-observation":
        row.update(activity_id=args.activity_id, parameter=args.parameter,
                   result_type=args.result_type, value=args.value,
                   original_text=args.original_text, unit=args.unit, notes=args.notes)
        _optional(row, args, "basis", "fraction", "qualifier", "method",
                  "qa_status", "detection_limit", "quantitation_limit")
        return "observations", row
    raise ImplementationError(f"Unsupported record command: {command}")



def _copy_evidence_archive(store, receipt, output, overwrite):
    """Stream and atomically publish a verified copy of the retained ZIP."""
    source = store.root / receipt["reference"]
    destination = Path(output).expanduser().absolute()
    if destination.is_symlink():
        raise ImplementationError("Evidence output must not be a symlink.")
    if destination.resolve() == source.resolve():
        return str(source)
    bank = store.base.parent.resolve()
    if destination.resolve().is_relative_to(bank):
        raise ImplementationError(
            "Choose an evidence output outside the managed implementation bank."
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".pending-evidence-copy-", dir=destination.parent
    )
    temporary = Path(temporary_name)
    digest, count = hashlib.sha256(), 0
    try:
        with os.fdopen(descriptor, "wb") as target, source.open("rb") as original:
            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                count += len(chunk)
                if count > receipt["bytes"]:
                    raise ImplementationError("The retained evidence archive changed during copy.")
                digest.update(chunk)
                target.write(chunk)
            if (count, digest.hexdigest()) != (receipt["bytes"], receipt["sha256"]):
                raise ImplementationError("The retained evidence archive changed during copy.")
            target.flush()
            os.fsync(target.fileno())
        if overwrite:
            os.replace(temporary, destination)
        else:
            try:
                os.link(temporary, destination)
            except FileExistsError as exc:
                raise ImplementationError(
                    f"Output already exists: {destination}. Choose another path or use --overwrite."
                ) from exc
        _fsync_directory(destination.parent)
        return str(destination)
    finally:
        temporary.unlink(missing_ok=True)

def execute(args):
    if args.command == "validate":
        plan = read_document(args.input)
        return dict(valid=True, plan_id=plan["id"], revision=plan["revision"])
    if args.command == "evidence-inspect":
        from .implementation_evidence import read_package
        source = Path(args.input).expanduser().resolve(strict=True)
        received = read_package(source)
        result = dict(
            valid=True, file_ref=str(source), archive_bytes=received["bytes"],
            archive_sha256=received["sha256"], plan_id=received["plan"]["id"],
            revision=received["plan"]["revision"], title=received["plan"]["title"],
            source_count=len(received["files"]), manifest=received["manifest"],
        )
        if args.include_plan:
            result["document"] = received["plan"]
        return result
    store = ImplementationStore(args.workspace)
    command = args.command
    if command == "create":
        return store.create(make_plan(
            args.plan_id, args.title, args.start_date, description=args.description,
            target_date=args.target_date, working_days=args.working_days,
            holidays=args.holiday,
        ), actor=args.actor)
    if command == "list":
        return store.list_plans()
    if command == "show":
        return store.get(args.plan_id, args.revision)
    if command == "history":
        return store.history(args.plan_id)
    if command == "import":
        return store.import_document(read_document(args.input), args.expected_revision, args.actor)
    if command == "save":
        return store.save(read_document(args.input), args.expected_revision, args.actor)
    if command == "export":
        return {"file_ref": store.export_json(
            args.plan_id, args.output, args.revision, overwrite=args.overwrite,
        )}
    if command == "evidence-export":
        from .implementation_evidence import export_package
        if args.overwrite and args.out is None:
            raise ImplementationError("--overwrite requires --out.")
        receipt = export_package(store, args.plan_id, revision=args.revision)
        native_file = str(store.root / receipt["reference"])
        file_ref = (_copy_evidence_archive(store, receipt, args.out, args.overwrite)
                    if args.out is not None else native_file)
        return dict(receipt, file_ref=file_ref, native_file_ref=native_file)
    if command == "evidence-import":
        from .implementation_evidence import import_package
        return import_package(
            store, Path(args.input).expanduser(), expected_revision=args.expected_revision,
            expected_plan_id=args.plan_id, actor=args.actor,
        )
    if command == "schedule":
        return schedule_plan(store.get(args.plan_id), args.as_of)
    if command == "summary":
        return summarize_plan(store.get(args.plan_id), args.as_of)
    if command == "report":
        result = store.report(args.plan_id, args.out, args.as_of)
        # Keep the complete original edition with its saved native plan so
        # ordinary CLI reports reopen through the same Workspace transfer path.
        result["retained_report"] = store.retain_report(result["directory"])
        return result
    if command in ("csv", "html"):
        plan = store.get(args.plan_id)
        content = (report_csv(plan, args.table, args.as_of) if command == "csv"
                   else render_report_html(plan, args.as_of))
        if command == "csv":
            content = "\ufeff" + content
        return {"file_ref": _safe_output(args.out, content, args.overwrite)}
    if command == "attach":
        return store.attach_file(args.plan_id, args.input, args.expected_revision,
                                 args.actor, args.label)
    if command == "append":
        with Path(args.input).open("rb") as handle:
            payload = load_json(handle.read(MAX_JSON_BYTES + 1))
        if not isinstance(payload.get("records"), list):
            raise ImplementationError('Append input must contain a "records" array.')
        return store.add_records(args.plan_id, args.collection, payload["records"],
                                 args.expected_revision, args.actor)
    if command.startswith("add-"):
        collection, row = _record_from_args(args)
        return store.add_records(args.plan_id, collection, [row],
                                 args.expected_revision, args.actor)
    if command in ("edit-task", "complete-visit"):
        plan = store.get(args.plan_id)
        if plan["revision"] != args.expected_revision:
            raise RevisionConflict(args.plan_id, args.expected_revision, plan["revision"])
        collection = "tasks" if command == "edit-task" else "visits"
        row = next((row for row in plan[collection] if row["id"] == args.record_id), None)
        if row is None:
            raise ImplementationError(f"Record not found: {collection}/{args.record_id}")
        if command == "edit-task":
            _optional(row, args, "title", "phase", "assignee", "status", "notes")
            if hasattr(args, "duration"):
                row["duration_days"] = args.duration
            if args.progress is not None:
                row["progress_pct"] = args.progress
            if args.start_not_before == "clear":
                row.pop("start_not_before", None)
            elif args.start_not_before:
                row["start_not_before"] = args.start_not_before
            if args.clear_depends:
                row["depends_on"] = []
            elif args.depends_on is not None:
                row["depends_on"] = args.depends_on
        else:
            row["status"] = "complete"
            row["visited_at"] = args.visited_at
            _optional(row, args, "observer", "notes")
        if args.evidence_ref:
            for reference in args.evidence_ref:
                if reference not in row["evidence_refs"]:
                    row["evidence_refs"].append(reference)
        return store.save(plan, args.expected_revision, args.actor)
    raise ImplementationError(f"Unknown command: {command}")


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = execute(args)
        sys.stdout.write(json_text(result))
        return 0
    except RevisionConflict as exc:
        sys.stderr.write(json_text(dict(
            error="revision_conflict", message=str(exc), plan_id=exc.plan_id,
            expected_revision=exc.expected_revision, current_revision=exc.current_revision,
            conflict_ref=exc.conflict_ref,
        )))
        return 3
    except ValidationError as exc:
        sys.stderr.write(json_text(dict(error="validation_error", issues=exc.issues)))
        return 2
    except (ImplementationError, OSError, ValueError) as exc:
        sys.stderr.write(json_text(dict(error="operation_error", message=str(exc))))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
