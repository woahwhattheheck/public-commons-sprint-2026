"""Compact derived summaries for immutable saved scenario assessments.

The operator's repeated state reads need titles and revision links. Keep those
small reads separate from loading the complete physical calculation. Opening or
receiving a view continues through the original content-verified workspace API.
"""
from __future__ import annotations

from .common import atomic_json, read_json

SCHEMA = "upstate.decision-view-summary/v1"
DIRECTORY = "decision-view-summaries"
FIELDS = ("id", "title", "purpose", "created_at", "baseline_id",
          "alternative_count", "previous_view_id")


def summary(row):
    return {
        "id": row["id"],
        "title": row.get("title", "Scenario assessment"),
        "purpose": row.get("purpose", ""),
        "created_at": row.get("created_at"),
        "baseline_id": row["selection"]["baseline_id"],
        "alternative_count": len(row["selection"].get("alternative_ids", [])),
        "previous_view_id": row.get("previous_view_id"),
    }


def _fingerprint(path):
    stat = path.stat()
    return {"bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def _cache_path(workspace, identifier):
    root = (workspace.root / DIRECTORY).resolve()
    root.relative_to(workspace.root)
    return root / (identifier + ".json")


def _cached(workspace, identifier, fingerprint):
    try:
        value = read_json(_cache_path(workspace, identifier))
        row = value["summary"]
        if (value.get("schema") != SCHEMA or value.get("view_id") != identifier
                or value.get("source") != fingerprint or not isinstance(row, dict)
                or set(row) != set(FIELDS) or row.get("id") != identifier
                or not isinstance(row.get("title"), str)
                or not isinstance(row.get("purpose"), str)
                or not isinstance(row.get("baseline_id"), str)
                or type(row.get("alternative_count")) is not int
                or row["alternative_count"] < 0):
            return None
        return row
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write(workspace, identifier, fingerprint, row):
    """Cache failures leave the original view usable, including read-only copies."""
    try:
        path = _cache_path(workspace, identifier)
        atomic_json(path, {"schema": SCHEMA, "view_id": identifier,
                           "source": fingerprint, "summary": row})
    except (OSError, ValueError):
        pass


def remember(workspace, kind, row):
    """Warm the compact listing immediately after the original immutable save."""
    try:
        source = workspace.root / kind / (row["id"] + ".json")
        _write(workspace, row["id"], _fingerprint(source), summary(row))
    except OSError:
        pass


def list_views(workspace, kind):
    result = []
    for source in sorted((workspace.root / kind).glob("*.json")):
        try:
            fingerprint = _fingerprint(source)
            row = _cached(workspace, source.stem, fingerprint)
            if row is None:
                original = workspace._get(kind, source.stem)
                row = summary(original)
                # If a file changes during an external restore, do not pair the
                # old calculation with a new file fingerprint.
                if _fingerprint(source) == fingerprint:
                    _write(workspace, source.stem, fingerprint, row)
            result.append(row)
        except FileNotFoundError:
            # An externally removed/restored view can disappear between listing
            # and stat. The next state read sees its current directory contents.
            continue
    return result
