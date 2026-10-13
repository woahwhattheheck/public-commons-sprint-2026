"""Join original jurisdiction-specific assessed-reach geometry to the existing study-domain polygons.

Uses the maintained native vector reader. Source files and companions remain
unchanged. Reported reach IDs are joined exactly; no station or HUC identifier
is constructed from a publisher assessment-unit identifier.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def fingerprint(path):
    digest = hashlib.sha256()
    size = 0
    with Path(path).open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return {"bytes": size, "sha256": digest.hexdigest()}


def verified_source(entry, base):
    path = (base / entry["path"]).resolve()
    observed = fingerprint(path)
    if observed["sha256"] != entry["sha256"]:
        raise ValueError(f"Source bytes changed: {entry['path']}")
    if "bytes" in entry and observed["bytes"] != entry["bytes"]:
        raise ValueError(f"Source byte length changed: {entry['path']}")
    companions = []
    for item in entry.get("companions", []):
        member = (base / item["path"]).resolve()
        actual = fingerprint(member)
        if actual["sha256"] != item["sha256"] or (
            "bytes" in item and actual["bytes"] != item["bytes"]
        ):
            raise ValueError(f"Original companion changed: {item['path']}")
        companions.append({**item, **actual})
    return path, {**entry, **observed, "companions": companions}


def original_id_text(value):
    """Canonical join text for exact original text or safe integral numeric IDs."""
    if isinstance(value, str):
        if value.strip():
            return value.strip()
        raise ValueError("empty_original_reach_id")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("missing_original_reach_id")
    if not math.isfinite(value) or int(value) != value or abs(value) > 9007199254740991:
        raise ValueError("nonintegral_or_unsafe_original_reach_id")
    return str(int(value))


def label_values(value):
    """Flatten source arrays for display without changing their retained originals."""
    if isinstance(value, (list, tuple)):
        return [label for item in value for label in label_values(item)]
    return [] if value is None or str(value) == "" else [str(value)]


def row_labels(rows, field):
    return "; ".join(dict.fromkeys(label for row in rows
                                  for label in label_values(row.get(field))))


def join_geography(bank, configuration, configuration_directory, output):
    from model.rasters import vector_geometry
    from pyproj import CRS, Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform
    from shapely.strtree import STRtree

    if bank.get("schema") != configuration.get("assessment_schema", "upstate.georgia-assessments/v1"):
        raise ValueError("Select the exact normalized assessment schema declared for this source")
    jurisdiction = configuration.get("jurisdiction", bank.get("method", {}).get("jurisdiction"))
    if jurisdiction not in {"GA", "NC", "SC"}:
        raise ValueError("Declare the original assessment jurisdiction")
    edition = bank["source"]
    records = bank[configuration.get("record_collection", "records")]
    if not isinstance(records, list):
        raise ValueError("Configured assessment record collection must be an array")
    for field in ["assessment_cycle", "publication_status"]:
        if field not in edition:
            raise ValueError("Assessment edition lacks " + field)
    cycle, status = edition["assessment_cycle"], edition["publication_status"]
    approval_date = edition.get("approval_date")
    fields = {"id":"native_reach_id", "name":"reach_name",
              "assessment":"overall_assessment_raw", "categories":"categories",
              "cause":"cause_raw", "listed":"on_303d_list"}
    fields.update(configuration.get("record_fields", {}))
    title = configuration.get("title", f"{jurisdiction}{cycle} assessed reaches")
    source_prefix = configuration.get("source_id_prefix", f"{jurisdiction.lower()}{cycle}")
    unit_id_field = fields["id"]
    base = Path(configuration_directory)
    target_crs = configuration.get("comparison_crs", "EPSG:26917")
    if target_crs != "EPSG:26917":
        raise ValueError("This regional join uses EPSG:26917 so reported measures are metres")
    domain_spec = configuration["domain"]
    domain_path, domain_source = verified_source(domain_spec, base)
    domain_rows, domain_crs = vector_geometry(
        domain_path, layer=domain_spec.get("layer"), target_crs=target_crs
    )
    huc_field = domain_spec["huc_field"]
    hucs, polygons = [], []
    for row in domain_rows:
        value = row["properties"].get(huc_field)
        if not isinstance(value, str) or len(value) != 12 or not value.isdigit():
            raise ValueError("Domain HUC must preserve its original twelve-character text field")
        geometry = row["geometry"]
        if geometry.geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError("Study domain must contain polygon features")
        if value in hucs:
            raise ValueError("Duplicate original domain HUC")
        hucs.append(value)
        polygons.append(geometry)
    expected_hucs = configuration.get("expected_domain_hucs")
    if expected_hucs is not None and set(expected_hucs) != set(hucs):
        raise ValueError("Selected domain differs from retained original HUC set")
    tree = STRtree(polygons)
    old_tree_index = {id(geometry): index for index, geometry in enumerate(polygons)}
    records_by_reach = {}
    for row in records:
        records_by_reach.setdefault(original_id_text(row[unit_id_field]), []).append(row)
    relations, features, source_inventory, unmatched_geometry = [], [], [], []
    to_wgs84 = Transformer.from_crs(target_crs, "EPSG:4326", always_xy=True).transform
    encountered = set()
    for entry in configuration["reach_sources"]:
        path, retained_source = verified_source(entry, base)
        source_inventory.append(retained_source)
        rows, source_crs = vector_geometry(path, layer=entry.get("layer"))
        if not CRS.from_user_input(source_crs).equals(CRS.from_user_input(entry["source_crs"])):
            raise ValueError("Original source CRS differs from selected source declaration")
        project = Transformer.from_crs(source_crs, target_crs, always_xy=True).transform
        id_field, feature_field = entry["reach_id_field"], entry.get("feature_id_field")
        seen_feature_ids = set()
        for native in rows:
            props = native["properties"]
            geometry = transform(project, native["geometry"])
            value = props.get(id_field)
            try:
                reach_id = original_id_text(value)
            except ValueError as error:
                unmatched_geometry.append({"source_id":entry["id"], "native_driver_fid":native["id"],
                                           "reason":str(error), "properties":props})
                continue
            feature_id = props.get(feature_field) if feature_field else native["id"]
            if feature_id is None or str(feature_id) == "":
                raise ValueError("Selected original feature ID field is null")
            typed_id = json.dumps(feature_id, sort_keys=True)
            if typed_id in seen_feature_ids:
                raise ValueError("Duplicate original feature ID within one geometry source")
            seen_feature_ids.add(typed_id)
            if reach_id not in records_by_reach:
                unmatched_geometry.append({"source_id":entry["id"],"native_feature_id":feature_id,
                    "assessment_unit_id":reach_id, unit_id_field:reach_id,"reason":"no_selected_assessment_row"})
                continue
            encountered.add(reach_id)
            kind = geometry.geom_type
            if kind in {"LineString", "MultiLineString"}:
                dimension, unit = "length", "m"
            elif kind in {"Polygon", "MultiPolygon"}:
                dimension, unit = "area", "m2"
            elif kind in {"Point", "MultiPoint"}:
                dimension, unit = "point", "count"
            else:
                raise ValueError(f"Unsupported original reach geometry: {kind}")
            selected_hucs, touches = [], []
            for candidate in tree.query(geometry):
                index = old_tree_index[id(candidate)] if hasattr(candidate, "geom_type") else int(candidate)
                polygon, huc = polygons[index], hucs[index]
                if not geometry.intersects(polygon):
                    continue
                intersection = geometry.intersection(polygon)
                if dimension == "length":
                    measure = intersection.length
                elif dimension == "area":
                    measure = intersection.area
                else:
                    measure = sum(1 for p in getattr(geometry, "geoms", [geometry]) if polygon.covers(p))
                positive = measure > 0
                if positive:
                    selected_hucs.append(huc)
                else:
                    touches.append(huc)
                relations.append({
                    "assessment_unit_id":reach_id, unit_id_field:reach_id, "native_assessment_unit_value":value, "native_feature_id":feature_id,
                    "native_feature_id_field":feature_field or "native_driver_fid",
                    "huc12":huc, "geometry_source_id":entry["id"],
                    "geometry_sha256":retained_source["sha256"],
                    "geometry_source_uri":entry["uri"],
                    "domain_source_id":domain_spec["id"], "domain_sha256":domain_source["sha256"],
                    "source_crs":CRS.from_user_input(source_crs).to_string(), "comparison_crs":target_crs,
                    "relation":"point_covered" if positive and dimension=="point" else
                               "positive_"+dimension if positive else "boundary_touch",
                    "intersection_measure":measure, "measure_unit":unit
                })
            if selected_hucs or touches:
                source_rows = records_by_reach[reach_id]
                categories = sorted({c["code"] for r in source_rows for c in r.get(fields["categories"], [])})
                features.append({
                    "type":"Feature",
                    "id":entry["id"]+":"+str(feature_id),
                    "geometry":mapping(transform(to_wgs84, geometry)),
                    "properties":{
                        "jurisdiction":jurisdiction, "assessment_cycle":cycle,
                        "publication_status":status, "approval_date":approval_date,
                        "assessment_unit_id":reach_id, unit_id_field:reach_id, "native_assessment_unit_value":value, "native_feature_id":str(feature_id),
                        "reach_name":row_labels(source_rows, fields["name"]),
                        "overall_assessment":row_labels(source_rows, fields["assessment"]),
                        "categories":", ".join(categories),
                        "cause": row_labels(source_rows, fields["cause"]),
                        "on_303d_list":True if any(r.get(fields["listed"]) is True for r in source_rows) else
                            None if any(r.get(fields["listed"]) is None for r in source_rows) else False,
                        "assessment_record_ids":json.dumps([r["id"] for r in source_rows if "id" in r]),
                        "parameter_record_ids":json.dumps([pid for r in source_rows for pid in r.get("parameter_record_ids", [])]),
                        "selected_assessment_unit_ids":json.dumps([r[unit_id_field] for r in source_rows]),
                        "selected_assessment_row_count":len(source_rows),
                        "selected_assessment_collection":configuration.get("record_collection", "records"),
                        "parameter_record_count":len({pid for r in source_rows for pid in r.get("parameter_record_ids", [])}),
                        "huc12s":", ".join(sorted(selected_hucs)),
                        "boundary_touch_huc12s":", ".join(sorted(touches)),
                        "intersects_selected_domain":bool(selected_hucs),
                        "source_id":entry["id"], "source_sha256":retained_source["sha256"],
                        "domain_source_sha256":domain_source["sha256"]
                    }
                })
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    result = {
        "schema":"upstate.assessment-reach-geography/v1", "jurisdiction":jurisdiction,
        "assessment_cycle":cycle, "publication_status":status, "approval_date":approval_date,
        "assessment_source":bank["source"], "domain_source":domain_source,
        "reach_sources":source_inventory, "comparison_crs":target_crs,
        "domain_hucs":sorted(hucs), "relations":relations,
        "assessment_unit_ids_without_geometry":sorted(set(records_by_reach)-encountered),
        "unmatched_original_geometry":unmatched_geometry,
        "feature_count":len(features),
        "positive_relation_count":sum(r["relation"]!="boundary_touch" for r in relations),
        "boundary_touch_count":sum(r["relation"]=="boundary_touch" for r in relations),
        "method":"Exact edition-specific native ReachID join; positive-dimensional intersection against retained original HUC polygons",
    }
    payloads = {
        "geometry-relations.json":relations,
        "domain-hucs.json":sorted(hucs),
        "geography-context.json":result,
        "assessed-reaches.geojson":{"type":"FeatureCollection",
            "name":title+" intersecting original study domain",
            "features":features}
    }
    for name, value in payloads.items():
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    # Portable map entry includes exact original native bodies and sidecars.
    companions = []
    for ordinal, entry in enumerate([domain_spec, *configuration["reach_sources"]]):
        retained_directory = output / "originals" / str(ordinal)
        retained_directory.mkdir(parents=True, exist_ok=True)
        original_members = [{"path":entry["path"], "sha256":entry["sha256"],
                             **({"bytes":entry["bytes"]} if "bytes" in entry else {})},
                            *entry.get("companions", [])]
        for item in original_members:
            original_path = (base / item["path"]).resolve()
            target_path = retained_directory / original_path.name
            if target_path.exists() and fingerprint(target_path)["sha256"] != item["sha256"]:
                raise ValueError("Different original members share one source basename")
            if original_path != target_path.resolve():
                shutil.copyfile(original_path, target_path)
            companions.append({"path":target_path.relative_to(output).as_posix(),
                               **fingerprint(target_path)})
    assessment_path = output / "assessment-rows.json"
    assessment_path.write_text(json.dumps(bank,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    config_path = output / "geometry-configuration.json"
    config_path.write_text(json.dumps(configuration,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for name in ["assessment-rows.json","geometry-configuration.json",
                 "geometry-relations.json","geography-context.json","domain-hucs.json"]:
        companions.append({"path":name,**fingerprint(output/name)})
    manifest = {
        "schema":"upstate.sources/v1",
        "title":title+" — original study-domain geography",
        "captured_at":bank["source"].get("captured_at"),
        "scope":"Original "+jurisdiction+" assessed-reach geometry intersecting selected study-domain polygons",
        "notes":"Reach-level assessment; positive dimensional membership and boundary-only contacts are separate.",
        "entries":[{
            "id":source_prefix+"-assessed-reach-geography",
            "title":title+" intersecting study domain",
            "uri":configuration.get("source_uri") or bank["source"]["uri"],
            "vintage":str(cycle)+"; "+status+(("; "+approval_date) if approval_date else ""),
            "kind":"vector", "role":"REGIONAL_ASSESSMENT_REACH_GEOGRAPHY",
            "path":"assessed-reaches.geojson", **fingerprint(output/"assessed-reaches.geojson"),
            "jurisdiction":jurisdiction, "assessment_cycle":cycle,
            "publication_status":status, "approval_date":approval_date,
            "reach_id_field":"assessment_unit_id", "crs":"EPSG:4326",
            "companions":companions
        }]
    }
    (output/"geography-sources.json").write_text(
        json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    result["files"]={name:{"path":name,**fingerprint(output/name)}
                     for name in [*payloads,"geography-sources.json",
                                  "assessment-rows.json","geometry-configuration.json"]}

    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assessments", required=True)
    parser.add_argument("--configuration", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    result = join_geography(read_json(args.assessments), read_json(args.configuration),
                            Path(args.configuration).resolve().parent, args.output)
    print(json.dumps({"output":str(Path(args.output).resolve()),
        "feature_count":result["feature_count"],
        "positive_relation_count":result["positive_relation_count"],
        "boundary_touch_count":result["boundary_touch_count"],
        "files":result["files"]}))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
