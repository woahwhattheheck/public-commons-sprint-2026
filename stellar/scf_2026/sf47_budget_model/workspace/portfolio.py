"""Resource allocation over an immutable original SF47 operating forecast.

The source forecast owns scope, costs, collections and observed records.
This module owns explicitly entered availability, resource effort, dependencies,
priorities and date alternatives. Chosen dates return through forecast.preview.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from html import escape
import hashlib
import io
import json
import re
import zipfile

from model import canonical, csv_bytes, digest, text, short_id, Problem
import operations_domain as domain
import forecast as forecasts
import portfolio_schedule as allocation

SCHEMA = "stellar-forge.sf47-portfolio.v1"
ENGINE_VERSION = 1
MAX_PORTFOLIOS = 40
MAX_ALTERNATIVES = 23
MAX_RESOURCES = 100
MAX_DAYS = forecasts.MAX_DAYS
ZERO = Decimal(0)
FIELDS = {"calendar", "resources", "tasks"}


def fail(message, code="INVALID_PORTFOLIO", status=422):
    raise Problem(message, status, code)


def obj(raw, allowed, label):
    if not isinstance(raw, dict) or set(raw) - set(allowed):
        fail(label + ": use the declared object fields.")
    return raw


def array(raw, label, maximum):
    if not isinstance(raw, list) or len(raw) > maximum:
        fail(label + ": use an array of at most " + str(maximum) + " rows.")
    return raw


def number(raw, label, *, nullable=False):
    if raw is None or raw == "":
        if nullable:
            return None
        fail(label + ": enter a number.")
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
        fail(label + ": enter a finite number.")
    try:
        value = Decimal(str(raw))
    except InvalidOperation:
        fail(label + ": enter a finite number.")
    if not value.is_finite() or value < 0 or value > Decimal("1000000000") or value.as_tuple().exponent < -8:
        fail(label + ": use 0 to 1,000,000,000 with at most eight decimal places.")
    answer = format(value, "f")
    return answer.rstrip("0").rstrip(".") if "." in answer else answer


def integer(raw, label, maximum=MAX_DAYS):
    if isinstance(raw, bool) or not isinstance(raw, int) or not 0 <= raw <= maximum:
        fail(label + ": enter a whole number from 0 to " + str(maximum) + ".")
    return raw


def iso(raw, label, *, nullable=False):
    if raw in (None, "") and nullable:
        return None
    if not isinstance(raw, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        fail(label + ": use YYYY-MM-DD.")
    try:
        date.fromisoformat(raw)
    except ValueError:
        fail(label + ": use a valid calendar date.")
    return raw


def dates(raw, label):
    values = [iso(x, label) for x in array(raw, label, MAX_DAYS)]
    if len(set(values)) != len(values):
        fail(label + ": do not repeat dates.")
    return sorted(values)


def unique(values, key, label):
    result = {}
    for row in values:
        if row[key] in result:
            fail(label + ": repeated identity " + str(row[key]) + ".")
        result[row[key]] = row
    return result


def source_tasks(saved):
    result = []
    for row in saved["report"]["packages"]:
        result.append({"id": "package/" + row["id"], "sourceKind": "package", "sourceId": row["id"],
            "title": row["id"], "remainingHours": row["remainingHours"],
            "startDate": row["startDate"], "endDate": row["endDate"], "tranche": row["tranche"],
            "remainingCostUsd": row["remainingCostUsd"], "scope": row.get("scope", ""),
            "sourceIds": []})
    for row in saved["report"]["commercial"]:
        if row["selected"]:
            result.append({"id": "commercial/" + row["id"], "sourceKind": "commercial", "sourceId": row["id"],
                "title": row["title"], "remainingHours": row["remainingHours"],
                "startDate": row["startDate"], "endDate": row["endDate"], "tranche": None,
                "remainingCostUsd": row["remainingUninvoicedCostUsd"], "scope": row["scope"],
                "sourceIds": row["sourceIds"], "caseRef": row["caseRef"], "sourceUrl": row["sourceUrl"],
                "stage": row["stage"],
                **({"timing": deepcopy(row["timing"])} if "timing" in row else {})})
    return result


def base_reference(saved):
    return {key: deepcopy(saved[key]) for key in ("id", "sha256", "previewSha256", "source")}


def check_source(context, saved):
    clean = {key: value for key, value in saved.items() if key != "current"}
    forecasts.validate_saved(clean, context["plan"])
    if forecasts.source_identity(context)["factsSha256"] != clean["source"]["factsSha256"]:
        fail("The case facts have changed since this forecast. Save an updated original forecast before allocating its work.",
             "PORTFOLIO_FORECAST_SOURCE_CHANGED", 409)
    return clean


def normalize_calendar(raw, saved):
    raw = obj(raw, {"startDate", "horizonDays", "weekdays", "holidays", "extraWorkingDates"}, "Calendar")
    start = iso(raw.get("startDate"), "Calendar start")
    horizon = integer(raw.get("horizonDays", 730), "Calendar horizon")
    if horizon < 1:
        fail("The calendar needs at least one date.")
    first = date.fromisoformat(saved["inputs"]["asOfDate"]) + timedelta(days=1)
    if date.fromisoformat(start) < first or date.fromisoformat(start) + timedelta(days=horizon) > first + timedelta(days=MAX_DAYS):
        fail("The allocation calendar must fit the original future forecast horizon.")
    weekdays = array(raw.get("weekdays"), "Open weekdays", 7)
    if any(isinstance(x, bool) or not isinstance(x, int) or not 0 <= x <= 6 for x in weekdays) or len(set(weekdays)) != len(weekdays):
        fail("Open weekdays use unique numbers 0 (Monday) through 6 (Sunday).")
    holidays = dates(raw.get("holidays", []), "Calendar holidays")
    extra = dates(raw.get("extraWorkingDates", []), "Extra working dates")
    if set(holidays) & set(extra):
        fail("A date cannot be both a holiday and an extra working date.")
    return {"startDate": start, "horizonDays": horizon, "weekdays": sorted(weekdays),
            "holidays": holidays, "extraWorkingDates": extra}


def normalize_resources(raw):
    result = []
    for item in array(raw, "Resources", MAX_RESOURCES):
        item = obj(item, {"id", "name", "hoursByWeekday", "hoursByDate", "note"}, "Resource")
        ident = short_id(item.get("id"), "Resource ID")
        weekly = array(item.get("hoursByWeekday"), "Seven daily availability values", 7)
        if len(weekly) != 7:
            fail("Enter seven daily availability values; unentered values may be null.")
        overrides = item.get("hoursByDate", {})
        if not isinstance(overrides, dict) or len(overrides) > MAX_DAYS:
            fail("Resource date overrides must map dates to hours.")
        result.append({"id": ident, "name": text(item.get("name", ident), "Resource name", 300, True),
            "hoursByWeekday": [number(x, ident + " weekday " + str(i), nullable=True) for i, x in enumerate(weekly)],
            "hoursByDate": {iso(k, "Capacity override date"): number(v, "Capacity override") for k, v in sorted(overrides.items())},
            "note": text(item.get("note", ""), "Availability basis", 12000)})
    unique(result, "id", "Resources")
    return result


def normalize_tasks(raw, sources, resources):
    resource_ids = {row["id"] for row in resources}
    index = {row["id"]: row for row in sources}
    result = []
    for item in array(raw, "Task assignments", len(sources)):
        item = obj(item, {"id", "effortHours", "dependsOn", "releaseDate", "dueDate", "minBusinessDays", "priority", "note"}, "Task")
        ident = text(item.get("id"), "Task ID", 150, True)
        if ident not in index:
            fail("Choose a task from the selected original forecast: " + ident)
        effort = item.get("effortHours", {})
        if not isinstance(effort, dict) or set(effort) - resource_ids:
            fail(ident + ": effort must reference an entered resource.")
        parents = array(item.get("dependsOn", []), ident + " dependencies", len(sources))
        if any(not isinstance(p, str) or p not in index or p == ident for p in parents) or len(set(parents)) != len(parents):
            fail(ident + ": choose distinct other source tasks as dependencies.")
        result.append({"id": ident, "effortHours": {k: number(v, ident + " effort", nullable=True) for k, v in sorted(effort.items())},
            "dependsOn": list(parents), "releaseDate": iso(item.get("releaseDate"), "Release date", nullable=True),
            "dueDate": iso(item.get("dueDate"), "Due date", nullable=True),
            "minBusinessDays": integer(item.get("minBusinessDays", 0), "Minimum working duration"),
            "priority": integer(item.get("priority", 100), "Priority", 1000000),
            "note": text(item.get("note", ""), "Task allocation basis", 12000)})
    selected = unique(result, "id", "Task assignments")
    if selected.keys() != index.keys():
        fail("Retain every original grant package and selected commercial task in this portfolio.")
    try:
        allocation._topology([{"id": r["id"], "depends_on": r["dependsOn"]} for r in result])
    except allocation.PlanningError as exc:
        fail(str(exc))
    return result


def normalize_fields(raw, saved, sources, base=None):
    merged = deepcopy(base or {})
    merged.update({k: deepcopy(v) for k, v in raw.items() if k in FIELDS})
    calendar = normalize_calendar(merged.get("calendar"), saved)
    resources = normalize_resources(merged.get("resources"))
    tasks = normalize_tasks(merged.get("tasks"), sources, resources)
    return {"calendar": calendar, "resources": resources, "tasks": tasks}


def normalize(context, saved, raw):
    raw = obj(raw, {"schema", "name", "forecastId", "forecastSha256", *FIELDS, "alternatives", "note"}, "Portfolio")
    if raw.get("schema") != SCHEMA:
        fail("Use the supported portfolio schema.")
    if raw.get("forecastId") != saved["id"] or raw.get("forecastSha256") != saved["sha256"]:
        fail("The selected immutable forecast differs from this draft.", "PORTFOLIO_FORECAST_CHANGED", 409)
    sources = source_tasks(saved)
    if not sources:
        fail("This forecast has no retained work packages or selected commercial work.")
    fields = normalize_fields(raw, saved, sources)
    alternatives = []
    for item in array(raw.get("alternatives", []), "Alternatives", MAX_ALTERNATIVES):
        item = obj(item, {"id", "name", "note", *FIELDS}, "Alternative")
        ident = short_id(item.get("id"), "Alternative ID")
        if ident == "base":
            fail("The base alternative ID is reserved for the entered base allocation.")
        authored = normalize_fields(item, saved, sources, fields)
        alternatives.append({"id": ident, "name": text(item.get("name"), "Alternative name", 300, True),
            "note": text(item.get("note", ""), "Alternative basis", 12000, True),
            **{key: authored[key] for key in FIELDS if key in item}})
    unique(alternatives, "id", "Alternatives")
    all_fields = [fields] + [{key: row.get(key, fields[key]) for key in FIELDS} for row in alternatives]
    if sum(row["calendar"]["horizonDays"] * len(row["resources"]) for row in all_fields) > 300000:
        fail("The complete comparison exceeds 300,000 resource dates. Shorten its horizon or reduce the alternatives.")
    if sum(row["calendar"]["horizonDays"] * sum(max(1, len(task["effortHours"])) for task in row["tasks"]) for row in all_fields) > 3000000:
        fail("The complete comparison exceeds 3,000,000 task-resource dates. Shorten its horizon or reduce the alternatives.")
    return {"schema": SCHEMA, "name": text(raw.get("name"), "Portfolio name", 300, True),
            "forecastId": saved["id"], "forecastSha256": saved["sha256"], **fields,
            "alternatives": alternatives, "note": text(raw.get("note", ""), "Portfolio basis", 12000)}


def seed(context, saved):
    saved = check_source(context, saved)
    sources = source_tasks(saved)
    people = saved["snapshot"]["plan"]["planning"]["contributors"]
    resources = [{"id": r["id"], "name": r["name"], "hoursByWeekday": [None] * 7, "hoursByDate": {},
                  "note": r.get("note", "")} for r in people]
    assignments = saved["snapshot"]["plan"]["planning"]["assignments"]
    assigned = {}
    for row in assignments:
        assigned.setdefault(row["costId"], {})[row["contributorId"]] = row["hours"]
    tasks = []
    for source in sources:
        effort = deepcopy(assigned.get(source["sourceId"], {})) if source["sourceKind"] == "package" else {}
        exact = all(role in {r["id"] for r in resources} for role in effort) and sum((Decimal(v) for v in effort.values()), ZERO) == Decimal(source["remainingHours"])
        tasks.append({"id": source["id"], "effortHours": effort if exact else {}, "dependsOn": [],
            "releaseDate": source["timing"]["reviewedReleaseDate"] if "timing" in source else source["startDate"],
            "dueDate": None if "timing" in source else source["endDate"],
            "minBusinessDays": 0, "priority": 100,
            "note": ("Original start condition: " + source["timing"]["startCondition"]) if "timing" in source
                else ("Exact original pinned contributor assignments retained; their sum matches remaining hours." if exact and effort else "")})
    inputs = {"schema": SCHEMA, "name": "Delivery allocation — " + saved["inputs"]["name"],
        "forecastId": saved["id"], "forecastSha256": saved["sha256"],
        "calendar": {"startDate": saved["report"]["firstForecastDate"], "horizonDays": min(730, MAX_DAYS),
                     "weekdays": [0, 1, 2, 3, 4, 5, 6], "holidays": [], "extraWorkingDates": []},
        "resources": resources, "tasks": tasks, "alternatives": [], "note": ""}
    return {"inputs": inputs, "baseForecast": base_reference(saved), "sourceTasks": sources,
        "originalCapacity": deepcopy(saved["report"]["capacity"]),
        "originalAssignments": deepcopy(assignments)}


def finding(code, field, message):
    return {"code": code, "field": field, "message": message}


def cash_summary(report):
    current = report["scenarios"]["commercial"]
    return {key: current[key] for key in ("additionalCashNeededUsd", "gapAfterOpeningCashUsd", "peakNeedDate", "endDeltaUsd")} | {
        "remainingCashOutflowUsd": report["totals"]["remainingCashOutflowWithCommercialUsd"],
        "cashScenarios": deepcopy(report["scenarios"]),
        **({"eventTiming": deepcopy(report["eventTiming"])} if "eventTiming" in report else {})}


def date_delta(new, old):
    return None if new is None or old is None else (date.fromisoformat(new) - date.fromisoformat(old)).days


def date_inputs(saved, chosen, name, event_deadlines=()):
    inputs = deepcopy(saved["inputs"])
    inputs["name"] = text(saved["inputs"]["name"] + " / " + name, "Selected forecast name", 300, True)
    overrides = {row["costId"]: row for row in inputs["packageOverrides"]}
    quotes = {row["id"]: row for row in inputs["commercial"]}
    reviewed_releases = {row["taskId"]: row["releaseDate"] for row in event_deadlines}
    for row in chosen:
        if row["sourceKind"] == "package":
            target = overrides.get(row["sourceId"])
            if target is None:
                target = {"costId": row["sourceId"]}
                inputs["packageOverrides"].append(target)
            target["startDate"], target["endDate"] = row["startDate"], row["endDate"]
        else:
            target = quotes[row["sourceId"]]
            target["startDate"], target["endDate"] = row["startDate"], row["endDate"]
            if "timing" in target:
                target["timing"]["reviewedReleaseDate"] = reviewed_releases[row["taskId"]]
        addition = "Portfolio " + name + ": entered availability, effort, dependencies and priority determine this remaining-work window."
        target["note"] = text((target.get("note", "") + "\n" + addition).strip(), "Selected date basis", 12000, True)
    return inputs


def calculate(context, saved, sources, fields, ident, name, note):
    index = {row["id"]: row for row in sources}
    findings = []
    for resource in fields["resources"]:
        if any(x is None for x in resource["hoursByWeekday"]):
            findings.append(finding("CAPACITY_REQUIRED", "resources." + resource["id"],
                "Enter all seven daily availability values for " + resource["name"] + "."))
    for task in fields["tasks"]:
        source = index[task["id"]]
        if "timing" in source:
            retained_release = source["timing"]["reviewedReleaseDate"]
            if retained_release is None and task["releaseDate"] is None:
                findings.append(finding("EVENT_RELEASE_DATE_REQUIRED", "tasks." + task["id"] + ".releaseDate",
                    "Retain the original start condition and choose its reviewed release date before allocating this work: " + source["timing"]["startCondition"]))
            elif retained_release and task["releaseDate"] and task["releaseDate"] < retained_release:
                findings.append(finding("ORIGINAL_EVENT_RELEASE", "tasks." + task["id"] + ".releaseDate",
                    "Work cannot be released before the retained original reviewed trigger on " + retained_release + "."))
        values = task["effortHours"]
        if any(value is None for value in values.values()):
            findings.append(finding("EFFORT_REQUIRED", "tasks." + task["id"], "Enter every selected resource's remaining effort."))
        else:
            total = sum((Decimal(v) for v in values.values()), ZERO)
            expected = Decimal(index[task["id"]]["remainingHours"])
            if total != expected:
                findings.append(finding("EFFORT_TOTAL_REQUIRED", "tasks." + task["id"],
                    "Assign exactly " + forecasts.hours(expected) + " original remaining hours; currently assigned " + forecasts.hours(total) + "."))
    common = {"id": ident, "name": name, "note": note, "findings": findings, "summary": None,
              "schedule": None, "chosenDates": [], "forecast": None}
    if findings:
        return {**common, "status": "INCOMPLETE"}
    calendar = fields["calendar"]
    pure = {"schema": allocation.SCHEMA, "id": ident, "title": name, "input_mode": context["program"]["mode"],
        "start_date": calendar["startDate"], "horizon_days": calendar["horizonDays"], "currency": "USD",
        "calendar": {"weekdays": calendar["weekdays"], "holidays": calendar["holidays"], "extra_working_dates": calendar["extraWorkingDates"]},
        "programme_ref": {"programId": context["program"]["id"], "forecastId": saved["id"], "forecastSha256": saved["sha256"]},
        "resources": [{"id": r["id"], "name": r["name"], "weekly_hours": r["hoursByWeekday"],
                       "hours_by_date": r["hoursByDate"], "hourly_cost": None} for r in fields["resources"]],
        "tasks": [{"id": r["id"], "title": index[r["id"]]["title"], "depends_on": r["dependsOn"],
                   "effort_hours": r["effortHours"], "release_date": r["releaseDate"] or calendar["startDate"],
                   "due_date": r["dueDate"], "minimum_business_days": r["minBusinessDays"], "priority": r["priority"],
                   "source_dates": {"startDate": index[r["id"]]["startDate"], "endDate": index[r["id"]]["endDate"]}} for r in fields["tasks"]]}
    try:
        timed = [task for task in pure["tasks"] if "timing" in index[task["id"]]]
        if timed:
            # Use the same native calendar for the contract's working-day clock.
            # Include an observed release before the forecast horizon without moving any work date.
            entered = {row["id"]: row["releaseDate"] for row in fields["tasks"]}
            releases = {task["id"]: index[task["id"]]["timing"]["reviewedReleaseDate"] or entered[task["id"]] for task in timed}
            for task in timed:
                task["release_date"] = entered[task["id"]] or releases[task["id"]]
            first = min([date.fromisoformat(calendar["startDate"])] + [date.fromisoformat(releases[task["id"]]) for task in timed])
            last = date.fromisoformat(calendar["startDate"]) + timedelta(days=calendar["horizonDays"])
            working = allocation.calendar_dates(first.isoformat(), (last - first).days, pure["calendar"])["days"]
            deadlines = []
            for task in timed:
                terms = index[task["id"]]["timing"]
                available = [stamp for stamp in working if stamp >= date.fromisoformat(releases[task["id"]])]
                duration = terms["deliveryBusinessDays"]
                if len(available) < duration:
                    return {**common, "status": "HORIZON_EXCEEDED",
                        "findings": [finding("EVENT_DEADLINE_OUTSIDE_HORIZON", "tasks." + task["id"],
                            "Extend the calendar to retain all " + str(duration) + " original delivery working days after the release date.")]}
                deadline = available[duration - 1].isoformat()
                if task["due_date"] is not None and task["due_date"] > deadline:
                    return {**common, "status": "INCOMPLETE",
                        "findings": [finding("ORIGINAL_EVENT_DEADLINE", "tasks." + task["id"] + ".dueDate",
                            "The original " + str(duration) + "-working-day term ends on " + deadline + ". Retain that deadline or an earlier one.")]}
                task["due_date"] = task["due_date"] or deadline
                deadlines.append({"taskId": task["id"], "releaseDate": releases[task["id"]], "workReleaseDate": task["release_date"],
                    "deliveryBusinessDays": duration, "contractDueDate": deadline, "selectedDueDate": task["due_date"],
                    "startCondition": terms["startCondition"]})
            common["eventDeadlines"] = deadlines
        schedule = allocation.plan_programme(pure)
    except allocation.PlanningError as exc:
        return {**common, "status": "INCOMPLETE", "findings": [finding(exc.code, exc.field, str(exc))]}
    # Staffing rates do not replace the original forecast's complete quoted costs.
    schedule["method_notes"] = [line for line in schedule["method_notes"] if "cost" not in line.lower() and "frontier" not in line.lower()]
    schedule["method_notes"].append("The original operating forecast calculates all cash and quoted costs; resource hours allocate remaining work.")
    for row in schedule["tasks"]:
        for key in ("known_labor_cost", "unpriced_hours", "labor_cost"):
            row.pop(key, None)
    for row in schedule["resources"]:
        row.pop("hourly_cost", None)
    for key in ("known_labor_cost", "labor_cost", "unpriced_resources", "currency"):
        schedule["summary"].pop(key, None)
    brief = {"finishDate": schedule["summary"]["projected_finish_date"],
        "scheduledTasks": schedule["summary"]["scheduled_tasks"], "tasks": schedule["summary"]["tasks"],
        "totalHours": schedule["summary"]["effort_hours"], "lateTasks": schedule["summary"]["deadline_exceptions"],
        "maxLatenessDays": max((r["late_calendar_days"] or 0 for r in schedule["tasks"]), default=0)}
    if not schedule["summary"]["all_tasks_scheduled"]:
        unresolved = [r["id"] for r in schedule["tasks"] if r["finish_date"] is None]
        return {**common, "status": "HORIZON_EXCEEDED", "schedule": schedule, "summary": brief,
                "findings": [finding("UNSCHEDULED_WORK", ",".join(unresolved), "Increase entered capacity or extend the calendar to allocate all remaining work.")]}
    chosen = []
    for row in schedule["tasks"]:
        source = index[row["id"]]
        start = row["first_work_date"] or row["ready_date"]
        end = row["finish_date"]
        chosen.append({"taskId": row["id"], "sourceKind": source["sourceKind"], "sourceId": source["sourceId"],
            "oldStartDate": source["startDate"], "oldEndDate": source["endDate"], "startDate": start, "endDate": end,
            "startShiftDays": date_delta(start, source["startDate"]), "endShiftDays": date_delta(end, source["endDate"])})
    chosen_index = {r["taskId"]: r for r in chosen}
    for quote in saved["report"]["commercial"]:
        if not quote["selected"]:
            continue
        window = chosen_index["commercial/" + quote["id"]]
        for receipt in quote["receipts"]:
            stamp = receipt["date"]
            if not stamp or Decimal(receipt["remainingUsd"]) == 0:
                continue
            if stamp < window["startDate"]:
                findings.append(finding("COLLECTION_BEFORE_ALLOCATED_START", "commercial." + quote["id"] + ".receipts." + receipt["id"],
                    receipt["label"] + " remains on " + stamp + ", before allocated work starts on " + window["startDate"] + ". Review collection timing in the original forecast."))
            elif window["oldEndDate"] is not None and stamp >= window["oldEndDate"] and stamp < window["endDate"]:
                findings.append(finding("COLLECTION_BEFORE_REPLANNED_FINISH", "commercial." + quote["id"] + ".receipts." + receipt["id"],
                    receipt["label"] + " remains on " + stamp + "; the work now finishes on " + window["endDate"] + ". Review its collection basis in the original forecast."))
    for grant in saved["report"]["grants"]:
        ends = [chosen_index[r["id"]]["endDate"] for r in sources if r["sourceKind"] == "package" and r["tranche"] == grant["tranche"]]
        if grant["included"] and grant["forecastDate"] and Decimal(grant["remainingUsd"]) and ends and grant["forecastDate"] < max(ends):
            findings.append(finding("GRANT_COLLECTION_BEFORE_REPLANNED_FINISH", "grants." + str(grant["tranche"]),
                "The conditional grant receipt remains on " + grant["forecastDate"] + "; this tranche's allocated work finishes on " + max(ends) + ". Review the original payout timing assumption."))
    selected = forecasts.preview(context, date_inputs(saved, chosen, name, common.get("eventDeadlines", ())))
    if selected["report"]["totals"] != saved["report"]["totals"]:
        fail("The date allocation changed original forecast totals.", "PORTFOLIO_CASH_SOURCE_CONFLICT", 409)
    return {**common, "status": "READY", "schedule": schedule, "chosenDates": chosen,
            "summary": {**brief, **cash_summary(selected["report"]), "collectionTimingReviews": len(findings)},
            "forecast": {"inputs": selected["inputs"], "previewSha256": selected["previewSha256"], "report": selected["report"]}}


def build(context, saved, inputs):
    sources = source_tasks(saved)
    base = {key: inputs[key] for key in FIELDS}
    alternatives = [calculate(context, saved, sources, base, "base", "Base allocation", inputs["note"])]
    for row in inputs["alternatives"]:
        fields = {key: row.get(key, base[key]) for key in FIELDS}
        alternatives.append(calculate(context, saved, sources, fields, row["id"], row["name"], row["note"]))
    original_end = max((row["endDate"] for row in sources if row["endDate"] is not None), default=saved["inputs"]["asOfDate"])
    baseline = {"name": saved["inputs"]["name"], "finishDate": original_end,
        "totalHours": forecasts.hours(sum((Decimal(r["remainingHours"]) for r in sources), ZERO)),
        "overloadedDays": saved["report"]["capacity"]["overloadedDays"],
        "peakWeeklyEquivalentHours": saved["report"]["capacity"]["peakWeeklyEquivalentHours"],
        **cash_summary(saved["report"])}
    comparison = []
    ready = [row for row in alternatives if row["status"] == "READY"]
    for row in alternatives:
        summary = row["summary"]
        value = {"id": row["id"], "name": row["name"], "status": row["status"], "frontier": False,
                 **(deepcopy(summary) if summary else {})}
        if row["status"] == "READY":
            value["finishShiftDays"] = date_delta(summary["finishDate"], original_end)
            value["fundingNeedDeltaUsd"] = forecasts.money(Decimal(summary["additionalCashNeededUsd"]) - Decimal(baseline["additionalCashNeededUsd"]))
            vector = lambda x: (x["summary"]["finishDate"], x["summary"]["lateTasks"], Decimal(x["summary"]["additionalCashNeededUsd"]))
            own = vector(row)
            value["frontier"] = not any(other["id"] != row["id"] and all(a <= b for a, b in zip(vector(other), own))
                and any(a < b for a, b in zip(vector(other), own)) for other in ready)
        comparison.append(value)
    return {"sourceTasks": sources, "baseline": baseline, "alternatives": alternatives, "comparison": comparison,
        "comparisonBasis": "Entered alternatives compared by finish date, late-task count and original cash funding need.",
        "paymentTimingBasis": "Quoted receipts, grant receipts, invoice dates, amounts and original installment schedules retain their entered dates. Original completion and accrual expense rules use the selected work window."}


def preview(context, saved, raw):
    saved = check_source(context, saved)
    inputs = normalize(context, saved, raw)
    value = {"schema": SCHEMA, "engineVersion": ENGINE_VERSION, "source": forecasts.source_identity(context),
             "baseForecast": base_reference(saved), "inputs": inputs, "report": build(context, saved, inputs)}
    value["previewSha256"] = digest(value)
    return value


def validate_saved(value, pinned_plan=None):
    try:
        if not isinstance(value, dict) or value.get("schema") != SCHEMA or value.get("engineVersion") != ENGINE_VERSION:
            fail("Unsupported saved portfolio.")
        if digest({key: item for key, item in value.items() if key != "sha256"}) != value.get("sha256"):
            fail("The saved portfolio differs from its retained identity.", "PORTFOLIO_CHANGED", 409)
        short_id(value.get("id"), "Portfolio ID")
        domain.timestamp(value.get("createdAt"), "Portfolio creation")
        text(value.get("actor"), "Portfolio operator", 300, True)
        text(value.get("note"), "Portfolio save note", 12000)
        context, saved = value["snapshot"], value["baseForecastSnapshot"]
        if pinned_plan and (context["plan"]["contentSha256"] != pinned_plan["contentSha256"]
                            or context["plan"]["source"]["sha256"] != pinned_plan["source"]["sha256"]):
            fail("The portfolio belongs to another pinned plan.", "PORTFOLIO_SOURCE_CONFLICT", 409)
        rebuilt = preview(context, saved, value["inputs"])
        if any(rebuilt[key] != value.get(key) for key in ("source", "baseForecast", "inputs", "report", "previewSha256")):
            fail("The saved portfolio differs from its complete source calculation.", "PORTFOLIO_CHANGED", 409)
        return value
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as exc:
        if isinstance(exc, Problem):
            raise
        fail("The complete saved portfolio is invalid: " + str(exc))


def summary(value):
    return {key: deepcopy(value[key]) for key in ("id", "createdAt", "actor", "source", "sha256", "previewSha256", "baseForecast")} | {
        "name": value["inputs"]["name"], "alternatives": len(value["report"]["alternatives"]),
        "readyAlternatives": sum(row["status"] == "READY" for row in value["report"]["alternatives"]),
        "comparison": deepcopy(value["report"]["comparison"])}


def select(context, value, alternative_id):
    validate_saved(value, context["plan"])
    if forecasts.source_identity(context)["factsSha256"] != value["source"]["factsSha256"]:
        fail("The case facts changed. Refresh the source forecast and allocation before selecting its dates.",
             "PORTFOLIO_SOURCE_CHANGED", 409)
    row = next((r for r in value["report"]["alternatives"] if r["id"] == alternative_id), None)
    if row is None:
        fail("The selected saved alternative is unavailable.", "PORTFOLIO_ALTERNATIVE_NOT_FOUND", 404)
    if row["status"] != "READY":
        fail("Complete this alternative's availability, effort and event release dates before selecting its dates.")
    candidate = forecasts.preview(context, row["forecast"]["inputs"])
    return {"inputs": candidate["inputs"], "selection": {"portfolioId": value["id"], "portfolioSha256": value["sha256"],
        "alternativeId": row["id"], "baseForecast": value["baseForecast"], "source": forecasts.source_identity(context),
        "previewSha256": candidate["previewSha256"], "chosenDates": deepcopy(row["chosenDates"])}}


def report_html(value):
    report = value["report"]
    def table(columns, rows):
        head = "".join("<th>" + escape(label) + "</th>" for key, label in columns)
        body = "".join("<tr>" + "".join("<td>" + escape("" if row.get(key) is None else str(row[key])) + "</td>" for key, label in columns) + "</tr>" for row in rows)
        return "<div class='scroll'><table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table></div>"
    parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>" + escape(value["inputs"]["name"]) + "</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fafafa;max-width:1200px;margin:32px auto;padding:0 24px}h1,h2{line-height:1.2}h2{margin-top:36px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#e9e9e9}.scroll{overflow:auto}code{overflow-wrap:anywhere}p{max-width:95ch}a{color:#222}</style><body>",
        "<h1>" + escape(value["inputs"]["name"]) + "</h1><p>Original forecast: <code>" + escape(value["baseForecast"]["id"]) + "</code>. Saved allocation: <code>" + escape(value["id"]) + "</code>.</p>",
        "<p>" + escape(report["paymentTimingBasis"]) + "</p><p>" + escape(value["inputs"]["note"]) + "</p>",
        "<h2>Delivery and cash comparison</h2>",
        table([("name","Alternative"),("status","State"),("finishDate","Finish"),("totalHours","Hours"),("lateTasks","Late tasks"),
               ("additionalCashNeededUsd","Funding need USD"),("fundingNeedDeltaUsd","Change USD"),("frontier","Comparison frontier")], report["comparison"]),
        "<p>Original dated forecast finishes " + escape(report["baseline"]["finishDate"]) + ", with " + str(report["baseline"]["overloadedDays"]) + " calendar dates above its original weekly-equivalent capacity. " + escape(report["comparisonBasis"]) + "</p>"]
    for row in report["alternatives"]:
        parts.extend(["<h2>" + escape(row["name"]) + "</h2><p>" + escape(row["note"]) + "</p>"])
        if row["findings"]:
            parts.append(table([("field","Input"),("message","Required detail")], row["findings"]))
        if row["schedule"]:
            parts.append(table([("title","Task"),("ready_date","Ready"),("first_work_date","First work"),("finish_date","Finish"),
                ("due_date","Due"),("late_calendar_days","Late days"),("effort_hours","Hours"),
                ("capacity_delay_business_days","Capacity delay")], row["schedule"]["tasks"]))
            parts.append("<p><a href='alternatives/" + escape(row["id"], quote=True) + "/resource-days.csv'>Resource calendar CSV</a> · <a href='alternatives/" + escape(row["id"], quote=True) + "/allocations.csv'>Task allocations CSV</a></p>")
    if any("timing" in row for row in report["sourceTasks"]):
        timing_rows = [{"title": row["title"], "startCondition": row["timing"]["startCondition"],
            "deliveryBusinessDays": row["timing"]["deliveryBusinessDays"],
            "reviewedReleaseDate": row["timing"]["reviewedReleaseDate"],
            "collectionConditions": "; ".join(item["receiptId"] + ": " + item["condition"] for item in row["timing"]["receiptConditions"])}
            for row in report["sourceTasks"] if "timing" in row]
        parts.append("<h2>Original event-dependent terms</h2>" + table([("title","Work"),("startCondition","Start condition"),
            ("reviewedReleaseDate","Original reviewed trigger"),("deliveryBusinessDays","Quoted delivery working days"),("collectionConditions","Original collections")], timing_rows))
        parts.append("<p>Undated work stays in the complete source scope. The original forecast lists its undated cash and hours separately until a reviewed release and work window are selected.</p>")
    parts.append("<h2>Original remaining scope</h2>" + table([("title","Work"),("sourceKind","Source"),("remainingHours","Hours"),("remainingCostUsd","Remaining cash USD"),("scope","Scope")], report["sourceTasks"]))
    parts.append("<p>Complete inputs, original forecast snapshot, dated cash calculations and source identities are in portfolio.json. Receive the complete original operations ZIP to reopen this allocation in the workspace.</p></body></html>")
    return "\n".join(parts).encode()


def export(value):
    validate_saved(value)
    files = {"portfolio.json": (canonical(value) + "\n").encode(), "report.html": report_html(value),
        "comparison.csv": csv_bytes(["id","name","status","finishDate","totalHours","lateTasks","maxLatenessDays",
            "additionalCashNeededUsd","gapAfterOpeningCashUsd","peakNeedDate","endDeltaUsd","finishShiftDays",
            "fundingNeedDeltaUsd","frontier"], value["report"]["comparison"]),
        "source-tasks.csv": csv_bytes(["id","sourceKind","sourceId","title","remainingHours","startDate","endDate",
            "remainingCostUsd","caseRef","sourceUrl","scope"], value["report"]["sourceTasks"]),
        "base-forecast.json": (canonical(value["baseForecastSnapshot"]) + "\n").encode(),
        "README.txt": ("SF47 delivery portfolio\n\nOpen report.html for delivery and cash comparisons. portfolio.json retains the complete source calculation and entered alternatives. "
            "Use the original operations case ZIP for full workspace receiving, original attachments, source forecasts and saved portfolios. "
            "The selected alternative returns a new draft to the original Forecast screen; review and save through its existing command.\n\n"
            + value["report"]["paymentTimingBasis"] + "\n").encode()}
    timed_sources = [row for row in value["report"]["sourceTasks"] if "timing" in row]
    if timed_sources:
        files["event-dependent-work.json"] = (canonical(timed_sources) + "\n").encode()
    for row in value["report"]["alternatives"]:
        prefix = "alternatives/" + row["id"] + "/"
        files[prefix + "findings.csv"] = csv_bytes(["code","field","message"], row["findings"])
        if row["schedule"]:
            schedule = row["schedule"]
            files[prefix + "schedule.json"] = (canonical(schedule) + "\n").encode()
            files[prefix + "tasks.csv"] = csv_bytes(["id","title","status","ready_date","first_work_date","finish_date",
                "due_date","late_calendar_days","effort_hours","dependency_finish_date","dependency_float_business_days",
                "capacity_delay_business_days","minimum_business_days"], schedule["tasks"])
            files[prefix + "resources.csv"] = csv_bytes(["resource_id","name","requested_hours","allocated_hours","available_hours","utilization_percent"], schedule["resources"])
            files[prefix + "resource-days.csv"] = csv_bytes(["date","resource_id","resource_name","capacity_hours","allocated_hours","unused_hours"], schedule["daily_workload"])
            files[prefix + "allocations.csv"] = csv_bytes(["taskId","date","resource_id","hours"],
                [{"taskId": task["id"], **item} for task in schedule["tasks"] for item in task["allocations"]])
        if row["forecast"]:
            files[prefix + "selected-forecast-inputs.json"] = (canonical(row["forecast"]["inputs"]) + "\n").encode()
            files[prefix + "changed-dates.csv"] = csv_bytes(["taskId","sourceKind","sourceId","oldStartDate","oldEndDate","startDate","endDate","startShiftDays","endShiftDays"], row["chosenDates"])
            report = row["forecast"]["report"]
            files[prefix + "dated-cash.csv"] = csv_bytes(["date","invoiceOutflowUsd","packageOutflowUsd","commercialOutflowUsd",
                "conditionalGrantInflowUsd","forecastCustomerInflowUsd","commercialDeltaUsd","commercialBalanceUsd",
                "remainingWorkHours","weeklyEquivalentHours"], report["days"])
            files[prefix + "cash-events.csv"] = csv_bytes(["date","kind","id","title","amountUsd","conditional","commercialId"], report["events"])
    manifest = {"schema": SCHEMA + ".bundle", "portfolioId": value["id"], "portfolioSha256": value["sha256"],
        "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr, info.compress_type = 0o600 << 16, zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return output.getvalue()
