"""Write a readable study report from the maintained experiment summary."""
from __future__ import annotations

import argparse
import base64
from collections import Counter
import csv
import html
import io
import json
import math
from pathlib import Path

POLLUTANTS = {
    "nitrogen_export": "Nitrogen export",
    "phosphorus_export": "Phosphorus export",
    "sediment_export": "Sediment export",
}


def _number(value, *, digits=2):
    if value is None:
        return "—"
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return "—"
    return format(value, ",." + str(digits) + "f")


def _text(value):
    return html.escape(str(value), quote=True)


def _aliases(profiles):
    result = {}
    for item in (profiles or {}).get("profiles", {}).values():
        result.setdefault(item["profile_id"], item["title"])
    baseline = (profiles or {}).get("baseline_profile_id")
    if baseline:
        result.setdefault(baseline, "Original regional source profile")
    return result


def _source_rows(summary, profiles):
    names = _aliases(profiles)
    result = []
    for row in summary["rows"]:
        if row["state"] != "complete":
            continue
        for pollutant, metric in row.get("metrics", {}).items():
            result.append({
                "profile_id": row["profile_id"],
                "profile": names.get(row["profile_id"], row["profile_title"]),
                "scenario_id": row["scenario_id"], "scenario": row["scenario_title"],
                "kind": row["kind"], "pollutant": pollutant,
                "units": metric["units"], "baseline_total": metric["baseline_total"],
                "alternative_total": metric["alternative_total"],
                "reduction": metric["reduction"], "delta": metric["delta"],
                "relative_change_pct": metric["relative_change_pct"],
                "paired_cells": metric["paired_cells"],
                "reporting_cells": metric["reporting_cells"],
                "coverage_fraction": metric["coverage_fraction"],
                "paired_area_ha": metric["paired_area_ha"],
                "support_sha256": metric["support_sha256"],
                "run_id": row["run_id"], "baseline_run_id": row["baseline_run_id"],
                "comparison_id": row.get("comparison_id"),
            })
    return result


def _csv(rows):
    columns = [
        "profile", "scenario", "kind", "pollutant", "units",
        "baseline_total", "alternative_total", "reduction", "delta",
        "relative_change_pct", "paired_cells", "reporting_cells",
        "coverage_fraction", "paired_area_ha", "support_sha256",
        "profile_id", "scenario_id", "run_id", "baseline_run_id", "comparison_id",
    ]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def _table(headers, rows, *, attributes=""):
    head = "".join("<th scope=\"col\">" + _text(name) + "</th>" for name in headers)
    body = "".join("<tr>" + "".join("<td>" + str(value) + "</td>" for value in row)
                   + "</tr>" for row in rows)
    return "<div class=\"table-wrap\"><table " + attributes + "><thead><tr>" + head + (
        "</tr></thead><tbody>" + body + "</tbody></table></div>")


def _study_sources(profiles):
    choices = list((profiles or {}).get("profiles", {}).values())
    references = [str(reference) for item in choices for reference in item.get("references", [])]
    titles = " ".join(str(item.get("title", "")) for item in choices).lower()
    selected = []
    for token, title_text, label in (
        ("10.1080/1747423X.2023.2234903", "albright", "Albright and colleagues, 2023 — Upstate biophysical coefficients"),
        ("10.1007/s00267-023-01861-6", "vickery", "Vickery and Quinn, 2023 — native parameters and spatial rules"),
        ("10.3390/land13060893", "upper flint", "Upper Flint study, 2024 — regional source alternatives"),
    ):
        if (title_text in titles or any(token in reference for reference in references)
                or (title_text == "vickery" and (profiles or {}).get("spatial_programme"))):
            selected.append("<li><a href=\"https://doi.org/" + token + "\">" + _text(label) + "</a></li>")
    return "<ul>" + "".join(selected) + "</ul>" if selected else ""


def _download_links(downloads):
    """Keep exported HTML usable independently of its original directory."""
    links = []
    for label, filename, content_type, body in downloads:
        encoded = base64.b64encode(body).decode("ascii")
        links.append(
            '<a download="' + _text(filename) + '" href="data:'
            + _text(content_type) + ';base64,' + encoded + '">'
            + _text(label) + '</a>')
    return " · ".join(links)



def _execution_section(value):
    if not value:
        return ""
    rows = []
    for model, item in value["models"].items():
        rows.append([
            _text(model.upper()), _number(item["selected_stages"], digits=0),
            _number(item["calculated_stages"], digits=0), _number(item["reused_stages"], digits=0),
            _number(item["pending_stages"], digits=0),
            _number(item["native_elapsed_seconds"]) + " (" + str(item["native_timed_stages"]) + " timed)",
            _number(item["reuse_elapsed_seconds"]) + " (" + str(item["reuse_timed_stages"]) + " timed)",
            _number(item["transfer_logical_bytes"], digits=0)
            + " (" + str(item["transfer_measured_stages"]) + " measured; "
            + str(item["transfer_unknown_stages"]) + " unknown)",
        ])
    return (
        '<section><h2>Actual execution and reuse</h2>'
        '<p>Recorded at ' + _text(value["observed_at"]) + '. '
        + _number(value["materialized_cases"], digits=0) + ' materialized cases from '
        + _number(value["planned_cases"], digits=0) + ' planned; '
        + _number(value["read_runs"], digits=0) + ' distinct native run records read.</p>'
        + _table(["Model", "Selected stages", "Calculated", "Reused", "Pending",
                  "Local native seconds", "Reuse seconds", "Recorded transfer bytes"], rows)
        + '<p class="definition">Native time excludes inherited donor time. Totals cover the '
        'stages with recorded timestamps; unknown timings remain empty. Retained outputs contain '
        + _number(value["output_files"], digits=0) + ' distinct run/path files and '
        + _number(value["output_logical_bytes"], digits=0) + ' logical bytes. '
        'Logical lengths describe retained contents; physical allocation depends on compression '
        'and file-copy methods. The execution CSV retains each original run and donor.</p></section>')


def _decision_section(value):
    if not value or not value.get("pairs"):
        return ""
    pairs, ranges = [], []
    for pair in value["pairs"]:
        pairs.append([
            _text(pair["a_scenario"]), _text(pair["b_scenario"]),
            _text(pair["response"]),
            str(pair["compared_profiles"]) + " / " + str(pair["expected_profiles"]),
            "Complete selected cohort" if pair["complete"] else "Partial selected cohort",
        ])
        for group in pair["support_groups"]:
            ranges.append([
                _text(pair["a_scenario"]), _text(pair["b_scenario"]),
                _text(POLLUTANTS.get(group["pollutant"], group["pollutant"])),
                _text(group["units"]),
                _number(group["minimum_a_advantage"]) + " to " + _number(group["maximum_a_advantage"]),
                str(len(group["profile_ids"])),
                _number(group["paired_cells"], digits=0),
                '<code title="' + _text(group["support_sha256"]) + '">'
                + _text(group["support_sha256"][:12]) + '</code>',
            ])
    return (
        '<section><h2>Compare the management alternatives</h2>'
        '<p>An alternative dominates when at least one selected pollutant export is lower '
        'and all others are equal or lower. Each comparison uses the same coefficient profile, '
        'baseline and identical valid cells for each pollutant. Nutrient and sediment units remain separate.</p>'
        + _table(["Alternative A", "Alternative B", "Observed ordering", "Compared profiles", "Coverage"], pairs)
        + '<details><summary>Annual differences on matching cell support</summary>'
        '<p>Positive A advantage means A exports less than B. Ranges group only profiles with '
        'the same valid-cell support and annual units. Exact differences and run identities are in the CSV.</p>'
        + _table(["A", "B", "Export", "Units", "A advantage range", "Profiles", "Paired cells", "Cell support"], ranges)
        + '</details></section>')


def _interpretation_section(value):
    if not value:
        return ""
    sources = {row["profile_id"]: row for row in value["table_sources"]}
    rows = []
    for row in value["profiles"]:
        source = sources.get(row["profile_id"], {})
        checksum = source.get("sha256", "")
        rows.append([
            _text(row["title"]), str(row["class_count"]), str(row["changed_coefficient_cells"]),
            str(row["changed_native_parameters"]),
            '<code title="' + _text(checksum) + '">' + _text(checksum[:12]) + '</code>',
        ])
    content = (
        '<section><h2>How the selected sources change the calculation</h2>'
        '<p>These counts come from the exact coefficient tables and native settings retained '
        'with the selected profiles. Changes are relative to this experiment’s original baseline profile.</p>'
        + _table(["Actual profile", "Land-cover classes", "Changed table cells",
                  "Changed native settings", "Table identity"], rows))
    if value["native_parameter_changes"]:
        content += (
            '<details><summary>Changed native settings</summary>'
            + _table(["Profile", "Model", "Setting", "Baseline", "Alternative"], [
                [_text(row["profile"]), _text(row["model"].upper()), _text(row["parameter"]),
                 _text(row["baseline"]), _text(row["alternative"])]
                for row in value["native_parameter_changes"]]) + '</details>')
    if value["transitions"]:
        def loading(row, constituent):
            return " → ".join(
                _number(row["load_" + constituent + "_" + side], digits=3)
                + " (" + _text(row["load_type_" + constituent + "_" + side] or "basis unknown") + ")"
                for side in ("before", "after"))
        content += (
            '<details><summary>Coefficients for the actual mapped land-cover changes</summary>'
            '<p>Loading columns are local coefficients in kg/ha/year. C × P is the dimensionless '
            'local erosion multiplier. Each loading value retains its published basis; load differences '
            'are calculated only between matching known bases. Routed annual export also depends on runoff, terrain, '
            'soil, connectivity and downslope retention. Compare these source differences with '
            'the completed native effects below.</p>'
            + _table(["Profile", "Alternative", "Class change", "Changed ha",
                      "N load before → after", "P load before → after", "C × P before → after"], [
                [_text(row["profile"]), _text(row["scenario"]),
                 str(row["from_lucode"]) + " → " + str(row["to_lucode"]),
                 _number(row["changed_area_ha"]),
                 loading(row, "n"),
                 loading(row, "p"),
                 _number(row["usle_cp_before"], digits=6) + " → " + _number(row["usle_cp_after"], digits=6)]
                for row in value["transitions"]]) + '</details>')
    return content + (
        '<p class="definition">The source CSVs retain every changed coefficient, its loading basis, '
        'native setting, actual transition count and profile/run identity. Retention and routing '
        'changes can alter downstream exports beyond the changed land-cover cells.</p></section>')


def _published_context(interpretation):
    """Retain the existing source study package when this study uses that lineage."""
    used = any(source["sha256"] == "b2b5778c5d8c71b2b0c6db370f29a60e987d1be3d491cec91493a0b975b8b9e4"
               for source in interpretation["table_sources"])
    references = json.dumps([row["references"] for row in interpretation["profiles"]], ensure_ascii=False)
    used = used or any(doi in references for doi in (
        "10.1080/1747423X.2023.2234903", "10.1007/s00267-023-01861-6", "10.3390/land13060893"))
    if not used:
        return {}
    from model.common import file_digest
    root = Path(__file__).resolve().parents[1]
    manifest = root / "source/regional-studies-20261013/coefficient-comparison-manifest.json"
    if not manifest.is_file():
        return {}
    value = json.loads(manifest.read_text(encoding="utf-8"))
    if value.get("schema") != "upstate.published-coefficient-comparison/v1":
        raise ValueError("Select the maintained published coefficient interpretation")
    allowed = {
        "source/regional-studies-20261013/COEFFICIENT_INTERPRETATION.md":
            ("Published source interpretation", "text/markdown"),
        "source/regional-studies-20261013/coefficient-comparison.csv":
            ("Published coefficient comparison", "text/csv"),
        "source/regional-studies-20261013/transition-coefficients.csv":
            ("Published transition coefficients", "text/csv"),
    }
    result = {}
    for name, (label, mime) in allowed.items():
        item = value["files"][name]
        path = root / name
        if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
            raise ValueError("Published coefficient interpretation changed: " + name)
        result[path.name] = (label, mime, path.read_bytes())
    result[manifest.name] = ("Published source manifest", "application/json", manifest.read_bytes())
    return result


def _render(summary, rows, profiles, *, downloads=(), execution=None, decisions=None, interpretation=None):
    total = summary["counts"]["cases"]
    completed = summary["progress"]["complete"]
    names = _aliases(profiles)
    title = str(summary.get("title") or "Scientific watershed study")
    sections = []
    sections.append(
        "<header><p class=\"eyebrow\">TokenJunkieLabs · Ecosystem Sciences</p>"
        "<h1>" + _text(title) + "</h1>"
        "<p>Published source alternatives and land-cover scenarios, calculated through "
        "the selected native InVEST models.</p></header>")
    sections.append(
        "<section aria-labelledby=\"status\"><h2 id=\"status\">Programme status</h2>"
        "<div class=\"status-grid\"><div><span>Completed cases</span><strong>"
        + str(completed) + " / " + str(total)
        + "</strong></div><div><span>Execution</span><strong>"
        + _text(summary["state"])
        + "</strong></div><div><span>Scientific profiles</span><strong>"
        + str(summary["counts"]["profiles"])
        + "</strong></div><div><span>Summary updated</span><strong class=\"time\">"
        + _text(summary["generated_at"])
        + "</strong></div></div>"
        "<p class=\"definition\">Reduction means baseline export minus alternative export. "
        "Positive reductions represent lower modeled export. Each land-cover alternative "
        "is paired with the baseline using the same coefficient profile. Percent change "
        "uses alternative minus baseline.</p></section>")
    sections.extend((_execution_section(execution), _interpretation_section(interpretation)))
    spatial = (profiles or {}).get("spatial_programme", {})
    if spatial.get("scenarios"):
        values = []
        for item in spatial["scenarios"].values():
            statistics = item["statistics"]
            values.append([
                _text(item["title"]),
                _number(statistics["converted_cells"], digits=0),
                _number(statistics.get("converted_area_ha")),
                _text(", ".join(
                    str(t["from_code"]) + " → " + str(t["to_code"])
                    + ": " + format(t["cells"], ",")
                    for t in statistics.get("transitions", []))),
            ])
        sections.append(
            "<section><h2>Actual land-cover changes</h2>"
            "<p>The retained reporting area supplies the forest-area denominator and management "
            "eligibility. Native hydrology retains the full contributing domain and upstream context.</p>"
            + _table(["Alternative", "Changed cells", "Changed area (ha)", "Class transitions"], values)
            + "</section>")
    envelopes = []
    for item in summary.get("sensitivity", []):
        for pollutant, sensitivity in item["pollutants"].items():
            for group in sensitivity["support_groups"]:
                lower = group["minimum_reduction"]
                upper = group["maximum_reduction"]
                envelopes.append([
                    _text(item["scenario_title"]),
                    _text(POLLUTANTS.get(pollutant, pollutant)),
                    _text(group["units"]),
                    _number(lower) + " to " + _number(upper),
                    _text(str(len(group["profile_ids"])) + " / " + str(item["expected_profiles"])),
                    _number(group["paired_cells"], digits=0),
                    _text(group["response"]),
                    "<code title=\"" + _text(group["support_sha256"]) + "\">"
                    + _text(group["support_sha256"][:12]) + "</code>",
                ])
    if envelopes:
        sections.append(
            "<section><h2>Response across source profiles</h2>"
            "<p>Ranges come directly from the experiment engine. Profiles appear in the same "
            "range only when their paired valid cells match exactly. Separate support groups "
            "remain separate rows. These ranges describe the selected source choices.</p>"
            + _table(["Alternative", "Export", "Units", "Reduction range", "Profiles",
                      "Paired cells", "Response", "Cell support"], envelopes)
            + "</section>")
    sections.append(_decision_section(decisions))
    sections.append(
        "<section><h2>Completed native comparisons</h2>"
        "<div class=\"controls\"><label for=\"profile\">Profile <select id=\"profile\">"
        "<option value=\"\">All profiles</option></select></label>"
        "<label for=\"scenario\">Alternative <select id=\"scenario\">"
        "<option value=\"\">All alternatives</option></select></label>"
        "<label for=\"pollutant\">Export <select id=\"pollutant\">"
        "<option value=\"\">All exports</option></select></label>"
        "<label for=\"search\">Find <input id=\"search\" type=\"search\" placeholder=\"Filter rows\"></label>"
        "<button id=\"reset\" type=\"button\">Reset filters</button></div>"
        "<p id=\"visible\" role=\"status\" aria-live=\"polite\"></p>"
        "<div class=\"table-wrap\"><table id=\"comparisons\"><thead><tr>"
        + "".join("<th scope=\"col\">" + name + "</th>" for name in
                  ["Profile", "Alternative", "Export", "Baseline", "Alternative",
                   "Reduction", "Change (%)", "Coverage (%)"])
        + "</tr></thead><tbody></tbody></table></div>"
        "<p class=\"definition\">Totals apply to paired valid cells inside the reporting area. "
        "Coverage is paired cells divided by reporting cells. Annual units are shown beside each "
        "export. The CSV retains full run and cell-support identities.</p></section>")
    pending = []
    for row in summary["rows"]:
        if row["state"] == "complete":
            continue
        pending.append([
            _text(names.get(row["profile_id"], row["profile_title"])),
            _text(row["scenario_title"]), _text(row["state"]),
            "<code>" + _text(row["run_id"]) + "</code>",
        ])
    if pending:
        sections.append(
            "<section><h2>Cases in progress</h2>"
            + _table(["Profile", "Alternative", "State", "Native run"], pending)
            + "</section>")
    sections.append(
        "<section><h2>Files and methods</h2>"
        "<p>" + _download_links(downloads) + "</p>"
        "<p>The selected profile definitions retain their published coefficients and references. "
        "Native scenario allocation and its regional placement choices are retained with "
        "each actual scenario source.</p>"
        + _study_sources(profiles)
        + 
        "<details><summary>Selected model identities</summary><dl>"
        "<dt>Workspace</dt><dd><code>" + _text(summary["workspace_id"])
        + "</code></dd><dt>Grid</dt><dd><code>" + _text(summary["grid_id"])
        + "</code></dd><dt>Experiment</dt><dd><code>" + _text(summary["id"])
        + "</code></dd></dl></details></section>")
    data = json.dumps(
        {"rows": rows, "pollutants": POLLUTANTS},
        ensure_ascii=False, allow_nan=False).replace("<", "\\u003c")
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + _text(title) + """</title>
<style>
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#171717;background:#fff}
*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}
header{border-bottom:2px solid #222;padding-bottom:20px}h1{font-size:28px;letter-spacing:-.3px;margin:8px 0}
h2{font-size:19px;margin:0 0 14px}p{line-height:1.5;max-width:100ch;margin:10px 0}
.eyebrow{font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:#555}
section{padding:26px 0;border-bottom:1px solid #ddd}.status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #ccc}
.status-grid>div{padding:18px;border-right:1px solid #ddd}.status-grid>div:last-child{border:0}
.status-grid span{display:block;color:#555;font-size:12px;margin-bottom:8px}.status-grid strong{font-size:24px}.status-grid .time{font-size:14px}
.definition{font-size:13px;color:#4b4b4b}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #ddd;vertical-align:top}th{background:#f4f4f4;font-weight:600}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tbody tr:hover{background:#f7f7f7}
td:first-child{min-width:160px}code{font-size:11px;overflow-wrap:anywhere}a{color:#222;text-decoration:underline}
.controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:12px 0}.controls label{display:grid;gap:5px;font-size:12px}
select,input,button{font:inherit;padding:9px;border:1px solid #999;border-radius:2px;background:#fff;color:#171717;max-width:330px}
button{cursor:pointer}button:hover{background:#eee}select:focus,input:focus,button:focus{outline:2px solid #222;outline-offset:2px}
#visible{font-size:12px;color:#555}details{margin-top:16px}summary{cursor:pointer;font-weight:bold}dd{margin:5px 0 12px}
@media(max-width:760px){main{padding:18px}.status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.status-grid>div:nth-child(2){border-right:0}h1{font-size:24px}.controls label{width:100%}select,input{max-width:none;width:100%}}
@media print{main{padding:0}.controls{display:none}section{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:9px}a{color:#000}}
</style></head><body><main>""" + "".join(sections) + """</main>
<script type="application/json" id="study-data">""" + data + """</script>
<script>
"use strict";
const payload=JSON.parse(document.getElementById("study-data").textContent);
const rows=payload.rows, labels=payload.pollutants;
const fields=["profile","scenario","pollutant"];
const number=v=>typeof v==="number"&&Number.isFinite(v)?v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
for(const field of fields){
 const values=[...new Set(rows.map(r=>r[field]))].sort();
 const select=document.getElementById(field);
 for(const value of values){const option=document.createElement("option");option.value=value;option.textContent=field==="pollutant"?(labels[value]||value):value;select.append(option);}
 select.addEventListener("change",render);
}
function render(){
 const query=document.getElementById("search").value.trim().toLowerCase();
 const chosen=rows.filter(row=>fields.every(field=>!document.getElementById(field).value||row[field]===document.getElementById(field).value)
  &&(!query||[row.profile,row.scenario,labels[row.pollutant]||row.pollutant].some(value=>value.toLowerCase().includes(query))));
 const body=document.querySelector("#comparisons tbody"),fragment=document.createDocumentFragment();
 for(const row of chosen){
  const tr=document.createElement("tr");
  const cells=[row.profile,row.scenario,(labels[row.pollutant]||row.pollutant)+" ("+row.units+")",
   number(row.baseline_total),number(row.alternative_total),number(row.reduction),
   number(row.relative_change_pct),number(row.coverage_fraction===null?null:100*row.coverage_fraction)];
  cells.forEach((value,index)=>{const td=document.createElement("td");td.textContent=value;if(index>2)td.className="num";tr.append(td);});
  fragment.append(tr);
 }
 body.replaceChildren(fragment);
 document.getElementById("visible").textContent=chosen.length+" of "+rows.length+" completed export comparisons";
}
document.getElementById("search").addEventListener("input",render);
document.getElementById("reset").addEventListener("click",()=>{for(const field of fields)document.getElementById(field).value="";document.getElementById("search").value="";render();});
render();
</script></body></html>
"""



def _retained_profiles(workspace, scope, experiment_id):
    """Recover the original report context from this received experiment."""
    from model.common import digest, read_json, verify_file
    context = scope / "study-report-context.json"
    if context.exists() or context.is_symlink():
        if context.is_symlink() or not context.is_file():
            raise ValueError("The retained study report context must be an original file.")
        value = read_json(context)
        payload = {name: item for name, item in value.items() if name != "id"}
        if (value.get("schema") != "upstate.study-report-context/v1"
                or value.get("experiment_id") != experiment_id
                or value.get("workspace_id") != workspace.project["id"]
                or value.get("id") != digest(payload)
                or not isinstance(value.get("source_profiles"), dict)):
            raise ValueError("The retained study report context differs from this experiment.")
        return value["source_profiles"]
    marker_path = scope / "study-report.json"
    if not marker_path.exists() and not marker_path.is_symlink():
        return None
    if marker_path.is_symlink() or not marker_path.is_file():
        raise ValueError("The retained study report marker must be an original file.")
    marker = read_json(marker_path)
    if (marker.get("schema") != "upstate.study-report-downloads/v1"
            or marker.get("experiment_id") != experiment_id
            or marker.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The retained study report belongs to another experiment.")
    descriptors = [
        item for item in marker.get("files", {}).values()
        if isinstance(item, dict) and item.get("path") == "study-report/study-summary.json"
    ]
    if len(descriptors) != 1:
        raise ValueError("Retain the original study summary before rebuilding its report.")
    previous = read_json(verify_file(scope, descriptors[0]))
    if (previous.get("schema") != "upstate.published-study-report/v1"
            or previous.get("experiment_id") != experiment_id
            or previous.get("workspace_id") != workspace.project["id"]
            or previous.get("experiment_summary", {}).get("sha256") != marker.get("summary_sha256")
            or not isinstance(previous.get("source_profiles"), dict)):
        raise ValueError("The original study summary differs from its retained report marker.")
    return previous["source_profiles"]


def refresh_existing(workspace, experiment_id):
    """Refresh an existing complete study report after summary publication."""
    from model.common import identifier
    experiment_id = identifier(experiment_id)
    scope = workspace.root / "experiments" / experiment_id
    if not any((scope / name).exists() or (scope / name).is_symlink() for name in
               ("study-report-context.json", "study-report.json")):
        return None
    try:
        return build(workspace, experiment_id)
    except Exception as error:
        raise RuntimeError(
            "The saved experiment summary and native run artifacts remain retained. "
            "Refreshing the complete study report failed: " + str(error)
        ) from error


def build(workspace, experiment_id, *, profiles=None):
    """Render values from one locked summary and register the retained outputs."""
    from model import experiments, study_decisions, study_execution, study_interpretation
    from model.common import atomic_bytes, atomic_json, describe_file, digest, held, identifier, verify_file
    experiment_id = identifier(experiment_id)
    scope = workspace.root / "experiments" / experiment_id
    # The same lock guards summary publication in the experiment engine and
    # generic operator report. A marker therefore names one complete snapshot.
    with held(scope / ".experiment.lock", blocking=False):
        summary = experiments.read_summary(workspace, experiment_id)
        if summary is None:
            raise ValueError("Execute at least one case in the selected experiment before building its report")
        if summary["id"] != experiment_id or summary["workspace_id"] != workspace.project["id"]:
            raise ValueError("Select the current workspace's original experiment")
        summary_source = describe_file(scope, scope / "summary.json")
        if profiles is None:
            profiles = _retained_profiles(workspace, scope, experiment_id)
        if profiles is not None and not isinstance(profiles, dict):
            raise ValueError("The study report programme context must be an object.")
        rows = _source_rows(summary, profiles)
        execution = study_execution.collect(workspace, summary)
        decisions = study_decisions.analyse(summary)
        interpretation = study_interpretation.collect(workspace, summary, profiles=profiles)
        published_context = _published_context(interpretation)
        context = {
            "schema": "upstate.study-report-context/v1",
            "experiment_id": experiment_id, "workspace_id": workspace.project["id"],
            "source_profiles": profiles or {},
        }
        # Retain validated source context before replacing report bodies. This
        # survives interrupted rendering and the ordinary complete-study archive.
        atomic_json(scope / "study-report-context.json", {**context, "id": digest(context)})
        directory = scope / "study-report"
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".report.lock", blocking=False):
            data = {
                "schema": "upstate.published-study-report/v1",
                "experiment_id": experiment_id, "workspace_id": workspace.project["id"],
                "grid_id": summary["grid_id"], "state": summary["state"],
                "generated_at": summary["generated_at"], "comparisons": rows,
                "counts": summary["counts"], "progress": summary["progress"],
                "materialized_case_states": dict(Counter(row["state"] for row in summary["rows"])),
                "sensitivity": summary.get("sensitivity", []),
                "source_profiles": profiles or {},
                "title": summary.get("title") or "Scientific watershed study",
                "execution": execution, "alternative_comparisons": decisions,
                "source_interpretation": interpretation,
                "experiment_summary": summary_source,
            }
            atomic_json(directory / "study-summary.json", data)
            retained = {
                "study-summary.json": (
                    "Study summary", "application/json",
                    (directory / "study-summary.json").read_bytes()),
                "study-comparisons.csv": (
                    "Study comparison CSV", "text/csv", _csv(rows)),
                "study-execution.csv": (
                    "Study execution CSV", "text/csv", study_execution.csv_bytes(execution)),
                "study-alternative-comparisons.csv": (
                    "Alternative comparison CSV", "text/csv", study_decisions.csv_bytes(decisions)),
                "study-source-coefficients.csv": (
                    "Actual source coefficient CSV", "text/csv",
                    study_interpretation.coefficient_csv(interpretation)),
                "study-native-parameters.csv": (
                    "Actual native parameter CSV", "text/csv",
                    study_interpretation.parameter_csv(interpretation)),
                "study-landcover-transitions.csv": (
                    "Actual land-cover transition CSV", "text/csv",
                    study_interpretation.transition_csv(interpretation)),
                **published_context,
            }
            for name, (_, _, body) in retained.items():
                if name != "study-summary.json":
                    atomic_bytes(directory / name, body)
            # Every link embeds its exact retained bytes, so downloaded HTML
            # remains usable independently of its original directory.
            downloads = [(label, name, mime, body)
                         for name, (label, mime, body) in retained.items()]
            downloads.append(
                ("Experiment summary", "experiment-summary.json", "application/json",
                 verify_file(scope, summary_source).read_bytes()))
            experiment_csv = summary.get("files", {}).get("csv")
            if experiment_csv is not None:
                downloads.append(
                    ("Experiment CSV", "experiment-results.csv", "text/csv",
                     verify_file(scope, experiment_csv).read_bytes()))
            atomic_bytes(directory / "index.html",
                         _render(summary, rows, profiles, downloads=downloads,
                                 execution=execution, decisions=decisions,
                                 interpretation=interpretation).encode("utf-8"))
            labels = {"index.html": "Study report",
                      **{name: item[0] for name, item in retained.items()}}
            files = {name: describe_file(workspace.root, directory / name) for name in labels}
            marker = {
                "schema": "upstate.study-report-downloads/v1",
                "experiment_id": experiment_id, "workspace_id": workspace.project["id"],
                "summary_sha256": summary_source["sha256"],
                "summary": summary_source, "generated_at": summary["generated_at"],
                "execution_observed_at": execution["observed_at"],
                "files": {
                    label: {**files[name], "path": "study-report/" + name}
                    for name, label in labels.items()},
            }
            # Publish the marker after every complete file. The operator's
            # existing download tickets verify their exact lengths and hashes.
            atomic_json(scope / "study-report.json", marker)
            return {
                "experiment_id": experiment_id, "state": summary["state"],
                "summary_sha256": summary_source["sha256"], "files": files,
            }

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--programme-result", type=Path)
    args = parser.parse_args(argv)
    from model.common import read_json
    from model.workspace import Workspace
    result = build(
        Workspace(args.workspace), args.experiment,
        profiles=read_json(args.programme_result) if args.programme_result else None)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
