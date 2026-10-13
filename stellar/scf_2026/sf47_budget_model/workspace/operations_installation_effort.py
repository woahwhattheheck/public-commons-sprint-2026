"""Attribute original Work to saved Installation phases and review remaining effort.

Work remains in the native Operations ledger. This module stores quantity
attribution and reviewed estimates inside each original Installation edition;
it owns no independent timesheet, invoice, acceptance or scheduling lifecycle.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal
from html import escape
import re

from model import Problem, canonical, digest, text
import operations_domain as domain
import operations_commercial_effort as commercial_effort

SCHEMA = "stellar-forge.sf47-installation-effort.v1"
SNAPSHOT_KEY = "installationEffort"
ZERO = Decimal("0")
MAX_ALLOCATIONS = 1000
MAX_WINDOWS = 100
WORK_CONTENT_FIELDS = ("id", "contributorId", "costId", "description", "startDate", "endDate",
                       "hours", "fundingBasis", "sourceIds", "sourceNote", "sourceBasis")


def fail(message, code="INVALID_INSTALLATION_EFFORT", status=422):
    raise Problem(message, status, code)


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail("Use the declared " + label + " fields.")
    return value


def rows(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        fail(label + ": use up to " + str(maximum) + " complete rows.")
    return value


def label(value, name, limit=4000, required=False):
    return text(value if value is not None else "", name, limit, required)


def hours(value):
    return domain.quantity(value, "Hours", 4)


def original_day(value):
    """Retain the civil date in the original observation's declared timezone."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()


def content_identity(work):
    return digest({key: deepcopy(work.get(key)) for key in WORK_CONTENT_FIELDS})


def phase_ids(document):
    if commercial_effort.selected(document):
        return commercial_effort.phase_ids(document)
    binding = document.get("workshare")
    if not binding:
        fail("Select an original Workshare Installation before attributing its work.")
    return [row["phaseId"] for row in binding["phaseChecks"]]


def normalize(context, raw, document):
    value = obj(deepcopy(raw), ("schema", "asOfDate", "allocations", "reviews", "supportWindows", "note"),
                "Installation effort")
    if value.get("schema") != SCHEMA:
        fail("Use the native Installation effort schema.")
    phases = phase_ids(document)
    source_ids = context["sources"]
    work = {row["id"]: row for row in context["records"]["work"]}
    as_of = domain.calendar(value.get("asOfDate"), "Effort as-of date")
    allocations, seen = [], set()
    for row in rows(value.get("allocations", []), "Phase Work attribution", MAX_ALLOCATIONS):
        obj(row, ("workId", "phaseId", "hours", "workContentSha256", "note"), "phase Work attribution")
        key = (row.get("workId"), row.get("phaseId"))
        if key[0] not in work or not isinstance(key[1], str) or not key[1] or len(key[1]) > 1000 or key in seen:
            fail("Select each original Work and phase pair once.")
        seen.add(key)
        allocations.append({"workId": key[0], "phaseId": key[1],
            "hours": domain.quantity(row.get("hours"), "Attributed original Work hours", 4, True),
            "workContentSha256": domain.sha(row.get("workContentSha256"), "Selected original Work content", False),
            "note": label(row.get("note"), "Phase attribution basis", 4000)})
    reviews, seen = [], set()
    for row in rows(value.get("reviews", []), "Phase remaining-work review", 200):
        obj(row, ("phaseId", "remainingHours", "reviewedBy", "reviewedAt", "basisSha256", "note", "sourceIds"),
            "phase remaining-work review")
        ident = row.get("phaseId")
        if not isinstance(ident, str) or not ident or len(ident) > 1000 or ident in seen:
            fail("Review each retained original phase once.")
        seen.add(ident)
        amount = None if row.get("remainingHours") in (None, "") else hours(row["remainingHours"])
        reviewer = label(row.get("reviewedBy"), "Remaining-work reviewer", 500)
        observed = domain.timestamp(row.get("reviewedAt"), "Remaining-work review time", True)
        note = label(row.get("note"), "Remaining-work estimate basis", 8000)
        basis = domain.sha(row.get("basisSha256"), "Reviewed original phase and Work basis")
        # Empty reviews are useful editable inputs. A committed quantity needs
        # an accountable review; currentness is reported against actual content.
        if amount is not None and (not reviewer or not observed or not note or not basis):
            fail("An entered remaining estimate needs its reviewer, original observation time, current basis and explanation.")
        reviews.append({"phaseId": ident, "remainingHours": amount, "reviewedBy": reviewer,
            "reviewedAt": observed, "basisSha256": basis, "note": note,
            "sourceIds": domain.reference_list(row.get("sourceIds", []), source_ids, "Remaining-estimate sources")})
    review_index = {row["phaseId"]: row for row in reviews}
    retained_ids = phases + sorted(set(review_index) - set(phases))
    reviews = [review_index.get(ident, {"phaseId": ident, "remainingHours": None, "reviewedBy": "",
        "reviewedAt": None, "basisSha256": "", "note": "", "sourceIds": []}) for ident in retained_ids]
    if commercial_effort.selected(document) and value.get("supportWindows", []):
        fail("Keep commercial recurring service terms in their original workflow; accepted implementation tasks do not define support-phase allowances.")
    windows, used_ids, used_phases = [], set(), set()
    for row in rows(value.get("supportWindows", []), "Original support allowances", MAX_WINDOWS):
        obj(row, ("id", "phaseIds", "includedHours", "anchorPhaseId", "anchorKind", "calendarDays",
                  "sourcePaths", "sourcePlanSha256", "reviewedBy", "reviewedAt", "note"), "support allowance")
        ident = row.get("id")
        if not isinstance(ident, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,79}", ident) or ident in used_ids:
            fail("Give each original support allowance a distinct lowercase identity.")
        selected = rows(row.get("phaseIds", []), "Support phases", 100)
        if (any(not isinstance(item, str) or not item or len(item) > 1000 for item in selected)
                or len(selected) != len(set(selected))):
            fail("Select distinct retained original support phase identities.")
        if not selected or set(selected) & used_phases:
            fail("Select each original support phase in only one included-hours allowance.")
        anchor = row.get("anchorPhaseId")
        if not isinstance(anchor, str) or not anchor or len(anchor) > 1000 or anchor in selected:
            fail("Select the original preceding acceptance or handoff phase.")
        pointers = rows(row.get("sourcePaths"), "Original support term locations", 20)
        if (not pointers or any(not isinstance(item, str) or not item.startswith("/") or len(item) > 1000 for item in pointers)
                or len(pointers) != len(set(pointers))):
            fail("Select distinct original Workshare plan JSON pointers for the support terms.")
        reviewed_at = domain.timestamp(row.get("reviewedAt"), "Support term review time")
        windows.append({"id": ident, "phaseIds": selected,
            "includedHours": domain.quantity(row.get("includedHours"), "Original included support hours", 4, True),
            "anchorPhaseId": anchor, "anchorKind": domain.enum(row.get("anchorKind"), ("ACCEPTANCE", "HANDOFF"), "Support start event"),
            "calendarDays": domain.integer(row.get("calendarDays"), "Original support calendar-day window", 1, 3660),
            "sourcePaths": list(pointers),
            "sourcePlanSha256": domain.sha(row.get("sourcePlanSha256", document["workshare"]["planSha256"]), "Reviewed support plan", False),
            "reviewedBy": label(row.get("reviewedBy"), "Support term reviewer", 500, True),
            "reviewedAt": reviewed_at, "note": label(row.get("note"), "Original support interpretation", 8000, True)})
        used_ids.add(ident); used_phases.update(selected)
    return {"schema": SCHEMA, "asOfDate": as_of, "allocations": allocations, "reviews": reviews,
            "supportWindows": windows, "note": label(value.get("note"), "Delivery effort notes", 12000)}


def pointer(plan, path):
    current = plan
    for encoded in path.split("/")[1:]:
        if re.search(r"~(?![01])", encoded):
            fail("Use the original JSON pointer escaping for a support term.")
        key = encoded.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list) and re.fullmatch(r"0|[1-9][0-9]*", key) and int(key) < len(current):
            current = current[int(key)]
        else:
            fail("The support term location is absent from the selected original Workshare plan.")
    if current in (None, "", [], {}):
        fail("Select a populated original support term.")
    return deepcopy(current)


def source_value(original, document):
    if commercial_effort.selected(document):
        return commercial_effort.source_value(original, document)
    if not original:
        fail("Retain the original complete Workshare source for delivery effort.")
    row, binding = original["workshare"], document["workshare"]
    return {"caseId": row["caseId"], "planSha256": row["planSha256"],
            "plan": deepcopy(row["plan"]), "effort": deepcopy(row["effort"]), "hours": row["hours"],
            **{key: binding.get(key) for key in ("sourceId", "sourceSha256", "packetSourceId", "packetSha256")}}


def retained_source_context(source, document, previous):
    """Retain only source meanings still referenced by the current document."""
    if commercial_effort.is_source(source):
        return commercial_effort.retained_source_context(source, document, previous, SNAPSHOT_KEY)
    phases = {row["id"]: row for row in source["plan"]["phases"]}
    before = previous["preview"] if previous else None
    frozen = before["snapshot"].get(SNAPSHOT_KEY, {}) if before else {}
    old_source = frozen.get("source")
    available = {source["planSha256"]: source}
    if old_source:
        available[old_source["planSha256"]] = old_source
    for item in frozen.get("supportSources", []):
        available[item["planSha256"]] = item
    support_sources = []
    for key in sorted({row["sourcePlanSha256"] for row in document["effort"]["supportWindows"]}):
        if key not in available:
            fail("Retain the previously reviewed original support plan or explicitly select the current source.")
        support_sources.append(deepcopy(available[key]))
    retired_index = {row["phaseId"]: row for row in frozen.get("retiredPhases", [])}
    if old_source and before:
        links = {row["phaseId"]: row["checkId"] for row in before["document"]["workshare"]["phaseChecks"]}
        checks = {row["id"]: row for row in before["document"]["checks"]}
        for phase in old_source["plan"]["phases"]:
            retired_index[phase["id"]] = {"phaseId": phase["id"], "title": phase["title"],
                "quotedHours": old_source["effort"][phase["id"]], "terms": deepcopy(phase),
                "sourceId": old_source["sourceId"], "sourceSha256": old_source["sourceSha256"],
                "planSha256": old_source["planSha256"], "check": deepcopy(checks[links[phase["id"]]])}
    used = {row["phaseId"] for row in document["effort"]["allocations"]}
    used.update(row["phaseId"] for row in document["effort"]["reviews"])
    for window in document["effort"]["supportWindows"]:
        used.update(window["phaseIds"]); used.add(window["anchorPhaseId"])
    retired = []
    for ident in sorted(used - set(phases)):
        if ident not in retired_index:
            fail("A retained phase must come from this Installation's original saved source history.")
        retired.append(deepcopy(retired_index[ident]))
    return retired, support_sources


def validate_terms(frozen, document):
    if commercial_effort.is_source(frozen["source"]):
        if document["effort"]["supportWindows"] or frozen["supportSources"]:
            fail("Commercial effort must preserve its native task scope without inferred support allowances.")
        return
    sources = {row["planSha256"]: row for row in frozen["supportSources"]}
    for window in document["effort"]["supportWindows"]:
        source = sources[window["sourcePlanSha256"]]
        phase_map = {row["id"]: row for row in source["plan"]["phases"]}
        if set(window["phaseIds"]) - set(phase_map) or window["anchorPhaseId"] not in phase_map:
            fail("Retain the support phases and original start event from their reviewed source plan.")
        original_hours = sum((Decimal(source["effort"][key]) for key in window["phaseIds"]), ZERO)
        if Decimal(window["includedHours"]) != original_hours:
            fail("The included support allowance must retain the full original quoted effort of its selected support phases.")
        for path in window["sourcePaths"]:
            pointer(source["plan"], path)
        def ancestors(ident, seen=None):
            seen = set() if seen is None else seen
            if ident in seen:
                return set()
            seen.add(ident)
            result = set(phase_map[ident]["depends_on"])
            for parent in list(result):
                result.update(ancestors(parent, seen))
            return result
        if any(window["anchorPhaseId"] not in ancestors(ident) for ident in window["phaseIds"]):
            fail("The support start event must precede each selected support phase in the original source graph.")

def claimed_work(document):
    result = {row["workId"] for row in document.get("effort", {}).get("allocations", [])}
    for check in document["checks"]:
        result.update(check["workIds"])
    return result


def sums(document):
    result = defaultdict(lambda: ZERO)
    for row in document.get("effort", {}).get("allocations", []):
        result[row["workId"]] += Decimal(row["hours"])
    return result


def peer_projection(rows, installation_id, selected_work, version=None):
    latest = {}
    for row in rows:
        if row["id"] == installation_id or version is not None and row["version"] > version:
            continue
        if row["id"] not in latest or row["revision"] > latest[row["id"]]["revision"]:
            latest[row["id"]] = row
    result = []
    for ident, row in sorted(latest.items()):
        allocations = [deepcopy(item) for item in row["preview"]["document"].get("effort", {}).get("allocations", [])
                       if item["workId"] in selected_work]
        if allocations:
            result.append({"installationId": ident, "installationRevision": row["revision"],
                "installationSha256": row["sha256"], "version": row["version"], "allocations": allocations})
    return result


def capture_context(operations, context, document, installation_id, original, *, heads=None, previous=None):
    from operations_installations import load_heads
    source = source_value(original, document)
    retired, support_sources = retained_source_context(source, document, previous)
    others = peer_projection(load_heads(operations, context["program"]["id"]) if heads is None else heads,
                             installation_id, claimed_work(document))
    value = {"schema": SCHEMA, "installationId": installation_id, "source": source,
             "otherAllocations": others, "retiredPhases": retired, "supportSources": support_sources}
    validate_terms(value, document)
    return value


def check_quantities(context, document, frozen, previous):
    """Forbid new overclaims while allowing original corrections to be repaired.

    A changed original Work quantity can make previously valid claims exceed its
    corrected amount. Keeping or decreasing that claim is permitted, including
    an unrelated acceptance update; adding attributed hours is not.
    """
    records = {row["id"]: row for row in context["records"]["work"]}
    selected, old = sums(document), sums(previous["preview"]["document"]) if previous else {}
    original_phases = ({row["id"] for row in frozen["source"]["tasks"]}
        if commercial_effort.is_source(frozen["source"]) else set(frozen["source"]["effort"]))
    previous_pairs = {(row["workId"], row["phaseId"]): Decimal(row["hours"])
        for row in previous["preview"]["document"].get("effort", {}).get("allocations", [])} if previous else {}
    for row in document["effort"]["allocations"]:
        if row["phaseId"] not in original_phases and Decimal(row["hours"]) > previous_pairs.get((row["workId"], row["phaseId"]), ZERO):
            fail("Retain or reduce earlier phase attributions; assign new work to the current original phases.")
    peers = defaultdict(lambda: ZERO)
    for row in frozen["otherAllocations"]:
        for item in row["allocations"]:
            peers[item["workId"]] += Decimal(item["hours"])
    for ident, amount in selected.items():
        record = records[ident]
        capacity = ZERO if record["state"] == "VOID" else Decimal(record["hours"])
        if amount + peers[ident] > capacity and amount > old.get(ident, ZERO):
            fail("Attributed hours for " + ident + " exceed its current original Work quantity. "
                 "Reduce the existing attribution before adding hours.", "WORK_HOURS_OVERALLOCATED", 409)


def phase_source(source, document):
    if commercial_effort.is_source(source):
        return commercial_effort.phase_source(source, document)
    checks = {row["id"]: row for row in document["checks"]}
    links = {row["phaseId"]: row["checkId"] for row in document["workshare"]["phaseChecks"]}
    phases = []
    for phase in source["plan"]["phases"]:
        check = checks[links[phase["id"]]]
        phases.append({"phaseId": phase["id"], "title": phase["title"], "quotedHours": source["effort"][phase["id"]],
            "owner": deepcopy(phase.get("owner", "")), "dependsOn": list(phase["depends_on"]),
            "businessDays": phase.get("business_days"), "terms": deepcopy(phase),
            "checkId": check["id"], "checkState": check["state"], "checkOperator": check["operator"],
            "checkObservedAt": check["observedAt"]})
    return {"caseId": source["caseId"], "planSha256": source["planSha256"], "title": source["plan"]["title"],
            "customer": deepcopy(source["plan"].get("customer")), "quotedHours": source["hours"],
            "sourceId": source["sourceId"], "sourceSha256": source["sourceSha256"],
            "plan": deepcopy(source["plan"]), "phases": phases}


def review_basis(source, document, phase_id, work, quoted_hours=None):
    selected = []
    for row in document["effort"]["allocations"]:
        if row["phaseId"] == phase_id:
            record = work[row["workId"]]
            selected.append({"workId": row["workId"], "hours": row["hours"],
                "selectedWorkContentSha256": row["workContentSha256"],
                "currentWorkContentSha256": content_identity(record), "void": record["state"] == "VOID"})
    if commercial_effort.is_source(source):
        return commercial_effort.review_basis(source, document, phase_id, sorted(selected, key=lambda item: item["workId"]))
    return digest({"schema": SCHEMA, "caseId": source["caseId"], "planSha256": source["planSha256"],
        "phaseId": phase_id, "quotedHours": source["effort"].get(phase_id, quoted_hours), "asOfDate": document["effort"]["asOfDate"],
        "allocations": sorted(selected, key=lambda item: item["workId"])})


def allocation_balance(context, document, peers):
    work = {row["id"]: row for row in context["records"]["work"]}
    contributors = {row["id"]: row for row in context["records"]["contributors"]}
    selected = sums(document)
    other = defaultdict(lambda: ZERO)
    for peer in peers:
        for row in peer["allocations"]:
            other[row["workId"]] += Decimal(row["hours"])
    result = []
    for ident in sorted(claimed_work(document)):
        row = work[ident]
        capacity = ZERO if row["state"] == "VOID" else Decimal(row["hours"])
        total = selected[ident] + other[ident]
        result.append({**deepcopy(row), "workId": ident, "workContentSha256": content_identity(row),
            "contributorName": contributors[row["contributorId"]]["name"],
            "selectedAllocatedHours": hours(selected[ident]), "otherAllocatedHours": hours(other[ident]),
            "totalAllocatedHours": hours(total), "unallocatedHours": hours(max(ZERO, capacity - total)),
            "overallocatedHours": hours(max(ZERO, total - capacity)),
            "sourceChangedAllocationCount": sum(item["workId"] == ident and item["workContentSha256"] != content_identity(row)
                for item in document["effort"]["allocations"])})
    return result


def support_report(frozen, document, work, phase_rows):
    if commercial_effort.is_source(frozen["source"]):
        return []
    source = frozen["source"]
    support_sources = {row["planSha256"]: row for row in frozen["supportSources"]}
    retired = {row["phaseId"]: row for row in frozen["retiredPhases"]}
    as_of = document["effort"]["asOfDate"]
    checks = {row["id"]: row for row in document["checks"]}
    bindings = {row["phaseId"]: row["checkId"] for row in document["workshare"]["phaseChecks"]}
    phases = {row["phaseId"]: row for row in phase_rows}
    result = []
    for window in document["effort"]["supportWindows"]:
        check_id = bindings.get(window["anchorPhaseId"])
        check = checks[check_id] if check_id else retired[window["anchorPhaseId"]]["check"]
        selected_source = support_sources[window["sourcePlanSha256"]]
        observed = check["observedAt"] if check["state"] == "ACCEPTED" else None
        start = original_day(observed) if observed else None
        finish = (date.fromisoformat(start) + timedelta(days=window["calendarDays"])).isoformat() if start else None
        state = "AWAITING_ORIGINAL_ACCEPTANCE" if start is None else ("NOT_STARTED" if as_of < start else
                "EXPIRED" if as_of > finish else "ACTIVE")
        attribution = []
        within = before = after = overlapping = unknown = ZERO
        for row in document["effort"]["allocations"]:
            if row["phaseId"] not in window["phaseIds"]:
                continue
            record, quantity = work[row["workId"]], Decimal(row["hours"])
            if record["state"] == "VOID":
                classification = "VOID"
            elif start is None:
                classification = "AWAITING_ANCHOR"; unknown += quantity
            elif record["endDate"] < start:
                classification = "BEFORE_WINDOW"; before += quantity
            elif record["startDate"] > finish:
                classification = "AFTER_WINDOW"; after += quantity
            elif record["startDate"] >= start and record["endDate"] <= finish:
                classification = "WITHIN_WINDOW"; within += quantity
            else:
                classification = "SPANS_WINDOW_BOUNDARY"; overlapping += quantity
            attribution.append({"workId": row["workId"], "phaseId": row["phaseId"], "hours": row["hours"],
                "state": record["state"], "startDate": record["startDate"], "endDate": record["endDate"],
                "classification": classification,
                "sourceChanged": row["workContentSha256"] != content_identity(record)})
        selected = [phases[ident] for ident in window["phaseIds"]]
        recorded = sum((Decimal(row["recordedHours"]) for row in selected), ZERO)
        accepted = sum((Decimal(row["acceptedHours"]) for row in selected), ZERO)
        remaining = (sum((Decimal(row["remainingHours"]) for row in selected), ZERO)
                     if all(row["remainingReviewCurrent"] for row in selected) else None)
        included = Decimal(window["includedHours"])
        result.append({**deepcopy(window), "status": state,
            "sourceTerms": [{"path": path, "value": pointer(selected_source["plan"], path)} for path in window["sourcePaths"]],
            "sourceCurrent": window["sourcePlanSha256"] == source["planSha256"],
            "anchor": {"phaseId": window["anchorPhaseId"], "checkId": check["id"], "kind": window["anchorKind"],
                "checkState": check["state"], "operator": check["operator"], "observedAt": observed,
                "startDate": start, "dateBasis": "ORIGINAL_OBSERVATION_CIVIL_DATE"},
            "windowEndDate": finish, "daysRemaining": (date.fromisoformat(finish) - date.fromisoformat(as_of)).days if finish else None,
            "recordedHours": hours(recorded), "acceptedHours": hours(accepted),
            "includedHoursBalance": hours(max(ZERO, included - recorded)),
            "recordedOverrunHours": hours(max(ZERO, recorded - included)),
            "reviewedRemainingHours": None if remaining is None else hours(remaining),
            "projectedOverrunHours": None if remaining is None else hours(max(ZERO, recorded + remaining - included)),
            "withinWindowAttributedHours": hours(within), "beforeWindowAttributedHours": hours(before),
            "afterWindowAttributedHours": hours(after), "boundarySpanningAttributedHours": hours(overlapping),
            "unanchoredAttributedHours": hours(unknown), "attributions": attribution})
    return result


def report(snapshot, document):
    if "effort" not in document:
        return None
    frozen = snapshot[SNAPSHOT_KEY]
    source, effort = frozen["source"], document["effort"]
    unit = "task" if commercial_effort.is_source(source) else "phase"
    work = {row["id"]: row for row in snapshot["records"]["work"]}
    original = phase_source(source, document)
    for retired in frozen["retiredPhases"]:
        if commercial_effort.is_source(source):
            original["phases"].append(commercial_effort.retired_phase(retired))
            continue
        phase, check = retired["terms"], retired["check"]
        original["phases"].append({"phaseId": retired["phaseId"], "title": retired["title"],
            "quotedHours": retired["quotedHours"], "owner": deepcopy(phase.get("owner", "")),
            "dependsOn": list(phase["depends_on"]), "businessDays": phase.get("business_days"),
            "terms": deepcopy(phase), "checkId": check["id"], "checkState": check["state"],
            "checkOperator": check["operator"], "checkObservedAt": check["observedAt"],
            "retired": True, "originalPlanSha256": retired["planSha256"]})
    reviews = {row["phaseId"]: row for row in effort["reviews"]}
    findings, phase_rows = [], []
    def issue(code, field, message, planning=False):
        findings.append({"code": code, "field": field, "message": message, "preventsPlanning": planning})
    balances = allocation_balance(snapshot, document, frozen["otherAllocations"])
    for row in balances:
        if Decimal(row["overallocatedHours"]) > ZERO:
            issue("WORK_HOURS_OVERALLOCATED", "work." + row["workId"],
                  row["description"] + ": current Installation claims exceed the corrected original Work quantity by "
                  + row["overallocatedHours"] + " hours.", True)
    for phase in original["phases"]:
        ident, totals = phase["phaseId"], defaultdict(lambda: ZERO)
        allocations = []
        for row in effort["allocations"]:
            if row["phaseId"] != ident:
                continue
            record, quantity = work[row["workId"]], Decimal(row["hours"])
            totals["allocatedHours"] += quantity
            changed = content_identity(record) != row["workContentSha256"]
            if changed:
                totals["sourceChangedHours"] += quantity
                issue("WORK_CONTENT_CHANGED", "allocations." + row["workId"] + "." + ident,
                      "Review the corrected original Work content before retaining this attribution.", True)
            if record["state"] == "VOID":
                totals["voidHours"] += quantity
                issue("WORK_VOID", "allocations." + row["workId"] + "." + ident,
                      "The original Work is void. Its saved attribution remains visible until explicitly removed.", True)
            elif record["endDate"] <= effort["asOfDate"]:
                totals["recordedHours"] += quantity
                if record["state"] == "ACCEPTED":
                    totals["acceptedHours"] += quantity
            elif record["startDate"] > effort["asOfDate"]:
                totals["afterAsOfHours"] += quantity
                issue("WORK_AFTER_AS_OF", "allocations." + row["workId"] + "." + ident,
                      "This original Work span follows the effort as-of date.", True)
            else:
                totals["spansAsOfHours"] += quantity
                issue("WORK_SPANS_AS_OF", "allocations." + row["workId"] + "." + ident,
                      "This Work span crosses the as-of date; its hours cannot be prorated from a total.", True)
            allocations.append({**deepcopy(row), "currentWorkContentSha256": content_identity(record),
                "sourceChanged": changed, "workState": record["state"], "startDate": record["startDate"],
                "endDate": record["endDate"], "description": record["description"],
                "contributorId": record["contributorId"], "fundingBasis": record["fundingBasis"], "costId": record["costId"]})
        basis = review_basis(source, document, ident, work, phase["quotedHours"])
        review = reviews.get(ident, {"phaseId": ident, "remainingHours": None, "reviewedBy": "", "reviewedAt": None,
            "basisSha256": "", "note": "", "sourceIds": []})
        reviewed = (not phase.get("retired") and review["remainingHours"] is not None and review["basisSha256"] == basis
                    and original_day(review["reviewedAt"]) <= effort["asOfDate"])
        if phase.get("retired"):
            issue("ORIGINAL_PHASE_REPLACED", "phases." + ident,
                  "This earlier " + unit + " remains in source history. Reassign or remove its current attributed quantities and review the new scope.",
                  bool(allocations))
        elif not reviewed:
            issue("REMAINING_REVIEW_REQUIRED", "reviews." + ident,
                  "Enter and review the actual remaining estimate against the current original " + unit + " and Work.", True)
        quoted = None if phase["quotedHours"] is None else Decimal(phase["quotedHours"])
        recorded = totals["recordedHours"]
        projected = recorded + Decimal(review["remainingHours"]) if reviewed else None
        phase_rows.append({**phase, **{key: hours(totals[key]) for key in
            ("allocatedHours", "recordedHours", "acceptedHours", "voidHours", "sourceChangedHours", "afterAsOfHours", "spansAsOfHours")},
            "quoteBalanceHours": None if quoted is None else hours(max(ZERO, quoted - recorded)),
            "recordedOverrunHours": None if quoted is None else hours(max(ZERO, recorded - quoted)),
            "remainingHours": review["remainingHours"], "remainingReviewCurrent": reviewed,
            "reviewBasisSha256": basis, "review": deepcopy(review),
            "projectedTotalHours": None if projected is None else hours(projected),
            "projectedOverrunHours": None if projected is None or quoted is None else hours(max(ZERO, projected - quoted)),
            "allocations": allocations})
    supports = support_report(frozen, document, work, phase_rows)
    for window in supports:
        if not window["sourceCurrent"]:
            issue("SUPPORT_SOURCE_CHANGED", "supportWindows." + window["id"],
                  "Review the support window against the current Workshare source; its original selected terms remain retained.", True)
        if any(Decimal(window[key]) > ZERO for key in ("beforeWindowAttributedHours", "afterWindowAttributedHours", "boundarySpanningAttributedHours")):
            issue("SUPPORT_WINDOW_ATTRIBUTION", "supportWindows." + window["id"],
                  "Review the original Work spans outside or crossing this support window.")
        if Decimal(window["recordedOverrunHours"]) > ZERO:
            issue("SUPPORT_HOURS_OVERRUN", "supportWindows." + window["id"],
                  "Attributed recorded support exceeds the original included allowance.")
        if window["status"] == "EXPIRED" and window["reviewedRemainingHours"] is not None and Decimal(window["reviewedRemainingHours"]) > ZERO:
            issue("SUPPORT_REMAINS_AFTER_WINDOW", "supportWindows." + window["id"],
                  "The reviewed remaining support continues after the original support window.")
        if original_day(window["reviewedAt"]) > effort["asOfDate"]:
            issue("SUPPORT_TERMS_AFTER_AS_OF", "supportWindows." + window["id"],
                  "The support term review follows this as-of date.")
    summary = {key: (None if key == "quotedHours" and commercial_effort.is_source(source)
        else hours(sum((Decimal(row[key]) for row in phase_rows), ZERO))) for key in
        ("quotedHours", "allocatedHours", "recordedHours", "acceptedHours", "voidHours", "sourceChangedHours", "afterAsOfHours", "spansAsOfHours")}
    summary["quotedHours"] = None if commercial_effort.is_source(source) else hours(source["hours"])
    summary["unallocatedSelectedWorkHours"] = hours(sum((Decimal(row["unallocatedHours"]) for row in balances), ZERO))
    summary["overallocatedWorkHours"] = hours(sum((Decimal(row["overallocatedHours"]) for row in balances), ZERO))
    current_phases = [row for row in phase_rows if not row.get("retired")]
    summary["reviewedPhases"] = sum(row["remainingReviewCurrent"] for row in current_phases)
    summary["totalPhases"] = len(current_phases)
    summary["retiredPhases"] = len(phase_rows) - len(current_phases)
    all_reviewed = all(row["remainingReviewCurrent"] for row in current_phases)
    summary["reviewedRemainingHours"] = hours(sum((Decimal(row["remainingHours"]) for row in current_phases), ZERO)) if all_reviewed else None
    summary["projectedTotalHours"] = hours(Decimal(summary["recordedHours"]) + Decimal(summary["reviewedRemainingHours"])) if all_reviewed else None
    summary["projectedOverrunHours"] = hours(max(ZERO, Decimal(summary["projectedTotalHours"]) - Decimal(summary["quotedHours"]))) if all_reviewed and summary["quotedHours"] is not None else None
    ready = not any(row["preventsPlanning"] for row in findings)
    result = {"schema": SCHEMA, "asOfDate": effort["asOfDate"], "status": "READY" if ready else "REVIEW_REQUIRED",
        "readyForPlanning": ready, "summary": summary, "phases": phase_rows, "work": balances,
        "supportWindows": supports, "findings": findings}
    if commercial_effort.is_source(source):
        result.update(commercial_effort.report_identity(source))
    result["reportSha256"] = digest(result)
    return result


def inventory(context, document, heads, installation_id):
    work = context["records"]["work"]
    contributors = {row["id"]: row for row in context["records"]["contributors"]}
    selected = sums(document)
    claims = defaultdict(list)
    for head in heads:
        if head["id"] == installation_id:
            continue
        for row in head["preview"]["document"].get("effort", {}).get("allocations", []):
            claims[row["workId"]].append({"installationId": head["id"], "installationRevision": head["revision"],
                "installationSha256": head["sha256"], "name": head["preview"]["document"]["name"], **deepcopy(row)})
    result = []
    for record in sorted(work, key=lambda row: (row["endDate"], row["id"]), reverse=True):
        ident, peers = record["id"], claims[record["id"]]
        other = sum((Decimal(row["hours"]) for row in peers), ZERO)
        total = selected[ident] + other
        capacity = ZERO if record["state"] == "VOID" else Decimal(record["hours"])
        result.append({**deepcopy(record), "workId": ident, "workContentSha256": content_identity(record),
            "contributorName": contributors[record["contributorId"]]["name"],
            "selectedAllocatedHours": hours(selected[ident]), "otherAllocatedHours": hours(other),
            "totalAllocatedHours": hours(total), "unallocatedHours": hours(max(ZERO, capacity - total)),
            "overallocatedHours": hours(max(ZERO, total - capacity)), "allocations": peers})
    return result


def seed(operations, context, body):
    import operations_installations as installations
    import operations_workshare_installations as workshares
    obj(body, ("expectedVersion", "installationId", "expectedRevision", "asOfDate", "document"), "Installation effort seed")
    installations._current(context, body.get("expectedVersion"))
    row = installations.get(operations, context["program"]["id"], body.get("installationId"))
    if row["revision"] != installations.revision(body.get("expectedRevision")):
        fail("Reopen the current original Installation edition.", "INSTALLATION_CONFLICT", 409)
    document = deepcopy(body.get("document", row["preview"]["document"]))
    as_of = domain.calendar(body.get("asOfDate"), "Effort as-of date")
    if "effort" not in document:
        document["effort"] = {"schema": SCHEMA, "asOfDate": as_of, "allocations": [], "reviews": [],
                              "supportWindows": [], "note": ""}
    else:
        document["effort"]["asOfDate"] = as_of
    # Original normalization retains existing attribution and review digests.
    candidate = installations.preview(operations, context, {"expectedVersion": context["program"]["version"],
        "installationId": row["id"], "expectedRevision": row["revision"], "document": document})
    heads = installations.load_heads(operations, context["program"]["id"])
    source = candidate["snapshot"][SNAPSHOT_KEY]["source"]
    return {"schema": SCHEMA, "source": installations._source(context), "installationId": row["id"],
        "expectedRevision": row["revision"], "document": candidate["document"],
        "phaseSource": phase_source(source, candidate["document"]),
        "workInventory": inventory(context, candidate["document"], heads, row["id"]),
        "report": candidate["report"], "previewSha256": candidate["previewSha256"]}


def validate_frozen(context, row, rows, events, original):
    """Join the frozen attribution context to heads at its original save time."""
    candidate = row["preview"]
    snapshot, document = candidate["snapshot"], candidate["document"]
    if "effort" not in document:
        if SNAPSHOT_KEY in snapshot:
            fail("An effort snapshot requires its original Installation inputs.")
        return
    frozen = snapshot.get(SNAPSHOT_KEY)
    if not isinstance(frozen, dict) or set(frozen) != {"schema", "installationId", "source", "otherAllocations", "retiredPhases", "supportSources"}:
        fail("Retain the complete original Installation effort snapshot.")
    expected_source = source_value(original, document)
    if frozen["schema"] != SCHEMA or frozen["installationId"] != candidate["installationId"] or frozen["source"] != expected_source:
        fail("The saved effort source differs from its complete original commissioning source.")
    previous = next((item for item in rows if item["id"] == row["id"] and item["revision"] == row["revision"] - 1), None)
    retired, support_sources = retained_source_context(expected_source, document, previous)
    if frozen["retiredPhases"] != retired or frozen["supportSources"] != support_sources:
        fail("Retain the exact earlier phase and support sources from this Installation history.")
    validate_terms(frozen, document)
    expected_peers = peer_projection(rows, row["id"], claimed_work(document), snapshot["program"]["version"])
    if frozen["otherAllocations"] != expected_peers:
        fail("The saved attribution must retain the exact other Installation heads at its original save version.")
    check_quantities(snapshot, document, frozen, previous)


def selection(operations, context, body):
    import operations_installations as installations
    import portfolio_installations as phase_plans
    import portfolio as portfolios
    import forecast as forecasts
    obj(body, ("expectedVersion", "forecastId", "installationSelections", "name", "note"), "Installation effort forecast selection")
    installations._current(context, body.get("expectedVersion"))
    saved = operations._portfolio_forecast(context["program"]["id"], body.get("forecastId"))
    forecasts.validate_saved(saved, context["plan"])
    selections = rows(body.get("installationSelections"), "Reviewed Installation selections", 100)
    if not selections:
        fail("Select at least one original saved effort edition.")
    references, tasks, values = [], set(), []
    inputs = deepcopy(saved["inputs"])
    commercial = {row["id"]: row for row in inputs["commercial"]}
    for item in selections:
        obj(item, ("taskId", "installationId", "installationRevision", "installationSha256"), "saved effort selection")
        task = label(item.get("taskId"), "Original commercial task", 150, True)
        if not task.startswith("commercial/") or task in tasks:
            fail("Select each original commercial task once.")
        tasks.add(task)
        ref = phase_plans.ref(item)
        if any(value["installationId"] == ref["installationId"] for value in references):
            fail("Select each saved Installation once.")
        row = installations.get(operations, context["program"]["id"], ref["installationId"])
        if phase_plans.row_ref(row) != ref:
            fail("Reopen the selected current effort edition.", "INSTALLATION_CONFLICT", 409)
        document = row["preview"]["document"]
        if "effort" not in document:
            fail("Save the reviewed original phase effort before its planning handover.")
        if document["effort"]["asOfDate"] != inputs["asOfDate"]:
            fail("Use the same retained as-of date for the reviewed effort and original Forecast.")
        current = installations.preview(operations, context, {"expectedVersion": context["program"]["version"],
            "installationId": row["id"], "expectedRevision": row["revision"], "document": document})
        observed = current["report"]["effort"]
        if not observed["readyForPlanning"]:
            fail("Resolve current original Work attribution and remaining-estimate reviews before handing over this effort.",
                 "EFFORT_REVIEW_REQUIRED", 409)
        old = row["preview"]["report"]["effort"]
        if observed != old:
            fail("Save a new effort edition for the current original Work and support observations before planning.",
                 "EFFORT_SOURCE_CHANGED", 409)
        if commercial_effort.selected(document):
            fail("Use the complete commercial effort handoff to the matching original quotation assessment. This Forecast selection binds an original Workshare commercial row.")
        binding = document["workshare"]
        target = commercial.get(task[len("commercial/"):])
        hashes = {context["sources"][ident]["sha256"] for ident in target.get("sourceIds", [])} if target else set()
        if (target is None or target.get("caseRef") != binding["caseId"]
                or binding["sourceId"] not in target.get("sourceIds", []) and binding["sourceSha256"] not in hashes):
            fail("Match the exact original commercial case and complete commissioning source.")
        previous = target["remainingHours"]
        target["remainingHours"] = observed["summary"]["reviewedRemainingHours"]
        detail = {"taskId": task, **ref, "caseId": binding["caseId"], "planSha256": binding["planSha256"],
            "effortReportSha256": observed["reportSha256"], "asOfDate": document["effort"]["asOfDate"],
            "originalRemainingHours": previous, "remainingHours": target["remainingHours"],
            "phases": [{"phaseId": phase["phaseId"], "remainingHours": phase["remainingHours"],
                "reviewBasisSha256": phase["reviewBasisSha256"], "review": phase["review"]} for phase in observed["phases"] if not phase.get("retired")]}
        target["note"] = label(target.get("note", "") + "\nReviewed original Installation effort "
            + row["id"] + " edition " + str(row["revision"]) + ". " + document["effort"]["note"],
            "Complete commercial estimate basis", 12000)
        references.append(ref); values.append(detail)
    inputs["name"] = label(body.get("name") or "Reviewed delivery effort — " + inputs["name"], "Forecast name", 300, True)
    inputs["note"] = label(inputs.get("note", "") + "\n" + label(body.get("note"), "Effort handover reason", 12000),
                           "Complete Forecast basis", 12000)
    inputs = forecasts.normalize(context, inputs)
    selected = {"schema": SCHEMA + ".selection", "forecastId": saved["id"], "forecastSha256": saved["sha256"],
                "installationSelections": [{**value, "taskId": row["taskId"]} for value, row in zip(references, values)],
                "effort": values}
    selected["sha256"] = digest(selected)
    return {"source": installations._source(context), "inputs": inputs, "selection": selected}


def html_section(snapshot, document):
    if "effort" not in document:
        return ""
    value = report(snapshot, document)
    e = lambda item: escape(str(item if item is not None else "Unentered"), quote=True)
    def table(headings, rows):
        return "<div class=\"table\"><table><thead><tr>" + "".join("<th>" + e(item) + "</th>" for item in headings) +             "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(item) + "</td>" for item in row) +             "</tr>" for row in rows) + "</tbody></table></div>"
    if value.get("sourceKind") == commercial_effort.SOURCE_KIND:
        body = "<h2>Original accepted tasks and delivery effort</h2><p>As of " + e(value["asOfDate"]) + ". Quoted task effort is unspecified. Original recorded Work, internal Work acceptance and reviewed remaining estimates retain separate meanings.</p>"
        body += table(["Original commercial selection", "Retained identity"],
            [[key, item] for key, item in value["commercial"].items()])
        body += table(["Task", "Allocated", "Recorded", "Internally accepted", "Reviewed remaining", "Projected total", "Review"],
            [[row["title"], row["allocatedHours"], row["recordedHours"], row["acceptedHours"],
              row["remainingHours"], row["projectedTotalHours"],
              "Retained earlier task" if row.get("retired") else "Current" if row["remainingReviewCurrent"] else "Review required"]
             for row in value["phases"]])
        summary = value["summary"]
        body += table(["Complete Installation effort", "Hours"],
            [[key, summary[key]] for key in ("allocatedHours", "recordedHours", "acceptedHours",
                "reviewedRemainingHours", "projectedTotalHours", "unallocatedSelectedWorkHours", "overallocatedWorkHours")])
        for row in value["phases"]:
            body += "<details><summary>" + e(row["title"]) + " — original task and check</summary>"
            body += table(["Original task selection", "Retained value"],
                [[key, row.get(key)] for key in ("taskId", "definitionSha256", "checkId", "checkState",
                    "checkOperator", "checkObservedAt")])
            if row.get("retired"):
                body += table(["Original earlier source", "Retained identity"],
                    [[key, item] for key, item in row["originalCommercial"].items()])
            body += "<pre>" + e(canonical(row["terms"])) + "</pre></details>"
    else:
        body = "<h2>Original phase work and remaining effort</h2><p>As of " + e(value["asOfDate"]) +         ". Original recorded Work is attributed once across current Installations. Acceptance of a customer step and internal acceptance of Work retain their own observations.</p>"
        body += table(["Phase", "Quoted hours", "Recorded", "Internally accepted", "Reviewed remaining", "Projected overrun", "Review"],
            [[row["title"], row["quotedHours"], row["recordedHours"], row["acceptedHours"], row["remainingHours"],
              row["projectedOverrunHours"], "Current" if row["remainingReviewCurrent"] else "Review required"] for row in value["phases"]])
    body += table(["Original Work", "Original hours", "This Installation", "Other Installations", "Unassigned", "Overallocated"],
        [[row["description"], row["hours"], row["selectedAllocatedHours"], row["otherAllocatedHours"],
          row["unallocatedHours"], row["overallocatedHours"]] for row in value["work"]])
    if value["supportWindows"]:
        body += "<h3>Original included support</h3><p>Window dates retain the civil date of the original accepted phase observation. A Work span crossing a boundary remains an explicit whole-span attribution.</p>"
        body += table(["Allowance", "Included hours", "Recorded", "Remaining allowance", "Reviewed effort", "Actual anchor", "Window end", "State"],
            [[row["id"], row["includedHours"], row["recordedHours"], row["includedHoursBalance"], row["reviewedRemainingHours"],
              row["anchor"]["startDate"], row["windowEndDate"], row["status"]] for row in value["supportWindows"]])
    if value["findings"]:
        body += "<h3>Delivery effort review</h3><ul>" + "".join("<li>" + e(row["message"]) + "</li>" for row in value["findings"]) + "</ul>"
    return body


def selected_files(row):
    if "effort" not in row["preview"]["document"]:
        return {}
    value = report(row["preview"]["snapshot"], row["preview"]["document"])
    return {"installation-effort.json": (canonical(value) + "\n").encode("utf-8")}
