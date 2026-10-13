"""Shared original-request journal for source-backed native customer billing.

Domain subclasses own source selection, commercial authority and reservations.
This class only orchestrates the existing Receivables API and retained local
intents. Native invoice/credit/payment state remains in the original account.
"""
from __future__ import annotations
import copy
from decimal import Decimal
import json
import re
import uuid
from model import Problem, canonical, digest, now, short_id
from operations_commercial_receivables import _required, _amount
from operations_commercial_changes import _native_rejected, _fingerprint, _assert_credit_review, _money

class SourceBillingJournal:
    """Subclass contract: constant schema/table/identity prefixes plus source hooks.

    Required hooks: preview, _source_current, _validate_exposure, _assert_document,
    _fail, _exact, _review_refusal and _active_heads. Domain source snapshots and
    complete exports are supplied by the original domain, without JSON mutation
    or a second financial ledger.
    """
    def __init__(self, operations):
        if not re.fullmatch(r"ops_[a-z_]+", self.table):
            raise ValueError("The billing table must be a declared source constant.")
        self.operations, self.workspace, self.db = operations, operations.workspace, operations.db
        self.billing = operations.commercial
        self.db.execute(f"""CREATE TABLE IF NOT EXISTS {self.table} (
            id TEXT PRIMARY KEY,chain_id TEXT NOT NULL,sequence INTEGER NOT NULL,
            body_json TEXT NOT NULL,UNIQUE(chain_id,sequence))""")
        self.db.execute(f"""CREATE TABLE IF NOT EXISTS {self.table}_cases (
            program_id TEXT NOT NULL,charge_id TEXT NOT NULL,
            PRIMARY KEY(program_id,charge_id))""")

    def _all(self):
        return [json.loads(r[0]) for r in self.db.execute(f"SELECT body_json FROM {self.table} ORDER BY chain_id,sequence")]

    def _rows(self, program_id):
        self.operations._context(program_id)
        return [json.loads(r[0]) for r in self.db.execute(
            f"SELECT b.body_json FROM {self.table} b JOIN {self.table}_cases c ON c.charge_id=b.id "
            "WHERE c.program_id=? ORDER BY b.chain_id,b.sequence", (program_id,))]

    def _read(self, program_id, ident):
        return next((r for r in self._rows(program_id) if r["id"] == ident), None) or self._missing()

    def _missing(self):
        self._fail("This customer charge is not retained in the selected case.", self.error_prefix + "_NOT_FOUND", 404)

    def _save(self, row):
        self.db.execute(f"UPDATE {self.table} SET body_json=? WHERE id=?", (canonical(row), row["id"]))

    def _native(self, proposal, action, body):
        actual = self.billing._identity(proposal["endpointId"])
        self.billing._assert_identity(proposal["accountingIdentity"], actual)
        return self.billing._native(action, {"endpointId": proposal["endpointId"], **body})

    def _context(self, program_id, expected=None):
        context = self.operations._context(program_id)
        if context["program"]["state"] != "OPEN":
            self._fail("Reopen the original operating case before changing its customer billing.")
        if expected is not None and expected != context["program"]["version"]:
            self._fail("Refresh the selected case and review its current source edition.", "VERSION_CONFLICT")
        return context

    def _head(self, row):
        candidates = [r for r in self._all() if r["chainId"] == row["chainId"] and r["state"] != "CANCELLED"]
        if not candidates or candidates[-1]["id"] != row["id"]:
            self._fail("Continue the latest original customer charge review.")
        return row

    def _summary(self, row):
        p = row["proposal"]
        return {"id": row["id"], "chainId": row["chainId"], "sequence": row["sequence"],
                "state": row["state"], "mode": p["mode"], "customerName": p["customer"]["name"],
                "currency": p["currency"], "amount": p["amount"], "createdAt": row["createdAt"],
                "activeInvoiceId": row.get("activeInvoiceId"), "pending": any(c["state"] == "PENDING" for c in row["commands"])}

    def get(self, program_id, ident, refresh=False):
        with self.workspace.mutex:
            row = copy.deepcopy(self._read(program_id, ident))
            row["current"] = self._active_heads(self._all()).get(row["chainId"], {}).get("id") == row["id"]
        if refresh:
            ids = {row["proposal"].get("invoiceId"), row.get("activeInvoiceId")} - {None}
            row["currentNative"] = [self._native(row["proposal"], "detail", {"invoiceId": i}) for i in sorted(ids)]
        return row

    def prepare(self, program_id, body):
        request_id = short_id(body.get("requestId"), "Preparation request")
        payload = {"domain": self.schema, "action": "prepare", "programId": program_id, "body": body}
        with self.workspace.mutex:
            retained = next((r for r in self._rows(program_id) if r["proposal"]["requestId"] == request_id), None)
            if retained:
                if retained["preparationRequest"]["body"] != body:
                    self._fail("This original preparation request identifies a different retained selection.", "REQUEST_CONFLICT")
                return self.get(program_id, retained["id"])
            previous = self.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
            if previous:
                if previous[0] != digest(payload):
                    self._fail("This preparation request already identifies another exact selection.", "REQUEST_CONFLICT")
                return self.get(program_id, json.loads(previous[1])["id"])
        review = self.preview(program_id, body)
        if review["previewSha256"] != body.get("expectedPreviewSha256"):
            self._fail("Review this exact source, customer and original invoice before preparing.")
        proposal = review["proposal"]
        ident = self.id_prefix + uuid.uuid4().hex
        def save():
            self._context(program_id, proposal["expectedVersion"])
            self._source_current(program_id, proposal)
            all_rows = [r for r in self._all() if r["chainId"] == proposal["chainId"]]
            heads = self._active_heads(all_rows)
            if heads.get(proposal["chainId"], {}).get("id") != proposal["previousId"]:
                self._fail("A newer original charge review exists.")
            sequence = max((r["sequence"] for r in all_rows), default=0) + 1
            row = {"schema": self.schema, "id": ident, "chainId": proposal["chainId"], "sequence": sequence,
                "createdAt": now(), "state": "PREPARED", "proposal": proposal,
                "proposalSha256": review["previewSha256"], "activeInvoiceId": None,
                "preparationRequest": {"body": copy.deepcopy(body), "sha256": digest(body)},
                "commands": [], "history": [{"action": "prepared", "at": now(), "actor": proposal["actor"]}]}
            self.db.execute(f"INSERT INTO {self.table} VALUES(?,?,?,?)",
                (ident, row["chainId"], sequence, canonical(row)))
            self.db.execute(f"INSERT INTO {self.table}_cases VALUES(?,?)", (program_id, ident))
            return {"id": ident}
        result = self.workspace._transaction(request_id, payload, save)
        return self.get(program_id, result["id"])

    def _new_command(self, program_id, ident, expected_index, step, revision, review=None):
        def save():
            row = self._head(self._read(program_id, ident))
            self._context(program_id)
            index = len(row["commands"])
            if expected_index < index:
                original = row["commands"][expected_index]
                comparison = {k: v for k, v in original["body"].items() if k not in ("requestId", "actor", "revision")}
                if original["action"] != step["action"] or comparison != step["body"] or original.get("review") != review:
                    self._fail("A different reviewed native command is already retained at this position.")
                return copy.deepcopy(original)
            if expected_index != index:
                self._fail("Resume the original contiguous native command history.")
            self._source_current(program_id, row["proposal"])
            if step["action"] == "issue":
                previous = next((c for c in reversed(row["commands"]) if c["action"] == "issue"), None)
                if row["state"] != "APPLIED" or (previous and previous["state"] != "REJECTED"):
                    self._fail("Reconcile the original invoice issue before preparing a new decision.")
                if review["supersedesRejectedCommand"] != (previous["index"] if previous else None):
                    self._fail("A different issue review was retained concurrently.")
            request_id = ident + "-native-" + str(index+1)
            body = {**copy.deepcopy(step["body"]), "requestId": request_id,
                    "actor": row["proposal"]["actor"], "revision": revision}
            command = {"index": index, "action": step["action"], "body": body,
                "requestId": request_id, "state": "PENDING", "createdAt": now(), "attempts": [],
                "intentSha256": digest({"action": step["action"], "body": {k: v for k, v in body.items() if k != "revision"}})}
            if review is not None:
                self._source_current(program_id, row["proposal"])
                command["review"] = copy.deepcopy(review)
            row["commands"].append(command)
            if step["action"] != "issue":
                row["state"] = "RUNNING"
            self._save(row)
            return command
        return self._review_refusal("ISSUE" if step["action"] == "issue" else "APPLY", lambda: self.billing._write(save))

    def _dispatch(self, program_id, ident, index):
        def start():
            row = self._head(self._read(program_id, ident))
            command = row["commands"][index]
            if command["state"] != "ACKNOWLEDGED":
                command["state"] = "PENDING"
                command["attempts"].append({"at": now(), "revision": command["body"]["revision"]})
                self._save(row)
            return copy.deepcopy(command), row["proposal"]
        command, proposal = self.billing._write(start)
        if command["state"] == "ACKNOWLEDGED":
            return command
        try:
            result = self._native(proposal, command["action"], command["body"])
            if result.get("operation", {}).get("id") != command["requestId"]:
                self._fail("The native account returned a different original request.", self.error_prefix + "_NATIVE_RESPONSE", 502)
            def accepted():
                row = self._read(program_id, ident)
                current = row["commands"][index]
                if current["intentSha256"] != command["intentSha256"]:
                    self._fail("The original native billing command changed.")
                current.update({"state": "ACKNOWLEDGED", "result": result, "acknowledgedAt": now()})
                current.pop("lastError", None)
                if current["action"] == "draft":
                    row["activeInvoiceId"] = result["operation"]["result"]["invoiceId"]
                self._save(row)
                return copy.deepcopy(current)
            return self.billing._write(accepted)
        except Problem as error:
            def rejected():
                row = self._read(program_id, ident)
                current = row["commands"][index]
                if current["state"] != "ACKNOWLEDGED":
                    current["state"] = "REJECTED" if _native_rejected(command["action"], getattr(error, "code", "")) else "PENDING"
                    current["lastError"] = {"at": now(), "code": getattr(error, "code", ""), "message": str(error)}
                    self._save(row)
            self.billing._write(rejected)
            raise

    def apply(self, program_id, ident, body):
        self._exact(body, ("actor", "expectedProposalSha256"), ("actor", "expectedProposalSha256"))
        with self.workspace.mutex:
            row = self._head(self._read(program_id, ident))
            if body["expectedProposalSha256"] != row["proposalSha256"] or _required(body["actor"], "Original operator", 300) != row["proposal"]["actor"]:
                self._fail("Resume the original operator and full retained charge review.")
            if row["state"] == "APPLIED":
                return copy.deepcopy(row)
            proposal = row["proposal"]
        for index, step in enumerate(proposal["steps"]):
            with self.workspace.mutex:
                row = self._head(self._read(program_id, ident))
                command = copy.deepcopy(row["commands"][index]) if index < len(row["commands"]) else None
            if command and command["state"] == "ACKNOWLEDGED":
                continue
            if command and command["state"] == "PENDING":
                self._dispatch(program_id, ident, index)
                continue
            # Exact original replay precedes every current source/revision check.
            with self.workspace.mutex:
                self._review_refusal("APPLY", lambda: self._source_current(program_id, proposal))
            detail = self._native(proposal, "detail", {"invoiceId": proposal["invoiceId"]}) if proposal["invoiceId"] else None
            if index == 0 and detail and _fingerprint(detail) != proposal["nativeFingerprint"]:
                self._fail("The reviewed invoice or payment state changed. Retain this review and prepare its explicit successor.", self.error_prefix + "_APPLY_REVIEW")
            if index > 0 and detail:
                if proposal["resolution"] == "VOID" and detail["invoice"]["status"] != "VOID":
                    self._fail("The original invoice is not in its acknowledged void state.", self.error_prefix + "_APPLY_REVIEW")
                if proposal["resolution"] == "CREDIT":
                    scale = proposal["currency"]["scale"]
                    if sum(self._money(c["document"]["totals"]["total"], scale)[1] for c in detail["credits"]) != self._money(detail["draft"]["totals"]["total"], scale)[1]:
                        self._fail("The original invoice is no longer fully credited for replacement.", self.error_prefix + "_APPLY_REVIEW")
            revision = detail["revision"] if detail else self._native(proposal, "customers", {})["revision"]
            if command:
                def rebind():
                    current = self._head(self._read(program_id, ident))
                    target = current["commands"][index]
                    if target["state"] != "REJECTED" or target["intentSha256"] != command["intentSha256"]:
                        self._fail("The original request changed while reviewing its refusal.")
                    self._source_current(program_id, current["proposal"])
                    target["body"]["revision"] = revision
                    target["state"] = "PENDING"
                    self._save(current)
                self._review_refusal("APPLY", lambda: self.billing._write(rebind))
            else:
                made = self._new_command(program_id, ident, index, step, revision)
                if made["index"] != index:
                    self._fail("Reopen the original retained native command order.")
            self._dispatch(program_id, ident, index)
        def complete():
            current = self._head(self._read(program_id, ident))
            if any(c["state"] != "ACKNOWLEDGED" for c in current["commands"][:len(proposal["steps"])]):
                self._fail("Reconcile each original native result.")
            draft = next((c for c in reversed(current["commands"]) if c["action"] == "draft"), None)
            current["activeInvoiceId"] = draft["result"]["operation"]["result"]["invoiceId"] if draft else (
                None if proposal["mode"] == "VOID" else proposal["invoiceId"])
            current["state"] = "APPLIED"
            current["appliedAt"] = now()
            current["history"].append({"action": "applied", "at": now(), "actor": proposal["actor"]})
            self._save(current)
            return copy.deepcopy(current)
        return self.billing._write(complete)

    def _cancel_request(self, program_id, ident, body):
        self._exact(body, ("requestId", "actor", "expectedProposalSha256", "reason"),
              ("requestId", "actor", "expectedProposalSha256", "reason"))
        actor, reason = _required(body["actor"], "Recording operator", 300), _required(body["reason"], "Cancellation reason", 6000)
        short_id(body["requestId"], "Original cancellation request")
        with self.workspace.mutex:
            retained = self._read(program_id, ident)
            prior = next((h for h in retained["history"] if h["action"] == "cancelled" and h["requestId"] == body["requestId"]), None)
            if prior:
                if prior["body"] != body:
                    self._fail("This original cancellation request identifies a different review.", "REQUEST_CONFLICT")
                return {"id": ident}
        def save():
            self._context(program_id)
            row = self._read(program_id, ident)
            if body["expectedProposalSha256"] != row["proposalSha256"]:
                self._fail("Cancel the exact retained charge review.")
            if row["state"] == "CANCELLED":
                self._fail("This preparation is already cancelled; reopen its original cancellation.")
            self._head(row)
            if any(c["state"] != "REJECTED" for c in row["commands"]):
                self._fail("A native command is pending or acknowledged. Preserve it and use a reviewed correction.")
            row["state"] = "CANCELLED"
            row["history"].append({"action": "cancelled", "at": now(), "actor": actor,
                                   "reason": reason, "requestId": body["requestId"], "body": copy.deepcopy(body), "bodySha256": digest(body)})
            self._save(row)
            return {"id": ident}
        result = self.workspace._transaction(body["requestId"], {"domain": self.schema, "action": "cancel",
            "programId": program_id, "id": ident, "body": body}, save)
        return result

    def cancel(self, program_id, ident, body):
        result = self._review_refusal("CANCEL", lambda: self._cancel_request(program_id, ident, body))
        # A failure of the post-commit read is not a rejected cancellation.
        return self.get(program_id, result["id"])

    def preview_issue(self, program_id, ident):
        with self.workspace.mutex:
            row = self._head(self._read(program_id, ident))
            if row["state"] != "APPLIED" or not row.get("activeInvoiceId") or not any(c["action"] == "draft" for c in row["commands"]):
                self._fail("Complete the original billing draft before reviewing its issue.")
            prior = next((c for c in reversed(row["commands"]) if c["action"] == "issue"), None)
            if prior and prior["state"] in ("PENDING", "ACKNOWLEDGED"):
                return {**copy.deepcopy(prior["review"]), "retainedCommand": copy.deepcopy(prior)}
            self._source_current(program_id, row["proposal"])
        native = self._native(row["proposal"], "preview", {"invoiceId": row["activeInvoiceId"]})
        self._assert_document(row["proposal"], native["document"])
        review = {"schema": self.schema, "id": ident, "proposalSha256": row["proposalSha256"],
            "invoiceId": row["activeInvoiceId"], "nativePreview": native,
            "supersedesRejectedCommand": prior["index"] if prior else None,
            "termsSha256": row["proposal"]["termsSha256"]}
        review["issuePreviewSha256"] = digest(review)
        return review

    def issue(self, program_id, ident, body):
        self._exact(body, ("actor", "expectedIssuePreviewSha256", "creditDecisionId"),
              ("actor", "expectedIssuePreviewSha256"))
        with self.workspace.mutex:
            row = self._head(self._read(program_id, ident))
            if _required(body["actor"], "Original operator", 300) != row["proposal"]["actor"]:
                self._fail("Resume this charge's original recording operator.")
            prior = next((c for c in reversed(row["commands"]) if c["action"] == "issue"), None)
        if prior and prior["state"] in ("PENDING", "ACKNOWLEDGED"):
            if body["expectedIssuePreviewSha256"] != prior["review"]["issuePreviewSha256"] or (
                    body.get("creditDecisionId") or None) != (prior["body"].get("creditDecisionId") or None):
                self._fail("Resume the exact retained issue review and credit-control decision.")
            self._dispatch(program_id, ident, prior["index"])
            return self.get(program_id, ident, True)
        review = self._review_refusal("ISSUE", lambda: self.preview_issue(program_id, ident))
        if body["expectedIssuePreviewSha256"] != review["issuePreviewSha256"]:
            self._fail("Review the current exact native invoice before issue.", self.error_prefix + "_ISSUE_REVIEW")
        native = review["nativePreview"]
        self._review_refusal("ISSUE", lambda: _assert_credit_review(native, body.get("creditDecisionId")))
        step = {"action": "issue", "body": {"invoiceId": row["activeInvoiceId"],
            "expectedVersion": native["expectedVersion"], "previewSha256": native["previewSha256"]}}
        if body.get("creditDecisionId"):
            step["body"]["creditDecisionId"] = _required(body["creditDecisionId"], "Native credit decision", 100)
        command = self._new_command(program_id, ident, len(row["commands"]), step, native["revision"], review)
        self._dispatch(program_id, ident, command["index"])
        return self.get(program_id, ident, True)

    def export_rows(self, program_id):
        with self.workspace.mutex:
            chains = {r["chainId"] for r in self._rows(program_id)}
            return {"schema": self.schema, "items": [copy.deepcopy(r) for r in self._all() if r["chainId"] in chains]}

    def restore_rows(self, program_id, value):
        # Validation runs before the enclosing original Operations import transaction.
        for incoming in value["items"]:
            found = self.db.execute(f"SELECT body_json FROM {self.table} WHERE id=?", (incoming["id"],)).fetchone()
            if found:
                original = json.loads(found[0])
                if original["proposalSha256"] != incoming["proposalSha256"] or original["sequence"] != incoming["sequence"]:
                    self._fail("A received customer charge changes its original reviewed source.")
                common = min(len(original["commands"]), len(incoming["commands"]))
                winner = copy.deepcopy(original if len(original["commands"]) >= len(incoming["commands"]) else incoming)
                for index in range(common):
                    left, right = original["commands"][index], incoming["commands"][index]
                    if left["intentSha256"] != right["intentSha256"] or left.get("review") != right.get("review"):
                        self._fail("The received original accounting request or review diverges.")
                    if left["state"] == right["state"] == "ACKNOWLEDGED" and left["result"]["operation"]["result"] != right["result"]["operation"]["result"]:
                        self._fail("An accounting acknowledgement names a different native result.")
                    winner["commands"][index] = copy.deepcopy(left if left["state"] == "ACKNOWLEDGED" else
                        right if right["state"] == "ACKNOWLEDGED" else left if left["state"] == "PENDING" else right)
                cancelled = next((r for r in (original, incoming) if r["state"] == "CANCELLED"), None)
                applied = next((r for r in (original, incoming) if r["state"] == "APPLIED"), None)
                if cancelled:
                    if any(r["state"] != "CANCELLED" and r["proposal"]["previousId"] == incoming["id"] for r in self._all() + value["items"]):
                        self._fail("A received cancellation conflicts with a retained successor review.")
                    if applied or any(c["state"] != "REJECTED" for c in winner["commands"]):
                        self._fail("Cancellation conflicts with retained native financial activity.")
                    winner["state"] = "CANCELLED"
                elif applied:
                    winner.update({k: applied[k] for k in ("state", "activeInvoiceId", "appliedAt")})
                history = {canonical(event): event for r in (original, incoming) for event in r["history"]}
                winner["history"] = sorted(history.values(), key=lambda e: (e["at"], canonical(e)))
                draft = next((c for c in reversed(winner["commands"]) if c["action"] == "draft" and c["state"] == "ACKNOWLEDGED"), None)
                winner["activeInvoiceId"] = draft["result"]["operation"]["result"]["invoiceId"] if draft else (
                    winner["proposal"]["invoiceId"] if winner["state"] == "APPLIED" and winner["proposal"]["mode"] != "VOID" else None)
                for index in range(common):
                    left, right = original["commands"][index], incoming["commands"][index]
                    attempts = {canonical(item): item for item in left["attempts"] + right["attempts"]}
                    winner["commands"][index]["attempts"] = sorted(attempts.values(), key=lambda item: (item["at"], canonical(item)))
                self._save(winner)
            else:
                clash = self.db.execute(f"SELECT id FROM {self.table} WHERE chain_id=? AND sequence=?",
                    (incoming["chainId"], incoming["sequence"])).fetchone()
                if clash:
                    self._fail("This copied case contains a divergent original customer charge sequence.")
                self.db.execute(f"INSERT INTO {self.table} VALUES(?,?,?,?)",
                    (incoming["id"], incoming["chainId"], incoming["sequence"], canonical(incoming)))
            self.db.execute(f"INSERT OR IGNORE INTO {self.table}_cases VALUES(?,?)", (program_id, incoming["id"]))
        # A copy references original charges; it never creates another reservation.
        self._validate_exposure(self._all())
        return {"schema": self.schema, "received": len(value["items"])}


def _journal_money(value, scale):
    return _amount(value, scale, "Reviewed customer amount")

def _journal_units(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,99})", value):
        raise Problem(label + " must retain an integer source-unit string.", 422, "SOURCE_BILLING_IMPORT")
    return int(value)

def validate_rows(value, *, schema, id_prefix, chain_prefix, error_prefix,
                  validate_proposal, compile_steps, assert_document, validate_exposure, fail, exact,
                  validate_preparation=None):
    """Verify complete original command/chain history using its domain source validator."""
    if value is None:
        return {"schema": schema, "items": []}
    try:
        exact(value, ("schema", "items"), ("schema", "items"))
        if value["schema"] != schema or not isinstance(value["items"], list) or len(value["items"]) > 10000:
            fail("Retain the complete supported source-billing history.", status=422)
        rows = value["items"]
        by_id, by_sequence = {}, set()
        for row in rows:
            required = ("schema", "id", "chainId", "sequence", "createdAt", "state", "proposal",
                        "proposalSha256", "activeInvoiceId", "commands", "history", "preparationRequest")
            exact(row, (*required, "appliedAt"), required)
            if row["schema"] != schema or not re.fullmatch(re.escape(id_prefix) + r"[a-f0-9]{32}", row["id"]) or row["id"] in by_id:
                fail("The original expense charge identity is invalid or repeated.", status=422)
            if type(row["sequence"]) is not int or row["sequence"] < 1 or (row["chainId"], row["sequence"]) in by_sequence:
                fail("The original charge sequence is invalid or repeated.", status=422)
            by_id[row["id"]] = row
            by_sequence.add((row["chainId"], row["sequence"]))
            p = row["proposal"]
            if digest(p) != row["proposalSha256"] or p["schema"] != schema or p["chainId"] != row["chainId"] or p["mode"] not in ("NEW", "DRAFT_EDIT", "CREDIT", "VOID", "REPLACE"):
                fail("The complete original charge proposal changed.", status=422)
            validate_proposal(p)
            if p["nativeFingerprint"] != (_fingerprint(p["nativeBefore"]) if p["nativeBefore"] else None) or p["steps"] != compile_steps(p):
                fail("The original native financial plan changed.", status=422)
            preparation = row["preparationRequest"]
            request_body = preparation["body"]
            if digest(request_body) != preparation["sha256"] or request_body["expectedPreviewSha256"] != row["proposalSha256"] or request_body["requestId"] != p["requestId"] or request_body["expectedVersion"] != p["expectedVersion"] or request_body["mode"] != p["mode"] or request_body.get("previousId") != p["previousId"]:
                fail("The original local preparation request changed.", status=422)
            if _required(request_body["actor"], "Original recording operator", 300) != p["actor"]:
                fail("The original preparation actor differs from the retained review.", status=422)
            if validate_preparation is not None:
                validate_preparation(p, request_body)
            for event in row["history"]:
                if event["action"] == "cancelled":
                    if event["bodySha256"] != digest(event["body"]) or event["requestId"] != event["body"]["requestId"] or event["body"]["expectedProposalSha256"] != row["proposalSha256"]:
                        fail("The original cancellation request changed.", status=422)
            if row["state"] not in ("PREPARED", "RUNNING", "APPLIED", "CANCELLED") or not isinstance(row["commands"], list):
                fail("The original charge lifecycle is unsupported.", status=422)
            if row["state"] == "PREPARED" and row["commands"]:
                fail("A prepared-only review contains a dispatched command.", status=422)
            if row["state"] == "CANCELLED" and any(c["state"] != "REJECTED" for c in row["commands"]):
                fail("Cancellation contains an acknowledged or uncertain native action.", status=422)
            previous_issue = None
            for index, command in enumerate(row["commands"]):
                if command["index"] != index or command["requestId"] != row["id"] + "-native-" + str(index+1):
                    fail("The original native request sequence changed.", status=422)
                body = command["body"]
                if command["state"] not in ("PENDING", "REJECTED", "ACKNOWLEDGED") or body["requestId"] != command["requestId"] or body["actor"] != p["actor"]:
                    fail("The original native command identity changed.", status=422)
                if type(body["revision"]) is not int or body["revision"] < 0:
                    fail("The native command revision is invalid.", status=422)
                if digest({"action": command["action"], "body": {k: v for k, v in body.items() if k != "revision"}}) != command["intentSha256"]:
                    fail("The original accounting request payload changed.", status=422)
                native_body = {k: v for k, v in body.items() if k not in ("actor", "requestId", "revision")}
                if index < len(p["steps"]):
                    if {"action": command["action"], "body": native_body} != p["steps"][index] or any(
                            c["state"] != "ACKNOWLEDGED" for c in row["commands"][:index]):
                        fail("The retained financial commands bypass their reviewed order.", status=422)
                else:
                    review = command["review"]
                    if command["action"] != "issue" or not all(c["state"] == "ACKNOWLEDGED" for c in row["commands"][:len(p["steps"])]):
                        fail("The native issue precedes its original draft.", status=422)
                    if previous_issue and previous_issue["state"] != "REJECTED":
                        fail("Another issue follows an unresolved or acknowledged original request.", status=422)
                    bare = {k: v for k, v in review.items() if k != "issuePreviewSha256"}
                    if digest(bare) != review["issuePreviewSha256"] or review["id"] != row["id"] or review["proposalSha256"] != row["proposalSha256"] or review["termsSha256"] != p["termsSha256"] or review["supersedesRejectedCommand"] != (previous_issue["index"] if previous_issue else None):
                        fail("The retained invoice issue review changed.", status=422)
                    native = review["nativePreview"]
                    assert_document(p, native["document"])
                    expected = {"invoiceId": review["invoiceId"], "expectedVersion": native["expectedVersion"], "previewSha256": native["previewSha256"]}
                    if "creditDecisionId" in native_body:
                        expected["creditDecisionId"] = native_body["creditDecisionId"]
                    _assert_credit_review(native, native_body.get("creditDecisionId"))
                    if native_body != expected or review["invoiceId"] != row["activeInvoiceId"]:
                        fail("The issue names a different original invoice.", status=422)
                    previous_issue = command
                if command["state"] == "REJECTED" and not _native_rejected(command["action"], command["lastError"]["code"]):
                    fail("An uncertain native result was incorrectly marked rejected.", status=422)
                if command["state"] == "ACKNOWLEDGED":
                    if command["result"]["operation"]["id"] != command["requestId"]:
                        fail("The original native acknowledgement has another request identity.", status=422)
                    if command["action"] == "draft":
                        _required(command["result"]["operation"]["result"]["invoiceId"], "Native invoice ID", 200)
            draft = next((c for c in reversed(row["commands"]) if c["action"] == "draft" and c["state"] == "ACKNOWLEDGED"), None)
            active = draft["result"]["operation"]["result"]["invoiceId"] if draft else None
            if row["state"] == "APPLIED":
                if len(row["commands"]) < len(p["steps"]) or any(c["state"] != "ACKNOWLEDGED" for c in row["commands"][:len(p["steps"])]):
                    fail("Applied source billing lacks its original acknowledged commands.", status=422)
                if not draft:
                    active = None if p["mode"] == "VOID" else p["invoiceId"]
            if row["activeInvoiceId"] != active:
                fail("The active invoice differs from its original native acknowledgement.", status=422)
            if not isinstance(row["history"], list) or not row["history"] or not any(h["action"] == "prepared" for h in row["history"]):
                fail("The complete charge history is absent.", status=422)
            if row["state"] == "CANCELLED" and not any(h["action"] == "cancelled" and h.get("reason") and h.get("requestId") for h in row["history"]):
                fail("A cancelled charge lost its original recorded decision.", status=422)
        for chain in {r["chainId"] for r in rows}:
            ordered = sorted((r for r in rows if r["chainId"] == chain), key=lambda r: r["sequence"])
            head = None
            for sequence, row in enumerate(ordered, 1):
                p = row["proposal"]
                if row["sequence"] != sequence or p["previousId"] != (head["id"] if head else None):
                    fail("The complete original customer charge chain is missing or reordered.", status=422)
                if head:
                    old = head["proposal"]
                    if any(p[k] != old[k] for k in ("endpointId", "customerId", "currency", "accountingIdentity")):
                        fail("A correction changed the original customer or native account.", status=422)
                    previous_invoice = head.get("activeInvoiceId") or old.get("invoiceId")
                    if p["invoiceId"] != previous_invoice:
                        fail("A correction lost its original invoice relationship.", status=422)
                    if p["mode"] in ("CREDIT", "VOID"):
                        prior = {x["portionKey"]: x for x in old["lines"]}
                        if set(prior) != {x["portionKey"] for x in p["lines"]} or any(_journal_units(x["nativeAmount"], "Remaining portion") > _journal_units(prior[x["portionKey"]]["nativeAmount"], "Original portion") for x in p["lines"]):
                            fail("An imported credit increases or substitutes the original source population.", status=422)
                elif p["mode"] != "NEW" or p["chainId"] != chain_prefix + digest({"programId": p["programId"], "requestId": p["requestId"]})[:32]:
                    fail("The original first charge identity changed.", status=422)
                if row["state"] != "CANCELLED":
                    head = row
        validate_exposure(rows)
        return copy.deepcopy(value)
    except Problem:
        raise
    except (KeyError, TypeError, ValueError, IndexError, AttributeError) as error:
        raise Problem("The complete original source-billing record is malformed.", 422, error_prefix + "_IMPORT") from error


def compile_native_steps(proposal, *, line_prefix, source_label, failure):
    """Rebuild native financial commands solely from the reviewed edition."""
    fail = failure
    mode, scale = proposal["mode"], proposal["currency"]["scale"]
    lines = proposal["lines"]
    draft_lines = [{"id": line_prefix + "-" + row["portionKey"][:40],
                    "description": row["description"], "quantity": "1",
                    "unitAmount": row["amount"]} for row in lines]
    request = {"customerId": proposal["customerId"], "currency": proposal["currency"],
               "issueDate": proposal["issueDate"], "dueDate": proposal["dueDate"],
               "purchaseOrder": proposal["purchaseOrder"], "note": proposal["note"],
               "lines": draft_lines, "sourceReference": source_label + " " + proposal["chainId"] +
               "; terms " + proposal["termsSha256"]}
    if not lines or len({line["id"] for line in draft_lines}) != len(lines):
        fail("Retain each selected original portion exactly once.", status=422)
    if mode in ("NEW", "DRAFT_EDIT", "REPLACE") and any(_journal_money(x["amount"], scale)[1] <= 0 for x in lines):
        fail("Every new native invoice line needs a positive agreed amount.", status=422)
    if mode == "NEW":
        if proposal["nativeBefore"] is not None or proposal["invoiceId"] is not None:
            fail("A first expense charge cannot replace an existing invoice.", status=422)
        return [{"action": "draft", "body": request}]
    detail = proposal["nativeBefore"]
    invoice, draft = detail["invoice"], detail["draft"]
    invoice_id = proposal["invoiceId"]
    if invoice["id"] != invoice_id or invoice["customerId"] != proposal["customerId"] or draft["currency"] != proposal["currency"]:
        fail("The current invoice customer, currency or original ID differs.")
    if proposal["effectiveDate"] < draft["issueDate"]:
        fail("A correction cannot precede the original invoice date.", status=422)
    steps = []
    if mode == "DRAFT_EDIT":
        if invoice["status"] != "DRAFT":
            fail("Edit only an unissued native draft.")
        request.update({"id": invoice_id, "expectedVersion": invoice["version"]})
        if draft.get("replacesId"):
            request["replacesId"] = draft["replacesId"]
    elif mode in ("CREDIT", "REPLACE", "VOID"):
        if invoice["status"] != "ISSUED":
            fail("An issued native invoice is required for credit, void or replacement.")
        resolution = "CREDIT" if mode == "CREDIT" else "VOID" if mode == "VOID" else proposal["resolution"]
        if resolution == "VOID":
            if detail["credits"] or any(not a.get("releasedDate") or a["releasedDate"] > proposal["effectiveDate"]
                                        for a in detail["allocations"]):
                fail("The invoice has credits or effective payment allocations. Review its native account or use credit and replacement.")
            steps.append({"action": "void", "body": {"invoiceId": invoice_id,
                "voidDate": proposal["effectiveDate"], "reason": proposal["reason"]}})
        else:
            targets = {x["id"]: _journal_money(x["unitAmount"], scale)[1] for x in draft_lines}
            original = {x["id"]: x for x in draft["lines"]}
            if mode == "CREDIT" and set(targets) != set(original):
                fail("A credit review must retain every original invoice line and its explicit remaining amount.")
            credits = {}
            for credit in detail["credits"]:
                for line in credit["document"]["lines"]:
                    credits[line["invoiceLineId"]] = credits.get(line["invoiceLineId"], 0) + _journal_money(line["netAmount"], scale)[1]
            selected = []
            for line in draft["lines"]:
                if _journal_money(line["taxAmount"], scale)[1] or _journal_money(line["discountAmount"], scale)[1]:
                    fail("Review externally added invoice tax or discount in native Receivables before returning to this charge.")
                remaining = _journal_money(line["netAmount"], scale)[1] - credits.get(line["id"], 0)
                target = targets[line["id"]] if mode == "CREDIT" else 0
                if target > remaining or remaining < 0:
                    fail("The remaining customer amount exceeds its original line after existing credits.")
                if remaining > target:
                    selected.append({"invoiceLineId": line["id"], "netAmount": _money(remaining-target, scale),
                                     "taxAmount": _money(0, scale)})
            if selected:
                steps.append({"action": "credit", "body": {"invoiceId": invoice_id,
                    "creditDate": proposal["effectiveDate"], "reason": proposal["reason"], "lines": selected}})
            elif mode == "CREDIT":
                fail("The reviewed remaining amounts create no additional credit.", status=422)
        if mode == "REPLACE":
            request["replacesId"] = invoice_id
    else:
        fail("Choose a supported charge continuation.", status=422)
    if mode in ("DRAFT_EDIT", "REPLACE"):
        steps.append({"action": "draft", "body": request})
    return steps


def assert_native_document(proposal, document, *, failure):
    fail = failure
    step = next((x["body"] for x in reversed(proposal["steps"]) if x["action"] == "draft"), None)
    if step is None:
        fail("This review contains no draft to issue.")
    for key in ("customerId", "currency", "issueDate", "dueDate", "purchaseOrder", "note", "sourceReference", "replacesId"):
        actual, expected = document.get(key), step.get(key)
        if key in ("purchaseOrder", "note", "replacesId"):
            actual, expected = actual or "", expected or ""
        if actual != expected:
            fail("The native draft differs from its reviewed expense-billing terms.")
    if document.get("customer", {}).get("id") != proposal["customerId"]:
        fail("The original customer binding changed.")
    if len(document["lines"]) != len(step["lines"]):
        fail("The native invoice line population changed.")
    scale = proposal["currency"]["scale"]
    for actual, expected in zip(document["lines"], step["lines"]):
        if any(actual.get(k) != expected[k] for k in ("id", "description", "unitAmount")) or (
                Decimal(actual["quantity"]) != Decimal(1) or
                _journal_money(actual["taxAmount"], scale)[1] or _journal_money(actual["discountAmount"], scale)[1]):
            fail("A native invoice line differs from its reviewed original expense portion.")
    if _journal_money(document["totals"]["total"], scale)[1] != sum(_journal_money(x["amount"], scale)[1] for x in proposal["lines"]):
        fail("The native total differs from the explicit agreed line amounts.")

