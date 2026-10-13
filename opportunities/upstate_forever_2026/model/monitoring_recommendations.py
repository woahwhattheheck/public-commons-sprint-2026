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
from . import monitoring_native_evidence as native_evidence

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
               "cost_basis", "sensitivity_basis", "model_evidence"}
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
    keys = COHORT_FIELDS
    if row.get("sampling_cohort_schema") == "upstate.native-observation-sampling-cohort/v1":
        keys = COHORT_FIELDS + ("time_basis", "temperature_basis", "particle_size_basis",
                                "time_support", "quantity_basis", "measurement_support")
    fields = {key: {"present": key in row, "value": row.get(key)} for key in keys}
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
    result = {"context_id": record["id"], "context_digest": digest(record),
            "network_id": record["network_id"], "network_digest": record["network_digest"],
            "source_binding": copy.deepcopy(record["source_binding"]),
            "source_period": copy.deepcopy(record["source_period"]),
            "stations": copy.deepcopy(record["station_matches"]), "cohorts": values,
            "flow_scope": copy.deepcopy(record.get("flow_scope")),
            "summary": copy.deepcopy(record["summary"])}
    if record.get("source_schema") == "upstate.monitoring-observed-source/v3":
        result["native_observation_binding"] = copy.deepcopy(record.get("native_observation_binding"))
        result["flow_availability"] = copy.deepcopy(record.get("flow_availability"))
    return result


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
            "model_evidence": native_evidence.catalog(workspace),
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
        if "model_evidence" in row:
            row["model_evidence"] = native_evidence.normalize(row["model_evidence"])
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


def compile_recommendations(record, selection, *, model_evidence=None):
    """Pure calculation over an already inspected retained context."""
    selection = _selection(record, selection)
    model_evidence = {} if model_evidence is None else model_evidence
    expected = {r["id"] for r in selection["targets"] if "model_evidence" in r}
    if not isinstance(model_evidence, dict) or set(model_evidence) != expected:
        raise ContractError("Resolve each explicitly selected native evidence source before compiling")
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
        if target["id"] in model_evidence:
            resolved = model_evidence[target["id"]]
            if resolved.get("selection") != target["model_evidence"]:
                raise ContractError("The resolved native evidence differs from the target choice")
            rows[-1]["model_evidence"] = copy.deepcopy(resolved)
            warnings.append("Native evidence supports authored sampling rationale; station-catchment and quantitative constituent equivalence are not established.")
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
    selected = _selection(record, selection)
    return compile_recommendations(record, selected,
        model_evidence=native_evidence.resolve(workspace, record, selected))


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
    recomputed = compile_recommendations(context_value, value["selection"],
        model_evidence=native_evidence.resolve(workspace, context_value, value["selection"]))
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


def report_html(record, native_designs=None, native_plans=None):
    """Readable saved-proposal report; scientific records and exports stay exact."""
    esc = lambda value: html.escape("" if value is None else str(value))
    def money(cents):
        return "Not supplied" if cents is None else "USD " + format(Decimal(cents) / 100, ".2f")
    def table(headers, rows):
        header = "".join("<th scope='col'>" + esc(name) + "</th>" for name in headers)
        body = "".join("<tr>" + "".join(
            "<td><span class='cell-label' aria-hidden='true'>" + esc(name) +
            "</span><span class='cell-value'>" + esc(value) + "</span></td>"
            for name, value in zip(headers, row)) + "</tr>" for row in rows)
        return "<div class='table'><table><thead><tr>" + header + "</tr></thead><tbody>" + body + "</tbody></table></div>"
    months = ("", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    target_rows = []
    for row in record["targets"]:
        target = row["target"]
        coverage = "; ".join(months[item["month"]] + ": " + str(item["observed_dates"]) +
            " / " + str(item["minimum_dates"]) for item in row["evidence"]["monthly"])
        target_rows.append((row["cohort"]["label"] + "\n" + target["station_id"] + "\nTarget: " + row["target_id"],
            "Historical dates / goal: " + coverage + "\nProposed visits: " + str(target["proposed_visits"]) +
            "\nTarget planning cost: " + money(row["cost"]["total_cents"]),
            target["reason"] + ("\nExcluded from proposal." if not target["included"] else "")))
    targets = "<h2>Sampling targets</h2>" + table(["Target and retained analytical cohort", "Historical coverage and proposed work", "Planning rationale"], target_rows)
    details = ""
    for row in record["targets"]:
        target = row["target"]
        details += "<section><div class='target-intro'><h2>" + esc(target["id"]) + ": " + esc(row["cohort"]["label"]) + "</h2>"
        details += "<p><strong>Reporting-limit target:</strong> " + esc(target["reporting_limit"] if target["reporting_limit"] is not None else "Not entered") + ". " + esc(target["reporting_limit_basis"]) + "</p></div>"
        details += "<p><strong>Cost basis:</strong> " + esc(target["cost_basis"] or "Not entered") + "</p><p><strong>Sensitivity context:</strong> " + esc(target["sensitivity_basis"] or "No model-sensitivity basis selected") + "</p>"
        if "model_evidence" in row:
            from .monitoring_evidence_report import render
            details += render(row["model_evidence"])
        if row["evidence"]["flow_scope_eligible"]:
            details += "<p>Flow goal: " + esc(target["flow_goal"]) + "; matching historical episodes: " + str(len(row["evidence"]["high_flow_episodes"])) + ". The retained flow scope applies to this station.</p>"
        else:
            details += "<p>Flow goal: " + esc(target["flow_goal"]) + ". Historical event coverage is unavailable for this station and source scope.</p>"
        details += "<ul>" + "".join("<li>" + esc(value) + "</li>" for value in row["warnings"]) + "</ul>"
        details += "<details><summary>Exact supporting observations, activities and cohort fields</summary><pre>" + esc(json.dumps({"observations": row["evidence"]["observation_ids"], "activities": row["evidence"]["activity_ids"], "cohort": row["cohort"]["fields"]}, ensure_ascii=False, indent=2)) + "</pre></details></section>"
    native = ""
    for item in native_designs or []:
        native += "<section><h2>Saved native calendar</h2><p>Status: " + esc(item["status"]) + ".</p>"
        cost = item.get("native_cost") or {}
        if "total_cents" in cost:
            native += "<p><strong>Geographic and calendar planning estimate: " + esc(money(cost["total_cents"])) + ".</strong> " + esc(cost.get("scope", "")) + ". Constituent-specific target costs above remain separately recorded.</p>"
        native += table(["Target", "Total visits requested / scheduled", "Requested total met"], [
            (row["target_id"], str(row["proposed_visits"]) + " / " + str(row["calendar_visits_in_selected_months"]), "Yes" if row["calendar_count_meets_request"] else "No") for row in item["target_calendar"]])
        plan = (native_plans or {}).get(item["plan_id"])
        if plan is not None:
            visits = plan.get("calendar", {}).get("visits", [])
            planned_dates = sorted({visit["date"] for visit in visits})
            native += "<p><strong>Actual saved calendar dates:</strong> " + esc(", ".join(planned_dates) or "No scheduled visits") + ".</p>"
            month_rows = []
            for target_calendar in item["target_calendar"]:
                target = next(row["target"] for row in record["targets"] if row["target_id"] == target_calendar["target_id"])
                keys = set(target_calendar["visit_keys"])
                selected_visits = [visit for visit in visits if visit["visit_key"] in keys]
                month_counts = "; ".join(months[month] + ": " + str(len({visit["date"] for visit in selected_visits if int(visit["date"][5:7]) == month})) for month in target["months"])
                month_rows.append((target["id"], month_counts))
            native += table(["Target", "Scheduled distinct dates by selected month"], month_rows)
            native += "<p>The requested-total check counts future visits across all selected months. Historical date goals and gaps above use the separate historical evidence window. Future slots do not change those recorded observations or establish a per-month coverage goal.</p>"
            visit_rows = [(visit["date"] + " " + visit["start_local"] + " to " + visit["finish_local"] + " local",
                item.get("station_bindings", {}).get(visit["site_id"], visit.get("site_label") or visit["site_id"]),
                "Crew " + str(visit["crew"]) + "; " + visit["status"] + "\n" + visit["visit_key"]) for visit in visits]
            native += "<details><summary>All original saved calendar slots</summary>" + table(["Date and local time", "Source station or search area", "Crew, status and visit key"], visit_rows) + "</details>"
        native += "<details><summary>Full saved native plan identity</summary><p>" + esc(item["plan_id"]) + "</p></details></section>"
    budget = record["budget"]
    if budget["complete"]:
        budget_text = "Included target planning total: " + money(budget["known_total_cents"]) + "."
    elif budget["known_total_cents"] == 0:
        budget_text = "A complete target budget is not yet available. Enter the missing selected field and laboratory costs. Recorded known-cost subtotal: USD 0.00."
    else:
        budget_text = "Known target-cost subtotal: " + money(budget["known_total_cents"]) + "; additional selected costs remain to be entered."
    source_support = ""
    if record["context_snapshot"].get("source_schema") == "upstate.monitoring-observed-source/v3":
        from .monitoring_concentration_report import sampling_support
        source_support = sampling_support(record["context_snapshot"])
    # Typography only: preserve the original authored notes in the saved record,
    # source downloads and an exact-text disclosure when spacing changes.
    original_notes = record["selection"]["notes"]
    display_notes = re.sub(r"\bAll([0-9]+)originalrows\b", r"All \1 original rows", original_notes)
    display_notes = re.sub(r"\bdepth([0-9]+(?:\.[0-9]+)?)m\b", r"depth \1 m", display_notes)
    notes_source = ("<details><summary>Exact original operator notes</summary><pre>" + esc(original_notes) + "</pre></details>"
                    if display_notes != original_notes else "")
    stamp = datetime.fromisoformat(record["recorded_at"].replace("Z", "+00:00"))
    stamp_text = stamp.strftime("%d %b %Y, %H:%M:%S %z")
    style = """:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#eee;color:#202020;font:15px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}main{max-width:1200px;margin:auto;padding:28px;background:white}h1{font-size:28px;line-height:1.25}h2{font-size:20px;margin-top:30px}h2,h3,h4,caption{break-after:avoid}.target-intro{break-inside:avoid;page-break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:13px;table-layout:fixed}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #bbb;padding:10px;word-break:normal;overflow-wrap:break-word}th{background:#eee}tr{break-inside:avoid}.table{overflow:auto}.cell-label{display:none}.cell-value{white-space:pre-line}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;font-size:12px}details{margin:12px 0}summary{cursor:pointer;font-weight:600}nav{display:flex;gap:10px 20px;flex-wrap:wrap;margin:20px 0}a{color:inherit;text-underline-offset:3px}.print-note{display:none}
@media(max-width:720px){main{padding:14px}table,tbody,tr,td{display:block;width:100%}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}tr{border:1px solid #aaa;margin:0 0 16px;padding:4px 0}td{border:0;padding:8px 12px}.cell-label{display:block;font-weight:600;margin-bottom:3px}.cell-value{display:block}}
@media print{@page{margin:16mm}body,main{background:white}main{padding:0;max-width:none}body{font-size:10pt}h1{font-size:20pt}h2{font-size:13pt}thead{display:table-header-group}.table{overflow:visible}table{font-size:9pt}th,td{padding:6px}details,nav{display:none}details[open]{display:block}.print-note{display:block;font-size:9pt;border-top:1px solid #999;padding-top:10px}.sampling-native-evidence details{display:none}}"""
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(record["title"]) + "</title><style>" + style + "</style></head><body><main>"
        "<h1>" + esc(record["title"]) + "</h1><p>Proposed monitoring programme. Recorded by " + esc(record["operator"]) + " at <time datetime='" + esc(record["recorded_at"]) + "' title='" + esc(record["recorded_at"]) + "'>" + esc(stamp_text) + "</time>.</p>"
        "<p>Historical evidence: " + esc(record["selection"]["evidence_start"]) + " to " + esc(record["selection"]["evidence_end"]) + ".</p><p><strong>" + esc(budget_text) + "</strong></p>"
        "<nav aria-label='Original report files'><a href='proposed-targets.csv'>Target worksheet CSV</a><a href='historical-month-gaps.csv'>Historical coverage CSV</a><a href='recommendation.json'>Full saved proposal</a><a href='native-designs.json'>Saved native designs</a><a href='planned-visits.csv'>Saved calendar CSV</a><a href='selection.json'>Editable selection</a></nav>"
        + targets + native + "<details open><summary>Planning basis and original measurement support</summary><p>" + esc(record["selection"]["planning_basis"]) + "</p>" + source_support + "</details>" + details
        + "<h2>Interpretation</h2><ul>" + "".join("<li>" + esc(value) + "</li>" for value in record["interpretation"]) + "</ul>"
        + "<details><summary>Complete original source binding</summary><pre>" + esc(json.dumps(record["source_binding"], ensure_ascii=False, indent=2)) + "</pre></details>"
        + "<h2>Operator notes</h2><p>" + esc(display_notes) + "</p>" + notes_source + "<p class='print-note'>The complete HTML report and its companion JSON/CSV files retain all original source identities, exact supporting observations and editable selections.</p></main></body></html>")

def export_members(workspace, recommendation_id, *, design_ids=None):
    from .monitoring_packet import bytes_member, add_member
    from .monitoring_sources import source_export_members
    from .monitoring_workspace import MonitoringWorkspace, csv_text
    record = inspect(workspace, recommendation_id)
    if design_ids is None:
        native = designs(workspace, recommendation_id)
    else:
        if (not isinstance(design_ids, list) or not design_ids
                or any(not isinstance(key, str) for key in design_ids)
                or len(set(design_ids)) != len(design_ids)):
            raise ContractError("Select distinct exact original Sampling design IDs")
        native = [inspect_design(workspace, key) for key in design_ids]
        if any(row["recommendation_id"] != recommendation_id for row in native):
            raise ContractError("Selected native designs must belong to this exact Sampling proposal")
    files = {}
    def add(name, body):
        add_member(files, name, bytes_member(body))
    add("recommendation.json", canonical_bytes(record))
    add("selection.json", canonical_bytes(record["selection"]))
    proposal_history = history(workspace, recommendation_id)
    add("proposal-history.json", canonical_bytes(proposal_history))
    evidence_rows = [{"recommendation_id": proposal["id"], "target_id": row["target_id"],
                      "evidence": row["model_evidence"]}
                     for proposal in proposal_history for row in proposal["targets"]
                     if "model_evidence" in row]
    if evidence_rows:
        add("native-evidence.json", canonical_bytes(evidence_rows))
        for name, member in native_evidence.export_members(workspace, proposal_history):
            add_member(files, name, member)
    add("native-designs.json", canonical_bytes(native))
    # Render the actual retained slots, not dates inferred from solver settings.
    native_plans = {}
    planned_visits = []
    for result in native:
        plan = MonitoringWorkspace(workspace).get("plans", result["plan_id"])
        if digest(plan) != result["plan_digest"]:
            raise ContractError("The selected native design differs from its retained result")
        native_plans[plan["id"]] = plan
        for visit in plan.get("calendar", {}).get("visits", []):
            planned_visits.append({**visit, "plan_id": plan["id"],
                "source_station_id": result.get("station_bindings", {}).get(visit["site_id"], ""),
                "target_ids": [target["target_id"] for target in result["target_calendar"] if visit["visit_key"] in target["visit_keys"]]})
    add("planned-visits.csv", csv_text(planned_visits, ["plan_id", "visit_key", "date", "start_local", "finish_local", "crew", "site_id", "site_label", "source_station_id", "target_ids", "round", "round_deadline", "status"]).encode("utf-8"))
    add("sampling-review.html", report_html(record, native, native_plans).encode("utf-8"))
    fields = ["target_id", "station_id", "cohort_id", "month", "observed_dates", "minimum_dates", "date_gap", "dates", "observation_ids", "activity_ids"]
    add("historical-month-gaps.csv", csv_text(record["gaps"], fields).encode("utf-8"))
    target_rows = [{**r["target"], "total_cost_cents": r["cost"]["total_cents"],
                    "cohort_fields": r["cohort"]["fields"], "warnings": r["warnings"]} for r in record["targets"]]
    add("proposed-targets.csv", csv_text(target_rows, ["id", "station_id", "cohort_id", "included",
        "months", "minimum_dates_per_month", "proposed_visits", "reporting_limit", "reporting_limit_basis",
        "flow_goal", "priority", "reason", "setup_cost", "per_visit_cost", "total_cost_cents",
        "cost_basis", "sensitivity_basis", "cohort_fields", "warnings",
        *(["model_evidence"] if evidence_rows else [])]).encode("utf-8"))
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
    add("README.txt", ("Open sampling-review.html for the proposed programme. Historical observations, original sources, complete proposal history, explicit editable selection and selected native designs are included.\n"
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
