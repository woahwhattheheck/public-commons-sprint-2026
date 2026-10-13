"""Compact and paged reads of an original native runtime-use record.

This projection never registers, refreshes, releases or retires a runtime. The
original record and native liveness report remain authoritative. A cursor binds
to the retained catalog contents and selection, so reopening cannot silently
combine two revisions.
"""
from __future__ import annotations

import base64
from collections import Counter
import hashlib
import json


SCHEMA = "commons.native-runtime-catalog/v1"
VIEWS = ("compact", "page", "full")
DEFAULT_LIMIT = 100
MAX_LIMIT = 500


class CatalogChanged(ValueError):
    """Reopen the first page after the original runtime catalog changed."""


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":")).encode()).hexdigest()


def _cursor(catalog, selection, offset):
    raw = json.dumps({"v": 1, "catalog": catalog, "selection": selection,
                      "offset": offset}, sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _offset(cursor, catalog, selection, total):
    if cursor is None:
        return 0
    if not isinstance(cursor, str) or not cursor or len(cursor) > 1024:
        raise ValueError("Use the next_cursor from the original runtime catalog page")
    try:
        raw = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        value = json.loads(raw)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Invalid runtime catalog cursor") from exc
    if (not isinstance(value, dict) or set(value) != {"v", "catalog", "selection", "offset"}
            or value["v"] != 1 or type(value["offset"]) is not int):
        raise ValueError("Invalid runtime catalog cursor")
    if value["catalog"] != catalog or value["selection"] != selection:
        raise CatalogChanged("The retained runtime catalog or selection changed; reopen its first page")
    if not 0 <= value["offset"] <= total:
        raise ValueError("Runtime catalog cursor is outside this retained selection")
    return value["offset"]


def project(value, *, observed=None, view="compact", paths=(), cursor=None, limit=DEFAULT_LIMIT):
    """Project one already-read record; preserve original row order and fields.

`observed` may include the original native state overlay. Cursor identity uses
only `value`, the retained record, rather than transient process observations.
Python snapshot()/inspect() retain their historical full default; operator
entry points explicitly select compact output.
"""
    if view not in VIEWS:
        raise ValueError("Select compact, page or full runtime output")
    if not isinstance(paths, (list, tuple)) or len(paths) > 128:
        raise ValueError("Select at most 128 runtime paths per catalog view")
    if view == "full":
        if paths or cursor is not None:
            raise ValueError("Use page output for a runtime selection or cursor")
        return dict(value if observed is None else observed)
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ValueError("Runtime page limit must be between 1 and " + str(MAX_LIMIT))

    from runtime_consumers import lexical_path, overlaps

    selected = sorted({str(lexical_path(path)) for path in paths})
    aliases = {alias for path in selected for alias in
               (lexical_path(path), lexical_path(path).resolve())}
    rows = value["paths"]
    matched = [row for row in rows if not aliases or any(overlaps(alias, row) for alias in aliases)]
    catalog_id = _digest(value)
    selection_id = _digest(sorted(str(path) for path in aliases))
    offset = _offset(cursor, catalog_id, selection_id, len(matched))
    # Explicit selection/cursor asks for detail even when compact is the
    # caller's default. A routine compact observation emits no unrequested rows.
    effective_view = "page" if view == "page" or selected or cursor is not None else "compact"
    shown = matched[offset:offset + limit] if effective_view == "page" else []
    next_offset = offset + len(shown)
    next_cursor = _cursor(catalog_id, selection_id, next_offset) if next_offset < len(matched) else None
    presence = Counter("present" if row.get("present") is True else
                       "absent" if row.get("present") is False else "unknown" for row in rows)
    result = {key: item for key, item in (value if observed is None else observed).items() if key != "paths"}
    result["paths"] = shown
    history = value.get("declaration_amendments")
    if isinstance(history, list):
        # A declaration correction retains its old observed path inventory for
        # audit. Routine pages must not expand that historical inventory again.
        result["declaration_amendments"] = [{
            **{key: event[key] for key in ("amendment_id", "amended_at", "selection_sha256") if key in event},
            "reason": event.get("reason", "")[:240],
            "reason_truncated": len(event.get("reason", "")) > 240,
            "previous_declaration_count": len(event.get("previous", {}).get("declarations", [])),
            "previous_path_count": len(event.get("previous", {}).get("paths", [])),
            "next_declaration_count": len(event.get("next", {}).get("declarations", []))
        } for event in history[-5:]]
        result["declaration_amendment_history"] = {
            "count": len(history), "returned_count": len(result["declaration_amendments"]),
            "all_event_summaries_returned": len(history) <= 5,
            "full_record": value["record"] + "/runtime-use.json"}
    result["catalog"] = {
        "schema": SCHEMA, "view": effective_view,
        "record": value["record"], "revision": value.get("revision"),
        "canonical_sha256": catalog_id,
        "path_count": len(rows), "selected_count": len(matched),
        "returned_count": len(shown), "offset": offset, "limit": limit,
        "selected_paths": selected, "next_cursor": next_cursor,
        "selection_complete": next_cursor is None,
        "presence": {key: presence.get(key, 0) for key in ("present", "absent", "unknown")},
        "origins": dict(sorted(Counter(row.get("origin", "unknown") for row in rows).items())),
        "kinds": dict(sorted(Counter(row.get("kind", "unknown") for row in rows).items())),
    }
    return result


def options(parser, *, listing=False):
    """Read-only CLI options; no runtime declaration or request fields change."""
    parser.add_argument("--runtime-view", choices=("compact", "full") if listing else VIEWS,
                        default="compact", help="compact runtime counts by default; full preserves every original row")
    if not listing:
        parser.add_argument("--runtime-path", action="append", default=[],
                            help="select an original runtime path and related recorded aliases; repeat to select more")
        parser.add_argument("--runtime-cursor", help="next_cursor from the same original catalog and selection")
        parser.add_argument("--runtime-limit", type=int, default=DEFAULT_LIMIT,
                            help="runtime rows per page, 1..500 (default: 100)")


def arguments(args):
    return {"runtime_view": args.runtime_view, "runtime_paths": args.runtime_path,
            "runtime_cursor": args.runtime_cursor, "runtime_limit": args.runtime_limit}
