"""Verify and exhibit human-selected Panta catalog context without trading authority.

A content hash detects accidental edits. It is NOT proof of a live API capture:
the viewer never authenticates the original request or the file's provenance.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote, urlsplit


MAX_FILE_BYTES = 1_000_000
EXPECTED_AUTHORITY = {
    "read_only": True,
    "transaction_built": False,
    "wallet_used": False,
    "trade_or_claim": False,
    "submission_or_award": False,
}
MARKET_FIELDS = {
    "marketId", "title", "category", "phase", "yesPrice", "noPrice",
    "volumeUsdc", "totalVolumeUsdc", "createdByPartner",
}
SNAPSHOT_FIELDS = {
    "schema", "source", "filters", "items", "nextCursor", "authority", "snapshotSha256",
}


class PantaViewError(ValueError):
    """Invalid or unavailable saved market evidence."""


def _no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise PantaViewError(f"duplicate JSON field: {key}")
        out[key] = value
    return out


def _reject_constant(value):
    raise PantaViewError(f"non-finite JSON constant: {value}")


def _bounded_text(value, label, *, nullable=False, cap=400):
    if value is None and nullable:
        return
    if not isinstance(value, str) or not value.strip() or len(value) > cap:
        raise PantaViewError(f"invalid {label}")


def _decimal(value, label, *, maximum=None):
    if value is None:
        return
    if not isinstance(value, str) or len(value) > 40:
        raise PantaViewError(f"invalid {label}")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise PantaViewError(f"invalid {label}") from exc
    if not number.is_finite() or number < 0 or (maximum is not None and number > maximum):
        raise PantaViewError(f"out-of-range {label}")


def verify_snapshot(raw: bytes) -> dict:
    """Read and verify the adapter's complete bounded v1 market snapshot."""
    if not isinstance(raw, bytes) or len(raw) > MAX_FILE_BYTES:
        raise PantaViewError("market snapshot exceeds 1 MB")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_no_duplicates,
                           parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PantaViewError("invalid snapshot JSON") from exc
    if not isinstance(value, dict) or set(value) != SNAPSHOT_FIELDS:
        raise PantaViewError("unexpected snapshot fields")
    if value["schema"] != "evidenceforge-panta-market-snapshot/v1":
        raise PantaViewError("unknown snapshot schema")
    source = value["source"]
    if not isinstance(source, str):
        raise PantaViewError("invalid API source")
    origin = urlsplit(source)
    if (origin.scheme != "https" or origin.hostname not in
            {"live-api.panta.market", "staging-api.panta.market"}
            or origin.username is not None or origin.password is not None
            or origin.port not in (None, 443) or origin.query or origin.fragment
            or not origin.path.endswith("/markets/")):
        raise PantaViewError("unexpected Panta API source")
    filters = value["filters"]
    if not isinstance(filters, dict) or set(filters) != {"category", "phase", "limit"}:
        raise PantaViewError("invalid snapshot filters")
    for field in ("category", "phase"):
        _bounded_text(filters[field], field, nullable=True, cap=100)
    if (not isinstance(filters["limit"], int) or isinstance(filters["limit"], bool)
            or not 1 <= filters["limit"] <= 50):
        raise PantaViewError("invalid snapshot limit")
    rows = value["items"]
    if not isinstance(rows, list) or len(rows) > filters["limit"]:
        raise PantaViewError("snapshot market limit exceeded")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != MARKET_FIELDS:
            raise PantaViewError("unexpected market fields")
        _bounded_text(row["marketId"], "marketId", cap=128)
        _bounded_text(row["title"], "title", cap=400)
        _bounded_text(row["phase"], "phase", cap=40)
        _bounded_text(row["category"], "category", nullable=True, cap=100)
        if row["marketId"] in seen:
            raise PantaViewError("duplicate market ID")
        seen.add(row["marketId"])
        for field in ("yesPrice", "noPrice"):
            _decimal(row[field], field, maximum=1)
        for field in ("volumeUsdc", "totalVolumeUsdc"):
            _decimal(row[field], field)
        if not isinstance(row["createdByPartner"], bool):
            raise PantaViewError("invalid partner flag")
    _bounded_text(value["nextCursor"], "nextCursor", nullable=True, cap=2048)
    if value["authority"] != EXPECTED_AUTHORITY:
        raise PantaViewError("snapshot asserts unexpected authority")
    claimed = value["snapshotSha256"]
    if not isinstance(claimed, str) or not re.fullmatch(r"[0-9a-f]{64}", claimed):
        raise PantaViewError("invalid snapshot digest")
    payload = {key: val for key, val in value.items() if key != "snapshotSha256"}
    actual = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                                      ensure_ascii=False, allow_nan=False).encode("utf-8")).hexdigest()
    if not hmac.compare_digest(actual, claimed):
        raise PantaViewError("snapshot digest mismatch")
    return value


def load_snapshot(path: Path) -> dict:
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_FILE_BYTES + 1)
    except OSError as exc:
        raise PantaViewError("snapshot file could not be read") from exc
    return verify_snapshot(raw)


def selected_context(snapshot: dict, market_id: str) -> dict:
    """Bind a human-selected market to its verified local snapshot digest."""
    for market in snapshot["items"]:
        if market["marketId"] == market_id:
            context = {
                "schema": "evidenceforge-panta-selection/v1",
                "snapshotSha256": snapshot["snapshotSha256"],
                "market": market,
                "authority": EXPECTED_AUTHORITY,
                "originAuthenticated": False,
                "liveFreshnessVerified": False,
            }
            digest = hashlib.sha256(json.dumps(context, sort_keys=True,
                            ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
            return {**context, "selectionSha256": digest}
    raise PantaViewError("market ID does not occur in this snapshot")


def _percent(value):
    return "Unquoted" if value is None else f"{Decimal(value) * 100:.1f}%"


def render_page(snapshot: dict, market_id: str | None = None) -> str:
    """Create a safe, actionable local judge view; values remain untrusted data."""
    selected = selected_context(snapshot, market_id) if market_id is not None else None
    cards = []
    for market in snapshot["items"]:
        title = html.escape(market["title"])
        market_key = html.escape(market["marketId"])
        label = html.escape(market["category"] or "Uncategorized")
        phase = html.escape(market["phase"])
        url = "/panta?market=" + quote(market["marketId"], safe="")
        cards.append(
            f'<article class="card"><div class="label">{label} · {phase}</div>'
            f'<h2>{title}</h2><p>YES {_percent(market["yesPrice"])} '
            f'· NO {_percent(market["noPrice"])}</p>'
            f'<a href="{html.escape(url, quote=True)}">Inspect {market_key}</a></article>'
        )
    detail = ""
    if selected:
        item = selected["market"]
        detail = ("<section class=\"card selected\"><h2>Human-selected context</h2>"
                  f"<p>{html.escape(item['title'])}</p>"
                  f"<p>YES {_percent(item['yesPrice'])} · NO {_percent(item['noPrice'])}</p>"
                  f"<p>Selection digest: <code>{selected['selectionSha256']}</code></p>"
                  f'<p><a href="/api/panta?market={quote(item["marketId"], safe="")}">'
                  "Inspect bounded JSON evidence</a></p></section>")
    body = "".join(cards) if cards else "<p>The captured page contained no markets.</p>"
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EvidenceForge × Panta market context</title><style>
body{{font-family:system-ui,sans-serif;line-height:1.5;max-width:960px;margin:2rem auto;padding:0 1rem;background:#f7f9fc;color:#17202b}}
.card{{border:1px solid #ccd5df;border-radius:10px;background:white;margin:1rem 0;padding:1rem 1.3rem}}
.selected{{border-left:5px solid #1766a8}} .label{{font-size:.85rem;color:#526579}}
code{{overflow-wrap:anywhere}}a{{color:#075e99}}h2{{font-size:1.2rem}}
</style></head><body><p><a href="/">EvidenceForge</a> / Panta context</p>
<h1>Read-only prediction-market context</h1>
<p>Browse an adapter-generated Panta market snapshot. Select a market to emit a digest-bound
context packet for human review; this application does not place trades or approve code changes.</p>
<div class="card"><strong>Capture provenance:</strong> local file only; API origin and freshness
are <strong>not independently verified</strong>. A matching digest proves internal consistency,
not that Panta returned this data. Fixture data must not be described as live.
<p>Markets: {len(snapshot['items'])} · Source: {html.escape(snapshot['source'])}</p>
<p>Snapshot digest: <code>{snapshot['snapshotSha256']}</code></p></div>
{detail}<section><h2>Market catalog</h2>{body}</section></body></html>'''
