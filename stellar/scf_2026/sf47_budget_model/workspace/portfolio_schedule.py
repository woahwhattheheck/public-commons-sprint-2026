"""Programme planning from entered effort, calendars and the saved milestone graph.

All hours describe remaining work. Each business day is a scheduling interval.
Roles may work in parallel within a task; sequential handoffs are separate
milestones. Positive-duration successors start on the next working day after
their predecessor finishes. The deterministic priority schedule is one feasible
allocation; the dependency baseline removes competition between tasks.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
import hashlib
import json
import re

SCHEMA = "stellar-forge.sf47-portfolio-schedule.v1"
RESULT_SCHEMA = "stellar-forge.sf47-portfolio-schedule-result.v1"
ANALYSIS_SCHEMA = "stellar-forge.sf47-portfolio-schedule-analysis.v1"
ZERO = Decimal(0)
METHOD = "Daily priority allocation with finish-to-start dependencies"
METHOD_NOTES = [
    "Hours are entered remaining effort, and costs are entered rates.",
    "Monday is weekday 0. Holidays close a day; extra working dates open a day.",
    "Date-specific capacity replaces that resource's weekly hours on an open day.",
    "Roles can work independently within a task. Model sequential handoffs as separate milestones.",
    "A task with work finishes at the end of a working day. A zero-effort, zero-duration checkpoint can release successors on the same day.",
    "Lower priority numbers run first, then earlier due dates, then the saved task order.",
    "A working milestone's minimum duration starts with its first allocated work. A zero-effort wait starts when it becomes ready.",
    "The dependency baseline gives each task its own access to the entered resource calendars.",
    "The shared-capacity result is a deterministic feasible schedule, without a claim of global optimality.",
    "Comparison frontiers cover only the saved alternatives and the stated dimensions.",
]


class PlanningError(ValueError):
    def __init__(self, message, *, code="plan_invalid", field=""):
        super().__init__(message)
        self.code, self.field = code, field


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def _num(value, field):
    if value is None or isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)) or value == "":
        raise PlanningError("Enter a number for " + field + ".", code="number_missing", field=field)
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise PlanningError(field + " must be a finite number.", field=field) from None
    if not result.is_finite() or result < 0 or result > Decimal("1000000000") or result.as_tuple().exponent < -8:
        raise PlanningError(field + " must be between 0 and 1,000,000,000 with at most eight decimal places.", field=field)
    return result


def _decimal(value):
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _money(value):
    return format(value.quantize(Decimal(".01"), rounding=ROUND_HALF_UP), "f")


def _int(value, field, *, maximum=3660):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= maximum:
        raise PlanningError(field + " must be a whole number between 0 and " + str(maximum) + ".", field=field)
    return value


def _day(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise PlanningError("Enter " + field + " as YYYY-MM-DD.", code="date_missing" if value in (None, "") else "date_invalid", field=field)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise PlanningError(field + " is not a valid calendar date.", field=field) from None


def _topology(tasks):
    index = {task["id"]: task for task in tasks}
    pending = {key: set(task["depends_on"]) for key, task in index.items()}
    for key, parents in pending.items():
        missing = parents - index.keys()
        if missing:
            raise PlanningError("Include the predecessor milestones for " + key + ": " + ", ".join(sorted(missing)) + ".",
                                code="predecessor_missing", field="tasks." + key)
    order = []
    while pending:
        ready = [key for key in pending if not pending[key]]
        if not ready:
            raise PlanningError("The selected milestones contain a dependency cycle: " + ", ".join(pending) + ".",
                                code="dependency_cycle", field="tasks")
        for key in ready:
            order.append(key)
            pending.pop(key)
        for parents in pending.values():
            parents.difference_update(ready)
    return order


def calendar_dates(start_value, horizon_value=730, calendar=None):
    """The original programme calendar, shared with relative delivery deadlines."""
    start = _day(start_value, "start_date")
    horizon = _int(horizon_value, "horizon_days")
    if horizon < 1:
        raise PlanningError("The planning horizon needs at least one day.", field="horizon_days")
    try:
        end = start + timedelta(days=horizon)
    except OverflowError:
        raise PlanningError("The planning horizon exceeds the supported calendar.", field="horizon_days") from None
    calendar = calendar or {}
    weekdays = set(calendar.get("weekdays", [0, 1, 2, 3, 4]))
    holidays = {_day(value, "calendar.holidays") for value in calendar.get("holidays", [])}
    extra = {_day(value, "calendar.extra_working_dates") for value in calendar.get("extra_working_dates", [])}
    if holidays & extra:
        raise PlanningError("A date cannot be both a holiday and an extra working date.", field="calendar")
    days = [start + timedelta(days=offset) for offset in range(horizon)]
    days = [day for day in days if day not in holidays and (day.weekday() in weekdays or day in extra)]
    if not days:
        raise PlanningError("The selected calendar has no working dates in this horizon.", code="calendar_empty", field="calendar")
    return {"start": start, "end": end, "days": days}


def _model(plan):
    if not isinstance(plan, dict) or plan.get("schema") != SCHEMA:
        raise PlanningError("Choose a supported programme planning schema.", field="schema")
    calendar = calendar_dates(plan.get("start_date"), plan.get("horizon_days", 730), plan.get("calendar", {}))
    start, end, days = calendar["start"], calendar["end"], calendar["days"]
    resources, capacity = {}, {}
    for value in plan.get("resources", []):
        key = value["id"]
        if key in resources:
            raise PlanningError("Resource IDs must be unique.", field="resources")
        weekly = value.get("weekly_hours")
        if not isinstance(weekly, list) or len(weekly) != 7:
            raise PlanningError("Enter all seven daily capacity values for " + value.get("name", key) + ".", code="capacity_missing", field="resources." + key)
        weekly = [_num(number, "resources." + key + ".weekly_hours." + str(i)) for i, number in enumerate(weekly)]
        overrides = {_day(day, "capacity date"): _num(number, "date-specific capacity")
                     for day, number in value.get("hours_by_date", {}).items()}
        rate = value.get("hourly_cost")
        resources[key] = {**value, "rate": None if rate in (None, "") else _num(rate, "hourly_cost")}
        capacity[key] = [overrides.get(day, weekly[day.weekday()]) for day in days]
    tasks = []
    for position, value in enumerate(plan.get("tasks", [])):
        key = value["id"]
        effort = {role: _num(hours, "tasks." + key + ".effort_hours." + role)
                  for role, hours in value.get("effort_hours", {}).items()}
        missing = set(effort) - resources.keys()
        if missing:
            raise PlanningError("Add the resource definitions for " + ", ".join(sorted(missing)) + ".",
                                code="resource_missing", field="tasks." + key)
        completed = _day(value["completed_on"], "completed_on") if value.get("completed_on") else None
        if completed and any(effort.values()):
            raise PlanningError("A completed milestone cannot also have remaining effort.", field="tasks." + key)
        tasks.append({**value, "position": position, "effort": effort,
                      "release": _day(value.get("release_date") or start.isoformat(), "release_date"),
                      "due": _day(value["due_date"], "due_date") if value.get("due_date") else None,
                      "completed": completed,
                      "minimum": _int(value.get("minimum_business_days", 0), "minimum_business_days"),
                      "priority": _int(value.get("priority", 100), "priority", maximum=1000000)})
    if not tasks:
        raise PlanningError("Select the milestones to plan.", code="tasks_missing", field="tasks")
    if len({task["id"] for task in tasks}) != len(tasks):
        raise PlanningError("Milestones must appear only once in a plan.", field="tasks")
    if len(days) * len(resources) > 300000 or len(days) * sum(max(1, len(task["effort"])) for task in tasks) > 3000000:
        raise PlanningError("This plan exceeds the daily calculation size; shorten the horizon or divide it into programme workstreams.",
                            code="calculation_size", field="horizon_days")
    return {"plan": plan, "days": days, "end": end, "tasks": tasks,
            "index": {task["id"]: task for task in tasks}, "order": _topology(tasks),
            "resources": resources, "capacity": capacity}


def _independent(task, model, lower):
    days, count = model["days"], len(model["days"])
    ready = max(lower, bisect_left(days, task["release"]))
    if ready >= count:
        return None
    if not any(task["effort"].values()) and task["minimum"] == 0:
        return {"ready": ready, "finish": ready, "instant": True}
    remaining = dict(task["effort"])
    duration_start = ready if not any(remaining.values()) else None
    for i in range(ready, count):
        for role, hours in remaining.items():
            if hours and model["capacity"][role][i] and duration_start is None:
                duration_start = i
            remaining[role] = max(ZERO, hours - model["capacity"][role][i])
        if not any(remaining.values()) and duration_start is not None and i + 1 - duration_start >= task["minimum"]:
            return {"ready": ready, "finish": i + 1, "instant": False}
    return None


def _baseline(model):
    result = {}
    for key in model["order"]:
        task = model["index"][key]
        if task["completed"]:
            result[key] = {"ready": 0, "finish": bisect_right(model["days"], task["completed"]), "instant": False}
        elif any(result[parent] is None for parent in task["depends_on"]):
            result[key] = None
        else:
            lower = max((result[parent]["finish"] for parent in task["depends_on"]), default=0)
            result[key] = _independent(task, model, lower)
    return result


def _latest_start(task, model, bound):
    if not any(task["effort"].values()) and not task["minimum"]:
        return bound
    remaining, elapsed = dict(task["effort"]), 0
    for i in range(min(bound, len(model["days"])) - 1, -1, -1):
        elapsed += 1
        for role, hours in remaining.items():
            remaining[role] = max(ZERO, hours - model["capacity"][role][i])
        useful_start = not any(task["effort"].values()) or any(
            hours and model["capacity"][role][i] for role, hours in task["effort"].items())
        if not any(remaining.values()) and elapsed >= task["minimum"] and useful_start:
            return i
    return None


def _floats(model, baseline):
    if any(value is None for value in baseline.values()):
        return {key: None for key in baseline}
    end = max(value["finish"] for value in baseline.values())
    children = {key: [] for key in baseline}
    for task in model["tasks"]:
        for parent in task["depends_on"]:
            children[parent].append(task["id"])
    latest, result = {}, {}
    for key in reversed(model["order"]):
        task = model["index"][key]
        if task["completed"]:
            latest[key], result[key] = baseline[key]["ready"], None
            continue
        bound = min((latest[child] for child in children[key]), default=end)
        chosen = _latest_start(task, model, bound)
        latest[key] = baseline[key]["ready"] if chosen is None else chosen
        result[key] = max(0, latest[key] - baseline[key]["ready"])
    return result


def _allocate(model):
    days = model["days"]
    available = {role: list(values) for role, values in model["capacity"].items()}
    states = {}
    for task in model["tasks"]:
        states[task["id"]] = {"remaining": dict(task["effort"]), "ready": None, "first_work": None,
                              "finish": bisect_right(days, task["completed"]) if task["completed"] else None,
                              "instant": False, "allocations": []}
    for i, day in enumerate(days):
        for key in model["order"]:
            task, state = model["index"][key], states[key]
            if state["finish"] is not None or task["release"] > day:
                continue
            if any(states[parent]["finish"] is None or states[parent]["finish"] > i for parent in task["depends_on"]):
                continue
            if state["ready"] is None:
                state["ready"] = i
            if not any(state["remaining"].values()) and task["minimum"] == 0:
                state["finish"], state["instant"] = i, True
        eligible = [task for task in model["tasks"]
                    if states[task["id"]]["finish"] is None and states[task["id"]]["ready"] is not None]
        eligible.sort(key=lambda task: (task["priority"], task["due"] or date.max, task["position"], task["id"]))
        for task in eligible:
            state = states[task["id"]]
            for role, hours in state["remaining"].items():
                allocated = min(hours, available[role][i])
                if allocated:
                    state["remaining"][role] -= allocated
                    available[role][i] -= allocated
                    if state["first_work"] is None:
                        state["first_work"] = i
                    state["allocations"].append({"date": day.isoformat(), "resource_id": role, "hours": _decimal(allocated)})
            duration_start = state["first_work"] if any(task["effort"].values()) else state["ready"]
            if not any(state["remaining"].values()) and duration_start is not None and i + 1 - duration_start >= task["minimum"]:
                state["finish"] = i + 1
        if all(value["finish"] is not None for value in states.values()):
            break
    return states, available


def _finish(task, value, days):
    if task["completed"]:
        return task["completed"].isoformat()
    if value is None or value["finish"] is None:
        return None
    index = value["finish"] if value["instant"] else max(0, value["finish"] - 1)
    return days[min(index, len(days) - 1)].isoformat()


def plan_programme(plan):
    """Calculate one complete source-bound plan without changing its input."""
    with localcontext() as context:
        context.prec = 50
        model = _model(plan)
        baseline = _baseline(model)
        floats = _floats(model, baseline)
        states, available = _allocate(model)
        days, rows, cost, unpriced, total_hours = model["days"], [], ZERO, set(), ZERO
        for task in model["tasks"]:
            key, state = task["id"], states[task["id"]]
            known, missing_hours = ZERO, ZERO
            for role, hours in task["effort"].items():
                rate = model["resources"][role]["rate"]
                if hours and rate is None:
                    unpriced.add(role)
                    missing_hours += hours
                elif rate is not None:
                    known += hours * rate
            cost += known
            effort = sum(task["effort"].values(), ZERO)
            total_hours += effort
            finish = _finish(task, state, days)
            row = {"id": key, "milestone_id": task.get("milestone_id", key), "workstream_id": task.get("workstream_id", ""),
                   "title": task.get("title", key), "depends_on": task["depends_on"], "priority": task["priority"],
                   "status": "completed" if task["completed"] else "scheduled" if finish else "unscheduled",
                   "ready_date": days[state["ready"]].isoformat() if state["ready"] is not None else None,
                   "first_work_date": days[state["first_work"]].isoformat() if state["first_work"] is not None else None,
                   "finish_date": finish, "dependency_finish_date": _finish(task, baseline[key], days),
                   "dependency_float_business_days": floats[key], "dependency_critical": floats[key] == 0,
                   "capacity_delay_business_days": max(0, state["finish"] - baseline[key]["finish"])
                       if baseline[key] is not None and state["finish"] is not None and not task["completed"] else None,
                   "due_date": task["due"].isoformat() if task["due"] else None,
                   "late_calendar_days": max(0, (date.fromisoformat(finish) - task["due"]).days) if finish and task["due"] else None,
                   "effort_hours": _decimal(effort),
                   "remaining_hours": {role: _decimal(hours) for role, hours in state["remaining"].items()},
                   "known_labor_cost": _money(known), "unpriced_hours": _decimal(missing_hours),
                   "labor_cost": None if missing_hours else _money(known),
                   "minimum_business_days": task["minimum"],
                   "source_dates": deepcopy(task.get("source_dates", {})),
                   "applied_dates": {"release_date": task["release"].isoformat(), "due_date": task.get("due_date") or None},
                   "allocations": state["allocations"]}
            rows.append(row)
        complete = all(row["finish_date"] is not None for row in rows)
        finish = max((row["finish_date"] for row in rows if row["finish_date"]), default=None) if complete else None
        cut = bisect_right(days, date.fromisoformat(finish)) if finish else len(days)
        daily, resources = [], []
        for role, resource in model["resources"].items():
            requested = sum((task["effort"].get(role, ZERO) for task in model["tasks"]), ZERO)
            capacity = sum(model["capacity"][role][:cut], ZERO)
            allocated = sum((model["capacity"][role][i] - available[role][i] for i in range(cut)), ZERO)
            resources.append({"resource_id": role, "name": resource.get("name", role),
                              "requested_hours": _decimal(requested), "allocated_hours": _decimal(allocated),
                              "available_hours": _decimal(capacity),
                              "utilization_percent": _money(allocated / capacity * 100) if capacity else None,
                              "hourly_cost": None if resource["rate"] is None else _decimal(resource["rate"])})
            for i, day in enumerate(days[:cut]):
                daily.append({"date": day.isoformat(), "resource_id": role, "resource_name": resource.get("name", role),
                              "capacity_hours": _decimal(model["capacity"][role][i]),
                              "allocated_hours": _decimal(model["capacity"][role][i] - available[role][i]),
                              "unused_hours": _decimal(available[role][i])})
        exceptions = [row["id"] for row in rows if row["late_calendar_days"] and not model["index"][row["id"]]["completed"]]
        return {"schema": RESULT_SCHEMA, "id": plan.get("id", ""), "title": plan.get("title", ""),
                "input_sha256": _sha(plan), "programme_ref": deepcopy(plan.get("programme_ref")),
                "input_mode": plan.get("input_mode", "working"), "method": METHOD, "method_notes": METHOD_NOTES,
                "calendar": {"start_date": days[0].isoformat(), "horizon_end_exclusive": model["end"].isoformat(),
                             "working_days": len(days)},
                "summary": {"all_tasks_scheduled": complete, "projected_finish_date": finish,
                            "scheduled_tasks": sum(row["status"] != "unscheduled" for row in rows), "tasks": len(rows),
                            "deadline_exceptions": len(exceptions), "deadline_exception_task_ids": exceptions,
                            "effort_hours": _decimal(total_hours), "currency": plan.get("currency", ""),
                            "known_labor_cost": _money(cost), "labor_cost": None if unpriced else _money(cost),
                            "unpriced_resources": sorted(unpriced)},
                "tasks": rows, "resources": resources, "daily_workload": daily}
