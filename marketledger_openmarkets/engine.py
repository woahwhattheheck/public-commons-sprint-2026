from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Mapping

SNAPSHOT_SCHEMA = "marketledger.snapshot.v1"
REPORT_SCHEMA = "marketledger.report.v1"
STAGE_SCHEMA = "marketledger.stage.v1"


class MarketLedgerError(ValueError):
    """Fail-closed validation error."""


def _parse_utc(value: str, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise MarketLedgerError(f"{field} must be a non-empty ISO-8601 timestamp")
    raw = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise MarketLedgerError(f"{field} is not valid ISO-8601") from exc
    if dt.tzinfo is None:
        raise MarketLedgerError(f"{field} must include a timezone")
    return dt.astimezone(timezone.utc)


def _decimal(value: Any, field: str, *, minimum: Decimal | None = None, maximum: Decimal | None = None) -> Decimal:
    if isinstance(value, bool):
        raise MarketLedgerError(f"{field} must be numeric")
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise MarketLedgerError(f"{field} must be numeric") from exc
    if not dec.is_finite():
        raise MarketLedgerError(f"{field} must be finite")
    if minimum is not None and dec < minimum:
        raise MarketLedgerError(f"{field} must be >= {minimum}")
    if maximum is not None and dec > maximum:
        raise MarketLedgerError(f"{field} must be <= {maximum}")
    return dec


def _q(value: Decimal, places: str = "0.00000001") -> str:
    return format(value.quantize(Decimal(places), rounding=ROUND_HALF_UP), "f")


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _receipt(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _validate_snapshot(snapshot: Mapping[str, Any], as_of: str, max_age_seconds: int) -> tuple[datetime, datetime, list[dict[str, Any]]]:
    if not isinstance(snapshot, Mapping) or snapshot.get("schema") != SNAPSHOT_SCHEMA:
        raise MarketLedgerError(f"snapshot.schema must equal {SNAPSHOT_SCHEMA}")
    if not isinstance(max_age_seconds, int) or isinstance(max_age_seconds, bool) or max_age_seconds < 0:
        raise MarketLedgerError("max_age_seconds must be a non-negative integer")
    observed = _parse_utc(snapshot.get("observed_at"), "snapshot.observed_at")
    now = _parse_utc(as_of, "as_of")
    age = (now - observed).total_seconds()
    if age < 0:
        raise MarketLedgerError("snapshot.observed_at cannot be in the future")
    if age > max_age_seconds:
        raise MarketLedgerError(f"snapshot is stale ({int(age)}s > {max_age_seconds}s)")
    positions = snapshot.get("positions")
    if not isinstance(positions, list) or not positions:
        raise MarketLedgerError("snapshot.positions must be a non-empty list")
    return observed, now, positions


def evaluate_snapshot(
    snapshot: Mapping[str, Any],
    *,
    as_of: str,
    max_age_seconds: int = 120,
    dispersion_threshold_bps: int = 75,
    min_available_usd: int | float | str = 100,
) -> dict[str, Any]:
    """Evaluate one normalized liquidity snapshot without mutating a provider."""
    observed, now, positions = _validate_snapshot(snapshot, as_of, max_age_seconds)
    threshold = _decimal(dispersion_threshold_bps, "dispersion_threshold_bps", minimum=Decimal("0"))
    min_liq = _decimal(min_available_usd, "min_available_usd", minimum=Decimal("0"))

    seen_positions: set[str] = set()
    rendered: list[dict[str, Any]] = []
    contest_ids: set[str] = set()

    for index, position in enumerate(positions):
        if not isinstance(position, Mapping):
            raise MarketLedgerError(f"positions[{index}] must be an object")
        position_hash = position.get("position_hash")
        contest_id = position.get("contest_id")
        if not isinstance(position_hash, str) or not position_hash:
            raise MarketLedgerError(f"positions[{index}].position_hash must be non-empty")
        if position_hash in seen_positions:
            raise MarketLedgerError(f"duplicate position_hash: {position_hash}")
        seen_positions.add(position_hash)
        if not isinstance(contest_id, str) or not contest_id:
            raise MarketLedgerError(f"positions[{index}].contest_id must be non-empty")
        contest_ids.add(contest_id)

        consensus = _decimal(position.get("consensus_price"), f"positions[{index}].consensus_price", minimum=Decimal("0"), maximum=Decimal("1"))
        quotes = position.get("quotes")
        if not isinstance(quotes, list) or not quotes:
            raise MarketLedgerError(f"positions[{index}].quotes must be a non-empty list")

        seen_partners: set[str] = set()
        qout: list[dict[str, Any]] = []
        eligible: list[tuple[Decimal, str, dict[str, Any]]] = []
        for qindex, quote in enumerate(quotes):
            if not isinstance(quote, Mapping):
                raise MarketLedgerError(f"positions[{index}].quotes[{qindex}] must be an object")
            partner_id = quote.get("partner_id")
            if not isinstance(partner_id, str) or not partner_id:
                raise MarketLedgerError(f"positions[{index}].quotes[{qindex}].partner_id must be non-empty")
            if partner_id in seen_partners:
                raise MarketLedgerError(f"duplicate partner_id {partner_id} for {position_hash}")
            seen_partners.add(partner_id)
            price = _decimal(quote.get("price"), f"quote[{partner_id}].price", minimum=Decimal("0"), maximum=Decimal("1"))
            available = _decimal(quote.get("available_usd"), f"quote[{partner_id}].available_usd", minimum=Decimal("0"))
            fee_bps = _decimal(quote.get("fee_bps", 0), f"quote[{partner_id}].fee_bps", minimum=Decimal("0"), maximum=Decimal("10000"))
            adjusted = price * (Decimal("1") + fee_bps / Decimal("10000"))
            rendered_quote = {
                "partner_id": partner_id,
                "partner_name": str(quote.get("partner_name") or partner_id),
                "price": _q(price),
                "fee_bps": _q(fee_bps, "0.01"),
                "fee_adjusted_price": _q(adjusted),
                "available_usd": _q(available, "0.01"),
                "eligible": available >= min_liq,
            }
            qout.append(rendered_quote)
            if available >= min_liq:
                eligible.append((adjusted, partner_id, rendered_quote))

        qout.sort(key=lambda row: row["partner_id"])
        eligible.sort(key=lambda item: (item[0], item[1]))
        result: dict[str, Any] = {
            "position_hash": position_hash,
            "contest_id": contest_id,
            "title": str(position.get("title") or ""),
            "market_key": str(position.get("market_key") or ""),
            "side_key": str(position.get("side_key") or ""),
            "participant_id": position.get("participant_id"),
            "consensus_price": _q(consensus),
            "quotes": qout,
        }
        if not eligible:
            result.update({"status": "insufficient_liquidity", "best_partner_id": None, "dispersion_bps": None, "alert": False})
        else:
            low = eligible[0][0]
            high = eligible[-1][0]
            dispersion = Decimal("0") if low == 0 else (high - low) / low * Decimal("10000")
            result.update({
                "status": "ok",
                "best_partner_id": eligible[0][1],
                "best_fee_adjusted_price": _q(low),
                "dispersion_bps": _q(dispersion, "0.01"),
                "alert": dispersion >= threshold,
            })
        rendered.append(result)

    rendered.sort(key=lambda row: row["position_hash"])
    core = {
        "schema": REPORT_SCHEMA,
        "observed_at": observed.isoformat().replace("+00:00", "Z"),
        "evaluated_at": now.isoformat().replace("+00:00", "Z"),
        "contest_ids": sorted(contest_ids),
        "parameters": {
            "max_age_seconds": max_age_seconds,
            "dispersion_threshold_bps": _q(threshold, "0.01"),
            "min_available_usd": _q(min_liq, "0.01"),
            "fee_model": "fee_adjusted_price = price * (1 + supplied_fee_bps / 10000)",
        },
        "positions": rendered,
    }
    core["report_sha256"] = _receipt(core)
    return core


def compare_reports(previous: Mapping[str, Any], current: Mapping[str, Any], *, move_threshold_bps: int | float | str = 50) -> list[dict[str, Any]]:
    if previous.get("schema") != REPORT_SCHEMA or current.get("schema") != REPORT_SCHEMA:
        raise MarketLedgerError("both reports must use marketledger.report.v1")
    threshold = _decimal(move_threshold_bps, "move_threshold_bps", minimum=Decimal("0"))
    prev = {row["position_hash"]: row for row in previous.get("positions", []) if isinstance(row, Mapping)}
    events: list[dict[str, Any]] = []
    for row in current.get("positions", []):
        if not isinstance(row, Mapping) or row.get("status") != "ok":
            continue
        old = prev.get(row.get("position_hash"))
        if not old or old.get("status") != "ok":
            continue
        old_price = _decimal(old.get("best_fee_adjusted_price"), "previous.best_fee_adjusted_price", minimum=Decimal("0"))
        new_price = _decimal(row.get("best_fee_adjusted_price"), "current.best_fee_adjusted_price", minimum=Decimal("0"))
        if old_price == 0:
            move = Decimal("0") if new_price == 0 else Decimal("10000")
        else:
            move = abs(new_price - old_price) / old_price * Decimal("10000")
        if move >= threshold:
            events.append({
                "position_hash": row["position_hash"],
                "from_partner_id": old.get("best_partner_id"),
                "to_partner_id": row.get("best_partner_id"),
                "from_fee_adjusted_price": _q(old_price),
                "to_fee_adjusted_price": _q(new_price),
                "absolute_move_bps": _q(move, "0.01"),
            })
    return sorted(events, key=lambda e: e["position_hash"])


def stage_action(report: Mapping[str, Any], *, position_hash: str, partner_id: str, confirmation_token: str) -> dict[str, Any]:
    """Create a data-only staged action. There is intentionally no execute function."""
    if report.get("schema") != REPORT_SCHEMA:
        raise MarketLedgerError("report must use marketledger.report.v1")
    if not isinstance(confirmation_token, str) or len(confirmation_token.strip()) < 8:
        raise MarketLedgerError("confirmation_token must contain at least 8 characters")
    target = next((row for row in report.get("positions", []) if row.get("position_hash") == position_hash), None)
    if target is None:
        raise MarketLedgerError("position_hash not present in report")
    quote = next((row for row in target.get("quotes", []) if row.get("partner_id") == partner_id), None)
    if quote is None:
        raise MarketLedgerError("partner_id not present for position")
    token_hash = hashlib.sha256(confirmation_token.encode("utf-8")).hexdigest()
    staged = {
        "schema": STAGE_SCHEMA,
        "authority": "data_only_human_confirmed_stage",
        "provider_mutation_allowed": False,
        "report_sha256": report.get("report_sha256"),
        "position_hash": position_hash,
        "partner_id": partner_id,
        "price": quote.get("price"),
        "fee_adjusted_price": quote.get("fee_adjusted_price"),
        "available_usd": quote.get("available_usd"),
        "confirmation_token_sha256": token_hash,
    }
    staged["stage_sha256"] = _receipt(staged)
    return staged
