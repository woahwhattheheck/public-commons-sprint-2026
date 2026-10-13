"""Capture FEMA flood context and USACE dams on the retained upstream domain.

Uses the original ArcGIS collector, domain transfer, and operator task client.
Run from the full application, where the existing source helpers are installed.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path
import sys
import time

_APPLICATION = Path(__file__).resolve().parents[1]
if str(_APPLICATION) not in sys.path:
    sys.path.insert(0, str(_APPLICATION))

from model.common import (
    atomic_bytes, atomic_json, canonical, describe_file, digest, file_digest, held,
    read_json, verify_file,
)
from source_tools.operator_source_intake import IntakeError
from source_tools.domain_overlays import (
    _crs, _entry as domain_entry, _retain, _verify_plan,
)
from capture_original_overlays import capture_layer

SCHEMA = "upstate.hazard-context/v1"
COVERAGE = (
    "Complete native features intersecting the retained upstream acquisition "
    "tiles, including the original domain buffer. Analytical overlap uses the "
    "selected domain geometry; original tile-edge features remain whole."
)
FEMA = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
NID = ("https://geospatial.sec.usace.army.mil/dls/rest/services/NID/"
       "National_Inventory_of_Dams_Public_Service/FeatureServer/0")
NID_DICTIONARY = (
    "https://usace-cwbi-prod-il2-nld2-docs.s3.us-gov-west-1.amazonaws.com/"
    "0f6b4388-dafb-4ae4-84b4-416ad30b08e5/"
    "NID%20Data%20Dictionary%20August%202023.pdf"
)
ASSESSED_NON_SFHA_ZONES = ("B", "C", "X")
FEMA_CLASS_REFERENCES = (
    "https://www.fema.gov/sites/default/files/documents/fema_rm-domain-tables-technical-reference-nov-2023.pdf",
    "https://www.fema.gov/sites/default/files/documents/fema_firm-database-guidance.pdf",
    "https://emilms.fema.gov/is_0273/groups/77.html",
)
SPECS = {
    "fema-flood-zones": {
        "title": "FEMA National Flood Hazard Layer flood hazard areas",
        "role": "FLOOD_HAZARD", "url": FEMA + "/28", "page_size": 100,
    },
    "fema-availability": {
        "title": "FEMA National Flood Hazard Layer availability footprints",
        "role": "FLOOD_HAZARD_COVERAGE", "url": FEMA + "/0", "page_size": 100,
    },
    "fema-firm-panels": {
        "title": "FEMA effective FIRM panels",
        "role": "FIRM_PANELS", "url": FEMA + "/3", "page_size": 100,
    },
    "nid-dams": {
        "title": "USACE National Inventory of Dams public structures",
        "role": "DAMS", "url": NID, "page_size": 100,
    },
}
SPECS = {key: {**value, "scope": "upstream", "coverage": COVERAGE}
         for key, value in SPECS.items()}


def _selected(values):
    result = list(SPECS) if not values else list(values)
    if len(set(result)) != len(result) or set(result) - set(SPECS):
        raise ValueError("Select unique documented FEMA or NID source keys")
    return result


def _plan(root, domain_capture=None):
    """Reuse the exact transferred acquisition masks without a second GIS plan."""
    retained = root / "domain"
    if domain_capture:
        source = Path(domain_capture).resolve(strict=True)
        native_plan, _ = _verify_plan(source)
        transfer = read_json(source / "plan-transfer.json")
        for item in transfer["files"]:
            _retain(verify_file(source, item), retained / item["path"])
        _retain(source / "plan-transfer.json", retained / "plan-transfer.json")
    else:
        native_plan, _ = _verify_plan(retained)
    checked, masks = _verify_plan(retained)
    if digest(native_plan) != digest(checked):
        raise ValueError("The retained upstream plan differs from its selected edition")
    value = {
        "schema": SCHEMA, "domain_plan_sha256": digest(checked),
        "domain_sha256": checked["domain"]["sha256"],
        "domain_feature_count": checked["selected_features"],
        "source_contracts": SPECS, "coverage": COVERAGE,
    }
    atomic_json(root / "hazard-plan.json", value, immutable=True)
    return value, masks


def _records(root):
    records = {}
    for key, spec in SPECS.items():
        path = root / "layers" / key / "layer-capture.json"
        if not path.is_file():
            continue
        value = read_json(path)
        if any(value.get(field) != spec[field] for field in ("role", "scope", "coverage")):
            raise ValueError("Retained layer belongs to a different hazard source contract: " + key)
        if value.get("uri") != spec["url"]:
            raise ValueError("Retained hazard source URL changed: " + key)
        for item in value["files"]:
            verify_file(root / "layers", item)
        records[key] = value
    return records


def _entry(root, key, value, plan):
    result = domain_entry(root, key, value, digest(plan))
    result["id"] = key + "-upstream-" + value["sha256"][:24]
    result["metadata"].update(
        hazard_source_key=key, hazard_view="native",
        native_object_id_field=value["id_field"],
    )
    if key == "fema-flood-zones":
        result["metadata"].update(
            feature_identity_fields=["GlobalID", "DFIRM_ID", "FLD_AR_ID"],
            sfha_filter={"SFHA_TF": "T"},
            non_sfha_filter={"SFHA_TF": "F"},
            availability_source_key="fema-availability",
            field_meanings={
                "SFHA_TF": "Native T/F Special Flood Hazard Area indicator",
                "GFID": "Grouping identifier; can repeat across distinct polygons",
                "STATIC_BFE": "Preserve native units, datum and negative sentinels",
            },
        )
    elif key == "nid-dams":
        result["metadata"].update(
            structure_id_field="FEDERAL_ID", reservoir_id_field="NIDID",
            primary_structure_filter={"IS_ASSOCIATED_STRUCTURE": "No"},
            dictionary_uri=NID_DICTIONARY,
            units={"NID_STORAGE": "acre-feet", "MAX_STORAGE": "acre-feet",
                   "NORMAL_STORAGE": "acre-feet", "DRAINAGE_AREA": "square miles"},
        )
    return result


def _view_entry(root, record):
    pointer = root / "dam-view.json"
    if not pointer.is_file():
        return None
    value = read_json(pointer)
    if value["native_sha256"] != record["sha256"]:
        raise ValueError("Dam analysis view belongs to a different native edition")
    entry = value["entry"]
    verify_file(root, entry)
    for member in entry.get("companions", []):
        verify_file(root, member)
    return entry


def _flood_entries(root, record):
    pointer = root / "flood-views.json"
    if not pointer.is_file():
        return []
    value = read_json(pointer)
    if (value.get("schema") != "upstate.fema-flood-views/v1"
            or value.get("native_sha256") != record["sha256"]):
        raise ValueError("Flood views belong to a different native edition")
    entries = value["entries"]
    if (len(entries) != 3 or
            {entry.get("metadata", {}).get("hazard_view") for entry in entries}
            != {"sfha", "classified_tf", "criterion_coverage"}):
        raise ValueError("The retained flood views must include SFHA, designation and criterion coverage")
    for entry in entries:
        verify_file(root, entry)
        for member in entry.get("companions", []):
            verify_file(root, member)
    return entries


def _publish(root, plan, records, failures):
    entries = [_entry(root, key, records[key], plan) for key in SPECS if key in records]
    if "nid-dams" in records:
        view = _view_entry(root, records["nid-dams"])
        if view:
            entries.append(view)
    if "fema-flood-zones" in records:
        entries.extend(_flood_entries(root, records["fema-flood-zones"]))
    transfer = read_json(root / "domain" / "plan-transfer.json")
    context = [root / "hazard-plan.json", root / "domain" / "plan-transfer.json"]
    context.extend(root / "domain" / item["path"] for item in transfer["files"])
    entries.append({
        "id": "hazard-domain-" + digest(plan)[:24],
        "title": "Hazard acquisition domain and source contracts",
        "uri": "urn:sha256:" + digest(plan), "kind": "document",
        "role": "SOURCE_CONTEXT", "vintage": "Retained upstream domain edition",
        **describe_file(root, context[0]),
        "companions": [describe_file(root, path) for path in context[1:]],
    })
    masks = root / "domain" / "masks.json"
    entries.append({
        "id": "hazard-upstream-masks-" + file_digest(masks)[:24],
        "title": "Original upstream hazard acquisition masks",
        "uri": "urn:sha256:" + file_digest(masks), "kind": "document",
        "role": "SOURCE_COVERAGE", "vintage": "Retained upstream domain edition",
        **describe_file(root, masks),
        "metadata": {"hazard_source_key": "upstream-masks", "hazard_view": "source_mask",
                     "scope": "upstream_model_domain", "group": "upstream",
                     "capture_plan_sha256": digest(plan)},
        "companions": [describe_file(root, path) for path in context if path != masks],
    })
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Upper Savannah floodplain and dam context",
        "entries": entries,
        "scope": {"upstream_domain_sha256": plan["domain_sha256"],
                  "selected_features": plan["domain_feature_count"], "coverage": COVERAGE},
        "notes": [
            "FEMA SFHA uses the native typed SFHA_TF=T predicate; all classes are retained.",
            "Availability footprints and effective panels accompany the flood polygons.",
            "NID FEDERAL_ID identifies a structure; NIDID groups structures at one reservoir.",
            "Reservoir storage uses a unique primary structure; associated dike rows repeat storage.",
            "Hazard potential describes downstream consequences of failure.",
        ],
    }
    path = root / ("source-manifest-" + digest(manifest)[:24] + ".json")
    atomic_json(path, manifest, immutable=True)
    atomic_json(root / "sources.json", manifest)
    pending = [key for key in SPECS if key not in records]
    progress = {
        "schema": SCHEMA, "state": "complete" if not pending else "partial",
        "manifest": describe_file(root, path),
        "completed_sources": list(records), "remaining_sources": pending,
        "dam_analysis_ready": any(entry.get("metadata", {}).get("hazard_view") == "analysis_xy"
                                  for entry in entries),
        "flood_analysis_ready": any(entry.get("metadata", {}).get("hazard_view") == "sfha"
                                    for entry in entries),
        "failures": failures,
    }
    atomic_json(root / "capture-progress.json", progress)
    return progress


def capture(output, *, domain_capture=None, sources=None, retry_failed=False,
            metadata_root=None):
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "hazard-capture.lock", blocking=False):
        plan, masks = _plan(root, domain_capture)
        records = _records(root)
        failures = {}
        previous = root / "capture-progress.json"
        if previous.is_file():
            failures.update(read_json(previous).get("failures", {}))
        for key in _selected(sources):
            try:
                if key not in records:
                    value = capture_layer(
                        root / "layers", key, SPECS[key], {"upstream": masks},
                        retry_failed=retry_failed,
                        metadata_root=Path(metadata_root) if metadata_root else None,
                    )
                    records[key] = value
                failures.pop(key, None)
            except Exception as error:
                failures[key] = {"type": type(error).__name__, "message": str(error)}
            _publish(root, plan, records, failures)
        return _publish(root, plan, records, failures)


def prepare_dams(output):
    """Expose native NID points to existing vector readers; keep every original."""
    from pyproj import CRS, Transformer

    root = Path(output).resolve(strict=True)
    with held(root / "hazard-capture.lock", blocking=False):
        plan, _ = _plan(root)
        records = _records(root)
        record = records.get("nid-dams")
        if record is None:
            raise ValueError("Capture the original NID layer before preparing its points")
        native_entry = _entry(root, "nid-dams", record, plan)
        path = verify_file(root, native_entry)
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            native = json.load(stream)
        if native.get("geometryType") != "esriGeometryPoint":
            raise ValueError("The retained NID source must contain native points")
        source_crs = _crs(native.get("spatialReference") or record["source_crs"])
        target_crs = CRS.from_epsg(4326)
        project = Transformer.from_crs(source_crs, target_crs, always_xy=True)
        field = record["id_field"]
        features, missing, seen, reservoirs = [], [], set(), {}
        for row in native["features"]:
            attributes = row["attributes"]
            oid = attributes[field]
            if oid in seen:
                raise ValueError("NID repeats a snapshot object ID")
            seen.add(oid)
            nid_id = attributes.get("NIDID")
            if isinstance(nid_id, str) and nid_id:
                reservoirs.setdefault(nid_id, []).append(attributes)
            geometry = row.get("geometry")
            if geometry is None:
                missing.append(oid)
                continue
            if geometry.get("spatialReference") and _crs(geometry["spatialReference"]) != source_crs:
                raise ValueError("NID point CRS differs from its retained collection")
            xy = [geometry.get("x"), geometry.get("y")]
            if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                   for v in xy):
                raise ValueError("NID point has invalid native XY coordinates")
            lon, lat = project.transform(*xy, errcheck=True)
            if not all(math.isfinite(v) for v in (lon, lat)) or not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("Projected NID point is outside geographic coordinate bounds")
            features.append({
                "type": "Feature", "id": str(oid), "properties": attributes,
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            })
        if len(seen) != record["feature_count"]:
            raise ValueError("NID analysis view differs from the captured feature count")
        folder = root / "views" / ("nid-" + record["sha256"][:24])
        points = folder / "points.geojson"
        atomic_json(points, {"type": "FeatureCollection", "features": features}, immutable=True)
        groups = []
        for nid_id, members in sorted(reservoirs.items()):
            primary = [row for row in members if row.get("IS_ASSOCIATED_STRUCTURE") == "No"]
            groups.append({
                "nid_id": nid_id,
                "structure_object_ids": sorted(row[field] for row in members),
                "structure_federal_ids": sorted({str(row["FEDERAL_ID"]) for row in members
                                                 if row.get("FEDERAL_ID")}),
                "primary_object_id": primary[0][field] if len(primary) == 1 else None,
                "primary_state": "unique" if len(primary) == 1 else "missing" if not primary else "ambiguous",
                "primary_attributes": {
                    name: primary[0].get(name) for name in
                    ("FEDERAL_ID", "NID_STORAGE", "MAX_STORAGE", "NORMAL_STORAGE",
                     "DRAINAGE_AREA", "HAZARD_POTENTIAL", "OPERATIONAL_STATUS")
                } if len(primary) == 1 else None,
            })
        index = folder / "reservoir-index.json"
        atomic_json(index, {
            "schema": "upstate.nid-reservoir-index/v1",
            "native_sha256": record["sha256"], "dictionary_uri": NID_DICTIONARY,
            "structure_id_field": "FEDERAL_ID", "reservoir_id_field": "NIDID",
            "primary_filter": {"IS_ASSOCIATED_STRUCTURE": "No"},
            "reservoirs": groups,
        }, immutable=True)
        derivation = folder / "derivation.json"
        atomic_json(derivation, {
            "schema": "upstate.nid-point-view/v1", "native_sha256": record["sha256"],
            "source_crs": source_crs.to_wkt(), "output_crs": target_crs.to_wkt(),
            "coordinate_operation": project.description,
            "analysis_axes": "XY", "native_axes_retained": record.get("geometry_flags"),
            "native_feature_count": len(seen), "point_feature_count": len(features),
            "source_geometry_absent_object_ids": missing,
            "attribute_treatment": "All native attributes retained without numeric or date coercion",
        }, immutable=True)
        entry = {
            **native_entry, "id": "nid-dam-points-" + file_digest(points)[:24],
            "title": "USACE NID dam points for spatial analysis",
            **describe_file(root, points),
            "metadata": {**native_entry["metadata"], "hazard_view": "analysis_xy",
                         "native_source_id": native_entry["id"],
                         "native_sha256": record["sha256"], "output_crs": "EPSG:4326",
                         "geometry_absent_count": len(missing)},
            "companions": [
                {key: native_entry[key] for key in ("path", "bytes", "sha256")},
                *native_entry["companions"],
                describe_file(root, index), describe_file(root, derivation),
            ],
        }
        atomic_json(root / "dam-view.json", {
            "native_sha256": record["sha256"], "entry": entry,
        }, immutable=True)
        previous = read_json(root / "capture-progress.json")
        return _publish(root, plan, records, previous.get("failures", {}))


def prepare_flood(output):
    """Retain SFHA positives, designation coverage and assessed criterion coverage."""
    from source.capture_upstream_network import esri_polygon

    root = Path(output).resolve(strict=True)
    with held(root / "hazard-capture.lock", blocking=False):
        plan, _ = _plan(root)
        records = _records(root)
        record = records.get("fema-flood-zones")
        if record is None:
            raise ValueError("Capture the original FEMA all-zone layer before preparing its views")
        native_entry = _entry(root, "fema-flood-zones", record, plan)
        with gzip.open(verify_file(root, native_entry), "rt", encoding="utf-8") as stream:
            native = json.load(stream)
        if native.get("geometryType") != "esriGeometryPolygon":
            raise ValueError("The retained FEMA flood source must contain native polygons")
        source_crs = _crs(native.get("spatialReference") or record["source_crs"])
        field = record["id_field"]
        selected = {"sfha": [], "classified_tf": [], "criterion_coverage": []}
        seen, unclassified, missing, empty, nonarea, corrections = set(), [], [], [], [], []
        assessment_exclusions = []
        for row in native["features"]:
            attributes = row["attributes"]
            oid = attributes[field]
            if type(oid) is not int or oid in seen:
                raise ValueError("FEMA requires unique native snapshot object IDs")
            seen.add(oid)
            if attributes.get("SFHA_TF") not in ("T", "F"):
                unclassified.append(oid)
                continue
            geometry = row.get("geometry")
            if geometry is None:
                missing.append(oid)
                continue
            if geometry.get("spatialReference") and _crs(geometry["spatialReference"]) != source_crs:
                raise ValueError("FEMA polygon CRS differs from its retained collection")
            changes = []
            planar = {**geometry, "rings": [
                [coordinate[:2] for coordinate in ring] for ring in geometry.get("rings", [])
            ]}
            parsed = esri_polygon(planar, changes, str(oid))
            if parsed.is_empty:
                empty.append(oid)
                continue
            if parsed.area <= 0:
                nonarea.append(oid)
                continue
            if changes:
                corrections.append({"object_id": oid, "reader_corrections": changes})
            selected["classified_tf"].append(row)
            if attributes["SFHA_TF"] == "T":
                selected["sfha"].append(row)
                selected["criterion_coverage"].append(row)
            else:
                zone = attributes.get("FLD_ZONE")
                compared_zone = zone.strip().upper() if isinstance(zone, str) else None
                if compared_zone in ASSESSED_NON_SFHA_ZONES:
                    selected["criterion_coverage"].append(row)
                else:
                    assessment_exclusions.append({
                        "object_id": oid, "SFHA_TF": attributes["SFHA_TF"],
                        "FLD_ZONE": zone, "ZONE_SUBTY": attributes.get("ZONE_SUBTY"),
                    })
        if len(seen) != record["feature_count"]:
            raise ValueError("FEMA analysis views differ from the captured feature count")
        folder = root / "views" / ("fema-" + record["sha256"][:24])
        derivation = folder / "derivation.json"
        atomic_json(derivation, {
            "schema": "upstate.fema-flood-views/v1", "native_sha256": record["sha256"],
            "native_feature_count": len(seen), "native_object_id_field": field,
            "source_crs": native.get("spatialReference") or record["source_crs"],
            "sfha_feature_count": len(selected["sfha"]),
            "classified_feature_count": len(selected["classified_tf"]),
            "criterion_coverage_feature_count": len(selected["criterion_coverage"]),
            "criterion_coverage_rule": {
                "positive_SFHA_TF": "T", "negative_SFHA_TF": "F",
                "negative_zone_codes": list(ASSESSED_NON_SFHA_ZONES),
                "zone_comparison": "Trim whitespace and uppercase; original values retained",
                "references": list(FEMA_CLASS_REFERENCES),
            },
            "criterion_coverage_exclusions": assessment_exclusions,
            "unclassified_object_ids": unclassified,
            "source_geometry_absent_object_ids": missing,
            "source_geometry_empty_object_ids": empty,
            "source_geometry_no_area_object_ids": nonarea,
            "reader_geometry_corrections": corrections,
            "attribute_geometry_treatment": (
                "Original selected rows retained unchanged; polygon usability checked "
                "with the existing XY reader and its recorded corrections"
            ),
        }, immutable=True)
        titles = {
            "sfha": "FEMA mapped Special Flood Hazard Area polygons",
            "classified_tf": "FEMA published SFHA designation coverage",
            "criterion_coverage": "FEMA SFHA and assessed non-SFHA criterion coverage",
        }
        roles = {
            "sfha": "FLOODPLAIN_ONE_PERCENT",
            "classified_tf": "FLOOD_CLASSIFICATION_COVERAGE",
            "criterion_coverage": "FLOOD_ASSESSMENT_COVERAGE",
        }
        entries = []
        for view, rows in selected.items():
            path = folder / (view + ".esri.json.gz")
            atomic_bytes(path, gzip.compress(canonical({**native, "features": rows}), mtime=0),
                         immutable=True)
            entry = {
                **native_entry, "id": "fema-" + view.replace("_", "-") + "-" + file_digest(path)[:24],
                "title": titles[view], "role": roles[view],
                **describe_file(root, path),
                "metadata": {
                    **native_entry["metadata"], "hazard_view": view,
                    "native_source_id": native_entry["id"], "native_sha256": record["sha256"],
                    "feature_count": len(rows), "native_feature_count": len(seen),
                    "source_filter": {"SFHA_TF": ["T"] if view == "sfha" else ["T", "F"]},
                    "geometry_absent_count": len(missing), "geometry_empty_count": len(empty),
                    "geometry_no_area_count": len(nonarea),
                    "criterion_coverage_excluded_count": len(assessment_exclusions),
                    "criterion_coverage_negative_zone_codes": list(ASSESSED_NON_SFHA_ZONES),
                },
                "companions": [
                    {key: native_entry[key] for key in ("path", "bytes", "sha256")},
                    *native_entry["companions"], describe_file(root, derivation),
                ],
            }
            entries.append(entry)
        atomic_json(root / "flood-views.json", {
            "schema": "upstate.fema-flood-views/v1",
            "native_sha256": record["sha256"], "entries": entries,
        }, immutable=True)
        previous = read_json(root / "capture-progress.json")
        return _publish(root, plan, records, previous.get("failures", {}))


def bindings(manifest, collection):
    """Bind only read-back Workspace bodies to native selectors and meanings."""
    collection_id = collection["id"]
    actual = {entry["id"]: entry for entry in collection["entries"]}
    choices, metadata_by_name = {}, {}
    for expected in manifest["entries"]:
        source = actual.get(expected["id"], {})
        if (source.get("kind") != expected["kind"] or source.get("role") != expected.get("role")
                or source.get("body", {}).get("sha256") != expected["sha256"]
                or source.get("body", {}).get("bytes") != expected["bytes"]):
            raise ValueError("Workspace source readback differs from " + expected["id"])
        metadata = expected.get("metadata", {})
        key = metadata.get("hazard_source_key")
        if key is None:
            continue
        suffix = {"analysis_xy": "-points", "sfha": "-sfha",
                  "classified_tf": "-classified-tf",
                  "criterion_coverage": "-criterion-coverage"}.get(metadata.get("hazard_view"), "")
        name = key + suffix
        if name in choices:
            raise ValueError("Hazard source bindings repeat " + name)
        choices[name] = {
            "source_collection_id": collection_id, "source_id": expected["id"],
            "reference": expected["uri"],
        }
        if expected.get("id_field"):
            choices[name]["id_field"] = expected["id_field"]
        metadata_by_name[name] = metadata
    result = {"schema": "upstate.hazard-source-bindings/v1", "sources": choices}
    if "fema-flood-zones" in choices:
        result["sfha"] = {
            **choices["fema-flood-zones"], "where": {"SFHA_TF": "T"},
            "meaning": "FEMA mapped Special Flood Hazard Area",
            "relation": "Polygon intersection on the selected equal-area analysis CRS",
        }
        result["mapped_non_sfha"] = {
            **choices["fema-flood-zones"], "where": {"SFHA_TF": "F"},
            "meaning": "Original FEMA rows carrying SFHA_TF=F; interpret FLD_ZONE/ZONE_SUBTY",
            "relation": "Polygon intersection on the selected equal-area analysis CRS",
        }
        result["flood_coverage"] = {
            "availability": choices.get("fema-availability"),
            "classified_tf": [result["sfha"], result["mapped_non_sfha"]],
            "meaning": "Measure availability footprint and valid T/F polygon coverage separately; union overlap before area aggregation",
        }
    if "nid-dams-points" in choices:
        result["dam_points"] = {
            **choices["nid-dams-points"], "label_field": "NAME",
            "meaning": "Published NID structure location",
            "relation": "Distance to a retained structure point in the selected projected CRS",
        }
    criteria = {}
    if "nid-dams-points" in choices:
        dams = {
            **choices["nid-dams-points"], "label_field": "NAME",
            "meaning": "Published NID structure location",
            "relation": "Original NID structure point intersects the retained reporting parcel",
        }
        if (metadata_by_name["nid-dams-points"].get("geometry_absent_count") == 0
                and "upstream-masks" in choices):
            dams["coverage"] = {"source": choices["upstream-masks"], "group": "upstream"}
        criteria["dams"] = dams
    if "fema-flood-zones-sfha" in choices:
        floodplains = {
            **choices["fema-flood-zones-sfha"],
            "meaning": "Mapped FEMA Special Flood Hazard Area; criterion measures published SFHA designation overlap",
            "relation": "Original FEMA SFHA polygon intersects the retained reporting parcel",
        }
        coverage_key = "fema-flood-zones-criterion-coverage"
        # The current coverage reader requires a nonempty vector; an empty
        # assessed edition supplies no known-negative area.
        if (coverage_key in choices
                and metadata_by_name[coverage_key].get("feature_count", 0) > 0):
            floodplains["coverage"] = {"source": choices[coverage_key]}
        criteria["floodplains"] = floodplains
    result["parcel_criteria"] = {"sources": criteria}
    return result


def intake(args):
    from source_tools import operator_source_intake as client_api

    manifest_path = Path(args.manifest).resolve(strict=True)
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the completed Workspace hazard source manifest")
    for entry in manifest["entries"]:
        for item in [entry, *entry.get("companions", [])]:
            verify_file(manifest_path.parent, item)
    client = client_api.Client(args.operator_url, client_api.secret(args), args.request_timeout)
    state, project = client_api.choose_workspace(client, args)
    catalog = client.get("/api/source-preparation/catalog", workspace=project["workspace_key"])
    registered = [row for row in catalog.get("registered", []) if row["id"] == args.registered_manifest]
    if len(registered) != 1 or registered[0].get("sha256") != file_digest(manifest_path):
        raise ValueError("Select the current registered ID for these exact manifest bytes")
    collection_ids = sorted(set(client_api.checked_id(value, "Source collection")
                                for value in args.include_collection))
    known = {row["id"] for row in state.get("data", {}).get("sources", [])}
    if set(collection_ids) - known:
        raise ValueError("Select existing source collections from this Workspace")
    request = {
        "workspace": project["workspace_key"], "action": "source.compose",
        "operation_id": client_api.operation(args.operation_id, "compose"),
        "payload": {"prepared_task_ids": [], "source_collection_ids": collection_ids,
                    "registered_ids": [args.registered_manifest],
                    "title": "Upper Savannah environmental context edition", "import_sources": True},
    }
    definition = {"name": "composition", "request": request}
    selection = {"project": project, "request": request, "manifest_sha256": file_digest(manifest_path)}
    output = Path(args.output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    with held(output.with_name(output.name + ".lock"), blocking=False):
        if output.is_symlink():
            raise ValueError("Choose an ordinary intake result file")
        if output.exists():
            ledger = read_json(output)
            if ledger.get("schema") != "upstate.hazard-intake/v1" or ledger.get("selection_sha256") != digest(selection):
                raise ValueError("This intake output already belongs to a different source selection")
        else:
            ledger = {"schema": "upstate.hazard-intake/v1", "selection": selection,
                      "selection_sha256": digest(selection), "tasks": {}}

        def persist():
            client_api.save(output, client.redact(ledger))

        ledger["state"] = "composing"
        ledger.pop("error", None)
        persist()
        try:
            existing = client_api.existing_task(client, definition, ledger, state.get("tasks", []))
            task = client_api.ensure_task(
                client, definition, existing=existing, ledger=ledger, persist=persist,
                resume_cancelled=args.resume_cancelled,
            )
            task = client_api.wait_tasks(
                client, {"composition": task}, ledger, persist,
                time.monotonic() + args.wait_seconds if args.wait_seconds else None,
                args.poll_seconds,
            )["composition"]
            collection_id = client_api.checked_id(task["result"]["source_collection_id"], "Source collection")
            collection = client.get("/api/item", workspace=project["workspace_key"],
                                    kind="sources", id=collection_id)
            bound = bindings(manifest, collection)
            ledger.update(state="complete", source_collection_id=collection_id,
                          composition_task_id=task["id"], bindings=bound)
            persist()
            return ledger
        except BaseException as error:
            ledger.update(state="pending" if ledger.get("state") == "pending"
                          else "interrupted" if isinstance(error, KeyboardInterrupt) else "failed",
                          error={"type": type(error).__name__, "message": client.redact(str(error))})
            persist()
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    grab = commands.add_parser("capture", help="Receive or resume native public source layers")
    grab.add_argument("--output", required=True)
    grab.add_argument("--domain-capture", help="Existing complete domain-overlay plan directory")
    grab.add_argument("--source", action="append", choices=list(SPECS))
    grab.add_argument("--retry-failed", action="store_true")
    grab.add_argument("--metadata-root")
    prepare = commands.add_parser("prepare-dams", help="Prepare original NID points for existing vector readers")
    prepare.add_argument("--output", required=True)
    flood = commands.add_parser("prepare-flood", help="Prepare native SFHA, designation and assessed coverage views")
    flood.add_argument("--output", required=True)
    receive = commands.add_parser("intake", help="Compose, import and bind the registered native source edition")
    receive.add_argument("--manifest", required=True, help="Exact immutable source-manifest file")
    receive.add_argument("--registered-manifest", required=True, help="Its current operator catalogue ID")
    receive.add_argument("--operator-url", required=True)
    study = receive.add_mutually_exclusive_group(required=True)
    study.add_argument("--workspace")
    study.add_argument("--study-title")
    auth = receive.add_mutually_exclusive_group()
    auth.add_argument("--capability-env")
    auth.add_argument("--capability-file")
    receive.add_argument("--include-collection", action="append", default=[])
    receive.add_argument("--operation-id", default="UPSTATE-HAZARD-CONTEXT-20261013-ESMX13")
    receive.add_argument("--output", required=True)
    receive.add_argument("--resume-cancelled", action="store_true")
    receive.add_argument("--wait-seconds", type=float, default=0)
    receive.add_argument("--poll-seconds", type=float, default=5)
    receive.add_argument("--request-timeout", type=float, default=30)
    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            result = capture(args.output, domain_capture=args.domain_capture, sources=args.source,
                             retry_failed=args.retry_failed, metadata_root=args.metadata_root)
        elif args.command == "prepare-dams":
            result = prepare_dams(args.output)
        elif args.command == "prepare-flood":
            result = prepare_flood(args.output)
        else:
            values = (args.wait_seconds, args.poll_seconds, args.request_timeout)
            if (not all(math.isfinite(value) for value in values) or args.wait_seconds < 0
                    or args.poll_seconds < .25 or args.request_timeout <= 0):
                raise ValueError("Use finite wait/poll/timeout values, polling at least 0.25 seconds")
            result = intake(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["state"] == "complete" else 2
    except KeyboardInterrupt:
        print("Intake observation interrupted; the native operator task remains retained.", file=sys.stderr)
        return 130
    except (IntakeError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
