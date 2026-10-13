"""Source-backed milestone corrections using the original Receivables commands.

The grant case owns customer authorization, reviewed plans and command recovery.
The accounting workspace owns every invoice, credit, allocation and payment.
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

from decimal import Decimal

from model import Problem, canonical, digest, now
from operations_commercial_receivables import (_object, _required, _date, _amount, _ids,
                                               _review_edition, installations)

SCHEMA = "stellar-forge.commercial-milestone-changes.v1"
MODES = ("DRAFT_EDIT", "CREDIT", "VOID", "REPLACE")
MAX_SOURCE_BYTES = 32 * 1024 * 1024

# These action-specific codes occur after native request replay and before that
# action's durable commit in receivables/store.mjs, core.mjs or checkIssue().
# Generic validation, I/O, response decoding and commit uncertainty are excluded:
# _result() can fail after commit, so an HTTP status alone never proves rejection.
NATIVE_PRECOMMIT_REJECTIONS = {
    "draft": frozenset(("INVALID_INVOICE_DRAFT", "INVALID_INVOICE_DATES",
        "INVALID_INVOICE_LINES", "INVALID_INVOICE_LINE", "DUPLICATE_INVOICE_LINE",
        "INVALID_LINE_DISCOUNT", "INVALID_REPLACEMENT_INVOICE",
        "INVOICE_ALREADY_ISSUED", "QUOTE_CUSTOMER_BINDING_CHANGED", "STALE_INVOICE")),
    "issue": frozenset(("INVOICE_ALREADY_ISSUED", "STALE_INVOICE",
        "INVOICE_PREVIEW_CHANGED", "MERCHANT_NAME_REQUIRED", "EMPTY_INVOICE",
        "INVOICE_NUMBER_EXISTS", "INVOICE_CUSTOMER_CHANGED", "CREDIT_POLICY_DISABLED",
        "CREDIT_DECISION_STALE", "CREDIT_REVIEW_REQUIRED")),
    "credit": frozenset(("ISSUED_INVOICE_REQUIRED", "INVALID_CREDIT_NOTE",
        "INVALID_CREDIT_DATE", "INVALID_CREDIT_LINES", "INVALID_CREDIT_LINE",
        "EMPTY_CREDIT_LINE", "CREDIT_EXCEEDS_INVOICE_LINE", "CREDIT_NUMBER_EXISTS")),
    "void": frozenset(("INVOICE_ALREADY_VOID", "INVALID_VOID_DATE",
        "INVOICE_HAS_CREDITS", "INVOICE_HAS_PAYMENTS")),
}


def _native_rejected(action, code):
    return code == "STALE_WORKSPACE" or code in NATIVE_PRECOMMIT_REJECTIONS.get(action, ())



def _fail(message, code="COMMERCIAL_CHANGE_CONFLICT", status=409):
    raise Problem(message, status, code)


def _fingerprint(detail):
    # Native summary balances vary with the date. Retain the actual source records.
    return digest({key: detail.get(key) for key in
                   ("draft", "document", "credits", "allocations",
                    "files", "sourceQuote", "history")} | {
                       "receipts": [{key: row.get(key) for key in ("id", "customerId", "currency", "amount", "receivedDate",
                                    "accountingDate", "sourceKey", "source", "status", "voidDate", "history")}
                                    for row in detail.get("receipts", [])],
                       "invoice": {key: detail["invoice"].get(key) for key in
                                   ("id", "status", "version", "customerId", "currency", "voidDate")}})


def _unscaled(value, scale, label):
    return _amount(value, scale, label)[1]


def _money(value, scale):
    raw = str(value).rjust(scale + 1, "0")
    return raw[:-scale] + "." + raw[-scale:] if scale else raw


def _source(value):
    metadata = _object(value.get("metadata"), "Authorization source metadata")
    try:
        raw = base64.b64decode(value["contentBase64"], validate=True)
    except (ValueError, KeyError, TypeError) as exc:
        raise Problem("Retain the complete original authorization file.", 422,
                      "COMMERCIAL_CHANGE_SOURCE") from exc
    if len(raw) > MAX_SOURCE_BYTES or len(raw) != metadata.get("bytes") or (
            hashlib.sha256(raw).hexdigest() != metadata.get("sha256")):
        _fail("An original authorization file changed.", "COMMERCIAL_CHANGE_SOURCE", 422)
    return raw


def _optional(value, label, limit):
    if not isinstance(value, str) or len(value) > limit:
        _fail(label + " must be text within its published limit.", status=422)
    return value


def _native_optional(value, label, limit):
    """Match original Receivables field(): ECMAScript trim and UTF-16 length."""
    if not isinstance(value, str) or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
        _fail(label + " must use the original native text contract.", status=422)
    prepared = value.strip("\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
                           "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
                           "\u2028\u2029\u202f\u205f\u3000\ufeff")
    if len(prepared.encode("utf-16-le", "surrogatepass")) // 2 > limit:
        _fail(label + " must be text within its published native limit.", status=422)
    return prepared


def _compile_steps(proposal):
    """Rebuild exact native requests from the retained reviewed source."""
    detail = _object(proposal.get("nativeBefore"), "Original native detail")
    invoice, draft = detail["invoice"], detail["draft"]
    mode, invoice_id, key = proposal["mode"], proposal["invoiceId"], proposal["obligationKey"]
    milestone, scale = proposal["originalMilestone"], proposal["currency"]["scale"]
    if type(scale) is not int or not 0 <= scale <= 6:
        _fail("Choose the original native currency precision.", status=422)
    target, target_units = _amount(proposal["targetAmount"], scale, "Authorized revised amount")
    original_total = _unscaled(draft["totals"]["total"], scale, "Original invoice total")
    credit_total = sum(_unscaled(c["document"]["totals"]["total"], scale, "Credit") for c in detail["credits"])
    reason, authorized_on = proposal["reason"], proposal["authorizedOn"]
    effective_date, issue_date, due_date = proposal["effectiveDate"], proposal["issueDate"], proposal["dueDate"]
    label, resolution = proposal["description"], proposal["resolution"]
    if invoice.get("id") != invoice_id or invoice.get("customerId") != proposal["customerId"] or draft["currency"] != proposal["currency"]:
        _fail("The change's original invoice binding differs.", status=422)
    if original_total < credit_total or mode == "VOID" and target_units != 0 or mode in ("DRAFT_EDIT", "REPLACE") and target_units <= 0:
        _fail("The reviewed change amount is invalid.", status=422)
    if mode == "DRAFT_EDIT" and invoice["status"] != "DRAFT" or mode == "REPLACE" and invoice["status"] == "DRAFT":
        _fail("The native invoice status does not support this change.", status=422)
    if effective_date < draft["issueDate"] or due_date < issue_date:
        _fail("The reviewed invoice dates are invalid.", status=422)
    steps = []
    if mode == "VOID" or (mode == "REPLACE" and resolution == "VOID"):
        if invoice["status"] != "VOID":
            if detail["credits"]:
                _fail("An invoice with credit notes stays in the issued register. Choose credit and replacement.")
            if any(not x.get("releasedDate") or x["releasedDate"] > effective_date for x in detail["allocations"]):
                _fail("This invoice has unreleased payments at the correction date. Review them in native Receivables, or choose credit and replacement.")
            steps.append({"action": "void", "body": {"invoiceId": invoice_id,
                          "voidDate": effective_date, "reason": reason}})
    elif mode == "CREDIT" or (mode == "REPLACE" and resolution == "CREDIT"):
        if invoice["status"] != "ISSUED":
            _fail("Only an issued invoice can be credited.")
        desired_credit = original_total - (target_units if mode == "CREDIT" else 0)
        needed = desired_credit - credit_total
        if needed <= 0:
            if mode == "CREDIT":
                _fail("The revised amount must create a positive credit beyond existing original credits.", status=422)
        else:
            # Source billing produces one net line with zero tax. Never infer how to
            # spread a customer-authorized amount over externally changed lines/tax.
            lines = draft["lines"]
            if len(lines) != 1 or _unscaled(lines[0]["taxAmount"], scale, "Tax") != 0:
                _fail("This native invoice has multiple or taxed lines. Select and issue its exact line credit in Receivables, then return for replacement preparation.")
            steps.append({"action": "credit", "body": {"invoiceId": invoice_id,
                          "creditDate": effective_date, "reason": reason,
                          "lines": [{"invoiceLineId": lines[0]["id"],
                                     "netAmount": _money(needed, scale), "taxAmount": _money(0, scale)}]}})
    if mode in ("DRAFT_EDIT", "REPLACE"):
        value = {"customerId": proposal["customerId"], "currency": proposal["currency"],
                 "issueDate": issue_date, "dueDate": due_date,
                 "purchaseOrder": proposal["purchaseOrder"], "note": proposal["note"],
                 "lines": [{"id": "milestone-" + str(milestone["sourceIndex"] + 1),
                            "description": label, "quantity": "1", "unitAmount": target}],
                 "sourceReference": "Workshare milestone correction " + key + "; authorization " +
                                    digest({"sourceIds": [item["id"] for item in proposal["authorizationSources"]], "reason": reason, "authorizedOn": authorized_on})}
        if mode == "DRAFT_EDIT":
            value.update({"id": invoice_id, "expectedVersion": invoice["version"]})
            if draft.get("replacesId"):
                value["replacesId"] = draft["replacesId"]
        else:
            value["replacesId"] = invoice_id
        steps.append({"action": "draft", "body": value})
    if not steps:
        _fail("This selection has no new native operation. Open the existing result.", status=422)
    return steps


def _assert_credit_review(native, decision_id):
    if native.get("creditReviewRequired") and (
            native.get("creditDecisionStale") or not decision_id or decision_id != native.get("creditDecisionId")):
        _fail("Complete the native credit-control review and select its current original decision before issuing.",
              "COMMERCIAL_NATIVE_CREDIT_REVIEW")


def _assert_changed_document(proposal, document):
    expected = next((step["body"] for step in reversed(proposal["steps"]) if step["action"] == "draft"), None)
    if expected is None:
        _fail("The change has no reviewed draft.")
    for key in ("customerId", "currency", "issueDate", "dueDate", "purchaseOrder", "note", "sourceReference", "replacesId"):
        native_expected = expected.get(key)
        if key in ("purchaseOrder", "note"):
            # Compare the native rendition of retained earlier raw requests without
            # changing their proposal, request body, fingerprint or original hash.
            native_expected = _native_optional(native_expected or "", key, 300 if key == "purchaseOrder" else 6000)
        if document.get(key) != native_expected:
            # Native normalizes omitted optional text/links to null or empty.
            if key not in ("purchaseOrder", "note", "replacesId") or (document.get(key) or "") != (native_expected or ""):
                _fail("The changed draft differs from its reviewed commercial terms.")
    if document.get("customer", {}).get("id") != proposal["customerId"]:
        _fail("The changed invoice identifies another customer.")
    lines = document.get("lines", [])
    if document.get("totals", {}).get("total") != proposal["targetAmount"] or len(lines) != 1:
        _fail("The changed draft amount or lines differ from the authorization.")
    line = lines[0]
    if line.get("id") != expected["lines"][0]["id"] or line.get("description") != proposal["description"] or (
            Decimal(line.get("quantity", "0")) != Decimal(1) or
            line.get("unitAmount") != proposal["targetAmount"] or
            _unscaled(line["taxAmount"], proposal["currency"]["scale"], "Tax") or
            _unscaled(line["discountAmount"], proposal["currency"]["scale"], "Discount")):
        _fail("The changed draft no longer matches the exact authorized line.")


def validate_import(value):
    value = copy.deepcopy(_object(value, "Milestone changes"))
    if value.get("schema") != SCHEMA or not isinstance(value.get("items"), list):
        _fail("Choose a complete milestone-change export.", status=422)
    seen, by_key = set(), {}
    for row in value["items"]:
        _object(row, "Milestone change")
        ident = _required(row.get("id"), "Change identity", 100)
        if not re.fullmatch(r"commercial-change-[a-f0-9]{32}", ident):
            _fail("Retain the original milestone-change identity.", status=422)
        if ident in seen:
            _fail("A milestone change is repeated.", status=422)
        seen.add(ident)
        proposal = _object(row.get("proposal"), "Reviewed change")
        if digest(proposal) != row.get("proposalSha256"):
            _fail("The reviewed change content differs from its identity.", status=422)
        if proposal.get("schema") != SCHEMA or proposal.get("mode") not in MODES:
            _fail("Unsupported milestone change.", status=422)
        for name, limit in (("actor", 300), ("reason", 3000), ("authorization", 12000), ("description", 3000),
                            ("invoiceId", 160), ("endpointId", 160), ("customerId", 160), ("obligationKey", 64)):
            _required(proposal.get(name), name, limit)
        for name in ("authorizedOn", "effectiveDate", "issueDate", "dueDate"):
            _date(proposal.get(name), name)
        _optional(proposal.get("purchaseOrder"), "Purchase order", 300)
        _optional(proposal.get("note"), "Invoice note", 6000)
        if proposal.get("resolution") not in ("VOID", "CREDIT"):
            _fail("The reviewed replacement resolution is invalid.", status=422)
        if row.get("obligationKey") != proposal.get("obligationKey"):
            _fail("The change identifies another original milestone.", status=422)
        if digest(proposal.get("nativeBefore")) != proposal.get("nativeBeforeSha256"):
            _fail("The original native invoice review changed.", status=422)
        if _fingerprint(proposal["nativeBefore"]) != proposal.get("nativeFingerprint"):
            _fail("The original native record identity changed.", status=422)
        sources = proposal.get("authorizationSources")
        if not isinstance(sources, list) or not sources:
            _fail("The customer authorization sources are missing.", status=422)
        if len({item["id"] for item in sources}) != len(sources):
            _fail("Authorization source identities repeat.", status=422)
        if sum(len(_source(item)) for item in sources) > MAX_SOURCE_BYTES:
            _fail("Authorization source bytes exceed the complete change limit.", status=422)
        if proposal.get("steps") != _compile_steps(proposal):
            _fail("Native commands differ from the source-backed commercial plan.", status=422)
        if row.get("state") not in ("PREPARED", "RUNNING", "APPLIED", "CANCELLED"):
            _fail("Unsupported milestone-change state.", status=422)
        sequence = row.get("sequence")
        if type(sequence) is not int or sequence < 1:
            _fail("The change sequence is invalid.", status=422)
        chain = by_key.setdefault(row["obligationKey"], {})
        if sequence in chain:
            _fail("The change history has competing editions.", status=422)
        chain[sequence] = row
        if not isinstance(row.get("commands"), list) or len(row["commands"]) > len(proposal["steps"]) + 1:
            _fail("The native change journal is incomplete.", status=422)
        for index, command in enumerate(row["commands"]):
            if command.get("index") != index or command.get("state") not in ("PENDING", "ACKNOWLEDGED", "REJECTED"):
                _fail("The native change commands changed order or state.", status=422)
            if command["state"] == "REJECTED" and not _native_rejected(
                    command.get("action"), command.get("lastError", {}).get("code")):
                _fail("A rejected command needs its original native precommit error.", status=422)
            expected_id = ident + ("-issue" if command.get("action") == "issue" else "-step-" + str(index + 1))
            body = command.get("body", {})
            if command.get("requestId") != expected_id or body.get("requestId") != expected_id:
                _fail("An original accounting request identity changed.", status=422)
            retained = {k: v for k, v in body.items() if k != "revision"}
            if digest({"action": command["action"], "body": retained}) != command.get("intentSha256"):
                _fail("An original accounting command changed.", status=422)
            if index < len(proposal["steps"]):
                step = proposal["steps"][index]
                if command["action"] != step["action"]:
                    _fail("A command differs from its reviewed step.", status=422)
                expected_body = dict(step["body"], actor=proposal["actor"], requestId=expected_id)
                if retained != expected_body:
                    _fail("A native command differs from the exact reviewed request.", status=422)
            else:
                if command["action"] != "issue" or row["state"] != "APPLIED":
                    _fail("Only the completed change may carry a separately reviewed issue.", status=422)
                review = _object(command.get("review"), "Retained invoice review")
                if digest({k: v for k, v in review.items() if k != "issuePreviewSha256"}) != review.get("issuePreviewSha256"):
                    _fail("The retained issue review changed.", status=422)
                native = _object(review.get("nativePreview"), "Original native preview")
                if review.get("id") != ident or review.get("proposalSha256") != row["proposalSha256"] or review.get("invoiceId") != row.get("activeInvoiceId"):
                    _fail("The issue review identifies another correction.", status=422)
                expected_issue = {"invoiceId": row["activeInvoiceId"], "actor": proposal["actor"],
                                  "requestId": expected_id, "expectedVersion": native["expectedVersion"],
                                  "previewSha256": native["previewSha256"]}
                if "creditDecisionId" in retained:
                    expected_issue["creditDecisionId"] = _required(retained["creditDecisionId"], "Native credit decision", 100)
                if retained != expected_issue:
                    _fail("The issue request differs from its retained native review.", status=422)
                _assert_changed_document(proposal, native["document"])
            if command["state"] == "ACKNOWLEDGED":
                result = _object(command.get("result"), "Original native result")
                if result.get("operation", {}).get("id") != expected_id:
                    _fail("A native result belongs to another request.", status=422)
        if row["state"] == "APPLIED" and any(
                c["state"] != "ACKNOWLEDGED" for c in row["commands"][:len(proposal["steps"])]):
            _fail("An applied change is missing a native acknowledgement.", status=422)
        if row["state"] == "APPLIED" and len(row["commands"]) < len(proposal["steps"]):
            _fail("An applied change omitted a reviewed operation.", status=422)
        if row["state"] == "APPLIED":
            drafted = next((c for c in reversed(row["commands"]) if c["action"] == "draft"), None)
            expected_invoice = (drafted["result"]["operation"]["result"]["invoiceId"] if drafted else
                                None if proposal["mode"] == "VOID" else proposal["invoiceId"])
            if row.get("activeInvoiceId") != expected_invoice:
                _fail("The applied invoice differs from its original native acknowledgement.", status=422)
        if row["state"] == "CANCELLED" and any(c["state"] != "REJECTED" for c in row["commands"]):
            _fail("An unresolved or completed financial action cannot be cancelled.", status=422)
    for chain in by_key.values():
        if sorted(chain) != list(range(1, len(chain) + 1)):
            _fail("Retain the complete milestone-change history.", status=422)
        previous, applied = None, None
        for number in sorted(chain):
            row = chain[number]
            if row["proposal"].get("previousChangeId") != previous:
                _fail("The milestone-change history has a different predecessor.", status=422)
            if row["proposal"].get("previousAppliedId") != applied:
                _fail("The reviewed change chain identifies another applied predecessor.", status=422)
            if previous and chain[number - 1]["state"] not in ("APPLIED", "CANCELLED"):
                _fail("A later change bypassed an unresolved preparation.", status=422)
            if previous and any(c["state"] == "PENDING" for c in chain[number - 1]["commands"]):
                _fail("A later change bypassed an unresolved original accounting command.", status=422)
            if row["state"] == "APPLIED":
                applied = row["id"]
            previous = row["id"]
    return value


class CommercialChanges:
    def __init__(self, billing):
        self.billing = billing
        self.operations = billing.operations
        self.workspace = billing.workspace
        self.db = billing.db
        self.db.execute("""CREATE TABLE IF NOT EXISTS ops_commercial_changes (
            id TEXT PRIMARY KEY, obligation_key TEXT NOT NULL,
            sequence INTEGER NOT NULL, body_json TEXT NOT NULL,
            UNIQUE(obligation_key, sequence))""")

    def _rows(self, key):
        return [json.loads(row[0]) for row in self.db.execute(
            "SELECT body_json FROM ops_commercial_changes WHERE obligation_key=? ORDER BY sequence", (key,))]

    def _save(self, row):
        self.db.execute("UPDATE ops_commercial_changes SET body_json=? WHERE id=?",
                        (canonical(row), row["id"]))

    def _access(self, program_id, row):
        self.operations._context(program_id)
        for prepared_row in self.db.execute(
                "SELECT body_json FROM ops_commercial_receivables WHERE program_id=?", (program_id,)):
            prepared = json.loads(prepared_row[0])
            if prepared.get("preparedSha256") == row["proposal"]["originalPreparedSha256"] and any(
                    item["obligationKey"] == row["obligationKey"] for item in prepared["milestones"]):
                return prepared
        _fail("This change belongs to another customer case.", "COMMERCIAL_CHANGE_NOT_FOUND", 404)

    def _read(self, program_id, ident):
        found = self.db.execute("SELECT body_json FROM ops_commercial_changes WHERE id=?", (ident,)).fetchone()
        if not found:
            _fail("The milestone change was not found.", "COMMERCIAL_CHANGE_NOT_FOUND", 404)
        row = json.loads(found[0])
        self._access(program_id, row)
        return row

    def _native(self, proposal, action, body):
        actual = self.billing._identity(proposal["endpointId"])
        self.billing._assert_identity(proposal["accountingIdentity"], actual)
        return self.billing._native(action, {"endpointId": proposal["endpointId"], **body})

    def assert_original(self, key):
        rows = self._rows(key)
        relevant = next((row for row in reversed(rows) if row["state"] != "CANCELLED"), None)
        if relevant:
            _fail("Open milestone change " + relevant["id"] +
                  " to continue its original correction and invoice review.",
                  "COMMERCIAL_CHANGE_ACTIVE")

    def list(self, program_id, prepared_id, milestone_id):
        with self.workspace.mutex:
            prepared = self.billing._plan(program_id, prepared_id)
            milestone = next((x for x in prepared["milestones"] if x["milestoneId"] == milestone_id), None)
            if milestone is None:
                _fail("Choose an original milestone.", status=404)
            rows = [row for row in self._rows(milestone["obligationKey"])
                    if row["proposal"]["originalPreparedSha256"] == prepared["preparedSha256"]]
            return {"schema": SCHEMA, "programId": program_id, "preparedId": prepared_id,
                    "milestoneId": milestone_id, "items": [{**{k: row[k] for k in ("id", "sequence", "state", "createdAt")},
                       "mode": row["proposal"]["mode"], "targetAmount": row["proposal"]["targetAmount"]} for row in rows],
                    "previousChangeId": rows[-1]["id"] if rows else None}

    def get(self, program_id, ident, refresh=False):
        with self.workspace.mutex:
            row = copy.deepcopy(self._read(program_id, ident))
        if refresh:
            proposal = row["proposal"]
            invoice_ids = {proposal["invoiceId"]}
            if row.get("activeInvoiceId"):
                invoice_ids.add(row["activeInvoiceId"])
            row["currentNative"] = [self._native(proposal, "detail", {"invoiceId": x})
                                    for x in sorted(invoice_ids)]
        return row

    def preview(self, program_id, prepared_id, milestone_id, body):
        body = _object(body, "Customer change")
        actor = _required(body.get("actor"), "Recording operator", 300)
        reason = _required(body.get("reason"), "Reason for the commercial change", 3000)
        authorization = _required(body.get("authorization"), "Customer authorization and interpretation", 12000)
        authorized_on = _date(body.get("authorizedOn"), "Customer authorization date")
        source_ids = _ids(body.get("sourceIds"), "Authorization source files")
        if not source_ids:
            _fail("Select the retained customer authorization files.", status=422)
        mode = body.get("mode")
        if mode not in MODES:
            _fail("Choose draft correction, credit, void or replacement.", status=422)
        with self.workspace.mutex:
            context = self.operations._context(program_id)
            if body.get("expectedVersion") != context["program"]["version"]:
                _fail("Refresh the original case before reviewing this source selection.", "VERSION_CONFLICT")
            prepared = self.billing._plan(program_id, prepared_id)
            milestone = next((x for x in prepared["milestones"] if x["milestoneId"] == milestone_id), None)
            if milestone is None:
                _fail("Choose an original prepared milestone.", status=404)
            key = milestone["obligationKey"]
            obligation = self.billing._obligation(key)
            rows = self._rows(key)
            latest = rows[-1] if rows else None
            if body.get("previousChangeId") != (latest["id"] if latest else None):
                _fail("A later milestone change exists. Reopen the full history.")
            if latest and latest["state"] in ("PREPARED", "RUNNING"):
                _fail("Continue or explicitly cancel the existing prepared change.")
            prior = next((row for row in reversed(rows) if row["state"] == "APPLIED"), None)
            if prior and any(c["state"] == "PENDING" for c in prior["commands"]):
                _fail("Reconcile the original pending invoice issue before another change.")
            invoice_id = prior.get("activeInvoiceId") if prior else obligation.get("invoiceId")
            if not invoice_id:
                invoice_id = prior["proposal"]["invoiceId"] if prior else None
            if not invoice_id:
                _fail("Create the original milestone invoice draft before a correction.")
            if any(self.billing._intent(key, action) and
                   self.billing._intent(key, action)["state"] == "PENDING"
                   for action in ("draft", "issue")):
                _fail("Reconcile the original milestone accounting command first.")
            sources = []
            for ident in source_ids:
                metadata, raw = self.operations.source(program_id, ident)
                sources.append({"id": ident, "metadata": copy.deepcopy(metadata),
                                "contentBase64": base64.b64encode(bytes(raw)).decode("ascii")})
            if sum(len(_source(item)) for item in sources) > MAX_SOURCE_BYTES:
                _fail("Selected authorization files exceed the complete change limit.", status=413)
            expected_version = context["program"]["version"]
        proposal = {"schema": SCHEMA, "programId": program_id, "preparedId": prepared_id,
                    "milestoneId": milestone_id, "obligationKey": key,
                    "originalPreparedSha256": prepared["preparedSha256"],
                    "originalMilestone": copy.deepcopy(milestone),
                    "originalWorkshare": copy.deepcopy(prepared["schedule"]),
                    "previousChangeId": latest["id"] if latest else None,
                    "previousAppliedId": prior["id"] if prior else None,
                    "endpointId": prepared["endpointId"], "accountingIdentity": prepared["accountingIdentity"],
                    "customerId": prepared["customerId"], "currency": prepared["schedule"]["currency"],
                    "invoiceId": invoice_id, "mode": mode, "actor": actor, "reason": reason,
                    "authorization": authorization, "authorizedOn": authorized_on,
                    "authorizationSources": sources, "expectedVersion": expected_version}
        detail = self._native(proposal, "detail", {"invoiceId": invoice_id})
        invoice, draft = detail["invoice"], detail["draft"]
        if invoice["customerId"] != proposal["customerId"] or draft["currency"] != proposal["currency"]:
            _fail("The selected invoice has another customer or currency.")
        scale = proposal["currency"]["scale"]
        target, target_units = _amount(body.get("targetAmount"), scale, "Authorized revised milestone amount")
        original_total = _unscaled(draft["totals"]["total"], scale, "Native invoice total")
        credit_total = sum(_unscaled(c["document"]["totals"]["total"], scale, "Original credit")
                           for c in detail["credits"])
        if credit_total > original_total:
            _fail("Native credits exceed this original invoice. Reconcile its native account.")
        if mode == "VOID" and target_units != 0:
            _fail("A void has zero revised milestone amount.", status=422)
        if mode in ("DRAFT_EDIT", "REPLACE") and target_units <= 0:
            _fail("An editable or replacement invoice needs a positive authorized amount.", status=422)
        issue_date = _date(body.get("issueDate") or draft["issueDate"], "Revised invoice date")
        due_date = _date(body.get("dueDate") or draft["dueDate"], "Revised due date")
        if due_date < issue_date:
            _fail("The due date cannot precede its invoice date.", status=422)
        effective_date = _date(body.get("effectiveDate"), "Correction accounting date")
        if effective_date < draft["issueDate"]:
            _fail("The correction date cannot precede the original invoice date.", status=422)
        label = _required(body.get("description") or milestone["label"], "Revised invoice description", 3000)
        if mode == "DRAFT_EDIT" and invoice["status"] != "DRAFT":
            _fail("Only an unissued native draft can be edited.")
        if mode == "CREDIT" and invoice["status"] != "ISSUED":
            _fail("A credit requires an issued native invoice.")
        resolution = body.get("resolution", "VOID")
        if resolution not in ("VOID", "CREDIT"):
            _fail("Choose void or credit for the replaced invoice.", status=422)
        if mode == "REPLACE" and invoice["status"] == "DRAFT":
            _fail("Use draft correction for an unissued invoice.")
        proposal.update({"targetAmount": target, "description": label,
                         "issueDate": issue_date, "dueDate": due_date,
                         "effectiveDate": effective_date, "resolution": resolution,
                         "purchaseOrder": _native_optional(body.get("purchaseOrder", draft.get("purchaseOrder", "")), "Purchase order", 300),
                         "note": _native_optional(body.get("note", draft.get("note", "")), "Invoice note", 6000),
                         "nativeBefore": detail, "nativeBeforeSha256": digest(detail),
                         "nativeFingerprint": _fingerprint(detail)})
        steps = _compile_steps(proposal)
        proposal["steps"] = steps
        proposal["consequences"] = {
            "nativePaid": invoice.get("paid"), "nativeCredited": invoice.get("credited"),
            "nativeAmountDue": invoice.get("amountDue"), "nativeCreditBalance": invoice.get("creditBalance"),
            "originalAllocations": copy.deepcopy(detail["allocations"]),
            "paymentDisposition": "Existing receipts and allocations remain in the original account. Review any customer credit balance, reallocation or refund in Receivables.",
            "replacementIssue": "A changed or replacement draft requires a separate invoice preview and explicit issue."}
        return {"schema": SCHEMA, "proposal": proposal, "previewSha256": digest(proposal)}

    def prepare(self, program_id, prepared_id, milestone_id, body):
        body = _object(body, "Reviewed correction")
        request = _required(body.get("requestId"), "Preparation request", 100)
        payload = {"domain": SCHEMA, "action": "prepare", "programId": program_id,
                   "preparedId": prepared_id, "milestoneId": milestone_id, "body": body}
        with self.workspace.mutex:
            prior = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request,)).fetchone()
            if prior:
                if prior[0] != digest(payload):
                    _fail("This original request belongs to another preparation.", "REQUEST_CONFLICT")
                return self.get(program_id, json.loads(prior[1])["id"])
        reviewed = self.preview(program_id, prepared_id, milestone_id, body)
        if reviewed["previewSha256"] != body.get("expectedPreviewSha256"):
            _fail("Review the current original invoice and complete customer authorization again.", "COMMERCIAL_CHANGE_REVIEW_CHANGED")
        proposal = reviewed["proposal"]
        ident = "commercial-change-" + uuid.uuid4().hex
        def save():
            context = self.operations._context(program_id)
            if context["program"]["version"] != proposal["expectedVersion"]:
                _fail("The original customer case changed before preparation.", "VERSION_CONFLICT")
            rows = self._rows(proposal["obligationKey"])
            if (rows[-1]["id"] if rows else None) != proposal["previousChangeId"]:
                _fail("Another correction was prepared for this milestone.")
            row = {"schema": SCHEMA, "id": ident, "obligationKey": proposal["obligationKey"],
                   "sequence": len(rows) + 1, "createdAt": now(), "state": "PREPARED",
                   "proposal": proposal, "proposalSha256": reviewed["previewSha256"],
                   "commands": [], "activeInvoiceId": None, "history": [{"action": "prepared", "at": now(), "requestId": request}]}
            self.db.execute("INSERT INTO ops_commercial_changes VALUES(?,?,?,?)",
                            (ident, row["obligationKey"], row["sequence"], canonical(row)))
            return {"id": ident}
        saved = self.workspace._transaction(request, payload, save)
        return self.get(program_id, saved["id"])

    def _assert_head(self, row):
        latest = self._rows(row["obligationKey"])[-1]
        if latest["id"] != row["id"]:
            _fail("A later correction exists. Open the complete original history.")

    def _new_command(self, program_id, ident, index, step, revision, before_fingerprint, review=None):
        def save():
            row = self._read(program_id, ident)
            self._assert_head(row)
            if len(row["commands"]) > index:
                return row["commands"][index]
            if len(row["commands"]) != index:
                _fail("Continue the preceding original accounting command.")
            request = ident + ("-issue" if step["action"] == "issue" else "-step-" + str(index + 1))
            body = dict(copy.deepcopy(step["body"]), actor=row["proposal"]["actor"], requestId=request, revision=revision)
            command = {"index": index, "action": step["action"], "requestId": request,
                       "body": body, "state": "PENDING", "createdAt": now(), "attempts": [],
                       "beforeFingerprint": before_fingerprint,
                       "intentSha256": digest({"action": step["action"], "body": {k: v for k, v in body.items() if k != "revision"}})}
            if review is not None:
                prepared = self._access(program_id, row)
                milestone = next(x for x in prepared["milestones"] if x["obligationKey"] == row["obligationKey"])
                evidence = self.billing._eligibility(prepared, milestone, program_id)
                if not evidence.get("ready") or evidence != review["eligibility"]:
                    _fail("The original milestone prerequisites changed before issue preparation.")
                selected = evidence["installation"]
                edition = installations.get(self.operations, program_id, selected["id"], selected["revision"])
                _review_edition(prepared, milestone, review, edition)
                command["review"] = copy.deepcopy(review)
                command["installationEdition"] = copy.deepcopy(edition)
            row["commands"].append(command)
            row["state"] = "RUNNING" if step["action"] != "issue" else row["state"]
            self._save(row)
            return command
        return self.billing._write(save)

    def _dispatch(self, program_id, ident, index):
        with self.workspace.mutex:
            row = self._read(program_id, ident)
            self._assert_head(row)
            command = copy.deepcopy(row["commands"][index])
        if command["state"] == "ACKNOWLEDGED":
            return command
        proposal = row["proposal"]
        def starting():
            selected = self._read(program_id, ident)
            current = selected["commands"][index]
            if current["intentSha256"] != command["intentSha256"]:
                _fail("The original accounting command changed.")
            if current["state"] == "ACKNOWLEDGED":
                return copy.deepcopy(current)
            current["attempts"].append({"at": now(), "revision": current["body"]["revision"]})
            current["state"] = "PENDING"
            self._save(selected)
            return copy.deepcopy(current)
        command = self.billing._write(starting)
        if command["state"] == "ACKNOWLEDGED":
            return command
        try:
            result = self._native(proposal, command["action"], command["body"])
            if result.get("operation", {}).get("id") != command["requestId"]:
                _fail("The accounting server returned another operation.", "COMMERCIAL_CHANGE_NATIVE_RESPONSE", 502)
            def acknowledged():
                selected = self._read(program_id, ident)
                current = selected["commands"][index]
                if current["intentSha256"] != command["intentSha256"]:
                    _fail("The retained accounting command changed.")
                current.update({"state": "ACKNOWLEDGED", "result": result, "acknowledgedAt": now()})
                current.pop("lastError", None)
                self._save(selected)
                return current
            return self.billing._write(acknowledged)
        except Problem as error:
            code = getattr(error, "code", "")
            def failed():
                selected = self._read(program_id, ident)
                current = selected["commands"][index]
                if current["state"] != "ACKNOWLEDGED":
                    # Only source-proven precommit codes permit a fresh review.
                    # Transport, file/summary decoding and commit uncertainty retain
                    # the exact original command for authoritative native replay.
                    current["state"] = "REJECTED" if _native_rejected(command["action"], code) else "PENDING"
                    current["lastError"] = {"at": now(), "code": code, "message": str(error)}
                    self._save(selected)
            self.billing._write(failed)
            raise

    def apply(self, program_id, ident, body):
        body = _object(body, "Original change command")
        with self.workspace.mutex:
            row = self._read(program_id, ident)
            self._assert_head(row)
            if body.get("expectedProposalSha256") != row["proposalSha256"]:
                _fail("Use this change's complete original reviewed proposal.")
            if _required(body.get("actor"), "Recording operator", 300) != row["proposal"]["actor"]:
                _fail("Resume with the original recording operator.", "COMMERCIAL_CHANGE_ACTOR")
            if row["state"] == "CANCELLED":
                _fail("This prepared change was cancelled.")
            if row["state"] == "APPLIED":
                return copy.deepcopy(row)
        proposal = row["proposal"]
        for index, step in enumerate(proposal["steps"]):
            with self.workspace.mutex:
                row = self._read(program_id, ident)
                command = copy.deepcopy(row["commands"][index]) if len(row["commands"]) > index else None
            if command and command["state"] == "ACKNOWLEDGED":
                continue
            if command and command["state"] == "PENDING":
                # Replay first with the exact original revision. Native request lookup
                # precedes revision validation, so a lost result cannot repeat its effect.
                self._dispatch(program_id, ident, index)
                continue
            detail = self._native(proposal, "detail", {"invoiceId": proposal["invoiceId"]})
            if index == 0 and _fingerprint(detail) != proposal["nativeFingerprint"]:
                _fail("The reviewed native invoice changed. Keep this history and prepare a fresh customer review.")
            if index > 0:
                previous = row["commands"][index - 1]
                if previous["state"] != "ACKNOWLEDGED":
                    _fail("Reconcile the preceding native result.")
                invoice = detail["invoice"]
                if invoice["customerId"] != proposal["customerId"] or detail["draft"]["currency"] != proposal["currency"]:
                    _fail("The original invoice customer or currency changed.")
                if proposal["resolution"] == "VOID" and invoice["status"] != "VOID":
                    _fail("The retained original invoice is no longer void.")
                if proposal["resolution"] == "CREDIT":
                    total = _unscaled(detail["draft"]["totals"]["total"], proposal["currency"]["scale"], "Invoice total")
                    credits = sum(_unscaled(c["document"]["totals"]["total"], proposal["currency"]["scale"], "Credit")
                                  for c in detail["credits"])
                    if credits != total:
                        _fail("The original invoice is no longer fully credited.")
            if command:  # A recorded STALE_WORKSPACE refusal; same intent, refreshed revision.
                def rebind():
                    selected = self._read(program_id, ident)
                    current = selected["commands"][index]
                    if current["state"] != "REJECTED" or current["intentSha256"] != command["intentSha256"]:
                        _fail("The original command changed during review.")
                    current["body"]["revision"] = detail["revision"]
                    current["state"] = "PENDING"
                    self._save(selected)
                self.billing._write(rebind)
            else:
                self._new_command(program_id, ident, index, step, detail["revision"], _fingerprint(detail))
            self._dispatch(program_id, ident, index)
        def complete():
            selected = self._read(program_id, ident)
            if any(c["state"] != "ACKNOWLEDGED" for c in selected["commands"][:len(proposal["steps"])]):
                _fail("Reconcile all original native commands.")
            draft = next((c for c in reversed(selected["commands"]) if c["action"] == "draft"), None)
            selected["activeInvoiceId"] = (draft["result"]["operation"]["result"]["invoiceId"] if draft
                                           else None if proposal["mode"] == "VOID" else proposal["invoiceId"])
            selected["state"] = "APPLIED"
            selected["appliedAt"] = now()
            selected["history"].append({"action": "applied", "at": now()})
            self._save(selected)
            return selected
        return self.billing._write(complete)

    def cancel(self, program_id, ident, body):
        request = _required(body.get("requestId"), "Cancellation request", 100)
        actor = _required(body.get("actor"), "Operator", 300)
        reason = _required(body.get("reason"), "Cancellation reason", 6000)
        def save():
            row = self._read(program_id, ident)
            self._assert_head(row)
            if body.get("expectedProposalSha256") != row["proposalSha256"]:
                _fail("Review this original preparation before cancelling it.")
            if row["state"] == "CANCELLED":
                return {"id": ident}
            if row["state"] == "APPLIED" or any(c["state"] != "REJECTED" for c in row["commands"]):
                _fail("A completed or uncertain accounting command stays with its original recovery.")
            row["state"] = "CANCELLED"
            row["history"].append({"action": "cancelled", "at": now(), "actor": actor, "reason": reason, "requestId": request})
            self._save(row)
            return {"id": ident}
        self.workspace._transaction(request, {"domain": SCHEMA, "action": "cancel", "id": ident, "body": body}, save)
        return self.get(program_id, ident)

    def preview_issue(self, program_id, ident):
        with self.workspace.mutex:
            row = self._read(program_id, ident)
            self._assert_head(row)
            if row["state"] != "APPLIED" or not row.get("activeInvoiceId"):
                _fail("Complete a native draft correction or replacement first.")
            draft_commands = [c for c in row["commands"] if c["action"] == "draft"]
            if not draft_commands:
                _fail("This change created no draft to issue.")
            pending = next((c for c in row["commands"] if c["action"] == "issue"), None)
        if pending:
            return {"schema": SCHEMA, "id": ident, "retainedCommand": pending,
                    "issuePreviewSha256": pending["review"]["issuePreviewSha256"],
                    "nativePreview": pending["review"]["nativePreview"]}
        proposal = row["proposal"]
        with self.workspace.mutex:
            prepared = self._access(program_id, row)
            milestone = next(x for x in prepared["milestones"] if x["obligationKey"] == row["obligationKey"])
            eligibility = self.billing._eligibility(prepared, milestone, program_id)
        native = self._native(proposal, "preview", {"invoiceId": row["activeInvoiceId"]})
        _assert_changed_document(proposal, native["document"])
        result = {"schema": SCHEMA, "id": ident, "proposalSha256": row["proposalSha256"],
                  "invoiceId": row["activeInvoiceId"], "nativePreview": native, "eligibility": eligibility,
                  "authorization": proposal["authorization"], "sourceIds": [x["id"] for x in proposal["authorizationSources"]]}
        result["issuePreviewSha256"] = digest(result)
        return result

    def issue(self, program_id, ident, body):
        with self.workspace.mutex:
            row = self._read(program_id, ident)
            self._assert_head(row)
            if _required(body.get("actor"), "Recording operator", 300) != row["proposal"]["actor"]:
                _fail("Use the original recording operator.", "COMMERCIAL_CHANGE_ACTOR")
            existing = next((c for c in row["commands"] if c["action"] == "issue"), None)
        if existing:
            if body.get("expectedIssuePreviewSha256") != existing["review"]["issuePreviewSha256"]:
                _fail("Resume the original retained invoice review.")
            if existing["state"] == "REJECTED":
                native = self._native(row["proposal"], "preview", {"invoiceId": row["activeInvoiceId"]})
                if native["expectedVersion"] != existing["body"]["expectedVersion"] or native["previewSha256"] != existing["body"]["previewSha256"]:
                    _fail("The original issue was refused and its draft changed. Keep this journal and prepare a new source-backed correction.")
                _assert_credit_review(native, existing["body"].get("creditDecisionId"))
                def rebind_issue():
                    selected = self._read(program_id, ident)
                    self._assert_head(selected)
                    current = selected["commands"][existing["index"]]
                    if current["state"] != "REJECTED" or current["intentSha256"] != existing["intentSha256"]:
                        _fail("The retained issue changed during recovery.")
                    current["body"]["revision"] = native["revision"]
                    current["state"] = "PENDING"
                    self._save(selected)
                self.billing._write(rebind_issue)
            self._dispatch(program_id, ident, existing["index"])
            return self.get(program_id, ident, True)
        review = self.preview_issue(program_id, ident)
        if review["issuePreviewSha256"] != body.get("expectedIssuePreviewSha256"):
            _fail("Review the exact current native invoice before issuing it.")
        if not review["eligibility"].get("ready"):
            _fail("Complete the original milestone billing prerequisites before issuing the changed draft.",
                  "COMMERCIAL_PREREQUISITES")
        native = review["nativePreview"]
        step = {"action": "issue", "body": {"invoiceId": row["activeInvoiceId"],
                "expectedVersion": native["expectedVersion"], "previewSha256": native["previewSha256"]}}
        # Native credit-control authority still applies; this reference must be an
        # existing native decision selected in the accounting product.
        if body.get("creditDecisionId"):
            step["body"]["creditDecisionId"] = _required(body["creditDecisionId"], "Native credit decision", 100)
        _assert_credit_review(native, step["body"].get("creditDecisionId"))
        index = len(row["commands"])
        self._new_command(program_id, ident, index, step, native["revision"], digest(native["document"]), review=review)
        self._dispatch(program_id, ident, index)
        return self.get(program_id, ident, True)

    def export_rows(self, program_id):
        with self.workspace.mutex:
            prepared_rows = [json.loads(row[0]) for row in self.db.execute(
                "SELECT body_json FROM ops_commercial_receivables WHERE program_id=?", (program_id,))]
            keys = {m["obligationKey"] for prepared in prepared_rows for m in prepared["milestones"]}
            hashes = {prepared["preparedSha256"] for prepared in prepared_rows}
            return {"schema": SCHEMA, "items": [item for key in sorted(keys) for item in self._rows(key)
                                                if item["proposal"]["originalPreparedSha256"] in hashes]}

    def restore_rows(self, program_id, value):
        value = validate_import(value)
        for incoming in value["items"]:
            prepared = self._access(program_id, incoming)
            proposal = incoming["proposal"]
            if prepared["preparedSha256"] != proposal["originalPreparedSha256"] or prepared["schedule"] != proposal["originalWorkshare"] or (
                    prepared["accountingIdentity"] != proposal["accountingIdentity"] or prepared["customerId"] != proposal["customerId"] or
                    prepared["endpointId"] != proposal["endpointId"]):
                _fail("The received change does not match its original prepared source.")
            source_milestone = next(x for x in prepared["milestones"] if x["obligationKey"] == incoming["obligationKey"])
            if source_milestone != proposal["originalMilestone"]:
                _fail("The original milestone terms differ from this change.")
            for command in incoming["commands"]:
                if command["action"] == "issue":
                    _review_edition(prepared, source_milestone, command["review"], command["installationEdition"])
            found = self.db.execute("SELECT body_json FROM ops_commercial_changes WHERE id=?", (incoming["id"],)).fetchone()
            if not found:
                competing = self.db.execute("SELECT id FROM ops_commercial_changes WHERE obligation_key=? AND sequence=?",
                                            (incoming["obligationKey"], incoming["sequence"])).fetchone()
                if competing:
                    _fail("This received milestone history diverges from its existing original change.")
                self.db.execute("INSERT INTO ops_commercial_changes VALUES(?,?,?,?)",
                                (incoming["id"], incoming["obligationKey"], incoming["sequence"], canonical(incoming)))
                continue
            original = json.loads(found[0])
            if original["proposalSha256"] != incoming["proposalSha256"]:
                _fail("An existing milestone change has different original source.")
            common = min(len(original["commands"]), len(incoming["commands"]))
            for index in range(common):
                left, right = original["commands"][index], incoming["commands"][index]
                if left["intentSha256"] != right["intentSha256"]:
                    _fail("Received accounting requests diverge from their originals.")
                if left["state"] == "ACKNOWLEDGED" and right["state"] == "ACKNOWLEDGED" and (
                        left["result"]["operation"]["result"] != right["result"]["operation"]["result"]):
                    _fail("An accounting acknowledgement names different original results.")
            # Merge monotonic acknowledgements; a historical receiver cannot erase an
            # actual native effect or an unresolved original command.
            winner = copy.deepcopy(original if len(original["commands"]) >= len(incoming["commands"]) else incoming)
            for index in range(common):
                left, right = original["commands"][index], incoming["commands"][index]
                winner["commands"][index] = copy.deepcopy(left if left["state"] == "ACKNOWLEDGED" else
                                                         right if right["state"] == "ACKNOWLEDGED" else
                                                         left if left["state"] == "PENDING" else right)
            if original["state"] == "CANCELLED" or incoming["state"] == "CANCELLED":
                if any(c["state"] != "REJECTED" for c in winner["commands"]):
                    _fail("Cancellation conflicts with a retained accounting action.")
                winner["state"] = "CANCELLED"
            elif original["state"] == "APPLIED" or incoming["state"] == "APPLIED":
                completed = original if original["state"] == "APPLIED" else incoming
                winner.update({k: completed[k] for k in ("state", "activeInvoiceId", "appliedAt")})
            self._save(winner)
        return {"schema": SCHEMA, "received": len(value["items"])}

    def export_bundle(self, program_id, ident):
        row = self.get(program_id, ident, True)
        with self.workspace.mutex:
            prepared = self._access(program_id, row)
        original = self.billing.export_bundle(program_id, prepared["id"])
        files = {"original-customer-account.zip": base64.b64decode(original["contentBase64"], validate=True),
                 "milestone-changes.json": (canonical(self.export_rows(program_id)) + "\n").encode(),
                 "selected-change.json": (canonical(row) + "\n").encode()}
        for source in row["proposal"]["authorizationSources"]:
            files["authorization/" + hashlib.sha256(source["id"].encode()).hexdigest() + ".bin"] = _source(source)
        # The current account archive is the native full customer snapshot, including
        # correction credits and replacement invoice references.
        account = self._native(row["proposal"], "export", {"customerId": row["proposal"]["customerId"]})
        files["current-customer-account.tar"] = base64.b64decode(account["contentBase64"], validate=True)
        linked = []
        for change in self.export_rows(program_id)["items"]:
            if change["obligationKey"] != row["obligationKey"]:
                continue
            for command in change["commands"]:
                if command["action"] != "issue":
                    continue
                edition = command["installationEdition"]
                snapshot = edition["preview"]["snapshot"]
                for source_id, metadata in snapshot["sources"].items():
                    current_metadata, raw = self.operations.source(program_id, source_id)
                    raw = bytes(raw)
                    if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                        _fail("An original issue acceptance file changed.")
                    files["acceptance/" + metadata["sha256"] + ".bin"] = raw
            ids = {change["proposal"]["invoiceId"]}
            if change.get("activeInvoiceId"):
                ids.add(change["activeInvoiceId"])
            for invoice_id in sorted(ids):
                detail = self._native(row["proposal"], "detail", {"invoiceId": invoice_id})
                if detail["invoice"]["customerId"] != row["proposal"]["customerId"]:
                    _fail("A linked correction document belongs to another customer.")
                records = ([{"id": invoice_id, "files": detail["files"]}] if detail.get("document") else []) + detail["credits"]
                for record in records:
                    names = ("credit.json", "credit.csv", "credit.html", "manifest.json") if "document" in record else (
                        "invoice.json", "invoice.csv", "invoice.html", "manifest.json")
                    document_id = record["id"]
                    root = "native/documents/" + hashlib.sha256(document_id.encode()).hexdigest() + "/"
                    if root + names[0] in files:
                        continue
                    for name in names:
                        item = self._native(row["proposal"], "document", {"invoiceId": document_id, "name": name})
                        raw = base64.b64decode(item["contentBase64"], validate=True)
                        metadata = record["files"][name]
                        if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                            _fail("An original native document differs from its retained bytes.", status=502)
                        files[root + name] = raw
                    linked.append({"invoiceId": invoice_id, "documentId": document_id, "directory": root})
        files["native/linked-documents.json"] = (canonical(linked) + "\n").encode()
        manifest = {"schema": SCHEMA, "changeId": ident, "createdAt": now(),
                    "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                              for name, raw in sorted(files.items())]}
        files["manifest.json"] = (canonical(manifest) + "\n").encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, raw in sorted(files.items()):
                archive.writestr(name, raw)
        raw = output.getvalue()
        return {"filename": ident + ".zip", "mediaType": "application/zip",
                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                "contentBase64": base64.b64encode(raw).decode(), "manifest": manifest}
