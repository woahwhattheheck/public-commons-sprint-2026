"""Portable field/scenario design; actual model execution stays with the ECO compiler.

Only original coordinates, property bindings, and user-authored edits are compiled.
The module has no dependency on ECO's core writers or HTTP implementation.
"""
from __future__ import annotations
import copy
import csv
import hashlib
import html
import io
import json
import math
import re
import uuid
import zipfile
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from pyproj import Geod
from shapely.geometry import shape
from shapely.validation import explain_validity

SCHEMA = "eco.scenario-design/v1"
HANDOFF_SCHEMA = "eco.scenario-design.handoff/v1"
GEOD = Geod(ellps="WGS84")
MAX_FEATURES = 25000
MAX_VERTICES = 1000000
MAX_ALTERNATIVES = 100
KEY = re.compile(r"^[A-Za-z0-9_-]{1,96}$")

class DesignError(ValueError):
    pass

def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def _wire_value(value: Any) -> Any:
    # JavaScript JSON serializes 1.0 as 1. Canonicalize this equivalence before
    # hashing rather than rejecting an unchanged baseline after browser saving.
    if isinstance(value, float) and math.isfinite(value) and value.is_integer() and abs(value) <= 9007199254740991:
        return int(value)
    if isinstance(value, dict):
        return {k: _wire_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_wire_value(v) for v in value]
    return value

def encode(value: Any) -> bytes:
    return json.dumps(_wire_value(value), ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")

def digest(value: Any) -> str:
    return hashlib.sha256(encode(value)).hexdigest()

def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def require(condition: Any, message: str) -> None:
    if not condition:
        raise DesignError(message)

def _key(value: Any, context: str) -> str:
    require(isinstance(value, str) and KEY.fullmatch(value), f"Invalid {context}")
    return value

def _geometry_info_uncached(geometry: dict, context: str = "geometry") -> dict:
    """Validate explicit WGS84 Polygon/MultiPolygon, including holes and topology.

    Dateline-spanning edges and hemispheric polygons are deliberately rejected:
    the editor uses a local longitude/latitude viewport, not a wrapped world map.
    No CRS is guessed or transformed and a third coordinate is retained unchanged.
    """
    require(isinstance(geometry, dict), f"{context}: geometry must be an object")
    kind = geometry.get("type")
    require(kind in ("Polygon", "MultiPolygon"), f"{context}: Polygon or MultiPolygon required")
    coordinates = geometry.get("coordinates")
    require(isinstance(coordinates, list) and coordinates, f"{context}: empty coordinates")
    polygons = [coordinates] if kind == "Polygon" else coordinates
    vertices = 0
    for polygon in polygons:
        require(isinstance(polygon, list) and polygon, f"{context}: empty polygon")
        for ring in polygon:
            require(isinstance(ring, list) and len(ring) >= 4, f"{context}: ring needs 3 vertices and closure")
            require(ring[0] == ring[-1], f"{context}: ring is not explicitly closed")
            for p in ring:
                require(isinstance(p, list) and 2 <= len(p) <= 3 and all(finite_number(x) for x in p),
                        f"{context}: positions must contain 2 or 3 finite coordinates")
                require(-180 <= p[0] <= 180 and -90 <= p[1] <= 90,
                        f"{context}: coordinates must be WGS84 longitude/latitude")
            require(all(abs(a[0] - b[0]) <= 180 for a, b in zip(ring, ring[1:])),
                    f"{context}: dateline-spanning edges require a regional split before editing")
            vertices += len(ring) - 1
    require(vertices <= MAX_VERTICES, f"{context}: vertex limit exceeded")
    try:
        obj = shape(geometry)
        require(not obj.is_empty and obj.is_valid, f"{context}: {explain_validity(obj)}")
        require(obj.bounds[2] - obj.bounds[0] < 180, f"{context}: extent must be less than 180 degrees")
        area = 0.0
        perimeter = 0.0
        # Explicit ring subtraction makes area independent of incoming ring orientation.
        for polygon in polygons:
            ring_areas = []
            for ring in polygon:
                a, p = GEOD.polygon_area_perimeter([x[0] for x in ring], [x[1] for x in ring])
                ring_areas.append(abs(a))
                perimeter += abs(p)
            area += ring_areas[0] - sum(ring_areas[1:])
        require(area > 0, f"{context}: non-positive geodesic area")
        return {"area_m2": area, "area_ha": area / 10000, "boundary_m": perimeter,
                "vertices": vertices, "bounds": list(obj.bounds)}
    except (TypeError, ValueError, IndexError, OverflowError) as e:
        if isinstance(e, DesignError):
            raise
        raise DesignError(f"{context}: invalid geometry ({e})") from e

@lru_cache(maxsize=8192)
def _geometry_summary(payload: bytes) -> dict:
    return _geometry_info_uncached(json.loads(payload))

def geometry_info(geometry: dict, context: str = "geometry") -> dict:
    """Content-keyed geometry measurements, shared across unchanged alternatives.

    Only small geometry keys are retained; model/project objects are not cached.
    New coordinate content gets a new validation. Results are defensive copies.
    """
    try:
        payload = encode(geometry)
        if len(payload) > 16384:
            return _geometry_info_uncached(geometry, context)
        result = _geometry_summary(payload)
        return {**result, "bounds": list(result["bounds"])}
    except (TypeError, ValueError) as e:
        raise DesignError(f"{context}: {e}") from e

def geometry_cache_stats() -> dict:
    info = _geometry_summary.cache_info()
    return {"hits": info.hits, "misses": info.misses, "entries": info.currsize,
            "capacity": info.maxsize, "maximum_key_bytes": 16384}

def validate_feature(feature: Any, context: str) -> dict:
    require(isinstance(feature, dict) and feature.get("type") == "Feature", f"{context}: Feature required")
    require(isinstance(feature.get("properties"), (dict, type(None))), f"{context}: properties must be object or null")
    # GeoJSON RFC 7946 has no alternate CRS. Reject legacy declarations rather than guessing.
    require("crs" not in feature and (not isinstance(feature.get("geometry"), dict) or "crs" not in feature["geometry"]), f"{context}: transform legacy CRS before import")
    return geometry_info(feature.get("geometry"), context)

def validate_collection(collection: Any) -> list[dict]:
    require(isinstance(collection, dict) and collection.get("type") == "FeatureCollection", "GeoJSON FeatureCollection required")
    require("crs" not in collection, "Legacy CRS declaration found. Export explicit WGS84 GeoJSON before import.")
    features = collection.get("features")
    require(isinstance(features, list) and 0 < len(features) <= MAX_FEATURES,
            f"Import between 1 and {MAX_FEATURES} polygon features")
    infos = [validate_feature(f, f"field {i+1}") for i, f in enumerate(features)]
    require(sum(x["vertices"] for x in infos) <= MAX_VERTICES, "Dataset vertex limit exceeded")
    xmin, xmax = min(x["bounds"][0] for x in infos), max(x["bounds"][2] for x in infos)
    require(xmax - xmin < 180, "Dataset spans 180 degrees or more; import one regional area")
    return infos

def new_project(collection: dict, title: str, filename: str = "fields.geojson", raw_bytes: bytes | None = None) -> dict:
    validate_collection(collection)
    stamp = now()
    result = {"schema": SCHEMA, "id": str(uuid.uuid4()), "title": title.strip() or "Field scenario project",
              "created_at": stamp, "updated_at": stamp,
              "baseline": {"collection": copy.deepcopy(collection),
                           "feature_keys": [f"f_{i+1:06d}" for i in range(len(collection["features"]))],
                           "source": {"filename": str(filename), "imported_at": stamp,
                                      "original_bytes_sha256": hashlib.sha256(raw_bytes).hexdigest() if raw_bytes is not None else None,
                                      "canonical_collection_sha256": digest(collection)}},
              "parameters": [], "alternatives": []}
    return result

def _parameters(project: dict) -> dict:
    items = project.get("parameters", [])
    require(isinstance(items, list) and len(items) <= 250, "Invalid parameter registry")
    output = {}
    properties = set()
    for p in items:
        require(isinstance(p, dict), "Parameter must be an object")
        pid = _key(p.get("id"), "parameter id")
        name = p.get("property")
        require(isinstance(name, str) and 0 < len(name) <= 500, f"{pid}: a source property must be explicitly bound")
        require(name not in ("__proto__", "constructor", "prototype"), f"{pid}: reserved property name")
        require(pid not in output and name not in properties, "Duplicate parameter id or source property")
        for limit in ("min", "max"):
            require(p.get(limit) is None or finite_number(p[limit]), f"{pid}: {limit} must be a finite number")
        require(p.get("min") is None or p.get("max") is None or p["min"] <= p["max"], f"{pid}: min exceeds max")
        require(isinstance(p.get("unit", ""), str) and isinstance(p.get("label", name), str), f"{pid}: label/unit must be text")
        output[pid] = p
        properties.add(name)
    return output

def validate_project(project: Any) -> dict:
    require(isinstance(project, dict) and project.get("schema") == SCHEMA, f"Project schema must be {SCHEMA}")
    _key(project.get("id"), "project id")
    require(isinstance(project.get("title"), str) and 0 < len(project["title"]) <= 500, "Project title required (max 500 characters)")
    baseline = project.get("baseline", {})
    collection = baseline.get("collection")
    infos = validate_collection(collection)
    keys = baseline.get("feature_keys")
    require(isinstance(keys, list) and len(keys) == len(infos), "Baseline key count mismatch")
    require(len(set(keys)) == len(keys), "Baseline keys must be unique")
    for key in keys:
        _key(key, "field key")
    source = baseline.get("source", {})
    require(source.get("canonical_collection_sha256") == digest(collection), "Original baseline changed: use a new import rather than rewriting provenance")
    if source.get("conservation") is not None:
        if __package__:
            from .conservation import binding_for
        else:
            from conservation import binding_for
        binding_for(project)
    params = _parameters(project)
    alternatives = project.get("alternatives", [])
    require(isinstance(alternatives, list) and len(alternatives) <= MAX_ALTERNATIVES, "Invalid alternatives")
    seen = set()
    for alt in alternatives:
        aid = _key(alt.get("id"), "alternative id")
        require(aid not in seen, "Duplicate alternative id")
        seen.add(aid)
        require(isinstance(alt.get("title"), str) and 0 < len(alt["title"]) <= 500, "Alternative title required")
        additions = alt.get("additions", [])
        require(isinstance(additions, list) and len(additions) + len(keys) <= MAX_FEATURES, "Too many added fields")
        all_keys = set(keys)
        features = dict(zip(keys, collection["features"]))
        for added in additions:
            key = _key(added.get("key"), "added field key")
            require(key not in all_keys, "Duplicate added field key")
            all_keys.add(key)
            features[key] = added.get("feature")
            validate_feature(features[key], f"{aid}/{key}")
        edits = alt.get("edits", {})
        require(isinstance(edits, dict), "Alternative edits must be an object")
        for key, edit in edits.items():
            require(key in all_keys and isinstance(edit, dict), f"{aid}/{key}: unknown field or malformed edit")
            require(not (set(edit) - {"geometry", "values", "excluded", "note"}), f"{aid}/{key}: unknown edit operation")
            require(isinstance(edit.get("excluded", False), bool), f"{aid}/{key}: excluded must be boolean")
            require(isinstance(edit.get("note", ""), str), f"{aid}/{key}: note must be text")
            if "geometry" in edit:
                geometry_info(edit["geometry"], f"{aid}/{key}")
            require(isinstance(edit.get("values", {}), dict), f"{aid}/{key}: values must be object")
            for pid, value in edit.get("values", {}).items():
                require(pid in params, f"{aid}/{key}: unknown parameter {pid}")
                p = params[pid]
                require(finite_number(value), f"{aid}/{key}/{pid}: a finite numeric value is required")
                require(p.get("min") is None or value >= p["min"], f"{aid}/{key}/{pid}: below minimum")
                require(p.get("max") is None or value <= p["max"], f"{aid}/{key}/{pid}: above maximum")
        realized = _realize(project, alt)
        require(realized["features"], f"{aid}: keep at least one field")
        validate_collection(realized)
    return {"features": len(infos), "vertices": sum(x["vertices"] for x in infos),
            "alternatives": len(alternatives), "area_ha": sum(x["area_ha"] for x in infos)}

def _realize(project: dict, alt: dict | None) -> dict:
    baseline = project["baseline"]
    original = baseline["collection"]
    output = copy.deepcopy(original)
    # An imported collection bbox is invalid after scenario edits. Preserve it only on baseline.
    if alt is not None:
        output.pop("bbox", None)
    if alt is None:
        return output
    params = {p["id"]: p for p in project["parameters"]}
    output["features"] = []
    pairs = list(zip(baseline["feature_keys"], original["features"]))
    pairs.extend((x["key"], x["feature"]) for x in alt.get("additions", []))
    for key, original_feature in pairs:
        edit = alt.get("edits", {}).get(key, {})
        if edit.get("excluded"):
            continue
        feature = copy.deepcopy(original_feature)
        if "geometry" in edit:
            feature["geometry"] = copy.deepcopy(edit["geometry"])
            feature.pop("bbox", None)
        values = edit.get("values", {})
        if values:
            if feature["properties"] is None:
                feature["properties"] = {}
            for pid, value in values.items():
                feature["properties"][params[pid]["property"]] = value
        output["features"].append(feature)
    return output

def realize(project: dict, alternative_id: str | None = None) -> dict:
    validate_project(project)
    if alternative_id is None or alternative_id == "baseline":
        return _realize(project, None)
    alt = next((x for x in project["alternatives"] if x["id"] == alternative_id), None)
    require(alt is not None, "Alternative does not exist")
    return _realize(project, alt)

def actions(project: dict, alt: dict) -> list[dict]:
    """Exact input-delta ledger, not predicted model outcomes or scenario costs."""
    originals = dict(zip(project["baseline"]["feature_keys"], project["baseline"]["collection"]["features"]))
    added_keys = set()
    for item in alt.get("additions", []):
        originals[item["key"]] = item["feature"]
        added_keys.add(item["key"])
    params = {p["id"]: p for p in project["parameters"]}
    rows = []
    def row(key, op, target, before, after, unit=""):
        rows.append({"alternative_id": alt["id"], "alternative_title": alt["title"], "field_key": key,
                     "operation": op, "target": target, "before_json": encode(before).decode("utf-8"),
                     "after_json": encode(after).decode("utf-8"), "unit": unit,
                     "note": alt.get("edits", {}).get(key, {}).get("note", "")})
    for key in added_keys:
        row(key, "add_feature", "feature", None, originals[key])
    for key, edit in alt.get("edits", {}).items():
        if edit.get("excluded"):
            row(key, "exclude_feature", "feature", originals[key], None)
        if "geometry" in edit:
            row(key, "replace_geometry", "geometry", originals[key]["geometry"], edit["geometry"])
        for pid, value in edit.get("values", {}).items():
            p = params[pid]
            old = (originals[key].get("properties") or {}).get(p["property"])
            row(key, "set_parameter", p["property"], old, value, p.get("unit", ""))
        if edit.get("note") and not (edit.get("excluded") or "geometry" in edit or edit.get("values")):
            row(key, "annotate", "note", None, edit["note"])
    return sorted(rows, key=lambda r: (r["field_key"], r["operation"], r["target"]))

def export_bundle(project: dict) -> bytes:
    validate_project(project)
    files = {"project.json": encode(project), "baseline.geojson": encode(project["baseline"]["collection"])}
    entries = []
    action_rows = []
    base_area = sum(geometry_info(f["geometry"])["area_ha"] for f in project["baseline"]["collection"]["features"])
    for alt in project["alternatives"]:
        name = f"alternatives/{alt['id']}.geojson"
        collection = _realize(project, alt)
        payload = encode(collection)
        files[name] = payload
        rows = actions(project, alt)
        action_rows.extend(rows)
        field_keys = [k for k in project["baseline"]["feature_keys"] if not alt.get("edits", {}).get(k, {}).get("excluded")]
        field_keys += [x["key"] for x in alt.get("additions", []) if not alt.get("edits", {}).get(x["key"], {}).get("excluded")]
        area = sum(geometry_info(f["geometry"])["area_ha"] for f in collection["features"])
        entries.append({"id": alt["id"], "title": alt["title"], "geojson": name,
                        "sha256": hashlib.sha256(payload).hexdigest(), "feature_keys_in_order": field_keys,
                        "feature_count": len(field_keys), "area_ha": area, "baseline_area_delta_ha": area - base_area,
                        "action_count": len(rows)})
    handoff = {"schema": HANDOFF_SCHEMA, "project_id": project["id"], "project_title": project["title"],
               "project_canonical_sha256": digest(project), "crs": "OGC:CRS84", "baseline": "baseline.geojson",
               "baseline_feature_keys_in_order": project["baseline"]["feature_keys"],
               "source": project["baseline"]["source"], "parameters": project["parameters"],
               "alternatives": entries, "actions": "actions.csv", "editable_project": "project.json",
               "meaning": "Explicit field geometry and source-property inputs for a downstream scenario compiler; measured areas are geodesic, not simulated outcomes."}
    files["handoff.json"] = encode(handoff)
    buf = io.StringIO(newline="")
    columns = ["alternative_id", "alternative_title", "field_key", "operation", "target", "before_json", "after_json", "unit", "note"]
    writer = csv.DictWriter(buf, fieldnames=columns)
    writer.writeheader()
    # CSV formula injection prevention; JSON columns begin with a JSON literal and are safe.
    for r in action_rows:
        writer.writerow({k: ("'" + v if isinstance(v, str) and v.startswith(("=", "+", "-", "@", "\t", "\r")) else v) for k, v in r.items()})
    files["actions.csv"] = buf.getvalue().encode("utf-8")
    esc = html.escape
    trs = "".join(f"<tr><td>{esc(x['title'])}</td><td>{x['feature_count']}</td><td>{x['area_ha']:,.4f}</td><td>{x['baseline_area_delta_ha']:+,.4f}</td><td>{x['action_count']}</td></tr>" for x in entries)
    files["design-summary.html"] = ("<!doctype html><meta charset='utf-8'><title>Scenario design handover</title><style>body{font:15px system-ui;max-width:1000px;margin:40px;color:#222}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #bbb}code{overflow-wrap:anywhere}</style>"
        f"<h1>{esc(project['title'])}</h1><p>Field geometry and explicit parameter design • WGS84</p><p>Original: {esc(project['baseline']['source']['filename'])}. Baseline: {len(project['baseline']['feature_keys'])} fields; {base_area:,.4f} ha (sum of field areas, including any overlaps).</p>"
        f"<table><tr><th>Alternative</th><th>Fields</th><th>Area (ha)</th><th>Area change (ha)</th><th>Input actions</th></tr>{trs}</table><p>Areas are ellipsoidal geodesic measurements. Ecological outcome modeling belongs to the consuming ECO pipeline. Original feature IDs, unknown properties, holes, and polygon parts are retained.</p>"
        f"<p>Project SHA-256: <code>{digest(project)}</code></p><p>Reopen <code>project.json</code> in Scenario Design to independently edit any alternative. <code>handoff.json</code> binds feature keys to the exported order. <code>actions.csv</code> contains complete before/after input values.</p>").encode("utf-8")
    files["README.txt"] = b"ECO Scenario Design handover\nReopen project.json in the scenario design workbench.\nThe GeoJSON files are WGS84 inputs, not ecological model results.\nAlternative feature keys and explicit source-property bindings are in handoff.json.\nUse the actual ECO scenario compiler to translate these inputs into its native manifest.\nCSV text cells beginning with spreadsheet formula characters are apostrophe-prefixed.\nOriginal imported source byte hashes, when available, identify the original source file;\nbaseline.geojson preserves the parsed collection, not its original JSON whitespace.\n"
    files["checksums.json"] = encode({name: hashlib.sha256(value).hexdigest() for name, value in sorted(files.items())})
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, value in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            z.writestr(info, value)
    return out.getvalue()

def receive_bundle(raw: bytes) -> dict:
    """Read a complete handover without extracting paths; verify every member."""
    require(len(raw) <= 100 * 1024 * 1024, "Bundle exceeds 100 MiB")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            infos = z.infolist()
            require(len(infos) <= 110 and sum(x.file_size for x in infos) <= 200 * 1024 * 1024, "Bundle exceeds unpacked limits")
            names = [x.filename for x in infos]
            require(len(names) == len(set(names)) and "project.json" in names and "checksums.json" in names, "Missing or duplicate bundle member")
            expected = json.loads(z.read("checksums.json"))
            require(set(expected) == set(names) - {"checksums.json"}, "Bundle member inventory differs from checksums")
            for name, sha in expected.items():
                require(hashlib.sha256(z.read(name)).hexdigest() == sha, f"Checksum mismatch: {name}")
            project = json.loads(z.read("project.json"))
            validate_project(project)
            handoff = json.loads(z.read("handoff.json"))
            require(handoff.get("project_canonical_sha256") == digest(project), "Handover and project differ")
            # Canonical regeneration ensures original geometry/actions and the project agree.
            expected_zip = export_bundle(project)
            with zipfile.ZipFile(io.BytesIO(expected_zip)) as regenerated:
                require(set(names) == set(regenerated.namelist()), "Unexpected bundle member")
                for name in names:
                    require(z.read(name) == regenerated.read(name), f"Derived handover differs from project: {name}")
            return project
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError, UnicodeDecodeError) as e:
        raise DesignError(f"Invalid handover bundle: {e}") from e
