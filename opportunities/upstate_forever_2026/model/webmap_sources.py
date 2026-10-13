"""Admit original embedded Web Map polygons through the native source registry.

The retained Web Map remains authoritative.  Standard GeoJSON is a derived
view for existing Fiona consumers; original Esri features and all declarations
travel as companions, together with the exact transformation lineage.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import html
import io
import json
from pathlib import Path
import re

from .common import digest

ALGORITHM = "retained-webmap-polygons/v2"
CONTEXT_ID = "upstate_sc_population_v2025"
CONTEXT_PARENT_SHA256 = "71fd61ee5f53cc91156250403454a3f7452b0c83087ea3ed9e0b3e0c23d7663e"
CONTEXT_FILES = {
    "upstate_county_population_v2025.csv": "1a582c02bee2f759f5c1f942fce96ef334eb6b6846a6a194802c6f9a925c1273",
    "upstate_county_population_v2025.metadata.json": "d8e9e102d8c939d7457f2d4c160cbc55c21464a541d86ce96690720113244bed",
    "upstate_county_geoid_reference.json": "d672d331915d50592248aa7017ed47c11249a781ce27ee6ce0f8eac4ca7d2530",
    "UPSTATE_COUNTY_POPULATION.md": "736821084017d32439f5af6ee9e50ae368e1a407383796eeecd8ea1e50fb963c",
}


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def _write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("A retained admission member changed: " + path.name)
    else:
        temp = path.with_suffix(path.suffix + ".partial")
        temp.write_bytes(data)
        temp.replace(path)
    return {"path": path.name, "sha256": _sha(data)}


def _csv(fieldnames, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fieldnames, lineterminator="\n",
                            extrasaction="raise")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: json.dumps(value, ensure_ascii=False, sort_keys=True)
                         if isinstance(value, (dict, list)) else value
                         for key, value in row.items()})
    return stream.getvalue().encode("utf-8")


def _source(workspace, collection_id, source_id):
    if not isinstance(collection_id, str) or not isinstance(source_id, str):
        raise ValueError("Choose a retained source collection and source.")
    collection = workspace._get("sources", collection_id)
    entry = next((row for row in collection.get("entries", [])
                  if row.get("id") == source_id), None)
    if entry is None:
        raise ValueError("The selected source is absent from this original collection.")
    return collection, entry


def _load(workspace, collection_id, source_id):
    collection, entry = _source(workspace, collection_id, source_id)
    path, verified = workspace.source_file(collection_id, source_id)
    # source_file is the existing original-byte and companion verifier.
    with path.open("r", encoding="utf-8-sig") as stream:
        document = json.load(stream)
    if not isinstance(document, dict):
        raise ValueError("A Web Map must be a JSON object.")
    return collection, verified, document, path


def _pointer_token(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def _walk(document):
    """Return embedded layers and remote layers with exact RFC6901 pointers."""
    embedded, remote = [], []

    def visit(value, pointer="", parent=None):
        if isinstance(value, dict):
            feature_collection = value.get("featureCollection")
            if isinstance(feature_collection, dict):
                for index, layer in enumerate(feature_collection.get("layers") or []):
                    if not isinstance(layer, dict):
                        continue
                    location = pointer + "/featureCollection/layers/" + str(index)
                    if isinstance(layer.get("featureSet"), dict):
                        embedded.append((location, layer, value))
            # URL-only feature services remain context, never an implicit fetch.
            if (isinstance(value.get("url"), str) and
                    ("FeatureServer" in value["url"] or "MapServer" in value["url"]) and
                    not isinstance(feature_collection, dict)):
                remote.append({"layer_path": pointer, "label": str(
                    value.get("title") or value.get("name") or value.get("id") or value["url"]),
                    "url": value["url"], "id": value.get("id")})
            for key, child in value.items():
                if key == "featureCollection":
                    continue
                if isinstance(child, (dict, list)):
                    visit(child, pointer + "/" + _pointer_token(key), value)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, pointer + "/" + str(index), parent)

    visit(document)
    return embedded, remote


def _declarations(pointer, layer):
    definition = layer.get("layerDefinition") or {}
    feature_set = layer["featureSet"]
    declarations = []
    for location, value in (
        (pointer + "/featureSet/spatialReference", feature_set.get("spatialReference")),
        (pointer + "/layerDefinition/spatialReference", definition.get("spatialReference")),
        (pointer + "/layerDefinition/extent/spatialReference",
         (definition.get("extent") or {}).get("spatialReference")),
    ):
        if value:
            declarations.append({"json_pointer": location, "value": copy.deepcopy(value)})
    for index, feature in enumerate(feature_set.get("features") or []):
        geometry = feature.get("geometry") or {}
        if geometry.get("spatialReference"):
            declarations.append({
                "json_pointer": pointer + "/featureSet/features/" + str(index) +
                                "/geometry/spatialReference",
                "value": copy.deepcopy(geometry["spatialReference"])})
    return declarations


def _id_fields(features, fields):
    names = [field.get("name") for field in fields if isinstance(field, dict)]

    def usable(candidate):
        if not isinstance(candidate, str) or not candidate:
            return False
        values = [(feature.get("attributes") or {}).get(candidate) for feature in features]
        # Match the original _zones reader: retain identifiers as their original
        # scalar values, including string HUC codes and their leading zeroes.
        if not values or any(value is None or isinstance(value, (dict, list, bool)) or
                             str(value) == "" for value in values):
            return False
        if "huc" in candidate.lower() and any(not isinstance(value, str) for value in values):
            return False
        return len({str(value) for value in values}) == len(values)

    for candidate in ("CNTYNAME", "GEOID", "HUC12", "huc12", "OBJECTID", "FID"):
        if usable(candidate):
            name = next((key for key in ("CNTYNAME", "NAME", "name", "CNAME", candidate)
                         if key in names), candidate)
            return candidate, name
    for field in fields:
        if isinstance(field, dict) and field.get("type") == "esriFieldTypeOID":
            candidate = field.get("name")
            if usable(candidate):
                return candidate, candidate
    return None, None


def _layer(pointer, layer, parent):
    feature_set, definition = layer["featureSet"], layer.get("layerDefinition") or {}
    features = feature_set.get("features")
    features = features if isinstance(features, list) else []
    fields = feature_set.get("fields") or definition.get("fields") or []
    geometry_type = feature_set.get("geometryType") or definition.get("geometryType")
    declarations = _declarations(pointer, layer)
    id_field, name_field = _id_fields(features, fields)
    reason = None
    if geometry_type != "esriGeometryPolygon":
        reason = "This admission handles original polygon feature collections."
    elif not features:
        reason = "This embedded layer has no features."
    elif not declarations:
        reason = "The original layer has no declared coordinate reference system."
    elif any(not isinstance(f.get("geometry"), dict) or
             not isinstance(f["geometry"].get("rings"), list) or
             f["geometry"].get("curveRings") for f in features):
        reason = "Each selected original polygon must contain ordinary Esri rings."
    elif not id_field:
        reason = "A unique original attribute is required for a reporting region selector."
    return {
        "layer_path": pointer,
        "label": str(definition.get("name") or layer.get("title") or
                     parent.get("title") or parent.get("id") or pointer),
        "feature_count": len(features), "geometry_type": geometry_type,
        "spatial_reference": copy.deepcopy(declarations[0]["value"]) if declarations else None,
        "spatial_reference_declarations": declarations,
        "fields": copy.deepcopy(fields), "eligible": reason is None,
        "reason": reason, "suggested_id_field": id_field,
        "suggested_name_field": name_field,
    }


def _context(data_directory=None):
    folder = Path(data_directory) if data_directory else Path(__file__).resolve().parents[1] / "source" / "webmap_county_context"
    data = {}
    for name, expected in CONTEXT_FILES.items():
        path = folder / name
        if not path.is_file():
            return None
        body = path.read_bytes()
        if _sha(body) != expected:
            raise ValueError("The installed dated county context differs from its retained source: " + name)
        data[name] = body
    return data


def _compatible(entry, selected, context):
    if context is None or entry.get("body", {}).get("sha256") != CONTEXT_PARENT_SHA256:
        return False
    crosswalk = json.loads(context["upstate_county_geoid_reference.json"])
    expected = {row["original_county_name"] for row in crosswalk["rows"]}
    for _, layer, _ in selected:
        features = layer["featureSet"].get("features") or []
        names = [(f.get("attributes") or {}).get("CNTYNAME") for f in features]
        if len(names) == len(expected) and set(names) == expected:
            return True
    return False


def _admissions(workspace, collection_id=None, source_id=None):
    found = []
    for collection in workspace.sources():
        admission = (collection.get("scope") or {}).get("webmap_admission")
        if not isinstance(admission, dict):
            continue
        if collection_id is not None and admission.get("parent_source_collection_id") != collection_id:
            continue
        if source_id is not None and admission.get("parent_source_id") != source_id:
            continue
        found.append(public_result(collection))
    return sorted(found, key=lambda row: (row["title"], row["admission_id"]))


def catalog(workspace, selection=None, *, data_directory=None):
    selection = selection or {}
    collection_id, source_id = selection.get("source_collection_id"), selection.get("source_id")
    context = _context(data_directory)
    available_context = {"id": CONTEXT_ID,
                         "label": "Census Vintage 2025 — ten whole South Carolina counties",
                         "available": context is not None, "compatible": False,
                         "geography_basis": "whole_county", "population_date": "2025-07-01",
                         "estimate_vintage": 2025}
    if collection_id is None and source_id is None:
        sources = []
        for collection in workspace.sources():
            if (collection.get("scope") or {}).get("webmap_admission"):
                continue
            for entry in collection.get("entries", []):
                body = entry.get("body") or {}
                filename = body.get("filename") or body.get("view_path") or ""
                if not str(filename).lower().endswith(".json"):
                    continue
                sources.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                                "label": entry.get("title") or entry["id"], "filename": filename,
                                "bytes": body.get("bytes"), "sha256": body.get("sha256"),
                                "uri": entry.get("uri"), "vintage": entry.get("vintage")})
        return {"sources": sources, "admissions": _admissions(workspace),
                "contexts": [available_context]}
    if not collection_id or not source_id:
        raise ValueError("Choose both the source collection and original source.")
    _, entry, document, _ = _load(workspace, collection_id, source_id)
    layers, remote = _walk(document)
    available_context["compatible"] = _compatible(entry, layers, context)
    return {"source_collection_id": collection_id, "source_id": source_id,
            "layers": [_layer(*item) for item in layers], "remote_layers": remote,
            "contexts": [available_context],
            "admissions": _admissions(workspace, collection_id, source_id)}


def _flat(pointer, layer, description):
    flat = copy.deepcopy(layer["featureSet"])
    definition = layer.get("layerDefinition") or {}
    additions = []
    for key in ("fields", "objectIdField", "globalIdField", "geometryType",
                "displayFieldName", "hasZ", "hasM"):
        if key not in flat and key in definition:
            flat[key] = copy.deepcopy(definition[key])
            additions.append({"field": key, "json_pointer": pointer + "/layerDefinition/" + key})
    if "spatialReference" not in flat:
        declaration = description["spatial_reference_declarations"][0]
        flat["spatialReference"] = copy.deepcopy(declaration["value"])
        additions.append({"field": "spatialReference", "json_pointer": declaration["json_pointer"]})
    # Original reader recognizes both objectIdField and original OID field metadata.
    flat.setdefault("geometryType", description["geometry_type"])
    return flat, additions


def _crs(value):
    from pyproj import CRS
    if value.get("wkt"):
        return CRS.from_wkt(value["wkt"])
    code = value.get("latestWkid") or value.get("wkid")
    if not code:
        raise ValueError("The original spatial reference has neither WKT nor WKID.")
    try:
        return CRS.from_user_input("EPSG:" + str(code))
    except Exception:
        return CRS.from_user_input("ESRI:" + str(code))


def _runtime():
    import pyproj
    import shapely
    from . import spatial_esri
    return {"pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
            "shapely": shapely.__version__,
            "native_reader_sha256": _sha(Path(spatial_esri.__file__).read_bytes())}


def _context_report(rows, metadata, parent, joins):
    e = lambda value: html.escape(str(value), quote=True)
    total = sum(int(r["pop_est_2025_v2025"]) for r in rows)
    base = sum(int(r["pop_base_2020_v2025"]) for r in rows)
    body = []
    for row in rows:
        current, previous = int(row["pop_est_2025_v2025"]), int(row["pop_base_2020_v2025"])
        body.append("<tr><th>" + e(row["county_name"]) + "</th><td>" + e(row["GEOID"]) +
                    "</td><td>" + format(current, ",") + "</td><td>" + format(previous, ",") +
                    "</td><td>" + format((current / previous - 1) * 100, ".2f") +
                    '%</td><td>' + format(int(row["census_2020"]), ",") +
                    "</td><td>" + format(int(row["census_2010"]), ",") +
                    '</td><td><a href="' + e(row["source_url"]) + '">Census source</a></td></tr>')
    return ("""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upstate county population context</title><style>
body{font:15px system-ui,sans-serif;color:#222;background:#fff;max-width:1180px;margin:32px auto;padding:0 20px}
h1{font-size:26px}h2{font-size:20px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:9px;border:1px solid #bbb;text-align:right}th:first-child,td:first-child{text-align:left}
thead{background:#eee}a{color:inherit}code{overflow-wrap:anywhere}.scroll{overflow:auto}
p{line-height:1.55}.meta{font-size:13px}</style><h1>Upstate county population context</h1>
<p>Ten whole South Carolina counties. Resident population estimate: 1 July 2025,
Census Vintage 2025. The growth column compares that estimate with the same
Vintage 2025 estimates base for 1 April 2020.</p>""" +
            "<p><strong>" + format(total, ",") + " persons</strong>; same-vintage 2020 base " +
            format(base, ",") + "; change " + format(total - base, "+,") + " (" +
            format((total / base - 1) * 100, ".2f") + "%).</p>" +
            '<div class="scroll"><table><thead><tr><th>County</th><th>GEOID</th>' +
            "<th>2025 estimate</th><th>2020 base</th><th>Change</th><th>2020 census</th>" +
            "<th>2010 census</th><th>Source</th></tr></thead><tbody>" + "".join(body) +
            "</tbody></table></div><h2>Geography and original records</h2>" +
            "<p>Population values describe complete counties. Native watershed and reporting-mask " +
            "results keep their own geography; this table does not allocate county population to " +
            "a watershed or clipped area. Decennial counts are separate measures. Original " +
            "POP1930, POP1960, POP1990, URBAN1990 and POP2000 attributes retain their original values.</p>" +
            '<p class="meta">Original source collection: <code>' +
            e(parent["parent_source_collection_id"]) + "</code><br>Original source: <code>" +
            e(parent["parent_source_id"]) + "</code><br>Original SHA-256: <code>" +
            e(parent["parent_sha256"]) + "</code><br>Matched original features: " + str(len(joins)) +
            '<br>Census county reference geography: 1 January 2025. Source retrieval: ' +
            e(metadata["retrieved_on"]) + '.</p><p><a href="' +
            e(metadata["geography"]["name_crosswalk"]) + '">Official county reference</a> · ' +
            '<a href="' + e(metadata["population_methodology"]) +
            '">Population estimates methodology</a></p></html>\n').encode("utf-8")


def public_result(collection):
    admission = copy.deepcopy(collection["scope"]["webmap_admission"])
    admitted = []
    for entry in collection["entries"]:
        metadata = entry.get("webmap_source")
        if not metadata:
            continue
        row = {"source_id": entry["id"], "title": entry["title"], "kind": entry["kind"],
               "role": metadata["role"], "feature_count": metadata.get("feature_count"),
               "related_source_ids": metadata.get("related_source_ids") or [],
               "layer_path": metadata.get("layer_path")}
        if entry["kind"] == "vector":
            row["region_selector"] = {
                "source_collection_id": collection["id"], "source_id": entry["id"],
                "id_field": metadata["id_field"], "name_field": metadata["name_field"]}
            row["scenario_zones"] = [
                {**zone, "source_collection_id": collection["id"], "source_id": entry["id"]}
                for zone in metadata.get("scenario_zones", [])]
        admitted.append(row)
    return {"source_collection_id": collection["id"], "admission_id": admission["id"],
            "parent_source_collection_id": admission["parent_source_collection_id"],
            "parent_source_id": admission["parent_source_id"], "title": collection["title"],
            "admitted_sources": admitted, "context": admission.get("context"),
            "files": []}


def admit(workspace, selection, *, data_directory=None):
    if not isinstance(selection, dict):
        raise ValueError("Provide a source admission selection.")
    collection_id, source_id = selection.get("source_collection_id"), selection.get("source_id")
    pointers = selection.get("layer_paths")
    if not isinstance(pointers, list) or not pointers or any(not isinstance(p, str) for p in pointers):
        raise ValueError("Select one or more retained embedded polygon layers.")
    if len(set(pointers)) != len(pointers):
        raise ValueError("Select each retained layer once.")
    pointers = sorted(pointers)
    parent_collection, parent_entry, document, parent_path = _load(workspace, collection_id, source_id)
    embedded, _ = _walk(document)
    by_pointer = {row[0]: row for row in embedded}
    if any(p not in by_pointer for p in pointers):
        raise ValueError("A selected layer is absent from the original Web Map.")
    selected = [by_pointer[p] for p in pointers]
    descriptions = [_layer(*item) for item in selected]
    for description in descriptions:
        if not description["eligible"]:
            raise ValueError(description["label"] + ": " + description["reason"])
    context_id = selection.get("context_id")
    if context_id not in (None, "", CONTEXT_ID):
        raise ValueError("Choose an installed dated county context.")
    context = _context(data_directory) if context_id else None
    if context_id and not _compatible(parent_entry, selected, context):
        raise ValueError("The dated South Carolina context requires its exact retained ten-county original layer.")

    runtime = _runtime()
    parent = {"parent_source_collection_id": collection_id, "parent_source_id": source_id,
              "parent_sha256": parent_entry["body"]["sha256"],
              "parent_uri": parent_entry["uri"], "parent_vintage": parent_entry["vintage"]}
    identity = {"algorithm": ALGORITHM, **parent, "layer_paths": pointers, "runtime": runtime,
                "context": {"id": context_id, "files": CONTEXT_FILES} if context_id else None}
    admission_id = digest(identity)
    for previous in workspace.sources():
        old = (previous.get("scope") or {}).get("webmap_admission") or {}
        # Runtime-independent identity preserves original admission on restore/replay.
        if (old.get("algorithm") == ALGORITHM and
                old.get("parent_source_collection_id") == collection_id and
                old.get("parent_source_id") == source_id and
                old.get("parent_sha256") == parent["parent_sha256"] and
                old.get("layer_paths") == pointers and
                (old.get("context") or {}).get("id") == (context_id or None) and
                (not context_id or (old.get("context") or {}).get("files") == CONTEXT_FILES)):
            return public_result(previous)

    directory = workspace.root / "derived-sources" / "webmap" / admission_id
    directory.mkdir(parents=True, exist_ok=True)
    original_parent_descriptor = _write(directory / "original-webmap.raw.json", parent_path.read_bytes())
    if original_parent_descriptor["sha256"] != parent["parent_sha256"]:
        raise ValueError("The original Web Map changed before its retained companion was written.")
    entries, all_joins, vector_ids = [], [], []
    from .spatial_esri import OriginalEsriFeatures
    from pyproj import Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform
    context_rows = list(csv.DictReader(io.StringIO(context["upstate_county_population_v2025.csv"].decode("utf-8")))) if context else []
    crosswalk = json.loads(context["upstate_county_geoid_reference.json"]) if context else None
    context_names = {row["original_county_name"]: row for row in crosswalk["rows"]} if crosswalk else {}
    context_source_id = "webmap-county-population-" + admission_id[:16] if context else None

    for selected_layer, description in zip(selected, descriptions):
        pointer, layer, _ = selected_layer
        token = digest({"parent_sha256": parent["parent_sha256"], "layer_path": pointer})[:16]
        vector_id, table_id = "webmap-regions-" + token, "webmap-attributes-" + token
        vector_ids.append(vector_id)
        flat, additions = _flat(pointer, layer, description)
        flat_name = token + ".original.esri.json"
        _write(directory / flat_name, _json(flat))
        source = OriginalEsriFeatures(directory / flat_name, {"format": "esrijson"})
        for declaration in description["spatial_reference_declarations"]:
            if not _crs(declaration["value"]).equals(source.crs, ignore_axis_order=True):
                raise ValueError("The original layer declares inconsistent spatial references.")
        transformer = Transformer.from_crs(source.crs, "EPSG:4326", always_xy=True)
        features, lineage, attribute_rows, zones = [], [], [], []
        fields = [field["name"] for field in description["fields"]]
        for native_feature in source.features:
            properties = dict(native_feature["properties"])
            for key in properties:
                if key not in fields:
                    fields.append(key)
            index = native_feature.source_feature_index
            original_geometry = native_feature.native_geometry
            if (original_geometry.is_empty or not original_geometry.is_valid or
                    original_geometry.geom_type not in ("Polygon", "MultiPolygon")):
                raise ValueError("Original feature " + str(native_feature["id"]) + " at index " +
                                 str(index) + " is not a usable polygon after native parsing: " +
                                 original_geometry.geom_type)
            geometry = transform(transformer.transform, original_geometry)
            if (geometry.is_empty or not geometry.is_valid or
                    geometry.geom_type not in ("Polygon", "MultiPolygon")):
                raise ValueError("Original feature " + str(native_feature["id"]) + " at index " +
                                 str(index) + " is not a usable polygon after transformation: " +
                                 geometry.geom_type)
            features.append({"type": "Feature", "id": native_feature["id"],
                             "geometry": mapping(geometry), "properties": properties})
            attribute_rows.append(properties)
            lineage.append({"original_feature_index": index, "original_feature_id": native_feature["id"],
                            "id_basis": native_feature.id_basis,
                            "geometry_operations": native_feature.geometry_operations})
            id_field, name_field = description["suggested_id_field"], description["suggested_name_field"]
            zones.append({"id": "webmap-" + token + "-" + str(index),
                          "title": str(properties.get(name_field, properties[id_field])),
                          "where": {id_field: properties[id_field]},
                          "rank_group": "counties" if id_field == "CNTYNAME" else "webmap-" + token})
            if context and properties.get("CNTYNAME") in context_names:
                ref = context_names[properties["CNTYNAME"]]
                all_joins.append({"source_id": vector_id, "layer_path": pointer,
                                  "original_feature_id": native_feature["id"],
                                  "original_feature_index": index, "CNTYNAME": properties["CNTYNAME"],
                                  "GEOID": ref["GEOID"], "STATE": ref["STATE"], "COUNTY": ref["COUNTY"]})

        geo_name, csv_name, lineage_name = token + ".geojson", token + ".attributes.csv", token + ".provenance.json"
        geo_descriptor = _write(directory / geo_name, _json({"type": "FeatureCollection", "features": features}))
        table_descriptor = _write(directory / csv_name, _csv(fields, attribute_rows))
        original_fields = copy.deepcopy(description["fields"])
        field_vintages = {}
        for field_name in fields:
            year_match = re.search(r"((?:19|20)\d{2})$", field_name)
            if year_match:
                field_vintages[field_name] = {
                    "year": int(year_match.group(1)),
                    "basis": "year explicitly present in original field name"}

        provenance = {"schema": "upstate.webmap-source-lineage/v1", **parent,
                      "admission_id": admission_id, "algorithm": ALGORITHM,
                      "json_pointer": pointer, "original_parent_companion": original_parent_descriptor,
                      "feature_set_sha256": _sha(_json(layer["featureSet"])),
                      "feature_set_hash_encoding": "UTF-8 JSON; sort_keys=true, indent=2, final LF",
                      "original_layer_definition": copy.deepcopy(layer.get("layerDefinition")),
                      "flat_feature_set_additions": additions,
                      "spatial_reference_declarations": description["spatial_reference_declarations"],
                      "source_crs_wkt": source.crs_wkt, "output_crs": "EPSG:4326",
                      "coordinate_order": "longitude,latitude", "runtime": runtime,
                      "transformation": transformer.description, "original_fields": original_fields,
                      "field_vintages": field_vintages, "features": lineage,
                      "reader_metadata": source.reader_metadata,
                      "original_attribute_values_preserved": True}
        provenance_descriptor = _write(directory / lineage_name, _json(provenance))
        related = [table_id] + ([context_source_id] if context_source_id else [])
        shared = {"uri": parent_entry["uri"], "vintage": parent_entry["vintage"],
                  "provenance": {**parent, "json_pointer": pointer, "admission_id": admission_id},
                  "original_fields": original_fields, "field_vintages": field_vintages}
        entries.append({**shared, **geo_descriptor, "id": vector_id,
                        "title": description["label"] + " — retained reporting regions", "kind": "vector",
                        "format": "geojson", "source_crs": "EPSG:4326",
                        "companions": [
                            {"path": flat_name, "sha256": _sha((directory / flat_name).read_bytes())},
                            provenance_descriptor, original_parent_descriptor],
                        "webmap_source": {"role": "reporting_regions", "layer_path": pointer,
                                          "feature_count": len(features), "id_field": id_field,
                                          "name_field": name_field, "scenario_zones": zones,
                                          "related_source_ids": related}})
        entries.append({**shared, **table_descriptor, "id": table_id,
                        "title": description["label"] + " — original attributes", "kind": "table",
                        "format": "csv", "columns": original_fields,
                        "companions": [provenance_descriptor],
                        "webmap_source": {"role": "original_attributes", "layer_path": pointer,
                                          "feature_count": len(features),
                                          "related_source_ids": [vector_id]}})

    context_summary = None
    if context:
        expected_names = set(context_names)
        if {row["CNTYNAME"] for row in all_joins} != expected_names or len(all_joins) != len(expected_names):
            raise ValueError("The dated context requires exactly one selected original feature per county.")
        for name, body in context.items():
            _write(directory / name, body)
        metadata = json.loads(context["upstate_county_population_v2025.metadata.json"])
        join_name, report_name = "original-feature-county-join.csv", "county-population-context.html"
        _write(directory / join_name, _csv(
            ["source_id", "layer_path", "original_feature_id", "original_feature_index",
             "CNTYNAME", "GEOID", "STATE", "COUNTY"], all_joins))
        _write(directory / report_name, _context_report(context_rows, metadata, parent, all_joins))
        name = "upstate_county_population_v2025.csv"
        companion_names = [n for n in context if n != name] + [join_name, report_name]
        entries.append({"id": context_source_id, "path": name, "sha256": CONTEXT_FILES[name],
                        "title": metadata["title"], "kind": "table", "format": "csv",
                        "uri": metadata["population_methodology"], "vintage": "Census Vintage 2025; population 2025-07-01",
                        "geography_basis": "whole_county", "columns": metadata["columns"],
                        "scientific_metadata": metadata, "provenance": {**parent, "admission_id": admission_id},
                        "companions": [{"path": n, "sha256": _sha((directory / n).read_bytes())}
                                       for n in companion_names],
                        "webmap_source": {"role": "dated_county_context", "feature_count": len(context_rows),
                                          "related_source_ids": vector_ids}})
        context_summary = {"id": CONTEXT_ID, "title": metadata["title"], "source_id": context_source_id,
                           "geography_basis": "whole_county", "estimate_vintage": 2025,
                           "population_date": "2025-07-01", "county_count": len(context_rows),
                           "population_total": sum(int(r["pop_est_2025_v2025"]) for r in context_rows),
                           "population_units": "persons", "files": CONTEXT_FILES}

    admission = {**identity, "id": admission_id, "context": context_summary}
    manifest = {"schema": "upstate.sources/v1",
                "title": (parent_entry.get("title") or source_id) + " — admitted reporting sources",
                "captured_at": parent_collection.get("captured_at"),
                "entries": entries,
                "notes": ["Derived from selected embedded original feature collections.",
                          "Original attributes and full original Esri features are retained.",
                          "Whole-county population context retains its own dated geography."],
                "scope": {"webmap_admission": admission}}
    manifest_path = directory / "sources.json"
    _write(manifest_path, _json(manifest))
    retained = workspace.import_sources(manifest_path)
    return public_result(retained)
