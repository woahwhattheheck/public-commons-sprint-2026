"""Join the retained S1 crosswalk to designation rules and a delivery source.

Needs expert review: named-reach geometry associations and source interpretation.
Run from the project root, or invoke this file directly with --help.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from source_tools.designation_rules import (
    apply_rules, from_wbd_bindings, make_designated_resource,
    resource_set_from_registry,
)

CROSSWALK_SCHEMA = "upstate.classified-water-crosswalk/v1"
PROVENANCE_SCHEMA = "upstate.classified-water-crosswalk-provenance/v1"
LEGAL_SCHEMA = "upstate.classified-water-legal-associations/v1"
VERSION = "1.2.3"
CLASS_FIELDS = (
    "class_raw", "class_label", "class_code", "previous_class",
    "site_specific", "rfp_high_quality_candidate", "class_resolution",
    "previous_class_from_label", "previous_class_raw", "previous_class_label",
    "site_specific_from_label", "site_specific_raw",
)


def _id(value, label):
    if value is None or isinstance(value, bool) or not str(value).strip():
        raise ValueError(label + " requires an original source identifier")
    return str(value).strip()


def _identity(value):
    """Retain S1's exact scalar object-ID spelling and original JSON value."""
    if value is None or isinstance(value, (dict, list, bool)):
        raise ValueError("native object ID must be a retained scalar")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("native object ID must be finite")
    return str(value)


def _positive_huc(row):
    if row.get("region_kind") != "huc12" or row.get("counted") is not True:
        return None
    if row.get("touch_only") is True:
        return None
    field = {"line": "intersection_length_m",
             "polygon": "intersection_area_ha"}.get(row.get("geometry_kind"))
    value = row.get(field) if field else None
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or value <= 0):
        return None
    code = row.get("huc12")
    if not isinstance(code, str) or len(code) != 12 or not code.isdigit():
        raise ValueError("positive HUC intersections need retained HUC12 strings")
    if row.get("region_id") != code:
        raise ValueError("HUC intersection region_id and huc12 differ")
    return code


def _feature_index(collection, layers):
    if collection.get("type") != "FeatureCollection":
        raise ValueError("source_reaches.geojson must be a FeatureCollection")
    features, references = {}, {}
    for feature in collection.get("features", []):
        props = feature.get("properties") or {}
        fid = _id(props.get("feature_id"), "crosswalk feature_id")
        if fid in features:
            raise ValueError("duplicate retained source feature_id: " + fid)
        layer_id = _id(props.get("layer_id"), "captured layer_id")
        if layer_id not in layers:
            raise ValueError("native feature layer absent from provenance: " + layer_id)
        layer = layers[layer_id]
        field = _id(layer.get("oid_field"), "provenance native oid_field")
        attrs = props.get("native_attributes")
        if not isinstance(attrs, dict) or field not in attrs:
            raise ValueError("native_attributes lack exact OID field for " + fid)
        oid = attrs[field]
        expected = layer_id + ":" + _identity(oid)
        if fid != expected or _identity(props.get("object_id")) != _identity(oid):
            raise ValueError("crosswalk/native identity mismatch: " + fid)
        if str(feature.get("id")) != fid:
            raise ValueError("GeoJSON id differs from retained feature_id: " + fid)
        features[fid] = feature
        references[fid] = {
            "source_id": layer_id + "-native", "layer_id": None,
            "field": field, "value": deepcopy(oid),
        }
    return features, references


def resource_set_from_crosswalk(crosswalk, provenance, native_collection,
                                legal_associations=None):
    """Adapt S1 actual rows, source references and unchanged source features.

    Native GIS resources remain distinct from named regulatory resources.
    Only explicit coextensive legal associations bind the full legal reach.
    """
    if crosswalk.get("schema") != CROSSWALK_SCHEMA:
        raise ValueError("unexpected classified-water crosswalk schema")
    if provenance.get("schema") != PROVENANCE_SCHEMA:
        raise ValueError("unexpected classified-water provenance schema")
    if crosswalk.get("run_id") != provenance.get("run_id"):
        raise ValueError("crosswalk and provenance run identities differ")
    layers = {}
    for layer in provenance.get("layers", []):
        lid = _id(layer.get("id"), "capture layer id")
        if lid in layers:
            raise ValueError("duplicate layer in crosswalk provenance: " + lid)
        layers[lid] = layer
    features, references = _feature_index(native_collection, layers)
    hucs = defaultdict(set)
    measures = defaultdict(list)
    for row in crosswalk.get("rows", []):
        fid = _id(row.get("feature_id"), "crosswalk feature_id")
        if fid not in features:
            raise ValueError("crosswalk row has no retained native feature: " + fid)
        original = features[fid]["properties"]
        if row.get("layer_id") != original.get("layer_id"):
            raise ValueError("crosswalk row changed layer identity: " + fid)
        if _identity(row.get("object_id")) != _identity(original.get("object_id")):
            raise ValueError("crosswalk row changed object identity: " + fid)
        code = _positive_huc(row)
        if code:
            hucs[fid].add(code)
            measures[fid].append({
                key: deepcopy(row.get(key)) for key in (
                    "huc12", "intersection_length_m", "intersection_area_ha",
                    "inside_reporting_length_m", "inside_reporting_area_ha",
                    "outside_reporting_length_m", "outside_reporting_area_ha",
                ) if key in row
            })
    resources, selected = [], []
    for fid in sorted(features):
        props = features[fid]["properties"]
        resource = make_designated_resource(
            "mapped:" + fid,
            {key: deepcopy(props.get(key)) for key in CLASS_FIELDS if key in props},
            node_ids=hucs[fid], source_feature_refs=[references[fid]],
            status=props.get("legal_edition_status", props.get("status", "unknown")),
            rule_edition_id=None, label=props.get("waterbody_name"),
        )
        resource["kind"] = "mapped_classified_water"
        resource["native_feature_id"] = fid
        resource["source_labels"] = {
            key: deepcopy(props.get(key)) for key in (
                "data_status", "legal_edition_status", "status", "vintage",
                "catalogue_source_id", "source_metadata", "source_metadata_ref", "source_url",
            )
        }
        resource["source_classification"] = {
            key: deepcopy(props.get(key)) for key in CLASS_FIELDS if key in props
        }
        resource["regulatory_association_ids"] = {
            key: deepcopy(props.get(key, [])) for key in (
                "coextensive_registry_ids", "partial_registry_ids",
                "candidate_registry_ids",
            )
        }
        resource["reach_description"] = props.get("reach_description")
        resource["no_discharge_zone"] = props.get("no_discharge_zone")
        resource["county_codes"] = deepcopy(props.get("county_codes", []))
        resource["positive_huc_intersections"] = measures[fid]
        resources.append(resource)
        if props.get("rfp_high_quality_candidate") is True:
            selected.append(resource["id"])

    source_catalog = [{
        "id": lid + "-native",
        "catalogue_source_id": layer.get("mapping", {}).get(
            "catalogue_source_id", layer.get("catalogue_source_id")),
        "url": layer.get("url"),
        "oid_field": layer.get("oid_field"),
        "source_crs": deepcopy(layer.get("source_crs")),
        "mapping": deepcopy(layer.get("mapping", {})),
        "crosswalk_run_id": crosswalk.get("run_id"),
    } for lid, layer in sorted(layers.items())]
    relation_counts, applied_links = Counter(), 0
    if legal_associations is not None:
        if legal_associations.get("schema") != LEGAL_SCHEMA:
            raise ValueError("unexpected legal association schema")
        editions = {}
        for entry in legal_associations.get("records", []):
            record, edition = entry["record"], entry["edition"]
            edition_id = _id(edition.get("id"), "legal edition id")
            group = editions.setdefault(edition_id, {
                "edition": deepcopy(edition), "records": [], "associations": {},
            })
            if group["edition"] != edition:
                raise ValueError("conflicting metadata for legal edition: " + edition_id)
            rid = _id(record.get("id"), "legal registry record id")
            if rid in group["associations"]:
                raise ValueError("duplicate legal registry record: " + rid)
            node_ids, refs, links = set(), [], deepcopy(entry.get("associations", []))
            unused_links = []
            for link in links:
                relation = link.get("geometry_relation")
                relation_counts[str(relation)] += 1
                fid = link.get("feature_id")
                if link.get("registry_record_id") != rid:
                    raise ValueError("legal association record identity differs")
                reason = None
                if relation != "coextensive":
                    reason = "retained_" + str(relation) + "_relation"
                elif link.get("method") != "explicit-binding":
                    reason = "coextensive_relation_requires_explicit_source_binding"
                elif link.get("in_geographic_scope") is not True or fid not in features:
                    reason = "outside_retained_source_feature_scope"
                elif link.get("native_class_agrees") is not True:
                    reason = "retained_native_class_disagreement"
                else:
                    props = features[fid]["properties"]
                    status = props.get("legal_edition_status", props.get("status"))
                    if status != edition.get("status"):
                        reason = "different_legal_edition_status"
                    elif rid not in props.get("coextensive_registry_ids", []):
                        reason = "coextensive_identity_missing_from_native_crosswalk"
                    elif props.get("class_code") != record.get("class_code"):
                        reason = "retained_native_class_disagreement"
                if reason:
                    unused_links.append({**link, "applicability_reason": reason})
                    continue
                node_ids.update(hucs[fid])
                refs.append(references[fid])
                applied_links += 1
            group["records"].append(deepcopy(record))
            group["associations"][rid] = {
                "node_ids": sorted(node_ids),
                "source_feature_refs": refs,
                "retained_associations": links,
                "other_geometry_relations": unused_links,
                "extent_basis": "explicit_coextensive_source_bindings",
            }
        for edition_id, group in sorted(editions.items()):
            registry = {
                "schema": "upstate.classified-water-registry/v1",
                "edition": group["edition"], "records": group["records"],
                "coverage": {"selected_records": len(group["records"]),
                             "exhaustive": False,
                             "source": "retained legal_associations.json registry"},
            }
            doc = resource_set_from_registry(registry, group["associations"])
            resources.extend(doc["resources"])
            selected.extend(doc["selection"]["resource_ids"])
            source_catalog.extend(doc["sources"])
    return {
        "schema": "upstate.designated-resource-set/v1",
        "resources": resources,
        "selection": {"resource_ids": selected, "include_proposed": False},
        "sources": source_catalog,
        "adapter": {
            "version": VERSION,
            "crosswalk_schema": crosswalk["schema"],
            "crosswalk_run_id": crosswalk.get("run_id"),
            "crosswalk_producer_version": provenance.get("producer_version"),
            "native_feature_count": len(features),
            "native_features_with_positive_huc_binding": sum(bool(hucs[k]) for k in features),
            "resources_by_kind": dict(Counter(r["kind"] for r in resources)),
            "legal_association_counts": dict(relation_counts),
            "applied_coextensive_links": applied_links,
            "native_huc_attribute_used_as_model_membership": False,
        },
    }


def _bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _save(path, value):
    body = _bytes(value)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".partial")
    pending.write_bytes(body)
    pending.replace(path)
    return {"path": path.name, "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest()}


def export_selection(result, native_collection, provenance, output_root, *,
                     resource_document=None, workspace_root=None):
    """Write original S1 RFC7946 feature objects and a native source manifest."""
    if result.get("schema") != "upstate.designation-applicability/v1":
        raise ValueError("expected designation applicability result")
    layers = {_id(row.get("id"), "layer id"): row for row in provenance["layers"]}
    features, refs = _feature_index(native_collection, layers)
    wanted = {
        (ref.get("source_id"), str(ref.get("layer_id")),
         ref.get("field"), _identity(ref.get("value")))
        for ref in result["selected_source_feature_refs"]
    }
    selected, found = [], set()
    for fid, feature in features.items():
        ref = refs[fid]
        key = (ref["source_id"], str(ref["layer_id"]), ref["field"], _identity(ref["value"]))
        if key in wanted:
            selected.append(deepcopy(feature))
            found.add(key)
    missing = wanted - found
    if missing:
        raise ValueError("selected native identities absent from source features: " + str(sorted(missing, key=str)))
    output = Path(output_root)
    generated = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    applicability = _save(output / "designation-applicability.json", result)
    vector = _save(output / "selected-high-quality-waters.geojson", {
        "type": "FeatureCollection", "name": "selected_high_quality_waters",
        "features": selected,
    })
    # S1 compact feature references resolve this exact companion filename.
    companions = [applicability, _save(output / "provenance.json", provenance)]
    if resource_document is not None:
        companions.append(_save(output / "designated-resources.json", resource_document))
    identifier = "high-quality-water-designation-selection"
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Source-bound high-quality-water map selection",
        "captured_at": generated,
        "entries": [{
            "id": identifier, "title": "Selected high-quality-water reaches",
            "kind": "vector", "role": "HIGH_QUALITY_WATERS",
            "path": vector["path"], "sha256": vector["sha256"],
            "uri": "urn:upstate:designation-selection:" + vector["sha256"],
            "vintage": "Derived from retained crosswalk " + str(provenance.get("run_id")),
            "source_format": "GeoJSON", "source_crs": "EPSG:4326",
            "id_field": "feature_id", "class_field": "class_code",
            "metadata": {"id_field": "feature_id", "class_field": "class_code"},
            "features": len(selected), "companions": companions,
            "effective_edition": result["rule_profile"]["effective_edition"],
            "source_labels": [
                {"layer_id": layer["id"], "mapping": deepcopy(layer.get("mapping", {}))}
                for layer in provenance["layers"]
            ],
            "selection": deepcopy(result["selection"]),
            "selected_resource_ids": deepcopy(result["selected_resource_ids"]),
            "selected_source_feature_refs": deepcopy(result["selected_source_feature_refs"]),
            "source_catalog": deepcopy(result["source_catalog"]),
            "network": deepcopy(result["network"]),
            "interpretation": deepcopy(result["interpretation"]),
        }],
    }
    _save(output / "sources.json", manifest)
    response = {
        "source_manifest": str(output / "sources.json"),
        "source_id": identifier, "selected_native_features": len(selected),
        "mapped_resources_by_kind": dict(Counter(
            row["resource"]["kind"] for row in result["resources"]
            if row["mapping_status"] in {"mapped", "partially_mapped"})),
        "graph_node_count": result["network"]["node_count"],
    }
    if workspace_root is not None:
        from model.workspace import Workspace
        collection = Workspace(workspace_root).import_sources(output / "sources.json")
        response["source_collection"] = collection
        response["source_collection_id"] = collection["id"]
        choice = {"source_collection_id": collection["id"], "source_id": identifier}
        response["overlay_choice"] = deepcopy(choice)
        response["water_designation_choice"] = make_water_designation_choice(
            result, collection, identifier)
        response["water_designation_choice_file"] = _save(
            output / "water-designation-choice.json", response["water_designation_choice"])
        response["delivery_selection_patch"] = {
            "overlays": {"high_quality_waters": deepcopy(choice)},
            "source_roles": {"HIGH_QUALITY_WATERS": deepcopy(choice)},
        }
    return response


def make_water_designation_choice(result, collection, source_id):
    """Bind the actual imported GeoJSON to the existing water-designation desk."""
    entries = [entry for entry in collection.get("entries", [])
               if entry.get("id") == source_id]
    if len(entries) != 1:
        raise ValueError("the imported source collection must contain the selected vector once")
    entry = entries[0]
    if entry.get("kind") != "vector":
        raise ValueError("the water-designation desk needs the imported vector source")
    rules = result["rule_profile"]
    reference = next((item for item in rules["sources"]
                      if item.get("id") == "sc_r61_69"), None)
    if reference is None or not reference.get("url"):
        raise ValueError("retain the profile's primary R.61-69 reference")
    edition = rules["effective_edition"]["id"]
    if result["selection"].get("include_proposed") is True:
        edition += "; proposed source context retained in source companions"
    choice = {
        "source_collection_id": _id(collection.get("id"), "imported collection id"),
        "source_id": _id(source_id, "imported source id"),
        "expected_source_sha256": _id(entry["body"].get("sha256"), "imported source hash"),
        "title": "High-quality-water selection from retained classified reaches",
        "purpose": "high_quality_waters", "selection_mode": "all",
        "id_field": "feature_id", "class_field": "class_code",
        "rule_reference": {
            "title": reference["title"], "uri": reference["url"],
            "edition": edition, "section": "A, B, E and F; named reaches in H",
        },
        "source_context": {
            "rule_profile": deepcopy(rules),
            "source_catalog": deepcopy(result.get("source_catalog", [])),
            "source_labels": deepcopy(entry.get("source_labels", [])),
            "interpretation": deepcopy(result.get("interpretation", {})),
        },
        "notes": [
            "The selected feature_id binds the original layer and typed object ID; "
            "native_attributes retains the original published fields.",
            "Mapped class features and named regulatory resources retain separate "
            "extent relations in designation-applicability.json and designated-resources.json.",
            "HUC12 receiving-water connections express watershed context; native "
            "feature geometries and source editions remain in the source companions.",
        ],
    }
    if entry.get("layer") is not None:
        choice["layer"] = entry["layer"]
    return choice


def prepare_delivery_selection(selection, source_choice):
    """Replace both high-quality-water bindings in the complete current selection."""
    if not isinstance(selection, dict):
        raise ValueError("delivery selection must be the complete selection object")
    if not isinstance(source_choice, dict):
        raise ValueError("delivery source choice must be an object")
    choice = deepcopy(source_choice)
    choice["source_collection_id"] = _id(
        source_choice.get("source_collection_id"), "imported collection id")
    choice["source_id"] = _id(source_choice.get("source_id"), "imported source id")
    if choice.get("layer") is None:
        choice.pop("layer", None)
    result = deepcopy(selection)
    for section, key in (("overlays", "high_quality_waters"),
                         ("source_roles", "HIGH_QUALITY_WATERS")):
        if section not in result:
            result[section] = {}
        if not isinstance(result[section], dict):
            raise ValueError("delivery selection " + section + " must be an object")
        result[section][key] = deepcopy(choice)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    crosswalk_input = parser.add_mutually_exclusive_group(required=True)
    crosswalk_input.add_argument("--crosswalk-root", type=Path,
                                 help="Actual immutable completed crosswalk directory")
    crosswalk_input.add_argument("--crosswalk-result", type=Path,
                                 help="JSON result returned by the native crosswalk builder")
    parser.add_argument("--bindings", required=True, type=Path)
    parser.add_argument("--rules", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--selection", type=Path)
    parser.add_argument("--operation", default="ECSA-20261012")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--save-desk-selection", action="store_true",
                        help="Save the imported choice through model.water_designations.save")
    parser.add_argument("--delivery-selection", type=Path,
                        help="Complete current delivery selection to update after native import")
    parser.add_argument("--build-delivery", action="store_true",
                        help="Build the updated selection through Workspace.build_delivery")
    args = parser.parse_args(argv)
    if args.save_desk_selection and not args.workspace:
        parser.error("--save-desk-selection requires --workspace")
    if args.delivery_selection and not args.workspace:
        parser.error("--delivery-selection requires --workspace for actual imported source identity")
    if args.build_delivery and not args.delivery_selection:
        parser.error("--build-delivery requires --delivery-selection")
    input_records = []

    def read(path):
        body = Path(path).read_bytes()
        input_records.append({
            "path": str(path), "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
        })
        return json.loads(body)

    delivery_selection = read(args.delivery_selection) if args.delivery_selection else None
    crosswalk_receipt = read(args.crosswalk_result) if args.crosswalk_result else None
    crosswalk_root = args.crosswalk_root
    if crosswalk_receipt is not None:
        if crosswalk_receipt.get("schema") != CROSSWALK_SCHEMA:
            raise ValueError("--crosswalk-result needs the actual crosswalk builder result")
        crosswalk_root = Path(_id(crosswalk_receipt.get("output_dir"), "crosswalk output directory"))
        if not crosswalk_root.is_absolute():
            raise ValueError("the native crosswalk result must retain its absolute output_dir")
    crosswalk = read(crosswalk_root / "crosswalk.json")
    provenance = read(crosswalk_root / "provenance.json")
    if crosswalk_receipt is not None:
        if crosswalk_receipt.get("run_id") != crosswalk.get("run_id"):
            raise ValueError("crosswalk result belongs to a different completed source edition")
        if Path(_id(crosswalk_receipt.get("source_manifest"), "crosswalk source manifest")).resolve() != (
                crosswalk_root / "sources.json").resolve():
            raise ValueError("crosswalk result source_manifest differs from its completed output directory")
    native = read(crosswalk_root / "source_reaches.geojson")
    legal_path = crosswalk_root / "legal_associations.json"
    legal = read(legal_path) if legal_path.is_file() else None
    resources = resource_set_from_crosswalk(crosswalk, provenance, native, legal)
    if args.selection:
        resources["selection"] = read(args.selection)
    payload = from_wbd_bindings(
        read(args.bindings), resources["resources"],
        selection=resources["selection"], operation=args.operation,
    )
    payload["sources"] = resources["sources"]
    result = apply_rules(payload, read(args.rules))
    result["adapter"] = resources["adapter"]
    if crosswalk_receipt is not None:
        result["crosswalk_builder_result"] = deepcopy(crosswalk_receipt)
    result["input_files"] = input_records
    response = export_selection(
        result, native, provenance, args.output,
        resource_document=resources, workspace_root=args.workspace,
    )
    response["adapter"] = resources["adapter"]
    delivery_choice = response.get("overlay_choice")
    saved = None
    if args.save_desk_selection:
        from model.workspace import Workspace
        from model.water_designations import save as save_water_designation
        saved = save_water_designation(
            Workspace(args.workspace), response["water_designation_choice"])
        delivery_choice = saved["delivery_overlay"]
        response["overlay_choice"] = deepcopy(delivery_choice)
        response["delivery_selection_patch"] = prepare_delivery_selection(
            {}, delivery_choice)
        response["water_designation"] = {
            "id": saved["id"], "state": saved["state"],
            "summary": deepcopy(saved["summary"]),
            "delivery_overlay": deepcopy(delivery_choice),
            "reused": saved.get("reused_completed_selection", False),
        }
        response["water_designation_record"] = _save(
            args.output / "water-designation-record.json", saved)
    if delivery_selection is not None:
        if saved is not None:
            from model.water_designations import apply_to_delivery
            completed_selection = apply_to_delivery(
                Workspace(args.workspace), saved["id"], delivery_selection)
            completed_selection = prepare_delivery_selection(
                completed_selection,
                completed_selection["overlays"]["high_quality_waters"])
        else:
            completed_selection = prepare_delivery_selection(
                delivery_selection, delivery_choice)
        selected_path = args.output / "delivery-selection.json"
        selected_descriptor = _save(selected_path, completed_selection)
        response["delivery_selection"] = {
            **selected_descriptor, "path": str(selected_path)}
        if args.build_delivery:
            from model.workspace import Workspace
            delivery = Workspace(args.workspace).build_delivery(completed_selection)
            response["delivery"] = {
                "id": delivery["id"], "state": delivery["state"],
                "map_ids": sorted(delivery.get("maps", {})),
                "package": deepcopy(delivery.get("package")),
                "reused": delivery.get("reused", False),
            }
    print(json.dumps(response, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
