"""Actual Upper Savannah polygons with explicitly simulated native model inputs.

This edition preserves the completed square demonstration. Real geography,
simulated physical fields and native results remain separately identified.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import gzip
import html
import json
import math
import os
import hashlib
import importlib.metadata
import shutil
from pathlib import Path
import tempfile

from .common import (atomic_bytes, atomic_json, describe_file,
                     digest, file_digest, held, identifier, now, read_json, verify_file)
from . import rasters

SCHEMA = "upstate.geographic-headwaters-selection/v1"
VERSION = "1.0.0"
CRS = "EPSG:26917"
RESOLUTION = 30
CLASSIFICATION = "SIMULATED DEMONSTRATION INPUTS"
TOPOLOGY_SHA256 = "2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac"
TOPOLOGY_PATH = "source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json"
UNITS = {"DEM": "m", "NLCD": "class", "PRECIPITATION": "mm/year",
         "R_FACTOR": "MJ*mm/(ha*h*year)", "K_FACTOR": "t*ha*h/(ha*MJ*mm)",
         "RESTORATION_MASK": "mask", "CONTROL_MASK": "mask", "RESTORED_NLCD": "class"}
TABLE_FIELDS = ("lucode", "load_n", "load_p", "load_type_n", "load_type_p",
                "eff_n", "eff_p", "crit_len_n", "crit_len_p",
                "proportion_subsurface_n", "usle_c", "usle_p")
COEFFICIENTS = ((21, 8, .9, .05, .05, .05), (41, 2, .12, .8, .8, .003),
                (81, 10, .7, .35, .35, .025), (82, 22, 1.8, .15, .15, .18))


def copy_verified(source, destination, checksum):
    """Stream an immutable copy, checking the same bytes that are retained."""
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if file_digest(destination) != checksum:
            raise ValueError("Retained source differs: " + str(destination))
        return
    pending = None
    try:
        with source.open("rb") as src, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".original-", delete=False) as out:
            pending = Path(out.name)
            h = hashlib.sha256()
            for block in iter(lambda: src.read(1024*1024), b""):
                h.update(block)
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if h.hexdigest() != checksum:
            raise ValueError("Original source changed during retention")
        os.link(pending, destination)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _text(value, name, maximum=3000):
    if not isinstance(value, str) or not value.strip() or "\0" in value or len(value) > maximum:
        raise ValueError("Supply " + name + " as nonempty text")
    return value.strip()


def _selector(value, name):
    if not isinstance(value, dict):
        raise ValueError("Supply the retained " + name + " vector selection")
    unknown = set(value) - {"source_collection_id", "source_id", "layer", "where", "part"}
    if unknown:
        raise ValueError("Unknown " + name + " selector fields: " + ", ".join(sorted(unknown)))
    result = {"source_collection_id": identifier(value.get("source_collection_id")),
              "source_id": _text(value.get("source_id"), name + ".source_id", 300)}
    for key in ("layer", "part"):
        if value.get(key) is not None:
            result[key] = _text(value[key], name + "." + key, 500)
    if "where" in value:
        where = value["where"]
        if not isinstance(where, dict) or any(
                not isinstance(k, str) or not k or "\0" in k or
                not (v is None or type(v) in (str, bool, int, float)) or
                (type(v) is float and not math.isfinite(v)) for k, v in where.items()):
            raise ValueError("where uses exact original field names and finite typed equality values")
        result["where"] = deepcopy(where)
    return result


def normalize(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("Use " + SCHEMA)
    allowed = {"schema", "title", "question", "reporting_huc12s", "huc_polygons",
               "huc_field", "reporting_boundary", "reporting_boundary_description",
               "utility_focus", "utility_label", "intakes", "seed", "corridor_width_m"}
    if set(value) - allowed:
        raise ValueError("Unknown geographic selection fields: " + ", ".join(sorted(set(value) - allowed)))
    ids = value.get("reporting_huc12s")
    if (not isinstance(ids, list) or not ids or
            any(not isinstance(v, str) or len(v) != 12 or not v.isdigit() for v in ids)
            or len(set(ids)) != len(ids)):
        raise ValueError("Select distinct original twelve-digit reporting HUCs")
    utilities = value.get("utility_focus")
    if not isinstance(utilities, list) or not utilities:
        raise ValueError("Select the actual published utility protection polygon(s)")
    intakes = value.get("intakes", [])
    if not isinstance(intakes, list):
        raise ValueError("intakes must be a list of actual original point selections")
    seed = value.get("seed", 20261013)
    if type(seed) is not int or not 0 <= seed < 2**32:
        raise ValueError("seed must be an unsigned 32-bit integer")
    width = value.get("corridor_width_m", 90)
    if type(width) not in (int, float) or not math.isfinite(width) or width <= 0:
        raise ValueError("corridor_width_m must be a positive finite distance")
    return {"schema": SCHEMA, "title": _text(value.get("title"), "title", 300),
            "question": _text(value.get("question"), "question"),
            "reporting_huc12s": sorted(ids),
            "huc_polygons": _selector(value.get("huc_polygons"), "huc_polygons"),
            "huc_field": _text(value.get("huc_field"), "huc_field", 100),
            "reporting_boundary": _selector(value.get("reporting_boundary"), "reporting_boundary"),
            "reporting_boundary_description": _text(value.get("reporting_boundary_description"),
                                                     "reporting_boundary_description"),
            "utility_focus": [_selector(v, "utility_focus") for v in utilities],
            "intakes": [_selector(v, "intakes") for v in intakes],
            "utility_label": _text(value.get("utility_label"), "utility_label", 300),
            "seed": seed, "corridor_width_m": float(width)}


def catalog(workspace):
    """Original choices only; no automatic interpretation of a STATES attribute."""
    rows = []
    for path in sorted((workspace.root / "sources").glob("*.json")):
        collection = workspace._get("sources", path.stem)
        for entry in collection["entries"]:
            if entry["kind"] == "vector":
                rows.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                             "title": entry["title"], "layer": entry.get("layer"),
                             "uri": entry["uri"], "vintage": entry["vintage"],
                             "source_crs": entry.get("source_crs"), "body": entry["body"],
                             "metadata": entry.get("metadata", {}),
                             "companions": entry["companions"]})
    return {"schema": "upstate.geographic-headwaters-catalog/v1",
            "project_id": workspace.project["id"], "vectors": rows}


def _source(workspace, selector):
    primary, entry = workspace.source_file(selector["source_collection_id"], selector["source_id"])
    bodies = [entry["body"], *entry["companions"]]
    selected = entry["body"]
    if selector.get("part"):
        candidates = [body for body in bodies
                      if body.get("view_path", body["filename"]) == selector["part"]]
        if len(candidates) != 1:
            raise ValueError("part must select one retained original view_path")
        selected = candidates[0]
    # source_file verifies original bytes and rebuilds ALL sibling sidecars.
    view = primary
    for _ in Path(entry["body"].get("view_path", entry["body"]["filename"])).parts:
        view = view.parent
    path = view / selected.get("view_path", selected["filename"])
    if file_digest(path) != selected["sha256"] or path.stat().st_size != selected["bytes"]:
        raise ValueError("Materialized original member differs")
    return path, entry, selected


def _rows(workspace, selector):
    from .receiving_waters import _source as original_vector_source
    path, entry, selected = _source(workspace, selector)
    if entry["kind"] != "vector":
        raise ValueError("Geographic choices must retain original vector sources")
    # Reuse the maintained original Esri ring reader through Receiving Waters.
    # The proxy selects a verified original companion while preserving sidecars.
    member_entry = deepcopy(entry)
    member_entry["body"] = selected
    if selector.get("part"):
        for key in ("decoded_sha256","decoded_bytes","source_crs","layer","format","source_format"):
            member_entry.pop(key,None)
    class SelectedMember:
        def source_file(self, collection_id, source_id):
            if (collection_id != selector["source_collection_id"] or source_id != selector["source_id"]):
                raise ValueError("Unexpected original source selection")
            return path, member_entry
    reader_selector = {key:value for key,value in selector.items() if key != "part"}
    rows, reader_binding = original_vector_source(SelectedMember(),reader_selector,CRS)
    if selector.get("where") and any(
            any(key not in row["properties"] for key in selector["where"]) for row in rows):
        raise ValueError("Selection contains an unknown original property")
    if selector.get("where"):
        rows = [row for row in rows if all(type(row["properties"].get(key)) is type(expected)
                and row["properties"][key] == expected for key,expected in selector["where"].items())]
        if not rows:
            raise ValueError("No original feature matches the exact typed selection")
    binding = {"selection":selector,"uri":entry["uri"],"vintage":entry["vintage"],
               "body":selected,"source_crs":entry.get("source_crs"),
               "feature_ids":[row["id"] for row in rows],
               "selected_features":[{"id":row["id"],"properties":row["properties"],
                                      **({"source_feature":row["source_feature"]}
                                         if "source_feature" in row else {})} for row in rows],
               "reader":reader_binding}
    return rows,binding


def _topology():
    path = Path(__file__).resolve().parents[1] / TOPOLOGY_PATH
    if file_digest(path) != TOPOLOGY_SHA256:
        raise ValueError("Retain the original 303-record WBD topology edition: " + TOPOLOGY_PATH)
    data = read_json(path)
    nodes = {}
    for feature in data["features"]:
        row = feature["attributes"]
        key = row["huc12"]
        if key in nodes:
            raise ValueError("Duplicate original topology HUC")
        nodes[key] = row
    return path, nodes


def geography(workspace, value):
    from shapely.ops import unary_union
    spec = normalize(value)
    topology_path, nodes = _topology()
    selected = set(spec["reporting_huc12s"])
    if not selected <= set(nodes):
        raise ValueError("A selected reporting HUC is absent from the retained original topology")
    domain_ids = set(selected)
    while True:
        upstream = {key for key, row in nodes.items() if row["tohuc"] in domain_ids}
        expanded = domain_ids | upstream
        if expanded == domain_ids:
            break
        domain_ids = expanded
    rows, huc_binding = _rows(workspace, spec["huc_polygons"])
    indexed = {}
    for row in rows:
        key = row["properties"].get(spec["huc_field"])
        if not isinstance(key, str):
            raise ValueError("Original HUC field must preserve its twelve-digit string")
        if key in indexed:
            raise ValueError("Duplicate selected original HUC polygon " + key)
        indexed[key] = row
    missing = domain_ids - set(indexed)
    if missing:
        raise ValueError("Original polygon source lacks upstream HUCs: " + ", ".join(sorted(missing)))
    domain = rasters.polygon_union([indexed[key] for key in sorted(domain_ids)])
    reporting_whole = rasters.polygon_union([indexed[key] for key in sorted(selected)])
    boundary_rows, boundary_binding = _rows(workspace, spec["reporting_boundary"])
    boundary = rasters.polygon_union(boundary_rows)
    reporting = reporting_whole.intersection(boundary)
    if reporting.is_empty or not reporting.is_valid or reporting.area <= 0:
        raise ValueError("Selected HUCs have no valid area in the actual reporting boundary")
    if not domain.buffer(1e-5).covers(reporting):
        raise ValueError("Actual upstream domain does not contain the reporting intersection")
    utility_rows, utility_bindings = [], []
    for choice in spec["utility_focus"]:
        current, binding = _rows(workspace, choice)
        utility_rows.extend(current)
        utility_bindings.append(binding)
    utility = rasters.polygon_union(utility_rows)
    focus = utility.intersection(reporting)
    if focus.is_empty or focus.area <= 0:
        raise ValueError("The selected utility footprint has no reporting-area intersection; choose an applicable actual source")
    intake_rows, intake_bindings = [], []
    for choice in spec["intakes"]:
        current, binding = _rows(workspace, choice)
        if any(row["geometry"].geom_type not in ("Point", "MultiPoint") for row in current):
            raise ValueError("Original intake selections must retain point geometries")
        intake_rows.extend(current)
        intake_bindings.append(binding)
    xmin, ymin, xmax, ymax = domain.bounds
    left, top = math.floor(xmin / RESOLUTION) * RESOLUTION, math.ceil(ymax / RESOLUTION) * RESOLUTION
    width = math.ceil((xmax - left) / RESOLUTION)
    height = math.ceil((top - ymin) / RESOLUTION)
    grid = {"crs": CRS, "width": width, "height": height, "resolution_m": RESOLUTION,
            "transform": [RESOLUTION, 0, left, 0, -RESOLUTION, top],
            "bounds": [left, top - height * RESOLUTION, left + width * RESOLUTION, top],
            "pixel_area_ha": .09}
    binding = {"huc_source": huc_binding, "reporting_boundary": boundary_binding,
               "utility_sources": utility_bindings, "intake_sources": intake_bindings,
               "intake_footprint_relations": [{"intake_id":point["id"], "footprint_id":footprint["id"],
                   "intake_properties":point["properties"], "footprint_properties":footprint["properties"],
                   "inside_or_on_boundary":bool(footprint["geometry"].covers(point["geometry"])),
                   "distance_m":float(footprint["geometry"].distance(point["geometry"]))}
                   for point in intake_rows for footprint in utility_rows],
               "topology": {"sha256": TOPOLOGY_SHA256, "source": TOPOLOGY_PATH,
                            "records": len(nodes), "id_field": "huc12", "downstream_field": "tohuc"},
               "reporting_huc12s": sorted(selected), "model_domain_huc12s": sorted(domain_ids),
               "upstream_huc12s": sorted(domain_ids - selected),
               "selected_topology_rows": [nodes[key] for key in sorted(domain_ids)],
               "method": "Reverse ToHUC closure in retained original topology; complete original HUC polygons, union and explicit reporting-boundary intersection.",
               "hydrology_scope": "Original WBD membership defines spatial context; routing over simulated terrain is an illustrative physical assumption.",
               "areas_ha": {"model_domain": domain.area / 10000,
                            "reporting_whole_hucs": reporting_whole.area / 10000,
                            "reporting_area": reporting.area / 10000,
                            "utility_full_union": utility.area / 10000,
                            "utility_reporting_intersection": focus.area / 10000},
               "grid": grid}
    return {"selection": spec, "binding": binding, "grid": grid, "domain": domain,
            "reporting": reporting, "utility": utility, "focus": focus,
            "utility_rows": utility_rows, "intake_rows": intake_rows,
            "reporting_parts": [{"huc12":key,"geometry":indexed[key]["geometry"].intersection(boundary)}
                                for key in sorted(selected)],
            "topology_path": topology_path}


def preview(workspace, value):
    geo = geography(workspace, value)
    grid = geo["grid"]
    return {"schema": "upstate.geographic-headwaters-preview/v1", "selection": geo["selection"],
            "project_id": workspace.project["id"], "geography": geo["binding"],
            "rectangular_grid_cells": grid["width"] * grid["height"],
            "physical_generation": {"method":"256x256 raster windows",
                                    "numeric_working_set_independent_of_total_cells": True},
            "classification": CLASSIFICATION,
            "geography_classification": "Original public source polygons; explicitly derived union/intersection",
            "physical_inputs_classification": "Deterministic simulated terrain, land cover, rainfall, erosion factors and coefficients",
            "native_execution": "Prepared separately by explicit --run; preview performs no native solve"}


def _retain_originals(workspace, destination, selectors):
    entries, seen = [], set()
    for selector in selectors:
        key = (selector["source_collection_id"], selector["source_id"])
        if key in seen:
            continue
        seen.add(key)
        _, entry, _ = _source(workspace, selector)
        retained = deepcopy(entry)
        bodies = [retained.pop("body"), *retained.pop("companions")]
        base = Path("originals") / key[0] / digest(key[1])
        locations = []
        for body in bodies:
            name = body.get("view_path", body["filename"])
            original = verify_file(workspace.root, {**body, "path": body["object"]})
            relative = (base / name).as_posix()
            copy_verified(original, destination / relative, body["sha256"])
            locations.append({"path": relative, "sha256": body["sha256"]})
        retained.update(id="original-" + digest(key), path=locations[0]["path"],
                        sha256=locations[0]["sha256"], companions=locations[1:],
                        original_binding={"source_collection_id": key[0], "source_id": key[1]})
        entries.append(retained)
        collection_path = destination / "originals" / key[0] / "source-collection.json"
        original_collection = workspace._get("sources", key[0])
        atomic_json(collection_path, original_collection, immutable=True)
        original_manifest = original_collection["original_manifest"]
        original_path = verify_file(workspace.root, {**original_manifest, "path": original_manifest["object"]})
        copy_verified(original_path, collection_path.with_name("source-manifest-original.json"),
                      original_manifest["sha256"])
    return entries


def _physical_inputs(geo, destination):
    import numpy as np
    import rasterio
    from contextlib import ExitStack
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine
    from rasterio.windows import transform as window_transform
    from shapely.geometry import LineString
    grid, spec = geo["grid"], geo["selection"]
    transform = Affine(*grid["transform"])
    left, bottom, right, top = grid["bounds"]
    point = geo["reporting"].representative_point()
    phase = (spec["seed"]%997)/997*2*math.pi
    base_column = int(round((point.x-left)/RESOLUTION-.5))
    from shapely.ops import unary_union
    corridor_features = []
    for part in geo["reporting_parts"]:
        geometry = part["geometry"]
        if geometry.is_empty or geometry.area <= 0:
            continue
        focus_point = geometry.representative_point()
        nearest_column = int(round((focus_point.x-left)/RESOLUTION-.5))
        centre_at_focus = base_column+round(12*math.sin(
            2*math.pi*(focus_point.y-bottom)/24000+phase))
        cycle = int(round((nearest_column-centre_at_focus)/60))
        first = max(0,int(math.floor((top-geometry.bounds[3])/RESOLUTION))-1)
        last = min(grid["height"]-1,int(math.ceil((top-geometry.bounds[1])/RESOLUTION))+1)
        points = []
        for row in range(first,last+1):
            northing = top-(row+.5)*RESOLUTION
            distance_from_south = northing-bottom
            valley_column = base_column+round(12*math.sin(
                2*math.pi*distance_from_south/24000+phase))+cycle*60
            points.append((left+(valley_column+.5)*RESOLUTION,northing))
        if len(points) < 2:
            raise ValueError("Selected reporting catchment is too small for the declared corridor")
        line = LineString(points)
        polygon = line.buffer(spec["corridor_width_m"]).intersection(geometry)
        corridor_features.append({"huc12":part["huc12"],"valley_cycle":cycle,
                                  "line":line,"geometry":polygon})
    corridor = unary_union([item["geometry"] for item in corridor_features])
    roles = ("DEM","NLCD","PRECIPITATION","R_FACTOR","K_FACTOR",
             "RESTORATION_MASK","CORRIDOR_MASK","REPORTING_MASK","RESTORED_NLCD")
    profile = {"driver":"GTiff","width":grid["width"],"height":grid["height"],
               "count":1,"crs":CRS,"transform":transform,"nodata":-9999,
               "compress":"deflate","tiled":True,"blockxsize":256,"blockysize":256}
    summary = {"domain_cells":0,"reporting_cells":0,"changed_cells":0,
               "restoration_original_class_counts":{"81":0,"82":0},
               "baseline_class_counts":{str(c):0 for c in (21,41,81,82)},
               "per_huc": {part["huc12"]:{"reporting_cells":0,"corridor_cells":0,
                    "changed_cells":0,"original_class_counts":{"81":0,"82":0}}
                    for part in geo["reporting_parts"]},
               "ranges":{},"selection":"30m pixel centre; vector-union hectares retained separately",
               "terrain_assumptions":{"longitudinal_grade":.002,"base_elevation_m":180,
                   "valley_spacing_m":1800,"lateral_decay_m":600,"nominal_relief_m":80,
                   "relief_variation_fraction":.2,"relief_wavelength_m":12000,
                   "valley_meander_amplitude_cells":12,"valley_meander_wavelength_m":24000,
                   "base_column":base_column,"phase_radians":phase,
                   "corridor_buffer_distance_m":spec["corridor_width_m"],
                   "corridor_huc12s":[item["huc12"] for item in corridor_features],
                   "classification":"SIMULATED; declared metre-scale terrain, not measured regional elevation"}}
    original_shapes = {id(geometry):geometry.__geo_interface__ for geometry in
                       (geo["domain"],geo["reporting"],corridor,
                        *(part["geometry"] for part in geo["reporting_parts"] if not part["geometry"].is_empty))}
    def inside(geometry, shape, trans):
        return geometry_mask([original_shapes[id(geometry)]], shape, trans, invert=True,
                             all_touched=False)
    with ExitStack() as stack:
        outputs = {}
        for role in roles:
            categorical = role in ("NLCD","RESTORED_NLCD") or role.endswith("_MASK")
            outputs[role] = stack.enter_context(rasterio.open(
                destination/(role.lower()+".tif"),"w",dtype="int16" if categorical else "float64",**profile))
            outputs[role].update_tags(classification="SIMULATED" if not role.endswith("_MASK") else
                ("DERIVED_ORIGINAL_GEOGRAPHY" if role=="REPORTING_MASK" else "SIMULATED"),
                role=role,units=UNITS.get(role,"mask"))
        for _, window in outputs["DEM"].block_windows(1):
            shape = (int(window.height),int(window.width))
            trans = window_transform(window,transform)
            domain = inside(geo["domain"],shape,trans)
            reporting = inside(geo["reporting"],shape,trans) & domain
            corr = inside(corridor,shape,trans) & reporting
            x = (np.arange(int(window.col_off),int(window.col_off+window.width),dtype="float64")[None,:]+.5)/grid["width"]
            y = (np.arange(int(window.row_off),int(window.row_off+window.height),dtype="float64")[:,None]+.5)/grid["height"]
            east_m = x*(right-left)
            north_m = (1-y)*(top-bottom)
            score = .5+.22*np.sin(2*math.pi*east_m/3600+phase)*np.cos(2*math.pi*north_m/2700)+.20*np.sin(2*math.pi*(east_m+north_m)/6000)
            cover = np.where(score<.28,21,np.where(score<.55,41,np.where(score<.70,81,82))).astype("int16")
            columns = np.arange(int(window.col_off),int(window.col_off+window.width),dtype="float64")[None,:]
            valley_columns = base_column+np.rint(12*np.sin(2*math.pi*north_m/24000+phase))
            distance = RESOLUTION*np.abs(((columns-valley_columns+30)%60)-30)
            relief = 80*(1+.2*np.sin(2*math.pi*north_m/12000+phase))
            values = {
                "DEM":np.broadcast_to(180+.002*north_m+relief*(-np.expm1(-distance/600)),shape),
                "NLCD":cover,
                "PRECIPITATION":np.broadcast_to(1400+120*(1-y)+60*np.sin(4*x),shape),
                "R_FACTOR":np.broadcast_to(4300+350*(1-y)+140*np.cos(6*x),shape),
                "K_FACTOR":np.broadcast_to(.028+.006*x+.002*np.sin(9*y),shape),
                "RESTORATION_MASK":(corr & np.isin(cover,[81,82])).astype("int16"),
                "RESTORED_NLCD":np.where(corr & np.isin(cover,[81,82]),41,cover).astype("int16"),
                "CORRIDOR_MASK":corr.astype("int16"),
                "REPORTING_MASK":reporting.astype("int16")}
            summary["domain_cells"] += int(domain.sum())
            summary["reporting_cells"] += int(reporting.sum())
            restoration = values["RESTORATION_MASK"] == 1
            summary["changed_cells"] += int(restoration.sum())
            for part in geo["reporting_parts"]:
                if part["geometry"].is_empty:
                    continue
                selected_huc = inside(part["geometry"],shape,trans) & reporting
                distribution = summary["per_huc"][part["huc12"]]
                distribution["reporting_cells"] += int(selected_huc.sum())
                distribution["corridor_cells"] += int((selected_huc & corr).sum())
                distribution["changed_cells"] += int((selected_huc & restoration).sum())
                for code in (81,82):
                    distribution["original_class_counts"][str(code)] += int((selected_huc & restoration & (cover==code)).sum())
            for code in (21,41,81,82):
                summary["baseline_class_counts"][str(code)] += int((domain & (cover==code)).sum())
            for code in (81,82):
                summary["restoration_original_class_counts"][str(code)] += int((restoration & (cover==code)).sum())
            for role, array in values.items():
                if role in ("DEM","PRECIPITATION","R_FACTOR","K_FACTOR") and domain.any():
                    low,high = float(array[domain].min()),float(array[domain].max())
                    previous = summary["ranges"].get(role,{"minimum":low,"maximum":high,"units":UNITS[role]})
                    previous.update(minimum=min(previous["minimum"],low),maximum=max(previous["maximum"],high))
                    summary["ranges"][role] = previous
                outputs[role].write(np.where(domain,array,-9999).astype(outputs[role].dtypes[0]),1,window=window)
    if not summary["domain_cells"] or not summary["reporting_cells"] or not summary["changed_cells"]:
        raise ValueError("Selected 30m reporting/corridor assumptions yield no treatment cells; revise the explicit selection/seed")
    for distribution in summary["per_huc"].values():
        distribution.update(reporting_hectares=distribution["reporting_cells"]*.09,
                            changed_hectares=distribution["changed_cells"]*.09)
    summary.update(domain_raster_ha=summary["domain_cells"]*.09,
                   reporting_raster_ha=summary["reporting_cells"]*.09,
                   changed_hectares=summary["changed_cells"]*.09)
    # Compose the complete original WAT adapter and matcher, preserving whole
    # baseline input support while matching actual restoration inside reporting.
    from source_tools.geographic_matched_control import prepare_control
    wrapped = prepare_control(
        destination/"nlcd.tif",destination/"restored_nlcd.tif",
        destination/"corridor_mask.tif",destination/"reporting_mask.tif",
        destination/"precipitation.tif",destination.parent/"control-work",seed=spec["seed"])
    original = wrapped["preparation"]
    control = original["summary"]
    counts = {str(key):int(value) for key,value in wrapped["class_counts"].items()}
    if wrapped["changed_cells"] != summary["changed_cells"] or counts != summary["restoration_original_class_counts"]:
        raise ValueError("Actual control must preserve restoration class counts and pixel area")
    if wrapped["overlap_with_restoration_corridor_cells"] != 0 or not math.isclose(
            wrapped["changed_hectares"],summary["changed_hectares"],abs_tol=1e-7):
        raise ValueError("Actual control must preserve disjoint siting and exact area")
    root = Path(original["directory"])
    for item in original["files"]:
        source_path = verify_file(root,item)
        copy_verified(source_path,destination/"matched-control"/item["path"],item["sha256"])
    copy_verified(root/"control-prepared.json",destination/"matched-control"/"control-prepared.json",
                  file_digest(root/"control-prepared.json"))
    copy_verified(Path(wrapped["mask_path"]),destination/"control_mask.tif",wrapped["mask"]["sha256"])
    atomic_json(destination/"matched-control"/"adapter-result.json",wrapped)
    summary.update(control=control,control_original_class_counts=counts,
                   control_changed_cells=wrapped["changed_cells"],
                   control_receipt="matched-control/control-prepared.json",
                   control_meaning="Equal agricultural class counts/area and disjoint off-corridor siting within reporting support; whole-domain precipitation normalization and actual local matching residuals remain explicit.")
    return summary, corridor_features, corridor


def _write_inputs(workspace, geo, destination, identity):
    import rasterio
    from rasterio.transform import Affine
    from shapely.geometry import mapping
    spec, grid = geo["selection"], geo["grid"]
    entries = _retain_originals(workspace, destination,
                               [spec["huc_polygons"], spec["reporting_boundary"], *spec["utility_focus"], *spec["intakes"]])
    def source(role, path, kind, classification, **metadata):
        entries.append({"id": "GEOGRAPHIC_" + role.upper(), "title": role.replace("_", " "),
                        "kind": kind, "path": path.relative_to(destination).as_posix(),
                        "uri": "upstate.geographic-headwaters:" + identity["id"] + "/" + path.name,
                        "vintage": "2026-10-13 geographic demonstration edition",
                        "sha256": file_digest(path), "classification": classification, **metadata})
    for role, geometry in (("model_domain", geo["domain"]), ("reporting_area", geo["reporting"]),
                           ("utility_full", geo["utility"]), ("utility_focus", geo["focus"])):
        path = destination / (role + ".gpkg")
        from pyproj import CRS as ProjectedCRS
        rasters.write_geometry(path, geometry, ProjectedCRS.from_user_input(CRS),
                               layer=role, title=spec["title"] + ": " + role)
        source(role, path, "vector", "derived-original-geography", source_crs=CRS, layer=role,
               derivation="Exact selected union/intersection of retained originals; no simplification")
    # Keep separate original footprints and intake points alongside the union masks.
    # The original feature properties remain verbatim JSON; no point is snapped.
    import fiona
    from pyproj import CRS as ProjectedCRS
    for role, rows in (("utility_features",geo["utility_rows"]),("intake_features",geo["intake_rows"])):
        if not rows:
            continue
        path = destination/(role+".gpkg")
        schema = {"geometry":"Unknown","properties":{"native_id":"str","properties_json":"str"}}
        with fiona.open(path,"w",driver="GPKG",layer=role,schema=schema,
                        crs_wkt=ProjectedCRS.from_user_input(CRS).to_wkt()) as writer:
            for row in rows:
                writer.write({"geometry":mapping(row["geometry"]),
                              "properties":{"native_id":str(row["id"]),
                              "properties_json":json.dumps(row["properties"],sort_keys=True,allow_nan=False)}})
        source(role,path,"vector","derived-original-geography",source_crs=CRS,layer=role,
               derivation="Individual original features transformed to the declared metre CRS; properties and source reader operations retained in geographic-binding.json")
    summary, corridor_features, corridor = _physical_inputs(geo, destination)
    control_receipt = read_json(destination/"matched-control"/"control-prepared.json")
    if control_receipt["binding"]["retained_implementation"] != identity["control_source_closure"]:
        raise ValueError("Matched-control implementation changed during geographic preparation")
    for role in (*UNITS, "CORRIDOR_MASK", "REPORTING_MASK"):
        path = destination / (role.lower() + ".tif")
        categorical = role in ("NLCD", "RESTORED_NLCD") or role.endswith("_MASK")
        source(role, path, "raster",
               "derived-original-geography" if role == "REPORTING_MASK" else "simulated",
               units=UNITS.get(role, "mask"), resampling="nearest" if categorical else "bilinear")
    atomic_json(destination / "assumed-corridor.geojson", {
        "type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": CRS}},
        "features": [{"type": "Feature", "properties": {"classification": "SIMULATED",
                     "meaning": "Hypothetical planting corridor on the declared simulated valley; native stream is calculated independently",
                     "huc12":item["huc12"],"valley_cycle":item["valley_cycle"],
                     "buffer_distance_m": spec["corridor_width_m"],
                     "nominal_full_width_m": 2*spec["corridor_width_m"]}, "geometry": mapping(item["geometry"])}
                     for item in corridor_features]})
    source("assumed_corridor", destination / "assumed-corridor.geojson", "vector", "simulated", source_crs=CRS)
    table = destination / "biophysical.csv"
    with table.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=TABLE_FIELDS)
        writer.writeheader()
        for code, n, p, en, ep, cover in COEFFICIENTS:
            writer.writerow({"lucode":code, "load_n":n, "load_p":p,
                "load_type_n":"measured-runoff", "load_type_p":"measured-runoff",
                "eff_n":en, "eff_p":ep, "crit_len_n":100, "crit_len_p":100,
                "proportion_subsurface_n":0, "usle_c":cover, "usle_p":1})
    source("biophysical", table, "table", "simulated")
    copy_verified(geo["topology_path"], destination / "original-topology.json", TOPOLOGY_SHA256)
    source("original_topology", destination / "original-topology.json", "document", "original-public-source",
           source_uri="https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer",
           note="Exact retained original 303-record WBD response")
    atomic_json(destination / "geographic-selection.json", spec)
    atomic_json(destination / "geographic-binding.json", geo["binding"])
    assumptions = {
        "schema":"upstate.geographic-headwaters-assumptions/v1", "version":VERSION,
        "classification": CLASSIFICATION, "question": spec["question"],
        "geography":"Actual retained WBD HUC polygons and topology; explicit original SC reporting-boundary intersection; actual published utility protection polygons.",
        "physical_fields":"DEM, rainfall proxy, erosivity, erodibility, land cover, source coefficients and hypothetical planting corridor are deterministic simulated assumptions.",
        "terrain":"Declared simulated metre-scale periodic valleys: 1800m spacing,600m lateral decay,80m varying relief and0.002 southward longitudinal grade. Actual catchment membership defines context; simulated drainage has not been calibrated to actual hydrography.",
        "terrain_parameters":summary["terrain_assumptions"],
        "land_cover_pattern":"Deterministic simulated kilometre-scale mosaic; sine wavelengths3600m/2700m/6000m and original declared seed.",
        "loads":"Assumed runoff-export coefficients kg/ha/year. Native measured-runoff enum specifies coefficient semantics; the values are not measured. NDR scales once by the common precipitation proxy/mean.",
        "parameters":"NDR k2/150m subsurface length/.5 efficiency; SDR k2/.8 maximum/.5 IC0/122 dimensionless Lmax; both threshold100 cells=9ha at30m and MFD.",
        "outputs":"Native annual nitrogen/phosphorus export reaching streams in kg/year and sediment in metric tonnes/year. No concentration, travel-time or intake-delivery conversion.",
        "scope":"Whole upstream model domain, selected SC reporting area and utility/reporting intersection remain different geometries.",
        "control":summary["control_meaning"], "input_summary":summary,
        "references":["https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html",
                      "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"]}
    atomic_json(destination / "assumptions.json", assumptions)
    copy_verified(Path(__file__), destination / "geographic_headwaters.py", file_digest(Path(__file__)))
    control_implementation = Path(__file__).resolve().parents[1]/"source_tools/regional_matched_control.py"
    copy_verified(control_implementation, destination/"regional_matched_control.py",
                  identity["control_implementation_sha256"])
    copy_verified(Path(__file__).resolve().parents[1]/"source_tools/geographic_matched_control.py",
                  destination/"geographic_matched_control.py",identity["control_adapter_sha256"])
    for name in ("geographic-selection.json","geographic-binding.json","assumptions.json","geographic_headwaters.py","regional_matched_control.py","geographic_matched_control.py"):
        source(name, destination/name, "document", "method-and-provenance")
    # Every original collection record is a retained companion of the selection.
    selection_entry = next(e for e in entries if e["id"] == "GEOGRAPHIC_GEOGRAPHIC-SELECTION.JSON")
    selection_entry["companions"] = [{"path":p.relative_to(destination).as_posix(),"sha256":file_digest(p)}
                                     for p in sorted((destination/"originals").glob("*/source-*.json"))]
    represented = {entry["path"] for entry in entries}
    represented.update(item["path"] for entry in entries for item in entry.get("companions",[]))
    # Retain additional actual control receipts in the same portable source edition.
    selection_entry["companions"].extend(
        {"path":p.relative_to(destination).as_posix(),"sha256":file_digest(p)}
        for p in sorted(destination.rglob("*"))
        if p.is_file() and p.relative_to(destination).as_posix() not in represented)
    atomic_json(destination / "sources.json", {"schema":"upstate.sources/v1","title":spec["title"],
                "classification":CLASSIFICATION, "geography_classification":"original public source geography",
                "entries":entries, "notes":[assumptions["physical_fields"], assumptions["scope"]]})
    receipt = {"identity":identity,"input_summary":summary,"geography":geo["binding"],
               "files":[describe_file(destination,p) for p in sorted(destination.rglob("*")) if p.is_file()]}
    atomic_json(destination / "input-receipt.json",receipt)
    return receipt


def prepare(workspace, value):
    geo = geography(workspace, value)
    from source_tools.geographic_matched_control import _implementation_snapshot
    control_sources = _implementation_snapshot()
    control_source_identity = {name:{"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()}
                               for name,body in control_sources.items()}
    identity = {"schema":"upstate.geographic-headwaters/v1","version":VERSION,
                "control_source_closure":control_source_identity,
                "project_id":workspace.project["id"],"selection":geo["selection"],
                "geographic_binding":geo["binding"],"implementation_sha256":file_digest(Path(__file__)),
                "control_implementation_sha256":file_digest(Path(__file__).resolve().parents[1]/
                    "source_tools/regional_matched_control.py"),
                "control_adapter_sha256":file_digest(Path(__file__).resolve().parents[1]/
                    "source_tools/geographic_matched_control.py"),
                "geographic_runtime":{name:importlib.metadata.version(name)
                    for name in ("numpy","rasterio","fiona","shapely","pyproj")}}
    identity["id"] = digest(identity)
    directory = workspace.root / "geographic-headwaters" / identity["id"]
    with held(directory / ".prepare.lock", blocking=False):
        inputs = directory / "inputs"
        # Existing portable backup uses this lock; no partial source capture enters it.
        with held(workspace.root / ".workspace.lock", blocking=False):
            if inputs.exists():
                original = read_json(inputs / "input-receipt.json")
                if original["identity"] != identity:
                    raise ValueError("Retained geographic edition identity differs")
                for item in original["files"]:
                    verify_file(inputs, item)
            else:
                with tempfile.TemporaryDirectory(prefix=".geographic-inputs-", dir=directory) as temporary:
                    pending = Path(temporary)
                    original = _write_inputs(workspace, geo, pending, identity)
                    os.rename(pending, inputs)
            imported = workspace.import_sources(inputs / "sources.json")
            collection = imported["id"]
            profile = workspace.save_profile({"title":geo["selection"]["title"]+": simulated NDR/SDR assumptions",
                "models":["ndr","sdr"], "source_collection_id":collection,
                "biophysical_source_id":"GEOGRAPHIC_BIOPHYSICAL",
                "references":["geographic-edition:"+identity["id"],"InVEST 3.20.0 original NDR/SDR"],
                "ndr":{"threshold_flow_accumulation":100,"k_param":2,"flow_dir_algorithm":"mfd",
                       "subsurface_critical_length_n":150,"subsurface_eff_n":.5},
                "sdr":{"threshold_flow_accumulation":100,"k_param":2,"flow_dir_algorithm":"mfd",
                       "sdr_max":.8,"ic_0_param":.5,"l_max":122}})
            scenarios = []
            for label, mask in (("baseline",None),("restoration","RESTORATION_MASK"),("matched control","CONTROL_MASK")):
                reason = ("Retained simulated present land cover" if mask is None else
                          "Convert assumed pasture81/crop82 to forest41; "+original["input_summary"]["control_meaning"])
                scenarios.append(workspace.save_scenario({"title":geo["selection"]["title"]+": "+label,
                    "kind":"baseline" if mask is None else "landcover","source_collection_id":collection,
                    "reason":reason,"patches":[] if mask is None else [{
                        "mask_source_id":"GEOGRAPHIC_"+mask,"from_codes":[81,82],"to_code":41,"reason":reason}]}))
        grid = workspace.prepare_grid({"title":geo["selection"]["title"]+": actual geography / simulated30m inputs",
            "models":["ndr","sdr"],"source_collection_id":collection,
            "input_sources":{role:"GEOGRAPHIC_"+role for role in ("DEM","NLCD","PRECIPITATION","R_FACTOR","K_FACTOR")},
            "reporting_area":{"source_id":"GEOGRAPHIC_REPORTING_AREA","layer":"reporting_area"},
            "model_domain":{"source_id":"GEOGRAPHIC_MODEL_DOMAIN","layer":"model_domain"},
            "upstream_buffer_m":0,"resolution_m":30,
            "domain_reason":geo["binding"]["method"]+" "+geo["binding"]["hydrology_scope"]})
        runs = [workspace.prepare_run({"models":["ndr","sdr"],"grid_id":grid["id"],
                "profile_id":profile["id"],"scenario_id":scenario["id"]}) for scenario in scenarios]
        from .scenario_footprint import preview_run
        footprints = []
        for index, run in enumerate(runs):
            footprint = preview_run(workspace, run["id"])
            expected = 0 if index == 0 else original["input_summary"]["changed_cells"]
            if footprint["summary"]["net_changed_cells"] != expected or not math.isclose(
                    footprint["summary"]["net_changed_hectares"], expected*.09, abs_tol=1e-7):
                raise ValueError("Prepared native scenario differs from the retained geographic recipe")
            footprints.append(footprint["id"])
        from source_tools.headwaters_parameter_course import prepare as prepare_course
        course = prepare_course(workspace, {"grid_id":grid["id"],"base_profile_id":profile["id"],
                    "baseline_scenario_id":scenarios[0]["id"],
                    "alternative_scenario_ids":[v["id"] for v in scenarios[1:]]})
        result = {"schema":"upstate.geographic-headwaters-prepared/v1","id":identity["id"],
                  "project_id":workspace.project["id"],"selection":geo["selection"],
                  "source_collection_id":collection,"grid_id":grid["id"],"profile_id":profile["id"],
                  "baseline_scenario_id":scenarios[0]["id"],"alternative_scenario_ids":[v["id"] for v in scenarios[1:]],
                  "baseline_run_id":runs[0]["id"],"alternative_run_ids":[v["id"] for v in runs[1:]],
                  "scenario_footprint_ids":footprints,"ensemble_id":course["ensemble_id"],
                  "input_summary":original["input_summary"],"geography":geo["binding"],
                  "state":"prepared","classification":CLASSIFICATION,
                  "directory":directory.relative_to(workspace.root).as_posix()}
        with held(workspace.root / ".workspace.lock", blocking=False):
            atomic_json(directory / "prepared.json", result, immutable=True)
        return result
