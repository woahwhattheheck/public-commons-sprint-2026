"""Retained supplier editions for planning-unit reports and portable decisions."""
from __future__ import annotations

import csv
import html
import io
import json
from pathlib import Path

from .common import atomic_bytes, atomic_json, canonical, describe_file

LINEAGE_VERSION = 1
SUPPLIER_FIELDS = (
    "source_role", "source_collection_id", "planning_source_id", "planning_source_sha256",
    "county_fips", "county_name", "provider_id", "source_uri", "source_status",
    "captured_at", "source_last_edit_date", "source_data_last_edit_date",
    "source_where", "native_county_field", "native_county_value", "native_id_field",
    "source_sha256", "source_selected_features", "geometry_features",
    "parcel_features", "context_features", "zero_area_or_outside_features",
    "original_supplier_record",
)


def _copy(value):
    return json.loads(canonical(value))


def source_snapshot(entry, selection):
    """Keep the selected imported source's typed metadata with its body identity."""
    return {
        "selection": _copy(selection), "id": entry["id"], "title": entry["title"],
        "uri": entry["uri"], "vintage": entry["vintage"], "body": _copy(entry["body"]),
        "scope": _copy(entry.get("scope")),
        "layer": selection.get("layer") or entry.get("layer"),
        "id_field": selection.get("id_field") or entry.get("id_field"),
        "metadata": _copy(entry.get("metadata", {})),
    }


def retained_sources(workspace, bindings):
    """Recover older bindings from their exact immutable imported source edition."""
    result = {}
    for role, binding in bindings.items():
        choice = binding["selection"]
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if any(entry["body"].get(key) != binding["body"].get(key) for key in ("sha256", "bytes")):
            raise ValueError("The retained source body differs from the study binding: " + role)
        source = _copy(binding)
        if "metadata" not in source:
            source["metadata"] = _copy(entry.get("metadata", {}))
        result[role] = source
    return result


def presentation_state(workspace, state):
    """Enrich only a report view; preserve the original saved study selection."""
    selection = state["selection"]
    bindings = selection["bindings"]
    return {**state, "selection": {**selection, "bindings": {
        **bindings, "sources": retained_sources(workspace, bindings["sources"]),
    }}}


def lineage_record(sources):
    return {
        "schema": "upstate.source-lineage/v1", "version": LINEAGE_VERSION,
        "scope": "Retained source editions and capture coverage; study and portfolio footprints are reported separately.",
        "sources": _copy(sources),
    }


def supplier_rows(sources):
    rows = []
    for role, source in sources.items():
        metadata = source.get("metadata") or {}
        suppliers = metadata.get("input_sources", [])
        if not isinstance(suppliers, list):
            continue
        for supplier in suppliers:
            if not isinstance(supplier, dict):
                continue
            row = {key: supplier.get(key) for key in SUPPLIER_FIELDS}
            row.update(
                source_role=role,
                source_collection_id=source["selection"]["source_collection_id"],
                planning_source_id=source["id"],
                planning_source_sha256=source["body"]["sha256"],
                original_supplier_record=_copy(supplier),
            )
            rows.append(row)
    return rows


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _csv(path, fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows({key: _csv_value(row.get(key)) for key in fields} for row in rows)
    atomic_bytes(path, stream.getvalue().encode("utf-8"))


def _display(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = json.dumps(value, sort_keys=True, ensure_ascii=False)
    return html.escape(str(value))


def supplier_tables(sources, *, registry="source-lineage.json"):
    """Human-readable publisher/filter/edition mapping beside derived parcel data."""
    rows = supplier_rows(sources)
    if not rows:
        return ""
    columns = (
        ("source_role", "Role"), ("county_name", "County"),
        ("provider_id", "Provider"), ("source_where", "Original source filter"),
        ("captured_at", "Captured edition"), ("source_status", "Source status"),
        ("native_id_field", "Native identity field"), ("source_sha256", "Original body SHA-256"),
    )
    body = []
    for row in rows:
        cells = []
        for key, _ in columns:
            value = _display(row.get(key))
            if key == "provider_id" and str(row.get("source_uri") or "").startswith(("https://", "http://")):
                value = '<a href="' + html.escape(row["source_uri"], quote=True) + '">' + value + "</a>"
            cells.append("<td>" + value + "</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return (
        "<h2>County parcel source editions</h2>"
        "<p>These are the captured supplier editions behind the selected parcel inventory. "
        "Their source filters differ from the study's selected planning-unit and reporting footprints. "
        "Capture timestamps and service edits retain their original meanings.</p>"
        '<p><a href="' + html.escape(registry, quote=True) + '">Complete typed source lineage</a> · '
        '<a href="source-editions.csv">Supplier spreadsheet</a> · '
        '<a href="source-coverage.csv">Captured county coverage</a></p>'
        '<div class="scroll"><table><thead><tr>'
        + "".join("<th>" + title + "</th>" for _, title in columns)
        + "</tr></thead><tbody>" + "".join(body) + "</tbody></table></div>"
    )


def write_supplier_files(directory, sources, *, relative_to):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    _csv(directory / "source-editions.csv", SUPPLIER_FIELDS, supplier_rows(sources))
    coverage_rows = []
    coverage_fields = ["source_role", "source_collection_id", "planning_source_id",
                       "planning_source_sha256", "original_coverage_record"]
    for role, source in sources.items():
        records = (source.get("metadata") or {}).get("county_coverage", [])
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            row = {
                "source_role": role,
                "source_collection_id": source["selection"]["source_collection_id"],
                "planning_source_id": source["id"],
                "planning_source_sha256": source["body"]["sha256"],
                "original_coverage_record": _copy(record),
            }
            for key, value in record.items():
                column = "coverage_" + key
                if column not in coverage_fields:
                    coverage_fields.append(column)
                row[column] = value
            coverage_rows.append(row)
    _csv(directory / "source-coverage.csv", coverage_fields, coverage_rows)
    return {role: describe_file(relative_to, directory / name) for role, name in (
        ("source_editions", "source-editions.csv"),
        ("source_coverage", "source-coverage.csv"),
    )}


def write_lineage(directory, sources, *, relative_to):
    """Write a complete source supplement without changing scientific quantities."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    payload = lineage_record(sources)
    atomic_json(directory / "source-lineage.json", payload)
    write_supplier_files(directory, sources, relative_to=relative_to)
    original = []
    for role, source in sources.items():
        original.append("<tr>" + "".join("<td>" + _display(value) + "</td>" for value in (
            role, source["title"], source["uri"], source["vintage"],
            source.get("layer"), source.get("id_field"), source["body"]["sha256"],
        )) + "</tr>")
    page = (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>Retained source editions</title>"
        "<style>body{font:15px system-ui,sans-serif;line-height:1.5;color:#171717;background:#fff;"
        "margin:32px auto;padding:0 24px;max-width:1440px}table{border-collapse:collapse;width:100%}"
        "th,td{padding:8px;text-align:left;border:1px solid #ccc;vertical-align:top}"
        ".scroll{overflow:auto}td{overflow-wrap:anywhere}a{color:inherit}pre{white-space:pre-wrap}</style>"
        "<main><h1>Retained source editions</h1><p>" + _display(payload["scope"]) + "</p>"
        '<p><a href="source-lineage.json">Complete typed source lineage</a> · '
        '<a href="source-editions.csv">Supplier spreadsheet</a> · '
        '<a href="source-coverage.csv">Captured county coverage</a></p>'
        '<div class="scroll"><table><thead><tr><th>Role</th><th>Source</th><th>Original URI</th>'
        "<th>Edition</th><th>Layer</th><th>Identity field</th><th>Body SHA-256</th>"
        "</tr></thead><tbody>" + "".join(original) + "</tbody></table></div>"
        + supplier_tables(sources) + "</main></html>"
    )
    atomic_bytes(directory / "source-lineage.html", page.encode("utf-8"))
    return {role: describe_file(relative_to, directory / name) for role, name in (
        ("source_lineage", "source-lineage.json"),
        ("source_editions", "source-editions.csv"),
        ("source_coverage", "source-coverage.csv"),
        ("source_lineage_report", "source-lineage.html"),
    )}
