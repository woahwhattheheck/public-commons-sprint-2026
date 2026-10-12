"""Complete Workshare commissioning intake for the original SF47 engines.

Workshare owns proposed terms, phases and dependencies. The original daily
allocator schedules that work; the original forecast calculates dated cash.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
from html import escape
import json
from pathlib import Path
import sys
import zipfile

SCHEMA = "stellar-forge.sf47-workshare-intake.v1"
ZERO = Decimal(0)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest(value):
    return sha(canonical(value).encode())


def fail(message):
    raise ValueError(message)


def decimal(value, label):
    if isinstance(value, bool):
        fail(label + " must be an explicit nonnegative decimal.")
    try:
        result = Decimal(str(value))
    except Exception as exc:
        raise ValueError(label + " must be an explicit nonnegative decimal.") from exc
    if not result.is_finite() or result < 0:
        fail(label + " must be an explicit nonnegative decimal.")
    return result


def money(value):
    return str(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def unique(rows, key, label):
    result = {}
    for row in rows:
        ident = row[key]
        if not isinstance(ident, str) or not ident or ident in result:
            fail(label + " requires distinct nonempty identities.")
        result[ident] = row
    return result


def business_end(start, days, calendar):
    if isinstance(days, bool) or not isinstance(days, int) or days < 1:
        fail("A quoted or phase duration needs at least one business day.")
    current = date.fromisoformat(start)
    weekdays = set(calendar["weekdays"])
    holidays = set(calendar.get("holidays", []))
    extra = set(calendar.get("extraWorkingDates", []))
    if not weekdays and not extra:
        fail("The assumption calendar has no working days.")
    for _ in range(1096):
        stamp = current.isoformat()
        if stamp not in holidays and (current.weekday() in weekdays or stamp in extra):
            days -= 1
            if days == 0:
                return stamp
        current += timedelta(days=1)
    fail("The entered duration exceeds the original forecast horizon.")


def load_workshares(commissioning, receiving_packet=None):
    """Read every original phase and reconcile the matching complete case packet."""
    supported = ("sec-workshare.commissioning-inputs.v1", "dealscout.workshare-commissioning-inputs.v1")
    if commissioning.get("version") not in supported:
        fail("Use the complete operated Workshare commissioning-inputs.v1 contract.")
    cases = unique(commissioning["cases"], "case_id", "Commissioning cases")
    if not cases:
        fail("Select complete commissioning cases.")
    packets = {}
    if receiving_packet is not None:
        packets = {row["prepared_case"]["id"]: row for row in receiving_packet["packets"]}
        if len(packets) != len(receiving_packet["packets"]) or set(cases) - packets.keys():
            fail("The complete receiving packet must contain each commissioning case once.")
    result = []
    for case_id, row in cases.items():
        source, plan = row["workshare_input"]["source"], row["workshare_input"]["plan"]
        if source["case_id"] != case_id or plan.get("version") != "dealscout.workshare-plan.v1":
            fail("The original case and Workshare plan identities differ.")
        if digest(plan) != row["plan_sha256"]:
            fail("The original operated Workshare plan content changed: " + case_id)
        if packets and packets[case_id]["workshare_input"] != row["workshare_input"]:
            fail("The receiving and commissioning Workshare inputs differ: " + case_id)
        commercial = plan["commercial"]
        if commercial["currency"] != "USD" or commercial["price_status"] != "PROPOSED":
            fail("This intake supports the retained USD proposed-work contract.")
        amount = decimal(commercial["amount"], "Original proposed fee")
        milestones = commercial["milestones"]
        if not milestones or sum((decimal(m["amount"], "Milestone amount") for m in milestones), ZERO) != amount:
            fail("Original payment milestones must sum to the original fee.")
        phases = unique(plan["phases"], "id", "Workshare phases")
        effort = unique(row["production_effort"], "phase_id", "Phase effort")
        if not phases or phases.keys() != effort.keys():
            fail("Every original phase needs exactly one original effort estimate.")
        for phase in phases.values():
            parents = phase["depends_on"]
            if len(set(parents)) != len(parents) or set(parents) - phases.keys() or phase["id"] in parents:
                fail("A phase dependency must name a distinct original predecessor.")
        result.append({
            "caseId": case_id, "planSha256": row["plan_sha256"],
            "source": deepcopy(source), "plan": deepcopy(plan),
            "effort": {ident: str(decimal(value["hours"], "Original phase effort")) for ident, value in effort.items()},
            "hours": str(sum((decimal(value["hours"], "Original phase effort") for value in effort.values()), ZERO)),
            "phaseCount": len(phases), "packetPresent": bool(packets)})
    return result


def commercial_inputs(base, workshares, choices, rate, source_ids):
    """Create an original forecast input with explicit incremental cost/date choices."""
    inputs = deepcopy(base)
    existing = {row["id"] for row in inputs["commercial"]}
    choices_by_id = unique(choices["cases"], "caseId", "Case assumptions")
    if choices_by_id.keys() != {row["caseId"] for row in workshares}:
        fail("Enter one assumption row for every complete incoming case.")
    rate = decimal(rate, "Assumed incremental delivery cost per hour")
    for item in workshares:
        case_id, plan = item["caseId"], item["plan"]
        if case_id in existing:
            fail("This case already exists in the selected forecast: " + case_id)
        option = choices_by_id[case_id]
        start = option["startDate"]
        end = business_end(start, plan["schedule"]["business_days"], choices["calendar"])
        bindings = option["milestones"]
        if len(bindings) != len(plan["commercial"]["milestones"]):
            fail("Every original payment milestone needs its explicit date rule.")
        receipts = []
        for index, (milestone, binding) in enumerate(zip(plan["commercial"]["milestones"], bindings)):
            if binding["label"] != milestone["label"] or binding["anchor"] not in ("START", "FINISH"):
                fail("Retain each original milestone label and choose a START or FINISH date anchor.")
            lag = binding.get("lagDays", 0)
            if isinstance(lag, bool) or not isinstance(lag, int) or not 0 <= lag <= 365:
                fail("Milestone lagDays must be a whole calendar-day count between zero and365.")
            receipts.append({"id": "milestone-" + str(index + 1), "label": milestone["label"],
                             "amountUsd": money(milestone["amount"]), "date": None})
        conditions = "; ".join(plan["schedule"]["start_conditions"])
        phase_text = "\n".join(
            p["title"] + " — " + item["effort"][p["id"]] + " planned hours; " +
            str(p["business_days"]) + " business days; predecessors: " +
            (", ".join(p["depends_on"]) or "none") for p in plan["phases"])
        inputs["commercial"].append({
            "id": case_id, "title": plan["title"], "caseRef": case_id,
            "sourceUrl": plan["commercial"]["source_url"], "sourceIds": list(source_ids),
            "stage": "QUOTED", "selected": True, "priceUsd": money(plan["commercial"]["amount"]),
            "totalDeliveryCostUsd": money(rate * Decimal(item["hours"])), "remainingHours": item["hours"],
            "startDate": start, "endDate": end, "paymentMode": "accrual", "receipts": receipts,
            "cashIds": [], "invoiceIds": [], "directCashIds": [],
            "scope": plan["outcome"] + "\nStart conditions: " + conditions +
                     "\nOriginal commissioning sequence:\n" + phase_text,
            "note": choices["costBasis"] + " Entered rate: USD " + money(rate) + "/hour; " +
                    item["hours"] + " original estimated hands-on hours. " + option["dateBasis"] +
                    " The quoted business-day duration and full phase graph remain original. " +
                    "Milestone dates follow the allocated start/finish and entered collection delay. " +
                    "Original milestone conditions: " +
                    "; ".join(m["label"] + ": " + m["trigger"] for m in plan["commercial"]["milestones"])})
    inputs["name"] = choices["name"] + " / USD " + money(rate) + " assumed hourly cost"
    inputs["note"] = (inputs.get("note", "") + "\n" + choices["note"]).strip()
    return inputs


def schedule_input(base_seed, forecast_preview, workshares, choices, capacity, priority, allocation):
    """Expand new projects into their original phases for the original allocator."""
    source_rows = {row["id"]: row for row in forecast_preview["report"]["commercial"]}
    original_tasks = deepcopy(base_seed["inputs"]["tasks"])
    resources = deepcopy(base_seed["inputs"]["resources"])
    resource_map = {row["id"]: row for row in resources}
    role = choices["resourceRoles"]["commercial"]
    if role not in resource_map:
        fail("The commercial effort role must belong to the original resource roster.")
    weekdays = choices["calendar"]["weekdays"]
    if (not weekdays or len(set(weekdays)) != len(weekdays) or
            any(isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 6 for d in weekdays)):
        fail("Enter distinct working weekdays using Monday=0 through Sunday=6.")
    if set(capacity["weeklyHours"]) != set(resource_map):
        fail("Every original resource requires a complete weekly capacity assumption.")
    for resource_id, weekly in capacity["weeklyHours"].items():
        total = decimal(weekly, "Assumed weekly resource hours")
        share = (total / len(weekdays)).quantize(Decimal("0.00000001"))
        values = ["0"] * 7
        for weekday in weekdays[:-1]:
            values[weekday] = str(share)
        values[weekdays[-1]] = str(total - share * (len(weekdays) - 1))
        resource_map[resource_id]["hoursByWeekday"] = values
        resource_map[resource_id]["note"] = capacity["basis"]

    def rank(kind):
        preferred = (priority == "grant-first" and kind == "package") or (
            priority == "quoted-first" and kind == "commercial")
        return 10 if preferred else 100

    tasks, groups = [], {}
    for original in original_tasks:
        kind, ident = original["id"].split("/", 1)
        effort = original["effortHours"]
        if kind == "commercial":
            effort = {role: source_rows[ident]["remainingHours"]}
        tasks.append({
            "id": original["id"], "title": original["id"], "depends_on": original["dependsOn"],
            "effort_hours": effort, "release_date": original["releaseDate"], "due_date": original["dueDate"],
            "minimum_business_days": original["minBusinessDays"], "priority": rank(kind),
            "source_dates": {"startDate": original["releaseDate"], "endDate": original["dueDate"]}})
        groups[original["id"]] = {"sourceKind": kind, "sourceId": ident, "tasks": [original["id"]]}
    incoming = {row["caseId"] for row in workshares}
    if incoming & {row["sourceId"] for row in groups.values()}:
        fail("The original source seed already contains an incoming case.")
    for item in workshares:
        ident, plan = item["caseId"], item["plan"]
        commercial = source_rows[ident]
        phases = {phase["id"]: phase for phase in plan["phases"]}
        order = allocation._topology([{"id": p["id"], "depends_on": p["depends_on"]} for p in phases.values()])
        elapsed = {}
        for phase_id in order:
            phase = phases[phase_id]
            days = phase["business_days"]
            if isinstance(days, bool) or not isinstance(days, int) or days < 1:
                fail("Every original phase must have a positive business-day duration.")
            elapsed[phase_id] = max((elapsed[p] for p in phase["depends_on"]), default=0) + days
        if max(elapsed.values()) > plan["schedule"]["business_days"]:
            fail("The original phase critical path exceeds its quoted project duration: " + ident)
        ids = []
        for phase in plan["phases"]:
            key = "workshare/" + ident + "/" + phase["id"]
            ids.append(key)
            tasks.append({
                "id": key, "title": plan["customer"] + " · " + phase["title"], "workstream_id": ident,
                "depends_on": ["workshare/" + ident + "/" + parent for parent in phase["depends_on"]],
                "effort_hours": {role: item["effort"][phase["id"]]}, "release_date": commercial["startDate"],
                "due_date": business_end(commercial["startDate"], elapsed[phase["id"]], choices["calendar"]),
                "minimum_business_days": phase["business_days"], "priority": rank("commercial"),
                "source_dates": {"caseId": ident, "phaseId": phase["id"], "planSha256": item["planSha256"],
                                 "startDate": commercial["startDate"], "endDate": commercial["endDate"]}})
        groups["commercial/" + ident] = {"sourceKind": "commercial", "sourceId": ident, "tasks": ids}
    calendar = choices["calendar"]
    return {
        "schema": allocation.SCHEMA, "id": capacity["id"] + "-" + priority,
        "title": capacity["name"] + " / " + priority, "input_mode": "working", "currency": "USD",
        "start_date": forecast_preview["report"]["firstForecastDate"], "horizon_days": calendar["horizonDays"],
        "calendar": {"weekdays": weekdays, "holidays": calendar.get("holidays", []),
                     "extra_working_dates": calendar.get("extraWorkingDates", [])},
        "programme_ref": {"sourceForecast": base_seed["baseForecast"], "worksharePlans": [
            {"caseId": row["caseId"], "planSha256": row["planSha256"]} for row in workshares]},
        "resources": [{"id": resource["id"], "name": resource["name"],
                       "weekly_hours": resource["hoursByWeekday"], "hours_by_date": resource["hoursByDate"],
                       "hourly_cost": None} for resource in resources], "tasks": tasks}, groups


def selected_inputs(forecast_preview, native_schedule, groups, workshares, choices, lag, portfolios):
    if not native_schedule["summary"]["all_tasks_scheduled"]:
        fail("The native allocation has unscheduled work. Enter capacity or a horizon that covers the complete work.")
    index = {row["id"]: row for row in native_schedule["tasks"]}
    changes = []
    for group in groups.values():
        rows = [index[ident] for ident in group["tasks"]]
        changes.append({
            "sourceKind": group["sourceKind"], "sourceId": group["sourceId"],
            "startDate": min(row["first_work_date"] or row["ready_date"] for row in rows),
            "endDate": max(row["finish_date"] for row in rows)})
    result = portfolios.date_inputs(forecast_preview, changes, native_schedule["title"])
    rows = {row["id"]: row for row in result["commercial"]}
    options = {row["caseId"]: row for row in choices["cases"]}
    for item in workshares:
        row = rows[item["caseId"]]
        for milestone, binding in zip(row["receipts"], options[item["caseId"]]["milestones"]):
            anchor = row["startDate"] if binding["anchor"] == "START" else row["endDate"]
            delay = binding.get("lagDays", 0) + (lag if binding["anchor"] == "FINISH" else 0)
            milestone["date"] = (date.fromisoformat(anchor) + timedelta(days=delay)).isoformat()
        row["note"] += (
            " Forecast collection rule: original kickoff milestone at allocated start; accepted-handover milestone "
            "at allocated finish plus " + str(lag) + " calendar days. " + choices["collectionBasis"])
    result["name"] = result["name"][:250] + " / collection +" + str(lag) + "d"
    return result, changes


def collection_findings(source, selected, changes):
    """Retain the existing portfolio operator's source-date review semantics."""
    windows = {(row["sourceKind"], row["sourceId"]): row for row in changes}
    prior_quotes = {row["id"]: row for row in source["report"]["commercial"]}
    findings = []
    for quote in selected["report"]["commercial"]:
        if not quote["selected"] or quote["id"] not in prior_quotes:
            continue
        window = windows[("commercial", quote["id"])]
        original = prior_quotes[quote["id"]]
        for receipt in quote["receipts"]:
            stamp = receipt["date"]
            if not stamp or Decimal(receipt["remainingUsd"]) == 0:
                continue
            field = "commercial." + quote["id"] + ".receipts." + receipt["id"]
            if stamp < window["startDate"]:
                findings.append({
                    "code": "COLLECTION_BEFORE_ALLOCATED_START", "field": field,
                    "message": receipt["label"] + " remains on " + stamp + ", before allocated work starts on " +
                               window["startDate"] + ". Review collection timing in the original forecast."})
            elif stamp >= original["endDate"] and stamp < window["endDate"]:
                findings.append({
                    "code": "COLLECTION_BEFORE_REPLANNED_FINISH", "field": field,
                    "message": receipt["label"] + " remains on " + stamp + "; the work now finishes on " +
                               window["endDate"] + ". Review its collection basis in the original forecast."})
    for grant in selected["report"]["grants"]:
        ends = [windows[("package", package["id"])]["endDate"] for package in source["report"]["packages"]
                if package["tranche"] == grant["tranche"]]
        if (grant["included"] and grant["forecastDate"] and Decimal(grant["remainingUsd"]) and
                ends and grant["forecastDate"] < max(ends)):
            findings.append({
                "code": "GRANT_COLLECTION_BEFORE_REPLANNED_FINISH", "field": "grants." + str(grant["tranche"]),
                "message": "The conditional grant receipt remains on " + grant["forecastDate"] +
                           "; this tranche's allocated work finishes on " + max(ends) +
                           ". Review the original payout timing assumption."})
    return findings


def evaluate(ops, case_id, forecast_id, commissioning, packet, choices, source_ids, destination, raw_inputs=None):
    """Run distinct original allocations once, then reuse them for the cash matrix."""
    import portfolio
    import portfolio_schedule as allocation

    workshares = load_workshares(commissioning, packet)
    base = ops.forecast(case_id, forecast_id)
    version = ops.read(case_id)["program"]["version"]
    seed = ops.seed_portfolio(case_id, {"expectedVersion": version, "forecastId": forecast_id})
    variants = {}
    if not choices["hourlyCostsUsd"] or not choices["capacities"] or not choices["priorities"]:
        fail("Enter complete cost, capacity and priority alternatives.")
    if len({str(rate) for rate in choices["hourlyCostsUsd"]}) != len(choices["hourlyCostsUsd"]):
        fail("Cost-rate alternatives must be distinct.")
    unique(choices["capacities"], "id", "Capacity alternatives")
    if len(set(choices["priorities"])) != len(choices["priorities"]):
        fail("Priority alternatives must be distinct.")
    lags = choices["completionCollectionLagDays"]
    if not lags or len(set(lags)) != len(lags):
        fail("Enter distinct collection-delay alternatives.")
    for lag in lags:
        if isinstance(lag, bool) or not isinstance(lag, int) or not 0 <= lag <= 365:
            fail("Collection delays use whole calendar days between zero and365.")
    for rate in choices["hourlyCostsUsd"]:
        inputs = commercial_inputs(base["inputs"], workshares, choices, rate, source_ids)
        variants[str(rate)] = ops.preview_forecast(case_id, {"expectedVersion": version, "inputs": inputs})
    first = next(iter(variants.values()))
    expected_hours = sum((Decimal(row["remainingHours"]) for row in first["report"]["packages"]), ZERO)
    expected_hours += sum((Decimal(row["remainingHours"]) for row in first["report"]["commercial"] if row["selected"]), ZERO)
    schedules, comparisons, selections = {}, [], {}
    members = []
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".partial")
    raw_inputs = raw_inputs or {}
    with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        def put(name, value):
            raw = value if isinstance(value, bytes) else (canonical(value) + "\n").encode()
            archive.writestr(name, raw)
            members.append({"path": name, "bytes": len(raw), "sha256": sha(raw)})

        put("inputs/commissioning-inputs.json", raw_inputs.get("commissioning", commissioning))
        put("inputs/receiving-packet.json", raw_inputs.get("packet", packet))
        put("inputs/planning-choices.json", raw_inputs.get("choices", choices))
        put("inputs/original-source-forecast.json", {key: value for key, value in base.items() if key != "current"})
        put("inputs/original-portfolio-seed.json", seed)
        for capacity in choices["capacities"]:
            for priority in choices["priorities"]:
                if priority not in ("balanced", "grant-first", "quoted-first"):
                    fail("Choose balanced, grant-first or quoted-first priority.")
                native_input, groups = schedule_input(seed, first, workshares, choices, capacity, priority, allocation)
                native = allocation.plan_programme(native_input)
                if Decimal(native["summary"]["effort_hours"]) != expected_hours:
                    fail("The phase translation changed original remaining effort.")
                ident = native_input["id"]
                schedules[ident] = {"inputSha256": native["input_sha256"], "summary": native["summary"]}
                put("allocations/" + ident + "-input.json", native_input)
                put("allocations/" + ident + "-result.json", native)
                if not native["summary"]["all_tasks_scheduled"]:
                    comparisons.append({"id": ident, "status": "HORIZON_EXCEEDED", "summary": native["summary"]})
                    continue
                for rate, source in variants.items():
                    for lag in lags:
                        inputs, changes = selected_inputs(source, native, groups, workshares, choices, lag, portfolio)
                        preview = ops.preview_forecast(case_id, {"expectedVersion": version, "inputs": inputs})
                        findings = collection_findings(base, preview, changes)
                        selected_id = ident + "-cost-" + rate.replace(".", "_") + "-lag-" + str(lag)
                        selections[selected_id] = inputs
                        targets = {row["id"]: row for row in preview["report"]["commercial"]}
                        windows = {row["sourceId"]: row for row in changes if row["sourceKind"] == "commercial"}
                        incoming = [{
                            "caseId": workshare["caseId"],
                            "startDate": windows[workshare["caseId"]]["startDate"],
                            "endDate": windows[workshare["caseId"]]["endDate"],
                            "priceUsd": targets[workshare["caseId"]]["priceUsd"],
                            "deliveryCostUsd": targets[workshare["caseId"]]["totalDeliveryCostUsd"],
                            "contributionUsd": targets[workshare["caseId"]]["forecastContributionBeforeOtherCostsUsd"],
                            "receipts": targets[workshare["caseId"]]["receipts"]} for workshare in workshares]
                        comparisons.append({
                            "id": selected_id, "status": "READY", "allocationId": ident,
                            "capacity": capacity["weeklyHours"], "priority": priority,
                            "hourlyCostUsd": money(rate), "completionCollectionLagDays": lag,
                            "finishDate": native["summary"]["projected_finish_date"],
                            "phaseDeadlineExceptions": native["summary"]["deadline_exceptions"],
                            "totalHours": native["summary"]["effort_hours"], "cash": preview["report"]["scenarios"],
                            "totals": preview["report"]["totals"], "incoming": incoming,
                            "collectionTimingReviews": len(findings), "collectionTimingFindings": findings,
                            "previewSha256": preview["previewSha256"]})
                        put("forecasts/" + selected_id + "-inputs.json", inputs)
                        put("forecasts/" + selected_id + "-native-preview.json", preview)
        result = {
            "schema": SCHEMA, "sourceCase": case_id, "sourceForecastId": forecast_id,
            "sourceForecastSha256": base["sha256"], "sourceVersion": version, "sourceIds": list(source_ids),
            "workshares": [{key: row[key] for key in ("caseId", "planSha256", "hours", "phaseCount")} for row in workshares],
            "scheduleCount": len(schedules), "cashScenarioCount": len(selections), "schedules": schedules,
            "comparisons": comparisons, "choices": choices,
            "method": "Original SF47 daily phase allocator followed by the original SF47 cash forecast. "
                      "Each capacity/priority schedule is evaluated once and reused across rate and collection-lag assumptions."}
        put("review.json", result)
        put("Review.html", report_html(result))
        put("MANIFEST.json", {"schema": SCHEMA, "members": list(members)})
    partial.replace(destination)
    return result, selections


def report_html(result):
    ready = [row for row in result["comparisons"] if row["status"] == "READY"]
    esc = lambda value: escape(str(value))
    body_rows = []
    for row in ready:
        cash = row["cash"]["commercial"]
        values = (
            row["allocationId"], row["hourlyCostUsd"], row["completionCollectionLagDays"],
            row["finishDate"], row["phaseDeadlineExceptions"], row["collectionTimingReviews"],
            cash["additionalCashNeededUsd"], cash["peakNeedDate"], cash["endDeltaUsd"])
        body_rows.append("<tr data-capacity='" + esc(row["allocationId"]) + "'>" +
                         "".join("<td>" + esc(value) + "</td>" for value in values) + "</tr>")
    source_rows = []
    if ready:
        for item in ready[0]["incoming"]:
            hours = next(w["hours"] for w in result["workshares"] if w["caseId"] == item["caseId"])
            source_rows.append("<tr><td>" + esc(item["caseId"]) + "</td><td>" +
                               esc(item["priceUsd"]) + "</td><td>" + esc(hours) + "</td></tr>")
    options = "".join("<option>" + esc(key) + "</option>" for key in result["schedules"])
    sections = [
        "<!doctype html><html lang='en'><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        "<title>Workshare delivery and cash review</title><style>",
        "body{font:15px/1.55 system-ui,sans-serif;color:#1b1b1b;background:#f5f5f5;margin:0}",
        "main{max-width:1350px;margin:auto;padding:30px}h1{font-size:28px}h2{font-size:20px;margin-top:30px}",
        "section{background:#fff;border:1px solid #bbb;padding:22px;margin:20px 0}",
        "table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}",
        "th,td{padding:9px;text-align:left;border-bottom:1px solid #ccc;vertical-align:top}th{background:#ededed}",
        "select{padding:9px;font:inherit;max-width:100%}.scroll{overflow:auto}code{overflow-wrap:anywhere}.muted{color:#555}",
        "@media(max-width:600px){main,section{padding:12px}h1{font-size:24px}}</style><main>",
        "<h1>Workshare delivery and cash review</h1><p>Original commissioning phases, retained grant work, ",
        "explicit resource calendars and conditional collection dates.</p><section><h2>Complete source intake</h2><p>",
        esc(sum(Decimal(row["hours"]) for row in result["workshares"])), " additional estimated hours across ",
        esc(sum(row["phaseCount"] for row in result["workshares"])), " original phases. The prior work, records, ",
        "sources and cost assumptions stay in the original operating case.</p><div class='scroll'><table><thead><tr>",
        "<th>Original case</th><th>Proposed USD fee</th><th>Estimated hours</th></tr></thead><tbody>",
        "".join(source_rows), "</tbody></table></div></section><section><h2>Reading the comparison</h2><p>",
        esc(result["choices"]["costBasis"]), "</p><p>", esc(result["choices"]["collectionBasis"]), "</p>",
        "<p>The original daily allocator preserves each phase dependency and minimum business-day duration. ",
        "Capacity is an entered allocation assumption. Each distinct date schedule is reused across cash choices. ",
        "Cash needed is the peak cumulative forecast deficit before applying opening cash. The original opening-cash balance ",
        "is unchanged; gapAfterOpeningCashUsd in the native result reports the remaining shortfall after it.</p>",
        "<p>Phase date exceptions count individual phase deadlines. Collection reviews identify original quoted or ",
        "grant receipts that remain earlier than the newly allocated work. Read those findings before selecting a cash case. ",
        "Every finding and all dated rows are retained in review.json and the native result files.</p></section>",
        "<section><h2>", esc(result["scheduleCount"]), " allocations · ", esc(result["cashScenarioCount"]),
        " cash scenarios</h2><label>Allocation <select id='filter'><option value=''>All allocations</option>",
        options, "</select></label><div class='scroll'><table><thead><tr>",
        "<th>Allocation / priority</th><th>Assumed USD/h</th><th>Handover collection delay</th>",
        "<th>Whole portfolio finish</th><th>Phase date exceptions</th><th>Collection reviews</th>",
        "<th>Additional cash needed</th><th>Peak date</th><th>Eventual cash change</th>",
        "</tr></thead><tbody id='comparison'>", "".join(body_rows), "</tbody></table></div></section>",
        "<section><h2>Receiving</h2><p>Import the complete operating case through Operations → Import complete case. ",
        "The saved workshare review is an original source attachment. Selected representative dated forecasts are saved ",
        "alongside the existing forecasts. Every other scenario has a complete editable input in this review archive ",
        "for the original forecast operator.</p><p class='muted'>", esc(result["method"]), "</p></section></main>",
        "<script>document.querySelector('#filter').addEventListener('change',e=>{",
        "for(const row of document.querySelectorAll('#comparison tr'))",
        "row.hidden=!!e.target.value&&row.dataset.capacity!==e.target.value})</script></html>"]
    return "".join(sections).encode()


def attachment(ops, case_id, path, actor, operation, source_url=""):
    path = Path(path)
    raw = path.read_bytes()
    before = ops.read(case_id)
    same = [row for row in before["sources"] if row["sha256"] == sha(raw) and row["bytes"] == len(raw)]
    if same:
        return same[0]["id"]
    body = {
        "action": "source.add", "expectedVersion": before["program"]["version"], "actor": actor,
        "requestId": operation + "-source-" + sha(raw)[:24],
        "note": "Retain the complete original Workshare intake source.",
        "data": {"filename": path.name,
                 "mediaType": "application/zip" if path.suffix == ".zip" else "application/json",
                 "kind": "other", "sourceUrl": source_url, "contentBase64": base64.b64encode(raw).decode()}}
    return ops.command(case_id, body)["recordId"]


def save_forecast(ops, case_id, inputs, actor, operation, name):
    current = ops.read(case_id)
    preview = ops.preview_forecast(case_id, {"expectedVersion": current["program"]["version"], "inputs": inputs})
    for original in ops.list_forecasts(case_id):
        candidate = ops.forecast(case_id, original["id"])
        if candidate["inputs"] == preview["inputs"] and not candidate["current"]["sourceChanged"]:
            return {"id": case_id, "version": current["program"]["version"],
                    "recordId": original["id"], "reused": True}
    identity = digest({"selection": name, "preview": preview["previewSha256"]})[:28]
    body = {
        "action": "forecast.save", "expectedVersion": current["program"]["version"], "actor": actor,
        "requestId": operation + "-forecast-" + identity,
        "note": "Original Workshare commissioning, native phase allocation and explicitly entered cash assumptions.",
        "data": {"inputs": preview["inputs"], "expectedPreviewSha256": preview["previewSha256"]}}
    return ops.command(case_id, body)


def check_archive(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            fail("The completed archive has an unreadable member.")
        manifest = json.loads(archive.read("MANIFEST.json"))
        for entry in manifest["members"]:
            raw = archive.read(entry["path"])
            if sha(raw) != entry["sha256"] or len(raw) != entry["bytes"]:
                fail("The completed archive differs from its original member manifest.")


def receiving_identity(args):
    """Bind a completed operation to its exact selected inputs and Python source."""
    engine = Path(args.engine_dir).resolve()
    sources = sorted(set(engine.glob("*.py")) | set(engine.parent.glob("*.py")))
    if not sources:
        fail("The original SF47 engine source is missing.")
    inputs = {}
    for label, path in (
            ("originalCase", args.original_case), ("commissioning", args.commissioning),
            ("packet", args.packet), ("choices", args.choices), ("scenario", args.scenario)):
        raw = Path(path).read_bytes()
        inputs[label] = {"bytes": len(raw), "sha256": sha(raw)}
    return {
        "schema": SCHEMA, "operationId": args.operation, "actor": args.actor,
        "sourceUrl": args.source_url, "originalForecastId": args.forecast,
        "inputs": inputs, "adapterSha256": sha(Path(__file__).read_bytes()),
        "engineSources": [
            {"path": path.relative_to(engine.parent).as_posix(),
             "bytes": path.stat().st_size, "sha256": sha(path.read_bytes())}
            for path in sources]}


def completed_receiving(args, root, identity, Workspace, Operations):
    """Reopen a completed receiving edition without appending another review."""
    saved_path = root / "native-receiving-result.json"
    if not saved_path.exists():
        return None
    receipt = json.loads(saved_path.read_bytes())
    if receipt.get("schema") != SCHEMA or receipt.get("invocation") != identity:
        fail("The completed receiving operation belongs to different selected inputs or source.")
    for artifact in receipt["artifacts"]:
        path = root / artifact["filename"]
        if not path.is_file():
            fail("A completed receiving output is missing: " + artifact["filename"])
        raw = path.read_bytes()
        if len(raw) != artifact["bytes"] or sha(raw) != artifact["sha256"]:
            fail("A completed receiving output changed: " + artifact["filename"])
    for directory, case in (
            (root / "workspace", receipt["case"]),
            (root / "restored", receipt["receivingCase"]["id"])):
        if not (directory / "planning.sqlite3").is_file():
            fail("A completed receiving database is missing: " + directory.name + "/planning.sqlite3")
        workspace = Workspace(directory, Path(args.scenario))
        try:
            operations = Operations(workspace)
            for selected in receipt["savedForecasts"]:
                actual = operations.forecast(case, selected["receipt"]["recordId"])
                if actual["sha256"] != selected["sha256"]:
                    fail("A completed receiving forecast changed across reopen.")
        finally:
            workspace.close()
    return receipt


def receive(args):
    from model import Workspace
    from operations import Operations

    root = Path(args.output).resolve()
    identity = receiving_identity(args)
    completed = completed_receiving(args, root, identity, Workspace, Operations)
    if completed is not None:
        return completed
    root.mkdir(parents=True, exist_ok=True)
    commissioning_raw = Path(args.commissioning).read_bytes()
    packet_raw = Path(args.packet).read_bytes()
    choices_raw = Path(args.choices).read_bytes()
    commissioning, packet, choices = map(json.loads, (commissioning_raw, packet_raw, choices_raw))
    original = Path(args.original_case).read_bytes()
    ws = Workspace(root / "workspace", Path(args.scenario))
    ops = Operations(ws)
    received = ops.import_bundle(original, choices["name"], args.operation + "-original-case", args.actor)
    case = received["id"]
    before = ops.read(case)
    original_inputs = deepcopy(ops.forecast(case, args.forecast)["inputs"])
    source_ids = [
        attachment(ops, case, path, args.actor, args.operation, args.source_url)
        for path in (args.commissioning, args.packet, args.choices)]
    refreshed = save_forecast(ops, case, original_inputs, args.actor, args.operation, "retained-source")
    review_path = root / "Workshare_Capacity_And_Cash_Review_20261012.zip"
    result, selections = evaluate(
        ops, case, refreshed["recordId"], commissioning, packet, choices, source_ids, review_path,
        raw_inputs={"commissioning": commissioning_raw, "packet": packet_raw, "choices": choices_raw})
    check_archive(review_path)
    review_json_path = root / "review.json"
    review_json_path.write_text(canonical(result) + "\n")
    report_path = root / "Workshare_Delivery_And_Cash_Review_20261012.html"
    report_path.write_bytes(report_html(result))
    review_source = attachment(ops, case, review_path, args.actor, args.operation, args.source_url)
    saved = []
    for selected_id in choices["saveSelections"]:
        if selected_id not in selections:
            fail("A selected forecast must name a completed native alternative: " + selected_id)
        inputs = deepcopy(selections[selected_id])
        incoming = {row["caseId"] for row in result["workshares"]}
        for row in inputs["commercial"]:
            if row["id"] in incoming and review_source not in row["sourceIds"]:
                row["sourceIds"].append(review_source)
        answer = save_forecast(ops, case, inputs, args.actor, args.operation, selected_id)
        saved.append({"selection": selected_id, "receipt": answer,
                      "sha256": ops.forecast(case, answer["recordId"])["sha256"]})
    after = ops.read(case)
    if before["records"] != after["records"] or before["plan"] != after["plan"]:
        fail("The original plan or operating records changed during source intake.")
    original_sources = {row["id"]: row for row in before["sources"]}
    current_sources = {row["id"]: row for row in after["sources"]}
    if any(current_sources.get(ident) != row for ident, row in original_sources.items()):
        fail("An original source attachment changed during Workshare intake.")
    bundle = ops.export(case)
    full_path = root / "SCF_Operating_Case_With_SEC_Workshares_20261012.zip"
    full_path.write_bytes(bundle)
    ws.close()

    ws = Workspace(root / "workspace", Path(args.scenario))
    reopened = Operations(ws)
    for item in saved:
        if reopened.forecast(case, item["receipt"]["recordId"])["sha256"] != item["sha256"]:
            fail("A selected forecast changed across cold reopen.")
    ws.close()

    restored = Workspace(root / "restored", Path(args.scenario))
    receiver = Operations(restored)
    imported = receiver.import_bundle(bundle, choices["name"], args.operation + "-receiving", args.actor)
    for item in saved:
        if receiver.forecast(imported["id"], item["receipt"]["recordId"])["sha256"] != item["sha256"]:
            fail("The complete receiving archive changed a selected forecast.")
    if receiver.read(imported["id"])["records"] != before["records"]:
        fail("The complete receiving archive changed original records.")
    replay = receiver.import_bundle(bundle, choices["name"], args.operation + "-receiving", args.actor)
    if imported != replay:
        fail("The original same-request import did not reuse its retained result.")
    restored.close()

    receipt = {
        "schema": SCHEMA, "operationId": args.operation, "invocation": identity,
        "case": case, "receivingCase": imported,
        "savedForecasts": saved, "scheduleCount": result["scheduleCount"],
        "cashScenarioCount": result["cashScenarioCount"], "originalRecordsPreserved": True,
        "originalPlanPreserved": True, "originalSourcesPreserved": True, "coldReopen": True,
        "sameRequestImport": True,
        "sourceFiles": [
            {"path": str(Path(path).resolve()), "bytes": Path(path).stat().st_size,
             "sha256": sha(Path(path).read_bytes())}
            for path in (args.original_case, args.commissioning, args.packet, args.choices)],
        "artifacts": [
            {"filename": path.name, "bytes": path.stat().st_size, "sha256": sha(path.read_bytes())}
            for path in (review_path, full_path, report_path, review_json_path)]}
    receipt_path = root / "native-receiving-result.json"
    receipt_partial = receipt_path.with_suffix(".json.partial")
    receipt_partial.write_text(canonical(receipt) + "\n")
    receipt_partial.replace(receipt_path)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-dir", required=True, help="Exact maintained SF47 workspace module directory")
    parser.add_argument("--scenario", required=True, help="Original SF47 source scenario")
    parser.add_argument("--original-case", required=True, help="Complete original Operations ZIP")
    parser.add_argument("--forecast", required=True, help="Original saved forecast within that case")
    parser.add_argument("--commissioning", required=True)
    parser.add_argument("--packet", required=True)
    parser.add_argument("--choices", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--source-url", default="")
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.engine_dir).resolve()))
    print(canonical(receive(args)))


if __name__ == "__main__":
    main()
