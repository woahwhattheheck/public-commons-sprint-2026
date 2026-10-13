"""Native water-designation selections and direct map-delivery sources.

Select exact publisher classes or original feature identities. Retain the whole
original source edition, selected geometry, rule reference and portable report.
"""
from __future__ import annotations

from collections import Counter
from contextlib import ExitStack, contextmanager
from functools import lru_cache
import csv
import io
import json
import math
from pathlib import Path
import shutil

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from . import rasters

SPEC_KIND = "water-designation-specs"
PURPOSES = {"high_quality_waters", "drinking_water", "protected_lands"}
VECTOR_ROLES = {"WATER_CLASSIFICATION", "SOURCE_WATER_INTAKES",
                "SOURCE_WATER_PROTECTION_AREAS", "SOURCE_WATER_PROTECTION_ZONES",
                "PROTECTED_LANDS"}
LAYER = "selected_features"
MEASURE_NOTES = [
    "Mapped line length adds the selected original line features, including banks and shorelines where the publisher maps them. It is not stream-centerline length.",
    "Mapped polygon area adds original polygon records. Overlapping designations can contribute more than once.",
    "Preview geometry uses longitude and latitude; the retained GIS selection keeps the original source coordinate system.",
]

def _text(value, label, *, required=True):
    if value is None and not required:
        return None
    if not isinstance(value, str) or (required and not value.strip()):
        raise ValueError(label + " must be a nonempty text value")
    if "\0" in value:
        raise ValueError(label + " contains a null character")
    return value.strip()

def _json_value(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("A native source attribute is not finite")
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    raise ValueError("Unsupported native attribute type: " + type(value).__name__)

def _class_key(value):
    if value is not None and not isinstance(value, (str, int, float, bool)):
        raise ValueError("Choose an exact native scalar class value")
    return canonical([type(value).__name__, _json_value(value)]).decode("utf-8")

def _ids(value, label):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(label + " must be a list of native feature identities")
    result = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, (str, int)):
            raise ValueError(label + " must contain strings or integer identities")
        text = str(item)
        if not text or "\0" in text:
            raise ValueError(label + " contains an invalid identity")
        result.append(text)
    return sorted(set(result))

def sources(workspace):
    items = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry["kind"] != "vector":
                continue
            metadata = entry.get("metadata", {})
            items.append({
                "source_collection_id": collection["id"], "source_id": entry["id"],
                "title": entry["title"], "role": entry.get("role"),
                "vintage": entry["vintage"], "uri": entry["uri"],
                "sha256": entry["body"]["sha256"], "layer": entry.get("layer"),
                "id_field": entry.get("id_field") or metadata.get("id_field"),
                "classification_status": metadata.get("classification_status"),
                "scope": entry.get("scope", collection.get("scope", {})),
                "preferred": entry.get("role") in VECTOR_ROLES,
            })
    return sorted(items, key=lambda item: (not item["preferred"], item["title"], item["source_id"]))

@lru_cache(maxsize=64)
def _infer_id(path, layer, source_sha256):
    """Choose a complete unique native ID field within this retained edition."""
    import fiona
    kwargs = {"layer": layer} if layer else {}
    with rasters.vector_environment(), fiona.open(path, ignore_geometry=True, **kwargs) as src:
        candidates = [name for name in ("OBJECTID_1", "OBJECTID", "FID")
                      if name in src.schema["properties"]]
        seen = {name: set() for name in candidates}
        for feature in src:
            props = feature["properties"]
            for name in list(seen):
                value = props.get(name)
                if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value):
                    del seen[name]
                elif str(value) in seen[name]:
                    del seen[name]
                else:
                    seen[name].add(str(value))
            if not seen:
                break
        return next((name for name in candidates if name in seen), "__fid__")

@contextmanager
def _reader(workspace, choice):
    import fiona
    from pyproj import CRS
    from .spatial_esri import OriginalEsriFeatures, UnsupportedEsriGeometry, is_esri_source
    collection_id = _text(choice.get("source_collection_id"), "Source edition")
    source_id = _text(choice.get("source_id"), "Source")
    path, entry = workspace.source_file(collection_id, source_id)
    if entry["kind"] != "vector":
        raise ValueError("Select a retained vector source")
    expected = choice.get("expected_source_sha256")
    if expected is not None and expected != entry["body"]["sha256"]:
        raise ValueError("The selected source edition changed; reopen its source choices")
    layer = choice.get("layer") or entry.get("layer")
    reader = None
    with ExitStack() as stack:
        src = None
        if is_esri_source(path, entry):
            try:
                src = OriginalEsriFeatures(path, entry)
            except UnsupportedEsriGeometry:
                pass
        if src is None:
            stack.enter_context(rasters.vector_environment())
            src = stack.enter_context(fiona.open(
                rasters.native_vector_path(path), **({"layer": layer} if layer else {})))
        else:
            if layer is not None and layer not in src.layers:
                raise ValueError("Select the retained original Esri polygon layer")
            reader = {
                **_json_value(src.reader_metadata),
                "adapter": "model/spatial_esri.py:OriginalEsriFeatures",
                "adapter_source_sha256": file_digest(Path(__file__).with_name("spatial_esri.py")),
                "analysis_axes": "XY",
            }
        if not src.crs_wkt and not src.crs:
            raise ValueError("The retained source needs its actual coordinate reference")
        crs = CRS.from_user_input(src.crs_wkt or src.crs)
        props = dict(src.schema["properties"])
        declared_id = choice.get("id_field")
        metadata = entry.get("metadata", {})
        id_field = declared_id or entry.get("id_field") or metadata.get("id_field")
        if id_field is None:
            id_field = ((reader.get("source_object_id_field") or "__fid__") if reader is not None else
                        _infer_id(rasters.native_vector_path(path), layer, entry["body"]["sha256"]))
        if id_field != "__fid__" and id_field not in props:
            raise ValueError("The selected native identity field does not exist")
        class_field = choice.get("class_field") or ("H2OCLASS" if "H2OCLASS" in props else None)
        if class_field is not None and class_field not in props:
            raise ValueError("The selected class field does not exist in this source")
        info = {
            "source_collection_id": collection_id, "source_id": source_id,
            "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
            "sha256": entry["body"]["sha256"], "role": entry.get("role"),
            "layer": src.name, "id_field": id_field, "class_field": class_field,
            "crs": crs.to_string(), "crs_wkt": crs.to_wkt(),
            "geometry_type": src.schema["geometry"],
            "classification_status": metadata.get("classification_status"),
            "scope": entry.get("scope", {}),
        }
        if reader is not None:
            info["geometry_reader"] = reader
            info["original_fields"] = dict(src.schema["properties"])
        yield src, crs, info


def _storage_schema(original, info):
    """Keep source parts and scalar attributes in a mixed-geometry GeoPackage."""
    properties = dict(original.schema["properties"])
    if info.get("geometry_reader") is not None:
        field_types = {
            "esriFieldTypeSmallInteger": "int", "esriFieldTypeInteger": "int64",
            "esriFieldTypeBigInteger": "int64", "esriFieldTypeOID": "int64",
            "esriFieldTypeSingle": "float", "esriFieldTypeDouble": "float",
            "esriFieldTypeString": "str", "esriFieldTypeGUID": "str",
            "esriFieldTypeGlobalID": "str", "esriFieldTypeXML": "str",
            # Original Esri JSON dates are epoch milliseconds, not reformatted dates.
            "esriFieldTypeDate": "int64", "esriFieldTypeDateOnly": "str",
            "esriFieldTypeTimeOnly": "str", "esriFieldTypeTimestampOffset": "str",
        }
        converted = {}
        for name, kind in properties.items():
            if kind in field_types:
                converted[name] = field_types[kind]
                continue
            values = [row["properties"].get(name) for row in original]
            present = [value for value in values if value is not None]
            if not present or all(isinstance(value, str) for value in present):
                converted[name] = "str"
            elif all(isinstance(value, (bool, int)) for value in present):
                converted[name] = "int64"
            elif all(isinstance(value, (bool, int, float)) for value in present):
                converted[name] = "float"
            else:
                raise ValueError("Choose a supported original scalar GIS field: " + name)
        properties = converted
    # Source schemas can say Polygon while native features contain MultiPolygon.
    # A generic GPKG layer retains the actual geometry, without flattening parts.
    geometry = original.schema["geometry"]
    if info.get("geometry_reader") is not None or geometry in {"Polygon", "MultiPolygon"}:
        geometry = "Unknown"
    return {"geometry": geometry, "properties": properties}

def _feature(feature, id_field):
    properties = {str(key): _json_value(value) for key, value in dict(feature["properties"]).items()}
    value = str(feature.id) if id_field == "__fid__" else properties.get(id_field)
    if value is None or isinstance(value, (dict, list, bool)):
        raise ValueError("A source feature has no usable original identity")
    return str(value), properties

def _wgs_geometry(feature, project):
    from shapely.geometry import shape
    from shapely.ops import transform
    if not feature["geometry"]:
        return None
    geometry = shape(feature["geometry"])
    if geometry.is_empty:
        return None
    if not geometry.is_valid:
        raise ValueError("Selected source geometry requires an explicit correction")
    result = transform(project.transform, geometry)
    if result.is_empty or not all(math.isfinite(v) for v in result.bounds):
        raise ValueError("The selected source cannot be represented in longitude and latitude")
    return result

def _bounds(current, incoming):
    if incoming is None:
        return current
    if current is None:
        return list(incoming)
    return [min(current[0], incoming[0]), min(current[1], incoming[1]),
            max(current[2], incoming[2]), max(current[3], incoming[3])]

def _page(offset, limit):
    if isinstance(offset, bool) or isinstance(limit, bool):
        raise ValueError("Choose whole-number pagination values")
    offset, limit = int(offset), int(limit)
    if offset < 0 or not 1 <= limit <= 5000:
        raise ValueError("Choose an offset of zero or greater and a page size of 1–5000")
    return offset, limit

def inspect(workspace, choice, *, offset=0, limit=500):
    """Count all original classes; return a clearly identified page of features."""
    from pyproj import Transformer
    from shapely.geometry import mapping
    offset, limit = _page(offset, limit)
    with _reader(workspace, choice) as (src, crs, info):
        project = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        counts, values, seen, features = Counter(), {}, set(), []
        total, missing = 0, 0
        bbox = None
        for feature in src:
            fid, properties = _feature(feature, info["id_field"])
            if fid in seen:
                raise ValueError("Native feature identities repeat; choose the original unique field")
            seen.add(fid)
            if info["class_field"]:
                value = properties.get(info["class_field"])
                key = _class_key(value)
                values[key] = value
                counts[key] += 1
            if offset <= total < offset + limit:
                try:
                    geometry = _wgs_geometry(feature, project)
                    error = None
                except ValueError as problem:
                    geometry, error = None, str(problem)
                item = {"type": "Feature", "id": fid, "properties": properties,
                        "geometry": mapping(geometry) if geometry is not None else None}
                if error:
                    item["geometry_error"] = error
                features.append(item)
            if not feature["geometry"]:
                missing += 1
            total += 1
        if total:
            try:
                bbox = list(project.transform_bounds(*src.bounds, densify_pts=21))
                if not all(math.isfinite(v) for v in bbox):
                    bbox = None
            except (ValueError, TypeError):
                bbox = None
        fields = [{"name": field, "type": kind} for field, kind in src.schema["properties"].items()]
    return {
        "schema": "upstate.water-designation-inspection/v1", "source": info,
        "fields": fields, "id_field": info["id_field"], "class_field": info["class_field"],
        "classes": [{"value": values[key], "count": counts[key]}
                    for key in sorted(counts, key=lambda key: (values[key] is None, str(values[key])))],
        "total_features": total, "features_without_geometry": missing,
        "offset": offset, "returned_features": len(features),
        "next_offset": offset + len(features) if offset + len(features) < total else None,
        "bbox": bbox, "features": features,
        "selection_note": "Class counts cover the complete retained source. This feature list is one page.",
    }

def _normalized(choice, info, *, saving=False):
    purpose = choice.get("purpose", "high_quality_waters")
    if purpose not in PURPOSES:
        raise ValueError("Choose a supported water or conservation overlay purpose")
    mode = choice.get("selection_mode", "classes")
    if mode not in {"classes", "features", "all"}:
        raise ValueError("Choose exact classes, exact features, or all source features")
    class_values = choice.get("class_values", [])
    if not isinstance(class_values, list):
        raise ValueError("Class values must be a list")
    unique = {_class_key(value): value for value in class_values}
    class_values = [unique[key] for key in sorted(unique)]
    feature_ids = _ids(choice.get("feature_ids"), "Selected features")
    exclude_ids = _ids(choice.get("exclude_ids"), "Excluded features")
    if mode == "classes" and (not info["class_field"] or not class_values):
        raise ValueError("Select a native class field and at least one exact class")
    if mode == "features" and not feature_ids:
        raise ValueError("Select at least one original feature")
    if saving and choice.get("expected_source_sha256") != info["sha256"]:
        raise ValueError("Inspect this source edition before saving its selected features")
    rule = choice.get("rule_reference") or {}
    if not isinstance(rule, dict):
        raise ValueError("The rule reference must contain named text fields")
    rule = {key: _text(rule.get(key), "Rule " + key, required=False)
            for key in ("title", "uri", "edition", "section")}
    if saving and purpose == "high_quality_waters":
        for key in ("title", "uri", "edition"):
            if not rule[key]:
                raise ValueError("Retain the selected classification rule's " + key)
    if rule["uri"]:
        from urllib.parse import urlsplit
        if urlsplit(rule["uri"]).scheme not in {"https", "http", "urn"}:
            raise ValueError("The rule reference needs an HTTP(S) or URN source")
    notes = choice.get("notes", [])
    if isinstance(notes, str):
        notes = [line.strip() for line in notes.splitlines() if line.strip()]
    if not isinstance(notes, list) or any(not isinstance(item, str) for item in notes):
        raise ValueError("Selection notes must be text")
    result = {
        "title": _text(choice.get("title") or "Water designation selection", "Selection title"),
        "purpose": purpose, "selection_mode": mode, "class_field": info["class_field"],
        "class_values": class_values if mode == "classes" else [],
        "feature_ids": feature_ids if mode == "features" else [],
        "exclude_ids": exclude_ids, "id_field": info["id_field"],
        "source_collection_id": info["source_collection_id"], "source_id": info["source_id"],
        "layer": info["layer"], "expected_source_sha256": info["sha256"],
        "rule_reference": rule, "notes": notes,
        "revision_of": choice.get("revision_of"),
    }
    context = choice.get("source_context")
    if context is not None:
        if not isinstance(context, dict):
            raise ValueError("Source context must be a JSON object of original references")
        result["source_context"] = _json_value(context)
    return result

def _selected(workspace, choice, *, saving=False, consume=None, preview_offset=0, preview_limit=500):
    from pyproj import Geod, Transformer
    from shapely.geometry import mapping
    from shapely.geometry.polygon import orient
    geod = Geod(ellps="WGS84")
    preview_offset, preview_limit = _page(preview_offset, preview_limit)
    with _reader(workspace, choice) as (src, crs, info):
        selection = _normalized(choice, info, saving=saving)
        if selection["revision_of"] is not None:
            identifier(selection["revision_of"])
        wanted = set(selection["feature_ids"])
        excluded = set(selection["exclude_ids"])
        wanted_classes = {_class_key(value) for value in selection["class_values"]}
        found_classes, seen = set(), set()
        selected_ids, preview_features, native_counts = [], [], Counter()
        selected_provenance = []
        classes, class_values = Counter(), {}
        project = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        total, points, polygon_count, line_count = 0, 0, 0, 0
        length_m, area_m2, bbox = 0.0, 0.0, None
        for feature in src:
            fid, properties = _feature(feature, info["id_field"])
            if fid in seen:
                raise ValueError("The selected native identity field contains duplicates")
            seen.add(fid)
            total += 1
            class_value = properties.get(info["class_field"]) if info["class_field"] else None
            key = _class_key(class_value)
            if info["class_field"]:
                found_classes.add(key)
            mode = selection["selection_mode"]
            chosen = mode == "all" or (mode == "features" and fid in wanted) or (
                mode == "classes" and key in wanted_classes)
            if not chosen or fid in excluded:
                continue
            geometry = _wgs_geometry(feature, project)
            if geometry is None:
                raise ValueError("Selected feature " + fid + " has no usable geometry")
            kind = geometry.geom_type
            if selection["purpose"] in {"drinking_water", "protected_lands"} and kind not in {"Polygon", "MultiPolygon"}:
                raise ValueError("Select actual protection-area polygons for this overlay; intake points do not define a catchment")
            if kind in {"LineString", "MultiLineString", "LinearRing"}:
                line_count += 1
                length_m += abs(float(geod.geometry_length(geometry)))
            elif kind in {"Polygon", "MultiPolygon"}:
                polygon_count += 1
                polygons = [geometry] if kind == "Polygon" else list(geometry.geoms)
                for polygon in polygons:
                    area, _ = geod.geometry_area_perimeter(orient(polygon, sign=1.0))
                    area_m2 += abs(float(area))
            elif kind in {"Point", "MultiPoint"}:
                points += 1 if kind == "Point" else len(geometry.geoms)
            else:
                raise ValueError("Select source point, line, or polygon features; found " + kind)
            native_counts[kind] += 1
            bbox = _bounds(bbox, geometry.bounds)
            index = len(selected_ids)
            selected_ids.append(fid)
            if info.get("geometry_reader") is not None:
                selected_provenance.append({
                    "native_feature_id": fid,
                    "source_array_index": feature.source_feature_index,
                    "native_id_basis": feature.id_basis,
                    "geometry_operations": _json_value(feature.geometry_operations),
                })
            if info["class_field"]:
                classes[key] += 1
                class_values[key] = class_value
            if preview_offset <= index < preview_offset + preview_limit:
                preview_features.append({"type": "Feature", "id": fid, "properties": properties,
                                         "geometry": mapping(geometry)})
            if consume is not None:
                consume(feature, fid, properties, geometry, src.schema, crs)
        missing_ids = (wanted | excluded) - seen
        if missing_ids:
            raise ValueError("Feature identities are absent from this source edition: " + ", ".join(sorted(missing_ids)[:20]))
        if selection["selection_mode"] == "classes" and wanted_classes - found_classes:
            raise ValueError("One or more selected class values are absent from this source edition")
        if not selected_ids:
            raise ValueError("The current choice selects no usable features")
        if not math.isfinite(length_m) or not math.isfinite(area_m2):
            raise ValueError("Selected geometry measurements are not finite")
    summary = {
        "selected_features": len(selected_ids), "total_features": total,
        "length_km": length_m / 1000, "area_km2": area_m2 / 1000000,
        "line_features": line_count, "polygon_features": polygon_count, "points": points,
        "bbox": bbox, "geometry_types": dict(native_counts),
        "classes": [{"value": class_values[key], "count": classes[key]} for key in sorted(classes)],
        "measure_notes": MEASURE_NOTES,
    }
    return {
        "schema": "upstate.water-designation-preview/v1",
        "source": info, "selection": selection, "summary": summary,
        "selected_ids": sorted(selected_ids), "offset": preview_offset,
        **({"selected_feature_provenance": selected_provenance} if info.get("geometry_reader") is not None else {}),
        "returned_features": len(preview_features), "total_features": len(selected_ids),
        "next_offset": preview_offset + len(preview_features) if preview_offset + len(preview_features) < len(selected_ids) else None,
        "geojson": {"type": "FeatureCollection", "features": preview_features},
        "measure_notes": MEASURE_NOTES,
    }

def preview(workspace, choice, *, offset=0, limit=500):
    result = _selected(workspace, choice, preview_offset=offset, preview_limit=limit)
    result.pop("selected_ids")
    return result

def export_features(workspace, choice, destination, *, format="geojson"):
    """Export the entire exact selection, independently of the displayed page."""
    if format not in {"geojson", "csv"}:
        raise ValueError("Choose GeoJSON or CSV")
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = destination.with_name("." + destination.name + ".pending")
    with held(destination.with_name("." + destination.name + ".lock")):
        try:
            with pending.open("w", encoding="utf-8", newline="") as output:
                first = True
                writer = None
                if format == "geojson":
                    output.write('{"type":"FeatureCollection","features":[')
                def consume(feature, fid, properties, geometry, schema, crs):
                    nonlocal first, writer
                    if format == "geojson":
                        from shapely.geometry import mapping
                        if not first:
                            output.write(",")
                        output.write(canonical({"type": "Feature", "id": fid,
                                                "properties": properties,
                                                "geometry": mapping(geometry)}).decode("utf-8"))
                        first = False
                    else:
                        identity_column = "native_feature_id"
                        while identity_column in schema["properties"]:
                            identity_column = "_" + identity_column
                        if writer is None:
                            writer = csv.DictWriter(output, fieldnames=[identity_column] + list(schema["properties"]))
                            writer.writeheader()
                        writer.writerow({identity_column: fid, **properties})
                result = _selected(workspace, choice, consume=consume, preview_limit=1)
                if format == "geojson":
                    output.write("]}")
                output.write("\n")
                output.flush()
                import os
                os.fsync(output.fileno())
            import os
            os.replace(pending, destination)
        finally:
            pending.unlink(missing_ok=True)
    return {"path": str(destination), "filename": destination.name,
            "bytes": destination.stat().st_size, "sha256": file_digest(destination),
            "features": result["summary"]["selected_features"], "format": format,
            "source": result["source"], "selection": result["selection"]}

def _report(result):
    from html import escape
    s, source, choice = result["summary"], result["source"], result["selection"]
    rule = choice["rule_reference"]
    rows = "".join("<tr><td>" + escape(str(row["value"])) + "</td><td>" + str(row["count"]) + "</td></tr>"
                   for row in s["classes"])
    interpretation = []
    if source.get("geometry_reader") is not None:
        interpretation.append(
            "Declared Esri polygon rings use the retained source reader. Any ring correction is recorded per selected feature in selected-identities.json; the original response remains unchanged.")
    notes = "".join("<li>" + escape(note) + "</li>" for note in MEASURE_NOTES + choice["notes"] + interpretation)
    rule_uri = escape(rule.get("uri") or "", quote=True)
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + escape(choice["title"]) + """</title><style>
body{max-width:960px;margin:40px auto;padding:0 24px;font:16px/1.55 system-ui;color:#18212b;background:#fff}
h1{font-size:30px;line-height:1.2}h2{font-size:20px;margin-top:32px}dl{display:grid;grid-template-columns:210px 1fr;gap:8px}
dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ced3d8;padding:10px}
.meta{color:#4d5964}a{color:#20364a}@media print{body{margin:0;max-width:none}a{color:inherit}}
</style><main><p class="meta">TOKENJUNKIELABS · UPPER SAVANNAH</p><h1>""" + escape(choice["title"]) + """</h1>
<p>Exact selected source features for the watershed map delivery.</p><dl><dt>Purpose</dt><dd>""" + escape(choice["purpose"].replace("_", " ")) + """</dd>
<dt>Selected features</dt><dd>""" + str(s["selected_features"]) + " of " + str(s["total_features"]) + """</dd>
<dt>Mapped line length</dt><dd>""" + f'{s["length_km"]:,.3f}' + """ km</dd><dt>Mapped polygon area</dt><dd>""" + f'{s["area_km2"]:,.3f}' + """ km²</dd>
<dt>Source</dt><dd>""" + escape(source["title"]) + """</dd><dt>Source edition</dt><dd>""" + escape(str(source["vintage"])) + """</dd>
<dt>Published classification status</dt><dd>""" + escape(str(source.get("classification_status") or "See source metadata")) + """</dd>
<dt>Native identity field</dt><dd>""" + escape(source["id_field"]) + """</dd><dt>Native coordinates</dt><dd>""" + escape(source["crs"]) + """</dd>
<dt>Rule reference</dt><dd><a href=\"""" + rule_uri + """\">""" + escape(rule.get("title") or "Source description") + """</a> · """ + escape(rule.get("edition") or "") + """ · """ + escape(rule.get("section") or "") + """</dd></dl>
<h2>Selected native classes</h2><table><thead><tr><th>Publisher value</th><th>Features</th></tr></thead><tbody>""" + rows + """</tbody></table>
<h2>How to interpret the selection</h2><ul>""" + notes + """</ul><p>The selected GeoPackage retains native geometry and attributes; GeoJSON uses longitude and latitude. The saved choice includes the original source identity and exact selected feature identities.</p></main></html>
"""

def save(workspace, choice):
    """Create a reusable vector source that the unchanged delivery engine accepts."""
    import fiona
    from fiona.model import to_dict
    with held(workspace.root / ".workspace.lock"):
        # Bind the source edition before writing; the original source stays retained.
        with _reader(workspace, choice) as (original, _, info):
            selection = _normalized(choice, info, saving=True)
            output_schema = _storage_schema(original, info)
            occupied = {name.casefold() for name in output_schema["properties"]}
            def unused_name(name):
                while name.casefold() in occupied:
                    name = "_" + name
                occupied.add(name.casefold())
                return name
            output_id_field = info["id_field"]
            if output_id_field == "__fid__":
                output_id_field = unused_name("native_feature_id")
                output_schema["properties"][output_id_field] = "str"
            storage_fid = unused_name("_designation_row_id")
            storage_geometry = unused_name("_designation_geometry")
        spec = workspace._save(SPEC_KIND, {"selection": selection, "source": info})
        key = spec["id"]
        directory = workspace.root / "water-designations" / key
        state_path = directory / "selection.json"
        if state_path.exists():
            result = get(workspace, key)
            return {**result, "reused_completed_selection": True}
        directory.mkdir(parents=True, exist_ok=True)
        gpkg = directory / "selected-features.gpkg"
        pending = directory / ".selected-features.pending.gpkg"
        if pending.exists():
            pending.unlink()
        writer = None
        try:
            def consume(feature, fid, properties, geometry, schema, crs):
                nonlocal writer
                if writer is None:
                    writer = fiona.open(pending, "w", driver="GPKG", layer=LAYER,
                                        schema=output_schema, crs_wkt=crs.to_wkt(),
                                        FID=storage_fid, GEOMETRY_NAME=storage_geometry)
                retained_properties = dict(feature["properties"])
                if info["id_field"] == "__fid__":
                    retained_properties[output_id_field] = fid
                writer.write({"geometry": to_dict(feature["geometry"]),
                              "properties": retained_properties})
            with rasters.vector_environment():
                result = _selected(workspace, selection, saving=True, consume=consume, preview_limit=1)
                if writer is not None:
                    writer.close()
                    writer = None
            import os
            os.replace(pending, gpkg)
        finally:
            if writer is not None:
                writer.close()
            pending.unlink(missing_ok=True)
        selected_ids_path = directory / "selected-identities.json"
        atomic_json(selected_ids_path, {"source": info, "selection": selection,
                                       "selected_ids": result["selected_ids"],
                                       "summary": result["summary"],
                                       **({"selected_feature_provenance": result["selected_feature_provenance"]}
                                          if "selected_feature_provenance" in result else {})}, immutable=True)
        manifest_path = directory / "sources.json"
        rule = selection["rule_reference"]
        rule_path = directory / "rule-reference.json"
        atomic_json(rule_path, rule, immutable=True)
        source_manifest = {
            "schema": "upstate.sources/v1", "title": selection["title"],
            "captured_at": None,
            "scope": {"selection": selection, "original_scope": info["scope"]},
            "notes": MEASURE_NOTES + selection["notes"],
            "entries": [{
                "id": "water-designation-" + key, "title": selection["title"],
                "uri": info["uri"], "vintage": info["vintage"], "kind": "vector",
                "role": {"high_quality_waters": "WATER_CLASSIFICATION",
                         "drinking_water": "SOURCE_WATER_PROTECTION_AREAS",
                         "protected_lands": "PROTECTED_LANDS"}[selection["purpose"]],
                "path": gpkg.name, "sha256": file_digest(gpkg), "layer": LAYER,
                "id_field": output_id_field,
                "companions": [{"path": selected_ids_path.name, "sha256": file_digest(selected_ids_path)},
                               {"path": rule_path.name, "sha256": file_digest(rule_path)}],
                "scope": {"selected_features": result["summary"]["selected_features"],
                          "original_source_sha256": info["sha256"],
                          "source_collection_id": selection["source_collection_id"],
                          "source_id": selection["source_id"], "selection_id": key},
                "metadata": {"classification_status": info["classification_status"],
                             "source_title": info["title"], "source_sha256": info["sha256"],
                             "original_id_field": info["id_field"],
                             "rule_reference": rule, "selection": selection,
                             "geometry_derivation": (
                                 "Retained Esri rings interpreted by the declared original parser; original body and per-feature operations retained"
                                 if info.get("geometry_reader") is not None else
                                 "Exact selected native features; original CRS and attributes retained"),
                             **({"geometry_reader": info["geometry_reader"]}
                                if info.get("geometry_reader") is not None else {})},
            }],
        }
        atomic_json(manifest_path, source_manifest)
        imported = workspace.import_sources(manifest_path)
        report = directory / "selection-report.html"
        atomic_bytes(report, _report(result).encode("utf-8"))
        geojson = directory / "selected-features.geojson"
        csv_path = directory / "selected-features.csv"
        export_features(workspace, selection, geojson, format="geojson")
        export_features(workspace, selection, csv_path, format="csv")
        record = {
            "schema": "upstate.water-designation/v1", "id": key, "state": "complete",
            "created_at": now(), "title": selection["title"], "purpose": selection["purpose"],
            "selection": selection, "source": info, "summary": result["summary"],
            "rule_reference": rule, "measure_notes": MEASURE_NOTES,
            "delivery_overlay": {"source_collection_id": imported["id"],
                                 "source_id": "water-designation-" + key, "layer": LAYER,
                                 "selection_id": key, "rule_reference": rule,
                                 "native_source_sha256": info["sha256"]},
            "files": {name: describe_file(directory, path) for name, path in {
                "geopackage": gpkg, "geojson": geojson, "csv": csv_path,
                "report": report, "selection": selected_ids_path, "source_manifest": manifest_path,
                "rule_reference": rule_path,
            }.items()},
        }
        atomic_json(state_path, record, immutable=True)
        return record

def get(workspace, key):
    key = identifier(key)
    spec = workspace._get(SPEC_KIND, key)
    directory = workspace.root / "water-designations" / key
    result = read_json(directory / "selection.json")
    if (result.get("id") != key or result.get("state") != "complete"
            or result.get("selection") != spec["selection"] or result.get("source") != spec["source"]):
        raise ValueError("The retained water-designation selection changed")
    for item in result["files"].values():
        verify_file(directory, item)
    return result

def selections(workspace):
    folder = workspace.root / "water-designations"
    if not folder.exists():
        return []
    return [get(workspace, path.parent.name)
            for path in sorted(folder.glob("*/selection.json"))]

def apply_to_delivery(workspace, selection_id, delivery_selection):
    """Bind a saved selection to both map geometry and report source lineage."""
    if not isinstance(delivery_selection, dict):
        raise ValueError("Delivery selection must be a JSON object")
    result = get(workspace, selection_id)
    value = json.loads(json.dumps(delivery_selection))
    overlays = value.setdefault("overlays", {})
    source_roles = value.setdefault("source_roles", {})
    if not isinstance(overlays, dict) or not isinstance(source_roles, dict):
        raise ValueError("Delivery overlays and source_roles must be JSON objects")
    role = {"high_quality_waters": "HIGH_QUALITY_WATERS",
            "drinking_water": "SOURCE_WATER_PROTECTION_AREAS",
            "protected_lands": "PROTECTED_LANDS_OVERLAY"}[result["purpose"]]
    choice = result["delivery_overlay"]
    overlays[result["purpose"]] = json.loads(json.dumps(choice))
    source_roles[role] = json.loads(json.dumps(choice))
    notes = value.setdefault("notes", [])
    if not isinstance(notes, list):
        raise ValueError("Delivery notes must be a list")
    line = "Water designation: " + result["title"] + " · source " + str(result["source"]["vintage"])
    if line not in notes:
        notes.append(line)
    return value

def verify_all(workspace):
    """Verify every complete retained designation during portable receiving."""
    records = selections(workspace)
    return {"water_designations": len(records), "selection_ids": [r["id"] for r in records]}

def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    for name in ("inspect", "preview", "save", "export"):
        command = sub.add_parser(name)
        command.add_argument("selection_json")
        if name in ("inspect", "preview"):
            command.add_argument("--offset", type=int, default=0)
            command.add_argument("--limit", type=int, default=500)
        if name == "export":
            command.add_argument("--format", choices=("geojson", "csv"), default="geojson")
            command.add_argument("--output", required=True)
    get_command = sub.add_parser("get")
    get_command.add_argument("selection_id")
    apply_command = sub.add_parser("apply")
    apply_command.add_argument("selection_id")
    apply_command.add_argument("delivery_json")
    apply_command.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "list":
        result = {"sources": sources(workspace), "selections": selections(workspace)}
    elif args.command == "get":
        result = get(workspace, args.selection_id)
    elif args.command == "apply":
        result = apply_to_delivery(workspace, args.selection_id, read_json(args.delivery_json))
        atomic_json(args.output, result)
    else:
        choice = read_json(args.selection_json)
        if args.command == "save":
            result = save(workspace, choice)
        elif args.command == "export":
            result = export_features(workspace, choice, args.output, format=args.format)
        else:
            result = globals()[args.command](workspace, choice, offset=args.offset, limit=args.limit)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))

if __name__ == "__main__":
    main()
