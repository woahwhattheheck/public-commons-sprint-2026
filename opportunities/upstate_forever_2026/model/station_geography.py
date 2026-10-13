"""Exact original-station geography and portable observation-location editions.

Geography is an additive workspace layer. Native observation values, qualifiers,
units, dates and methods are retained unchanged; no mass-rate inference is made.
"""
from __future__ import annotations
import argparse
import csv
import gzip
import html
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, identifier, now, read_json, relative_file,
                     verify_file)

from .station_assessment_context import enrich as enrich_assessments, geojson as assessment_geojson, report_section as assessment_report

VERSION = "1.2.2"
KIND = "station-geographies"
RESULT_SCHEMA = "upstate.station-geography-result/v1"
PACKAGE_SCHEMA = "upstate.station-geography-package/v1"
LOCATED = frozenset(("located", "coincident", "selected"))


def _text(value):
    return "" if value is None else str(value).strip()


def _station_key(value):
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ValueError("Station IDs must be original strings or integer source IDs")
    return _text(value)


def _safe_member(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Use an ordinary relative package member")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or str(path) != value or ":" in path.parts[0]
            or any(part in (".", "..") for part in path.parts)):
        raise ValueError("Package member leaves its retained source scope")
    return path


def _number(value):
    if isinstance(value, bool):
        raise ValueError("Coordinate must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Coordinate must be a finite number")
    return result


def _crs(value):
    from pyproj import CRS
    if isinstance(value, dict):
        if value.get("wkt"):
            value = value["wkt"]
        elif value.get("latestWkid") or value.get("wkid"):
            value = "EPSG:" + str(value.get("latestWkid") or value["wkid"])
        elif value.get("properties", {}).get("name"):
            value = value["properties"]["name"]
    if not value:
        raise ValueError("An original coordinate reference is required")
    return CRS.from_user_input(value)


def _source(workspace, reference):
    if not isinstance(reference, dict):
        raise ValueError("Select an exact retained source reference")
    collection = identifier(reference.get("collection_id"))
    source_id = reference.get("source_id")
    path, entry = workspace.source_file(collection, source_id)
    expected = reference.get("source_sha256") or reference.get("sha256")
    if expected and entry["body"]["sha256"] != expected:
        raise ValueError("The original source hash differs from the selected source")
    binding = {
        "collection_id": collection, "source_id": source_id,
        "source_sha256": entry["body"]["sha256"],
        "title": entry.get("title"), "uri": entry.get("uri"),
        "source_metadata": {k: v for k, v in entry.items() if k not in ("body", "companions")},
        "body": entry["body"], "companions": entry.get("companions", []),
    }
    return path, entry, binding


def _json_body(path):
    body = Path(path).read_bytes()
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    def reject(token):
        raise ValueError("Original JSON contains a nonfinite number: " + token)
    return json.loads(body.decode("utf-8-sig"), parse_constant=reject)


def _features(path, entry, reference, *, points):
    """Read original geometry with its native CRS and native identifier type."""
    options = {**entry, **reference}
    suffix = Path(path).suffix.lower()
    json_source = suffix in (".json", ".geojson", ".gz") or "json" in str(options.get("format", "")).lower()
    if points and (suffix == ".csv" or options.get("format") == "csv"):
        x_field, y_field = options.get("x_field"), options.get("y_field")
        if not x_field or not y_field:
            raise ValueError("Original point CSV needs explicit x_field and y_field")
        crs = _crs(options.get("source_crs") or options.get("crs"))
        with open(path, encoding="utf-8-sig", newline="") as stream:
            table = csv.DictReader(stream)
            if not table.fieldnames or len(table.fieldnames) != len(set(table.fieldnames)):
                raise ValueError("Original point CSV needs distinct native headers")
            if {x_field, y_field} - set(table.fieldnames):
                raise ValueError("Selected original coordinate fields are absent")
            records = []
            for index, attributes in enumerate(table):
                if None in attributes:
                    raise ValueError("Original point CSV has an extra cell")
                records.append({"properties": dict(attributes), "source_feature_index": index,
                    "native_feature_id": attributes.get(options.get("native_id_field", "")),
                    "native_geometry": {"type": "Point", "coordinates": [attributes[x_field], attributes[y_field]]},
                    "geometry": {"type": "Point", "coordinates": [attributes[x_field], attributes[y_field]]}})
        return crs, records
    if json_source:
        body = _json_body(path)
        if not isinstance(body, dict) or not isinstance(body.get("features"), list):
            raise ValueError("Choose an original feature collection")
        esri = "geometryType" in body or any("attributes" in row for row in body["features"])
        if esri and not points:
            from .spatial_esri import OriginalEsriFeatures
            original = OriginalEsriFeatures(path, entry)
            try:
                crs = _crs(original.crs_wkt or original.crs)
                declared = options.get("source_crs") or options.get("crs")
                if declared and _crs(declared) != crs:
                    raise ValueError("The watershed selection and original Esri body declare different coordinate systems")
                native_id_field = options.get("native_id_field") or body.get("objectIdFieldName") or body.get("objectIdField") or original.reader_metadata.get("source_object_id_field")
                rows = []
                for feature in original:
                    props = dict(feature.properties)
                    rows.append({"properties": props,
                        "source_feature_index": feature.source_feature_index,
                        "native_feature_id": props.get(native_id_field) if native_id_field else None,
                        "native_geometry": feature.source_geometry,
                        "geometry": feature.native_geometry.__geo_interface__ if feature.native_geometry is not None else None,
                        "geometry_operations": list(feature.geometry_operations or [])})
                return crs, rows
            finally:
                if hasattr(original, "close"):
                    original.close()
        declared = options.get("source_crs") or options.get("crs")
        native_definition = body.get("spatialReference") if esri else body.get("crs")
        if esri and not native_definition:
            native_definition = next((f.get("geometry", {}).get("spatialReference") for f in body["features"]
                                      if isinstance(f.get("geometry"), dict) and f["geometry"].get("spatialReference")), None)
        if esri and not native_definition:
            raise ValueError("Retain the original station source coordinate reference")
        crs = _crs(native_definition or declared or "EPSG:4326")
        if native_definition and declared and _crs(declared) != crs:
            raise ValueError("The station source body and manifest declare different coordinate systems")
        native_id_field = options.get("native_id_field") or body.get("objectIdFieldName") or body.get("objectIdField")
        if not native_id_field:
            oid_fields = [f["name"] for f in body.get("fields", []) if f.get("type") == "esriFieldTypeOID"]
            native_id_field = oid_fields[0] if len(oid_fields) == 1 else None
        rows = []
        for index, feature in enumerate(body["features"]):
            props = dict(feature.get("attributes" if esri else "properties") or {})
            native = feature.get("geometry")
            if esri and isinstance(native, dict) and native.get("spatialReference") and _crs(native["spatialReference"]) != crs:
                raise ValueError("An original station feature declares a different coordinate reference")
            geometry = native
            if esri:
                geometry = {"type": "Point", "coordinates": [native.get("x"), native.get("y")]} if isinstance(native, dict) and "x" in native else None
            feature_id = props.get(native_id_field) if native_id_field else feature.get("id")
            rows.append({"properties": props, "source_feature_index": index,
                         "native_feature_id": feature_id, "native_geometry": native, "geometry": geometry})
        return crs, rows
    import fiona
    with fiona.open(path, layer=options.get("layer")) as original:
        declared = options.get("source_crs") or options.get("crs")
        native = original.crs_wkt or original.crs
        crs = _crs(native or declared)
        if native and declared and _crs(declared) != crs:
            raise ValueError("The source selection and native vector source declare different coordinate systems")
        rows = []
        for index, feature in enumerate(original):
            props = dict(feature.properties)
            geometry = feature.geometry.__geo_interface__ if feature.geometry is not None else None
            rows.append({"properties": props, "source_feature_index": index,
                "native_feature_id": props.get(options["native_id_field"]) if options.get("native_id_field") else feature.id,
                "reader_feature_id": feature.id, "native_geometry": geometry, "geometry": geometry})
        return crs, rows


def _locations(workspace, references):
    from pyproj import Transformer
    from pyproj.exceptions import ProjError
    inventory, bindings, by_id = [], [], {}
    for reference in references:
        path, entry, binding = _source(workspace, reference)
        crs, originals = _features(path, entry, reference, points=True)
        field = reference.get("station_id_field") or entry.get("station_id_field")
        if not field:
            raise ValueError("Select the exact native station_id_field for " + entry["id"])
        transform = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        bindings.append(binding)
        for original in originals:
            props = original["properties"]
            native_station = props.get(field)
            source_ref = {"collection_id": binding["collection_id"], "source_id": binding["source_id"],
                "source_sha256": binding["source_sha256"], "native_feature_id": original["native_feature_id"],
                "source_feature_index": original["source_feature_index"], "station_id_field": field,
                "native_id_field": reference.get("native_id_field") or entry.get("native_id_field"),
                "uri": entry.get("uri")}
            candidate = {"candidate_id": digest(source_ref), "source_ref": source_ref,
                "native_station_id": native_station, "native_crs": crs.to_string(),
                "native_crs_wkt": crs.to_wkt(), "native_geometry": original["native_geometry"],
                "native_coordinates": None, "coordinates_wgs84": None,
                "properties": props, "issues": []}
            try:
                candidate["station_key"] = _station_key(native_station)
                if not candidate["station_key"]:
                    raise ValueError("Original station identifier is empty")
            except ValueError as problem:
                candidate["station_key"] = ""
                candidate["issues"].append(str(problem))
            try:
                geometry = original["geometry"]
                if not isinstance(geometry, dict) or geometry.get("type") != "Point":
                    raise ValueError("Original station feature is not a point")
                coordinates = list(geometry.get("coordinates") or [])
                if len(coordinates) < 2:
                    raise ValueError("Original station point has no coordinate pair")
                x, y = _number(coordinates[0]), _number(coordinates[1])
                candidate["native_coordinates"] = coordinates
                lon, lat = transform.transform(x, y, errcheck=True)
                lon, lat = _number(lon), _number(lat)
                if not -180 <= lon <= 180 or not -90 <= lat <= 90:
                    raise ValueError("Original coordinate transforms outside WGS84 limits")
                candidate["coordinates_wgs84"] = [lon, lat]
            except (ValueError, TypeError, KeyError, ProjError) as problem:
                candidate["issues"].append(str(problem))
            inventory.append(candidate)
            if candidate["station_key"]:
                by_id.setdefault(candidate["station_key"], []).append(candidate)
    return inventory, bindings, by_id


def _observation_rows(workspace, selection):
    rows, originals, table_bindings = [], [], []
    for observation_id in selection.get("observation_ids", []):
        record = workspace._get("observations", identifier(observation_id))
        originals.append(record)
        for row in record["rows"]:
            rows.append({"observation_id": observation_id, "record_id": row.get("id"),
                "station_id_original": row.get("station_id"), "row_number": row.get("line"),
                "source_ref": {"observation_id": observation_id, "record_id": row.get("id"),
                    "source_sha256": record["original"]["sha256"], "source_uri": record["metadata"].get("source_uri")},
                "measurement": row, "original": row.get("original", {})})
    for reference in selection.get("observation_tables", []):
        path, entry, binding = _source(workspace, reference)
        station_field = reference.get("station_id_field") or entry.get("station_id_field")
        record_field = reference.get("record_id_field") or entry.get("record_id_field")
        if not station_field:
            raise ValueError("Select the exact station_id_field in the original observation table")
        table_bindings.append(binding)
        with open(path, encoding="utf-8-sig", newline="") as stream:
            table = csv.DictReader(stream)
            if not table.fieldnames or len(table.fieldnames) != len(set(table.fieldnames)) or station_field not in table.fieldnames:
                raise ValueError("Original observation table needs distinct headers and its native station field")
            if record_field and record_field not in table.fieldnames:
                raise ValueError("Original observation record_id_field is absent")
            for number, original in enumerate(table, 2):
                if None in original:
                    raise ValueError("Original observation CSV row has an extra cell")
                record_id = original.get(record_field) if record_field else None
                rows.append({"observation_id": None, "record_id": record_id,
                    "station_id_original": original.get(station_field), "row_number": number,
                    "source_ref": {"collection_id": binding["collection_id"], "source_id": entry["id"],
                        "source_sha256": binding["source_sha256"], "source_uri": entry.get("uri"),
                        "record_id": record_id, "row_number": number},
                    "measurement": dict(original), "original": dict(original)})
    return rows, originals, table_bindings


def _sites(selection, observation_rows, by_id):
    explicit = selection.get("sites") or []
    if not isinstance(explicit, list):
        raise ValueError("Select study stations as a list of exact station IDs")
    sites = {}
    for supplied in explicit:
        row = {"station_id": supplied} if isinstance(supplied, (str, int)) else dict(supplied)
        station = _station_key(row.get("station_id"))
        if not station or station in sites:
            raise ValueError("Study station IDs must be nonempty and unique")
        sites[station] = {**row, "station_id": station}
    aliases = selection.get("aliases") or {}
    if not isinstance(aliases, dict):
        raise ValueError("Exact station aliases must be an object keyed by study station ID")
    reverse = {}
    for station, values in aliases.items():
        station = _station_key(station)
        if not isinstance(values, list):
            raise ValueError("Each station alias selection must be a list")
        for alias in values:
            reverse.setdefault(_station_key(alias), set()).add(station)
    if not explicit:
        for row in observation_rows:
            key = _text(row.get("station_id_original"))
            if not key:
                continue
            matches = reverse.get(key, {key})
            for station in sorted(matches):
                sites.setdefault(station, {"station_id": station})
        if selection.get("include_all_source_stations") is True and not sites:
            sites = {key: {"station_id": key} for key in sorted(by_id)}
    if not sites:
        raise ValueError("Select the exact study sites or retain an observation edition or table")
    for station, row in sites.items():
        values = [station, *list(row.get("aliases") or []), *list(aliases.get(station) or [])]
        row["aliases"] = list(dict.fromkeys(_station_key(value) for value in values if _text(value)))
    source_to_sites = {}
    for station, row in sites.items():
        for alias in row["aliases"]:
            source_to_sites.setdefault(alias, []).append(station)
    links, unassigned = [], []
    for original in observation_rows:
        key = _text(original.get("station_id_original"))
        matches = source_to_sites.get(key, [])
        if len(matches) == 1:
            links.append({**original, "station_id": matches[0]})
        else:
            unassigned.append({**original, "station_id": None, "candidate_study_ids": matches,
                "reason": "missing_station_id" if not key else "ambiguous_exact_alias" if matches else "outside_study_selection"})
    return sites, links, unassigned


def _watersheds(workspace, references):
    from pyproj import Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    try:
        from shapely import STRtree
    except ImportError:
        from shapely.strtree import STRtree
    groups, bindings, features = [], [], []
    for reference in references:
        path, entry, binding = _source(workspace, reference)
        crs, originals = _features(path, entry, reference, points=False)
        field = reference.get("id_field") or entry.get("id_field")
        if not field:
            raise ValueError("Choose the exact original watershed id_field")
        to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        from_wgs = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        shapes, records = [], []
        for original in originals:
            props, geometry = original["properties"], original["geometry"]
            native_id = props.get(field)
            if native_id is None or _text(native_id) == "":
                raise ValueError("An original retained watershed has no selected identifier")
            polygon = shape(geometry)
            if polygon.is_empty or polygon.geom_type not in ("Polygon", "MultiPolygon") or not polygon.is_valid:
                raise ValueError("Use the retained valid watershed polygon geometry for " + _text(native_id))
            ref = {"collection_id": binding["collection_id"], "source_id": binding["source_id"],
                "source_sha256": binding["source_sha256"], "native_feature_id": original["native_feature_id"],
                "source_feature_index": original["source_feature_index"], "id_field": field,
                "native_crs": crs.to_string()}
            row = {"watershed_id": native_id, "source_ref": ref,
                   "geometry_operations": original.get("geometry_operations", [])}
            shapes.append(polygon)
            records.append(row)
            features.append({"type": "Feature", "id": digest(ref), "geometry": mapping(transform(to_wgs.transform, polygon)),
                "properties": {**props, **row}})
        groups.append({"shapes": shapes, "tree": STRtree(shapes) if shapes else None,
                       "records": records, "from_wgs": from_wgs})
        bindings.append(binding)
    return groups, bindings, {"type": "FeatureCollection", "features": features}


def _memberships(coordinates, groups):
    from shapely.geometry import Point
    matches = []
    if not coordinates:
        return [], "unresolved"
    for group in groups:
        if group["tree"] is None:
            continue
        x, y = group["from_wgs"].transform(*coordinates, errcheck=True)
        point = Point(x, y)
        for found in group["tree"].query(point):
            if hasattr(found, "geom_type"):
                indices = [i for i, polygon in enumerate(group["shapes"]) if polygon is found]
            else:
                indices = [int(found)]
            for index in indices:
                polygon = group["shapes"][index]
                if polygon.covers(point):
                    relation = "interior" if polygon.contains(point) else "boundary"
                    matches.append({**group["records"][index], "relation": relation})
    status = ("not_selected" if not groups else "outside" if not matches else
              "overlap" if len(matches) > 1 else "boundary" if matches[0]["relation"] == "boundary" else "matched")
    return matches, status


def _choose(value, candidates):
    if value is None:
        return None
    if isinstance(value, str):
        matches = [c for c in candidates if c["candidate_id"] == value]
    elif isinstance(value, dict):
        wanted = {k: value[k] for k in ("collection_id", "source_id", "native_feature_id", "source_feature_index") if k in value}
        if not {"collection_id", "source_id"} <= set(wanted) or not {"native_feature_id", "source_feature_index"} & set(wanted):
            raise ValueError("A chosen location needs its exact original source and native feature identity")
        matches = [c for c in candidates if all(c["source_ref"].get(k) == v and type(c["source_ref"].get(k)) is type(v) for k, v in wanted.items())]
    else:
        raise ValueError("Choose a retained original location candidate")
    if len(matches) != 1 or not matches[0]["coordinates_wgs84"]:
        raise ValueError("The chosen original station location is absent, ambiguous or invalid")
    return matches[0]


def _site_tables(workspace, selection):
    """Retain original CSV or complete JSON inventory rows as station source context."""
    from .station_inventory import read_inventory
    sites,bindings={},[]
    for reference in selection.get("site_tables",[]):
        path,entry,binding=_source(workspace,reference)
        field,records,info=read_inventory(path,reference,entry)
        bindings.append(binding)
        for number,original,position in records:
            station=_station_key(original[field])
            if not station:
                raise ValueError("Original station inventory row has no exact station ID")
            sites.setdefault(station,{"station_id":station,"source_references":[]})["source_references"].append({
                "collection_id":binding["collection_id"],"source_id":binding["source_id"],
                "source_sha256":binding["source_sha256"],"row_number":number,
                **position,"original":original})
    return sites,bindings

def _csv(fields, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: json.dumps(row.get(field), ensure_ascii=False, sort_keys=True, allow_nan=False)
                         if isinstance(row.get(field), (dict, list)) else row.get(field, "") for field in fields})
    return output.getvalue().encode("utf-8")


def _copy_retained(workspace, body, target):
    original = relative_file(workspace.root, body["object"])
    if original.stat().st_size != body["bytes"] or file_digest(original) != body["sha256"]:
        raise ValueError("An original source object changed before geographic export")
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != body["bytes"] or file_digest(target) != body["sha256"]:
            raise ValueError("An existing retained source copy differs")
        return
    pending = target.with_name(target.name + ".pending")
    shutil.copyfile(original, pending)
    os.replace(pending, target)


def _package_inputs(workspace, destination, bindings, observations):
    groups = {}
    for binding in bindings:
        groups.setdefault(binding["collection_id"], {})[binding["source_id"]] = binding
    manifests = []
    for collection_id, sources in sorted(groups.items()):
        folder = destination / "retained_sources" / collection_id
        entries = []
        original_collection = workspace._get("sources", collection_id)
        _copy_retained(workspace, original_collection["original_manifest"], folder / "original_manifest.json")
        for index, binding in enumerate(sources.values()):
            entry = dict(binding["source_metadata"])
            entry["origin_ref"] = {"collection_id": collection_id, "source_id": binding["source_id"],
                                   "source_sha256": binding["source_sha256"]}
            companions = []
            for number, body in enumerate([binding["body"], *binding["companions"]]):
                name = body.get("view_path") or body["filename"]
                relative = PurePosixPath("source-" + str(index).zfill(4)) / _safe_member(name)
                _copy_retained(workspace, body, folder / relative)
                descriptor = {"path": relative.as_posix(), "sha256": body["sha256"]}
                if number == 0:
                    entry.update(descriptor)
                else:
                    companions.append(descriptor)
            entry["companions"] = companions
            entries.append(entry)
        manifest = {"schema": "upstate.sources/v1", "title": original_collection.get("title", "Original geographic sources"),
                    "entries": entries, "notes": original_collection.get("notes", []),
                    "captured_at": original_collection.get("captured_at")}
        atomic_json(folder / "sources.json", manifest, immutable=True)
        manifests.append({"original_collection_id": collection_id,
            "path": (folder / "sources.json").relative_to(destination).as_posix(),
            "original_manifest_path": (folder / "original_manifest.json").relative_to(destination).as_posix()})
    original_observations = []
    for record in observations:
        folder = destination / "retained_observations" / record["id"]
        name = _safe_member(record["original"]["filename"])
        _copy_retained(workspace, record["original"], folder / name)
        atomic_json(folder / "metadata.json", record["metadata"], immutable=True)
        original_observations.append({"original_observation_id": record["id"],
            "path": (folder / name).relative_to(destination).as_posix(),
            "metadata_path": (folder / "metadata.json").relative_to(destination).as_posix()})
    return manifests, original_observations


def _svg_map(stations, watershed_geojson):
    pairs = []
    def visit(value):
        if isinstance(value, (tuple, list)) and len(value) >= 2 and isinstance(value[0], (int, float)):
            pairs.append(value[:2])
        elif isinstance(value, (tuple, list)):
            for child in value:
                visit(child)
    for feature in watershed_geojson["features"]:
        visit(feature["geometry"].get("coordinates"))
    for row in stations:
        if row["coordinates"]:
            pairs.append(row["coordinates"])
    if not pairs:
        return "<p>No resolved map coordinates in this edition.</p>"
    min_x, max_x = min(p[0] for p in pairs), max(p[0] for p in pairs)
    min_y, max_y = min(p[1] for p in pairs), max(p[1] for p in pairs)
    aspect = max(.05, math.cos(math.radians((min_y + max_y) / 2)))
    width, height = max((max_x - min_x) * aspect, .01), max(max_y - min_y, .01)
    scale = min(940 / width, 580 / height)
    def point(coordinates):
        return 30 + (coordinates[0] - min_x) * aspect * scale, 30 + (max_y - coordinates[1]) * scale
    items = ['<svg viewBox="0 0 1000 640" role="img" aria-label="Selected stations and retained watershed boundaries">']
    for feature in watershed_geojson["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        commands = []
        for polygon in polygons:
            for ring in polygon:
                commands.append(" ".join(("M" if i == 0 else "L") + "%.5f %.5f" % point(p) for i, p in enumerate(ring)) + " Z")
        items.append('<path d="' + " ".join(commands) + '" fill="#eeeeec" fill-rule="evenodd" stroke="#a5a5a0" stroke-width=".55"/>')
    for index, row in enumerate(stations):
        if row["coordinates"]:
            x, y = point(row["coordinates"])
            items.append('<a href="#station-' + str(index) + '"><circle cx="%.4f" cy="%.4f" r="4" fill="#262625" stroke="#fff" stroke-width="1"><title>' %
                         (x, y) + html.escape(row["station_id"]) + "</title></circle></a>")
    items.append("</svg>")
    return "".join(items)


def _report(result, watershed_geojson):
    escape = lambda value: html.escape(str(value if value is not None else ""))
    summary, stations = result["summary"], result["stations"]
    cards = "".join("<div><strong>" + escape(summary[key]) + "</strong><span>" + escape(title) + "</span></div>"
                    for key, title in (("station_count", "Study stations"), ("located_count", "Located"),
                                       ("unresolved_count", "Location review"), ("observation_count", "Linked observation rows")))
    station_rows = []
    for index, row in enumerate(stations):
        coordinates = ", ".join("%.8f" % value for value in row["coordinates"]) if row["coordinates"] else "Unresolved"
        candidates = "".join("<details><summary>" + escape(candidate["source_ref"]["source_id"]) + " · native feature " +
                    escape(candidate["source_ref"]["native_feature_id"]) + "</summary><pre>" +
                    escape(json.dumps(candidate, ensure_ascii=False, indent=2, allow_nan=False)) + "</pre></details>" for candidate in row["candidates"])
        station_rows.append('<tr id="station-' + str(index) + '"><td><strong>' + escape(row["station_id"]) + "</strong>" +
                ("<br>" + escape(row.get("label")) if row.get("label") else "") + "</td><td>" + escape(row["status"]) + "</td><td>" +
                escape(coordinates) + "</td><td>" + escape(row["watershed_status"]) + "<br>" +
                escape(", ".join(str(w["watershed_id"]) for w in row["watersheds"])) + "</td><td>" +
                str(row["observation_count"]) + "</td><td>" + candidates + "</td></tr>")
    files = ("stations.csv", "station_watershed_crosswalk.csv", "observation_links.csv", "unassigned_observations.csv",
             "source_inventory.csv", "stations.geojson", "candidate_locations.geojson", "watersheds.geojson",
             "assessment_links.csv", "assessment_sites.geojson", "analysis.json")
    links = " ".join('<a href="' + name + '">' + name + "</a>" for name in files)
    sources = "".join("<tr><td>" + escape(s["title"]) + "</td><td>" + escape(s["source_id"]) + "</td><td><code>" +
                      escape(s["source_sha256"]) + "</code></td><td>" + escape(s["uri"]) + "</td></tr>" for s in result["sources"])
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        "<title>" + escape(result["title"]) + "</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#252525;background:#fafaf8;margin:0 auto;padding:32px;max-width:1500px}h1,h2,h3{font-weight:650}h1{font-size:30px}p{max-width:95ch}a{color:inherit;text-decoration:underline}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:10px;border:1px solid #c7c7c2;vertical-align:top}th{background:#e9e9e5}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:440px;overflow:auto}code{overflow-wrap:anywhere}details{padding:5px}summary{cursor:pointer}svg{width:100%;max-height:680px;border:1px solid #c7c7c2;background:white}.metrics{display:flex;gap:12px;flex-wrap:wrap}.metrics div{padding:14px 22px;border:1px solid #bdbdb6;background:white;min-width:140px}.metrics strong{display:block;font-size:30px}.metrics span{display:block}.exports{display:flex;gap:16px;flex-wrap:wrap;margin:18px 0}.scroll{overflow:auto}@media print{body{padding:0;background:white}details{break-inside:avoid}th{background:#eee}svg{max-height:450px}a{text-decoration:none}}</style>" +
        "<body><h1>" + escape(result["title"]) + "</h1><p>Original station locations, exact study identifiers and membership in retained watershed geometry. Observation values, units, dates, qualifiers and methods are retained with their original rows.</p>" +
        '<div class="metrics">' + cards + "</div><h2>Study geography</h2>" + _svg_map(stations, watershed_geojson) +
        "<p>Display coordinates use EPSG:4326. Each station keeps native source coordinates, source CRS, feature identifiers and original attributes. Polygon covers includes boundary points; all overlapping matches remain in the crosswalk.</p>" +
        '<div class="exports">' + links + '</div>' + assessment_report(result) + '<h2>Every selected study station</h2><div class="scroll"><table><thead><tr><th>Station</th><th>Location status</th><th>Longitude, latitude</th><th>Watershed membership</th><th>Observation rows</th><th>Original locations</th></tr></thead><tbody>' +
        "".join(station_rows) + "</tbody></table></div><h2>Original source editions</h2><div class=\"scroll\"><table><thead><tr><th>Title</th><th>Source ID</th><th>Original hash</th><th>Provider reference</th></tr></thead><tbody>" +
        sources + "</tbody></table></div><h2>Reopen the original selection</h2><p>In the operator, open Station geography and choose Reopen original geography package. Select station-geography.zip. It contains the native sources, companions, observation originals and complete selection needed to create an editable geography edition in the receiving workspace.</p>" +
        "<p>Created " + escape(result["created_at"]) + " · build <code>" + escape(result["build_id"]) + "</code></p></body></html>")


def build(workspace, selection):
    if not isinstance(selection, dict):
        raise ValueError("Supply a station geography selection object")
    selection = json.loads(canonical(selection))
    references = selection.get("sources") or []
    if not isinstance(references, list) or not references:
        raise ValueError("Choose original station feature sources")
    inventory, station_bindings, by_id = _locations(workspace, references)
    observation_rows, observations, table_bindings = _observation_rows(workspace, selection)
    inventory_sites, inventory_bindings = _site_tables(workspace, selection)
    working_selection = dict(selection)
    if inventory_sites:
        explicit = selection.get("sites") or []
        if explicit:
            selected = []
            for supplied in explicit:
                row = {"station_id": supplied} if isinstance(supplied, (str, int)) else dict(supplied)
                key = _station_key(row["station_id"])
                original = inventory_sites.get(key, {})
                row["source_references"] = [*original.get("source_references", []), *row.get("source_references", [])]
                selected.append(row)
            working_selection["sites"] = selected
        else:
            working_selection["sites"] = list(inventory_sites.values())
    sites, links, unassigned = _sites(working_selection, observation_rows, by_id)
    watershed_groups, watershed_bindings, watershed_geojson = _watersheds(workspace, selection.get("watersheds") or [])
    rows = []
    choices = selection.get("choices") or {}
    normalized_choices = {}
    for station, site in sites.items():
        candidates_by_id = {}
        for alias in site["aliases"]:
            for candidate in by_id.get(alias, []):
                candidates_by_id[candidate["candidate_id"]] = candidate
        candidates = list(candidates_by_id.values())
        valid = [c for c in candidates if c["coordinates_wgs84"]]
        chosen = _choose(choices.get(station), candidates)
        status = "missing" if not candidates else "invalid" if not valid else "located"
        if chosen is not None:
            status = "selected"
            normalized_choices[station] = chosen["source_ref"]
        elif valid:
            distinct = {tuple(c["coordinates_wgs84"]) for c in valid}
            if len(distinct) > 1:
                status = "ambiguous"
            else:
                chosen = valid[0]
                status = "coincident" if len(valid) > 1 else "located"
        coordinates = chosen["coordinates_wgs84"] if chosen is not None else None
        memberships, membership_status = _memberships(coordinates, watershed_groups)
        decorated = []
        for candidate in candidates:
            memberships_for_candidate, candidate_status = _memberships(candidate["coordinates_wgs84"], watershed_groups)
            decorated.append({**candidate, "watersheds": memberships_for_candidate, "watershed_status": candidate_status})
        rows.append({**site, "status": status, "coordinates": coordinates,
            "selected_candidate_id": chosen["candidate_id"] if chosen is not None else None,
            "selected_source_ref": chosen["source_ref"] if chosen is not None else None,
            "candidates": decorated, "watersheds": memberships, "watershed_status": membership_status,
            "observation_count": sum(link["station_id"] == station for link in links),
            "issues": (["Multiple original locations match the exact selected station identifiers"] if status == "ambiguous" else
                       ["No exact native station identifier matched"] if status == "missing" else
                       ["Exact original station matches have no usable point geometry"] if status == "invalid" else [])})
    unknown_choices = set(choices) - set(sites)
    if unknown_choices:
        raise ValueError("A saved original location choice names a station outside this study selection")
    selection["choices"] = normalized_choices
    bindings_by_id = {}
    for binding in [*station_bindings, *watershed_bindings, *table_bindings, *inventory_bindings]:
        bindings_by_id[(binding["collection_id"], binding["source_id"])] = binding
    bindings = list(bindings_by_id.values())
    build_id = digest({"version": VERSION, "selection": selection,
        "sources": [{"collection_id": s["collection_id"], "source_id": s["source_id"], "sha256": s["source_sha256"]} for s in bindings],
        "observations": [o["id"] for o in observations]})
    destination = workspace.root / "station-geography" / build_id
    existing = destination / "edition.json"
    if existing.exists():
        saved = read_json(existing)
        return inspect(workspace, saved["id"], verify=True)
    destination.mkdir(parents=True, exist_ok=True)
    started_path = destination / "build-start.json"
    if not started_path.exists():
        atomic_json(started_path, {"build_id": build_id, "created_at": now()}, immutable=True)
    started = read_json(started_path)
    if started.get("build_id") != build_id:
        raise ValueError("The saved geographic operation belongs to another selection")
    created = started["created_at"]
    assessment_links, assessment_summary = enrich_assessments(rows, bindings)
    row_by_id = {row["station_id"]: row for row in rows}
    for link in links:
        station = row_by_id[link["station_id"]]
        link.update(location_status=station["status"], coordinates=station["coordinates"],
                    station_source_ref=station["selected_source_ref"], watershed_status=station["watershed_status"],
                    watersheds=station["watersheds"])
    counts = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    summary = {"station_count": len(rows), "located_count": sum(row["status"] in LOCATED for row in rows),
        "unresolved_count": sum(row["status"] not in LOCATED for row in rows),
        "observation_count": len(links), "unassigned_observation_count": len(unassigned),
        "original_candidate_count": len(inventory), "study_candidate_count": sum(len(r["candidates"]) for r in rows),
        "watershed_feature_count": len(watershed_geojson["features"]), "source_count": len(bindings),
        "status_counts": counts, "outside_watersheds_count": sum(r["watershed_status"] == "outside" for r in rows)}
    summary.update(assessment_summary)
    result = {"schema": RESULT_SCHEMA, "version": VERSION, "build_id": build_id,
        "project_id": workspace.project["id"], "title": selection.get("title") or "Study station geography",
        "created_at": created, "selection": selection, "summary": summary, "stations": rows,
        "observation_links": links, "unassigned_observations": unassigned, "sources": bindings,
        "assessment_links": assessment_links,
        "source_inventory": inventory, "matching_method": "Exact trimmed native identifiers and explicitly retained aliases",
        "watershed_method": "Native-CRS point/polygon covers; all boundary and overlap memberships retained"}
    atomic_json(destination / "analysis.json", result, immutable=True)
    station_features, candidate_features = [], []
    for row in rows:
        station_features.append({"type": "Feature", "id": row["station_id"],
            "geometry": {"type": "Point", "coordinates": row["coordinates"]} if row["coordinates"] else None,
            "properties": {key: row[key] for key in ("station_id", "status", "selected_candidate_id",
                "selected_source_ref", "watersheds", "watershed_status", "observation_count", "source_references", "aliases",
                "assessment_record_count", "assessment_editions", "assessment_cause_codes",
                "assessment_cause_labels", "publisher_huc12s") if key in row}})
        for candidate in row["candidates"]:
            candidate_features.append({"type": "Feature", "id": candidate["candidate_id"],
                "geometry": {"type": "Point", "coordinates": candidate["coordinates_wgs84"]} if candidate["coordinates_wgs84"] else None,
                "properties": {**candidate, "station_id": row["station_id"]}})
    for name, value in (("stations.geojson", {"type": "FeatureCollection", "features": station_features}),
                        ("candidate_locations.geojson", {"type": "FeatureCollection", "features": candidate_features}),
                        ("watersheds.geojson", watershed_geojson),
                        ("assessment_sites.geojson", assessment_geojson(assessment_links))):
        atomic_json(destination / name, value, immutable=True)
    flat_stations = [{**row, "longitude": row["coordinates"][0] if row["coordinates"] else None,
        "latitude": row["coordinates"][1] if row["coordinates"] else None,
        "candidate_ids": [c["candidate_id"] for c in row["candidates"]]} for row in rows]
    atomic_bytes(destination / "stations.csv", _csv(
        ["station_id", "label", "status", "longitude", "latitude", "watershed_status", "watersheds",
         "observation_count", "selected_candidate_id", "selected_source_ref", "candidate_ids", "aliases", "source_references", "issues"], flat_stations), immutable=True)
    crosswalk = []
    for row in rows:
        for membership in row["watersheds"] or [{}]:
            crosswalk.append({"station_id": row["station_id"], "location_status": row["status"],
                "watershed_status": row["watershed_status"], "longitude": row["coordinates"][0] if row["coordinates"] else None,
                "latitude": row["coordinates"][1] if row["coordinates"] else None,
                "watershed_id": membership.get("watershed_id"), "relation": membership.get("relation"),
                "station_source_ref": row["selected_source_ref"], "watershed_source_ref": membership.get("source_ref"),
                "observation_count": row["observation_count"]})
    atomic_bytes(destination / "station_watershed_crosswalk.csv", _csv(
        ["station_id", "location_status", "watershed_status", "longitude", "latitude", "watershed_id", "relation",
         "station_source_ref", "watershed_source_ref", "observation_count"], crosswalk), immutable=True)
    atomic_bytes(destination / "observation_links.csv", _csv(
        ["station_id", "station_id_original", "observation_id", "record_id", "row_number", "location_status",
         "coordinates", "watershed_status", "watersheds", "station_source_ref", "source_ref", "measurement", "original"], links), immutable=True)
    atomic_bytes(destination / "unassigned_observations.csv", _csv(
        ["station_id_original", "observation_id", "record_id", "row_number", "reason", "candidate_study_ids",
         "source_ref", "measurement", "original"], unassigned), immutable=True)
    atomic_bytes(destination / "assessment_links.csv", _csv(
        ["id", "station_id", "assessment_record_id", "source_id", "source_vintage", "publication_status",
         "evidence_kind", "source_uri", "source_sha256", "publisher_huc12", "cause_code", "cause_label",
         "cause_source_cell", "use", "use_support", "priority_ranking", "description", "county",
         "source_page", "tmdl_report", "approval_date", "location_status", "coordinates_wgs84",
         "geographic_huc12s", "publisher_huc_relation", "station_publisher_huc12", "station_publisher_huc8",
         "station_publisher_huc_relation", "station_publisher_huc_fields", "original_record_pointer",
         "original_record_index", "inventory_body_sha256", "inventory_row_number",
         "station_source_ref", "inventory_source_ref", "original"],
        assessment_links), immutable=True)
    atomic_bytes(destination / "source_inventory.csv", _csv(
        ["candidate_id", "native_station_id", "station_key", "native_crs", "native_crs_wkt", "native_coordinates",
         "coordinates_wgs84", "source_ref", "native_geometry", "properties", "issues"], inventory), immutable=True)
    atomic_bytes(destination / "OPEN_STATIONS.html", _report(result, watershed_geojson).encode("utf-8"), immutable=True)
    spatial_manifest = {
        "schema": "upstate.sources/v1", "title": result["title"] + " — mapped assessment editions",
        "captured_at": created, "scope": {"station_geography_build_id": build_id},
        "entries": [{
            "id": "station-geography-" + build_id + "-" + role,
            "title": title, "uri": "urn:upstate:station-geography:" + build_id,
            "vintage": created, "kind": "vector", "path": filename, "format": "geojson",
            "role": role, "source_crs": "EPSG:4326",
            "sha256": file_digest(destination / filename),
            "provenance": {"station_geography_build_id": build_id,
                           "source_identities": [{"source_id": source["source_id"], "sha256": source["source_sha256"]}
                                                 for source in bindings]},
        } for role, title, filename in (
            ("MONITORING_STATIONS", result["title"] + " — original station locations", "stations.geojson"),
            ("STATION_ASSESSMENTS", result["title"] + " — assessment records by edition", "assessment_sites.geojson"))],
    }
    atomic_json(destination / "spatial-sources.json", spatial_manifest, immutable=True)
    spatial_collection = workspace.import_sources(destination / "spatial-sources.json")
    manifests, original_observations = _package_inputs(workspace, destination, bindings, observations)
    owned_package_files = {destination / name for name in (
        "edition.json", "station-geography.zip", "package.json", "station-geography.zip.pending")}
    package_files = [describe_file(destination, path) for path in sorted(destination.rglob("*"))
                     if path.is_file() and path not in owned_package_files]
    package = {"schema": PACKAGE_SCHEMA, "version": VERSION, "build_id": build_id, "project_id": workspace.project["id"],
        "title": result["title"], "selection": selection, "source_manifests": manifests,
        "observations": original_observations, "files": package_files}
    atomic_json(destination / "package.json", package, immutable=True)
    archive_path = destination / "station-geography.zip"
    archive_pending = destination / "station-geography.zip.pending"
    with zipfile.ZipFile(archive_pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in sorted([item["path"] for item in package_files] + ["package.json"]):
            original = destination.joinpath(*_safe_member(name).parts)
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, original.read_bytes())
    os.replace(archive_pending, archive_path)
    files = [describe_file(workspace.root, destination / name, label=name) for name in (
        "analysis.json", "stations.geojson", "candidate_locations.geojson", "watersheds.geojson",
        "assessment_sites.geojson", "assessment_links.csv", "spatial-sources.json",
        "stations.csv", "station_watershed_crosswalk.csv", "observation_links.csv", "unassigned_observations.csv",
        "source_inventory.csv", "OPEN_STATIONS.html", "package.json", "station-geography.zip")]
    saved = workspace._save(KIND, {"version": VERSION, "title": result["title"], "created_at": created,
        "build_id": build_id, "selection": selection, "summary": summary, "sources": bindings,
        "observation_ids": [o["id"] for o in observations], "files": files,
        "source_collection_id": spatial_collection["id"]})
    atomic_json(existing, {"id": saved["id"], "build_id": build_id}, immutable=True)
    return saved


def inspect(workspace, edition_id, *, verify=False, include_result=False):
    record = workspace._get(KIND, identifier(edition_id))
    if verify:
        for item in record["files"]:
            verify_file(workspace.root, item)
        for binding in record["sources"]:
            _source(workspace, binding)
        for observation_id in record.get("observation_ids", []):
            observation = workspace._get("observations", observation_id)
            original = observation["original"]
            path = relative_file(workspace.root, original["object"])
            if path.stat().st_size != original["bytes"] or file_digest(path) != original["sha256"]:
                raise ValueError("An original observed-data file changed")
    if include_result:
        result_file = next(item for item in record["files"] if Path(item["path"]).name == "analysis.json")
        record["result"] = read_json(verify_file(workspace.root, result_file))
        watershed_file = next(item for item in record["files"] if Path(item["path"]).name == "watersheds.geojson")
        record["watershed_geojson"] = read_json(verify_file(workspace.root, watershed_file))
    return record


def catalog(workspace):
    from .station_inventory import catalogue_fields
    sources = []
    for collection in workspace._list("sources"):
        for entry in collection["entries"]:
            if entry["kind"] not in ("vector", "table"):
                continue
            row = {key: entry.get(key) for key in ("title", "kind", "role", "uri", "vintage", "station_id_field",
                "native_id_field", "id_field", "source_crs", "x_field", "y_field", "layer")}
            row.update(collection_id=collection["id"], source_id=entry["id"],
                       collection_title=collection.get("title"), source_sha256=entry["body"]["sha256"],
                       bytes=entry["body"]["bytes"])
            row.update(catalogue_fields(entry))
            sources.append(row)
    observations = [{"id": row["id"], "title": row["metadata"].get("title"), "row_count": len(row["rows"]),
                     "source_uri": row["metadata"].get("source_uri")} for row in workspace._list("observations")]
    editions = [{key: row[key] for key in ("id", "title", "created_at", "build_id", "summary")} for row in workspace._list(KIND)]
    try:
        from .station_study import prepared_studies
    except ModuleNotFoundError as error:
        if error.name != __package__ + ".station_study":
            raise
        studies = []
    else:
        studies = prepared_studies(workspace)
    # Original observation station study catalogue extension
    from .observed_station_studies import prepared_studies as observed_station_studies
    studies.extend(observed_station_studies(workspace, original_studies=studies))
    return {"schema": "upstate.station-geography-catalog/v1", "sources": sources, "observations": observations,
            "editions": editions, "prepared_studies": studies, "version": VERSION}


def receive(workspace, archive_path, *, max_extracted_bytes=2 * 1024 ** 3):
    """Reimport native originals and rebuild the editable selection in this workspace."""
    archive_path = Path(archive_path).resolve(strict=True)
    archive_sha = file_digest(archive_path)
    destination = workspace.root / "station-geography-received" / archive_sha
    receipt_path = destination / "received.json"
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if receipt.get("edition_id"):
            return inspect(workspace, receipt["edition_id"], verify=True)
    else:
        receipt = {"schema": "upstate.station-geography-receive/v1", "archive_sha256": archive_sha,
                   "source_map": {}, "observation_map": {}}
    with zipfile.ZipFile(archive_path) as archive:
        infos = archive.infolist()
        names, members = set(), {}
        total = 0
        for info in infos:
            if info.is_dir():
                continue
            name = _safe_member(info.filename).as_posix()
            mode = info.external_attr >> 16
            if name.casefold() in names or info.flag_bits & 1 or stat.S_ISLNK(mode):
                raise ValueError("A geographic package member is duplicated, encrypted or a symbolic link")
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                raise ValueError("A geographic package member is not an ordinary file")
            names.add(name.casefold())
            members[name] = info
            total += info.file_size
        if total > max_extracted_bytes or len(members) > 20000:
            raise ValueError("The geographic package exceeds the receiving workspace extraction limit")
        if "package.json" not in members or members["package.json"].file_size > 16 * 1024 ** 2:
            raise ValueError("The original station package manifest is absent or too large")
        package = json.loads(archive.read("package.json"))
        if package.get("schema") != PACKAGE_SCHEMA:
            raise ValueError("Choose an original station geography package")
        declared = {}
        for item in package.get("files", []):
            name = _safe_member(item.get("path")).as_posix()
            if name in declared:
                raise ValueError("The original geographic package inventory duplicates a member")
            declared[name] = item
        if set(declared) != set(members) - {"package.json"}:
            raise ValueError("The geographic package does not match its complete original inventory")
        for name, item in declared.items():
            if members[name].file_size != item.get("bytes") or not isinstance(item.get("sha256"), str):
                raise ValueError("A geographic package member differs from its declared size or identity")
        destination.mkdir(parents=True, exist_ok=True)
        original_root = destination / "original"
        if not (original_root / "package.json").exists():
            with tempfile.TemporaryDirectory(prefix=".geography-receive-", dir=destination) as temporary:
                staging = Path(temporary)
                for name in sorted(members):
                    target = staging.joinpath(*_safe_member(name).parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(members[name]) as source, open(target, "wb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
                    if name != "package.json":
                        verify_file(staging, declared[name])
                if original_root.exists():
                    shutil.rmtree(original_root)
                os.replace(staging, original_root)
        else:
            for item in declared.values():
                verify_file(original_root, item)
            if read_json(original_root / "package.json") != package:
                raise ValueError("The retained received package manifest changed")
    atomic_json(receipt_path, receipt)
    for item in package.get("source_manifests", []):
        old = identifier(item["original_collection_id"])
        if old in receipt["source_map"]:
            workspace._get("sources", receipt["source_map"][old])
            continue
        manifest_path = relative_file(original_root, _safe_member(item["path"]).as_posix())
        imported = workspace.import_sources(manifest_path)
        receipt["source_map"][old] = imported["id"]
        atomic_json(receipt_path, receipt)
    for item in package.get("observations", []):
        old = identifier(item["original_observation_id"])
        if old in receipt["observation_map"]:
            workspace._get("observations", receipt["observation_map"][old])
            continue
        path = relative_file(original_root, _safe_member(item["path"]).as_posix())
        metadata = read_json(relative_file(original_root, _safe_member(item["metadata_path"]).as_posix()))
        imported = workspace.import_observations(path, metadata)
        receipt["observation_map"][old] = imported["id"]
        atomic_json(receipt_path, receipt)
    selection = json.loads(canonical(package["selection"]))
    def source_reference(reference):
        reference = dict(reference)
        old = reference.get("collection_id")
        if old not in receipt["source_map"]:
            raise ValueError("The received selection refers to an original source absent from its package")
        reference["collection_id"] = receipt["source_map"][old]
        return reference
    for name in ("sources", "watersheds", "observation_tables", "site_tables"):
        selection[name] = [source_reference(ref) for ref in selection.get(name, [])]
    selection["observation_ids"] = [receipt["observation_map"][old] for old in selection.get("observation_ids", [])]
    selection["choices"] = {station: source_reference(ref) for station, ref in selection.get("choices", {}).items()}
    selection["received_from"] = {"archive_sha256": archive_sha, "build_id": package["build_id"],
                                  "project_id": package["project_id"], "source_map": receipt["source_map"]}
    result = build(workspace, selection)
    receipt["edition_id"] = result["id"]
    receipt["completed_at"] = now()
    atomic_json(receipt_path, receipt)
    return result


def verify_workspace(workspace):
    editions = workspace._list(KIND)
    for edition in editions:
        inspect(workspace, edition["id"], verify=True)
    return {"edition_count": len(editions), "verified": True}


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("selection")
    inspect_parser = commands.add_parser("inspect")
    inspect_parser.add_argument("id")
    inspect_parser.add_argument("--complete", action="store_true")
    inspect_parser.add_argument("--verify", action="store_true")
    receive_parser = commands.add_parser("receive")
    receive_parser.add_argument("archive")
    commands.add_parser("catalog")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "build":
        result = build(workspace, read_json(args.selection))
    elif args.command == "inspect":
        result = inspect(workspace, args.id, verify=args.verify, include_result=args.complete)
    elif args.command == "receive":
        result = receive(workspace, args.archive)
    else:
        result = catalog(workspace)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
