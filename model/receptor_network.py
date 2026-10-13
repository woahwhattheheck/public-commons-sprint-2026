"""Contributing HUC12 memberships from retained Watershed Boundary Dataset links.

The calculation keeps the source's complete hydrologic-unit identifiers and
walks the original ToHUC relationship upstream. It operates on records already
selected by the source acquisition workflow and performs no provider requests.
"""
from __future__ import annotations
from collections import defaultdict, deque
import re

_HUC12 = re.compile(r"^[0-9]{12}$")
_ROLES = {"drinking_water", "high_quality_waters"}


def _field(properties, selected, default):
    if selected:
        if selected not in properties:
            raise ValueError("Network source lacks selected field " + selected)
        return selected
    matches = [key for key in properties if key.casefold() == default.casefold()]
    if len(matches) != 1:
        raise ValueError("Select the original " + default + " field in the network source")
    return matches[0]


def normalize_receptors(receptors):
    if not isinstance(receptors, list) or not receptors:
        raise ValueError("Select at least one source-water or high-quality-water area")
    seen, normalized = set(), []
    for original in receptors:
        row = dict(original)
        identity = row.get("id")
        if not isinstance(identity, str) or not identity.strip() or identity in seen:
            raise ValueError("Each receiving-water area needs a unique nonempty ID")
        seen.add(identity)
        if row.get("role") not in _ROLES:
            raise ValueError("Receiving-water role must be drinking_water or high_quality_waters")
        if not isinstance(row.get("title"), str) or not row["title"].strip():
            raise ValueError("Name each receiving-water area")
        anchors = row.get("anchor_huc12s")
        if (not isinstance(anchors, list) or not anchors
                or any(not isinstance(key, str) or not _HUC12.fullmatch(key) for key in anchors)):
            raise ValueError("Anchor HUC12s must be their complete 12-character source strings")
        if len(set(anchors)) != len(anchors):
            raise ValueError("An anchor HUC12 is repeated for " + identity)
        reference = row.get("reference")
        if (not isinstance(reference, dict)
                or not isinstance(reference.get("uri"), str) or not reference["uri"].strip()
                or not isinstance(reference.get("basis"), str) or not reference["basis"].strip()):
            raise ValueError("Retain the original source URI and geographic basis for " + identity)
        row["anchor_huc12s"] = sorted(anchors)
        normalized.append(row)
    return normalized


def upstream_memberships(records, receptors, *, huc12_field=None, tohuc_field=None,
                         name_field=None, type_field=None):
    """Return source-linked upstream sets and shortest downstream paths to anchors.

    Each record supplies an original properties dictionary and a feature ID.
    Source attributes remain in the returned network table. Closed basins,
    outside-network links and special hydrologic-unit types stay visible.
    """
    receptors = normalize_receptors(receptors)
    network, by_target = {}, defaultdict(list)
    fields = None
    for record in records:
        properties = dict(record["properties"])
        if fields is None:
            fields = {
                "huc12": _field(properties, huc12_field, "huc12"),
                "tohuc": _field(properties, tohuc_field, "tohuc"),
                "name": _field(properties, name_field, "name") if name_field else next(
                    (key for key in properties if key.casefold() == "name"), None),
                "type": _field(properties, type_field, "hutype") if type_field else next(
                    (key for key in properties if key.casefold() == "hutype"), None),
            }
        key = properties.get(fields["huc12"])
        if not isinstance(key, str) or not _HUC12.fullmatch(key):
            raise ValueError("Network HUC12 must retain its original 12-character string")
        if key in network:
            raise ValueError("Network contains repeated HUC12 " + key)
        raw_target = properties.get(fields["tohuc"])
        # Values such as OCEAN and CLOSED BASIN are original terminal labels.
        target = raw_target.strip() if isinstance(raw_target, str) else raw_target
        target_huc12 = target if isinstance(target, str) and _HUC12.fullmatch(target) and target != "000000000000" else None
        network[key] = {
            "huc12": key, "source_feature_id": str(record["id"]),
            "tohuc_original": raw_target, "tohuc12": target_huc12,
            "name": properties.get(fields["name"]) if fields["name"] else None,
            "hutype": properties.get(fields["type"]) if fields["type"] else None,
            "attributes": properties,
        }
        if target_huc12:
            by_target[target_huc12].append(key)
    if not network:
        raise ValueError("The selected network contains no original HUC12 records")
    for children in by_target.values():
        children.sort()
    areas, all_selected = [], set()
    for receptor in receptors:
        missing = set(receptor["anchor_huc12s"]) - set(network)
        if missing:
            raise ValueError("Network lacks anchor HUC12s for " + receptor["id"] + ": " + ", ".join(sorted(missing)))
        # A visited set handles source cycles without repeated members. Distances
        # are the number of original ToHUC links to the nearest selected anchor.
        queue = deque((key, 0, key) for key in receptor["anchor_huc12s"])
        distances, anchors, next_huc = {}, {}, {}
        while queue:
            key, distance, anchor = queue.popleft()
            if key in distances:
                continue
            distances[key], anchors[key] = distance, anchor
            next_huc[key] = network[key]["tohuc12"] if distance else None
            for upstream in by_target.get(key, ()):
                if upstream not in distances:
                    queue.append((upstream, distance + 1, anchor))
        selected = set(distances)
        all_selected.update(selected)
        areas.append({
            **receptor, "huc12s": sorted(selected), "huc12_count": len(selected),
            "memberships": [{
                "huc12": key, "anchor_huc12": anchors[key],
                "downstream_huc12": next_huc[key], "links_to_anchor": distances[key],
                "is_anchor": key in receptor["anchor_huc12s"],
            } for key in sorted(selected)],
        })
    return {
        "schema": "upstate.receptor-network/v1", "source_fields": fields,
        "method": "Reverse traversal of retained original ToHUC edges, including selected anchor HUC12s",
        "network": [network[key] for key in sorted(network)],
        "network_huc12_count": len(network), "areas": areas,
        "selected_huc12_count": len(all_selected),
        "shared_huc12s": {
            key: [area["id"] for area in areas if key in area["huc12s"]]
            for key in sorted(all_selected)
            if sum(key in area["huc12s"] for area in areas) > 1
        },
        "outside_network_links": [
            {"huc12": key, "tohuc12": row["tohuc12"]}
            for key, row in sorted(network.items())
            if row["tohuc12"] and row["tohuc12"] not in network
        ],
        "terminal_links": [
            {"huc12": key, "tohuc_original": row["tohuc_original"]}
            for key, row in sorted(network.items()) if row["tohuc12"] is None
        ],
        "special_hydrologic_units": [
            {"huc12": key, "hutype": row["hutype"], "tohuc_original": row["tohuc_original"]}
            for key, row in sorted(network.items())
            if row["hutype"] not in (None, "", "S")
        ],
        "geographic_basis": "Entire source HUC12 units and their retained upstream relationship",
        "network_extent": "Memberships reflect the original retained network source edition",
        "quantity_basis": "Land-origin export delivered to the modeled stream network within the reporting area",
    }
