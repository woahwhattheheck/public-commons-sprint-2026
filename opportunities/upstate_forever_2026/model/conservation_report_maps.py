"""Retained geographic inputs for the existing Conservation scientific report.

Saved planning geometry remains authoritative. Context boundaries use the
original Conservation source selector and its maintained geometry reader.
"""
from __future__ import annotations

from copy import deepcopy
import math
from pathlib import Path

from . import conservation
from .common import describe_file, file_digest, read_json, verify_file

SCHEMA = "upstate.conservation-report-map-inputs/v1"
EDITION = "conservation-report-geography/1"
AREA_CHECK = {
    "absolute_ha": 0.000001,
    "relative": 0.000000001,
    "meaning": "Agreement check against saved vector areas; this is not positional accuracy.",
}


def _checked_area(geometry, expected, label):
    actual = geometry.area / 10000
    if (isinstance(expected, bool) or not isinstance(expected, (int, float))
            or not math.isfinite(expected)):
        raise ValueError("The original map area is unavailable: " + label)
    tolerance = max(AREA_CHECK["absolute_ha"], abs(expected) * AREA_CHECK["relative"])
    if abs(actual - expected) > tolerance:
        raise ValueError("Retained map geometry differs from the original saved " + label)
    return {"saved_ha": expected, "geometry_ha": actual, "tolerance_ha": tolerance}


def _feature(key, geometry, properties=None):
    from shapely.geometry import mapping
    if not geometry.is_empty and not geometry.is_valid:
        raise ValueError("Retained map geometry requires its original source correction: " + str(key))
    return {"type": "Feature", "id": str(key), "properties": deepcopy(properties or {}),
            "geometry": None if geometry.is_empty else mapping(geometry)}


def _collection(features):
    return {"type": "FeatureCollection", "features": features}


def capture(workspace, state, plan):
    """Read the completed original plan's full geometry without solving a case."""
    from pyproj import CRS
    from shapely import wkb
    from shapely.ops import unary_union

    if (state.get("state") != "complete" or plan.get("state") != "complete"
            or plan.get("study_id") != state.get("id")
            or plan["selection"].get("study_id") != state["id"]):
        raise ValueError("Choose the same completed Conservation study and portfolio")
    spec, bindings = state["selection"]["spec"], state["selection"]["bindings"]
    crs = CRS.from_user_input(state["analysis_crs"])
    if (CRS.from_user_input(plan["analysis_crs"]) != crs or not crs.is_projected
            or crs.to_epsg() == 3857 or len(crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-8 for axis in crs.axis_info[:2])):
        raise ValueError("Conservation map geometry needs its original projected metre analysis CRS")
    geometry_descriptor = state["files"]["geometries"]
    candidate_descriptor = state["files"]["candidates"]
    if (plan["selection"].get("geometries_sha256") != geometry_descriptor["sha256"]
            or plan["selection"].get("candidates_sha256") != candidate_descriptor["sha256"]):
        raise ValueError("The original portfolio binds another planning geometry or candidate edition")
    geometry_data = read_json(verify_file(workspace.root, geometry_descriptor))
    candidate_data = read_json(verify_file(workspace.root, candidate_descriptor))
    if (geometry_data.get("schema") != "upstate.conservation-geometries/v1"
            or geometry_data.get("study_id") != state["id"]
            or CRS.from_user_input(geometry_data.get("analysis_crs")) != crs
            or candidate_data.get("schema") != "upstate.conservation-candidates/v1"
            or candidate_data.get("study_id") != state["id"]):
        raise ValueError("The original map inputs identify another study or coordinate system")
    candidates = candidate_data["candidates"]
    by_id = {row["id"]: row for row in candidates}
    if len(by_id) != len(candidates) or set(by_id) != set(geometry_data["units"]):
        raise ValueError("The retained candidate and geometry inventories differ")
    selected_ids = plan.get("selected_ids")
    if (not isinstance(selected_ids, list) or not selected_ids
            or len(selected_ids) != len(set(selected_ids))
            or not set(selected_ids).issubset(by_id)):
        raise ValueError("Retain the original selected planning-unit identities")

    selected_set = set(selected_ids)
    all_reporting, selected_original, selected_reporting = [], [], []
    background_features, whole_features, reporting_features = [], [], []
    ordinal = {key: index + 1 for index, key in enumerate(selected_ids)}
    for key in sorted(by_id):
        row = by_id[key]
        original = wkb.loads(bytes.fromhex(geometry_data["units"][key]["original"]))
        reporting = wkb.loads(bytes.fromhex(geometry_data["units"][key]["reporting"]))
        for geometry in (original, reporting):
            if (geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon")
                    or not geometry.is_valid):
                raise ValueError("Original map planning geometry is incomplete: " + key)
        _checked_area(original, row["area_ha"], "whole unit " + key)
        _checked_area(reporting, row["reporting_area_ha"], "reporting unit " + key)
        metadata = {
            "native_id": key, "label": row.get("label"), "selected": key in selected_set,
            "map_number": ordinal.get(key), "source_identity": row["source_identity"],
            "original_attributes": row.get("original_attributes", {}),
            "geometry_corrections": row.get("geometry_corrections", []),
            "source_axes": row.get("source_axes"), "source_array_index": row.get("source_array_index"),
        }
        background_features.append(_feature(key, reporting, metadata))
        all_reporting.append(reporting)
        if key in selected_set:
            whole_features.append(_feature(key, original, metadata))
            reporting_features.append(_feature(key, reporting, metadata))
            selected_original.append(original)
            selected_reporting.append(reporting)
    whole_union = unary_union(selected_original)
    reporting_union = unary_union(selected_reporting)
    inventory_union = unary_union(all_reporting)
    checks = {
        "selected_original_union": _checked_area(
            whole_union, plan["summary"]["whole_unit_union_area_ha"], "whole selected-unit union"),
        "selected_reporting_union": _checked_area(
            reporting_union, plan["summary"]["union_area_ha"], "selected reporting union"),
        "candidate_reporting_union": _checked_area(
            inventory_union, state["summary"]["unit_footprint_area_ha"], "candidate reporting union"),
    }

    # The stored selected-union layer is also the native scenario-mask authority.
    footprint = plan["files"]["footprint"]
    footprint_path = verify_file(workspace.root, footprint)
    footprint_rows, unused = conservation.rasters.vector_geometry(
        footprint_path, layer=footprint.get("layer", "selected_union"), target_crs=crs)
    footprint_union = conservation.rasters.polygon_union(footprint_rows)
    _checked_area(footprint_union, plan["summary"]["union_area_ha"], "saved footprint layer")
    difference = footprint_union.symmetric_difference(reporting_union)
    _checked_area(difference, 0.0, "selected footprint symmetric difference")

    grid = bindings.get("grid")
    if grid:
        boundary_file = verify_file(workspace.root / "grids" / grid["id"], grid["reporting_area"])
        boundary_rows, unused = conservation.rasters.vector_geometry(boundary_file, target_crs=crs)
        boundary_binding = {"grid_id": grid["id"], "file": describe_file(workspace.root, boundary_file)}
    else:
        boundary_rows = conservation._vector(
            workspace, spec["reporting_area"], bindings["sources"]["reporting_area"], crs)
        boundary_binding = deepcopy(bindings["sources"]["reporting_area"])
    boundary = conservation.rasters.polygon_union(boundary_rows)
    checks["reporting_boundary"] = _checked_area(
        boundary, state["reporting_area_ha"], "original reporting boundary")

    context_features, context_unions, intersections, context_sources = {}, {}, {}, {}
    for name, choice in spec.get("contexts", {}).items():
        source = bindings["sources"][name]
        rows = conservation._vector(workspace, choice, source, crs)
        selected_source = unary_union([row["geometry"] for row in rows])
        buffer_m = choice.get("buffer_m", 0)
        if buffer_m:
            if not choice.get("relation"):
                raise ValueError("Retain the declared geographic meaning of this context buffer")
            selected_source = selected_source.buffer(buffer_m)
        clipped = selected_source.intersection(boundary)
        intersection = reporting_union.intersection(clipped)
        context_features[name] = _collection([
            _feature(str(row["id"]), row["geometry"], {
                "native_id": str(row["id"]), "original_attributes": row["properties"],
                "source_array_index": row.get("source_array_index"),
                "source_axes": row.get("source_axes"),
                "geometry_corrections": row.get("geometry_corrections", []),
            }) for row in rows
        ])
        for feature, row in zip(context_features[name]["features"], rows):
            visible = row["geometry"].intersection(boundary)
            anchor = visible.representative_point() if not visible.is_empty else None
            feature["properties"]["cartographic_anchor"] = (
                [anchor.x, anchor.y] if anchor is not None else None)
            feature["properties"]["anchor_meaning"] = (
                "Label position within the reporting-clipped source feature; not an observed site")
        context_unions[name] = _feature(name, clipped, {"buffer_m": buffer_m})
        intersections[name] = _feature(name, intersection)
        context_sources[name] = {
            "selection": deepcopy(choice), "binding": deepcopy(source),
            "selected_feature_count": len(rows), "buffer_m": buffer_m,
            "relation": choice.get("relation"), "meaning": choice.get("meaning"),
            "reference": choice.get("reference"),
            "context_geometry_type": clipped.geom_type,
            "selected_intersection_length_m": (intersection.length
                if clipped.geom_type in ("LineString", "MultiLineString") else None),
        }
        area_key = {"drinking_water": "source_water_area_ha",
                    "protected_lands": "protected_area_ha",
                    "high_quality_waters": "high_quality_overlap_area_ha"}[name]
        checks[name] = _checked_area(intersection, plan["summary"][area_key], name + " intersection")
        if name == "high_quality_waters" and clipped.geom_type in ("LineString", "MultiLineString"):
            expected_length = plan["summary"].get("high_quality_contact_length_m")
            if (isinstance(expected_length, bool) or not isinstance(expected_length, (int, float))
                    or not math.isfinite(expected_length)
                    or abs(intersection.length - expected_length) > max(0.0001, abs(expected_length) * 1e-9)):
                raise ValueError("Retained designated-water map differs from saved line contact")
            context_sources[name]["saved_contact_length_m"] = expected_length

    implementations = {
        "map_capture": Path(__file__),
        "conservation_geometry_reader": Path(conservation.__file__),
        "native_vector_reader": Path(conservation.rasters.__file__),
    }
    from source import capture_upstream_network
    implementations["original_esri_polygon_reader"] = Path(capture_upstream_network.__file__)
    versions = {}
    for name in ("pyproj", "shapely"):
        from importlib.metadata import version
        versions[name] = version(name)
    return {
        "schema": SCHEMA, "edition": EDITION, "project_id": workspace.project["id"],
        "study_id": state["id"], "plan_id": plan["id"], "mode": state["mode"],
        "selected_ids": list(selected_ids), "analysis_crs": crs.to_wkt(),
        "analysis_crs_label": crs.to_string(), "coordinate_unit": "metre",
        "geometry_method": "Unchanged saved WKB planning geometry; original bound context reader; no simplification",
        "area_check": deepcopy(AREA_CHECK), "area_checks": checks,
        "inputs": {
            "geometries": deepcopy(geometry_descriptor), "candidates": deepcopy(candidate_descriptor),
            "footprint": deepcopy(footprint), "reporting_boundary": boundary_binding,
        },
        "implementations": {name: {"bytes": path.stat().st_size, "sha256": file_digest(path)}
                            for name, path in sorted(implementations.items())},
        "native_libraries": versions, "context_sources": context_sources,
        "geometry": {
            "candidate_reporting_footprints": _collection(background_features),
            "selected_original_units": _collection(whole_features),
            "selected_reporting_units": _collection(reporting_features),
            "selected_original_union": _feature("selected-original-union", whole_union),
            "selected_reporting_union": _feature("selected-reporting-union", reporting_union),
            "reporting_boundary": _feature("reporting-boundary", boundary),
            "context_features": context_features, "context_unions": context_unions,
            "selected_context_intersections": intersections,
        },
    }


MAP_SCHEMA = "upstate.conservation-report-maps/v1"
INPUTS = "figures/conservation-map-inputs.json"
SPEC = "figures/conservation-map-spec.json"
INVENTORY = "figures/conservation-map-members.json"
CONTEXT_REGISTER = "figures/conservation-map-context-features.json"


def implementation():
    """Bind the installed geographic presentation before choosing its source ID."""
    from reportlab import Version as reportlab_version
    from . import scientific_figures, scientific_map_figures
    from source import capture_upstream_network
    from importlib.metadata import version
    role_reader = getattr(scientific_map_figures, "_role_labels", None)
    labels = {"contribution": "Selected reporting footprint", "receptor": "Retained context"}
    if not callable(role_reader) or role_reader({"role_labels": labels}) != labels:
        raise ValueError("Install the maintained scientific-map role-label support for Conservation geography")
    return {
        "edition": EDITION, "reportlab_version": reportlab_version,
        "capture_sha256": file_digest(__file__),
        "renderer_sha256": file_digest(scientific_map_figures.__file__),
        "dispatcher_sha256": file_digest(scientific_figures.__file__),
        "conservation_geometry_reader_sha256": file_digest(conservation.__file__),
        "native_vector_reader_sha256": file_digest(conservation.rasters.__file__),
        "original_esri_reader_sha256": file_digest(capture_upstream_network.__file__),
        "pyproj_version": version("pyproj"), "shapely_version": version("shapely"),
        "width_points": 511.2,
    }


def _extent(geometries):
    from .scientific_map_figures import positions
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    for geometry in geometries.values():
        for point in positions(geometry):
            x0, x1 = min(x0, point[0]), max(x1, point[0])
            y0, y1 = min(y0, point[1]), max(y1, point[1])
    if not all(math.isfinite(value) for value in (x0, x1, y0, y1)):
        raise ValueError("The original Conservation map has no retained coordinates")
    margin = max(x1 - x0, y1 - y0, 1.0) * 0.08
    return [x0 - margin, y0 - margin, x1 + margin, y1 + margin]


def _geometry_collection(features):
    values = [deepcopy(feature["geometry"]) for feature in features if feature.get("geometry")]
    if not values:
        return None
    return values[0] if len(values) == 1 else {"type": "GeometryCollection", "geometries": values}


def context_register(captured):
    """Preserve source labels as declared attributes, without inferring a site."""
    rows = []
    for context, collection in captured["geometry"]["context_features"].items():
        source = captured["context_sources"][context]["selection"]
        for feature in collection["features"]:
            properties = feature["properties"]
            attrs = properties.get("original_attributes") or {}
            def text_field(name):
                value = attrs.get(name)
                return "" if value is None else str(value)
            fields = {name: text_field(name) for name in
                      ("NAME", "FACILITY", "INTAKE", "BUFFER_FT")}
            rows.append({
                "context": context, "source_id": source["source_id"],
                "native_feature_id": properties["native_id"],
                "NAME": fields["NAME"], "FACILITY": fields["FACILITY"],
                "INTAKE": fields["INTAKE"], "BUFFER_FT": fields["BUFFER_FT"],
                "cartographic_anchor": properties.get("cartographic_anchor"),
            })
    return rows


def _context_legend(captured, name):
    rows = [row for row in context_register(captured)
            if row["context"] == name and row["cartographic_anchor"] is not None]
    if len(rows) > 6:
        return []  # Retain the complete source register, never an arbitrary six-feature subset.
    result = []
    for row in rows:
        label = "ID " + row["native_feature_id"]
        if row["INTAKE"]:
            label += " · intake " + row["INTAKE"]
        if row["BUFFER_FT"]:
            label += " · " + row["BUFFER_FT"] + " ft (BUFFER_FT)"
        result.append({"label": label, "receptor_id": row["native_feature_id"],
                       "anchor": row["cartographic_anchor"]})
    return result


def figures(captured, descriptor):
    """Supply original coordinate specifications to the shared geographic renderer."""
    from .common import digest

    data = captured["geometry"]
    crs = {"name": captured["analysis_crs_label"], "wkt": captured["analysis_crs"],
           "axes": "XY", "units": "metre"}
    result = []
    def frame(key, title, caption, layers, labels, legend=()):
        bank, selected = {}, []
        for role, geometry, location in layers:
            if geometry is None:
                continue
            token = digest(geometry)
            bank[token] = deepcopy(geometry)
            selected.append({
                "geometry": token, "role": role, "receptor_id": location,
                "source": {**descriptor, "geometry_location": location,
                           "project_id": captured["project_id"], "plan_id": captured["plan_id"]},
            })
        if not selected:
            return
        panel = {
            "kind": "projected_geometry_map", "title": title,
            "bounds": _extent(bank), "crs": deepcopy(crs), "layers": selected,
            "legend": list(legend), "role_labels": labels,
        }
        result.append({
            "id": key, "title": title, "caption": caption, "alt": caption,
            "geometries": bank, "panels": [panel],
            "source_binding": {
                "project_id": captured["project_id"], "study_id": captured["study_id"],
                "plan_id": captured["plan_id"], "selected_ids": captured["selected_ids"],
                "geographic_inputs": deepcopy(descriptor),
            },
            "method": {
                "planning_geometry": "Original saved WKB XY, without coordinate simplification",
                "contexts": "Original bound source selector and retained interpretation",
                "north": "Positive projected Y (grid north)",
                "scale": "Projected grid metres; not a ground-distance correction",
                "basemap": None, "simplification": False,
                "labels": "Cartographic positions only, never inferred monitoring or intake sites",
            },
        })

    all_reporting = _geometry_collection(data["candidate_reporting_footprints"]["features"])
    whole = data["selected_original_union"]["geometry"]
    selected = data["selected_reporting_union"]["geometry"]
    checks = captured["area_checks"]
    whole_ha = checks["selected_original_union"]["saved_ha"]
    selected_ha = checks["selected_reporting_union"]["saved_ha"]
    inventory_count = len(data["candidate_reporting_footprints"]["features"])
    selected_count = len(captured["selected_ids"])
    frame("conservation-regional-selection", "Selected land in the original planning inventory",
          str(selected_count) + " selected original units within the full " + str(inventory_count) +
          "-unit reporting inventory. Grey polygons retain every original reporting footprint; "
          "dark outlines show the selected complete original units. The inventory footprint is not "
          "automatically a source-water protection designation or a modeled contributing catchment. "
          "Overlapping units are counted once only in the separate union totals.",
          [("contribution", all_reporting, "geometry.candidate_reporting_footprints"),
           ("receptor", whole, "geometry.selected_original_union")],
          {"contribution": "Original reporting footprints", "receptor": "Selected whole units"})
    frame("conservation-selected-footprints", "Whole selected units and the reporting footprint",
          "Full selected original-unit union: " + format(whole_ha, ",.6f") + " ha. "
          "Selected union within the original reporting boundary: " +
          format(selected_ha, ",.6f") + " ha. Grey is the reporting footprint; the dark outline "
          "is the whole original-unit union. When they coincide the original boundaries remain "
          "superimposed. These are saved vector areas, separate from any raster cell-centre mask.",
          [("contribution", selected, "geometry.selected_reporting_union"),
           ("receptor", whole, "geometry.selected_original_union")],
          {"contribution": "Selected reporting footprint", "receptor": "Whole selected-unit union"})

    titles = {"drinking_water": "Retained source-water context",
              "protected_lands": "Retained protected-land context",
              "high_quality_waters": "Retained designated-water context"}
    for name, context in captured["context_sources"].items():
        contextual = data["context_unions"][name]["geometry"]
        intersection = data["selected_context_intersections"][name]["geometry"]
        if contextual is None:
            continue
        original_features = data["context_features"][name]["features"]
        selected_area = checks[name]["saved_ha"]
        meaning = context.get("meaning") or context.get("relation") or "Declared source intersection"
        title = titles[name]
        caption = (
            title + " from original source " + str(context["selection"]["source_id"]) +
            ". Declared relation: " + str(meaning) + ". Grey is the selected reporting footprint; "
            "the dark geometry is the selected context within the reporting boundary. "
            "Its intersection with the selected footprint is " + format(selected_area, ",.6f") +
            " ha; the whole selected footprint remains " + format(selected_ha, ",.6f") + " ha. "
            "Context polygons are unioned before overlap is measured. The retained source contains " +
            str(len(original_features)) + " selected original features. "
            "A displayed boundary is geographic context, not a measured concentration or modeled flow path."
        )
        caption += " Numbered source labels, when shown, are cartographic anchors; they are not intake or sample sites."
        if len(original_features) > 6:
            caption += " The complete source-feature register accompanies this frame; no six-feature subset is substituted."
        if context.get("saved_contact_length_m") is not None:
            caption += " Saved line contact within selected land is " + format(
                context["saved_contact_length_m"], ",.3f") + " m; a line has no areal coverage."
        if context.get("buffer_m"):
            caption += " The saved context explicitly includes a " + str(context["buffer_m"]) + "-metre buffer."
        else:
            caption += " No additional buffer is applied."
        if context.get("reference"):
            caption += " Original reference: " + str(context["reference"])
        frame("conservation-context-" + name.replace("_", "-"), title, caption,
              [("contribution", selected, "geometry.selected_reporting_union"),
               ("receptor", contextual, "geometry.context_unions." + name)],
              {"contribution": "Selected reporting footprint", "receptor": "Retained context"},
              legend=_context_legend(captured, name))
        if intersection is not None:
            # The separate overlap view has a distinct caption and fill, so the
            # context area cannot be mistaken for the whole selected footprint.
            frame("conservation-overlap-" + name.replace("_", "-"),
                  title + " — selected intersection",
                  "Grey shows the exact intersection of the retained context with selected land: " +
                  format(selected_area, ",.6f") + " ha. The dark outline is the complete selected "
                  "reporting union (" + format(selected_ha, ",.6f") + " ha). Overlaps are unioned once; "
                  "fill darkness represents membership, not a modeled quantity. Original source and "
                  "geometry interpretation are the same as in the preceding context frame." +
                  ((" The selected line contact is " + format(context["saved_contact_length_m"], ",.3f") +
                    " m; zero hectares is the expected area of a line.") if
                   context.get("saved_contact_length_m") is not None else ""),
                  [("contribution", intersection, "geometry.selected_context_intersections." + name),
                   ("receptor", selected, "geometry.selected_reporting_union")],
                  {"contribution": "Selected context intersection", "receptor": "Selected reporting union"})
    return result


def _immutable_bytes(path, body):
    import os
    import tempfile
    path = Path(path)
    body = body.encode("utf-8") if isinstance(body, str) else body
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("The retained Conservation map has another original rendering")
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".conservation-map-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise ValueError("Concurrent Conservation map rendering differs")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def prepare(workspace, state, plan, directory):
    """Retain complete original geometry, figure specifications and shared SVGs."""
    from reportlab.graphics import renderSVG
    from . import scientific_figures
    from .common import atomic_json

    directory = Path(directory)
    identity = {
        "project_id": workspace.project["id"], "study_id": state["id"], "plan_id": plan["id"],
        "geometries": deepcopy(state["files"]["geometries"]),
        "candidates": deepcopy(state["files"]["candidates"]),
        "footprint": deepcopy(plan["files"]["footprint"]),
        "selected_ids": list(plan["selected_ids"]),
        "context_sources": deepcopy(state["selection"]["bindings"]["sources"]),
        "implementation": implementation(),
    }
    inventory_path = directory / INVENTORY
    if inventory_path.exists():
        inventory = read_json(inventory_path)
        if inventory.get("schema") != MAP_SCHEMA or inventory.get("identity") != identity:
            raise ValueError("The saved geographic figures bind another source or rendering edition")
        for item in inventory["files"]:
            verify_file(directory, item)
        return {**inventory, "files": inventory["files"] + [describe_file(directory, inventory_path)]}
    captured = capture(workspace, state, plan)
    atomic_json(directory / INPUTS, captured, immutable=True)
    inputs = describe_file(directory, directory / INPUTS)
    register = context_register(captured)
    atomic_json(directory / CONTEXT_REGISTER, {
        "schema": "upstate.conservation-report-map-context-features/v1",
        "project_id": workspace.project["id"], "study_id": state["id"], "plan_id": plan["id"],
        "rows": register,
        "fields": "NAME, FACILITY, INTAKE and BUFFER_FT retain original source attributes; blank means absent or null",
        "anchor_meaning": "Cartographic label position, not a monitoring or intake site",
    }, immutable=True)
    original_figures = figures(captured, inputs)
    specification = {
        "schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
        "title": plan["title"] + " — original Conservation geography",
        "project_id": workspace.project["id"], "study_id": state["id"], "plan_id": plan["id"],
        "rendering": identity["implementation"], "figures": original_figures,
    }
    atomic_json(directory / SPEC, specification, immutable=True)
    files = [inputs, describe_file(directory, directory / SPEC),
             describe_file(directory, directory / CONTEXT_REGISTER)]
    selections = []
    for figure in original_figures:
        drawings = scientific_figures.panel_drawings(figure, identity["implementation"]["width_points"])
        if len(drawings) != 1:
            raise ValueError("Each original Conservation geographic frame needs one shared drawing")
        name = "figures/" + figure["id"] + ".svg"
        _immutable_bytes(directory / name, renderSVG.drawToString(drawings[0]))
        files.append(describe_file(directory, directory / name))
        selections.append({"id": figure["id"], "path": name})
    inventory = {
        "schema": MAP_SCHEMA, "identity": identity, "figure_spec": SPEC,
        "figures": selections, "files": files, "context_register": register,
        "summary": {
            "figures": len(selections), "selected_units": len(plan["selected_ids"]),
            "candidate_units": len(captured["geometry"]["candidate_reporting_footprints"]["features"]),
            "crs": captured["analysis_crs_label"], "selected_original_union_ha":
                captured["area_checks"]["selected_original_union"]["saved_ha"],
            "selected_reporting_union_ha": captured["area_checks"]["selected_reporting_union"]["saved_ha"],
            "context_overlap_ha": {name: captured["area_checks"][name]["saved_ha"]
                                   for name in captured["context_sources"]},
            "saved_planning_vertices_preserved": True, "renderer_reprojects": False,
            "renderer_simplifies": False, "map_labels_are_sample_locations": False,
        },
    }
    atomic_json(inventory_path, inventory, immutable=True)
    return {**inventory, "files": files + [describe_file(directory, inventory_path)]}
