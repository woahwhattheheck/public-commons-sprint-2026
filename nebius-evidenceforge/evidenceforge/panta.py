from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal, InvalidOperation
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any


BASE_URL = "https://live-api.panta.market/api/v1"
ALLOWED_API_HOSTS = {"live-api.panta.market", "staging-api.panta.market"}
MAX_RESPONSE_BYTES = 1_000_000
Transport = Callable[[str, Mapping[str, str]], bytes]


class _RejectAuthenticatedRedirect(urllib.request.HTTPRedirectHandler):
    """A credential-bearing Panta request must not follow any HTTP redirect."""

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


_PANTA_OPENER = urllib.request.build_opener(_RejectAuthenticatedRedirect())


class PantaError(ValueError):
    """Raised when Panta market evidence is unavailable or malformed."""


def _unique_json_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Reject duplicate source fields before producing a signed evidence snapshot."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise PantaError(f"Panta response contains duplicate JSON field: {key}")
        result[key] = value
    return result


def _reject_nonfinite_constant(value: str) -> None:
    raise PantaError(f"Panta response contains non-finite JSON number: {value}")


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _default_transport(url: str, headers: Mapping[str, str]) -> bytes:
    request = urllib.request.Request(url, headers=dict(headers), method="GET")
    try:
        with _PANTA_OPENER.open(request, timeout=20) as response:
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > MAX_RESPONSE_BYTES:
                raise PantaError("Panta response exceeds the 1 MB evidence limit")
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except PantaError:
        raise
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise PantaError(f"Panta market request failed: {exc}") from exc
    if len(payload) > MAX_RESPONSE_BYTES:
        raise PantaError("Panta response exceeds the 1 MB evidence limit")
    return payload


def _text(value: Any, field: str, *, required: bool = True) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise PantaError(f"market {field} must be non-empty text")
    return value.strip()


def _decimal(value: Any, field: str) -> str | None:
    """Keep the source's exact decimal value, never convert quotes via float.

    The explicit 40-character normalized output and bounded decimal exponent
    also keep a hostile 1e100000 value from expanding during formatting.
    """
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise PantaError(f"market {field} must be numeric")
    lexical = str(value).strip()
    if not lexical or len(lexical) > 40:
        raise PantaError(f"market {field} exceeds supported numeric length")
    try:
        number = Decimal(lexical)
    except (InvalidOperation, ValueError) as exc:
        raise PantaError(f"market {field} must be numeric") from exc
    if not number.is_finite() or number < 0:
        raise PantaError(f"market {field} must be finite and non-negative")
    if field.endswith("Price") and number > 1:
        raise PantaError(f"market {field} must be in [0, 1]")
    if number.is_zero():
        return "0"
    if number.adjusted() > 18 or number.as_tuple().exponent < -24:
        raise PantaError(f"market {field} exceeds supported decimal scale")
    normalized = format(number, "f")
    if "." in normalized:
        normalized = normalized.rstrip("0").rstrip(".")
    if len(normalized) > 40:
        raise PantaError(f"market {field} exceeds supported numeric length")
    return normalized


def _normalize_market(row: Any) -> dict[str, Any]:
    if not isinstance(row, dict):
        raise PantaError("Panta markets items must be objects")
    yes = row.get("yesPrice")
    no = row.get("noPrice")
    if yes is None or yes == "":
        yes = row.get("primaryYesPrice")
    if no is None or no == "":
        no = row.get("primaryNoPrice")
    return {
        "marketId": _text(row.get("marketId"), "marketId"),
        "title": _text(row.get("title"), "title"),
        "category": _text(row.get("category"), "category", required=False),
        "phase": _text(row.get("phase"), "phase"),
        "yesPrice": _decimal(yes, "yesPrice"),
        "noPrice": _decimal(no, "noPrice"),
        "volumeUsdc": _decimal(row.get("volumeUsdc"), "volumeUsdc"),
        "totalVolumeUsdc": _decimal(row.get("totalVolumeUsdc"), "totalVolumeUsdc"),
        "createdByPartner": row.get("createdByPartner") is True,
    }


def fetch_market_snapshot(
    api_key: str,
    *,
    category: str | None = None,
    phase: str | None = None,
    limit: int = 20,
    base_url: str = BASE_URL,
    transport: Transport = _default_transport,
) -> dict[str, Any]:
    """Fetch and bind a read-only Panta market catalog page.

    The result is context for EvidenceForge; it is not trading advice, a quote,
    a transaction, or proof of submission eligibility.
    """

    if not isinstance(api_key, str) or not api_key.strip():
        raise PantaError("PANTA_API_KEY is required")
    if not isinstance(limit, int) or isinstance(limit, bool) or not (1 <= limit <= 50):
        raise PantaError("limit must be an integer in [1, 50]")
    parsed_base = urllib.parse.urlparse(base_url)
    if parsed_base.scheme != "https" or parsed_base.hostname not in ALLOWED_API_HOSTS:
        raise PantaError("Panta base URL must use an allowed HTTPS Panta API host")
    query: dict[str, str] = {"limit": str(limit)}
    if category:
        query["category"] = category
    if phase:
        query["status"] = phase
    url = f"{base_url.rstrip('/')}/markets/?{urllib.parse.urlencode(query)}"
    payload = transport(
        url,
        {"Accept": "application/json", "X-Api-Key": api_key.strip()},
    )
    if not isinstance(payload, bytes) or len(payload) > MAX_RESPONSE_BYTES:
        raise PantaError("transport returned invalid or oversized evidence")
    try:
        decoded = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_unique_json_pairs,
            parse_float=Decimal,
            parse_int=Decimal,
            parse_constant=_reject_nonfinite_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, InvalidOperation) as exc:
        raise PantaError("Panta markets response is not valid UTF-8 JSON") from exc
    if not isinstance(decoded, dict) or not isinstance(decoded.get("items"), list):
        raise PantaError("Panta markets response must contain items[]")
    if len(decoded["items"]) > limit:
        raise PantaError("Panta markets response exceeded requested limit")
    items = [_normalize_market(row) for row in decoded["items"]]
    ids = [row["marketId"] for row in items]
    if len(ids) != len(set(ids)):
        raise PantaError("Panta markets response contains duplicate marketId values")
    evidence = {
        "schema": "evidenceforge-panta-market-snapshot/v1",
        "source": f"{parsed_base.scheme}://{parsed_base.netloc}{parsed_base.path.rstrip('/')}/markets/",
        "filters": {"category": category, "phase": phase, "limit": limit},
        "items": items,
        "nextCursor": decoded.get("nextCursor") if isinstance(decoded.get("nextCursor"), str) else None,
        "authority": {
            "read_only": True,
            "transaction_built": False,
            "wallet_used": False,
            "trade_or_claim": False,
            "submission_or_award": False,
        },
    }
    return {
        **evidence,
        "snapshotSha256": hashlib.sha256(_canonical_bytes(evidence)).hexdigest(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evidenceforge.panta")
    parser.add_argument("--category")
    parser.add_argument("--phase", choices=["primary", "secondary", "resolved", "cancelled"])
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args(argv)
    try:
        snapshot = fetch_market_snapshot(
            os.environ.get("PANTA_API_KEY", ""),
            category=args.category,
            phase=args.phase,
            limit=args.limit,
        )
        json.dump(snapshot, sys.stdout, indent=2, sort_keys=True)
        sys.stdout.write("\n")
        return 0
    except PantaError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
