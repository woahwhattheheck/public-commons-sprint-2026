"""Bind original monitoring observations to an existing network and saved calendar.

This is descriptive source context. It never modifies the network, solver,
planning costs, selected catchments, campaign revision or source observations.
"""
from __future__ import annotations
import argparse
import csv
import html
import io
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path

from .monitoring_common import ContractError, canonical_bytes, digest, file_sha256, load_json
from .monitoring_sources import source_record, verify_binding, export_source

SOURCE_SCHEMA = "upstate.monitoring-observed-source/v1"
SCOPED_SOURCE_SCHEMA = "upstate.monitoring-observed-source/v2"
SCHEMA = "upstate.monitoring_observed_contexts/v1"
COLLECTION = "monitoring_observed_contexts"


def _service(workspace):
    from .monitoring_workspace import MonitoringWorkspace
    return MonitoringWorkspace(workspace)


def _date(value):
    if not isinstance(value, str):
        raise ContractError("Observed and calendar dates must be original ISO date strings")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ContractError("Invalid original date: " + value) from exc
    if parsed.isoformat() != value:
        raise ContractError("Observed dates must be YYYY-MM-DD")
    return value


def _id(value, label):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ContractError(label + " must be an exact nonempty original identifier")
    return value


def _number(value, label):
    if isinstance(value, bool):
        raise ContractError(label + " must be numeric")
    try:
        number = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ContractError(label + " must be finite") from exc
    if not math.isfinite(number):
        raise ContractError(label + " must be finite")
    return number


def _flow_scope(value):
    """Return the declared station-specific flow selection without broadening it."""
    scope = value.get("flow_scope")
    if scope is None:
        return None
    if not isinstance(scope, dict) or scope.get("mode") != "same_station_only":
        raise ContractError("Observed flow scope must declare same_station_only")
    gauge = _id(scope.get("gauge_station_id"), "flow gauge station")
    stations = scope.get("station_ids")
    if not isinstance(stations, list) or stations != [gauge]:
        raise ContractError("Same-station flow scope must select only its original gauge station")
    start, end = scope.get("start_inclusive"), scope.get("end_inclusive")
    if (start is None) != (end is None):
        raise ContractError("Flow scope must retain both original period endpoints")
    if start is not None and _date(end) < _date(start):
        raise ContractError("Original flow scope period is reversed")
    return scope


def _flow_applies(scope, station, day):
    if scope is None:
        return True
    return (station in scope["station_ids"] and
            (scope.get("start_inclusive") is None or
             scope["start_inclusive"] <= day <= scope["end_inclusive"]))


def _episode_activity(scope, row):
    return (_flow_applies(scope, row["station_id"], row["date"]) and
            (scope is None or row.get("activity_type") == "Sample-Routine"))


def _validate(value):
    if not isinstance(value, dict) or value.get("schema") not in {SOURCE_SCHEMA, SCOPED_SOURCE_SCHEMA}:
        raise ContractError("Select an original monitoring observational context source")
    needed = ("stations", "activities", "daily_flow", "relations", "annual_coverage",
              "station_year_coverage", "monthly_coverage", "high_flow_episodes", "paired_contrasts")
    if any(not isinstance(value.get(key), list) for key in needed):
        raise ContractError("The retained context lacks its complete source tables")
    stations = {}
    for row in value["stations"]:
        station = _id(row["station_id"], "source station")
        if station in stations:
            raise ContractError("Original station IDs repeat")
        lon = _number(row["longitude"], "station longitude")
        lat = _number(row["latitude"], "station latitude")
        if (not -180 <= lon <= 180 or not -90 <= lat <= 90
                or row.get("datum") not in {"WGS84", "NAD83"}):
            raise ContractError("Original geographic station coordinates require their declared WGS84 or NAD83 datum")
        stations[station] = row
    if value["schema"] == SCOPED_SOURCE_SCHEMA and value.get("flow_scope") is None:
        raise ContractError("A v2 observed source requires its explicit original station flow scope")
    _flow_scope(value)
    seen = set()
    activity_dates = {}
    for row in value["activities"]:
        station = row["station_id"]
        identity = (station, _id(row["activity_id"], "source activity"))
        if station not in stations or identity in seen:
            raise ContractError("Source activity is ambiguous or belongs to an unknown station")
        seen.add(identity)
        activity_dates[identity] = _date(row["date"])
    observations = value.get("observations", [])
    if not isinstance(observations, list):
        raise ContractError("Original observations must be a complete source table")
    observed_ids = set()
    for row in observations:
        if not isinstance(row, dict):
            raise ContractError("Each original observation must be a source record")
        identity = _id(row.get("observation_id"), "original observation")
        station = _id(row.get("station_id"), "observation station")
        activity = _id(row.get("activity_id"), "observation activity")
        if identity in observed_ids or activity_dates.get((station, activity)) != _date(row.get("date")):
            raise ContractError("Original observation repeats or differs from its station/activity/date")
        observed_ids.add(identity)
        for field in ("result_value", "limit_value", "lower", "upper"):
            if row.get(field) is not None:
                _number(row[field], "observation " + field)
        if row.get("upper_unbounded") is True and row.get("upper") is not None:
            raise ContractError("An unbounded original upper interval must retain a null upper value")
        if (row.get("lower") is not None and row.get("upper") is not None
                and float(row["lower"]) > float(row["upper"])):
            raise ContractError("Original observation interval is reversed")
    start = _date(value["source_period"]["start_inclusive"])
    end = _date(value["source_period"]["end_inclusive"])
    if end < start:
        raise ContractError("Source period is reversed")
    days = {}
    for row in value["daily_flow"]:
        day = _date(row["date"])
        if day in days or not start <= day <= end:
            raise ContractError("Original daily flow date repeats or exceeds its stated period")
        flow = _number(row["mean_cfs"], "source daily mean")
        threshold = _number(row["p95_cfs"], "source annual P95")
        if flow < 0 or threshold < 0 or type(row["at_or_above_annual_p95"]) is not bool:
            raise ContractError("Daily flow threshold fields are invalid")
        if row["at_or_above_annual_p95"] != (flow >= threshold):
            raise ContractError("Source daily threshold flag differs from its retained values")
        days[day] = row
    if not stations or not days:
        raise ContractError("Original stations and daily support are required")
    episodes = set()
    for row in value["high_flow_episodes"]:
        key = _id(row["event_id"], "original episode")
        if key in episodes or _date(row["end_date"]) < _date(row["start_date"]):
            raise ContractError("Source high-flow episodes repeat or have reversed dates")
        episodes.add(key)
    return value


def _source(workspace, collection_id, source_id, *, include_value=True):
    from .common import relative_file
    collection = workspace._get("sources", collection_id)
    entries = [entry for entry in collection["entries"] if entry["id"] == source_id]
    if len(entries) != 1:
        raise ContractError("Original observational source entry is absent or ambiguous")
    entry = entries[0]
    for member in [entry["body"], *entry.get("companions", []), collection["original_manifest"]]:
        original = relative_file(workspace.root, member["object"])
        if original.stat().st_size != member["bytes"] or file_sha256(original) != member["sha256"]:
            raise ContractError("Original observational source or companion changed")
    path = relative_file(workspace.root, entry["body"]["object"])
    if entry.get("kind") != "document" or entry.get("role") != "monitoring_observed_context":
        raise ContractError("Select the registered monitoring observational document")
    expected = entry.get("body", {})
    actual = file_sha256(path)
    if expected.get("sha256") != actual or expected.get("bytes") != path.stat().st_size:
        raise ContractError("The original observational source body changed")
    # Intake validates the complete original document. A saved context is bound
    # to these exact bytes, so inspection need not materialize it again.
    value = _validate(load_json(path)) if include_value else None
    binding = {
        "source_id": source_id, "source_collection_id": collection_id,
        "source_record_id": collection["id"], "title": entry.get("title", ""),
        "filename": path.name, "bytes": path.stat().st_size, "object_sha256": actual,
    }
    return value, binding


def catalog(workspace):
    sources = []
    for collection in workspace.sources():
        for entry in collection.get("entries", []):
            if entry.get("kind") == "document" and entry.get("role") == "monitoring_observed_context":
                value, binding = _source(workspace, collection["id"], entry["id"])
                sources.append({**binding, "source_schema": value["schema"], "period": value["source_period"],
                                "stations": [{"station_id": row["station_id"],
                                              "station_name": row.get("station_name", row["station_id"]),
                                              "datum": row["datum"]}
                                             for row in value["stations"]],
                                "activities": len(value["activities"]),
                                "observations": len(value.get("observations", [])),
                                "flow_scope": value.get("flow_scope"),
                                "gauge_days": len(value["daily_flow"])})
    return {"sources": sources}


def _distance(a, b):
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    term = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371008.8 * 2 * math.asin(min(1.0, math.sqrt(term)))


def _selection(workspace, network_id, plan_id, campaign_id):
    service = _service(workspace)
    if plan_id and campaign_id:
        raise ContractError("Choose a saved plan or campaign, not both")
    campaign = service.campaign(campaign_id) if campaign_id else None
    plan = campaign["plan"] if campaign else service.get("plans", plan_id) if plan_id else None
    if plan:
        if network_id and network_id != plan["network_id"]:
            raise ContractError("Selected plan belongs to a different monitoring network")
        network_id = plan["network_id"]
    if not network_id:
        raise ContractError("Choose the original saved monitoring network")
    network = service.get("networks", network_id)
    service.verify_sources(network)
    return network, plan, campaign


def preview(workspace, *, source_collection_id, source_id, network_id=None,
            plan_id=None, campaign_id=None, station_mapping=None,
            title="Observed support for the monitoring network"):
    value, binding = _source(workspace, source_collection_id, source_id)
    network, plan, campaign = _selection(workspace, network_id, plan_id, campaign_id)
    mapping = station_mapping or {}
    if not isinstance(mapping, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items()):
        raise ContractError("Station mapping must name exact original source IDs and saved network station IDs")
    source_stations = {s["station_id"]: s for s in value["stations"]}
    native_stations = {s["id"]: s for s in network["stations"]}
    if set(mapping) - set(source_stations) or set(mapping.values()) - set(native_stations):
        raise ContractError("Station mapping contains an unknown original or saved station ID")
    if len(set(mapping.values())) != len(mapping):
        raise ContractError("Explicit source stations must map to distinct native stations")
    flow_scope = _flow_scope(value)
    by_station = defaultdict(list)
    by_station_day = defaultdict(list)
    observations_by_station = defaultdict(list)
    for row in value.get("observations", []):
        observations_by_station[row["station_id"]].append(row)
    for row in value["activities"]:
        by_station[row["station_id"]].append(row)
        by_station_day[(row["station_id"], row["date"])].append(row)
    matches = []
    resolved = {}
    selected_ids = set(plan["selected_ids"]) if plan else set()
    for key, original in source_stations.items():
        target = mapping.get(key, key if key in native_stations else None)
        native = native_stations.get(target)
        if native and target in resolved:
            raise ContractError("Two source stations would map to the same saved station")
        if native:
            resolved[target] = key
        point = native.get("geometry", {}) if native else {}
        coords = point.get("coordinates") if point.get("type") == "Point" else None
        distance = (_distance([original["longitude"], original["latitude"]], coords[:2])
                    if coords and original["datum"] == "WGS84" else None)
        records = by_station[key]
        matches.append({
            "source_station_id": key, "source_station_name": original.get("station_name", key),
            "network_station_id": target, "match": "explicit_mapping" if key in mapping else "exact_station_id" if native else "absent_from_network",
            "catchment_id": native.get("huc_id") if native else None,
            "catchment_assignment": native.get("assignment") if native else None,
            "selected_search_area": bool(native and native.get("huc_id") in selected_ids),
            "coordinate_difference_m": distance,
            "coordinate_review": ("different_datum" if original["datum"] != "WGS84" else
                                  "over_100m" if distance is not None and distance > 100 else
                                  "within_100m" if distance is not None else "unavailable"),
            "original_datum": original["datum"],
            "flow_scope_eligible": flow_scope is None or key in flow_scope["station_ids"],
            "observations": len(observations_by_station[key]),
            "activities": len(records), "sampling_dates": len({r["date"] for r in records}),
            "first_date": min((r["date"] for r in records), default=None),
            "last_date": max((r["date"] for r in records), default=None),
            "gauge_network_relation": original.get("gauge_network_relation"),
            "original_longitude": original["longitude"], "original_latitude": original["latitude"],
            "native_geometry": point if native else None,
        })
    available = {m["source_station_id"] for m in matches if m["network_station_id"]}
    episode_scope_available = (available if flow_scope is None else
                               available.intersection(flow_scope["station_ids"]))
    days = {r["date"]: r for r in value["daily_flow"]}
    visits = campaign["calendar"] if campaign else plan["calendar"]["visits"] if plan and "calendar" in plan else []
    binding_map = campaign["revision"]["site_bindings"] if campaign else {}
    calendar = []
    for visit in visits:
        day = _date(visit["date"])
        native_id = binding_map.get(visit["site_id"])
        source_station = resolved.get(native_id)
        exact = by_station_day.get((source_station, day), []) if source_station else []
        flow_applicable = _flow_applies(flow_scope, source_station, day)
        flow = days.get(day) if flow_applicable else None
        if flow_scope is not None and source_station is None:
            flow_status = "station_not_bound_to_source"
        elif flow_scope is not None and source_station not in flow_scope["station_ids"]:
            flow_status = "station_outside_flow_scope"
        elif not flow_applicable:
            flow_status = "date_outside_flow_scope"
        else:
            flow_status = "received_original_date" if flow else "outside_received_daily_series"
        possible = [m["source_station_id"] for m in matches if m["catchment_id"] == visit["site_id"] and m["network_station_id"]]
        calendar.append({
            "visit_key": visit["visit_key"], "site_id": visit["site_id"], "date": day,
            "start_local": visit.get("start_local"), "finish_local": visit.get("finish_local"),
            "planned_network_station_id": native_id, "source_station_id": source_station,
            "station_basis": "retained_campaign_binding" if native_id else "unbound_search_area",
            "source_candidates_in_search_area": possible,
            "source_activity_ids_same_date": [r["activity_id"] for r in exact],
            "source_observation_status": "same_station_same_date" if exact else "no_same_station_sample" if source_station else "station_not_bound_to_source",
            "original_flow_status": flow_status,
            "flow_scope_applicable": flow_applicable,
            "flow_gauge_station_id": flow_scope["gauge_station_id"] if flow_scope else None,
            "mean_cfs": flow["mean_cfs"] if flow else None,
            "flow_qualifiers": flow.get("qualifiers") if flow else None,
            "at_or_above_annual_p95": flow["at_or_above_annual_p95"] if flow else None,
            "source_daily_record": flow if flow else None,
            "planned_status": visit.get("status", "planned"),
        })
    episode_rows = []
    for episode in value["high_flow_episodes"]:
        overlap = [v for v in calendar if v["flow_scope_applicable"]
                   and episode["start_date"] <= v["date"] <= episode["end_date"]]
        actual = [r for r in value["activities"] if r["station_id"] in available
                  and _episode_activity(flow_scope, r)
                  and episode["start_date"] <= r["date"] <= episode["end_date"]]
        episode_rows.append({
            **episode, "matching_network_station_activities": len(actual),
            "matching_flow_scope_station_ids": sorted(episode_scope_available),
            "matching_network_station_ids": sorted({r["station_id"] for r in actual}),
            "matching_network_activity_ids": [r["activity_id"] for r in actual],
            "saved_calendar_visit_keys": [v["visit_key"] for v in overlap],
            "saved_calendar_bound_station_visit_keys": [v["visit_key"] for v in overlap if v["source_station_id"]],
        })
    selected_relations = [r for r in value["relations"]
                          if r["station_a"] in available and r["station_b"] in available]
    paired = [{**row, "both_stations_in_saved_network": row["station_a_id"] in available and row["station_b_id"] in available}
              for row in value["paired_contrasts"]]
    result = {
        "schema": SCHEMA, "title": str(title), "status": "retained_source_context",
        "source_binding": binding, "source_schema": value["schema"], "source_edition": value.get("source_edition"),
        "source_period": value["source_period"], "network_id": network["id"],
        "network_digest": digest(network), "plan_id": plan["id"] if plan else None,
        "plan_digest": digest(plan) if plan else None,
        "campaign_id": campaign["revision"]["campaign_id"] if campaign else None,
        "campaign_revision_id": campaign["revision"]["id"] if campaign else None,
        "campaign_revision_digest": digest(campaign["revision"]) if campaign else None,
        "campaign_snapshot": campaign["revision"] if campaign else None,
        "station_mapping": mapping, "station_matches": matches,
        "flow_scope": flow_scope,
        "observations": [row for row in value.get("observations", [])
                         if row["station_id"] in available],
        "network_stations_without_source": sorted(set(native_stations) - set(resolved)),
        "calendar": calendar, "high_flow_episodes": episode_rows,
        "annual_coverage": value["annual_coverage"],
        "station_year_coverage": value["station_year_coverage"],
        "monthly_coverage": value["monthly_coverage"],
        "topology": value["relations"], "matched_topology": selected_relations,
        "paired_contrasts": paired,
        "summary": {
            "source_stations": len(source_stations), "matched_stations": len(available),
            "network_stations": len(native_stations), "source_activities": len(value["activities"]),
            "matched_station_activities": sum(len(by_station[key]) for key in available),
            "source_observations": len(value.get("observations", [])),
            "matched_station_observations": sum(len(observations_by_station[key]) for key in available),
            "matched_flow_scope_stations": sum(flow_scope is None or key in flow_scope["station_ids"]
                                               for key in available),
            "source_gauge_days": len(days), "source_high_flow_episodes": len(episode_rows),
            "source_unsampled_episodes": sum(r["sampled_dates"] == 0 for r in episode_rows),
            "matched_stations_unsampled_episodes": sum(r["matching_network_station_activities"] == 0 for r in episode_rows) if episode_scope_available else None,
            "saved_calendar_visits": len(calendar),
            "visits_with_received_daily_flow": sum(r["source_daily_record"] is not None for r in calendar),
            "visits_outside_received_daily_series": sum(r["original_flow_status"] == "outside_received_daily_series" for r in calendar),
            "visits_outside_flow_station_scope": sum(r["original_flow_status"] == "station_outside_flow_scope" for r in calendar),
            "visits_outside_flow_date_scope": sum(r["original_flow_status"] == "date_outside_flow_scope" for r in calendar),
            "visits_without_flow_station_binding": sum(r["original_flow_status"] == "station_not_bound_to_source" for r in calendar),
            "bound_source_station_visits": sum(r["source_station_id"] is not None for r in calendar),
            "visits_sharing_original_sample_station_date": sum(bool(r["source_activity_ids_same_date"]) for r in calendar),
            "high_flow_episodes_with_saved_calendar_date": sum(bool(r["saved_calendar_visit_keys"]) for r in episode_rows),
            "paired_contrasts_with_both_stations": sum(r["both_stations_in_saved_network"] for r in paired),
        },
        "interpretation": value["interpretation"] + [
            "Station matching uses exact original identifiers or an explicit retained mapping; activity identifiers are never used as stations.",
            "Saved-calendar overlap uses its unchanged absolute dates. It does not replay future dates into earlier years.",
            "An episode containing a planned visit has calendar overlap only. Existing collected field-event history remains in its original campaign.",
            "Source-year and month coverage includes the original full " + str(len(source_stations)) + "-station cohort. Matched-station counts are separately labeled.",
            "Original station datums are retained. NAD83 coordinates are not relabeled or transformed to WGS84; their point-distance comparison is marked different_datum.",
            "Matched observations retain their original values, censoring intervals, statuses, units, comments and source row identities.",
            ("Daily flow and episode activity/calendar support apply only to the original gauge station " + flow_scope["gauge_station_id"] + ". Episode sampling counts include original Sample-Routine activities only."
             if flow_scope else "This unscoped source retains its original regional daily-flow date-context behavior."),
        ],
    }
    return result


def prepare(workspace, **selection):
    result = preview(workspace, **selection)
    return workspace._save(COLLECTION, result)


def inspect(workspace, context_id):
    record = workspace._get(COLLECTION, context_id)
    if record.get("schema") != SCHEMA:
        raise ContractError("Saved monitoring context has an unsupported schema")
    _, retained_binding = _source(workspace, record["source_binding"]["source_collection_id"],
                                  record["source_binding"]["source_id"], include_value=False)
    if retained_binding != record["source_binding"]:
        raise ContractError("Saved monitoring context differs from its original source binding")
    service = _service(workspace)
    network = service.get("networks", record["network_id"])
    from .monitoring_sources import verify_retained_binding
    for binding in network["source_bindings"].values():
        if binding:
            verify_retained_binding(workspace, binding)
    if digest(network) != record["network_digest"]:
        raise ContractError("The retained monitoring network differs")
    if record.get("plan_id"):
        plan = service.get("plans", record["plan_id"])
        if digest(plan) != record["plan_digest"] or plan["network_id"] != network["id"]:
            raise ContractError("The retained monitoring plan differs")
    if record.get("campaign_revision_id"):
        revision = service.get("revisions", record["campaign_revision_id"])
        if digest(revision) != record["campaign_revision_digest"] or revision != record["campaign_snapshot"]:
            raise ContractError("The retained campaign revision differs")
        if revision["plan_id"] != record["plan_id"] or revision["network_id"] != record["network_id"]:
            raise ContractError("Saved campaign context points to a different plan")
    return record


def list_saved(workspace):
    rows = []
    for path in sorted((workspace.root / COLLECTION).glob("*.json")):
        row = workspace._get(COLLECTION, path.stem)
        if row.get("schema") != SCHEMA:
            raise ContractError("Saved monitoring context has an unsupported schema")
        rows.append({key: row.get(key) for key in ("id", "title", "network_id", "plan_id", "campaign_id",
                                                  "campaign_revision_id", "source_period", "summary")})
    return {"records": rows}


def _csv(rows):
    from .monitoring_workspace import csv_text
    fields = list(dict.fromkeys(key for row in rows for key in row))
    return csv_text(rows, fields).encode("utf-8")


def report_html(record):
    esc = lambda value: html.escape(str(value if value is not None else ""))
    def table(rows, fields):
        return "<div class='table'><table><thead><tr>" + "".join("<th>"+esc(k.replace("_", " "))+"</th>" for k in fields) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>"+esc(json.dumps(r.get(k), ensure_ascii=False) if isinstance(r.get(k), (dict, list)) else r.get(k))+"</td>" for k in fields) + "</tr>" for r in rows) + "</tbody></table></div>"
    summary = table([record["summary"]], list(record["summary"]))
    stations = table(record["station_matches"], ["source_station_id", "network_station_id", "match", "catchment_id", "selected_search_area", "original_datum", "coordinate_difference_m", "coordinate_review", "activities", "observations", "sampling_dates", "gauge_network_relation"])
    calendar = table(record["calendar"], ["visit_key", "date", "planned_network_station_id", "source_station_id", "station_basis", "original_flow_status", "mean_cfs", "flow_qualifiers", "at_or_above_annual_p95", "source_activity_ids_same_date"])
    episodes = table(record["high_flow_episodes"], ["event_id", "start_date", "end_date", "peak_cfs", "sampled_dates", "matching_network_station_activities", "saved_calendar_visit_keys"])
    pairs = table(record["paired_contrasts"], ["date", "analyte", "upstream_station_id", "downstream_station_id", "contrast_unit", "downstream_direction", "downstream_minus_upstream_lower", "downstream_minus_upstream_upper", "downstream_difference_lower_open", "downstream_difference_upper_open", "clock_separation_minutes", "both_stations_in_saved_network"])
    topology = table(record["topology"], ["station_a", "station_b", "relation", "relation_basis", "path"])
    observations = table(record.get("observations", []), ["observation_id", "station_id", "activity_id", "date", "activity_type", "characteristic", "status", "result_value", "limit_value", "lower", "upper", "upper_unbounded", "unit", "method", "source_comment_flags", "source_result_comment", "source_file", "source_row"])
    notes = "<ul>" + "".join("<li>"+esc(v)+"</li>" for v in record["interpretation"]) + "</ul>"
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>"+esc(record["title"])+"</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#171717;max-width:1200px;margin:32px auto;padding:0 18px}h1,h2{line-height:1.2}.table{overflow:auto;margin:14px 0}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:7px;text-align:left;vertical-align:top}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:inherit}@media print{body{max-width:none;margin:0}.table{overflow:visible}table{font-size:8px}tr{break-inside:avoid}}</style>"
            "<h1>"+esc(record["title"])+"</h1><p>Original observational context for a retained monitoring network and saved calendar.</p>"
            "<p>Period "+esc(record["source_period"]["start_inclusive"])+" to "+esc(record["source_period"]["end_inclusive"])+". Network "+esc(record["network_id"])+". Plan "+esc(record.get("plan_id"))+". Campaign revision "+esc(record.get("campaign_revision_id"))+".</p>"
            "<h2>Interpretation</h2>"+notes+"<h2>Coverage summary</h2>"+summary+"<h2>Original station matches</h2>"+stations+
            "<h2>Source network relations</h2>"+topology+"<h2>Exact saved calendar dates</h2>"+calendar+
            "<h2>Original high-flow episodes</h2>"+episodes+"<h2>Original matched-station observations</h2>"+observations+"<h2>Same-date concentration intervals in downstream order</h2>"+pairs+
            "<h2>Complete source and selection</h2><pre>"+esc(json.dumps({k: record[k] for k in ("source_binding", "source_schema", "source_edition", "station_mapping", "flow_scope") if k in record}, indent=2, ensure_ascii=False))+"</pre></html>")



def _export_members(workspace, record):
    """Describe an already inspected context and its exact original source."""
    from .monitoring_packet import bytes_member
    from .monitoring_sources import source_export_members
    yield "observed-context/context.json", bytes_member(canonical_bytes(record))
    yield "observed-context/report.html", bytes_member(report_html(record).encode("utf-8"))
    for key in ("station_matches", "calendar", "high_flow_episodes", "annual_coverage",
                "station_year_coverage", "monthly_coverage", "topology", "paired_contrasts"):
        yield "observed-context/" + key.replace("_", "-") + ".csv", bytes_member(_csv(record[key]))
    yield "observed-context/observations.csv", bytes_member(_csv(record.get("observations", [])))
    yield from source_export_members(workspace, "monitoring-observations", record["source_binding"])


def export_members(workspace, context_id, *, plan_id=None, network_id=None):
    """Streamable descriptors with the same names and bytes as export_files."""
    record = inspect(workspace, context_id)
    if plan_id and record.get("plan_id") != plan_id:
        raise ContractError("Selected observational context belongs to another saved plan")
    if network_id and record["network_id"] != network_id:
        raise ContractError("Selected observational context belongs to another saved network")
    yield from _export_members(workspace, record)


def export_files(workspace, context_id, *, plan_id=None, network_id=None):
    record = inspect(workspace, context_id)
    if plan_id and record.get("plan_id") != plan_id:
        raise ContractError("Selected observational context belongs to another saved plan")
    if network_id and record["network_id"] != network_id:
        raise ContractError("Selected observational context belongs to another saved network")
    files = {"observed-context/context.json": canonical_bytes(record),
             "observed-context/report.html": report_html(record).encode("utf-8")}
    for key in ("station_matches", "calendar", "high_flow_episodes", "annual_coverage",
                "station_year_coverage", "monthly_coverage", "topology", "paired_contrasts"):
        files["observed-context/" + key.replace("_", "-") + ".csv"] = _csv(record[key])
    files["observed-context/observations.csv"] = _csv(record.get("observations", []))
    originals = export_source(workspace, "monitoring-observations", record["source_binding"])
    files.update(originals)
    return files



def export_context(workspace, *, context_id, export_root=None):
    """Stream the complete retained source context through original file tickets."""
    import uuid
    from .monitoring_packet import add_member, bytes_member, retain_packet
    service = _service(workspace)
    if export_root is not None:
        service.export_root = Path(export_root).resolve()
    record = inspect(workspace, context_id)
    files = {}
    for name, member in _export_members(workspace, record):
        add_member(files, name, member)
    add_member(files, "manifest.json", bytes_member(canonical_bytes({
        "schema": "upstate.monitoring-context-export/v1", "context_id": record["id"],
        "files": [{"path": name, "bytes": member["bytes"], "sha256": member["sha256"]}
                  for name, member in sorted(files.items())]})))
    base = service.export_root or workspace.root.parent / (workspace.root.name + "-monitoring-exports")
    folder = base / ("monitoring-context-" + uuid.uuid4().hex)
    folder.mkdir(parents=True, exist_ok=False)
    path = folder / "monitoring-observed-context.zip"
    retain_packet(path, files, metadata="export")
    return service._download(path, {"format": "observed-context", "context_id": record["id"],
                                    "network_id": record["network_id"], "plan_id": record["plan_id"],
                                    "files": len(files)})


def verify_workspace(workspace):
    ids = [path.stem for path in sorted((workspace.root / COLLECTION).glob("*.json"))]
    for identity in ids:
        inspect(workspace, identity)
    return {"observational_contexts": len(ids)}


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("catalog")
    for name in ("preview", "prepare"):
        command = commands.add_parser(name)
        command.add_argument("--selection", type=Path, required=True)
        command.add_argument("--output", type=Path, required=True)
    command = commands.add_parser("inspect")
    command.add_argument("--id", required=True)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    if args.command == "catalog":
        result = catalog(workspace)
    elif args.command == "inspect":
        result = inspect(workspace, args.id)
    else:
        result = (preview if args.command == "preview" else prepare)(workspace, **load_json(args.selection))
        from .monitoring_common import atomic_json
        atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
