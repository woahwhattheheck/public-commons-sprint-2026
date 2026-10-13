"""Write a readable study report from the maintained experiment summary."""
from __future__ import annotations

import argparse
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


def _render(summary, rows, profiles):
    total = summary["counts"]["cases"]
    completed = summary["progress"]["complete"]
    names = _aliases(profiles)
    sections = []
    sections.append(
        "<header><p class=\"eyebrow\">TokenJunkieLabs · Ecosystem Sciences</p>"
        "<h1>Upper Savannah regional study</h1>"
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
        "<p><a href=\"study-comparisons.csv\">Comparison CSV</a> · "
        "<a href=\"study-summary.json\">Study summary</a> · "
        "<a href=\"../summary.json\">Experiment summary</a> · "
        "<a href=\"../results.csv\">Experiment CSV</a></p>"
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
<title>Upper Savannah regional study</title>
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


def build(workspace, experiment_id, *, profiles=None):
    """Render only values supplied by the retained experiment engine."""
    from model import experiments
    from model.common import atomic_bytes, atomic_json, describe_file, held, identifier
    experiment_id = identifier(experiment_id)
    summary = experiments.read_summary(workspace, experiment_id)
    if summary is None:
        raise ValueError("Execute at least one case in the selected experiment before building its report")
    if summary["id"] != experiment_id or summary["workspace_id"] != workspace.project["id"]:
        raise ValueError("Select the current workspace's original experiment")
    rows = _source_rows(summary, profiles)
    directory = workspace.root / "experiments" / experiment_id / "study-report"
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
        }
        atomic_json(directory / "study-summary.json", data)
        atomic_bytes(directory / "study-comparisons.csv", _csv(rows))
        atomic_bytes(directory / "index.html", _render(summary, rows, profiles).encode("utf-8"))
        return {
            "experiment_id": experiment_id, "state": summary["state"],
            "files": {
                name: describe_file(workspace.root, directory / name)
                for name in ("index.html", "study-summary.json", "study-comparisons.csv")},
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
