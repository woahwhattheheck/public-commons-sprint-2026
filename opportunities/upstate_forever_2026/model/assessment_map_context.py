"""Map saved assessment relationships from their retained native watershed source.

The shared scientific renderer draws native projected XY geometry. This module
does not recompute station memberships, reproject, simplify, rank water quality,
or derive concentration/area quantities from assessment inventories.
"""
from __future__ import annotations

import math
from pathlib import Path

from . import station_geography as geography
from . import assessment_context as assessments
from . import scientific_figures, scientific_map_figures
from .common import atomic_bytes, atomic_json, describe_file, digest, file_digest, read_json, verify_file

VERSION = "1.0.0"
SCHEMA = "upstate.assessment-map-context/v1"
SPEC = "maps/assessment-map-figures.json"
METADATA = "maps/assessment-map-context.json"


def implementation():
    """Bind the exact producer and shared vector renderer into a report edition."""
    return {"version": VERSION, "renderer_kind": scientific_map_figures.KIND,
            "sources": [{"path": "model/" + path.name, "sha256": file_digest(path)}
                        for path in (Path(__file__), Path(scientific_figures.__file__),
                                     Path(scientific_map_figures.__file__))]}


def _key(reference):
    return reference.get("collection_id"), reference.get("source_id")


def _metric(crs):
    return (crs.is_projected and len(crs.axis_info) >= 2 and
            all(abs(axis.unit_conversion_factor - 1.0) <= 1e-12
                for axis in crs.axis_info[:2]))


def _extent(records):
    positions = (point for row in records for point in
                 scientific_map_figures.positions(row["geometry"]))
    first = next(positions, None)
    if first is None:
        raise ValueError("The retained watershed source has no map positions")
    x0 = x1 = first[0]; y0 = y1 = first[1]
    for point in positions:
        x0 = min(x0, point[0]); x1 = max(x1, point[0])
        y0 = min(y0, point[1]); y1 = max(y1, point[1])
    pad = max(x1 - x0, y1 - y0) * .035
    if not math.isfinite(pad) or pad <= 0:
        raise ValueError("Original watershed map has no positive native extent")
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]


def _layer(row, role, original_file):
    return {"role": role, "geometry": row["geometry_sha256"],
            "receptor_id": row["polygon_id"], "source": dict(original_file),
            "watershed_id": row["watershed_id"], "source_ref": row["source_ref"],
            "geometry_operations": row["geometry_operations"],
            "original_geometry_sha256": row["original_geometry_sha256"]}


def _figure(key, title, caption, rows, layers, declared_crs, labels, legend=()):
    bank = {row["geometry_sha256"]: row["geometry"] for row in rows}
    figure = {"id": key, "title": title, "caption": caption, "geometries": bank,
              "panels": [{"kind": scientific_map_figures.KIND, "title": title,
                          "crs": declared_crs, "bounds": _extent(rows),
                          "layers": layers, "role_labels": labels,
                          "legend": list(legend)}]}
    scientific_figures._validate_figure(figure)
    return figure


def _difference_groups(rows, native):
    from shapely.geometry import shape
    groups = {}
    for row in rows:
        if row.get("association_agreement") is not False:
            continue
        published = sorted(set(row.get("published_polygon_ids", [])))
        computed = sorted(set(row.get("computed_polygon_ids", [])))
        if not published or not computed or set(published) == set(computed):
            raise ValueError("A saved differing relationship has no distinct resolved polygon sets")
        if set(published + computed) - set(native):
            raise ValueError("A differing relationship lost its original native watershed")
        identity = {"station_id": row["station_id"], "published": published, "computed": computed}
        key = digest(identity)
        group = groups.setdefault(key, {**identity, "id": key, "assessment_row_ids": [],
                                      "original_assessment_records": []})
        row_id = row.get("assessment_row_id") or assessments._row_id(row)
        group["assessment_row_ids"].append(row_id)
        group["original_assessment_records"].append({
            "assessment_row_id": row_id,
            "assessment_edition": row.get("assessment_edition"),
            "cause": row.get("cause"), "impaired_use": row.get("impaired_use"),
            "use_support": row.get("use_support"), "source_ref": row["source_ref"]})
    values = sorted(groups.values(), key=lambda group: (group["station_id"], group["id"]))
    for group in values:
        # A label anchor is a cartographic polygon point, not a station coordinate.
        polygon = shape(native[group["computed"][0]]["geometry"])
        point = polygon.representative_point()
        group["label_anchor"] = [point.x, point.y]
        group["label_anchor_meaning"] = "Interior label point in the first retained computed polygon; not a station location"
        group["published_watershed_ids"] = [native[key]["watershed_id"] for key in group["published"]]
        group["computed_watershed_ids"] = [native[key]["watershed_id"] for key in group["computed"]]
    return values


def _native(workspace, context):
    study = geography.inspect(workspace, context["selection"]["station_geography_id"],
                              verify=True, include_result=True)
    choice = context["selection"]["watershed_source"]
    references = [reference for reference in study["selection"]["watersheds"]
                  if _key(reference) == _key(choice)]
    bindings = [binding for binding in study["sources"] if _key(binding) == _key(choice)]
    if len(references) != 1 or len(bindings) != 1:
        raise ValueError("Choose the exact watershed source retained by this station study")
    path, entry, binding = geography._source(workspace, references[0])
    if binding["source_sha256"] != bindings[0]["source_sha256"]:
        raise ValueError("The original map source differs from the saved station study")
    crs, originals = geography._features(path, entry, references[0], points=False)
    field = references[0].get("id_field") or entry.get("id_field")
    if not field:
        raise ValueError("The original map source needs its retained watershed ID field")
    native = {}
    for feature in originals:
        native_id = feature["properties"].get(field)
        if native_id is None or str(native_id) == "":
            raise ValueError("An original watershed map feature has no native identifier")
        reference = {"collection_id": binding["collection_id"], "source_id": binding["source_id"],
                     "source_sha256": binding["source_sha256"],
                     "native_feature_id": feature["native_feature_id"],
                     "source_feature_index": feature["source_feature_index"],
                     "id_field": field, "native_crs": crs.to_string()}
        key = digest(reference)
        if key in native:
            raise ValueError("Original watershed map repeats a source feature identity")
        geometry = feature["geometry"]
        if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValueError("Assessment map needs the original watershed polygon geometry")
        # Validate every original position, including all polygon parts and holes.
        for unused in scientific_map_figures.positions(geometry):
            pass
        native[key] = {"polygon_id": key, "watershed_id": native_id,
                       "source_ref": reference, "geometry": geometry,
                       "geometry_sha256": digest(geometry),
                       "original_geometry_sha256": digest(feature["native_geometry"]),
                       "geometry_operations": list(feature.get("geometry_operations", []))}
    retained = {feature["id"] for feature in study["watershed_geojson"]["features"]
                if _key(feature["properties"]["source_ref"]) == _key(choice)}
    if set(native) != retained:
        raise ValueError("Original native map features differ from the saved station watershed inventory")
    return study, entry, binding, crs, native


def prepare(workspace, context, directory):
    """Retain source, figure specification and SVGs in the existing report edition."""
    directory = Path(directory)
    current_implementation = implementation()
    study, entry, binding, crs, native = _native(workspace, context)
    selected = sorted({row["context_id"] for row in context["result"]["watersheds"]})
    rows = context["result"]["rows"]
    selected_from_rows = {key for row in rows for key in row["selected_polygon_ids"]}
    if set(selected) != selected_from_rows or set(selected) - set(native):
        raise ValueError("The map selection differs from the saved assessment context")
    if len(selected) != context["summary"]["watershed_count"]:
        raise ValueError("The original context watershed count differs from its selected map")
    identity = {"implementation": current_implementation, "context_id": context["id"],
                "station_geography_id": study["id"], "source_ref": {
                    "collection_id": binding["collection_id"], "source_id": binding["source_id"],
                    "source_sha256": binding["source_sha256"]},
                "selected_polygon_ids": selected,
                "native_geometry": {key: row["geometry_sha256"] for key, row in native.items()}}
    identity_sha = digest(identity)
    existing = directory / METADATA
    if existing.exists():
        saved = read_json(existing)
        if saved.get("identity_sha256") != identity_sha:
            raise ValueError("Existing assessment map belongs to another original selection or renderer")
        for item in saved["files"]:
            verify_file(directory, item)
        return saved

    original_path = "maps/original-source/" + geography._safe_member(
        binding["body"].get("view_path") or binding["body"]["filename"]).as_posix()
    geography._copy_retained(workspace, binding["body"], directory / original_path)
    original_file = describe_file(directory, directory / original_path)
    source = {**identity["source_ref"], "title": binding.get("title"), "uri": binding.get("uri"),
              "file": original_file, "native_crs": crs.to_string(), "native_crs_wkt": crs.to_wkt(),
              "watershed_id_field": references_id_field(native), "feature_count": len(native),
              "complete_original_companions": "context/original-station-geography.zip"}
    groups = _difference_groups(rows, native)
    metadata = {"schema": SCHEMA, "version": VERSION, "identity_sha256": identity_sha,
                "identity": identity, "context_id": context["id"], "source": source,
                "relationship_basis": context["result"]["relationship_basis"],
                "selected_polygon_count": len(selected), "selected_polygon_ids": selected,
                "assessment_record_count": len(rows),
                "differing_assessment_record_count": sum(row.get("association_agreement") is False for row in rows),
                "unresolved_assessment_record_count": sum(row.get("association_agreement") is None for row in rows),
                "difference_relationship_count": len(groups), "difference_relationships": groups,
                "native_features": [{key: value for key, value in row.items() if key != "geometry"}
                                    for row in native.values()],
                "figures": [], "files": [original_file]}
    if not _metric(crs):
        metadata.update(status="unavailable_native_projected_metre_crs",
            message="The selected original source does not use projected XY metre coordinates. "
                    "Its original geometry and saved associations remain retained; the native metric map is unavailable.")
        atomic_json(existing, metadata, immutable=True)
        return metadata

    declared = {"name": crs.to_string(), "wkt": crs.to_wkt(), "units": "metre", "axes": "XY"}
    original_rows = list(native.values())
    layers = [_layer(row, "contribution", original_file) for row in original_rows]
    layers.extend(_layer(native[key], "receptor", original_file) for key in selected)
    overview = _figure("assessment-watersheds-overview",
        "Saved assessment selection in its original watershed source",
        str(len(selected)) + " selected original polygons within " + str(len(native)) +
        " retained source polygons; " + str(len(rows)) + " original assessment records. "
        "Gray is retained watershed geography and black outlines show this saved " +
        context["result"]["relationship_basis"] + " selection. Unselected polygons do not establish "
        "water-quality condition. Geometry is in " + crs.to_string() +
        "; scale and north are projected-grid references.",
        original_rows, layers, declared,
        {"contribution": "Retained watershed source", "receptor": "Selected assessment context"})
    figures = [overview]
    for start in range(0, len(groups), 6):
        page = groups[start:start + 6]
        published = sorted({key for group in page for key in group["published"]})
        computed = sorted({key for group in page for key in group["computed"]})
        involved = sorted(set(published + computed))
        layers = [_layer(native[key], "contribution", original_file) for key in published]
        layers.extend(_layer(native[key], "receptor", original_file) for key in computed)
        legend = [{"label": group["station_id"] + ": published " +
                   ", ".join(map(str, group["published_watershed_ids"])) + "; computed " +
                   ", ".join(map(str, group["computed_watershed_ids"])),
                   "anchor": group["label_anchor"], "relationship_id": group["id"]}
                  for group in page]
        number = start // 6 + 1
        figures.append(_figure("assessment-watershed-differences-" + str(number).zfill(3),
            "Publisher and station-membership differences — page " + str(number),
            str(sum(len(group["assessment_row_ids"]) for group in page)) +
            " original assessment records in " + str(len(page)) +
            " distinct station/polygon relationships on this page. Gray polygons are the original "
            "publisher association; black outlines are saved station membership. Numbered labels "
            "use interior polygon anchors, not station positions. This is a geographic comparison, "
            "not a change in assessment status, concentration or load. Full edition/cause/use/source "
            "identities remain in maps/assessment-map-context.json and context/context.json.",
            [native[key] for key in involved], layers, declared,
            {"contribution": "Publisher watershed", "receptor": "Station membership"}, legend))

    spec = {"schema": "upstate.scientific-figure-spec/v1", "edition": "assessment-map-" + VERSION,
            "source": source, "original_context_id": context["id"],
            "relationship_basis": context["result"]["relationship_basis"], "figures": figures}
    atomic_json(directory / SPEC, spec, immutable=True)
    metadata["files"].append(describe_file(directory, directory / SPEC))
    from reportlab.graphics import renderSVG
    for figure in figures:
        drawings = scientific_figures.panel_drawings(figure, 760)
        if len(drawings) != 1:
            raise ValueError("Each retained assessment map needs one native renderer panel")
        path = "maps/" + figure["id"] + ".svg"
        body = renderSVG.drawToString(drawings[0])
        atomic_bytes(directory / path, body.encode("utf-8") if isinstance(body, str) else body)
        metadata["files"].append(describe_file(directory, directory / path))
        metadata["figures"].append({"id": figure["id"], "path": path,
                                    "title": figure["title"], "caption": figure["caption"]})
    metadata.update(status="ready", figure_spec=SPEC,
        message="Native projected watershed maps preserve the original geometry and saved assessment relationships.")
    atomic_json(existing, metadata, immutable=True)
    return metadata


def references_id_field(native):
    values = {row["source_ref"]["id_field"] for row in native.values()}
    if len(values) != 1:
        raise ValueError("The retained watershed map needs one original identifier field")
    return next(iter(values))
