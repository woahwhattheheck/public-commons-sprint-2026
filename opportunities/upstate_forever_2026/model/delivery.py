"""Assemble the seven RFP map families and invoke the original delivery engine."""
from __future__ import annotations
import importlib.util
import json
import math
from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET
from .common import (INVEST_SOURCE, INVEST_VERSION, MAP_IDS, SOURCE_IDS, atomic_bytes, atomic_json,
                     describe_file, digest, held, identifier, now, read_json, verify_file)
from . import cartography, portable, rasters
from .delivery_archive import package_archive

NDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
DELIVERY_FORMAT_VERSION = "native-grid-metadata-2"

def _copy(source, target, expected=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    if expected:
        actual = describe_file(target.parent, target)
        if actual["sha256"] != expected["sha256"] or actual["bytes"] != expected["bytes"]:
            raise ValueError("Delivered file differs from its retained original")

def _source_records(workspace, selection, grid, baseline):
    records = {}
    collection = workspace._get("sources", grid["spec"]["source_collection_id"])
    by_id = {e["id"]: e for e in collection["entries"]}
    for role, source_id in grid["spec"]["input_sources"].items():
        entry = by_id[source_id]
        records[role] = {"id": role, "source_id": entry["id"], "title": entry["title"],
                         "vintage": entry["vintage"], "uri": entry["uri"],
                         "sha256": entry["body"]["sha256"], "units": entry.get("units"),
                         "conversion": entry.get("conversion")}
    for role, choice in selection.get("source_roles", {}).items():
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if role in records and records[role]["sha256"] != entry["body"]["sha256"]:
            raise ValueError("Delivery provenance cannot replace the actual modeled " + role + " input")
        if role == "LS_FACTOR":
            raise ValueError("LS_FACTOR is supplied by the original SDR terrain calculation; keep external references under a separate source ID")
        records[role] = {"id": role, "source_id": entry["id"], "title": entry["title"],
                         "vintage": entry["vintage"], "uri": entry["uri"],
                         "sha256": entry["body"]["sha256"], "selection": choice}
    if "LS_FACTOR" not in records:
        item = baseline["stages"]["sdr"]["files"].get("ls")
        if not item:
            raise ValueError("The original SDR output registry must retain its computed LS factor")
        records["LS_FACTOR"] = {
            "id": "LS_FACTOR", "title": "Original InVEST SDR topographic LS factor",
            "vintage": "InVEST " + INVEST_VERSION + "; DEM edition " + str(records["DEM"]["vintage"]),
            "uri": SDR_GUIDE, "sha256": item["sha256"],
            "derivation": "Original SDR terrain and flow calculation on the selected DEM",
            "source_dem_sha256": records["DEM"]["sha256"],
        }
    missing = set(SOURCE_IDS) - set(records)
    if missing:
        raise ValueError("Retain the original source editions for " + ", ".join(sorted(missing)))
    return [records[key] for key in sorted(records)]

def _overlay(workspace, choice, grid_crs, reporting, *, label):
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if entry["kind"] != "vector":
        raise ValueError(label + " requires an original vector source")
    rows, _ = rasters.vector_geometry(path, layer=choice.get("layer") or entry.get("layer"),
                                      where=choice.get("where"), target_crs=grid_crs)
    features = [row for row in rows if row["geometry"].intersects(reporting)]
    if not features:
        raise ValueError(label + " source contains no geometry intersecting the reporting basin")
    return {"label": label + " · " + str(entry["vintage"]), "features": features,
            "source": {"uri": entry["uri"], "vintage": entry["vintage"],
                        "sha256": entry["body"]["sha256"], "title": entry["title"]},
            "width": .65, "style": "--" if label == "Designated high-quality waters" else "-"}

def _grid_measurements(grid):
    """Describe the actual retained pixel geometry and physical area."""
    a, b, _, d, e, _ = (float(value) for value in grid["grid"]["transform"])
    width, height = math.hypot(a, d), math.hypot(b, e)
    hectares = abs(a * e - b * d) / 10000.0
    if not all(math.isfinite(value) and value > 0 for value in (width, height, hectares)):
        raise ValueError("Delivery requires a finite, nondegenerate projected grid")
    width_text, height_text, area_text = (format(value, ".12g") for value in (width, height, hectares))
    pixels = width_text + " x " + height_text
    resolution = width_text + " m" if width == height else pixels + " m"
    return {"width": width_text, "height": height_text, "hectares": area_text,
            "pixels": pixels, "resolution": resolution}

def _fgdc(path, title, raster, *, unit, grid, sources, selection, profile, contact):
    from pyproj import CRS, Transformer
    cells = _grid_measurements(grid)
    crs = CRS.from_user_input(grid["grid"]["crs"])
    transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    west, south, east, north = transformer.transform_bounds(*grid["grid"]["bounds"], densify_pts=21)
    root = ET.Element("metadata")
    def add(route, text):
        current = root
        for name in route.split("/"):
            found = current.find(name)
            current = ET.SubElement(current, name) if found is None else found
        current.text = str(text)
    day = now()[:10].replace("-", "")
    add("idinfo/citation/citeinfo/origin", contact["organization"])
    add("idinfo/citation/citeinfo/pubdate", day)
    add("idinfo/citation/citeinfo/title", title)
    add("idinfo/citation/citeinfo/geoform", "raster digital data")
    add("idinfo/descript/abstract", title + " modeled with original InVEST " + INVEST_VERSION +
        " NDR/SDR engines. Values are " + unit + " at actual " + cells["pixels"] + " metre pixels; native rates "
        "are multiplied by " + cells["hectares"] + " hectares. The selected reporting mask preserves original NoData. "
        "Original run: " + selection["baseline_run_id"] + ". Parameter profile: " + profile["id"] + ".")
    add("idinfo/descript/purpose", selection.get("title", "Watershed source-water and land-conservation analysis") +
        ": retained source editions, annual N/P/sediment model outputs and explicit reviewed scenarios.")
    add("idinfo/timeperd/timeinfo/sngdate/caldate", day)
    add("idinfo/timeperd/current", "Model derivation date; input observation and publication editions are retained in lineage.")
    add("idinfo/status/progress", "Complete")
    add("idinfo/status/update", "As needed")
    for name, value in (("westbc", west), ("eastbc", east), ("northbc", north), ("southbc", south)):
        add("idinfo/spdom/bounding/" + name, value)
    add("idinfo/keywords/theme/themekt", "None")
    for word in ("watershed", "annual pollutant export", "source water", selection.get("title", title)):
        ET.SubElement(root.find("idinfo/keywords/theme"), "themekey").text = word
    add("idinfo/accconst", "Project delivery and original source access conditions apply.")
    add("idinfo/useconst", "Interpret with the delivered source vintages, profile, model assumptions, "
        "observation comparisons and scenario definitions. Quantitative export estimates describe the "
        "selected model; conservation priorities combine explicitly declared normalization and weights.")
    add("dataqual/attracc/attraccr", "The original per-hectare export rate is converted using the actual "
        + cells["hectares"] + "-ha pixel area. Original quantitative values and source bytes remain in the working archive.")
    add("dataqual/logic", "Native rasters share the selected original " + cells["resolution"] + " reference pixel alignment. "
        "N/P/sediment physical units remain separate; NoData cells retain their native meaning.")
    add("dataqual/complete", "Reporting extent and upstream model-domain context are retained as original "
        "polygon layers; source currency and observations are listed in the accompanying report.")
    lineage = ET.SubElement(root.find("dataqual"), "lineage")
    for source in sources:
        node = ET.SubElement(lineage, "srcinfo")
        cite = ET.SubElement(ET.SubElement(node, "srccite"), "citeinfo")
        ET.SubElement(cite, "title").text = source["title"]
        ET.SubElement(cite, "pubdate").text = str(source["vintage"])
        ET.SubElement(cite, "onlink").text = source["uri"]
        ET.SubElement(node, "srccitea").text = source["id"]
        ET.SubElement(node, "srccontr").text = "Original source SHA256 " + source["sha256"]
    step = ET.SubElement(lineage, "procstep")
    ET.SubElement(step, "procdesc").text = (
        "Original InVEST " + INVEST_VERSION + " NDR and SDR execution; source selection, " + cells["resolution"] + " grid "
        "alignment, biophysical parameters, explicit land-cover changes and model settings are retained "
        "in the native working archive. Per-hectare rates converted to " + unit +
        " by multiplication by " + cells["hectares"] + ". Reporting-mask pixel-centre selection; no interpolated output values.")
    ET.SubElement(step, "procdate").text = day
    add("spdoinfo/direct", "Raster")
    add("spdoinfo/rastinfo/rasttype", "Grid Cell")
    add("spdoinfo/rastinfo/rowcount", grid["grid"]["height"])
    add("spdoinfo/rastinfo/colcount", grid["grid"]["width"])
    add("spdoinfo/rastinfo/vrtcount", 1)
    add("spref/horizsys/planar/mapproj/mapprojn", crs.name)
    operation = crs.coordinate_operation
    if operation and "albers" in operation.method_name.lower():
        albers = ET.SubElement(root.find("spref/horizsys/planar/mapproj"), "albers")
        names = {p.name.lower(): p.value for p in operation.params}
        for name, value in names.items():
            if "standard parallel" in name:
                ET.SubElement(albers, "stdparll").text = str(value)
            elif "longitude" in name:
                ET.SubElement(albers, "longcm").text = str(value)
            elif "latitude" in name:
                ET.SubElement(albers, "latprjo").text = str(value)
            elif "easting" in name:
                ET.SubElement(albers, "feast").text = str(value)
            elif "northing" in name:
                ET.SubElement(albers, "fnorth").text = str(value)
    else:
        add("spref/horizsys/planar/mapproj/otherprj", crs.to_wkt())
    add("spref/horizsys/planar/planci/plance", "row and column")
    add("spref/horizsys/planar/planci/coordrep/absres", cells["width"])
    add("spref/horizsys/planar/planci/coordrep/ordres", cells["height"])
    add("spref/horizsys/planar/planci/plandu", "meters")
    add("spref/horizsys/geodetic/horizdn", crs.datum.name)
    add("spref/horizsys/geodetic/ellips", crs.ellipsoid.name)
    add("spref/horizsys/geodetic/semiaxis", crs.ellipsoid.semi_major_metre)
    add("spref/horizsys/geodetic/denflat", crs.ellipsoid.inverse_flattening)
    add("eainfo/overview/eaover", "Single raster band: " + title + "; units " + unit +
        ". Native source artifact SHA256 " + raster["sha256"] + ".")
    add("eainfo/overview/eadetcit", "Delivered model, run, source and profile manifests.")
    add("distinfo/distrib/cntinfo/cntorgp/cntorg", contact["organization"])
    add("distinfo/distrib/cntinfo/cntemail", contact["email"])
    add("distinfo/resdesc", Path(path).with_suffix(".tif").name)
    add("distinfo/distliab", "Use the documented model and source assumptions with the delivered quantitative results.")
    add("metainfo/metd", day)
    add("metainfo/metc/cntinfo/cntperp/cntper", contact["name"])
    add("metainfo/metc/cntinfo/cntperp/cntorg", contact["organization"])
    add("metainfo/metc/cntinfo/cntemail", contact["email"])
    add("metainfo/metstdn", "FGDC Content Standard for Digital Geospatial Metadata")
    add("metainfo/metstdv", "FGDC-STD-001-1998")
    ET.indent(root)
    atomic_bytes(path, ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n")

def build(workspace, selection):
    selection = dict(selection)
    review_ids = selection.get("spatial_review_ids", [])
    export_ids = selection.get("spatial_export_ids", [])
    if not isinstance(review_ids, list) or not isinstance(export_ids, list):
        raise ValueError("Select original saved spatial review and map export IDs")
    review_ids = [identifier(key) for key in review_ids]
    export_ids = [identifier(key) for key in export_ids]
    if len(review_ids) != len(set(review_ids)) or len(export_ids) != len(set(export_ids)):
        raise ValueError("Select distinct original spatial review and map export IDs")
    spatial_exports = []
    if export_ids:
        from .spatial_exports import SpatialExports
        exporter = SpatialExports(workspace)
        for key in export_ids:
            exported = exporter.inspect(key, verify=True)
            if exported["state"] != "complete":
                raise ValueError("Complete each selected saved-map export before delivery")
            spatial_exports.append(exported)
            if exported["review_id"] not in review_ids:
                review_ids.append(exported["review_id"])
        selection["spatial_review_ids"] = review_ids
        selection["spatial_export_ids"] = export_ids
    reviews = [workspace._get("spatial-reviews", key) for key in review_ids]
    if reviews:
        from .spatial import SpatialReview
        reviewer = SpatialReview(workspace)
        for review in reviews:
            reviewer.validate_saved(review)
    contact = selection["contact"]
    if any(not isinstance(contact.get(k), str) or not contact[k].strip()
           for k in ("name", "organization", "email")):
        raise ValueError("Retain the actual responsible contact for GIS metadata")
    from .model_selection import require_complete_delivery
    baseline = workspace.inspect_run(selection["baseline_run_id"])
    if baseline["state"] != "complete":
        raise ValueError("Complete the selected baseline native run")
    require_complete_delivery(baseline)
    scenario_ids = selection.get("scenario_run_ids", [])
    if not scenario_ids:
        raise ValueError("Select completed explicit future land-cover scenarios for the future-service maps")
    alternatives = [workspace.inspect_run(i) for i in scenario_ids]
    for run in alternatives:
        require_complete_delivery(run)
        if run["state"] != "complete" or run["selection"]["grid_id"] != baseline["selection"]["grid_id"]:
            raise ValueError("Delivery scenarios must be complete on the same retained grid")
        if run["selection"]["profile_id"] != baseline["selection"]["profile_id"]:
            raise ValueError("Future land-cover maps require a common parameter profile; parameter sensitivity remains a separate run comparison")
        if workspace._get("scenarios", run["selection"]["scenario_id"])["kind"] != "landcover":
            raise ValueError("Future map alternatives must contain explicit source-bound land-cover changes")
    grid = workspace.get_grid(baseline["selection"]["grid_id"])
    cells = _grid_measurements(grid)
    profile = workspace._get("profiles", baseline["selection"]["profile_id"])
    key = digest({"selection": selection, "baseline": baseline["id"], "version": INVEST_VERSION,
                  "map_renderer": cartography.MAP_RENDERER_VERSION,
                  "delivery_format": DELIVERY_FORMAT_VERSION})
    directory = workspace.root / "deliveries" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "delivery-state.json"
    with held(directory / ".delivery.lock", blocking=False):
        if state_path.exists():
            state = read_json(state_path)
            if state["state"] == "complete":
                for item in state["files"].values():
                    verify_file(directory, item)
                return {**state, "reused": True}
        else:
            state = {"schema": "upstate.delivery/v1", "id": key, "selection": selection,
                     "state": "building", "created_at": now(), "files": {}, "maps": {}}
            atomic_json(state_path, state)
        try:
            state.pop("error", None)
            for review in reviews:
                name = "spatial_review_" + review["id"]
                if name not in state["files"]:
                    path = directory / "reviews" / (review["id"] + ".json")
                    original = workspace.root / "spatial-reviews" / (review["id"] + ".json")
                    _copy(original, path, describe_file(workspace.root, original))
                    state["files"][name] = describe_file(directory, path,
                        title=review["title"], review_id=review["id"], project_id=review["project_id"])
                    atomic_json(state_path, state)
                else:
                    verify_file(directory, state["files"][name])
            for exported in spatial_exports:
                source = workspace.root / "spatial-exports" / exported["id"]
                export_members = {**exported["files"],
                    "record": describe_file(source, source / "export.json")}
                for member_key, item in export_members.items():
                    name = "spatial_export_" + exported["id"] + "_" + member_key
                    if name not in state["files"]:
                        original = verify_file(source, item)
                        target = directory / "spatial-maps" / exported["id"] / item["path"]
                        _copy(original, target, item)
                        state["files"][name] = describe_file(directory, target,
                            title=exported["title"] + " / " + item.get("title", member_key),
                            export_id=exported["id"], review_id=exported["review_id"],
                            project_id=exported["project_id"])
                        atomic_json(state_path, state)
                    else:
                        verify_file(directory, state["files"][name])
            from pyproj import CRS
            crs = CRS.from_user_input(grid["grid"]["crs"])
            grid_directory = workspace.root / "grids" / grid["id"]
            boundary_path = verify_file(grid_directory, grid["files"]["reporting_area"])
            boundary, _ = rasters.vector_geometry(boundary_path, target_crs=crs)
            reporting = rasters.polygon_union(boundary)
            records = _source_records(workspace, selection, grid, baseline)
            overlay_choices = selection.get("overlays", {})
            for name in ("drinking_water", "high_quality_waters"):
                if name not in overlay_choices:
                    raise ValueError("Select the actual " + name.replace("_", " ") + " source overlay")
            overlays = {name: _overlay(workspace, overlay_choices[name], crs, reporting, label=label)
                        for name, label in (("drinking_water", "Source-water catchments"),
                                            ("high_quality_waters", "Designated high-quality waters"))}
            if "protected_lands" in overlay_choices:
                overlays["protected_lands"] = _overlay(workspace, overlay_choices["protected_lands"],
                    crs, reporting, label="Protected lands")
                overlays["protected_lands"].update(style=":", width=.45)
            native_directory = workspace.root / "runs" / baseline["id"]
            mass_paths = {}
            for name, item in baseline["artifacts"].items():
                if name not in rasters.MASS_UNITS:
                    continue
                target = directory / "rasters" / (name + ".tif")
                if name not in state["files"]:
                    _copy(verify_file(native_directory, item), target, item)
                    state["files"][name] = describe_file(directory, target, units=item["units"])
                    atomic_json(state_path, state)
                mass_paths[name] = verify_file(directory, state["files"][name])
                metadata_path = target.with_suffix(".xml")
                metadata_key = name + "_metadata"
                if metadata_key not in state["files"]:
                    _fgdc(metadata_path, cartography.LABELS[name], item, unit=item["units"],
                          grid=grid, sources=records, selection=selection, profile=profile, contact=contact)
                    state["files"][metadata_key] = describe_file(directory, metadata_path)
                    atomic_json(state_path, state)
            settings = selection.get("map_settings", {})
            priority = directory / "rasters" / "combined_priority.tif"
            if "combined_priority" not in state["files"]:
                summary = rasters.combined_priority(mass_paths, priority,
                    weights=settings.get("weights", {k: 1 for k in rasters.MASS_UNITS}),
                    percentile=settings.get("percentile", 95), selected_caps=settings.get("caps"))
                state["priority"] = summary
                state["files"]["combined_priority"] = describe_file(directory, priority, **summary)
                atomic_json(state_path, state)
            comparison = workspace.compare_runs([baseline["id"]] + scenario_ids)
            comparison_root = workspace.root / "comparisons" / comparison["id"]
            receptor_product = None
            receptor_overlays = {}
            if selection.get("receptor_spec"):
                from .receptors import build_inventory
                receptor_root = directory / "receptors"
                receptor_product = build_inventory(workspace, selection["receptor_spec"], grid,
                    baseline, alternatives, receptor_root, priority_path=priority)
                state["receptor_inventory"] = receptor_product["inventory"]
                receptor_overlays = {role: overlay for role, overlay in receptor_product["overlays"].items()
                                     if overlay["features"]}
                for name, item in receptor_product["inventory"]["files"].items():
                    state["files"]["receptor_" + name] = describe_file(directory, receptor_root / item["path"])
                state["files"]["receptor_inventory"] = describe_file(directory, receptor_root / "inventory.json")
                atomic_json(state_path, state)
            if "parcels" in overlay_choices and "parcel_priorities" not in state:
                from .priorities import parcel_inventory
                if "protected_lands" not in overlays:
                    protected_choice = selection.get("source_roles", {}).get("PROTECTED_LANDS")
                    if not protected_choice:
                        raise ValueError("Parcel inventory requires its actual protected-land source")
                    overlays["protected_lands"] = _overlay(workspace, protected_choice, crs, reporting,
                                                           label="Protected lands")
                inventory_root = directory / "priorities"
                inventory = parcel_inventory(workspace, overlay_choices["parcels"], grid, mass_paths,
                    priority, comparison, inventory_root, protected=overlays["protected_lands"],
                    drinking_water=receptor_overlays.get("drinking_water", overlays["drinking_water"]),
                    high_quality_water=receptor_overlays.get("high_quality_waters", overlays["high_quality_waters"]))
                state["parcel_priorities"] = inventory
                for name, item in inventory["files"].items():
                    state["files"]["parcel_" + name] = describe_file(directory, inventory_root / item["path"])
                atomic_json(directory / "priorities" / "inventory.json", inventory)
                state["files"]["parcel_inventory"] = describe_file(directory, directory / "priorities" / "inventory.json")
                atomic_json(state_path, state)
            if "map_scales" not in state:
                map_percentile = settings.get("display_percentile", 98)
                baseline_scales = {name: cartography.shared_display_scale(
                    [path], percentile=map_percentile, units=rasters.MASS_UNITS[name])
                    for name, path in mass_paths.items()}
                alternative_scales = {}
                for name in rasters.MASS_UNITS:
                    paths = [verify_file(comparison_root, alternative["artifacts"][name])
                             for alternative in comparison["alternatives"]]
                    alternative_scales[name] = cartography.shared_display_scale(
                        paths, signed=True, percentile=map_percentile, units=rasters.MASS_UNITS[name])
                state["map_scales"] = {
                    "renderer": cartography.MAP_RENDERER_VERSION,
                    "baseline": baseline_scales, "alternatives": alternative_scales}
                scale_path = directory / "maps" / "display-scales.json"
                atomic_json(scale_path, state["map_scales"])
                state["files"]["display_scales"] = describe_file(directory, scale_path)
                atomic_json(state_path, state)
            def panel(name):
                return {"path": mass_paths[name], "label": cartography.LABELS[name],
                        "units": rasters.MASS_UNITS[name], "scale": state["map_scales"]["baseline"][name]}
            score_panel = {"path": priority, "label": "Weighted relative export priority",
                "units": "dimensionless (0–1)", "scale": {
                    "minimum": 0.0, "maximum": 1.0, "signed": False,
                    "units": "dimensionless (0–1)",
                    "label": "Fixed 0–1 range for the recorded weighted export priority."}}
            all_specs = {
                "current_nutrient_export": ([panel("nitrogen_export"), panel("phosphorus_export")], []),
                "current_sediment_export": ([panel("sediment_export")], []),
                "combined_pollutant_export": ([score_panel], []),
                "critical_drinking_water": ([score_panel], [overlays["drinking_water"]] +
                                              ([overlays["protected_lands"]] if "protected_lands" in overlays else [])),
                "high_quality_waters": ([score_panel], [overlays["high_quality_waters"]]),
            }
            if receptor_product:
                for role, family in (("drinking_water", "critical_drinking_water"),
                                     ("high_quality_waters", "high_quality_waters")):
                    item = receptor_product["inventory"]["priority_rasters"].get(role)
                    if item:
                        focused_panel = {**score_panel,
                            "path": verify_file(receptor_root, item),
                            "label": "Relative export priority in contributing land"}
                        all_specs[family] = ([focused_panel],
                            all_specs[family][1] + [receptor_overlays[role]])
            future_maps = {}
            for alternative in comparison["alternatives"]:
                scenario = workspace._get("scenarios", alternative["selection"]["scenario_id"])
                selected_panels = {}
                for name, item in alternative["artifacts"].items():
                    selected_panels[name] = {"path": verify_file(comparison_root, item),
                                            "label": cartography.LABELS[name] + " change",
                                            "units": rasters.MASS_UNITS[name], "signed": True,
                                            "scale": state["map_scales"]["alternatives"][name]}
                for family, names in (("future_sediment_loss", ["sediment_export"]),
                                       ("future_nutrient_runoff", ["nitrogen_export", "phosphorus_export"])):
                    map_key = family + "-" + alternative["run_id"]
                    all_specs[map_key] = ([selected_panels[n] for n in names],
                                         [overlays["drinking_water"]])
                    future_maps.setdefault(family, []).append(map_key)
            footer = ("Native InVEST " + INVEST_VERSION + "; original " + cells["resolution"] + " grid; baseline " + baseline["id"][:12] +
                      "; profile " + profile["title"] + "; source editions and full native outputs in the working archive.")
            for map_key, (panels, selected_overlays) in all_specs.items():
                if map_key in state["maps"]:
                    verify_file(directory, state["maps"][map_key])
                    continue
                family = next((f for f in MAP_IDS if map_key == f or map_key.startswith(f + "-")), map_key)
                subtitle = "Current selected source editions and biophysical profile."
                if map_key.startswith(("future_sediment_loss-", "future_nutrient_runoff-")):
                    run_id = map_key.rsplit("-", 1)[-1]
                    selected_run = workspace.inspect_run(run_id)
                    scenario = workspace._get("scenarios", selected_run["selection"]["scenario_id"])
                    subtitle = scenario["title"] + " · alternative minus baseline; positive values indicate greater modeled export."
                elif family == "combined_pollutant_export":
                    subtitle = "Explicit pollutant weights " + json.dumps(state["priority"]["weights"], sort_keys=True)
                elif receptor_product and family in ("critical_drinking_water", "high_quality_waters"):
                    role = "drinking_water" if family == "critical_drinking_water" else "high_quality_waters"
                    if role in receptor_product["inventory"]["priority_rasters"]:
                        subtitle = "Upstream-connected source HUC12s inside the reporting area; original whole-basin priority scale."
                elif selected_overlays:
                    subtitle = " · ".join(o["label"] for o in selected_overlays)
                target = directory / "maps" / (map_key + ".pdf")
                cartography.map_pdf(target, cartography.TITLES[family], panels,
                    overlays=selected_overlays, boundary=boundary, crs=crs, subtitle=subtitle,
                    footer=footer, dpi=settings.get("dpi", 220))
                state["maps"][map_key] = describe_file(directory, target)
                atomic_json(state_path, state)
            maps = {family: state["maps"][family]["path"] for family in all_specs if family in MAP_IDS}
            for family, map_keys in future_maps.items():
                # The first explicit scenario is the principal family map; every additional scenario remains an extra map.
                maps[family] = state["maps"][map_keys[0]]["path"]
                for map_key in map_keys[1:]:
                    maps[map_key] = state["maps"][map_key]["path"]
            observation_results = [workspace._get("observation-comparisons", value)
                                   for value in selection.get("observation_comparison_ids", [])]
            if any(v["run_id"] not in [baseline["id"]] + scenario_ids for v in observation_results):
                raise ValueError("Observation comparison is not bound to a selected delivery run")
            if "report" not in state["files"]:
                sections = [
                    ("Study scope", [selection.get("title", workspace.project["title"]),
                     "The reporting polygon is retained separately from the model domain and its " +
                     str(grid["spec"]["upstream_buffer_m"]) + " metre context buffer. "
                     "Model outputs and the explicit current-versus-future scenarios use the same original "
                     + cells["resolution"] + " land-cover reference alignment."]),
                    ("Model and units", [
                     "The original InVEST " + INVEST_VERSION + " Nutrient Delivery Ratio and Sediment Delivery Ratio "
                     "engines were executed with the retained inputs and parameter profile. Nitrogen and phosphorus "
                     "are delivered in kg per pixel per year; sediment is in metric tonnes per pixel per year. "
                     "Native per-hectare rates are multiplied by the actual " + cells["hectares"] + "-ha cell area.",
                     "NDR guide: " + NDR_GUIDE, "SDR guide: " + SDR_GUIDE]),
                    ("Selected parameter profile", [profile["title"],
                     json.dumps({"ndr": profile["ndr"], "sdr": profile["sdr"]}, sort_keys=True),
                     "Original profile references: " + json.dumps(profile["references"], ensure_ascii=False)]),
                    ("Current quantitative exports", [
                     name.replace("_", " ") + ": " + json.dumps({k: v for k, v in item.items()
                         if k in ("units", "sum", "sum_units", "valid_cells", "pixel_area_ha", "native_units")}, sort_keys=True)
                     for name, item in baseline["artifacts"].items() if name in rasters.MASS_UNITS]),
                    ("Future conservation and development scenarios", [
                     json.dumps(workspace._get("scenarios", r["selection"]["scenario_id"]), ensure_ascii=False)
                     for r in alternatives]),
                    ("Combined priorities", [json.dumps(state["priority"], sort_keys=True),
                     "Physical N/P/sediment rasters remain separate. The combined map is a dimensionless "
                     "weighted index, with normalization and weights recorded above. Source-water and "
                     "designated high-quality-water overlays use the original retained source geometry."]),
                    *([("Source-water contributing land", [
                        state["receptor_inventory"]["method"],
                        state["receptor_inventory"]["quantity_basis"],
                        "Saved area definitions: " + json.dumps([
                            {"title": area["title"], "anchors": area["anchor_huc12s"],
                             "huc12_count": area["huc12_count"], "reporting_area_ha": area["reporting_area_ha"]}
                            for area in state["receptor_inventory"]["areas"]], ensure_ascii=False),
                        "The contributing-area GIS layers, original network links, upstream memberships "
                        "and annual scenario quantities are retained under receptors. Scenario differences "
                        "use the same valid reporting pixels; each row includes its coverage counts. "
                        "Shared upstream land is retained explicitly and should be combined using its union."])]
                      if receptor_product else []),
                    ("Observed watershed loads", [
                     json.dumps(v["metrics"], sort_keys=True) + "; observation source " + v["observation_id"]
                     for v in observation_results] or [
                     "This delivery retains the selected published parameter profile. Original annual-load "
                     "observations can be imported and compared by catchment through the workspace."]),
                    ("Interpretation", [
                     "Native SDR estimates overland erosion and sediment delivery; channel-bank erosion, "
                     "mass wasting and in-stream/reservoir processes require their own reviewed treatment. "
                     "NDR represents the selected annual nutrient loading, retention and flow assumptions.",
                     "The future maps compare explicit land-cover scenarios using one common parameter "
                     "profile. Actual bacterial or cyanotoxin observations remain distinct source measurements "
                     "and are preserved alongside annual nutrient and sediment load comparisons.",
                     "Sampling periods, source resolution/vintage, spatial coverage and any point-source "
                     "or impoundment influences must accompany interpretation of modeled export totals."]),
                    ("Project notes", selection.get("notes", [])),
                    *([("Saved spatial reviews", [
                        review["title"] + " / " + review["id"] + "; " + review["view"]["crs"]
                        for review in reviews] + [
                        "The selected original review JSON files retain the geographic viewport, "
                        "exact source and run bindings, numeric scales, overlay filters and annotations. "
                        "They are included with original project assets and the complete working archive."])]
                      if reviews else []),
                    *([("Printed saved spatial reviews", [
                        exported["title"] + " / " + exported["id"] + "; " +
                        exported["selection"]["paper"].upper() + " landscape, " +
                        str(exported["selection"]["dpi"]) + " DPI; saved review " + exported["review_id"]
                        for exported in spatial_exports] + [
                        "Each selected map pack retains its PDF/SVG/PNG, complete source and legend "
                        "appendix, exact native point values and feature attributes, original saved "
                        "review, provenance, application source and ZIP. The original export file "
                        "hierarchy is retained under spatial-maps and in the working archive."])]
                      if spatial_exports else []),
                    ("Receiving and reuse", [
                     "The working archive includes original retained source bytes, immutable profile and "
                     "scenario selections, aligned inputs, original native working files, run logs and this "
                     "application. Restore it into a new directory with the included CLI. The accompanying "
                     "original delivery navigator and audit inspect the actual final GIS files."]),
                ]
                target = directory / "report.pdf"
                cartography.report_pdf(target, selection.get("title", workspace.project["title"]),
                                       sections, contact=contact, source_records=records)
                state["files"]["report"] = describe_file(directory, target)
                atomic_json(state_path, state)
            working = directory / "working" / "scientific-workspace.zip"
            if "working_archive" not in state["files"]:
                working.parent.mkdir(parents=True, exist_ok=True)
                if working.exists():
                    previous = portable.inspect_archive(working, verify=True)
                    if previous["project"] != workspace.project:
                        raise ValueError("Existing working archive belongs to another original project")
                else:
                    portable.backup(workspace, working, include_intermediates=True, include_deliveries=False)
                state["files"]["working_archive"] = describe_file(directory, working)
                atomic_json(state_path, state)
            manifest = {"schema": "upstate-ec-sdc-2026/delivery-v1",
                "model": {"name": "InVEST NDR and SDR", "version": INVEST_VERSION,
                          "upstream_buffer_m": grid["spec"]["upstream_buffer_m"],
                          "baseline_run_id": baseline["id"], "scenario_run_ids": scenario_ids,
                          "profile_id": profile["id"], "grid_id": grid["id"]},
                "source_data": records, "rasters": {},
                "maps": maps, "report_pdf": state["files"]["report"]["path"],
                "project_assets": [state["files"]["combined_priority"]["path"],
                                   state["files"]["working_archive"]["path"],
                                   state["files"]["display_scales"]["path"]]}
            for name in rasters.MASS_UNITS:
                manifest["rasters"][name] = {"path": state["files"][name]["path"],
                    "fgdc_xml": state["files"][name + "_metadata"]["path"], "units": rasters.MASS_UNITS[name]}
            manifest["project_assets"].extend(item["path"] for name, item in state["files"].items()
                                             if name.startswith(("parcel_", "spatial_review_", "spatial_export_", "receptor_")))
            audit_manifest = directory / "delivery.json"
            atomic_json(audit_manifest, manifest)
            source_root = Path(__file__).resolve().parent.parent
            if str(source_root) not in sys.path:
                sys.path.insert(0, str(source_root))
            spec = importlib.util.spec_from_file_location("_upstate_original_package", source_root / "package_delivery.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            package_root = directory / "package"
            if package_root.exists() and (package_root / "package.json").is_file():
                module.verify(package_root)
                package = read_json(package_root / "package.json")
            else:
                if package_root.exists():
                    # Original failed capture stays intact for receiving diagnosis.
                    package_root = directory / ("package-" + now().replace(":", "").replace("+", "_"))
                code = module.pack(audit_manifest, package_root)
                if code:
                    raise ValueError("Original delivery audit requires correction; inspect " + str(package_root / "audit.json"))
                package = read_json(package_root / "package.json")
            state["files"]["delivery_archive"] = package_archive(directory, package_root, package)
            state.update(state="complete", completed_at=now(), manifest=manifest,
                         package={"path": package_root.relative_to(directory).as_posix(),
                                  "packageSha256": package["packageSha256"],
                                  "auditStatus": package["auditStatus"]})
            for map_key, item in state["maps"].items():
                state["files"]["map_" + map_key] = item
            state["files"]["manifest"] = describe_file(directory, audit_manifest)
            state["files"]["package_index"] = describe_file(directory, package_root / "package.json")
            atomic_json(state_path, state)
            return state
        except BaseException as error:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise
