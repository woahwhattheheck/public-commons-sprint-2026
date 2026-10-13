"""Measured period comparisons for immutable Implementation plan revisions.

Saved evaluations use the existing implementation report bank and full Workspace
archive. Computation reads original plan observations once and preserves their
IDs, dates, units, limits, qualifiers and original result text.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import html
import io
import json
import math
from pathlib import Path
import re
import tempfile
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .implementation import ImplementationStore
from .implementation_schema import (
    ImplementationError, canonical_bytes, document_digest, validate_plan,
)
from .portable_implementation import report_edition

SCHEMA = "upstate.implementation-outcomes/v1"
SELECTION_SCHEMA = "upstate.implementation-outcome-selection/v1"
METHOD = "original-record-day-and-month-contrast/v1"
GROUP_FIELDS = ("parameter", "unit", "basis", "fraction", "method")
SUPPORT_FIELDS = (
    "ActivityMediaName", "ActivityMediaSubdivisionName",
    "ActivityDepthHeightMeasure/MeasureValue", "ActivityDepthHeightMeasure/MeasureUnitCode",
    "ActivityDepthAltitudeReferencePointText",
    "ResultAnalyticalMethod/MethodIdentifierContext", "ResultValueTypeName",
    "SampleCollectionMethod/MethodIdentifier", "SampleCollectionMethod/MethodIdentifierContext",
    "ActivityTypeCode",
    "ResultTemperatureBasisText", "ResultWeightBasisText", "ResultTimeBasisText",
    "ResultParticleSizeBasisText",
)
PRIMARY_REFERENCES = [
    {"title": "EPA: Study Design for Monitoring Wetlands",
     "url": "https://www.epa.gov/sites/default/files/documents/wetlands_4studydesign.pdf"},
    {"title": "USGS: Water-quality trends — data preparation and statistical methods",
     "url": "https://pubs.usgs.gov/publication/sir20175006"},
    {"title": "USGS: Reporting qualified, estimated and censored water-quality data",
     "url": "https://water.usgs.gov/owq/OFR_99-193/data.html"},
]
LITERAL_LIMIT = re.compile(r"^\s*(<=|>=|<|>|≤|≥)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$")


def _digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ImplementationError("Choose calendar dates in YYYY-MM-DD format.")
    try:
        return dt.date.fromisoformat(value)
    except ValueError as error:
        raise ImplementationError("Choose a valid calendar date: " + value) from error


def _stamp(value):
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result if result.tzinfo is not None and result.utcoffset() is not None else None
    except ValueError:
        return None


def _group(observation, activity):
    result = {key: observation.get(key, "") or "" for key in GROUP_FIELDS}
    result["method"] = observation.get("method") or activity.get("method") or ""
    reporting = observation.get("lab_source")
    original = reporting.get("original_row") if isinstance(reporting, dict) else None
    original = original if isinstance(original, dict) else {}
    result["support"] = {key: original[key] for key in SUPPORT_FIELDS
                         if original.get(key) not in (None, "")}
    if activity.get("method") and activity["method"] != result["method"]:
        result["support"]["collection_method"] = activity["method"]
    for key in ("depth", "depth_unit", "sample_media", "method_authority", "measurement_support"):
        if observation.get(key) not in (None, ""):
            result["support"][key] = observation[key]
    return result



def _group_label(group):
    names = {
        "ActivityMediaName": "media", "ActivityMediaSubdivisionName": "media subdivision",
        "ActivityDepthHeightMeasure/MeasureValue": "depth",
        "ActivityDepthHeightMeasure/MeasureUnitCode": "depth unit",
        "ActivityDepthAltitudeReferencePointText": "depth reference",
        "ResultAnalyticalMethod/MethodIdentifierContext": "method authority",
        "ResultValueTypeName": "value type", "SampleCollectionMethod/MethodIdentifier": "collection method ID",
        "SampleCollectionMethod/MethodIdentifierContext": "collection authority", "ActivityTypeCode": "activity type",
        "ResultTemperatureBasisText": "temperature basis", "ResultWeightBasisText": "weight basis",
        "ResultTimeBasisText": "time basis", "ResultParticleSizeBasisText": "particle-size basis",
    }
    parts = [str(group[key]) for key in GROUP_FIELDS if group[key]]
    parts.extend(names.get(key, key.replace("_", " ")) + ": " + _cell(value)
                 for key, value in group["support"].items())
    return " · ".join(parts)

def _rows(plan, zone):
    activities = {row["id"]: row for row in plan["activities"]}
    visits = {row["id"]: row for row in plan["visits"]}
    sites = {row["id"]: row for row in plan["sites"]}
    rows = []
    for index, observation in enumerate(plan["observations"]):
        activity = activities[observation["activity_id"]]
        visit = visits[activity["visit_id"]]
        collected = activity.get("collected_at")
        timestamp = _stamp(collected)
        date_basis = "activity.collected_at"
        if timestamp is None:
            collected = visit.get("visited_at")
            timestamp = _stamp(collected)
            date_basis = "visit.visited_at" if timestamp else None
        group = _group(observation, activity)
        rows.append({
            "observation_id": observation["id"], "activity_id": activity["id"],
            "visit_id": visit["id"], "site_id": activity["site_id"],
            "site_label": sites[activity["site_id"]]["label"],
            "sample_id": activity.get("sample_id"),
            "group_id": _digest(group), **group,
            "timestamp": collected if timestamp else None,
            "date": timestamp.astimezone(zone).date().isoformat() if timestamp else None,
            "date_basis": date_basis, "time_zone": str(zone),
            "result_type": observation["result_type"], "value": observation["value"],
            "original_text": observation["original_text"],
            "qualifier": observation.get("qualifier", "") or "",
            "qa_status": observation.get("qa_status", "") or "",
            "detection_limit": observation.get("detection_limit"),
            "quantitation_limit": observation.get("quantitation_limit"),
            "original_pointer": "/observations/" + str(index),
            "original_record_sha256": _digest(observation),
            "original_record": observation,
        })
    return rows


def _plan_binding(plan):
    return {"plan_id": plan["id"], "revision": plan["revision"],
            "document_digest": document_digest(plan), "title": plan["title"]}


def catalog(workspace, plan_id, revision=None):
    plan = ImplementationStore(workspace).get(plan_id, revision)
    rows = _rows(plan, ZoneInfo("UTC"))
    groups = {}
    for row in rows:
        group = groups.setdefault(row["group_id"], {
            "id": row["group_id"], **{key: row[key] for key in GROUP_FIELDS}, "support": row["support"],
            "count": 0, "dated_count": 0, "dates": [], "site_ids": set(),
            "result_types": Counter(),
        })
        group["count"] += 1
        group["site_ids"].add(row["site_id"])
        group["result_types"][row["result_type"]] += 1
        if row["date"]:
            group["dated_count"] += 1
            group["dates"].append(row["date"])
    for group in groups.values():
        dates = group.pop("dates")
        group["min_date"] = min(dates) if dates else None
        group["max_date"] = max(dates) if dates else None
        group["site_ids"] = sorted(group["site_ids"])
        group["result_types"] = dict(group["result_types"])
        group["label"] = _group_label(group)
    dates = [row["date"] for row in rows if row["date"]]
    return {
        "schema": "upstate.implementation-outcome-catalog/v1",
        "plan_binding": _plan_binding(plan),
        "sites": plan["sites"], "tasks": plan["tasks"],
        "evidence": plan["source_links"], "source_links": plan["source_links"],
        "monitoring_plans": plan["monitoring_plans"],
        "groups": sorted(groups.values(), key=lambda row: tuple(row[key] for key in GROUP_FIELDS)),
        "qa_statuses": sorted({row["qa_status"] for row in rows}),
        "coverage": {"records": len(rows), "dated_records": len(dates),
                     "min_date": min(dates) if dates else None,
                     "max_date": max(dates) if dates else None,
                     "date_basis_counts": dict(Counter(row["date_basis"] or "missing" for row in rows))},
        "defaults": {"time_zone": "UTC", "calendar_months": list(range(1, 13)),
                     "qa_statuses": None, "lower_bound": None},
    }


def _selection(plan, value, available_groups):
    if not isinstance(value, dict):
        raise ImplementationError("Choose the saved plan and period comparison selection.")
    if value.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ImplementationError("Unrecognized period comparison selection.")
    binding = _plan_binding(plan)
    for key in ("plan_id", "revision", "document_digest"):
        if value.get(key) != binding[key] or (key == "revision" and type(value.get(key)) is not int):
            raise ImplementationError("The selection must bind the exact saved plan revision and digest.")
    def ids(key, available, required=False):
        items = value.get(key, [])
        if not isinstance(items, list) or any(not isinstance(x, str) for x in items):
            raise ImplementationError(key + " must contain original choice IDs.")
        if len(items) != len(set(items)) or any(x not in available for x in items):
            raise ImplementationError(key + " contains a duplicate or unavailable original choice.")
        if required and not items:
            raise ImplementationError("Choose at least one " + key + ".")
        return sorted(items)
    sites = {row["id"] for row in plan["sites"]}
    impact = ids("impact_site_ids", sites, True)
    controls = ids("control_site_ids", sites)
    if set(impact) & set(controls):
        raise ImplementationError("Impact and control site selections must be distinct.")
    selected_groups = ids("group_ids", available_groups, True)
    windows = {}
    for name in ("before", "after"):
        window = value.get(name)
        if not isinstance(window, dict):
            raise ImplementationError("Choose both inclusive before and after date windows.")
        first, last = _date(window.get("start")), _date(window.get("end"))
        if first > last:
            raise ImplementationError(name + " start must be on or before its end.")
        windows[name] = {"start": first.isoformat(), "end": last.isoformat()}
    if windows["before"]["end"] >= windows["after"]["start"]:
        raise ImplementationError("Before and after windows must be ordered and nonoverlapping.")
    months = value.get("calendar_months", list(range(1, 13)))
    if (not isinstance(months, list) or not months
            or any(type(month) is not int or not 1 <= month <= 12 for month in months)
            or len(months) != len(set(months))):
        raise ImplementationError("Choose unique calendar months 1 through 12.")
    qa = value.get("qa_statuses")
    if qa is not None and (not isinstance(qa, list) or any(not isinstance(x, str) for x in qa)
                           or len(qa) != len(set(qa))):
        raise ImplementationError("QA selection must retain the original status labels.")
    zone_name = value.get("time_zone", "UTC")
    if not isinstance(zone_name, str):
        raise ImplementationError("Choose a named observation time zone.")
    try:
        ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ImplementationError("The selected time zone is unavailable: " + zone_name) from error
    lower = value.get("lower_bound")
    if lower is not None and not _finite(lower):
        raise ImplementationError("The explicit physical lower bound must be finite or null.")
    event = value.get("event")
    if event is not None:
        if not isinstance(event, dict) or not isinstance(event.get("label"), str) or not event["label"].strip():
            raise ImplementationError("An event needs its explicit date and original description.")
        event_date = _date(event.get("date")).isoformat()
        references = event.get("source_link_ids", [])
        available = {row["id"] for row in plan["source_links"]}
        if (not isinstance(references, list) or any(not isinstance(x, str) or x not in available for x in references)
                or len(references) != len(set(references))):
            raise ImplementationError("Event evidence must select original plan source-link IDs.")
        if not isinstance(event.get("notes", ""), str):
            raise ImplementationError("Event notes must be text.")
        event = {"date": event_date, "label": event["label"], "notes": event.get("notes", ""),
                 "source_link_ids": sorted(references)}
    title = value.get("title", "Measured period comparison")
    if not isinstance(title, str) or not title.strip():
        raise ImplementationError("Give the saved comparison a title.")
    return {"schema": SELECTION_SCHEMA, **{key: binding[key] for key in ("plan_id", "revision", "document_digest")},
            "title": title, **windows, "impact_site_ids": impact, "control_site_ids": controls,
            "group_ids": selected_groups, "qa_statuses": sorted(qa) if qa is not None else None,
            "calendar_months": sorted(months), "time_zone": zone_name, "lower_bound": lower, "event": event}


def _interval(lower, upper, lower_open=False, upper_open=False):
    return {"lower": lower, "upper": upper, "lower_open": bool(lower_open),
            "upper_open": bool(upper_open)}


def _mean(intervals):
    if not intervals:
        return None
    lower = None if any(x["lower"] is None for x in intervals) else math.fsum(x["lower"] for x in intervals) / len(intervals)
    upper = None if any(x["upper"] is None for x in intervals) else math.fsum(x["upper"] for x in intervals) / len(intervals)
    if any(x is not None and not math.isfinite(x) for x in (lower, upper)):
        raise ImplementationError("Original values exceed finite arithmetic support for this comparison.")
    return _interval(lower, upper, any(x["lower_open"] for x in intervals),
                     any(x["upper_open"] for x in intervals))


def _subtract(left, right):
    if left is None or right is None:
        return None
    lower = None if left["lower"] is None or right["upper"] is None else left["lower"] - right["upper"]
    upper = None if left["upper"] is None or right["lower"] is None else left["upper"] - right["lower"]
    if any(x is not None and not math.isfinite(x) for x in (lower, upper)):
        raise ImplementationError("Original contrasts exceed finite arithmetic support.")
    return _interval(lower, upper, left["lower_open"] or right["upper_open"],
                     left["upper_open"] or right["lower_open"])


def _value_interval(row, lower_bound):
    raw = row["original_text"].strip()
    literal = LITERAL_LIMIT.fullmatch(raw)
    qualifier = row["qualifier"].strip().casefold()
    reporting = row["original_record"].get("lab_source")
    reporting = reporting if isinstance(reporting, dict) else {}
    raw_source = reporting.get("original_row")
    raw_source = raw_source if isinstance(raw_source, dict) else {}
    if row["result_type"] == "numeric":
        if literal or qualifier in ("<", "<=", "≤", ">", ">=", "≥"):
            return None, "conflicting_numeric_censor"
        value = row["value"]
        if not _finite(value):
            return None, "nonfinite_numeric"
        if lower_bound is not None and value < lower_bound:
            return None, "below_selected_physical_bound"
        return _interval(value, value), "original_numeric"
    if row["result_type"] != "censored":
        return None, row["result_type"] + "_result"
    sign, endpoint, basis = None, None, None
    if (not literal and reporting.get("schema") == "upstate.implementation-lab-row/v1"
            and qualifier == "below reporting limit"
            and raw_source.get("DetectionQuantitationLimitTypeName") == "Lower Reporting Limit"):
        limit_text = raw_source.get("DetectionQuantitationLimitMeasure/MeasureValue")
        if raw_source.get("DetectionQuantitationLimitMeasure/MeasureUnitCode") != row["unit"]:
            return None, "reporting_limit_unit_differs"
        try:
            endpoint = float(limit_text)
        except (TypeError, ValueError):
            return None, "invalid_original_reporting_limit"
        if not _finite(endpoint) or (lower_bound is not None and endpoint <= lower_bound):
            return None, "contradictory_original_reporting_limit"
        return _interval(lower_bound, endpoint, False, True), "original_lower_reporting_limit"
    if literal:
        sign, text = literal.groups()
        endpoint, basis = float(text), "literal_original_result"
    else:
        left = qualifier in ("<", "<=", "≤", "below", "below detection limit", "below quantitation limit",
                             "less than detection limit", "less than quantitation limit")
        right = qualifier in (">", ">=", "≥", "above", "above quantitation limit", "above detection limit")
        if not left and not right:
            return None, "unresolved_censor_direction"
        sign = "<" if left else ">"
        if qualifier in ("<=", "≤", ">=", "≥"):
            sign = qualifier
        detection, quantitation = row["detection_limit"], row["quantitation_limit"]
        if "detection" in qualifier:
            endpoint, basis = detection, "declared_detection_limit"
        elif "quantitation" in qualifier:
            endpoint, basis = quantitation, "declared_quantitation_limit"
        else:
            limits = {x for x in (detection, quantitation) if _finite(x)}
            if len(limits) != 1:
                return None, "ambiguous_or_missing_original_limit"
            endpoint, basis = next(iter(limits)), "single_distinct_original_limit"
    if not _finite(endpoint):
        return None, "nonfinite_or_missing_original_limit"
    if sign in ("<", "<=", "≤"):
        opened = sign == "<"
        if lower_bound is not None and (endpoint < lower_bound or endpoint == lower_bound and opened):
            return None, "contradictory_physical_bound"
        return _interval(lower_bound, endpoint, False, opened), basis
    return _interval(endpoint if lower_bound is None else max(endpoint, lower_bound), None,
                     sign == ">" and (lower_bound is None or endpoint >= lower_bound), False), basis


def _stats(days):
    supported = [day for day in days if day["interval"] is not None]
    quantified = [day["quantified_interval"] for day in days if day["quantified_interval"] is not None]
    complete = len(supported) == len(days)
    return {"days": len(days), "supported_days": len(supported),
            "incomplete_days": len(days) - len(supported),
            "records": sum(day["record_count"] for day in days),
            "quantified_records": sum(day["quantified_count"] for day in days),
            "censored_records": sum(day["censored_count"] for day in days),
            "unresolved_records": sum(day["unresolved_count"] for day in days),
            "dates": [day["date"] for day in days],
            "first_date": min((day["date"] for day in days), default=None),
            "last_date": max((day["date"] for day in days), default=None),
            "interval": _mean([day["interval"] for day in days]) if complete else None,
            "supported_dates_interval": _mean([day["interval"] for day in supported]),
            "quantified_subset_interval": _mean(quantified),
            "quantified_subset_days": len(quantified)}


def _period_comparison(days):
    before = [day for day in days if day["period"] == "before"]
    after = [day for day in days if day["period"] == "after"]
    first, second = _stats(before), _stats(after)
    monthly = []
    for month in range(1, 13):
        a = _stats([day for day in before if int(day["date"][5:7]) == month])
        b = _stats([day for day in after if int(day["date"][5:7]) == month])
        if a["days"] or b["days"]:
            monthly.append({"month": month, "before": a, "after": b,
                            "change": _subtract(b["interval"], a["interval"]),
                            "supported_date_change": _subtract(b["supported_dates_interval"], a["supported_dates_interval"])})
    matched = [row for row in monthly if row["before"]["supported_days"] and row["after"]["supported_days"]]
    full = all(row["change"] is not None for row in matched)
    return {"before": first, "after": second, "change": _subtract(second["interval"], first["interval"]),
            "supported_date_change": _subtract(second["supported_dates_interval"], first["supported_dates_interval"]),
            "monthly": monthly,
            "month_balanced": {"months": [row["month"] for row in matched],
                               "omitted_months": [row["month"] for row in monthly if row not in matched],
                               "change": _mean([row["change"] for row in matched]) if full else None,
                               "supported_date_change": _mean([row["supported_date_change"] for row in matched])}}


def _day(rows):
    supported = [row for row in rows if row["interval"] is not None]
    quantified = [row for row in supported if row["result_type"] == "numeric"]
    return {"date": rows[0]["date"], "period": rows[0]["period"],
            "site_id": rows[0]["site_id"], "group_id": rows[0]["group_id"],
            "record_count": len(rows), "quantified_count": len(quantified),
            "censored_count": sum(row["result_type"] == "censored" for row in rows),
            "unresolved_count": len(rows) - len(supported),
            "activity_count": len({row["activity_id"] for row in rows}),
            "sample_ids": sorted({row["sample_id"] for row in rows if row["sample_id"]}),
            "observation_ids": [row["observation_id"] for row in rows],
            "interval": _mean([row["interval"] for row in rows]) if len(supported) == len(rows) else None,
            "supported_subset_interval": _mean([row["interval"] for row in supported]),
            "quantified_interval": _mean([row["interval"] for row in quantified])}


def analyze(plan, selection):
    """Compute a descriptive comparison from one complete original saved revision."""
    plan = validate_plan(plan)
    raw_rows = _rows(plan, ZoneInfo("UTC"))
    groups = {}
    for row in raw_rows:
        groups.setdefault(row["group_id"], {
            "id": row["group_id"], **{key: row[key] for key in GROUP_FIELDS}, "support": row["support"],
        })
    selected = _selection(plan, selection, groups)
    selected_groups = [groups[key] for key in selected["group_ids"]]
    if selected["lower_bound"] is not None and len({group["unit"] for group in selected_groups}) != 1:
        raise ImplementationError("An explicit lower bound can apply only to groups with the same original unit.")
    zone = ZoneInfo(selected["time_zone"])
    all_rows = _rows(plan, zone)
    sites = set(selected["impact_site_ids"] + selected["control_site_ids"])
    records, bins = [], defaultdict(list)
    for row in all_rows:
        if row["site_id"] not in sites or row["group_id"] not in selected["group_ids"]:
            continue
        row = dict(row)
        day = row["date"]
        period = next((name for name in ("before", "after")
                       if day and selected[name]["start"] <= day <= selected[name]["end"]), None)
        reason = None
        if not day:
            reason = "missing_actual_date"
        elif period is None:
            reason = "outside_selected_windows"
        elif int(day[5:7]) not in selected["calendar_months"]:
            reason = "calendar_month_excluded"
        elif selected["qa_statuses"] is not None and row["qa_status"] not in selected["qa_statuses"]:
            reason = "qa_status_excluded"
        interval, value_basis = _value_interval(row, selected["lower_bound"])
        row.update({"period": period, "role": "impact" if row["site_id"] in selected["impact_site_ids"] else "control",
                    "interval": interval, "value_basis": value_basis,
                    "included_in_period": reason is None,
                    "status": reason or ("resolved" if interval is not None else "unresolved_result")})
        records.append(row)
        if reason is None:
            bins[(row["site_id"], row["group_id"], day)].append(row)
    days = [_day(rows) for _, rows in sorted(bins.items())]
    by_key = {(row["site_id"], row["group_id"], row["date"]): row for row in days}
    effects, matched_rows = [], []
    site_labels = {row["id"]: row["label"] for row in plan["sites"]}
    for group in selected_groups:
        group["label"] = _group_label(group)
        group["physical_lower_bound"] = selected["lower_bound"]
        for site_id in selected["impact_site_ids"]:
            own = [row for row in days if row["site_id"] == site_id and row["group_id"] == group["id"]]
            comparison = _period_comparison(own)
            paired, missing = [], []
            if selected["control_site_ids"]:
                for day in own:
                    controls = [by_key.get((control, group["id"], day["date"]))
                                for control in selected["control_site_ids"]]
                    missing_controls = [control for control, value in zip(selected["control_site_ids"], controls)
                                        if value is None or value["interval"] is None]
                    if day["interval"] is None or missing_controls:
                        missing.append({"date": day["date"], "period": day["period"],
                                        "impact_incomplete": day["interval"] is None,
                                        "missing_or_incomplete_control_site_ids": missing_controls})
                        continue
                    control_interval = _mean([value["interval"] for value in controls])
                    contrast = _subtract(day["interval"], control_interval)
                    paired_day = dict(day)
                    quantified_complete = (day["censored_count"] == 0
                                           and all(value["censored_count"] == 0 for value in controls))
                    paired_day.update({
                        "interval": contrast,
                        "quantified_interval": contrast if quantified_complete else None,
                        "record_count": day["record_count"] + sum(value["record_count"] for value in controls),
                        "quantified_count": day["quantified_count"] + sum(value["quantified_count"] for value in controls),
                        "censored_count": day["censored_count"] + sum(value["censored_count"] for value in controls),
                        "unresolved_count": 0,
                    })
                    paired.append(paired_day)
                    matched_rows.append({
                        "impact_site_id": site_id, "group_id": group["id"], "date": day["date"],
                        "period": day["period"], "impact_interval": day["interval"],
                        "control_interval": control_interval, "contrast": contrast,
                        "impact_observation_ids": day["observation_ids"],
                        "controls": [{"site_id": value["site_id"], "observation_ids": value["observation_ids"],
                                      "interval": value["interval"]} for value in controls],
                    })
            effects.append({
                "site_id": site_id, "site_label": site_labels[site_id], "group_id": group["id"],
                **{key: group[key] for key in GROUP_FIELDS}, "support": group["support"],
                "direct": comparison,
                "controls": ({"site_ids": selected["control_site_ids"], "paired": _period_comparison(paired),
                              "unpaired_impact_dates": missing,
                              "pairing": "Exact selected-zone calendar date; every selected control site required"}
                             if selected["control_site_ids"] else None),
            })
    accepted = [row for row in records if row["included_in_period"]]
    summary = {
        "selected_records": len(records), "period_records": len(accepted),
        "resolved_records": sum(row["interval"] is not None for row in accepted),
        "unresolved_records": sum(row["interval"] is None for row in accepted),
        "quantified_records": sum(row["result_type"] == "numeric" and row["interval"] is not None for row in accepted),
        "censored_records": sum(row["result_type"] == "censored" for row in accepted),
        "sampled_site_dates": len({(day["site_id"], day["date"]) for day in days}),
        "sampled_site_group_dates": len(days),
        "complete_sampled_site_group_dates": sum(day["interval"] is not None for day in days),
        "status_counts": dict(Counter(row["status"] for row in records)),
        "date_basis_counts": dict(Counter(row["date_basis"] or "missing" for row in accepted)),
        "impact_sites": len(selected["impact_site_ids"]), "control_sites": len(selected["control_site_ids"]),
        "groups": len(selected_groups),
        "matched_control_dates": len({row["date"] for row in matched_rows}),
        "matched_control_site_group_dates": len(matched_rows),
    }
    return {
        "schema": SCHEMA, "method": METHOD, "plan_binding": _plan_binding(plan),
        "selection": selected, "selection_digest": _digest(selected),
        "groups": selected_groups, "summary": summary, "effects": effects,
        "days": days, "matched_controls": matched_rows, "records": records,
        "event_sources": [row for row in plan["source_links"]
                         if selected["event"] and row["id"] in selected["event"]["source_link_ids"]],
        "interpretation": [
            "Absolute changes use the original parameter, unit, fraction, basis, method and retained measurement support.",
            "A sampled-date mean averages original records on that date; it is not a measured 24-hour average.",
            "Period means give equal weight to sampled dates. Full intervals are unavailable when any selected date has an unresolved result; supported-date and quantified subsets remain explicitly separate.",
            "Control contrasts use the same dates and all selected control sites. Calendar-month balancing gives equal weight to months supported in both periods.",
            "Displayed bounds propagate original result limits and the explicit physical floor; they are not confidence intervals.",
            "The selected event and dates provide context. These descriptive comparisons do not establish that an intervention caused the observed change.",
        ],
        "references": PRIMARY_REFERENCES,
    }


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _csv(rows, fields):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        # Prevent original free text from becoming a spreadsheet formula. The
        # unmodified original record remains in outcomes.json and plan.json.
        values = {}
        for key in fields:
            value = row.get(key)
            text = _cell(value)
            if isinstance(value, str) and text.lstrip().startswith(("=", "+", "-", "@")):
                text = "'" + text
            values[key] = text
        writer.writerow(values)
    return buffer.getvalue()


def _interval_text(value):
    if value is None:
        return "Unavailable"
    lower, upper = value["lower"], value["upper"]
    if lower is not None and lower == upper and not value["lower_open"] and not value["upper_open"]:
        return format(lower, ".8g")
    left = "−∞" if lower is None else format(lower, ".8g")
    right = "+∞" if upper is None else format(upper, ".8g")
    return ("(" if value["lower_open"] or lower is None else "[") + left + ", " + right + (
        ")" if value["upper_open"] or upper is None else "]")


def _table(headers, rows):
    esc = lambda value: html.escape(_cell(value), quote=True)
    return ('<div class="table"><table><thead><tr>' +
            "".join("<th>" + esc(value) + "</th>" for value in headers) +
            "</tr></thead><tbody>" +
            "".join("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in row) + "</tr>"
                    for row in rows) + "</tbody></table></div>")


def _period_rows(result):
    rows = []
    for effect in result["effects"]:
        comparisons = [("site", effect["direct"])]
        if effect["controls"] is not None:
            comparisons.append(("same_date_control_contrast", effect["controls"]["paired"]))
        for kind, comparison in comparisons:
            for month, item in [(None, comparison)] + [(row["month"], row) for row in comparison["monthly"]]:
                rows.append({
                    **{key: effect[key] for key in ("site_id", "site_label", "group_id") + GROUP_FIELDS},
                    "support": effect["support"], "comparison": kind, "month": month,
                    "before_days": item["before"]["days"],
                    "before_supported_days": item["before"]["supported_days"],
                    "after_days": item["after"]["days"],
                    "after_supported_days": item["after"]["supported_days"],
                    "before": item["before"]["interval"], "after": item["after"]["interval"],
                    "change": item["change"], "supported_date_change": item["supported_date_change"],
                    "before_records": item["before"]["records"], "after_records": item["after"]["records"],
                })
    return rows


def render_html(result):
    """Render the complete saved evaluation as a self-contained neutral report."""
    esc = lambda value: html.escape(_cell(value), quote=True)
    selection, binding, summary = result["selection"], result["plan_binding"], result["summary"]
    sections = [
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>" + esc(selection["title"]) + "</title>"
        "<style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1180px;margin:36px auto;padding:0 24px}"
        "h1{font-size:30px;line-height:1.2}h2{margin-top:36px;border-top:1px solid #bbb;padding-top:20px}"
        "h3{margin-top:28px}p,li{max-width:100ch}.table{overflow:auto}table{border-collapse:collapse;width:100%;margin:16px 0}"
        "th,td{text-align:left;vertical-align:top;border:1px solid #ccc;padding:8px}th{background:#eee}"
        "code{overflow-wrap:anywhere}small{color:#444}a{color:inherit;text-decoration:underline}"
        "@media print{body{margin:0;max-width:none;padding:0}.table{overflow:visible}tr{break-inside:avoid}}</style>"
        "<main><h1>" + esc(selection["title"]) + "</h1>",
        "<p>" + esc(binding["title"]) + " · saved revision " + str(binding["revision"]) + "</p>",
        "<p><small>Plan digest <code>" + esc(binding["document_digest"]) +
        "</code><br>Selection digest <code>" + esc(result["selection_digest"]) + "</code></small></p>",
        "<h2>Selection and source support</h2>",
        _table(["Setting", "Value"], [
            ["Before (inclusive)", selection["before"]["start"] + " through " + selection["before"]["end"]],
            ["After (inclusive)", selection["after"]["start"] + " through " + selection["after"]["end"]],
            ["Calendar time zone", selection["time_zone"]],
            ["Impact / study sites", selection["impact_site_ids"]],
            ["Reference sites", selection["control_site_ids"]],
            ["Selected calendar months", selection["calendar_months"]],
            ["QA labels", "All original labels" if selection["qa_statuses"] is None else selection["qa_statuses"]],
            ["Physical lower bound", "Unbounded" if selection["lower_bound"] is None else selection["lower_bound"]],
            ["Explicit event context", selection["event"]],
        ]),
        _table(["Source support", "Count"], [[key.replace("_", " "), value] for key, value in summary.items()]),
        "<p>The terms impact and reference describe the operator's selection. Interpretation depends on the actual study design and documented event context.</p>",
        "<h2>Period comparisons</h2>",
        "<p>All changes are after minus before in the original unit. Bounds retain open endpoints from original censored results. "
        "Unavailable means the selected support does not produce a complete interval; explicitly labeled supported-date results use only complete sampled dates.</p>",
    ]
    for effect in result["effects"]:
        sections += ["<h3>" + esc(effect["site_label"]) + " · " + esc(effect["parameter"]) + "</h3>",
                     "<p>" + esc(" · ".join(effect[key] for key in ("unit", "basis", "fraction", "method") if effect[key])) +
                     "</p><p><small>Original measurement support: " + esc(effect["support"]) + "</small></p>"]
        comparisons = [("Original site measurements", effect["direct"])]
        if effect["controls"] is not None:
            comparisons.append(("Same-date site minus selected references", effect["controls"]["paired"]))
        for label, comparison in comparisons:
            sections.append("<h4>" + esc(label) + "</h4>")
            sections.append(_table(
                ["Period", "Mean interval", "Sampled dates", "Complete dates", "Original results", "Unresolved results"],
                [[name.title(), _interval_text(comparison[name]["interval"]),
                  comparison[name]["days"], comparison[name]["supported_days"],
                  comparison[name]["records"], comparison[name]["unresolved_records"]] for name in ("before", "after")]))
            balance = comparison["month_balanced"]
            sections.append(_table(["Contrast", "Interval", "Support"], [
                ["After − before", _interval_text(comparison["change"]), "All selected sampled dates"],
                ["Supported dates: after − before", _interval_text(comparison["supported_date_change"]), "Complete sampled dates only"],
                ["Common-month balanced change", _interval_text(balance["change"]), balance["months"]],
                ["Supported dates: common-month balanced change", _interval_text(balance["supported_date_change"]), balance["months"]],
                ["Months omitted from balancing", "", balance["omitted_months"]],
            ]))
            if comparison["monthly"]:
                sections.append(_table(["Month", "Before", "After", "Change", "Before dates", "After dates"],
                    [[row["month"], _interval_text(row["before"]["interval"]), _interval_text(row["after"]["interval"]),
                      _interval_text(row["change"]), row["before"]["days"], row["after"]["days"]]
                     for row in comparison["monthly"]]))
        if effect["controls"] is not None and effect["controls"]["unpaired_impact_dates"]:
            sections.append("<details><summary>Dates without complete reference support</summary>" +
                _table(["Date", "Period", "Impact incomplete", "Missing or incomplete reference sites"],
                       [[row["date"], row["period"], row["impact_incomplete"], row["missing_or_incomplete_control_site_ids"]]
                        for row in effect["controls"]["unpaired_impact_dates"]]) + "</details>")
    sections += ["<h2>Interpretation and methods</h2><ul>" +
                 "".join("<li>" + esc(text) + "</li>" for text in result["interpretation"]) + "</ul>",
                 "<h2>Original observations</h2><p>Every selected site and group record is retained here, including excluded dates and unresolved results. "
                 "The JSON edition also retains each complete original record and its plan pointer.</p>",
                 _table(["Observation", "Site", "Date", "Parameter / method", "Original result", "Unit", "QA", "Status", "Interval", "Limit basis"],
                        [[row["observation_id"], row["site_label"], row["date"],
                          row["parameter"] + " / " + row["method"], row["original_text"], row["unit"], row["qa_status"],
                          row["status"], _interval_text(row["interval"]), row["value_basis"]] for row in result["records"]]),
                 "<h2>Original event evidence</h2>",
                 _table(["Original source record"], [[row] for row in result["event_sources"]]),
                 "<h2>Files and references</h2><p>"
                 '<a href="outcomes.json">Complete evaluation JSON</a> · <a href="outcome_rows.csv">Original observation selection</a> · '
                 '<a href="period_summary.csv">Period and monthly contrasts</a> · <a href="sampled_dates.csv">Sampled dates</a> · '
                 '<a href="matched_controls.csv">Same-date reference matches</a> · <a href="implementation-plan.html">Original implementation report</a> · '
                 '<a href="plan.json">Original saved plan</a> · <a href="manifest.json">File inventory</a></p>',
                 "<ul>" + "".join('<li><a href="' + esc(row["url"]) + '">' + esc(row["title"]) + "</a></li>"
                                  for row in result["references"]) + "</ul></main></html>"]
    return "\n".join(sections) + "\n"


def _retained_result(store, directory):
    edition = report_edition(store, directory)
    directory = Path(edition["directory"])
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("analysis_schema") != SCHEMA:
        raise ImplementationError("Choose a retained period comparison report edition.")
    required = {"outcomes.json", "outcome_rows.csv", "period_summary.csv",
                "sampled_dates.csv", "matched_controls.csv", "implementation-plan.html"}
    if not required.issubset(edition["members"]):
        raise ImplementationError("The retained comparison lacks its original result and export inventory.")
    result = json.loads((directory / "outcomes.json").read_text(encoding="utf-8"))
    binding = result.get("plan_binding", {})
    if (result.get("schema") != SCHEMA
            or any(binding.get(key) != edition[key] for key in ("plan_id", "revision", "document_digest"))
            or result.get("selection_digest") != _digest(result.get("selection"))
            or manifest.get("selection_digest") != result["selection_digest"]
            or any(result.get("selection", {}).get(key) != binding.get(key)
                   for key in ("plan_id", "revision", "document_digest"))):
        raise ImplementationError("The outcome edition and original saved plan binding differ.")
    files = []
    for name in edition["members"]:
        path = directory / name
        body = path.read_bytes()
        files.append({"name": name, "path": path.relative_to(store.root).as_posix(),
                      "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
    return {**result, "id": edition["id"], "files": files,
            "report": {**edition, "directory": directory.relative_to(store.root).as_posix()}}


def get(workspace, plan_id, id):
    """Reopen and verify a complete retained report, including after restore."""
    if not isinstance(id, str) or not re.fullmatch(r"[0-9a-f]{64}", id):
        raise ImplementationError("Choose an original retained period comparison ID.")
    store = ImplementationStore(workspace)
    directory = store._directory(plan_id) / "reports" / id
    result = _retained_result(store, directory)
    if result["id"] != id or result["plan_binding"]["plan_id"] != plan_id:
        raise ImplementationError("The retained outcome identity differs from the selected report.")
    return result


def list_outcomes(workspace, plan_id):
    """List verified outcome editions from the existing Implementation report bank."""
    store = ImplementationStore(workspace)
    rows = []
    for edition in store.list_reports(plan_id):
        directory = Path(edition["directory"])
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("analysis_schema") != SCHEMA:
            continue
        result = _retained_result(store, directory)
        rows.append({key: result[key] for key in
                     ("id", "schema", "method", "plan_binding", "selection", "selection_digest", "summary", "report")})
    return sorted(rows, key=lambda row: (row["plan_binding"]["revision"], row["id"]), reverse=True)


def build(workspace, selection):
    """Compute and retain a complete original report edition in the native bank."""
    if not isinstance(selection, dict):
        raise ImplementationError("Supply a saved period comparison selection.")
    store = ImplementationStore(workspace)
    plan = store.get(selection.get("plan_id"), selection.get("revision"))
    result = analyze(plan, selection)
    with tempfile.TemporaryDirectory(prefix="implementation-outcomes-") as temporary:
        directory = Path(temporary) / "report"
        store.report(plan["id"], directory, as_of=result["selection"]["after"]["end"], revision=plan["revision"])
        (directory / "report.html").rename(directory / "implementation-plan.html")
        (directory / "report.html").write_text(render_html(result), encoding="utf-8")
        (directory / "outcomes.json").write_bytes(canonical_bytes(result) + b"\n")
        tables = {
            "outcome_rows.csv": (result["records"], [
                "observation_id", "activity_id", "visit_id", "sample_id", "site_id", "site_label",
                "group_id", *GROUP_FIELDS, "support", "timestamp", "date", "date_basis", "time_zone",
                "period", "role", "result_type", "value", "original_text", "qualifier", "qa_status",
                "detection_limit", "quantitation_limit", "interval", "value_basis", "included_in_period",
                "status", "original_pointer", "original_record_sha256", "original_record"]),
            "period_summary.csv": (_period_rows(result), [
                "site_id", "site_label", "group_id", *GROUP_FIELDS, "support", "comparison", "month",
                "before_days", "before_supported_days", "after_days", "after_supported_days",
                "before", "after", "change", "supported_date_change", "before_records", "after_records"]),
            "sampled_dates.csv": (result["days"], [
                "site_id", "group_id", "date", "period", "record_count", "quantified_count",
                "censored_count", "unresolved_count", "activity_count", "sample_ids", "observation_ids",
                "interval", "supported_subset_interval", "quantified_interval"]),
            "matched_controls.csv": (result["matched_controls"], [
                "impact_site_id", "group_id", "date", "period", "impact_interval", "control_interval",
                "contrast", "impact_observation_ids", "controls"]),
        }
        for name, (rows, fields) in tables.items():
            (directory / name).write_text(_csv(rows, fields), encoding="utf-8-sig", newline="")
        manifest_path = directory / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.update(analysis_schema=SCHEMA, method=METHOD, selection_digest=result["selection_digest"])
        manifest["files"] = [{"name": path.name, "size_bytes": path.stat().st_size,
                              "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                             for path in sorted(directory.iterdir()) if path.name != "manifest.json"]
        manifest_path.write_bytes(canonical_bytes(manifest) + b"\n")
        edition = store.retain_report(directory)
    return get(workspace, plan["id"], edition["id"])


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--revision", type=int)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--catalog", action="store_true")
    choice.add_argument("--selection", type=Path)
    choice.add_argument("--get", dest="outcome_id")
    choice.add_argument("--list", dest="list_saved", action="store_true")
    args = parser.parse_args(argv)
    if args.catalog:
        result = catalog(args.workspace, args.plan_id, args.revision)
    elif args.list_saved:
        result = list_outcomes(args.workspace, args.plan_id)
    elif args.outcome_id:
        result = get(args.workspace, args.plan_id, args.outcome_id)
    else:
        selection = json.loads(args.selection.read_text(encoding="utf-8"))
        if selection.get("plan_id") != args.plan_id or (
                args.revision is not None and selection.get("revision") != args.revision):
            parser.error("The selection must bind the requested plan and revision.")
        result = build(args.workspace, selection)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
