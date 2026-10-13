"""Watershed context from retained publisher records for the selected model domain.

This module uses Python's standard library. It joins NRCS state records to the
original HUC12 list and summarizes SCDES publisher HUC attributes. Native geometry
intersections and land-origin export summaries remain in the receiving-water model.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping
import csv
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
from typing import Any
from urllib.parse import parse_qs, urlsplit

SCHEMA = "upstate.watershed-context/v1"
ANALYSIS_VERSION = "1.1.0"
ACRE_TO_KM2 = 0.0040468564224
TARGET_CLASSES = ("ORW", "ONRW", "TN", "TPGT", "TPT")
PRIORITY_STATUS = "High Priority Area"


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_json_bytes(value)).hexdigest()


def _huc(value: Any, label: str = "HUC12") -> str:
    text = str(value).strip()
    if not re.fullmatch(r"\d{12}", text):
        raise ValueError(f"{label} must preserve all 12 HUC digits: {value!r}")
    return text


def _number(value: Any, label: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a finite nonnegative number")
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a finite nonnegative number") from exc
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"{label} must be a finite nonnegative number")
    return result


def _count(value: Any, label: str) -> int:
    number = _number(value, label)
    if number is None or not number.is_integer():
        raise ValueError(f"{label} must be a nonnegative integer")
    return int(number)


def _sum(values: Iterable[float | None]) -> float:
    return math.fsum(value for value in values if value is not None)


def _first(record: Mapping, names: tuple[str, ...]) -> Any:
    return next((record[name] for name in names if name in record), None)


def _classification_inventory(context: Mapping, domain: set[str]) -> dict:
    inventory = context.get("classified_source_inventory") or {}
    counts: dict[str, Counter] = defaultdict(Counter)
    named: dict[str, Counter] = defaultdict(Counter)
    pairs: set[tuple[str, str]] = set()
    for record in inventory.get("source_huc_class_counts", []):
        huc12 = _huc(record["publisher_huc12"], "publisher_huc12")
        code = str(record["class_code"]).strip().upper()
        pair = (huc12, code)
        if pair in pairs:
            raise ValueError(f"Duplicate publisher HUC/class count: {pair}")
        pairs.add(pair)
        if code not in TARGET_CLASSES:
            raise ValueError(f"Unexpected selected water class {code!r}")
        if huc12 not in domain:
            raise ValueError(f"Publisher HUC12 {huc12} is outside the model domain")
        count = _count(record["feature_count"], f"{huc12} {code} feature_count")
        named_count = record.get("named_feature_count")
        if named_count is not None:
            named_count = _count(named_count, f"{huc12} {code} named_feature_count")
            if named_count > count:
                raise ValueError(f"Named feature count exceeds features for {pair}")
            named[huc12][code] = named_count
        counts[huc12][code] = count
    class_counts: Counter = Counter()
    for values in counts.values():
        class_counts.update(values)
    total = sum(class_counts.values())
    if "feature_count" in inventory and total != _count(
            inventory["feature_count"], "classified inventory feature_count"):
        raise ValueError("Publisher HUC/class counts do not sum to the retained feature count")
    declared = inventory.get("class_counts")
    if declared is not None:
        expected = {str(k).upper(): _count(v, f"class_counts.{k}")
                    for k, v in declared.items() if v != 0}
        observed = {k: v for k, v in class_counts.items() if v != 0}
        if expected != observed:
            raise ValueError("Publisher HUC/class counts disagree with class totals")
    return {"counts": dict(counts), "named": dict(named), "total": total,
            "class_counts": dict(sorted(class_counts.items())),
            "publisher_huc_count": sum(sum(v.values()) > 0 for v in counts.values())}


def _classification_coverage(
        companion: Mapping | None, domain: list[str], inventory: Mapping) -> dict:
    """Bind an exact-domain companion to its original query and retained counts."""
    base = {
        "complete_domain_query": False,
        "status": "retained_publisher_records_only",
        "model_domain_huc_count": len(domain),
        "selected_classes": list(TARGET_CLASSES),
        "selected_feature_count": inventory["total"],
        "publisher_huc_count": inventory["publisher_huc_count"],
        "assignment": "publisher_huc12_attribute",
        "source_jurisdiction": "South Carolina",
    }
    if companion is None:
        return base
    if companion.get("schema") != "upstate.classification-source-coverage/v1":
        raise ValueError("Unexpected classification coverage schema")
    captured = companion.get("captured_geometry") or {}
    membership = companion.get("full_domain_id_response") or {}
    comparison = companion.get("comparison") or {}
    source_domain = companion.get("model_domain") or {}
    url = membership.get("request_url", "")
    where = parse_qs(urlsplit(url).query).get("where", [""])[0]
    selected_clause = re.search(r"\bHUC_12\s+IN\s*\((.*?)\)", where, re.I | re.S)
    class_clause = re.search(r"\bH2OCLASS\s+IN\s*\((.*?)\)", where, re.I | re.S)
    queried_hucs = re.findall(r"'(\d{12})'", selected_clause.group(1)) if selected_clause else []
    queried_classes = re.findall(r"'([^']+)'", class_clause.group(1)) if class_clause else []
    domain_matches = (
        len(queried_hucs) == len(domain)
        and len(set(queried_hucs)) == len(domain)
        and set(queried_hucs) == set(domain)
        and source_domain.get("huc12_count") == len(domain)
    )
    complete = (
        domain_matches
        and set(queried_classes) == set(TARGET_CLASSES)
        and comparison.get("same_complete_object_id_set") is True
        and comparison.get("all_publisher_hucs_in_selected_domain") is True
        and comparison.get("added_ids") == []
        and comparison.get("retained_ids_outside_exact_selection") == []
    )
    total = inventory["total"]
    if complete and any(value != total for value in (
            membership.get("count"), membership.get("unique_ids"),
            captured.get("features"))):
        raise ValueError("Classification coverage count disagrees with retained source")
    if complete:
        expected = {k: v for k, v in (comparison.get("class_counts") or {}).items() if v}
        observed = {k: v for k, v in inventory["class_counts"].items() if v}
        if expected != observed:
            raise ValueError("Classification coverage class totals disagree with retained source")
        if comparison.get("publisher_huc12_count") != inventory["publisher_huc_count"]:
            raise ValueError("Classification coverage publisher HUC count disagrees with source")
    base.update({
        "complete_domain_query": complete,
        "status": "complete_domain_query" if complete else "companion_not_bound_to_domain",
        "domain_membership_matches": domain_matches,
        "captured_at": companion.get("captured_at"),
        "operation_id": companion.get("operation_id"),
        "layer_url": companion.get("layer_url"),
        "query_url": url,
        "membership_source": dict(membership),
        "captured_geometry": dict(captured),
        "additional_huc8_response": companion.get("additional_huc8_response"),
    })
    return base


def _state_context(record: Mapping | None, huc12: str) -> dict:
    """Use one watershed area, retaining each distinct state's published portion."""
    source_rows = list((record or {}).get("nrcs_state_rows") or [])
    states: dict[str, dict] = {}
    watershed_areas: list[float] = []
    names: set[str] = set()
    priority_states: list[str] = []
    priority_reasons: list[str] = []
    known_statuses: list[str] = []
    for source_row in source_rows:
        row = dict(source_row)
        if _huc(row.get("huc12_code"), "NRCS huc12_code") != huc12:
            raise ValueError(f"NRCS record assigned to the wrong HUC12: {huc12}")
        state = str(row.get("st_usps") or "").strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", state):
            raise ValueError(f"Invalid NRCS state for {huc12}")
        if state in states:
            raise ValueError(f"Duplicate NRCS state portion for {huc12}/{state}")
        row["st_ac"] = _number(row.get("st_ac"), f"{huc12}/{state} st_ac")
        row["huc12_ac"] = _number(row.get("huc12_ac"), f"{huc12}/{state} huc12_ac")
        row["st_usps"] = state
        states[state] = row
        if row["huc12_ac"] is not None:
            watershed_areas.append(row["huc12_ac"])
        if row.get("huc12_name"):
            names.add(str(row["huc12_name"]))
        status = str(row.get("fy26_status") or "").strip()
        known_statuses.append(status)
        if status.casefold() == PRIORITY_STATUS.casefold():
            priority_states.append(state)
            details = [f"{state}: {(record or {}).get('nrcs_edition', 'NRCS')} {status}"]
            details.extend(str(row[key]) for key in ("system_type", "resource_concern")
                           if row.get(key))
            priority_reasons.append("; ".join(details))
    unique_area = watershed_areas[0] if watershed_areas else None
    if unique_area is not None and any(
            not math.isclose(value, unique_area, abs_tol=1e-8, rel_tol=0)
            for value in watershed_areas):
        raise ValueError(f"NRCS state rows disagree on full watershed area for {huc12}")
    state_total = _sum(row["st_ac"] for row in states.values())
    complete_state_area = bool(states) and all(row["st_ac"] is not None for row in states.values())
    priority: bool | None
    if priority_states:
        priority = True
    elif known_statuses and all(value.casefold() == "not selected" for value in known_statuses):
        priority = False
    else:
        priority = None
    return {
        "name": " / ".join(sorted(names)) if names else huc12,
        "states": sorted(states),
        "area_acres": unique_area,
        "area_km2": unique_area * ACRE_TO_KM2 if unique_area is not None else None,
        "state_portion_acres": state_total if complete_state_area else None,
        "known_state_portion_acres": state_total,
        "state_area_minus_huc_area_acres": (
            state_total - unique_area
            if unique_area is not None and complete_state_area else None
        ),
        "state_portions_acres": {state: row["st_ac"] for state, row in sorted(states.items())},
        "cross_state": len(states) > 1,
        "nrcs_coverage": (record or {}).get("nrcs_coverage", "no_source_rows"),
        "nrcs_edition": (record or {}).get("nrcs_edition"),
        "nrcs_state_rows": [row for _, row in sorted(states.items())],
        "nrcs_state_row_count": len(states),
        "priority": priority,
        "priority_states": sorted(priority_states),
        "priority_state_row_count": len(priority_states),
        "priority_state_portion_acres": _sum(states[state]["st_ac"] for state in priority_states),
        "priority_reasons": sorted(priority_reasons),
        "system_types": sorted({str(row["system_type"]) for row in states.values()
                                if row.get("system_type")}),
        "resource_concerns": sorted({str(row["resource_concern"]) for row in states.values()
                                    if row.get("resource_concern")}),
        "priority_statuses": sorted(set(known_statuses)),
    }


def _summary(rows: list[dict]) -> dict:
    area = _sum(row["area_acres"] for row in rows)
    state_area = _sum(row["known_state_portion_acres"] for row in rows)
    priority = [row for row in rows if row["priority"] is True]
    classified = [row for row in rows if row["selected_classification_count"] > 0]
    counts: Counter = Counter()
    for row in rows:
        counts.update(row["class_counts"])
    return {
        "huc_count": len(rows),
        "area_acres": area,
        "area_km2": area * ACRE_TO_KM2,
        "hucs_with_area_count": sum(row["area_acres"] is not None for row in rows),
        "state_portion_acres": state_area,
        "state_area_minus_huc_area_acres": (
            state_area - area if all(row["area_acres"] is not None
                                    and row["state_portion_acres"] is not None for row in rows)
            else None
        ),
        "state_row_count": sum(row["nrcs_state_row_count"] for row in rows),
        "states": sorted({state for row in rows for state in row["states"]}),
        "cross_state_huc_count": sum(row["cross_state"] for row in rows),
        "priority_huc_count": len(priority),
        "priority_state_row_count": sum(row["priority_state_row_count"] for row in rows),
        "priority_area_acres": _sum(row["area_acres"] for row in priority),
        "priority_state_portion_acres": _sum(row["priority_state_portion_acres"] for row in rows),
        "unknown_priority_huc_count": sum(row["priority"] is None for row in rows),
        "selected_classification_count": sum(counts.values()),
        "class_counts": dict(sorted(counts.items())),
        "classified_huc_count": len(classified),
        "priority_and_classified_huc_count": sum(row["priority"] is True for row in classified),
        "priority_without_selected_classes_huc_count": sum(
            row["selected_classification_count"] == 0 for row in priority),
        "sc_huc_count": sum("SC" in row["states"] for row in rows),
        "outside_south_carolina_huc_count": sum(
            row["classification_scope"] == "outside_south_carolina" for row in rows),
        "complete_query_huc_count": sum(
            row["classification_query_coverage"] == "complete_domain_query" for row in rows),
        "queried_zero_target_huc_count": sum(
            row["selected_classification_count"] == 0
            and row["classification_query_coverage"] == "complete_domain_query" for row in rows),
        "unverified_zero_target_huc_count": sum(
            row["selected_classification_count"] == 0
            and row["classification_query_coverage"] != "complete_domain_query" for row in rows),
    }


def _state_summaries(rows: list[dict]) -> list[dict]:
    by_state: dict[str, list[tuple[dict, dict]]] = defaultdict(list)
    for huc in rows:
        for record in huc["nrcs_state_rows"]:
            by_state[record["st_usps"]].append((huc, record))
    result = []
    for state, portions in sorted(by_state.items()):
        priority = [(huc, row) for huc, row in portions
                    if str(row.get("fy26_status") or "").casefold() == PRIORITY_STATUS.casefold()]
        area = _sum(row["st_ac"] for _, row in portions)
        result.append({
            "state": state,
            "huc_count": len(portions),
            "state_row_count": len(portions),
            "state_portion_acres": area,
            "state_portion_km2": area * ACRE_TO_KM2,
            "rows_with_area_count": sum(row["st_ac"] is not None for _, row in portions),
            "priority_huc_count": len(priority),
            "priority_state_portion_acres": _sum(row["st_ac"] for _, row in priority),
            "cross_state_huc_count": sum(huc["cross_state"] for huc, _ in portions),
            "priority_system_type_counts": dict(sorted(Counter(
                str(row.get("system_type") or "Unspecified") for _, row in priority).items())),
            "status_counts": dict(sorted(Counter(
                str(row.get("fy26_status") or "Unspecified") for _, row in portions).items())),
        })
    return result


def _network_context(network: Mapping | list | None, rows: list[dict]) -> dict:
    """Summarize reachable HUCs using explicit native ToHUC records only."""
    if network is None:
        for row in rows:
            row["network"] = None
            row["downstream_huc12"] = None
        return {"status": "not_supplied", "method": "native_ToHUC"}
    source_rows = network if isinstance(network, list) else (
        network.get("rows", network.get("hucs", network.get("features", []))))
    if not isinstance(source_rows, list):
        raise ValueError("Native network requires a rows list or a feature collection")
    domain = {row["huc12"] for row in rows}
    by_huc = {row["huc12"]: row for row in rows}
    downstream: dict[str, tuple[str | None, str]] = {}
    roles: dict[str, str] = {}
    for item in source_rows:
        record = item.get("attributes", item.get("properties", item))
        huc12 = _huc(_first(record, ("huc12", "HUC12", "huc12_code", "HUC_12")), "network HUC12")
        raw = _first(record, ("ToHUC", "tohuc", "TOHUC", "to_huc12", "downstream_huc12"))
        text = str(raw).strip() if raw is not None else ""
        if not text or text.casefold() in ("null", "none", "unknown"):
            value = (None, "unknown")
        elif text.upper() in ("0", "000000000000", "OCEAN", "CLOSED BASIN", "CLOSED_BASIN"):
            value = (None, "terminal")
        else:
            value = (_huc(text, f"{huc12} ToHUC"), "linked")
        if huc12 in downstream and downstream[huc12] != value:
            raise ValueError(f"Conflicting native ToHUC values for {huc12}")
        downstream[huc12] = value
        if record.get("role") in ("reporting", "upstream", "model_domain"):
            roles[huc12] = record["role"]
    reverse: dict[str, set[str]] = defaultdict(set)
    for huc12, (target, _) in downstream.items():
        if target is not None:
            reverse[target].add(huc12)
    complete_domain = all(huc in downstream and downstream[huc][1] != "unknown" for huc in domain)
    cycles: set[tuple[str, ...]] = set()
    for row in rows:
        huc12 = row["huc12"]
        upstream: set[str] = set()
        pending = list(reverse.get(huc12, ()))
        while pending:
            node = pending.pop()
            if node in upstream or node == huc12:
                continue
            upstream.add(node)
            pending.extend(reverse.get(node, ()))
        path: list[str] = []
        seen = {huc12: 0}
        node = huc12
        while True:
            if node not in downstream:
                path_status = "exits_supplied_network" if node != huc12 else "missing_native_record"
                break
            target, state = downstream[node]
            if target is None:
                path_status = state
                break
            path.append(target)
            if target in seen:
                cycle = [huc12, *path][seen[target]:-1]
                cycles.add(tuple(sorted(cycle)))
                path_status = "cycle_in_source"
                break
            seen[target] = len(path)
            node = target
        upstream_domain = sorted(upstream & domain)
        upstream_rows = [by_huc[key] for key in upstream_domain]
        target, downstream_state = downstream.get(huc12, (None, "missing_native_record"))
        row["downstream_huc12"] = target
        if huc12 in roles:
            row["role"] = roles[huc12]
        row["network"] = {
            "native_record_present": huc12 in downstream,
            "downstream_state": downstream_state,
            "downstream_huc12s": path,
            "downstream_path_status": path_status,
            "downstream_domain_huc12s": list(dict.fromkeys(
                node for node in path if node in domain and node != huc12)),
            "known_upstream_domain_huc12s": upstream_domain,
            "known_external_upstream_huc12s": sorted(upstream - domain),
            "known_upstream_domain_huc_count": len(upstream_rows),
            "known_upstream_priority_huc_count": sum(
                other["priority"] is True for other in upstream_rows),
            "known_upstream_area_acres": _sum(other["area_acres"] for other in upstream_rows),
            "known_upstream_area_huc_count": sum(
                other["area_acres"] is not None for other in upstream_rows),
            "known_upstream_selected_classification_count": sum(
                other["selected_classification_count"] for other in upstream_rows),
            "outgoing_records_complete_for_model_domain": complete_domain,
        }
    return {
        "status": (
            "cycles_in_source" if cycles else
            "complete_model_domain" if complete_domain else "partial_native_network"
        ),
        "method": "native_ToHUC",
        "input_row_count": len(source_rows),
        "unique_native_huc_count": len(downstream),
        "model_domain_native_row_count": len(domain & downstream.keys()),
        "missing_model_domain_huc12s": sorted(domain - downstream.keys()),
        "unknown_downstream_huc12s": sorted(huc for huc in domain
                                           if downstream.get(huc, (None, ""))[1] == "unknown"),
        "outgoing_records_complete_for_model_domain": complete_domain,
        "domain_exit_edges": [{"huc12": huc, "ToHUC": target}
                              for huc, (target, _) in sorted(downstream.items())
                              if huc in domain and target is not None and target not in domain],
        "cycles": [list(cycle) for cycle in sorted(cycles)],
        "source_reference": network.get("source_reference") if isinstance(network, Mapping) else None,
        "interpretation": (
            "Upstream summaries count distinct HUC12 ancestors present in the supplied "
            "native network and exclude the focal watershed. They describe connectivity; "
            "the receiving-water model groups land-origin sediment and nutrient export "
            "over the selected contributing geometry. InVEST transport ends at the "
            "modeled stream; in-stream and reservoir processing are separate."
        ),
    }


def build_watershed_context(
        source_context: Mapping,
        classification_coverage: Mapping | None = None,
        network: Mapping | list | None = None,
        selected_huc12s: Iterable[str] | None = None,
) -> dict:
    """Build complete-domain context and a selection without trimming the model domain.

    NRCS priority is true when any retained state row says High Priority Area.
    Watershed area is counted once per HUC; priority state area sums only the
    states carrying that designation. Optional network input accepts rows with
    huc12 and ToHUC, or native features with those attributes.
    """
    if source_context.get("schema") != "upstate.water-context/v1":
        raise ValueError("Expected upstate.water-context/v1 source context")
    original_domain = [_huc(value) for value in source_context.get("model_domain_huc12s", [])]
    if not original_domain or len(original_domain) != len(set(original_domain)):
        raise ValueError("Model domain must contain distinct HUC12 identifiers")
    domain = sorted(original_domain)
    domain_set = set(domain)
    source_hucs: dict[str, Mapping] = {}
    for record in source_context.get("hucs", []):
        huc12 = _huc(record["huc12"])
        if huc12 in source_hucs:
            raise ValueError(f"Duplicate source context for {huc12}")
        source_hucs[huc12] = record
    selected = domain if selected_huc12s is None else sorted(
        {_huc(value, "selected HUC12") for value in selected_huc12s})
    unknown_selected = set(selected) - domain_set
    if unknown_selected:
        raise ValueError("Selected HUC12s are outside the model domain: "
                         + ", ".join(sorted(unknown_selected)))
    inventory = _classification_inventory(source_context, domain_set)
    coverage = _classification_coverage(classification_coverage, domain, inventory)
    references = [value for value in (
        source_context.get("source_reference"),
        coverage.get("layer_url"),
    ) if isinstance(value, str) and value]
    rows: list[dict] = []
    for huc12 in domain:
        state = _state_context(source_hucs.get(huc12), huc12)
        class_counts = dict(sorted(inventory["counts"].get(huc12, {}).items()))
        feature_count = sum(class_counts.values())
        if not state["states"]:
            scope = "state_unknown"
        elif "SC" in state["states"]:
            scope = "south_carolina"
        else:
            scope = "outside_south_carolina"
        query_coverage = (
            "complete_domain_query" if coverage["complete_domain_query"]
            else "retained_publisher_records_only" if feature_count else "unverified"
        )
        if feature_count:
            classification_state = "selected_target_reaches"
        elif scope == "outside_south_carolina":
            classification_state = "outside_south_carolina"
        elif coverage["complete_domain_query"]:
            classification_state = "queried_no_target_reaches"
        else:
            classification_state = "unverified"
        rows.append({
            "huc12": huc12,
            "huc8": huc12[:8],
            "role": "model_domain",
            **state,
            "classification_count": feature_count,
            "selected_classification_count": feature_count,
            "selected_classes": [code for code, count in class_counts.items() if count],
            "class_counts": class_counts,
            "named_class_counts": dict(sorted(inventory["named"].get(huc12, {}).items())),
            "classification_coverage": classification_state,
            "classification_query_coverage": query_coverage,
            "classification_scope": scope,
            "classification_assignment": "publisher_huc12_attribute",
            "source_references": references[:],
        })
    network_summary = _network_context(network, rows)
    by_huc = {row["huc12"]: row for row in rows}
    huc8_groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        huc8_groups[row["huc8"]].append(row)
    sources = [{
        "source_id": "water_context",
        "schema": source_context["schema"],
        "reference": source_context.get("source_reference"),
        "canonical_sha256": _digest(source_context),
        "title": source_context.get("title"),
    }]
    if classification_coverage is not None:
        sources.append({
            "source_id": "classification_coverage",
            "schema": classification_coverage.get("schema"),
            "reference": coverage.get("layer_url"),
            "canonical_sha256": _digest(classification_coverage),
            "captured_at": coverage.get("captured_at"),
            "operation_id": coverage.get("operation_id"),
            "membership_sha256": (coverage.get("membership_source") or {}).get("sha256"),
        })
    if network is not None:
        sources.append({
            "source_id": "native_network",
            "schema": network.get("schema") if isinstance(network, Mapping) else None,
            "reference": network_summary.get("source_reference"),
            "canonical_sha256": _digest(network),
        })
    matrix_groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row["priority"] is None:
            group = "unknown_priority"
        elif row["priority"]:
            group = "priority_and_classified" if row["classification_count"] else "priority_only"
        else:
            group = "classified_only" if row["classification_count"] else "other_model_watersheds"
        matrix_groups[group].append(row)
    payload_id = _digest({
        "schema": SCHEMA, "analysis_version": ANALYSIS_VERSION, "source_context": source_context,
        "classification_coverage": classification_coverage, "network": network,
        "selected_huc12s": selected, "selection_requested": selected_huc12s is not None,
    })
    return {
        "schema": SCHEMA,
        "analysis_version": ANALYSIS_VERSION,
        "id": "watershed-" + payload_id[:20],
        "title": "Upper Savannah watershed context",
        "model_domain_huc12s": domain,
        "summary": _summary(rows),
        "hucs": rows,
        "huc8s": [{"huc8": huc8, **_summary(members)}
                  for huc8, members in sorted(huc8_groups.items())],
        "states": _state_summaries(rows),
        "priority_matrix": [
            {"group": group, **_summary(members),
             "huc12s": [row["huc12"] for row in members]}
            for group, members in sorted(matrix_groups.items())
        ],
        "selection": {
            "requested": selected_huc12s is not None,
            "huc12s": selected,
            "summary": _summary([by_huc[huc] for huc in selected]),
        },
        "classification_coverage": coverage,
        "network": network_summary,
        "sources": sources,
        "methods": {
            "watershed_area": (
                "NRCS huc12_ac is counted once per HUC12. Repeated values across "
                "state records must agree. Acres convert to km2 using 0.0040468564224."
            ),
            "state_area": (
                "NRCS st_ac is summed once per state/HUC12. State portions and "
                "watershed totals retain their published rounding or vintage differences."
            ),
            "priority": (
                "A HUC12 is priority when at least one NRCS state row has FY26 status "
                "High Priority Area. Priority watershed area includes that whole HUC once; "
                "priority state area includes only designated state portions."
            ),
            "classified_water": (
                "Counts use retained publisher HUC12 attributes for ORW, ONRW, TN, TPGT "
                "and TPT. A complete exact-domain membership query supports zero matches "
                "for these selected classes. South Carolina jurisdiction is shown separately."
            ),
            "geometry": (
                "Native receiving-water geometry intersections associate contributing land with "
                "the selected receptor. Saved NDR/SDR summaries aggregate land-origin "
                "export reaching the modeled stream over that geometry. In-stream "
                "retention, reservoir processing and intake concentrations require "
                "additional modeling. Source attribute counts remain available for "
                "regional context and source inspection."
            ),
            "roles": (
                "All original model-domain HUC12s are retained. Reporting and upstream roles "
                "are used only when explicitly supplied with native network records."
            ),
            "hashes": (
                "canonical_sha256 hashes sorted compact UTF-8 JSON values. Source-byte "
                "membership hashes are preserved separately from the publisher companion."
            ),
        },
    }


HUC_COLUMNS = (
    "huc12", "name", "huc8", "role", "states", "area_acres", "area_km2",
    "state_portion_acres", "state_area_minus_huc_area_acres", "cross_state",
    "nrcs_edition", "nrcs_coverage", "nrcs_state_row_count", "priority",
    "priority_states", "priority_state_portion_acres", "priority_reasons",
    "system_types", "resource_concerns", "selected_classification_count",
    "selected_classes", "class_counts", "classification_coverage",
    "classification_query_coverage", "classification_scope", "classification_assignment",
    "state_portions_acres", "downstream_huc12", "native_record_present",
    "downstream_state", "downstream_path_status", "downstream_domain_huc12s",
    "known_upstream_domain_huc_count", "known_upstream_priority_huc_count",
    "known_upstream_area_acres", "known_upstream_selected_classification_count",
    "known_upstream_domain_huc12s", "known_external_upstream_huc12s",
    "outgoing_records_complete_for_model_domain", "source_references",
)
HUC8_COLUMNS = (
    "huc8", "huc_count", "states", "area_acres", "area_km2", "state_portion_acres",
    "state_area_minus_huc_area_acres", "state_row_count", "cross_state_huc_count",
    "priority_huc_count", "priority_state_row_count", "priority_area_acres",
    "priority_state_portion_acres", "selected_classification_count", "class_counts",
    "classified_huc_count", "priority_and_classified_huc_count",
    "sc_huc_count", "outside_south_carolina_huc_count", "complete_query_huc_count",
    "queried_zero_target_huc_count", "unverified_zero_target_huc_count",
)
STATE_COLUMNS = (
    "state", "huc_count", "state_row_count", "state_portion_acres", "state_portion_km2",
    "rows_with_area_count", "priority_huc_count", "priority_state_portion_acres",
    "cross_state_huc_count", "priority_system_type_counts", "status_counts",
)


def _csv_bytes(rows: list[dict], columns: tuple[str, ...]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        cells = {}
        for column in columns:
            value = (row[column] if column in row else
                     (row.get("network") or {}).get(column))
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
            elif value is None:
                value = ""
            elif isinstance(value, bool):
                value = "true" if value else "false"
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            cells[column] = value
        writer.writerow(cells)
    return stream.getvalue().encode("utf-8")


def selected_watershed_export(report: Mapping, huc12s: Iterable[str] | None = None) -> dict:
    """Build a source-bound selection from an already completed context report."""
    if report.get("schema") != SCHEMA:
        raise ValueError(f"Expected {SCHEMA} report")
    selected = sorted({_huc(value) for value in (
        report["selection"]["huc12s"] if huc12s is None else huc12s)})
    by_huc = {row["huc12"]: row for row in report["hucs"]}
    unknown = set(selected) - by_huc.keys()
    if unknown:
        raise ValueError("Selected HUC12s are outside the model domain: "
                         + ", ".join(sorted(unknown)))
    rows = [by_huc[key] for key in selected]
    return {
        "schema": "upstate.selected-watersheds/v1",
        "context_id": report["id"],
        "context_canonical_sha256": _digest(report),
        "model_domain_huc_count": len(report["model_domain_huc12s"]),
        "selected_huc12s": selected,
        "summary": _summary(rows),
        "hucs": rows,
        "sources": report["sources"],
        "classification_coverage": report["classification_coverage"],
        "network": report["network"],
        "methods": report["methods"],
    }


def _display(value: Any) -> str:
    if value is None:
        return "Unknown"
    if isinstance(value, int) and not isinstance(value, bool):
        return f"{value:,}"
    if isinstance(value, float):
        return f"{value:,.2f}"
    if isinstance(value, (list, tuple)):
        value = ", ".join(str(item) for item in value)
    return str(value).replace("|", r"\|").replace("\n", " ")


def _markdown_table(headers: list[str], rows: Iterable[Iterable[Any]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |",
             "| " + " | ".join("---" for _ in headers) + " |"]
    lines.extend("| " + " | ".join(_display(cell) for cell in row) + " |" for row in rows)
    return lines


def _source_reference_rows(value: Any, label: str = "Reference"):
    if isinstance(value, Mapping):
        for key, child in value.items():
            name = str(key).replace("_", " ").capitalize()
            prefix = name if label == "Reference" else label + " / " + name
            yield from _source_reference_rows(child, prefix)
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value, 1):
            yield from _source_reference_rows(child, f"{label} {index}")
    elif value is not None:
        yield label, value


def render_watershed_report(report: Mapping) -> str:
    summary = report["summary"]
    coverage = report["classification_coverage"]
    lines = [
        "# Upper Savannah watershed context", "",
        f"The retained model domain contains **{summary['huc_count']} watersheds** "
        f"across **{len(report['huc8s'])} HUC8 regions**, covering "
        f"**{_display(summary['area_acres'])} acres** "
        f"({_display(summary['area_km2'])} km2) of published watershed area. "
        f"NRCS records identify **{summary['priority_huc_count']} priority watersheds** "
        f"through {summary['priority_state_row_count']} designated state portions.", "",
        f"Selected South Carolina water classes contain **{_display(summary['selected_classification_count'])} "
        f"retained source features** assigned by the publisher to "
        f"**{summary['classified_huc_count']} HUC12s**. "
        f"The source query covers {summary['complete_query_huc_count']} of "
        f"{summary['huc_count']} model HUC12s. "
        f"{summary['outside_south_carolina_huc_count']} model HUC12s lie outside "
        "South Carolina according to the retained state records.", "",
        "## Regional context", "",
    ]
    lines.extend(_markdown_table(
        ["HUC8", "HUC12s", "Area (ac)", "Priority HUC12s", "Priority state area (ac)",
         "Selected SC class records", "Publisher HUC12s"],
        ((row["huc8"], row["huc_count"], row["area_acres"], row["priority_huc_count"],
          row["priority_state_portion_acres"], row["selected_classification_count"],
          row["classified_huc_count"]) for row in report["huc8s"]),
    ))
    lines.extend(["", "## State portions", "",
        f"The {summary['state_row_count']} state rows sum to "
        f"{_display(summary['state_portion_acres'])} acres. "
        f"There are {summary['cross_state_huc_count']} cross-state watersheds. "
        "The difference between summed state portions and distinct watershed areas is "
        f"{_display(summary['state_area_minus_huc_area_acres'])} acres; both published "
        "measures are preserved.", ""])
    lines.extend(_markdown_table(
        ["State", "HUC12 state rows", "State area (ac)", "Priority state rows",
         "Priority state area (ac)"],
        ((row["state"], row["state_row_count"], row["state_portion_acres"],
          row["priority_huc_count"], row["priority_state_portion_acres"])
         for row in report["states"]),
    ))
    priority_rows = [row for row in report["hucs"] if row["priority"] is True]
    lines.extend(["", "## NRCS priority watersheds", "",
        f"Priority watersheds cover {_display(summary['priority_area_acres'])} acres "
        "when each whole watershed is counted once. Their designated state portions "
        f"cover {_display(summary['priority_state_portion_acres'])} acres.", ""])
    lines.extend(_markdown_table(
        ["HUC12", "Watershed", "Priority states", "System types", "Area (ac)",
         "Selected SC class records"],
        ((row["huc12"], row["name"], row["priority_states"], row["system_types"],
          row["area_acres"], row["selected_classification_count"]) for row in priority_rows),
    ))
    lines.extend(["", "## Source coverage", "",
        f"Coverage status: **{coverage['status']}**. "
        f"Selected South Carolina classes: {', '.join(coverage['selected_classes'])}. "
        f"{summary['queried_zero_target_huc_count']} watersheds have a complete query "
        "and zero records for these selected classes. "
        f"{summary['unverified_zero_target_huc_count']} zero-record watersheds lack "
        "a complete query bound to this source context.", "",
        "Class counts retain each source feature's publisher HUC12 attribute. "
        "The native receiving-water engine supplies spatial intersections and land-origin "
        "sediment and nutrient export summaries. InVEST transport ends at the modeled "
        "stream; HUC connectivity preserves the separate receptor relationship. "
        "Watersheds outside the classification layer's state jurisdiction remain "
        "in the original model domain.", "",
        "## Hydrologic connectivity", "",
        f"Native ToHUC status: **{report['network']['status']}**.", ""])
    if report["network"]["status"] != "not_supplied":
        lines.append(report["network"]["interpretation"])
        lines.extend(["", _display(
            report["network"]["model_domain_native_row_count"])
            + " model-domain watersheds have explicit native network records.", ""])
        exits = report["network"].get("domain_exit_edges", [])
        if exits:
            lines.extend(["### Downstream domain exits", ""])
            lines.extend(_markdown_table(
                ["Last model-domain HUC12", "Next original HUC12"],
                ((edge["huc12"], edge["ToHUC"]) for edge in exits),
            ))
            lines.append("")
    else:
        lines.extend(["Connect native HUC12/ToHUC records to populate upstream watershed "
                      "areas, upstream priorities, downstream paths and domain exits.", ""])
    if report["selection"]["requested"]:
        selection = report["selection"]
        selected_ids = set(selection["huc12s"])
        selected_rows = [row for row in report["hucs"] if row["huc12"] in selected_ids]
        noun = "watershed" if selection["summary"]["huc_count"] == 1 else "watersheds"
        lines.extend(["## Selected watersheds", "",
            f"The selection contains {_display(selection['summary']['huc_count'])} {noun} "
            f"covering {_display(selection['summary']['area_acres'])} acres. "
            "The complete model domain remains in the context report.", ""])
        lines.extend(_markdown_table(
            ["HUC12", "Watershed", "Whole watershed (ac)", "Priority states", "Selected SC class records"],
            ((row["huc12"], row["name"], row["area_acres"], row["priority_states"],
              row["selected_classification_count"]) for row in selected_rows),
        ))
        state_rows = [(row["huc12"], native) for row in selected_rows
                      for native in row["nrcs_state_rows"]]
        if state_rows:
            lines.extend(["", "### Selected state portions", ""])
            lines.extend(_markdown_table(
                ["HUC12", "State", "State portion (ac)", "FY26 priority status", "System type"],
                ((huc12, native.get("st_usps"), native.get("st_ac"),
                  native.get("fy26_status"), native.get("system_type"))
                 for huc12, native in state_rows),
            ))
        network_rows = [row for row in selected_rows if row.get("network")]
        if network_rows:
            lines.extend(["", "### Upstream context of selected watersheds", ""])
            lines.extend(_markdown_table(
                ["HUC12", "Next original HUC12", "Upstream model HUC12s",
                 "Upstream area (ac)", "Upstream priority HUC12s", "Downstream path"],
                ((row["huc12"],
                  row.get("downstream_huc12") or row["network"]["downstream_state"].replace("_", " "),
                  row["network"]["known_upstream_domain_huc_count"],
                  row["network"]["known_upstream_area_acres"],
                  row["network"]["known_upstream_priority_huc_count"],
                  row["network"]["downstream_path_status"].replace("_", " "))
                 for row in network_rows),
            ))
        lines.append("")
    lines.extend(["## Methods", ""])
    for method, description in report["methods"].items():
        lines.extend([f"**{method.replace('_', ' ').capitalize()}.** {description}", ""])
    lines.extend(["## Sources", ""])
    for source in report["sources"]:
        title = source.get("title") or source["source_id"].replace("_", " ").capitalize()
        lines.extend([f"### {_display(title)}", ""])
        if source.get("schema"):
            lines.extend([f"Schema: `{source['schema']}`", ""])
        for label, value in _source_reference_rows(source.get("reference")):
            rendered = _display(value)
            if isinstance(value, str) and value.startswith(("https://", "http://")):
                rendered = "<" + value.replace(">", "%3E").replace("<", "%3C") + ">"
            lines.append(f"- **{_display(label)}.** {rendered}")
        lines.extend([
            f"- **Canonical JSON SHA-256.** `{source['canonical_sha256']}`", "",
        ])
    lines.extend(["", "The complete source identities, original state records and query "
                  "references accompany the JSON exports.", "",
                  f"Context identifier: {report['id']}", ""])
    return "\n".join(lines)


def write_watershed_context(report: Mapping, output_dir: str | Path) -> dict:
    """Export JSON, source-preserving CSVs, selection files and a readable report.

    Return filename -> {path, bytes, sha256, media_type}; paths are relative to
    output_dir. The report's deterministic ID remains unchanged by export.
    """
    if report.get("schema") != SCHEMA:
        raise ValueError(f"Expected {SCHEMA} report")
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    selection = selected_watershed_export(report)
    json_dump = lambda value: (json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    outputs = {
        "watershed-context.json": (json_dump(report), "application/json"),
        "watershed-hucs.csv": (_csv_bytes(report["hucs"], HUC_COLUMNS), "text/csv"),
        "watershed-huc8s.csv": (_csv_bytes(report["huc8s"], HUC8_COLUMNS), "text/csv"),
        "watershed-states.csv": (_csv_bytes(report["states"], STATE_COLUMNS), "text/csv"),
        "watershed-report.md": (render_watershed_report(report).encode("utf-8"), "text/markdown"),
        "selected-watersheds.json": (json_dump(selection), "application/json"),
        "selected-watersheds.csv": (_csv_bytes(selection["hucs"], HUC_COLUMNS), "text/csv"),
    }
    result = {}
    for filename, (payload, media_type) in outputs.items():
        (destination / filename).write_bytes(payload)
        result[filename] = {
            "path": filename,
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "media_type": media_type,
        }
    return result


def _read_json_source(path: str | Path) -> Any:
    """Read retained plain JSON or gzip bytes without an extracted intermediate."""
    with Path(path).open("rb") as source:
        compressed = source.read(2) == b"\x1f\x8b"
        source.seek(0)
        if compressed:
            with gzip.GzipFile(fileobj=source, mode="rb") as decoded:
                return json.load(decoded)
        return json.load(source)


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-context", type=Path, required=True)
    parser.add_argument("--classification-coverage", type=Path)
    parser.add_argument("--network", type=Path, help="Original HUC12/ToHUC JSON or gzip source")
    parser.add_argument("--select-huc12", nargs="+", action="extend")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    read = _read_json_source
    report = build_watershed_context(
        read(args.source_context),
        read(args.classification_coverage) if args.classification_coverage else None,
        read(args.network) if args.network else None,
        args.select_huc12,
    )
    files = write_watershed_context(report, args.output_dir)
    print(json.dumps({"id": report["id"], "summary": report["summary"], "files": files},
                     ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
