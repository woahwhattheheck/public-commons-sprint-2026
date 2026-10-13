"""Whole-HUC utility selections from an original profile and saved native network."""
from __future__ import annotations

from collections.abc import Mapping
import copy
import math

from .watershed_context import PRIORITY_STATUS, _digest, _huc, _number, _summary

VERSION = "1.0.0"
PROFILE_NAME = "utility-focus-profile.json"
SELECTION_SCHEMA = "upstate.utility-watershed-selection/v1"


def programme_summary(rows):
    """Sum original designated state-HUC portions without merging programme labels."""
    groups = {}
    for watershed in rows:
        for original in watershed.get("nrcs_state_rows", []):
            if str(original.get("fy26_status") or "").strip().casefold() != PRIORITY_STATUS.casefold():
                continue
            label = str(original.get("system_type") or "").strip() or "Unspecified"
            group = groups.setdefault(label, {"system_type": label, "state_row_count": 0,
                                             "known_state_portion_acres": 0., "missing_area_count": 0,
                                             "state_huc_keys": []})
            area = _number(original.get("st_ac"), "NRCS designated state-portion acres")
            group["state_row_count"] += 1
            group["missing_area_count"] += area is None
            group["state_huc_keys"].append({
                "huc12": watershed["huc12"], "state": original["st_usps"]})
            if area is not None:
                group.setdefault("_areas", []).append(area)
    for label in ("Ground", "Surface", "Both"):
        groups.setdefault(label, {"system_type": label, "state_row_count": 0,
                                 "known_state_portion_acres": 0., "missing_area_count": 0,
                                 "state_huc_keys": []})
    for group in groups.values():
        group["known_state_portion_acres"] = math.fsum(group.pop("_areas", []))
        group["state_portion_acres"] = (
            None if group["missing_area_count"] else group["known_state_portion_acres"])
    return [groups[key] for key in sorted(groups)]


def state_records(rows):
    """Retain all original attributes plus an unambiguous selected-HUC key."""
    result = []
    for watershed in rows:
        for source in watershed.get("nrcs_state_rows", []):
            result.append({**copy.deepcopy(source), "selected_huc12": watershed["huc12"]})
    return result


def utility_selections(report, profile, source_identity):
    """Bind whole-HUC source planning selections to the saved report and profile.

    Missing/partial topology yields a visible unavailable choice. Every returned
    available footprint follows original downstream paths, then agrees with the
    independently retained upstream membership.
    """
    if report.get("schema") != "upstate.watershed-context/v1":
        raise ValueError("Choose a saved regional watershed report")
    if profile.get("schema") != "upstate.receptor-spec/v1":
        raise ValueError("Choose the original utility receptor profile")
    receptors = profile.get("receptors")
    if not isinstance(receptors, list) or not receptors:
        raise ValueError("The utility profile must retain its receptor rows")
    rows = report.get("hucs") or []
    indexed = {row["huc12"]: row for row in rows}
    if len(indexed) != len(rows):
        raise ValueError("The saved report contains duplicate watershed IDs")
    result, used = [], set()
    for receptor in receptors:
        utility_id = str(receptor.get("utility_id") or receptor.get("id") or "").strip()
        if not utility_id or utility_id in used:
            raise ValueError("The profile must have distinct utility identities")
        used.add(utility_id)
        original_anchors = receptor.get("anchor_huc12s")
        if not isinstance(original_anchors, list) or not original_anchors:
            raise ValueError("Retain original utility anchor HUC12s")
        anchors = [_huc(value, "utility anchor") for value in original_anchors]
        if len(anchors) != len(set(anchors)):
            raise ValueError("Utility anchors must be distinct")
        base = {
            "schema": SELECTION_SCHEMA, "version": VERSION,
            "utility_id": utility_id, "receptor_id": receptor.get("id"),
            "title": receptor.get("title") or utility_id, "anchor_huc12s": sorted(anchors),
            "profile_source": copy.deepcopy(source_identity),
            "reference": copy.deepcopy(receptor.get("reference", {})),
            "profile_notes": copy.deepcopy(profile.get("notes", [])),
            "report_id": report["id"], "report_canonical_sha256": _digest(report),
            "geography": "Whole original HUC12 planning units within the selected model domain",
        }
        missing = sorted(set(anchors) - indexed.keys())
        if missing:
            reason = "Original profile anchors are absent from this saved report: " + ", ".join(missing)
        elif (report.get("network") or {}).get("status") != "complete_model_domain":
            reason = "Build this regional context with its complete original HUC12 / ToHUC network."
        else:
            reason = None
        if reason:
            item = {**base, "available": False, "reason": reason, "huc12s": []}
            item["key"] = _digest(item)
            result.append(item)
            continue
        # Saved original downstream paths include any intermediate source HUCs
        # outside the model domain, so a path that re-enters the domain is retained.
        members = set(anchors)
        for row in rows:
            path = (row.get("network") or {}).get("downstream_huc12s") or []
            if any(anchor in path for anchor in anchors):
                members.add(row["huc12"])
        selected = [indexed[key] for key in sorted(members)]
        known = set(anchors)
        external = set()
        for anchor in anchors:
            context = indexed[anchor].get("network") or {}
            known.update(context.get("known_upstream_domain_huc12s") or [])
            external.update(context.get("known_external_upstream_huc12s") or [])
        if known != members:
            raise ValueError("Saved upstream membership differs from its original ToHUC links")
        states = state_records(selected)
        item = {
            **base, "available": True, "reason": None, "huc12s": sorted(members),
            "summary": _summary(selected), "programme_designations": programme_summary(selected),
            "state_rows": states,
            "known_external_upstream_huc12s": sorted(external),
            "membership": [
                {"huc12": row["huc12"], "downstream_huc12": row.get("downstream_huc12"),
                 "is_profile_anchor": row["huc12"] in anchors}
                for row in selected
            ],
            "interpretation": (
                "Anchors and their distinct upstream model-domain HUC12s form a whole-HUC "
                "planning footprint. Published intake protection polygons and native reporting "
                "masks retain separate boundaries. NRCS Ground, Surface and Both are original "
                "programme designations on state-HUC records. Selected SC feature counts use "
                "publisher HUC attributes; source jurisdiction remains South Carolina. "
                "InVEST land-origin export ends at the modeled stream; this source selection "
                "adds no river/reservoir retention or intake-concentration calculation."
            ),
            "area_basis": "NRCS huc12_ac counted once per selected HUC12; st_ac once per original state-HUC row",
        }
        item["key"] = _digest(item)
        result.append(item)
    return result
