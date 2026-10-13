"""Original polygon maps and portable scope exports for Regional Watersheds."""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path

from .common import atomic_bytes, describe_file
from . import utility_observed_context as original_sources

MANIFEST = "observations/watershed_profile_overlay_20261013/model-sources.json"
PREFIX = "watershed-map-sources/"
SOURCE_DIRECTORY = "observations/watershed_profile_overlay_20261013/"
PROFILE_PARSER = "observations/landcover_observation_profiles_20261013/profiles_core.mjs"
SCHEMA = "upstate.watershed-map-selection/v1"


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _manifest(application, manifest_name=MANIFEST):
    application = Path(application).resolve(strict=True)
    path = application / original_sources._relative(manifest_name)
    if not path.is_file():
        return None
    path = path.resolve(strict=True)
    if not path.is_relative_to(application):
        raise ValueError("The original map manifest leaves its application")
    body = path.read_bytes()
    manifest = json.loads(body)
    entries = manifest.get("entries", [])
    if (manifest.get("schema") != "upstate.sources/v1" or len(entries) != 1
            or entries[0].get("role") != "LANDCOVER_OBSERVATION_PROFILES"
            or entries[0].get("kind") != "vector"):
        raise ValueError("Choose the original watershed profile map edition")
    entry = entries[0]
    metadata = entry.get("metadata", {})
    if (entry.get("source_crs") != "EPSG:3857"
            or metadata.get("identifier_field") != "huc12"
            or metadata.get("label_field") != "name"):
        raise ValueError("The original map must retain its projected HUC12 geometry")
    name = original_sources._relative(entry.get("path"))
    choice = {
        "schema": "upstate.watershed-map-choice/v1",
        "sha256": _hash(body), "source_id": entry["id"],
        "title": entry.get("title") or manifest.get("title"),
        "manifest": MANIFEST, "source_crs": entry["source_crs"],
        "feature_count": metadata["feature_count"], "vertex_count": metadata["vertex_count"],
        "geometry_sha256": entry["sha256"], "geometry_bytes": entry["bytes"],
        "profile_sha256": metadata["profile_source_sha256"],
        "original_domain_sha256": metadata["original_domain_sha256"],
        "vintage": entry.get("vintage"),
        "geometry_method": metadata["geometry_method"],
    }
    return application, path, body, entry, name, choice


def catalog(application):
    result = _manifest(application)
    return result[-1] if result is not None else None


def load(application, expected_manifest_sha256, *, manifest_name=MANIFEST):
    original = _manifest(application, manifest_name)
    if original is None:
        raise ValueError("Install the original watershed map edition, then refresh this report")
    application, manifest_path, manifest_body, entry, name, choice = original
    if not expected_manifest_sha256 or expected_manifest_sha256 != choice["sha256"]:
        raise ValueError("The selected original map edition changed. Refresh this watershed report")
    bodies = {MANIFEST: manifest_body}
    for declared in [entry, *entry.get("companions", [])]:
        member = original_sources._relative(declared.get("path"))
        retained_name = SOURCE_DIRECTORY + member
        if retained_name in bodies:
            raise ValueError("The original map manifest repeats a source member")
        path = (manifest_path.parent / member).resolve(strict=True)
        if not path.is_relative_to(manifest_path.parent) or not path.is_file():
            raise ValueError("The original map member leaves its source directory")
        body = path.read_bytes()
        if len(body) != declared.get("bytes") or _hash(body) != declared.get("sha256"):
            raise ValueError("The original map source changed: " + member)
        bodies[retained_name] = body
    binding = json.loads(bodies[SOURCE_DIRECTORY + "overlay-binding.json"])
    parser_path = (manifest_path.parent.parent / "landcover_observation_profiles_20261013" / "profiles_core.mjs").resolve(strict=True)
    if not parser_path.is_relative_to(application) or not parser_path.is_file():
        raise ValueError("The retained map parser leaves its original source root")
    parser_body = parser_path.read_bytes()
    if _hash(parser_body) != binding.get("source_methods", {}).get("profiles_core_sha256"):
        raise ValueError("The original map profile parser changed")
    bodies[PROFILE_PARSER] = parser_body
    geometry = json.loads(bodies[SOURCE_DIRECTORY + name])
    fields_name = original_sources._relative(entry["metadata"]["map_fields_file"])
    fields = json.loads(bodies[SOURCE_DIRECTORY + fields_name])
    if (geometry.get("type") != "FeatureCollection"
            or geometry.get("crs", {}).get("properties", {}).get("name")
            != "urn:ogc:def:crs:EPSG::3857"):
        raise ValueError("The original map must retain its explicit EPSG:3857 geometry")
    if (fields.get("schema") != "upstate.watershed-map-fields/v1"
            or fields.get("source_id") != choice["source_id"]):
        raise ValueError("The original map field descriptions belong to a different source")
    features = geometry.get("features", [])
    indexed = {}
    for feature in features:
        key = feature.get("properties", {}).get("huc12")
        if (not isinstance(key, str) or not re.fullmatch(r"[0-9]{12}", key)
                or key in indexed or feature.get("id") != key):
            raise ValueError("The original map needs each HUC12 exactly once")
        indexed[key] = feature
    if len(indexed) != choice["feature_count"]:
        raise ValueError("The original map is missing watershed polygons")
    return {
        "source": choice, "geojson": geometry, "fields": fields,
        "indexed": indexed, "bodies": bodies,
        "geometry_path": manifest_path.parent / name,
        "geometry_file": {"path": name, "bytes": len(bodies[SOURCE_DIRECTORY + name]),
                          "sha256": _hash(bodies[SOURCE_DIRECTORY + name])},
    }


def load_retained(directory, context, expected_manifest_sha256):
    if context.get("schema") != SCHEMA:
        raise ValueError("Choose a saved original watershed map selection")
    if context.get("source", {}).get("sha256") != expected_manifest_sha256:
        raise ValueError("The saved map source differs from the requested edition")
    loaded = load(directory, expected_manifest_sha256,
                  manifest_name=PREFIX + MANIFEST)
    if loaded["source"] != context["source"]:
        raise ValueError("The saved map source identity changed")
    for name, body in loaded["bodies"].items():
        if context.get("retained_files", {}).get(name) != {
                "path": PREFIX + name, "bytes": len(body), "sha256": _hash(body)}:
            raise ValueError("The saved map member differs from its original inventory")
    return loaded


def preview(loaded, report):
    keys = sorted(row["huc12"] for row in report["hucs"])
    if set(keys) - loaded["indexed"].keys():
        raise ValueError("The map edition does not cover this regional report's watersheds")
    return {
        "schema": "upstate.watershed-map/v1", "report_id": report["id"],
        "source": copy.deepcopy(loaded["source"]),
        "source_crs": loaded["source"]["source_crs"],
        "fields": copy.deepcopy(loaded["fields"]), "domain_huc12s": keys,
    }


def _collection(original, keys):
    return {**{key: copy.deepcopy(value) for key, value in original.items() if key != "features"},
            "features": [copy.deepcopy(feature) for feature in original["features"]
                         if feature["properties"]["huc12"] in keys]}


def selection(application, selected, expected_manifest_sha256, *, loaded=None):
    loaded = load(application, expected_manifest_sha256) if loaded is None else loaded
    if loaded["source"]["sha256"] != expected_manifest_sha256:
        raise ValueError("The selected original map differs from its requested edition")
    chosen = sorted(set(selected["selected_huc12s"]))
    if not chosen or set(chosen) - loaded["indexed"].keys():
        raise ValueError("Choose original mapped watersheds from this report")
    contributing = selected.get("contributing_context")
    union = sorted(set(contributing["member_huc12s"])) if contributing is not None else None
    if union is not None and (set(union) - loaded["indexed"].keys() or not set(chosen).issubset(union)):
        raise ValueError("The original contributing union must include every chosen watershed")
    products = {"selected-watersheds.geojson": _json(_collection(loaded["geojson"], set(chosen)))}
    if union is not None:
        products["contributing-watersheds.geojson"] = _json(_collection(loaded["geojson"], set(union)))
    context = {
        "schema": SCHEMA, "source": copy.deepcopy(loaded["source"]),
        "selected_huc12s": chosen, "contributing_huc12s": union,
        "selected_feature_count": len(chosen),
        "contributing_feature_count": len(union) if union is not None else None,
        "geometry": {
            name: {"path": name, "bytes": len(body), "sha256": _hash(body)}
            for name, body in products.items()
        },
        "retained_files": {
            name: {"path": PREFIX + name, "bytes": len(body), "sha256": _hash(body)}
            for name, body in sorted(loaded["bodies"].items())
        },
        "interpretation": copy.deepcopy(loaded["fields"].get("interpretation", {})),
        "method": "Complete original projected polygons are selected by their original HUC12 identifiers. "
                  "Every original coordinate and source property is retained. The contributing union uses "
                  "the saved regional report's unique upstream membership and counts each HUC12 once.",
    }
    return context, loaded["bodies"], products


def retain(directory, context, bodies, products):
    root = Path(directory)
    files = {}
    for name, body in bodies.items():
        member = PREFIX + original_sources._relative(name)
        expected = context["retained_files"][name]
        if expected["path"] != member or expected["sha256"] != _hash(body) or expected["bytes"] != len(body):
            raise ValueError("The retained original map source identity changed")
        atomic_bytes(root / member, body, immutable=True)
        files[member] = describe_file(root, root / member)
    for name, body in products.items():
        expected = context["geometry"][name]
        if expected["path"] != name or expected["sha256"] != _hash(body) or expected["bytes"] != len(body):
            raise ValueError("The selected original map geometry changed")
        atomic_bytes(root / name, body, immutable=True)
        files[name] = describe_file(root, root / name)
    return files

def brief_lines(selected, table, number):
    context = selected.get("watershed_map_context")
    if context is None:
        return []
    if (context.get("schema") != SCHEMA
            or context.get("selected_huc12s") != sorted(selected["selected_huc12s"])):
        raise ValueError("The saved map and selected watershed membership differ")
    source = context["source"]
    rows = [
        ["Selected original polygons", context["selected_feature_count"]],
        ["Original source coordinate system", source["source_crs"]],
        ["Complete map edition", str(source["feature_count"]) + " watersheds"],
    ]
    if context["contributing_huc12s"] is not None:
        rows.insert(1, ["Distinct contributing polygons", context["contributing_feature_count"]])
    lines = ["## Original watershed map", "", *table(["Map scope", "Retained result"], rows), "",
             context["method"], "",
             "The selected-watersheds.geojson download preserves the complete selected polygons and "
             "their original land-cover and local-station attributes in EPSG:3857."]
    if context["contributing_huc12s"] is not None:
        lines += ["The contributing-watersheds.geojson download preserves the distinct contributing "
                  "union in the same original coordinate system."]
    lines += ["", "The full original map, its source geometry, profile table, field meanings and "
              "rebuild source are retained with this export under watershed-map-sources/.",
              "", "Original map manifest SHA-256: " + source["sha256"] + ".", ""]
    return lines
