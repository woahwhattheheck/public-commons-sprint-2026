"""Readable planning briefs from retained native watershed selections."""
from __future__ import annotations

import argparse
import csv
import io
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

BRIEF_FORMAT = "upstate.watershed-selection-brief/v8"
BRIEF_FILENAME = "watershed-selection-brief.md"
HTML_FILENAME = "watershed-selection-brief.html"


CONTRIBUTING_FILENAME = "watershed-contributing-hucs.csv"
CONTRIBUTING_COLUMNS = (
    "huc12", "name", "area_acres", "states", "priority", "priority_states",
    "selected_classification_count", "class_counts", "is_selected",
    "contributes_to_huc12s",
)
CLASS_LABELS = {
    "ORW": "Outstanding Resource Waters",
    "ONRW": "Outstanding National Resource Waters",
    "TN": "Trout Natural",
    "TPGT": "Trout Put, Grow, and Take",
    "TPT": "Trout Put and Take",
}


def _upstream_ids(focal, values, domain):
    if not isinstance(values, (list, tuple)) or any(
            not isinstance(key, str) or not re.fullmatch(r"[0-9]{12}", key)
            for key in values):
        raise ValueError("Contributing membership requires original twelve-digit HUC12s")
    if len(values) != len(set(values)) or focal in values or set(values) - domain:
        raise ValueError("Upstream membership must be distinct model-domain ancestors")
    return sorted(values)


def load_completed_connectivity(report, report_sha256, csv_path, summary_path):
    """Bind an existing completed connectivity output to its exact source report."""
    csv_path, summary_path = Path(csv_path), Path(summary_path)
    csv_body, summary_body = csv_path.read_bytes(), summary_path.read_bytes()
    summary = json.loads(summary_body)
    original = summary.get("sources", {}).get("original_regional_report", {})
    if (summary.get("schema") != "upstate.watershed-connectivity/v1"
            or summary.get("source_context_id") != report["id"]
            or original.get("sha256") != report_sha256):
        raise ValueError("Completed connectivity must bind to this exact original report file")
    by_huc = {row["huc12"]: row for row in report["hucs"]}
    rows = list(csv.DictReader(io.StringIO(csv_body.decode("utf-8-sig"), newline="")))
    indexed = {row["huc12"]: row for row in rows}
    if (len(indexed) != len(rows) or set(indexed) != set(by_huc)
            or summary.get("domain_huc_count") != len(by_huc)):
        raise ValueError("Completed connectivity must retain every original model-domain HUC")
    upstream = {}
    for key, row in indexed.items():
        original_row = by_huc[key]
        if (row["focal_priority"] != str(original_row["priority"]).lower()
                or int(row["focal_selected_classifications"]) != original_row["selected_classification_count"]
                or not math.isclose(float(row["focal_area_acres"]), original_row["area_acres"],
                                    rel_tol=1e-10, abs_tol=1e-6)):
            raise ValueError("Completed connectivity focal attributes differ from the original report")
        members = _upstream_ids(key, row["upstream_huc12s"].split("|")
                                if row["upstream_huc12s"] else [], set(by_huc))
        contributing = [original_row, *(by_huc[item] for item in members)]
        area = math.fsum(item["area_acres"] for item in contributing)
        if (int(row["upstream_domain_huc_count"]) != len(members)
                or int(row["contributing_huc_count"]) != len(contributing)
                or int(row["contributing_priority_huc_count"]) !=
                    sum(item["priority"] is True for item in contributing)
                or int(row["contributing_selected_classifications"]) !=
                    sum(item["selected_classification_count"] for item in contributing)
                or not math.isclose(float(row["contributing_area_acres"]), area,
                                    rel_tol=1e-10, abs_tol=1e-6)):
            raise ValueError("Completed connectivity quantities differ from its retained membership")
        upstream[key] = members
    source = {
        "kind": "completed_connectivity",
        "source_context_id": report["id"],
        "original_report_sha256": report_sha256,
        "calculated_on": summary.get("calculated_on"),
        "source_status": summary.get("source_status"),
        "sources": summary.get("sources", {}),
        "files": [
            {"name": path.name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            for path, body in ((csv_path, csv_body), (summary_path, summary_body))
        ],
    }
    return upstream, source


def add_contributing_context(selection, report, *, upstream_by_huc=None, source=None):
    """Count the union of original member rows once, retaining each focal set."""
    from .watershed_context import selected_watershed_export, _summary
    focal = selected_watershed_export(report, selection["selected_huc12s"])
    if (selection.get("context_id") != focal["context_id"]
            or selection.get("context_canonical_sha256") != focal["context_canonical_sha256"]):
        raise ValueError("Contributing context must use the saved selection's original report")
    indexed = {row["huc12"]: row for row in report["hucs"]}
    chosen = focal["selected_huc12s"]
    if upstream_by_huc is None:
        if not all(isinstance(indexed[key].get("network"), Mapping) for key in chosen):
            return dict(selection)
        upstream_by_huc = {
            key: indexed[key]["network"].get("known_upstream_domain_huc12s")
            for key in chosen
        }
        source = {"kind": "retained_report_network",
                  "context_canonical_sha256": focal["context_canonical_sha256"],
                  "network": report.get("network"), "sources": report.get("sources", [])}
    membership, per_focal = {}, []
    for key in chosen:
        members = [key, *_upstream_ids(key, upstream_by_huc.get(key), set(indexed))]
        member_summary = _summary([indexed[item] for item in members])
        for member in members:
            membership.setdefault(member, []).append(key)
        per_focal.append({
            "huc12": key, "name": indexed[key].get("name"),
            "member_huc12s": sorted(members), "summary": member_summary,
        })
    union_rows = [indexed[key] for key in sorted(membership)]
    rows = [
        {**{field: row.get(field) for field in CONTRIBUTING_COLUMNS
            if field not in {"is_selected", "contributes_to_huc12s"}},
         "is_selected": row["huc12"] in chosen,
         "contributes_to_huc12s": membership[row["huc12"]]}
        for row in union_rows
    ]
    repeated = [row for row in rows if len(row["contributes_to_huc12s"]) > 1]
    complete_area = all(row["area_acres"] is not None for row in rows)
    individual_area = (math.fsum(item["summary"]["area_acres"] for item in per_focal)
                       if complete_area else None)
    repeated_area = (math.fsum(row["area_acres"] * (len(row["contributes_to_huc12s"]) - 1)
                              for row in repeated) if complete_area else None)
    context = {
        "schema": "upstate.watershed-contributing-union/v1",
        "context_id": focal["context_id"],
        "context_canonical_sha256": focal["context_canonical_sha256"],
        "selected_huc12s": chosen,
        "member_huc12s": sorted(membership), "summary": _summary(union_rows),
        "per_focal": per_focal, "hucs": rows,
        "sum_individual_contributing_acres": individual_area,
        "repeated_area_acres": repeated_area,
        "repeated_member_huc12s": [row["huc12"] for row in repeated],
        "source": source,
    }
    return {**selection, "contributing_context": context}


def selection_with_contributing_context(report, selected_huc12s, report_sha256,
                                        completed_directory=None):
    """Use native report membership or an installed, exactly bound completed result."""
    from .watershed_context import selected_watershed_export
    selection = selected_watershed_export(report, selected_huc12s)
    enriched = add_contributing_context(selection, report)
    if "contributing_context" in enriched or completed_directory is None:
        return enriched
    directory = Path(completed_directory)
    csv_path = directory / "watershed-connectivity-217.csv"
    summary_path = directory / "watershed-connectivity-summary.json"
    if not csv_path.is_file() or not summary_path.is_file():
        return enriched
    summary = json.loads(summary_path.read_bytes())
    if (summary.get("source_context_id") != report["id"]
            or summary.get("sources", {}).get("original_regional_report", {}).get("sha256")
            != report_sha256):
        return enriched
    upstream, source = load_completed_connectivity(report, report_sha256, csv_path, summary_path)
    return add_contributing_context(selection, report, upstream_by_huc=upstream, source=source)


def _contributing_lines(selection):
    context = selection.get("contributing_context")
    if context is None:
        return []
    if (context.get("schema") != "upstate.watershed-contributing-union/v1"
            or context.get("context_id") != selection["context_id"]
            or context.get("context_canonical_sha256") != selection["context_canonical_sha256"]
            or context.get("selected_huc12s") != sorted(selection["selected_huc12s"])):
        raise ValueError("Saved contributing membership differs from its selected report")
    summary = context["summary"]
    rows = context["hucs"]
    if ([row["huc12"] for row in rows] != context["member_huc12s"]
            or len(rows) != summary["huc_count"]):
        raise ValueError("Saved contributing rows differ from their retained union")
    lines = ["## Contributing-area union", "",
             f"The distinct union of the focal watersheds and their known upstream model-domain "
             f"watersheds contains **{summary['huc_count']} HUC12s** covering "
             f"**{_number(summary['area_acres'])} acres**. Each member is counted once. "
             f"The union contains **{summary['priority_huc_count']} NRCS priority watersheds** "
             f"and **{summary['selected_classification_count']:,} selected-class source records**.", ""]
    lines.extend(_table(
        ["Focal HUC12", "Watershed", "Contributing HUCs", "Contributing acres",
         "Priority HUCs", "Selected-class records"],
        ([item["huc12"], item["name"], item["summary"]["huc_count"],
          _number(item["summary"]["area_acres"]), item["summary"]["priority_huc_count"],
          item["summary"]["selected_classification_count"]] for item in context["per_focal"]),
    ))
    lines.extend(["", "The individual contributing areas sum to "
                  + _number(context["sum_individual_contributing_acres"]) + " acres. "
                  "Repeated memberships account for "
                  + _number(context["repeated_area_acres"]) + " acres in that sum.", ""])
    repeated = [row for row in rows if row["huc12"] in context["repeated_member_huc12s"]]
    if repeated:
        lines.extend(_table(
            ["Shared HUC12", "Watershed", "Area (acres)", "Contributes to focal HUC12s"],
            ([row["huc12"], row["name"], _number(row["area_acres"]),
              row["contributes_to_huc12s"]] for row in repeated),
        ))
        lines.append("")
    priority = [row for row in rows if row["priority"] is True]
    if priority:
        lines.extend(["### Priority watersheds in the union", "", *_table(
            ["HUC12", "Watershed", "Whole area (acres)", "Designated priority states"],
            ([row["huc12"], row["name"], _number(row["area_acres"]), row["priority_states"]]
             for row in priority),
        ), ""])
    lines.extend(["### Classified-water records in the union", "", *_table(
        ["Publisher class", "Publisher label", "Source records"],
        ([code, CLASS_LABELS.get(code, code), count]
         for code, count in sorted(summary["class_counts"].items())),
    ), "", "The union follows original HUC12 drainage membership. Stream classifications retain "
        "their publisher-assigned HUC12 and named-reach meaning. A drainage connection does not "
        "extend a legal stream classification to every water in the contributing watershed.", "",
        "- [USGS Watershed Boundary Dataset](<https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6>)",
        "- [SCDES classified-stream service](<https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2>)",
        "- [SCDES R.61-68 classification definitions](<https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf>)",
        "- [South Carolina R.61-69 named classified waters](<https://www.scstatehouse.gov/coderegs/Chapter%2061-69.pdf>)", ""])
    return lines


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



def _utility_lines(selection):
    utility = selection.get("utility_selection")
    if utility is None:
        return []
    if (utility.get("schema") != "upstate.utility-watershed-selection/v1"
            or not utility.get("available")
            or set(utility.get("huc12s", [])) != set(selection["selected_huc12s"])):
        raise ValueError("The utility profile and selected watershed membership differ")
    lines = ["## Original utility contributing footprint", "",
             _text(utility["title"]), "", _text(utility["interpretation"]), ""]
    lines.extend(_table(["Field", "Retained source selection"], [
        ["Utility", utility["utility_id"]],
        ["Original focus anchors", utility["anchor_huc12s"]],
        ["Whole-HUC model-domain members", utility["huc12s"]],
        ["Known upstream source HUCs outside model domain",
         utility.get("known_external_upstream_huc12s", [])],
        ["Area basis", utility["area_basis"]],
        ["Original profile SHA-256", utility["profile_source"]["sha256"]],
    ]))
    lines.extend(["", "### Original NRCS programme designations", ""])
    lines.extend(_table(
        ["Original system type", "Priority state-HUC rows", "Designated state portions (acres)",
         "Known state portions (acres)", "Missing source areas"],
        ([row["system_type"], row["state_row_count"], _number(row["state_portion_acres"]),
          _number(row["known_state_portion_acres"]), row["missing_area_count"]]
         for row in utility["programme_designations"]),
    ))
    lines.extend(["",
        "Ground, Surface and Both remain separate original programme labels. These are "
        "designated state-HUC portions, not measured water quality, a surface-water-only "
        "priority ranking or parameters for InVEST subsurface transport.", ""])
    return lines

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
    from .watershed_source_review import brief_lines as review_lines
    lines.extend(["", *review_lines(selection, _table, _number)])
    lines.extend(["", *_utility_lines(selection)])
    from .utility_observed_context import brief_lines
    lines.extend(["", *brief_lines(selection, _table, _number)])
    from .watershed_observation_context import brief_lines as evidence_lines
    lines.extend(["", *evidence_lines(selection, _table, _number)])
    from .watershed_map_context import brief_lines as map_lines
    lines.extend(["", *map_lines(selection, _table, _number)])
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
    lines.extend(_contributing_lines(selection))
    lines.extend(["## Interpretation", ""])
    for key in ("priority", "state_area", "roles", "geometry"):
        if methods.get(key):
            lines.extend([_text(methods[key]), ""])
    lines.extend(["## Original sources", "", *_source_links(
        list(selection.get("sources", [])) + list(selection.get("supporting_source_references", []))), "",
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
                source_link = (link and re.fullmatch(r"observed-sources/[A-Za-z0-9_./-]+", link[2])
                               and ".." not in link[2].split("/"))
                if link and (urlsplit(link[2]).scheme in ("https", "http") or source_link):
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
@media(max-width:600px){main{padding:24px 16px}h1{font-size:25px}table{min-width:720px}th,td{padding:7px}}
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
    from .watershed_context import _csv_bytes
    from .utility_watershed_context import state_records, programme_summary
    original_states = state_records(selection["hucs"])
    state_columns = ("selected_huc12",) + tuple(sorted({
        key for row in original_states for key in row if key != "selected_huc12"}))
    bodies["selected-watershed-state-records.csv"] = (
        _csv_bytes(original_states, state_columns), "text/csv")
    bodies["selected-programme-designations.csv"] = (
        _csv_bytes(programme_summary(selection["hucs"]), (
            "system_type", "state_row_count", "state_portion_acres",
            "known_state_portion_acres", "missing_area_count", "state_huc_keys")), "text/csv")
    utility = selection.get("utility_selection")
    if utility is not None:
        selected = {row["huc12"]: row for row in selection["hucs"]}
        memberships = [{
            "utility_id": utility["utility_id"], "receptor_id": utility["receptor_id"],
            **item, "whole_huc_area_acres": selected[item["huc12"]]["area_acres"],
            "states": selected[item["huc12"]]["states"],
            "geography": utility["geography"],
            "profile_sha256": utility["profile_source"]["sha256"],
            "report_id": utility["report_id"],
        } for item in utility["membership"]]
        bodies["utility-watershed-memberships.csv"] = (
            _csv_bytes(memberships, (
                "utility_id", "receptor_id", "huc12", "downstream_huc12",
                "is_profile_anchor", "whole_huc_area_acres", "states",
                "geography", "profile_sha256", "report_id")), "text/csv")
    if selection.get("contributing_context") is not None:
        bodies[CONTRIBUTING_FILENAME] = (
            _csv_bytes(selection["contributing_context"]["hucs"], CONTRIBUTING_COLUMNS), "text/csv")
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
    parser.add_argument("--connectivity-csv", help="Original completed connectivity CSV")
    parser.add_argument("--connectivity-summary", help="Its source-bound connectivity summary JSON")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    if args.selection and args.huc12:
        parser.error("--huc12 selects rows from --report; --selection already retains membership")
    if bool(args.connectivity_csv) != bool(args.connectivity_summary):
        parser.error("Use --connectivity-csv and --connectivity-summary together")
    if args.selection and args.connectivity_csv:
        parser.error("Completed connectivity enriches --report; --selection already retains its context")
    input_path = Path(args.report or args.selection)
    body = input_path.read_bytes()
    value = json.loads(body)
    if args.report:
        from .watershed_context import selected_watershed_export
        if not args.huc12:
            parser.error("Choose at least one --huc12 from the retained regional report")
        selection = selected_watershed_export(value, args.huc12)
        selection["report_sha256"] = hashlib.sha256(body).hexdigest()
        if args.connectivity_csv:
            upstream, source = load_completed_connectivity(
                value, selection["report_sha256"], args.connectivity_csv, args.connectivity_summary)
            selection = add_contributing_context(selection, value, upstream_by_huc=upstream, source=source)
        else:
            selection = add_contributing_context(selection, value)
    else:
        selection = value
    files = write_selection_brief(args.output_dir, selection)
    print(json.dumps({
        "schema": BRIEF_FORMAT, "context_id": selection["context_id"],
        "selected_huc12s": selection["selected_huc12s"], "summary": selection["summary"],
        "contributing_context": selection.get("contributing_context"),
        "input_path": str(input_path), "input_sha256": hashlib.sha256(body).hexdigest(),
        "files": files,
    }, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
