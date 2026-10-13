"""Complete control assessment and original observed-report recipe sections."""
from __future__ import annotations

import html
from pathlib import Path

from .common import atomic_bytes

LINKS = ("assessment.json", "selection.json", "input-binding.json",
         "matched-pairs.csv", "unmatched-targets.csv", "strata.csv", "balance.csv")


def sections(assessment, notes):
    summary = assessment["summary"]
    table = lambda columns, rows, caption: {"kind": "table", "columns": columns, "rows": rows, "caption": caption}
    result = [[assessment["selection"]["title"], [
        "Saved control design assessment: " + assessment["state"] + ".",
        assessment["selection"]["reason"], *notes,
        table(["Measure", "Value"], [[key.replace("_", " "), value]
              for key, value in summary.items() if not isinstance(value, (list, dict))], "Complete support and acceptance"),
        "Matched dimensions: " + ", ".join(summary["matched_dimensions"]) + ".",
        "Dimensions not stratified: " + ", ".join(summary["unmatched_dimensions"]) + ".",
        "Repeated titles or the same deterministic configuration do not create independent spatial placements. Compare retained mask hashes.",
    ]]]
    dimensions = []
    for item in assessment["selection"]["strata"]:
        source = item.get("source")
        dimensions.append([item["role"], item["units"],
            ", ".join(map(str, item["boundaries"])) if item["boundaries"] else "One unconstrained bin",
            item.get("definition", "Original prepared native-grid physical input"),
            (source["source_collection_id"] + " / " + source["source_id"]) if source else "Original prepared grid"])
    result.append(["Declared matching dimensions", [
        "Bin rule: " + summary["bin_rule"] + ".",
        table(["Role", "Units", "Ordered boundaries", "Physical definition", "Original source"],
              dimensions, "Explicit analyst choices retained in selection.json"),
        "The __all__ target/candidate rows use each field\'s finite pre-admission population, including cells missing other admission covariates; they are not the eligible matching-pool counts. An enabled dimension with no boundaries still requires valid source support.",
        "For an unaccepted assessment, overall treatment and selected-control supports can differ. Paired residual counts state the actual finite paired support; no unmatched treatment is silently removed."
    ]])
    rows = []
    for value in assessment["strata"]:
        rows.append([value["key"], value["from_code"], value["to_code"],
                     ", ".join(map(str, value["bins"])), value["target_cells"],
                     value["candidate_cells"], value["matched_cells"],
                     value["state"], "; ".join(value["reasons"])])
    for offset in range(0, len(rows), 24):
        result.append(["Declared matching strata", [table(
            ["Stratum", "From", "To", "Bins", "Targets", "Candidates", "Pairs", "State", "Reason"],
            rows[offset:offset+24], "Original class/transition and explicit covariate boundaries; no target trimming")]])
    for role in dict.fromkeys(r["role"] for r in assessment["balance"]):
        rows = []
        for value in assessment["balance"]:
            if value["role"] != role:
                continue
            a, b, r = value["target"], value["control"], value["residual"]
            rows.append([value["stratum"], a["count"], a["mean"], a["population_sd"],
                         b["count"], b["mean"], b["population_sd"],
                         r["count"], r["mean"], r["mean_absolute"], r["max_absolute"]])
        for offset in range(0, len(rows), 24):
            result.append([role + " balance (" + next(r["units"] for r in assessment["balance"] if r["role"] == role) + ")", [
                table(["Stratum", "Target n", "Mean", "SD", "Control n", "Mean", "SD",
                       "Paired n", "C − T mean", "Mean |C − T|", "Max |C − T|"],
                      rows[offset:offset+24], "Population SD; each balance field retains its own finite support. Full candidate values and extrema remain in balance.csv.")]])
    result.append(["Complete scientific inputs and outputs", [{
        "kind": "links", "items": [{"title": name, "path": name} for name in LINKS]
    }]])
    return result


def write(directory, assessment, notes):
    """Keep a directly usable offline HTML report alongside the native recipe."""
    blocks = sections(assessment, notes)
    e = lambda value: html.escape("" if value is None else str(value), quote=True)
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>' + e(assessment["selection"]["title"]) + '</title>',
             '<style>body{font:16px/1.55 system-ui,sans-serif;color:#18212b;background:#f5f7fa;margin:0}main{max-width:1180px;margin:auto;padding:28px}section{background:white;border:1px solid #d5dde6;border-radius:8px;padding:22px;margin:18px 0}h1{font-size:1.65rem}h2{font-size:1.2rem}p,td,th{overflow-wrap:anywhere}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.87rem}td,th{padding:8px;border-bottom:1px solid #d5dde6;text-align:left;vertical-align:top}th{background:#eef3f7}a{color:#1253a1}caption{text-align:left;padding:10px 0;font-weight:600}@media(max-width:500px){main{padding:12px}section{padding:14px}table{min-width:680px}}@media print{body{background:white}section{border:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}}</style><main>']
    for index, (heading, content) in enumerate(blocks):
        parts.append("<section><" + ("h1" if index == 0 else "h2") + ">" + e(heading) + "</" + ("h1" if index == 0 else "h2") + ">")
        for item in content:
            if isinstance(item, str):
                parts.append("<p>" + e(item) + "</p>")
            elif item["kind"] == "table":
                parts.append('<div class="scroll"><table><caption>' + e(item["caption"]) + "</caption><thead><tr>" +
                             "".join("<th>" + e(x) + "</th>" for x in item["columns"]) + "</tr></thead><tbody>")
                for row in item["rows"]:
                    parts.append("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row) + "</tr>")
                parts.append("</tbody></table></div>")
            elif item["kind"] == "links":
                parts.append("<ul>" + "".join('<li><a href="' + e(x["path"]) + '">' + e(x["title"]) + "</a></li>" for x in item["items"]) + "</ul>")
        parts.append("</section>")
    parts.append("<footer><p>TokenJunkieLabs scientific engineering · Original source and prime scientific interpretation retained.</p></footer></main></html>")
    atomic_bytes(Path(directory) / "report.html", "".join(parts).encode("utf-8"), immutable=True)
    return blocks
