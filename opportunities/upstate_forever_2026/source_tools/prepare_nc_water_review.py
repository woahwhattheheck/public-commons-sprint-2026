#!/usr/bin/env python3
"""Run the complete NC classification crosswalk against the retained regional Workspace."""
from __future__ import annotations
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.workspace import Workspace
from model.common import atomic_json, file_digest, held
from source_tools.high_quality_water_crosswalk import build_crosswalk, FOCUS_HUCS, PLANNING_SHA256

NC_SOURCE = APPLICATION / "source/water_classifications/north_carolina/20261013"
DOMAIN_SOURCE_ID = "upstate-wbd-upstream-domain-20261012"
DOMAIN_DECODED_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"

def candidates(workspace):
    rows = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            for body in [entry["body"]] + entry.get("companions", []):
                rows.append({"collection_id": collection["id"], "source_id": entry["id"],
                             "body": body, "entry": entry,
                             "name": body.get("source_path", body.get("filename", ""))})
    return rows

def materialize(workspace, row):
    path, entry = workspace.source_file(row["collection_id"], row["source_id"])
    primary_name = entry["body"].get("view_path", entry["body"]["filename"])
    root = path.parents[len(PurePosixPath(primary_name).parts) - 1]
    body = row["body"]
    member = PurePosixPath(body.get("view_path", body["filename"]))
    if member.is_absolute() or ".." in member.parts:
        raise ValueError("Original retained source member has an invalid path")
    result = root.joinpath(*member.parts)
    if not result.is_file() or result.stat().st_size != body["bytes"] or file_digest(result) != body["sha256"]:
        raise ValueError("Materialized source differs from retained original: " + row["name"])
    return result

def decoded(path):
    body = path.read_bytes()
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body

def unique_source(rows, label, selected_sha=None):
    if selected_sha:
        rows = [row for row in rows if row["body"]["sha256"] == selected_sha]
    # Duplicate immutable views with identical bytes are the same source content.
    by_hash = {}
    for row in sorted(rows, key=lambda x: (x["collection_id"], x["source_id"], x["name"])):
        by_hash.setdefault(row["body"]["sha256"], row)
    if len(by_hash) != 1:
        options = [{"collection_id": row["collection_id"], "source_id": row["source_id"],
                    "path": row["name"], "sha256": checksum} for checksum, row in by_hash.items()]
        raise ValueError("Select the retained original " + label + " from actual candidates: " + json.dumps(options))
    return next(iter(by_hash.values()))

def planning_members(row):
    """Keep original shape, attribute, CRS and index companions together."""
    main = PurePosixPath(row["body"].get("view_path", row["body"]["filename"]))
    selected = {}
    for body in [row["entry"]["body"]] + row["entry"].get("companions", []):
        path = PurePosixPath(body.get("view_path", body["filename"]))
        if path.parent != main.parent:
            continue
        if path.stem == main.stem or path.name == main.name + ".xml":
            suffix = path.name[len(main.stem):]
            if suffix in selected:
                raise ValueError("The original planning entry repeats companion " + suffix)
            selected[suffix] = {"bytes": body["bytes"], "sha256": body["sha256"]}
    missing = {".shp", ".shx", ".dbf", ".prj"} - set(selected)
    if missing:
        raise ValueError("The original planning entry lacks companions: " + ", ".join(sorted(missing)))
    return selected

def planning_source(rows, collection_id=None):
    selected = [row for row in rows if row["body"]["sha256"] == PLANNING_SHA256
                and Path(row["name"]).suffix.lower() == ".shp"
                and (collection_id is None or row["collection_id"] == collection_id)]
    editions = {}
    for row in sorted(selected, key=lambda x: (x["collection_id"], x["source_id"], x["name"])):
        members = planning_members(row)
        key = json.dumps(members, sort_keys=True, separators=(",", ":"))
        editions.setdefault(key, (row, members))
    if len(editions) != 1:
        options = [{"collection_id": row["collection_id"], "source_id": row["source_id"],
                    "path": row["name"], "companions": members}
                   for row, members in editions.values()]
        raise ValueError("Choose an original planning edition with --planning-collection; "
                         "shape, attributes and CRS must stay together: " + json.dumps(options))
    return next(iter(editions.values()))

def review_catalog(workspace, registry_id, crosswalk_id):
    """Exercise the installed original provider without starting another Operator."""
    path = APPLICATION / "operator/water_source_review.py"
    spec = importlib.util.spec_from_file_location("_nc_opening_water_source_review", path)
    if spec is None or spec.loader is None:
        raise ValueError("The installed Water source review provider is unavailable")
    provider = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(provider)
    catalog = provider.catalog(workspace)
    registries = [row for row in catalog["registries"]
                  if row["collection_id"] == registry_id
                  and row["source_id"] == "nc-savannah-classification-registry"
                  and row.get("registry_origin") == "standalone"]
    crosswalks = [row for row in catalog["crosswalks"] if row["collection_id"] == crosswalk_id]
    if len(registries) != 1 or len(crosswalks) != 1:
        raise ValueError("The retained NC registry and crosswalk must both open in Water source review")
    registry, crosswalk = registries[0], crosswalks[0]
    if (registry.get("jurisdiction") != "NC"
            or registry.get("classification_system") != "NC-15A-NCAC-02B"
            or registry.get("designation_status") != "source-published"
            or registry.get("data_status") != "source-published"):
        raise ValueError("The retained NC catalogue must preserve its jurisdiction and source edition")
    return {"producer_version": catalog["producer_version"],
            "registry": registry, "crosswalk": crosswalk,
            "selection": {"registry_collection": registry_id,
                          "registry_source": registry["source_id"],
                          "crosswalk_collection": crosswalk_id,
                          "crosswalk_source": crosswalk["source_id"]}}

def prepare(workspace, output, *, focus_sha=None, domain_collection=None, planning_collection=None):
    output = Path(output).resolve()
    if output == workspace.root or output.is_relative_to(workspace.root):
        raise ValueError("Use a receiving output outside the scientific Workspace")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".nc-water-opening.lock", blocking=False):
        return _prepare(workspace, output, focus_sha=focus_sha,
                        domain_collection=domain_collection, planning_collection=planning_collection)

def _prepare(workspace, output, *, focus_sha=None, domain_collection=None, planning_collection=None):
    rows = candidates(workspace)
    planning, planning_companions = planning_source(rows, planning_collection)
    focus = unique_source([row for row in rows if Path(row["name"]).name == "selected-four-huc12.json.gz"],
                          "four-focus HUC12 response", focus_sha)
    domains = [row for row in rows if row["source_id"] == DOMAIN_SOURCE_ID
               and row["body"] is row["entry"]["body"]
               and (domain_collection is None or row["collection_id"] == domain_collection)]
    domain_candidates = []
    for row in domains:
        path = materialize(workspace, row)
        if hashlib.sha256(decoded(path)).hexdigest() == DOMAIN_DECODED_SHA256:
            domain_candidates.append(row)
    # Compression editions can differ while the exact decoded original is identical.
    if not domain_candidates:
        raise ValueError("Retain the original 217-HUC source " + DOMAIN_SOURCE_ID +
                         " with decoded SHA256 " + DOMAIN_DECODED_SHA256)
    domain = sorted(domain_candidates, key=lambda x: (x["collection_id"], x["source_id"]))[0]
    selected = {"planning": planning, "focus": focus, "domain": domain}
    paths = {key: materialize(workspace, row) for key, row in selected.items()}
    focus_body = json.loads(decoded(paths["focus"]))
    domain_body = json.loads(decoded(paths["domain"]))
    def huc_ids(body):
        found = []
        for feature in body.get("features", []):
            attributes = feature.get("attributes", feature.get("properties", {}))
            names = {key.casefold(): key for key in attributes}
            if "huc12" not in names:
                raise ValueError("Original watershed lacks HUC12")
            found.append(str(attributes[names["huc12"]]))
        if len(found) != len(set(found)):
            raise ValueError("Original watershed source repeats HUC12")
        return found
    if set(huc_ids(focus_body)) != set(FOCUS_HUCS) or len(huc_ids(domain_body)) != 217:
        raise ValueError("Original four-focus and complete217 source identities differ")
    for name in ("capture.json", "mapping.json", "derived/classification-registry.json",
                 "derived/combined-native-features.json"):
        if not (NC_SOURCE / name).is_file():
            raise ValueError("Run node source/water_classifications/north_carolina/20261013/build-nc-source.mjs first")
    resolved = {key: {"collection_id": row["collection_id"], "source_id": row["source_id"],
                      "source_path": row["name"], "sha256": row["body"]["sha256"],
                      "materialized_path": str(paths[key])} for key, row in selected.items()}
    resolved["planning"]["companions"] = planning_companions
    request = {"schema": "upstate.nc-classified-water-opening-request/v1",
               "project_id": workspace.project["id"], "workspace": str(workspace.root),
               "original_geography": resolved,
               "registry_manifest_sha256": file_digest(APPLICATION / "nc_classified_water_sources.json")}
    atomic_json(output / "request.json", request, immutable=True)
    # Import the complete, hash-bound schedule/source family into the same Workspace.
    registry_collection = workspace.import_sources(APPLICATION / "nc_classified_water_sources.json")
    result = build_crosswalk(
        NC_SOURCE, NC_SOURCE / "mapping.json", None, output / "crosswalk",
        huc_paths=[paths["domain"]], registry_paths=[NC_SOURCE / "derived/classification-registry.json"],
        workspace_root=workspace.root, planning_path=paths["planning"], focus_path=paths["focus"])
    catalog = review_catalog(workspace, registry_collection["id"], result["source_collection"]["id"])
    final = {"schema": "upstate.nc-classified-water-workspace-opening/v1",
             "original_geography": resolved, "registry_collection_id": registry_collection["id"],
             "review_catalog": catalog, "result": result}
    output.mkdir(parents=True, exist_ok=True)
    atomic_json(output / "opening.json", final)
    return final

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--focus-sha", help="Choose an actual retained four-focus edition if multiple byte editions exist")
    parser.add_argument("--domain-collection", help="Choose an actual collection containing the original217 domain")
    parser.add_argument("--planning-collection", help="Choose one actual planning edition when retained sidecars differ")
    args = parser.parse_args(argv)
    print(json.dumps(prepare(Workspace(args.workspace), args.output,
                             focus_sha=args.focus_sha, domain_collection=args.domain_collection,
                             planning_collection=args.planning_collection), indent=2))

if __name__ == "__main__":
    main()
