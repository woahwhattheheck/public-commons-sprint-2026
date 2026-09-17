from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

MAX_TEXT = 2000
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
ALLOWED_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "URGENT"}
ALLOWED_ISSUE_STATES = {"OPEN", "IN_REVIEW", "PLAN_PROPOSED", "CLOSED"}
SIDE_EFFECT_KINDS = {"SEND_MESSAGE", "PLACE_ORDER", "SCHEDULE_VISIT", "CHANGE_DEVICE_STATE"}


class HomeOpsError(ValueError):
    pass


def canonical_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _text(value: Any, name: str, *, max_len: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or not value or len(value) > max_len:
        raise HomeOpsError(f"{name}: invalid text")
    if any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise HomeOpsError(f"{name}: control character")
    return value


def _id(value: Any, name: str) -> str:
    value = _text(value, name, max_len=96)
    if not ID_RE.fullmatch(value):
        raise HomeOpsError(f"{name}: invalid id")
    return value


def _priority(value: Any) -> str:
    value = _text(value, "priority", max_len=16).upper()
    if value not in ALLOWED_PRIORITIES:
        raise HomeOpsError("priority: unsupported")
    return value


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class HomeOpsStore:
    issues: dict[str, dict[str, Any]] = field(default_factory=dict)
    evidence: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    quotes: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    plans: dict[str, dict[str, Any]] = field(default_factory=dict)
    approvals: dict[str, dict[str, Any]] = field(default_factory=dict)
    actions: dict[str, dict[str, Any]] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)

    def _event(self, kind: str, subject_id: str, body: dict[str, Any]) -> dict[str, Any]:
        prior = self.events[-1]["event_digest"] if self.events else "0" * 64
        event = {
            "schema": "homeops-event/v1",
            "seq": len(self.events) + 1,
            "kind": kind,
            "subject_id": subject_id,
            "body": body,
            "prior_digest": prior,
        }
        event["event_digest"] = digest(event)
        self.events.append(event)
        return event

    def create_issue(self, args: dict[str, Any]) -> dict[str, Any]:
        wanted = {"issue_id", "title", "description", "priority"}
        if set(args) != wanted:
            raise HomeOpsError("create_issue: exact fields required")
        issue_id = _id(args["issue_id"], "issue_id")
        if issue_id in self.issues:
            raise HomeOpsError("issue_id already exists")
        issue = {
            "issue_id": issue_id,
            "title": _text(args["title"], "title", max_len=160),
            "description": _text(args["description"], "description"),
            "priority": _priority(args["priority"]),
            "state": "OPEN",
            "created_at": now_utc(),
        }
        issue["record_digest"] = digest(issue)
        self.issues[issue_id] = issue
        self._event("ISSUE_CREATED", issue_id, {"record_digest": issue["record_digest"]})
        return issue

    def add_evidence(self, args: dict[str, Any]) -> dict[str, Any]:
        wanted = {"issue_id", "evidence_id", "kind", "summary", "source"}
        if set(args) != wanted:
            raise HomeOpsError("add_evidence: exact fields required")
        issue_id = _id(args["issue_id"], "issue_id")
        if issue_id not in self.issues:
            raise HomeOpsError("unknown issue")
        evidence_id = _id(args["evidence_id"], "evidence_id")
        rows = self.evidence.setdefault(issue_id, [])
        if any(x["evidence_id"] == evidence_id for x in rows):
            raise HomeOpsError("duplicate evidence_id")
        row = {
            "issue_id": issue_id,
            "evidence_id": evidence_id,
            "kind": _text(args["kind"], "kind", max_len=64).upper(),
            "summary": _text(args["summary"], "summary"),
            "source": _text(args["source"], "source", max_len=512),
            "observed_at": now_utc(),
        }
        row["record_digest"] = digest(row)
        rows.append(row)
        self._event("EVIDENCE_ADDED", issue_id, {"evidence_id": evidence_id, "record_digest": row["record_digest"]})
        return row

    def add_quote(self, args: dict[str, Any]) -> dict[str, Any]:
        wanted = {"issue_id", "quote_id", "vendor", "amount_cents", "currency", "scope"}
        if set(args) != wanted:
            raise HomeOpsError("add_quote: exact fields required")
        issue_id = _id(args["issue_id"], "issue_id")
        if issue_id not in self.issues:
            raise HomeOpsError("unknown issue")
        quote_id = _id(args["quote_id"], "quote_id")
        amount = args["amount_cents"]
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 0 or amount > 100_000_000:
            raise HomeOpsError("amount_cents: invalid integer")
        currency = _text(args["currency"], "currency", max_len=3).upper()
        if not re.fullmatch(r"[A-Z]{3}", currency):
            raise HomeOpsError("currency: invalid")
        rows = self.quotes.setdefault(issue_id, [])
        if any(x["quote_id"] == quote_id for x in rows):
            raise HomeOpsError("duplicate quote_id")
        row = {
            "issue_id": issue_id,
            "quote_id": quote_id,
            "vendor": _text(args["vendor"], "vendor", max_len=160),
            "amount_cents": amount,
            "currency": currency,
            "scope": _text(args["scope"], "scope"),
            "received_at": now_utc(),
        }
        row["record_digest"] = digest(row)
        rows.append(row)
        self._event("QUOTE_ADDED", issue_id, {"quote_id": quote_id, "record_digest": row["record_digest"]})
        return row

    def propose_plan(self, args: dict[str, Any]) -> dict[str, Any]:
        wanted = {"issue_id", "plan_id", "summary", "steps"}
        if set(args) != wanted:
            raise HomeOpsError("propose_plan: exact fields required")
        issue_id = _id(args["issue_id"], "issue_id")
        if issue_id not in self.issues:
            raise HomeOpsError("unknown issue")
        plan_id = _id(args["plan_id"], "plan_id")
        if plan_id in self.plans:
            raise HomeOpsError("duplicate plan_id")
        steps = args["steps"]
        if not isinstance(steps, list) or not 1 <= len(steps) <= 16:
            raise HomeOpsError("steps: 1..16 strings required")
        norm_steps = [_text(x, f"steps[{i}]", max_len=400) for i, x in enumerate(steps)]
        issue = self.issues[issue_id]
        issue["state"] = "PLAN_PROPOSED"
        issue["record_digest"] = digest({k: v for k, v in issue.items() if k != "record_digest"})
        self._event("ISSUE_STATE_CHANGED", issue_id, {"state": issue["state"], "record_digest": issue["record_digest"]})
        evidence_digests = sorted(x["record_digest"] for x in self.evidence.get(issue_id, []))
        quote_digests = sorted(x["record_digest"] for x in self.quotes.get(issue_id, []))
        plan = {
            "plan_id": plan_id,
            "issue_id": issue_id,
            "summary": _text(args["summary"], "summary"),
            "steps": norm_steps,
            "issue_digest": issue["record_digest"],
            "evidence_digests": evidence_digests,
            "quote_digests": quote_digests,
            "authority": "PROPOSAL_ONLY",
        }
        plan["plan_digest"] = digest(plan)
        self.plans[plan_id] = plan
        self._event("PLAN_PROPOSED", issue_id, {"plan_id": plan_id, "plan_digest": plan["plan_digest"]})
        return plan

    def review_plan(self, args: dict[str, Any]) -> dict[str, Any]:
        wanted = {"plan_id", "decision", "reviewer", "note"}
        if set(args) != wanted:
            raise HomeOpsError("review_plan: exact fields required")
        plan_id = _id(args["plan_id"], "plan_id")
        if plan_id not in self.plans:
            raise HomeOpsError("unknown plan")
        decision = _text(args["decision"], "decision", max_len=16).upper()
        if decision not in {"APPROVE", "REJECT"}:
            raise HomeOpsError("decision: APPROVE or REJECT")
        if plan_id in self.approvals:
            raise HomeOpsError("plan already reviewed")
        approval = {
            "plan_id": plan_id,
            "plan_digest": self.plans[plan_id]["plan_digest"],
            "decision": decision,
            "reviewer": _id(args["reviewer"], "reviewer"),
            "note": _text(args["note"], "note", max_len=600),
            "reviewed_at": now_utc(),
        }
        approval["approval_digest"] = digest(approval)
        self.approvals[plan_id] = approval
        issue_id = self.plans[plan_id]["issue_id"]
        self._event("PLAN_REVIEWED", issue_id, {"plan_id": plan_id, "approval_digest": approval["approval_digest"]})
        return approval

    def request_side_effect(self, args: dict[str, Any]) -> dict[str, Any]:
        wanted = {"plan_id", "action_id", "kind", "summary"}
        if set(args) != wanted:
            raise HomeOpsError("request_side_effect: exact fields required")
        plan_id = _id(args["plan_id"], "plan_id")
        if plan_id not in self.plans:
            raise HomeOpsError("unknown plan")
        approval = self.approvals.get(plan_id)
        if not approval or approval["decision"] != "APPROVE" or approval["plan_digest"] != self.plans[plan_id]["plan_digest"]:
            raise HomeOpsError("approved exact plan required")
        action_id = _id(args["action_id"], "action_id")
        if action_id in self.actions:
            raise HomeOpsError("duplicate action_id")
        kind = _text(args["kind"], "kind", max_len=40).upper()
        if kind not in SIDE_EFFECT_KINDS:
            raise HomeOpsError("kind: unsupported side effect")
        request = {
            "action_id": action_id,
            "plan_id": plan_id,
            "plan_digest": self.plans[plan_id]["plan_digest"],
            "approval_digest": approval["approval_digest"],
            "kind": kind,
            "summary": _text(args["summary"], "summary"),
            "execution_authorized": False,
            "requires_external_executor": True,
        }
        request["request_digest"] = digest(request)
        self.actions[action_id] = request
        self._event("SIDE_EFFECT_REQUESTED", self.plans[plan_id]["issue_id"], {"request_digest": request["request_digest"]})
        return request

    def get_issue(self, args: dict[str, Any]) -> dict[str, Any]:
        if set(args) != {"issue_id"}:
            raise HomeOpsError("get_issue: issue_id required")
        issue_id = _id(args["issue_id"], "issue_id")
        if issue_id not in self.issues:
            raise HomeOpsError("unknown issue")
        return {
            "issue": self.issues[issue_id],
            "evidence": list(self.evidence.get(issue_id, [])),
            "quotes": list(self.quotes.get(issue_id, [])),
            "plans": [x for x in self.plans.values() if x["issue_id"] == issue_id],
            "actions": [x for x in self.actions.values() if self.plans[x["plan_id"]]["issue_id"] == issue_id],
        }

    def verify_event_chain(self) -> dict[str, Any]:
        prior = "0" * 64
        for idx, event in enumerate(self.events, start=1):
            body = dict(event)
            claimed = body.pop("event_digest", None)
            if body.get("seq") != idx or body.get("prior_digest") != prior or digest(body) != claimed:
                return {"valid": False, "failed_seq": idx, "event_count": len(self.events)}
            prior = claimed
        return {"valid": True, "failed_seq": None, "event_count": len(self.events), "head_digest": prior}
