"""Saved customer installations in the original SF47 Operations case.

Every edition retains its selected native records and source identities. The
original case owns work, payment, support, acceptance observations and receiving.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from html import escape
import hashlib
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-installation.v1"
SELECTION_SCHEMA = SCHEMA + ".selection"
MAX_INSTALLATIONS = 100
MAX_EDITIONS = 500
MAX_DOCUMENT_BYTES = 128 * 1024
STAGES = ("PLANNED", "COMMISSIONING", "OPERATING", "HANDED_OVER", "RETIRED")
CHECK_STATES = ("OPEN", "IN_PROGRESS", "ACCEPTED", "CHANGES_REQUIRED", "NOT_APPLICABLE")
COLLECTIONS = ("deployments", "contributors", "work", "purchases", "outcomes")


def fail(message, code="INVALID_INSTALLATION", status=422):
    raise Problem(message, status, code)


def object_value(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the declared " + label + " fields.")
    return value


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r"installation-[a-f0-9]{32}", value):
        fail("Select the original installation identity.")
    return value


def revision(value, allow_zero=False):
    return domain.integer(value, "Installation edition", 0 if allow_zero else 1, MAX_EDITIONS)


def short_text(value, label, limit=4000, required=False):
    return text(value if value is not None else "", label, limit, required)


def atomic(value, label):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,29})", value):
        fail(label + ": retain a nonnegative whole atomic amount as decimal text.")
    return value


def install(db):
    db.execute("""
        CREATE TABLE IF NOT EXISTS ops_installations(
            program_id TEXT NOT NULL REFERENCES ops_programs(id),
            installation_id TEXT NOT NULL,revision INTEGER NOT NULL,body_json TEXT NOT NULL,
            PRIMARY KEY(program_id,installation_id,revision))
    """)


def load(operations, program_id):
    return [json.loads(row[0]) for row in operations.db.execute(
        "SELECT body_json FROM ops_installations WHERE program_id=? ORDER BY installation_id,revision",
        (program_id,))]


def summary(row):
    value = row["preview"]
    report = value["report"]
    return {"id": row["id"], "revision": row["revision"], "version": row["version"],
            "sha256": row["sha256"], "name": value["document"]["name"],
            "stage": value["document"]["stage"], "createdAt": row["createdAt"], "actor": row["actor"],
            "merchantDeploymentId": value["document"]["merchantDeploymentId"],
            "buyerDeploymentIds": value["document"]["buyerDeploymentIds"],
            "sourceVersion": value["source"]["version"],
            "configurationComplete": report["configurationComplete"],
            "acceptedChecks": report["acceptedChecks"], "totalChecks": report["totalChecks"],
            "openFindings": len(report["findings"])}


def latest_refs(rows):
    latest = {}
    for row in rows:
        if row["id"] not in latest or row["revision"] > latest[row["id"]]["revision"]:
            latest[row["id"]] = row
    return [{"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}
            for row in sorted(latest.values(), key=lambda value: value["id"])]


def latest_summaries(rows):
    wanted = {(ref["id"], ref["revision"]) for ref in latest_refs(rows)}
    return sorted([summary(row) for row in rows if (row["id"], row["revision"]) in wanted],
                  key=lambda row: (row["createdAt"], row["id"]), reverse=True)


def get(operations, program_id, installation_id, selected_revision=None):
    ident = identity(installation_id)
    parameters = (program_id, ident)
    suffix = " ORDER BY revision DESC LIMIT 1"
    if selected_revision is not None:
        parameters += (revision(selected_revision),)
        suffix = " AND revision=?"
    stored = operations.db.execute(
        "SELECT body_json FROM ops_installations WHERE program_id=? AND installation_id=?" + suffix,
        parameters).fetchone()
    if not stored:
        fail("The original installation edition is unavailable.", "INSTALLATION_NOT_FOUND", 404)
    row = json.loads(stored[0])
    if digest({key: value for key, value in row.items() if key != "sha256"}) != row.get("sha256"):
        fail("The saved installation differs from its retained identity.", "INSTALLATION_CHANGED", 409)
    return row


def normalized(context, raw):
    raw = object_value(deepcopy(raw), ("name", "stage", "merchantDeploymentId", "buyerDeploymentIds",
        "workorder", "task", "source", "payment", "receiving", "assignments", "checks"), "installation")
    records, sources, plan = context["records"], context["sources"], context["plan"]
    maps = {kind: {row["id"]: row for row in records[kind]} for kind in COLLECTIONS}
    retained = lambda value, label: domain.reference_list(value if value is not None else [], sources, label)
    merchant = raw.get("merchantDeploymentId") or None
    if merchant is not None:
        if merchant not in maps["deployments"] or maps["deployments"][merchant]["role"] not in ("MERCHANT", "BOTH"):
            fail("Select a retained merchant or combined deployment.", "INSTALLATION_DEPLOYMENT")
    buyers = domain.reference_list(raw.get("buyerDeploymentIds", []), maps["deployments"], "Buyer deployments", 20)
    if any(maps["deployments"][key]["role"] not in ("BUYER", "BOTH") for key in buyers):
        fail("Select retained buyer or combined deployments.", "INSTALLATION_DEPLOYMENT")
    deployments = set(buyers) | ({merchant} if merchant else set())

    source_workorder = object_value(raw.get("workorder", {}), ("sourceId", "reference", "payer", "scope", "terms"),
                                   "original workorder")
    workorder_id = source_workorder.get("sourceId") or None
    if workorder_id is not None:
        retained([workorder_id], "Original workorder")
    workorder = {"sourceId": workorder_id,
                 **{key: short_text(source_workorder.get(key), label, 8000 if key in ("scope", "terms") else 1000)
                    for key, label in (("reference", "Original workorder reference"), ("payer", "Commissioning payer"),
                                       ("scope", "Original scope and implementation assignment"),
                                       ("terms", "Original commercial terms"))}}
    task_raw = object_value(raw.get("task", {}), ("name", "purpose", "request", "completeOutput", "repeatTrigger", "pricedUnit"),
                            "customer task")
    task = {key: short_text(task_raw.get(key), label, 8000 if key == "request" else 4000)
            for key, label in (("name", "Useful task"), ("purpose", "Customer purpose"),
                ("request", "Complete original request"), ("completeOutput", "Whole task completion"),
                ("repeatTrigger", "Reason for another useful result"), ("pricedUnit", "Merchant priced unit"))}
    source_raw = object_value(raw.get("source", {}), ("sourceIds", "reference", "mode", "population", "meaning", "authority", "changePolicy"),
                              "source specification")
    source = {"sourceIds": retained(source_raw.get("sourceIds"), "Selected source files"),
              "mode": domain.enum(source_raw.get("mode", "UNSELECTED"), ("UNSELECTED", "SNAPSHOT", "LIVE", "MIXED"), "Source behavior"),
              **{key: short_text(source_raw.get(key), label) for key, label in (
                  ("reference", "Source edition or live-operation identity"), ("population", "Complete source population"),
                  ("meaning", "Keys, types, units and time meaning"), ("authority", "Source rights and authority"),
                  ("changePolicy", "Source change and withdrawal"))}}
    payment_raw = object_value(raw.get("payment", {}), ("network", "asset", "recipient", "priceAtomic", "taskBudgetAtomic",
        "taskUnits", "authority", "termsSourceIds", "facilitators"), "payment selection")
    providers = payment_raw.get("facilitators", [])
    if not isinstance(providers, list) or len(providers) > 10:
        fail("Use up to ten explicit facilitator selections.")
    facilitators, seen = [], set()
    for provider in providers:
        provider = object_value(provider, ("operatorId", "endpoint", "sourceIds", "note"), "facilitator selection")
        operator = short_text(provider.get("operatorId"), "Facilitator operator identity", 500, True)
        endpoint = domain.url(provider.get("endpoint"), "Facilitator endpoint", False)
        key = (operator, endpoint)
        if key in seen:
            fail("Keep each selected facilitator operator and endpoint once.")
        seen.add(key)
        facilitators.append({"operatorId": operator, "endpoint": endpoint,
                             "sourceIds": retained(provider.get("sourceIds"), "Facilitator sources"),
                             "note": short_text(provider.get("note"), "Facilitator selection basis")})
    payment = {**{key: short_text(payment_raw.get(key), label, limit) for key, label, limit in (
                    ("network", "Payment network", 200), ("asset", "Payment asset", 500),
                    ("recipient", "Payment recipient", 500), ("authority", "Buyer approval and aggregate spending authority", 4000))},
               "priceAtomic": atomic(payment_raw.get("priceAtomic"), "Original unit price"),
               "taskBudgetAtomic": atomic(payment_raw.get("taskBudgetAtomic"), "Whole task budget"),
               "taskUnits": domain.integer(payment_raw.get("taskUnits"), "Expected priced units", 0, 10**12, True),
               "termsSourceIds": retained(payment_raw.get("termsSourceIds"), "Original payment terms"),
               "facilitators": facilitators}
    receiving_raw = object_value(raw.get("receiving", {}), ("application", "host", "operator", "acceptanceRule",
        "changeAndWithdraw", "recovery", "maintenance", "sourceIds"), "customer receiving")
    receiving = {"sourceIds": retained(receiving_raw.get("sourceIds"), "Receiving sources"),
                 **{key: short_text(receiving_raw.get(key), label) for key, label in (
                    ("application", "Receiving application and version"), ("host", "Authorized receiving host"),
                    ("operator", "Receiving operator"), ("acceptanceRule", "Useful output acceptance"),
                    ("changeAndWithdraw", "Second-operator change or withdrawal"), ("recovery", "Original recovery procedure"),
                    ("maintenance", "Maintainer, support destination and ownership"))}}
    assignment_raw = object_value(raw.get("assignments", {}), ("costIds", "commercialRef", "note"), "delivery assignments")
    cost_ids = assignment_raw.get("costIds", [])
    if (not isinstance(cost_ids, list) or len(cost_ids) > 200 or any(not isinstance(item, str) for item in cost_ids)
            or len(cost_ids) != len(set(cost_ids))):
        fail("Select distinct original funded work packages.")
    for value in cost_ids:
        if not isinstance(value, str) or domain.cost_id(value, plan) is None:
            fail("Select an original funded work package.")
    assignments = {"costIds": cost_ids,
                   "commercialRef": short_text(assignment_raw.get("commercialRef"), "Separate commercial workorder", 4000),
                   "note": short_text(assignment_raw.get("note"), "Original funding and effort assignment", 8000)}
    checks_raw = raw.get("checks", [])
    if not isinstance(checks_raw, list) or len(checks_raw) > 100:
        fail("Use up to one hundred distinct acceptance steps.")
    checks, check_ids = [], set()
    for original in checks_raw:
        value = object_value(original, ("id", "title", "criterion", "tranche", "required", "state", "operator", "observedAt",
            "note", "sourceIds", "workIds", "purchaseIds", "outcomeIds"), "installation acceptance")
        ident = value.get("id")
        if not isinstance(ident, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,79}", ident) or ident in check_ids:
            fail("Give each acceptance step a distinct retained lowercase identity.")
        check_ids.add(ident)
        required = value.get("required", True)
        if not isinstance(required, bool):
            fail("The acceptance requirement must be true or false.")
        state = domain.enum(value.get("state", "OPEN"), CHECK_STATES, "Acceptance state")
        operator = short_text(value.get("operator"), "Accountable acceptance operator", 500)
        observed = domain.timestamp(value.get("observedAt"), "Actual acceptance observation", True)
        note = short_text(value.get("note"), "Acceptance result and correction", 8000)
        if state == "ACCEPTED" and (not operator or not observed or not note):
            fail("Accepted work needs its actual operator, observation time and result.")
        if state == "NOT_APPLICABLE" and not note:
            fail("Retain the reason this acceptance step is not applicable.")
        links = {}
        for field, kind in (("workIds", "work"), ("purchaseIds", "purchases"), ("outcomeIds", "outcomes")):
            links[field] = domain.reference_list(value.get(field, []), maps[kind], "Original " + kind, 200)
        if any(maps["purchases"][key]["deploymentId"] not in deployments for key in links["purchaseIds"]):
            fail("An installation purchase must belong to one of its selected deployments.", "INSTALLATION_PURCHASE")
        checks.append({"id": ident, "title": short_text(value.get("title"), "Acceptance title", 500, True),
                       "criterion": short_text(value.get("criterion"), "Original acceptance criterion", 8000, state == "ACCEPTED"),
                       "tranche": domain.integer(value.get("tranche"), "Acceptance tranche", 1, 3, True),
                       "required": required, "state": state, "operator": operator, "observedAt": observed,
                       "note": note, "sourceIds": retained(value.get("sourceIds"), "Acceptance sources"), **links})
    result = {"name": short_text(raw.get("name"), "Installation name", 300, True),
              "stage": domain.enum(raw.get("stage", "PLANNED"), STAGES, "Installation stage"),
              "merchantDeploymentId": merchant, "buyerDeploymentIds": buyers, "workorder": workorder,
              "task": task, "source": source, "payment": payment, "receiving": receiving,
              "assignments": assignments, "checks": checks}
    if len(canonical(result).encode("utf-8")) > MAX_DOCUMENT_BYTES:
        fail("The complete installation input exceeds 128 KiB.", status=413)
    return result


def capture(context, document):
    """Select complete original rows, then close their source/contributor links."""
    selected = {kind: set() for kind in domain.KINDS}
    selected["deployments"].update(document["buyerDeploymentIds"])
    if document["merchantDeploymentId"]:
        selected["deployments"].add(document["merchantDeploymentId"])
    source_ids = set(document["source"]["sourceIds"] + document["payment"]["termsSourceIds"]
                     + document["receiving"]["sourceIds"])
    if document["workorder"]["sourceId"]:
        source_ids.add(document["workorder"]["sourceId"])
    for row in document["payment"]["facilitators"]:
        source_ids.update(row["sourceIds"])
    for row in document["checks"]:
        source_ids.update(row["sourceIds"])
        for field, kind in (("workIds", "work"), ("purchaseIds", "purchases"), ("outcomeIds", "outcomes")):
            selected[kind].update(row[field])
    originals = {kind: {row["id"]: row for row in context["records"][kind]} for kind in domain.KINDS}
    for kind in ("work", "outcomes"):
        for key in selected[kind]:
            contributor = originals[kind][key].get("contributorId")
            if contributor:
                selected["contributors"].add(contributor)
    records = {kind: [deepcopy(originals[kind][key]) for key in sorted(selected[kind])]
               for kind in domain.KINDS}
    for values in records.values():
        for row in values:
            source_ids.update(row.get("sourceIds", []))
    return {"program": deepcopy(context["program"]), "plan": deepcopy(context["plan"]), "records": records,
            "sources": {key: deepcopy(context["sources"][key]) for key in sorted(source_ids)}}


def report(snapshot, document):
    findings = []
    def missing(path, value, description):
        if value in (None, "", [], "UNSELECTED"):
            findings.append({"field": path, "kind": "DECISION", "message": description})
    for path, value, description in (
        ("merchantDeploymentId", document["merchantDeploymentId"], "Select the accountable merchant deployment."),
        ("buyerDeploymentIds", document["buyerDeploymentIds"], "Select the original receiving buyer deployment."),
        ("workorder.sourceId", document["workorder"]["sourceId"], "Select the complete original commissioning/workorder source."),
        ("workorder.payer", document["workorder"]["payer"], "Record the commissioning payer."),
        ("task.request", document["task"]["request"], "Name the complete original request."),
        ("task.completeOutput", document["task"]["completeOutput"], "State what finishes the customer's whole task."),
        ("task.repeatTrigger", document["task"]["repeatTrigger"], "Record the event that makes a later result useful."),
        ("task.pricedUnit", document["task"]["pricedUnit"], "Name the merchant's priced unit."),
        ("source.mode", document["source"]["mode"], "Choose snapshot, live or mixed source behavior."),
        ("source.population", document["source"]["population"], "Describe the full selected population."),
        ("source.meaning", document["source"]["meaning"], "Retain its keys, types, units and time meaning."),
        ("source.authority", document["source"]["authority"], "Identify the selected source rights and authority."),
        ("payment.network", document["payment"]["network"], "Select the original payment network."),
        ("payment.asset", document["payment"]["asset"], "Select the original payment asset."),
        ("payment.recipient", document["payment"]["recipient"], "Retain the original payment recipient."),
        ("payment.authority", document["payment"]["authority"], "Record the buyer approval and complete-task spending authority."),
        ("receiving.application", document["receiving"]["application"], "Name the receiving application and version."),
        ("receiving.host", document["receiving"]["host"], "Name the authorized receiving host."),
        ("receiving.operator", document["receiving"]["operator"], "Name the receiving operator."),
        ("receiving.acceptanceRule", document["receiving"]["acceptanceRule"], "State the useful-result acceptance."),
        ("receiving.changeAndWithdraw", document["receiving"]["changeAndWithdraw"], "Record the second operator's source or terms change."),
        ("receiving.recovery", document["receiving"]["recovery"], "Select the original recovery procedure."),
        ("receiving.maintenance", document["receiving"]["maintenance"], "Name the maintainer and support destination.")):
        missing(path, value, description)
    for row in document["checks"]:
        if row["required"] and row["state"] not in ("ACCEPTED", "NOT_APPLICABLE"):
            findings.append({"field": "checks." + row["id"], "kind": "ACCEPTANCE",
                             "message": row["title"] + ": " + row["state"].replace("_", " ").lower()})
    for key, label in (("priceAtomic", "unit price"), ("taskBudgetAtomic", "whole task budget")):
        if document["payment"][key] is None:
            findings.append({"field": "payment." + key, "kind": "PAYMENT", "message": "Original " + label + " is unentered."})
    payment = document["payment"]
    total = None
    if payment["priceAtomic"] is not None and payment["taskUnits"] is not None:
        total = str(int(payment["priceAtomic"]) * payment["taskUnits"])
        if payment["taskBudgetAtomic"] is not None and int(total) > int(payment["taskBudgetAtomic"]):
            findings.append({"field": "payment.taskBudgetAtomic", "kind": "PAYMENT",
                             "message": "The selected priced units exceed the entered whole-task atomic budget."})
    work = snapshot["records"]["work"]
    work_groups = {}
    from decimal import Decimal
    for row in work:
        key = (row.get("fundingBasis"), row.get("costId"))
        item = work_groups.setdefault(key, {"fundingBasis": key[0], "costId": key[1],
                                           "recordedHours": Decimal(0), "acceptedHours": Decimal(0)})
        if row["state"] != "VOID":
            item["recordedHours"] += Decimal(row["hours"])
            if row["state"] == "ACCEPTED":
                item["acceptedHours"] += Decimal(row["hours"])
        if row.get("costId") and row["costId"] not in document["assignments"]["costIds"]:
            findings.append({"field": "work." + row["id"], "kind": "ASSIGNMENT",
                             "message": "Selected work retains a funded package outside this installation's assignment."})
    for row in work_groups.values():
        row["recordedHours"], row["acceptedHours"] = str(row["recordedHours"]), str(row["acceptedHours"])
    purchases = snapshot["records"]["purchases"]
    groups = {}
    for row in purchases:
        key = (row["network"], row["asset"])
        item = groups.setdefault(key, {"network": key[0], "asset": key[1], "purchases": 0,
                                      "settledAtomic": 0, "reportedFeesAtomic": 0, "unknownFees": 0})
        item["purchases"] += 1
        if row["state"] != "VOID" and row["settlementStatus"] == "SETTLED":
            item["settledAtomic"] += int(row["amountStroops"])
        if row.get("feesStroops") is None:
            item["unknownFees"] += 1
        else:
            item["reportedFeesAtomic"] += int(row["feesStroops"])
    for row in groups.values():
        row["settledAtomic"], row["reportedFeesAtomic"] = str(row["settledAtomic"]), str(row["reportedFeesAtomic"])
    costs = {row["id"]: row for row in snapshot["plan"]["scenario"]["future_costs"]}
    return {"name": document["name"], "stage": document["stage"], "configurationComplete": not any(row["kind"] != "ACCEPTANCE" for row in findings),
            "acceptedChecks": sum(row["state"] == "ACCEPTED" for row in document["checks"]),
            "totalChecks": len(document["checks"]), "findings": findings,
            "pricedTaskAtomic": total, "pricedTaskBasis": "Entered unit price multiplied by entered priced units",
            "packages": [deepcopy(costs[key]) for key in document["assignments"]["costIds"]],
            "work": sorted(work_groups.values(), key=lambda row: (row["fundingBasis"] or "", row["costId"] or "")),
            "purchaseStates": dict(sorted(Counter(row["settlementStatus"] + "/" + row["outputStatus"] + "/" + row["state"]
                                                for row in purchases).items())),
            "purchaseAmounts": sorted(groups.values(), key=lambda row: (row["network"], row["asset"])),
            "sourceFiles": len(snapshot["sources"]), "sourceBytes": sum(row["bytes"] for row in snapshot["sources"].values())}


def differences(before, after, path=""):
    result = []
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            result += differences(before.get(key), after.get(key), (path + "." if path else "") + key)
    elif before != after:
        result.append({"field": path or "installation", "before": before, "after": after})
    return result


def _source(context):
    program, plan = context["program"], context["plan"]
    return {"caseId": program["id"], "version": program["version"], "mode": program["mode"],
            "planId": plan["id"], "planRevision": plan["revision"], "planContentSha256": plan["contentSha256"],
            "planSourceSha256": plan["source"]["sha256"]}


def _current(context, expected):
    expected = domain.integer(expected, "Reviewed operations version", 1, 10000000)
    if context["program"]["version"] != expected:
        fail("The original case changed. Reopen it before reviewing this installation.", "OPERATIONS_CONFLICT", 409)


def seed(context):
    checks = []
    for cost in context["plan"]["scenario"]["future_costs"]:
        check_id = re.sub(r"[^a-z0-9-]", "-", cost["id"].lower()).strip("-")[:80]
        checks.append({"id": check_id, "title": cost["id"], "criterion": cost.get("measurable_proof", ""),
                       "tranche": cost["tranche"], "required": True, "state": "OPEN", "operator": "",
                       "observedAt": None, "note": "", "sourceIds": [], "workIds": [], "purchaseIds": [], "outcomeIds": []})
    return normalized(context, {"name": "Customer installation", "stage": "PLANNED",
        "merchantDeploymentId": None, "buyerDeploymentIds": [], "workorder": {}, "task": {}, "source": {},
        "payment": {}, "receiving": {}, "assignments": {
            "costIds": [row["id"] for row in context["plan"]["scenario"]["future_costs"]],
            "commercialRef": "", "note": "Assign actual implementation work once to the selected original grant package or commercial workorder."},
        "checks": checks})


def preview(operations, context, body):
    object_value(body, ("expectedVersion", "installationId", "expectedRevision", "document"), "installation preview")
    _current(context, body.get("expectedVersion"))
    ident = body.get("installationId")
    expected_revision = revision(body.get("expectedRevision", 0), True)
    previous = None
    if ident is None:
        if expected_revision != 0:
            fail("A new installation starts at edition zero before its first save.")
    else:
        previous = get(operations, context["program"]["id"], ident)
        if previous["revision"] != expected_revision:
            fail("Another installation edition is saved. Reopen its current edition.", "INSTALLATION_CONFLICT", 409)
    document = normalized(context, body.get("document"))
    snapshot = capture(context, document)
    value = {"schema": SCHEMA, "installationId": ident, "expectedRevision": expected_revision,
             "source": _source(context), "document": document, "snapshot": snapshot, "report": report(snapshot, document),
             "previous": None if previous is None else {"id": previous["id"], "revision": previous["revision"], "sha256": previous["sha256"]},
             "changes": differences(previous["preview"]["document"], document) if previous else []}
    value["previewSha256"] = digest(value)
    return value


def save(operations, context, data, actor, version, note):
    object_value(data, ("installationId", "expectedRevision", "document", "expectedPreviewSha256"), "installation save")
    candidate = preview(operations, context, {"expectedVersion": context["program"]["version"],
        **{key: data.get(key) for key in ("installationId", "expectedRevision", "document")}})
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed installation", False):
        fail("The selected input or original records changed. Review the current installation.", "INSTALLATION_PREVIEW_CONFLICT", 409)
    count, distinct = operations.db.execute(
        "SELECT COUNT(*),COUNT(DISTINCT installation_id) FROM ops_installations WHERE program_id=?",
        (context["program"]["id"],)).fetchone()
    if count >= MAX_EDITIONS or candidate["installationId"] is None and distinct >= MAX_INSTALLATIONS:
        fail("This case has reached its retained installation-edition capacity.", status=413)
    ident = candidate["installationId"] or "installation-" + uuid.uuid4().hex
    row = {"id": ident, "revision": candidate["expectedRevision"] + 1, "version": version,
           "createdAt": now(), "actor": actor, "note": short_text(note, "Installation save reason", 12000, True),
           "preview": candidate}
    row["sha256"] = digest(row)
    operations.db.execute("INSERT INTO ops_installations VALUES(?,?,?,?)",
                         (context["program"]["id"], ident, row["revision"], canonical(row)))
    return {"before": candidate["previous"], "after": summary(row), "kind": "installation", "recordId": ident,
            "revision": row["revision"], "sha256": row["sha256"], "unchanged": False}


def show(operations, context, installation_id, selected_revision=None):
    row = get(operations, context["program"]["id"], installation_id, selected_revision)
    try:
        current = capture(context, normalized(context, row["preview"]["document"]))
        before = row["preview"]["snapshot"]
        changed = current["records"] != before["records"] or current["sources"] != before["sources"] or \
            current["plan"]["contentSha256"] != before["plan"]["contentSha256"]
        current_state = {"available": True, "selectedRecordsChanged": changed,
                         "caseVersion": context["program"]["version"]}
    except (Problem, KeyError):
        current_state = {"available": False, "selectedRecordsChanged": True,
                         "caseVersion": context["program"]["version"]}
    return {**row, "current": current_state}


def history(operations, program_id, installation_id, before=None, limit=25):
    identity(installation_id)
    domain.integer(limit, "Installation history page size", 1, 100)
    if before is not None:
        revision(before)
    rows = [json.loads(row[0]) for row in operations.db.execute(
        "SELECT body_json FROM ops_installations WHERE program_id=? AND installation_id=?"
        + (" AND revision<?" if before is not None else "") + " ORDER BY revision DESC LIMIT ?",
        (program_id, installation_id, before, limit + 1) if before is not None else (program_id, installation_id, limit + 1))]
    more = len(rows) > limit
    rows = rows[:limit]
    return {"editions": [summary(row) for row in rows], "nextBefore": rows[-1]["revision"] if more else None}


def _record_matches(events, final_records):
    """Index complete native states retained by their existing mutation events."""
    result = defaultdict(set)
    def visit(value):
        if isinstance(value, dict):
            if isinstance(value.get("id"), str) and isinstance(value.get("version"), int) and "recordedBy" in value:
                result[(value["id"], value["version"])].add(digest(value))
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
    for values in final_records.values():
        visit(values)
    for event in events:
        visit(event.get("before"))
        visit(event.get("after"))
    return result


def validate_import(context, rows, events, source_version):
    if not isinstance(rows, list) or len(rows) > MAX_EDITIONS:
        fail("The complete installation history is invalid.")
    by_id, seen = {}, set()
    states = _record_matches(events, context["records"])
    for row in rows:
        object_value(row, ("id", "revision", "version", "createdAt", "actor", "note", "preview", "sha256"),
                     "saved installation edition")
        ident, number = identity(row.get("id")), revision(row.get("revision"))
        if (ident, number) in seen:
            fail("The complete case repeats an installation edition.")
        seen.add((ident, number))
        by_id.setdefault(ident, []).append(row)
        domain.integer(row.get("version"), "Installation save version", 2, source_version)
        domain.timestamp(row.get("createdAt"), "Original installation save time")
        short_text(row.get("actor"), "Original installation author", 300, True)
        short_text(row.get("note"), "Original installation save reason", 12000, True)
        if digest({key: value for key, value in row.items() if key != "sha256"}) != row.get("sha256"):
            fail("A retained installation edition differs from its complete identity.")
        candidate = row.get("preview")
        object_value(candidate, ("schema", "installationId", "expectedRevision", "source", "document", "snapshot",
            "report", "previous", "changes", "previewSha256"), "saved installation preview")
        if candidate.get("schema") != SCHEMA or candidate.get("expectedRevision") != number - 1:
            fail("A retained installation uses a different edition contract.")
        if digest({key: value for key, value in candidate.items() if key != "previewSha256"}) != candidate.get("previewSha256"):
            fail("A retained installation preview differs from its selected input.")
        snapshot = candidate.get("snapshot")
        if not isinstance(snapshot, dict) or set(snapshot) != {"program", "plan", "records", "sources"}:
            fail("The complete original installation snapshot is required.")
        if (any(snapshot["plan"].get(key) != context["plan"].get(key) for key in
                ("scenario", "planning", "report", "source", "revision", "contentSha256"))
                or snapshot["program"]["mode"] != context["program"]["mode"]
                or snapshot["program"]["version"] != row["version"] - 1
                or candidate["source"] != _source(snapshot)):
            fail("The installation must retain its original selected case and funding plan.")
        document = normalized(snapshot, candidate.get("document"))
        if document != candidate["document"] or capture(snapshot, document) != snapshot:
            fail("The installation's selected records or sources are incomplete.")
        for source_id, metadata in snapshot["sources"].items():
            present = context["sources"].get(source_id)
            if not present or any(present.get(key) != metadata.get(key) for key in
                ("id", "filename", "bytes", "sha256", "createdAt", "observedAt", "mediaType", "kind", "sourceUrl")):
                fail("An installation source is absent from the complete case.")
        for values in snapshot["records"].values():
            for record in values:
                if record["version"] >= row["version"] or digest(record) not in states[(record["id"], record["version"])]:
                    fail("A selected installation record is missing from its original case history.")
        if candidate["report"] != report(snapshot, document):
            fail("The installation report differs from its retained original observations.")
        event = events[row["version"] - 1]
        if (event.get("action") != "installation.save" or event.get("recordId") != ident
                or event.get("after") != summary(row)):
            fail("The installation edition does not join its original save event.")
    if len(by_id) > MAX_INSTALLATIONS:
        fail("The complete case has too many installations.")
    for ident, values in by_id.items():
        values.sort(key=lambda row: row["revision"])
        previous = None
        for number, row in enumerate(values, 1):
            candidate = row["preview"]
            expected_previous = None if previous is None else {
                "id": ident, "revision": previous["revision"], "sha256": previous["sha256"]}
            if (row["revision"] != number or candidate["previous"] != expected_previous
                    or candidate["installationId"] != (ident if previous else None)
                    or candidate["changes"] != (differences(previous["preview"]["document"], candidate["document"]) if previous else [])
                    or previous is not None and previous["version"] >= row["version"]):
                fail("The original installation edition sequence is incomplete.")
            previous = row
    if {(event.get("recordId"), event.get("after", {}).get("revision")) for event in events
            if event.get("action") == "installation.save"} != seen:
        fail("The complete case is missing an original saved installation.")


def html_document(row):
    value, document = row["preview"], row["preview"]["document"]
    e = lambda item: escape(str(item if item is not None else "Unentered"), quote=True)
    def table(headings, values):
        return "<div class=\"table\"><table><thead><tr>" + "".join("<th>" + e(item) + "</th>" for item in headings) \
            + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + item + "</td>" for item in items) + "</tr>" for items in values) \
            + "</tbody></table></div>"
    def pretty(item):
        return e(canonical(item) if isinstance(item, (dict, list)) else item)
    body = "<h1>" + e(document["name"]) + "</h1><p>Installation edition " + str(row["revision"]) + " · " \
        + e(document["stage"]) + " · saved " + e(row["createdAt"]) + " by " + e(row["actor"]) + "</p>"
    body += "<p><strong>Original case purpose:</strong> " + e(value["source"]["mode"]) + ". Source case " \
        + e(value["source"]["caseId"]) + ", version " + str(value["source"]["version"]) + ".</p>"
    body += "<p>" + e(row["note"]) + "</p>"
    for key, label in (("workorder", "Original commissioning"), ("task", "Useful customer task"), ("source", "Source meaning and authority"),
                       ("payment", "Payment and complete-task budget"), ("receiving", "Receiving and maintenance"),
                       ("assignments", "Original funded and commercial assignments")):
        body += "<h2>" + label + "</h2>" + table(["Field", "Selected value"],
            [[e(name), pretty(item)] for name, item in document[key].items()])
    body += "<h2>Acceptance and corrections</h2>" + table(
        ["Step", "Original criterion", "State", "Operator / observed", "Result / source"],
        [[e(item["title"]), e(item["criterion"]), e(item["state"]),
          e(item["operator"]) + "<br>" + e(item["observedAt"]), e(item["note"]) + "<pre>" +
          pretty({key: item[key] for key in ("sourceIds", "workIds", "purchaseIds", "outcomeIds")}) + "</pre>"]
         for item in document["checks"]])
    body += "<h2>Selected original deployment, work and purchase records</h2>"
    for kind, rows in value["snapshot"]["records"].items():
        if rows:
            body += "<h3>" + e(kind) + "</h3>" + "".join("<details><summary>" + e(item.get("name") or item.get("description") or item["id"])
                + "</summary><pre>" + e(json.dumps(item, ensure_ascii=False, indent=2)) + "</pre></details>" for item in rows)
    body += "<h2>Retained report</h2><pre>" + e(json.dumps(value["report"], ensure_ascii=False, indent=2)) + "</pre>"
    body += "<h2>Complete original files</h2>" + table(["File", "Bytes", "SHA-256"],
        [["<a download href=\"sources/" + e(item["id"]) + "\">" + e(item["filename"]) + "</a>",
          str(item["bytes"]), e(item["sha256"])] for item in value["snapshot"]["sources"].values()])
    body += "<h2>Changes from the preceding edition</h2>" + table(["Field", "Before", "This edition"],
        [[e(item["field"]), pretty(item["before"]), pretty(item["after"])] for item in value["changes"]])
    body += "<h2>Open the complete operating case</h2><p>Import this entire ZIP through the original SF47 Delivery operations "
    body += "Import complete case control or its operations import command. The selected installation edition, every earlier edition, "
    body += "original work, purchases, source files and planning history open together. The receiving workspace supplies its own private access authority.</p>"
    body += "<p>Installation " + e(row["id"]) + " · edition SHA-256 " + e(row["sha256"]) + "</p>"
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            "<title>" + e(document["name"]) + "</title><style>"
            "body{margin:0 auto;padding:32px;max-width:1180px;background:#fff;color:#202020;font:15px/1.55 system-ui,sans-serif}"
            "h1{font-size:28px}h2{margin-top:32px;border-bottom:1px solid #bbb;padding-bottom:8px}h3{font-size:17px}"
            "table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #bbb}"
            "th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}"
            ".table{overflow:auto}td{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#222;text-decoration:underline}"
            "details{border:1px solid #ccc;padding:12px;margin:8px 0}summary{cursor:pointer}@media(max-width:650px){body{padding:16px}}"
            "</style><body>" + body + "</body></html>\n").encode("utf-8")


def selected_files(context, rows, installation_id, selected_revision):
    ident = identity(installation_id)
    number = revision(selected_revision)
    row = next((value for value in rows if value["id"] == ident and value["revision"] == number), None)
    if row is None:
        fail("The selected installation edition is unavailable.", "INSTALLATION_NOT_FOUND", 404)
    document = html_document(row)
    selection = {"schema": SELECTION_SCHEMA, "caseId": context["program"]["id"],
                 "caseVersion": context["program"]["version"], "installationId": ident,
                 "revision": number, "sha256": row["sha256"],
                 "document": {"path": "installation.html", "bytes": len(document),
                              "sha256": hashlib.sha256(document).hexdigest()}}
    return {"installation-selection.json": (canonical(selection) + "\n").encode("utf-8"),
            "installation.html": document}


def selection_from_files(document, files):
    selected_names = {"installation-selection.json", "installation.html"}
    if not selected_names.intersection(files):
        return None
    if not selected_names.issubset(files):
        fail("The selected installation handover is incomplete.")
    try:
        selection = json.loads(files["installation-selection.json"])
        object_value(selection, ("schema", "caseId", "caseVersion", "installationId", "revision", "sha256", "document"),
                     "installation handover selection")
        ident, number = identity(selection.get("installationId")), revision(selection.get("revision"))
        row = next((value for value in document.get("installations", [])
                    if value["id"] == ident and value["revision"] == number), None)
        raw = files["installation.html"]
        descriptor = {"path": "installation.html", "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        if (not row or selection != {"schema": SELECTION_SCHEMA, "caseId": document["program"]["id"],
                "caseVersion": document["program"]["version"], "installationId": ident, "revision": number,
                "sha256": row["sha256"], "document": descriptor}):
            fail("The installation selection or readable handover differs from its retained edition.")
        # Keep the exact received rendition across later software/template changes.
        # Only the normalized saved edition drives the native operator; this HTML
        # remains a complete downloaded document under the archive's file manifest.
        raw.decode("utf-8")
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        raise Problem("The installation selection is unreadable.", 422, "INVALID_INSTALLATION") from exc
    return {"id": ident, "revision": number, "sha256": selection["sha256"]}
