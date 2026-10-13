"""Prepared original-data gauge, lake and outfall studies for Station Geography."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .common import atomic_json, canonical, digest, verify_file
from .station_study import _entries, _by_hash, _ref, _domain, _import_once

SPEC_PATH = Path(__file__).with_name("observed_station_studies.json")
REFERENCE_FIELDS = ("station_id_field", "native_id_field", "source_crs", "record_id_field", "id_field")


def specification():
    value = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    if value.get("schema") != "upstate.observed-station-recipes/v1":
        raise ValueError("Choose the retained observed-station recipe edition")
    return value


def _domain_from_catalog(workspace, rows, original_studies):
    for study in original_studies or []:
        if study.get("source_summary", {}).get("watershed_count") == 217:
            refs = study.get("selection", {}).get("watersheds", [])
            if len(refs) == 1 and refs[0].get("source_sha256"):
                return dict(refs[0]), 217, []
    return _domain(workspace, rows)


def _original_features(workspace, item, definition):
    path, unused = workspace.source_file(item[0]["id"], item[1]["id"])
    body = Path(path).read_bytes()
    if hashlib.sha256(body).hexdigest() != definition["sha256"]:
        raise ValueError("Original station source bytes changed: " + definition["title"])
    value = json.loads(body.decode("utf-8-sig"))
    features = value.get("features", [])
    if value.get("type") != "FeatureCollection" or len(features) != definition["expected_features"]:
        raise ValueError("Original feature inventory differs: " + definition["title"])
    ids = [feature.get("properties", {}).get(definition.get("station_id_field", definition.get("id_field"))) for feature in features]
    if any(not isinstance(station, str) or not station for station in ids) or len(set(ids)) != len(ids):
        raise ValueError("Original feature inventory has absent or repeated station identities")
    return features


def prepared_studies(workspace, original_studies=None):
    """Resolve exact retained byte identities to ordinary editable selections."""
    spec = specification()
    rows = _entries(workspace)
    domain, domain_count, domain_problems = _domain_from_catalog(workspace, rows, original_studies)
    bound, features, source_problems = {}, {}, {}
    for key, definition in spec["sources"].items():
        eligible = rows
        required_manifest = definition.get("source_manifest_sha256")
        if required_manifest:
            eligible = [(collection, entry) for collection, entry in rows
                        if collection.get("original_manifest", {}).get("sha256") == required_manifest]
        item = _by_hash(eligible, [definition["sha256"]], {definition["kind"]})
        if item is None:
            continue
        try:
            if definition["kind"] == "vector":
                features[key] = _original_features(workspace, item, definition)
            else:
                workspace.source_file(item[0]["id"], item[1]["id"])
            bound[key] = item
        except (OSError, ValueError, TypeError, KeyError) as problem:
            source_problems[key] = str(problem)
    studies = []
    for recipe in spec["studies"]:
        needed = list(dict.fromkeys([*recipe["point_sources"], *recipe["observation_tables"],
                                    *recipe.get("watershed_sources", [])]))
        missing = [source_problems.get(key, "Import " + spec["sources"][key]["title"] + ".")
                   for key in needed if key not in bound]
        if recipe.get("require_original_domain") and domain is None:
            missing.append("Import the retained original 217-HUC12 model domain.")
            missing.extend(domain_problems)
        selection = {"title": recipe["title"], "sources": [], "site_tables": [],
                     "watersheds": [], "observation_ids": [], "observation_tables": [],
                     "sites": json.loads(json.dumps(recipe["sites"])), "aliases": {}, "choices": {}}
        for field, keys in (("sources", recipe["point_sources"]),
                            ("observation_tables", recipe["observation_tables"]),
                            ("watersheds", recipe.get("watershed_sources", []))):
            for key in keys:
                if key in bound:
                    definition = spec["sources"][key]
                    selection[field].append(_ref(bound[key], **{
                        name: definition[name] for name in REFERENCE_FIELDS if name in definition}))
        if domain is not None:
            selection["watersheds"].insert(0, domain)
        choice_key = recipe.get("location_choice_source", recipe.get("outfall_choice_source"))
        if choice_key in bound:
            definition = spec["sources"][choice_key]
            item = bound[choice_key]
            for index, feature in enumerate(features[choice_key]):
                props = feature["properties"]
                station = props[definition["station_id_field"]]
                selection["choices"][station] = _ref(item,
                    native_feature_id=props[definition["native_id_field"]], source_feature_index=index)
        if recipe.get("source_context"):
            selection["observed_source_context"] = json.loads(json.dumps(recipe["source_context"]))
        roles = {}
        for site in selection["sites"]:
            roles[site["role"]] = roles.get(site["role"], 0) + 1
        studies.append({"id": recipe["id"], "title": recipe["title"], "ready": not missing,
            "missing": missing, "selection": selection,
            "source_summary": {"station_count": len(selection["sites"]), "station_roles": roles,
                "watershed_count": domain_count,
                "additional_whole_catchment_sources": len(recipe.get("watershed_sources", [])),
                "additional_whole_catchment_features": sum(
                    spec["sources"][key]["expected_features"]
                    for key in recipe.get("watershed_sources", [])),
                "observation_table_count": len(selection["observation_tables"]),
                "selected_outfall_geometry": recipe.get("outfall_choice_source"),
                "selected_coordinate_source": choice_key,
                "retained_flow_days": sum(site.get("retained_flow_days", 0) for site in selection["sites"]),
                "retained_stage_days": sum(site.get("retained_stage_days", 0) for site in selection["sites"]),
                "source_count": len(needed)},
            "source_links": [{"title": spec["sources"][key]["title"],
                             "uri": bound[key][1].get("uri"),
                             "source_sha256": spec["sources"][key]["sha256"]}
                            for key in needed if key in bound]})
    return studies


def prepare(workspace, study_id, manifests=()):
    imported = [_import_once(workspace, manifest)["id"] for manifest in manifests]
    studies = {study["id"]: study for study in prepared_studies(workspace)}
    if study_id not in studies:
        raise ValueError("Choose an original observed-station study")
    study = studies[study_id]
    result = {"schema": "upstate.prepared-observed-station-study/v1", "study": study,
              "imported_collection_ids": imported}
    if study["ready"]:
        operation_id = digest({"study_id": study_id, "selection": study["selection"]})
        path = workspace.root / "station-study-selections" / operation_id / "selection.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(path, study["selection"], immutable=True)
        result.update(operation_id=operation_id, selection_path=str(path),
            action="station.geography.build", payload={"selection": study["selection"]})
    return result


def _portable_identity(result):
    """Compare preserved facts while excluding the receiving collection address."""
    def source(ref):
        return {key: (ref or {}).get(key) for key in
                ("source_id", "source_sha256", "native_feature_id", "source_feature_index")}
    values = []
    for station in result["stations"]:
        values.append({
            "station_id": station["station_id"], "status": station["status"],
            "coordinates": station["coordinates"], "watershed_status": station["watershed_status"],
            "observation_count": station["observation_count"],
            "selected_source": source(station.get("selected_source_ref")),
            "candidates": sorted([{"source": source(candidate["source_ref"]),
                "native_crs": candidate["native_crs"],
                "native_geometry": candidate["native_geometry"],
                "coordinates_wgs84": candidate["coordinates_wgs84"],
                "properties": candidate["properties"]} for candidate in station["candidates"]], key=canonical),
            "watersheds": sorted([{"watershed_id": item["watershed_id"], "relation": item["relation"],
                "source": source(item.get("source_ref"))} for item in station["watersheds"]], key=canonical)})
    return sorted(values, key=canonical)


def operate(workspace, study_id, manifests=(), receiving_workspace=None):
    from . import station_geography
    result = prepare(workspace, study_id, manifests)
    result["workspace"] = {"root": str(workspace.root), "project_id": workspace.project["id"]}
    if not result["study"]["ready"]:
        return result
    edition = station_geography.build(workspace, result["study"]["selection"])
    edition = station_geography.inspect(workspace, edition["id"], verify=True, include_result=True)
    archives = [item for item in edition["files"] if Path(item["path"]).name == "station-geography.zip"]
    if len(archives) != 1:
        raise ValueError("The observed station study has no unique portable geography archive")
    archive = verify_file(workspace.root, archives[0])
    result["edition"] = {key: edition[key] for key in ("id", "title", "build_id", "summary", "files")}
    result["archive"] = {**archives[0], "absolute_path": str(archive)}
    if receiving_workspace is not None:
        if receiving_workspace.root.resolve() == workspace.root.resolve():
            raise ValueError("Choose a separate receiving Workspace")
        received = station_geography.receive(receiving_workspace, archive)
        received = station_geography.inspect(receiving_workspace, received["id"], verify=True, include_result=True)
        if _portable_identity(edition["result"]) != _portable_identity(received["result"]):
            raise ValueError("Received station identities, geometry choices or original observations changed")
        if edition["summary"] != received["summary"]:
            raise ValueError("The received station-study summary differs")
        result["received"] = {"workspace": {"root": str(receiving_workspace.root),
                                            "project_id": receiving_workspace.project["id"]},
                             "edition": {key: received[key] for key in ("id", "title", "build_id", "summary", "files")}}
    return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--source-manifest", action="append", default=[])
    parser.add_argument("--study-id", choices=[study["id"] for study in specification()["studies"]])
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--receive-workspace")
    parser.add_argument("--create-receiving-workspace", action="store_true")
    args = parser.parse_args(argv)
    if not args.list and not args.study_id:
        parser.error("Choose --study-id or --list")
    if args.create_receiving_workspace and not args.receive_workspace:
        parser.error("--create-receiving-workspace requires --receive-workspace")
    if args.receive_workspace and Path(args.workspace).resolve() == Path(args.receive_workspace).resolve():
        parser.error("Choose a separate receiving Workspace directory")
    workspace = Workspace(args.workspace, create=args.create_workspace,
                          title="Upper Savannah original observation geography")
    if args.list:
        imported = [_import_once(workspace, manifest)["id"] for manifest in args.source_manifest]
        print(json.dumps({"prepared_studies": prepared_studies(workspace),
                          "imported_collection_ids": imported}, ensure_ascii=False, indent=2))
        return 0
    receiving = (Workspace(args.receive_workspace, create=args.create_receiving_workspace,
                           title="Upper Savannah received observation geography")
                 if args.receive_workspace else None)
    result = (operate(workspace, args.study_id, args.source_manifest, receiving)
              if args.build or receiving else prepare(workspace, args.study_id, args.source_manifest))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if result["study"]["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
