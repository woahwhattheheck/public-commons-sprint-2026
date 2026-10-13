"""Compare a received working vector with its complete retained original source."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time
import base64
import csv
import html
import json
import math
from pathlib import Path
import zipfile

from . import gis_project as gis
from . import gis_workspace
from .common import identifier

SCHEMA = "upstate.gis-vector-review/v1"
VERSION = "original-feature-identity-v1"
FOLDER = "gis-vector-reviews"


def _value(value):
    """Keep source nulls, literal strings and finite numbers distinct."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        return {"nonfinite": "NaN" if math.isnan(value) else ("+Infinity" if value > 0 else "-Infinity")}
    if isinstance(value, (date, datetime, time)):
        return {"type": type(value).__name__, "value": value.isoformat()}
    if isinstance(value, bytes):
        return {"type": "bytes", "base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, dict):
        return {str(key): _value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_value(item) for item in value]
    raise ValueError("Unsupported original attribute type: " + type(value).__name__)


def _geometry(value):
    from shapely.geometry import shape
    from shapely.validation import explain_validity
    if value is None:
        return None, {"null": True, "valid": True, "empty": False, "type": None}
    try:
        geometry = shape(value)
        bounds = list(geometry.bounds)
        public = {"null": False, "type": geometry.geom_type,
                  "valid": bool(geometry.is_valid), "empty": bool(geometry.is_empty),
                  "has_z": bool(geometry.has_z), "has_m": bool(getattr(geometry, "has_m", False)),
                  "bounds": bounds if all(math.isfinite(v) for v in bounds) else None}
        if not geometry.is_valid:
            public["reason"] = explain_validity(geometry)
        return geometry, public
    except Exception as error:
        return None, {"null": False, "valid": False, "empty": False,
                      "type": value.get("type"), "reason": str(error)}


def _z_coordinates(geometry):
    from shapely.geometry import mapping
    def visit(value):
        if isinstance(value, dict):
            for key in ("coordinates", "geometries"):
                if key in value:
                    yield from visit(value[key])
        elif isinstance(value, (tuple, list)):
            if value and all(isinstance(x, (int, float)) for x in value):
                yield gis.canonical(_value(list(value))).decode("utf-8")
            else:
                for child in value:
                    yield from visit(child)
    return Counter(visit(mapping(geometry)))


def _geometry_change(before, after):
    original, original_info = before
    working, working_info = after
    result = {"original": original_info, "working": working_info,
              "xy_equal": None, "z_equal": None, "changed": None}
    if original_info.get("has_m") or working_info.get("has_m"):
        result["reason"] = "Measured coordinates require an explicit M-aware comparison; no equality assumption was applied."
        return result
    if not original_info["valid"] or not working_info["valid"]:
        result["reason"] = "Invalid geometry; no repair or equality assumption was applied."
        return result
    if original_info["null"] or working_info["null"]:
        result["xy_equal"] = original_info["null"] == working_info["null"]
        result["changed"] = not result["xy_equal"]
        return result
    try:
        result["xy_equal"] = bool(original.equals(working))
        if original_info.get("has_z") or working_info.get("has_z"):
            result["z_equal"] = (original_info.get("has_z") == working_info.get("has_z")
                                 and _z_coordinates(original) == _z_coordinates(working))
        result["changed"] = (not result["xy_equal"] or result["z_equal"] is False
                             or original_info["type"] != working_info["type"])
    except Exception as error:
        result["reason"] = str(error)
    return result


def _binding(project, layer):
    requests = [row for row in project.get("source_request", {}).get("layers", [])
                if row.get("id") == layer["id"]]
    if len(requests) != 1 or requests[0].get("kind") != "vector":
        raise ValueError("The vector has no unique original source request: " + layer["id"])
    request = requests[0]
    requested = [request["file"], *request.get("companions", [])]
    retained = layer["originals"]
    if len(requested) != len(retained) or any(
            (want["path"], want["bytes"], want["sha256"]) !=
            (have.get("source_path"), have["bytes"], have["sha256"])
            for want, have in zip(requested, retained)):
        raise ValueError("The retained original vector members differ from their source request.")
    if request.get("where", {}) != layer["data"].get("where", {}):
        raise ValueError("The original feature selection differs from its retained source request.")
    return request


def compare_layer(root, project, layer):
    """Read exact original/working members; never match features by display order."""
    import fiona
    from pyproj import CRS
    request = _binding(project, layer)
    for descriptor in layer["originals"]:
        gis.checked(root, descriptor)
    source_path = gis.local(root, layer["originals"][0]["path"])
    working_path = gis.local(root, layer["working_path"])
    data = layer["data"]
    identity_field = data.get("source_identity_field")
    field_map = data.get("source_field_map")
    if not isinstance(identity_field, str) or not identity_field or not isinstance(field_map, dict):
        raise ValueError("This vector lacks its retained original feature-identity mapping.")
    original_rows, working_rows = defaultdict(list), defaultdict(list)
    missing = []
    where = request.get("where", {})
    with fiona.open(gis._vector_path(source_path), layer=request.get("layer")) as source:
        if not source.crs_wkt and not source.crs:
            raise ValueError("The retained original vector has no declared CRS.")
        source_crs = CRS.from_user_input(source.crs_wkt or source.crs)
        original_fields = dict(source.schema["properties"])
        if (set(field_map) != set(original_fields) or
                any(not isinstance(v, str) or not v for v in field_map.values()) or
                len(set(field_map.values())) != len(field_map) or identity_field in field_map.values()):
            raise ValueError("The original attribute-to-working-field mapping is incomplete or ambiguous.")
        if not isinstance(where, dict) or set(where) - set(original_fields):
            raise ValueError("The retained source predicate names unavailable original fields.")
        for index, feature in enumerate(source):
            properties = dict(feature["properties"])
            if any(properties.get(key) != value for key, value in where.items()):
                continue
            key = str(feature.id)
            original_rows[key].append({"feature_id": key, "index": index,
                "properties": {name: _value(value) for name, value in properties.items()},
                "geometry": _geometry(feature["geometry"])})
    with fiona.open(working_path, layer=data["layer"]) as working:
        if not working.crs_wkt and not working.crs:
            raise ValueError("The working vector has no declared CRS.")
        working_crs = CRS.from_user_input(working.crs_wkt or working.crs)
        working_fields = dict(working.schema["properties"])
        identity_missing = identity_field not in working_fields
        for index, feature in enumerate(working):
            properties = dict(feature["properties"])
            row = {"feature_id": str(feature.id), "index": index,
                "properties": {name: _value(value) for name, value in properties.items()},
                "geometry": _geometry(feature["geometry"])}
            key = properties.get(identity_field)
            if not isinstance(key, str) or not key:
                row["identity_value"] = _value(key)
                missing.append(row)
            else:
                working_rows[key].append(row)
    equivalent = bool(source_crs.equals(working_crs))
    mapped = set(field_map.values())
    added_fields = [name for name in working_fields if name not in mapped and name != identity_field]
    removed_fields = [name for name, destination in field_map.items() if destination not in working_fields]
    type_changes = [{"field": name, "working_field": destination,
                     "original_type": original_fields[name], "working_type": working_fields[destination]}
                    for name, destination in field_map.items() if destination in working_fields
                    and original_fields[name] != working_fields[destination]]
    counts = {key: 0 for key in ("matched", "unchanged", "attribute_changed", "geometry_changed",
              "geometry_unassessed", "added_identities", "removed_identities", "unmatched_original", "ambiguous_ids",
              "missing_working_identity", "invalid_original", "invalid_working")}
    counts.update(original_features=sum(map(len, original_rows.values())),
                  working_features=sum(map(len, working_rows.values())) + len(missing),
                  schema_changes=len(added_fields) + len(removed_fields) + len(type_changes))
    rows = []
    def feature_public(row):
        return {"feature_id": row["feature_id"], "feature_index": row["index"],
                "properties": row["properties"], "geometry": row["geometry"][1]}
    for key in sorted(set(original_rows) | set(working_rows)):
        originals, workings = original_rows[key], working_rows[key]
        if len(originals) > 1 or len(workings) > 1:
            counts["ambiguous_ids"] += 1
            rows.append({"source_id": key, "status": "ambiguous_identity",
                         "original_features": [feature_public(row) for row in originals],
                         "working_features": [feature_public(row) for row in workings],
                         "reason": "The original identity is not unique; these features were not paired."})
            continue
        if not originals:
            counts["added_identities"] += 1
            rows.append({"source_id": key, "status": "added_identity",
                         "reason": "This identifier is absent from the original selection; it may be a new feature or an edited identity.",
                         "working": feature_public(workings[0])})
            continue
        if not workings:
            status = "unmatched_original" if missing else "removed_identity"
            counts["unmatched_original" if missing else "removed_identities"] += 1
            rows.append({"source_id": key, "status": status,
                         "reason": ("Some working identities are missing, so deletion cannot be inferred."
                                    if missing else "This identifier is absent from the working layer; it may be a removed feature or an edited identity."),
                         "original": feature_public(originals[0])})
            continue
        original, working = originals[0], workings[0]
        counts["matched"] += 1
        attributes = []
        for field, destination in field_map.items():
            before = {"present": field in original["properties"],
                      "value": original["properties"].get(field)}
            after = {"present": destination in working["properties"],
                     "value": working["properties"].get(destination)}
            if gis.canonical(before) != gis.canonical(after):
                attributes.append({"field": field, "working_field": destination,
                                   "original": before, "working": after})
        for field in added_fields:
            attributes.append({"field": field, "working_field": field,
                "original": {"present": False},
                "working": {"present": field in working["properties"],
                            "value": working["properties"].get(field)}})
        if equivalent:
            geometry = _geometry_change(original["geometry"], working["geometry"])
        else:
            geometry = {"original": original["geometry"][1], "working": working["geometry"][1],
                "xy_equal": None, "z_equal": None, "changed": None,
                "reason": "Original and working CRS differ; no implicit reprojection was applied."}
        changed = bool(attributes) or geometry["changed"] is True
        status = ("changed" if changed else "unassessed" if geometry["changed"] is None else "unchanged")
        counts["attribute_changed"] += bool(attributes)
        counts["geometry_changed"] += geometry["changed"] is True
        counts["geometry_unassessed"] += geometry["changed"] is None
        counts["unchanged"] += status == "unchanged"
        rows.append({"source_id": key, "status": status,
            "original_feature_id": original["feature_id"], "working_feature_id": working["feature_id"],
            "attributes": attributes, "geometry": geometry})
    for working in missing:
        counts["missing_working_identity"] += 1
        rows.append({"source_id": None, "status": "missing_identity",
                     "identity_value": working["identity_value"], "working": feature_public(working),
                     "reason": "A nonempty literal original identity is required; no positional match was made."})
    counts["invalid_original"] = sum(not row["geometry"][1]["valid"]
                                     for values in original_rows.values() for row in values)
    counts["invalid_working"] = sum(not row["geometry"][1]["valid"]
                                    for values in working_rows.values() for row in values)
    counts["invalid_working"] += sum(not row["geometry"][1]["valid"] for row in missing)
    return {"layer_id": layer["id"], "title": layer["title"], "units": data.get("units"),
            "source_identity_field": identity_field, "identity_field_missing": identity_missing,
            "source_field_map": field_map, "source_selection": where,
            "original_layer": request.get("layer"), "working_layer": data["layer"],
            "originals": layer["originals"], "working_file": gis.record(root, working_path),
            "source": layer.get("source", {}),
            "crs": {"original": source_crs.to_string(), "original_wkt": source_crs.to_wkt(),
                    "working": working_crs.to_string(), "working_wkt": working_crs.to_wkt(),
                    "equivalent": equivalent},
            "fields": {"original": original_fields, "working": working_fields,
                       "added": added_fields, "removed": removed_fields, "type_changes": type_changes},
            "counts": counts, "rows": rows}


def _selection(workspace, payload):
    if not isinstance(payload, dict) or set(payload) != {"receipt_id", "layer_ids"}:
        raise ValueError("Select the received edition and explicit vector-layer identities.")
    parent, receipt, verified = gis_workspace.received(workspace, payload["receipt_id"])
    project = gis.load(parent / "project" / "project.json")
    chosen = payload["layer_ids"]
    if (not isinstance(chosen, list) or not chosen or any(not isinstance(v, str) or not v for v in chosen)
            or len(set(chosen)) != len(chosen)):
        raise ValueError("Choose each received vector layer once.")
    layers = {row["id"]: row for row in project["layers"]}
    if any(key not in layers or layers[key]["data"]["kind"] != "vector" for key in chosen):
        raise ValueError("The selected received layer is not a working vector.")
    selection = {"schema": SCHEMA, "algorithm": VERSION,
        "project_id": workspace.project["id"], "receipt_id": receipt["id"],
        "received_edition_id": project["edition_id"], "received_fingerprint": verified["fingerprint"],
        "layer_ids": chosen}
    return parent / "project", project, layers, selection


def _html(report):
    esc = lambda value: html.escape(str(value), quote=True)
    def encoded(value):
        return esc(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>Working vector change review</title><style>',
        'body{font:15px system-ui,sans-serif;color:#202020;background:#f5f5f5;margin:0;padding:28px;max-width:1300px}'
        'section,details{background:#fff;border:1px solid #bbb;padding:16px;margin:16px 0}'
        'table{border-collapse:collapse;width:100%}th,td{padding:8px;text-align:left;border:1px solid #bbb;vertical-align:top}'
        'pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}h1,h2{font-weight:600}'
        'summary{cursor:pointer}a{color:#222}small{color:#444}</style><h1>Working vector change review</h1>',
        '<p>This review compares each received working vector with its retained original source selection.</p>',
        '<p>Features are paired only by their retained original identity. XY geometry uses topological equality; '
        'Z values use the complete coordinate multiset. No geometry repair, area conversion or implicit reprojection is applied.</p>',
        '<p>The complete ZIP also contains review.json and feature-changes.csv beside this HTML.</p>',
        '<p>Received edition: <code>' + esc(report["selection"]["received_edition_id"]) + '</code></p>']
    for layer in report["layers"]:
        parts.extend(['<section><h2>' + esc(layer["title"]) + '</h2>',
            '<p>Original CRS: ' + esc(layer["crs"]["original"]) + ' · Working CRS: ' + esc(layer["crs"]["working"]) + '</p>',
            '<p>Identity field: <code>' + esc(layer["source_identity_field"]) + '</code></p>',
            '<pre>' + encoded(layer["counts"]) + '</pre><details><summary>Source, units and field schema</summary><pre>' +
            encoded({k: layer[k] for k in ("source", "units", "fields", "source_selection", "originals")}) + '</pre></details>',
            '<table><thead><tr><th>Original identity</th><th>Review</th><th>Exact changes and source context</th></tr></thead><tbody>'])
        for row in layer["rows"]:
            detail = {key: value for key, value in row.items() if key not in ("source_id", "status")}
            parts.append('<tr><td><code>' + esc(row["source_id"] if row["source_id"] is not None else "(missing)") +
                '</code></td><td>' + esc(row["status"]) + '</td><td><details><summary>Open feature details</summary><pre>' +
                encoded(detail) + '</pre></details></td></tr>')
        parts.append('</tbody></table></section>')
    parts.append('<p>Retained review ' + esc(report["id"]) + '</p></html>')
    return "".join(parts)


def build(workspace, payload):
    root, project, layers, selection = _selection(workspace, payload)
    key = gis.fingerprint(selection)
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with gis.locked(directory / ".review.lock"):
        if (directory / "summary.json").is_file():
            return inspect(workspace, key)
        reviews = [compare_layer(root, project, layers[layer_id]) for layer_id in selection["layer_ids"]]
        report = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                  "selection": selection, "layers": reviews}
        gis.save(directory / "review.json", report)
        with (directory / "feature-changes.csv").open("w", encoding="utf-8", newline="") as stream:
            fields = ("layer_id", "source_id", "status", "original_feature_id", "working_feature_id",
                      "attribute_changes_json", "geometry_json", "feature_context_json")
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            for layer in reviews:
                for row in layer["rows"]:
                    writer.writerow({"layer_id": layer["layer_id"], "source_id": row["source_id"],
                        "status": row["status"], "original_feature_id": row.get("original_feature_id", ""),
                        "working_feature_id": row.get("working_feature_id", ""),
                        "attribute_changes_json": json.dumps(row.get("attributes", []), ensure_ascii=False),
                        "geometry_json": json.dumps(row.get("geometry"), ensure_ascii=False),
                        "feature_context_json": json.dumps({k: v for k, v in row.items()
                            if k not in ("attributes", "geometry")}, ensure_ascii=False)})
        (directory / "review.html").write_text(_html(report), encoding="utf-8")
        # Complete original review files travel together for ordinary offline opening.
        with zipfile.ZipFile(directory / "vector-review.zip", "w",
                             compression=zipfile.ZIP_DEFLATED) as archive:
            for name in ("review.json", "feature-changes.csv", "review.html"):
                entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, (directory / name).read_bytes())
        files = {name: gis.record(workspace.root, directory / name)
                 for name in ("review.json", "feature-changes.csv", "review.html", "vector-review.zip")}
        summary = {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"], "state": "complete",
                   "title": project["title"] + " · working vector review", "selection": selection,
                   "layers": [{k: row[k] for k in ("layer_id", "title", "counts", "crs",
                              "identity_field_missing", "source_identity_field")} for row in reviews],
                   "files": files}
        gis.save(directory / "summary.json", summary)
        return summary


def inspect(workspace, key):
    key = identifier(key)
    summary = gis.load(workspace.root / FOLDER / key / "summary.json")
    selection = summary["selection"]
    if (summary.get("schema") != SCHEMA or summary.get("id") != key or
            summary.get("project_id") != workspace.project["id"] or
            selection.get("project_id") != workspace.project["id"] or gis.fingerprint(selection) != key):
        raise ValueError("This retained vector review belongs to another original project or selection.")
    _, _, _, current = _selection(workspace, {
        "receipt_id": selection["receipt_id"], "layer_ids": selection["layer_ids"]})
    if current != selection:
        raise ValueError("The received vector edition differs from this retained review.")
    names = {"review.json", "feature-changes.csv", "review.html", "vector-review.zip"}
    if set(summary["files"]) != names:
        raise ValueError("The retained review file set changed.")
    for name, descriptor in summary["files"].items():
        if descriptor["path"] != (Path(FOLDER) / key / name).as_posix():
            raise ValueError("The review member is outside its retained review directory.")
        gis.checked(workspace.root, descriptor)
    report = gis.load(gis.local(workspace.root, summary["files"]["review.json"]["path"]))
    expected_layers = [{k: row[k] for k in ("layer_id", "title", "counts", "crs",
                       "identity_field_missing", "source_identity_field")} for row in report["layers"]]
    if (report.get("schema") != SCHEMA or report.get("id") != key or report.get("selection") != selection
            or report.get("project_id") != workspace.project["id"] or expected_layers != summary["layers"]
            or [row["layer_id"] for row in report["layers"]] != selection["layer_ids"]):
        raise ValueError("The complete vector review differs from its retained selection.")
    return summary


def catalog(workspace):
    rows = []
    for path in sorted((workspace.root / FOLDER).glob("*/summary.json")):
        value = gis.load(path)
        if (value.get("schema") != SCHEMA or value.get("id") != path.parent.name
                or value.get("project_id") != workspace.project["id"]
                or gis.fingerprint(value["selection"]) != value["id"]):
            raise ValueError("A retained vector-review identity changed.")
        rows.append({key: value[key] for key in ("id", "title", "state", "selection", "layers")})
    return rows
