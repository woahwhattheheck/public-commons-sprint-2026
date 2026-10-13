"""Compile original receiving-water sources into model-ready receptor catalogs.

Uses the application's content-addressed Workspace and original vector assets.
Compilation is offline. No geometry is fabricated, buffered, or promoted to a
legal designation. Source selection, legal vintage, and drainage relationships
remain separate fields. See docs/receiving_water_catalog.md.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
from collections import Counter
from copy import deepcopy
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

SC_RULES_URL = "https://www.des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf"
CATALOG_SCHEMA = "upstate.receiving-water-catalog/1"
SELECTION_SCHEMA = "upstate.receiving-water-selection/1"
CLASS_CODES = ("ONRW", "ORW", "SFH", "TN", "TPGT", "TPT", "FW", "SA", "SB")
HIGH_QUALITY_CHOICES = ("ONRW", "ORW", "TN", "TPGT", "TPT")
VINTAGE_STATUSES = ("effective", "proposed", "historical", "unknown")
RULE_REFERENCES = [
    {"url": SC_RULES_URL, "section": "A",
     "meaning": "Site-specific standards apply to the named water unless stated otherwise."},
    {"url": SC_RULES_URL, "section": "B",
     "meaning": "Unlisted tributary use classifications have a separate regulatory rule; this compiler preserves named-source geometry."},
    {"url": SC_RULES_URL, "section": "F",
     "meaning": "sp marks site-specific standards; parentheses after ORW or ONRW record the previous classification."},
]

# These are source roles, not assumptions that a particular export is current.
# Use layer metadata from the same acquired source to resolve its actual fields.
PROFILES = {
    "scdes_classified_streams": {
        "title": "SCDES classified streams",
        "service_url": "https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2",
        "family": "high_quality_waters", "kind": "classified_water",
        "default_relation": "upstream_huc",
        "geometry_types": ["LineString", "MultiLineString"],
        "default_rationale": "Identify contributing HUC12 units upstream of the original SCHydroClass stream feature.",
    },
    "scdes_classified_waters": {
        "title": "SCDES classified waters",
        "service_url": "https://gis.des.sc.gov/gisserver/rest/services/water/Water_Classifications/MapServer/0",
        "family": "high_quality_waters", "kind": "classified_water",
        "default_relation": "upstream_huc",
        "geometry_types": ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
        "default_rationale": "Identify contributing HUC12 units upstream of the source-mapped classified water feature.",
    },
    "scdes_surface_intakes": {
        "title": "SCDES public-water-supply intakes",
        "service_url": "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/0",
        "family": "critical_drinking_water", "kind": "drinking_water_intake",
        "default_relation": "upstream_huc",
        "geometry_types": ["Point", "MultiPoint"],
        "default_rationale": "Identify contributing HUC12 units upstream of the source-mapped surface-water intake.",
    },
    "scdes_source_water_areas": {
        "title": "SCDES source-water areas",
        "service_url": "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2",
        "family": "critical_drinking_water", "kind": "source_water_area",
        "default_relation": "source_area",
        "geometry_types": ["Polygon", "MultiPolygon"],
        "default_rationale": "Use the published source-water-area polygon as the explicitly delineated source-area support.",
    },
    "scdes_protection_zones": {
        "title": "SCDES public-water-supply protection zones",
        "service_url": "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/3",
        "family": "critical_drinking_water", "kind": "protection_zone",
        "default_relation": "source_area",
        "geometry_types": ["Polygon", "MultiPolygon"],
        "default_rationale": "Use the published protection-zone polygon as protection-area support; its boundary retains its source-defined meaning.",
    },
}
FIELD_ALIASES = {
    "classification": ("H2OCLASS", "CLASS", "CLASSIFICATION", "WATER_CLASS", "WATER_CLASSIFICATION"),
    "name": ("NAME", "WATERBODY", "WATERBODY_NAME", "WATER_NAME", "H2ONAME", "HYDNAME",
             "PWS_NAME", "PWSNAME", "SYSTEM_NAME", "SYSNAME", "FACILITY_NAME", "INTAKE_NAME"),
    "description": ("DESCRIPTION", "DESCRIPT", "WATERBODY_DESCRIPTION", "H2ODESC", "WATER_DESC", "REACH_DESCRIPTION", "DESC_"),
    "status": ("STATUS", "ACTIVITY_STATUS", "PWS_STATUS", "SYSTEM_STATUS", "INTAKE_STATUS", "INTAKESTAT"),
    "system_id": ("PWSID", "PWS_ID", "PWS_NUMBER", "SYSTEM_ID", "PWSSYSID", "PWSNO", "SYSTEM"),
    "intake_id": ("INTAKE_ID", "INTAKEID", "SOURCE_ID", "SRC_ID", "INTAKE"),
}
_REF_KEYS = ("source_collection_id", "source_id", "layer", "where", "feature_ids")


def _canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _plain(value):
    """Normalize Fiona/date/tuple values while retaining all field names."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and not (-float("inf") < value < float("inf")):
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _norm(value):
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def _field_names(metadata, rows):
    names = {str(f["name"]) for f in metadata.get("fields", []) if f.get("name")}
    names.update(str(k) for row in rows for k in row["properties"])
    return sorted(names)


def _domain_value(metadata, field, raw):
    definition = next((f for f in metadata.get("fields", []) if f.get("name") == field), {})
    for item in (definition.get("domain") or {}).get("codedValues", []):
        # JSON numbers and strings are deliberately distinct domain keys.
        if type(item.get("code")) is type(raw) and item.get("code") == raw:
            return item.get("name"), item
    return raw, None


def _resolve_field(role, explicit, metadata, rows, required=False):
    names = _field_names(metadata, rows)
    if explicit is not None:
        if not isinstance(explicit, str) or explicit not in names:
            raise ValueError(f"field_map.{role}={explicit!r} is not a source field; available: {names}")
        return explicit
    if role == "object_id":
        candidates = [metadata.get("objectIdField"), metadata.get("objectIdFieldName")]
        candidates += [f.get("name") for f in metadata.get("fields", [])
                       if f.get("type") == "esriFieldTypeOID"]
        found = sorted({x for x in candidates if x in names})
        # No guess between OBJECTID and OBJECTID_1 if both are present.
        if not found:
            found = [n for n in names if _norm(n) in ("OBJECTID", "OBJECTID1", "FID", "OID")]
    else:
        aliases = {_norm(a) for a in FIELD_ALIASES.get(role, ())}
        found = [n for n in names if _norm(n) in aliases]
        if not found:
            found = [str(f["name"]) for f in metadata.get("fields", [])
                     if f.get("name") in names and _norm(f.get("alias", "")) in aliases]
    found = sorted(set(found))
    if len(found) > 1:
        if required:
            raise ValueError(f"Ambiguous {role} fields {found}; supply the exact field_map.{role}.")
        return None
    if not found:
        if required:
            raise ValueError(f"No {role} field; supply field_map.{role} from fields {names}.")
        return None
    return found[0]


def parse_classification(value):
    """Parse exact R.61-69 codes, including ORW(TPGT) and FWsp.

    Previous class is informational and is never promoted to current class.
    An unrecognized string remains in raw and can be corrected through the
    source-specific field map or exact coded-value mapping.
    """
    raw = _plain(value)
    code = re.sub(r"\s+", "", str(value or "").upper())
    match = re.fullmatch(
        r"(ONRW|ORW|TPGT|TPT|SFH|TN|FW|SA|SB)(SP)?"
        r"(?:\((TPGT|TPT|SFH|TN|FW|SA|SB)(SP)?\))?", code
    )
    if not match:
        return {"raw": raw, "recognized": False, "designation": None,
                "previous_class": None, "site_specific": False}
    designation, site_specific, previous, previous_sp = match.groups()
    if previous and designation not in ("ORW", "ONRW"):
        return {"raw": raw, "recognized": False, "designation": None,
                "previous_class": None, "site_specific": False}
    return {
        "raw": raw, "recognized": True, "designation": designation,
        "previous_class": previous, "site_specific": bool(site_specific),
        "previous_class_site_specific": bool(previous_sp),
        "display_code": code,
    }


def _date(value, label):
    if value is None or value == "":
        return None
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be YYYY-MM-DD, got {value!r}") from exc


def _vintage(raw, as_of):
    raw = deepcopy(raw or {})
    status = raw.get("status", "unknown")
    if status not in VINTAGE_STATUSES:
        raise ValueError(f"vintage.status must be one of {VINTAGE_STATUSES}")
    start = _date(raw.get("effective_from"), "vintage.effective_from")
    end = _date(raw.get("effective_to"), "vintage.effective_to")
    if start and end and end <= start:
        raise ValueError("vintage.effective_to must be later than effective_from (exclusive end).")
    evidence = raw.get("evidence", [])
    if not isinstance(evidence, list) or any(
            not ((isinstance(item, str) and item.strip()) or (isinstance(item, dict) and item))
            for item in evidence):
        raise ValueError("vintage.evidence must be an array of nonempty source-reference strings or objects.")
    temporal_status = status
    if status == "effective" and start and start > as_of:
        temporal_status = "proposed"
    elif status == "effective" and end and end <= as_of:
        temporal_status = "historical"
    raw.update({
        "status": status, "selection_status": temporal_status,
        "effective_from": start.isoformat() if start else None,
        "effective_to": end.isoformat() if end else None,
        "as_of": as_of.isoformat(),
        "evidence": evidence,
    })
    return raw


def _service_layer(uri):
    parsed = urlsplit(str(uri or ""))
    if parsed.scheme not in ("http", "https"):
        return None
    path = re.sub(r"/query/?$", "", parsed.path.rstrip("/"), flags=re.I)
    return (parsed.hostname or "").lower() + path.lower()


def _source_ref(ref):
    if not isinstance(ref, dict):
        raise ValueError("source must be a source descriptor object.")
    for key in ("source_collection_id", "source_id"):
        if not ref.get(key):
            raise ValueError(f"source requires {key}")
    return {key: deepcopy(ref[key]) for key in _REF_KEYS if key in ref}


def _json_payload(path):
    import gzip
    raw = Path(path).read_bytes()
    if raw.startswith(b"\x1f\x8b"):
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8-sig"))


def _retained_json(workspace, body):
    """Read a verified Workspace object, independent of native view layout."""
    from model.common import verify_file
    if not isinstance(body, dict) or not body.get("object"):
        raise ValueError("Metadata must refer to a retained Workspace object.")
    path = verify_file(workspace.root, {**body, "path": body["object"]})
    return _json_payload(path)


def _companion_metadata(workspace, selection, entry):
    companions = entry.get("companions") or []
    selected_path = selection.get("layer_metadata_companion")
    if selected_path is not None and (not isinstance(selected_path, str) or not selected_path):
        raise ValueError("layer_metadata_companion must be an exact retained source_path.")
    if not companions:
        if selected_path is not None:
            raise ValueError("This source has no retained metadata companions.")
        return {}, {}
    source = _source_ref(selection["source"])
    collections = [item for item in workspace.sources()
                   if item.get("id") == source["source_collection_id"]]
    if len(collections) != 1:
        raise ValueError("The original source collection could not be resolved uniquely.")
    manifest_body = collections[0].get("original_manifest")
    manifest = _retained_json(workspace, manifest_body)
    originals = [item for item in manifest.get("entries", [])
                 if item.get("id") == source["source_id"]]
    if len(originals) != 1:
        raise ValueError("The retained original manifest must contain this exact source ID once.")
    declared = {}
    for item in originals[0].get("companions", []):
        path = item.get("path")
        if path in declared:
            raise ValueError(f"Original manifest repeats companion path {path!r}.")
        declared[path] = item
    candidates = []
    exact_matches = 0
    source_layer = _service_layer(entry.get("uri"))
    for body in companions:
        source_path = body.get("source_path")
        if selected_path is not None and source_path != selected_path:
            continue
        if selected_path is not None:
            exact_matches += 1
        declaration = declared.get(source_path)
        if declaration is None:
            raise ValueError(f"Companion {source_path!r} is absent from the original manifest.")
        # GeoPackage sidecars and unrelated binary companions need no JSON read.
        if selected_path is None and not re.search(r"\.json(?:\.gz)?$", str(source_path), re.I):
            continue
        try:
            metadata = _retained_json(workspace, body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            if selected_path is not None:
                raise ValueError(f"Selected metadata companion {source_path!r} is not JSON.") from None
            continue
        if not isinstance(metadata, dict):
            if selected_path is not None:
                raise ValueError("Selected metadata companion must contain an object.")
            continue
        dictionary = metadata.get("schema") == "upstate.water-source-dictionary/v1"
        part = metadata.get("sources", {}).get("scdes", {}) if dictionary else {}
        metadata_uri = part.get("layer_url") if dictionary else declaration.get("uri")
        metadata_layer = _service_layer(metadata_uri)
        is_layer = (isinstance(metadata.get("fields"), list)
                    and bool(metadata.get("geometryType"))
                    and "features" not in metadata and not metadata.get("error"))
        is_dictionary = dictionary and isinstance(part.get("field_metadata"), list)
        mismatch = bool(metadata_layer and source_layer and metadata_layer != source_layer)
        layer_number = re.search(r"/(?:mapserver|featureserver)/(\d+)$", source_layer or "")
        if is_layer and layer_number and metadata.get("id") is not None:
            mismatch = mismatch or str(metadata["id"]) != layer_number.group(1)
        if mismatch or not (is_layer or is_dictionary):
            if selected_path is not None:
                raise ValueError("Selected metadata companion is not the original metadata for this source layer.")
            continue
        # Auto-binding a dictionary needs its explicit original layer URL.
        if is_dictionary and selected_path is None and metadata_layer != source_layer:
            continue
        provenance = {
            "source": source,
            "companion": deepcopy(body),
            "original_manifest": deepcopy(manifest_body),
            "declared_companion": deepcopy(declaration),
            "uri": metadata_uri,
            "association": "original_manifest_companion",
        }
        candidates.append((0 if is_layer else 1, body["sha256"], metadata, provenance))
    if selected_path is not None and exact_matches != 1:
        raise ValueError(f"layer_metadata_companion matched {exact_matches} retained entries; expected one.")
    if not candidates:
        return {}, {}
    # Prefer the original ArcGIS layer object over a derived source dictionary.
    best_rank = min(item[0] for item in candidates)
    unique = {}
    for item in sorted(candidates, key=lambda item: str(item[3]["companion"].get("source_path"))):
        if item[0] == best_rank:
            unique.setdefault(item[1], item)
    if len(unique) != 1:
        paths = [item[3]["companion"]["source_path"] for item in unique.values()]
        raise ValueError(f"Multiple original metadata companions {paths}; choose layer_metadata_companion.")
    _, _, metadata, provenance = next(iter(unique.values()))
    return metadata, provenance


def _entry_metadata(workspace, selection, entry):
    metadata_provenance = {}
    reference = selection.get("layer_metadata_source")
    companion = selection.get("layer_metadata_companion")
    if reference and companion is not None:
        raise ValueError("Choose layer_metadata_source or layer_metadata_companion, not both.")
    if reference:
        ref = _source_ref(reference)
        path, original = workspace.source_file(ref["source_collection_id"], ref["source_id"])
        metadata = _json_payload(path)
        metadata_provenance = {
            "source": ref, "source_body": deepcopy(original.get("body", {})),
            "uri": original.get("uri"), "vintage": original.get("vintage"),
        }
    elif companion is not None:
        metadata, metadata_provenance = _companion_metadata(workspace, selection, entry)
    elif "layer_metadata" in selection:
        metadata = deepcopy(selection["layer_metadata"])
    elif (entry.get("metadata") or {}).get("layer_metadata"):
        metadata = deepcopy(entry["metadata"]["layer_metadata"])
    else:
        metadata, metadata_provenance = _companion_metadata(workspace, selection, entry)
    if not isinstance(metadata, dict) or metadata.get("error"):
        raise ValueError("Layer metadata must be the successful ArcGIS metadata object.")
    if metadata.get("schema") == "upstate.water-source-dictionary/v1":
        original_dictionary = metadata
        part = original_dictionary.get("sources", {}).get("scdes", {})
        if not isinstance(part.get("field_metadata"), list):
            raise ValueError("Source dictionary has no original sources.scdes.field_metadata.")
        if (part.get("layer_url") and _service_layer(entry.get("uri"))
                and _service_layer(part["layer_url"]) != _service_layer(entry.get("uri"))):
            raise ValueError("Source dictionary describes a different original service layer.")
        metadata_provenance.update({
            "dictionary_schema": original_dictionary["schema"],
            "dictionary_sha256": _sha(original_dictionary),
            "dictionary_component": "sources.scdes",
        })
        metadata = {
            "name": part.get("title"), "fields": deepcopy(part["field_metadata"]),
            "objectIdField": part.get("object_id"), "geometryType": part.get("geometry_type"),
            "sourceSpatialReference": deepcopy(part.get("spatial_reference")),
            "editingInfo": deepcopy(part.get("editing_info")),
            "serviceItemId": part.get("service_item_id"),
            "source_dictionary_component": deepcopy(part),
        }
    return metadata, metadata_provenance


def _read_source(workspace, selection):
    from model import rasters
    source = _source_ref(selection["source"])
    path, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    # Original row properties and stable source IDs are retained; output geometry
    # is explicitly WGS84 while the original bytes and CRS stay referenced.
    rows, crs = rasters.vector_geometry(
        path, layer=source.get("layer", entry.get("layer")),
        where=source.get("where"), target_crs="EPSG:4326")
    if source.get("feature_ids") is not None:
        wanted = {str(value) for value in source["feature_ids"]}
        rows = [row for row in rows if str(row["id"]) in wanted]
    metadata, metadata_provenance = _entry_metadata(workspace, selection, entry)
    return source, entry, rows, str(crs), metadata, metadata_provenance


def _selector_for_row(source, row, oid_field, oid_value):
    result = deepcopy(source)
    # A loader's native feature ID is always retained, including exports whose
    # native ObjectID is a feature ID rather than a property.
    result["feature_ids"] = [str(row["id"])]
    if oid_field and oid_field in row["properties"] and oid_value is not None:
        result["where"] = {**result.get("where", {}), oid_field: oid_value}
    return result


def _relationship(selection, override, profile):
    relation = {
        "method": profile["default_relation"],
        "rationale": profile["default_rationale"],
        "buffer_m": 0,
    }
    relation.update(deepcopy(selection.get("relation") or {}))
    relation.update(deepcopy(override.get("relation") or {}))
    if relation["method"] not in ("upstream_huc", "source_area", "geometric_context"):
        raise ValueError(f"Unknown relation method {relation['method']!r}")
    if not str(relation.get("rationale") or "").strip():
        raise ValueError("Each relationship requires a concrete rationale.")
    seeds = relation.get("seed_huc_ids")
    if seeds is not None:
        if not isinstance(seeds, list) or any(not isinstance(x, str) or not re.fullmatch(r"\d{12}", x) for x in seeds):
            raise ValueError("seed_huc_ids must be an array of exact 12-digit strings.")
        relation["seed_huc_ids"] = sorted(set(seeds))
        if relation["method"] == "upstream_huc" and (not seeds or not relation.get("evidence")):
            raise ValueError("Explicit upstream HUC seeds require nonempty seed_huc_ids and relation.evidence.")
    buffer_m = relation.get("buffer_m", 0)
    if isinstance(buffer_m, bool) or not isinstance(buffer_m, (int, float)) or not 0 <= buffer_m < float("inf"):
        raise ValueError("relation.buffer_m must be a finite nonnegative number.")
    if relation["method"] != "geometric_context" and buffer_m != 0:
        raise ValueError("A buffer belongs only to an explicit geometric_context relationship.")
    return relation


def _status_filter(selection, metadata, fields, props):
    rule = selection.get("status_filter")
    if rule is None:
        return True, None
    if not isinstance(rule, dict) or not isinstance(rule.get("include"), list) or not rule["include"]:
        raise ValueError("status_filter must contain a nonempty include array of exact raw status values.")
    field = rule.get("field") or fields.get("status")
    if field not in props:
        raise ValueError(f"status_filter field {field!r} is absent from source properties.")
    raw = props[field]
    accepted = any(type(raw) is type(value) and raw == value for value in rule["include"])
    decoded, domain = _domain_value(metadata, field, raw)
    return accepted, {"field": field, "raw": raw, "label": decoded, "domain": domain,
                      "include_raw_values": deepcopy(rule["include"])}


def _selection_name(selection):
    return selection.get("id") or selection["profile"]


def compile_catalog(workspace, request):
    """Return a deterministic catalog, GeoJSON records, and separate vintage plans.

    request.sources selects original Workspace assets and exact fields. Unknown,
    excluded, and historical records remain in the catalog with selection
    reasons. plans.effective and plans.proposed are always separate.
    """
    from shapely.geometry import mapping

    if request.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError(f"Expected {SELECTION_SCHEMA}")
    as_of = _date(request.get("as_of"), "as_of")
    if as_of is None:
        raise ValueError("Provide as_of so replay does not depend on today's date.")
    selections = request.get("sources")
    if not isinstance(selections, list) or not selections:
        raise ValueError("sources must contain at least one source selection.")
    catchments = deepcopy(request.get("catchments"))
    if catchments is not None:
        _source_ref(catchments)
    records, source_summaries, issues, seen_records, seen_selection_ids = [], [], [], set(), set()

    for selection in selections:
        profile_id = selection.get("profile")
        if profile_id not in PROFILES:
            raise ValueError(f"Unknown profile {profile_id!r}; use one of {list(PROFILES)}")
        profile = PROFILES[profile_id]
        selection_id = _selection_name(selection)
        if selection_id in seen_selection_ids:
            raise ValueError(f"Duplicate selection id {selection_id!r}; use distinct IDs for separate vintages.")
        seen_selection_ids.add(selection_id)
        source, entry, rows, crs, metadata, metadata_provenance = _read_source(workspace, selection)
        field_map = {
            role: entry[key] for role, key in (
                ("object_id", "object_id_field"), ("classification", "classification_field"),
                ("name", "name_field"), ("description", "description_field"))
            if entry.get(key)
        }
        supplied_fields = selection.get("field_map", {})
        if not isinstance(supplied_fields, dict):
            raise ValueError("field_map must be an object of exact source field names.")
        field_map.update(supplied_fields)
        if not isinstance(field_map, dict):
            raise ValueError("field_map must be an object of exact source field names.")
        fields = {role: _resolve_field(
            role, field_map.get(role), metadata, rows,
            required=role == "classification" and profile["kind"] == "classified_water")
            for role in ("object_id", "classification", "name", "description", "status", "system_id", "intake_id")}
        exact_codes = selection.get("include_classes")
        if profile["kind"] == "classified_water":
            if not isinstance(exact_codes, list) or not exact_codes:
                raise ValueError("Classified-water selection requires explicit include_classes.")
            if any(code not in CLASS_CODES for code in exact_codes):
                raise ValueError(f"include_classes uses current designation codes from {CLASS_CODES}")
            if not str(selection.get("selection_rationale") or "").strip():
                raise ValueError("State why include_classes defines this project's high-quality-water selection.")
        overrides = selection.get("record_overrides", {})
        if not isinstance(overrides, dict):
            raise ValueError("record_overrides must be keyed by the exact source ObjectID or native feature ID.")
        native_ids = Counter(str(row["id"]) for row in rows)
        if any(n > 1 for n in native_ids.values()):
            raise ValueError(f"{selection_id}: duplicate native feature IDs prevent an exact source selector.")
        body = entry.get("body", {})
        source_sha = body.get("sha256")
        if not isinstance(source_sha, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", source_sha):
            raise ValueError(f"{selection_id}: Workspace source entry has no original body SHA-256.")
        authoritative_uri = selection.get("service_url") or profile["service_url"]
        actual_layer = _service_layer(entry.get("uri"))
        expected_layer = _service_layer(authoritative_uri)
        service_match = actual_layer == expected_layer if actual_layer else None
        summary = {
            "selection_id": selection_id, "profile": profile_id, "source": source,
            "service_url": authoritative_uri, "source_uri": entry.get("uri"),
            "source_uri_matches_service": service_match,
            "source_body": deepcopy(body), "source_vintage": deepcopy(entry.get("vintage")),
            "fields": fields, "layer_metadata": metadata,
            "layer_metadata_sha256": _sha(metadata), "metadata_provenance": metadata_provenance,
            "source_spatial_reference": (metadata.get("extent") or {}).get("spatialReference") or metadata.get("sourceSpatialReference") or entry.get("source_crs"),
            "mapped_classification_status": entry.get("mapped_classification_status"),
            "regulatory_reference": deepcopy(entry.get("regulatory_reference")),
            "catalog_geometry_crs": crs, "candidate_count": len(rows),
            "include_classes": deepcopy(exact_codes), "selection_rationale": selection.get("selection_rationale"),
            "status_filter": deepcopy(selection.get("status_filter")),
        }
        source_summaries.append(summary)
        matched_overrides = set()

        for row in rows:
            props = _plain(dict(row["properties"]))
            oid_value = props.get(fields["object_id"]) if fields["object_id"] else None
            native_id = str(row["id"])
            override_key = str(oid_value) if oid_value is not None else native_id
            override = deepcopy(overrides.get(override_key, {}))
            if override_key in overrides:
                matched_overrides.add(override_key)
            vintage_raw = {**deepcopy(selection.get("vintage") or {}), **deepcopy(override.get("vintage") or {})}
            vintage = _vintage(vintage_raw, as_of)
            relation = _relationship(selection, override, profile)
            record_id = profile_id + "-" + _sha({
                "body": source_sha, "layer": source.get("layer", entry.get("layer")),
                "native_id": native_id, "selection": selection_id,
            })[:20]
            if record_id in seen_records:
                raise ValueError(f"Duplicate compiled record {record_id}")
            seen_records.add(record_id)
            geometry = row.get("geometry")
            reasons = []
            geometry_json = None
            if geometry is None or geometry.is_empty:
                reasons.append("empty_geometry")
            else:
                geometry_json = _plain(mapping(geometry))
                if not geometry.is_valid:
                    reasons.append("invalid_geometry")
                if geometry.geom_type not in profile["geometry_types"]:
                    reasons.append("unexpected_geometry_type")
                if relation["method"] == "source_area" and geometry.geom_type not in ("Polygon", "MultiPolygon"):
                    reasons.append("source_area_requires_polygon")
                if relation["method"] == "geometric_context" and geometry.geom_type not in ("Polygon", "MultiPolygon") and relation["buffer_m"] == 0:
                    reasons.append("geometric_context_requires_area_or_explicit_buffer")

            parsed_class = None
            if fields["classification"] and profile["kind"] == "classified_water":
                raw_class = props.get(fields["classification"])
                decoded_class, domain = _domain_value(metadata, fields["classification"], raw_class)
                parsed_class = parse_classification(decoded_class)
                parsed_class.update({"source_field": fields["classification"], "source_value": raw_class,
                                     "domain_value": _plain(domain)})
                if not parsed_class["recognized"]:
                    reasons.append("unrecognized_classification")
                elif parsed_class["designation"] not in exact_codes:
                    reasons.append("classification_not_selected")

            status_selected, status_detail = _status_filter(selection, metadata, fields, props)
            if not status_selected:
                reasons.append("source_status_not_selected")
            if override.get("include") is False:
                reasons.append("explicit_record_exclusion")
            if vintage["selection_status"] in ("historical", "unknown"):
                reasons.append("vintage_" + vintage["selection_status"])
            if vintage["selection_status"] in ("effective", "proposed") and not vintage["evidence"]:
                reasons.append("vintage_source_reference_missing")

            native_name = props.get(fields["name"]) if fields["name"] else None
            title = next(
                (str(value).strip() for value in (override.get("title"), native_name)
                 if value is not None and str(value).strip()),
                f"{profile['title']} {override_key}",
            )
            source_selector = _selector_for_row(source, row, fields["object_id"], oid_value)
            classification = {
                "profile": profile_id, "kind": profile["kind"], "source_classification": parsed_class,
                "native_name": native_name,
                "description": props.get(fields["description"]) if fields["description"] else None,
                "vintage": vintage, "status": status_detail,
                "mapped_classification_status": entry.get("mapped_classification_status"),
                "regulatory_reference": deepcopy(entry.get("regulatory_reference")),
                "rule_references": deepcopy(RULE_REFERENCES if profile["kind"] == "classified_water" else []),
                "legal_geometry_scope": "original_source_feature",
                "hydrologic_support_scope": relation["method"],
                "source_fields": props,
            }
            record = {
                "id": record_id, "title": title, "family": profile["family"],
                "source": source_selector, "relation": relation, "classification": classification,
                "geometry": geometry_json, "geometry_crs": "EPSG:4326",
                "provenance": {
                    "selection_id": selection_id, "source_body_sha256": source_sha,
                    "source_uri": entry.get("uri"), "service_url": authoritative_uri,
                    "source_vintage": deepcopy(entry.get("vintage")),
                    "metadata_sha256": summary["layer_metadata_sha256"],
                    "native_feature_id": native_id, "object_id_field": fields["object_id"],
                    "object_id_value": oid_value, "source_collection_id": source["source_collection_id"],
                    "source_id": source["source_id"],
                    "identity_scope": "immutable_source_snapshot",
                    "geometry_sha256": _sha(geometry_json) if geometry_json else None,
                },
                "selected": not reasons, "selection_reasons": reasons,
                "selection_rationale": selection.get("selection_rationale"),
            }
            if fields["system_id"]:
                record["classification"]["system_id"] = props.get(fields["system_id"])
            if fields["intake_id"]:
                record["classification"]["intake_id"] = props.get(fields["intake_id"])
            records.append(record)
            if reasons:
                issues.append({"record_id": record_id, "title": title, "selection_id": selection_id,
                               "native_feature_id": native_id, "reasons": reasons})

        unused = sorted(set(overrides) - matched_overrides)
        if unused:
            raise ValueError(f"{selection_id}: record_overrides did not match original features: {unused}")
        selected_source = [r for r in records if r["provenance"]["selection_id"] == selection_id]
        summary["selected_count"] = sum(r["selected"] for r in selected_source)
        summary["class_counts"] = dict(sorted(Counter(
            (r["classification"]["source_classification"] or {}).get("designation") or "unclassified"
            for r in selected_source).items()))
        summary["vintage_counts"] = dict(sorted(Counter(
            r["classification"]["vintage"]["selection_status"] for r in selected_source).items()))

    records.sort(key=lambda r: r["id"])
    source_summaries.sort(key=lambda s: s["selection_id"])
    catalog = {
        "schema": CATALOG_SCHEMA, "title": request.get("title", "Receiving-water catalog"),
        "as_of": as_of.isoformat(), "request_sha256": _sha(request),
        "source_selections": source_summaries, "records": records,
        "summary": {
            "records": len(records), "selected": sum(r["selected"] for r in records),
            "families": dict(sorted(Counter(r["family"] for r in records if r["selected"]).items())),
            "selection_reasons": dict(sorted(Counter(reason for r in records for reason in r["selection_reasons"]).items())),
        },
        "issues": sorted(issues, key=lambda i: i["record_id"]),
    }
    catalog["id"] = _sha(catalog)
    plans = {}
    for status in ("effective", "proposed"):
        receptors = []
        for record in records:
            if record["selected"] and record["classification"]["vintage"]["selection_status"] == status:
                receptors.append({key: deepcopy(value) for key, value in record.items()
                                  if key in ("id", "title", "family", "source", "relation", "classification", "provenance", "selection_rationale")})
        plan = {
            "title": f"{catalog['title']} - {status}", "receptors": receptors,
            "catalog_id": catalog["id"], "designation_vintage": status,
            "catalog_as_of": as_of.isoformat(),
        }
        if catchments is not None:
            plan["catchments"] = deepcopy(catchments)
        for key in ("analysis_crs", "notes"):
            if key in request:
                plan[key] = deepcopy(request[key])
        plans[status] = plan
    geojson = {
        "type": "FeatureCollection", "name": catalog["title"],
        "catalog_id": catalog["id"],
        "features": [
            {"type": "Feature", "id": r["id"], "geometry": r["geometry"],
             "properties": {key: deepcopy(value) for key, value in r.items()
                            if key not in ("geometry", "geometry_crs")}}
            for r in records if r["geometry"] is not None
        ],
    }
    return {"catalog": catalog, "geojson": geojson, "plans": plans}


def inspect_sources(workspace, selectors=None):
    """Inspect the same exact source selection and metadata used by compilation."""
    candidates = []
    all_sources = [(collection, entry) for collection in workspace.sources()
                   for entry in collection.get("entries", [])]
    for profile_id, profile in PROFILES.items():
        selections = []
        explicit = (selectors or {}).get(profile_id)
        if explicit is not None:
            if not isinstance(explicit, dict):
                raise ValueError("Each profile selector must be a source reference or source selection.")
            selections = [deepcopy(explicit) if "source" in explicit else {"source": deepcopy(explicit)}]
        else:
            for collection, entry in all_sources:
                if _service_layer(entry.get("uri")) != _service_layer(profile["service_url"]):
                    continue
                source = {"source_collection_id": collection["id"], "source_id": entry["id"]}
                if entry.get("layer") is not None:
                    source["layer"] = entry["layer"]
                selections.append({"source": source})
        for selection in selections:
            source, entry, rows, crs, metadata, metadata_provenance = _read_source(workspace, selection)
            supplied = selection.get("field_map", {})
            if not isinstance(supplied, dict):
                raise ValueError("field_map must be an object of exact source field names.")
            fields = {}
            entry_fields = {"object_id": "object_id_field", "classification": "classification_field",
                            "name": "name_field", "description": "description_field"}
            for role in ("object_id", *FIELD_ALIASES):
                explicit_field = supplied.get(role, entry.get(entry_fields.get(role, "")))
                try:
                    fields[role] = _resolve_field(
                        role, explicit_field, metadata, rows,
                        required=role == "classification" and profile["kind"] == "classified_water")
                except ValueError as exc:
                    fields[role] = {"needs_explicit_field": str(exc)}
            class_field = fields.get("classification")
            counts = Counter()
            if isinstance(class_field, str):
                for row in rows:
                    raw = row["properties"].get(class_field)
                    label, _ = _domain_value(metadata, class_field, raw)
                    counts[str(label)] += 1
            candidates.append({
                "profile": profile_id, "source": source, "title": entry.get("title"),
                "uri": entry.get("uri"), "vintage": entry.get("vintage"),
                "body": deepcopy(entry.get("body", {})), "rows": len(rows),
                "field_names": _field_names(metadata, rows), "field_resolution": fields,
                "class_values": dict(sorted(counts.items())), "geometry_crs": str(crs),
                "layer_metadata": metadata, "metadata_provenance": metadata_provenance,
                "metadata_companions": [
                    {"source_path": item.get("source_path"), "sha256": item.get("sha256"),
                     "bytes": item.get("bytes")} for item in entry.get("companions", [])
                ],
                "geometry_types": dict(sorted(Counter(
                    row["geometry"].geom_type for row in rows if row.get("geometry") is not None).items())),
            })
    return {"schema": "upstate.receiving-water-source-inventory/1",
            "profiles": deepcopy(PROFILES), "candidates": candidates}

def write_catalog(compiled, output_dir):
    """Write full reusable artifacts and a machine-readable byte manifest."""
    from model.common import atomic_bytes
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    bodies = {
        "receiving-water-catalog.json": _canonical(compiled["catalog"]) + b"\n",
        "receiving-water-records.geojson": _canonical(compiled["geojson"]) + b"\n",
        "prepare-effective.json": _canonical(compiled["plans"]["effective"]) + b"\n",
        "prepare-proposed.json": _canonical(compiled["plans"]["proposed"]) + b"\n",
    }
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["record_id", "title", "family", "selected", "vintage_status",
                     "class", "previous_class", "source_collection_id", "source_id",
                     "native_feature_id", "selection_reasons"])
    for record in compiled["catalog"]["records"]:
        klass = record["classification"]["source_classification"] or {}
        writer.writerow([
            record["id"], record["title"], record["family"], record["selected"],
            record["classification"]["vintage"]["selection_status"],
            klass.get("designation"), klass.get("previous_class"),
            record["source"]["source_collection_id"], record["source"]["source_id"],
            record["provenance"]["native_feature_id"], ";".join(record["selection_reasons"]),
        ])
    bodies["receiving-water-index.csv"] = stream.getvalue().encode("utf-8")
    manifest = {
        "schema": "upstate.receiving-water-catalog-files/1",
        "catalog_id": compiled["catalog"]["id"],
        "files": [{"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                  for name, body in sorted(bodies.items())],
    }
    bodies["catalog-files.json"] = _canonical(manifest) + b"\n"
    # An immutable catalog directory may be replayed exactly, but not overwritten
    # by a different source selection. Choose a different directory for an update.
    for name, body in bodies.items():
        path = directory / name
        if path.exists() and path.read_bytes() != body:
            raise FileExistsError(f"Existing artifact differs: {path}; choose a new output directory.")
    # Publish each complete body atomically, with the completion manifest last.
    # A stopped writer leaves missing files which an exact replay can complete.
    for name, body in bodies.items():
        atomic_bytes(directory / name, body, immutable=True)
    return {"directory": str(directory.resolve()), **manifest}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing content-addressed scientific workspace")
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect", help="Read source candidates, exact fields, and class counts")
    inspect.add_argument("--selectors", help="JSON object mapping profile IDs to original source descriptors")
    inspect.add_argument("--output", required=True)
    compile_parser = sub.add_parser("compile", help="Compile a catalog and separate effective/proposed model requests")
    compile_parser.add_argument("--request", required=True)
    compile_parser.add_argument("--output-dir", required=True)
    compile_parser.add_argument("--prepare", choices=("effective", "proposed"),
                                help="Prepare the selected vintage's spatial plan in the same workspace")
    args = parser.parse_args(argv)
    from model.workspace import Workspace
    workspace = Workspace(args.workspace, create=False)

    if args.command == "inspect":
        selectors = _json_payload(Path(args.selectors)) if args.selectors else None
        result = inspect_sources(workspace, selectors)
        target = Path(args.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        body = _canonical(result) + b"\n"
        if target.exists() and target.read_bytes() != body:
            raise FileExistsError(f"Source inventory already exists with different bytes: {target}")
        from model.common import atomic_bytes
        atomic_bytes(target, body, immutable=True)
        print(json.dumps({"inventory": str(target.resolve()), "candidates": len(result["candidates"])}))
        return 0

    request = _json_payload(Path(args.request))
    compiled = compile_catalog(workspace, request)
    result = write_catalog(compiled, args.output_dir)
    if args.prepare:
        plan = compiled["plans"][args.prepare]
        if not plan["receptors"]:
            raise ValueError(f"No selected {args.prepare} receptors; inspect the catalog selection_reasons.")
        if any(r["relation"]["method"] == "upstream_huc" for r in plan["receptors"]) and "catchments" not in plan:
            raise ValueError("Selected upstream_huc receptors require the original catchments source descriptor.")
        from model.receiving_waters import prepare
        result["prepared_plan"] = prepare(workspace, plan)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
