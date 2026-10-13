"""Durable implementation planning and field monitoring, using Python's standard library.

Portable documents use upstate.implementation-plan/v1. Revisions and attachments
live under <workspace.root>/implementation/plans/<id>. The native Workspace is
only consumed through its root attribute. No optimizer, nutrient calculator, or
remote service is invoked by this module.
"""
from __future__ import annotations

import bisect
import copy
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
from typing import Any, Iterable

SCHEMA = "upstate.implementation-plan/v1"
REVISION_SCHEMA = "upstate.implementation-revision/v1"
SAFE_INTEGER = 9007199254740991
MAX_JSON_BYTES = 16 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REVISION_RE = re.compile(r"^(\d{16})\.json$")
COLLECTIONS = (
    "source_links", "candidates", "tasks", "budget_lines", "sites",
    "monitoring_plans", "visits", "activities", "observations",
)


class ImplementationError(ValueError):
    """An actionable document or operation error."""


class ValidationError(ImplementationError):
    def __init__(self, issues: Iterable[str]):
        self.issues = list(issues)
        super().__init__("Invalid implementation plan:\n" + "\n".join(self.issues))


class RevisionConflict(ImplementationError):
    def __init__(self, plan_id: str, expected: Any, current: int,
                 conflict_ref: str | None = None):
        self.plan_id = plan_id
        self.expected_revision = expected
        self.current_revision = current
        self.conflict_ref = conflict_ref
        message = (f"Plan {plan_id!r} is at revision {current}; "
                   f"the supplied base revision was {expected!r}.")
        if conflict_ref:
            message += (" Incoming content is preserved at " + conflict_ref +
                        ". Reconcile it with the current revision and save with that revision.")
        super().__init__(message)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fail_constant(value: str):
    raise ImplementationError(f"JSON contains a nonfinite number: {value}")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ImplementationError(f"Duplicate JSON object key: {key!r}")
        result[key] = value
    return result


def load_json(value: bytes | str, *, max_bytes: int = MAX_JSON_BYTES) -> dict:
    raw = value if isinstance(value, bytes) else value.encode("utf-8")
    if len(raw) > max_bytes:
        raise ImplementationError(f"Document exceeds {max_bytes} bytes.")
    try:
        result = json.loads(
            raw.decode("utf-8-sig"), parse_constant=_fail_constant,
            object_pairs_hook=_unique_object,
        )
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ImplementationError(f"Cannot read JSON: {exc}") from exc
    if not isinstance(result, dict):
        raise ImplementationError("The JSON root must be an object.")
    return result


def read_document(path: str | Path) -> dict:
    path = Path(path)
    with path.open("rb") as handle:
        raw = handle.read(MAX_JSON_BYTES + 1)
    return validate_plan(load_json(raw))


def canonical_bytes(document: Any) -> bytes:
    try:
        return json.dumps(document, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, RecursionError, UnicodeError) as exc:
        raise ImplementationError(f"Document cannot be serialized safely: {exc}") from exc


def document_digest(document: dict) -> str:
    return hashlib.sha256(canonical_bytes(document)).hexdigest()


def json_text(document: Any) -> str:
    return json.dumps(document, ensure_ascii=False, indent=2,
                      sort_keys=True, allow_nan=False) + "\n"


def _safe_id(value: Any, name: str = "id") -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ImplementationError(
            f"{name} must be 1–96 letters, digits, underscores or hyphens, "
            "beginning with a letter or digit."
        )
    return value


def _date(value: str) -> dt.date:
    if not isinstance(value, str) or not DATE_RE.fullmatch(value):
        raise ValueError("expected YYYY-MM-DD")
    return dt.date.fromisoformat(value)


def _timestamp(value: str) -> dt.datetime:
    if not isinstance(value, str) or "T" not in value:
        raise ValueError("expected an ISO timestamp with timezone")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("timestamp must include its timezone")
    return parsed


def _integer(value: Any, minimum: int = 0, maximum: int = SAFE_INTEGER) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def make_plan(plan_id: str, title: str, start_date: str, *,
              description: str = "", target_date: str | None = None,
              working_days: list[int] | None = None,
              holidays: list[str] | None = None) -> dict:
    now = utc_now()
    result = dict(
        schema=SCHEMA, id=plan_id, revision=0, title=title,
        description=description, start_date=start_date, currency="USD",
        working_days=list(working_days if working_days is not None else [1, 2, 3, 4, 5]),
        holidays=list(holidays or []), created_at=now, updated_at=now,
        **{name: [] for name in COLLECTIONS},
    )
    if target_date is not None:
        result["target_date"] = target_date
    return validate_plan(result)


def validate_plan(document: dict) -> dict:
    """Validate all core semantics and retain unknown JSON fields unchanged.

    IDs are unique within each typed collection. References always address the
    original ID in the specified collection; no label-based remapping occurs.
    """
    issues: list[str] = []
    if not isinstance(document, dict):
        raise ValidationError(["plan: expected an object"])

    def error(path, message):
        issues.append(f"{path}: {message}")

    def json_value(value, path="$", depth=0):
        if depth > 64:
            error(path, "JSON nesting exceeds 64 levels")
            return
        if value is None or type(value) in (bool, str):
            if isinstance(value, str):
                try:
                    value.encode("utf-8")
                except UnicodeError:
                    error(path, "invalid Unicode surrogate")
        elif type(value) is int:
            if abs(value) > SAFE_INTEGER:
                error(path, "integer is outside the interoperable safe range")
        elif type(value) is float:
            if not math.isfinite(value):
                error(path, "number must be finite")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                json_value(item, f"{path}[{index}]", depth + 1)
        elif isinstance(value, dict):
            for key, item in value.items():
                if not isinstance(key, str):
                    error(path, "object keys must be strings")
                else:
                    json_value(key, path, depth + 1)
                    json_value(item, f"{path}.{key}", depth + 1)
        else:
            error(path, "value is not JSON compatible")

    def string(obj, key, path, required=True, nonempty=False):
        if key not in obj:
            if required:
                error(f"{path}.{key}", "is required")
            return
        value = obj[key]
        if not required and value is None:
            return
        if not isinstance(value, str) or (nonempty and not value.strip()):
            error(f"{path}.{key}", "expected " + ("a nonempty string" if nonempty else "a string"))

    def ident(obj, key, path, required=True):
        if key not in obj or obj[key] is None:
            if required:
                error(f"{path}.{key}", "is required")
            return
        try:
            _safe_id(obj[key], key)
        except ImplementationError as exc:
            error(f"{path}.{key}", str(exc))

    def date_field(obj, key, path, required=False, timestamp=False):
        if key not in obj or obj[key] is None:
            if required:
                error(f"{path}.{key}", "is required")
            return
        try:
            (_timestamp if timestamp else _date)(obj[key])
        except (ValueError, TypeError, OverflowError) as exc:
            error(f"{path}.{key}", str(exc))

    def numeric(obj, key, path, required=False, minimum=None, maximum=None):
        if key not in obj or obj[key] is None:
            if required:
                error(f"{path}.{key}", "is required")
            return
        value = obj[key]
        if (not _number(value) or (minimum is not None and value < minimum)
                or (maximum is not None and value > maximum)):
            error(f"{path}.{key}", "expected a finite number within the allowed range")

    def string_list(obj, key, path, required=True, unique=False, ids=False):
        if key not in obj:
            if required:
                error(f"{path}.{key}", "is required")
            return []
        value = obj[key]
        if not isinstance(value, list):
            error(f"{path}.{key}", "expected an array")
            return []
        result = []
        for index, item in enumerate(value):
            if not isinstance(item, str) or not item.strip():
                error(f"{path}.{key}[{index}]", "expected a nonempty string")
            else:
                if ids and not ID_RE.fullmatch(item):
                    error(f"{path}.{key}[{index}]", "invalid ID")
                result.append(item)
        if unique and len(result) != len(set(result)):
            error(f"{path}.{key}", "contains duplicate values")
        return result

    json_value(document)
    if issues:
        raise ValidationError(issues)
    if document.get("schema") != SCHEMA:
        error("schema", f"must equal {SCHEMA}")
    ident(document, "id", "plan")
    if not _integer(document.get("revision")):
        error("revision", "expected a nonnegative safe integer")
    string(document, "title", "plan", nonempty=True)
    string(document, "description", "plan")
    if document.get("currency") != "USD":
        error("currency", "must equal USD")
    date_field(document, "start_date", "plan", required=True)
    date_field(document, "target_date", "plan")
    for key in ("created_at", "updated_at"):
        date_field(document, key, "plan", required=True, timestamp=True)
    if isinstance(document.get("created_at"), str) and isinstance(document.get("updated_at"), str):
        try:
            if _timestamp(document["updated_at"]) < _timestamp(document["created_at"]):
                error("updated_at", "cannot precede created_at")
        except (ValueError, TypeError):
            pass
    if document.get("target_date") and document.get("start_date"):
        try:
            if _date(document["target_date"]) < _date(document["start_date"]):
                error("target_date", "cannot precede start_date")
        except (ValueError, TypeError):
            pass
    weekdays = document.get("working_days")
    if (not isinstance(weekdays, list) or not weekdays or
            any(not _integer(day, 1, 7) for day in weekdays) or
            len(weekdays) != len(set(day for day in weekdays if type(day) is int))):
        error("working_days", "expected unique ISO weekdays 1 through 7; at least one is required")
    holidays = string_list(document, "holidays", "plan", unique=True)
    for holiday in holidays:
        try:
            _date(holiday)
        except ValueError:
            error("holidays", f"invalid date {holiday!r}")

    rows: dict[str, list[dict]] = {}
    indexes: dict[str, dict[str, dict]] = {}
    for name in COLLECTIONS:
        entries = document.get(name)
        if not isinstance(entries, list):
            error(name, "expected an array")
            entries = []
        rows[name] = []
        indexes[name] = {}
        for index, row in enumerate(entries):
            path = f"{name}[{index}]"
            if not isinstance(row, dict):
                error(path, "expected an object")
                continue
            rows[name].append(row)
            ident(row, "id", path)
            row_id = row.get("id")
            if isinstance(row_id, str):
                if row_id in indexes[name]:
                    error(path + ".id", f"duplicate ID {row_id!r}")
                indexes[name][row_id] = row

    def reference(row, key, collection, path, required=False):
        ident(row, key, path, required)
        value = row.get(key)
        if value is not None and isinstance(value, str) and value not in indexes[collection]:
            error(path + "." + key, f"unknown {collection} ID {value!r}")

    for row in rows["source_links"]:
        path = f"source_links.{row.get('id', '?')}"
        string(row, "kind", path, nonempty=True)
        string(row, "label", path, nonempty=True)
        string(row, "reference", path, required=False, nonempty=True)

    for row in rows["candidates"]:
        path = f"candidates.{row.get('id', '?')}"
        string(row, "label", path, nonempty=True)
        numeric(row, "area_ha", path, minimum=0)
        if not isinstance(row.get("source"), (dict, str)) or not row.get("source"):
            error(path + ".source", "expected the original source reference or frozen snapshot object")
        if not isinstance(row.get("modeled_benefits"), list):
            error(path + ".modeled_benefits", "expected the retained array of modeled results")
        source = row.get("source")
        if isinstance(source, dict) and "source_link_id" in source:
            reference(source, "source_link_id", "source_links", path + ".source", required=True)
            link_id = source.get("source_link_id")
            link = indexes["source_links"].get(link_id) if isinstance(link_id, str) else None
            if link is not None:
                for source_key, link_key in (("source_digest", "source_digest"),
                                              ("source_id", "source_id"), ("source_kind", "kind")):
                    if source_key in source and link_key in link and source[source_key] != link[link_key]:
                        error(path + ".source." + source_key,
                              "does not match the retained original source link")

    for row in rows["tasks"]:
        path = f"tasks.{row.get('id', '?')}"
        for key in ("title", "phase", "assignee", "notes"):
            string(row, key, path, nonempty=(key == "title"))
        reference(row, "candidate_id", "candidates", path)
        if row.get("status") not in ("planned", "in_progress", "complete", "cancelled"):
            error(path + ".status", "expected planned, in_progress, complete or cancelled")
        if "duration_days" not in row or (row["duration_days"] is not None and
                                                       not _integer(row["duration_days"])):
            error(path + ".duration_days", "expected a nonnegative safe integer or null")
        numeric(row, "progress_pct", path, required=True, minimum=0, maximum=100)
        date_field(row, "start_not_before", path)
        dependencies = string_list(row, "depends_on", path, unique=True, ids=True)
        for dependency in dependencies:
            if dependency not in indexes["tasks"]:
                error(path + ".depends_on", f"unknown task ID {dependency!r}")
        string_list(row, "evidence_refs", path, unique=True)

    totals = dict(budget=0, commitment=0, actual=0)
    for row in rows["budget_lines"]:
        path = f"budget_lines.{row.get('id', '?')}"
        reference(row, "task_id", "tasks", path)
        string(row, "label", path, nonempty=True)
        kind = row.get("kind")
        if not isinstance(kind, str) or kind not in totals:
            error(path + ".kind", "expected budget, commitment or actual")
        amount = row.get("amount_minor")
        if not _integer(amount):
            error(path + ".amount_minor", "expected a nonnegative safe integer in USD cents")
        elif isinstance(kind, str) and kind in totals:
            totals[kind] += amount
        date_field(row, "date", path)
        string(row, "reference", path, required=False, nonempty=True)
    if any(total > SAFE_INTEGER for total in totals.values()):
        error("budget_lines", "a kind total exceeds the interoperable safe integer range")

    for row in rows["sites"]:
        path = f"sites.{row.get('id', '?')}"
        string(row, "label", path, nonempty=True)
        reference(row, "candidate_id", "candidates", path)
        reference(row, "source_ref", "source_links", path)
        numeric(row, "latitude", path, minimum=-90, maximum=90)
        numeric(row, "longitude", path, minimum=-180, maximum=180)
        if (row.get("latitude") is None) != (row.get("longitude") is None):
            error(path, "latitude and longitude must be supplied together")

    for row in rows["monitoring_plans"]:
        path = f"monitoring_plans.{row.get('id', '?')}"
        for key in ("title", "objective", "notes"):
            string(row, key, path, nonempty=(key == "title"))
        site_ids = string_list(row, "site_ids", path, unique=True, ids=True)
        for site_id in site_ids:
            if site_id not in indexes["sites"]:
                error(path + ".site_ids", f"unknown site ID {site_id!r}")
        string_list(row, "parameters", path, unique=True)
        for key in ("method_ref", "frequency"):
            string(row, key, path, required=False)

    for row in rows["visits"]:
        path = f"visits.{row.get('id', '?')}"
        reference(row, "site_id", "sites", path, required=True)
        reference(row, "monitoring_plan_id", "monitoring_plans", path)
        date_field(row, "planned_date", path)
        date_field(row, "visited_at", path, timestamp=True)
        string(row, "observer", path)
        string(row, "notes", path)
        string_list(row, "evidence_refs", path, unique=True)
        if row.get("status") not in ("planned", "complete", "cancelled"):
            error(path + ".status", "expected planned, complete or cancelled")
        if row.get("status") == "complete" and not row.get("visited_at"):
            error(path + ".visited_at", "a completed visit requires its actual timestamp")
        monitor_id = row.get("monitoring_plan_id")
        monitor = indexes["monitoring_plans"].get(monitor_id) if isinstance(monitor_id, str) else None
        if monitor and isinstance(monitor.get("site_ids"), list):
            if row.get("site_id") not in monitor["site_ids"]:
                error(path + ".site_id", "site is not in the referenced monitoring plan")

    for row in rows["activities"]:
        path = f"activities.{row.get('id', '?')}"
        reference(row, "visit_id", "visits", path, required=True)
        reference(row, "site_id", "sites", path, required=True)
        if row.get("kind") not in ("sample", "measurement", "inspection", "photo"):
            error(path + ".kind", "expected sample, measurement, inspection or photo")
        string(row, "notes", path)
        for key in ("sample_id", "method", "custody_ref"):
            string(row, key, path, required=False, nonempty=True)
        if "evidence_refs" in row:
            string_list(row, "evidence_refs", path, unique=True)
        date_field(row, "collected_at", path, timestamp=True)
        if row.get("kind") == "sample" and not row.get("sample_id"):
            error(path + ".sample_id", "a sample activity requires the original sample ID")
        visit_id = row.get("visit_id")
        visit = indexes["visits"].get(visit_id) if isinstance(visit_id, str) else None
        if visit and visit.get("site_id") != row.get("site_id"):
            error(path + ".site_id", "must equal the referenced visit's site_id")

    for row in rows["observations"]:
        path = f"observations.{row.get('id', '?')}"
        reference(row, "activity_id", "activities", path, required=True)
        for key in ("parameter", "original_text", "unit", "notes"):
            string(row, key, path, nonempty=(key == "parameter"))
        for key in ("basis", "fraction", "qualifier", "method", "qa_status"):
            string(row, key, path, required=False)
        result_type = row.get("result_type")
        if result_type not in ("numeric", "censored", "text", "missing"):
            error(path + ".result_type", "expected numeric, censored, text or missing")
        if "value" not in row:
            error(path + ".value", "must be explicitly present, using null when absent")
        value = row.get("value")
        if result_type == "numeric":
            if not _number(value):
                error(path + ".value", "numeric results require a finite numeric value")
            if (not isinstance(row.get("original_text"), str) or not row["original_text"].strip()):
                error(path + ".original_text", "preserve the original numeric result text")
        elif result_type in ("censored", "text", "missing") and value is not None:
            error(path + ".value", f"{result_type} results use null, preserving original_text and limits")
        if result_type in ("censored", "text") and (not isinstance(row.get("original_text"), str) or not row["original_text"].strip()):
            error(path + ".original_text", "must preserve the source result text")
        if result_type == "censored" and (not isinstance(row.get("qualifier"), str) or not row["qualifier"].strip()):
            error(path + ".qualifier", "censored results require the original qualifier")
        if result_type in ("numeric", "censored") and (not isinstance(row.get("unit"), str) or not row["unit"].strip()):
            error(path + ".unit", "numeric/censored results require the original unit; use 1 for dimensionless")
        for key in ("detection_limit", "quantitation_limit"):
            numeric(row, key, path, minimum=0)

    # Iterative Kahn traversal handles large plans without Python recursion limits.
    task_ids = set(indexes["tasks"])
    incoming = {}
    children = {task_id: [] for task_id in task_ids}
    for task_id, row in indexes["tasks"].items():
        deps = row.get("depends_on", [])
        deps = deps if isinstance(deps, list) else []
        valid_deps = {dep for dep in deps if isinstance(dep, str) and dep in task_ids}
        incoming[task_id] = len(valid_deps)
        for dep in valid_deps:
            children[dep].append(task_id)
    ready = [task_id for task_id in incoming if incoming[task_id] == 0]
    visited = 0
    while ready:
        task_id = ready.pop()
        visited += 1
        for child in children[task_id]:
            incoming[child] -= 1
            if incoming[child] == 0:
                ready.append(child)
    if visited != len(task_ids):
        error("tasks.depends_on", "dependency cycle involving " +
              ", ".join(sorted(task_id for task_id, count in incoming.items() if count)))

    if issues:
        raise ValidationError(issues)
    result = copy.deepcopy(document)
    if len(canonical_bytes(result)) >= MAX_JSON_BYTES:
        raise ValidationError([f"document: exceeds {MAX_JSON_BYTES} bytes"])
    return result


class ProjectCalendar:
    """ISO workday calendar with holiday-aware ordinal arithmetic."""
    def __init__(self, working_days: Iterable[int], holidays: Iterable[str]):
        self.working_days = frozenset(working_days)
        self.holidays = frozenset(_date(value) for value in holidays)
        self.holiday_ordinals = sorted(
            day.toordinal() for day in self.holidays
            if day.isoweekday() in self.working_days
        )

    def is_workday(self, day: dt.date) -> bool:
        return day.isoweekday() in self.working_days and day not in self.holidays

    def next_workday(self, day: dt.date) -> dt.date:
        while not self.is_workday(day):
            if day == dt.date.max:
                raise OverflowError("calendar extends beyond 9999-12-31")
            day += dt.timedelta(days=1)
        return day

    def _count(self, first: dt.date, last: dt.date) -> int:
        """Count eligible days in an inclusive interval."""
        if last < first:
            return 0
        length = (last - first).days + 1
        weeks, remainder = divmod(length, 7)
        count = weeks * len(self.working_days)
        count += sum(
            ((first.isoweekday() - 1 + offset) % 7 + 1) in self.working_days
            for offset in range(remainder)
        )
        count -= (bisect.bisect_right(self.holiday_ordinals, last.toordinal()) -
                  bisect.bisect_left(self.holiday_ordinals, first.toordinal()))
        return count

    def advance(self, start: dt.date, duration: int) -> tuple[dt.date, dt.date | None]:
        """Return exclusive finish boundary and last consumed working date."""
        start = self.next_workday(start)
        if duration == 0:
            return start, None
        low, high = start.toordinal(), dt.date.max.toordinal()
        if self._count(start, dt.date.max) < duration:
            raise OverflowError("duration extends beyond 9999-12-31")
        while low < high:
            middle = (low + high) // 2
            if self._count(start, dt.date.fromordinal(middle)) >= duration:
                high = middle
            else:
                low = middle + 1
        last = dt.date.fromordinal(low)
        if last == dt.date.max:
            raise OverflowError("exclusive finish extends beyond 9999-12-31")
        finish = self.next_workday(last + dt.timedelta(days=1))
        return finish, last


def schedule_plan(document: dict, as_of: str | None = None) -> dict:
    plan = validate_plan(document)
    as_of = as_of or dt.datetime.now(dt.timezone.utc).date().isoformat()
    try:
        selected_date = _date(as_of)
    except (TypeError, ValueError) as exc:
        raise ImplementationError(f"Invalid as_of date: {exc}") from exc
    calendar = ProjectCalendar(plan["working_days"], plan["holidays"])
    tasks = {row["id"]: row for row in plan["tasks"]}
    children = {task_id: [] for task_id in tasks}
    incoming = {task_id: len(row["depends_on"]) for task_id, row in tasks.items()}
    ready = [task_id for task_id in tasks if incoming[task_id] == 0]
    for task_id, row in tasks.items():
        for dependency in row["depends_on"]:
            children[dependency].append(task_id)
    results: dict[str, dict] = {}
    issues: list[dict] = []
    for task_id in ready:
        task = tasks[task_id]
        row = dict(
            id=task_id, title=task["title"], status=task["status"],
            start=None, finish_exclusive=None, last_work_date=None,
            duration_days=task["duration_days"], schedule_state="scheduled",
            issue_codes=[], overdue=False,
        )

        def issue(code: str, message: str):
            row["issue_codes"].append(code)
            issues.append(dict(task_id=task_id, code=code, message=message))

        blocked = [
            dependency for dependency in task["depends_on"]
            if results[dependency]["finish_exclusive"] is None
        ]
        cancelled = [dependency for dependency in task["depends_on"]
                     if tasks[dependency]["status"] == "cancelled"]
        if cancelled and task["status"] != "cancelled":
            issue("cancelled_dependency", "Predecessor(s) cancelled: " + ", ".join(cancelled) +
                  ". Review whether this dependency still belongs in the plan.")
        if blocked:
            row["schedule_state"] = "blocked_unknown"
            issue("dependency_finish_unknown",
                  "Enter predecessor duration or resolve its calendar range for: " + ", ".join(blocked))
        else:
            earliest = max(
                [_date(plan["start_date"])] +
                ([_date(task["start_not_before"])] if task.get("start_not_before") else []) +
                [_date(results[dependency]["finish_exclusive"])
                 for dependency in task["depends_on"]]
            )
            try:
                start = calendar.next_workday(earliest)
                row["start"] = start.isoformat()
                if task["duration_days"] is None:
                    row["schedule_state"] = "unknown_duration"
                    issue("duration_unknown", "Enter a duration to calculate the finish boundary.")
                else:
                    finish, last = calendar.advance(start, task["duration_days"])
                    row["finish_exclusive"] = finish.isoformat()
                    row["last_work_date"] = last.isoformat() if last else None
                    if task["status"] not in ("complete", "cancelled"):
                        row["overdue"] = (
                            start < selected_date if task["duration_days"] == 0
                            else finish <= selected_date
                        )
                    if plan.get("target_date"):
                        due = last or start
                        if due > _date(plan["target_date"]):
                            issue("after_project_target",
                                  f"Task's last planned work date is after target {plan['target_date']}.")
            except OverflowError as exc:
                row["schedule_state"] = "calendar_overflow"
                issue("calendar_overflow", str(exc))
        if (task["status"] == "complete" and task["progress_pct"] != 100) or (
                task["status"] == "planned" and task["progress_pct"] != 0):
            issue("status_progress_mismatch",
                  "Status and progress differ; both original values have been retained.")
        results[task_id] = row
        for child in children[task_id]:
            incoming[child] -= 1
            if incoming[child] == 0:
                ready.append(child)
    active = [results[task_id] for task_id in tasks if tasks[task_id]["status"] != "cancelled"]
    known_finishes = [row["finish_exclusive"] for row in active if row["finish_exclusive"]]
    return dict(
        as_of=as_of, calendar=dict(
            working_days=list(plan["working_days"]), holidays=list(plan["holidays"])
        ),
        tasks=[results[row["id"]] for row in plan["tasks"]], issues=issues,
        critical_finish_exclusive=(
            max(known_finishes) if known_finishes and all(row["finish_exclusive"] for row in active)
            else None
        ),
        latest_known_finish_exclusive=max(known_finishes) if known_finishes else None,
        unknown_task_count=sum(row["finish_exclusive"] is None for row in active),
    )


def summarize_plan(document: dict, as_of: str | None = None) -> dict:
    plan = validate_plan(document)
    schedule = schedule_plan(plan, as_of)
    by_task = {}
    totals = dict(budget=0, commitment=0, actual=0)
    for line in plan["budget_lines"]:
        totals[line["kind"]] += line["amount_minor"]
        key = line.get("task_id") or ""
        values = by_task.setdefault(key, dict(budget=0, commitment=0, actual=0))
        values[line["kind"]] += line["amount_minor"]
    task_counts = {status: sum(task["status"] == status for task in plan["tasks"])
                   for status in ("planned", "in_progress", "complete", "cancelled")}
    visit_counts = {status: sum(visit["status"] == status for visit in plan["visits"])
                   for status in ("planned", "complete", "cancelled")}
    due_visits = [
        visit["id"] for visit in plan["visits"]
        if visit["status"] == "planned" and visit.get("planned_date")
        and visit["planned_date"] < schedule["as_of"]
    ]
    planned_active = visit_counts["planned"] + visit_counts["complete"]
    return dict(
        schema="upstate.implementation-summary/v1",
        plan_id=plan["id"], revision=plan["revision"], title=plan["title"],
        as_of=schedule["as_of"], currency=plan["currency"],
        budget_minor=totals["budget"], commitment_minor=totals["commitment"],
        actual_minor=totals["actual"], budget_by_task=by_task,
        task_counts=task_counts, overdue_task_ids=[
            row["id"] for row in schedule["tasks"] if row["overdue"]
        ],
        visit_counts=visit_counts, overdue_visit_ids=due_visits,
        visit_completion_pct=(100 * visit_counts["complete"] / planned_active
                              if planned_active else None),
        observation_counts={
            kind: sum(row["result_type"] == kind for row in plan["observations"])
            for kind in ("numeric", "censored", "text", "missing")
        },
        site_count=len(plan["sites"]), activity_count=len(plan["activities"]),
        schedule=schedule,
    )

