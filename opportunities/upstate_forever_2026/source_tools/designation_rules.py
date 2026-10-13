"""Source-bound water designation applicability and receiving-resource export.

Needs expert review: source interpretation and native reach applicability.

Consumes normalized rows from the retained source crosswalk. It does not parse
GIS classification strings, change source geometries, or rank legal classes.
All identifiers and source attributes remain available in the output.

Run:
    python source_tools/designation_rules.py --input network.json \
        --rules source/water-designations/sc-effective-rules.json \
        --output applicability.json
"""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

SCHEMA = "upstate.designation-applicability/v1"
INPUT_SCHEMA = "upstate.designation-network/v1"


def _identifier(value: Any, field: str) -> str:
    if value is None or isinstance(value, bool):
        raise ValueError(f"{field} requires a nonempty source identifier")
    text = str(value).strip()
    if not text:
        raise ValueError(f"{field} requires a nonempty source identifier")
    return text


def _unique_records(records: Iterable[Mapping[str, Any]], kind: str) -> dict:
    result = {}
    for row in records:
        key = _identifier(row.get("id"), f"{kind}.id")
        if key in result:
            raise ValueError(f"duplicate {kind} id: {key}")
        result[key] = deepcopy(dict(row))
        result[key]["id"] = key
    return result


def _record_source_refs(record: Mapping[str, Any]) -> list:
    """Keep source feature identity as authored; never manufacture native IDs."""
    return deepcopy(record.get("source_feature_refs", []))


def _unique_refs(refs):
    result, seen = [], set()
    for ref in refs:
        token = json.dumps(ref, sort_keys=True, ensure_ascii=False)
        if token not in seen:
            seen.add(token)
            result.append(deepcopy(ref))
    return result


def feature_id_selector(source_feature_refs, *, source_id, layer_id, field):
    """Compile exact native-ID membership for model.rasters.vector_geometry.

    Reference schema: {source_id, layer_id, field, value}. Caller source identity
    selects the namespace before matching source attributes.
    """
    values = {
        _identifier(ref.get("value"), "source feature ID")
        for ref in source_feature_refs
        if ref.get("source_id") == source_id
        and str(ref.get("layer_id")) == str(layer_id)
        and ref.get("field") == field
    }

    def matches(properties):
        value = properties.get(field)
        return value is not None and not isinstance(value, bool) and str(value) in values

    return matches


def iter_selected_features(features, source_feature_refs, *, source_id, layer_id, field):
    """Yield original GeoJSON/Esri/Fiona feature objects with matching native IDs."""
    predicate = feature_id_selector(
        source_feature_refs, source_id=source_id, layer_id=layer_id, field=field
    )
    for feature in features:
        properties = feature.get("properties")
        if properties is None:
            properties = feature.get("attributes", {})
        if predicate(properties):
            yield feature


def make_designated_resource(resource_id, parsed_class, *, node_ids,
                             source_feature_refs, status, rule_edition_id, label=None):
    """Consume high_quality_water_crosswalk.parse_class's existing result."""
    return {
        "id": _identifier(resource_id, "resource.id"),
        "kind": "designated_water",
        "label": label if label is not None else parsed_class.get("class_label"),
        "node_ids": sorted({_identifier(node, "resource.node_ids") for node in node_ids}),
        "source_feature_refs": _unique_refs(source_feature_refs),
        "status": status,
        "rule_edition_id": rule_edition_id,
        "primary_class": parsed_class.get("class_code"),
        "previous_class": parsed_class.get("previous_class"),
        "raw_class": deepcopy(parsed_class.get("class_raw")),
        "site_specific": deepcopy(parsed_class.get("site_specific")),
        "source_priority": deepcopy(parsed_class.get("rfp_high_quality_candidate")),
        "source_parse_resolution": deepcopy(parsed_class.get("class_resolution")),
    }


def make_reach_record(node_id, parsed_class, *, listing_status, jurisdiction,
                      source_feature_refs, regulation_status, rule_edition_id,
                      site_specific_numeric_criteria=None, tidal=False):
    """Create an explicit reach node; listing status must come from source work."""
    if listing_status not in {"listed", "unlisted", "unknown"}:
        raise ValueError("listing_status requires listed, unlisted or unknown")
    return {
        "id": _identifier(node_id, "reach.id"),
        "listing_status": listing_status,
        "jurisdiction": jurisdiction,
        "tidal": tidal,
        "source_feature_refs": _unique_refs(source_feature_refs),
        "classification": {
            "primary_class": parsed_class.get("class_code"),
            "previous_class": parsed_class.get("previous_class"),
            "raw_class": deepcopy(parsed_class.get("class_raw")),
            "site_specific": deepcopy(parsed_class.get("site_specific")),
            "site_specific_numeric_criteria": deepcopy(site_specific_numeric_criteria),
            "status": regulation_status,
            "rule_edition_id": rule_edition_id,
            "source_parse_resolution": deepcopy(parsed_class.get("class_resolution")),
        },
    }


def resource_set_from_registry(registry, associations, *, registry_source_id=None):
    """Bind retained R.61-69 registry IDs to explicit native feature/HUC matches.

    associations maps a registry record ID to {node_ids,source_feature_refs,...}.
    All selected source records remain in the resource document; its explicit
    default selection uses the source's rfp_high_quality_candidate flag.
    """
    if registry.get("schema") != "upstate.classified-water-registry/v1":
        raise ValueError("expected upstate.classified-water-registry/v1")
    edition = registry["edition"]
    if registry_source_id is None:
        registry_source_id = registry.get("source_id") or (
            "sc-r61-69-current-reach-registry"
            if edition["id"] == "sc-r61-69-2023"
            else edition["id"] + "-reach-registry"
        )
    resources, selected = [], []
    for row in registry["records"]:
        rid = _identifier(row.get("id"), "registry record id")
        association = associations.get(rid, {})
        parsed = {
            "class_raw": row.get("class_raw"),
            "class_label": row.get("waterbody_name"),
            "class_code": row.get("class_code"),
            "previous_class": row.get("previous_class"),
            "site_specific": row.get("site_specific"),
            "rfp_high_quality_candidate": row.get("rfp_high_quality_candidate"),
            "class_resolution": "retained_regulatory_record",
        }
        resource = make_designated_resource(
            rid, parsed,
            node_ids=association.get("node_ids", []),
            source_feature_refs=association.get("source_feature_refs", []),
            status=edition["status"],
            rule_edition_id=edition["id"],
            label=row.get("waterbody_name"),
        )
        resource["rule_record_ref"] = {
            "source_id": registry_source_id,
            "record_id": rid,
            "source_pdf_page": row.get("source_pdf_page"),
            "source_line_start": row.get("source_line_start"),
            "source_line_end": row.get("source_line_end"),
        }
        resource["reach_description"] = row.get("reach_description")
        resource["county_codes"] = deepcopy(row.get("county_codes", []))
        resource["no_discharge_zone"] = row.get("no_discharge_zone")
        resource["mapping"] = deepcopy(association)
        resources.append(resource)
        if row.get("rfp_high_quality_candidate") is True:
            selected.append(rid)
    return {
        "schema": "upstate.designated-resource-set/v1",
        "resources": resources,
        "selection": {"resource_ids": selected, "include_proposed": False},
        "registry_coverage": deepcopy(registry.get("coverage")),
        "sources": [{
            "id": registry_source_id,
            "edition": deepcopy(edition),
            "source_extraction": deepcopy(registry.get("source_extraction")),
        }],
    }


def _numeric_class(classification, rules):
    value = classification.get("numeric_criteria_class")
    if value is not None:
        return value if value in rules["class_codes"] else None
    primary = classification.get("primary_class")
    basis = rules.get("numeric_criteria_basis", {}).get(primary, "primary_class")
    if basis == "previous_class":
        previous = classification.get("previous_class")
        return previous if previous in rules["class_codes"] else None
    return primary if basis == "primary_class" else basis


def _network(payload: Mapping[str, Any]) -> tuple:
    descriptor = payload.get("network", {})
    nodes = _unique_records(descriptor.get("nodes", []), "network node")
    downstream = defaultdict(set)
    upstream = defaultdict(set)
    for pair in descriptor.get("edges", []):
        if isinstance(pair, Mapping):
            parent, child = pair.get("from"), pair.get("to")
        else:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                raise ValueError("network edges require [from,to] or {from,to}")
            parent, child = pair
        parent = _identifier(parent, "edge.from")
        child = _identifier(child, "edge.to")
        if parent not in nodes or child not in nodes:
            raise ValueError(f"edge contains an undeclared node: {parent} -> {child}")
        downstream[parent].add(child)
        upstream[child].add(parent)
    return descriptor, nodes, downstream, upstream


def from_wbd_bindings(bindings, resources, *, selection=None, operation=None,
                      domain_source_id="upstate-wbd-upstream-domain-20261012"):
    """Adapt retained 217-HUC native bindings without reopening or clipping geometry."""
    if bindings.get("schema") != "upstate.wbd-domain-bindings/v1":
        raise ValueError("bindings schema must be upstate.wbd-domain-bindings/v1")
    rows = bindings.get("features", [])
    if bindings.get("feature_count") is not None and bindings["feature_count"] != len(rows):
        raise ValueError("binding feature_count differs from retained feature rows")
    native_id_field = bindings.get("native_object_id_field")
    if not native_id_field:
        raise ValueError("bindings require native_object_id_field")
    by_huc = {}
    for row in rows:
        code = row.get("huc12")
        if not isinstance(code, str) or len(code) != 12 or not code.isdigit():
            raise ValueError("native HUC12 codes must be retained as 12-character strings")
        if code in by_huc:
            raise ValueError(f"duplicate HUC12 binding: {code}")
        _identifier(row.get("object_id"), "native WBD object_id")
        by_huc[code] = row
    selected = bindings.get("selected_huc12")
    if selected is not None and set(selected) != set(by_huc):
        raise ValueError("selected_huc12 and feature binding membership differ")
    nodes, edges, boundaries = [], [], []
    for code in sorted(by_huc):
        row = by_huc[code]
        receiver = row.get("tohuc")
        receiver_text = None if receiver is None else str(receiver).strip()
        nodes.append({
            "id": code,
            "listing_status": "unknown",
            "intersects_reporting_area": row.get("intersects_reporting_area"),
            "source_feature_refs": [{
                "source_id": domain_source_id,
                "layer_id": bindings.get("layer_id"),
                "field": native_id_field,
                "value": row["object_id"],
                "huc12": code,
                "original_body": row.get("original_body"),
                "original_feature_index": row.get("original_feature_index"),
                "original_stored_sha256": row.get("original_stored_sha256"),
            }],
        })
        if receiver_text in by_huc:
            edges.append([code, receiver_text])
        else:
            boundaries.append({"from": code, "native_tohuc": receiver})
    return {
        "schema": INPUT_SCHEMA,
        "operation": operation,
        "network": {
            "node_kind": "huc12",
            "source": {
                "source_id": domain_source_id,
                "bindings_schema": bindings["schema"],
                "original_capture_sha256": bindings.get("original_capture_sha256"),
                "selection_sha256": bindings.get("selection_sha256"),
                "native_object_id_field": native_id_field,
                "native_huc12_field": bindings.get("native_huc12_field"),
                "native_tohuc_field": bindings.get("native_tohuc_field"),
            },
            "nodes": nodes,
            "edges": edges,
            "boundary_links": boundaries,
        },
        "resources": deepcopy(list(resources)),
        "selection": deepcopy(selection or {}),
        "sources": [],
    }


def _inheritance(nodes, downstream, upstream, rules, node_kind):
    """Resolve nearest named receiving reaches over an explicit source graph.

    Listed reaches terminate classification inheritance. Unknown listing status,
    mixed editions, missing class definitions and cross-border nodes remain
    visible as distinct obstructions. A graph cycle with a known exit resolves
    through monotone set propagation; a closed cycle has no receiving anchor.
    """
    edition = rules["effective_edition"]["id"]
    current_classes = set(rules["class_codes"])
    if node_kind != "water_reach":
        return {
            key: {
                "status": "context_only_at_this_resolution",
                "source_classification": deepcopy(row.get("classification")),
                "inherited_classification": None,
                "receiving_anchor_ids": [],
                "reason_codes": ["network_nodes_are_not_individual_water_reaches"],
            }
            for key, row in nodes.items()
        }

    anchors = {key: set() for key in nodes}
    obstructions = {key: set() for key in nodes}
    pass_through = set()
    for key, row in nodes.items():
        listing = row.get("listing_status", "unknown")
        cls = row.get("classification") or {}
        if row.get("jurisdiction") != "SC":
            obstructions[key].add((key, "outside_rule_jurisdiction"))
        elif listing == "listed":
            if cls.get("rule_edition_id") != edition:
                obstructions[key].add((key, "different_or_unset_rule_edition"))
            elif cls.get("status") != "current":
                obstructions[key].add((key, "classification_is_not_effective_current"))
            elif cls.get("primary_class") not in current_classes:
                obstructions[key].add((key, "missing_normalized_primary_class"))
            else:
                anchors[key].add(key)
        elif listing == "unlisted" and row.get("tidal") is True:
            obstructions[key].add((key, "tidal_numeric_standard_comparison"))
        elif listing == "unlisted":
            pass_through.add(key)
            if not downstream[key]:
                obstructions[key].add((key, "network_boundary_without_named_receiver"))
        elif listing == "unknown":
            obstructions[key].add((key, "listing_status_unresolved"))
        else:
            raise ValueError(f"unknown listing_status at {key}: {listing}")

    queue = deque(nodes)
    queued = set(nodes)
    while queue:
        child = queue.popleft()
        queued.discard(child)
        for parent in upstream[child]:
            if parent not in pass_through:
                continue
            old_size = len(anchors[parent]) + len(obstructions[parent])
            anchors[parent].update(anchors[child])
            obstructions[parent].update(obstructions[child])
            if len(anchors[parent]) + len(obstructions[parent]) != old_size:
                if parent not in queued:
                    queue.append(parent)
                    queued.add(parent)

    result = {}
    for key, row in nodes.items():
        cls = deepcopy(row.get("classification"))
        candidates = sorted(anchors[key])
        reasons = sorted(obstructions[key])
        entry = {
            "status": "unresolved",
            "source_classification": cls,
            "inherited_classification": None,
            "receiving_anchor_ids": candidates,
            "obstructions": [
                {"node_id": n, "reason": reason} for n, reason in reasons
            ],
            "reason_codes": sorted({reason for _, reason in reasons}),
        }
        if row.get("listing_status") == "listed":
            entry["status"] = "source_named_classification"
        elif row.get("listing_status") == "unlisted" and not reasons:
            signatures = {
                (
                    nodes[target]["classification"]["primary_class"],
                    _numeric_class(nodes[target]["classification"], rules),
                )
                for target in candidates
            }
            if len(signatures) == 1:
                primary, numeric = next(iter(signatures))
                entry["status"] = "resolved" if numeric else "resolved_use_class"
                entry["inherited_classification"] = {
                    "primary_class": primary,
                    "numeric_criteria_class": numeric,
                    "site_specific_numeric_criteria": None,
                    "rule_edition_id": edition,
                    "rule_refs": ["R.61-69.B"],
                    "basis": "explicit_unlisted_tributary",
                    "source_anchor_ids": candidates,
                    "source_feature_refs": _unique_refs(
                        ref for target in candidates
                        for ref in _record_source_refs(nodes[target])
                    ),
                }
                if numeric is None:
                    entry["reason_codes"] = ["numeric_class_awaits_source_resolution"]
            elif len(signatures) > 1:
                entry["status"] = "multiple_receiving_classes"
                entry["reason_codes"] = ["receiving_classes_are_not_interchangeable"]
                entry["receiving_class_options"] = [
                    {"primary_class": primary, "numeric_criteria_class": numeric}
                    for primary, numeric in sorted(signatures, key=lambda x: (x[0], x[1] or ""))
                ]
            else:
                entry["reason_codes"] = ["no_named_receiving_anchor_in_network"]
        result[key] = entry
    return result


def _receiving_context(nodes, upstream, resources):
    """Propagate resource relationships; never propagate legal class labels."""
    by_node = {key: [] for key in nodes}
    by_resource = {}
    for resource_id, resource in resources.items():
        target_nodes = {
            _identifier(value, "resource.node_ids")
            for value in resource.get("node_ids", [])
        }
        missing = sorted(target_nodes - nodes.keys())
        mapped_nodes = target_nodes & nodes.keys()
        reached = set(mapped_nodes)
        queue = deque(mapped_nodes)
        while queue:
            child = queue.popleft()
            for parent in upstream[child]:
                if parent not in reached:
                    reached.add(parent)
                    queue.append(parent)
        for key in reached:
            by_node[key].append(resource_id)
        by_resource[resource_id] = {
            "resource": deepcopy(resource),
            "target_node_ids": sorted(mapped_nodes),
            "source_requested_node_ids": sorted(target_nodes),
            "unmodeled_node_ids": missing,
            "mapping_status": (
                "mapped" if mapped_nodes and not missing else
                "partially_mapped" if mapped_nodes else "unmapped"
            ),
            "upstream_and_target_node_ids": sorted(reached),
            "node_count": len(reached),
        }
    for selected in by_node.values():
        selected.sort()
    return by_node, by_resource


def apply_rules(payload: Mapping[str, Any], rules: Mapping[str, Any]) -> dict:
    """Return context and exact selected source IDs from normalized source rows."""
    if payload.get("schema") != INPUT_SCHEMA:
        raise ValueError(f"input schema must be {INPUT_SCHEMA}")
    if rules.get("schema") != "upstate.designation-rules/v1":
        raise ValueError("rules schema must be upstate.designation-rules/v1")
    if rules.get("effective_edition", {}).get("status") != "effective":
        raise ValueError("the effective-rules profile requires an effective edition")
    descriptor, nodes, downstream, upstream = _network(payload)
    resources = _unique_records(payload.get("resources", []), "resource")
    selection = payload.get("selection", {})
    requested = selection.get("resource_ids")
    if requested is None:
        selected_resources = resources
    else:
        requested = {_identifier(value, "selection.resource_ids") for value in requested}
        missing = requested - resources.keys()
        if missing:
            raise ValueError(f"selection includes unknown resource IDs: {sorted(missing)}")
        selected_resources = {key: resources[key] for key in sorted(requested)}
    effective_id = rules["effective_edition"]["id"]
    excluded_resources = []
    context_resources = {}
    include_proposed = selection.get("include_proposed", False)
    if not isinstance(include_proposed, bool):
        raise ValueError("selection.include_proposed must be a boolean")
    for key, resource in selected_resources.items():
        status = resource.get("status", "unknown")
        if status == "proposed" and not include_proposed:
            excluded_resources.append({"resource_id": key, "reason": "proposal_scenario_not_selected"})
        else:
            context_resources[key] = resource
    inheritance = _inheritance(
        nodes, downstream, upstream, rules, descriptor.get("node_kind")
    )
    receivers, resource_output = _receiving_context(nodes, upstream, context_resources)
    output_nodes = []
    for key in sorted(nodes):
        row = nodes[key]
        links = []
        for rid in receivers[key]:
            resource = context_resources[rid]
            kind = resource.get("kind")
            links.append({
                "resource_id": rid,
                "kind": kind,
                "relationship": "target_or_upstream_network_node",
                "resource_status": resource.get("status", "unknown"),
                "rule_edition_id": resource.get("rule_edition_id"),
                "source_feature_refs": _record_source_refs(resource),
                "context_rule_refs": (
                    ["R.61-68.G.2"] if kind == "designated_water"
                    and resource.get("status") == "current"
                    and resource.get("rule_edition_id") == effective_id else []
                ),
            })
        output_nodes.append({
            "id": key,
            "source_feature_refs": _record_source_refs(row),
            "jurisdiction": row.get("jurisdiction"),
            "intersects_reporting_area": row.get("intersects_reporting_area"),
            "listing_status": row.get("listing_status", "unknown"),
            "classification": inheritance[key],
            "receiving_resources": links,
            "is_resource_target": any(
                key in resource_output[rid]["target_node_ids"]
                for rid in receivers[key]
            ),
        })
    return {
        "schema": SCHEMA,
        "operation": payload.get("operation"),
        "rule_profile": deepcopy(rules),
        "network": {
            "node_kind": descriptor.get("node_kind"),
            "source": deepcopy(descriptor.get("source")),
            "node_count": len(nodes),
            "edge_count": sum(map(len, downstream.values())),
            "boundary_links": deepcopy(descriptor.get("boundary_links", [])),
        },
        "selection": deepcopy(selection),
        "selected_resource_ids": sorted(context_resources),
        "selected_source_feature_refs": _unique_refs(
            ref for rid in sorted(context_resources)
            for ref in _record_source_refs(context_resources[rid])
        ),
        "excluded_resources": excluded_resources,
        "nodes": output_nodes,
        "resources": [resource_output[rid] for rid in sorted(resource_output)],
        "source_catalog": deepcopy(payload.get("sources", [])),
        "interpretation": {
            "classification_and_connection_are_distinct": True,
            "numeric_site_specific_standards_inherited": False,
            "proposed_resource_context_enabled": include_proposed,
            "receiving_context_depends_on_supplied_network_resolution": True,
            "source_geometry_and_native_class_fields_preserved": True,
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--input", type=Path)
    source_group.add_argument("--bindings", type=Path)
    parser.add_argument("--resources", type=Path)
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--operation")
    parser.add_argument("--rules", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    source_path = args.input or args.bindings
    source_bytes = source_path.read_bytes()
    rule_bytes = args.rules.read_bytes()
    additional_inputs = []
    if args.bindings:
        if not args.resources:
            parser.error("--resources is required with --bindings")
        resource_bytes = args.resources.read_bytes()
        resource_document = json.loads(resource_bytes)
        resources = (
            resource_document["resources"]
            if isinstance(resource_document, dict) else resource_document
        )
        selected = (
            deepcopy(resource_document.get("selection"))
            if isinstance(resource_document, dict) else None
        )
        if args.selection:
            selection_bytes = args.selection.read_bytes()
            selected = json.loads(selection_bytes)
            additional_inputs.append({
                "path": str(args.selection),
                "sha256": hashlib.sha256(selection_bytes).hexdigest(),
            })
        payload = from_wbd_bindings(
            json.loads(source_bytes), resources,
            selection=selected, operation=args.operation,
        )
        if isinstance(resource_document, dict):
            payload["sources"] = deepcopy(resource_document.get("sources", []))
        additional_inputs.append({
            "path": str(args.resources),
            "sha256": hashlib.sha256(resource_bytes).hexdigest(),
        })
    else:
        if args.resources or args.selection:
            parser.error("--resources and --selection accompany --bindings")
        payload = json.loads(source_bytes)
        if args.operation is not None:
            payload["operation"] = args.operation
    rules = json.loads(rule_bytes)
    result = apply_rules(payload, rules)
    result["input_files"] = [
        {"path": str(source_path), "sha256": hashlib.sha256(source_bytes).hexdigest()},
        {"path": str(args.rules), "sha256": hashlib.sha256(rule_bytes).hexdigest()},
        *additional_inputs,
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pending_path = args.output.with_name(args.output.name + ".partial")
    pending_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    pending_path.replace(args.output)
    print(json.dumps({
        "output": str(args.output),
        "nodes": result["network"]["node_count"],
        "resources": len(result["resources"]),
        "selected_source_feature_refs": len(result["selected_source_feature_refs"]),
    }))


if __name__ == "__main__":
    main()
