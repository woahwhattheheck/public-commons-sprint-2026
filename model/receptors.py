"""Contributing-area maps and quantitative source-water scenario inventories."""
from __future__ import annotations
import csv
from contextlib import ExitStack
from html import escape
from urllib.parse import urlsplit
import json
import math
from pathlib import Path
from .common import atomic_json, describe_file, digest, read_json, verify_file
from .receptor_network import upstream_memberships
from . import rasters, receptor_execution


def _csv(path, columns, rows):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            # Derived spreadsheet cells keep source strings available in JSON.
            safe = {key: ("'" + value if isinstance(value, str) and value.lstrip().startswith(
                ("=", "+", "-", "@")) else value) for key, value in row.items()}
            writer.writerow(safe)


def _polygon(geometry):
    from shapely.geometry import MultiPolygon
    if geometry.is_empty:
        return None
    if geometry.geom_type == "Polygon":
        return MultiPolygon([geometry])
    if geometry.geom_type == "MultiPolygon":
        return geometry
    pieces = []
    for child in getattr(geometry, "geoms", ()):
        selected = _polygon(child)
        if selected is not None:
            pieces.extend(selected.geoms)
    return MultiPolygon(pieces) if pieces else None


def _summarize_pair(baseline, alternative, geometry):
    """Aggregate both complete footprints and their same-pixel comparison."""
    import numpy as np
    from rasterio.features import geometry_mask, geometry_window
    from rasterio.errors import WindowError
    from rasterio.windows import Window
    rasters.check_same_grid(baseline, alternative)
    result = {"selected_cells": 0, "baseline_valid_cells": 0,
              "alternative_valid_cells": 0, "common_valid_cells": 0,
              "baseline_export": None, "alternative_export": None,
              "common_baseline_export": None, "common_alternative_export": None,
              "alternative_minus_baseline": None, "change_percent": None,
              "baseline_only_cells": 0, "alternative_only_cells": 0}
    if geometry is None or geometry.is_empty:
        return result
    try:
        extent = geometry_window(baseline, [geometry.__geo_interface__])
    except WindowError:
        return result
    bh, bw = baseline.block_shapes[0]
    totals = {key: 0.0 for key in ("baseline", "alternative", "common_baseline", "common_alternative")}
    for row in range(int(extent.row_off) // bh * bh, math.ceil(extent.row_off + extent.height), bh):
        for col in range(int(extent.col_off) // bw * bw, math.ceil(extent.col_off + extent.width), bw):
            window = Window(col, row, min(bw, baseline.width-col), min(bh, baseline.height-row))
            left = baseline.read(1, window=window, masked=True)
            right = alternative.read(1, window=window, masked=True)
            inside = geometry_mask([geometry.__geo_interface__], out_shape=left.shape,
                transform=baseline.window_transform(window), invert=True, all_touched=False)
            valid_a = inside & ~np.ma.getmaskarray(left) & np.isfinite(left.data)
            valid_b = inside & ~np.ma.getmaskarray(right) & np.isfinite(right.data)
            common = valid_a & valid_b
            result["selected_cells"] += int(inside.sum())
            result["baseline_valid_cells"] += int(valid_a.sum())
            result["alternative_valid_cells"] += int(valid_b.sum())
            result["common_valid_cells"] += int(common.sum())
            totals["baseline"] += float(np.sum(left.data[valid_a], dtype="float64"))
            totals["alternative"] += float(np.sum(right.data[valid_b], dtype="float64"))
            totals["common_baseline"] += float(np.sum(left.data[common], dtype="float64"))
            totals["common_alternative"] += float(np.sum(right.data[common], dtype="float64"))
    for side in ("baseline", "alternative"):
        if result[side + "_valid_cells"]:
            result[side + "_export"] = totals[side]
    count = result["common_valid_cells"]
    if count:
        a, b = totals["common_baseline"], totals["common_alternative"]
        result.update(common_baseline_export=a, common_alternative_export=b,
                      alternative_minus_baseline=b-a, change_percent=(b-a)/a*100 if a != 0 else None)
    result["baseline_only_cells"] = result["baseline_valid_cells"]-count
    result["alternative_only_cells"] = result["alternative_valid_cells"]-count
    return result


def _mask_priority(source, destination, geometry):
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    with rasterio.open(source) as src:
        profile = src.profile.copy()
        if profile.get("nodata") is None:
            profile["nodata"] = -9999.0
        count = 0
        with rasterio.open(destination, "w", **profile) as out:
            for _, window in src.block_windows(1):
                values = src.read(1, window=window, masked=True)
                inside = geometry_mask([geometry.__geo_interface__], out_shape=values.shape,
                    transform=src.window_transform(window), invert=True, all_touched=False)
                valid = inside & ~np.ma.getmaskarray(values) & np.isfinite(values.data)
                data = values.data.copy()
                data[~valid] = profile["nodata"]
                out.write(data, 1, window=window)
                count += int(valid.sum())
            out.update_tags(**src.tags())
            out.update_tags(geographic_scope="Selected upstream-connected source HUC12s in reporting area",
                            selection="pixel centre")
    return count


def _report(path, inventory):
    def value(number):
        return "—" if number is None else format(number, ",.6g")
    source = inventory["network_source"]
    source_url = source["uri"] if urlsplit(source["uri"]).scheme in ("https", "http") else ""
    area_rows = "".join(
        "<tr>" + "".join("<td>" + escape(str(v)) + "</td>" for v in (
            area["title"], area["role"].replace("_", " "), area["huc12_count"],
            value(area["upstream_area_ha"]), value(area["reporting_area_ha"]),
            ", ".join(area["anchor_huc12s"]))) + "</tr>"
        for area in inventory["areas"])
    quantity_rows = "".join(
        "<tr>" + "".join("<td>" + escape(str(v)) + "</td>" for v in (
            row["receptor_title"], row["scenario_title"], "Changed" if row["profile_changed"] else "Same",
            row["pollutant"].replace("_", " "), row["native_model"].upper() + " " + row["native_version"],
            value(row["common_baseline_export"]), value(row["common_alternative_export"]),
            value(row["alternative_minus_baseline"]), value(row["change_percent"]),
            row["unit"], str(row["common_valid_cells"]) + " / " + str(row["selected_cells"]))) + "</tr>"
        for row in inventory["scenario_exports"])
    content = (
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" "
        "content=\"width=device-width,initial-scale=1\"><title>" + escape(inventory["title"]) + "</title>"
        "<style>body{font:15px system-ui,sans-serif;color:#202020;background:#fff;margin:32px auto;padding:0 24px;max-width:1250px}"
        "h1{font-size:26px}h2{margin-top:32px;font-size:19px}table{width:100%;border-collapse:collapse;margin:16px 0;font-variant-numeric:tabular-nums}"
        "th,td{padding:9px 10px;border:1px solid #c7c7c7;text-align:left;vertical-align:top}th{background:#ededed}"
        "section{overflow:auto}a{color:inherit}p{line-height:1.5}code{overflow-wrap:anywhere}footer{border-top:1px solid #999;margin-top:32px;padding-top:16px}"
        "@media print{body{margin:10mm;font-size:10pt}table{font-size:8pt}tr{break-inside:avoid}}</style><body>"
        "<h1>" + escape(inventory["title"]) + "</h1>"
        "<p>Follow the contributing land upstream from the selected water-protection areas, "
        "then compare the same land-cover alternatives using the retained physical model outputs.</p>"
        "<section><h2>Contributing land</h2><table><thead><tr><th>Area</th><th>Purpose</th><th>HUC12 units</th>"
        "<th>Retained upstream area, ha</th><th>Area in reporting basin, ha</th><th>Source anchors</th></tr></thead>"
        "<tbody>" + area_rows + "</tbody></table></section>"
        "<section><h2>Modeled export and scenario change</h2><p>Shared retained outputs: "
        + escape(", ".join(key.replace("_", " ") for key in inventory["pollutants"])) + ".</p>"
        "<p>Positive change means greater annual export "
        "under the alternative. Every change compares the same valid pixels. Separate CSV columns also retain "
        "the complete valid footprint for each run.</p>"
        "<table><thead><tr><th>Area</th><th>Alternative</th><th>Parameter profile</th><th>Pollutant</th><th>Native version</th><th>Baseline</th><th>Alternative</th>"
        "<th>Change</th><th>Change, %</th><th>Unit</th><th>Compared / selected pixels</th></tr></thead><tbody>"
        + quantity_rows + "</tbody></table></section>"
        "<h2>Method</h2><p>" + escape(inventory["method"]) + "</p>"
        "<p>" + escape(inventory["quantity_basis"]) + "</p>"
        "<p>Land memberships use complete HUC12 polygons. The saved anchor definitions identify the "
        "HUC12 outlets or source-designated watershed groups used for planning. Source-reported special "
        "unit types and original downstream links are retained in the network JSON.</p>"
        "<p>Areas may share contributing land. Review each area independently; combined footprint totals "
        "must use the geometric union. Channel transport, impoundment retention and intake-specific delivery "
        "are scientific processes that can be added through the project's selected method.</p>"
        + receptor_execution.report_section(inventory.get("native_execution"))
        + "<h2>Editable files</h2><p><a href=\"contributing-areas.gpkg\">Contributing areas and HUC12 layers</a> · "
        "<a href=\"memberships.csv\">Upstream memberships</a> · <a href=\"scenario-exports.csv\">Physical scenario quantities</a> · "
        "<a href=\"inventory.json\">Inventory</a> · <a href=\"network.json\">Original network attributes and selections</a></p>"
        "<footer><p>Network source: " + escape(source["title"]) + " · " + escape(str(source["vintage"])) +
        "<br><a href=\"" + escape(source_url, quote=True) + "\">" + escape(source["uri"]) + "</a>"
        "<br>Source SHA-256: <code>" + escape(source["sha256"]) + "</code>"
        "<br>Baseline run: <code>" + escape(inventory["baseline_run_id"]) + "</code></p></footer></body></html>\n"
    )
    path.write_text(content, encoding="utf-8")


def build_inventory(workspace, selection, grid, baseline, alternatives, directory, *, priority_path=None,
                    execution_binding=None):
    """Build the area inventory and map inputs using completed native runs.

    The returned inventory is JSON-compatible. The separate overlays value holds
    Shapely geometries for the existing cartography and parcel inventory code.
    """
    selection = dict(selection)
    directory = Path(directory)
    selected_runs = [baseline] + alternatives
    execution = receptor_execution.bind(selected_runs, grid_id=grid["id"],
        pollutants=execution_binding["pollutants"] if execution_binding is not None else None)
    if execution_binding is not None and execution != execution_binding:
        raise ValueError("Source-water producing executions changed during preparation")
    pollutants = execution["pollutants"]
    run_pollutants = {key: item["scope"]["available_artifacts"]
                      for key, item in execution["runs"].items()}
    import fiona
    import rasterio
    from pyproj import CRS
    from shapely.geometry import mapping
    from shapely.ops import unary_union
    directory.mkdir(parents=True, exist_ok=True)
    collection_id = selection.get("source_collection_id", grid["spec"]["source_collection_id"])
    network_id = selection.get("network_source_id", grid["spec"]["model_domain"]["source_id"])
    source_path, source_entry = workspace.source_file(collection_id, network_id)
    crs = CRS.from_user_input(grid["grid"]["crs"])
    input_signature = digest({"schema": "upstate.receptor-inventory/v1", "selection": selection,
        "product_version": receptor_execution.PRODUCT_VERSION,
        "execution_signature": receptor_execution.signature(execution),
        "grid_id": grid["id"], "baseline_run_id": baseline["id"],
        "alternative_run_ids": [run["id"] for run in alternatives],
        "network_source_sha256": source_entry["body"]["sha256"],
        "priority_sha256": describe_file(Path(priority_path).parent, Path(priority_path))["sha256"]
                           if priority_path is not None else None})
    inventory_path = directory / "inventory.json"
    if inventory_path.exists():
        cached = read_json(inventory_path)
        if cached.get("input_signature") != input_signature:
            raise ValueError("Retained contributing-area inventory belongs to another selection")
        for item in cached["files"].values():
            verify_file(directory, item)
        reporting_path = verify_file(workspace.root / "grids" / grid["id"], grid["files"]["reporting_area"])
        reporting_rows, _ = rasters.vector_geometry(reporting_path, target_crs=crs)
        reporting = rasters.polygon_union(reporting_rows)
        rows, _ = rasters.vector_geometry(verify_file(directory, cached["files"]["geopackage"]),
                                         layer="contributing_areas", target_crs=crs)
        overlays = {}
        for row in rows:
            properties = row["properties"]
            overlay = overlays.setdefault(properties["role"], {
                "label": "Upstream-connected " + properties["role"].replace("_", " ") +
                         " areas · " + str(source_entry["vintage"]),
                "features": [], "source": cached["network_source"], "width": .8, "style": "--"})
            clipped = _polygon(row["geometry"].intersection(reporting))
            if clipped is not None:
                overlay["features"].append({"id": properties["receptor_id"],
                                             "geometry": clipped, "properties": properties})
        return {"inventory": cached, "overlays": overlays}
    source_rows, _ = rasters.vector_geometry(source_path, layer=selection.get("layer") or source_entry.get("layer"),
                                             target_crs=crs)
    if any(row["geometry"].geom_type not in ("Polygon", "MultiPolygon") for row in source_rows):
        raise ValueError("Contributing-area analysis requires original HUC12 polygons")
    network = upstream_memberships(source_rows, selection["receptors"],
        huc12_field=selection.get("huc12_field"), tohuc_field=selection.get("tohuc_field"),
        name_field=selection.get("name_field"), type_field=selection.get("type_field"))
    field = network["source_fields"]["huc12"]
    original_geometries = {row["properties"][field]: row["geometry"] for row in source_rows}
    source_binding = {"source_collection_id": collection_id, "source_id": network_id,
                      "uri": source_entry["uri"], "title": source_entry["title"],
                      "vintage": source_entry["vintage"], "sha256": source_entry["body"]["sha256"],
                      "metadata": source_entry.get("metadata", {})}
    network["source"] = source_binding
    atomic_json(directory / "network.json", network)
    reporting_path = verify_file(workspace.root / "grids" / grid["id"], grid["files"]["reporting_area"])
    reporting_rows, _ = rasters.vector_geometry(reporting_path, target_crs=crs)
    reporting = rasters.polygon_union(reporting_rows)
    areas, memberships, geometries, overlays = [], [], {}, {}
    for area in network["areas"]:
        full = unary_union([original_geometries[key] for key in area["huc12s"]])
        clipped = _polygon(full.intersection(reporting))
        geometries[area["id"]] = {"full": full, "reporting": clipped}
        areas.append({key: value for key, value in area.items() if key != "memberships"} | {
            "upstream_area_ha": full.area / 10000,
            "reporting_area_ha": clipped.area / 10000 if clipped is not None else 0.0,
            "outside_reporting_area_ha": max(0.0, full.area-(clipped.area if clipped is not None else 0.0)) / 10000})
        for member in area["memberships"]:
            memberships.append({"receptor_id": area["id"], "receptor_title": area["title"], **member})
        overlay = overlays.setdefault(area["role"], {
            "label": "Upstream-connected " + area["role"].replace("_", " ") + " areas · " + str(source_entry["vintage"]),
            "features": [], "source": source_binding, "width": .8, "style": "--",
        })
        if clipped is not None:
            overlay["features"].append({"id": area["id"], "geometry": clipped,
                "properties": {"title": area["title"], "anchors": area["anchor_huc12s"], "huc12_count": area["huc12_count"]}})
    gpkg = directory / "contributing-areas.gpkg"
    gpkg.unlink(missing_ok=True)
    area_schema = {"geometry": "MultiPolygon", "properties": {
        "receptor_id": "str", "title": "str", "role": "str", "anchor_huc12s": "str",
        "huc12_count": "int", "upstream_ha": "float", "reporting_ha": "float", "basis": "str"}}
    with rasters.vector_environment(), fiona.open(gpkg, "w", driver="GPKG", layer="contributing_areas",
                                                 crs_wkt=crs.to_wkt(), schema=area_schema) as out:
        for area in areas:
            out.write({"geometry": mapping(_polygon(geometries[area["id"]]["full"])), "properties": {
                "receptor_id": area["id"], "title": area["title"], "role": area["role"],
                "anchor_huc12s": ";".join(area["anchor_huc12s"]), "huc12_count": area["huc12_count"],
                "upstream_ha": area["upstream_area_ha"], "reporting_ha": area["reporting_area_ha"],
                "basis": area["reference"]["basis"]}})
    member_schema = {"geometry": "MultiPolygon", "properties": {"huc12": "str", "name": "str",
        "tohuc": "str", "hutype": "str", "receptor_ids": "str", "original_attributes": "str"}}
    selected_keys = sorted({key for area in areas for key in area["huc12s"]})
    original_rows = {row["huc12"]: row for row in network["network"]}
    with rasters.vector_environment(), fiona.open(gpkg, "w", driver="GPKG", layer="contributing_huc12",
                                                 crs_wkt=crs.to_wkt(), schema=member_schema) as out:
        for key in selected_keys:
            row = original_rows[key]
            out.write({"geometry": mapping(_polygon(original_geometries[key])), "properties": {
                "huc12": key, "name": row["name"], "tohuc": row["tohuc_original"], "hutype": row["hutype"],
                "receptor_ids": ";".join(area["id"] for area in areas if key in area["huc12s"]),
                "original_attributes": json.dumps(row["attributes"], ensure_ascii=False, sort_keys=True)}})
    _csv(directory / "memberships.csv", ["receptor_id", "receptor_title", "huc12", "anchor_huc12",
        "downstream_huc12", "links_to_anchor", "is_anchor"], memberships)
    quantities = []
    # All run artifacts are already in physical mass/pixel/year on the reporting
    # grid. Summing them counts each selected pixel once in each receiving area.
    with ExitStack() as stack:
        rasters_by_run = {}
        for run in selected_runs:
            paths = {pollutant: verify_file(workspace.root / "runs" / run["id"], run["artifacts"][pollutant])
                     for pollutant in pollutants}
            rasters_by_run[run["id"]] = {key: stack.enter_context(rasterio.open(path)) for key, path in paths.items()}
        for alternative in alternatives:
            scenario = workspace._get("scenarios", alternative["selection"]["scenario_id"])
            for area in areas:
                for pollutant in pollutants:
                    summary = _summarize_pair(rasters_by_run[baseline["id"]][pollutant],
                        rasters_by_run[alternative["id"]][pollutant], geometries[area["id"]]["reporting"])
                    quantities.append({"receptor_id": area["id"], "receptor_title": area["title"],
                        "role": area["role"], "baseline_run_id": baseline["id"],
                        "alternative_run_id": alternative["id"], "scenario_title": scenario["title"],
                        "pollutant": pollutant, "unit": rasters.MASS_UNITS[pollutant].replace("/pixel", ""),
                        "profile_changed": alternative["selection"]["profile_id"] != baseline["selection"]["profile_id"],
                        **receptor_execution.pair_fields(execution, baseline["id"], alternative["id"], pollutant),
                        **summary})
    columns = ["receptor_id", "receptor_title", "role", "baseline_run_id", "alternative_run_id", "scenario_title",
        "pollutant", "unit", "profile_changed", "baseline_export", "alternative_export",
        "common_baseline_export", "common_alternative_export", "alternative_minus_baseline", "change_percent",
        "selected_cells", "baseline_valid_cells", "alternative_valid_cells", "common_valid_cells",
        "baseline_only_cells", "alternative_only_cells", *receptor_execution.CSV_FIELDS]
    _csv(directory / "scenario-exports.csv", columns, quantities)
    atomic_json(directory / "native-execution.json", execution)
    files = {key: describe_file(directory, directory / filename) for key, filename in (
        ("geopackage", "contributing-areas.gpkg"), ("memberships", "memberships.csv"),
        ("scenario_exports", "scenario-exports.csv"), ("network", "network.json"),
        ("native_execution", "native-execution.json"))}
    priority_rasters = {}
    if priority_path is not None:
        for role, overlay in overlays.items():
            if not overlay["features"]:
                continue
            footprint = unary_union([row["geometry"] for row in overlay["features"]])
            target = directory / (role + "-priority.tif")
            cells = _mask_priority(priority_path, target, footprint)
            item = describe_file(directory, target, units="dimensionless (0-1)", valid_cells=cells)
            files[role + "_priority"] = item
            priority_rasters[role] = item
    inventory = {"schema": "upstate.receptor-inventory/v1", "title": selection.get("title", "Source-water contributing land"),
        "selection": selection, "input_signature": input_signature, "network_source": source_binding, "grid_id": grid["id"],
        "baseline_run_id": baseline["id"], "alternative_run_ids": [run["id"] for run in alternatives],
        "pollutants": pollutants, "run_pollutants": run_pollutants,
        "product_version": receptor_execution.PRODUCT_VERSION, "native_execution": execution,
        "execution_signature": receptor_execution.signature(execution),
        "areas": areas, "scenario_exports": quantities, "files": files, "priority_rasters": priority_rasters,
        "method": network["method"] + "; polygon union for each receiving area; original reporting mask and pixel-centre aggregation.",
        "quantity_basis": "Annual land-origin nutrient and sediment export to the modeled stream network from contributing land inside the reporting basin.",
        "change_direction": "alternative minus baseline", "change_basis": "Common finite valid pixels within each receiving area's reporting footprint",
        "geographic_basis": network["geographic_basis"], "shared_huc12s": network["shared_huc12s"],
        "source_coverage": {"network_huc12_count": network["network_huc12_count"],
                            "selected_huc12_count": network["selected_huc12_count"],
                            "outside_network_links": network["outside_network_links"],
                            "special_hydrologic_units": network["special_hydrologic_units"]}}
    _report(directory / "index.html", inventory)
    inventory["files"]["report"] = describe_file(directory, directory / "index.html")
    atomic_json(directory / "inventory.json", inventory)
    return {"inventory": inventory, "overlays": overlays}
