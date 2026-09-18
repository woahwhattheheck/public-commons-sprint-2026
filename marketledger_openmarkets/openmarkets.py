from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping
from urllib.parse import quote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .engine import MarketLedgerError, SNAPSHOT_SCHEMA

DEFAULT_BASE_URL = "https://api.openmarkets.ai/flow/v1"
DEFAULT_HOST = "api.openmarkets.ai"
MAX_RESPONSE_BYTES = 4_000_000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _validate_base_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != DEFAULT_HOST
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path.rstrip("/") != "/flow/v1"
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise MarketLedgerError("base_url must be the exact HTTPS OpenMarkets Flow v1 root")
    return DEFAULT_BASE_URL


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise MarketLedgerError("OpenMarkets redirects are refused to protect API-key custody")


def _open_request(req: Request, timeout_seconds: float):
    return build_opener(_NoRedirectHandler()).open(req, timeout=timeout_seconds)


def fetch_contest_liquidity(contest_id: str, api_key: str, *, timeout_seconds: float = 10.0, base_url: str = DEFAULT_BASE_URL) -> dict[str, Any]:
    """Read live OpenMarkets liquidity. This adapter never calls order/execution endpoints."""
    if not isinstance(contest_id, str) or not contest_id.strip():
        raise MarketLedgerError("contest_id must be non-empty")
    if not isinstance(api_key, str) or len(api_key.strip()) < 8:
        raise MarketLedgerError("api_key is missing or too short")
    if not (0 < float(timeout_seconds) <= 30):
        raise MarketLedgerError("timeout_seconds must be >0 and <=30")
    safe_base = _validate_base_url(base_url)
    url = f"{safe_base}/contests/{quote(contest_id, safe='')}/liquidity"
    req = Request(url, headers={"X-API-Key": api_key, "Accept": "application/json"}, method="GET")
    with _open_request(req, float(timeout_seconds)) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise MarketLedgerError("OpenMarkets response exceeds size limit")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MarketLedgerError("OpenMarkets response is not valid UTF-8 JSON") from exc
    if not isinstance(payload, dict):
        raise MarketLedgerError("OpenMarkets response must be a JSON object")
    return payload


def _fee_bps(value: Any, partner_id: str) -> str:
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise MarketLedgerError(f"fee_bps for {partner_id} must be numeric") from exc
    if not dec.is_finite() or dec < 0 or dec > 10000:
        raise MarketLedgerError(f"fee_bps for {partner_id} must be between 0 and 10000")
    return format(dec, "f")


def normalize_liquidity_envelope(
    payload: Mapping[str, Any],
    *,
    fee_bps_by_partner: Mapping[str, Any] | None = None,
    fetched_at: str | None = None,
) -> dict[str, Any]:
    """Map the documented OpenMarkets liquidity envelope to MarketLedger's immutable snapshot shape."""
    if not isinstance(payload, Mapping):
        raise MarketLedgerError("OpenMarkets payload must be an object")
    raw = payload.get("data")
    if isinstance(raw, Mapping) and isinstance(raw.get("positions"), list):
        positions = raw["positions"]
    elif isinstance(raw, list):
        positions = raw
    else:
        raise MarketLedgerError("OpenMarkets data must be a positions list or an object containing positions")
    meta = payload.get("meta") if isinstance(payload.get("meta"), Mapping) else {}
    observed_at = meta.get("timestamp") or fetched_at or _utc_now()
    fees = dict(fee_bps_by_partner or {})
    out: list[dict[str, Any]] = []
    for pindex, position in enumerate(positions):
        if not isinstance(position, Mapping):
            raise MarketLedgerError(f"OpenMarkets position[{pindex}] must be an object")
        partner_liquidities = position.get("partner_liquidities")
        if not isinstance(partner_liquidities, list) or not partner_liquidities:
            raise MarketLedgerError(f"OpenMarkets position[{pindex}] has no partner_liquidities")
        quotes: list[dict[str, Any]] = []
        for qindex, row in enumerate(partner_liquidities):
            if not isinstance(row, Mapping):
                raise MarketLedgerError(f"partner_liquidities[{qindex}] must be an object")
            partner_id = row.get("partner_id")
            if not isinstance(partner_id, str) or not partner_id:
                raise MarketLedgerError("partner_id must be non-empty")
            quotes.append({
                "partner_id": partner_id,
                "partner_name": row.get("partner_name") or partner_id,
                "price": row.get("price"),
                "available_usd": row.get("available"),
                "fee_bps": _fee_bps(fees.get(partner_id, 0), partner_id),
                "liquidity_hash": row.get("liquidity_hash"),
            })
        out.append({
            "position_hash": position.get("position_hash"),
            "contest_id": position.get("contest_id"),
            "title": position.get("title") or "",
            "market_key": position.get("market_key") or "",
            "side_key": position.get("side_key") or "",
            "participant_id": position.get("participant_id"),
            "consensus_price": position.get("consensus_price"),
            "quotes": quotes,
        })
    return {"schema": SNAPSHOT_SCHEMA, "observed_at": observed_at, "positions": out}
