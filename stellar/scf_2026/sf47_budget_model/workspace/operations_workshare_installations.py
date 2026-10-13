"""Receive a selected original Workshare into the native Customer Installation.

The commercial source remains an immutable Operations attachment. Installation
editions bind its original case, complete plan and phase identities; native
payment and receiving choices stay in the existing Installation document.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
import hashlib
import json

from model import Problem, canonical, digest
import operations_domain as domain
from workshare_intake import load_workshares

SCHEMA = "stellar-forge.sf47-workshare-installation.v1"
SOURCE_FIELDS = ("sourceId", "expectedSourceSha256", "packetSourceId", "expectedPacketSha256")
BINDING_FIELDS = ("schema", "sourceId", "sourceSha256", "packetSourceId", "packetSha256",
                  "caseId", "planSha256", "phaseChecks")


def fail(message, code="INVALID_WORKSHARE_INSTALLATION", status=422):
    raise Problem(message, status, code)


def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        fail("Use the complete " + label + " object with its original field names.")
    return value


def original_id(value, label):
    if (not isinstance(value, str) or not value or len(value) > 500
            or any(ord(char) < 32 for char in value)):
        fail("Select the original " + label + ".")
    return value


def source_selection(context, raw):
    """Resolve existing immutable attachment identities without rewriting bytes."""
    result = {}
    for key, sha_key in (("sourceId", "expectedSourceSha256"),
                         ("packetSourceId", "expectedPacketSha256")):
        ident = raw.get(key)
        if ident is None and key == "packetSourceId":
            if raw.get(sha_key) is not None:
                fail("Select the original receiving packet with its SHA-256.")
            result[key], result[sha_key] = None, None
            continue
        domain.reference_list([ident], context["sources"], "Original Workshare source")
        metadata = context["sources"][ident]
        expected = domain.sha(raw.get(sha_key), "Original Workshare source", False)
        if metadata["sha256"] != expected:
            fail("The selected original Workshare attachment differs.", "WORKSHARE_SOURCE_CONFLICT", 409)
        result[key], result[sha_key] = ident, expected
    if result["sourceId"] == result["packetSourceId"]:
        fail("Select the complete commissioning document and its distinct receiving packet.")
    return result


def normalize_binding(context, raw):
    value = exact(deepcopy(raw), BINDING_FIELDS, "selected Workshare binding")
    if value.get("schema") != SCHEMA:
        fail("Use the native selected Workshare binding.")
    sources = source_selection(context, {
        "sourceId": value.get("sourceId"), "expectedSourceSha256": value.get("sourceSha256"),
        "packetSourceId": value.get("packetSourceId"), "expectedPacketSha256": value.get("packetSha256")})
    pairs = value.get("phaseChecks")
    if not isinstance(pairs, list) or not pairs or len(pairs) > 100:
        fail("Bind every original Workshare phase to its installation acceptance step.")
    case_id = original_id(value.get("caseId"), "Workshare case")
    phases, checks, normalized = set(), set(), []
    for row in pairs:
        exact(row, ("phaseId", "checkId"), "Workshare phase binding")
        phase, check = original_id(row.get("phaseId"), "phase"), original_id(row.get("checkId"), "acceptance step")
        if check != phase_check_id(case_id, phase):
            fail("Retain the native stable acceptance identity for each original phase.")
        if phase in phases or check in checks:
            fail("Keep each original Workshare phase and installation step once.")
        phases.add(phase); checks.add(check)
        normalized.append({"phaseId": phase, "checkId": check})
    return {"schema": SCHEMA, "sourceId": sources["sourceId"],
            "sourceSha256": sources["expectedSourceSha256"], "packetSourceId": sources["packetSourceId"],
            "packetSha256": sources["expectedPacketSha256"], "caseId": case_id,
            "planSha256": domain.sha(value.get("planSha256"), "Original Workshare plan", False),
            "phaseChecks": normalized}


def read_source(operations, context, selection, reader=None):
    selected = source_selection(context, selection)
    read = reader or (lambda ident: operations.source(context["program"]["id"], ident)[1])
    def original(ident):
        if ident is None:
            return None
        raw = read(ident)
        metadata = context["sources"][ident]
        if not isinstance(raw, bytes) or len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
            fail("The complete original Workshare file differs from its retained attachment.")
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            fail("Use the complete original Workshare JSON object.")
        return value
    try:
        commissioning, packet = original(selected["sourceId"]), original(selected["packetSourceId"])
        workshares = load_workshares(commissioning, packet, require_proposed_usd=False)
        for workshare in workshares:
            commercial = workshare["plan"]["commercial"]
            original_id(commercial.get("currency"), "commercial currency")
            original_id(commercial.get("price_status"), "commercial price status")
        originals = {row["case_id"]: row for row in commissioning["cases"]}
        packets = {} if packet is None else {row["prepared_case"]["id"]: row for row in packet["packets"]}
        return {"selection": selected, "commissioning": commissioning, "packet": packet,
                "workshares": workshares, "originals": originals, "packets": packets}
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, AttributeError, UnicodeError) as error:
        raise Problem("The original Workshare commissioning source is unreadable: " + str(error),
                      422, "INVALID_WORKSHARE_SOURCE") from error


def case_inventory(operations, context, body):
    exact(body, ("expectedVersion", *SOURCE_FIELDS), "Workshare source selection")
    from operations_installations import _current, _source
    _current(context, body.get("expectedVersion"))
    original = read_source(operations, context, body)
    return {"schema": SCHEMA, "source": _source(context), "selection": original["selection"],
            "cases": [{"caseId": row["caseId"], "title": row["plan"]["title"],
                       "customer": row["plan"]["customer"], "supplier": row["plan"]["supplier"],
                       "planSha256": row["planSha256"], "commercial": deepcopy(row["plan"]["commercial"]),
                       "hours": row["hours"], "phaseCount": row["phaseCount"], "packetPresent": row["packetPresent"]}
                      for row in original["workshares"]]}


def selected_case(original, case_id):
    row = next((row for row in original["workshares"] if row["caseId"] == case_id), None)
    if row is None:
        fail("Select an original case from this complete commissioning document.", "WORKSHARE_CASE_NOT_FOUND", 404)
    return row


def resolve_binding(operations, context, binding, reader=None):
    value = normalize_binding(context, binding)
    original = read_source(operations, context, {
        "sourceId": value["sourceId"], "expectedSourceSha256": value["sourceSha256"],
        "packetSourceId": value["packetSourceId"], "expectedPacketSha256": value["packetSha256"]}, reader)
    row = selected_case(original, value["caseId"])
    if row["planSha256"] != value["planSha256"]:
        fail("The installation selects a different original Workshare plan.", "WORKSHARE_PLAN_CONFLICT", 409)
    phases = {phase["id"]: phase for phase in row["plan"]["phases"]}
    if set(phases) != {item["phaseId"] for item in value["phaseChecks"]}:
        fail("Retain every selected original Workshare phase in the installation.")
    return {"binding": value, "workshare": row, "commissioningCase": deepcopy(original["originals"][value["caseId"]]),
            "receivingPacket": deepcopy(original["packets"].get(value["caseId"]))}


def verify_document(operations, context, document, reader=None):
    if "workshare" not in document:
        return None
    original = resolve_binding(operations, context, document["workshare"], reader)
    plan = original["workshare"]["plan"]
    phases = {phase["id"]: phase for phase in plan["phases"]}
    checks = {check["id"]: check for check in document["checks"]}
    for selected in document["workshare"]["phaseChecks"]:
        phase, check = phases[selected["phaseId"]], checks.get(selected["checkId"])
        if (check is None or check["title"] != phase["title"] or check["criterion"] != phase["acceptance"]
                or not check["required"] or document["workshare"]["sourceId"] not in check["sourceIds"]):
            fail("Preserve each original commercial phase criterion and its source; record acceptance in its native step.")
    if document["workorder"] != workorder_document(plan, document["workshare"]):
        fail("Keep the selected Workshare's original reference, payer, scope and commercial terms. "
             "Receive a changed original source to revise those fields.", "WORKSHARE_WORKORDER_CONFLICT", 409)
    return original


def verify_transition(operations, context, previous, document, reader=None, original=None):
    """Validate source refresh against the saved edition after each document is checked.

    Appended source references and reordered evidence links do not create a new
    acceptance observation. An explicitly changed operator, observation time,
    result or native work/purchase/outcome evidence remains a new observation.
    """
    if previous is None:
        return
    before = previous["preview"]["document"]
    old_binding, binding = before.get("workshare"), document.get("workshare")
    if old_binding is None:
        return
    if binding is None or old_binding["caseId"] != binding["caseId"]:
        fail("Keep this installation attached to its original commercial case; "
             "create a separate installation for another case.", "WORKSHARE_CASE_CONFLICT", 409)
    if old_binding == binding:
        return
    # Imported saved snapshots retain their original program IDs. Read the
    # immutable bytes through the current native case (or the received bundle),
    # while validating each edition against its own original source metadata.
    read = reader or (lambda ident: operations.source(context["program"]["id"], ident)[1])
    old_original = verify_document(operations, previous["preview"]["snapshot"], before, read)
    current_original = original or verify_document(operations, context, document, read)
    old_row, row = old_original["workshare"], current_original["workshare"]
    old_phases = {phase["id"]: phase for phase in old_row["plan"]["phases"]}
    old_checks = {check["id"]: check for check in before["checks"]}
    checks = {check["id"]: check for check in document["checks"]}

    def observation(check):
        return {**{key: check.get(key) for key in ("operator", "observedAt", "note")},
                **{key: sorted(check.get(key, []))
                   for key in ("workIds", "purchaseIds", "outcomeIds")}}

    for phase in row["plan"]["phases"]:
        phase_id = phase["id"]
        if phase_id not in old_phases:
            continue
        changed = (old_phases[phase_id] != phase
                   or old_row["effort"][phase_id] != row["effort"][phase_id])
        check_id = phase_check_id(binding["caseId"], phase_id)
        old_check, check = old_checks[check_id], checks[check_id]
        if changed and check["state"] == "ACCEPTED" and observation(check) == observation(old_check):
            fail("The original phase or effort changed: " + phase_id + ". Record a new acceptance "
                 "observation or keep this phase open; its prior acceptance remains in the saved edition.",
                 "WORKSHARE_ACCEPTANCE_CONFLICT", 409)


def phase_check_id(case_id, phase_id):
    return "workshare-" + hashlib.sha256((case_id + "\0" + phase_id).encode("utf-8")).hexdigest()[:32]


def terms_text(plan):
    commercial = plan["commercial"]
    lines = [str(commercial["currency"]) + " " + str(commercial["amount"]) + " · " + str(commercial["price_status"])]
    for milestone in commercial["milestones"]:
        lines.append(str(milestone["label"]) + ": " + str(commercial["currency"]) + " " +
                     str(milestone["amount"]) + " — " + str(milestone.get("trigger", "")))
    lines.append("Complete commercial terms, phase assignments, rights, dependencies and changes are retained in the attached original Workshare.")
    return "\n".join(lines)


def workorder_document(plan, binding):
    """Keep copied original commercial fields identical in seed, save and receive."""
    return {"sourceId": binding["sourceId"], "reference": binding["caseId"],
            "payer": plan["customer"], "scope": plan["outcome"], "terms": terms_text(plan)}


def seed(operations, context, body):
    """Prepare a complete editable native document; saving remains installation.save."""
    exact(body, ("expectedVersion", *SOURCE_FIELDS, "workshareCaseId",
                 "installationId", "expectedRevision", "document"), "Workshare installation selection")
    import operations_installations as installations
    installations._current(context, body.get("expectedVersion"))
    ident = body.get("installationId")
    number = installations.revision(body.get("expectedRevision", 0), True)
    previous = None
    if ident is not None:
        previous = installations.get(operations, context["program"]["id"], ident)
        if previous["revision"] != number:
            fail("Reopen the installation's current edition before receiving this source.", "INSTALLATION_CONFLICT", 409)
    elif number != 0:
        fail("Use edition zero for a new installation.")
    original = read_source(operations, context, body)
    row = selected_case(original, original_id(body.get("workshareCaseId"), "Workshare case"))
    plan = row["plan"]
    if body.get("document") is not None:
        document = installations.normalized(context, body["document"])
    elif previous:
        document = deepcopy(previous["preview"]["document"])
    else:
        document = installations.seed(context)
    old_binding = document.get("workshare")
    old_original = verify_document(operations, context, document) if old_binding else None
    if old_binding and old_binding["caseId"] != row["caseId"]:
        fail("Create a separate installation for a different original commercial case.", "WORKSHARE_CASE_CONFLICT", 409)
    old_checks = {item["id"]: item for item in document["checks"]}
    old_phases = {} if not old_original else {phase["id"]: phase for phase in old_original["workshare"]["plan"]["phases"]}
    old_effort = {} if not old_original else old_original["workshare"]["effort"]
    removed = set() if not old_binding else {item["checkId"] for item in old_binding["phaseChecks"]}
    document["checks"] = [item for item in document["checks"] if item["id"] not in removed]
    bindings, reset = [], []
    for phase in plan["phases"]:
        check_id = phase_check_id(row["caseId"], phase["id"])
        if any(item["id"] == check_id for item in document["checks"]):
            fail("The original phase identity collides with another installation check.")
        same_phase = old_phases.get(phase["id"]) == phase and old_effort.get(phase["id"]) == row["effort"][phase["id"]]
        existing = old_checks.get(check_id) if same_phase else None
        check = deepcopy(existing) if existing else {"id": check_id, "title": phase["title"],
            "criterion": phase["acceptance"], "tranche": None, "required": True, "state": "OPEN",
            "operator": "", "observedAt": None, "note": "", "sourceIds": [],
            "workIds": [], "purchaseIds": [], "outcomeIds": []}
        check["sourceIds"] = list(dict.fromkeys([*check["sourceIds"], original["selection"]["sourceId"]]))
        if not existing:
            check["note"] = "Original assigned phase owner: " + str(phase["owner"]) + ". Planned effort: " + \
                row["effort"][phase["id"]] + " hours. Dependencies: " + ", ".join(phase["depends_on"])
            if check_id in old_checks:
                reset.append(phase["id"])
        document["checks"].append(check)
        bindings.append({"phaseId": phase["id"], "checkId": check_id})
    selected = original["selection"]
    document["workshare"] = {"schema": SCHEMA, "sourceId": selected["sourceId"],
        "sourceSha256": selected["expectedSourceSha256"], "packetSourceId": selected["packetSourceId"],
        "packetSha256": selected["expectedPacketSha256"], "caseId": row["caseId"],
        "planSha256": row["planSha256"], "phaseChecks": bindings}
    # A source refresh updates original commercial fields and preserves actual
    # deployment, native payment, receiving and independent acceptance selections.
    document["name"] = plan["title"]
    document["workorder"] = workorder_document(plan, document["workshare"])
    for field in ("name", "purpose", "request", "completeOutput"):
        plan_key = "title" if field == "name" else "outcome"
        previous_value = old_original["workshare"]["plan"][plan_key] if old_original else ""
        if not document["task"][field] or document["task"][field] == previous_value:
            document["task"][field] = plan[plan_key]
    document["assignments"]["commercialRef"] = row["caseId"] + " · plan " + row["planSha256"]
    linked = [selected["sourceId"]] + ([selected["packetSourceId"]] if selected["packetSourceId"] else [])
    document["source"]["sourceIds"] = list(dict.fromkeys([*document["source"]["sourceIds"], *linked]))
    document["payment"]["termsSourceIds"] = list(dict.fromkeys([*document["payment"]["termsSourceIds"], *linked]))
    old_reference = ("Original Workshare " + old_binding["caseId"] + " · plan " + old_binding["planSha256"]) if old_binding else ""
    if not document["source"]["reference"] or document["source"]["reference"] == old_reference:
        document["source"]["reference"] = "Original Workshare " + row["caseId"] + " · plan " + row["planSha256"]
    if not document["source"]["authority"] or (old_original and document["source"]["authority"] == old_original["workshare"]["plan"].get("rights", "")):
        document["source"]["authority"] = str(plan.get("rights", ""))
    if not document["source"]["changePolicy"] or (old_original and document["source"]["changePolicy"] == old_original["workshare"]["plan"].get("change_process", "")):
        document["source"]["changePolicy"] = str(plan.get("change_process", ""))
    document = installations.normalized(context, document)
    verify_document(operations, context, document)
    return {"schema": SCHEMA, "source": installations._source(context), "installationId": ident,
            "expectedRevision": number, "document": document,
            "workshare": {"caseId": row["caseId"], "planSha256": row["planSha256"],
                          "commercial": deepcopy(plan["commercial"]), "hours": row["hours"],
                          "phaseCount": len(plan["phases"]), "resetPhaseIds": reset},
            "sourceChanges": installations.differences(previous["preview"]["document"], document) if previous else []}


def html_section(original):
    if original is None:
        return ""
    row, binding = original["workshare"], original["binding"]
    plan, commercial = row["plan"], row["plan"]["commercial"]
    e = lambda value: escape(str(value), quote=True)
    html = "<h2>Original commercial Workshare</h2><p>" + e(plan["title"]) + " · " + e(plan["customer"]) + \
        " / " + e(plan["supplier"]) + "</p><p>" + e(commercial["currency"]) + " " + e(commercial["amount"]) + \
        " · " + e(commercial["price_status"]) + " · " + e(row["hours"]) + " planned hours</p>"
    html += "<p>Original case " + e(binding["caseId"]) + " · plan SHA-256 " + e(binding["planSha256"]) + "</p>"
    html += "<table><thead><tr><th>Phase / owner</th><th>Effort / dependencies</th><th>Complete assignment and acceptance</th></tr></thead><tbody>"
    for phase in plan["phases"]:
        html += "<tr><td>" + e(phase["title"]) + "<br>" + e(phase["owner"]) + "</td><td>" + \
            e(row["effort"][phase["id"]]) + " hours<br>" + e(", ".join(phase["depends_on"])) + \
            "</td><td>" + e(phase["description"]) + "<br><strong>Acceptance:</strong> " + e(phase["acceptance"]) + "</td></tr>"
    html += "</tbody></table><details><summary>Complete original commissioning case and commercial terms</summary><pre>" + \
        e(json.dumps(original["commissioningCase"], ensure_ascii=False, indent=2)) + "</pre></details>"
    if original["receivingPacket"] is not None:
        html += "<details><summary>Complete original receiving packet</summary><pre>" + \
            e(json.dumps(original["receivingPacket"], ensure_ascii=False, indent=2)) + "</pre></details>"
    return html
