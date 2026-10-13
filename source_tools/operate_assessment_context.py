#!/usr/bin/env python3
"""Import original assessment points and operate the existing native spatial review."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import sys

ORIGINAL_DOMAIN_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
FOCUS_HUCS = ("030601010703", "030601010704", "030601020507", "030601020502")
EIGHTEENMILE_HUCS = ("030601010601", "030601010602")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, value):
    from model.common import atomic_json
    atomic_json(Path(path), value)


def verify_inputs(root, manifest):
    checked = {}
    for entry in manifest["entries"]:
        for item in [entry] + entry.get("companions", []):
            relative = item["path"]
            if relative in checked:
                continue
            path = (root / relative).resolve(strict=True)
            if not path.is_relative_to(root):
                raise ValueError("Source path leaves the assessment directory: " + relative)
            body = path.read_bytes()
            digest = hashlib.sha256(body).hexdigest()
            if digest != item["sha256"] or len(body) != item["bytes"]:
                raise ValueError("Original assessment file differs: " + relative)
            checked[relative] = {"bytes": len(body), "sha256": digest}
    return checked


def count_features(description):
    native = description["native"]
    value = native.get("filtered_count")
    return native["feature_count"] if value is None else value


def huc_field(description):
    fields = description["native"].get("fields", {})
    return next((name for name in fields if name.lower().replace("_", "") == "huc12"), None)


def extent_in_view(descriptions, view_crs):
    from pyproj import Transformer
    bounds = []
    for description in descriptions:
        native = description["native"]
        box = native.get("bounds")
        if box is None or count_features(description) == 0:
            continue
        converter = Transformer.from_crs(native["crs"], view_crs, always_xy=True)
        transformed = converter.transform_bounds(*box, densify_pts=21, errcheck=True)
        if not all(math.isfinite(value) for value in transformed):
            raise ValueError("Original source extent cannot be projected")
        bounds.append(transformed)
    if not bounds:
        return None
    box = [min(b[0] for b in bounds), min(b[1] for b in bounds),
           max(b[2] for b in bounds), max(b[3] for b in bounds)]
    padding = max((box[2] - box[0]) * .035, (box[3] - box[1]) * .035, 1500.0)
    return [box[0] - padding, box[1] - padding, box[2] + padding, box[3] + padding]


def operate(args):
    """Continue one original native review operation under its own execution lock."""
    from model.common import held, now
    out = (Path(args.output).resolve() if args.output else
           Path(args.source_dir).resolve() / "native-assessment-review")
    out.mkdir(parents=True, exist_ok=True)
    with held(out / ".operation.lock", blocking=False):
        args._assessment_operation_admitted = False
        try:
            return _operate(args)
        except BaseException as error:
            record = out / "operation.json"
            if record.is_file() and args._assessment_operation_admitted:
                state = read_json(record)
                state.update(state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                             updated_at=now(),
                             error={"type": type(error).__name__, "message": str(error)})
                if state.get("attempts"):
                    state["attempts"][-1].update(state=state["state"], ended_at=now(),
                                                error=state["error"])
                write_json(record, state)
            raise


def _operate(args):
    from model.common import digest, file_digest, now
    from pyproj import CRS, Transformer
    from model.workspace import Workspace
    from model.spatial import SpatialReview
    from model.spatial_exports import SpatialExports

    source_root = Path(args.source_dir).resolve(strict=True)
    manifest_path = source_root / "geography-model-sources.json"
    manifest = read_json(manifest_path)
    checked = verify_inputs(source_root, manifest)
    ws = Workspace(args.workspace, create=args.create_workspace,
                   title="Upper Savannah / Ecosystem Sciences")
    additional_sources = []
    for role, paths in (("domain", args.domain_manifest), ("context", args.context_manifest)):
        for path in dict.fromkeys(paths):
            original_manifest = Path(path).resolve(strict=True)
            imported = ws.import_sources(original_manifest)
            additional_sources.append({"role": role, "manifest_path": str(original_manifest),
                                       "source_collection_id": imported["id"],
                                       "manifest_sha256": hashlib.sha256(original_manifest.read_bytes()).hexdigest()})
    collection = ws.import_sources(manifest_path)
    spatial = SpatialReview(ws)
    catalog = spatial.catalog()
    layers = {layer["id"]: layer for layer in catalog["layers"]}

    source_layers = {}
    source_features = []
    descriptions = {}
    for entry in manifest["entries"]:
        if not entry.get("metadata", {}).get("assessment_station_layer"):
            continue
        matches = [layer for layer in layers.values()
                   if layer.get("source_collection_id") == collection["id"]
                   and layer.get("source_id") == entry["id"]]
        if len(matches) != 1:
            raise ValueError("Expected one imported native station layer: " + entry["id"])
        layer = matches[0]
        selection = {"layer_id": layer["id"]}
        description = spatial.describe({"selection": selection})
        if CRS.from_user_input(description["native"]["crs"]) != CRS.from_user_input(entry["source_crs"]):
            raise ValueError("Native reader changed the original station datum: " + entry["id"])
        original = read_json(source_root / entry["path"])
        if count_features(description) != len(original["features"]):
            raise ValueError("Native station count differs from the retained source: " + entry["id"])
        required = {"site", "listed_huc12", "listed_causes", "rfp_focus_huc",
                    "nutrient_listed", "eighteenmile_huc10", "huc_source_difference"}
        if not required.issubset(description["native"]["fields"]):
            raise ValueError("Native station layer lost scalar assessment fields")
        source_layers[layer["id"]] = {"selection": selection, "description": description, "entry": entry}
        descriptions[layer["id"]] = description
        for feature in original["features"]:
            source_features.append({"layer_id": layer["id"], "crs": entry["source_crs"], "feature": feature})

    expected = manifest["scope"]["located_station_count"]
    if len(source_features) != expected or len({r["feature"]["properties"]["site"] for r in source_features}) != expected:
        raise ValueError("Each original located station must have one native point")

    domains = []
    explicit_ids = list(dict.fromkeys(args.domain_layer_id))
    if explicit_ids:
        for layer_id in explicit_ids:
            if layer_id not in layers or layers[layer_id]["kind"] != "vector":
                raise ValueError("Requested original watershed layer is absent: " + layer_id)
            description = spatial.describe({"selection": {"layer_id": layer_id}})
            domains.append({"selection": {"layer_id": layer_id}, "description": description})
    else:
        for layer in sorted(layers.values(), key=lambda value: value["id"]):
            if layer["kind"] != "vector" or layer["id"] in source_layers:
                continue
            filename = layer.get("filename", "").lower()
            native_format = str(layer.get("format", "")).lower()
            domain_collection_ids = {source["source_collection_id"] for source in additional_sources
                                     if source["role"] == "domain"}
            if ("esri" not in filename and "esri" not in native_format
                    and layer.get("source_collection_id") not in domain_collection_ids):
                continue
            description = spatial.describe({"selection": {"layer_id": layer["id"]}})
            if description["native"].get("decoded_sha256") == ORIGINAL_DOMAIN_SHA256:
                domains.append({"selection": {"layer_id": layer["id"]}, "description": description})
                break

    if getattr(args, "require_domain", False) and not domains:
        raise ValueError("Select the retained original HUC12 domain with --domain-manifest or --domain-layer-id")
    for domain in domains:
        domain["huc_field"] = huc_field(domain["description"])
        if domain["huc_field"] is None:
            raise ValueError("Select a watershed source with its original HUC12 field")

    contexts = []
    context_collection_ids = {source["source_collection_id"] for source in additional_sources
                              if source["role"] == "context"}
    context_ids = list(args.context_layer_id) + [layer["id"] for layer in layers.values()
                   if layer["kind"] == "vector" and layer.get("source_collection_id") in context_collection_ids]
    for layer_id in dict.fromkeys(context_ids):
        if layer_id not in layers or layers[layer_id]["kind"] != "vector":
            raise ValueError("Requested observation context layer is absent: " + layer_id)
        selection = {"layer_id": layer_id}
        contexts.append({"selection": selection, "description": spatial.describe({"selection": selection})})

    primary = {"layer_id": args.primary_layer_id} if args.primary_layer_id else None
    comparison = {"layer_id": args.comparison_layer_id} if args.comparison_layer_id else None
    if comparison is not None and primary is None:
        raise ValueError("A comparison raster needs its baseline raster selection")
    for selection in (primary, comparison):
        if selection:
            spatial.describe({"selection": selection})
    mode = args.mode or ("compare" if comparison else "single")
    view_crs = "EPSG:5070"

    scopes = [("Upper Savannah: 2026 draft assessment", {}, None)]
    scopes.extend(("RFP focus " + huc + ": listed monitoring sites", {"listed_huc12": huc}, (huc,))
                  for huc in FOCUS_HUCS)
    scopes.extend([
        ("Eighteenmile Creek: assessment and nutrient context", {"eighteenmile_huc10": 1}, EIGHTEENMILE_HUCS),
        ("Upper Savannah: listed nitrogen and phosphorus", {"nutrient_listed": 1}, None),
        ("Original HUC source differences: RS-06190 and SV-192", {"huc_source_difference": 1}, None),
    ])

    reviews = []
    map_packs = []
    empty_scopes = []
    out = Path(args.output).resolve() if args.output else source_root / "native-assessment-review"
    out.mkdir(parents=True, exist_ok=True)
    operation = {"schema": "upstate.operated-assessment-review/v1", "state": "running",
                 "workspace": str(ws.root), "project_id": ws.project["id"],
                 "source_collection_id": collection["id"], "verified_input_files": checked,
                 "additional_source_imports": additional_sources,
                 "located_station_count": len(source_features),
                 "native_station_layers": [info["description"] for info in source_layers.values()],
                 "original_domain_layers": domains, "context_layers": contexts,
                 "saved_reviews": reviews, "map_packs": map_packs,
                 "empty_scopes": empty_scopes, "point_inspections": "point-inspections.json",
                 "station_domain_joins": "station-domain-joins.csv", "domain_join_rows": 0}
    identity = {
        "schema": "upstate.assessment-operation-selection/v1",
        "project_id": ws.project["id"], "source_collection_id": collection["id"],
        "additional_sources": [
            {key: source[key] for key in ("role", "source_collection_id", "manifest_sha256")}
            for source in additional_sources],
        "domains": [domain["selection"] for domain in domains],
        "contexts": [context["selection"] for context in contexts],
        "primary": primary, "comparison": comparison, "mode": mode,
        "paper": args.paper, "dpi": args.dpi, "skip_export": bool(args.skip_export),
    }
    operation_id = digest(identity)
    previous_path = out / "operation.json"
    previous = read_json(previous_path) if previous_path.is_file() else {}
    if previous.get("identity") is not None and previous["identity"] != identity:
        raise ValueError("This assessment output directory retains another original selection")
    if previous and previous.get("identity") is None:
        if (previous.get("project_id") != ws.project["id"]
                or previous.get("source_collection_id") != collection["id"]):
            raise ValueError("The prior assessment output belongs to another original source")
    operation.update(identity=identity, id=operation_id,
                     created_at=previous.get("created_at", now()), updated_at=now(),
                     attempts=previous.get("attempts", []) + [{"started_at": now(), "state": "running"}])
    write_json(out / "operation.json", operation)
    args._assessment_operation_admitted = True
    exporter = None if args.skip_export else SpatialExports(ws)
    for title, where, domain_hucs in scopes:
        overlays = []
        fit_descriptions = []
        selected_points = []
        for layer_id, info in source_layers.items():
            selection = {"layer_id": layer_id, "where": dict(where)}
            description = spatial.describe({"selection": selection})
            if count_features(description):
                fit_descriptions.append(description)
                overlays.append({"selection": selection, "label": info["entry"]["title"],
                                 "style": "solid", "width": 1.5, "opacity": 1.0, "visible": True})
                selected_points.extend(row for row in source_features if row["layer_id"] == layer_id
                                       and all(row["feature"]["properties"].get(k) == v for k, v in where.items()))
        domain_overlays = []
        for domain in domains:
            choices = list(domain_hucs) if domain_hucs else [None]
            for huc in choices:
                selection = dict(domain["selection"])
                if huc is not None:
                    selection["where"] = {domain["huc_field"]: huc}
                description = spatial.describe({"selection": selection})
                if count_features(description):
                    domain_overlays.append({"selection": selection, "label": "Original HUC12 " + (huc or "model domain"),
                                            "style": "solid", "width": .65, "opacity": .55, "visible": True})
                    if domain_hucs or not where:
                        fit_descriptions.append(description)
        overlays = domain_overlays + overlays
        extent = extent_in_view(fit_descriptions, view_crs)
        if extent is None:
            empty_scopes.append({"title": title, "station_filter": where, "domain_huc12": domain_hucs})
            continue
        reference = overlays[-1]["selection"]
        for context in contexts:
            page = spatial.overlay({"selection": context["selection"],
                                    "view": {"crs": view_crs, "bounds": extent}, "limit": 1})
            if page["features"]:
                overlays.append({"selection": context["selection"],
                                 "label": context["description"]["layer"]["title"],
                                 "style": "dash", "width": 1.2, "opacity": 1.0, "visible": True})
        markers = []
        if where:
            for row in selected_points:
                feature = row["feature"]
                x, y = Transformer.from_crs(row["crs"], view_crs, always_xy=True).transform(
                    *feature["geometry"]["coordinates"][:2], errcheck=True)
                p = feature["properties"]
                markers.append({"x": x, "y": y, "label": p["site"] + " | " + p["listed_causes"]})
        payload = {"title": title, "mode": mode, "reference": reference,
                   "view": {"crs": view_crs, "bounds": extent}, "scale": {"mode": "auto"},
                   "primary": primary, "comparison": comparison, "overlays": overlays,
                   "markers": markers,
                   "notes": "Original monitoring locations and pollutant-specific facts from the 2026 draft SCDES assessment. "
                            "Assessment HUC12 fields identify the listed station context. Watershed overlays retain their "
                            "original polygon identities and reporting/upstream fields. Coordinate datum and source URL "
                            "remain on each station. Full listing, TMDL, use-support, source differences and model context "
                            "are companions in source collection " + collection["id"] + "."}
        review = spatial.save(payload)
        reviews.append(review)
        write_json(out / "operation.json", operation)
        if exporter is not None:
            pack = exporter.export({"review_id": review["id"], "paper": args.paper, "dpi": args.dpi})
            map_packs.append(pack)
            write_json(out / "operation.json", operation)

    point_inspections = []
    joins = []
    for row in source_features:
        feature = row["feature"]
        p = feature["properties"]
        checkpoint_identity = {"operation_id": operation_id, "site": p["site"],
                               "station_layer_id": row["layer_id"],
                               "station_feature": feature,
                               "domains": identity["domains"],
                               "primary": primary, "comparison": comparison}
        checkpoint_path = out / "station-checkpoints" / (digest(checkpoint_identity) + ".json")
        if checkpoint_path.is_file():
            completed = read_json(checkpoint_path)
            if completed.get("identity") != checkpoint_identity:
                raise ValueError("The original station checkpoint identity differs")
            point_inspections.append(completed["inspection"])
            joins.extend(completed["joins"])
            operation["inspected_stations"] = len(point_inspections)
            continue
        join_start = len(joins)
        point = {"x": feature["geometry"]["coordinates"][0], "y": feature["geometry"]["coordinates"][1],
                 "crs": row["crs"]}
        station_selection = {"layer_id": row["layer_id"], "where": {"site": p["site"]}}
        result = spatial.point({"point": point, "tolerance": 0,
                                "primary": primary, "comparison": comparison,
                                "overlays": [station_selection] + [domain["selection"] for domain in domains]})
        if not result["features"] or len(result["features"][0]["features"]) != 1:
            raise ValueError("Native exact point inspection did not recover station " + p["site"])
        compact = {key: value for key, value in result.items() if key != "features"}
        compact["features"] = []
        for group in result["features"]:
            saved_group = {key: value for key, value in group.items() if key != "features"}
            saved_group["features"] = [
                {key: value for key, value in found.items()
                 if key not in {"geometry", "source_geometry_json", "properties_json", "properties_text"}}
                for found in group["features"]]
            compact["features"].append(saved_group)
        point_inspections.append({"site": p["site"], "result": compact})
        if len(point_inspections) % 10 == 0:
            write_json(out / "point-inspections.json", point_inspections)
            operation["inspected_stations"] = len(point_inspections)
            write_json(out / "operation.json", operation)
        for group in result["features"][1:]:
            if group.get("truncated"):
                raise ValueError("Retain the complete original domain matches for " + p["site"])
            domain_field = next((d["huc_field"] for d in domains
                                 if d["selection"]["layer_id"] == group["layer"]["id"]), None)
            if not group["features"]:
                joins.append({"site": p["site"], "listed_huc12": p["listed_huc12"],
                              "domain_layer_id": group["layer"]["id"], "domain_sha256": group["layer"]["sha256"],
                              "original_huc12": "", "match": "outside_original_domain",
                              "source_huc_equal": "", "original_properties_json": ""})
            for found in group["features"]:
                native = found.get("properties", {})
                original_huc = str(native.get(domain_field, ""))
                joins.append({"site": p["site"], "listed_huc12": p["listed_huc12"],
                              "domain_layer_id": group["layer"]["id"], "domain_sha256": group["layer"]["sha256"],
                              "original_huc12": original_huc, "match": found.get("match", "covers"),
                              "source_huc_equal": int(original_huc == p["listed_huc12"]),
                              "original_properties_json": json.dumps(native, ensure_ascii=True, sort_keys=True)})

        write_json(checkpoint_path, {"identity": checkpoint_identity,
                                    "completed_at": now(),
                                    "inspection": point_inspections[-1],
                                    "joins": joins[join_start:]})
        operation["inspected_stations"] = len(point_inspections)
        write_json(out / "operation.json", operation)

    write_json(out / "point-inspections.json", point_inspections)
    with (out / "station-domain-joins.csv").open("w", encoding="utf-8", newline="") as stream:
        columns = ["site", "listed_huc12", "domain_layer_id", "domain_sha256", "original_huc12",
                   "match", "source_huc_equal", "original_properties_json"]
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(joins)
    operation["attempts"][-1].update(state="complete", completed_at=now())
    operation.update({"state": "complete", "inspected_stations": len(point_inspections),
                      "domain_join_rows": len(joins), "updated_at": now(),
                      "output_files": {
                          name: {"bytes": (out / name).stat().st_size,
                                 "sha256": file_digest(out / name)}
                          for name in ("point-inspections.json", "station-domain-joins.csv")}})
    write_json(out / "operation.json", operation)
    print(json.dumps({"workspace": str(ws.root), "source_collection_id": collection["id"],
                      "stations": len(source_features), "saved_review_ids": [v["id"] for v in reviews],
                      "map_pack_count": len(map_packs), "domain_layers": len(domains),
                      "domain_join_rows": len(joins), "output": str(out)}, sort_keys=True), file=sys.stderr)
    return operation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", required=True, help="Current complete Upstate application root")
    parser.add_argument("--workspace", required=True, help="Current project scientific Workspace")
    parser.add_argument("--source-dir", default=str(Path(__file__).resolve().parents[1] / "assessment"))
    parser.add_argument("--create-workspace", action="store_true",
                        help="Initialize the chosen project Workspace when its manifest is absent")
    parser.add_argument("--domain-manifest", action="append", default=[],
                        help="Retained original domain sources.json to import before native domain discovery")
    parser.add_argument("--context-manifest", action="append", default=[],
                        help="Retained study/outfall sources.json to import and add its vector layers to relevant views")
    parser.add_argument("--domain-layer-id", action="append", default=[],
                        help="Existing original HUC12 layer ID; default discovers the exact retained 217-feature Esri body")
    parser.add_argument("--context-layer-id", action="append", default=[],
                        help="Existing original study/outfall vector layer; included where its geometry intersects each view")
    parser.add_argument("--primary-layer-id", help="Existing baseline raster layer ID for the same saved views")
    parser.add_argument("--comparison-layer-id", help="Existing alternative raster layer ID")
    parser.add_argument("--mode", choices=("single", "compare", "swipe", "difference"))
    parser.add_argument("--paper", choices=("letter", "a4"), default="letter")
    parser.add_argument("--dpi", choices=(150, 220, 300), type=int, default=220)
    parser.add_argument("--skip-export", action="store_true", help="Save native views without generating printable map packs")
    parser.add_argument("--output", help="Directory for the actual operation and complete point/domain joins")
    args = parser.parse_args()
    app_root = Path(args.app_root).resolve(strict=True)
    sys.path.insert(0, str(app_root))
    operate(args)


if __name__ == "__main__":
    main()
