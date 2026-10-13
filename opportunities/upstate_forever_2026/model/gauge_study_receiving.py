"""Open retained Gauge, Station Geography and regional lineage in received Studies.

This reader joins the original selected-Study resolver; it does not receive,
rebuild, register or alter the captured scientific sources.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

CONTEXT = "gauge_support"
SCHEMA = "upstate.received-gauge-source/v1"


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT]
    return {
        "gauge_source_count": len(rows),
        "editable_gauge_count": len({row["gauge_support_id"] for row in rows
                                    if row.get("relationship") == "same_project"}),
    }


def _descriptor(closure, path, expected=None, *, label=None):
    closure.add_file(path, expected)
    item = closure.files[path]
    if item.get("sha256") is None:
        closure.read(path)
        item = closure.files[path]
    original_name = (expected or {}).get("filename")
    return {"path": path, "bytes": item["bytes"], "sha256": item["sha256"],
            "filename": original_name or PurePosixPath(label or path).name,
            "label": label or original_name or PurePosixPath(path).name}


def _files(closure, items):
    rows = {}
    for item in items:
        row = _descriptor(closure, item["path"], item, label=item.get("label"))
        # Equal bytes can be separate authored files with different logical names.
        rows[(row["path"], row["filename"], row["label"])] = row
    return [rows[key] for key in sorted(rows)]


def _record(closure, kind, key):
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    if not isinstance(value, dict) or digest(value) != key:
        raise ValueError("The received Gauge source lost its original " + kind + " record.")
    # Workspace._save stores the digest-addressed body without id; _get adds it.
    return {**value, "id": key}


def _source(closure, captured):
    collection_id = identifier(captured["source_collection_id"])
    source_id = captured["source_id"]
    collection = closure.read("sources/" + collection_id + ".json")
    matches = [row for row in collection.get("entries", []) if row.get("id") == source_id]
    if len(matches) != 1:
        raise ValueError("The received Gauge report lost its exact original source entry.")
    entry = matches[0]
    if entry["body"]["sha256"] != captured["source_body_sha256"]:
        raise ValueError("The received Gauge report changed its source body.")
    metadata = entry.get("metadata") or {}
    if (metadata.get("report_context_kind") != CONTEXT
            or metadata.get("gauge_support_id") != captured["gauge_support_id"]):
        raise ValueError("The received Gauge source has another producer identity.")
    return entry


def augment(closure, retained, result):
    """Add verified Gauge navigation to the existing received-study detail.

    Call after the maintained resolver/ScientificReport receipt verification,
    and before its final closure.assert_unchanged(). Files are captured through
    that same closure and later exposed by the ordinary ticket service.
    """
    identity = retained["identity"]
    captured_rows = [row for row in identity.get("scientific_report_sources", [])
                     if row.get("report_context_kind") == CONTEXT]
    resolved = getattr(closure, "report_source_records", {})
    result.update(summary(identity))
    result["gauge_sources"] = []
    for captured in captured_rows:
        token = (captured["source_collection_id"], captured["source_id"])
        current = resolved.get(token)
        if current != captured:
            raise ValueError("The received Study changed its original Gauge report lineage.")
        entry = _source(closure, captured)
        source = {"source_collection_id": token[0], "source_id": token[1]}
        row = {
            "schema": SCHEMA, "source": source,
            "title": entry.get("title") or "Original Gauge and catchment support",
            "source_project_id": captured["source_project_id"],
            "relationship": captured["relationship"],
            "source_body_sha256": captured["source_body_sha256"],
            "lineage": deepcopy(captured), "native": None,
            "support": deepcopy(captured.get("support")),
            "original_selection": deepcopy(captured.get("original_selection", {})),
            "report_ids": [report["id"] for report in result.get("reports", [])
                           if source in report.get("source_choices", [])],
            "source_members": [],
        }
        row["source_members"] = _files(closure, [
            {**entry["body"], "path": entry["body"]["object"],
             "label": entry["body"].get("view_path") or entry["body"].get("filename")
                      or entry["body"].get("source_path") or "Original Gauge report source"},
            *[{**item, "path": item["object"],
               "label": item.get("view_path") or item.get("filename")
                        or item.get("source_path") or PurePosixPath(item["object"]).name}
              for item in entry.get("companions", [])],
        ])
        if captured["relationship"] == "same_project":
            if captured["source_project_id"] != closure.workspace.project["id"]:
                raise ValueError("Editable Gauge lineage belongs to another original project.")
            gauge = _record(closure, "gauge-support", captured["gauge_support_id"])
            station = _record(closure, "station-geographies", captured["station_edition_id"])
            if (gauge["build_id"] != captured["gauge_build_id"]
                    or gauge["station_edition_id"] != station["id"]
                    or station["build_id"] != captured["station_build_id"]
                    or gauge["regional"] != captured["regional"]
                    or gauge["selection"] != captured["original_selection"]):
                raise ValueError("The received Gauge, Station and regional selections no longer match.")
            regional_id = captured["regional"]["report_id"]
            regional_prefix = "watershed-context/" + regional_id + "/"
            regional = closure.read(regional_prefix + "operator-report.json")
            if (regional.get("id") != regional_id or regional.get("state") != "complete"
                    or regional.get("source_fingerprint") != captured["regional"]["source_fingerprint"]):
                raise ValueError("The received Gauge lost its original completed regional report.")
            required = {("gauge-support", gauge["id"]),
                        ("station-geographies", station["id"]),
                        ("watershed-context", regional_id)}
            if not required.issubset({(item["kind"], item["id"])
                                     for item in captured.get("required_records", [])}):
                raise ValueError("The received Gauge lineage omits an original editable record.")
            regional_members = [
                {**item, "path": regional_prefix + item.get("path", name),
                 "label": name} for name, item in regional["files"].items()
            ]
            row["native"] = {
                "gauge": {"id": gauge["id"], "build_id": gauge["build_id"],
                          "title": gauge["title"], "created_at": gauge.get("created_at"),
                          "summary": deepcopy(gauge["summary"]),
                          "selection": deepcopy(gauge["selection"]),
                          "members": _files(closure, gauge["files"])},
                "station": {"id": station["id"], "build_id": station["build_id"],
                            "title": station.get("title") or "Original Station Geography",
                            "summary": deepcopy(station.get("summary", {})),
                            "members": _files(closure, station["files"])},
                "regional": {"id": regional_id,
                             "title": regional.get("title") or "Original regional watershed report",
                             "source_fingerprint": regional["source_fingerprint"],
                             "source_edition_fingerprint": captured["regional"].get("source_edition_fingerprint"),
                             "members": _files(closure, regional_members)},
            }
        elif captured["relationship"] != "external_project":
            raise ValueError("Choose a supported original Gauge source relationship.")
        result["gauge_sources"].append(row)
    return result
