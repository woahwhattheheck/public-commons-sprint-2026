"""Source-bound customer billing through the existing Receivables authority.

The original SF47 database retains source selections and recoverable commands.
The configured native accounting workspace owns invoice amounts, documents,
numbers, payment state and balances.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import date
from decimal import Decimal

from model import Problem, canonical, digest, now, text
import operations_installations as installations
import operations_workshare_installations as workshares

SCHEMA = "stellar-forge.sf47-commercial-receivables.v1"
MAX_MINOR = (1 << 127) - 1
BILLING_BASES = ("PHASE_ACCEPTANCE", "COMMERCIAL_AUTHORIZATION")


def _object(value, label):
    if not isinstance(value, dict):
        raise Problem(label + " must be an object.")
    return value


def _required(value, label, limit=300):
    return text(value, label, limit, True)


def _integer(value, label, minimum=1, maximum=10000000):
    if type(value) is not int or not minimum <= value <= maximum:
        raise Problem(label + " must be an integer in the supported range.")
    return value


def _date(value, label):
    value = _required(value, label, 10)
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise Problem(label + " must be a calendar date (YYYY-MM-DD).") from error
    if parsed.isoformat() != value:
        raise Problem(label + " must use YYYY-MM-DD.")
    return value


def _amount(value, scale, label):
    # Monetary tokens come from original JSON parsed with parse_float=str.
    # Binary floats never enter this conversion.
    if type(value) is int:
        value = str(value)
    if not isinstance(value, str) or not re.fullmatch(
            r"(0|[1-9][0-9]{0,38})(?:\.[0-9]+)?", value):
        raise Problem(label + " must be an unsigned decimal amount.")
    whole, dot, fraction = value.partition(".")
    if len(fraction) > scale:
        raise Problem(label + " exceeds the selected currency precision.",
                      422, "COMMERCIAL_PRECISION")
    units = int(whole + fraction.ljust(scale, "0"))
    if units > MAX_MINOR:
        raise Problem(label + " exceeds the native Receivables amount range.")
    rendered = str(units).rjust(scale + 1, "0")
    return ((rendered[:-scale] + "." + rendered[-scale:]) if scale
            else rendered), units


def _ids(value, label):
    if not isinstance(value, list):
        raise Problem(label + " must be an array.")
    result = [_required(item, label, 300) for item in value]
    if len(result) != len(set(result)):
        raise Problem(label + " must not contain duplicates.")
    return result


def install(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS ops_commercial_receivables (
            id TEXT NOT NULL,
            program_id TEXT NOT NULL,
            body_json TEXT NOT NULL,
            PRIMARY KEY(program_id, id)
        );
        CREATE INDEX IF NOT EXISTS ops_commercial_program
            ON ops_commercial_receivables(program_id);
        CREATE TABLE IF NOT EXISTS ops_commercial_obligations (
            obligation_key TEXT PRIMARY KEY,
            body_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ops_commercial_intents (
            id TEXT PRIMARY KEY,
            obligation_key TEXT NOT NULL,
            action TEXT NOT NULL,
            body_json TEXT NOT NULL,
            UNIQUE(obligation_key, action)
        );
    """)


def _review_edition(prepared, milestone, review, edition):
    """Join a frozen issue review to its exact native installation evidence."""
    _object(review, "Original issue review")
    _object(edition, "Reviewed installation edition")
    identity = {key: edition[key] for key in ("id", "revision", "sha256")}
    if digest({key: item for key, item in edition.items()
               if key != "sha256"}) != edition["sha256"]:
        raise Problem("The reviewed installation edition changed.",
                      409, "COMMERCIAL_SOURCE_CHANGED")
    snapshot = edition["preview"]["snapshot"]
    document = edition["preview"]["document"]
    binding = document.get("workshare", {})
    source = prepared["schedule"]["source"]
    if (binding.get("caseId") != source["caseId"]
            or binding.get("planSha256") != source["planSha256"]):
        raise Problem("The reviewed installation identifies another original workshare.",
                      409, "COMMERCIAL_SOURCE_CHANGED")
    evidence = _object(review.get("eligibility"), "Reviewed acceptance evidence")
    checks = {row["id"]: row for row in document["checks"]}
    recorded_checks = evidence.get("checks", [])
    check_ids = [row["id"] for row in recorded_checks]
    authorization_ids = [row["id"] for row in evidence.get("authorizationSources", [])]
    if (len(check_ids) != len(set(check_ids))
            or set(check_ids) != set(milestone["requiredCheckIds"])
            or not set(check_ids) <= set(checks)
            or len(authorization_ids) != len(set(authorization_ids))
            or set(authorization_ids) != set(milestone["authorizationSourceIds"])):
        raise Problem("The reviewed installation omitted or changed its selected evidence.",
                      409, "COMMERCIAL_SOURCE_CHANGED")
    selected = [copy.deepcopy(checks[key]) for key in check_ids]
    original_sources = prepared["sourceSnapshot"]["installation"]["preview"]["snapshot"]["sources"]
    awaiting = [row["id"] for row in selected if row["state"] != "ACCEPTED"]
    expected = {
        "ready": not awaiting, "billingBasis": milestone["billingBasis"],
        "installation": identity, "checks": selected, "awaitingCheckIds": awaiting,
        "authorizationNote": milestone["authorizationNote"],
        "authorizationSources": [copy.deepcopy(original_sources[key])
                                 for key in authorization_ids]}
    expected["evidenceSha256"] = digest(expected)
    if not expected["ready"] or review.get("eligibility") != expected:
        raise Problem("The issue review differs from its original acceptance evidence.",
                      409, "COMMERCIAL_SOURCE_CHANGED")
    return snapshot


def _prepared_specification(prepared, milestone):
    schedule = prepared["schedule"]
    return {
        "workspaceId": prepared["accountingIdentity"]["workspaceId"],
        "customerId": prepared["customerId"], "caseId": schedule["source"]["caseId"],
        "sourceIndex": milestone["sourceIndex"],
        "planSha256": schedule["source"]["planSha256"],
        "sourceMilestoneSha256": milestone["sourceSha256"],
        "currency": schedule["currency"], "amount": milestone["amount"],
        "issueDate": milestone["issueDate"], "dueDate": milestone["dueDate"],
        "billingBasis": milestone["billingBasis"],
        "requiredCheckIds": sorted(milestone["requiredCheckIds"]),
        "authorizationSourceIds": sorted(milestone["authorizationSourceIds"]),
        "authorizationNote": milestone["authorizationNote"],
        "purchaseOrder": prepared["purchaseOrder"], "note": prepared["note"]}


def _same_preparation(obligation, prepared, milestone):
    selected_sha = milestone.get("specificationSha256") or digest(
        _prepared_specification(prepared, milestone))
    return (obligation["specificationSha256"] == selected_sha
            and obligation.get("specificationRevision", 1)
            == milestone.get("specificationRevision", 1))


def _historical_specification(obligation, prepared, milestone):
    selected_sha = milestone.get("specificationSha256") or digest(
        _prepared_specification(prepared, milestone))
    revision = milestone.get("specificationRevision", 1)
    for row in [obligation, *obligation.get("specificationHistory", [])]:
        if (row["specificationSha256"] == selected_sha
                and row.get("specificationRevision", 1) == revision):
            return row["specification"]
    raise Problem("The original preparation is absent from its billing history.",
                  409, "COMMERCIAL_SOURCE_CHANGED")


def _external_command_reference(obligation, intent, missing_sources=None):
    """Keep a foreign prepared case's command identity without importing its authority."""
    return {
        "requestId": intent["id"], "obligationKey": intent["obligationKey"],
        "action": intent["action"],
        "programId": intent.get("programId", obligation["programId"]),
        "preparedId": intent.get("preparedId") or (intent.get("review") or {}).get("id")
                      or obligation["preparedId"],
        "specificationSha256": obligation["specificationSha256"],
        "specificationRevision": obligation.get("specificationRevision", 1),
        "missingSourceIds": sorted(missing_sources or [])}


def validate_import(value, reader=None):
    """Validate the retained source/command graph before the original case import."""
    value = _object(value, "Commercial export")
    if value.get("schema") != SCHEMA:
        raise Problem("Commercial export has an unsupported schema.")
    value = copy.deepcopy(value)
    for key in ("prepared", "obligations", "intents"):
        if not isinstance(value.get(key), list):
            raise Problem("Commercial export rows must be arrays.")
    external_rows = value.setdefault("externalCommands", [])
    if not isinstance(external_rows, list):
        raise Problem("Outside-case command references must be an array.")
    external_commands = {}
    for reference in external_rows:
        _object(reference, "Outside-case command reference")
        request_id = _required(reference.get("requestId"), "Native request identity", 100)
        if request_id in external_commands:
            raise Problem("Commercial export repeats an outside-case command.")
        external_commands[request_id] = reference
    obligations = {}
    for row in value["obligations"]:
        _object(row, "Commercial obligation")
        key = _required(row.get("obligationKey"), "Obligation identity", 64)
        if key in obligations:
            raise Problem("Commercial export repeats an obligation identity.")
        specification = _object(row.get("specification"), "Original billing terms")
        if digest(specification) != row.get("specificationSha256"):
            raise Problem("Commercial obligation hash does not match.")
        if digest({name: specification[name] for name in
                   ("workspaceId", "caseId", "sourceIndex")}) != key:
            raise Problem("Commercial obligation identity differs from its original case.")
        revision = _integer(row.get("specificationRevision", 1), "Billing terms revision")
        history = row.get("specificationHistory", [])
        if not isinstance(history, list) or len(history) != revision - 1:
            raise Problem("The original billing terms history is incomplete.")
        for index, previous in enumerate(history, 1):
            if previous.get("specificationRevision") != index:
                raise Problem("The original billing terms history changed order.")
            prior_spec = _object(previous.get("specification"), "Prior billing terms")
            if digest(prior_spec) != previous.get("specificationSha256"):
                raise Problem("An original billing terms revision changed.")
            if digest({name: prior_spec[name] for name in
                       ("workspaceId", "caseId", "sourceIndex")}) != key:
                raise Problem("The billing history identifies another original obligation.")
        obligations[key] = row
    prepared_ids, linked_keys = set(), set()
    for prepared in value["prepared"]:
        _object(prepared, "Prepared commercial schedule")
        if prepared.get("id") in prepared_ids:
            raise Problem("Commercial export repeats a preparation.")
        prepared_ids.add(prepared["id"])
        original = {key: item for key, item in prepared.items() if key != "preparedSha256"}
        if digest(original) != prepared.get("preparedSha256"):
            raise Problem("Prepared commercial source hash does not match.",
                          422, "COMMERCIAL_EXPORT_CHANGED")
        schedule = prepared["schedule"]
        if digest({key: item for key, item in schedule.items()
                   if key != "scheduleSha256"}) != schedule.get("scheduleSha256"):
            raise Problem("Commercial schedule hash does not match.")
        edition = prepared["sourceSnapshot"]["installation"]
        if digest({key: item for key, item in edition.items()
                   if key != "sha256"}) != edition.get("sha256"):
            raise Problem("Original installation edition hash does not match.")
        if schedule["installation"] != {
                "id": edition["id"], "revision": edition["revision"], "sha256": edition["sha256"]}:
            raise Problem("Commercial selection differs from its original installation edition.")
        if reader is not None:
            preview = edition["preview"]
            resolved = workshares.verify_document(
                None, preview["snapshot"], preview["document"], reader)
            if not resolved or any(resolved["binding"].get(key) != source
                                   for key, source in schedule["source"].items()):
                raise Problem("Commercial source binding differs from its original workshare.")
        for milestone in prepared["milestones"]:
            key = milestone["obligationKey"]
            linked_keys.add(key)
            if key not in obligations:
                raise Problem("Commercial export omitted an original obligation.")
            expected = _historical_specification(obligations[key], prepared, milestone)
            if expected != _prepared_specification(prepared, milestone):
                raise Problem("Commercial milestone no longer matches its retained billing terms.")
    if set(obligations) != linked_keys:
        raise Problem("Commercial export has unrelated obligation rows.")
    seen_intents, observed_external = set(), set()
    for intent in value["intents"]:
        _object(intent, "Retained native command")
        key = intent.get("obligationKey")
        action = intent.get("action")
        if key not in obligations or action not in ("draft", "issue"):
            raise Problem("Commercial intent has no original obligation or supported action.")
        pair = (key, action)
        if pair in seen_intents:
            raise Problem("Commercial export repeats a native command.")
        seen_intents.add(pair)
        payload = _object(intent.get("payload"), "Retained native payload")
        request_id = "workshare-" + key[:40] + "-" + action
        if intent.get("id") != request_id or payload.get("requestId") != request_id:
            raise Problem("Commercial export changed an original native request identity.")
        if digest({"action": action, "value": payload}) != intent.get("intentSha256"):
            raise Problem("Retained native command hash does not match.")
        if intent.get("state") not in ("PENDING", "ACKNOWLEDGED"):
            raise Problem("Commercial command has an unsupported acknowledgement state.")
        if intent["accountingIdentity"]["workspaceId"] != obligations[key]["specification"]["workspaceId"]:
            raise Problem("Commercial command identifies another accounting workspace.")
        if (intent.get("specificationSha256", obligations[key]["specificationSha256"])
                != obligations[key]["specificationSha256"]
                or intent.get("specificationRevision", 1)
                != obligations[key].get("specificationRevision", 1)):
            raise Problem("A retained native command belongs to superseded billing terms.")
        candidates = [(prepared, milestone)
                      for prepared in value["prepared"]
                      for milestone in prepared["milestones"]
                      if milestone["obligationKey"] == key
                      and _same_preparation(obligations[key], prepared, milestone)]
        external_reference = external_commands.get(intent["id"])
        missing_sources = []
        if external_reference is not None:
            missing_sources = _ids(external_reference.get("missingSourceIds", []),
                                   "Outside-case source references")
            expected_reference = _external_command_reference(
                obligations[key], intent, missing_sources)
            if external_reference != expected_reference or (candidates and not missing_sources):
                raise Problem("The outside-case command reference differs from its original scope.")
            observed_external.add(intent["id"])
        elif not candidates:
            # A received copy can correct unused terms and later bill. An older
            # case keeps that exact native journal so reopening cannot clear its
            # command lock, but does not acquire the other case's billing authority.
            raise Problem("This native command belongs to a preparation outside the "
                          "exported case. Retain its outside-case reference or include "
                          "its complete original preparation and sources.",
                          422, "COMMERCIAL_EXPORT_SOURCE_GRAPH")
        if action == "issue":
            review = _object(intent.get("review"), "Original issue review")
            edition = review.get("installationEdition")
            if edition is not None:
                if candidates:
                    prepared, milestone = next(
                        (pair for pair in candidates if pair[0]["id"] == review.get("id")),
                        candidates[0])
                else:
                    # Validate the frozen edition and its selected evidence against
                    # the exact shared specification. Source bytes remain with the
                    # originating case named above and are not part of this case.
                    specification = obligations[key]["specification"]
                    authorization = review["eligibility"].get("authorizationSources", [])
                    prepared = {
                        "schedule": {"source": {
                            "caseId": specification["caseId"],
                            "planSha256": specification["planSha256"]}},
                        "sourceSnapshot": {"installation": {"preview": {"snapshot": {
                            "sources": {row["id"]: row for row in authorization}}}}}}
                    milestone = {name: specification[name] for name in (
                        "requiredCheckIds", "authorizationSourceIds",
                        "authorizationNote", "billingBasis")}
                snapshot = _review_edition(prepared, milestone, review, edition)
                if not set(missing_sources) <= set(snapshot["sources"]):
                    raise Problem("The outside-case command references unrelated source files.")
                if reader is not None:
                    available = {}
                    for source_id, metadata in snapshot["sources"].items():
                        try:
                            content = reader(source_id)
                        except (KeyError, Problem) as error:
                            absent = isinstance(error, KeyError) or error.status == 404
                            if source_id in missing_sources and absent:
                                continue
                            raise
                        if (not isinstance(content, bytes)
                                or len(content) != metadata["bytes"]
                                or hashlib.sha256(content).hexdigest() != metadata["sha256"]):
                            raise Problem("A reviewed acceptance source differs from its original file.",
                                          422, "COMMERCIAL_SOURCE_CHANGED")
                        available[source_id] = content
                    binding = edition["preview"]["document"].get("workshare", {})
                    binding_ids = {binding.get(name) for name in ("sourceId", "packetSourceId")}
                    if binding_ids - {None, ""} <= set(available):
                        workshares.verify_document(
                            None, snapshot, edition["preview"]["document"],
                            lambda ident: available[ident])
            elif missing_sources:
                raise Problem("Outside-case evidence requires its frozen installation edition.")
        elif missing_sources:
            raise Problem("A draft command cannot declare issue evidence outside this case.")
    if set(external_commands) != observed_external:
        raise Problem("Commercial export has unrelated outside-case command references.")
    return value


class CommercialReceivables:
    def __init__(self, operations, adapter=None):
        self.operations = operations
        self.workspace = operations.workspace
        self.db = operations.db
        self.adapter = adapter
        with self.workspace.mutex:
            install(self.db)

    def _native(self, operation, payload):
        if self.adapter is None:
            raise Problem("Configure a customer accounting connection.",
                          503, "RECEIVABLES_NOT_CONFIGURED")
        result = self.adapter(operation, copy.deepcopy(payload))
        if not isinstance(result, dict):
            raise Problem("The accounting service returned an invalid response.",
                          502, "RECEIVABLES_RESPONSE")
        return result

    def _write(self, action):
        # Original workspace lock and SQLite transaction; no adapter effects inside.
        with self.workspace.mutex:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                result = action()
                self.db.execute("COMMIT")
                return result
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def _plan(self, program_id, prepared_id):
        row = self.db.execute(
            "SELECT body_json FROM ops_commercial_receivables "
            "WHERE id=? AND program_id=?", (prepared_id, program_id)).fetchone()
        if not row:
            raise Problem("Prepared commercial schedule was not found.",
                          404, "COMMERCIAL_NOT_FOUND")
        value = json.loads(row[0])
        if digest({key: item for key, item in value.items()
                   if key != "preparedSha256"}) != value.get("preparedSha256"):
            raise Problem("Prepared commercial source hash does not match.",
                          409, "COMMERCIAL_SOURCE_CHANGED")
        return value

    def _obligation(self, key):
        row = self.db.execute(
            "SELECT body_json FROM ops_commercial_obligations "
            "WHERE obligation_key=?", (key,)).fetchone()
        if not row:
            raise Problem("Commercial milestone link was not found.",
                          404, "COMMERCIAL_NOT_FOUND")
        return json.loads(row[0])

    def _save_obligation(self, value):
        self.db.execute(
            "UPDATE ops_commercial_obligations SET body_json=? "
            "WHERE obligation_key=?", (canonical(value), value["obligationKey"]))

    def _intent(self, key, action):
        row = self.db.execute(
            "SELECT body_json FROM ops_commercial_intents "
            "WHERE obligation_key=? AND action=?", (key, action)).fetchone()
        return json.loads(row[0]) if row else None

    def _source_schedule(self, program_id, body, check_version=True):
        context = self.operations._context(program_id)
        expected = _integer(body.get("expectedVersion"), "Program version")
        if check_version and context["program"]["version"] != expected:
            raise Problem("The program changed. Refresh the source selection.",
                          409, "VERSION_CONFLICT")
        installation_id = _required(body.get("installationId"), "Installation", 100)
        revision = _integer(body.get("installationRevision"), "Installation revision")
        selected = installations.get(self.operations, program_id,
                                     installation_id, revision)
        expected_sha = _required(body.get("expectedInstallationSha256"),
                                 "Installation SHA-256", 64)
        if selected["sha256"] != expected_sha:
            raise Problem("The selected installation edition changed.",
                          409, "COMMERCIAL_SOURCE_CHANGED")
        saved = selected["preview"]
        resolved = workshares.verify_document(
            self.operations, saved["snapshot"], saved["document"],
            lambda ident: self.operations.source(program_id, ident)[1])
        if not resolved:
            raise Problem("Select an installation bound to an original workshare.",
                          422, "COMMERCIAL_WORKSHARE_REQUIRED")
        binding = resolved["binding"]
        plan = resolved["workshare"]["plan"]
        source_meta, source_bytes = self.operations.source(program_id, binding["sourceId"])
        # Preserve native source verification and separately read exact money tokens.
        lexical = json.loads(bytes(source_bytes).decode("utf-8"), parse_float=str)
        original_case = next(
            row for row in lexical["cases"] if row["case_id"] == binding["caseId"])
        commercial = original_case["workshare_input"]["plan"]["commercial"]
        scale = _integer(body.get("currencyScale"), "Currency scale", 0, 6)
        code = commercial.get("currency")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z]{3}", code):
            raise Problem("The original workshare currency must be a three-letter "
                          "uppercase currency code.", 422, "COMMERCIAL_CURRENCY")
        amount, total_units = _amount(commercial.get("amount"), scale,
                                      "Workshare commercial amount")
        rows = commercial.get("milestones")
        if not isinstance(rows, list) or not rows or len(rows) > 250:
            raise Problem("The workshare must contain its original payment milestones.")
        milestones, sum_units = [], 0
        for index, row in enumerate(rows):
            _object(row, "Payment milestone")
            value, units = _amount(row.get("amount"), scale,
                                   "Milestone " + str(index + 1) + " amount")
            if units <= 0:
                raise Problem("Payment milestones must have a positive amount.")
            sum_units += units
            source_sha = digest(row)
            milestone_id = "milestone-" + digest({
                "caseId": binding["caseId"], "sourceIndex": index,
                "sourceSha256": source_sha})[:32]
            milestones.append({
                "milestoneId": milestone_id, "sourceIndex": index,
                "label": _required(row.get("label"), "Milestone label", 3000),
                "trigger": _required(row.get("trigger"), "Milestone trigger", 12000),
                "amount": value, "sourceAmount": row.get("amount"),
                "sourceSha256": source_sha, "original": copy.deepcopy(row)})
        if total_units <= 0 or sum_units != total_units:
            raise Problem("The exact milestone sum must equal the workshare amount.",
                          422, "COMMERCIAL_TOTAL")
        checks = {row["id"]: row for row in saved["document"]["checks"]}
        source = {key: binding.get(key) for key in (
            "sourceId", "sourceSha256", "packetSourceId", "packetSha256",
            "caseId", "planSha256")}
        result = {
            "schema": SCHEMA, "programId": program_id, "expectedVersion": expected,
            "installation": {"id": installation_id, "revision": revision,
                             "sha256": selected["sha256"]},
            "source": source, "customer": plan["customer"], "supplier": plan["supplier"],
            "title": plan["title"], "currency": {"code": code, "scale": scale},
            "amount": amount, "priceStatus": commercial.get("price_status"),
            "commercial": copy.deepcopy(commercial), "milestones": milestones,
            "phaseChecks": [dict(copy.deepcopy(item),
                                 **{key: copy.deepcopy(checks[item["checkId"]].get(key))
                                    for key in ("title", "criterion", "state", "sourceIds",
                                                "operator", "observedAt")})
                            for item in binding["phaseChecks"]]}
        result["scheduleSha256"] = digest(result)
        return result, selected, resolved

    def schedule(self, program_id, body):
        with self.workspace.mutex:
            return self._source_schedule(program_id, _object(body, "Selection"))[0]

    def _identity(self, endpoint_id):
        value = self._native("identity", {"endpointId": endpoint_id})
        if any(not isinstance(value.get(key), str) or not value[key]
               for key in ("workspaceId", "sourcesSha256")):
            raise Problem("The accounting connection has no original workspace binding.",
                          502, "RECEIVABLES_IDENTITY")
        return value

    @staticmethod
    def _assert_identity(expected, actual):
        if any(expected.get(key) != actual.get(key)
               for key in ("workspaceId", "sourcesSha256")):
            raise Problem("The accounting connection now identifies another workspace.",
                          409, "RECEIVABLES_IDENTITY_CHANGED")

    def prepare(self, program_id, body):
        body = _object(body, "Preparation")
        request_id = _required(body.get("requestId"), "Request ID", 100)
        actor = _required(body.get("actor"), "Recording operator", 300)
        endpoint_id = _required(body.get("endpointId"), "Accounting connection", 200)
        customer_id = _required(body.get("customerId"), "Customer", 100)
        if not re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                customer_id):
            raise Problem("Select an existing native accounting customer.")
        payload = {"domain": SCHEMA, "action": "prepare",
                   "programId": program_id, "body": body}
        fingerprint = digest(payload)
        # An original request replay precedes all current-version and service reads.
        with self.workspace.mutex:
            prior = self.db.execute(
                "SELECT fingerprint,result_json FROM requests WHERE request_id=?",
                (request_id,)).fetchone()
            if prior:
                if prior[0] != fingerprint:
                    raise Problem("This request ID already belongs to another action.",
                                  409, "REQUEST_CONFLICT")
                return self.get(program_id, json.loads(prior[1])["id"])
        identity = self._identity(endpoint_id)
        state = self._native("customers", {"endpointId": endpoint_id})
        customers = state.get("customers", state.get("state", {}).get("customers", []))
        customer = next((item for item in customers if item.get("id") == customer_id), None)
        if customer is None:
            raise Problem("The selected customer is absent from this accounting workspace.",
                          409, "COMMERCIAL_CUSTOMER")
        prepared_id = "commercial-" + uuid.uuid4().hex

        def action():
            schedule, installation, resolved = self._source_schedule(program_id, body)
            if body.get("expectedScheduleSha256") != schedule["scheduleSha256"]:
                raise Problem("Review the current complete commercial schedule.",
                              409, "COMMERCIAL_PREVIEW_CHANGED")
            mappings = body.get("milestones")
            if not isinstance(mappings, list):
                raise Problem("Provide the billing mapping for every original milestone.")
            by_id = {_required(item.get("milestoneId"), "Milestone", 100): item
                     for item in mappings if isinstance(item, dict)}
            if len(by_id) != len(mappings) or set(by_id) != {
                    item["milestoneId"] for item in schedule["milestones"]}:
                raise Problem("Map every original milestone exactly once.")
            phase_ids = {item["checkId"] for item in schedule["phaseChecks"]}
            source_ids = set(installation["preview"]["snapshot"]["sources"])
            purchase_order = text(body.get("purchaseOrder", ""), "Purchase order", 300)
            note = text(body.get("note", ""), "Billing note", 6000)
            linked = []
            for milestone in schedule["milestones"]:
                selected = by_id[milestone["milestoneId"]]
                basis = selected.get("billingBasis")
                if basis not in BILLING_BASES:
                    raise Problem("Choose phase acceptance or commercial authorization.")
                required_checks = _ids(selected.get("requiredCheckIds", []), "Required phase checks")
                if not set(required_checks) <= phase_ids:
                    raise Problem("Billing prerequisites must be original workshare phase checks.")
                authorization_ids = _ids(selected.get("authorizationSourceIds", []),
                                         "Commercial authorization sources")
                if not set(authorization_ids) <= source_ids:
                    raise Problem("Commercial authorization must cite retained source documents.")
                authorization_note = text(selected.get("authorizationNote", ""),
                                          "Commercial authorization", 6000)
                if basis == "PHASE_ACCEPTANCE" and not required_checks:
                    raise Problem("Select the phase checks that authorize this milestone.")
                if basis == "COMMERCIAL_AUTHORIZATION" and (
                        not authorization_ids or not authorization_note.strip()):
                    raise Problem("Record the commercial authorization and its source.")
                issue_date = _date(selected.get("issueDate"), "Issue date")
                due_date = _date(selected.get("dueDate"), "Due date")
                if due_date < issue_date:
                    raise Problem("The due date cannot precede the issue date.")
                # Stable across copied programs and source revisions. Changed
                # original obligations reconcile with their existing native invoice.
                obligation_key = digest({
                    "workspaceId": identity["workspaceId"],
                    "caseId": schedule["source"]["caseId"],
                    "sourceIndex": milestone["sourceIndex"]})
                specification = {
                    "workspaceId": identity["workspaceId"], "customerId": customer_id,
                    "caseId": schedule["source"]["caseId"],
                    "sourceIndex": milestone["sourceIndex"],
                    "planSha256": schedule["source"]["planSha256"],
                    "sourceMilestoneSha256": milestone["sourceSha256"],
                    "currency": schedule["currency"], "amount": milestone["amount"],
                    "issueDate": issue_date, "dueDate": due_date,
                    "billingBasis": basis, "requiredCheckIds": sorted(required_checks),
                    "authorizationSourceIds": sorted(authorization_ids),
                    "authorizationNote": authorization_note,
                    "purchaseOrder": purchase_order, "note": note}
                specification_sha = digest(specification)
                existing_row = self.db.execute(
                    "SELECT body_json FROM ops_commercial_obligations WHERE obligation_key=?",
                    (obligation_key,)).fetchone()
                if existing_row:
                    existing = json.loads(existing_row[0])
                    if existing["specificationSha256"] != specification_sha:
                        if (existing["invoiceId"] is not None
                                or self._intent(obligation_key, "draft") is not None
                                or self._intent(obligation_key, "issue") is not None):
                            raise Problem(
                                "This original milestone already has a retained accounting command. "
                                "Reconcile " + existing["preparedId"] + " in its native "
                                "accounting workspace before changing its source, payer or terms.",
                                409, "COMMERCIAL_OBLIGATION_EXISTS")
                        history = existing.setdefault("specificationHistory", [])
                        history.append({
                            "specificationRevision": existing.get("specificationRevision", 1),
                            "specificationSha256": existing["specificationSha256"],
                            "specification": copy.deepcopy(existing["specification"]),
                            "preparedId": existing["preparedId"], "programId": existing["programId"],
                            "milestoneId": existing["milestoneId"], "supersededAt": now(),
                            "recordingOperator": actor})
                        existing.update({
                            "specificationRevision": existing.get("specificationRevision", 1) + 1,
                            "specificationSha256": specification_sha,
                            "specification": specification, "preparedId": prepared_id,
                            "programId": program_id, "milestoneId": milestone["milestoneId"]})
                        self._save_obligation(existing)
                else:
                    existing = {
                        "obligationKey": obligation_key, "preparedId": prepared_id,
                        "programId": program_id, "milestoneId": milestone["milestoneId"],
                        "specificationSha256": specification_sha, "specification": specification,
                        "specificationRevision": 1, "specificationHistory": [],
                        "nativeRequestId": "workshare-" + obligation_key[:40] + "-draft",
                        "invoiceId": None, "native": None, "lastRefreshAt": None}
                    self.db.execute("INSERT INTO ops_commercial_obligations VALUES(?,?)",
                                    (obligation_key, canonical(existing)))
                linked.append(dict(copy.deepcopy(milestone), **{
                    "obligationKey": obligation_key, "nativeRequestId": existing["nativeRequestId"],
                    "specificationSha256": specification_sha,
                    "specificationRevision": existing.get("specificationRevision", 1),
                    "issueDate": issue_date, "dueDate": due_date, "billingBasis": basis,
                    "requiredCheckIds": required_checks,
                    "authorizationSourceIds": authorization_ids,
                    "authorizationNote": authorization_note}))
            prepared = {
                "schema": SCHEMA, "id": prepared_id, "programId": program_id,
                "createdAt": now(), "actor": actor, "requestId": request_id,
                "endpointId": endpoint_id, "accountingIdentity": identity,
                "customerId": customer_id, "nativeCustomer": copy.deepcopy(customer),
                "schedule": schedule, "milestones": linked,
                "purchaseOrder": purchase_order, "note": note,
                "sourceSnapshot": {
                    "installation": installation,
                    "commissioningCase": resolved["commissioningCase"],
                    "receivingPacket": resolved["receivingPacket"],
                    "workshare": resolved["workshare"]}}
            prepared["preparedSha256"] = digest(prepared)
            self.db.execute("INSERT INTO ops_commercial_receivables VALUES(?,?,?)",
                            (prepared_id, program_id, canonical(prepared)))
            return {"id": prepared_id}
        result = self.workspace._transaction(request_id, payload, action)
        return self.get(program_id, result["id"])

    def _selection(self, program_id, prepared_id, milestone_id):
        prepared = self._plan(program_id, prepared_id)
        milestone = next((row for row in prepared["milestones"]
                          if row["milestoneId"] == milestone_id), None)
        if milestone is None:
            raise Problem("Original commercial milestone was not found.",
                          404, "COMMERCIAL_NOT_FOUND")
        obligation = self._obligation(milestone["obligationKey"])
        if not _same_preparation(obligation, prepared, milestone):
            raise Problem("This preparation was superseded before billing. Open "
                          + obligation["preparedId"] + " to continue with the corrected terms.",
                          409, "COMMERCIAL_PREPARATION_SUPERSEDED")
        return prepared, milestone, obligation

    def _eligibility(self, prepared, milestone, program_id=None):
        program_id = program_id or prepared["programId"]
        try:
            obligation = self._obligation(milestone["obligationKey"])
            if not _same_preparation(obligation, prepared, milestone):
                raise Problem("This preparation was superseded before billing. Open "
                              + obligation["preparedId"] + " to continue.",
                              409, "COMMERCIAL_PREPARATION_SUPERSEDED")
            source = prepared["schedule"]["source"]
            selected = installations.get(
                self.operations, program_id, prepared["schedule"]["installation"]["id"])
            snapshot = selected["preview"]["snapshot"]
            document = selected["preview"]["document"]
            resolved = workshares.verify_document(
                self.operations, snapshot, document,
                lambda ident: self.operations.source(program_id, ident)[1])
            if (resolved is None or resolved["binding"]["caseId"] != source["caseId"]
                    or resolved["binding"]["planSha256"] != source["planSha256"]):
                raise Problem("The current installation has a different workshare. "
                              "Reconcile this original commercial obligation.",
                              409, "COMMERCIAL_SOURCE_CHANGED")
            checks = {row["id"]: row for row in document["checks"]}
            observations = []
            for check_id in milestone["requiredCheckIds"]:
                check = checks.get(check_id)
                if check is None:
                    raise Problem("A mapped original phase check is absent.",
                                  409, "COMMERCIAL_SOURCE_CHANGED")
                observations.append(copy.deepcopy(check))
            original_snapshot = prepared["sourceSnapshot"]["installation"]["preview"]["snapshot"]
            authorization_sources = []
            for source_id in milestone["authorizationSourceIds"]:
                metadata = original_snapshot["sources"][source_id]
                current_metadata, raw = self.operations.source(
                    program_id, source_id)
                if hashlib.sha256(bytes(raw)).hexdigest() != metadata["sha256"]:
                    raise Problem("An authorization source changed.",
                                  409, "COMMERCIAL_SOURCE_CHANGED")
                authorization_sources.append(copy.deepcopy(metadata))
            awaiting = [row["id"] for row in observations if row["state"] != "ACCEPTED"]
            result = {
                "ready": not awaiting, "billingBasis": milestone["billingBasis"],
                "installation": {"id": selected["id"], "revision": selected["revision"],
                                 "sha256": selected["sha256"]},
                "checks": observations, "awaitingCheckIds": awaiting,
                "authorizationNote": milestone["authorizationNote"],
                "authorizationSources": authorization_sources}
            result["evidenceSha256"] = digest(result)
            return result
        except Problem as error:
            return {"ready": False, "code": error.code, "message": str(error)}

    @staticmethod
    def _public_intent(intent):
        if intent is None:
            return None
        return {key: copy.deepcopy(intent.get(key)) for key in (
            "id", "action", "state", "actor", "createdAt", "updatedAt",
            "attempts", "lastError", "intentSha256", "native")}

    def get(self, program_id, prepared_id):
        with self.workspace.mutex:
            prepared = self._plan(program_id, prepared_id)
            result = copy.deepcopy(prepared)
            result["sourceProgramId"] = prepared["programId"]
            result["programId"] = program_id
            for milestone in result["milestones"]:
                obligation = self._obligation(milestone["obligationKey"])
                milestone["superseded"] = not _same_preparation(obligation, prepared, milestone)
                current = not milestone["superseded"]
                milestone["invoiceId"] = obligation["invoiceId"] if current else None
                milestone["native"] = obligation.get("native") if current else None
                milestone["lastRefreshAt"] = obligation.get("lastRefreshAt") if current else None
                milestone["origin"] = {
                    "programId": obligation["programId"],
                    "preparedId": obligation["preparedId"],
                    "milestoneId": obligation["milestoneId"]}
                milestone["draftIntent"] = self._public_intent(
                    self._intent(milestone["obligationKey"], "draft")) if current else None
                milestone["issueIntent"] = self._public_intent(
                    self._intent(milestone["obligationKey"], "issue")) if current else None
                milestone["eligibility"] = self._eligibility(prepared, milestone, program_id)
            return result

    def list(self, program_id):
        with self.workspace.mutex:
            self.operations._program(program_id)
            rows = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_commercial_receivables WHERE program_id=? ORDER BY rowid",
                (program_id,))]
            items = []
            for prepared in rows:
                counts = {"draftCount": 0, "issuedCount": 0, "voidCount": 0,
                          "pendingCount": 0, "supersededCount": 0}
                for milestone in prepared["milestones"]:
                    obligation = self._obligation(milestone["obligationKey"])
                    if not _same_preparation(obligation, prepared, milestone):
                        counts["supersededCount"] += 1
                        continue
                    status = (obligation.get("native") or {}).get("invoice", {}).get("status")
                    count = {"DRAFT": "draftCount", "ISSUED": "issuedCount",
                             "VOID": "voidCount"}.get(status)
                    if count:
                        counts[count] += 1
                    if any(intent and intent["state"] == "PENDING"
                           for intent in [self._intent(milestone["obligationKey"], action)
                                          for action in ("draft", "issue")]):
                        counts["pendingCount"] += 1
                items.append({
                    "id": prepared["id"], "createdAt": prepared["createdAt"],
                    "customerName": prepared["nativeCustomer"].get("name")
                                    or prepared["schedule"]["customer"],
                    "currency": prepared["schedule"]["currency"],
                    "amount": prepared["schedule"]["amount"],
                    "milestoneCount": len(prepared["milestones"]), **counts})
        return {"schema": SCHEMA, "programId": program_id, "items": items}

    def _remember_intent(self, prepared, milestone, action, payload, review=None, program_id=None):
        key = milestone["obligationKey"]
        request_id = "workshare-" + key[:40] + "-" + action
        payload = dict(copy.deepcopy(payload), requestId=request_id)
        fingerprint = digest({"action": action, "value": payload})
        def write():
            obligation = self._obligation(key)
            if not _same_preparation(obligation, prepared, milestone):
                raise Problem("The unused billing terms changed before this command was retained. "
                              "Open " + obligation["preparedId"] + " to continue.",
                              409, "COMMERCIAL_PREPARATION_SUPERSEDED")
            previous = self._intent(key, action)
            if previous:
                if previous["intentSha256"] != fingerprint:
                    raise Problem("This original milestone already has a retained "
                                  + action + " command. Resume its original request.",
                                  409, "COMMERCIAL_INTENT_CONFLICT")
                return previous
            retained_review = copy.deepcopy(review)
            if action == "issue":
                evidence = self._eligibility(prepared, milestone, program_id)
                if not evidence["ready"] or evidence != review["eligibility"]:
                    raise Problem("The selected billing prerequisites changed during review.",
                                  409, "COMMERCIAL_PREVIEW_CHANGED")
                selected = evidence["installation"]
                edition = installations.get(
                    self.operations, program_id or prepared["programId"],
                    selected["id"], selected["revision"])
                _review_edition(prepared, milestone, review, edition)
                retained_review["installationEdition"] = copy.deepcopy(edition)
            result = {
                "id": request_id, "obligationKey": key, "action": action,
                "programId": program_id or prepared["programId"], "preparedId": prepared["id"],
                "specificationSha256": obligation["specificationSha256"],
                "specificationRevision": obligation.get("specificationRevision", 1),
                "endpointId": prepared["endpointId"],
                "accountingIdentity": prepared["accountingIdentity"],
                "actor": payload["actor"], "createdAt": now(), "updatedAt": now(),
                "state": "PENDING", "attempts": 0, "lastError": None,
                "intentSha256": fingerprint, "payload": payload,
                "review": retained_review, "native": None}
            self.db.execute("INSERT INTO ops_commercial_intents VALUES(?,?,?,?)",
                            (request_id, key, action, canonical(result)))
            return result
        return self._write(write)

    def _update_intent(self, intent_id, update):
        def write():
            row = self.db.execute(
                "SELECT body_json FROM ops_commercial_intents WHERE id=?", (intent_id,)).fetchone()
            if not row:
                raise Problem("Retained billing command was not found.",
                              404, "COMMERCIAL_NOT_FOUND")
            intent = json.loads(row[0])
            update(intent)
            intent["updatedAt"] = now()
            self.db.execute(
                "UPDATE ops_commercial_intents SET body_json=? WHERE id=?",
                (canonical(intent), intent_id))
            return intent
        return self._write(write)

    def _run_intent(self, intent):
        # A completed local acknowledgement needs no second accounting mutation.
        with self.workspace.mutex:
            intent = self._intent(intent["obligationKey"], intent["action"])
        if intent["state"] == "ACKNOWLEDGED":
            return intent
        identity = self._identity(intent["endpointId"])
        self._assert_identity(intent["accountingIdentity"], identity)
        state_result = self._native("list", {"endpointId": intent["endpointId"]})
        state = state_result.get("state", state_result)
        revision = _integer(state.get("revision"), "Native accounting revision", 0)
        def attempting(value):
            if value["state"] != "ACKNOWLEDGED":
                value["attempts"] += 1
                value["lastAttemptRevision"] = revision
        intent = self._update_intent(intent["id"], attempting)
        if intent["state"] == "ACKNOWLEDGED":
            return intent
        # Native Receivables excludes only revision from its intent hash and checks
        # request identity before revision. A lost response can therefore recover
        # at the latest revision without changing actor, dates, amounts or request.
        payload = dict(copy.deepcopy(intent["payload"]),
                       endpointId=intent["endpointId"], revision=revision)
        try:
            native = self._native(intent["action"], payload)
            invoice = native.get("invoice", {})
            invoice_id = invoice.get("id") or native.get("operation", {}).get(
                "result", {}).get("invoiceId")
            if not isinstance(invoice_id, str) or not invoice_id:
                raise Problem("The native invoice response has no invoice identity.",
                              502, "RECEIVABLES_RESPONSE")
            def acknowledge():
                current = self._intent(intent["obligationKey"], intent["action"])
                obligation = self._obligation(intent["obligationKey"])
                if obligation["invoiceId"] not in (None, invoice_id):
                    raise Problem("The original milestone points to another native invoice.",
                                  409, "COMMERCIAL_INVOICE_CONFLICT")
                if current["state"] == "ACKNOWLEDGED":
                    return current
                current.update(state="ACKNOWLEDGED", updatedAt=now(),
                               lastError=None, native=copy.deepcopy(native))
                obligation["invoiceId"] = invoice_id
                obligation["native"] = {
                    "invoice": copy.deepcopy(invoice),
                    "revision": native.get("revision")}
                self._save_obligation(obligation)
                self.db.execute(
                    "UPDATE ops_commercial_intents SET body_json=? WHERE id=?",
                    (canonical(current), current["id"]))
                return current
            return self._write(acknowledge)
        except Exception as error:
            def failed(value):
                if value["state"] != "ACKNOWLEDGED":
                    value["lastError"] = {
                        "message": str(error) if isinstance(error, Problem)
                        else "The accounting request did not return a confirmed response.",
                        "code": getattr(error, "code", "RECEIVABLES_UNAVAILABLE"),
                        "status": getattr(error, "status", 502), "at": now()}
            self._update_intent(intent["id"], failed)
            if isinstance(error, Problem):
                raise
            raise Problem(
                "The accounting request did not return a confirmed response. "
                "Retry this retained command to recover its native result.",
                502, "RECEIVABLES_UNAVAILABLE") from error

    def _command_result(self, program_id, prepared_id, milestone_id, intent):
        return {
            "id": prepared_id, "milestoneId": milestone_id,
            "obligationKey": intent["obligationKey"],
            "requestId": intent["id"], "intent": self._public_intent(intent),
            "native": copy.deepcopy(intent["native"]),
            "commercial": self.get(program_id, prepared_id)}

    def draft(self, program_id, prepared_id, milestone_id, body):
        body = _object(body, "Draft request")
        actor = _required(body.get("actor"), "Recording operator", 300)
        with self.workspace.mutex:
            prepared, milestone, obligation = self._selection(
                program_id, prepared_id, milestone_id)
            self.operations.commercial_changes.assert_original(milestone["obligationKey"])
            prior = self._intent(milestone["obligationKey"], "draft")
        if prior:
            return self._command_result(
                program_id, prepared_id, milestone_id, self._run_intent(prior))
        source = prepared["schedule"]["source"]
        source_reference = (
            "Workshare " + source["caseId"] + "; milestone "
            + str(milestone["sourceIndex"] + 1) + "; plan " + source["planSha256"]
            + "; source " + source["sourceSha256"])
        _required(source_reference, "Native source reference", 1000)
        payload = {
            "actor": actor, "customerId": prepared["customerId"],
            "currency": prepared["schedule"]["currency"],
            "issueDate": milestone["issueDate"], "dueDate": milestone["dueDate"],
            "sourceReference": source_reference,
            "lines": [{"id": "milestone-" + str(milestone["sourceIndex"] + 1),
                       "description": milestone["label"], "quantity": "1",
                       "unitAmount": milestone["amount"]}]}
        if prepared["purchaseOrder"]:
            payload["purchaseOrder"] = prepared["purchaseOrder"]
        if prepared["note"]:
            payload["note"] = prepared["note"]
        intent = self._remember_intent(prepared, milestone, "draft", payload, program_id=program_id)
        return self._command_result(
            program_id, prepared_id, milestone_id, self._run_intent(intent))

    def _invoice_matches(self, prepared, milestone, native):
        document = native.get("document", {})
        if (document.get("customerId") != prepared["customerId"]
                or document.get("customer", {}).get("id") != prepared["customerId"]):
            raise Problem("The native invoice customer changed. Reconcile the original milestone.",
                          409, "COMMERCIAL_NATIVE_CHANGED")
        if document.get("currency") != prepared["schedule"]["currency"]:
            raise Problem("The native invoice currency changed. Reconcile the original milestone.",
                          409, "COMMERCIAL_NATIVE_CHANGED")
        scale = prepared["schedule"]["currency"]["scale"]
        total, units = _amount(document.get("totals", {}).get("total"), scale,
                               "Native invoice total")
        if total != milestone["amount"]:
            raise Problem("The native invoice total differs from the original milestone.",
                          409, "COMMERCIAL_NATIVE_CHANGED")
        if document.get("issueDate") != milestone["issueDate"] or (
                document.get("dueDate") != milestone["dueDate"]):
            raise Problem("The native invoice dates changed. Reconcile the prepared terms.",
                          409, "COMMERCIAL_NATIVE_CHANGED")
        lines = document.get("lines", [])
        if len(lines) != 1:
            raise Problem("The native draft lines changed. Reconcile the original milestone.",
                          409, "COMMERCIAL_NATIVE_CHANGED")
        line = lines[0]
        amount, units = _amount(line.get("unitAmount"), scale, "Native invoice line")
        discount, discount_units = _amount(line.get("discountAmount"), scale,
                                           "Native invoice discount")
        tax, tax_units = _amount(line.get("taxAmount"), scale, "Native invoice tax")
        if (line.get("id") != "milestone-" + str(milestone["sourceIndex"] + 1)
                or line.get("description") != milestone["label"]
                or Decimal(line.get("quantity", "0")) != Decimal(1)
                or amount != milestone["amount"] or discount_units or tax_units):
            raise Problem("The native draft line differs from the original milestone.",
                          409, "COMMERCIAL_NATIVE_CHANGED")
        with self.workspace.mutex:
            original = self._intent(milestone["obligationKey"], "draft")
        if original is None or document.get("sourceReference") != original["payload"]["sourceReference"]:
            raise Problem("The native draft source reference changed.",
                          409, "COMMERCIAL_NATIVE_CHANGED")

    def preview_issue(self, program_id, prepared_id, milestone_id, body=None):
        if body is not None:
            _object(body, "Issue preview")
        with self.workspace.mutex:
            prepared, milestone, obligation = self._selection(
                program_id, prepared_id, milestone_id)
            self.operations.commercial_changes.assert_original(milestone["obligationKey"])
            issue_intent = self._intent(milestone["obligationKey"], "issue")
            eligibility = self._eligibility(prepared, milestone, program_id)
        if issue_intent:
            return dict(copy.deepcopy(issue_intent["review"]),
                        retainedIntent=self._public_intent(issue_intent))
        if not obligation["invoiceId"]:
            raise Problem("Create or recover the native draft before reviewing issue.",
                          409, "COMMERCIAL_DRAFT_REQUIRED")
        identity = self._identity(prepared["endpointId"])
        self._assert_identity(prepared["accountingIdentity"], identity)
        native_preview = self._native("preview", {
            "endpointId": prepared["endpointId"], "invoiceId": obligation["invoiceId"]})
        self._invoice_matches(prepared, milestone, native_preview)
        result = {
            "id": prepared_id, "milestoneId": milestone_id,
            "invoiceId": obligation["invoiceId"], "eligibility": eligibility,
            "nativePreview": native_preview}
        result["issuePreviewSha256"] = digest({
            "preparedSha256": prepared["preparedSha256"],
            "milestoneId": milestone_id, "invoiceId": obligation["invoiceId"],
            "eligibility": eligibility,
            "nativePreviewSha256": native_preview["previewSha256"],
            "nativeExpectedVersion": native_preview["expectedVersion"]})
        return result

    def issue(self, program_id, prepared_id, milestone_id, body):
        body = _object(body, "Issue request")
        actor = _required(body.get("actor"), "Recording operator", 300)
        with self.workspace.mutex:
            prepared, milestone, obligation = self._selection(
                program_id, prepared_id, milestone_id)
            self.operations.commercial_changes.assert_original(milestone["obligationKey"])
            prior = self._intent(milestone["obligationKey"], "issue")
        if prior:
            # An interrupted issue may already have frozen the native invoice.
            # Resume its original command before requesting another draft preview.
            return self._command_result(
                program_id, prepared_id, milestone_id, self._run_intent(prior))
        preview = self.preview_issue(program_id, prepared_id, milestone_id)
        if body.get("expectedIssuePreviewSha256") != preview["issuePreviewSha256"]:
            raise Problem("Review the current native invoice and its billing prerequisites.",
                          409, "COMMERCIAL_PREVIEW_CHANGED")
        if not preview["eligibility"]["ready"]:
            raise Problem("The selected billing prerequisites are not complete.",
                          409, "COMMERCIAL_PREREQUISITES")
        payload = {
            "actor": actor, "invoiceId": obligation["invoiceId"],
            "expectedVersion": preview["nativePreview"]["expectedVersion"],
            "previewSha256": preview["nativePreview"]["previewSha256"]}
        intent = self._remember_intent(prepared, milestone, "issue", payload, preview, program_id=program_id)
        return self._command_result(
            program_id, prepared_id, milestone_id, self._run_intent(intent))

    def refresh(self, program_id, prepared_id, body=None):
        if body is not None:
            _object(body, "Refresh request")
        with self.workspace.mutex:
            prepared = self._plan(program_id, prepared_id)
        identity = self._identity(prepared["endpointId"])
        self._assert_identity(prepared["accountingIdentity"], identity)
        for milestone in prepared["milestones"]:
            with self.workspace.mutex:
                obligation = self._obligation(milestone["obligationKey"])
            if (not _same_preparation(obligation, prepared, milestone)
                    or not obligation["invoiceId"]):
                continue
            native = self._native("detail", {
                "endpointId": prepared["endpointId"], "invoiceId": obligation["invoiceId"]})
            if native.get("invoice", {}).get("id") != obligation["invoiceId"]:
                raise Problem("The accounting detail identified another invoice.",
                              502, "RECEIVABLES_RESPONSE")
            def record():
                value = self._obligation(milestone["obligationKey"])
                value["native"] = copy.deepcopy(native)
                value["lastRefreshAt"] = now()
                self._save_obligation(value)
            self._write(record)
        return self.get(program_id, prepared_id)

    def export_rows(self, program_id):
        """Original Operations exports can include these non-financial bridge rows."""
        with self.workspace.mutex:
            prepared = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_commercial_receivables WHERE program_id=? ORDER BY id",
                (program_id,))]
            keys = sorted({row["obligationKey"] for item in prepared
                           for row in item["milestones"]})
            obligations = [self._obligation(key) for key in keys]
            intents = [intent for key in keys for action in ("draft", "issue")
                       for intent in [self._intent(key, action)] if intent]
            by_key = {row["obligationKey"]: row for row in obligations}
            current_keys = {row["obligationKey"] for item in prepared
                            for row in item["milestones"]
                            if _same_preparation(by_key[row["obligationKey"]], item, row)}
            local_sources = self.operations._context(program_id)["sources"]
            external = []
            for intent in intents:
                edition = (intent.get("review") or {}).get("installationEdition")
                evidence_sources = (edition["preview"]["snapshot"]["sources"]
                                    if edition is not None else {})
                missing = []
                for source_id, metadata in evidence_sources.items():
                    local = local_sources.get(source_id)
                    if local is None:
                        missing.append(source_id)
                    elif any(local[name] != metadata[name] for name in ("sha256", "bytes")):
                        raise Problem("An original source identity describes different files.",
                                      409, "COMMERCIAL_SOURCE_CHANGED")
                if intent["obligationKey"] not in current_keys or missing:
                    external.append(_external_command_reference(
                        by_key[intent["obligationKey"]], intent, missing))
        return {"schema": SCHEMA, "programId": program_id,
                "prepared": prepared, "obligations": obligations, "intents": intents,
                "externalCommands": external}

    def restore_rows(self, program_id, value):
        """Restore inside the original Operations import transaction.

        Receiving program identity belongs to the table key. Original preparation,
        source editions, obligation identities and native intents remain unchanged.
        Host accounting connection configuration is intentionally host-local.
        """
        value = validate_import(
            value, reader=lambda ident: self.operations.source(program_id, ident)[1])
        prepared_rows = value["prepared"]
        obligation_rows = value["obligations"]
        intent_rows = value["intents"]
        for prepared in prepared_rows:
            existing = self.db.execute(
                "SELECT body_json FROM ops_commercial_receivables WHERE program_id=? AND id=?",
                (program_id, prepared["id"])).fetchone()
            if existing:
                if json.loads(existing[0]) != prepared:
                    raise Problem("An existing preparation differs from this import.",
                                  409, "COMMERCIAL_IMPORT_CONFLICT")
            else:
                self.db.execute("INSERT INTO ops_commercial_receivables VALUES(?,?,?)",
                                (prepared["id"], program_id, canonical(prepared)))
        incoming_intent_keys = {row["obligationKey"] for row in intent_rows}
        for obligation in obligation_rows:
            key = obligation["obligationKey"]
            existing = self.db.execute(
                "SELECT body_json FROM ops_commercial_obligations WHERE obligation_key=?",
                (key,)).fetchone()
            if not existing:
                self.db.execute("INSERT INTO ops_commercial_obligations VALUES(?,?)",
                                (key, canonical(obligation)))
                continue
            original = json.loads(existing[0])
            original_revision = original.get("specificationRevision", 1)
            incoming_revision = obligation.get("specificationRevision", 1)
            original_chain = {
                row["specificationRevision"]: row["specificationSha256"]
                for row in original.get("specificationHistory", [])}
            original_chain[original_revision] = original["specificationSha256"]
            incoming_chain = {
                row["specificationRevision"]: row["specificationSha256"]
                for row in obligation.get("specificationHistory", [])}
            incoming_chain[incoming_revision] = obligation["specificationSha256"]
            if any(original_chain[revision] != incoming_chain[revision]
                   for revision in set(original_chain) & set(incoming_chain)):
                raise Problem("The imported billing history diverges from a retained original "
                              "revision. Reconcile its existing obligation.",
                              409, "COMMERCIAL_IMPORT_CONFLICT")
            same = (original_revision == incoming_revision
                    and original["specificationSha256"] == obligation["specificationSha256"])
            if not same:
                incoming_history = {row["specificationRevision"]: row["specificationSha256"]
                                    for row in obligation.get("specificationHistory", [])}
                original_history = {row["specificationRevision"]: row["specificationSha256"]
                                    for row in original.get("specificationHistory", [])}
                local_commands = any(self._intent(key, action)
                                     for action in ("draft", "issue"))
                if (incoming_revision > original_revision
                        and incoming_history.get(original_revision)
                        == original["specificationSha256"]
                        and original["invoiceId"] is None and not local_commands):
                    self._save_obligation(obligation)
                    continue
                if (original_revision > incoming_revision
                        and original_history.get(incoming_revision)
                        == obligation["specificationSha256"]
                        and obligation.get("invoiceId") is None
                        and key not in incoming_intent_keys):
                    # Restore historical preparations without reverting corrected terms.
                    continue
                raise Problem("The imported billing history conflicts with a retained original "
                              "obligation or accounting command.",
                              409, "COMMERCIAL_IMPORT_CONFLICT")
            if (original["invoiceId"] is not None and obligation.get("invoiceId") is not None
                    and original["invoiceId"] != obligation["invoiceId"]):
                raise Problem("The original obligation has a different native invoice.",
                              409, "COMMERCIAL_IMPORT_CONFLICT")
            if original.get("invoiceId") is None and obligation.get("invoiceId"):
                self._save_obligation(obligation)
        for intent in intent_rows:
            existing = self._intent(intent["obligationKey"], intent["action"])
            if existing:
                if existing["intentSha256"] != intent["intentSha256"]:
                    raise Problem("An existing native command differs from this import.",
                                  409, "COMMERCIAL_IMPORT_CONFLICT")
                if existing["state"] == "ACKNOWLEDGED" or intent["state"] != "ACKNOWLEDGED":
                    continue
                self.db.execute(
                    "UPDATE ops_commercial_intents SET body_json=? WHERE id=?",
                    (canonical(intent), existing["id"]))
            else:
                self.db.execute("INSERT INTO ops_commercial_intents VALUES(?,?,?,?)",
                                (intent["id"], intent["obligationKey"],
                                 intent["action"], canonical(intent)))
        return {"schema": SCHEMA, "programId": program_id,
                "sourceProgramId": value.get("programId"),
                "prepared": len(prepared_rows), "obligations": len(obligation_rows),
                "intents": len(intent_rows)}

    def import_rows(self, program_id, value):
        """Standalone import wrapper; original Operations uses restore_rows."""
        return self._write(lambda: self.restore_rows(program_id, value))

    def export_bundle(self, program_id, prepared_id, body=None):
        if body is not None:
            _object(body, "Export request")
        with self.workspace.mutex:
            prepared = self._plan(program_id, prepared_id)
            for milestone in prepared["milestones"]:
                self._selection(program_id, prepared_id, milestone["milestoneId"])
            retained = self.export_rows(program_id)
            keys = {row["obligationKey"] for row in prepared["milestones"]}
            retained["prepared"] = [prepared]
            retained["obligations"] = [row for row in retained["obligations"]
                                       if row["obligationKey"] in keys]
            retained["intents"] = [row for row in retained["intents"]
                                   if row["obligationKey"] in keys]
            # All selected milestones passed current-preparation selection above.
            retained["externalCommands"] = []
            source_metadata, source_programs = {}, {}
            def select_sources(snapshot, originating_program=None):
                # Native snapshots already close check, work, purchase, outcome
                # and contributor references to their original source files.
                for source_id, metadata in snapshot["sources"].items():
                    previous = source_metadata.get(source_id)
                    if previous is not None and any(
                            previous[key] != metadata[key] for key in ("sha256", "bytes")):
                        raise Problem("An original source identity describes different files.",
                                      409, "COMMERCIAL_SOURCE_CHANGED")
                    source_metadata.setdefault(source_id, copy.deepcopy(metadata))
                    owners = source_programs.setdefault(source_id, [])
                    for owner in (program_id, originating_program, snapshot["program"]["id"]):
                        if owner and owner not in owners:
                            owners.append(owner)
            def read_retained_source(source_id):
                metadata = source_metadata[source_id]
                for owner in source_programs[source_id]:
                    try:
                        current_metadata, content = self.operations.source(owner, source_id)
                    except Problem as error:
                        if error.status == 404:
                            continue
                        raise
                    content = bytes(content)
                    if (len(content) != metadata["bytes"]
                            or hashlib.sha256(content).hexdigest() != metadata["sha256"]):
                        raise Problem("A retained commercial or acceptance source changed.",
                                      409, "COMMERCIAL_SOURCE_CHANGED")
                    return content
                # Original case imports receive new Program IDs while preserving
                # immutable source IDs. A retained copy of the exact same source
                # can therefore close this read-only export after either case is
                # reopened, without rewriting its frozen originating identities.
                for row in self.db.execute(
                        "SELECT content FROM ops_sources WHERE id=? ORDER BY program_id",
                        (source_id,)):
                    content = bytes(row[0])
                    if (len(content) == metadata["bytes"]
                            and hashlib.sha256(content).hexdigest() == metadata["sha256"]):
                        return content
                raise Problem("The original acceptance file " + source_id
                              + " belongs to the linked case. Receive that case's complete "
                              "source archive before exporting this customer handoff.",
                              404, "COMMERCIAL_SOURCE_NOT_RETAINED")
            select_sources(prepared["sourceSnapshot"]["installation"]["preview"]["snapshot"],
                           prepared["programId"])
            issue_intents = {row["obligationKey"]: row for row in retained["intents"]
                             if row["action"] == "issue"}
            acceptance, evidence_files = [], {}
            for milestone in prepared["milestones"]:
                intent = issue_intents.get(milestone["obligationKey"])
                if intent is None:
                    continue
                review = _object(intent.get("review"), "Original issue review")
                edition = review.get("installationEdition")
                if edition is None:
                    # Earlier commands retained the edition identity. Resolve
                    # that exact saved revision; a later acceptance cannot replace it.
                    selected = review["eligibility"]["installation"]
                    edition = installations.get(self.operations, program_id,
                                                selected["id"], selected["revision"])
                snapshot = _review_edition(prepared, milestone, review, edition)
                select_sources(snapshot, intent.get("programId"))
                workshares.verify_document(
                    None, snapshot, edition["preview"]["document"], read_retained_source)
                path = "acceptance/installations/" + edition["sha256"] + ".json"
                evidence_files[path] = (canonical(edition) + "\n").encode("utf-8")
                acceptance.append({
                    "milestoneId": milestone["milestoneId"],
                    "obligationKey": milestone["obligationKey"],
                    "requestId": intent["id"], "commandState": intent["state"],
                    "evidenceSha256": review["eligibility"]["evidenceSha256"],
                    "installation": {key: edition[key] for key in ("id", "revision", "sha256")},
                    "file": path})
            sources = []
            for source_id, metadata in sorted(source_metadata.items()):
                sources.append((source_id, metadata, read_retained_source(source_id)))
        identity = self._identity(prepared["endpointId"])
        self._assert_identity(prepared["accountingIdentity"], identity)
        native = self._native("export", {
            "endpointId": prepared["endpointId"], "customerId": prepared["customerId"]})
        try:
            account_bytes = base64.b64decode(native["contentBase64"], validate=True)
        except (ValueError, KeyError, TypeError) as error:
            raise Problem("The native customer export could not be read.",
                          502, "RECEIVABLES_RESPONSE") from error
        if native.get("mediaType") != "application/x-tar":
            raise Problem("The native customer export must be the original account archive.",
                          502, "RECEIVABLES_RESPONSE")
        invoice_files, linked_invoices = {}, []
        invoice_ids = sorted({row["invoiceId"] for row in retained["obligations"]
                              if row.get("invoiceId")})
        for invoice_id in invoice_ids:
            detail = self._native("detail", {
                "endpointId": prepared["endpointId"], "invoiceId": invoice_id})
            invoice = detail.get("invoice", {})
            if invoice.get("id") != invoice_id:
                raise Problem("The accounting detail identified another invoice.",
                              502, "RECEIVABLES_RESPONSE")
            if invoice.get("customerId") != prepared["customerId"]:
                raise Problem("A linked invoice now belongs to another customer. "
                              "Reconcile the original milestone in accounting.",
                              409, "COMMERCIAL_NATIVE_CHANGED")
            document = detail.get("document")
            if document is None:
                continue
            # The account archive retains its original as-of date. Include each
            # linked immutable issued document separately, including postdated
            # invoices that do not yet appear in that account's dated balances.
            retained_files = _object(detail.get("files"), "Native invoice files")
            descriptors = []
            for name in ("invoice.json", "invoice.csv", "invoice.html", "manifest.json"):
                metadata = _object(retained_files.get(name), "Retained invoice document")
                item = self._native("document", {
                    "endpointId": prepared["endpointId"],
                    "invoiceId": invoice_id, "name": name})
                try:
                    content = base64.b64decode(item["contentBase64"], validate=True)
                except (ValueError, KeyError, TypeError) as error:
                    raise Problem("An original invoice document could not be read.",
                                  502, "RECEIVABLES_RESPONSE") from error
                sha256 = hashlib.sha256(content).hexdigest()
                if len(content) != metadata.get("bytes") or sha256 != metadata.get("sha256"):
                    raise Problem("The invoice document differs from its original retained file.",
                                  502, "RECEIVABLES_RESPONSE")
                path = "native/invoices/" + hashlib.sha256(
                    invoice_id.encode("utf-8")).hexdigest() + "/" + name
                invoice_files[path] = content
                descriptors.append({
                    "path": path, "filename": item.get("filename", name),
                    "mediaType": item.get("mediaType", "application/octet-stream"),
                    "bytes": len(content), "sha256": sha256})
            linked_invoices.append({
                "invoiceId": invoice_id, "number": document["number"],
                "issueDate": document["issueDate"], "issuedAt": document["issuedAt"],
                "files": descriptors})
        files = {
            "commercial.json": (canonical(retained) + "\n").encode("utf-8"),
            "native/customer-account.tar": account_bytes,
            "sources/index.json": (canonical([
                {"sourceId": source_id, "metadata": metadata,
                 "file": "sources/" + hashlib.sha256(source_id.encode("utf-8")).hexdigest() + ".bin"}
                for source_id, metadata, content in sources]) + "\n").encode("utf-8")}
        files.update(invoice_files)
        if linked_invoices:
            files["native/linked-invoices.json"] = (canonical(linked_invoices) + "\n").encode("utf-8")
        files.update(evidence_files)
        if acceptance:
            files["acceptance/index.json"] = (canonical(acceptance) + "\n").encode("utf-8")
        for source_id, metadata, content in sources:
            files["sources/" + hashlib.sha256(source_id.encode("utf-8")).hexdigest() + ".bin"] = content
        manifest = {
            "schema": SCHEMA, "preparedId": prepared_id, "programId": program_id,
            "createdAt": now(), "accountingIdentity": prepared["accountingIdentity"],
            "customerId": prepared["customerId"],
            "files": [{"path": path, "bytes": len(content),
                       "sha256": hashlib.sha256(content).hexdigest()}
                      for path, content in sorted(files.items())]}
        files["manifest.json"] = (canonical(manifest) + "\n").encode("utf-8")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for path, content in sorted(files.items()):
                archive.writestr(path, content)
        content = output.getvalue()
        return {
            "filename": prepared_id + "-customer-account.zip",
            "mediaType": "application/zip",
            "contentBase64": base64.b64encode(content).decode("ascii"),
            "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
            "manifest": manifest}
