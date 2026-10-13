"""Join complete original recurring customer work to saved Installation editions."""
from __future__ import annotations

from copy import deepcopy
from html import escape
import hashlib

from model import Problem, digest
import operations_domain as domain
from operations_workflow_source import read_bundle, period_summary, identity

SCHEMA = "stellar-forge.sf47-workflow-installation.v1"
SOURCE_FIELDS = ("sourceId", "expectedSourceSha256")
PERIOD_FIELDS = ("cycleId", "checkId", "seriesId", "seriesRevision", "runId", "period",
                 "recordedState", "runRevision", "completedAt", "deliveryIds", "customerFiles",
                 "customerBytes", "completedSteps", "stepCount", "recoveredSteps", "basisSha256")


def fail(message, code="INVALID_WORKFLOW_INSTALLATION", status=422):
    raise Problem(message, status, code)


def exact(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail("Use the original " + label + " fields.")
    return value


def source_selection(context, value):
    ident = value.get("sourceId")
    domain.reference_list([ident], context["sources"], "Original recurring-work source")
    expected = domain.sha(value.get("expectedSourceSha256"), "Original recurring-work source", False)
    if context["sources"][ident]["sha256"] != expected:
        fail("The selected complete recurring-work source changed.", "WORKFLOW_SOURCE_CONFLICT", 409)
    return {"sourceId": ident, "expectedSourceSha256": expected}


def read_source(operations, context, selection, reader=None):
    selected = source_selection(context, selection)
    read = reader or (lambda ident: operations.source(context["program"]["id"], ident)[1])
    raw = read(selected["sourceId"])
    metadata = context["sources"][selected["sourceId"]]
    if (not isinstance(raw, bytes) or len(raw) != metadata["bytes"]
            or hashlib.sha256(raw).hexdigest() != metadata["sha256"]):
        fail("Receive every original byte of the selected customer operating source.")
    return {"selection": selected, **read_bundle(raw)}


def check_id(profile_id, cycle_id):
    return "period-" + hashlib.sha256((profile_id + "\0" + cycle_id).encode()).hexdigest()[:32]


def binding_period(profile_id, original):
    value = period_summary(original)
    result = {key: deepcopy(value[key]) for key in ("cycleId", "seriesId", "seriesRevision", "runId",
              "period", "runRevision", "completedAt", "deliveryIds", "customerFiles", "customerBytes",
              "completedSteps", "stepCount", "recoveredSteps", "basisSha256")}
    result.update({"checkId": check_id(profile_id, value["cycleId"]), "recordedState": value["state"]})
    return result


def normalize_binding(context, value):
    exact(value, ("schema", "sourceId", "sourceSha256", "profileId", "periods"), "recurring-work binding")
    if value.get("schema") != SCHEMA:
        fail("Select the original native recurring-work binding.")
    selected = source_selection(context, {"sourceId": value.get("sourceId"),
                                         "expectedSourceSha256": value.get("sourceSha256")})
    profile_id = identity(value.get("profileId"), "profile")
    periods = value.get("periods")
    if not isinstance(periods, list) or not 1 <= len(periods) <= 100:
        fail("Retain each selected complete customer period.")
    seen, normalized = set(), []
    for row in periods:
        if not isinstance(row, dict) or set(row) != set(PERIOD_FIELDS):
            fail("Keep the complete original recorded period selection.")
        cycle_id = identity(row["cycleId"], "cycle")
        identity(row["seriesId"], "series"); identity(row["runId"], "run")
        if cycle_id in seen or row["checkId"] != check_id(profile_id, cycle_id):
            fail("Keep each recurring acceptance step attached to its original cycle once.")
        seen.add(cycle_id)
        domain.sha(row["basisSha256"], "Selected original period", False)
        for key in ("seriesRevision",):
            domain.integer(row[key], "Original series edition", 1, 10000000)
        if row["runRevision"] is not None:
            domain.integer(row["runRevision"], "Original native run revision", 1, 10000000)
        for key in ("customerFiles", "customerBytes", "completedSteps", "stepCount", "recoveredSteps"):
            domain.integer(row[key], "Original " + key, 0, 2147483647)
        exact(row["period"], ("start", "end"), "period dates")
        for key in ("start", "end"):
            domain.calendar(row["period"].get(key), "Original period " + key)
        if row["period"]["start"] > row["period"]["end"]:
            fail("Retain the original customer period order.")
        if not isinstance(row["recordedState"], str) or not row["recordedState"]:
            fail("Retain the recorded native run state.")
        if row["completedAt"] is not None:
            domain.timestamp(row["completedAt"], "Original run completion time")
        ids = row["deliveryIds"]
        if not isinstance(ids, list) or len(ids) > 1000 or len(set(ids)) != len(ids):
            fail("Keep the explicitly selected original customer delivery identities.")
        for ident in ids:
            identity(ident, "customer delivery")
        normalized.append(deepcopy(row))
    return {"schema": SCHEMA, "sourceId": selected["sourceId"],
            "sourceSha256": selected["expectedSourceSha256"], "profileId": profile_id, "periods": normalized}


def title_and_criterion(original):
    cycle, series = original["cycle"], original["series"]
    request = cycle["request"]
    title = str(series["name"]) + " · " + str(request["label"])
    criterion = ("Review the complete original customer task for cycle " + cycle["id"] +
        ", period " + request["period"]["start"] + " to " + request["period"]["end"] +
        ", native run " + cycle["runId"] + ". Confirm its useful result in the receiving application. " +
        ("Review every complete file in the explicitly selected customer deliveries." if original["customers"] else
         "Review the complete original native results; this period selects no separate customer file delivery."))
    return title, criterion


def verify_document(operations, context, document, reader=None):
    if "workflowPeriods" not in document:
        return None
    binding = normalize_binding(context, document["workflowPeriods"])
    original = read_source(operations, context, {"sourceId": binding["sourceId"],
                           "expectedSourceSha256": binding["sourceSha256"]}, reader)
    if original["manifest"]["profileId"] != binding["profileId"]:
        fail("Keep this Installation attached to the selected original customer profile.", "WORKFLOW_PROFILE_CONFLICT", 409)
    available = {value["cycle"]["id"]: value for value in original["periods"]}
    checks = {row["id"]: row for row in document["checks"]}
    selected = []
    for row in binding["periods"]:
        value = available.get(row["cycleId"])
        if value is None or binding_period(binding["profileId"], value) != row:
            fail("The saved period differs from its complete original source and selection.", "WORKFLOW_PERIOD_CONFLICT", 409)
        check = checks.get(row["checkId"])
        title, criterion = title_and_criterion(value)
        if (check is None or check["title"] != title or check["criterion"] != criterion
                or check["required"] is not True or binding["sourceId"] not in check["sourceIds"]):
            fail("Keep the native recurring acceptance step, full criterion and original source.")
        if check["state"] == "ACCEPTED" and row["recordedState"] != "COMPLETE":
            fail("Retain this period's native completion before recording its complete-result acceptance. "
                 "The current run and correction stay visible in the source.", "WORKFLOW_RESULT_INCOMPLETE", 409)
        selected.append(value)
    return {**original, "binding": binding, "selectedPeriods": selected}


def verify_transition(operations, context, previous, document, reader=None, original=None):
    if previous is None:
        return
    before = previous["preview"]["document"]
    old = before.get("workflowPeriods")
    if old is None:
        return
    binding = document.get("workflowPeriods")
    if binding is None or binding["profileId"] != old["profileId"]:
        fail("Keep this Installation attached to its original customer profile; use a separate Installation "
             "for another customer.", "WORKFLOW_PROFILE_CONFLICT", 409)
    old_periods = {row["cycleId"]: row for row in old["periods"]}
    periods = {row["cycleId"]: row for row in binding["periods"]}
    if not old_periods.keys() <= periods.keys():
        fail("Retain earlier selected customer periods when appending a later operating edition.",
             "WORKFLOW_PERIOD_HISTORY", 409)
    old_checks = {row["id"]: row for row in before["checks"]}
    checks = {row["id"]: row for row in document["checks"]}
    for key, row in periods.items():
        earlier = old_periods.get(key)
        if earlier is None or earlier["basisSha256"] == row["basisSha256"]:
            continue
        old_check, check = old_checks[earlier["checkId"]], checks[row["checkId"]]
        observed = lambda value: {**{field: value[field] for field in ("operator", "observedAt", "note")},
                                  **{field: sorted(value[field]) for field in ("workIds", "purchaseIds", "outcomeIds")}}
        if check["state"] == "ACCEPTED" and observed(check) == observed(old_check):
            fail("This original period, native run or selected customer delivery changed. Record the new "
                 "useful-result observation; its earlier acceptance remains in the preceding edition.",
                 "WORKFLOW_ACCEPTANCE_CONFLICT", 409)


def inventory(operations, context, body):
    exact(body, ("expectedVersion", *SOURCE_FIELDS), "recurring-work source selection")
    from operations_installations import _current, _source
    _current(context, body.get("expectedVersion"))
    original = read_source(operations, context, body)
    return {"schema": SCHEMA, "source": _source(context), "selection": original["selection"],
            "profile": {"id": original["manifest"]["profileId"], "name": original["profile"]["profile"]["name"],
                        "sourceWorkspaceId": original["manifest"]["sourceWorkspaceId"]},
            "periods": [period_summary(value) for value in original["periods"]],
            "sourceFiles": original["manifest"]["files"],
            "otherDeliveries": deepcopy(original["handover"].get("otherDeliveries", []))}


def seed(operations, context, body):
    exact(body, ("expectedVersion", *SOURCE_FIELDS, "cycleIds", "installationId",
                 "expectedRevision", "document"), "customer-period receiving selection")
    import operations_installations as installations
    installations._current(context, body.get("expectedVersion"))
    ident = body.get("installationId")
    number = installations.revision(body.get("expectedRevision", 0), True)
    previous = None
    if ident is not None:
        previous = installations.get(operations, context["program"]["id"], ident)
        if previous["revision"] != number:
            fail("Reopen the current Installation edition before receiving this period.", "INSTALLATION_CONFLICT", 409)
    elif number != 0:
        fail("Use edition zero when preparing a new Installation.")
    original = read_source(operations, context, body)
    profile_id = original["manifest"]["profileId"]
    wanted = body.get("cycleIds")
    if not isinstance(wanted, list) or not wanted or len(wanted) > 100 or len(set(wanted)) != len(wanted):
        fail("Select each complete original customer period once.")
    for key in wanted:
        identity(key, "cycle")
    if body.get("document") is not None:
        document = installations.normalized(context, body["document"])
    elif previous:
        document = deepcopy(previous["preview"]["document"])
    else:
        document = installations.seed(context)
    old = document.get("workflowPeriods")
    saved_document = previous["preview"]["document"] if previous else None
    saved_binding = saved_document.get("workflowPeriods") if saved_document else None
    if any(value and value["profileId"] != profile_id for value in (old, saved_binding)):
        fail("Create a separate Installation for another original customer profile.", "WORKFLOW_PROFILE_CONFLICT", 409)
    if old:
        verify_document(operations, context, document)
    current_periods = {value["cycle"]["id"]: value for value in original["periods"]}
    # A historical edition may be the editable draft. Carry periods which were
    # subsequently saved in the current edition, without replacing the chosen
    # draft's observations for its own periods.
    saved_periods = {} if saved_binding is None else {row["cycleId"]: row for row in saved_binding["periods"]}
    draft_periods = {} if old is None else {row["cycleId"]: row for row in old["periods"]}
    old_periods = {**saved_periods, **draft_periods}
    selected_ids = list(dict.fromkeys([*old_periods, *wanted]))
    if not set(selected_ids) <= current_periods.keys():
        fail("Capture the complete earlier and new periods together before refreshing this Installation.",
             "WORKFLOW_PERIOD_HISTORY", 409)
    old_checks = {row["id"]: row for row in document["checks"]}
    for row in saved_periods.values():
        if row["cycleId"] not in draft_periods:
            saved_check = next(value for value in saved_document["checks"] if value["id"] == row["checkId"])
            if row["checkId"] in old_checks:
                fail("The carried original period acceptance identity collides with another draft check.")
            old_checks[row["checkId"]] = saved_check
    removed = {row["checkId"] for row in old_periods.values()}
    document["checks"] = [row for row in document["checks"] if row["id"] not in removed]
    bound, reset = [], []
    for key in selected_ids:
        value = current_periods[key]
        selected = binding_period(profile_id, value)
        check_key = selected["checkId"]
        if any(row["id"] == check_key for row in document["checks"]):
            fail("The original period acceptance identity collides with another Installation check.")
        existing = old_checks.get(check_key)
        unchanged = old_periods.get(key, {}).get("basisSha256") == selected["basisSha256"]
        if existing is not None and unchanged:
            check = deepcopy(existing)
        else:
            title, criterion = title_and_criterion(value)
            check = {"id": check_key, "title": title, "criterion": criterion, "tranche": None,
                     "required": True, "state": "OPEN", "operator": "", "observedAt": None, "note": "",
                     "sourceIds": [], "workIds": [], "purchaseIds": [], "outcomeIds": []}
            if existing is not None:
                reset.append(key)
        check["sourceIds"] = list(dict.fromkeys([*check["sourceIds"], original["selection"]["sourceId"]]))
        document["checks"].append(check); bound.append(selected)
    document["workflowPeriods"] = {"schema": SCHEMA, "sourceId": original["selection"]["sourceId"],
        "sourceSha256": original["selection"]["expectedSourceSha256"], "profileId": profile_id, "periods": bound}
    if not old and not document.get("workshare"):
        first = current_periods[selected_ids[0]]
        if document["name"] == "Customer installation":
            document["name"] = str(original["profile"]["profile"]["name"]) + " · recurring work"
        if not document["task"]["name"]:
            document["task"]["name"] = str(first["series"]["name"])
        if not document["task"]["request"]:
            document["task"]["request"] = "Complete original requests are retained in the attached Console profile, selected cycles and native reports."
        if not document["task"]["completeOutput"]:
            document["task"]["completeOutput"] = "The original native task has completed and its useful result is reviewed in the receiving application with the selected complete customer files."
        if not document["task"]["repeatTrigger"]:
            document["task"]["repeatTrigger"] = "The next explicitly selected original customer period or changed source edition."
    document["source"]["sourceIds"] = list(dict.fromkeys([*document["source"]["sourceIds"], original["selection"]["sourceId"]]))
    document["receiving"]["sourceIds"] = list(dict.fromkeys([*document["receiving"]["sourceIds"], original["selection"]["sourceId"]]))
    document = installations.normalized(context, document)
    verify_document(operations, context, document)
    return {"schema": SCHEMA, "source": installations._source(context),
            "installationId": ident, "expectedRevision": number, "document": document,
            "workflow": {"profileId": profile_id, "periods": [period_summary(current_periods[key]) for key in selected_ids],
                         "resetCycleIds": reset},
            "sourceChanges": installations.differences(previous["preview"]["document"], document) if previous else []}


def report(document):
    binding = document.get("workflowPeriods")
    if binding is None:
        return None
    checks = {value["id"]: value for value in document["checks"]}
    periods = [{**deepcopy(value), "acceptanceState": checks[value["checkId"]]["state"],
                "observingOperator": checks[value["checkId"]]["operator"],
                "observedAt": checks[value["checkId"]]["observedAt"]}
               for value in binding["periods"]]
    return {"profileId": binding["profileId"], "sourceId": binding["sourceId"],
            "sourceSha256": binding["sourceSha256"], "periods": periods,
            "recordedCompletePeriods": sum(row["recordedState"] == "COMPLETE" for row in periods),
            "acceptedPeriods": sum(row["acceptanceState"] == "ACCEPTED" for row in periods),
            "distinctSelectedDeliveries": len({key for row in periods for key in row["deliveryIds"]})}


def html_section(document):
    value = report(document)
    if value is None:
        return ""
    e = lambda value: escape(str(value if value is not None else "Unentered"), quote=True)
    rows = []
    for row in value["periods"]:
        rows.append("<tr><td>" + e(row["period"]["start"]) + " to " + e(row["period"]["end"]) +
                    "<br>" + e(row["cycleId"]) + "</td><td>" + e(row["runId"]) + "<br>" +
                    e(row["recordedState"]) + " · " + str(row["completedSteps"]) + " / " + str(row["stepCount"]) +
                    "</td><td>" + str(row["customerFiles"]) + " complete selected files<br>" +
                    str(row["customerBytes"]) + " bytes</td><td>" + e(row["acceptanceState"]) +
                    "<br>" + e(row["observingOperator"]) + "<br>" + e(row["observedAt"]) + "</td></tr>")
    return ("<h2>Original customer operating periods</h2><p>Profile " + e(value["profileId"]) +
            ". Each period retains its original run and explicit file selection; the receiving operator's "
            "acceptance belongs to this saved Installation edition.</p><div class=\"table\"><table><thead><tr>"
            "<th>Customer period</th><th>Recorded native run</th><th>Selected customer files</th>"
            "<th>Actual receiving acceptance</th></tr></thead><tbody>" + "".join(rows) +
            "</tbody></table></div><p><a download href=\"sources/" + e(value["sourceId"]) +
            "\">Download the complete original profile, reports and customer files</a></p>")
