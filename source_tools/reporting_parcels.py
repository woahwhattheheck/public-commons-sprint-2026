"""Acquire and prepare all county parcels intersecting the original SC reporting area.

The collector preserves native county records and source editions. Prepared parcel
keys are qualified by county/provider/OID; areas are measured in EPSG:5070.
"""
from __future__ import annotations
import argparse
import collections
import csv
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, verify_file)
from model import rasters
from .domain_overlays import _retain, _crs, polygon_rows, _acquisition_masks

_SOURCE = Path(__file__).resolve().parents[1] / "source"
if str(_SOURCE) not in sys.path:
    sys.path.insert(0, str(_SOURCE))
from capture_original_overlays import capture_layer, OriginalResponses, oid_field, source_where
from capture_upstream_network import PLANNING_SHA

SCHEMA = "upstate.reporting-parcels/v1"
PREPARATION_METHOD = "upstate.reporting-parcels/whole-original-polygons/v2"
TRANSFER_SCHEMA = "upstate.reporting-parcel-transfer/v1"
CATALOG_SCHEMA = "upstate.sc-parcel-providers/v1"
DEFAULT_CATALOG = Path(__file__).with_name("SC_PARCEL_PROVIDERS.json")
REPORTING_HASHES = {
    ".shp": PLANNING_SHA,
    ".prj": "16375a22022b8b34455292d576c5ebb590083e406d754a9abbcca6994c3e3261",
    ".dbf": "0c792056dcaff94eaa9fb5a22d576a6c42bcce763a885a289f4cdd15434b4dba",
    ".shx": "60572d5c75694110fceab00c24ba9b3607756838585f2b315c5abcbeac0034c6",
    ".shp.xml": "95776aa0ff34820f077e04695975af1eb73a3f21d03642c827623324e47a73ec",
}
COVERAGE = ("Whole native county parcel features intersecting every acquisition "
            "tile covering original PlanningBasins2023 Upper Savannah record 5. "
            "The analytical inventory selects positive-area reporting intersections.")
SC_MASK = {"id": "south-carolina-counties",
           "geometry": {"rings": [[[-84, 31], [-84, 36], [-78, 36], [-78, 31], [-84, 31]]]},
           "spatial_reference": {"wkid": 4326},
           "source": "Statewide envelope; validate all 46 native South Carolina county FIPS"}
PARCEL_FIELDS = {
    "parcel_id": "str:180", "county_fips": "str:5", "county_name": "str:50",
    "source_id": "str:100", "native_oid": "str:40", "native_id_field": "str:100",
    "parcel_ref": "str:255", "parcel_ref_field": "str:100",
    "source_uri": "str:512", "source_sha256": "str:64",
    "source_edition": "str:100", "source_status": "str:50",
    "record_class": "str:60", "native_class": "str:100", "parcel_candidate": "int",
    "native_class_field": "str:100", "classification_basis": "str:100",
    "source_revision_field": "str:100", "source_revision_type": "str:50",
    "source_revision_value": "str:255",
    "whole_feature_area_ha": "float", "reporting_area_ha": "float",
    "source_county_area_ha": "float", "outside_source_county_ha": "float",
}
COVERAGE_FIELDS = {
    "county_fips": "str:5", "county_name": "str:50",
    "provider_id": "str:100", "capture_status": "str:50",
    "expected_ha": "float", "covered_ha": "float", "uncovered_ha": "float",
    "coverage_fraction": "float", "overlap_excess_ha": "float",
    "source_own_coverage_ha": "float", "parcel_count": "int",
    "parcel_coverage_ha": "float", "cadastral_record_count": "int",
}
GAP_FIELDS = {"county_fips": "str:5", "tile_id": "str:100",
              "capture_status": "str:50", "gap_class": "str:60", "area_ha": "float"}


def _simple(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
        raise ValueError(label + " must be a simple portable identifier")
    return value


def _catalog(path):
    value = read_json(path)
    if value.get("schema") != CATALOG_SCHEMA:
        raise ValueError("Select the documented South Carolina parcel provider catalog")
    counties = value.get("counties")
    if not isinstance(counties, list) or not counties:
        raise ValueError("The provider catalog needs its original county records")
    seen, ids = set(), set()
    for county in counties:
        fips = county.get("fips")
        if not isinstance(fips, str) or not re.fullmatch(r"45\d{3}", fips) or fips in seen:
            raise ValueError("Use unique five-digit South Carolina county FIPS")
        seen.add(fips)
        providers = county.get("providers", [])
        local = set()
        for provider in providers:
            identity = _simple(provider.get("id"), "Provider ID")
            if identity in ids:
                raise ValueError("A provider ID is assigned to more than one county")
            ids.add(identity); local.add(identity)
            source_where(provider)
            if "native_county_field" in provider or "native_county_value" in provider:
                if any(not isinstance(provider.get(name), str) or not provider[name].strip()
                       for name in ("native_county_field", "native_county_value")):
                    raise ValueError("Record the exact native county field and value together")
            if (not isinstance(provider.get("url"), str)
                    or not re.match(r"^https://[^/]+/.+/(?:MapServer|FeatureServer)/\d+$",
                                    provider["url"], re.I)):
                raise ValueError("A parcel provider must name an exact HTTPS ArcGIS feature layer")
            if not provider.get("authority_url") or not provider.get("provenance"):
                raise ValueError("Record the county authority and source provenance")
            if not provider.get("parcel_id_fields"):
                raise ValueError("Record the provider's actual native parcel reference field")
            if type(provider.get("page_size")) is not int or provider["page_size"] < 1:
                raise ValueError("Use a positive exact-ID page size")
        preferred = county.get("preferred_provider")
        if preferred is not None and preferred not in local:
            raise ValueError("The selected county provider is absent from the catalog")
    boundary = value.get("county_boundary", {})
    if not boundary.get("url") or not boundary.get("county_field") or not boundary.get("fips_field"):
        raise ValueError("The catalog must bind the original statewide county geometry")
    return value


def _csv(path, fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=list(fields), extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    atomic_bytes(path, stream.getvalue().encode("utf-8"), immutable=True)


def _body(path):
    with gzip.open(path, "rb") as stream:
        return json.load(stream)


def _validate_counties(collection, spec):
    field = oid_field(collection)
    features = collection.get("features", [])
    if len(features) != 46:
        raise ValueError("The county source must contain all 46 South Carolina counties")
    found = set()
    for feature in features:
        attrs = feature.get("attributes", {})
        fips = attrs.get(spec["fips_field"])
        if not isinstance(fips, str) or not re.fullmatch(r"45\d{3}", fips) or fips in found:
            raise ValueError("The original county source does not contain 46 unique SC FIPS")
        if not attrs.get(spec["county_field"]) or not feature.get("geometry"):
            raise ValueError("An original county record lacks its name or geometry")
        if type(attrs.get(field)) is not int:
            raise ValueError("A county source OID must retain its native integer identity")
        found.add(fips)
    return features


def _verify_capture(root, record):
    path = verify_file(root, {"path": record["path"], "sha256": record["sha256"],
                             "bytes": (root/record["path"]).stat().st_size})
    for item in record.get("files", []):
        verify_file(root, item)
    return path


def _receive_original_reporting(root):
    """Receive the exact small reporting source directly from its pinned source commit."""
    from datetime import datetime, timezone
    from email.utils import parsedate_to_datetime
    from urllib.error import HTTPError
    from urllib.request import Request, urlopen
    prefix = ("https://raw.githubusercontent.com/capellett/scsf/"
              "45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023/")
    destination = root/"original-reporting"
    responses = root/"reporting-responses"
    destination.mkdir(parents=True, exist_ok=True)
    responses.mkdir(parents=True, exist_ok=True)
    for suffix, expected in REPORTING_HASHES.items():
        name = "PlanningBasins2023" + suffix
        target = destination/name
        if target.exists():
            if file_digest(target) != expected:
                raise ValueError("Received reporting member has another original identity: " + name)
            continue
        # The cumulative application carries these exact original companions.
        # Reuse them before requesting the same pinned bytes from the network.
        bundled = _SOURCE/"geography"/"planning_basins2023"/name
        if bundled.exists():
            if not bundled.is_file():
                raise ValueError("Bundled reporting member is not a file: " + name)
            body = bundled.read_bytes()
            if hashlib.sha256(body).hexdigest() != expected:
                raise ValueError("Bundled reporting member has another original identity: " + name)
            receipt = {"uri": prefix+name, "received_at": now(),
                       "transfer": "bundled-original-source", "retained_from": str(bundled),
                       "bytes": len(body), "sha256": expected, "expected_sha256": expected}
            receipt_path = responses/(name + ".bundled.json")
            if receipt_path.exists():
                previous = read_json(receipt_path)
                for key in ("uri", "transfer", "bytes", "sha256", "expected_sha256"):
                    if previous.get(key) != receipt[key]:
                        raise ValueError("Bundled reporting receipt differs: " + name)
            else:
                atomic_json(receipt_path, receipt, immutable=True)
            atomic_bytes(target, body, immutable=True)
            print(json.dumps({"stage": "reporting-original", "path": str(target),
                              "bytes": len(body), "sha256": expected,
                              "transfer": "bundled-original-source"}), flush=True)
            continue
        attempts = sorted(responses.glob(name + ".attempt-*.json"))
        if attempts:
            previous = read_json(attempts[-1])
            retry = previous.get("retry_after")
            if retry:
                try:
                    due = datetime.fromisoformat(previous["received_at"]).timestamp() + float(retry)
                except ValueError:
                    due = parsedate_to_datetime(retry).timestamp()
                if datetime.now(timezone.utc).timestamp() < due:
                    raise ValueError("The original reporting provider Retry-After window is active")
        request = Request(prefix+name, headers={"User-Agent": "TJLabs Upper Savannah source capture",
                                               "Accept-Encoding": "identity"})
        try:
            response = urlopen(request, timeout=60)
        except HTTPError as error:
            response = error
        with response:
            body = response.read(4*1024*1024+1)
            if len(body) > 4*1024*1024:
                raise ValueError("Original reporting member exceeds its retained source scale")
            received = now()
            receipt = {"uri": prefix+name, "received_at": received, "status": response.status,
                       "response_url": response.geturl(), "content_type": response.headers.get("Content-Type"),
                       "retry_after": response.headers.get("Retry-After"),
                       "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                       "expected_sha256": expected}
        label = name + ".attempt-" + str(len(attempts)+1).zfill(6)
        atomic_bytes(responses/(label + ".body"), body, immutable=True)
        atomic_json(responses/(label + ".json"), receipt, immutable=True)
        if receipt["status"] != 200 or receipt["sha256"] != expected:
            raise ValueError("Original reporting response differs from its pinned source: " + name)
        atomic_bytes(target, body, immutable=True)
        print(json.dumps({"stage": "reporting-original", "path": str(target),
                          "bytes": len(body), "sha256": expected}), flush=True)


def boundaries(output, *, catalog=DEFAULT_CATALOG, retry_failed=False, archive=None):
    """Network phase: retain all native county polygons using stdlib only."""
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    value = _catalog(catalog)
    with held(root/"capture.lock", blocking=False):
        atomic_json(root/"provider-catalog.json", value, immutable=True)
        _receive_original_reporting(root)
        retained_index = root/"county-boundaries.json"
        if retained_index.exists():
            retained = read_json(retained_index)
            if (retained.get("schema") != SCHEMA or retained.get("kind") != "county-boundary-capture"
                    or retained.get("catalog_sha256") != digest(value)
                    or retained.get("source", {}).get("uri") != value["county_boundary"]["url"]):
                raise ValueError("The retained county capture belongs to another source selection")
            captured = retained["source"]
            _verify_capture(root/"layers", captured)
            _validate_counties(_body(root/"layers"/captured["path"]), value["county_boundary"])
            print(json.dumps({"stage": "county-boundaries", "count": 46,
                              "path": str(root/"layers"/captured["path"]),
                              "sha256": captured["sha256"], "reused": True}), flush=True)
            if archive:
                return bundle(root, archive)
            return retained
        spec = {**value["county_boundary"], "role": "COUNTY_CONTEXT",
                "scope": "state", "page_size": 10,
                "coverage": "All 46 original South Carolina county polygons"}
        captured = capture_layer(root/"layers", "sc-county-boundaries", spec,
                                 {"state": [SC_MASK]}, retry_failed=retry_failed)
        collection = _body(root/"layers"/captured["path"])
        _validate_counties(collection, value["county_boundary"])
        index = {"schema": SCHEMA, "kind": "county-boundary-capture",
                 "catalog_sha256": digest(value),
                 "source": captured, "catalog": describe_file(root, root/"provider-catalog.json")}
        atomic_json(root/"county-boundaries.json", index, immutable=True)
        print(json.dumps({"stage": "county-boundaries", "count": 46,
                          "path": str(root/"layers"/captured["path"]),
                          "sha256": captured["sha256"]}), flush=True)
    if archive:
        return bundle(root, archive)
    return index


def _reporting(path):
    """Read the exact original reporting record without the four-HUC dependency."""
    import shapefile
    from pyproj import CRS, Transformer
    from shapely.ops import transform
    from capture_upstream_network import esri_polygon
    path = Path(path).resolve(strict=True)
    if path.is_dir():
        path = path/"PlanningBasins2023.shp"
    if path.name != "PlanningBasins2023.shp":
        raise ValueError("Use original PlanningBasins2023.shp")
    for suffix, expected in REPORTING_HASHES.items():
        if file_digest(path.with_suffix(suffix)) != expected:
            raise ValueError("Reporting source differs from retained original " + suffix)
    native = CRS.from_wkt(path.with_suffix(".prj").read_text())
    if native.to_epsg() != 26917:
        raise ValueError("The original reporting source retains EPSG:26917")
    with shapefile.Reader(str(path)) as source:
        matches = [(number, feature) for number, feature in enumerate(source.iterShapeRecords(), 1)
                   if feature.record.as_dict().get("Basin") == "Upper Savannah"]
        if len(matches) != 1 or matches[0][0] != 5:
            raise ValueError("Select whole original Upper Savannah record 5")
        feature = matches[0][1]
        starts = list(feature.shape.parts) + [len(feature.shape.points)]
        native_geometry = {"rings": [[list(point) for point in
            feature.shape.points[starts[i]:starts[i+1]]] for i in range(len(starts)-1)]}
        props = {key: value.isoformat() if hasattr(value, "isoformat") else value
                 for key, value in feature.record.as_dict().items()}
    corrections = []
    geometry = esri_polygon(native_geometry, corrections, "reporting-record-5")
    project = Transformer.from_crs(native, CRS.from_epsg(5070), always_xy=True)
    result = transform(project.transform, geometry)
    if result.is_empty or not result.is_valid:
        raise ValueError("The original reporting polygon requires an explicit projected repair")
    members = []
    for item in sorted(path.parent.glob(path.stem + ".*")):
        if item.is_file():
            members.append({"name": item.name, "bytes": item.stat().st_size,
                            "sha256": file_digest(item)})
    required = {path.with_suffix(s).name for s in (".shp", ".shx", ".dbf", ".prj")}
    if not required.issubset({item["name"] for item in members}):
        raise ValueError("Retain complete original reporting shapefile companions")
    return result, members, {"id": "planning-upper-savannah-record-5",
        "source_crs": native.to_wkt(), "analysis_crs": "EPSG:5070",
        "source_sha256": PLANNING_SHA, "record_number": 5,
        "properties": props, "native_geometry": native_geometry,
        "analysis_corrections": corrections}


def _geometry_feature(geometry, props):
    from shapely.geometry import mapping
    return {"type": "Feature", "properties": props, "geometry": mapping(geometry)}


def _geojson(path, features, *, title):
    atomic_json(path, {"type": "FeatureCollection", "name": title,
                      "crs": {"type": "name", "properties": {"name": "EPSG:5070"}},
                      "features": features}, immutable=True)


def plan(reporting, county_capture, output, *, catalog=None, tile_m=25000, archive=None):
    """GIS phase: derive all reporting counties and source-bound rectangular masks."""
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    original = Path(county_capture).resolve(strict=True)
    index = read_json(original/"county-boundaries.json")
    if index.get("schema") != SCHEMA or index.get("kind") != "county-boundary-capture":
        raise ValueError("Select the original statewide county capture")
    old_catalog = _catalog(original/"provider-catalog.json")
    value = _catalog(catalog) if catalog else old_catalog
    if old_catalog["county_boundary"] != value["county_boundary"]:
        raise ValueError("The provider update must retain the captured original county boundary binding")
    _verify_capture(original/"layers", index["source"])
    county_file = original/"layers"/index["source"]["path"]
    _validate_counties(_body(county_file), value["county_boundary"])
    if not math.isfinite(tile_m) or tile_m <= 0:
        raise ValueError("Use a positive acquisition tile width in metres")
    geometry, members, reporting_info = _reporting(reporting)
    county_rows, county_reader = polygon_rows(county_file, "EPSG:5070")
    catalog_rows = {row["fips"]: row for row in value["counties"]}
    with held(root/"plan.lock", blocking=False):
        reporting_path = Path(reporting).resolve()
        if reporting_path.is_dir():
            reporting_path = reporting_path/"PlanningBasins2023.shp"
        for member in members:
            _retain(reporting_path.parent/member["name"], root/"original-reporting"/member["name"])
        _retain(county_file, root/"original-counties"/"features.esri.json.gz")
        for item in index["source"].get("files", []):
            _retain(original/"layers"/item["path"], root/"county-capture"/item["path"])
        _retain(original/"layers"/"sc-county-boundaries"/"layer-capture.json",
                root/"county-capture"/"sc-county-boundaries"/"layer-capture.json")
        atomic_json(root/"provider-catalog.json", value, immutable=True)
        selected, features = [], []
        for row in county_rows:
            attributes = row["properties"]
            spec = value["county_boundary"]
            fips = attributes[spec["fips_field"]]
            name = str(attributes[spec["county_field"]])
            part = geometry.intersection(row["geometry"])
            if part.is_empty or part.area <= 0:
                continue
            county = catalog_rows.get(fips, {"fips": fips, "name": name,
                                           "preferred_provider": None, "providers": []})
            providers = {item["id"]: item for item in county.get("providers", [])}
            provider = providers.get(county.get("preferred_provider"))
            selected.append({"fips": fips, "name": name, "native_county_oid": row["id"],
                "native_county_attributes": attributes,
                "reporting_area_ha": part.area/10000,
                "provider": provider, "provider_status": "selected" if provider else "source_required"})
            features.append(_geometry_feature(part, {"county_fips": fips, "county_name": name,
                                                     "native_oid": row["id"]}))
        selected.sort(key=lambda x: x["fips"])
        if not selected:
            raise ValueError("The original reporting area has no original county intersections")
        masks = _acquisition_masks([{"geometry": geometry}], 0, float(tile_m))
        for mask in masks:
            mask["id"] = mask["id"].replace("domain-", "reporting-", 1)
            mask["source"] = "Original PlanningBasins2023 Upper Savannah record 5 acquisition tiles"
        _geojson(root/"reporting.geojson", [_geometry_feature(geometry, reporting_info["properties"])],
                 title="Original reporting polygon projected to EPSG:5070")
        _geojson(root/"county-reporting.geojson", features,
                 title="Native county intersections with original SC reporting area")
        covered = unary_union([row["geometry"].intersection(geometry) for row in county_rows
                               if row["geometry"].intersects(geometry)])
        context = {"schema": SCHEMA, "kind": "reporting-parcel-plan",
                   "reporting": reporting_info, "reporting_members": members,
                   "reporting_area_ha": geometry.area/10000,
                   "county_partition_area_ha": covered.area/10000,
                   "county_partition_gap_ha": geometry.difference(covered).area/10000,
                   "county_intersection_sum_ha": sum(row["reporting_area_ha"] for row in selected),
                   "county_source": index["source"],
                   "county_reader": county_reader,
                   "catalog_sha256": digest(value), "tile_m": float(tile_m),
                   "capture_crs": "EPSG:5070", "coverage": COVERAGE, "counties": selected}
        atomic_json(root/"parcel-plan.json", context, immutable=True)
        atomic_json(root/"parcel-masks.json", {"reporting": masks}, immutable=True)
        _csv(root/"required-counties.csv",
             ("fips", "name", "reporting_area_ha", "provider_status", "provider_id", "source_uri"),
             ({**row, "provider_id": (row["provider"] or {}).get("id"),
               "source_uri": (row["provider"] or {}).get("url")} for row in selected))
        _seal_plan(root)
    if archive:
        result = bundle(root, archive)
    else:
        result = {"path": str(root), "plan_sha256": digest(context)}
    print(json.dumps({"stage": "reporting-parcel-plan", **result,
        "counties": [{"fips": row["fips"], "name": row["name"],
                     "provider": (row["provider"] or {}).get("id"),
                     "reporting_area_ha": row["reporting_area_ha"]} for row in selected],
        "county_partition_gap_ha": context["county_partition_gap_ha"]}), flush=True)
    return context

def _seal_plan(root):
    paths = [root/name for name in ("parcel-plan.json", "parcel-masks.json",
             "provider-catalog.json", "reporting.geojson", "county-reporting.geojson",
             "required-counties.csv")]
    for directory in ("original-reporting", "original-counties", "county-capture"):
        paths.extend(path for path in sorted((root/directory).rglob("*")) if path.is_file())
    transfer = {"schema": TRANSFER_SCHEMA, "kind": "plan",
                "plan_sha256": digest(read_json(root/"parcel-plan.json")),
                "masks_sha256": digest(read_json(root/"parcel-masks.json")),
                "files": [describe_file(root, path) for path in paths]}
    atomic_json(root/"plan-transfer.json", transfer, immutable=True)
    return transfer


def _verify_plan(root):
    plan_value = read_json(root/"parcel-plan.json")
    if plan_value.get("schema") != SCHEMA or plan_value.get("kind") != "reporting-parcel-plan":
        raise ValueError("Select the complete original reporting parcel plan")
    transfer = read_json(root/"plan-transfer.json")
    masks = read_json(root/"parcel-masks.json")
    if (transfer.get("schema") != TRANSFER_SCHEMA or transfer.get("kind") != "plan"
            or transfer.get("plan_sha256") != digest(plan_value)
            or transfer.get("masks_sha256") != digest(masks)):
        raise ValueError("The source-bound reporting plan or request masks changed")
    files = transfer.get("files", [])
    names = [item["path"] for item in files]
    if len(names) != len(set(names)):
        raise ValueError("The reporting plan repeats a source file")
    required = {"parcel-plan.json", "parcel-masks.json", "provider-catalog.json",
                "reporting.geojson", "county-reporting.geojson", "required-counties.csv",
                "original-counties/features.esri.json.gz"}
    required.update("original-reporting/" + item["name"] for item in plan_value["reporting_members"])
    if not required.issubset(set(names)):
        raise ValueError("The original reporting plan is missing a required input")
    for item in files:
        verify_file(root, item)
    catalog = _catalog(root/"provider-catalog.json")
    if digest(catalog) != plan_value["catalog_sha256"]:
        raise ValueError("The reporting plan belongs to another provider edition")
    selected = plan_value.get("counties", [])
    by_fips = {row["fips"]: row for row in catalog["counties"]}
    if not selected or len({row["fips"] for row in selected}) != len(selected):
        raise ValueError("The plan needs unique original reporting county selections")
    for county in selected:
        fips = county["fips"]
        if not re.fullmatch(r"45\d{3}", fips):
            raise ValueError("The plan contains an unexpected county FIPS")
        if county["reporting_area_ha"] <= 0 or not math.isfinite(county["reporting_area_ha"]):
            raise ValueError("The selected county has no positive reporting area")
        source = by_fips.get(fips, {})
        providers = {item["id"]: item for item in source.get("providers", [])}
        expected = providers.get(source.get("preferred_provider"))
        if county.get("provider") != expected:
            raise ValueError("The selected parcel provider differs from its retained catalog")
    values = masks.get("reporting")
    if not isinstance(values, list) or not values:
        raise ValueError("The reporting parcel plan has no source acquisition masks")
    ids = set()
    for mask in values:
        identity = _simple(mask.get("id"), "Acquisition mask ID")
        if identity in ids or mask.get("spatial_reference") != {"wkid": 5070}:
            raise ValueError("Use unique original EPSG:5070 reporting masks")
        ids.add(identity)
        rings = mask.get("geometry", {}).get("rings")
        if not isinstance(rings, list) or len(rings) != 1 or len(rings[0]) != 5:
            raise ValueError("Reporting acquisition uses complete rectangular tiles")
        ring = rings[0]
        if ring[0] != ring[-1] or any(len(point) != 2 or any(
                isinstance(number, bool) or not isinstance(number, (float, int))
                or not math.isfinite(number) for number in point) for point in ring):
            raise ValueError("A reporting acquisition mask has invalid coordinates")
        if sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(ring, ring[1:])) >= 0:
            raise ValueError("ArcGIS exterior request rings must be clockwise")
    for suffix, expected in REPORTING_HASHES.items():
        if file_digest(root/"original-reporting"/("PlanningBasins2023" + suffix)) != expected:
            raise ValueError("The transferred reporting source differs from the original edition")
    return plan_value, masks


def _provider_spec(provider):
    return {"title": provider["title"], "url": provider["url"], "role": "PARCEL",
            "scope": "reporting", "page_size": provider["page_size"],
            "coverage": COVERAGE, "where": source_where(provider)}


def _edition(root, identity):
    response = OriginalResponses(root/"layers"/identity/"responses")
    metadata, receipt = response.response("metadata",
        read_json(root/"layers"/identity/"layer-capture.json")["uri"] + "?f=pjson")
    editing = metadata.get("editingInfo", {})
    return {"captured_at": receipt["captured_at"],
            "last_edit_date": editing.get("lastEditDate"),
            "data_last_edit_date": editing.get("dataLastEditDate"),
            "schema_last_edit_date": editing.get("schemaLastEditDate"),
            "source_description": metadata.get("description", ""),
            "definition_expression": metadata.get("definitionExpression"),
            "native_fields": metadata.get("fields", [])}


def _capture_records(root, plan_value):
    records = {}
    for county in plan_value["counties"]:
        provider = county.get("provider")
        if not provider:
            continue
        identity = provider["id"]
        path = root/"layers"/identity/"layer-capture.json"
        if not path.exists():
            continue
        value = read_json(path)
        if (value.get("id") != identity or value.get("uri") != provider["url"]
                or value.get("scope") != "reporting" or value.get("coverage") != COVERAGE
                or source_where(value) != source_where(provider)):
            raise ValueError("A parcel capture belongs to another native provider or selection")
        _verify_capture(root/"layers", value)
        selection = read_json(root/"layers"/identity/"selection.json")
        if source_where(selection) != source_where(provider):
            raise ValueError("A parcel selection belongs to another original feature predicate")
        records[identity] = value
    return records


def _capture_manifest(root, plan_value, records, failures):
    entries, counties = [], []
    plan_id = digest(plan_value)
    for county in plan_value["counties"]:
        provider = county.get("provider")
        key = provider["id"] if provider else None
        record = records.get(key)
        if record:
            edition = _edition(root, key)
            companions = [describe_file(root, root/"layers"/key/"layer-capture.json")]
            companions.extend(describe_file(root, root/"layers"/item["path"])
                for item in record["files"] if item["path"] != record["path"])
            entries.append({"id": key + "-reporting-" + plan_id[:16],
                "title": provider["title"], "kind": "vector", "role": "PARCEL_SOURCE",
                "uri": provider["url"],
                "vintage": "Observed provider edition captured " + edition["captured_at"],
                **describe_file(root, root/"layers"/record["path"]),
                "id_field": record["id_field"], "companions": companions,
                "metadata": {"county_fips": county["fips"], "county_name": county["name"],
                    "source_crs": record["source_crs"], "feature_count": record["feature_count"],
                    "edition": edition, "provider": provider,
                    "coverage": COVERAGE, "plan_sha256": plan_id,
                    "source_where": source_where(provider)}})
        status = ("complete" if record else "source_required" if not provider
                  else "provider_exception" if key in failures else "pending")
        counties.append({"fips": county["fips"], "name": county["name"],
            "expected_reporting_area_ha": county["reporting_area_ha"],
            "provider_id": key, "status": status,
            "selected_native_features": record["feature_count"] if record else None,
            "source_uri": provider["url"] if provider else None,
            "source_where": source_where(provider) if provider else None,
            "exception": failures.get(key)})
    transfer = read_json(root/"plan-transfer.json")
    entries.append({"id": "reporting-parcel-plan-" + plan_id[:16],
        "title": "Full reporting parcel selection and original county sources",
        "kind": "document", "role": "SOURCE_CONTEXT", "uri": "urn:sha256:" + plan_id,
        "vintage": "PlanningBasins2023 and retained original county edition",
        **describe_file(root, root/"parcel-plan.json"),
        "companions": [describe_file(root, root/"plan-transfer.json")] +
            [item for item in transfer["files"] if item["path"] != "parcel-plan.json"]})
    manifest = {"schema": "upstate.sources/v1",
        "title": "Upper Savannah full reporting county parcel sources",
        "entries": entries, "scope": {"planning_shapefile_sha256": PLANNING_SHA,
            "plan_sha256": plan_id, "reporting_area_ha": plan_value["reporting_area_ha"],
            "counties": counties},
        "notes": ["PARCEL_SOURCE preserves native county collections. The prepared parcel manifest supplies PARCEL.",
                  "A selected county capture is complete when all provider-selected native IDs are retained.",
                  "Uncovered cadastral area and failed source acquisition remain distinct inventory measures."]}
    manifest_name = "native-sources-" + digest(manifest)[:20] + ".json"
    atomic_json(root/manifest_name, manifest, immutable=True)
    atomic_json(root/"native-sources.json", manifest)
    complete = all(row["status"] == "complete" for row in counties)
    progress = {"schema": SCHEMA, "kind": "reporting-parcel-progress",
        "state": "complete" if complete else "partial", "plan_sha256": plan_id,
        "counties": counties, "manifest": manifest_name, "updated_at": now()}
    atomic_json(root/"capture-progress.json", progress)
    print(json.dumps(progress, ensure_ascii=False), flush=True)
    return progress


def _reuse_sources(root, plan_value, masks, originals, fresh_providers):
    """Reuse only byte-complete providers with identical original acquisition masks."""
    wanted = {row["provider"]["id"]: row["provider"] for row in plan_value["counties"]
              if row.get("provider")}
    for original in originals or []:
        original = Path(original).resolve(strict=True)
        previous_plan, previous_masks = _verify_plan(original)
        if digest(previous_masks) != digest(masks):
            raise ValueError("Parcel source reuse requires identical original reporting acquisition masks")
        previous = _capture_records(original, previous_plan)
        for key, record in previous.items():
            if (key not in wanted or key in fresh_providers
                    or wanted[key]["url"] != record["uri"]
                    or source_where(wanted[key]) != source_where(record)
                    or (root/"layers"/key/"layer-capture.json").exists()):
                continue
            for item in record["files"]:
                _retain(verify_file(original/"layers", item), root/"layers"/item["path"])
            _retain(original/"layers"/key/"layer-capture.json",
                    root/"layers"/key/"layer-capture.json")
            print(json.dumps({"stage": "parcel-source-reused", "provider": key,
                              "source_sha256": record["sha256"], "original": str(original)}), flush=True)


def receive(output, *, plan_directory=None, plan_archive=None, archive_sha256=None,
            providers=None, retry_failed=False, reuse_capture=None, fresh_provider=None):
    """Network phase: complete county queries with only the Python standard library."""
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root/"capture.lock", blocking=False):
        if plan_archive:
            unpack(plan_archive, root, archive_sha256=archive_sha256)
        elif plan_directory:
            original = Path(plan_directory).resolve(strict=True)
            _verify_plan(original)
            transfer = read_json(original/"plan-transfer.json")
            for item in transfer["files"]:
                _retain(verify_file(original, item), root/item["path"])
            _retain(original/"plan-transfer.json", root/"plan-transfer.json")
        plan_value, masks = _verify_plan(root)
        requested = {row["provider"]["id"] for row in plan_value["counties"] if row.get("provider")}
        if providers:
            chosen = list(providers)
            if len(chosen) != len(set(chosen)) or set(chosen) - requested:
                raise ValueError("Select unique parcel providers present in this original reporting plan")
            requested = set(chosen)
        fresh = set(fresh_provider or [])
        if fresh - requested:
            raise ValueError("Fresh providers must be selected in this original reporting plan")
        if any((root/"layers"/key).exists() for key in fresh):
            raise ValueError("A fresh provider edition needs a new output directory; retain its earlier capture")
        _reuse_sources(root, plan_value, masks, reuse_capture, fresh)
        records = _capture_records(root, plan_value)
        previous = read_json(root/"capture-progress.json") if (root/"capture-progress.json").exists() else {}
        failures = {row["provider_id"]: row["exception"] for row in previous.get("counties", [])
                    if row.get("exception") and row.get("provider_id") not in records}
        result = _capture_manifest(root, plan_value, records, failures)
        for county in plan_value["counties"]:
            provider = county.get("provider")
            if not provider or provider["id"] not in requested:
                continue
            key = provider["id"]
            if key in records:
                continue
            print(json.dumps({"stage": "county-parcel-capture", "county": county["name"],
                              "provider": key, "uri": provider["url"],
                              "source_where": source_where(provider)}), flush=True)
            try:
                records[key] = capture_layer(root/"layers", key, _provider_spec(provider),
                                            masks, retry_failed=retry_failed)
                failures.pop(key, None)
            except Exception as error:
                failures[key] = {"type": type(error).__name__, "message": str(error),
                                 "recorded_at": now()}
            result = _capture_manifest(root, plan_value, records, failures)
        return result


def _bundle_paths(root):
    if (root/"parcel-plan.json").exists():
        _verify_plan(root)
    elif (root/"county-boundaries.json").exists():
        index = read_json(root/"county-boundaries.json")
        _verify_capture(root/"layers", index["source"])
    else:
        raise ValueError("Bundle an original county capture or reporting parcel plan/capture")
    return [path for path in sorted(root.rglob("*")) if path.is_file()
            and not any(part.startswith(".") for part in path.relative_to(root).parts)
            and not path.name.endswith(".lock")
            and path.name != "parcel-transfer.json"]


def bundle(directory, archive):
    """Transfer exact original plan/capture bytes without changing source files."""
    root, archive = Path(directory).resolve(strict=True), Path(archive).resolve()
    if archive == root or root in archive.parents:
        raise ValueError("Place the transfer archive outside its input directory")
    paths = _bundle_paths(root)
    records = [describe_file(root, path) for path in paths]
    manifest = {"schema": TRANSFER_SCHEMA, "kind": "directory",
                "files": records, "total_bytes": sum(item["bytes"] for item in records)}
    manifest_body = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=archive.parent, delete=False) as stream:
        pending = Path(stream.name)
    try:
        with zipfile.ZipFile(pending, "w", allowZip64=True) as zipped:
            for item in [*records, {"path": "parcel-transfer.json", "body": manifest_body}]:
                info = zipfile.ZipInfo(item["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = 0o100644 << 16
                if "body" in item:
                    zipped.writestr(info, item["body"])
                else:
                    with verify_file(root, item).open("rb") as source, zipped.open(info, "w", force_zip64=True) as out:
                        shutil.copyfileobj(source, out, 1024*1024)
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        _retain(pending, archive)
    finally:
        pending.unlink(missing_ok=True)
    result = {"path": str(archive), "bytes": archive.stat().st_size,
              "sha256": file_digest(archive), "source_files": len(records),
              "decoded_source_bytes": manifest["total_bytes"]}
    print(json.dumps({"stage": "parcel-transfer", **result}), flush=True)
    return result


def unpack(archive, output, *, archive_sha256=None):
    """Receive source-plan or native parcel bytes using stdlib and original hashes."""
    archive, root = Path(archive).resolve(strict=True), Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if archive_sha256 and file_digest(archive) != archive_sha256:
        raise ValueError("The received parcel archive differs from its transmitting source")
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        names = [item.filename for item in members]
        if len(names) != len(set(names)) or "parcel-transfer.json" not in names:
            raise ValueError("The parcel transfer needs unique files and its original manifest")
        for item in members:
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in item.filename
                    or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16)
                    or not path.parts or any(part.startswith(".") for part in path.parts)):
                raise ValueError("The parcel transfer contains an unsupported path")
        raw_manifest = zipped.read("parcel-transfer.json")
        transfer = json.loads(raw_manifest)
        if transfer.get("schema") != TRANSFER_SCHEMA or transfer.get("kind") != "directory":
            raise ValueError("Select the original parcel transfer manifest")
        records = transfer.get("files", [])
        by_path = {item["path"]: item for item in records}
        if len(by_path) != len(records) or set(names) != set(by_path) | {"parcel-transfer.json"}:
            raise ValueError("The original parcel archive and file manifest differ")
        if sum(item["bytes"] for item in records) != transfer.get("total_bytes"):
            raise ValueError("The original transfer byte total differs from its files")
        for name, item in by_path.items():
            if zipped.getinfo(name).file_size != item["bytes"]:
                raise ValueError("A received parcel member has another size")
            destination = root/name
            if destination.exists():
                verify_file(root, item)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
                pending = Path(stream.name)
                with zipped.open(name) as source:
                    shutil.copyfileobj(source, stream, 1024*1024)
                stream.flush(); os.fsync(stream.fileno())
            try:
                if pending.stat().st_size != item["bytes"] or file_digest(pending) != item["sha256"]:
                    raise ValueError("A received parcel member differs from its original hash")
                _retain(pending, destination)
            finally:
                pending.unlink(missing_ok=True)
    print(json.dumps({"stage": "parcel-received", "directory": str(root),
                      "files": len(records), "archive_sha256": file_digest(archive)}), flush=True)
    return root

def _polygonal(geometry):
    from shapely.geometry import MultiPolygon
    from shapely.ops import unary_union
    if geometry.is_empty:
        return MultiPolygon([])
    if geometry.geom_type == "Polygon":
        return MultiPolygon([geometry])
    if geometry.geom_type == "MultiPolygon":
        return geometry
    if geometry.geom_type == "GeometryCollection":
        parts = [_polygonal(part) for part in geometry.geoms]
        return _polygonal(unary_union([part for part in parts if not part.is_empty]))
    return MultiPolygon([])


def _classify(properties, provider):
    rule = provider.get("classification")
    if not rule:
        field = provider.get("native_classification_field")
        value = properties.get(field) if field else None
        return {"record_class": "parcel_source" if field else "parcel",
                "native_class": None if value is None else str(value),
                "native_class_field": field,
                "classification_basis": ("uninterpreted_native_code" if field
                                         else "published_parcel_layer"),
                "parcel_candidate": 1, "coverage_eligible": True}
    value = properties.get(rule["field"])
    code = None if value is None else str(value)
    parcel = {str(item) for item in rule["parcel_values"]}
    excluded = {str(key): val for key, val in rule.get("excluded_values", {}).items()}
    context = {str(key): val for key, val in rule.get("context_values", {}).items()}
    if code in parcel:
        status = "parcel"
    elif code in excluded:
        status = excluded[code]
    else:
        status = context.get(code, "unclassified_cadastral")
    return {"record_class": status, "native_class": code,
            "native_class_field": rule["field"],
            "classification_basis": "published_native_category",
            "parcel_candidate": int(code in parcel), "coverage_eligible": code not in excluded}


def _parcel_reference(properties, fields):
    for name in fields:
        value = properties.get(name)
        if value is not None and str(value).strip():
            return str(value), name
    return None, None


def _native_rows(root, plan_value, records, reporting_geometry, county_geometries):
    parcels, contexts, exclusions, corrections, source_rows = [], [], [], [], []
    seen = set()
    for county in plan_value["counties"]:
        provider = county.get("provider")
        if not provider or provider["id"] not in records:
            continue
        key, record = provider["id"], records[provider["id"]]
        original = root/"layers"/record["path"]
        rows, reader = polygon_rows(original, "EPSG:5070")
        edition = _edition(root, key)
        fields = {row["name"] for row in edition["native_fields"]}
        if not fields.intersection(provider["parcel_id_fields"]):
            raise ValueError("Provider " + key + " no longer publishes its retained parcel reference fields")
        native_county_field = provider.get("native_county_field")
        if native_county_field and native_county_field not in fields:
            raise ValueError("Provider " + key + " no longer publishes its native county field")
        classification = provider.get("classification")
        classification_field = (classification["field"] if classification
                                else provider.get("native_classification_field"))
        if classification_field and classification_field not in fields:
            raise ValueError("Provider " + key + " no longer publishes its native parcel classification")
        field_types = {field["name"]: field.get("type")
                       for field in edition["native_fields"]}
        source_rows.append({"county_fips": county["fips"], "county_name": county["name"],
            "provider_id": key, "source_uri": provider["url"],
            "source_sha256": record["sha256"], "native_id_field": record["id_field"],
            "captured_at": edition["captured_at"],
            "source_last_edit_date": edition["last_edit_date"],
            "source_data_last_edit_date": edition["data_last_edit_date"],
            "source_status": provider["provenance"],
            "definition_expression": edition["definition_expression"],
            "source_where": source_where(provider),
            "native_county_field": native_county_field,
            "native_county_value": provider.get("native_county_value"),
            "source_selected_features": record["feature_count"],
            "geometry_features": len(rows), "parcel_features": 0, "context_features": 0,
            "zero_area_or_outside_features": 0})
        corrections.extend({"source_id": key, **item} for item in reader.get("analysis_corrections", []))
        actual_ids = {row["id"] for row in rows}
        selection = read_json(root/"layers"/key/"selection.json")
        for oid in selection["object_ids"]:
            if str(oid) not in actual_ids:
                exclusions.append({"source_id": key, "native_oid": str(oid),
                                   "reason": "source_geometry_absent_or_no_polygon_after_recorded_repair"})
        for row in rows:
            native_oid = row["id"]
            if (native_county_field and row["properties"].get(native_county_field)
                    != provider["native_county_value"]):
                raise ValueError("Provider " + key + " returned native OID " + native_oid
                                 + " outside its exact county selection")
            identity = county["fips"] + ":" + key + ":" + native_oid
            if identity in seen:
                raise ValueError("A prepared parcel repeats its county/provider/native OID key")
            seen.add(identity)
            full = row["geometry"]
            part = _polygonal(full.intersection(reporting_geometry))
            if part.is_empty or part.area <= 0:
                exclusions.append({"source_id": key, "native_oid": native_oid,
                                   "reason": "no_positive_reporting_area"})
                source_rows[-1]["zero_area_or_outside_features"] += 1
                continue
            if not part.is_valid:
                raise ValueError("Parcel reporting intersection is invalid: " + identity)
            parcel_ref, parcel_field = _parcel_reference(row["properties"], provider["parcel_id_fields"])
            category = _classify(row["properties"], provider)
            revision_fields = [field for field in provider.get("source_date_fields", [])
                               if field in row["properties"]]
            revision_field = next((field for field in revision_fields
                                   if row["properties"][field] is not None),
                                  revision_fields[0] if revision_fields else None)
            revision_value = row["properties"].get(revision_field) if revision_field else None
            own = part.intersection(county_geometries[county["fips"]]).area/10000
            properties = {"parcel_id": identity, "county_fips": county["fips"],
                "county_name": county["name"], "source_id": key, "native_oid": native_oid,
                "native_id_field": record["id_field"], "parcel_ref": parcel_ref,
                "parcel_ref_field": parcel_field, "source_uri": provider["url"],
                "source_sha256": record["sha256"], "source_edition": edition["captured_at"],
                "source_status": provider["provenance"],
                "source_revision_field": revision_field,
                "source_revision_type": field_types.get(revision_field),
                "source_revision_value": (None if revision_value is None
                    else json.dumps(revision_value, ensure_ascii=False, separators=(",", ":"))),
                "whole_feature_area_ha": full.area/10000, "reporting_area_ha": part.area/10000,
                "source_county_area_ha": own, "outside_source_county_ha": max(0, part.area/10000-own),
                **{field: category[field] for field in (
                    "record_class", "native_class", "native_class_field",
                    "classification_basis", "parcel_candidate")}}
            # The parcel reducer measures original area and performs its own reporting clip.
            # Keep the complete analytical polygon; original native bodies remain companions.
            prepared = {"id": identity, "properties": properties, "geometry": full,
                        "coverage_eligible": category["coverage_eligible"]}
            if category["parcel_candidate"]:
                parcels.append(prepared)
                source_rows[-1]["parcel_features"] += 1
            else:
                contexts.append(prepared)
                source_rows[-1]["context_features"] += 1
        print(json.dumps({"stage": "county-parcel-geometry", **source_rows[-1]}), flush=True)
    return parcels, contexts, exclusions, corrections, source_rows


def _write_layer(path, layer, fields, rows):
    import fiona
    from pyproj import CRS
    from shapely.geometry import mapping
    with rasters.vector_environment(), fiona.open(path, "w", driver="GPKG",
            layer=layer, schema={"geometry": "MultiPolygon", "properties": fields},
            crs_wkt=CRS.from_epsg(5070).to_wkt(), SPATIAL_INDEX="YES") as destination:
        for row in rows:
            geometry = _polygonal(row["geometry"])
            if geometry.is_empty:
                continue
            destination.write({"geometry": mapping(geometry),
                "properties": {name: row["properties"].get(name) for name in fields}})


def _coverage(plan_value, parcels, contexts, county_rows, statuses, gap_writer):
    """Measure unique observed coverage in spatial tiles; preserve independent parcels."""
    from shapely import STRtree
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    candidates = [row for row in [*parcels, *contexts] if row["coverage_eligible"]]
    tree = STRtree([row["geometry"] for row in candidates]) if candidates else None
    summaries = []
    for county in county_rows:
        fips = county["properties"].get("county_fips")
        name = county["properties"].get("county_name")
        expected = county["geometry"]
        status_row = statuses.get(fips, {})
        status = status_row.get("status", "county_boundary_gap")
        counts, parcel_ids = set(), set()
        covered_area = parcel_area = own_area = overlap_area = 0.0
        tiles = _acquisition_masks([{"geometry": expected}], 0, plan_value["tile_m"])
        for mask in tiles:
            tile = Polygon(mask["geometry"]["rings"][0])
            part = _polygonal(expected.intersection(tile))
            if part.is_empty or part.area <= 0:
                continue
            indices = [] if tree is None else tree.query(part, predicate="intersects")
            fragments, parcel_fragments, own_fragments = [], [], []
            for index in indices:
                row = candidates[int(index)]
                fragment = _polygonal(row["geometry"].intersection(part))
                if fragment.is_empty or fragment.area <= 0:
                    continue
                fragments.append(fragment)
                counts.add(row["id"])
                if row["properties"]["parcel_candidate"]:
                    parcel_fragments.append(fragment)
                    parcel_ids.add(row["id"])
                if row["properties"]["county_fips"] == fips:
                    own_fragments.append(fragment)
            union = unary_union(fragments)
            covered_area += union.area
            parcel_area += unary_union(parcel_fragments).area
            own_area += unary_union(own_fragments).area
            overlap_area += max(0, sum(fragment.area for fragment in fragments) - union.area)
            gap = _polygonal(part.difference(union))
            if not gap.is_empty and gap.area > 0:
                gap_class = ("no_received_county_geometry" if status == "county_boundary_gap"
                    else "no_published_cadastral_polygon" if status == "complete"
                    else "provider_capture_pending")
                gap_writer({"geometry": gap, "properties": {
                    "county_fips": fips, "tile_id": mask["id"],
                    "capture_status": status, "gap_class": gap_class, "area_ha": gap.area/10000}})
        expected_ha = expected.area/10000
        properties = {"county_fips": fips, "county_name": name,
            "provider_id": status_row.get("provider_id"), "capture_status": status,
            "expected_ha": expected_ha, "covered_ha": covered_area/10000,
            "uncovered_ha": max(0, expected_ha-covered_area/10000),
            "coverage_fraction": covered_area/expected.area if expected.area else None,
            "overlap_excess_ha": overlap_area/10000,
            "source_own_coverage_ha": own_area/10000 if status == "complete" else None,
            "parcel_coverage_ha": parcel_area/10000,
            "parcel_count": len(parcel_ids), "cadastral_record_count": len(counts)}
        summaries.append({"geometry": expected, "properties": properties})
        print(json.dumps({"stage": "county-parcel-coverage", **properties}), flush=True)
    return summaries


def prepare(capture_directory):
    """GIS phase: publish the PARCEL inventory and full county coverage into the importer."""
    import fiona
    from pyproj import CRS
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    root = Path(capture_directory).resolve(strict=True)
    with held(root/"prepare.lock", blocking=False):
        plan_value, _ = _verify_plan(root)
        records = _capture_records(root, plan_value)
        if not records:
            raise ValueError("At least one original county parcel capture is required for preparation")
        state_path = root/"capture-progress.json"
        previous = read_json(state_path) if state_path.exists() else {}
        failures = {row["provider_id"]: row["exception"] for row in previous.get("counties", [])
                    if row.get("exception") and row.get("provider_id") not in records}
        progress = _capture_manifest(root, plan_value, records, failures)
        fingerprint = digest({"preparation_method": PREPARATION_METHOD,
                              "preparation_revision": "20261013-native-parcel-attributes-v1",
                              "plan_sha256": digest(plan_value),
                              "sources": {key: record["sha256"] for key, record in sorted(records.items())},
                              "classification": {county["fips"]: county.get("provider", {}).get("classification")
                                  if county.get("provider") else None for county in plan_value["counties"]}})
        destination = root/("inventory-" + fingerprint[:20])
        inventory_path = destination/"inventory.json"
        if inventory_path.exists():
            result = read_json(inventory_path)
            for item in result["files"].values():
                verify_file(root, item)
            manifest = read_json(root/result["source_manifest"])
            atomic_json(root/"parcel-sources.json", manifest)
            print(json.dumps({"stage": "parcel-inventory", "reused": True,
                              "inventory": str(inventory_path), "parcel_count": result["parcel_count"]}), flush=True)
            return result
        reporting_rows, _ = rasters.vector_geometry(root/"reporting.geojson", target_crs="EPSG:5070")
        reporting = rasters.polygon_union(reporting_rows)
        counties, _ = rasters.vector_geometry(root/"county-reporting.geojson", target_crs="EPSG:5070")
        by_county = {row["properties"]["county_fips"]: row["geometry"] for row in counties}
        parcels, contexts, excluded, corrections, source_rows = _native_rows(
            root, plan_value, records, reporting, by_county)
        partition = unary_union([row["geometry"] for row in counties])
        uncovered_counties = _polygonal(reporting.difference(partition))
        if not uncovered_counties.is_empty and uncovered_counties.area > 0:
            counties.append({"geometry": uncovered_counties,
                "properties": {"county_fips": None, "county_name": "Outside retained county geometry"}})
        statuses = {row["fips"]: row for row in progress["counties"]}
        with tempfile.TemporaryDirectory(prefix=".parcel-inventory-", dir=root) as temporary:
            staging = Path(temporary)/"inventory"
            staging.mkdir()
            atomic_json(staging/"preparation-context.json",
                {"source_fingerprint": fingerprint, "plan_sha256": digest(plan_value),
                 "preparation_method": PREPARATION_METHOD}, immutable=True)
            gpkg = staging/"reporting-parcels.gpkg"
            _write_layer(gpkg, "parcels_reporting", PARCEL_FIELDS, parcels)
            _write_layer(gpkg, "cadastral_context", PARCEL_FIELDS, contexts)
            with rasters.vector_environment(), fiona.open(gpkg, "w", driver="GPKG",
                    layer="parcel_coverage_gaps",
                    schema={"geometry": "MultiPolygon", "properties": GAP_FIELDS},
                    crs_wkt=CRS.from_epsg(5070).to_wkt(), SPATIAL_INDEX="YES") as gap_output:
                def write_gap(row):
                    gap_output.write({"geometry": mapping(row["geometry"]),
                                      "properties": row["properties"]})
                summaries = _coverage(plan_value, parcels, contexts, counties, statuses, write_gap)
            _write_layer(gpkg, "county_reporting", COVERAGE_FIELDS, summaries)
            _csv(staging/"parcels.csv", PARCEL_FIELDS, (row["properties"] for row in parcels))
            _csv(staging/"cadastral-context.csv", PARCEL_FIELDS, (row["properties"] for row in contexts))
            _csv(staging/"county-coverage.csv", COVERAGE_FIELDS, (row["properties"] for row in summaries))
            source_fields = ("county_fips", "county_name", "provider_id", "source_uri", "source_sha256",
                "native_id_field", "captured_at", "source_last_edit_date", "source_data_last_edit_date",
                "source_status", "definition_expression", "source_where", "native_county_field",
                "native_county_value", "source_selected_features", "geometry_features",
                "parcel_features", "context_features", "zero_area_or_outside_features")
            _csv(staging/"county-sources.csv", source_fields, source_rows)
            _csv(staging/"excluded-records.csv", ("source_id", "native_oid", "reason"), excluded)
            atomic_json(staging/"geometry-corrections.json",
                {"schema": SCHEMA, "corrections": corrections}, immutable=True)
            methods = {"schema": SCHEMA, "analysis_crs": "EPSG:5070", "area_units": "hectares",
                "preparation_method": PREPARATION_METHOD,
                "native_feature_identity": "county FIPS : provider ID : native OID",
                "source_identity": "Original URI, response dates, native OID and retained feature SHA256",
                "parcel_geometry": "Whole source polygons in the analysis CRS, selected by positive reporting intersection; native bodies retained",
                "reporting_geometry": "Reporting-area intersections are measured separately; the parcel reducer clips whole geometry itself",
                "parcel_candidate": "Published parcel layer; provider classification rules retained in the catalog",
                "coverage": "Unique union of available cadastral polygons, including known road/water context",
                "parcel_coverage": "Unique union of parcel candidates only",
                "excluded_source_categories": "Catalog excluded_values, including provider outside-county polygons",
                "overlap": "Independent source records retained; summed area minus unique union reported separately",
                "uncovered": "No available cadastral geometry; provider capture status distinguishes pending source",
                "county_partition": "Original reporting polygon intersected with original received county geometries",
                "raster_alignment": "No raster resampling or model-grid changes; parcel preparation is vector-only"}
            atomic_json(staging/"methods.json", methods, immutable=True)
            if destination.exists():
                context_path = destination/"preparation-context.json"
                if (not context_path.exists()
                        or read_json(context_path).get("source_fingerprint") != fingerprint):
                    raise ValueError("Another output already owns this parcel inventory directory")
                with tempfile.TemporaryDirectory(prefix=".parcel-recovery-", dir=root) as recovery:
                    retained = root/(Path(recovery).name + "-retained")
                    os.rename(destination, retained)
            os.rename(staging, destination)
        file_paths = {"gpkg": destination/"reporting-parcels.gpkg",
                      "parcel_csv": destination/"parcels.csv",
                      "context_csv": destination/"cadastral-context.csv",
                      "county_coverage_csv": destination/"county-coverage.csv",
                      "county_sources_csv": destination/"county-sources.csv",
                      "excluded_records_csv": destination/"excluded-records.csv",
                      "geometry_corrections": destination/"geometry-corrections.json",
                      "methods": destination/"methods.json",
                      "preparation_context": destination/"preparation-context.json"}
        files = {key: describe_file(root, path) for key, path in file_paths.items()}
        companions = [value for key, value in files.items() if key != "gpkg"]
        native_manifest = read_json(root/"native-sources.json")
        native_companions = [describe_file(root, root/progress["manifest"])]
        for entry in native_manifest["entries"]:
            native_companions.append({field: entry[field] for field in ("path", "sha256", "bytes")})
            native_companions.extend(entry.get("companions", []))
        by_path = {item["path"]: item for item in [*companions, *native_companions]}
        prepared = {"id": "sc-reporting-parcels-" + fingerprint[:20],
            "title": "Upper Savannah full reporting parcel inventory", "kind": "vector",
            "role": "PARCEL", "layer": "parcels_reporting", "id_field": "parcel_id",
            "uri": "urn:sha256:" + fingerprint,
            "vintage": "Original county editions in county-sources.csv",
            **files["gpkg"], "companions": list(by_path.values()),
            "metadata": {"analysis_crs": "EPSG:5070", "area_units": "hectares",
                         "preparation_method": PREPARATION_METHOD,
                         "geometry_scope": "whole_source_polygons",
                         "capture_state": progress["state"], "parcel_count": len(parcels),
                         "cadastral_context_count": len(contexts), "plan_sha256": digest(plan_value),
                         "input_sources": source_rows,
                         "county_coverage": [row["properties"] for row in summaries]}}
        context_entry = {"id": "sc-reporting-cadastral-context-" + fingerprint[:20],
            "title": "Native cadastral road, water and unclassified context",
            "kind": "vector", "role": "PARCEL_CONTEXT", "layer": "cadastral_context",
            "id_field": "parcel_id", "uri": "urn:sha256:" + fingerprint,
            "vintage": prepared["vintage"], **files["gpkg"]}
        coverage_entry = {"id": "sc-reporting-parcel-coverage-" + fingerprint[:20],
            "title": "County coverage of acquired parcel and cadastral sources",
            "kind": "vector", "role": "PARCEL_COVERAGE", "layer": "county_reporting",
            "uri": "urn:sha256:" + fingerprint, "vintage": prepared["vintage"], **files["gpkg"]}
        gaps_entry = {"id": "sc-reporting-parcel-gaps-" + fingerprint[:20],
            "title": "Available parcel source coverage gaps",
            "kind": "vector", "role": "PARCEL_COVERAGE_GAPS", "layer": "parcel_coverage_gaps",
            "uri": "urn:sha256:" + fingerprint, "vintage": prepared["vintage"], **files["gpkg"]}
        manifest = {"schema": "upstate.sources/v1", "title": prepared["title"],
                    "entries": [prepared, context_entry, coverage_entry, gaps_entry],
                    "scope": {"planning_shapefile_sha256": PLANNING_SHA,
                              "capture_plan_sha256": digest(plan_value),
                              "reporting_area_ha": plan_value["reporting_area_ha"],
                              "capture_state": progress["state"]}}
        manifest_name = "parcel-sources-" + fingerprint[:20] + ".json"
        atomic_json(root/manifest_name, manifest, immutable=True)
        result = {"schema": SCHEMA, "kind": "reporting-parcel-inventory",
            "preparation_method": PREPARATION_METHOD,
            "source_fingerprint": fingerprint, "plan_sha256": digest(plan_value),
            "capture_state": progress["state"], "parcel_count": len(parcels),
            "cadastral_context_count": len(contexts), "excluded_record_count": len(excluded),
            "source_manifest": manifest_name, "files": files,
            "county_coverage": [row["properties"] for row in summaries],
            "model_binding": {"source_id": prepared["id"], "role": "PARCEL",
                              "layer": "parcels_reporting", "id_field": "parcel_id"}}
        atomic_json(inventory_path, result, immutable=True)
        atomic_json(root/"parcel-sources.json", manifest)
        atomic_json(root/"parcel-inventory.json", result)
        print(json.dumps({"stage": "parcel-inventory", "inventory": str(inventory_path),
                          "manifest": str(root/"parcel-sources.json"), **result}), flush=True)
        return result



def bind(workspace, capture_directory, output, *, create_workspace=False):
    """Import the prepared native inventory and write the existing parcel selection."""
    from model.workspace import Workspace
    root = Path(capture_directory).resolve(strict=True)
    manifest_path = root/"parcel-sources.json"
    original = read_json(manifest_path)
    candidates = [entry for entry in original.get("entries", [])
                  if entry.get("role") == "PARCEL"]
    if original.get("schema") != "upstate.sources/v1" or len(candidates) != 1:
        raise ValueError("Select the prepared reporting parcel manifest with one PARCEL entry")
    expected = candidates[0]
    if (expected.get("kind") != "vector" or expected.get("layer") != "parcels_reporting"
            or expected.get("id_field") != "parcel_id"):
        raise ValueError("Use the original prepared parcel layer and qualified native record key")
    selected_workspace = Workspace(workspace, create=create_workspace)
    target = Path(output).resolve()
    selection = None
    if target.is_file():
        previous = read_json(target)
        if (previous.get("source_id") == expected["id"]
                and previous.get("layer") == "parcels_reporting"
                and previous.get("id_field") == "parcel_id"
                and previous.get("source_collection_id")):
            try:
                _, retained = selected_workspace.source_file(
                    previous["source_collection_id"], previous["source_id"])
            except FileNotFoundError:
                pass
            else:
                if retained["body"]["sha256"] != expected["sha256"]:
                    raise ValueError("The retained parcel binding has another original source body")
                selection = previous
    if selection is None:
        collection = selected_workspace.import_sources(manifest_path)
        returned = [entry for entry in collection["entries"] if entry["id"] == expected["id"]]
        if len(returned) != 1:
            raise ValueError("The imported parcel source did not retain its original source ID")
        entry = returned[0]
        selection = {"source_collection_id": collection["id"], "source_id": entry["id"],
                     "layer": entry["layer"], "id_field": entry["id_field"]}
        # Resolve the exact retained body through the API used by priorities.
        selected_workspace.source_file(selection["source_collection_id"], selection["source_id"])
    atomic_json(target, selection)
    result = {"stage": "reporting-parcel-binding", "selection": selection,
              "selection_path": str(target), "source_manifest": str(manifest_path),
              "capture_state": expected.get("metadata", {}).get("capture_state"),
              "parcel_count": expected.get("metadata", {}).get("parcel_count"),
              "consumer": "model.priorities.parcel_inventory"}
    print(json.dumps(result), flush=True)
    return result



def run(workspace, output, *, catalog=DEFAULT_CATALOG, tile_m=25000,
        retry_failed=False, create_workspace=False):
    """Run original county acquisition through the existing parcel analysis binding."""
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    value = _catalog(catalog)
    catalog_path = Path(catalog).resolve(strict=True)
    with held(root/"reporting-parcel-run.lock", blocking=False):
        county_root = root/("counties-" + digest(value["county_boundary"])[:20])
        retained_catalog = county_root/"provider-catalog.json"
        # County geometry is shared across provider revisions of the same source.
        # Its original capture catalog remains immutable.
        boundary_catalog = retained_catalog if retained_catalog.exists() else catalog_path
        county_result = boundaries(county_root, catalog=boundary_catalog,
                                   retry_failed=retry_failed)
        plan_key = digest({"reporting_sha256": PLANNING_SHA,
                           "county_source_sha256": county_result["source"]["sha256"],
                           "catalog_sha256": digest(value), "tile_m": float(tile_m)})
        plan_root = root/"plans"/plan_key[:20]
        if (plan_root/"plan-transfer.json").exists():
            _verify_plan(plan_root)
        else:
            plan(reporting=county_root/"original-reporting"/"PlanningBasins2023.shp",
                 county_capture=county_root, output=plan_root,
                 catalog=catalog_path, tile_m=tile_m)
        capture_root = root/"captures"/plan_key[:20]
        mask_signature = digest(read_json(plan_root/"parcel-masks.json"))
        earlier = [path for path in sorted((root/"captures").glob("*"))
                   if path.is_dir() and path != capture_root
                   and (path/"plan-transfer.json").exists()
                   and digest(read_json(path/"parcel-masks.json")) == mask_signature]
        progress = receive(capture_root, plan_directory=plan_root,
                           retry_failed=retry_failed, reuse_capture=earlier)
        inventory = prepare(capture_root)
        binding = bind(workspace, capture_root, root/"parcel-selection.json",
                       create_workspace=create_workspace)
        result = {"schema": SCHEMA, "kind": "reporting-parcel-operation",
                  "state": progress["state"], "county_source_root": str(county_root),
                  "plan_root": str(plan_root), "capture_root": str(capture_root),
                  "source_manifest": str(capture_root/"parcel-sources.json"),
                  "inventory": str(capture_root/"parcel-inventory.json"),
                  "parcel_count": inventory["parcel_count"],
                  "county_coverage": inventory["county_coverage"],
                  "selection": binding["selection"],
                  "selection_path": binding["selection_path"]}
        atomic_json(root/"reporting-parcel-run.json", result)
        print(json.dumps({"stage": "reporting-parcel-operation", **result}), flush=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("run", help="Acquire, prepare and import the full reporting parcel inventory")
    p.add_argument("--workspace", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    p.add_argument("--tile-m", type=float, default=25000)
    p.add_argument("--retry-failed", action="store_true")
    p.add_argument("--create-workspace", action="store_true")
    p = commands.add_parser("boundaries", help="Stdlib native statewide county acquisition")
    p.add_argument("--output", required=True)
    p.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    p.add_argument("--retry-failed", action="store_true")
    p.add_argument("--archive")
    p = commands.add_parser("plan", help="GIS original reporting county selection")
    p.add_argument("--reporting", required=True)
    p.add_argument("--county-capture", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--catalog")
    p.add_argument("--tile-m", type=float, default=25000)
    p.add_argument("--archive")
    p = commands.add_parser("receive", help="Stdlib source-bound native parcel capture")
    p.add_argument("--output", required=True)
    group = p.add_mutually_exclusive_group()
    group.add_argument("--plan-directory")
    group.add_argument("--plan-archive")
    p.add_argument("--archive-sha256")
    p.add_argument("--provider", action="append", dest="providers")
    p.add_argument("--retry-failed", action="store_true")
    p.add_argument("--reuse-capture", action="append")
    p.add_argument("--fresh-provider", action="append")
    p = commands.add_parser("prepare", help="GIS parcel inventory and county coverage")
    p.add_argument("--capture-directory", required=True)
    p = commands.add_parser("bind", help="Import prepared parcels and write the existing analysis selection")
    p.add_argument("--workspace", required=True)
    p.add_argument("--capture-directory", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--create-workspace", action="store_true")
    p = commands.add_parser("bundle", help="Transfer complete plan/capture source files")
    p.add_argument("--directory", required=True)
    p.add_argument("--archive", required=True)
    p = commands.add_parser("unpack", help="Receive exact source files with stdlib")
    p.add_argument("--archive", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--archive-sha256")
    args = vars(parser.parse_args(argv))
    command = args.pop("command")
    if command == "run":
        result = run(**args)
        return 0 if result["state"] == "complete" else 2
    elif command == "boundaries":
        result = boundaries(**args)
    elif command == "plan":
        result = plan(**args)
    elif command == "receive":
        result = receive(**args)
        return 0 if result["state"] == "complete" else 2
    elif command == "prepare":
        result = prepare(**args)
    elif command == "bind":
        result = bind(**args)
    elif command == "bundle":
        result = bundle(**args)
    else:
        result = unpack(**args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
