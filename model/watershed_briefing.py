"""Create source-bound meeting pages from the complete saved watershed brief."""
from __future__ import annotations
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
from . import client_briefing
from .watershed_brief import render_selection_brief, _inline_html

SCHEMA = "upstate.source-context-report/v1"
EDITION = "2026-10-13-utility-source-briefing-1"
STEM = "source-context-report"

def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)

def _hash(body):
    return hashlib.sha256(body).hexdigest()

def _plain(value):
    """Decode the existing brief's escaped table text without changing values."""
    return re.sub(r"\\([\\|])", r"\1", value)

def _cells(line):
    # A literal pipe is escaped by the original renderer. Count backslashes
    # rather than treating an escaped backslash as a cell separator escape.
    values, part, escaped = [], [], False
    for char in line.strip()[1:-1]:
        if char == "|" and not escaped:
            values.append(_plain("".join(part).strip()))
            part = []
        else:
            part.append(char)
        escaped = not escaped if char == "\\" else False
    values.append(_plain("".join(part).strip()))
    return values

def _sections(markdown):
    """Retain original paragraph/table ordering and exact displayed cell text."""
    sections, current, heading, index = [], None, "Watershed selection", 0
    lines = markdown.splitlines()
    def start(title, source_line):
        row = {"id": "source-section-" + str(len(sections) + 1).zfill(4),
               "title": title, "paragraphs": [], "tables": [], "assets": [],
               "source_markdown_line": source_line + 1,
               "core": len(sections) < 5 or title in ("Interpretation", "Original sources")}
        sections.append(row)
        return row
    while index < len(lines):
        line = lines[index]
        if not line:
            index += 1
            continue
        match = re.fullmatch(r"#{1,3} (.+)", line)
        if match:
            heading = _plain(match[1])
            current = start(heading, index)
            index += 1
            continue
        if current is None:
            current = start(heading, index)
        if line.startswith("| ") and index + 1 < len(lines) and lines[index + 1].startswith("| ---"):
            columns, rows, first = _cells(line), [], index
            index += 2
            while index < len(lines) and lines[index].startswith("| "):
                values = _cells(lines[index])
                if len(values) != len(columns):
                    raise ValueError("Original watershed table column count changed")
                rows.append(values)
                index += 1
            current["tables"].append({"caption": heading, "columns": columns,
                "rows": rows, "source_markdown_line": first + 1})
            continue
        # The briefing renders paragraphs before tables. Starting a continuation
        # here keeps source interpretations after their original table.
        if current["tables"] or current["assets"]:
            current = start(heading + " — interpretation and sources", index)
        link = re.fullmatch(r"- \[(.+?)\]\(<(.+)>\)", line)
        if link and client_briefing._path(link[2]):
            current["assets"].append({"path": link[2], "title": _plain(link[1])})
        else:
            current["paragraphs"].append(_plain(line))
        index += 1
    return [row for row in sections if row["paragraphs"] or row["tables"] or row["assets"]]

def _observed_sections(selection):
    observed = selection.get("observed_context")
    if observed is None:
        return []
    utility, regional = observed["utility"], observed["regional_stream"]
    def cell(value):
        return "Unavailable" if value is None else value
    measured_rows = []
    for row in utility["station_year_method_groups"]:
        stats = row["measured"]
        measured_rows.append([
            row["station_id"], row["year"], row["method_context"], row["method"],
            row["activity_type"], row["source_unit"], row["records"],
            stats["measured_count"], _json(row["detection_status"]),
            row["information_only_records"], cell(stats["minimum"]),
            cell(stats["median"]), cell(stats["maximum"])])
    method_rows = [[key, value] for key, value in observed["methods"].items()]
    return [{
        "id": "original-observed-methods", "title": "Observed-source methods and interpretation",
        "core": True, "paragraphs": [utility["geographic_basis"], utility["model_interpretation"]],
        "tables": [{"caption": "Original source method statements", "columns": ["Method", "Original interpretation"],
                    "rows": method_rows}], "assets": [],
    }, {
        "id": "original-microbial-groups", "title": "Utility E. coli: exact station, year, method and unit groups",
        "core": False, "paragraphs": [
            observed["methods"]["summaries"], observed["methods"]["temporal"],
            "Minimum, median and maximum use only the stated measured subset in each exact group. "
            "Unavailable numeric summaries retain their original null values in the complete source selection. "
            "Censored values, missing results, Information Only comments and field replicates retain their original categories."],
        "tables": [{"caption": "Original measured-only group summaries; statistics use the listed concentration unit",
            "columns": ["Station", "Year", "Method context", "Method", "Activity type", "Source unit",
                        "Original rows", "Measured rows", "Detection-state counts", "Information Only rows",
                        "Minimum", "Median", "Maximum"], "rows": measured_rows}], "assets": [],
    }, {
        "id": "original-regional-nutrient-groups", "title": "Regional nutrient observations: separate source geography",
        "core": False, "paragraphs": [regional["geographic_meaning"], regional["quantity_meaning"],
                                      regional["interpretation"]],
        "tables": [{"caption": "Original station, characteristic, fraction, method and unit groups",
            "columns": ["Station", "Characteristic", "Sample fraction", "Method context", "Method",
                        "Result type", "Observation unit", "Rows", "Unique dates", "First sample",
                        "Last sample", "Quantitation classes", "Original result units", "Limit units", "Flow role"],
            "rows": [[row["station_id"], row["characteristic"], row["sample_fraction"],
                      row["method_context"], row["method_id"], row["result_type"],
                      row["observation_unit"], row["records"], row["unique_dates"],
                      row["first_date"], row["last_date"], _json(row["quantitation_classes"]),
                      _json(row["original_units"]), _json(row["original_limit_units"]),
                      _json(row["flow_location_roles"])] for row in regional["nutrient_groups"]]}],
        "assets": [],
    }]

def build(selection, original_selection_bytes):
    if not isinstance(original_selection_bytes, bytes):
        raise ValueError("Use the complete original saved selection bytes")
    if _json(json.loads(original_selection_bytes.decode("utf-8"))) != _json(selection):
        raise ValueError("The saved selection and briefing source differ")
    markdown = render_selection_brief(selection)
    utility = selection.get("utility_selection")
    title = utility["title"] if utility else "Upper Savannah watershed source selection"
    source = {"path": "selected-watersheds.json", "bytes": len(original_selection_bytes),
              "sha256": _hash(original_selection_bytes),
              "canonical_sha256": _hash(_json(selection).encode("utf-8")),
              "context_id": selection["context_id"], "export_id": selection.get("export_id"),
              "utility_id": utility.get("utility_id") if utility else None,
              "selected_huc12s": list(selection["selected_huc12s"])}
    return {
        "schema": SCHEMA, "report_edition": EDITION, "title": title,
        "report_kind_label": "Original utility and watershed source context",
        "delivery_mode": "source_context", "source_binding": source,
        "source_selection": selection, "source_markdown": markdown,
        "source_scope": [
            {"label": "Selected source footprint", "value": str(len(selection["selected_huc12s"])) + " original HUC12 watersheds"},
            {"label": "Regional source domain", "value": str(selection["model_domain_huc_count"]) + " original HUC12 watersheds"},
            {"label": "Geographic interpretation", "value": utility["interpretation"] if utility else
             "The explicitly saved watershed membership and original source jurisdiction"}],
        "sections": _sections(markdown) + _observed_sections(selection), "maps": [],
    }

def render_complete(report):
    client_briefing._binding(report)
    parts = []
    for section in report["sections"]:
        parts.append('<section id="' + html.escape(section["id"], quote=True) +
                     '"><h2>' + html.escape(section["title"]) + '</h2>')
        parts.extend("<p>" + _inline_html(value) + "</p>" for value in section["paragraphs"])
        for table in section["tables"]:
            parts.append(client_briefing._table(table, table["rows"], 0, len(table["rows"])))
        parts.append(client_briefing._assets(section["assets"]))
        parts.append("</section>")
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>' + html.escape(report["title"]) + '</title><style>' + client_briefing.STYLE +
        'main{max-width:1200px;margin:auto;padding:32px}main section{margin:32px 0}'
        '</style></head><body><main><h1>' + html.escape(report["title"]) + '</h1>'
        '<p>Original source context. Each source retains its own geography, period, method and units.</p>'
        '<p><a href="' + STEM + '-briefing.html">Present and record meeting notes</a> · '
        '<a href="selected-watersheds.json">Original selected watershed records</a> · '
        '<a href="watershed-selection-brief.html">Original watershed brief</a></p>' +
        "".join(parts) + '</main></body></html>')

def write(directory, selection):
    """Publish an independent presentation edition beside verified saved sources."""
    directory = Path(directory)
    original = (directory / "selected-watersheds.json").read_bytes()
    report = build(selection, original)
    model_body = (_json(report) + "\n").encode("utf-8")
    briefing, index = client_briefing.render(
        report, report_href=STEM + ".html", model_href=STEM + "-model.json",
        report_model_bytes=model_body)
    bodies = {
        STEM + "-model.json": (model_body, "application/json"),
        STEM + ".html": (render_complete(report).encode("utf-8"), "text/html"),
        STEM + "-briefing.html": (briefing.encode("utf-8"), "text/html"),
        STEM + "-briefing.json": ((_json(index) + "\n").encode("utf-8"), "application/json"),
    }
    files = {}
    for name, (body, media_type) in bodies.items():
        path = directory / name
        if path.exists() and path.read_bytes() != body:
            raise ValueError("This source briefing edition already has different bytes: " + name)
        if not path.exists():
            descriptor, pending = tempfile.mkstemp(prefix="." + name, dir=directory)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(body)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(pending, path)
            finally:
                Path(pending).unlink(missing_ok=True)
        files[name] = {"path": name, "bytes": len(body), "sha256": _hash(body),
                       "media_type": media_type, "title": {
            STEM + "-model.json": "Original source-context report model",
            STEM + ".html": "Complete utility source-context report",
            STEM + "-briefing.html": "Present utility sources and record meeting notes",
            STEM + "-briefing.json": "Original source-context briefing page index"}[name]}
    return files
