"""Exact supplied-record arithmetic and replay for a local paper treasury ledger.

Original product/design: Z-ObliqueLedger-0228, public-commons-sprint-2026 #134.
No provider operation, price forecast, investment recommendation or live execution.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any

MAX_BYTES = 4 * 1024 * 1024
MAX_SAFE = 2**53 - 1
ZERO_HASH = "0" * 64
CASE_SCHEMA = "proof-treasury.case/v1"
SNAPSHOT_SCHEMA = "proof-treasury.snapshot/v1"
PROPOSAL_SCHEMA = "proof-treasury.proposal/v1"
EVENT_SCHEMA = "proof-treasury.event/v1"
AUTHORITY = {"mode": "PAPER_ONLY", "live_execution_authorized": False}
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}\Z")
DECIMAL = re.compile(r"(?:0|[1-9][0-9]{0,35})(?:\.[0-9]{1,24})?\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")


class TreasuryError(ValueError):
    def __init__(self, code: str, path: str = ""):
        super().__init__(code)
        self.code, self.path = code, path


def fail(code: str, path: str = "") -> None:
    raise TreasuryError(code, path)


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def digest(value: Any) -> str:
    return sha256(canonical(value).encode("utf-8"))


def source_digest() -> str:
    return sha256(Path(__file__).read_bytes())


def load_json(text: str) -> Any:
    if len(text.encode("utf-8", "strict")) > MAX_BYTES:
        fail("INPUT_TOO_LARGE")
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > 32:
                fail("JSON_DEPTH_LIMIT")
        elif char in "]}":
            depth -= 1
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                fail("JSON_DUPLICATE_KEY")
            result[key] = value
        return result
    def number(_value):
        fail("JSON_INTEGER_OR_DECIMAL_STRING_REQUIRED")
    try:
        result = json.loads(text, object_pairs_hook=pairs, parse_float=number,
                            parse_constant=number)
        canonical(result).encode("utf-8", "strict")
        return result
    except TreasuryError:
        raise
    except (ValueError, RecursionError, UnicodeError) as exc:
        raise TreasuryError("JSON_INVALID") from exc


def keys(value: Any, expected: set[str], path: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail("OBJECT_FIELDS_INVALID", path)


def integer(value: Any, path: str, low: int = 0, high: int = MAX_SAFE) -> int:
    if type(value) is not int or not low <= value <= high:
        fail("INTEGER_OUT_OF_RANGE", path)
    return value


def identifier(value: Any, path: str) -> str:
    if type(value) is not str or not ID.fullmatch(value):
        fail("IDENTIFIER_INVALID", path)
    return value


def utc(value: Any, path: str = "at") -> datetime:
    if type(value) is not str or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        fail("UTC_WHOLE_SECOND_REQUIRED", path)
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise TreasuryError("UTC_INVALID", path) from exc


def stamp(value: datetime) -> str:
    return (f"{value.year:04d}-{value.month:02d}-{value.day:02d}T"
            f"{value.hour:02d}:{value.minute:02d}:{value.second:02d}Z")


def later(value: datetime, seconds: int) -> datetime:
    try:
        return value + timedelta(seconds=seconds)
    except OverflowError as exc:
        raise TreasuryError("TIMESTAMP_ARITHMETIC_OUT_OF_RANGE") from exc


def decimal(value: Any, path: str, *, positive: bool = False) -> Fraction:
    if type(value) is not str or not DECIMAL.fullmatch(value):
        fail("DECIMAL_STRING_REQUIRED", path)
    result = Fraction(value)
    if positive and result <= 0:
        fail("POSITIVE_AMOUNT_REQUIRED", path)
    return result


def fraction(value: Any, path: str) -> Fraction:
    if type(value) is not str or len(value) > 150:
        fail("NONNEGATIVE_EXACT_AMOUNT_REQUIRED", path)
    if "/" not in value:
        return decimal(value, path)
    if not re.fullmatch(r"(?:0|[1-9][0-9]{0,71})/[1-9][0-9]{0,71}", value):
        fail("NONNEGATIVE_EXACT_AMOUNT_REQUIRED", path)
    return Fraction(value)


def exact(value: Fraction | int) -> str:
    value = Fraction(value)
    if value.denominator == 1:
        return str(value.numerator)
    denominator, twos, fives = value.denominator, 0, 0
    while denominator % 2 == 0:
        denominator //= 2
        twos += 1
    while denominator % 5 == 0:
        denominator //= 5
        fives += 1
    if denominator != 1:
        return f"{value.numerator}/{value.denominator}"
    scale = max(twos, fives)
    amount = abs(value.numerator) * 10**scale // value.denominator
    whole, rest = divmod(amount, 10**scale)
    return ("-" if value < 0 else "") + str(whole) + "." + str(rest).zfill(scale).rstrip("0")


def validate_case(case: Any) -> None:
    keys(case, {"schema", "snapshot", "portfolio", "policy", "order"}, "")
    if case["schema"] != CASE_SCHEMA:
        fail("CASE_SCHEMA")
    snapshot, portfolio, policy, order = (case[k] for k in ("snapshot", "portfolio", "policy", "order"))
    keys(snapshot, {"schema", "source_kind", "source_id", "observed_at", "quote_as_of",
                    "quote_currency", "quote_scale", "evidence_sha256", "quotes"}, "/snapshot")
    if snapshot["schema"] != SNAPSHOT_SCHEMA:
        fail("SNAPSHOT_SCHEMA", "/snapshot/schema")
    if snapshot["source_kind"] not in ("SUPPLIED_OFFLINE", "SOSOVALUE_API"):
        fail("SOURCE_KIND_INVALID", "/snapshot/source_kind")
    source_id = snapshot["source_id"]
    if type(source_id) is not str or not 1 <= len(source_id) <= 240 or any(ord(c) < 32 for c in source_id):
        fail("SOURCE_ID_INVALID", "/snapshot/source_id")
    utc(snapshot["observed_at"], "/snapshot/observed_at")
    if snapshot["quote_as_of"] is not None:
        utc(snapshot["quote_as_of"], "/snapshot/quote_as_of")
    if type(snapshot["quote_currency"]) is not str or not re.fullmatch(r"[A-Z]{3}", snapshot["quote_currency"]):
        fail("CURRENCY_TOKEN_INVALID", "/snapshot/quote_currency")
    integer(snapshot["quote_scale"], "/snapshot/quote_scale", 0, 8)
    if type(snapshot["evidence_sha256"]) is not str or not DIGEST.fullmatch(snapshot["evidence_sha256"]):
        fail("SOURCE_DIGEST_INVALID", "/snapshot/evidence_sha256")
    if type(snapshot["quotes"]) is not list or not 1 <= len(snapshot["quotes"]) <= 100:
        fail("QUOTE_COUNT_INVALID", "/snapshot/quotes")
    seen = set()
    for i, quote in enumerate(snapshot["quotes"]):
        path = f"/snapshot/quotes/{i}"
        keys(quote, {"asset_id", "price_minor"}, path)
        asset = identifier(quote["asset_id"], path + "/asset_id")
        if asset in seen:
            fail("DUPLICATE_QUOTE", path)
        seen.add(asset)
        decimal(quote["price_minor"], path + "/price_minor", positive=True)
    keys(portfolio, {"portfolio_id", "generation_id", "quote_currency", "quote_scale", "cash_minor",
                     "turnover_minor", "realized_loss_minor", "positions"}, "/portfolio")
    identifier(portfolio["portfolio_id"], "/portfolio/portfolio_id")
    identifier(portfolio["generation_id"], "/portfolio/generation_id")
    if (portfolio["quote_currency"], portfolio["quote_scale"]) != (snapshot["quote_currency"], snapshot["quote_scale"]):
        fail("QUOTE_UNIT_MISMATCH", "/portfolio")
    integer(portfolio["quote_scale"], "/portfolio/quote_scale", 0, 8)
    integer(portfolio["cash_minor"], "/portfolio/cash_minor")
    integer(portfolio["turnover_minor"], "/portfolio/turnover_minor")
    fraction(portfolio["realized_loss_minor"], "/portfolio/realized_loss_minor")
    if type(portfolio["positions"]) is not list or len(portfolio["positions"]) > 100:
        fail("POSITION_COUNT_INVALID", "/portfolio/positions")
    seen = set()
    for i, position in enumerate(portfolio["positions"]):
        path = f"/portfolio/positions/{i}"
        keys(position, {"asset_id", "quantity", "cost_basis_minor"}, path)
        asset = identifier(position["asset_id"], path + "/asset_id")
        if asset in seen:
            fail("DUPLICATE_POSITION", path)
        seen.add(asset)
        decimal(position["quantity"], path + "/quantity", positive=True)
        fraction(position["cost_basis_minor"], path + "/cost_basis_minor")
    keys(policy, {"policy_id", "max_source_age_seconds", "confirmation_ttl_seconds", "min_cash_minor",
                  "max_order_minor", "max_turnover_minor", "max_concentration_bps",
                  "max_realized_loss_minor", "asset_limits"}, "/policy")
    identifier(policy["policy_id"], "/policy/policy_id")
    integer(policy["max_source_age_seconds"], "/policy/max_source_age_seconds", 1, 31536000)
    integer(policy["confirmation_ttl_seconds"], "/policy/confirmation_ttl_seconds", 1, 86400)
    integer(policy["max_concentration_bps"], "/policy/max_concentration_bps", 0, 10000)
    for key in ("min_cash_minor", "max_order_minor", "max_turnover_minor", "max_realized_loss_minor"):
        integer(policy[key], "/policy/" + key)
    if type(policy["asset_limits"]) is not list or not 1 <= len(policy["asset_limits"]) <= 100:
        fail("ASSET_LIMIT_COUNT_INVALID", "/policy/asset_limits")
    seen = set()
    for i, limit in enumerate(policy["asset_limits"]):
        path = f"/policy/asset_limits/{i}"
        keys(limit, {"asset_id", "max_value_minor"}, path)
        asset = identifier(limit["asset_id"], path + "/asset_id")
        if asset in seen:
            fail("DUPLICATE_ASSET_LIMIT", path)
        seen.add(asset)
        integer(limit["max_value_minor"], path + "/max_value_minor")
    keys(order, {"order_id", "asset_id", "side", "quantity", "fee_minor"}, "/order")
    identifier(order["order_id"], "/order/order_id")
    identifier(order["asset_id"], "/order/asset_id")
    if order["side"] not in ("BUY", "SELL"):
        fail("ORDER_SIDE_INVALID", "/order/side")
    decimal(order["quantity"], "/order/quantity", positive=True)
    integer(order["fee_minor"], "/order/fee_minor")


def proposal(input_text: str, at: str) -> tuple[dict, dict]:
    case = load_json(input_text)
    validate_case(case)
    now = utc(at)
    snapshot, portfolio, policy, order = (case[k] for k in ("snapshot", "portfolio", "policy", "order"))
    observed = utc(snapshot["observed_at"])
    quoted = utc(snapshot["quote_as_of"]) if snapshot["quote_as_of"] is not None else None
    capture_expiry = later(observed, policy["max_source_age_seconds"])
    expires = min(later(now, policy["confirmation_ttl_seconds"]), capture_expiry)
    reasons = []
    if observed > now:
        reasons.append("SOURCE_FROM_FUTURE")
    if now >= capture_expiry:
        reasons.append("SOURCE_CAPTURE_STALE")
    if quoted is None:
        reasons.append("QUOTE_TIME_UNKNOWN")
    else:
        quote_expiry = later(quoted, policy["max_source_age_seconds"])
        expires = min(expires, quote_expiry)
        if quoted > observed or quoted > now:
            reasons.append("QUOTE_TIME_FROM_FUTURE")
        if now >= quote_expiry:
            reasons.append("QUOTE_STALE")
    prices = {q["asset_id"]: Fraction(q["price_minor"]) for q in snapshot["quotes"]}
    limits = {q["asset_id"]: q["max_value_minor"] for q in policy["asset_limits"]}
    positions = {p["asset_id"]: {"quantity": Fraction(p["quantity"]),
                                 "cost": Fraction(p["cost_basis_minor"])} for p in portfolio["positions"]}
    needed = set(positions) | {order["asset_id"]}
    for asset in sorted(needed - set(prices)):
        reasons.append("QUOTE_MISSING:" + asset)
    for asset in sorted(needed - set(limits)):
        reasons.append("ASSET_POLICY_MISSING:" + asset)
    projected, metrics = None, {}
    if needed <= set(prices):
        asset, quantity = order["asset_id"], Fraction(order["quantity"])
        notional = prices[asset] * quantity
        metrics["order_notional_minor"] = exact(notional)
        metrics["before_value_minor"] = exact(portfolio["cash_minor"] + sum(prices[a] * p["quantity"] for a, p in positions.items()))
        if notional.denominator != 1:
            reasons.append("SUB_MINOR_TRADE_NOTIONAL")
        if notional > policy["max_order_minor"]:
            reasons.append("ORDER_LIMIT_EXCEEDED")
        prior = positions.get(asset, {"quantity": Fraction(0), "cost": Fraction(0)})
        if order["side"] == "SELL" and quantity > prior["quantity"]:
            reasons.append("INSUFFICIENT_ASSET_QUANTITY")
        if notional.denominator == 1 and not (order["side"] == "SELL" and quantity > prior["quantity"]):
            loss = Fraction(0)
            cash = portfolio["cash_minor"]
            if order["side"] == "BUY":
                cash -= int(notional) + order["fee_minor"]
                positions[asset] = {"quantity": prior["quantity"] + quantity,
                                    "cost": prior["cost"] + notional + order["fee_minor"]}
            else:
                allocated_cost = prior["cost"] * quantity / prior["quantity"]
                cash += int(notional) - order["fee_minor"]
                loss = max(Fraction(0), allocated_cost - (notional - order["fee_minor"]))
                if quantity == prior["quantity"]:
                    positions.pop(asset)
                else:
                    positions[asset] = {"quantity": prior["quantity"] - quantity,
                                        "cost": prior["cost"] - allocated_cost}
            values = {a: prices[a] * p["quantity"] for a, p in positions.items()}
            total = cash + sum(values.values())
            realized = Fraction(portfolio["realized_loss_minor"]) + loss
            turnover = portfolio["turnover_minor"] + int(notional)
            if cash < 0:
                reasons.append("INSUFFICIENT_CASH")
            if cash < policy["min_cash_minor"]:
                reasons.append("CASH_BUFFER_BELOW_LIMIT")
            if abs(cash) > MAX_SAFE or turnover > MAX_SAFE:
                reasons.append("INTEGER_MONEY_RANGE_EXCEEDED")
            if turnover > policy["max_turnover_minor"]:
                reasons.append("TURNOVER_LIMIT_EXCEEDED")
            if realized > policy["max_realized_loss_minor"]:
                reasons.append("REALIZED_LOSS_BUDGET_EXCEEDED")
            if total <= 0:
                reasons.append("NONPOSITIVE_PROJECTED_VALUE")
            for name, value in sorted(values.items()):
                if name in limits and value > limits[name]:
                    reasons.append("ASSET_VALUE_LIMIT_EXCEEDED:" + name)
                if total > 0 and value * 10000 > total * policy["max_concentration_bps"]:
                    reasons.append("CONCENTRATION_LIMIT_EXCEEDED:" + name)
            projected = {**portfolio, "generation_id": "paper-" + digest(order)[:32], "cash_minor": cash,
                         "turnover_minor": turnover, "realized_loss_minor": exact(realized),
                         "positions": [{"asset_id": a, "quantity": exact(p["quantity"]),
                                        "cost_basis_minor": exact(p["cost"])} for a, p in sorted(positions.items())]}
            try:
                validate_case({**case, "portfolio": projected})
            except TreasuryError as exc:
                reasons.append("PROJECTED_PORTFOLIO_NOT_REPRESENTABLE:" + exc.path)
            metrics.update({"after_value_minor": exact(total), "fee_minor": order["fee_minor"],
                            "realized_loss_added_minor": exact(loss),
                            "projected_asset_values_minor": {a: exact(v) for a, v in sorted(values.items())},
                            "cash_change_minor": cash - portfolio["cash_minor"]})
    result = {"schema": PROPOSAL_SCHEMA, **AUTHORITY, "evaluated_at": at, "expires_at": stamp(expires),
              "input_sha256": sha256(input_text.encode("utf-8")), "core_source_sha256": source_digest(),
              "snapshot_sha256": digest(snapshot), "portfolio_sha256": digest(portfolio),
              "policy_sha256": digest(policy), "order": order,
              "source_health": {"source_kind": snapshot["source_kind"], "observed_at": snapshot["observed_at"],
                                "quote_as_of": snapshot["quote_as_of"], "source_authenticity_verified": False,
                                "quote_time_basis": "UNKNOWN" if quoted is None else "SUPPLIED_RECORD"},
              "state": "HOLD" if reasons else "PAPER_ELIGIBLE", "reasons": sorted(set(reasons)),
              "metrics": metrics, "projected_portfolio": projected}
    result["proposal_sha256"] = digest(result)
    return case, result


def event(number: int, previous: str, action: str, at: str, payload: dict, result: dict) -> dict:
    value = {"schema": EVENT_SCHEMA, "number": number, "previous_sha256": previous,
             "action": action, "at": at, "payload": payload, "result": result}
    value["event_sha256"] = digest(value)
    return value


def opening(input_text: str, at: str) -> dict:
    _case, result = proposal(input_text, at)
    return event(1, ZERO_HASH, "PROPOSE", at, {"input_text": input_text}, result)


def transition(state: dict, action: str, at: str, payload: dict) -> dict:
    now = utc(at)
    proposed = state["proposal"]
    reasons = []
    if now < utc(state["latest_at"]):
        reasons.append("TIME_BEFORE_LAST_EVENT")
    if state["execution"] is not None:
        reasons.append("ALREADY_PAPER_EXECUTED")
    if proposed["state"] != "PAPER_ELIGIBLE":
        reasons.append("PROPOSAL_ON_HOLD")
    if now >= utc(proposed["expires_at"]):
        reasons.append("PROPOSAL_EXPIRED")
    result = {**AUTHORITY}
    if action == "CONFIRM":
        keys(payload, {"proposal_sha256"}, "/event/payload")
        if payload["proposal_sha256"] != proposed["proposal_sha256"]:
            reasons.append("PROPOSAL_HASH_MISMATCH")
        if not reasons:
            confirmation = {"proposal_sha256": proposed["proposal_sha256"], "confirmed_at": at,
                            "expires_at": proposed["expires_at"], "event_number": state["count"] + 1}
            result.update({"confirmation": confirmation, "confirmation_sha256": digest(confirmation)})
        result["status"] = "REJECTED" if reasons else "CONFIRMED"
    elif action == "PAPER_EXECUTE":
        keys(payload, {"confirmation_sha256"}, "/event/payload")
        confirmation = state["confirmations"].get(payload["confirmation_sha256"])
        if confirmation is None:
            reasons.append("CONFIRMATION_NOT_FOUND")
        elif now < utc(confirmation["confirmed_at"]):
            reasons.append("TIME_BEFORE_CONFIRMATION")
        if not reasons:
            receipt = {**AUTHORITY, "proposal_sha256": proposed["proposal_sha256"],
                       "confirmation_sha256": payload["confirmation_sha256"], "executed_at": at,
                       "order_id": proposed["order"]["order_id"], "input_sha256": proposed["input_sha256"],
                       "before_portfolio_sha256": proposed["portfolio_sha256"],
                       "after_portfolio": proposed["projected_portfolio"],
                       "cash_change_minor": proposed["metrics"]["cash_change_minor"]}
            result.update({"paper_receipt": receipt, "paper_receipt_sha256": digest(receipt)})
        result["status"] = "REJECTED" if reasons else "PAPER_EXECUTED"
    else:
        fail("ACTION_INVALID")
    result["reasons"] = sorted(set(reasons))
    return result


def apply_event(state: dict, item: dict) -> None:
    result = item["result"]
    if result.get("status") == "CONFIRMED":
        state["confirmations"][result["confirmation_sha256"]] = result["confirmation"]
    if result.get("status") == "PAPER_EXECUTED":
        state["execution"] = result
    state.update({"head_sha256": item["event_sha256"], "count": item["number"],
                  "latest_at": max(state["latest_at"], item["at"]), "last_result": result})


def replay(events: list[dict]) -> dict:
    if not events or len(events) > 10000:
        fail("EVENT_COUNT_INVALID")
    first = events[0]
    keys(first, {"schema", "number", "previous_sha256", "action", "at", "payload", "result", "event_sha256"}, "/events/0")
    keys(first["payload"], {"input_text"}, "/events/0/payload")
    if type(first["payload"]["input_text"]) is not str:
        fail("ORIGINAL_INPUT_MISSING")
    expected = opening(first["payload"]["input_text"], first["at"])
    if canonical(first) != canonical(expected):
        fail("OPENING_REPLAY_MISMATCH")
    state = {"input_text": first["payload"]["input_text"], "case": load_json(first["payload"]["input_text"]),
             "proposal": first["result"], "confirmations": {}, "execution": None,
             "head_sha256": first["event_sha256"], "count": 1, "latest_at": first["at"], "last_result": first["result"]}
    for i, item in enumerate(events[1:], 2):
        keys(item, set(first), f"/events/{i - 1}")
        expected_result = transition(state, item["action"], item["at"], item["payload"])
        expected = event(i, state["head_sha256"], item["action"], item["at"], item["payload"], expected_result)
        if canonical(item) != canonical(expected):
            fail("EVENT_REPLAY_MISMATCH", f"/events/{i - 1}")
        apply_event(state, item)
    return state


def summary(state: dict) -> dict:
    return {**AUTHORITY, "proposal_state": state["proposal"]["state"],
            "proposal_sha256": state["proposal"]["proposal_sha256"], "expires_at": state["proposal"]["expires_at"],
            "event_count": state["count"], "head_sha256": state["head_sha256"],
            "last_result": state["last_result"],
            "paper_executed": state["execution"] is not None,
            "paper_portfolio": (state["execution"]["paper_receipt"]["after_portfolio"]
                                if state["execution"] else state["case"]["portfolio"])}


def report(state: dict) -> str:
    p = state["proposal"]
    lines = ["# ProofTreasury paper review", "", "Needs expert review.", "",
             "PAPER_ONLY. Live execution authorized: false. No provider order or funds movement.", "",
             f"Proposal state: {p['state']}", f"Evaluated at: {p['evaluated_at']}", f"Expires at: {p['expires_at']}",
             f"Proposal SHA-256: {p['proposal_sha256']}", f"Ledger head: {state['head_sha256']}",
             f"Retained events: {state['count']}", f"Paper executed: {str(state['execution'] is not None).lower()}", "",
             "## Proposal reasons", ""]
    lines.extend("- " + reason for reason in p["reasons"])
    if not p["reasons"]:
        lines.append("- No supplied-policy condition failed. This is not financial approval or a recommendation.")
    lines += ["", "## Exact arithmetic (minor units)", "", "```json", canonical(p["metrics"]), "```", "",
              "## Most recent retained outcome", "", "```json", canonical(state["last_result"]), "```", "",
              "## Paper portfolio", "", "```json", canonical(summary(state)["paper_portfolio"]), "```", "",
              "Quote timing and policy limits are supplied facts. Cost basis is allocated proportionally;",
              "gross realized losses accumulate, while gains do not reduce that budget. This is not a loss forecast,",
              "tax method, accounting conclusion, independent source authentication or a guarantee against loss.", ""]
    return "\n".join(lines)


def template(at: str) -> dict:
    utc(at)
    evidence = {"fictional": True, "asset_id": "EXAMPLE", "price_minor": "2500", "at": at}
    return {"schema": CASE_SCHEMA,
            "snapshot": {"schema": SNAPSHOT_SCHEMA, "source_kind": "SUPPLIED_OFFLINE",
                         "source_id": "fictional-editable-template", "observed_at": at, "quote_as_of": at,
                         "quote_currency": "USD", "quote_scale": 2, "evidence_sha256": digest(evidence),
                         "quotes": [{"asset_id": "EXAMPLE", "price_minor": "2500"}]},
            "portfolio": {"portfolio_id": "fictional-portfolio", "generation_id": "opening-1", "quote_currency": "USD",
                          "quote_scale": 2, "cash_minor": 75000, "turnover_minor": 0, "realized_loss_minor": "0",
                          "positions": [{"asset_id": "EXAMPLE", "quantity": "10", "cost_basis_minor": "20000"}]},
            "policy": {"policy_id": "fictional-owner-limits", "max_source_age_seconds": 3600,
                       "confirmation_ttl_seconds": 600, "min_cash_minor": 10000, "max_order_minor": 10000,
                       "max_turnover_minor": 20000, "max_concentration_bps": 5000, "max_realized_loss_minor": 1000,
                       "asset_limits": [{"asset_id": "EXAMPLE", "max_value_minor": 50000}]},
            "order": {"order_id": "paper-order-1", "asset_id": "EXAMPLE", "side": "BUY", "quantity": "2", "fee_minor": 25}}
