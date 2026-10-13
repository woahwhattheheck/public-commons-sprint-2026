"""Reviewed customer recovery of original issued buyer expense portions.

This domain records the customer's source-backed charge decision. Original Buyer
Expenses owns cost attribution; the running native Receivables service owns every
invoice, credit, allocation and payment. No accounting source is opened here.
"""
from __future__ import annotations

import base64
import copy
from decimal import Decimal
import hashlib
import io
import json
import re
import uuid
import zipfile
from html import escape

from model import Problem, canonical, digest, now, short_id, text, csv_bytes
from operations_source_billing import SourceBillingJournal, validate_rows, compile_native_steps, assert_native_document
import operations_expenses as expenses
import operations_amendments as amendments
from operations_commercial_receivables import _amount, _date, _ids, _object, _required
from operations_commercial_changes import (_native_rejected, _native_optional,
    _fingerprint, _money, _source, _assert_credit_review)

SCHEMA = "stellar-forge.customer-expense-billing.v1"
MODES = ("NEW", "DRAFT_EDIT", "CREDIT", "VOID", "REPLACE")
MAX_LINES = 200
MAX_SOURCES = 32 * 1024 * 1024


def fail(message, code="EXPENSE_BILLING_CONFLICT", status=409):
    raise Problem(message, status, code)


def review_refusal(action, operation):
    """Label only a local/read-only review or a rolled-back local transaction.

    The caller must keep every native dispatch outside this wrapper. A retained
    pending command remains authoritative and must be reconciled by the client.
    """
    try:
        return operation()
    except Problem as error:
        if getattr(error, "status", 500) not in (400, 404, 409, 413, 422):
            raise
        raise Problem(str(error), error.status, "EXPENSE_BILLING_" + action + "_REVIEW") from error


def exact(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or not set(required) <= set(value):
        fail("Retain the complete declared expense billing fields.", "EXPENSE_BILLING_INPUT", 422)
    return value


def units(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,99})", value):
        fail(label + " must retain an integer native-unit string.", status=422)
    return int(value)


def money(value, scale):
    return _amount(value, scale, "Reviewed customer amount")


def portion_key(source, cost):
    return digest({"buyerWorkspaceId": source["workspaceId"],
                   "sourceLineId": source["sourceLineId"], "costId": cost,
                   "fundingBasis": "CUSTOMER"})


def original_key(source):
    return digest({"buyerWorkspaceId": source["workspaceId"],
                   "sourceLineId": source["sourceLineId"]})


def active_heads(rows):
    """One current noncancelled review per chain, independent of copied case IDs."""
    result = {}
    for row in sorted(rows, key=lambda x: (x["chainId"], x["sequence"])):
        if row["state"] != "CANCELLED":
            result[row["chainId"]] = row
    return result


def chain_exposure(rows):
    """Keep billed exposure until a correction completes.

    Take per-portion maxima across the last applied and pending editions.
    For each original expense take the largest edition total, never the sum
    of per-portion maxima across a cost-package reassignment.
    """
    result = {}
    for chain in {r["chainId"] for r in rows}:
        ordered = sorted((r for r in rows if r["chainId"] == chain and r["state"] != "CANCELLED"),
                         key=lambda r: r["sequence"])
        if not ordered:
            continue
        applied = max((i for i, r in enumerate(ordered) if r["state"] == "APPLIED"), default=-1)
        portions, originals, lines = {}, {}, []
        for row in (ordered[applied:] if applied >= 0 else ordered):
            selected = [] if row["state"] == "APPLIED" and row["proposal"]["mode"] == "VOID" else row["proposal"]["lines"]
            totals = {}
            for line in selected:
                quantity = units(line["nativeAmount"], "Retained source portion")
                portions[line["portionKey"]] = max(portions.get(line["portionKey"], 0), quantity)
                totals[line["originalKey"]] = totals.get(line["originalKey"], 0) + quantity
                lines.append(line)
            for key, quantity in totals.items():
                originals[key] = max(originals.get(key, 0), quantity)
        result[chain] = {"portions": portions, "originals": originals, "lines": lines}
    return result


def validate_exposure(rows):
    used, originals, budgets, original_budgets = {}, {}, {}, {}
    for exposure in chain_exposure(rows).values():
        for key, quantity in exposure["portions"].items():
            used[key] = used.get(key, 0) + quantity
        for key, quantity in exposure["originals"].items():
            originals[key] = originals.get(key, 0) + quantity
        for line in exposure["lines"]:
            budgets[line["portionKey"]] = max(budgets.get(line["portionKey"], 0), units(line["allocation"]["nativeAmount"], "Original allocation"))
            original_budgets[line["originalKey"]] = max(original_budgets.get(line["originalKey"], 0), units(line["attribution"]["source"]["original"]["amount"], "Original expense"))
    if any(value > budgets.get(key, 0) for key, value in used.items()) or any(value > original_budgets.get(key, 0) for key, value in originals.items()):
        fail("The combined original charge histories over-reserve a retained expense portion.")


def source_edition(context, selected, *, correction=False):
    values = expenses.retained(context)
    attribution = next((r for r in values["attributions"] if r["id"] == selected["attributionId"]), None)
    if attribution is None or attribution["state"] != "REVIEWED":
        fail("Select a reviewed original expense attribution.")
    if attribution["contentSha256"] != selected["expectedContentSha256"]:
        fail("The selected reviewed expense edition changed.")
    binding = expenses.source_binding_current(values, attribution)
    if not binding or binding["bindingSha256"] != attribution["source"]["bindingSha256"]:
        fail("Review the current accountant source before billing its expense.")
    if attribution["source"]["kind"] != "EXPENSE":
        fail("A buyer credit is reviewed with the original customer charge; it cannot create a positive expense invoice.", status=422)
    part = next((p for p in attribution["allocations"] if p["costId"] == selected["costId"]
                 and p["fundingBasis"] == "CUSTOMER"), None)
    if part is None and correction:
        part = {"costId": selected["costId"], "fundingBasis": "CUSTOMER", "nativeAmount": "0", "usdValue": "0.00", "removedAllocation": True}
    if part is None:
        fail("Choose the explicit CUSTOMER-funded work-package portion.", status=422)
    native = units(selected["nativeAmount"], "Selected original expense portion")
    if (native == 0 and not correction) or native > units(part["nativeAmount"], "Reviewed source allocation"):
        fail("Choose a positive portion within the reviewed customer allocation.", status=422)
    return attribution, part


def credit_context(context, workspace_ids):
    """Show all current original credits for selected buyers; never infer a lien."""
    values = expenses.retained(context)
    rows = []
    for intake in expenses.heads(values).values():
        if intake["inspection"]["source"]["buyer"]["workspaceId"] in workspace_ids:
            rows.extend({"intakeId": intake["id"], "sourceId": intake["sourceId"],
                         "buyer": copy.deepcopy(intake["inspection"]["source"]["buyer"]), **copy.deepcopy(row)}
                        for row in intake["inspection"]["rows"] if row["kind"] == "CREDIT")
    return sorted(rows, key=lambda r: (r["buyer"]["workspaceId"], r["sourceLineId"]))


def compile_steps(proposal):
    return compile_native_steps(proposal, line_prefix="expense",
        source_label="Reviewed expense recovery", failure=fail)


def assert_document(proposal, document):
    return assert_native_document(proposal, document, failure=fail)


class ExpenseBilling(SourceBillingJournal):
    schema = SCHEMA
    table = "ops_expense_billing"
    id_prefix = "expense-billing-"
    error_prefix = "EXPENSE_BILLING"
    _fail = staticmethod(fail)
    _money = staticmethod(money)
    _exact = staticmethod(exact)
    _review_refusal = staticmethod(review_refusal)
    _active_heads = staticmethod(active_heads)
    _assert_document = staticmethod(assert_document)
    _validate_exposure = staticmethod(validate_exposure)

    def _capacity(self, proposal, replacing_chain=None):
        exposures = chain_exposure(self._all())
        current = exposures.get(replacing_chain, {"portions": {}, "originals": {}})
        used, original_used, proposed_original = {}, {}, {}
        for chain, exposure in exposures.items():
            if chain == replacing_chain:
                continue
            for key, quantity in exposure["portions"].items():
                used[key] = used.get(key, 0) + quantity
            for key, quantity in exposure["originals"].items():
                original_used[key] = original_used.get(key, 0) + quantity
        for line in proposal["lines"]:
            key, origin = line["portionKey"], line["originalKey"]
            quantity = units(line["nativeAmount"], "Reviewed portion")
            limit = units(line["allocation"]["nativeAmount"], "Current allocation")
            if replacing_chain:
                limit = max(limit, used.get(key, 0) + current["portions"].get(key, 0))
            if used.get(key, 0) + quantity > limit:
                fail("Another retained charge already reserves part of this customer allocation.")
            proposed_original[origin] = proposed_original.get(origin, 0) + quantity
            limit = units(line["attribution"]["source"]["original"]["amount"], "Original expense")
            if replacing_chain:
                limit = max(limit, original_used.get(origin, 0) + current["originals"].get(origin, 0))
            if original_used.get(origin, 0) + proposed_original[origin] > limit:
                fail("Customer charges exceed the original expense across case copies.")

    def _source_current(self, program_id, proposal):
        context = self._context(program_id)
        for line in proposal["lines"]:
            selected = {"attributionId": line["attribution"]["id"],
                        "expectedContentSha256": line["attribution"]["contentSha256"],
                        "costId": line["allocation"]["costId"], "nativeAmount": line["nativeAmount"]}
            current, part = source_edition(context, selected, correction=proposal["mode"] in ("CREDIT", "VOID"))
            if canonical(current) != canonical(line["attribution"]) or canonical(part) != canonical(line["allocation"]):
                fail("The original reviewed expense or allocation changed; keep this charge and prepare an explicit source-backed correction.")
        current_credits = credit_context(context, {x["attribution"]["source"]["workspaceId"] for x in proposal["lines"]})
        if canonical(current_credits) != canonical(proposal["buyerCredits"]):
            fail("The received buyer credit population changed. Review the current credits with this customer charge.")
        for source in proposal["sources"]:
            metadata, raw = self.operations.source(program_id, source["id"])
            if metadata != source["metadata"] or raw != _source(source):
                fail("A selected commercial or expense source changed.")
        self._capacity(proposal, proposal["chainId"])
        return context

    def catalog(self, program_id):
        with self.workspace.mutex:
            context = self.operations._context(program_id)
            view = expenses.dashboard(context)
            reserved = {}
            for exposure in chain_exposure(self._all()).values():
                for key, quantity in exposure["portions"].items():
                    reserved[key] = reserved.get(key, 0) + quantity
            selected = []
            for record in view["attributions"]:
                for part in record["allocations"]:
                    if part["fundingBasis"] != "CUSTOMER" or record["source"]["kind"] != "EXPENSE":
                        continue
                    key = portion_key(record["source"], part["costId"])
                    selected.append({"attribution": record, "allocation": part, "portionKey": key,
                        "reservedNativeAmount": str(reserved.get(key, 0)),
                        "availableNativeAmount": str(max(0, int(part["nativeAmount"])-reserved.get(key, 0))),
                        "selectable": record["state"] == "REVIEWED" and not record["bookkeepingChanged"] and context["program"]["state"] == "OPEN"})
            return {"schema": SCHEMA, "programId": program_id, "version": context["program"]["version"],
                    "mode": context["program"]["mode"], "sources": list(context["sources"].values()),
                    "portions": selected, "attributions": view["attributions"], "buyerCredits": credit_context(context, {r["source"]["workspaceId"] for r in view["attributions"]}),
                    "items": [self._summary(row) for row in self._rows(program_id)]}

    def _capture_source_snapshot(self, program_id, context, authorization_ids):
        events = [json.loads(r[0]) for r in self.db.execute(
            "SELECT body_json FROM ops_events WHERE program_id=? ORDER BY version", (program_id,))]
        reviews = [json.loads(r[0]) for r in self.db.execute(
            "SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (program_id,))]
        changes = amendments.load(self.operations, program_id)
        plans = {str(event["version"] - 1): amendments.plan_at(changes, context["plan"], event["version"] - 1)
                 for event in events if event.get("action") == "expense.save"}
        values = expenses.retained(context)
        selected = set(authorization_ids)
        selected.update(row["sourceId"] for row in values["intakes"])
        for event in events:
            if event.get("kind") == "expenseAttribution":
                selected.update((event["after"].get("valuation") or {}).get("sourceIds", []))
        sources = []
        for ident in sorted(selected):
            metadata, raw = self.operations.source(program_id, ident)
            sources.append({"id": ident, "metadata": metadata, "contentBase64": base64.b64encode(raw).decode()})
        if sum(len(_source(item)) for item in sources) > MAX_SOURCES:
            fail("The complete original expense source context exceeds 32 MiB.", status=413)
        return {"context": copy.deepcopy({key: context[key] for key in ("program", "plan", "records", "sources")}),
                "expenseRecords": copy.deepcopy(values), "events": events, "reviews": reviews,
                "expensePlanEditions": plans, "files": sources}

    def preview(self, program_id, body):
        exact(body, ("requestId", "actor", "expectedVersion", "previousId", "mode",
            "endpointId", "customerId", "currency", "sourceIds", "authorization",
            "authorizedOn", "creditReviewNote", "reason", "issueDate", "dueDate",
            "effectiveDate", "resolution", "purchaseOrder", "note", "lines", "expectedPreviewSha256"),
            ("requestId", "actor", "expectedVersion", "mode", "sourceIds", "authorization",
             "authorizedOn", "creditReviewNote", "reason", "lines"))
        request_id = short_id(body["requestId"], "Preparation request")
        actor = _required(body["actor"], "Recording operator", 300)
        mode = body["mode"]
        if mode not in MODES:
            fail("Choose a new charge, draft correction, credit, void or replacement.", status=422)
        source_ids = _ids(body["sourceIds"], "Original commercial authority files")
        if not source_ids:
            fail("Select the customer's actual cost-recovery terms or authorization.", status=422)
        auth = _required(body["authorization"], "Customer terms and charge interpretation", 12000)
        authorized = _date(body["authorizedOn"], "Authorization date")
        credit_note = _required(body["creditReviewNote"], "Review of buyer credits and amounts charged", 6000)
        reason = _required(body["reason"], "Charge or correction reason", 3000)
        prior = None
        with self.workspace.mutex:
            context = self._context(program_id, body["expectedVersion"])
            if body.get("previousId"):
                prior = self._read(program_id, body["previousId"])
                self._head(prior)
                if prior["state"] == "PREPARED" or any(c["state"] == "PENDING" for c in prior["commands"]):
                    fail("Continue or cancel the retained preparation; reconcile each pending native command before a new review.")
                if prior["state"] == "RUNNING" and not any(c["state"] == "REJECTED" for c in prior["commands"]):
                    fail("Complete the acknowledged native operation before creating its successor.")
                if mode == "NEW":
                    fail("Use a correction for the original retained customer charge.", status=422)
            elif mode != "NEW":
                fail("Select the original customer expense charge to correct.", status=422)
            chain = prior["chainId"] if prior else "expense-chain-" + digest({"programId": program_id, "requestId": request_id})[:32]
            endpoint = prior["proposal"]["endpointId"] if prior else _required(body.get("endpointId"), "Accounting connection", 200)
            customer_id = prior["proposal"]["customerId"] if prior else _required(body.get("customerId"), "Native customer", 100)
            currency = copy.deepcopy(prior["proposal"]["currency"] if prior else body.get("currency"))
            exact(currency, ("code", "scale"), ("code", "scale"))
            if not isinstance(currency["code"], str) or not re.fullmatch(r"[A-Z]{3}", currency["code"]) or (
                    type(currency["scale"]) is not int or not 0 <= currency["scale"] <= 6):
                fail("Choose the native three-letter currency and zero-to-six decimal precision.", status=422)
            if prior and any(body.get(k, prior["proposal"][k]) != prior["proposal"][k] for k in ("endpointId", "customerId", "currency")):
                fail("The original expense charge retains its customer, currency and accounting identity.")
            raw_lines = body["lines"]
            if not isinstance(raw_lines, list) or not 1 <= len(raw_lines) <= MAX_LINES:
                fail("Select the complete one-to-200 original expense portions.", status=422)
            lines, selected_sources, seen = [], set(source_ids), set()
            for selected in raw_lines:
                exact(selected, ("attributionId", "expectedContentSha256", "costId", "nativeAmount",
                    "amountBasis", "amount", "description"), ("attributionId", "expectedContentSha256",
                    "costId", "nativeAmount", "amountBasis", "amount", "description"))
                attribution, part = source_edition(context, selected, correction=mode in ("CREDIT", "VOID"))
                key = portion_key(attribution["source"], part["costId"])
                if key in seen:
                    fail("Combine each original customer work-package portion once.", status=422)
                seen.add(key)
                amount, minor = money(selected["amount"], currency["scale"])
                basis = selected["amountBasis"]
                if basis not in ("REVIEWED_USD", "AGREED_AMOUNT"):
                    fail("Choose reviewed USD cost or an explicitly agreed customer amount.", status=422)
                if basis == "REVIEWED_USD":
                    if currency != {"code": "USD", "scale": 2} or part["usdValue"] is None:
                        fail("Reviewed-cost billing requires the original entered USD valuation and USD cents.", status=422)
                    numerator = money(part["usdValue"], 2)[1] * units(selected["nativeAmount"], "Expense portion")
                    denominator = units(part["nativeAmount"], "Reviewed allocation")
                    if (not denominator and minor) or (denominator and (numerator % denominator or numerator // denominator != minor)):
                        fail("This portion does not equal an exact-cent share of its reviewed USD valuation. Retain a separately agreed amount and its source instead.", status=422)
                if (not units(selected["nativeAmount"], "Expense portion") and minor) or (mode == "VOID" and (minor or units(selected["nativeAmount"], "Expense portion"))):
                    fail("A released or voided cost portion retains zero remaining charge and native units.", status=422)
                selected_sources.add(attribution["source"]["sourceId"])
                selected_sources.update((attribution.get("valuation") or {}).get("sourceIds", []))
                lines.append({"portionKey": key, "originalKey": original_key(attribution["source"]),
                    "attribution": copy.deepcopy(attribution), "allocation": copy.deepcopy(part),
                    "nativeAmount": selected["nativeAmount"], "amountBasis": basis, "amount": amount,
                    "description": _native_optional(selected["description"], "Invoice description", 3000)})
                if not lines[-1]["description"]:
                    fail("Describe each original expense charge.", status=422)
            if prior and mode in ("CREDIT", "VOID"):
                old = {x["portionKey"]: x for x in prior["proposal"]["lines"]}
                if set(old) != seen or any(units(x["nativeAmount"], "Remaining portion") > units(old[x["portionKey"]]["nativeAmount"], "Original portion") for x in lines):
                    fail("Credit or void retains the original source population and can only reduce its reserved portions.")
            sources = []
            for ident in sorted(selected_sources):
                metadata, raw = self.operations.source(program_id, ident)
                sources.append({"id": ident, "metadata": copy.deepcopy(metadata),
                                "contentBase64": base64.b64encode(raw).decode("ascii")})
            if sum(len(_source(x)) for x in sources) > MAX_SOURCES:
                fail("The selected full expense and authorization files exceed 32 MiB.", status=413)
            buyer_credits = credit_context(context, {x["attribution"]["source"]["workspaceId"] for x in lines})
            case_version = context["program"]["version"]
            source_mode = context["program"]["mode"]
            source_snapshot = self._capture_source_snapshot(program_id, context, source_ids)
            self._capacity({"lines": lines}, chain if prior else None)
        identity = self.billing._identity(endpoint)
        if prior:
            self.billing._assert_identity(prior["proposal"]["accountingIdentity"], identity)
            identity = prior["proposal"]["accountingIdentity"]
        customers = self.billing._native("customers", {"endpointId": endpoint})
        customer = next((r for r in customers["customers"] if r["id"] == customer_id), None)
        if not customer:
            fail("The selected customer is absent from the original native account.")
        detail = None
        invoice_id = None
        if prior:
            acknowledged = next((c for c in reversed(prior["commands"]) if c["action"] == "draft" and c["state"] == "ACKNOWLEDGED"), None)
            invoice_id = acknowledged["result"]["operation"]["result"]["invoiceId"] if acknowledged else (
                prior.get("activeInvoiceId") or prior["proposal"].get("invoiceId"))
            if not invoice_id:
                fail("Cancel an unused rejected preparation and prepare its corrected original source.")
            detail = self._native(prior["proposal"], "detail", {"invoiceId": invoice_id})
        defaults = detail["draft"] if detail else {}
        issue_date = _date(body.get("issueDate", defaults.get("issueDate")), "Invoice date")
        due_date = _date(body.get("dueDate", defaults.get("dueDate")), "Due date")
        effective_date = _date(body.get("effectiveDate", issue_date), "Correction date")
        if due_date < issue_date:
            fail("Due date cannot precede invoice date.", status=422)
        resolution = body.get("resolution", "CREDIT")
        if resolution not in ("CREDIT", "VOID"):
            fail("Select the original invoice's credit or void disposition.", status=422)
        terms = {"authorization": auth, "authorizedOn": authorized, "sourceIds": sorted(source_ids),
                 "creditReviewNote": credit_note, "currency": currency, "customerId": customer_id,
                 "reason": reason, "amounts": [{k: row[k] for k in ("portionKey", "nativeAmount", "amountBasis", "amount", "description")} for row in lines]}
        proposal = {"schema": SCHEMA, "programId": program_id, "expectedVersion": case_version,
            "caseMode": source_mode, "requestId": request_id, "chainId": chain,
            "sourceSnapshot": source_snapshot, "sourceSnapshotSha256": digest(source_snapshot),
            "previousId": prior["id"] if prior else None, "mode": mode, "actor": actor,
            "endpointId": endpoint, "accountingIdentity": identity, "customerId": customer_id,
            "customer": copy.deepcopy(customer), "currency": currency, "invoiceId": invoice_id,
            "sources": sources, "authorizationSourceIds": sorted(source_ids), "authorization": auth,
            "authorizedOn": authorized, "creditReviewNote": credit_note, "buyerCredits": buyer_credits,
            "reason": reason, "issueDate": issue_date, "dueDate": due_date, "effectiveDate": effective_date,
            "resolution": resolution, "purchaseOrder": _native_optional(body.get("purchaseOrder", defaults.get("purchaseOrder", "")) or "", "Purchase order", 300),
            "note": _native_optional(body.get("note", defaults.get("note", "")) or "", "Invoice note", 6000),
            "lines": lines, "terms": terms, "termsSha256": digest(terms),
            "amount": _money(sum(money(x["amount"], currency["scale"])[1] for x in lines), currency["scale"]),
            "nativeBefore": detail, "nativeFingerprint": _fingerprint(detail) if detail else None}
        proposal["steps"] = compile_steps(proposal)
        proposal["consequences"] = {"sourcePortions": "These reviewed original cost portions are reserved once across all receiving case copies.",
            "payments": "Original receipts, allocations and refunds stay in native Receivables; this review changes no cash.",
            "buyerCredits": "Original buyer credits remain visible source records. The customer amount follows the explicit retained terms and credit review.",
            "issue": "A prepared or corrected draft requires a separate native invoice preview and explicit issue."}
        return {"schema": SCHEMA, "proposal": proposal, "previewSha256": digest(proposal)}

    def export_bundle(self, program_id, ident):
        with self.operations._snapshot():
            selected = self.get(program_id, ident)
            original = self.operations.export(program_id)
            retained = self.export_rows(program_id)
            local_fingerprint = digest(retained)
        proposal = selected["proposal"]
        native_revision = self._native(proposal, "customers", {})["revision"]
        account = self._native(proposal, "export", {"customerId": proposal["customerId"]})
        files = {"operations.zip": original,
            "expense-billing.json": (canonical(retained) + "\n").encode(),
            "selected-charge.json": (canonical(selected) + "\n").encode(),
            "native-customer-account.tar": base64.b64decode(account["contentBase64"], validate=True)}
        linked = []
        invoice_ids = set()
        for row in retained["items"]:
            if row["proposal"]["accountingIdentity"] == proposal["accountingIdentity"] and row["proposal"]["customerId"] == proposal["customerId"]:
                if row["proposal"].get("invoiceId"):
                    invoice_ids.add(row["proposal"]["invoiceId"])
                if row.get("activeInvoiceId"):
                    invoice_ids.add(row["activeInvoiceId"])
        for invoice_id in sorted(invoice_ids):
            detail = self._native(proposal, "detail", {"invoiceId": invoice_id})
            if detail["invoice"]["customerId"] != proposal["customerId"]:
                fail("A linked native document belongs to another customer.")
            records = ([{"id": invoice_id, "files": detail["files"]}] if detail.get("document") else []) + detail["credits"]
            for record in records:
                names = ("credit.json", "credit.csv", "credit.html", "manifest.json") if "document" in record else (
                    "invoice.json", "invoice.csv", "invoice.html", "manifest.json")
                folder = "native/documents/" + hashlib.sha256(record["id"].encode()).hexdigest() + "/"
                if folder + names[0] in files:
                    continue
                for name in names:
                    fetched = self._native(proposal, "document", {"invoiceId": record["id"], "name": name})
                    raw = base64.b64decode(fetched["contentBase64"], validate=True)
                    metadata = record["files"][name]
                    if len(raw) != metadata["bytes"] or hashlib.sha256(raw).hexdigest() != metadata["sha256"]:
                        fail("The linked immutable native document differs from its original bytes.", status=502)
                    files[folder + name] = raw
                linked.append({"invoiceId": invoice_id, "documentId": record["id"], "directory": folder})
        if self._native(proposal, "customers", {})["revision"] != native_revision:
            fail("The native account changed during export. Reopen and export its current original edition.")
        with self.operations._snapshot():
            if digest(self.export_rows(program_id)) != local_fingerprint:
                fail("The expense-billing history changed during export. Reopen its current original edition.")
        files["native/linked-documents.json"] = (canonical(linked) + "\n").encode()
        files["export-observations.json"] = (canonical({"localHistorySha256": local_fingerprint,
            "nativeRevisionBeforeAndAfter": native_revision, "accountingIdentity": proposal["accountingIdentity"],
            "interpretation": "One local aggregate snapshot and the unchanged native revision observed around the original customer archive and all linked documents."}) + "\n").encode()
        records = []
        for row in retained["items"]:
            p = row["proposal"]
            for line in p["lines"]:
                records.append({"chargeId": row["id"], "chainId": row["chainId"], "sequence": row["sequence"],
                    "state": row["state"], "mode": p["mode"], "customerId": p["customerId"],
                    "invoiceId": row.get("activeInvoiceId"), "currency": p["currency"]["code"],
                    "attributionId": line["attribution"]["id"], "sourceLineId": line["attribution"]["source"]["sourceLineId"],
                    "costId": line["allocation"]["costId"], "nativeAmount": line["nativeAmount"],
                    "amount": line["amount"], "amountBasis": line["amountBasis"], "description": line["description"]})
        headers = ["chargeId", "chainId", "sequence", "state", "mode", "customerId", "invoiceId", "currency",
                   "attributionId", "sourceLineId", "costId", "nativeAmount", "amount", "amountBasis", "description"]
        files["expense-billing.csv"] = csv_bytes(headers, records)
        cells = lambda values: "".join("<td>" + escape(str(v if v is not None else "")) + "</td>" for v in values)
        table = "<table><thead><tr>" + "".join("<th>" + escape(h) + "</th>" for h in headers) + "</tr></thead><tbody>"
        table += "".join("<tr>" + cells([r.get(k) for k in headers]) + "</tr>" for r in records) + "</tbody></table>"
        files["expense-billing.html"] = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Customer expense recovery</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#fff;color:#222;font:16px/1.5 system-ui}'
            'h1,h2,p,td,th{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #bbb;text-align:left;vertical-align:top}'
            '.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #bbb;padding:16px;background:#f5f5f5;color:#222}</style>'
            '<h1>Customer expense recovery</h1><p>Complete original cost portions, customer charge reviews and native command history.</p><div class="table">' + table +
            '</div><h2>Selected customer terms</h2><pre>' + escape(selected["proposal"]["authorization"]) +
            '</pre><h2>Buyer credits review</h2><pre>' + escape(selected["proposal"]["creditReviewNote"]) +
            '</pre><p>Open operations.zip in Grant Operations to continue the whole case. The original customer-account archive retains native invoices, credits, allocations and documents. Configure the same accounting identity at its current service URL before financial continuation.</p></html>').encode()
        files["README.txt"] = ("CUSTOMER EXPENSE RECOVERY\n\noperations.zip is the complete original Grant case, not a new invoice source. "
            "expense-billing.json and CSV retain every charge edition and original command. native-customer-account.tar is the actual native full customer export. "
            "Reopen the complete operating case and its original native account; preserve the accounting identity pair and original request IDs. "
            "A customer-account export does not replace the authenticated full-account backup for native account restore. "
            "Inspect all outgoing HTML, CSV and native invoice documents; operate the rendered desk at desktop and phone widths, in light and dark embedding contexts, and cold-reopen the complete saved case.\n").encode()
        manifest = {"schema": SCHEMA, "id": ident, "createdAt": now(), "files": [
            {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
        files["manifest.json"] = (canonical(manifest) + "\n").encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, raw in sorted(files.items()):
                archive.writestr(name, raw)
        raw = output.getvalue()
        return {"filename": ident + ".zip", "mediaType": "application/zip", "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(), "contentBase64": base64.b64encode(raw).decode(), "manifest": manifest}


def _validate_proposal(p, context, events, files):
    snapshot = p["sourceSnapshot"]
    if digest(snapshot) != p["sourceSnapshotSha256"]:
        fail("The charge lost its complete original expense source context.", status=422)
    original_context = copy.deepcopy(snapshot["context"])
    if original_context["program"]["id"] != p["programId"] or original_context["program"]["version"] != p["expectedVersion"] or original_context["program"]["mode"] != p["caseMode"]:
        fail("The charge source context changed its original case or edition.", status=422)
    original_files = {}
    for source in snapshot["files"]:
        if source["id"] in original_files or original_context["sources"].get(source["id"]) != source["metadata"]:
            fail("The original source context repeats or changes a file.", status=422)
        original_files[source["id"]] = _source(source)
        if source["id"] in context["sources"] and (
                context["sources"][source["id"]] != source["metadata"] or files.get("sources/" + source["id"]) != original_files[source["id"]]):
            fail("A shared original source identity differs between received cases.", status=422)
    if sum(map(len, original_files.values())) > MAX_SOURCES:
        fail("The complete original source context exceeds its bound.", status=413)
    original_events = snapshot["events"]
    if type(p["expectedVersion"]) is not int or p["expectedVersion"] < 1 or any(event["version"] > p["expectedVersion"] for event in original_events):
        fail("The source context contains events after its reviewed edition.", status=422)
    verified_expenses = expenses.validate_import(original_context, snapshot["expenseRecords"], original_events,
        snapshot["reviews"], {"sources/" + key: raw for key, raw in original_files.items()},
        plan_for_version=lambda version: snapshot["expensePlanEditions"][str(version)])
    historic = {**original_context, "expenseRecords": verified_expenses}
    if context["program"]["id"] == p["programId"]:
        actual = [event for event in events if event["version"] <= p["expectedVersion"]]
        if actual != original_events:
            fail("The received original case changed the charge's recorded event prefix.", status=422)
    if not isinstance(p["lines"], list) or not 1 <= len(p["lines"]) <= MAX_LINES:
        fail("The original charge line population is invalid.", status=422)
    currency = p["currency"]
    if set(currency) != {"code", "scale"} or not re.fullmatch(r"[A-Z]{3}", currency["code"]) or type(currency["scale"]) is not int or not 0 <= currency["scale"] <= 6:
        fail("The original native currency is invalid.", status=422)
    _required(p["actor"], "Original operator", 300)
    short_id(p["requestId"], "Original preparation request")
    _required(p["endpointId"], "Original connection", 200)
    _required(p["customerId"], "Original customer", 100)
    if p["customer"]["id"] != p["customerId"] or any(not re.fullmatch(r"[a-f0-9]{64}", p["accountingIdentity"][k]) for k in ("workspaceId", "sourcesSha256")):
        fail("The original customer/account identity changed.", status=422)
    for key in ("issueDate", "dueDate", "effectiveDate", "authorizedOn"):
        _date(p[key], key)
    if p["dueDate"] < p["issueDate"]:
        fail("The original invoice dates are invalid.", status=422)
    terms = {"authorization": _required(p["authorization"], "Original customer terms", 12000),
        "authorizedOn": p["authorizedOn"], "sourceIds": sorted(_ids(p["authorizationSourceIds"], "Original terms files")),
        "creditReviewNote": _required(p["creditReviewNote"], "Buyer credits review", 6000),
        "currency": currency, "customerId": p["customerId"], "reason": _required(p["reason"], "Original reason", 3000),
        "amounts": [{k: line[k] for k in ("portionKey", "nativeAmount", "amountBasis", "amount", "description")} for line in p["lines"]]}
    if not terms["sourceIds"] or terms != p["terms"] or digest(terms) != p["termsSha256"]:
        fail("The retained commercial terms changed.", status=422)
    seen, required_sources = set(), set(terms["sourceIds"])
    for line in p["lines"]:
        selected = {"attributionId": line["attribution"]["id"],
            "expectedContentSha256": line["attribution"]["contentSha256"],
            "costId": line["allocation"]["costId"], "nativeAmount": line["nativeAmount"]}
        attribution, part = source_edition(historic, selected, correction=p["mode"] in ("CREDIT", "VOID"))
        if attribution != line["attribution"] or part != line["allocation"] or (
                portion_key(attribution["source"], part["costId"]) != line["portionKey"] or
                original_key(attribution["source"]) != line["originalKey"] or line["portionKey"] in seen):
            fail("A charge differs from its actual reviewed original expense edition.", status=422)
        seen.add(line["portionKey"])
        required_sources.add(attribution["source"]["sourceId"])
        required_sources.update((attribution.get("valuation") or {}).get("sourceIds", []))
        amount, minor = money(line["amount"], currency["scale"])
        if amount != line["amount"] or not _native_optional(line["description"], "Original description", 3000):
            fail("The original line amount or description changed.", status=422)
        quantity, full_quantity = units(line["nativeAmount"], "Portion"), units(part["nativeAmount"], "Original allocation")
        if line["amountBasis"] == "REVIEWED_USD":
            if currency != {"code": "USD", "scale": 2} or part["usdValue"] is None:
                fail("The original reviewed USD basis is absent.", status=422)
            numerator = money(part["usdValue"], 2)[1] * quantity
            if (not full_quantity and minor) or (full_quantity and (numerator % full_quantity or numerator // full_quantity != minor)):
                fail("The original reviewed USD portion changed.", status=422)
        elif line["amountBasis"] != "AGREED_AMOUNT":
            fail("The original amount basis is unknown.", status=422)
        if (not quantity and minor) or p["mode"] == "VOID" and (minor or quantity):
            fail("A released original portion retains a charge.", status=422)
    if p["buyerCredits"] != credit_context(historic, {x["attribution"]["source"]["workspaceId"] for x in p["lines"]}):
        fail("The original review lost its actual buyer credit population.", status=422)
    if len(p["sources"]) != len(required_sources) or {s["id"] for s in p["sources"]} != required_sources:
        fail("The complete original commercial/expense source population changed.", status=422)
    for source in p["sources"]:
        raw = _source(source)
        if original_context["sources"].get(source["id"]) != source["metadata"] or original_files.get(source["id"]) != raw:
            fail("The received case lost an original expense or customer authorization file.", status=422)
    if sum(len(_source(s)) for s in p["sources"]) > MAX_SOURCES:
        fail("The original charge source exceeds its supported bound.", status=413)
    if p["amount"] != _money(sum(money(x["amount"], currency["scale"])[1] for x in p["lines"]), currency["scale"]):
        fail("The original reviewed customer total changed.", status=422)



def _validate_preparation(p, body):
    exact(body, ("requestId", "actor", "expectedVersion", "previousId", "mode",
        "endpointId", "customerId", "currency", "sourceIds", "authorization",
        "authorizedOn", "creditReviewNote", "reason", "issueDate", "dueDate",
        "effectiveDate", "resolution", "purchaseOrder", "note", "lines", "expectedPreviewSha256"),
        ("requestId", "actor", "expectedVersion", "mode", "sourceIds", "authorization",
         "authorizedOn", "creditReviewNote", "reason", "lines", "expectedPreviewSha256"))
    if any(body.get(k, p[k]) != p[k] for k in ("endpointId", "customerId", "currency")):
        fail("The original preparation names a different customer or currency.", status=422)
    for key, label, bound in (("authorization", "Original customer terms", 12000),
            ("creditReviewNote", "Original buyer credit review", 6000), ("reason", "Original reason", 3000)):
        if _required(body[key], label, bound) != p[key]:
            fail("The original preparation differs from its reviewed commercial terms.", status=422)
    if sorted(_ids(body["sourceIds"], "Original authority sources")) != p["authorizationSourceIds"] or _date(body["authorizedOn"], "Original authorization") != p["authorizedOn"]:
        fail("The original preparation changed its customer authority files or date.", status=422)
    if not isinstance(body["lines"], list) or len(body["lines"]) != len(p["lines"]):
        fail("The original preparation lost its reviewed source portions.", status=422)
    for selected, line in zip(body["lines"], p["lines"]):
        exact(selected, ("attributionId", "expectedContentSha256", "costId", "nativeAmount",
            "amountBasis", "amount", "description"), ("attributionId", "expectedContentSha256",
            "costId", "nativeAmount", "amountBasis", "amount", "description"))
        expected = {"attributionId": line["attribution"]["id"], "expectedContentSha256": line["attribution"]["contentSha256"],
            "costId": line["allocation"]["costId"], "nativeAmount": line["nativeAmount"], "amountBasis": line["amountBasis"]}
        if any(selected[k] != value for k, value in expected.items()) or money(selected["amount"], p["currency"]["scale"])[0] != line["amount"] or _native_optional(selected["description"], "Original description", 3000) != line["description"]:
            fail("The original request differs from its reviewed expense portion.", status=422)
    defaults = p["nativeBefore"]["draft"] if p["nativeBefore"] else {}
    issued = _date(body.get("issueDate", defaults.get("issueDate")), "Original invoice date")
    expected = {"issueDate": issued, "dueDate": _date(body.get("dueDate", defaults.get("dueDate")), "Original due date"),
        "effectiveDate": _date(body.get("effectiveDate", issued), "Original correction date"),
        "resolution": body.get("resolution", "CREDIT"),
        "purchaseOrder": _native_optional(body.get("purchaseOrder", defaults.get("purchaseOrder", "")) or "", "Original purchase order", 300),
        "note": _native_optional(body.get("note", defaults.get("note", "")) or "", "Original note", 6000)}
    if any(p[k] != value for k, value in expected.items()):
        fail("The original request differs from its reviewed native invoice terms.", status=422)


def validate_import(value, context, events, files):
    return validate_rows(value, schema=SCHEMA, id_prefix="expense-billing-",
        chain_prefix="expense-chain-", error_prefix="EXPENSE_BILLING",
        validate_proposal=lambda p: _validate_proposal(p, context, events, files),
        compile_steps=compile_steps, assert_document=assert_document,
        validate_exposure=validate_exposure, fail=fail, exact=exact,
        validate_preparation=_validate_preparation)
