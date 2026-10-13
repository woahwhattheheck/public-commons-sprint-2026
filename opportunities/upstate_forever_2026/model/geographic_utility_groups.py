"""Add original utility-group unions to a geographic receiving-water plan.

The existing individual HUC anchors and family union remain unchanged. Group
quantities are calculated by Receiving from one union mask, never by adding
potentially overlapping individual-anchor totals.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path

from .common import file_digest
from . import receiving_waters as waters

PROFILE = "source/receptor-profiles/utility-focus-20261012.json"
SCHEMA = "upstate.geographic-utility-groups/v1"


def augment(workspace, prepared, upstream, *, profile_path=None):
    """Return a source-bound plan with each selected utility's upstream union.

    A partial selection is labelled as a selected subset, not a complete utility
    catchment. Unmapped anchors remain in the original plan and are enumerated
    in its metadata. An edited profile is a new, explicitly hashed edition.
    """
    result = deepcopy(upstream)
    profile_name = str(profile_path) if profile_path else PROFILE
    profile_path = Path(profile_path) if profile_path else Path(__file__).resolve().parents[1] / PROFILE
    profile_bytes = profile_path.read_bytes()
    profile = json.loads(profile_bytes)
    if profile.get("schema") != "upstate.receptor-spec/v1":
        raise ValueError("Use an original utility-focus receptor profile")
    definitions = profile.get("receptors")
    if not isinstance(definitions, list) or not definitions:
        raise ValueError("The original utility profile requires receptor definitions")
    selected = prepared["selection"]
    anchors = list(selected["reporting_huc12s"])
    if len(anchors) != len(set(anchors)):
        raise ValueError("Select distinct original geographic anchors")
    if set(anchors) != set(prepared["geography"]["reporting_huc12s"]):
        raise ValueError("Original geographic and selected anchor memberships differ")
    expected = set(prepared["geography"]["model_domain_huc12s"])
    existing = {row["id"]: row for row in result["receptors"]}
    if len(existing) != len(result["receptors"]):
        raise ValueError("Existing receiving receptor IDs must be distinct")
    for code in anchors:
        original = existing.get("huc-" + code)
        if (original is None or original["relation"].get("method") != "upstream_huc"
                or original["relation"].get("seed_huc_ids") != [code]
                or original.get("family") != "critical_drinking_water"):
            raise ValueError("Keep every original individual geographic HUC receptor")

    # Resolve the native IDs through the same reader that will consume them.
    # Do not assume an array position, OBJECTID field or GDAL-generated ID.
    source = deepcopy(selected["huc_polygons"])
    if source.pop("part", None) is not None:
        raise ValueError("Use the original retained vector entry for utility grouping")
    rows, source_identity = waters._source(workspace, source, result["analysis_crs"])
    huc_field = selected["huc_field"]
    graph = waters.huc_graph(rows, id_field=huc_field, downstream_field="tohuc")
    native_ids, seen_native = {}, set()
    for row in rows:
        code = waters._huc(row["properties"][waters._field(row["properties"], huc_field)])
        native_id = row["id"]
        if code in native_ids or native_id in seen_native:
            raise ValueError("Original HUC and native feature identities must be unique")
        native_ids[code] = native_id
        seen_native.add(native_id)
    if set(anchors) - set(native_ids):
        raise ValueError("The retained original vector lacks selected geographic anchors")

    profile_binding = {"path": profile_name, "sha256": hashlib.sha256(profile_bytes).hexdigest(),
                       "bytes": len(profile_bytes), "schema": profile["schema"]}
    groups, mapped, profile_ids = [], set(), set()
    for definition in definitions:
        if definition.get("role") != "drinking_water":
            continue
        profile_id = waters._safe_label(definition.get("id"), "original utility profile ID")
        if profile_id in profile_ids:
            raise ValueError("Original utility profile IDs must be distinct")
        profile_ids.add(profile_id)
        utility_id = waters._title(definition.get("utility_id"), "original utility ID")
        original_anchors = definition.get("anchor_huc12s")
        if not isinstance(original_anchors, list) or not original_anchors:
            raise ValueError("Original utility definitions require HUC12 anchors")
        all_anchors = [waters._huc(value) for value in original_anchors]
        if len(all_anchors) != len(set(all_anchors)):
            raise ValueError("Original utility profile repeats an anchor")
        group_anchors = [code for code in all_anchors if code in anchors]
        if not group_anchors:
            continue
        reference = deepcopy(definition.get("reference", {}))
        waters._title(reference.get("uri"), "original utility reference URI")
        rationale = waters._title(reference.get("basis"), "original utility anchor basis")
        closure = waters.upstream_hucs(graph, group_anchors)
        if set(closure) - expected:
            raise ValueError("Utility upstream closure exceeds the prepared geographic model domain")
        rid = "utility-" + profile_id
        if rid in existing:
            raise ValueError("Utility group collides with an existing receiving receptor ID")
        complete = len(group_anchors) == len(all_anchors)
        descriptor = {
            "id": rid, "utility_id": utility_id, "source_profile_id": profile_id,
            "selected_anchor_huc12s": group_anchors,
            "profile_anchor_huc12s": all_anchors,
            "complete_profile_selection": complete,
            "member_receptor_ids": ["huc-" + code for code in group_anchors],
            "native_feature_ids": [native_ids[code] for code in group_anchors],
            "upstream_huc12s": closure,
            "reference": reference,
        }
        name = waters._title(definition.get("title"), "original utility title")
        name += (": upstream union" if complete else
                 ": selected %d of %d focus anchors, upstream union" % (len(group_anchors), len(all_anchors)))
        result["receptors"].append({
            "id": rid, "title": name, "family": "critical_drinking_water",
            "source": {**source, "feature_ids": descriptor["native_feature_ids"]},
            "relation": {
                "method": "upstream_huc", "seed_huc_ids": group_anchors,
                "evidence": [reference, {"original_profile": profile_binding,
                                         "geographic_edition_id": prepared["id"]}],
                "rationale": rationale + " Union only the selected original anchors and their retained ToHUC ancestors.",
            },
            "classification": {**deepcopy(definition.get("classification", {})),
                               "utility_id": utility_id, "utility_group": descriptor},
            "metadata": {
                "geographic_edition_id": prepared["id"],
                "original_receptor_definition": deepcopy(definition),
                "original_profile": profile_binding,
                "overlap": "One union mask; each selected cell contributes once. Do not sum individual-anchor totals.",
                "interpretation": "Potential upstream contributing land at HUC12 resolution; distinct from published protection polygons and intake delivery.",
            },
        })
        existing[rid] = result["receptors"][-1]
        groups.append(descriptor)
        mapped.update(group_anchors)
    result.setdefault("metadata", {})["utility_groups"] = {
        "schema": SCHEMA, "profile": profile_binding,
        "implementation_sha256": file_digest(__file__),
        "retained_vector": source_identity, "groups": groups,
        "ungrouped_anchor_huc12s": sorted(set(anchors) - mapped),
        "quantity_scope": "Selected independently by the original Receiving analysis",
        "combined_family_union": "Preserved; added group masks are subsets of existing anchor unions",
    }
    return result
