#!/usr/bin/env python3
"""Native classified-water geography crosswalk for the Upper Savannah project.

Consumes retained source captures; performs no network calls. Run --help for CLI.
All measured geometry uses EPSG:26917. Original provider bytes remain companions.
"""
from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import gzip
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unicodedata

VERSION = "1.3.0"
SCHEMA = "upstate.classified-water-crosswalk/v1"
PLANNING_SHA256 = "133bc5369bd0d68bfdb53c61e3df24f9445f799b0d68b301f321d2c49d71eab6"
FOCUS_HUCS = ("030601010703", "030601010704", "030601020507", "030601020502")
PRIORITY_CLASSES = frozenset(("ONRW", "ORW", "TN", "TPGT", "TPT"))
KNOWN_CLASSES = ("ONRW", "ORW", "TPGT", "TPT", "TN", "FW", "SA", "SB", "SFH")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


from source_tools.water_classifications import (classification_scope, classification_key,
    literal_class, record_scope, validate_registry)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def read_json(path):
    path = Path(path)
    with (gzip.open(path, "rt", encoding="utf-8") if path.suffix == ".gz"
          else path.open("r", encoding="utf-8")) as handle:
        return json.load(handle)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode(value))


def member(root, name):
    name = str(name)
    part = Path(name)
    if (not name or part.is_absolute() or ".." in part.parts or "\\" in name
            or "\0" in name or part.as_posix() != name):
        raise ValueError("Expected a portable relative source member: " + name)
    root = Path(root).resolve()
    path = (root / part).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("Source member leaves its retained root: " + name)
    return path


def identity(value):
    if value is None or isinstance(value, (dict, list, bool)):
        raise ValueError("A native feature needs a scalar object ID")
    return str(value)


def normalized_name(value):
    return " ".join(unicodedata.normalize("NFKC", str(value or "")).casefold().split())


def source_crs(value):
    from pyproj import CRS
    if isinstance(value, dict):
        if value.get("wkt"):
            return CRS.from_wkt(value["wkt"])
        code = value.get("latestWkid") or value.get("wkid")
        if code is None:
            raise ValueError("Native spatialReference has neither WKT nor WKID")
        # These are source-declared Esri aliases for Web Mercator, not guessed CRS.
        code = 3857 if int(code) in (102100, 102113, 900913) else int(code)
        try:
            return CRS.from_epsg(code)
        except Exception:
            return CRS.from_user_input("ESRI:" + str(code))
    return CRS.from_user_input(value)


@lru_cache(maxsize=32)
def coordinate_transformer(source_definition, target_definition):
    from pyproj import Transformer
    return Transformer.from_crs(source_definition, target_definition, always_xy=True).transform


def project(geometry, from_crs, to_crs):
    from shapely.ops import transform
    source_definition = str(getattr(from_crs, "srs", from_crs))
    target_definition = str(getattr(to_crs, "srs", to_crs))
    return transform(coordinate_transformer(source_definition, target_definition), geometry)


def dimensional_geometry(geometry, dimension):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    wanted = {1: ("LineString", "LinearRing"), 2: ("Polygon",)}[dimension]
    if geometry.is_empty:
        return GeometryCollection()
    if geometry.geom_type in wanted:
        return geometry
    if hasattr(geometry, "geoms"):
        parts = [dimensional_geometry(item, dimension) for item in geometry.geoms]
        return unary_union([item for item in parts if not item.is_empty])
    return GeometryCollection()


def esri_geometry(value, geometry_type, corrections, key):
    from shapely.geometry import MultiLineString
    from source.capture_upstream_network import esri_polygon
    if not value:
        raise ValueError("Missing native geometry for " + key)
    if geometry_type == "esriGeometryPolyline":
        if "curvePaths" in value or "paths" not in value:
            raise ValueError("Native curved geometry needs source-side linearization: " + key)
        paths = value["paths"]
        if any(len(path) < 2 for path in paths):
            raise ValueError("Native polyline has a path with fewer than two vertices: " + key)
        geometry = MultiLineString([[point[:2] for point in path] for path in paths])
        dimension = 1
    elif geometry_type == "esriGeometryPolygon":
        if "curveRings" in value or "rings" not in value:
            raise ValueError("Native curved polygon needs source-side linearization: " + key)
        flat = {"rings": [[point[:2] for point in ring] for ring in value["rings"]]}
        geometry = dimensional_geometry(esri_polygon(flat, corrections, key), 2)
        dimension = 2
    else:
        raise ValueError("Expected native polyline or polygon, got " + str(geometry_type))
    if geometry.is_empty:
        raise ValueError("Native geometry has no usable line/area component: " + key)
    if not geometry.is_valid:
        from shapely import make_valid, is_valid_reason
        corrections.append({"identity": key, "stage": "native-analysis",
                            "reason": is_valid_reason(geometry),
                            "analysis_operation": "make_valid; original native response unchanged"})
        geometry = dimensional_geometry(make_valid(geometry), dimension)
    return geometry, dimension


def parse_class(raw_value, field_metadata, layer_mapping):
    """Decode native domains and literal class notation; never apply reach law."""
    label = raw_value
    resolution = "literal"
    explicit = layer_mapping.get("class_values", {})
    domain = (field_metadata.get("domain") or {}).get("codedValues", [])
    native = {str(row["code"]): row["name"] for row in domain}
    key = str(raw_value)
    if key in explicit:
        label, resolution = explicit[key], "mapping.class_values"
    elif key in native:
        label, resolution = native[key], "native.codedValues"
    label = None if label is None else str(label)
    if layer_mapping.get("classification_system"):
        jurisdiction, _ = classification_scope(layer_mapping, required=True)
        if jurisdiction != "SC":
            return {"class_raw": raw_value, "class_resolution": resolution,
                    **literal_class(label, layer_mapping)}
    text = unicodedata.normalize("NFKC", label or "").strip()
    codes = "|".join(KNOWN_CLASSES)
    # R.61-69 E/F use SFH and both attached (FWsp/SAsp) and spaced sp.
    # https://www.scstatehouse.gov/coderegs/Chapter%2061-69.pdf
    match = re.match(r"^(" + codes + r")(?:(sp)(?=$|[^A-Za-z])|(?=$|[^A-Za-z]))", text, re.I)
    code = match.group(1).upper() if match else None
    prior_match = re.search(r"\(\s*(" + codes + r")\s*(sp)?\s*\)", text, re.I)
    prior = prior_match.group(1).upper() if code in ("ORW", "ONRW") and prior_match else None
    site_specific = bool((match and match.group(2)) or (prior_match and prior_match.group(2))
                         or re.search(r"(?<![A-Za-z])sp(?![A-Za-z])", text, re.I))
    return {"class_raw": raw_value, "class_label": label, "class_code": code,
            "previous_class": prior,
            "site_specific": site_specific,
            "rfp_high_quality_candidate": code in PRIORITY_CLASSES,
            "class_resolution": resolution}


def boolean_value(raw, overrides=None):
    if overrides and str(raw) in overrides:
        raw = overrides[str(raw)]
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return raw
    key = str(raw).strip().casefold()
    if key in ("true", "yes", "y", "1"):
        return True
    if key in ("false", "no", "n", "0"):
        return False
    return None


def county_values(raw, config):
    if raw is None:
        return []
    values = raw if isinstance(raw, list) else re.split(config.get("county_separator", r"[,;]"), str(raw))
    aliases = {normalized_name(k): v for k, v in config.get("county_values", {}).items()}
    result = []
    for value in values:
        value = str(value).strip()
        mapped = aliases.get(normalized_name(value), value)
        for item in mapped if isinstance(mapped, list) else [mapped]:
            if str(item).strip():
                result.append(str(item).strip())
    return sorted(set(result))


def measure(geometry, dimension):
    return geometry.length if dimension == 1 else geometry.area / 10000.0


def measure_fields(geometry, dimension, prefix):
    return {prefix + "_length_m": geometry.length if dimension == 1 else None,
            prefix + "_area_ha": geometry.area / 10000.0 if dimension == 2 else None}


class Inputs:
    def __init__(self):
        self.files = {}

    def add(self, name, path, expected_sha=None, expected_bytes=None):
        path = Path(path).resolve(strict=True)
        digest = sha256_file(path)
        size = path.stat().st_size
        if expected_sha is not None and digest != expected_sha:
            raise ValueError("Retained source hash differs: " + str(path))
        if expected_bytes is not None and size != expected_bytes:
            raise ValueError("Retained source byte count differs: " + str(path))
        row = {"path": name, "sha256": digest, "bytes": size}
        if name in self.files and self.files[name][1] != row:
            raise ValueError("Two input editions collide at " + name)
        self.files[name] = (path, row)
        return row

    def copy_to(self, root):
        for name, (source, row) in sorted(self.files.items()):
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            if sha256_file(target) != row["sha256"]:
                raise ValueError("Source changed while being retained: " + str(source))

    def inventory(self):
        return [row for _, row in sorted(self.files.values(), key=lambda x: x[1]["path"])]


def load_capture(capture_root, mapping_path, inputs):
    root = Path(capture_root).resolve(strict=True)
    capture = read_json(root / "capture.json")
    mapping = read_json(mapping_path)
    if capture.get("schema") != "upstate.classified-water-capture/v1":
        raise ValueError("Expected intake's upstate.classified-water-capture/v1 capture")
    if not isinstance(mapping.get("layers"), dict):
        raise ValueError("The mapping must contain a layers object keyed by native layer ID")
    inputs.add("inputs/capture/capture.json", root / "capture.json")
    inputs.add("inputs/mapping.json", mapping_path)
    for row in capture.get("files", []):
        inputs.add("inputs/capture/" + row["path"], member(root, row["path"]),
                   row["sha256"], row["bytes"])
    if (root / "sources.json").exists():
        inputs.add("inputs/capture/sources.json", root / "sources.json")
    loaded, seen_layers = [], set()
    for layer in capture.get("layers", []):
        layer_id = layer["id"]
        if layer_id in seen_layers:
            raise ValueError("Duplicate captured layer ID: " + layer_id)
        seen_layers.add(layer_id)
        config = mapping["layers"].get(layer_id)
        if not isinstance(config, dict):
            raise ValueError("Supply exact metadata field mapping for layer " + layer_id)
        if config.get("status") not in ("current", "proposed", "source-published", "historical", "superseded") or not config.get("vintage"):
            raise ValueError("Every layer mapping needs an explicit edition status and source vintage")
        classification_scope(config)
        fields = {row["name"]: row for row in layer["field_schema"]}
        for key in ("class_field", "name_field"):
            if not config.get(key):
                raise ValueError("Missing " + key + " in mapping for " + layer_id)
        for key in ("class_field", "name_field", "description_field", "county_field",
                    "ndz_field", "previous_class_field", "site_specific_field",
                    "native_index_field", "effective_date_field"):
            if config.get(key) and config[key] not in fields:
                raise ValueError(key + " does not match native metadata exactly for " + layer_id)
        references = [layer["metadata_path"], layer["object_ids_path"], layer["count_path"],
                      layer["combined_path"]] + [page["path"] for page in layer["pages"]]
        for name in references:
            if "inputs/capture/" + name not in inputs.files:
                inputs.add("inputs/capture/" + name, member(root, name))
        combined = read_json(member(root, layer["combined_path"]))
        oid = layer["oid_field"]
        if oid not in fields:
            raise ValueError("Native object-ID field is absent from layer metadata")
        if combined.get("objectIdFieldName", oid) != oid:
            raise ValueError("Combined native object-ID field changed")
        if combined.get("geometryType", layer["geometry_type"]) != layer["geometry_type"]:
            raise ValueError("Combined native geometry type changed")
        crs = source_crs(layer["source_crs"])
        if "spatialReference" in combined and not crs.equals(source_crs(combined["spatialReference"])):
            raise ValueError("Native source CRS changed between metadata and combined features")
        features = combined.get("features", [])
        observed = [identity(feature["attributes"].get(oid)) for feature in features]
        ids_response = read_json(member(root, layer["object_ids_path"]))
        count_response = read_json(member(root, layer["count_path"]))
        expected = [identity(value) for value in (ids_response.get("objectIds") or [])]
        if (len(features) != layer["feature_count"] or len(set(observed)) != len(observed)
                or len(features) != count_response["count"] or set(observed) != set(expected)
                or len(expected) != len(set(expected))):
            raise ValueError("Native count, exact IDs and combined feature set differ for " + layer_id)
        page_hashes = {}
        for page in layer["pages"]:
            page_path = member(root, page["path"])
            inputs.add("inputs/capture/" + page["path"], page_path,
                       page.get("sha256"), page.get("bytes"))
            body = read_json(page_path)
            if body.get("error") or body.get("exceededTransferLimit"):
                raise ValueError("Retained native feature page is an error or truncated")
            page_ids = []
            for feature in body.get("features", []):
                key = identity(feature["attributes"].get(oid))
                if key in page_hashes:
                    raise ValueError("Native feature occurs in more than one retained page: " + key)
                page_ids.append(key)
                page_hashes[key] = hashlib.sha256(canonical(feature).encode("utf-8")).hexdigest()
            if set(page_ids) != {identity(value) for value in page["object_ids"]}:
                raise ValueError("Retained page differs from its recorded exact object-ID set")
        for feature, key in zip(features, observed):
            digest = hashlib.sha256(canonical(feature).encode("utf-8")).hexdigest()
            if page_hashes.get(key) != digest:
                raise ValueError("Combined feature differs from authoritative original page: " + key)
        if set(page_hashes) != set(observed):
            raise ValueError("Combined feature set does not cover all authoritative pages")
        loaded.append({"layer": layer, "config": config, "fields": fields,
                       "features": features, "crs": crs})
    if not loaded:
        raise ValueError("The retained capture has no native classification layers")
    return capture, mapping, loaded


def load_geography(project_source, huc_paths, inputs, corrections, *,
                   planning_path=None, focus_path=None):
    import fiona
    from pyproj import CRS
    from shapely.geometry import shape
    from shapely import make_valid, is_valid_reason
    from shapely.ops import unary_union

    source_root = None
    if planning_path is None or focus_path is None:
        if project_source is None:
            raise ValueError("Choose the retained planning and four-focus sources, or the original source directory")
        source_root = Path(project_source).resolve(strict=True)
    analysis_crs = CRS.from_epsg(26917)
    planning = (Path(planning_path).resolve(strict=True) if planning_path is not None else
                source_root / "geography/planning_basins2023/PlanningBasins2023.shp")
    inputs.add("inputs/planning/PlanningBasins2023.shp", planning, PLANNING_SHA256)
    for suffix in (".shx", ".dbf", ".prj", ".cpg", ".sbn", ".sbx", ".shp.xml"):
        sidecar = planning.with_suffix(suffix)
        if suffix in (".shx", ".dbf", ".prj") or sidecar.exists():
            inputs.add("inputs/planning/" + sidecar.name, sidecar)
    selected = []
    with fiona.open(planning) as collection:
        if "Basin" not in collection.schema["properties"]:
            raise ValueError("Original planning layer lacks native Basin field")
        native_crs = CRS.from_user_input(collection.crs_wkt or collection.crs)
        for ordinal, feature in enumerate(collection, 1):
            attributes = dict(feature["properties"])
            if attributes.get("Basin") == "Upper Savannah":
                selected.append((ordinal, attributes, shape(feature["geometry"])))
    if len(selected) != 1 or selected[0][0] != 5:
        raise ValueError("Select original PlanningBasins2023 Upper Savannah native record 5")
    reporting = project(selected[0][2], native_crs, analysis_crs)
    if not reporting.is_valid:
        corrections.append({"identity": "planning:record-5", "stage": "projected-analysis",
                            "reason": is_valid_reason(reporting),
                            "analysis_operation": "make_valid; original shapefile unchanged"})
        reporting = dimensional_geometry(make_valid(reporting), 2)
    hucs, networks = {}, []

    def add_huc(feature, crs, origin, role, expected_huc=None):
        attributes = feature.get("attributes") or feature.get("properties")
        if not isinstance(attributes, dict):
            attributes = dict(attributes or {})
        fields = {key.casefold(): key for key in attributes}
        field = fields.get("huc12")
        if field is None:
            raise ValueError("Native HUC feature lacks HUC12 field: " + origin)
        huc = str(attributes[field])
        if not re.fullmatch(r"[0-9]{12}", huc):
            raise ValueError("Native HUC12 must retain all twelve digits: " + repr(huc))
        if expected_huc is not None and huc != expected_huc:
            raise ValueError("Network geometry locator identifies another HUC12")
        raw_geometry = feature["geometry"]
        if "rings" in raw_geometry or "curveRings" in raw_geometry:
            geometry, _ = esri_geometry(raw_geometry, "esriGeometryPolygon", corrections, "huc:" + huc)
        else:
            geometry = dimensional_geometry(shape(raw_geometry), 2)
        geometry = project(geometry, crs, analysis_crs)
        if not geometry.is_valid:
            corrections.append({"identity": "huc:" + huc, "stage": "projected-analysis",
                                "reason": is_valid_reason(geometry),
                                "analysis_operation": "make_valid; native response unchanged"})
            geometry = dimensional_geometry(make_valid(geometry), 2)
        if geometry.is_empty:
            raise ValueError("HUC12 has empty polygon analysis geometry: " + huc)
        reference = {"path": origin, "huc12_field": field, "attributes": attributes, "role": role}
        if huc in hucs:
            if not hucs[huc]["geometry"].equals(geometry):
                raise ValueError("Conflicting native geometry editions for HUC12 " + huc
                                 + "; provide one consistent HUC12 source edition")
            hucs[huc]["sources"].append(reference)
            hucs[huc]["roles"].add(role)
        else:
            hucs[huc] = {"huc12": huc, "geometry": geometry, "sources": [reference], "roles": {role}}
        if huc in FOCUS_HUCS:
            hucs[huc]["roles"].add("focus_huc12")

    focus = (Path(focus_path).resolve(strict=True) if focus_path is not None else
             source_root / "geography/wbd_20261012/selected-four-huc12.json.gz")
    paths = [focus] + [Path(path).resolve(strict=True) for path in huc_paths]
    for index, path in enumerate(paths):
        prefix = "inputs/huc/%03d" % index
        inputs.add(prefix + "/" + path.name, path)
        if path.suffix.lower() in (".gz", ".json", ".geojson"):
            body = read_json(path)
            if body.get("schema") == "upstate.wbd-upstream-selection/v1":
                selection = body
                networks.append({"path": prefix + "/" + path.name,
                                 "model_huc12_count": selection["model_huc12_count"],
                                 "reporting_intersection_count": selection["reporting_intersection_count"],
                                 "source_crs": selection["source_crs"],
                                 "upstream_method": selection.get("upstream_method")})
                for optional in ("topology-records.json", "capture.json", "sources.json"):
                    if (path.parent / optional).is_file():
                        inputs.add(prefix + "/" + optional, path.parent / optional)
                source_manifest_path = path.parent / "sources.json"
                if source_manifest_path.exists():
                    source_manifest = read_json(source_manifest_path)
                    if source_manifest.get("schema") == "upstate.sources/v1":
                        for entry in source_manifest["entries"]:
                            for retained in [entry] + entry.get("companions", []):
                                name = retained["path"]
                                inputs.add(prefix + "/" + name, member(path.parent, name),
                                           retained.get("sha256"), retained.get("bytes"))
                cache = {}
                for row in selection["selected_huc12"]:
                    location = row["geometry"]
                    name = location["file"]
                    if name not in cache:
                        original = member(path.parent, name)
                        inputs.add(prefix + "/" + name, original)
                        receipt = original.parent / ("receipt.json" if original.name == "body.json.gz"
                                                      else original.name.removesuffix(".json.gz") + ".receipt.json")
                        if receipt.exists():
                            rel = receipt.relative_to(path.parent).as_posix()
                            receipt_value = read_json(receipt)
                            inputs.add(prefix + "/" + rel, receipt)
                            if receipt_value.get("stored_sha256"):
                                inputs.add(prefix + "/" + name, original, receipt_value["stored_sha256"],
                                           receipt_value.get("stored_bytes"))
                        cache[name] = read_json(original)
                    native = cache[name]
                    feature = native["features"][location["feature_index"]]
                    crs = source_crs(native.get("spatialReference", selection["source_crs"]))
                    role = "upstream_ancestor" if row["upstream_ancestor"] else "reporting_intersection"
                    add_huc(feature, crs, prefix + "/" + name, role, row["huc12"])
                if len(selection["selected_huc12"]) != selection["model_huc12_count"]:
                    raise ValueError("Native network selection count differs from its geometry locators")
            elif body.get("type") == "FeatureCollection":
                # RFC 7946 coordinates are WGS84 when there is no legacy explicit CRS.
                crs_spec = body.get("crs", {}).get("properties", {}).get("name", "EPSG:4326")
                for feature in body["features"]:
                    add_huc(feature, source_crs(crs_spec), prefix + "/" + path.name, "provided_huc12")
            else:
                crs = source_crs(body["spatialReference"])
                if body.get("error") or body.get("exceededTransferLimit"):
                    raise ValueError("HUC source feature set is an error or incomplete")
                for feature in body["features"]:
                    add_huc(feature, crs, prefix + "/" + path.name,
                            "focus_huc12" if index == 0 else "provided_huc12")
        else:
            if path.suffix.lower() == ".shp":
                for suffix in (".shx", ".dbf", ".prj", ".cpg"):
                    sidecar = path.with_suffix(suffix)
                    if suffix in (".shx", ".dbf", ".prj") or sidecar.exists():
                        inputs.add(prefix + "/" + sidecar.name, sidecar)
            candidates = []
            for layer in fiona.listlayers(path):
                with fiona.open(path, layer=layer) as collection:
                    if any(key.casefold() == "huc12" for key in collection.schema["properties"]):
                        candidates.append(layer)
            if len(candidates) != 1:
                raise ValueError("Select a native HUC input containing exactly one HUC12 polygon layer")
            with fiona.open(path, layer=candidates[0]) as collection:
                crs = CRS.from_user_input(collection.crs_wkt or collection.crs)
                for feature in collection:
                    add_huc(feature, crs, prefix + "/" + path.name, "provided_huc12")
        if index == 0 and set(hucs) != set(FOCUS_HUCS):
            raise ValueError("The focus input must contain exactly the four original utility HUC12 identities")
    if not set(FOCUS_HUCS).issubset(hucs):
        raise ValueError("Retained four-focus HUC12 response is missing a required source identity")
    regions = [{"id": "sc-upper-savannah", "kind": "reporting",
                "role": "SC Upper Savannah reporting boundary", "geometry": reporting}]
    for huc, row in sorted(hucs.items()):
        regions.append({"id": huc, "kind": "huc12", "role": sorted(row["roles"]),
                        "geometry": row["geometry"]})
    regions.append({"id": "loaded-huc12-union", "kind": "loaded_domain",
                    "role": "Union of provided native HUC12 polygons",
                    "geometry": unary_union([row["geometry"] for row in hucs.values()])})
    provenance = {"analysis_crs": "EPSG:26917", "reporting_native_record": 5,
                  "reporting_native_attributes": selected[0][1], "huc12_count": len(hucs),
                  "focus_huc12": list(FOCUS_HUCS), "upstream_selections": networks,
                  "huc12_sources": [{"huc12": huc, "roles": sorted(row["roles"]), "sources": row["sources"]}
                                    for huc, row in sorted(hucs.items())]}
    return regions, provenance


class LegalAssociations:
    """Explicit geometry bindings and conservative exact candidate links."""
    def __init__(self, registry_paths, bindings_path, inputs):
        self.records = {}
        self.index = collections.defaultdict(list)
        self.original_indices = collections.defaultdict(list)
        self.bindings = collections.defaultdict(list)
        self.associations = []
        self.seen_features = set()
        for index, path in enumerate(registry_paths):
            path = Path(path).resolve(strict=True)
            inputs.add("inputs/registry/%03d-%s" % (index, path.name), path)
            value = read_json(path)
            validate_registry(value)
            edition = value["edition"]
            for record in value["records"]:
                key = record["id"]
                if key in self.records:
                    raise ValueError("Duplicate legal reach identity: " + key)
                self.records[key] = {"record": record, "edition": edition}
                scope = classification_key(record, edition)
                if record.get("allow_name_candidate", True):
                    self.index[(*scope, normalized_name(record["waterbody_name"]),
                                edition["status"])].append(key)
                if record.get("original_index") is not None:
                    self.original_indices[(*scope, str(record["original_index"]), edition["status"])].append(key)
        if bindings_path:
            inputs.add("inputs/registry/bindings.json", bindings_path)
            value = read_json(bindings_path)
            rows = value if isinstance(value, list) else value["bindings"]
            seen = set()
            for row in rows:
                key = row["layer_id"] + ":" + identity(row["object_id"])
                record_id = row["registry_record_id"]
                if record_id not in self.records:
                    raise ValueError("Binding references an unloaded legal record: " + record_id)
                if row.get("geometry_relation") not in ("coextensive", "partial", "candidate"):
                    raise ValueError("Binding needs coextensive, partial or candidate geometry relation")
                pair = (key, record_id)
                if pair in seen:
                    raise ValueError("Duplicate explicit feature/legal record binding")
                seen.add(pair)
                self.bindings[key].append(row)

    def for_feature(self, properties, in_scope):
        key = properties["feature_id"]
        self.seen_features.add(key)
        links = []
        for binding in self.bindings.get(key, []):
            record_id = binding["registry_record_id"]
            entry = self.records[record_id]
            if record_scope(entry["record"], entry["edition"]) != classification_scope(properties):
                raise ValueError("Explicit legal binding crosses classification jurisdictions or systems")
            if entry["edition"]["status"] != properties["status"]:
                raise ValueError("Explicit legal binding mixes different source edition statuses")
            links.append({"feature_id": key, "registry_record_id": record_id,
                          "geometry_relation": binding["geometry_relation"],
                          "method": "explicit-binding", "in_geographic_scope": in_scope,
                          "native_class_agrees": properties["class_code"] == entry["record"]["class_code"],
                          "binding": binding})
        explicit = {link["registry_record_id"] for link in links}
        counties = {normalized_name(value) for value in properties["county_codes"]}
        scope = classification_key(properties)
        index_value = properties.get("original_index")
        if index_value is not None:
            for record_id in self.original_indices.get((*scope, str(index_value), properties["status"]), []):
                if record_id in explicit:
                    continue
                links.append({"feature_id": key, "registry_record_id": record_id,
                              "geometry_relation": "candidate", "method": "exact-jurisdiction-index-class",
                              "in_geographic_scope": in_scope, "native_class_agrees": True})
                explicit.add(record_id)
        lookup = (*scope, normalized_name(properties["waterbody_name"]), properties["status"])
        if counties:
            for record_id in self.index.get(lookup, []):
                entry = self.records[record_id]
                record = entry["record"]
                if record_id in explicit:
                    continue
                if not counties.intersection(normalized_name(value) for value in record["county_codes"]):
                    continue
                prior = properties["previous_class"]
                if prior and record.get("previous_class") and prior != record["previous_class"]:
                    continue
                links.append({"feature_id": key, "registry_record_id": record_id,
                              "geometry_relation": "candidate", "method": "exact-name-class-county",
                              "in_geographic_scope": in_scope, "native_class_agrees": True})
        self.associations.extend(links)
        return links

    def export(self):
        missing = sorted(set(self.bindings) - self.seen_features)
        if missing:
            raise ValueError("Explicit bindings reference absent native features: " + ", ".join(missing))
        by_record = collections.defaultdict(list)
        for link in self.associations:
            by_record[link["registry_record_id"]].append(link)
        records = []
        for key, entry in self.records.items():
            links = by_record[key]
            records.append({**entry, "associations": links,
                            "coextensive_in_scope": any(link["in_geographic_scope"]
                              and link["geometry_relation"] == "coextensive" for link in links)})
        return {"schema": "upstate.classified-water-legal-associations/v1",
                "records": records, "associations": self.associations,
                "unassociated_registry_ids": [key for key in self.records if not by_record[key]],
                "interpretation": "Candidates associate records for review; they do not split a legal reach or "
                                  "apply its classification to a whole source feature. Coextensive is an explicit "
                                  "geometry assertion supplied in bindings. HUC intersection is spatial membership, "
                                  "not downstream receiving-water applicability."}


def source_labels(layer, config, *, compact=False):
    labels = {"data_status": config.get("data_status", layer.get("data_status")),
              "catalogue_source_id": config.get("catalogue_source_id", layer.get("catalogue_source_id"))}
    metadata = config.get("source_metadata", layer.get("source_metadata", {}))
    if not compact:
        labels["source_metadata"] = metadata
        return labels
    if "source_metadata" in config:
        member_name = "mapping.source_metadata"
    elif "source_metadata" in layer:
        member_name = "source_metadata"
    else:
        labels["source_metadata_ref"] = None
        return labels
    labels["source_metadata_ref"] = {
        "schema": "upstate.classified-water-metadata-ref/v1",
        "document": "provenance.json", "layer_id": layer["id"], "member": member_name,
        "sha256": hashlib.sha256(canonical(metadata).encode("utf-8")).hexdigest(),
    }
    return labels


def feature_properties(loaded, feature):
    layer, config, fields = loaded["layer"], loaded["config"], loaded["fields"]
    attributes = feature["attributes"]
    oid = identity(attributes[layer["oid_field"]])
    values = parse_class(attributes.get(config["class_field"]), fields[config["class_field"]], config)
    prior_raw = attributes.get(config["previous_class_field"]) if config.get("previous_class_field") else None
    if prior_raw is not None:
        prior_field = fields[config["previous_class_field"]]
        prior = parse_class(prior_raw, prior_field, {"class_values": config.get("previous_class_values", {})})
        values["previous_class_from_label"] = values["previous_class"]
        values["previous_class"] = prior["class_code"] or values["previous_class"]
        values["previous_class_raw"] = prior_raw
        values["previous_class_label"] = prior["class_label"]
    sp_raw = attributes.get(config["site_specific_field"]) if config.get("site_specific_field") else None
    sp_value = boolean_value(sp_raw, config.get("site_specific_values"))
    if sp_value is not None:
        values["site_specific_from_label"] = values["site_specific"]
        values["site_specific"] = values["site_specific"] or sp_value
    ndz_raw = attributes.get(config["ndz_field"]) if config.get("ndz_field") else None
    county_raw = attributes.get(config["county_field"]) if config.get("county_field") else None
    declared = {}
    if config.get("classification_system"):
        jurisdiction, system = classification_scope(config, required=True)
        declared = {"jurisdiction": jurisdiction, "classification_system": system}
    if config.get("native_index_field"):
        declared["original_index"] = attributes.get(config["native_index_field"])
    if config.get("effective_date_field"):
        declared["native_effective_date"] = attributes.get(config["effective_date_field"])
    return {**declared, "feature_id": layer["id"] + ":" + oid, "layer_id": layer["id"], "object_id": oid,
            "waterbody_name": attributes.get(config["name_field"]),
            "reach_description": attributes.get(config["description_field"]) if config.get("description_field") else None,
            "status": config["status"], "legal_edition_status": config["status"],
            **(loaded.get("_feature_source_labels") or source_labels(layer, config, compact=True)),
            "vintage": config["vintage"], "source_url": layer["url"],
            **values, "site_specific_raw": sp_raw, "no_discharge_zone_raw": ndz_raw,
            "no_discharge_zone": boolean_value(ndz_raw, config.get("ndz_values")),
            "county_raw": county_raw, "county_codes": county_values(county_raw, config),
            "native_attributes": attributes}


def csv_value(value):
    if isinstance(value, (dict, list)):
        return canonical(value)
    return value


def write_csv(path, rows, required_fields=()):
    keys = list(dict.fromkeys(list(required_fields) + [key for row in rows for key in row]))
    with Path(path).open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: csv_value(value) for key, value in row.items()})


def write_vectors(root, name, rows, analysis_crs, gpkg_path):
    """GeoJSON is RFC 7946; GeoPackage is projected and grouped by geometry."""
    import fiona
    from shapely.geometry import mapping, MultiLineString, MultiPolygon
    from pyproj import CRS
    out = root / (name + ".geojson")
    with out.open("w", encoding="utf-8") as handle:
        handle.write('{"type":"FeatureCollection","name":' + json.dumps(name) + ',"features":[')
        for index, row in enumerate(rows):
            if index:
                handle.write(",")
            feature = {"type": "Feature", "id": row["id"], "properties": row["properties"],
                       "geometry": mapping(project(row["geometry"], analysis_crs, CRS.from_epsg(4326)))}
            handle.write(canonical(feature))
        handle.write("]}\n")
    groups = collections.defaultdict(list)
    for row in rows:
        geometry = row["geometry"]
        if geometry.geom_type in ("LineString", "LinearRing", "MultiLineString") and not row["properties"].get("touch_only"):
            group = "lines"
        elif geometry.geom_type in ("Polygon", "MultiPolygon") and not row["properties"].get("touch_only"):
            group = "polygons"
        else:
            group = "touches"
        groups[group].append(row)
    layer_inventory = []
    for group, items in groups.items():
        layer_name = name + "_" + group
        keys = list(dict.fromkeys(key for item in items for key in item["properties"]))
        properties_schema = {}
        for key in keys:
            values = [item["properties"].get(key) for item in items if item["properties"].get(key) is not None]
            if values and all(isinstance(value, (int, bool)) for value in values):
                properties_schema[key] = "int64"
            elif values and all(isinstance(value, (int, float, bool)) for value in values):
                properties_schema[key] = "float"
            else:
                properties_schema[key] = "str"
        geometry_schema = {"lines": "MultiLineString", "polygons": "MultiPolygon", "touches": "Unknown"}[group]
        with fiona.open(gpkg_path, "w", driver="GPKG", layer=layer_name, crs=analysis_crs.to_wkt(),
                        schema={"geometry": geometry_schema, "properties": properties_schema}) as collection:
            def feature_records():
                for item in items:
                    geometry = item["geometry"]
                    if group == "lines" and geometry.geom_type != "MultiLineString":
                        geometry = MultiLineString([geometry])
                    elif group == "polygons" and geometry.geom_type == "Polygon":
                        geometry = MultiPolygon([geometry])
                    values = {}
                    for key, kind in properties_schema.items():
                        value = item["properties"].get(key)
                        if value is not None:
                            if kind == "str":
                                value = canonical(value) if isinstance(value, (dict, list, bool)) else str(value)
                            elif kind == "int64":
                                value = int(value)
                            else:
                                value = float(value)
                        values[key] = value
                    yield {"geometry": mapping(geometry), "properties": values}
            collection.writerecords(feature_records())
        layer_inventory.append({"file": gpkg_path.name, "layer": layer_name,
                                "geometry": geometry_schema, "features": len(items), "crs": "EPSG:26917"})
    return layer_inventory


def summarize(groups, regions, statuses, dimensions):
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    output = []
    for region in regions:
        for status in statuses:
            for dimension in dimensions:
                for scope in ("all", "priority"):
                    groups.setdefault((region["id"], status, scope, dimension), [])
    for (region_id, status, class_scope, dimension), rows in sorted(groups.items()):
        geometries = [row[1] for row in rows]
        union = unary_union(geometries) if geometries else GeometryCollection()
        output.append({"region_id": region_id, "status": status, "class_scope": class_scope,
                       "geometry_kind": "line" if dimension == 1 else "polygon",
                       "positive_feature_count": len({row[0] for row in rows}),
                       "data_statuses": sorted({row[2] for row in rows if row[2] is not None}),
                       "source_feature_measure_sum": sum(measure(geometry, dimension) for geometry in geometries),
                       "unique_geometry_measure": measure(union, dimension),
                       "measure_unit": "m" if dimension == 1 else "ha"})
    return output


def build_crosswalk(capture_root, mapping_path, project_source, output_root, *,
                    huc_paths=(), registry_paths=(), bindings_path=None, workspace_root=None,
                    planning_path=None, focus_path=None):
    """Build an immutable source edition and optionally import its local manifest.

    Explicit planning_path and focus_path can be verified Workspace.source_file
    paths. When both are supplied, project_source may be None. Original source
    bodies and native geography checks are identical in either input mode.
    """
    import fiona
    import pyproj
    import shapely
    from pyproj import CRS
    from shapely.ops import unary_union
    from shapely.strtree import STRtree

    inputs, corrections = Inputs(), []
    capture, configuration, layers = load_capture(capture_root, mapping_path, inputs)
    regions, geography = load_geography(project_source, huc_paths, inputs, corrections,
                                         planning_path=planning_path, focus_path=focus_path)
    legal = LegalAssociations(registry_paths, bindings_path, inputs)
    inputs.add("inputs/producer/high_quality_water_crosswalk.py", Path(__file__))
    inputs.add("inputs/producer/water_classifications.py", PROJECT_ROOT / "source_tools/water_classifications.py")
    inputs.add("inputs/producer/capture_upstream_network.py",
               PROJECT_ROOT / "source/capture_upstream_network.py")
    runtime = {"python": sys.version.split()[0], "fiona": fiona.__version__,
               "shapely": shapely.__version__, "pyproj": pyproj.__version__}
    signature = {"schema": SCHEMA, "version": VERSION, "inputs": inputs.inventory(), "runtime": runtime}
    run_id = hashlib.sha256(canonical(signature).encode("utf-8")).hexdigest()[:24]
    output = Path(output_root).resolve()
    output.mkdir(parents=True, exist_ok=True)
    final = output / run_id

    def retained_result():
        completed = read_json(final / "completed.json")
        if completed["run_id"] != run_id or completed["signature"] != signature:
            raise ValueError("Output edition belongs to different retained inputs")
        for row in completed["files"]:
            path = member(final, row["path"])
            if path.stat().st_size != row["bytes"] or sha256_file(path) != row["sha256"]:
                raise ValueError("Previously completed output bytes changed: " + row["path"])
        result = dict(completed["result"])
        if workspace_root is not None:
            from model.workspace import Workspace
            result["source_collection"] = Workspace(workspace_root).import_sources(final / "sources.json")
        return result

    if final.exists():
        return retained_result()
    staging = Path(tempfile.mkdtemp(prefix="." + run_id + "-", dir=output))
    try:
        inputs.copy_to(staging)
        analysis_crs = CRS.from_epsg(26917)
        reporting = regions[0]["geometry"]
        interest = unary_union([reporting, regions[-1]["geometry"]])
        tree = STRtree([row["geometry"] for row in regions])
        maps = {key: [] for key in ("source_reaches", "reporting_reaches", "huc_reaches", "domain_reaches")}
        native_rows, crosswalk_rows = [], []
        groups = collections.defaultdict(list)
        stats = collections.Counter()
        unparsed = collections.Counter()
        statuses, dimensions = set(), set()

        for loaded in layers:
            layer, config = loaded["layer"], loaded["config"]
            loaded["_feature_source_labels"] = source_labels(layer, config, compact=True)
            statuses.add(config["status"])
            for feature in loaded["features"]:
                stats["captured_native_features"] += 1
                properties = feature_properties(loaded, feature)
                key = properties["feature_id"]
                native, dimension = esri_geometry(feature.get("geometry"), layer["geometry_type"], corrections, key)
                dimensions.add(dimension)
                geometry = project(native, loaded["crs"], analysis_crs)
                if geometry.is_empty or not geometry.is_valid:
                    raise ValueError("Projected native geometry needs resolution for " + key)
                in_scope = geometry.intersects(interest)
                links = legal.for_feature(properties, in_scope)
                if not in_scope:
                    stats["outside_loaded_geographic_scope"] += 1
                    continue
                stats["geographically_selected_features"] += 1
                if properties["class_code"] is None:
                    unparsed[(layer["id"], canonical(properties["class_raw"]), properties["class_label"] or "")] += 1
                properties.update({"geometry_kind": "line" if dimension == 1 else "polygon",
                                   **measure_fields(geometry, dimension, "source"),
                                   "registry_record_ids": [link["registry_record_id"] for link in links],
                                   "coextensive_registry_ids": [link["registry_record_id"] for link in links
                                                               if link["geometry_relation"] == "coextensive"],
                                   "partial_registry_ids": [link["registry_record_id"] for link in links
                                                           if link["geometry_relation"] == "partial"],
                                   "candidate_registry_ids": [link["registry_record_id"] for link in links
                                                             if link["geometry_relation"] == "candidate"]})
                source_row = {key: value for key, value in properties.items() if key != "native_attributes"}
                native_rows.append({**source_row, "native_attributes": properties["native_attributes"]})
                maps["source_reaches"].append({"id": key, "geometry": geometry, "properties": properties})
                for region_index in sorted(int(value) for value in tree.query(geometry, predicate="intersects")):
                    region = regions[region_index]
                    intersection = geometry.intersection(region["geometry"])
                    selected = dimensional_geometry(intersection, dimension)
                    amount = measure(selected, dimension)
                    counted = amount > 0
                    inside_reporting = dimensional_geometry(selected.intersection(reporting), dimension)
                    outside_reporting = dimensional_geometry(selected.difference(reporting), dimension)
                    source_amount = measure(geometry, dimension)
                    row = {**source_row, "region_id": region["id"], "region_kind": region["kind"],
                           "geography_role": region["role"], "huc12": region["id"] if region["kind"] == "huc12" else None,
                           "counted": counted, "touch_only": not counted,
                           **measure_fields(selected, dimension, "intersection"),
                           **measure_fields(inside_reporting, dimension, "inside_reporting"),
                           **measure_fields(outside_reporting, dimension, "outside_reporting"),
                           "fraction_of_source_measure": amount / source_amount if source_amount > 0 else None}
                    crosswalk_rows.append(row)
                    map_name = {"reporting": "reporting_reaches", "huc12": "huc_reaches",
                                "loaded_domain": "domain_reaches"}[region["kind"]]
                    maps[map_name].append({"id": key + "@" + region["id"],
                                          "geometry": selected if counted else intersection, "properties": row})
                    if counted:
                        qualified = classification_scope(properties)
                        class_scope = properties["class_code"] or "UNPARSED:" + str(properties["class_label"])
                        if qualified[0] != "SC":
                            class_scope = qualified[0] + ":" + qualified[1] + ":" + class_scope
                        scopes = ["all", "class:" + class_scope]
                        if qualified[0] != "SC":
                            scopes.append("jurisdiction:" + qualified[0])
                        if properties["rfp_high_quality_candidate"]:
                            scopes.append("priority")
                        for scope in scopes:
                            groups[(region["id"], properties["status"], scope, dimension)].append(
                                (key, selected, properties.get("data_status")))
                    else:
                        stats["touch_only_crosswalk_rows"] += 1
        legal_result = legal.export()
        summaries = summarize(groups, regions, sorted(statuses), sorted(dimensions))
        boundary_rows = [{"id": region["id"], "geometry": region["geometry"],
                          "properties": {"region_id": region["id"], "region_kind": region["kind"],
                                         "geography_role": region["role"],
                                         "area_ha": region["geometry"].area / 10000.0}}
                         for region in regions]
        maps["boundaries"] = boundary_rows
        gpkg = staging / "classified_water_maps.gpkg"
        vector_layers = []
        for name, rows in maps.items():
            vector_layers.extend(write_vectors(staging, name, rows, analysis_crs, gpkg))
        generated_at = now()
        crosswalk = {"schema": SCHEMA, "run_id": run_id, "generated_at": generated_at,
                     "analysis_crs": "EPSG:26917", "statistics": dict(stats), "rows": crosswalk_rows,
                     "coverage_summary": summaries, "vector_layers": vector_layers}
        write_json(staging / "crosswalk.json", crosswalk)
        write_csv(staging / "crosswalk.csv", crosswalk_rows,
                  ("feature_id", "layer_id", "object_id", "region_id", "status", "class_code",
                   "intersection_length_m", "intersection_area_ha", "counted", "touch_only"))
        write_csv(staging / "native_features.csv", native_rows,
                  ("feature_id", "layer_id", "object_id", "status", "class_code", "waterbody_name"))
        write_csv(staging / "coverage_summary.csv", summaries)
        write_json(staging / "legal_associations.json", legal_result)
        provenance = {"schema": "upstate.classified-water-crosswalk-provenance/v1",
                      "run_id": run_id, "generated_at": generated_at, "producer_version": VERSION,
                      "signature": signature, "geography": geography, "geometry_operations": corrections,
                      "layers": [{**row["layer"], "mapping": row["config"]} for row in layers],
                      "unparsed_native_class_values": [{"layer_id": key[0], "raw_value_json": key[1],
                                                       "label": key[2], "feature_count": count}
                                                      for key, count in sorted(unparsed.items())],
                      "interpretation": {
                          "source": "Original native pages and complete geometries remain retained in inputs/capture. "
                                    "Feature/HUC source_metadata_ref selects one layer member in this provenance; "
                                    "full metadata remains in layers and original inputs/mapping.json.",
                          "dimensions": "Horizontal line lengths in metres; polygon areas in hectares. No polygon perimeter "
                                        "or point-touch count is substituted for water length or water area.",
                          "scope": "Upper Savannah record 5 is the SC reporting mask. The four focus HUC12s are named "
                                   "hydrologic polygons; full upstream scope comes from supplied native network selections.",
                          "aggregation": "Feature sums expose overlap. Unique geometry measures dissolve coincident geometry "
                                         "within region, status, class scope and dimension. Regional totals use the union "
                                         "region; never add independent HUC memberships or separate class totals.",
                          "legal": "Legal edition status and publisher data_status (including provisional) "
                                   "and catalogue_source_id remain separate labels. Explicit legal associations retain "
                                   "reach descriptions. Spatial HUC membership does not imply downstream applicability.",
                          "priority": "Priority is a jurisdiction-specific source screening predicate. SC retains ONRW/ORW/TN/TPGT/TPT; "
                                      "NC uses original Tr/HQW/ORW components; GA uses original trout, ONRW or wild/scenic designations. "
                                      "These predicates do not make the states legally equivalent. Unknown labels remain visible.",
                          "zero": "Boundary-only intersections are retained as touch-only and contribute zero measure."}}
        write_json(staging / "provenance.json", provenance)

        def descriptor(name):
            path = staging / name
            return {"path": name, "sha256": sha256_file(path)}

        uri = "urn:upstate:classified-water-crosswalk:" + run_id
        entries = [
            {"id": "classified-water-crosswalk", "title": "Native classified-water geographic crosswalk",
             "kind": "table", "uri": uri, "vintage": generated_at, **descriptor("crosswalk.json"),
             "companions": [descriptor(name) for name in ("crosswalk.csv", "native_features.csv",
                             "coverage_summary.csv", "legal_associations.json", "provenance.json")]},
            {"id": "classified-water-geographic-maps", "title": "Classified-water native, reporting and HUC maps",
             "kind": "vector", "uri": uri, "vintage": generated_at, **descriptor(gpkg.name),
             "source_crs": "EPSG:26917", "layers": vector_layers,
             "source_labels": [{"layer_id": row["layer"]["id"], **source_labels(row["layer"], row["config"])}
                               for row in layers],
             "companions": [descriptor(name + ".geojson") for name in maps] + [descriptor("provenance.json")]},
            {"id": "classified-water-retained-inputs", "title": "Complete retained crosswalk source inputs",
             "kind": "document", "uri": uri, "vintage": generated_at, **descriptor("provenance.json"),
             "companions": [descriptor(row["path"]) for row in inputs.inventory()]}
        ]
        for loaded in layers:
            layer, config = loaded["layer"], loaded["config"]
            original = "inputs/capture/" + layer["combined_path"]
            references = list(dict.fromkeys([layer["metadata_path"], layer["object_ids_path"], layer["count_path"]]
                                             + [page["path"] for page in layer["pages"]]))
            with (staging / original).open("rb") as source_stream:
                original_is_gzip = source_stream.read(2) == b"\x1f\x8b"
            entries.append({"id": layer["id"] + "-native", "title": layer["title"],
                            "kind": "vector", "uri": layer["url"], "vintage": config["vintage"],
                            "role": "WATER_CLASSIFICATION",
                            "id_field": layer["oid_field"], "native_oid_field": layer["oid_field"],
                            "class_field": config["class_field"], "field_schema": layer["field_schema"],
                            "metadata": {"id_field": layer["oid_field"],
                                         "native_oid_field": layer["oid_field"],
                                         "class_field": config["class_field"],
                                         "classification_status": config.get("data_status", layer.get("data_status"))},
                            "status": config["status"], "legal_edition_status": config["status"],
                            **source_labels(layer, config), "source_format": "Esri JSON",
                            **({"encoding": "gzip"} if original_is_gzip else {}),
                            "source_crs": layer["source_crs"], "mapping": config,
                            **descriptor(original),
                            "companions": [descriptor("inputs/capture/" + name) for name in references]
                                          + [descriptor("inputs/mapping.json")]})
        manifest = {"schema": "upstate.sources/v1", "title": "Upper Savannah native high-quality-water source edition",
                    "captured_at": generated_at, "entries": entries,
                    "scope": {"reporting": "SC Upper Savannah PlanningBasins2023 native record 5",
                              "reporting_shapefile_sha256": PLANNING_SHA256, "huc12_count": geography["huc12_count"],
                              "focus_huc12": list(FOCUS_HUCS), "upstream_selections": geography["upstream_selections"],
                              "statuses": sorted(statuses),
                              "source_labels": [{"layer_id": row["layer"]["id"],
                                                 **source_labels(row["layer"], row["config"])} for row in layers]},
                    "notes": list(provenance["interpretation"].values())}
        write_json(staging / "sources.json", manifest)
        result = {"schema": SCHEMA, "run_id": run_id, "output_dir": str(final),
                  "source_manifest": str(final / "sources.json"), "geopackage": str(final / gpkg.name),
                  "selected_native_features": len(native_rows), "crosswalk_rows": len(crosswalk_rows),
                  "huc12_count": geography["huc12_count"], "vector_layers": vector_layers}
        files = [{"path": path.relative_to(staging).as_posix(), "bytes": path.stat().st_size,
                  "sha256": sha256_file(path)} for path in sorted(staging.rglob("*")) if path.is_file()]
        write_json(staging / "completed.json", {"run_id": run_id, "signature": signature,
                                              "files": files, "result": result})
        try:
            os.rename(staging, final)
        except OSError:
            if not final.exists():
                raise
            winner = read_json(final / "completed.json")
            if winner["signature"] != signature:
                raise ValueError("Another source edition already occupies the output directory")
            shutil.rmtree(staging)
        return retained_result()
    except Exception as error:
        if staging.exists():
            write_json(staging / "failure.json", {"error": str(error), "retained_staging": str(staging),
                                                "source_inputs": inputs.inventory()})
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True, help="Retained intake capture directory")
    parser.add_argument("--mapping", required=True, help="Actual native field/domain mapping JSON")
    parser.add_argument("--project-source", help="Original source data directory containing geography/; optional with both explicit sources")
    parser.add_argument("--planning-basins", help="Retained original PlanningBasins2023.shp with its original sidecars")
    parser.add_argument("--focus-hucs", help="Retained original four-focus HUC12 response")
    parser.add_argument("--output", required=True, help="Parent for immutable crosswalk editions")
    parser.add_argument("--huc", action="append", default=[], help="Extra native HUC file or upstream network-selection.json")
    parser.add_argument("--registry", action="append", default=[], help="Original source reach registry with explicit edition status; repeatable")
    parser.add_argument("--bindings", help="Explicit native-feature/legal-record binding JSON")
    parser.add_argument("--workspace", help="Existing model Workspace; imports the completed local sources.json")
    args = parser.parse_args(argv)
    result = build_crosswalk(args.capture, args.mapping, args.project_source, args.output,
                             huc_paths=args.huc, registry_paths=args.registry,
                             bindings_path=args.bindings, workspace_root=args.workspace,
                             planning_path=args.planning_basins, focus_path=args.focus_hucs)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
