"""Read-only comparison of two exact saved Sampling designs.

TokenJunkieLabs. Original plans, observations and requests remain authoritative.
No solver, new Workspace record, source rewrite or scientific execution.
"""
from __future__ import annotations

import copy
import csv
import io
import json
from html import escape

from .common import identifier
from .monitoring_common import ContractError, digest
from . import monitoring_recommendations as recommendations
from .monitoring_workspace import MonitoringWorkspace

SCHEMA = "upstate.sampling-design-comparison/v1"


def _changes(left, right, path=()):
    if isinstance(left, dict) and isinstance(right, dict):
        rows = []
        for key in sorted(set(left) | set(right)):
            here = path + (key,)
            if key not in left or key not in right:
                rows.append({"path": list(here),
                             "left": {"present": key in left, **({"value": copy.deepcopy(left[key])} if key in left else {})},
                             "right": {"present": key in right, **({"value": copy.deepcopy(right[key])} if key in right else {})}})
            else:
                rows.extend(_changes(left[key], right[key], here))
        return rows
    if type(left) is not type(right) or left != right:
        return [{"path": list(path), "left": {"present": True, "value": copy.deepcopy(left)},
                 "right": {"present": True, "value": copy.deepcopy(right)}}]
    return []


def _visits(plan):
    calendar = plan.get("calendar")
    if calendar is None:
        return {}
    if not isinstance(calendar, dict):
        raise ContractError("The retained native calendar is malformed")
    rows = calendar.get("visits", [])
    if not isinstance(rows, list):
        raise ContractError("The retained native calendar has no complete visits array")
    result = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("visit_key"), str):
            raise ContractError("The retained native calendar has an invalid visit identity")
        if row["visit_key"] in result:
            raise ContractError("The retained native calendar repeats a visit identity")
        result[row["visit_key"]] = copy.deepcopy(row)
    return result


def _side(design, plan):
    return {"design_id": design["id"], "design_digest": digest(design),
            "plan_id": plan["id"], "plan_digest": digest(plan),
            "title": plan.get("title"), "status": design["status"],
            "configuration": copy.deepcopy(design["configuration"]),
            "native_cost": copy.deepcopy(design.get("native_cost")),
            "selected_ids": copy.deepcopy(plan.get("selected_ids", [])),
            "calendar": copy.deepcopy(plan.get("calendar")),
            "target_calendar": copy.deepcopy(design["target_calendar"])}


def compare(workspace, *, recommendation_id, left_design_id, right_design_id):
    """Verify both originals and return a deterministic, downloadable comparison."""
    recommendation_id = identifier(recommendation_id)
    left_design_id, right_design_id = identifier(left_design_id), identifier(right_design_id)
    if left_design_id == right_design_id:
        raise ContractError("Choose two distinct retained Sampling designs")
    proposal = recommendations.inspect(workspace, recommendation_id)
    left = recommendations.inspect_design(workspace, left_design_id)
    right = recommendations.inspect_design(workspace, right_design_id)
    if any(row["recommendation_id"] != recommendation_id for row in (left, right)):
        raise ContractError("Compare designs from the same exact saved Sampling recommendation")
    service = MonitoringWorkspace(workspace)
    plans = [service.get("plans", row["plan_id"]) for row in (left, right)]
    for design, plan in zip((left, right), plans):
        if digest(plan) != design["plan_digest"]:
            raise ContractError("A retained native plan changed during comparison")
    visit_maps = [_visits(plan) for plan in plans]
    visits = []
    for key in sorted(set(visit_maps[0]) | set(visit_maps[1])):
        a, b = visit_maps[0].get(key), visit_maps[1].get(key)
        visits.append({"visit_key": key, "left": a, "right": b,
                       "state": "added" if a is None else "removed" if b is None else "unchanged" if a == b else "changed"})
    targets, monthly = [], []
    for original in proposal["targets"]:
        target = original["target"]
        if not target["included"]:
            continue
        target_id = original["target_id"]
        calendar_rows = []
        for design, mapping in zip((left, right), visit_maps):
            matches = [item for item in design["target_calendar"] if item["target_id"] == target_id]
            if len(matches) != 1:
                raise ContractError("The exact target has no unique retained design calendar")
            bound = matches[0]
            if any(key not in mapping for key in bound["visit_keys"]):
                raise ContractError("A retained target refers to a missing native calendar visit")
            selected = [mapping[key] for key in bound["visit_keys"]]
            calendar_rows.append({"binding": copy.deepcopy(bound), "visits": copy.deepcopy(selected),
                                  "distinct_planned_dates": sorted({row["date"] for row in selected})})
        targets.append({"target_id": target_id, "target": copy.deepcopy(target),
                        "station": copy.deepcopy(original["station"]), "cohort": copy.deepcopy(original["cohort"]),
                        "historical_evidence": copy.deepcopy(original["evidence"]),
                        "target_cost": copy.deepcopy(original["cost"]),
                        "left": calendar_rows[0], "right": calendar_rows[1]})
        for historic in original["evidence"]["monthly"]:
            month = historic["month"]
            by_side = []
            for row in calendar_rows:
                selected = [v for v in row["visits"] if int(v["date"][5:7]) == month]
                by_side.append({"visits": len(selected), "distinct_dates": sorted({v["date"] for v in selected})})
            monthly.append({"target_id": target_id, "station_id": target["station_id"],
                            "cohort_id": target["cohort_id"], "month": month,
                            "historical": copy.deepcopy(historic), "left": by_side[0], "right": by_side[1]})
    sides = [_side(design, plan) for design, plan in zip((left, right), plans)]
    costs = [side["native_cost"] for side in sides]
    comparable = (all(isinstance(cost, dict) and type(cost.get("total_cents")) is int for cost in costs)
                  and isinstance(costs[0].get("currency"), str) and bool(costs[0]["currency"])
                  and costs[0]["currency"] == costs[1].get("currency"))
    value = {"schema": SCHEMA, "project_id": workspace.project["id"],
             "recommendation_id": recommendation_id, "recommendation_digest": digest(proposal),
             "context_id": proposal["context_id"], "network_id": proposal["network_id"],
             "title": proposal["title"] + " — saved design comparison",
             "left": sides[0], "right": sides[1],
             "configuration_changes": _changes(left["configuration"], right["configuration"]),
             "visits": visits, "targets": targets, "monthly": monthly,
             "geographic_cost_difference": {
                 "comparable": comparable,
                 "currency": costs[0].get("currency") if comparable else None,
                 "right_minus_left_cents": costs[1]["total_cents"] - costs[0]["total_cents"] if comparable else None,
                 "reason": "Same recorded currency and complete native geographic costs." if comparable
                           else "One native geographic cost is unavailable or currencies differ; no delta calculated."},
             "proposal_budget": copy.deepcopy(proposal["budget"]),
             "historical_window": {"start": proposal["selection"]["evidence_start"],
                                   "end": proposal["selection"]["evidence_end"]},
             "interpretation": [
                 "Both alternatives retain the same recommendation, original observations and target definitions.",
                 "Calendar dates are planned source-catchment opportunities under the original proposed station binding. Field events, analytical suitability and flow conditions require actual measurements.",
                 "Historical date counts and gaps refer to the unchanged evidence window; the future calendar allocates later sampling opportunities.",
                 "Geographic costs and itemized target costs remain separate authored estimates, with unknown laboratory or target prices displayed explicitly."],
             "originals": {"recommendation": copy.deepcopy(proposal),
                           "designs": [copy.deepcopy(left), copy.deepcopy(right)],
                           "plans": copy.deepcopy(plans)}}
    value["id"] = digest(value)
    return value


def _text(value):
    if value is None:
        return "Unknown"
    return json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value)


def _money(cost):
    if not isinstance(cost, dict) or type(cost.get("total_cents")) is not int:
        return "Unknown"
    value = cost["total_cents"]
    return str(cost.get("currency", "")) + " " + ("-" if value < 0 else "") + str(abs(value) // 100) + "." + str(abs(value) % 100).zfill(2)


def _table(headings, rows):
    return "<div class='table-wrap'><table><thead><tr>" + "".join("<th scope='col'>" + escape(str(h)) + "</th>" for h in headings) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + escape(_text(cell)) + "</td>" for cell in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def report_html(value):
    a, b = value["left"], value["right"]
    target_labels = {row["target_id"]: recommendations._label(row["cohort"]["fields"]) for row in value["targets"]}
    titles = ["Saved result", a["title"] or "Left design", b["title"] or "Right design"]
    content = "<h1>" + escape(value["title"]) + "</h1><p>TokenJunkieLabs · retained Monitoring plans</p>"
    content += _table(titles, [
        ["Native outcome", a["status"], b["status"]],
        ["Geographic cost", _money(a["native_cost"]), _money(b["native_cost"])],
        ["Selected catchments", len(a["selected_ids"]), len(b["selected_ids"])],
        ["Physical planned visits", len((a["calendar"] or {}).get("visits", [])), len((b["calendar"] or {}).get("visits", []))]])
    delta = value["geographic_cost_difference"]
    delta_text = _money({"currency": delta["currency"], "total_cents": delta["right_minus_left_cents"]}) if delta["comparable"] else "Unavailable"
    content += "<p>Geographic cost difference, right minus left: " + escape(delta_text) + ". " + escape(delta["reason"]) + "</p>"
    budget = value["proposal_budget"]
    known = _money({"currency": budget["currency"], "total_cents": budget["known_total_cents"]})
    content += "<h2>Itemized target costs</h2><p>Known supplied estimate: " + escape(known) + ". Targets with unspecified complete costs: " + str(len(budget["unknown_target_ids"])) + ".</p>"
    content += _table(["Target / original station", "Supplied target estimate", "Cost basis"], [
        [target_labels[row["target_id"]] + " / " + str(row["target"]["station_id"]), _money(row["target_cost"]), row["target_cost"].get("basis")]
        for row in value["targets"]])
    content += "<details><summary>Complete original target-cost summary</summary><pre>" + escape(json.dumps(budget, ensure_ascii=False, indent=2)) + "</pre></details>"
    content += "<h2>Original calendar</h2>" + _table(["Visit", "Left date / time / crew", "Right date / time / crew", "Change"], [
        [row["visit_key"], None if row["left"] is None else [row["left"][key] for key in ("date", "start_local", "finish_local", "crew")],
         None if row["right"] is None else [row["right"][key] for key in ("date", "start_local", "finish_local", "crew")], row["state"]]
        for row in value["visits"]])
    content += "<h2>Months and original target evidence</h2><p>Historical window: " + escape(value["historical_window"]["start"]) + " through " + escape(value["historical_window"]["end"]) + ". Future planned dates remain separate.</p>"
    for target in value["targets"]:
        content += "<section><h3>" + escape(target_labels[target["target_id"]]) + "</h3><p>Original station " + escape(str(target["target"]["station_id"])) + " · cohort " + escape(target["target"]["cohort_id"]) + "</p>"
        content += _table(["Month", "Historical dates / goal / gap", "Left planned dates", "Right planned dates"], [
            [row["month"], [row["historical"]["observed_dates"], row["historical"]["minimum_dates"], row["historical"]["date_gap"]],
             row["left"]["distinct_dates"], row["right"]["distinct_dates"]] for row in value["monthly"] if row["target_id"] == target["target_id"]])
        content += "<details><summary>Exact target, cohort, station, costs and field requirements</summary><pre>" + escape(json.dumps(target, ensure_ascii=False, indent=2)) + "</pre></details></section>"
    content += "<h2>Configuration changes</h2>" + _table(["Field", "Left presence / value", "Right presence / value"], [
        [" / ".join(row["path"]), row["left"], row["right"]] for row in value["configuration_changes"]])
    content += "<h2>Interpretation</h2><ul>" + "".join("<li>" + escape(line) + "</li>" for line in value["interpretation"]) + "</ul>"
    content += "<details><summary>Exact source identities and complete native plans</summary><pre>" + escape(json.dumps(value, ensure_ascii=False, indent=2)) + "</pre></details>"
    return "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + escape(value["title"]) + "</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#202020;background:#fff;margin:0 auto;padding:24px;max-width:1100px}h1{font-size:1.7rem}h2,h3{break-after:avoid}h3+p{break-after:avoid}.table-wrap{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;margin:12px 0 24px}th,td{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}p,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;font-size:.8rem}details{margin:12px 0}section{margin:24px 0}@media(max-width:500px){body{padding:12px}th,td{padding:6px;font-size:.9rem}}@media print{body{max-width:none;padding:0;font-size:10pt}tr{break-inside:avoid}thead{display:table-header-group}.table-wrap{overflow:visible}details{display:none}}</style><main>" + content + "</main></html>\n"


def _csv(headings, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(headings)
    writer.writerows(rows)
    return out.getvalue()


def files(value):
    """Original comparison downloads; JSON retains every complete source record."""
    monthly = _csv(["target_id", "station_id", "cohort_id", "month", "historical_window_start", "historical_window_end",
                    "historical_distinct_dates", "historical_goal", "historical_gap", "left_planned_dates", "right_planned_dates"], [
        [row["target_id"], row["station_id"], row["cohort_id"], row["month"],
         value["historical_window"]["start"], value["historical_window"]["end"],
         row["historical"]["observed_dates"], row["historical"]["minimum_dates"], row["historical"]["date_gap"],
         json.dumps(row["left"]["distinct_dates"]), json.dumps(row["right"]["distinct_dates"])] for row in value["monthly"]])
    visits = _csv(["visit_key", "change", "left_original_visit", "right_original_visit"], [
        [row["visit_key"], row["state"], json.dumps(row["left"], ensure_ascii=False, sort_keys=True),
         json.dumps(row["right"], ensure_ascii=False, sort_keys=True)] for row in value["visits"]])
    return [
        {"filename": "sampling-design-comparison.json", "media_type": "application/json", "text": json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"},
        {"filename": "sampling-design-comparison.html", "media_type": "text/html", "text": report_html(value)},
        {"filename": "sampling-design-months.csv", "media_type": "text/csv", "text": monthly},
        {"filename": "sampling-design-visits.csv", "media_type": "text/csv", "text": visits}]
