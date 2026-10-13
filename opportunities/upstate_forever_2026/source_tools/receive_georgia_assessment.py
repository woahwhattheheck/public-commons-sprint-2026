#!/usr/bin/env python3
"""Import Georgia's retained approved-2024 reach assessment and domain geography.

Consumes already acquired original response pages. The source registry resolves
the existing project domain. Shared geometry and edition composition preserve the
same table, map and Scientific Reports workflow used for North Carolina.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import sys
import traceback

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from source_tools.receive_north_carolina_assessment import (
    fingerprint, read_json, member, verify, source_view_root,
    intact_outputs, compose_native_edition,
)


def selected_assessment(manifest_path):
    manifest_path = Path(manifest_path).resolve(strict=True)
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the complete approved-2024 Georgia source manifest")
    selected = [entry for entry in manifest["entries"]
                if entry.get("id") == "ga2024-gis-assessments-json"]
    if len(selected) != 1:
        raise ValueError("Select the complete original Georgia publisher-GIS assessment table")
    for entry in manifest["entries"]:
        for descriptor in [entry, *entry.get("companions", [])]:
            verify(member(manifest_path.parent, descriptor["path"]), descriptor)
    entry = selected[0]
    bank = read_json(member(manifest_path.parent, entry["path"]))
    if bank.get("schema") != "upstate.georgia-assessments/v1":
        raise ValueError("Wrong Georgia assessment schema")
    rows = bank.get("records", [])
    if len(rows) != 295 or len({row["native_reach_id"] for row in rows}) != 295:
        raise ValueError("Select all 295 distinct original publisher Savannah-basin reaches")
    if bank["source"].get("assessment_cycle") != 2024 or bank["source"].get("publication_status") != "EPA-approved":
        raise ValueError("Select the approved 2024 publisher edition")
    return manifest_path, entry, bank


def reach_sources(bank, manifest_path, geometry_root):
    """Validate unchanged source pages against both requested IDs and raw attributes."""
    capture = read_json(manifest_path)
    pages = capture.get("files", [])
    if len(pages) != 11:
        raise ValueError("Retain all six stream and five lake original geometry pages")
    if capture.get("object_id_field") != "FID" or capture.get("reach_id_field") != "ReachID":
        raise ValueError("Use the original publisher FID and ReachID fields")
    expected = {
        kind: set(capture["selection"][kind + "_object_ids"])
        for kind in ("stream", "lake")}
    if len(expected["stream"]) != 281 or len(expected["lake"]) != 14:
        raise ValueError("Select the exact original 281-stream / 14-lake ID inventories")
    records = {}
    for row in bank["records"]:
        key = (row["source_locator"]["layer_uri"], row["native_feature_id"])
        if key in records:
            raise ValueError("Repeated original layer/FID assessment identity")
        records[key] = row
    observed = {"stream": set(), "lake": set()}
    page_ids, matched, result, inventory = set(), set(), [], []
    for page in pages:
        kind = page["kind"]
        if kind not in observed:
            raise ValueError("Unknown original geometry page kind")
        native = member(geometry_root, page["path"])
        identity = fingerprint(native)
        if identity["bytes"] != page["bytes"] or (
                page.get("sha256") and identity["sha256"] != page["sha256"]):
            raise ValueError("Retained original geometry page identity differs: " + page["path"])
        body = read_json(native)
        if body.get("error") or body.get("exceededTransferLimit"):
            raise ValueError("Original geometry response is an error or a partial result: " + page["path"])
        if body.get("objectIdFieldName") != "FID":
            raise ValueError("Original geometry page does not declare FID identity")
        fields = {field["name"]: field for field in body.get("fields", [])}
        if fields.get("FID", {}).get("type") != "esriFieldTypeOID":
            raise ValueError("Original FID field must retain its publisher OID type")
        if fields.get("ReachID", {}).get("type") != "esriFieldTypeString":
            raise ValueError("Original ReachID must retain its publisher text type")
        projection = body.get("spatialReference", {})
        if (projection.get("latestWkid") or projection.get("wkid")) not in (3857, 102100):
            raise ValueError("Original geometry must retain its EPSG:3857 coordinates")
        wanted_type = "esriGeometryPolyline" if kind == "stream" else "esriGeometryPolygon"
        if body.get("geometryType") != wanted_type or body.get("hasZ") is not True or body.get("hasM") is not True:
            raise ValueError("Original geometry type or Z/M metadata differs: " + page["path"])
        source_uri = page["url"]
        if "/query?" not in source_uri:
            raise ValueError("Retain the exact publisher request URI")
        layer = source_uri.split("/query?", 1)[0]
        features = body.get("features", [])
        ids = [feature["attributes"]["FID"] for feature in features]
        if len(set(ids)) != len(ids) or set(ids) != set(page["ids"]):
            raise ValueError("Original page feature IDs differ from its requested inventory")
        if observed[kind].intersection(ids):
            raise ValueError("Repeated original geometry feature across pages")
        observed[kind].update(ids)
        for feature in features:
            attributes = feature["attributes"]
            key = (layer, attributes["FID"])
            row = records.get(key)
            if row is None:
                raise ValueError("Original geometry FID is absent from the retained assessment table: " + str(key))
            if attributes != row["raw"]:
                changes = sorted(set(attributes) ^ set(row["raw"]) |
                    {name for name in set(attributes) & set(row["raw"])
                     if attributes[name] != row["raw"][name]})
                raise ValueError("Geometry and assessment capture attributes differ: " +
                                 json.dumps({"layer": layer, "FID": attributes["FID"], "fields": changes}))
            if not feature.get("geometry"):
                raise ValueError("Original assessed reach has no geometry")
            matched.add(key)
        source_id = "ga2024-" + kind + "-geometry-" + str(page["part"]).zfill(3)
        if source_id in page_ids:
            raise ValueError("Repeated original page identity")
        page_ids.add(source_id)
        result.append({
            "id": source_id, "path": str(native), **identity, "uri": source_uri,
            "source_crs": "EPSG:3857", "reach_id_field": "ReachID",
            "feature_id_field": "FID",
        })
        inventory.append({
            "id": source_id, "path": page["path"], **identity, "kind": kind,
            "original_feature_ids": ids, "uri": source_uri,
            "retrieval_completed_at": page.get("retrieval_completed_at"),
            "object_id_field": "FID", "reach_id_field": "ReachID",
            "spatial_reference": projection, "hasZ": True, "hasM": True,
        })
    if observed != expected or matched != set(records):
        raise ValueError("Original geometry does not cover the complete 295-row publisher edition")
    return result, inventory


def perform(args):
    application = Path(args.application).resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.common import atomic_json, digest, held
    from model.workspace import Workspace
    from source_tools.assessment_reach_geography import join_geography

    workspace = Workspace(args.workspace)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".ga-assessment.lock", blocking=False):
        manifest_path, assessment_entry, bank = selected_assessment(args.sources)
        geometry_manifest = Path(args.geometry_manifest).resolve(strict=True)
        verify(geometry_manifest, {"sha256": args.geometry_manifest_sha256})
        original_pages, capture_inventory = reach_sources(bank, geometry_manifest, args.geometry_root)
        capture_inventory_path = output / "original-geometry-inventory.json"
        domain_path, domain_entry = workspace.source_file(args.domain_collection, args.domain_source)
        if domain_entry.get("kind") != "vector":
            raise ValueError("Select the retained original HUC polygon source")
        if domain_entry["body"]["sha256"] != args.domain_sha256:
            raise ValueError("The selected Workspace domain differs from the accepting receiver's source")
        domain_identity = verify(domain_path, domain_entry["body"])
        view = source_view_root(domain_path, domain_entry["body"])
        companions = []
        for item in domain_entry.get("companions", []):
            original = member(view, item.get("view_path") or item["filename"])
            companions.append({"path": str(original), **verify(original, item)})
        domain = {"id": args.domain_source, "uri": domain_entry["uri"],
                  "path": str(domain_path), **domain_identity,
                  "huc_field": args.huc_field, "companions": companions}
        if args.domain_layer:
            domain["layer"] = args.domain_layer
        binding = {
            "project_id": workspace.project["id"],
            "assessment_manifest_sha256": fingerprint(manifest_path)["sha256"],
            "assessment_sha256": assessment_entry["sha256"],
            "geometry_manifest_sha256": args.geometry_manifest_sha256,
            "original_geometry": capture_inventory,
            "domain_collection_id": args.domain_collection, "domain_source_id": args.domain_source,
            "domain_sha256": domain_identity["sha256"], "huc_field": args.huc_field,
            "domain_layer": args.domain_layer,
        }
        state_path = output / "ga-assessment-operation.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": "upstate.ga-assessment-receiving/v1", "binding": binding}
        if state["binding"] != binding:
            raise ValueError("This operation directory already belongs to a different original selection")
        atomic_json(capture_inventory_path, capture_inventory)
        original_pages[0]["companions"] = [{"path": str(capture_inventory_path),
                                              **fingerprint(capture_inventory_path)}]
        configuration = {
            "assessment_schema": bank["schema"], "jurisdiction": "GA",
            "record_collection": "records",
            "record_fields": {"id": "native_reach_id", "name": "reach_name",
                              "assessment": "overall_assessment_raw"},
            "source_uri": bank["source"]["uri"],
            "source_id_prefix": "ga-approved2024-savannah",
            "title": "Georgia approved 2024 original assessment geography",
            "comparison_crs": "EPSG:26917", "domain": domain,
            "reach_sources": original_pages,
        }
        geo_source = application / "source_tools" / "assessment_reach_geography.py"
        geo_key = digest({"binding": binding, "configuration": configuration,
                          "implementation_sha256": fingerprint(geo_source)["sha256"]})
        geo_dir = output / ("geography-" + geo_key[:20])
        config_path = output / ("geography-configuration-" + geo_key[:20] + ".json")
        atomic_json(config_path, configuration)
        prior = state.get("geography", {})
        if prior.get("key") == geo_key and intact_outputs(geo_dir, prior.get("files", {})) and prior.get("files"):
            geography = read_json(geo_dir / "geography-context.json")
        else:
            state["phase"] = "original-reach-geography"
            atomic_json(state_path, state)
            geography = join_geography(bank, configuration, output, geo_dir)
            if len(geography["domain_hucs"]) != 217:
                raise ValueError("The selected original domain must contain all 217 distinct HUC12s")
            if geography["assessment_unit_ids_without_geometry"]:
                raise ValueError( "Original GA reach IDs were not read: " + json.dumps({
                    "missing_unit_ids": geography["assessment_unit_ids_without_geometry"],
                    "native_reader_details": geography["unmatched_original_geometry"][:5]}))
            state["geography"] = {"key": geo_key, "directory": str(geo_dir),
                                   "files": geography["files"]}
            atomic_json(state_path, state)
        if len(geography["domain_hucs"]) != 217:
            raise ValueError("The received geography is not the complete 217-HUC domain")
        relations = geo_dir / "geometry-relations.json"
        domain_hucs = geo_dir / "domain-hucs.json"
        producer = application / "source_tools" / "georgia_assessment.mjs"
        normalized_key = digest({"geography": geo_key,
                                 "relations_sha256": fingerprint(relations)["sha256"],
                                 "producer_sha256": fingerprint(producer)["sha256"],
                                 "receiving_source_sha256": fingerprint(__file__)["sha256"],
                                 "edition_composer_sha256": fingerprint(application / "source_tools" /
                                     "receive_north_carolina_assessment.py")["sha256"]})
        normalized_dir = output / ("assessment-" + normalized_key[:20])
        normalized_manifest = normalized_dir / "sources.json"
        original_selection = member(manifest_path.parent, "originals/selection.json")
        document_context = member(manifest_path.parent, "published-document-context.json")
        previous = state.get("normalized", {})
        if not (previous.get("key") == normalized_key and normalized_manifest.exists()
                and fingerprint(normalized_manifest)["sha256"] == previous.get("manifest_sha256")):
            state["phase"] = "geography-aware-scientific-source"
            atomic_json(state_path, state)
            command = [args.node, str(producer), "--input", str(original_selection),
                       "--document-context", str(document_context), "--output", str(normalized_dir),
                       "--relations", str(relations), "--domain-hucs", str(domain_hucs)]
            log = output / ("normalization-" + normalized_key[:20] + ".log")
            with log.open("w", encoding="utf-8") as stream:
                completed = subprocess.run(command, cwd=str(application), stdout=stream,
                                           stderr=subprocess.STDOUT, text=True, check=False)
            if completed.returncode:
                raise RuntimeError( "Maintained Georgia producer failed; full log " + str(log) + "\n"
                                   + log.read_text(encoding="utf-8")[-6000:])
            geographic_id = compose_native_edition(normalized_dir, geo_dir,
                                                    table_id="ga2024-gis-assessments-json")
            state["normalized"] = {
                "geographic_source_id": geographic_id,
                "key": normalized_key, "manifest": str(normalized_manifest),
                "manifest_sha256": fingerprint(normalized_manifest)["sha256"], "log": str(log)}
            atomic_json(state_path, state)
        # Import is content addressed by the maintained Workspace; retries reuse
        # identical original manifest/member records rather than creating tasks.
        state["phase"] = "source-import"
        atomic_json(state_path, state)
        normalized_collection = workspace.import_sources(normalized_manifest)
        geographic_id = state["normalized"]["geographic_source_id"]
        source_ids = [entry["id"] for entry in normalized_collection["entries"]
                      if entry["id"] != geographic_id]
        geographic_ids = [geographic_id]
        # Reopen using a new Workspace instance, then materialize the exact stored
        # source members through the ordinary hash-verifying native source view.
        reopened = Workspace(workspace.root)
        for collection in [normalized_collection]:
            for entry in collection["entries"]:
                reopened.source_file(collection["id"], entry["id"])
        final_bank = read_json(normalized_dir / "assessments.json")
        state.update({
            "phase": "complete", "workspace": str(workspace.root),
            "application": str(application),
            "normalized_source_collection_id": normalized_collection["id"],
            "normalized_source_ids": source_ids,
            "geographic_source_collection_id": normalized_collection["id"],
            "geographic_source_ids": geographic_ids,
            "summary": final_bank["summary"],
            "geography_summary": {key: geography[key] for key in
                                  ["feature_count", "positive_relation_count", "boundary_touch_count",
                                   "assessment_unit_ids_without_geometry"]},
            "scientific_report_source_id": "ga2024-gis-observed-report",
            "geographic_assessment_summary": final_bank.get("geographic_summary"),
            "original_geometry_inventory": str(capture_inventory_path),
            "result_path": str(state_path),
        })
        atomic_json(state_path, state)
        return state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--sources", required=True, help="Complete normalized Georgia sources.json")
    parser.add_argument("--geometry-manifest", required=True, help="Retained eleven-page source capture manifest")
    parser.add_argument("--geometry-manifest-sha256", required=True)
    parser.add_argument("--geometry-root", required=True, help="Directory containing unchanged original response pages")
    parser.add_argument("--domain-collection", required=True)
    parser.add_argument("--domain-source", required=True)
    parser.add_argument("--domain-sha256", required=True)
    parser.add_argument("--huc-field", required=True)
    parser.add_argument("--domain-layer")
    parser.add_argument("--output", required=True)
    parser.add_argument("--node", default="node")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(perform(args), ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except Exception:
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
