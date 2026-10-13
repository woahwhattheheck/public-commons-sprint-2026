"""Complete legal-water source review in the original operator.

Reads retained Workspace source editions. Geometry and regulatory associations
come from the existing native crosswalk; this adapter does not infer new ones.
"""
from __future__ import annotations

import collections
from functools import lru_cache
import gzip
import hashlib
import json
import math
from pathlib import Path

from source_tools.water_classifications import (REGISTRY_SCHEMAS, display_fields, validate_registry)

VERSION = "1.4.0"
REGISTRY_SCHEMA = "upstate.classified-water-registry/v1"
CROSSWALK_SCHEMA = "upstate.classified-water-crosswalk/v1"
ASSOCIATION_SCHEMA = "upstate.classified-water-legal-associations/v1"
READS = {"catalog", "review", "features", "feature"}
RELATIONS = ("coextensive", "partial", "candidate")


def _arg(payload, name, required=False):
    value = payload.get(name)
    if isinstance(value, list):
        if len(value) != 1:
            raise ValueError("Choose one " + name.replace("_", " ") + ".")
        value = value[0]
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError("Choose an existing " + name.replace("_", " ") + ".")
    if required and not value:
        raise ValueError("Choose an existing " + name.replace("_", " ") + ".")
    return value


def _name(body):
    return Path(body.get("source_path") or body.get("view_path") or body.get("filename", "")).name


def _kind(entry):
    name = _name(entry.get("body", {}))
    if (entry["id"] == "classified-water-crosswalk" or name == "crosswalk.json"
            or entry.get("source_schema") == CROSSWALK_SCHEMA):
        return "crosswalk"
    if (entry["id"] == "sc-r61-69-current-reach-registry"
            or name.endswith(".selected-reaches.json")
            or entry.get("source_schema") in REGISTRY_SCHEMAS):
        return "registry"
    return None


def _descriptor(collection, entry):
    body = entry["body"]
    return {
        "collection_id": collection["id"], "source_id": entry["id"],
        "title": entry["title"], "collection_title": collection.get("title", ""),
        "captured_at": collection.get("captured_at", ""),
        "vintage": entry.get("vintage"), "uri": entry.get("uri"),
        "sha256": body["sha256"], "bytes": body["bytes"],
        "filename": _name(body),
        "jurisdiction": entry.get("jurisdiction"), "classification_system": entry.get("classification_system"),
        "designation_status": entry.get("designation_status", entry.get("legal_edition_status")),
        "data_status": entry.get("data_status", entry.get("classification_status")),
        "scope": collection.get("scope", {}),
    }


def _collection(workspace, key):
    values = [row for row in workspace.sources() if row["id"] == key]
    if len(values) != 1:
        raise ValueError("Choose an imported source edition in this workspace.")
    return values[0]


def _source(workspace, collection_id, source_id):
    path, entry = workspace.source_file(collection_id, source_id)
    collection = _collection(workspace, collection_id)
    return path, entry, _descriptor(collection, entry)


def _companion(path, entry, filename):
    members = [entry["body"]] + entry.get("companions", [])
    found = [body for body in members if _name(body) == filename]
    if len(found) != 1:
        raise ValueError("The imported source needs its exact retained companion " + filename + ".")
    body_name = Path(entry["body"].get("view_path", entry["body"]["filename"]))
    root = path
    for _ in body_name.parts:
        root = root.parent
    body = found[0]
    target = root / body.get("view_path", body["filename"])
    if not target.is_file() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError("The retained source companion is unavailable: " + filename)
    return target, body


@lru_cache(maxsize=16)
def _json(path, sha256):
    # Workspace.source_file has already verified this immutable content hash.
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def _ticket(operator, workspace_key, path, body, label):
    return operator._ticket(workspace_key, path, body, label)


def catalog(workspace):
    registries, crosswalks = [], []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            kind = _kind(entry)
            if not kind:
                continue
            row = _descriptor(collection, entry)
            if kind == "registry":
                registries.append({**row, "registry_origin": "standalone"})
            else:
                crosswalks.append(row)
                if any(_name(body) == "legal_associations.json" for body in entry.get("companions", [])):
                    registries.append({**row, "registry_origin": "crosswalk-companion",
                                       "title": "Legal reaches retained with " + row["title"]})
    sort_key = lambda row: (row.get("captured_at") or "", row["collection_id"], row["source_id"])
    registries.sort(key=sort_key, reverse=True)
    crosswalks.sort(key=sort_key, reverse=True)
    return {"schema": "upstate.water-source-review-catalog/v1", "producer_version": VERSION,
            "registries": registries, "crosswalks": crosswalks}


def _legal_source(operator, workspace_key, payload):
    workspace = operator.ws(workspace_key)
    path, entry, descriptor = _source(
        workspace, _arg(payload, "registry_collection", True), _arg(payload, "registry_source", True))
    value = _json(str(path), entry["body"]["sha256"])
    if value.get("schema") in REGISTRY_SCHEMAS:
        validate_registry(value)
        editions = [(value["edition"], record) for record in value["records"]]
        body = entry["body"]
    elif value.get("schema") == CROSSWALK_SCHEMA:
        path, body = _companion(path, entry, "legal_associations.json")
        value = _json(str(path), body["sha256"])
        if value.get("schema") != ASSOCIATION_SCHEMA:
            raise ValueError("Choose the retained legal-association companion produced by the native crosswalk.")
        editions = [(item["edition"], item["record"]) for item in value["records"]]
        descriptor = {**descriptor, "legal_body_sha256": body["sha256"],
                      "legal_body_bytes": body["bytes"], "legal_body_filename": _name(body)}
    else:
        raise ValueError("Choose a complete classified-water legal registry or its retained crosswalk edition.")
    records, seen = [], set()
    for edition, record in editions:
        if not isinstance(record.get("id"), str) or not record["id"]:
            raise ValueError("Every legal reach requires its original stable record identity.")
        key = (edition["id"], record["id"])
        if key in seen:
            raise ValueError("The chosen legal source repeats the same edition and record identity.")
        seen.add(key)
        records.append({**record, "edition": edition})
    return records, descriptor, [_ticket(operator, workspace_key, path, body, "Complete legal reach source")]


def _crosswalk_source(operator, workspace_key, payload):
    collection_id = _arg(payload, "crosswalk_collection")
    source_id = _arg(payload, "crosswalk_source")
    if not collection_id and not source_id:
        return None
    if not collection_id or not source_id:
        raise ValueError("Choose both the crosswalk source and its imported collection.")
    workspace = operator.ws(workspace_key)
    path, entry, descriptor = _source(workspace, collection_id, source_id)
    value = _json(str(path), entry["body"]["sha256"])
    if value.get("schema") != CROSSWALK_SCHEMA:
        raise ValueError("Choose a retained native classified-water crosswalk.")
    companions = {}
    for name in ("legal_associations.json", "provenance.json", "native_features.csv"):
        member, body = _companion(path, entry, name)
        companions[name] = (member, body)
    legal_path, legal_body = companions["legal_associations.json"]
    legal = _json(str(legal_path), legal_body["sha256"])
    if legal.get("schema") != ASSOCIATION_SCHEMA:
        raise ValueError("The selected crosswalk needs its legal-association source.")
    provenance_path, provenance_body = companions["provenance.json"]
    provenance = _json(str(provenance_path), provenance_body["sha256"])
    return {"descriptor": descriptor, "path": path, "entry": entry,
            "value": value, "legal": legal, "provenance": provenance,
            "companions": companions}


def _positive(row):
    amount = row.get("intersection_length_m") if row.get("geometry_kind") == "line" else row.get("intersection_area_ha")
    return (row.get("counted") is True and isinstance(amount, (float, int))
            and not isinstance(amount, bool) and math.isfinite(amount) and amount > 0)


def _index(crosswalk):
    by_feature = collections.defaultdict(list)
    for row in crosswalk["value"]["rows"]:
        by_feature[row["feature_id"]].append(row)
    by_record = collections.defaultdict(list)
    records = {}
    for item in crosswalk["legal"]["records"]:
        key = (item["edition"]["id"], item["record"]["id"])
        records[key] = item
        by_record[key].extend(item.get("associations", []))
    return by_feature, by_record, records


def _association(link, feature_rows, source_record_matches):
    first = feature_rows[0] if feature_rows else {}
    positive = [row for row in feature_rows if _positive(row)]
    return {
        **link, "record_version_matches": source_record_matches,
        "geometry_available": bool(feature_rows),
        "has_positive_intersection": bool(positive),
        "huc12": sorted({row["huc12"] for row in positive if row.get("region_kind") == "huc12"}),
        "touch_huc12": sorted({row["huc12"] for row in feature_rows
                              if row.get("region_kind") == "huc12" and row.get("touch_only")}),
        "native_class_raw": first.get("class_raw"), "native_class_code": first.get("class_code"),
        "native_waterbody_name": first.get("waterbody_name"),
        "data_status": first.get("data_status"),
        "legal_edition_status": first.get("legal_edition_status", first.get("status")),
        "catalogue_source_id": first.get("catalogue_source_id"),
    }


def _inventories(operator, workspace_key, registry, crosswalk):
    workspace = operator.ws(workspace_key)
    native_ids = set()
    if crosswalk:
        for layer in crosswalk["provenance"]["layers"]:
            source_id = (layer.get("upstream_source_id") or
                         layer.get("mapping", {}).get("catalogue_source_id") or
                         layer.get("catalogue_source_id"))
            if source_id:
                native_ids.add((layer["id"], source_id))
    result = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if not (entry.get("role") == "HIGH_QUALITY_WATER_SOURCE_INVENTORY"
                    or _name(entry.get("body", {})).endswith(".attribute-profile.json")):
                continue
            path, retained, descriptor = _source(workspace, collection["id"], entry["id"])
            value = _json(str(path), retained["body"]["sha256"])
            if value.get("schema") != "upstate.classified-water-inventory/v1":
                raise ValueError("The imported classified-water attribute inventory uses an unsupported source schema.")
            downloads = [_ticket(operator, workspace_key, path, retained["body"], "Complete captured-source inventory")]
            index_name = entry.get("feature_index")
            if index_name:
                index_path, index_body = _companion(path, retained, Path(index_name).name)
                downloads.append(_ticket(operator, workspace_key, index_path, index_body,
                                         "Complete native feature attribute index"))
            compared_sha = value.get("inputs", {}).get("legal_registry", {}).get("sha256")
            result.append({
                "source": descriptor, "profile": value, "downloads": downloads,
                "matches_selected_crosswalk_source": (value.get("layer_id"), value.get("source_id")) in native_ids,
                "matches_selected_registry_body": compared_sha == registry["sha256"] if compared_sha else None,
                "compared_registry_sha256": compared_sha,
            })
    return result



def _domain_coverages(operator, workspace_key, crosswalk):
    if crosswalk is None:
        return []
    workspace = operator.ws(workspace_key)
    matches = {}
    for layer in crosswalk["provenance"]["layers"]:
        source_id = (layer.get("upstream_source_id") or
                     layer.get("mapping", {}).get("catalogue_source_id") or layer.get("catalogue_source_id"))
        matches[(layer["id"], source_id, layer["url"])] = layer
    result = []
    for collection in workspace.sources():
        for candidate in collection["entries"]:
            if candidate.get("role") != "WATER_CLASSIFICATION_DOMAIN_INVENTORY":
                continue
            path, entry, descriptor = _source(workspace, collection["id"], candidate["id"])
            report = _json(str(path), entry["body"]["sha256"])
            if report.get("schema") != "upstate.classified-water-domain-completeness/v1":
                raise ValueError("The classified-water domain inventory needs its retained report schema.")
            layer = matches.get((report.get("layer_id"), report.get("source_id"), report.get("layer_url")))
            if layer is None:
                continue
            original_hash = report.get("original_capture", {}).get("original_geometry", {}).get("sha256")
            retained_page_hashes = {page.get("sha256") for page in layer.get("pages", [])}
            downloads = [_ticket(operator, workspace_key, path, entry["body"], "Complete selected-class domain inventory")]
            for companion in entry.get("companions", []):
                member, body = _companion(path, entry, _name(companion))
                downloads.append(_ticket(operator, workspace_key, member, body, _name(companion)))
            result.append({"source": descriptor, "report": report,
                           "matches_retained_geometry_page": bool(original_hash and original_hash in retained_page_hashes),
                           "downloads": downloads})
    return result


def review(operator, workspace_key, payload):
    records, registry, downloads = _legal_source(operator, workspace_key, payload)
    crosswalk = _crosswalk_source(operator, workspace_key, payload)
    by_feature, by_record, originals = _index(crosswalk) if crosswalk else ({}, {}, {})
    edition_map, classes, relations = {}, collections.Counter(), collections.Counter()
    for record in records:
        key = (record["edition"]["id"], record["id"])
        edition_map[record["edition"]["id"]] = record["edition"]
        classes[record.get("class_raw") or record.get("class_code") or "Unparsed"] += 1
        original = originals.get(key)
        agrees = (original is not None and original["record"] == {k: v for k, v in record.items() if k != "edition"}
                  and original["edition"] == record["edition"])
        links = [_association(link, by_feature.get(link["feature_id"], []), agrees)
                 for link in by_record.get(key, [])]
        record["native_associations"] = links
        record["linked_huc12"] = sorted({huc for link in links for huc in link["huc12"]})
        record["association_status"] = next((relation for relation in RELATIONS
            if any(link["geometry_relation"] == relation and link["has_positive_intersection"]
                   for link in links)), "outside-scope" if links else "unassociated")
        record["native_feature_count"] = len({link["feature_id"] for link in links})
        for link in links:
            relations[link["geometry_relation"]] += 1

    crosswalk_summary = None
    if crosswalk:
        descriptor, value, provenance = (crosswalk[name] for name in ("descriptor", "value", "provenance"))
        crosswalk_summary = {
            **descriptor, "run_id": value["run_id"], "generated_at": value.get("generated_at"),
            "analysis_crs": value["analysis_crs"], "statistics": value.get("statistics", {}),
            "intersection_row_count": len(value["rows"]),
            "native_feature_count": len(by_feature),
            "coverage_summary": value.get("coverage_summary", []),
            "geography": provenance.get("geography", {}),
            "layers": provenance.get("layers", []),
            "interpretation": provenance.get("interpretation", {}),
            "unparsed_native_class_values": provenance.get("unparsed_native_class_values", []),
            "association_interpretation": crosswalk["legal"].get("interpretation"),
        }
        downloads.append(_ticket(operator, workspace_key, crosswalk["path"],
                                 crosswalk["entry"]["body"], "All native geographic intersections"))
        for name, (path, body) in crosswalk["companions"].items():
            downloads.append(_ticket(operator, workspace_key, path, body, name))
    else:
        # The original full legal register remains usable before a crosswalk import.
        for record in records:
            record["association_status"] = "crosswalk-unselected"
    return {
        "schema": "upstate.water-source-review/v1", "producer_version": VERSION,
        "workspace_key": workspace_key, "registry_source": registry,
        "crosswalk_source": crosswalk_summary, "editions": list(edition_map.values()),
        "records": records, "downloads": downloads,
        "source_inventories": _inventories(operator, workspace_key, registry, crosswalk),
        "domain_coverages": _domain_coverages(operator, workspace_key, crosswalk),
        "counts": {
            "legal_rows": len(records),
            "literal_waterbody_names": len({record["waterbody_name"] for record in records}),
            "priority_rows": sum(record.get("rfp_high_quality_candidate") is True for record in records),
            "no_discharge_zone_rows": sum(record.get("no_discharge_zone") is True for record in records),
            "class_raw_counts": dict(classes), "association_counts": dict(relations),
        },
        "interpretation": [
            "Regulatory rows retain named aliases and reach splits. Literal names and rows have different meanings.",
            "Associated feature HUCs are positive measured intersections in EPSG:26917. Boundary touches are listed separately.",
            "Coextensive, partial and candidate relations retain the original geometry binding supplied to the crosswalk.",
            "Legal edition status, publisher data status and native classification remain separate source attributes.",
            "The captured layer query and extent define the native source coverage. Unassociated legal rows remain in the full register.",
        ],
    }



def _source_metadata(layer, properties):
    """Resolve a compact geographic reference against the retained layer."""
    reference = properties.get("source_metadata_ref")
    if reference is None:
        return properties.get("source_metadata",
                              layer.get("mapping", {}).get("source_metadata", layer.get("source_metadata", {})))
    if (not isinstance(reference, dict)
            or reference.get("schema") != "upstate.classified-water-metadata-ref/v1"
            or reference.get("document") != "provenance.json"
            or reference.get("layer_id") != layer["id"]
            or reference.get("member") not in ("mapping.source_metadata", "source_metadata")):
        raise ValueError("The feature metadata reference does not select its retained source layer.")
    metadata = layer
    for member in reference["member"].split("."):
        if not isinstance(metadata, dict) or member not in metadata:
            raise ValueError("The feature metadata reference has no retained source member.")
        metadata = metadata[member]
    encoded = json.dumps(metadata, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":"), allow_nan=False).encode("utf-8")
    if hashlib.sha256(encoded).hexdigest() != reference.get("sha256"):
        raise ValueError("The feature metadata reference differs from its retained source member.")
    return metadata


def _rule_context(metadata, legal):
    """Keep the source's explicit legal-edition reference distinct from reach matching."""
    if not isinstance(metadata, dict):
        return {"source_legal_reference": None, "rule_reference": None, "rule_edition": None}
    legal_reference = metadata.get("legal_reference")
    if not isinstance(legal_reference, dict):
        legal_reference = metadata.get("retained_selection", {}).get("legal_reference")
    if not isinstance(legal_reference, dict):
        return {"source_legal_reference": None, "rule_reference": None, "rule_edition": None}
    edition_id = legal_reference.get("edition_id")
    editions = {}
    for item in legal["records"]:
        edition = item["edition"]
        if edition.get("id") == edition_id:
            editions[json.dumps(edition, ensure_ascii=False, sort_keys=True)] = edition
    if len(editions) != 1:
        return {"source_legal_reference": legal_reference, "rule_reference": None, "rule_edition": None}
    edition = next(iter(editions.values()))
    title = " ".join(str(edition.get(key) or "") for key in ("jurisdiction", "regulation")).strip()
    uri = edition.get("source_url")
    reference = {"title": title, "uri": uri, "edition": edition["id"],
                 "section": str(legal_reference.get("section") or "")} if title and uri else None
    return {"source_legal_reference": legal_reference, "rule_reference": reference, "rule_edition": edition}



@lru_cache(maxsize=8)
def _captured_features(path, sha256, oid_field):
    value = _json(path, sha256)
    if not isinstance(value, dict) or not isinstance(value.get("features"), list):
        raise ValueError("The retained native source needs its original Esri feature collection.")
    declared = value.get("objectIdFieldName")
    if declared is not None and declared != oid_field:
        raise ValueError("The native feature collection declares a different object identifier.")
    result = {}
    for feature in value["features"]:
        attributes = feature.get("attributes")
        if not isinstance(attributes, dict):
            raise ValueError("A captured native feature needs its unchanged source attributes.")
        oid = attributes.get(oid_field)
        if oid is None or isinstance(oid, (bool, dict, list)):
            raise ValueError("A captured native feature has no usable original object identifier.")
        key = str(oid)
        if key in result:
            raise ValueError("The captured source repeats native identifier " + key)
        result[key] = feature
    return result


def _captured_layer(workspace, crosswalk, layer):
    from source_tools.high_quality_water_crosswalk import source_labels
    collection_id = crosswalk["descriptor"]["collection_id"]
    source_id = layer["id"] + "-native"
    path, entry, descriptor = _source(workspace, collection_id, source_id)
    config = layer["mapping"]
    fields = {field["name"]: field for field in layer["field_schema"]}
    loaded = {"layer": layer, "config": config, "fields": fields,
              "_feature_source_labels": source_labels(layer, config, compact=True)}
    return {"loaded": loaded, "entry": entry, "descriptor": descriptor, "path": path,
            "features": _captured_features(str(path), entry["body"]["sha256"], layer["oid_field"])}


def _geographic_status(rows):
    return "positive" if any(_positive(row) for row in rows) else "touch" if rows else "outside"


def features(operator, workspace_key, payload):
    """Browse every original captured feature, independently of named legal rows."""
    from source_tools.high_quality_water_crosswalk import feature_properties
    crosswalk = _crosswalk_source(operator, workspace_key, payload)
    if crosswalk is None:
        raise ValueError("Choose a retained crosswalk source for its complete native captures.")
    workspace = operator.ws(workspace_key)
    by_feature, _, _ = _index(crosswalk)
    links = collections.defaultdict(list)
    for link in crosswalk["legal"]["associations"]:
        links[link["feature_id"]].append(link)
    records, sources, downloads = [], [], []
    for layer in crosswalk["provenance"]["layers"]:
        native = _captured_layer(workspace, crosswalk, layer)
        loaded, entry, descriptor = native["loaded"], native["entry"], native["descriptor"]
        config, fields = loaded["config"], loaded["fields"]
        source_metadata = config.get("source_metadata", layer.get("source_metadata", {}))
        catalogue = source_metadata.get("catalogue_entry", {}) if isinstance(source_metadata, dict) else {}
        hydro_field = config.get("hydro_type_field") or ("HYDTYPE" if "HYDTYPE" in fields else None)
        huc_field = config.get("publisher_huc_field") or catalogue.get("publisher_huc12")
        sources.append({**descriptor, "layer_id": layer["id"], "oid_field": layer["oid_field"],
                        **display_fields(config),
                        "class_field": config["class_field"], "hydro_type_field": hydro_field,
                        "id_field": layer["oid_field"], "native_oid_field": layer["oid_field"],
                        "layer": entry.get("layer"), "expected_source_sha256": entry["body"]["sha256"],
                        **_rule_context(source_metadata, crosswalk["legal"]),
                        "publisher_huc_field": huc_field, "captured_feature_count": len(native["features"]),
                        "source_crs": layer.get("source_crs"),
                        "legal_edition_status": config["status"],
                        "data_status": config.get("data_status", layer.get("data_status"))})
        downloads.append(_ticket(operator, workspace_key, native["path"], entry["body"],
                                 "Complete original captured layer: " + layer["title"]))
        for feature in native["features"].values():
            properties = feature_properties(loaded, feature)
            attributes = feature["attributes"]
            feature_id = properties["feature_id"]
            intersections = by_feature.get(feature_id, [])
            positive = [row for row in intersections if _positive(row)]
            associated = links.get(feature_id, [])
            name = properties.get("waterbody_name")
            county = properties.get("county_raw")
            ref = {"source_id": entry["id"], "layer_id": entry.get("layer"),
                   "field": layer["oid_field"], "value": attributes[layer["oid_field"]]}
            records.append({
                "feature_id": feature_id, "layer_id": layer["id"],
                "collection_id": descriptor["collection_id"], "source_id": entry["id"],
                "object_id": attributes[layer["oid_field"]], "id_field": layer["oid_field"],
                "waterbody_name": name, "name_blank": name is None or not str(name).strip(),
                "county_raw": county, "county_codes": properties.get("county_codes", []),
                "county_blank": county is None or not str(county).strip(),
                "hydro_type_raw": attributes.get(hydro_field) if hydro_field else None,
                "publisher_huc12": attributes.get(huc_field) if huc_field in fields else None,
                **display_fields(properties),
                "class_raw": properties.get("class_raw"), "class_code": properties.get("class_code"),
                "previous_class": properties.get("previous_class"),
                "site_specific": properties.get("site_specific"),
                "no_discharge_zone": properties.get("no_discharge_zone"),
                "legal_edition_status": properties.get("legal_edition_status"),
                "data_status": properties.get("data_status"),
                "geographic_status": _geographic_status(intersections),
                "positive_huc12": sorted({row["huc12"] for row in positive if row.get("region_kind") == "huc12"}),
                "touch_huc12": sorted({row["huc12"] for row in intersections
                                      if row.get("region_kind") == "huc12" and row.get("touch_only")}),
                "positive_reporting": any(row.get("region_kind") == "reporting" for row in positive),
                "legal_record_ids": sorted({link["registry_record_id"] for link in associated}),
                "association_relations": sorted({link["geometry_relation"] for link in associated}),
                "source_feature_refs": [ref],
            })
    records.sort(key=lambda row: (row["layer_id"], str(row["object_id"])))
    return {
        "schema": "upstate.water-source-feature-catalog/v1", "producer_version": VERSION,
        "workspace_key": workspace_key, "crosswalk_source": crosswalk["descriptor"],
        "sources": sources, "records": records, "downloads": downloads,
        "legal_records": [{"record": item["record"], "edition": item["edition"]}
                          for item in crosswalk["legal"]["records"]],
        "legal_associations": crosswalk["legal"]["associations"],
        "counts": {"captured_features": len(records),
                   "blank_names": sum(row["name_blank"] for row in records),
                   "blank_counties": sum(row["county_blank"] for row in records),
                   "class_counts": dict(collections.Counter(str(row["class_raw"]) for row in records)),
                   "hydro_type_counts": dict(collections.Counter(
                       "" if row["hydro_type_raw"] is None else str(row["hydro_type_raw"]) for row in records)),
                   "geographic_status_counts": dict(collections.Counter(row["geographic_status"] for row in records))},
        "interpretation": [
            "Every feature in the retained capture is available, including unnamed and unassociated features.",
            "Positive, boundary touch and outside describe the crosswalk's loaded geographic scope.",
            "Publisher HUC12 values remain separate from positive measured WBD HUC12 intersections.",
            "Legal association types retain their original coextensive, partial or candidate meaning.",
            "Polyline features include the publisher's banks, shorelines and other original linework types.",
        ],
    }


def feature(operator, workspace_key, payload):
    from source_tools.high_quality_water_crosswalk import feature_properties
    crosswalk = _crosswalk_source(operator, workspace_key, payload)
    if crosswalk is None:
        raise ValueError("Choose the retained crosswalk for this native feature.")
    feature_id = _arg(payload, "feature_id", True)
    layers = [layer for layer in crosswalk["provenance"]["layers"]
              if feature_id.startswith(layer["id"] + ":")]
    if len(layers) != 1:
        raise ValueError("Choose one original captured feature in this crosswalk source.")
    layer = layers[0]
    workspace = operator.ws(workspace_key)
    native = _captured_layer(workspace, crosswalk, layer)
    key = feature_id[len(layer["id"]) + 1:]
    original = native["features"].get(key)
    if original is None:
        raise ValueError("The original captured source does not contain this native feature.")
    properties = feature_properties(native["loaded"], original)
    if properties["feature_id"] != feature_id:
        raise ValueError("The requested feature differs from the original source identifier.")
    by_feature, _, _ = _index(crosswalk)
    rows = by_feature.get(feature_id, [])
    attributes = original["attributes"]
    oid_field = layer["oid_field"]
    layer_id = layer["id"]
    source_id = native["entry"]["id"]
    collection_id = crosswalk["descriptor"]["collection_id"]
    collection = _collection(workspace, collection_id)
    native_entries = [native["entry"]]
    ref = {"source_id": source_id, "layer_id": native["entry"].get("layer"),
           "field": oid_field, "value": attributes[oid_field]}
    associations = [link for link in crosswalk["legal"]["associations"] if link["feature_id"] == feature_id]
    record_ids = {link["registry_record_id"] for link in associations}
    legal_records = [item for item in crosswalk["legal"]["records"] if item["record"]["id"] in record_ids]
    native_class = {key: properties.get(key) for key in (
        "jurisdiction", "classification_system", "class_components", "primary_class", "supplemental_classes",
        "special_markers", "original_index", "native_effective_date", "classification_role",
        "class_raw", "class_label", "class_code", "previous_class", "site_specific",
        "rfp_high_quality_candidate", "class_resolution", "previous_class_raw",
        "previous_class_label", "previous_class_from_label", "no_discharge_zone",
        "status", "legal_edition_status", "data_status", "catalogue_source_id",
        "source_metadata_ref", "waterbody_name", "county_codes")}
    native_class["source_metadata"] = _source_metadata(layer, properties)
    rule_context = _rule_context(native_class["source_metadata"], crosswalk["legal"])
    native_entry = native_entries[0] if len(native_entries) == 1 else None
    native_layer = native_entry.get("layer") if native_entry else None
    map_sources = [
        {"collection_id": collection_id, "source_id": entry["id"],
         "layers": entry.get("layers", []), "feature_field": "feature_id", "feature_value": feature_id}
        for entry in collection["entries"] if entry["id"] == "classified-water-geographic-maps"
    ]
    return {
        "schema": "upstate.water-source-feature-review/v1", "workspace_key": workspace_key,
        "feature_id": feature_id, "collection_id": collection_id,
        "source_id": source_id, "source_imported": len(native_entries) == 1,
        "source_feature_refs": [ref], "native_attributes": attributes,
        "native_fields": layer.get("field_schema", []), "source_layer": layer,
        "native_class": native_class, **rule_context,
        "crosswalk_source": crosswalk["descriptor"],
        "intersections": rows, "geographic_status": _geographic_status(rows),
        "legal_associations": associations, "legal_records": legal_records,
        "map_sources": map_sources,
        "selection_context": {
            "geography_role": "native-classified-water-feature",
            "feature_id": feature_id, "parsed_class": native_class,
            "legal_associations": associations, "map_sources": map_sources,
            "source_feature_refs": [ref],
            "source_collection_id": collection_id,
            "source_id": source_id, "layer": native_layer,
            "id_field": oid_field, "native_oid_field": oid_field,
            "class_field": layer.get("mapping", {}).get("class_field"),
            "expected_source_sha256": native_entry["body"]["sha256"] if native_entry else None,
            **rule_context,
            "regulatory_record_ids": sorted(record_ids),
            "positive_huc12": sorted({row["huc12"] for row in rows
                                      if row.get("region_kind") == "huc12" and _positive(row)}),
        },
    }


def read(operator, workspace_key, operation, payload):
    if operation == "catalog":
        return {**catalog(operator.ws(workspace_key)), "workspace_key": workspace_key}
    if operation == "review":
        return review(operator, workspace_key, payload)
    if operation == "features":
        return features(operator, workspace_key, payload)
    if operation == "feature":
        return feature(operator, workspace_key, payload)
    raise ValueError("Choose a supported water-source review operation.")
