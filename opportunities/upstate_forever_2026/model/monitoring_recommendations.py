"""Source-bound observation gaps and editable proposed monitoring programmes.

Recommendations describe retained observations and explicit operator goals.
The existing native monitoring solver and calendar own any requested design.
"""
from __future__ import annotations
import argparse
import copy
import html
import json
import re
import uuid
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .monitoring_common import ContractError, canonical_bytes, digest, held, atomic_json, load_json
from . import monitoring_observed_context as observed_context

COLLECTION = "monitoring_recommendations"
DESIGNS = "monitoring_recommendation_designs"
SCHEMA = "upstate.monitoring_recommendations/v1"
COHORT_FIELDS = ("characteristic", "method", "unit", "fraction", "result_value_type", "speciation",
    "method_id", "method_context", "method_name", "method_specification", "activity_type",
    "sample_media", "sample_media_subdivision", "sample_fraction", "value_type", "weight_basis",
    "analytical_fraction", "depth_value", "depth_unit", "result_depth_value", "result_depth_unit",
    "project_id", "organization_id")
TARGET_KEYS = {"id", "station_id", "cohort_id", "months", "minimum_dates_per_month",
               "proposed_visits", "reporting_limit", "reporting_limit_basis", "flow_goal",
               "reason", "priority", "included", "setup_cost", "per_visit_cost",
               "cost_basis", "sensitivity_basis"}
SELECTION_KEYS = {"context_id", "title", "operator", "recorded_at", "evidence_start",
                  "evidence_end", "notes", "planning_basis", "targets"}


def _text(value, name, *, empty=False, limit=20000):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ContractError(name + " must be " + ("a" if empty else "a nonempty") + " text value")
    return value


def _id(value, name):
    value = _text(value, name, limit=200)
    if value != value.strip() or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        raise ContractError(name + " must be an exact identifier without whitespace")
    return value


def _date(value, name):
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
        return value
    except (ValueError, TypeError) as exc:
        raise ContractError(name + " must be YYYY-MM-DD") from exc


def _time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
    except (AttributeError, ValueError, TypeError) as exc:
        raise ContractError("recorded_at needs an actual ISO timestamp including timezone") from exc
    return value


def _integer(value, name, minimum=0):
    if type(value) is not int or value < minimum:
        raise ContractError(name + " must be an integer >= " + str(minimum))
    return value


def _decimal(value, name, *, money=False):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", value):
        raise ContractError(name + " must be null or an explicit nonnegative decimal string")
    try:
        d = Decimal(value)
    except InvalidOperation as exc:
        raise ContractError(name + " is not an exact decimal") from exc
    if not d.is_finite() or d < 0 or len(value) > 100:
        raise ContractError(name + " is outside its supported numeric range")
    if money:
        if d * 100 != (d * 100).to_integral_value() or d * 100 > 10**12:
            raise ContractError(name + " needs at most two decimal places and <= 10000000000")
        return format(d, ".2f")
    return value


def _cohort(row):
    fields = {key: {"present": key in row, "value": row.get(key)} for key in COHORT_FIELDS}
    return digest(fields), fields


def _label(fields):
    def show(key):
        field = fields[key]
        return str(field["value"]) if field["present"] and field["value"] is not None else "unspecified"
    return " · ".join(show(key) for key in ("characteristic", "method", "unit", "fraction"))


def _context_view(record):
    cohorts = {}
    for row in record.get("observations", []):
        key, fields = _cohort(row)
        item = cohorts.setdefault(key, {"id": key, "fields": fields, "label": _label(fields),
                                       "observation_count": 0, "station_ids": set()})
        item["observation_count"] += 1
        item["station_ids"].add(row["station_id"])
    values = [{**row, "station_ids": sorted(row["station_ids"])} for _, row in sorted(cohorts.items())]
    return {"context_id": record["id"], "context_digest": digest(record),
            "network_id": record["network_id"], "network_digest": record["network_digest"],
            "source_binding": copy.deepcopy(record["source_binding"]),
            "source_period": copy.deepcopy(record["source_period"]),
            "stations": copy.deepcopy(record["station_matches"]), "cohorts": values,
            "flow_scope": copy.deepcopy(record.get("flow_scope")),
            "summary": copy.deepcopy(record["summary"])}


def context(workspace, context_id):
    record = observed_context.inspect(workspace, context_id)
    result = _context_view(record)
    if record.get("plan_id"):
        from .monitoring_workspace import MonitoringWorkspace
        result["design_configuration"] = copy.deepcopy(MonitoringWorkspace(workspace).get("plans", record["plan_id"]).get("configuration"))
    else:
        result["design_configuration"] = None
    return result


def list_saved(workspace):
    records = []
    for path in sorted((workspace.root / COLLECTION).glob("*.json")):
        value = workspace._get(COLLECTION, path.stem)
        records.append({key: value.get(key) for key in ("id", "title", "context_id",
            "network_id", "parent_id", "revision", "operator", "recorded_at", "summary", "budget")})
    return {"records": records}


def catalog(workspace):
    return {"contexts": observed_context.list_saved(workspace)["records"],
            "recommendations": list_saved(workspace)["records"], "currency": "USD",
            "semantics": "Historical evidence and proposed future sampling remain separate."}


def _selection(record, selection):
    if not isinstance(selection, dict) or set(selection) - SELECTION_KEYS:
        raise ContractError("Unknown or invalid recommendation selection fields")
    if selection.get("context_id") != record["id"]:
        raise ContractError("Choose the exact retained observed context")
    result = copy.deepcopy(selection)
    for key in ("title", "operator", "planning_basis"):
        _text(result.get(key), key)
    for key in ("notes",):
        result[key] = _text(result.get(key, ""), key, empty=True)
    result["recorded_at"] = _time(result.get("recorded_at"))
    start, end = _date(result.get("evidence_start"), "evidence_start"), _date(result.get("evidence_end"), "evidence_end")
    if end < start:
        raise ContractError("The selected evidence window is reversed")
    period = record["source_period"]
    if start < period["start_inclusive"] or end > period["end_inclusive"]:
        raise ContractError("The evidence window must stay inside the declared original source period")
    targets = result.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ContractError("Add at least one explicit station/cohort target")
    view = _context_view(record)
    stations = {r["source_station_id"]: r for r in view["stations"]}
    cohorts = {r["id"]: r for r in view["cohorts"]}
    seen = set()
    for row in targets:
        if not isinstance(row, dict) or set(row) - TARGET_KEYS:
            raise ContractError("Unknown or invalid target fields")
        key = _id(row.get("id"), "target.id")
        if key in seen:
            raise ContractError("Target IDs must be unique")
        seen.add(key)
        if row.get("station_id") not in stations or row.get("cohort_id") not in cohorts:
            raise ContractError("Targets must use an original source station and a retained exact cohort")
        months = row.get("months")
        if not isinstance(months, list) or not months or any(type(v) is not int or not 1 <= v <= 12 for v in months) or len(set(months)) != len(months):
            raise ContractError("Target months must be distinct integers 1 through 12")
        row["months"] = sorted(months)
        for key in ("minimum_dates_per_month", "proposed_visits"):
            _integer(row.get(key), key)
        _integer(row.get("priority"), "priority", 1)
        if row["priority"] > 5 or type(row.get("included")) is not bool:
            raise ContractError("Priority must be 1 through 5 and included must be boolean")
        if row.get("flow_goal") not in {"any", "high_flow"}:
            raise ContractError("flow_goal must be any or high_flow")
        for key in ("reason",):
            _text(row.get(key), key)
        for key in ("reporting_limit_basis", "cost_basis", "sensitivity_basis"):
            row[key] = _text(row.get(key, ""), key, empty=True)
        for key in ("setup_cost", "per_visit_cost"):
            row[key] = _decimal(row.get(key), key, money=True)
        row["reporting_limit"] = _decimal(row.get("reporting_limit"), "reporting_limit")
        if row["reporting_limit"] is not None and not row["reporting_limit_basis"].strip():
            raise ContractError("A proposed reporting limit needs its explicit scientific/operator rationale")
        if any(row[k] is not None for k in ("setup_cost", "per_visit_cost")) and not row["cost_basis"].strip():
            raise ContractError("Entered planning costs need an explicit source or operator basis")
    return result


def _as_decimal(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() else None
    except InvalidOperation:
        return None


def compile_recommendations(record, selection):
    """Pure calculation over an already inspected retained context."""
    selection = _selection(record, selection)
    view = _context_view(record)
    stations = {r["source_station_id"]: r for r in view["stations"]}
    cohorts = {r["id"]: r for r in view["cohorts"]}
    by_key = {}
    for row in record.get("observations", []):
        by_key.setdefault((row["station_id"], _cohort(row)[0]), []).append(row)
    rows, gaps, required, unbound, bindings = [], [], set(), [], {}
    known_total, unknown = 0, []
    start, end = selection["evidence_start"], selection["evidence_end"]
    for target in selection["targets"]:
        station, cohort = stations[target["station_id"]], cohorts[target["cohort_id"]]
        evidence = [r for r in by_key.get((target["station_id"], target["cohort_id"]), [])
                    if start <= r["date"] <= end and int(r["date"][5:7]) in target["months"]]
        month_rows = []
        for month in target["months"]:
            matched = [r for r in evidence if int(r["date"][5:7]) == month]
            dates = sorted({r["date"] for r in matched})
            item = {"target_id": target["id"], "station_id": target["station_id"],
                    "cohort_id": target["cohort_id"], "month": month,
                    "observed_dates": len(dates), "dates": dates,
                    "years_with_observations": sorted({d[:4] for d in dates}),
                    "minimum_dates": target["minimum_dates_per_month"],
                    "date_gap": max(0, target["minimum_dates_per_month"] - len(dates)),
                    "observation_ids": [r["observation_id"] for r in matched],
                    "activity_ids": sorted({r["activity_id"] for r in matched})}
            month_rows.append(item)
            gaps.append(item)
        desired = _as_decimal(target["reporting_limit"])
        unit_field = cohort["fields"]["unit"]
        unit = unit_field["value"] if unit_field["present"] else None
        limits, limit_unknown, limit_incompatible = [], [], []
        for original in evidence:
            limit = _as_decimal(original.get("limit_value"))
            if limit is None:
                limit_unknown.append(original["observation_id"])
                continue
            limit_unit = original.get("limit_unit", original.get("unit"))
            if unit is None or limit_unit != unit:
                limit_incompatible.append(original["observation_id"])
                continue
            limits.append({"observation_id": original["observation_id"],
                           "value": str(limit), "unit": limit_unit,
                           "above_target": bool(limit > desired) if desired is not None else None})
        scope = record.get("flow_scope")
        flow_eligible = bool(scope and target["station_id"] in scope["station_ids"])
        episodes = []
        if flow_eligible:
            for ep in record.get("high_flow_episodes", []):
                # An event is historical evidence only when it overlaps this
                # exact source window and one of the chosen calendar months.
                lo, hi = max(start, ep["start_date"], scope.get("start_inclusive") or start), min(end, ep["end_date"], scope.get("end_inclusive") or end)
                if lo > hi:
                    continue
                sample_dates = sorted({r["date"] for r in evidence if lo <= r["date"] <= hi
                                       and r.get("activity_type") == "Sample-Routine"})
                from datetime import timedelta
                cursor, months = date.fromisoformat(lo), set()
                final = date.fromisoformat(hi)
                while cursor <= final:
                    months.add(cursor.month)
                    cursor += timedelta(days=1)
                if not months.intersection(target["months"]):
                    continue
                episodes.append({"event_id": ep["event_id"], "start_date": ep["start_date"],
                                 "end_date": ep["end_date"], "sampled_dates": sample_dates,
                                 "has_selected_routine_observation": bool(sample_dates),
                                 "activity_type_unknown_observation_ids": [r["observation_id"] for r in evidence if lo <= r["date"] <= hi and not r.get("activity_type")]})
        setup = None if target["setup_cost"] is None else int(Decimal(target["setup_cost"]) * 100)
        visit = None if target["per_visit_cost"] is None else int(Decimal(target["per_visit_cost"]) * 100)
        total = None if setup is None or visit is None else setup + visit * target["proposed_visits"]
        if target["included"]:
            if total is None:
                unknown.append(target["id"])
            else:
                known_total += total
            catchment, native = station.get("catchment_id"), station.get("network_station_id")
            if catchment and native:
                required.add(catchment)
                bindings.setdefault(catchment, set()).add(native)
            else:
                unbound.append(target["id"])
        warnings = []
        if not station.get("network_station_id"):
            warnings.append("The original source station is not bound to the saved network.")
        if not station.get("catchment_id"):
            warnings.append("No retained source-catchment assignment is available.")
        if target["flow_goal"] == "high_flow" and not flow_eligible:
            warnings.append("The received flow series is not declared applicable to this exact station; event coverage is unknown.")
        if not evidence:
            warnings.append("No matching retained observation occurs in the selected window and months; this is source-record absence.")
        if any(not f["present"] or f["value"] is None for f in cohort["fields"].values()):
            warnings.append("Some original cohort metadata is unspecified; the exact missing/null fields remain separate.")
        if target["sensitivity_basis"].strip():
            warnings.append("Sensitivity rationale is operator-supplied context; this compiler computes no model information gain.")
        if total is None:
            warnings.append("The target's complete planning cost is unknown.")
        rows.append({"target_id": target["id"], "target": copy.deepcopy(target),
                     "station": copy.deepcopy(station), "cohort": copy.deepcopy(cohort),
                     "evidence": {"start": start, "end": end, "observations": len(evidence),
                         "distinct_dates": len({r["date"] for r in evidence}),
                         "observation_ids": [r["observation_id"] for r in evidence],
                         "activity_ids": sorted({r["activity_id"] for r in evidence}),
                         "status_counts": dict(Counter(str(r.get("status")) for r in evidence)),
                         "monthly": month_rows, "reporting_limits": limits,
                         "unknown_limit_observation_ids": limit_unknown,
                         "incompatible_limit_unit_observation_ids": limit_incompatible,
                         "flow_scope_eligible": flow_eligible, "high_flow_episodes": episodes},
                     "cost": {"currency": "USD", "setup_cents": setup,
                              "per_visit_cents": visit, "proposed_visits": target["proposed_visits"],
                              "total_cents": total, "basis": target["cost_basis"]},
                     "warnings": warnings})
    conflicts = [{"catchment_id": k, "station_ids": sorted(v)} for k, v in sorted(bindings.items()) if len(v) > 1]
    return {"schema": SCHEMA, "title": selection["title"], "selection": selection,
            "context_id": record["id"], "context_digest": digest(record),
            "network_id": record["network_id"], "network_digest": record["network_digest"],
            "source_binding": copy.deepcopy(record["source_binding"]),
            "source_period": copy.deepcopy(record["source_period"]),
            "context_snapshot": copy.deepcopy(record), "operator": selection["operator"],
            "recorded_at": selection["recorded_at"], "targets": rows, "gaps": gaps,
            "budget": {"currency": "USD", "known_total_cents": known_total,
                       "unknown_target_ids": unknown, "complete": not unknown,
                       "basis": "Sum of included target setup plus proposed visits times entered per-visit cost; overlaps are not automatically discounted."},
            "handoff": {"required_catchment_ids": sorted(required), "unbound_target_ids": unbound,
                        "station_binding_conflicts": conflicts,
                        "station_bindings": {k: next(iter(v)) for k, v in sorted(bindings.items()) if len(v) == 1},
                        "requirements": [copy.deepcopy(r["target"]) for r in rows if r["target"]["included"]]},
            "summary": {"targets": len(rows), "included": sum(r["target"]["included"] for r in rows),
                        "month_gaps": sum(r["date_gap"] > 0 for r in gaps),
                        "missing_dates_to_operator_goal": sum(r["date_gap"] for r in gaps),
                        "unbound_targets": len(unbound)},
            "interpretation": [
                "Monthly coverage goals count distinct historical dates across the selected evidence window, not laboratory replicates or a per-year target.",
                "Proposed future visits, desired reporting limits, priorities and costs are explicit planning choices, not collected observations or guaranteed information gain.",
                "Original method, fraction, unit, value type, speciation and missing/null metadata remain separate cohorts. No unit conversion or censored-value substitution occurs.",
                "A high-flow episode describes the original gauge and period; a future calendar cannot promise a storm or substitute nearby-gauge flow.",
                "Existing network/design/calendar actions select catchment search areas. Station bindings, laboratory scope and event-triggered field work require explicit operator decisions.",
                "Included target costs are an itemized authored planning estimate. The requested native design retains its own entered budget and costs separately."
            ]}


def preview(workspace, *, selection):
    record = observed_context.inspect(workspace, selection.get("context_id") if isinstance(selection, dict) else None)
    return compile_recommendations(record, selection)


def _operation(workspace, operation_id, request, perform):
    key = digest({"operation_id": _id(operation_id, "operation_id")})
    path = workspace.root / "monitoring_recommendation_operations" / (key + ".json")
    fingerprint = digest(request)
    with held(path.with_suffix(".lock")):
        if path.exists():
            prior = load_json(path)
            if prior["fingerprint"] != fingerprint:
                raise ContractError("This operation ID already belongs to a different request")
            return workspace._get(prior["collection"], prior["record_id"])
        # Recover death after immutable save, before the small operation index.
        for collection in (COLLECTION, DESIGNS):
            for candidate in sorted((workspace.root / collection).glob("*.json")):
                row = workspace._get(collection, candidate.stem)
                if row.get("operation_id") == operation_id:
                    if row.get("request_fingerprint") != fingerprint:
                        raise ContractError("This operation ID has a different retained immutable request")
                    atomic_json(path, {"fingerprint": fingerprint, "collection": collection, "record_id": row["id"]})
                    return row
        collection, row = perform(fingerprint)
        atomic_json(path, {"fingerprint": fingerprint, "collection": collection, "record_id": row["id"]})
        return row


def prepare(workspace, *, selection, operation_id, parent_id=None, expected_parent_digest=None):
    request = copy.deepcopy({"kind": "prepare", "selection": selection, "parent_id": parent_id,
                             "expected_parent_digest": expected_parent_digest})
    selection = request["selection"]
    def perform(fingerprint):
        parent = inspect(workspace, parent_id) if parent_id else None
        if parent is None and expected_parent_digest is not None:
            raise ContractError("A parent digest requires the exact parent proposal")
        if parent is not None:
            if parent["id"] != expected_parent_digest:
                raise ContractError("The selected parent proposal differs; reopen its exact immutable edition")
            if parent["context_id"] != selection.get("context_id"):
                raise ContractError("Changing the source context starts a new proposal family")
        value = preview(workspace, selection=selection)
        value.update(parent_id=parent_id, revision=parent["revision"] + 1 if parent else 1,
                     operation_id=operation_id, request_fingerprint=fingerprint,
                     request_payload=copy.deepcopy(request))
        return COLLECTION, workspace._save(COLLECTION, value)
    return _operation(workspace, operation_id, request, perform)


def inspect(workspace, recommendation_id):
    value = workspace._get(COLLECTION, recommendation_id)
    if value.get("schema") != SCHEMA:
        raise ContractError("Unsupported saved recommendation schema")
    context_value = observed_context.inspect(workspace, value["context_id"])
    if digest(context_value) != value["context_digest"] or context_value != value["context_snapshot"]:
        raise ContractError("The saved recommendation differs from its retained original observed context")
    # Native IDs validate payload bytes; ancestry validates the actual family.
    seen, current = set(), value
    while current:
        if current["id"] in seen:
            raise ContractError("Recommendation ancestry contains a cycle")
        seen.add(current["id"])
        _integer(current.get("revision"), "proposal revision", 1)
        _id(current.get("operation_id"), "operation_id")
        parent_id = current.get("parent_id")
        expected = current.get("request_payload")
        if (not isinstance(expected, dict) or set(expected) != {"kind", "selection", "parent_id", "expected_parent_digest"}
                or expected["kind"] != "prepare" or expected["parent_id"] != parent_id
                or expected["expected_parent_digest"] != parent_id
                or _selection(context_value, expected["selection"]) != current["selection"]
                or current.get("request_fingerprint") != digest(expected)):
            raise ContractError("Proposal request identity differs from its complete saved selection")
        if parent_id is None:
            if current["revision"] != 1:
                raise ContractError("A proposal without a parent must be revision 1")
            break
        parent = workspace._get(COLLECTION, parent_id)
        if (parent.get("schema") != SCHEMA or parent.get("context_id") != value["context_id"]
                or current["revision"] != parent.get("revision", 0) + 1):
            raise ContractError("Proposal ancestry differs in source context or revision sequence")
        current = parent
    recomputed = compile_recommendations(context_value, value["selection"])
    for key in recomputed:
        if key != "schema" and value.get(key) != recomputed[key]:
            raise ContractError("The saved recommendation no longer matches its exact calculation: " + key)
    return value


def history(workspace, recommendation_id):
    result, seen = [], set()
    current = inspect(workspace, recommendation_id)
    while current:
        if current["id"] in seen:
            raise ContractError("Recommendation ancestry contains a cycle")
        seen.add(current["id"])
        result.append(current)
        current = inspect(workspace, current["parent_id"]) if current.get("parent_id") else None
    return list(reversed(result))


def inspect_design(workspace, design_id):
    from .monitoring_workspace import MonitoringWorkspace
    value = workspace._get(DESIGNS, design_id)
    if value.get("schema") != "upstate.monitoring_recommendation_designs/v1":
        raise ContractError("Unsupported saved recommendation design schema")
    proposal = inspect(workspace, value["recommendation_id"])
    request = value.get("request_payload")
    if (not isinstance(request, dict) or set(request) != {"kind", "recommendation_id", "configuration", "title"}
            or request["kind"] != "design" or request["recommendation_id"] != proposal["id"]
            or request["configuration"] != value["configuration"]
            or digest(request) != value.get("request_fingerprint")):
        raise ContractError("Retained design request differs from its complete original payload")
    service = MonitoringWorkspace(workspace)
    plan = service.get("plans", value["plan_id"])
    network = service.get("networks", proposal["network_id"])
    service.verify_sources(network)
    if (digest(proposal) != value["recommendation_digest"] or digest(plan) != value["plan_digest"]
            or digest(network) != proposal["network_digest"]
            or value.get("context_id") != proposal["context_id"]
            or value.get("network_id") != proposal["network_id"]
            or plan.get("network_id") != proposal["network_id"]
            or plan.get("configuration") != value.get("configuration")
            or plan.get("title") != (request["title"] or proposal["title"] + " — native design")
            or plan.get("recommendation_id") != proposal["id"]
            or plan.get("recommendation_operation_id") != value.get("operation_id")
            or plan.get("recommendation_request_fingerprint") != value.get("request_fingerprint")
            or value.get("target_calendar") != _target_calendar(proposal, plan)
            or value.get("status") != plan.get("status")
            or value.get("native_cost") != plan.get("cost")
            or value.get("proposal_budget") != proposal["budget"]
            or value.get("station_bindings") != proposal["handoff"]["station_bindings"]):
        raise ContractError("Saved native design differs from its proposal, network, configuration or exact calendar")
    return value


def designs(workspace, recommendation_id):
    inspect(workspace, recommendation_id)
    result = []
    for path in sorted((workspace.root / DESIGNS).glob("*.json")):
        value = workspace._get(DESIGNS, path.stem)
        if value.get("recommendation_id") == recommendation_id:
            result.append(inspect_design(workspace, path.stem))
    return result


def _target_calendar(proposal, plan):
    visits = plan.get("calendar", {}).get("visits", [])
    outcomes = []
    for target in proposal["handoff"]["requirements"]:
        station = next(r["station"] for r in proposal["targets"] if r["target_id"] == target["id"])
        matched = [v for v in visits if v["site_id"] == station["catchment_id"]
                   and int(v["date"][5:7]) in target["months"]]
        outcomes.append({"target_id": target["id"], "catchment_id": station["catchment_id"],
                         "station_id": target["station_id"],
                         "native_station_id": station["network_station_id"],
                         "proposed_visits": target["proposed_visits"],
                         "calendar_visits_in_selected_months": len(matched),
                         "visit_keys": [v["visit_key"] for v in matched],
                         "calendar_count_meets_request": len(matched) >= target["proposed_visits"],
                         "flow_goal": target["flow_goal"],
                         "field_scope": "Proposed source-station binding and laboratory scope; no collected event is created."})
    return outcomes


def design(workspace, *, recommendation_id, configuration, operation_id, title=None):
    """Invoke the maintained solver once, preserving planning/source distinctions."""
    request = copy.deepcopy({"kind": "design", "recommendation_id": recommendation_id,
                             "configuration": configuration, "title": title})
    configuration = request["configuration"]
    def perform(fingerprint):
        from .monitoring_workspace import MonitoringWorkspace
        from .monitoring_design import solve_design
        from .monitoring_campaign import rounds
        proposal = inspect(workspace, recommendation_id)
        if not isinstance(configuration, dict):
            raise ContractError("Supply the complete explicit native design configuration")
        if not proposal["summary"]["included"]:
            raise ContractError("Include at least one sampling target before preparing a native design")
        if proposal["handoff"]["unbound_target_ids"]:
            raise ContractError("Bind target source stations to the retained network before a native design")
        if proposal["handoff"]["station_binding_conflicts"]:
            raise ContractError("This native campaign binds one station per catchment; split or reconcile the conflicting targets")
        config = copy.deepcopy(configuration)
        required = set(proposal["handoff"]["required_catchment_ids"])
        if not required.issubset(set(config.get("required_ids", []))):
            raise ContractError("Explicit native required_ids must include every selected target's catchment")
        calendar = config.get("calendar")
        if not isinstance(calendar, dict):
            raise ContractError("Supply the full native calendar")
        if _date(calendar.get("start_date"), "calendar.start_date") <= proposal["selection"]["evidence_end"]:
            raise ContractError("A proposed future campaign must begin after the selected historical evidence window")
        rounds(calendar)  # Original calendar owns its complete validation.
        service = MonitoringWorkspace(workspace)
        network = service.get("networks", proposal["network_id"])
        service.verify_sources(network)
        if digest(network) != proposal["network_digest"]:
            raise ContractError("Native design network differs from the source-bound proposal")
        # A crashed call after plan save is recovered through its original marker.
        plan = None
        for path in sorted((workspace.root / "monitoring_plans").glob("*.json")):
            candidate = service.get("plans", path.stem)
            if candidate.get("recommendation_operation_id") == operation_id:
                if candidate.get("recommendation_request_fingerprint") != fingerprint:
                    raise ContractError("Retained solver plan has a different exact request")
                plan = candidate
                break
        if plan is None:
            calculated = solve_design(network, config)
            calculated.update(title=title or proposal["title"] + " — native design",
                              recommendation_id=recommendation_id,
                              recommendation_operation_id=operation_id,
                              recommendation_request_fingerprint=fingerprint)
            plan = service.save("plans", calculated)
        outcomes = _target_calendar(proposal, plan)
        value = {"recommendation_id": recommendation_id, "recommendation_digest": digest(proposal),
                 "network_id": proposal["network_id"], "context_id": proposal["context_id"],
                 "plan_id": plan["id"], "plan_digest": digest(plan), "configuration": config,
                 "operation_id": operation_id, "request_fingerprint": fingerprint,
                 "request_payload": copy.deepcopy(request), "status": plan["status"], "target_calendar": outcomes,
                 "station_bindings": proposal["handoff"]["station_bindings"],
                 "native_cost": plan.get("cost"), "proposal_budget": proposal["budget"],
                 "interpretation": "The unchanged native solver enforces its geographic/calendar/budget constraints. Analyte, reporting-limit and high-flow goals remain explicit field/laboratory requirements."}
        return DESIGNS, workspace._save(DESIGNS, value)
    return _operation(workspace, operation_id, request, perform)


def report_html(record, native_designs=None):
    esc = lambda v: html.escape("" if v is None else str(v))
    def table(headers, rows):
        return "<div class='table'><table><thead><tr>" + "".join("<th>" + esc(x) + "</th>" for x in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(x) + "</td>" for x in row) + "</tr>" for row in rows) + "</tbody></table></div>"
    def money(cents):
        return "Unknown" if cents is None else "USD " + format(Decimal(cents) / 100, ".2f")
    targets = table(["Target / source station", "Retained analytical cohort", "Months", "Historic dates / goal", "Proposed visits", "Planning cost", "Rationale"], [
        (r["target_id"] + " / " + r["target"]["station_id"], r["cohort"]["label"],
         ", ".join(str(m) for m in r["target"]["months"]),
         "; ".join(str(m["month"]) + ": " + str(m["observed_dates"]) + " / " + str(m["minimum_dates"]) for m in r["evidence"]["monthly"]),
         r["target"]["proposed_visits"], money(r["cost"]["total_cents"]),
         r["target"]["reason"] + (" [Excluded from proposal]" if not r["target"]["included"] else ""))
        for r in record["targets"]])
    details = ""
    for row in record["targets"]:
        target = row["target"]
        details += "<section><h2>" + esc(target["id"]) + ": " + esc(row["cohort"]["label"]) + "</h2>"
        details += "<p>Reporting-limit target: " + esc(target["reporting_limit"] if target["reporting_limit"] is not None else "Not entered") + ". " + esc(target["reporting_limit_basis"]) + "</p>"
        details += "<p>Cost basis: " + esc(target["cost_basis"] or "Not entered") + ". Sensitivity context: " + esc(target["sensitivity_basis"] or "No model-sensitivity basis selected") + ".</p>"
        details += "<p>Flow goal: " + esc(target["flow_goal"]) + "; matching historical episodes: " + str(len(row["evidence"]["high_flow_episodes"])) + ". Original station flow applicability: " + str(row["evidence"]["flow_scope_eligible"]) + ".</p>"
        details += "<ul>" + "".join("<li>" + esc(x) + "</li>" for x in row["warnings"]) + "</ul>"
        details += "<details><summary>Exact supporting observation and activity identifiers</summary><pre>" + esc(json.dumps({"observations": row["evidence"]["observation_ids"], "activities": row["evidence"]["activity_ids"], "cohort": row["cohort"]["fields"]}, ensure_ascii=False, indent=2)) + "</pre></details></section>"
    native = ""
    for item in native_designs or []:
        native += "<h2>Saved native design " + esc(item["plan_id"]) + "</h2><p>Status: " + esc(item["status"]) + ".</p>"
        native += table(["Target", "Proposed visits", "Native calendar visits in selected months", "Count met"], [
            (r["target_id"], r["proposed_visits"], r["calendar_visits_in_selected_months"], r["calendar_count_meets_request"]) for r in item["target_calendar"]])
    total = money(record["budget"]["known_total_cents"])
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>" + esc(record["title"]) + "</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eee;color:#202020;font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:28px;background:white}h1{font-size:28px}h2{font-size:20px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #bbb;padding:8px;overflow-wrap:anywhere}th{background:#eee}.table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{break-inside:avoid}details{margin:12px 0}@media(max-width:500px){main{padding:14px}}@media print{body,main{background:white}main{padding:0;max-width:none}thead{display:table-header-group}.table{overflow:visible}details{display:block}details>*{display:block}table{font-size:10px}}</style></head><body><main>"
        "<h1>" + esc(record["title"]) + "</h1><p>Proposed monitoring programme · recorded by " + esc(record["operator"]) + " at " + esc(record["recorded_at"]) + "</p>"
        "<p>Historical evidence: " + esc(record["selection"]["evidence_start"]) + " to " + esc(record["selection"]["evidence_end"]) + ". Known included planning cost: " + total + ("; complete." if record["budget"]["complete"] else "; additional selected costs remain unknown.") + "</p>"
        "<p>" + esc(record["selection"]["planning_basis"]) + "</p>" + targets + details + native +
        "<h2>Interpretation</h2><ul>" + "".join("<li>" + esc(x) + "</li>" for x in record["interpretation"]) + "</ul>"
        "<h2>Original source binding</h2><pre>" + esc(json.dumps(record["source_binding"], ensure_ascii=False, indent=2)) + "</pre>"
        "<h2>Operator notes</h2><p>" + esc(record["selection"]["notes"]) + "</p></main></body></html>")


def export_members(workspace, recommendation_id):
    from .monitoring_packet import bytes_member, add_member
    from .monitoring_sources import source_export_members
    from .monitoring_workspace import MonitoringWorkspace, csv_text
    record = inspect(workspace, recommendation_id)
    native = designs(workspace, recommendation_id)
    files = {}
    def add(name, body):
        add_member(files, name, bytes_member(body))
    add("recommendation.json", canonical_bytes(record))
    add("selection.json", canonical_bytes(record["selection"]))
    add("proposal-history.json", canonical_bytes(history(workspace, recommendation_id)))
    add("native-designs.json", canonical_bytes(native))
    add("sampling-review.html", report_html(record, native).encode("utf-8"))
    fields = ["target_id", "station_id", "cohort_id", "month", "observed_dates", "minimum_dates", "date_gap", "dates", "observation_ids", "activity_ids"]
    add("historical-month-gaps.csv", csv_text(record["gaps"], fields).encode("utf-8"))
    target_rows = [{**r["target"], "total_cost_cents": r["cost"]["total_cents"],
                    "cohort_fields": r["cohort"]["fields"], "warnings": r["warnings"]} for r in record["targets"]]
    add("proposed-targets.csv", csv_text(target_rows, ["id", "station_id", "cohort_id", "included",
        "months", "minimum_dates_per_month", "proposed_visits", "reporting_limit", "reporting_limit_basis",
        "flow_goal", "priority", "reason", "setup_cost", "per_visit_cost", "total_cost_cents",
        "cost_basis", "sensitivity_basis", "cohort_fields", "warnings"]).encode("utf-8"))
    for name, member in observed_context.export_members(workspace, record["context_id"]):
        add_member(files, name, member)
    service = MonitoringWorkspace(workspace)
    network = service.get("networks", record["network_id"])
    add("network.json", canonical_bytes(network))
    for label, binding in network["source_bindings"].items():
        if binding:
            for name, member in source_export_members(workspace, "network-" + label, binding):
                add_member(files, name, member)
    for result in native:
        plan = service.get("plans", result["plan_id"])
        if digest(plan) != result["plan_digest"]:
            raise ContractError("The selected native design differs from its retained result")
        add("native-plans/" + plan["id"] + ".json", canonical_bytes(plan))
    add("README.txt", ("Open sampling-review.html for the proposed programme. Historical observations, original sources, complete proposal history, explicit editable selection and all native designs are included.\n"
        "Monthly date targets apply across the chosen historical window. Proposed visits and costs are operator planning inputs. Native calendars do not promise storm occurrence or laboratory suitability.\n"
        "Use the original complete Workspace export/import for editable application receiving. This report bundle retains original scientific files and is not a replacement Workspace.\n").encode("utf-8"))
    add("manifest.json", canonical_bytes({"schema": "upstate.monitoring-recommendation-export/v1",
        "recommendation_id": recommendation_id, "files": [{"path": name, "bytes": member["bytes"], "sha256": member["sha256"]} for name, member in sorted(files.items())]}))
    return files


def export_recommendations(workspace, *, recommendation_id, export_root=None):
    from .monitoring_workspace import MonitoringWorkspace
    from .monitoring_packet import retain_packet
    service = MonitoringWorkspace(workspace, export_root=export_root)
    base = service.export_root or workspace.root.parent / (workspace.root.name + "-monitoring-exports")
    folder = base / ("sampling-proposal-" + uuid.uuid4().hex)
    folder.mkdir(parents=True, exist_ok=False)
    files = export_members(workspace, recommendation_id)
    path = folder / "monitoring-sampling-proposal.zip"
    retain_packet(path, files, metadata="export")
    return service._download(path, {"format": "sampling-proposal", "recommendation_id": recommendation_id,
                                    "files": len(files)})


def verify_workspace(workspace):
    records = [p.stem for p in sorted((workspace.root / COLLECTION).glob("*.json"))]
    for identity in records:
        inspect(workspace, identity)
    saved_designs = [p.stem for p in sorted((workspace.root / DESIGNS).glob("*.json"))]
    for identity in saved_designs:
        inspect_design(workspace, identity)
    return {"recommendations": len(records), "recommendation_designs": len(saved_designs)}


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("action", choices=["catalog", "context", "preview", "prepare", "inspect", "design", "export"])
    parser.add_argument("--request", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    request = load_json(args.request) if args.request else {}
    commands = {"catalog": catalog, "context": context, "preview": preview, "prepare": prepare,
                "inspect": inspect, "design": design, "export": export_recommendations}
    result = commands[args.action](Workspace(args.workspace), **request)
    if args.output:
        atomic_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
