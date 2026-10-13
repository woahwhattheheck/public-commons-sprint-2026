"""Readable planning briefs from retained native watershed selections."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import tempfile
from typing import Mapping
from urllib.parse import urlsplit

BRIEF_FORMAT = "upstate.watershed-selection-brief/v1"
BRIEF_FILENAME = "watershed-selection-brief.md"
HTML_FILENAME = "watershed-selection-brief.html"


def _text(value):
    if value is None:
        return "Unknown"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (list, tuple)):
        value = ", ".join(str(item) for item in value) or "None"
    return str(value).replace("\\", "\\\\").replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def _number(value, digits=2):
    if value is None:
        return "Unknown"
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Watershed brief quantities must be finite numbers")
    return f"{value:,.{digits}f}"


def _table(headers, rows):
    return [
        "| " + " | ".join(_text(value) for value in headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
        *("| " + " | ".join(_text(value) for value in row) + " |" for row in rows),
    ]


def _source_links(sources):
    labels = {
        "domain": "Original HUC12 model domain",
        "nrcs": "NRCS FY26 source-water priorities",
        "classified": "SCDES classified streams",
        "classification_coverage": "SCDES classification query",
        "native_network": "Original HUC12 downstream network",
        "water_context": "Retained regional water context",
    }
    links, seen = [], set()
    for source in sources:
        reference = source.get("reference")
        if isinstance(reference, Mapping) and not (reference.get("uri") or reference.get("url")):
            entries = reference.items()
        else:
            entries = [(source.get("source_id", "source"), reference)]
        for role, entry in entries:
            uri = (entry.get("uri") or entry.get("url")) if isinstance(entry, Mapping) else entry
            if not isinstance(uri, str) or urlsplit(uri).scheme not in ("http", "https") or uri in seen:
                continue
            seen.add(uri)
            label = labels.get(role, str(role).replace("_", " ").capitalize())
            safe = uri.replace("<", "%3C").replace(">", "%3E").replace(" ", "%20")
            links.append(f"- [{_text(label)}](<{safe}>)")
    return links


def render_selection_brief(selection):
    """Render the exact selected-watersheds/v1 rows and retained summaries."""
    if not isinstance(selection, Mapping) or selection.get("schema") != "upstate.selected-watersheds/v1":
        raise ValueError("Choose a retained upstate.selected-watersheds/v1 export")
    rows = selection.get("hucs")
    keys = selection.get("selected_huc12s")
    if not isinstance(rows, list) or not isinstance(keys, list) or not rows:
        raise ValueError("Choose at least one watershed in the saved selection")
    if any(not isinstance(key, str) or not re.fullmatch(r"[0-9]{12}", key) for key in keys):
        raise ValueError("Retain each original twelve-digit HUC12")
    indexed = {row["huc12"]: row for row in rows}
    if len(indexed) != len(rows) or set(indexed) != set(keys) or len(keys) != len(set(keys)):
        raise ValueError("Selected watershed rows and retained membership must agree")
    rows = [indexed[key] for key in sorted(keys)]
    summary = selection["summary"]
    if summary.get("huc_count") != len(rows):
        raise ValueError("The retained selection summary differs from its watershed rows")
    count = len(rows)
    noun = "watershed" if count == 1 else "watersheds"
    lines = [
        "# Upper Savannah watershed selection", "",
        f"This saved selection contains **{count} {noun}** from the "
        f"{selection['model_domain_huc_count']}-HUC regional model domain, covering "
        f"**{_number(summary.get('area_acres'))} acres** "
        f"({_number(summary.get('area_km2'))} km²) of published watershed area.", "",
        "## Planning context", "",
    ]
    lines.extend(_table(["Measure", "Retained result"], [
        ["Selected watersheds", count],
        ["NRCS priority watersheds", summary["priority_huc_count"]],
        ["Whole area of priority watersheds (acres)", _number(summary.get("priority_area_acres"))],
        ["Designated priority state portions (acres)", _number(summary.get("priority_state_portion_acres"))],
        ["Selected-class source records", summary["selected_classification_count"]],
        ["Watersheds with selected-class records", summary["classified_huc_count"]],
        ["Watersheds covered by the complete selected-class query", summary["complete_query_huc_count"]],
        ["Cross-state watersheds", summary["cross_state_huc_count"]],
    ]))
    lines.extend(["", "## Selected watersheds", ""])
    lines.extend(_table(
        ["HUC12", "Watershed", "Area (acres)", "States", "NRCS priority states", "Selected-class records"],
        ([row["huc12"], row.get("name"), _number(row.get("area_acres")), row.get("states", []),
          row.get("priority_states", []), row["selected_classification_count"]] for row in rows),
    ))
    lines.extend(["", "## Original state portions and priorities", ""])
    state_rows = [
        [row["huc12"], item.get("st_usps"), _number(item.get("st_ac")),
         item.get("fy26_status"), item.get("system_type"), item.get("resource_concern")]
        for row in rows for item in row.get("nrcs_state_rows", [])
    ]
    lines.extend(_table(
        ["HUC12", "State", "State portion (acres)", "NRCS status", "System type", "Resource concern"],
        state_rows,
    ))
    lines.extend([
        "",
        "Whole-watershed area counts each HUC12 once. State portions retain the publisher's "
        "original values and can differ slightly from the whole-watershed area.",
        "", "## Classified-water context", "",
    ])
    coverage = selection.get("classification_coverage") or {}
    lines.append("Selected source classes: " + _text(coverage.get("selected_classes", [])) + ".")
    lines.extend(["", *_table(
        ["HUC12", "Source classes", "Class counts", "Query coverage", "Source jurisdiction"],
        ([row["huc12"], row.get("selected_classes", []),
          "; ".join(f"{key}: {value}" for key, value in sorted(row.get("class_counts", {}).items())) or "0",
          row.get("classification_query_coverage", row.get("classification_coverage")),
          row.get("classification_scope")] for row in rows),
    ), ""])
    methods = selection.get("methods") or {}
    if methods.get("classified_water"):
        lines.extend([_text(methods["classified_water"]), ""])
    connected = [row for row in rows if row.get("network") is not None]
    if connected:
        lines.extend(["## Original drainage network", ""])
        lines.extend(_table(
            ["HUC12", "Known upstream model HUCs", "Upstream priority HUCs", "Upstream area (acres)",
             "Upstream selected-class records", "Downstream HUC12", "Path ending"],
            ([row["huc12"], row["network"].get("known_upstream_domain_huc_count"),
              row["network"].get("known_upstream_priority_huc_count"),
              _number(row["network"].get("known_upstream_area_acres")),
              row["network"].get("known_upstream_selected_classification_count"),
              row.get("downstream_huc12"), row["network"].get("downstream_path_status")]
             for row in connected),
        ))
        interpretation = (selection.get("network") or {}).get("interpretation")
        if interpretation:
            lines.extend(["", _text(interpretation)])
        lines.extend(["", "Upstream totals apply separately to each selected watershed. "
                      "Shared ancestors remain part of each watershed's own upstream context."])
        for row in connected:
            network = row["network"]
            lines.extend(["", "### " + _text(row.get("name") or row["huc12"]) + " — " + row["huc12"], ""])
            lines.append("- Original downstream path: " + _text(network.get("downstream_huc12s", [])) + ".")
            lines.append("- Known upstream model HUC12s: " + _text(network.get("known_upstream_domain_huc12s", [])) + ".")
            external = network.get("known_external_upstream_huc12s", [])
            if external:
                lines.append("- Additional upstream source HUC12s outside the model domain: " + _text(external) + ".")
        lines.append("")
    lines.extend(["## Interpretation", ""])
    for key in ("priority", "state_area", "roles", "geometry"):
        if methods.get(key):
            lines.extend([_text(methods[key]), ""])
    lines.extend(["## Original sources", "", *_source_links(selection.get("sources", [])), "",
                  "## Saved selection identity", ""])
    identities = [
        ["Regional context", selection["context_id"]],
        ["Canonical parent report SHA-256", selection["context_canonical_sha256"]],
        ["Selected HUC12s", ", ".join(sorted(keys))],
        ["Brief format", BRIEF_FORMAT],
    ]
    for label, key in (("Saved export", "export_id"),
                       ("Original parent report file SHA-256", "report_sha256"),
                       ("Original source fingerprint", "source_fingerprint")):
        if selection.get(key):
            identities.append([label, selection[key]])
    lines.extend(_table(["Field", "Value"], identities))
    return "\n".join(lines).rstrip() + "\n"


def _inline_html(text):
    text = text.replace("\\|", "|").replace("\\\\", "\\")
    escaped = html.escape(text, quote=True)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)


def render_selection_html(selection):
    """Render the same brief as accessible standalone HTML with neutral styling."""
    markdown = render_selection_brief(selection)
    lines, output = markdown.splitlines(), []
    index, heading = 0, "Watershed selection"
    while index < len(lines):
        line = lines[index]
        if not line:
            index += 1
            continue
        title = re.match(r"^(#{1,3}) (.+)$", line)
        if title:
            level, text = len(title[1]), title[2]
            heading = text
            output.append(f"<h{level}>" + _inline_html(text) + f"</h{level}>")
            index += 1
            continue
        if line.startswith("| ") and index + 1 < len(lines) and lines[index + 1].startswith("| ---"):
            def cells(row):
                return [value.strip() for value in re.split(r"(?<!\\)\|", row.strip()[1:-1])]
            headers = cells(line)
            output.append('<div class="table-scroll"><table><caption>' + _inline_html(heading) +
                          '</caption><thead><tr>' +
                          "".join('<th scope="col">' + _inline_html(value) + "</th>" for value in headers) +
                          "</tr></thead><tbody>")
            index += 2
            while index < len(lines) and lines[index].startswith("| "):
                values = cells(lines[index])
                if len(values) != len(headers):
                    raise ValueError("Watershed brief table cells differ from their columns")
                output.append("<tr>" + "".join(
                    ('<th scope="row">' + _inline_html(value) + "</th>") if column == 0 else
                    ("<td>" + _inline_html(value) + "</td>")
                    for column, value in enumerate(values)) + "</tr>")
                index += 1
            output.append("</tbody></table></div>")
            continue
        if line.startswith("- "):
            output.append("<ul>")
            while index < len(lines) and lines[index].startswith("- "):
                item = lines[index][2:]
                link = re.fullmatch(r"\[(.+?)\]\(<(.+)>\)", item)
                if link and urlsplit(link[2]).scheme in ("https", "http"):
                    content = '<a href="' + html.escape(link[2], quote=True) + '">' + _inline_html(link[1]) + "</a>"
                else:
                    content = _inline_html(item)
                output.append("<li>" + content + "</li>")
                index += 1
            output.append("</ul>")
            continue
        output.append("<p>" + _inline_html(line) + "</p>")
        index += 1
    style = """
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#222;font:15px/1.55 Arial,Helvetica,sans-serif}
main{max-width:1160px;margin:0 auto;padding:40px 28px}
h1{font-size:29px;line-height:1.2;margin:0 0 24px}
h2{font-size:20px;line-height:1.3;margin:32px 0 12px}
h3{font-size:16px;margin:22px 0 8px}
p,li{max-width:100ch}
a{color:inherit;text-decoration:underline;text-underline-offset:2px}
a:focus-visible{outline:2px solid #333;outline-offset:3px}
.table-scroll{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.45}
caption{text-align:left;font-size:12px;font-weight:600;padding:0 0 8px;color:#555}
th,td{border:1px solid #c8c8c8;padding:8px 10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
thead th{background:#eee}
tbody th{font-weight:600;background:#fafafa}
@media(max-width:600px){main{padding:24px 16px}h1{font-size:25px}th,td{padding:7px}}
@media print{main{max-width:none;padding:0}body{font-size:10pt}.table-scroll{overflow:visible}
h1,h2,h3{break-after:avoid}tr{break-inside:avoid}a{overflow-wrap:anywhere}}
"""
    return ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Upper Savannah watershed selection</title><style>' + style +
            '</style></head><body><main><article aria-label="Saved watershed selection">' +
            "\n".join(output) + "</article></main></body></html>\n")


def write_selection_brief(directory, selection):
    """Write both brief formats for the original operator's files manifest."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    bodies = {
        BRIEF_FILENAME: (render_selection_brief(selection).encode("utf-8"), "text/markdown"),
        HTML_FILENAME: (render_selection_html(selection).encode("utf-8"), "text/html"),
    }
    files = {}
    for name, (body, media_type) in bodies.items():
        path = directory / name
        fd, pending = tempfile.mkstemp(prefix="." + name + ".", dir=directory)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pending, path)
        finally:
            Path(pending).unlink(missing_ok=True)
        files[name] = {"path": name, "bytes": len(body),
                       "sha256": hashlib.sha256(body).hexdigest(), "media_type": media_type}
    return files


def main(argv=None):
    """Build the same brief directly from a retained report or selection."""
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--report", help="Original retained watershed-context.json")
    inputs.add_argument("--selection", help="Original saved selected-watersheds.json")
    parser.add_argument("--huc12", action="append", help="Selected HUC12; repeat for each watershed")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    if args.selection and args.huc12:
        parser.error("--huc12 selects rows from --report; --selection already retains membership")
    input_path = Path(args.report or args.selection)
    body = input_path.read_bytes()
    value = json.loads(body)
    if args.report:
        from .watershed_context import selected_watershed_export
        if not args.huc12:
            parser.error("Choose at least one --huc12 from the retained regional report")
        selection = selected_watershed_export(value, args.huc12)
        selection["report_sha256"] = hashlib.sha256(body).hexdigest()
    else:
        selection = value
    files = write_selection_brief(args.output_dir, selection)
    print(json.dumps({
        "schema": BRIEF_FORMAT, "context_id": selection["context_id"],
        "selected_huc12s": selection["selected_huc12s"], "summary": selection["summary"],
        "input_path": str(input_path), "input_sha256": hashlib.sha256(body).hexdigest(),
        "files": files,
    }, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
