#!/usr/bin/env python3
"""Build and retain the complete monitoring decision study from original run artifacts."""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import html
import importlib.metadata
import json
import shutil
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
if str(APP) not in sys.path:
    sys.path.insert(0, str(APP))
from model.chemistry_monitoring_frontier import build

TITLE = "Four-reach teaching case: monitoring budgets and missed-visit plans"
SOURCE_ID = "chemistry-monitoring-frontier-20261013"


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+"\n", encoding="utf-8")


def desc(path: Path, root: Path) -> dict:
    body = path.read_bytes()
    return {"path": path.relative_to(root).as_posix(), "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def write_csv(path: Path, rows: list[dict]) -> None:
    columns = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False, separators=(",", ":")) if isinstance(v, (dict, list)) else v for k,v in row.items()})


def flatten(row: dict, parameters: list[dict]) -> dict:
    out = {k:v for k,v in row.items() if k not in {"precision", "linearized_parameter_sd", "linearized_parameter_correlation"}}
    for par, sd in zip(parameters, row["linearized_parameter_sd"]):
        out[par["id"]+"_linearized_sd"] = sd
    for i, a in enumerate(parameters):
        for j, b in enumerate(parameters):
            if j > i:
                out[f"correlation_{a['id']}__{b['id']}"] = row["linearized_parameter_correlation"][i][j]
    return out


def fmt(value: float) -> str:
    return format(value, ".5g")


def readable(value: str) -> str:
    return {"point_load":"Point-source load", "ammonium_n":"Ammonium-N", "nitrate_n":"Nitrate-N", "fit":"Calibration fit", "holdout":"Held out of fit"}.get(value, value.replace("_", " ").capitalize())


def parameter_labels(parameters: list[dict], project: dict) -> list[dict]:
    species = {s["id"]:s["basis"] for s in project["species"]}
    answer=[]
    for p in parameters:
        kind=p["kind"]
        if kind=="reaction_rate_day":
            unit="1/day"
        else:
            groups={"load_kg_day":"loads", "boundary_mg_l":"flows", "initial_kg":"initial"}
            target=next(r for r in project[groups[kind]] if r["id"]==p["target"])
            basis=species[p.get("species",target.get("species"))]
            unit={"load_kg_day":f"kg {basis}/day", "boundary_mg_l":f"mg {basis}/L", "initial_kg":f"kg {basis}"}[kind]
        answer.append({"id":p["id"],"label":readable(p["id"]),"unit":unit})
    return answer


def sections(result: dict, calibration: dict) -> list:
    pars = result["parameters"]
    labels = parameter_labels(pars,calibration["calibrated_project"])
    at_budget = [r for r in result["cross_evaluation"] if r["assays"] == result["assay_budget"] and r["evaluation_state"] == "calibrated"]
    original = next(r for r in at_budget if r["design_state"] == "original")
    revised = next(r for r in at_budget if r["design_state"] == "calibrated")
    selected_ids = revised["candidate_ids"]
    lookup = {r["id"]:r for r in result["candidates"]}
    missed = [r for r in result["disruptions"] if r["design_state"] == "calibrated" and r["loss_kind"] == "sampling_day"]
    worst = min(missed, key=lambda r:r["interrupted"]["relative_d_criterion_to_uninterrupted"])
    finding = (f"At {result['assay_budget']} assays, the original schedule retains {100*original['relative_d_criterion_to_native_greedy']:.2f}% of the revised native-greedy D criterion when both are evaluated at the retained fitted coefficients. "
               f"The original schedule uses {original['reach_day_visits']} reach/day visits; the revised schedule uses {revised['reach_day_visits']}. Assay count and visit count are separate operational budgets.")
    risk = (f"Losing all selected assays on day {worst['lost_day']} is the most damaging date loss in the revised schedule. "
            f"The local D criterion falls to {100*worst['interrupted']['relative_d_criterion_to_uninterrupted']:.2f}% of its uninterrupted value. "
            f"A contingency planned before the campaign restores {100*worst['preplanned']['relative_d_criterion_to_uninterrupted']:.2f}%; "
            f"a decision after that day, restricted to strictly later candidates, restores {100*worst['reactive_after_day']['relative_d_criterion_to_uninterrupted']:.2f}% "
            f"with {worst['reactive_after_day']['unfilled_assay_slots']} unfilled assay slots.")
    return [
        ["What this study changes", [
            "This is the retained constructed four-reach teaching case, operated through the original reach-chemistry engine. The source observations were generated for parameter-recovery practice; model time is expressed in days. Regional agency observations and the separate headwaters InVEST demonstration keep their own identities.",
            finding, risk,
            {"kind":"table", "columns":["Parameter", "Original", "Retained fit", "Units"],
             "rows":[[label["label"],fmt(p["original"]),fmt(p["fitted"]),label["unit"]] for p,label in zip(calibration["parameters"],labels)]},
        ]],
        [f"{result['assay_budget']}-assay schedule after calibration", [
            "The original planning prior and assay errors are held fixed. This comparison changes the coefficient point estimate, not the assay budget, field data, calibration fit, or prior by adding fitting information a second time.",
            {"kind":"table", "columns":["Order", "Reach", "Day", "Species", "Assay sigma (mg/L)", "Original role"],
             "rows":[[str(i+1),readable(lookup[k]["reach"]),str(lookup[k]["day"]),readable(lookup[k]["species"]),fmt(lookup[k]["sigma_mg_l"]),readable(lookup[k].get("role","fit"))] for i,k in enumerate(selected_ids)]},
            "Fit/holdout labels are preserved from the earlier recovery exercise. Design scoring uses model sensitivities and declared assay error, not the target concentration values. No fit is repeated.",
        ]],
        ["Budget frontier and prior sensitivity", [
            f"The study contains {len(result['frontiers'])} frontier rows, covering budgets zero through {result['candidate_count']} for the original and fitted coefficient states at prior-precision multipliers 0.25, 1 and 4. A multiplier of 0.25 doubles prior standard deviations; a multiplier of 4 halves them. They are explicit sensitivity cases, not probability weights.",
            {"kind":"table", "columns":["Assays", "State", "Visits"]+[p["label"]+" SD ("+p["unit"]+")" for p in labels],
             "rows":[[str(r["assays"]),r["design_state"],str(r["reach_day_visits"])]+[fmt(x) for x in r["linearized_parameter_sd"]]
                     for r in result["frontiers"] if r["prior_multiplier"] == 1 and r["assays"] in (0,2,4,6,8,12,18,24,36)]},
            "The complete source retains each candidate selection, exact tangent, declared covariance and all equal-budget cross-evaluations. D criteria are model-dependent local design summaries. Native greedy designs are not asserted to be global optima. Local standard deviations are inverse-information planning spreads, not field confidence intervals.",
        ]],
        ["A missed date: prepare alternatives before departure", [
            "Successful or unaffected planned assays are retained. A preplanned contingency excludes the unavailable date but can choose other dates anywhere in the campaign. Reactive recovery is decided after the missed day and admits only strictly later candidate times. Earlier observations cannot be recreated by a later field visit.",
            {"kind":"table", "columns":["Lost day", "Assays lost", "Interrupted D %", "Preplanned D %", "Reactive D %", "Reactive slots unfilled"],
             "rows":[[str(r["lost_day"]),str(len(r["removed_candidate_ids"])),
                      fmt(100*r["interrupted"]["relative_d_criterion_to_uninterrupted"]),
                      fmt(100*r["preplanned"]["relative_d_criterion_to_uninterrupted"]),
                      fmt(100*r["reactive_after_day"]["relative_d_criterion_to_uninterrupted"]),
                      str(r["reactive_after_day"]["unfilled_assay_slots"])] for r in missed]},
            "The full disruption table also covers every selected reach/day visit in both original and revised schedules. It includes removed, retained, eligible and replacement candidate IDs, remaining slots, parameter spreads and information ratios. Every replacement is chosen by the existing native design_monitoring API.",
        ]],
        ["Operational interpretation", [
            "For this teaching case, preserve the revised schedule when assay count is the controlling resource, and account explicitly for its extra reach/day visit. Protect the most informative date and prepare a substitute schedule before the campaign. A later reactive decision has a smaller feasible candidate set. Select a currency or travel-cost objective only after actual costs have been supplied.",
            "The precision model assumes independent errors at the original declared sigma_mg_l. Correlated errors, unmodeled dynamics, different noise levels, unavailable travel windows, extra sampling costs and parameter uncertainty can change a design. The retained 512-draw ensemble remains available as original context; this local design study does not label it a posterior or repeat its forward solves.",
            {"kind":"links", "items":[
                {"title":"Open the offline decision explorer", "path":"index.html"},
                {"title":"Complete budget frontier CSV", "path":"frontier.csv"},
                {"title":"Equal-budget cross-evaluation CSV", "path":"cross-evaluation.csv"},
                {"title":"Every disruption and replacement CSV", "path":"disruptions.csv"},
                {"title":"Full native results and selections", "path":"result.json"},
                {"title":"Original retained four-run source bank", "path":"inputs/original-chemistry-results.source-bank.json"},
                {"title":"Rebuild and source guide", "path":"README.md"},
            ]},
        ]],
    ]


HTML = r'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Monitoring budget and recovery decisions</title>
<style>
:root{font-family:Arial,Helvetica,sans-serif;color:#202020;background:white;font-size:15px;line-height:1.5}*{box-sizing:border-box}body{margin:0}main{max-width:1220px;margin:auto;padding:36px 32px 70px}header{border-bottom:3px solid #222;padding-bottom:22px}.eyebrow{font-size:12px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase}h1{font-size:34px;line-height:1.15;max-width:900px;margin:12px 0}h2{font-size:23px;line-height:1.2;margin-top:36px}h3{font-size:17px}.lede{max-width:100ch;margin-bottom:0}.notice{border-left:3px solid #333;background:#f3f3f3;padding:14px 18px;margin:22px 0}.metrics{display:flex;gap:30px;border-bottom:1px solid #ccc;padding:20px 0;flex-wrap:wrap}.metrics strong{display:block;font-size:28px;line-height:1.2}.metrics span{font-size:13px}label{display:inline-flex;gap:8px;align-items:center;margin:8px 18px 8px 0}select,input,button{font:inherit;padding:6px;border:1px solid #777;background:white;color:#111;border-radius:2px}input[type=range]{width:250px;accent-color:#333}a{color:#222;text-decoration:underline;text-underline-offset:2px}.downloads{display:flex;gap:12px 22px;flex-wrap:wrap;margin:18px 0;font-size:13px}.table-wrap{overflow:auto;margin:15px 0}table{width:100%;border-collapse:collapse;font-size:13px;text-align:left}caption{text-align:left;font-weight:bold;font-size:15px;margin-bottom:10px}th,td{border-bottom:1px solid #ddd;vertical-align:top;padding:9px 10px;font-variant-numeric:tabular-nums}th{background:#eee}td.num{text-align:right}code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.chart{border:1px solid #ddd;margin:16px 0;padding:8px;width:100%;height:auto;display:block}.small{font-size:13px;color:#444}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.source-id{font-size:12px;overflow-wrap:anywhere}details{border-top:1px solid #ccc;margin-top:20px;padding-top:12px}summary{cursor:pointer;font-weight:bold}footer{border-top:2px solid #333;padding-top:20px;margin-top:40px}.toolbar{border-bottom:1px solid #ccc;padding-bottom:12px}h2,h3{break-after:avoid}tr{break-inside:avoid}.print-only{display:none}
@media(max-width:780px){main{padding:24px 16px}h1{font-size:27px}.grid{display:block}.metrics{gap:18px}.toolbar label{display:flex}th,td{padding:7px}}
@media print{main{max-width:none;padding:0}header{padding-bottom:12px}h1{font-size:27px}.toolbar,.downloads,button{display:none}.grid{display:block}.chart{max-height:240px}.table-wrap{overflow:visible}table{font-size:10px}h2{font-size:19px;margin-top:24px}a{color:black}details{display:block}.print-only{display:block}}
</style><main><header><div class="eyebrow">Ecosystem Sciences / Reach chemistry / Decision study</div><h1>Monitoring budgets and missed-visit plans</h1><p class="lede">How the retained calibration changes a __BUDGET__-assay schedule, and which contingency remains possible after a sampling day has passed.</p></header>
<div class="notice"><strong>Constructed four-reach teaching case.</strong> These are the original operated simulation and parameter-recovery inputs. Days are relative model times. The separate Upper Savannah field observations and headwaters InVEST demonstration retain their own source identities.</div>
<div class="metrics"><div><strong id="candidate-count"></strong><span>candidate assays</span></div><div><strong id="frontier-count"></strong><span>budget / state / prior rows</span></div><div><strong id="loss-count"></strong><span>visit and date-loss cases</span></div><div><strong id="retained-score"></strong><span>old schedule's D criterion after calibration</span></div></div>
<h2>What changed at __BUDGET__ assays</h2><p id="summary"></p><div class="table-wrap"><table><caption>Original coefficients and the retained completed fit</caption><thead><tr><th>Parameter</th><th>Original</th><th>Fitted</th><th>Units</th></tr></thead><tbody id="parameters"></tbody></table></div>
<h2>Choose the assay budget</h2><div class="toolbar"><label>Coefficient state <select id="state"><option value="calibrated">Retained fitted coefficients</option><option value="original">Original coefficients</option></select></label><label>Prior precision <select id="prior"><option value="0.25">0.25 × original</option><option value="1" selected>Original</option><option value="4">4 × original</option></select></label><label>Assays <input id="budget" type="range" min="0" max="36" value="8"><output id="budget-value">8</output></label></div><p class="small">An assay is one reach, species and day measurement. Several assays can share a field visit. Local standard deviations below are inverse-information planning spreads, expressed in each parameter's original unit.</p>
<div id="selection"></div><div id="charts"></div><div class="table-wrap"><table><caption id="schedule-caption"></caption><thead><tr><th>Order</th><th>Reach</th><th>Day</th><th>Species</th><th>Sigma, mg/L</th><th>Original role</th></tr></thead><tbody id="schedule"></tbody></table></div>
<h2>A missed visit: what can still be done?</h2><p id="risk"></p><div class="toolbar"><label>Original schedule <select id="loss-state"><option value="calibrated">Retained fitted coefficients</option><option value="original">Original coefficients</option></select></label><label>Unavailable <select id="loss-kind"><option value="sampling_day">An entire sampling day</option><option value="reach_day_visit">One reach/day visit</option></select></label></div><p class="small">All ratios use the fitted coefficient state. Preplanned alternatives can move an assay earlier in the campaign. Reactive recovery is decided after the missed day and can only use strictly later candidate days. Unaffected planned assays remain fixed.</p><div class="table-wrap"><table><caption>Information relative to the uninterrupted __BUDGET__-assay schedule</caption><thead><tr><th>Unavailable</th><th>Assays lost</th><th>Interrupted D</th><th>Preplanned D</th><th>Reactive D</th><th>Unfilled slots</th><th>Reactive replacement assays</th></tr></thead><tbody id="losses"></tbody></table></div>
<h2>Use the result without losing the operational context</h2><p id="operations"></p><p>The native design criterion is model-dependent and greedy. It is not a global optimum, field confidence interval, cost optimum or measure of predictive accuracy. The prior and independent assay-error assumptions are unchanged. Original fit/holdout roles remain attached, and the fit is not repeated.</p><p>Prior-precision multipliers of 0.25 and 4 double and halve prior standard deviations respectively. The eight-assay selections are compared at each multiplier in the complete data. Original uncertainty results retain all 512 draws; this study reuses that context without rerunning those forward simulations.</p>
<div class="downloads"><a href="frontier.csv" download>All frontier rows</a><a href="cross-evaluation.csv" download>Cross-evaluation</a><a href="disruptions.csv" download>All contingencies</a><a href="sensitivity.csv" download>Exact sensitivities</a><a href="result.json" download>Complete native results</a><a href="inputs/original-chemistry-results.source-bank.json" download>Original run source bank</a><a href="README.md">Rebuild guide</a></div>
<details><summary>Source identity and method</summary><p class="source-id" id="identity"></p><p>Selection uses the retained <code>reach_chemistry.inference.design_monitoring</code> function. Exact tangent equations are propagated by the original sparse matrix-exponential engine. The study preserves the original eight-choice order and its precision matrix before extending the complete budget and contingency course.</p><p><a href="https://www.itl.nist.gov/div898/handbook/pri/section5/pri521.htm">NIST: D-optimal designs</a> · <a href="https://www.itl.nist.gov/div898/handbook/pri/section5/pri52.htm">NIST: model-dependent design criteria</a></p></details><footer><strong>Retain the schedule, the assumptions and the contingency together.</strong><p class="small">Complete original inputs, native source, results, CSVs and a source-bound recipe accompany this offline study.</p></footer></main>
<script id="study-data" type="application/json">__DATA__</script><script>
'use strict';
const D=JSON.parse(document.getElementById('study-data').textContent),$=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number(v).toLocaleString('en-US',{maximumSignificantDigits:5}),pct=v=>(100*v).toFixed(2)+'%',cell=v=>'<td>'+esc(v)+'</td>',tr=vs=>'<tr>'+vs.map(cell).join('')+'</tr>';
const candidates=new Map(D.candidates.map(x=>[x.id,x])),pretty=v=>({'point_load':'Point-source load','ammonium_n':'Ammonium-N','nitrate_n':'Nitrate-N','fit':'Calibration fit','holdout':'Held out of fit'}[v]||String(v).replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()));
$('candidate-count').textContent=D.candidate_count;$('frontier-count').textContent=D.frontiers.length;$('loss-count').textContent=D.disruptions.length;
const old=D.cross_evaluation.find(x=>x.assays===D.assay_budget&&x.design_state==='original'&&x.evaluation_state==='calibrated'),rev=D.cross_evaluation.find(x=>x.assays===D.assay_budget&&x.design_state==='calibrated'&&x.evaluation_state==='calibrated');
$('retained-score').textContent=pct(old.relative_d_criterion_to_native_greedy);
$('summary').textContent=`The revised schedule changes ${D.assay_budget-old.candidate_ids.filter(x=>rev.candidate_ids.includes(x)).length} of ${D.assay_budget} assay choices. The original schedule retains ${pct(old.relative_d_criterion_to_native_greedy)} of the revised local D criterion when both are scored at the fitted coefficients. The original plan uses ${old.reach_day_visits} reach/day visits; the revised plan uses ${rev.reach_day_visits}.`;
$('parameters').innerHTML=D.calibration_parameters.map((p,i)=>tr([D.parameter_labels[i].label,num(p.original),num(p.fitted),D.parameter_labels[i].unit])).join('');
const worst=D.disruptions.filter(x=>x.design_state==='calibrated'&&x.loss_kind==='sampling_day').sort((a,b)=>a.interrupted.relative_d_criterion_to_uninterrupted-b.interrupted.relative_d_criterion_to_uninterrupted)[0];
$('risk').textContent=`Day ${worst.lost_day} is the revised plan's most sensitive date. Missing it leaves ${pct(worst.interrupted.relative_d_criterion_to_uninterrupted)} of the original local D criterion. A preplanned contingency retains ${pct(worst.preplanned.relative_d_criterion_to_uninterrupted)}, while a strictly later reactive replacement retains ${pct(worst.reactive_after_day.relative_d_criterion_to_uninterrupted)}.`;
$('operations').textContent=`For this teaching case, use the revised schedule when assay count is the controlling resource, allow for ${rev.reach_day_visits} separate reach/day visits, and prepare date-loss alternatives before the campaign. Protect day ${worst.lost_day}; a later decision cannot recreate earlier candidate times. Price travel and laboratory work explicitly before turning this assay frontier into a commercial field budget.`;
$('identity').textContent=`Study ${D.study_id}. Original project ${D.original_project_sha256}. Retained fit ${D.calibrated_project_sha256}. Exact native prefix matched ${D.native_agreement.original_selected_count} retained choices; largest precision entry difference ${num(D.native_agreement.maximum_precision_absolute_difference)}.`;
$('budget').max=D.candidate_count;$('budget').value=D.assay_budget;
function chart(j,state,prior,budget){const rows=D.frontiers.filter(r=>r.design_state===state&&r.prior_multiplier===prior),W=1100,H=240,L=82,R=30,T=30,B=45;const values=rows.map(r=>r.linearized_parameter_sd[j]),logmin=Math.floor(Math.log10(Math.min(...values))),logmax=Math.ceil(Math.log10(Math.max(...values)));const x=v=>L+v/D.candidate_count*(W-L-R),y=v=>T+(logmax-Math.log10(v))/(logmax-logmin||1)*(H-T-B);let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(D.parameter_labels[j].label)} local planning standard deviation by assay count"><title>${esc(D.parameter_labels[j].label)}: local planning SD by assay count</title>`;for(let e=logmin;e<=logmax;e++){let yy=y(10**e);s+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#ddd"/><text x="${L-12}" y="${yy+4}" text-anchor="end" font-size="12">${esc(num(10**e))}</text>`;}for(let t=0;t<=D.candidate_count;t+=4)s+=`<text x="${x(t)}" y="${H-18}" text-anchor="middle" font-size="12">${t}</text>`;s+=`<path d="${rows.map((r,i)=>(i?'L':'M')+x(r.assays)+','+y(r.linearized_parameter_sd[j])).join(' ')}" fill="none" stroke="#222" stroke-width="2.5"/><line x1="${x(budget)}" x2="${x(budget)}" y1="${T}" y2="${H-B}" stroke="#777" stroke-dasharray="4 4"/><text x="${L}" y="17" font-size="13" font-weight="bold">${esc(D.parameter_labels[j].label)} local SD, ${esc(D.parameter_labels[j].unit)} (log scale)</text><text x="${W-R}" y="${H-3}" text-anchor="end" font-size="12">Assay count</text></svg>`;return s;}
function update(){let state=$('state').value,prior=Number($('prior').value),budget=Number($('budget').value),r=D.frontiers.find(x=>x.design_state===state&&x.prior_multiplier===prior&&x.assays===budget);$('budget-value').textContent=budget;$('selection').innerHTML='<p><strong>'+budget+' assays · '+r.reach_day_visits+' reach/day visits · '+r.sampling_days.length+' sampling days.</strong> Local parameter SD: '+D.parameters.map((p,i)=>esc(D.parameter_labels[i].label)+' '+num(r.linearized_parameter_sd[i])+' '+esc(D.parameter_labels[i].unit)).join('; ')+'.</p>';$('charts').innerHTML=D.parameters.map((p,j)=>chart(j,state,prior,budget)).join('');$('schedule-caption').textContent=`Selected original candidate assays: ${state} coefficients, prior multiplier ${prior}`;$('schedule').innerHTML=r.candidate_ids.map((id,i)=>{const o=candidates.get(id);return tr([i+1,pretty(o.reach),o.day,pretty(o.species),num(o.sigma_mg_l),pretty(o.role||'fit')]);}).join('');}
function losses(){const rows=D.disruptions.filter(r=>r.design_state===$('loss-state').value&&r.loss_kind===$('loss-kind').value);$('losses').innerHTML=rows.map(r=>tr([r.loss_kind==='sampling_day'?'Day '+r.lost_day:pretty(r.lost_reach)+' / day '+r.lost_day,r.removed_candidate_ids.length,pct(r.interrupted.relative_d_criterion_to_uninterrupted),pct(r.preplanned.relative_d_criterion_to_uninterrupted),pct(r.reactive_after_day.relative_d_criterion_to_uninterrupted),r.reactive_after_day.unfilled_assay_slots,r.reactive_after_day.replacement_candidate_ids.map(id=>{const o=candidates.get(id);return pretty(o.reach)+' / '+pretty(o.species)+' / day '+o.day;}).join('; ')||'No later candidates'])).join('');}
for(const id of ['state','prior','budget'])$(id).addEventListener('input',update);for(const id of ['loss-state','loss-kind'])$(id).addEventListener('change',losses);update();losses();
</script></html>'''


def export(output: Path, result: dict, source_bank: Path, calibration: dict) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    inputs = output/"inputs"
    inputs.mkdir()
    shutil.copyfile(source_bank, inputs/"original-chemistry-results.source-bank.json")
    write_json(output/"result.json",result)
    write_csv(output/"frontier.csv",[flatten(r,result["parameters"]) for r in result["frontiers"]])
    write_csv(output/"cross-evaluation.csv",[flatten(r,result["parameters"]) for r in result["cross_evaluation"]])
    disruptions=[]
    for r in result["disruptions"]:
        common={k:v for k,v in r.items() if k not in {"complete","interrupted","preplanned","reactive_after_day"}}
        for stage in ("complete","interrupted","preplanned","reactive_after_day"):
            disruptions.append({**common,"stage":stage,**flatten(r[stage],result["parameters"])})
    write_csv(output/"disruptions.csv",disruptions)
    write_csv(output/"sensitivity.csv",[{"state":state,**row["observation"],"predicted_mg_l":row["predicted_mg_l"],**d}
        for state,sens in result["native_sensitivity"].items() for row in sens["rows"] for d in row["derivatives"]])
    write_csv(output/"prior-sensitivity.csv",result["prior_sensitivity_at_budget"])
    compact={k:result[k] for k in ("candidate_count","candidates","assay_budget","parameters","frontiers","cross_evaluation","disruptions","study_id","original_project_sha256","calibrated_project_sha256","native_agreement")}
    compact["calibration_parameters"]=calibration["parameters"]
    compact["parameter_labels"]=parameter_labels(result["parameters"],calibration["calibrated_project"])
    (output/"index.html").write_text(HTML.replace("__BUDGET__",str(result["assay_budget"])).replace("__DATA__",json.dumps(compact,ensure_ascii=False,separators=(",",":"),allow_nan=False).replace("<","\\u003c")),encoding="utf-8")
    source = output/"rebuild"/"application"
    for rel in ["model/chemistry_monitoring_frontier.py","source_tools/build_chemistry_monitoring_frontier.py"]:
        dest=source/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(APP/rel,dest)
    for p in (APP/"model"/"reach_chemistry").glob("*.py"):
        dest=source/"model"/"reach_chemistry"/p.name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
    (source/"model"/"__init__.py").write_text('"""Retained chemistry source for this study rebuild."""\n')
    versions={k:importlib.metadata.version(k) for k in ("numpy","scipy")}
    (output/"rebuild"/"requirements.txt").write_text("\n".join(k+"=="+v for k,v in versions.items())+"\n")
    guide=f'''# {TITLE}

This delivery extends the original constructed four-reach case with complete
assay-budget and missed-visit decisions. It retains the original twelve JSON
artifacts from four operated runs and uses the unchanged native chemistry
selector and exact tangent engine. Study ID: `{result['study_id']}`.

Open `index.html` in an ordinary browser. It is entirely offline. Choose a
coefficient state, prior multiplier and assay count. The two parameter plots,
original candidate schedule and visit counts update together. The disruption
panel separates a contingency prepared before the campaign from a response
made after a missed day. Reactive replacement candidates are strictly later
than the missing day; unfilled assay slots stay visible.

## Rebuild

Python 3 with NumPy {versions['numpy']} and SciPy {versions['scipy']} operated
this edition. The pinned dependencies are in `rebuild/requirements.txt`.
From this extracted study directory, use a NEW output path:

```sh
python rebuild/application/source_tools/build_chemistry_monitoring_frontier.py \\
  --source-bank inputs/original-chemistry-results.source-bank.json \\
  --monitoring-run 9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044 \\
  --calibration-run 6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d \\
  --output ../chemistry-frontier-rebuilt
```

The complete retained engine and this study's source are included under
`rebuild/application`. No InVEST, GIS download or repeat of the 512-draw
uncertainty run is needed. The CLI verifies each supplied source-bank member
before using it, checks original project/calibration identities, and preserves
the original eight-choice sequence and precision. Changed inputs produce a new
study ID. Existing output directories are never overwritten.

## Native scientific reports

Use the existing report composer with `chemistry-monitoring-frontier.sources.json`.
It contains one `upstate.observed-report/v1` document. That is the current typed
scientific report transport; its title, source metadata and first section
explicitly identify this as constructed teaching data. The report recipe keeps
all input hashes, full native results, source, CSVs and offline explorer together.

From a complete current application:

```sh
python source/observed-report-20261013/render.py \\
  --app-root "$PWD" --workspace ACTUAL_WORKSPACE \\
  --manifest /absolute/study/chemistry-monitoring-frontier.sources.json \\
  --output /absolute/new-scientific-report-directory
```

The returned collection/source selection can join the existing ordered
`host.openScientificReport` composer. Original chemistry report producers,
Workspace IDs, model runs and source collections remain their existing owners.

## Meaning of the quantities

An assay is a reach/species/day measurement, not a field visit or a dollar.
Both assay count and distinct reach/day visits are exported. The planning prior
precision is unchanged between the original and fitted coefficient states.
Multipliers 0.25, 1 and 4 are explicit prior-sensitivity cases. Scoring assumes
the original independent errors at declared sigma_mg_l. Candidate fit/holdout
roles are retained; the score uses sensitivities, not target concentrations.

`P = prior + J'J`, with each tangent row divided by its assay sigma.
Local parameter SD is `sqrt(diag(P^-1))` in the parameter's original unit.
Relative D criterion is `exp((logdet(P)-logdet(P_reference))/parameter_count)`.
An information-ellipsoid volume ratio is `exp(-(logdet(P)-logdet(P_reference))/2)`.
The condition number uses explicit parameter-range coordinates so unlike units
are not silently mixed. A relative criterion can exceed 1 because a native
greedy schedule is not asserted to be a global optimum.

Preplanned recovery excludes the unavailable visit/day and keeps the other
selected assays, but can use another candidate time anywhere in the campaign.
Reactive recovery retains those same unaffected planned assays and admits only
strictly later times. Each replacement comes from the existing native selector
with retained-assay precision as its starting prior. No observations at missed
or earlier times are fabricated. A last-date loss can leave slots unfilled.

D-optimality is model-dependent. These are local planning summaries, not field
confidence intervals, posterior claims or a cost-minimizing route. Actual
travel costs, correlated errors and new chemistry inputs must be supplied before
making those further decisions. See the NIST references in `observed-report.json`.

The native source originated in the maintained Commons Ecosystem Sciences
application. All original source bodies and individual SHA-256 identities are
retained in the manifest. This additive study leaves that native engine intact.
'''
    (output/"README.md").write_text(guide,encoding="utf-8")
    write_json(output/"runtime.json",{"python":sys.version,"packages":versions,"captured_at":datetime.now(timezone.utc).isoformat()})
    companions=[desc(p,output) for p in sorted(output.rglob('*')) if p.is_file()]
    recipe={"schema":"upstate.observed-report/v1","title":TITLE,"edition":result["study_id"],
            "input_kind":result["input_kind"],"inputs":companions,
            "sections":sections(result,calibration),"references":result["references"]}
    write_json(output/"observed-report.json",recipe)
    manifest={"schema":"upstate.sources/v1","title":TITLE,"captured_at":"2026-10-13",
              "entries":[{"id":SOURCE_ID,"title":TITLE,"kind":"document",**desc(output/"observed-report.json",output),
                "uri":"urn:commons:ecosystem:chemistry-monitoring-frontier:"+result["study_id"],
                "vintage":"Retained four-reach teaching case; relative model days 1 to 20; study 2026-10-13",
                "metadata":{"report_schema":"upstate.observed-report/v1","input_kind":result["input_kind"],
                            "study_id":result["study_id"],"candidate_assays":result["candidate_count"],
                            "frontier_rows":len(result["frontiers"]),"disruption_cases":len(result["disruptions"])},
                "companions":companions}]}
    write_json(output/"chemistry-monitoring-frontier.sources.json",manifest)
    return manifest


def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-bank",type=Path,required=True)
    p.add_argument("--monitoring-run",required=True)
    p.add_argument("--calibration-run",required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--budget",type=int)
    args=p.parse_args()
    if args.output.exists():
        p.error("Choose a new output directory; retained editions are not overwritten")
    bank=json.loads(args.source_bank.read_text(encoding="utf-8"))
    files=bank["files"]
    for name,text in files.items():
        metadata=bank["file_metadata"][name];body=text.encode("utf-8")
        if len(body)!=metadata["bytes"] or hashlib.sha256(body).hexdigest()!=metadata["sha256"]:
            raise ValueError("Original source bank member differs: "+name)
    def source(run,name):
        return json.loads(files[f"chemistry-runs/{run}/artifacts/{name}"])
    calibration=source(args.calibration_run,"result.json")
    result=build(source(args.monitoring_run,"project.json"),source(args.monitoring_run,"request.json"),
                 source(args.monitoring_run,"result.json"),calibration,budget=args.budget)
    result["source_runs"]={"monitoring":args.monitoring_run,"calibration":args.calibration_run}
    result["source_bank_sha256"]=hashlib.sha256(args.source_bank.read_bytes()).hexdigest()
    manifest=export(args.output,result,args.source_bank,calibration)
    print(json.dumps({"study_id":result["study_id"],"output":str(args.output.resolve()),
                      "frontier_rows":len(result["frontiers"]),"cross_evaluations":len(result["cross_evaluation"]),
                      "disruption_cases":len(result["disruptions"]),"source_companions":len(manifest["entries"][0]["companions"]),
                      "native_agreement":result["native_agreement"]},indent=2))

if __name__ == "__main__":
    main()
