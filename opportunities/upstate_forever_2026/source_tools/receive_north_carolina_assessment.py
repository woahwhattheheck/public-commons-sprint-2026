#!/usr/bin/env python3
"""Receive the retained NC final-2022 assessment into an existing regional Workspace.

The operation resolves its domain through the maintained source registry, calls
the shared original-reach geography implementation, regenerates the existing
scientific recipe with those relations, and imports one complete native edition.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path, PurePosixPath
import subprocess
import sys
import traceback


def fingerprint(path):
    value = Path(path)
    digest = hashlib.sha256()
    size = 0
    with value.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def member(root, name):
    relative = PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts or "\\" in name:
        raise ValueError("Source member must remain within its original edition: " + name)
    selected = (Path(root) / name).resolve(strict=True)
    if not selected.is_relative_to(Path(root).resolve()) or not selected.is_file():
        raise ValueError("Source member escapes its original edition: " + name)
    return selected


def verify(path, descriptor):
    actual = fingerprint(path)
    if actual["sha256"] != descriptor["sha256"] or (
            "bytes" in descriptor and actual["bytes"] != descriptor["bytes"]):
        raise ValueError("Original source identity differs: " + str(path))
    return actual


def source_view_root(primary, descriptor):
    name = PurePosixPath(descriptor.get("view_path") or descriptor["filename"])
    root = Path(primary)
    for _ in name.parts:
        root = root.parent
    if (root / name).resolve() != Path(primary).resolve():
        raise ValueError("Original Workspace source view has an inconsistent member path")
    return root


def selected_assessment(manifest_path):
    manifest_path = Path(manifest_path).resolve(strict=True)
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the complete normalized NC source manifest")
    selected = [row for row in manifest["entries"]
                if row.get("id") == "ncdeq-final-2022-savannah-assessment-context"]
    if len(selected) != 1:
        raise ValueError("Select the original normalized NC assessment entry")
    entry = selected[0]
    path = member(manifest_path.parent, entry["path"])
    verify(path, entry)
    # The scientific recipe and its original references must already be portable.
    for record in manifest["entries"]:
        for descriptor in [record, *record.get("companions", [])]:
            verify(member(manifest_path.parent, descriptor["path"]), descriptor)
    bank = read_json(path)
    if bank.get("schema") != "upstate.nc-integrated-assessment/v1":
        raise ValueError("Wrong normalized assessment schema")
    if len(bank.get("assessment_units", [])) != 110 or len(bank.get("source_features", [])) != 144:
        raise ValueError("Select the complete 110-unit / 144-feature original NC edition")
    if len(bank.get("parameter_records", [])) != 77:
        raise ValueError("Select all 77 original parameter determinations")
    return manifest_path, entry, bank


def reach_sources(bank, normalized_root):
    grouped = {}
    for feature in bank["source_features"]:
        locator = feature["source_locator"]
        geometry = feature["geometry_locator"]
        if (geometry["path"] != locator["path"] or geometry["sha256"] != locator["sha256"]
                or geometry["json_pointer"] != locator["json_pointer"] + "/geometry"):
            raise ValueError("Original geometry pointer differs from its feature pointer")
        filename = locator["path"]
        current = grouped.setdefault(filename, {
            "locator": locator, "kind": feature["geometry_type"], "features": []})
        if (current["locator"]["sha256"] != locator["sha256"]
                or current["kind"] != feature["geometry_type"]):
            raise ValueError("One original source page has conflicting identity/type")
        current["features"].append(feature)
    result = []
    for index, (filename, group) in enumerate(sorted(grouped.items())):
        locator = group["locator"]
        path = member(normalized_root, filename)
        identity = verify(path, locator)
        original = read_json(path)
        rows = original.get("features", [])
        expected = {str(row["attributes"][locator["object_id_field"]])
                    for row in group["features"]}
        observed = {str(row["attributes"][locator["object_id_field"]]) for row in rows}
        if expected != observed or len(observed) != len(rows):
            raise ValueError("Original page OBJECTID inventory differs from the normalized source")
        metadata_crs = original.get("spatialReference", {})
        if (metadata_crs.get("latestWkid") or metadata_crs.get("wkid")) not in (3857, 102100):
            raise ValueError("Select the original EPSG:3857 NC assessment geometry")
        if not locator.get("uri"):
            raise ValueError("Original geometry page lacks its retained request URI")
        result.append({
            "id": "nc-final2022-layer-" + str(locator["layer_id"]) + "-page-" + str(index + 1),
            "path": str(path), **identity, "uri": locator["uri"],
            "source_crs": "EPSG:3857", "reach_id_field": "AU_ID",
            "feature_id_field": locator["object_id_field"],
        })
    if len(result) != 29:
        raise ValueError("Select all 22 stream and seven polygon original pages")
    return result


def intact_outputs(directory, descriptors):
    try:
        for descriptor in descriptors.values():
            verify(member(directory, descriptor["path"]), descriptor)
    except (OSError, ValueError, KeyError):
        return False
    return True



def compose_native_edition(normalized_dir, geographic_dir, *,
                           table_id="ncdeq-final-2022-savannah-assessment-context"):
    """Join the existing typed entries and report inputs, reusing exact NC bodies."""
    normalized_dir, geographic_dir = Path(normalized_dir), Path(geographic_dir)
    manifest_path = normalized_dir / "sources.json"
    manifest = read_json(manifest_path)
    geographic_manifest = read_json(geographic_dir / "geography-sources.json")
    if len(geographic_manifest.get("entries", [])) != 1:
        raise ValueError("Select the shared helper's one complete assessed-reach vector entry")
    known_by_path, existing_by_identity = {}, {}
    for entry in manifest["entries"]:
        for descriptor in [entry, *entry.get("companions", [])]:
            verify(member(normalized_dir, descriptor["path"]), descriptor)
            key = (descriptor["sha256"], descriptor["bytes"])
            existing_by_identity.setdefault(key, descriptor["path"])
            identity = {key: descriptor[key] for key in ["path", "bytes", "sha256"]}
            prior = known_by_path.setdefault(descriptor["path"], identity)
            if prior != identity:
                raise ValueError("Source edition has conflicting member identities")
    original_entry = geographic_manifest["entries"][0]
    remapped, geographic_members = {}, {}
    for descriptor in [original_entry, *original_entry.get("companions", [])]:
        original = member(geographic_dir, descriptor["path"])
        actual = verify(original, descriptor)
        key = (actual["sha256"], actual["bytes"])
        destination_name = (None if descriptor["path"].startswith("originals/0/")
                            else existing_by_identity.get(key))
        if destination_name is None:
            destination_name = "geography/" + descriptor["path"]
            destination = normalized_dir / destination_name
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                verify(destination, descriptor)
            else:
                shutil.copyfile(original, destination)
                verify(destination, descriptor)
            existing_by_identity[key] = destination_name
        remapped[descriptor["path"]] = destination_name
        geographic_members[destination_name] = {"path": destination_name, **actual}
    geographic_entry = dict(original_entry)
    geographic_entry["path"] = remapped[original_entry["path"]]
    geographic_entry["companions"] = list({
        remapped[row["path"]]: {**row, "path": remapped[row["path"]]}
        for row in original_entry.get("companions", [])
        if remapped[row["path"]] != geographic_entry["path"]}.values())
    selected = [entry for entry in manifest["entries"] if entry.get("role") == "OBSERVED_CONTEXT"]
    tables = [entry for entry in manifest["entries"]
              if entry.get("id") == table_id]
    if len(selected) != 1 or len(tables) != 1:
        raise ValueError("Retain the selected assessment table and its scientific recipe together")
    report_entry = selected[0]
    recipe_path = member(normalized_dir, report_entry["path"])
    recipe = read_json(recipe_path)
    if recipe.get("schema") != "upstate.observed-report/v1":
        raise ValueError("Select the maintained scientific report recipe")
    inputs = {row["path"]: row for row in recipe["inputs"]}
    for name, descriptor in geographic_members.items():
        if name == report_entry["path"]:
            raise ValueError("A scientific recipe cannot include itself as an input")
        previous = inputs.setdefault(name, descriptor)
        if previous["sha256"] != descriptor["sha256"] or previous["bytes"] != descriptor["bytes"]:
            raise ValueError("Scientific geometry input conflicts with an original member")
    recipe["inputs"] = list(inputs.values())
    links = [
        {"title": "Original assessed-reach map layer", "path": geographic_entry["path"]},
        {"title": "Original domain and reach-source identities",
         "path": remapped["geography-context.json"]},
        {"title": "Every positive-dimensional intersection and boundary contact",
         "path": remapped["geometry-relations.json"]},
    ]
    recipe["sections"].append(["Original regional assessment geography", [
        "This source edition retains the original 217-watershed domain, the original "
        "jurisdiction stream and polygon responses, and the completed geographic relationships. "
        "Assessment units, individual geometry features and parameter records retain "
        "separate identities.",
        {"kind": "table", "columns": ["Retained geographic source", "Member path"],
         "rows": [[row["title"], row["path"]] for row in links], "widths": [2, 3]},
    ]])
    recipe["source_links"] = list(dict.fromkeys(
        [*recipe.get("source_links", []), *(row["path"] for row in links)]))
    recipe_path.write_text(json.dumps(recipe, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    report_entry.update(fingerprint(recipe_path))
    report_entry["companions"] = recipe["inputs"]
    metadata = report_entry.setdefault("metadata", {})
    metadata["related_source_ids"] = list(dict.fromkeys(
        [*metadata.get("related_source_ids", []), tables[0]["id"], geographic_entry["id"]]))
    relationships = metadata.setdefault("source_relationships", [])
    for selected_id, relationship in [
            (tables[0]["id"], "original_jurisdiction_assessment"),
            (geographic_entry["id"], "original_assessment_domain_geometry")]:
        if not any(row.get("id") == selected_id for row in relationships):
            relationships.append({"id": selected_id, "relationship": relationship})
    table_members = {row["path"]: row for row in tables[0].get("companions", [])}
    for name, descriptor in geographic_members.items():
        if name != tables[0]["path"]:
            previous = table_members.setdefault(name, descriptor)
            if previous["sha256"] != descriptor["sha256"] or previous["bytes"] != descriptor["bytes"]:
                raise ValueError("Geographic companion conflicts with a retained assessment member")
    tables[0]["companions"] = list(table_members.values())
    manifest["entries"].insert(1, geographic_entry)
    if len({row["id"] for row in manifest["entries"]}) != len(manifest["entries"]):
        raise ValueError("The complete native edition has duplicate source identities")
    note = ("Original assessment table, native domain/reach geometry and scientific recipe "
            "are retained together; exact duplicate original bodies reuse their original paths.")
    previous_notes = manifest.get("notes")
    if isinstance(previous_notes, list):
        manifest["notes"] = [*previous_notes, note]
    elif isinstance(previous_notes, str):
        manifest["notes"] = previous_notes + "\n" + note
    elif previous_notes is None:
        manifest["notes"] = [note]
    else:
        raise ValueError("Source manifest notes must be text or a list")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    return geographic_entry["id"]


def perform(args):
    application = Path(args.application).resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.common import atomic_json, digest, held
    from model.workspace import Workspace
    from source_tools.assessment_reach_geography import join_geography

    workspace = Workspace(args.workspace)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".nc-assessment.lock", blocking=False):
        manifest_path, assessment_entry, bank = selected_assessment(args.sources)
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
            "domain_collection_id": args.domain_collection, "domain_source_id": args.domain_source,
            "domain_sha256": domain_identity["sha256"], "huc_field": args.huc_field,
            "domain_layer": args.domain_layer,
        }
        state_path = output / "nc-assessment-operation.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": "upstate.nc-assessment-receiving/v1", "binding": binding}
        if state["binding"] != binding:
            raise ValueError("This operation directory already belongs to a different original selection")
        configuration = {
            "assessment_schema": bank["schema"], "jurisdiction": "NC",
            "record_collection": "assessment_units",
            "record_fields": {"id": "native_reach_id", "name": "names",
                              "assessment": "overall_assessments_raw"},
            "source_uri": bank["source"]["uri"],
            "source_id_prefix": "nc-final2022-savannah",
            "title": "North Carolina final 2022 original assessment geography",
            "comparison_crs": "EPSG:26917", "domain": domain,
            "reach_sources": reach_sources(bank, manifest_path.parent),
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
                raise ValueError("Original NC unit IDs were not read: " + json.dumps({
                    "missing_unit_ids": geography["assessment_unit_ids_without_geometry"],
                    "native_reader_details": geography["unmatched_original_geometry"][:5]}))
            state["geography"] = {"key": geo_key, "directory": str(geo_dir),
                                   "files": geography["files"]}
            atomic_json(state_path, state)
        if len(geography["domain_hucs"]) != 217:
            raise ValueError("The received geography is not the complete 217-HUC domain")
        relations = geo_dir / "geometry-relations.json"
        domain_hucs = geo_dir / "domain-hucs.json"
        producer = application / "source_tools" / "north_carolina_assessment.mjs"
        normalized_key = digest({"geography": geo_key,
                                 "relations_sha256": fingerprint(relations)["sha256"],
                                 "producer_sha256": fingerprint(producer)["sha256"],
                                 "receiving_source_sha256": fingerprint(__file__)["sha256"]})
        normalized_dir = output / ("assessment-" + normalized_key[:20])
        normalized_manifest = normalized_dir / "sources.json"
        normalization_config = member(manifest_path.parent, "input-configuration.json")
        original_root = (manifest_path.parent / "original").resolve(strict=True)
        previous = state.get("normalized", {})
        if not (previous.get("key") == normalized_key and normalized_manifest.exists()
                and fingerprint(normalized_manifest)["sha256"] == previous.get("manifest_sha256")):
            state["phase"] = "geography-aware-scientific-source"
            atomic_json(state_path, state)
            command = [args.node, str(producer), "--configuration", str(normalization_config),
                       "--input", str(original_root), "--output", str(normalized_dir),
                       "--relations", str(relations), "--domain-hucs", str(domain_hucs)]
            log = output / ("normalization-" + normalized_key[:20] + ".log")
            with log.open("w", encoding="utf-8") as stream:
                completed = subprocess.run(command, cwd=str(application), stdout=stream,
                                           stderr=subprocess.STDOUT, text=True, check=False)
            if completed.returncode:
                raise RuntimeError("Maintained NC producer failed; full log " + str(log) + "\n"
                                   + log.read_text(encoding="utf-8")[-6000:])
            geographic_id = compose_native_edition(normalized_dir, geo_dir)
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
            "scientific_report_source_id": "ncdeq-final-2022-savannah-scientific-report",
            "result_path": str(state_path),
        })
        atomic_json(state_path, state)
        return state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--sources", required=True, help="Complete normalized NC sources.json")
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
