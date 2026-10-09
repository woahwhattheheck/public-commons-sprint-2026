"""Deterministic, nontrading change ledger for two independently verified Panta pages.

This compares *operator-ordered captured pages*, not an authenticated live feed.
Markets outside either captured page remain unknown, even when IDs disappear.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

from .panta_view import EXPECTED_AUTHORITY, PantaViewError, load_snapshot, verify_snapshot


SCHEMA = "evidenceforge-panta-page-comparison/v1"
NUMERIC = ("yesPrice", "noPrice", "volumeUsdc", "totalVolumeUsdc")
META = ("title", "category", "phase", "createdByPartner")


class PantaComparisonError(ValueError):
    """Two otherwise valid captured pages are not comparable."""


def _canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _change(left: Any, right: Any, *, numeric: bool) -> dict[str, Any] | None:
    if left == right:
        return None
    record: dict[str, Any] = {"before": left, "after": right}
    if numeric:
        record["delta"] = (str(Decimal(right) - Decimal(left))
                           if left is not None and right is not None else None)
    return record


def compare_snapshots(before: dict, after: dict) -> dict[str, Any]:
    """Compare two validated capture pages without inventing a timeline or delisting."""
    # Revalidate the full digest, field types, limits, source and read-only ceiling.
    for label, value in (("before", before), ("after", after)):
        try:
            verify_snapshot(_canonical(value))
        except (PantaViewError, TypeError, ValueError) as exc:
            raise PantaComparisonError(f"{label} is not a valid bounded snapshot: {exc}") from exc

    if before["source"] != after["source"]:
        raise PantaComparisonError("cannot compare pages from different API sources")
    if before["filters"] != after["filters"]:
        raise PantaComparisonError("cannot compare pages with different category/phase/limit")
    b = {item["marketId"]: item for item in before["items"]}
    a = {item["marketId"]: item for item in after["items"]}
    matched = sorted(set(b) & set(a))
    changed: list[dict[str, Any]] = []
    for market_id in matched:
        fields = {}
        for name in (*NUMERIC, *META):
            diff = _change(b[market_id][name], a[market_id][name], numeric=name in NUMERIC)
            if diff is not None:
                fields[name] = diff
        if fields:
            changed.append({"marketId": market_id, "fields": fields})
    # A missing ID may have moved to another page. Never call it a delisting.
    report = {
        "schema": SCHEMA,
        "source": before["source"],
        "filters": before["filters"],
        "beforeSnapshotSha256": before["snapshotSha256"],
        "afterSnapshotSha256": after["snapshotSha256"],
        "scope": "two_captured_catalog_pages_only",
        "ordering": "operator_supplied_not_provider_timestamped",
        "originAuthenticated": False,
        "liveFreshnessVerified": False,
        "paginationMayHideMarkets": bool(before["nextCursor"] or after["nextCursor"]),
        "matchedMarkets": len(matched),
        "changedMarkets": changed,
        "appearedInAfterPage": sorted(set(a) - set(b)),
        "absentFromAfterPage": sorted(set(b) - set(a)),
        "authority": dict(EXPECTED_AUTHORITY),
    }
    return {**report, "comparisonSha256": hashlib.sha256(_canonical(report)).hexdigest()}


def render_summary(report: dict[str, Any]) -> str:
    """Human-readable receipt; no trading signal or fabricated listing changes."""
    lines = [
        "Panta captured-page comparison (read-only; NOT a live authenticated feed)",
        f"before={report['beforeSnapshotSha256']} after={report['afterSnapshotSha256']}",
        f"receipt={report['comparisonSha256']}",
        f"matched={report['matchedMarkets']} changed={len(report['changedMarkets'])} "
        f"appeared_on_page={len(report['appearedInAfterPage'])} "
        f"absent_from_page={len(report['absentFromAfterPage'])}",
    ]
    for market in report["changedMarkets"]:
        parts = []
        for field, change in market["fields"].items():
            delta = f" (delta {change['delta']})" if "delta" in change else ""
            parts.append(f"{field}: {change['before']!r} -> {change['after']!r}{delta}")
        lines.append(f"- {market['marketId']}: " + "; ".join(parts))
    if report["appearedInAfterPage"]:
        lines.append("Appeared in later CAPTURED PAGE only: " +
                     ", ".join(report["appearedInAfterPage"]))
    if report["absentFromAfterPage"]:
        lines.append("Absent from later CAPTURED PAGE only (NOT delisted): " +
                     ", ".join(report["absentFromAfterPage"]))
    lines.append("No authenticated timestamps, quote guarantees, trades, payouts, or awards.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare two Panta captured market pages")
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--summary", action="store_true", help="Plain-language receipt instead of JSON")
    args = parser.parse_args(argv)
    try:
        report = compare_snapshots(load_snapshot(args.before), load_snapshot(args.after))
    except (PantaComparisonError, PantaViewError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if args.summary:
        print(render_summary(report))
    else:
        print(json.dumps(report, sort_keys=True, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
