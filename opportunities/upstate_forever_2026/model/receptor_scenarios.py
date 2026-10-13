"""Prepare original upstream polygons for native analysis and land-cover scenarios.

Uses the retained Esri feature bodies. Rendering geometry is never a model input.
All preparation steps use the Python standard library and Workspace source store.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import gzip
from html import escape
import io
import json
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     identifier, now, read_json, verify_file)
from .receptor_network_cli import _read_source

SCHEMA = "upstate.receptor-scenario-areas/v1"
FOLDER = "receptor-scenario-areas"
FAMILIES = {"drinking_water": "critical_drinking_water",
            "high_quality_waters": "high_quality_waters"}


def _network(workspace, network_id):
    directory = workspace.root / "receptor-networks" / identifier(network_id)
    result = read_json(directory / "result.json")
    if (result.get("schema") != "upstate.receptor-network-product/v1"
            or result.get("id") != network_id or digest(result["identity"]) != network_id):
        raise ValueError("Choose a saved original watershed study in this workspace")
    for item in result["files"].values():
        verify_file(directory, item)
    network = read_json(verify_file(directory, result["files"]["network"]))
    return directory, result, network


def _geometry(feature, spatial_reference, huc):
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or not isinstance(geometry.get("rings"), list):
        raise ValueError("Original HUC12 " + huc + " needs its retained polygon geometry")
    rings = geometry["rings"]
    if not rings:
        raise ValueError("Original HUC12 " + huc + " has no polygon rings")
    for ring in rings:
        if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("Original HUC12 " + huc + " has an incomplete polygon ring")
        if any(not isinstance(point, (list, tuple)) or len(point) < 2
               or any(type(coordinate) not in (int, float) or not math.isfinite(coordinate)
                      for coordinate in point[:2]) for point in ring):
            raise ValueError("Original HUC12 " + huc + " contains invalid coordinates")
    reference = geometry.get("spatialReference") or spatial_reference
    if not isinstance(reference, dict) or not any(reference.get(name)
                                                 for name in ("wkid", "latestWkid", "wkt")):
        raise ValueError("Retain the original coordinate reference for HUC12 " + huc)
    if spatial_reference and geometry.get("spatialReference") not in (None, spatial_reference):
        raise ValueError("Original feature and layer coordinate references differ for " + huc)
    return reference


def _source_selection(workspace, selection):
    network_id = identifier(selection["network_result_id"])
    directory, product, network = _network(workspace, network_id)
    areas = network["areas"]
    requested = selection.get("receptor_ids")
    if requested is None:
        requested = [area["id"] for area in areas]
    if (not isinstance(requested, list) or not requested
            or any(not isinstance(value, str) for value in requested)
            or len(set(requested)) != len(requested)):
        raise ValueError("Select one or more distinct receiving-area IDs")
    lookup = {area["id"]: area for area in areas}
    unknown = set(requested) - set(lookup)
    if unknown:
        raise ValueError("Receiving areas are absent from the saved study: " + ", ".join(sorted(unknown)))
    selected = [area for area in areas if area["id"] in requested]
    title = selection.get("title") or product["title"] + " — scenario areas"
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Give the prepared source areas a title")
    title = title.strip()
    identity = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
                "network_result_id": network_id, "title": title,
                "receptor_ids": [area["id"] for area in selected],
                "source_body_sha256": product["source_binding"]["body_sha256"]}
    return directory, product, network, selected, identity


def inspect(workspace, key):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    result = read_json(directory / "result.json")
    if (result.get("schema") != SCHEMA or result.get("id") != key
            or digest(result["identity"]) != key
            or result.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Choose prepared source areas from this workspace")
    for item in result["files"].values():
        verify_file(directory, item)
    for area in result["areas"]:
        _, entry = workspace.source_file(result["source_collection_id"], area["source_id"])
        descriptor = result["files"][area["file_key"]]
        if (entry["kind"] != "vector" or entry["body"]["sha256"] != descriptor["sha256"]
                or entry["body"]["bytes"] != descriptor["bytes"]):
            raise ValueError("The retained scenario polygon differs from its prepared source")
    return {**result, "files": {**result["files"],
            "result": describe_file(directory, directory / "result.json")}}


def _report(path, product, areas, shared, handoff):
    rows = "".join("<tr><td>" + escape(area["title"]) + "</td><td>"
                   + escape(area["role"].replace("_", " ")) + "</td><td>"
                   + str(area["huc12_count"]) + "</td><td>"
                   + escape(", ".join(area["anchor_huc12s"])) + "</td><td><a href=\""
                   + escape(area["filename"], quote=True) + "\">Original polygon subset</a></td></tr>"
                   for area in areas)
    html = ('<!doctype html><html lang="en"><meta charset="utf-8"><title>'
            + escape(product["title"]) + '</title><style>'
            'body{font:16px system-ui;color:#222;max-width:1100px;margin:40px auto;padding:0 24px}'
            'table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #bbb;padding:10px;text-align:left}'
            'a{color:inherit}code{overflow-wrap:anywhere}</style><h1>'
            + escape(handoff["selection"]["title"]) + '</h1><p>'
            'These original HUC12 polygon subsets follow the saved study’s upstream memberships. '
            'Original feature attributes, native feature IDs, polygon rings and source coordinate reference are retained. '
            'Native analysis clips these areas to its actual reporting grid.</p><table><thead><tr>'
            '<th>Receiving area</th><th>Purpose</th><th>HUC12 units</th><th>Original anchors</th>'
            '<th>Geometry</th></tr></thead><tbody>' + rows + '</tbody></table><p>'
            + str(len(shared)) + ' HUC12 units are shared by the selected areas. '
            'Area results must be interpreted separately where they overlap. '
            'Land-cover changes apply in their declared patch order.</p><p>'
            '<a href="scenario-source-areas.json">Add these prepared areas to the existing analysis form</a> · '
            '<a href="sources.json">Workspace source manifest</a> · '
            '<a href="memberships.csv">Original memberships</a> · '
            '<a href="network.json">Original drainage network</a> · '
            '<a href="source-profile.json">Saved receiving-area specification</a></p><p>Original study: <code>'
            + escape(product["id"]) + '</code></p><p>Original source body SHA-256: <code>'
            + escape(product["source_binding"]["body_sha256"]) + '</code></p></html>\n')
    atomic_bytes(path, html.encode("utf-8"), immutable=True)


def build(workspace, selection):
    source_directory, product, network, selected, identity = _source_selection(workspace, selection)
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock", blocking=False):
        if (directory / "result.json").exists():
            return inspect(workspace, key)
        source_path = verify_file(source_directory, product["files"]["source_body"])
        rows, binding, retained = _read_source(source_path)
        if (binding["body_sha256"] != product["source_binding"]["body_sha256"]
                or binding["decoded_sha256"] != product["source_binding"]["decoded_sha256"]):
            raise ValueError("The original polygon body differs from the saved watershed study")
        decoded = gzip.decompress(retained) if retained[:2] == b"\x1f\x8b" else retained
        document = json.loads(decoded)
        if document.get("geometryType") not in (None, "esriGeometryPolygon"):
            raise ValueError("Prepare upstream areas from original watershed polygons")
        huc_field = network["source_fields"]["huc12"]
        features = {}
        for feature in document["features"]:
            raw_huc = feature.get("attributes", {}).get(huc_field)
            huc = str(raw_huc).strip() if raw_huc is not None else ""
            if len(huc) != 12 or not huc.isdigit() or huc in features:
                raise ValueError("Original HUC12 values must be distinct twelve-digit identifiers")
            features[huc] = feature
        expected = {row["huc12"] for row in network["network"]}
        if set(features) != expected:
            raise ValueError("The original polygon set differs from the saved drainage network")
        source_name = product["files"]["source_body"]["path"]
        source_name = "source-domain.esri.json.gz" if retained[:2] == b"\x1f\x8b" else "source-domain.esri.json"
        atomic_bytes(directory / source_name, retained, immutable=True)
        atomic_json(directory / "source-profile.json", product["identity"]["receptor_spec"], immutable=True)
        atomic_json(directory / "network.json", network, immutable=True)
        source_reference = deepcopy(product["identity"]["receptor_spec"].get("source_reference") or {})
        vintage = source_reference.get("vintage") or product["created_at"].split("T")[0]
        members, prepared, entries = [], [], []
        spatial_reference = document.get("spatialReference")
        shared = {}
        for area in selected:
            if area["role"] not in FAMILIES:
                raise ValueError("Choose a drinking-water or high-quality-water receiving area")
            hucs = area["huc12s"]
            if not hucs or len(set(hucs)) != len(hucs) or any(huc not in features for huc in hucs):
                raise ValueError("Saved receiving-area membership differs from the original polygon set")
            body = {name: value for name, value in document.items() if name != "features"}
            body["features"] = [features[huc] for huc in hucs]
            local_reference = spatial_reference
            for huc in hucs:
                reference = _geometry(features[huc], spatial_reference, huc)
                if local_reference is not None and reference != local_reference:
                    raise ValueError("Selected original polygons use different coordinate references")
                local_reference = reference
                shared.setdefault(huc, []).append(area["id"])
            # A source can carry CRS only on its feature geometries. Preserve that
            # actual declared reference at the FeatureSet level for native readers.
            if not body.get("spatialReference"):
                body["spatialReference"] = local_reference
            source_id = "upstream-" + digest({"receptor_id": area["id"]})[:24]
            filename = source_id + ".esri.json"
            atomic_json(directory / filename, body, immutable=True)
            descriptor = describe_file(directory, directory / filename)
            row = {name: deepcopy(value) for name, value in area.items() if name != "memberships"}
            row.update(source_id=source_id, filename=filename, file_key=source_id,
                       source_spatial_reference=local_reference)
            prepared.append(row)
            for item in area["memberships"]:
                members.append({"receptor_id": area["id"], "receptor_title": area["title"], **item})
            origin = {"network_result_id": product["id"], "receptor_id": area["id"],
                      "original_source_body_sha256": binding["body_sha256"],
                      "original_source_decoded_sha256": binding["decoded_sha256"],
                      "source_reference": source_reference, "anchor_huc12s": area["anchor_huc12s"],
                      "huc12s": hucs, "geometry_method": "original_feature_subset",
                      "source_geometry_scope": "upstream_huc12_units"}
            entries.append({"id": source_id, "kind": "vector", "title": area["title"],
                            "uri": "urn:sha256:" + descriptor["sha256"], "vintage": vintage,
                            "path": filename, "sha256": descriptor["sha256"],
                            "source_plan_id": key, "receptor_ids": [area["id"]],
                            "map_family": FAMILIES[area["role"]], "origin": origin,
                            "companions": [{"path": name} for name in
                                           (source_name, "source-profile.json", "network.json")]})
        shared = {huc: owners for huc, owners in sorted(shared.items()) if len(owners) > 1}
        manifest = {"schema": "upstate.sources/v1", "title": identity["title"],
                    "captured_at": product["created_at"], "entries": entries,
                    "scope": {"network_result_id": product["id"], "receptor_ids": identity["receptor_ids"],
                              "original_source_body_sha256": binding["body_sha256"]},
                    "notes": "Original upstream HUC12 feature subsets from the retained watershed study."}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        zones = [{"id": area["source_id"], "title": area["title"],
                  "source_collection_id": collection["id"], "source_id": area["source_id"],
                  "map_family": FAMILIES[area["role"]], "source_plan_id": key,
                  "receptor_ids": [area["id"]], "source_relation_method": "source_area",
                  "source_geometry_scope": "upstream_huc12_units",
                  "metadata": {"network_result_id": product["id"], "anchor_huc12s": area["anchor_huc12s"],
                               "huc12s": area["huc12s"], "original_source_body_sha256": binding["body_sha256"],
                               "source_reference": source_reference}}
                 for area in prepared]
        origin = {"source_plan_id": key, "workspace": str(workspace.root),
                  "workspace_id": workspace.project["id"], "source_collection_id": collection["id"],
                  "network_result_id": product["id"], "original_source_body_sha256": binding["body_sha256"],
                  "original_source_decoded_sha256": binding["decoded_sha256"],
                  "source_reference": source_reference, "source_geometry_scope": "upstream_huc12_units",
                  "source_records": [{"source_id": area["source_id"], "receptor_id": area["id"],
                                      "original_huc12s": area["huc12s"]} for area in prepared],
                  "native_preparation": {"module": "model.receptor_scenarios", "product_id": key,
                                         "geometry_method": "original_feature_subset"},
                  "native_selection": deepcopy(selection)}
        handoff = {"schema": "upstate.scenario-source-areas/v1",
                   "selection": {"title": identity["title"], "zones": zones}, "origin": origin}
        atomic_json(directory / "scenario-source-areas.json", handoff, immutable=True)
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=("receptor_id", "receptor_title", "huc12",
            "anchor_huc12", "downstream_huc12", "links_to_anchor", "is_anchor"), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(members)
        atomic_bytes(directory / "memberships.csv", stream.getvalue().encode("utf-8"), immutable=True)
        _report(directory / "index.html", product, prepared, shared, handoff)
        paths = {"source_body": source_name, "profile": "source-profile.json", "network": "network.json",
                 "manifest": "sources.json", "handoff": "scenario-source-areas.json",
                 "memberships": "memberships.csv", "report": "index.html",
                 **{area["file_key"]: area["filename"] for area in prepared}}
        result = {"schema": SCHEMA, "id": key, "identity": identity, "title": identity["title"],
                  "created_at": now(), "state": "complete", "workspace_id": workspace.project["id"],
                  "network_result_id": product["id"], "source_binding": product["source_binding"],
                  "source_collection_id": collection["id"], "areas": prepared, "shared_huc12s": shared,
                  "membership_rows": len(members), "selected_huc12_count": len({r["huc12"] for r in members}),
                  "scenario_source_areas": handoff,
                  "files": {name: describe_file(directory, directory / path) for name, path in paths.items()}}
        atomic_json(directory / "result.json", result, immutable=True)
        return inspect(workspace, key)


def save_scenario(workspace, preparation_id, selection):
    """Save an explicit, ordered land-cover scenario on the prepared polygons."""
    preparation = inspect(workspace, preparation_id)
    areas = {area["id"]: area for area in preparation["areas"]}
    title, reason = selection.get("title"), selection.get("reason")
    if not isinstance(title, str) or not title.strip() or not isinstance(reason, str) or not reason.strip():
        raise ValueError("Give the scenario a title and an explicit intervention reason")
    changes = selection.get("changes")
    if not isinstance(changes, list) or not changes:
        raise ValueError("Select at least one explicit land-cover change")
    patches = []
    selected_areas = set()
    for change in changes:
        if not isinstance(change, dict) or change.get("receptor_id") not in areas:
            raise ValueError("Select a receiving area from this prepared source collection")
        codes, target = change.get("from_codes"), change.get("to_code")
        if (not isinstance(codes, list) or not codes or any(type(code) is not int for code in codes)
                or len(set(codes)) != len(codes) or type(target) is not int):
            raise ValueError("Use distinct actual integer source codes and an integer destination code")
        if not isinstance(change.get("reason"), str) or not change["reason"].strip():
            raise ValueError("Explain each selected land-cover change")
        area = areas[change["receptor_id"]]
        selected_areas.add(area["id"])
        patches.append({"mask_source_id": area["source_id"], "from_codes": codes,
                        "to_code": target, "reason": change["reason"].strip(),
                        "receptor_id": area["id"], "source_plan_id": preparation["id"],
                        "network_result_id": preparation["network_result_id"]})
    overlap = {huc: [area for area in owners if area in selected_areas]
               for huc, owners in preparation["shared_huc12s"].items()
               if len([area for area in owners if area in selected_areas]) > 1}
    value = {"title": title.strip(), "kind": "landcover", "reason": reason.strip(),
             "source_collection_id": preparation["source_collection_id"], "patches": patches,
             "source_area_origins": [deepcopy(preparation["scenario_source_areas"]["origin"])],
             "source_area_selection": {"preparation_id": preparation["id"],
                                      "ordered_changes": deepcopy(changes),
                                      "shared_huc12s": overlap,
                                      "patch_application": "declared_order_on_current_landcover"}}
    return workspace.save_scenario(value)
