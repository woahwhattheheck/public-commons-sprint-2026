"""Assemble a regional RFP or original native-study scientific delivery."""
from __future__ import annotations
import importlib.util
import json
import math
from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET
from .common import (INVEST_VERSION, MAP_IDS, SOURCE_IDS, atomic_bytes, atomic_json,
                     describe_file, digest, held, identifier, now, read_json, verify_file)
from . import atlas_browser, cartography, client_report, map_atlas, native_study, native_versions, portable, rasters
import tempfile
from .report_release import bind_report, retain_report
from .source_lineage import LINEAGE_VERSION
from .delivery_archive import package_archive
from . import receiving_water_delivery, scientific_report, observed_context, delivery_datasets
from . import scenario_analysis_delivery as analysis_delivery
from . import scenario_treatment_report
from .robust_decisions.eco_robust import decision_delivery
from .client_economics import (CLIENT_REPORT_EDITION, bind_economic,
                               retain_economic, scientific_sections)

NDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html"
SDR_GUIDE = "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html"
OVERLAY_LABELS = (("drinking_water", "Drinking-water source areas"),
                  ("high_quality_waters", "Designated high-quality waters"))
DELIVERY_EDITION = "2026-10-13-integrated-native-treatment-report-14"
DELIVERY_FORMAT_VERSION = "retained-stage-version-treatment-client-report-14"

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
                         "conversion": entry.get("conversion"),
                         **{key: entry[key] for key in ("data_status", "legal_edition_status",
                                                       "catalogue_source_id", "source_labels")
                            if key in entry}}
    source_choices = dict(selection.get("source_roles", {}))
    selected_reports = observed_context.source_choices(selection)
    if "observed_context_sources" in selection:
        source_choices.pop(observed_context.ROLE, None)
        for index, choice in enumerate(selected_reports):
            role = observed_context.ROLE if index == 0 else observed_context.ROLE + "_%03d" % (index + 1)
            source_choices[role] = choice
    overlay_choices = selection.get("overlays", {})
    for name, role in (("high_quality_waters", "HIGH_QUALITY_WATERS"),
                       ("drinking_water", "SOURCE_WATER_PROTECTION_AREAS"),
                       ("protected_lands", "PROTECTED_LANDS_OVERLAY")):
        if name in overlay_choices:
            source_choices[role] = overlay_choices[name]
        elif role == "PROTECTED_LANDS_OVERLAY":
            source_choices.pop(role, None)
    for role, choice in source_choices.items():
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if role in records and records[role]["sha256"] != entry["body"]["sha256"]:
            raise ValueError("Delivery provenance cannot replace the actual modeled " + role + " input")
        if role == "LS_FACTOR":
            raise ValueError("LS_FACTOR is supplied by the original SDR terrain calculation; keep external references under a separate source ID")
        records[role] = {"id": role, "source_id": entry["id"], "title": entry["title"],
                         "vintage": entry["vintage"], "uri": entry["uri"],
                         "sha256": entry["body"]["sha256"], "selection": choice,
                         **{key: entry[key] for key in ("data_status", "legal_edition_status",
                                                       "catalogue_source_id", "source_labels")
                            if key in entry}}
    if "LS_FACTOR" not in records:
        item = baseline["stages"]["sdr"]["files"].get("ls")
        if not item:
            raise ValueError("The original SDR output registry must retain its computed LS factor")
        sdr_version = native_versions.model_versions(baseline, ("sdr",))["sdr"]
        records["LS_FACTOR"] = {
            "id": "LS_FACTOR", "title": "Original InVEST SDR topographic LS factor",
            "vintage": native_versions.version_label(sdr_version) + "; DEM edition " + str(records["DEM"]["vintage"]),
            "uri": native_versions.guide_url("sdr", sdr_version) or "https://github.com/natcap/invest",
            "native_version": sdr_version, "sha256": item["sha256"],
            "derivation": "Original SDR terrain and flow calculation on the selected DEM",
            "source_dem_sha256": records["DEM"]["sha256"],
        }
    missing = (set(SOURCE_IDS) - set(records)
               if native_study.mode(selection) == "regional_rfp" else set())
    if missing:
        raise ValueError("Retain the original source editions for " + ", ".join(sorted(missing)))
    return [records[key] for key in sorted(records)]

def _overlay(workspace, choice, grid_crs, reporting, *, label):
    display_label = choice.get("label", label)
    if not isinstance(display_label, str) or not display_label.strip():
        raise ValueError("A source overlay label must be nonempty text")
    display_label = display_label.strip()
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if entry["kind"] != "vector":
        raise ValueError(label + " requires an original vector source")
    rows, _ = rasters.vector_geometry(path, layer=choice.get("layer") or entry.get("layer"),
                                      where=choice.get("where"), target_crs=grid_crs)
    features = [row for row in rows if row["geometry"].intersects(reporting)]
    if not features:
        raise ValueError(label + " source contains no geometry intersecting the reporting basin")
    return {"label": display_label + " · " + str(entry["vintage"]), "features": features,
            "source": {"uri": entry["uri"], "vintage": entry["vintage"],
                        "sha256": entry["body"]["sha256"], "title": entry["title"]},
            "width": .65, "style": "--" if label == "Designated high-quality waters" else "-"}

def _delivery_audit_scope(selection, grid):
    """Keep an explicit contract, otherwise follow the original prepared grid."""
    chosen = selection.get("audit_scope")
    if chosen is not None:
        if chosen not in ("regional-30m", "source-native"):
            raise ValueError("Select regional-30m or source-native delivery audit scope")
        return chosen
    a, b, _, d, e, _ = (float(value) for value in grid["grid"]["transform"])
    regional = (math.isclose(abs(a), 30, rel_tol=0, abs_tol=1e-6)
                and math.isclose(abs(e), 30, rel_tol=0, abs_tol=1e-6)
                and abs(b) < 1e-8 and abs(d) < 1e-8
                and grid["spec"]["upstream_buffer_m"] > 0)
    return "regional-30m" if regional else "source-native"


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

def _fgdc(path, title, raster, *, unit, grid, sources, selection, profile, contact,
          native_model=None, native_execution=None, dataset=None):
    from pyproj import CRS, Transformer
    cells = _grid_measurements(grid)
    native_model = native_model or {}
    model_label = (str(native_model.get("model", "native model")).upper() + ": "
                   + native_versions.version_label(native_model))
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
    add("idinfo/citation/citeinfo/origin", contact.get("organization") or selection.get("native_study", {}).get("title") or selection["title"])
    add("idinfo/citation/citeinfo/pubdate", day)
    add("idinfo/citation/citeinfo/title", title)
    add("idinfo/citation/citeinfo/geoform", "raster digital data")
    add("idinfo/descript/abstract", title + " derived from the retained " + model_label +
        ". Values are " + unit + " at actual " + cells["pixels"] + " metre pixels; native rates "
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
        "Retained " + model_label + "; source selection, " + cells["resolution"] + " grid "
        "alignment, biophysical parameters, explicit land-cover changes and model settings are retained "
        "in the native working archive. Per-hectare rates converted to " + unit +
        " by multiplication by " + cells["hectares"] + ". Reporting-mask pixel-centre selection; no interpolated output values.")
    ET.SubElement(step, "procdate").text = day
    if native_execution:
        add("idinfo/descript/supplinf", "Original producing-model metadata: " +
            json.dumps(native_model, ensure_ascii=False, sort_keys=True) +
            ". Complete ordered run/stage/source records: " + native_execution["path"] +
            "; SHA256 " + native_execution["sha256"] + ".")
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
    if contact.get("organization"):
        add("distinfo/distrib/cntinfo/cntorgp/cntorg", contact["organization"])
    if contact.get("email"):
        add("distinfo/distrib/cntinfo/cntemail", contact["email"])
    add("distinfo/resdesc", Path(path).with_suffix(".tif").name)
    add("distinfo/distliab", "Use the documented model and source assumptions with the delivered quantitative results.")
    add("metainfo/metd", day)
    for key, route in (("name", "cntperp/cntper"), ("organization", "cntperp/cntorg"), ("email", "cntemail")):
        if contact.get(key):
            add("metainfo/metc/cntinfo/" + route, contact[key])
    add("metainfo/metstdn", "FGDC Content Standard for Digital Geospatial Metadata")
    add("metainfo/metstdv", "FGDC-STD-001-1998")
    if dataset is not None:
        # Derived rasters have their own quantity, support and process lineage.
        # The baseline conversion prose above remains exclusive to physical exports.
        kind = dataset["kind"]
        quantity = ("Signed alternative-minus-baseline annual mass per original pixel."
                    if kind == "scenario_difference"
                    else "Dimensionless relative export priority under the retained normalization and weights.")
        process = json.dumps(dataset["derivation"], ensure_ascii=False, sort_keys=True)
        add("idinfo/descript/abstract", title + ". " + quantity + " Units: " + unit +
            ". " + dataset["support"] + " Exact original dataset: " + dataset["source_raster"] +
            "; delivered SHA256 " + raster["sha256"] + ".")
        add("dataqual/attracc/attraccr", "The delivered GeoTIFF and its actual companions preserve "
            "the original bytes and numerical representation. " + quantity +
            " The map display range is presentation metadata and does not change dataset values.")
        add("dataqual/complete", dataset["support"] +
            " The retained grid distinguishes the model-domain context from the reporting area.")
        add("dataqual/logic", "Original CRS, affine alignment, band type, NoData and mask flags "
            "are retained in the atlas dataset record. No reprojection, resampling or numerical "
            "conversion occurs during dataset packaging.")
        step.find("procdesc").text = "Original retained derivation: " + process
        # Run completion dates describe the producing stages, not necessarily
        # the later comparison or normalization process.
        step.find("procdate").text = "Unknown"
        add("idinfo/timeperd/timeinfo/sngdate/caldate", "Unknown")
        add("idinfo/timeperd/current", "The original derived-dataset processing date is not recorded. "
            "Producing-stage completion dates remain in the retained run records; "
            "the actual packaging date is recorded in the packaging process step.")
        for source in sources:
            ET.SubElement(step, "srcused").text = source["id"]
        transfer = ET.SubElement(lineage, "procstep")
        ET.SubElement(transfer, "procdesc").text = (
            "Retain the original dataset and present companions for editable GIS delivery; "
            "verify original and delivered byte counts and SHA256. Source " +
            dataset["source_raster"] + "; source SHA256 " +
            dataset["source_file"]["sha256"] + "; delivered member " + dataset["file"]["path"] +
            "; delivered SHA256 " + dataset["file"]["sha256"] +
            ". Original map relationships, selected runs, source editions and physical header "
            "are retained in maps/atlas-index.json.")
        ET.SubElement(transfer, "procdate").text = day
        add("idinfo/descript/supplinf", json.dumps({
            "dataset_id": dataset["id"], "grid_id": dataset["grid_id"],
            "profile_id": dataset["profile_id"], "runs": dataset["runs"],
            "comparison_id": dataset.get("comparison_id"),
            "native_execution": dataset["native_execution"],
            "header": dataset["grid"], "support": dataset["support"],
            "derivation": dataset["derivation"],
        }, ensure_ascii=False, sort_keys=True))
        add("eainfo/overview/eaover", "Single raster band: " + title + "; units " + unit +
            "; NoData " + str(dataset["grid"]["nodata"]) +
            "; signed values " + str(dataset["signed"]) +
            ". Complete original physical header and companions are in the atlas dataset record.")
        add("distinfo/resdesc", dataset["file"]["path"])
        add("distinfo/stdorder/digform/digtinfo/formname", "GeoTIFF")
        # Derived metadata is retained at gis/metadata/<id>.xml.
        add("distinfo/stdorder/digform/digtopt/onlinopt/computer/networka/networkr",
            "../../" + dataset["file"]["path"])
    ET.indent(root)
    atomic_bytes(path, ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n")

def build(workspace, selection):
    selection = dict(selection)
    study_mode = native_study.prepare(selection)
    map_atlas.settings(selection.get("map_settings"))
    water_links = map_atlas.bind_water_selections(workspace, selection)
    report_link = bind_report(workspace, selection)
    if report_link is not None:
        selection["source_report_sha256"] = report_link["report_sha256"]
    analysis_link = analysis_delivery.bind_analysis(workspace, selection)
    if analysis_link is not None:
        selection["source_scenario_analysis_sha256"] = analysis_link["analysis_sha256"]
    decision_link = decision_delivery.bind_decision(workspace, selection)
    if decision_link is not None:
        selection["source_decision"] = decision_link["source_decision"]
    economic_link = bind_economic(workspace, selection)
    if economic_link is not None:
        selection["economic_edition_sha256"] = economic_link["edition_sha256"]
    selection["client_report_edition"] = CLIENT_REPORT_EDITION
    observed_link = observed_context.bind(workspace, selection)
    if observed_link is not None:
        selection["observed_context_binding"] = observed_link
    else:
        selection.pop("observed_context_binding", None)
    selection["report_renderer_version"] = scientific_report.REPORT_VERSION
    selection["client_companion_edition"] = client_report.REPORT_EDITION
    selection["delivery_edition"] = DELIVERY_EDITION
    selection["application_sha256"] = portable.application_digest()
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
    if not study_mode and any(not isinstance(contact.get(k), str) or not contact[k].strip()
           for k in ("name", "organization", "email")):
        raise ValueError("Retain the actual responsible contact for GIS metadata")
    from .model_selection import require_complete_delivery
    baseline = workspace.inspect_run(selection["baseline_run_id"])
    if baseline["state"] != "complete":
        raise ValueError("Complete the selected baseline native run")
    require_complete_delivery(baseline)
    if workspace._get("scenarios", baseline["selection"]["scenario_id"])["kind"] != "baseline":
        raise ValueError("Choose an original baseline scenario for the current-export maps")
    scenario_ids = selection.get("scenario_run_ids", [])
    if not isinstance(scenario_ids, list) or not scenario_ids:
        raise ValueError("Select completed explicit future land-cover scenarios for the future-service maps")
    scenario_ids = [identifier(value) for value in scenario_ids]
    if len(scenario_ids) != len(set(scenario_ids)) or baseline["id"] in scenario_ids:
        raise ValueError("Choose distinct future land-cover alternatives, each different from the baseline")
    selection["scenario_run_ids"] = scenario_ids
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
    report_title = (selection.get("title")
                    or (selection["native_study"]["title"] if study_mode else None)
                    or workspace.project.get("title") or "Source-water assessment")
    native_versions.comparison_versions([baseline, *alternatives], ("ndr", "sdr"))
    native_execution = scientific_report.execution_provenance(baseline, alternatives)
    selection["native_execution_digest"] = digest(native_execution)
    version_provenance = {
        "policy": native_versions.POLICY,
        "runs": {run["id"]: native_versions.model_versions(run)
                 for run in [baseline, *alternatives]},
    }
    baseline_versions = version_provenance["runs"][baseline["id"]]
    versions = {model: info["comparison_version"]
                for model, info in baseline_versions.items()}
    version_provenance.update(models=list(versions), versions=dict(versions))
    all_versions = {info["comparison_version"]
                    for items in version_provenance["runs"].values()
                    for info in items.values()}
    common_version = next(iter(all_versions)) if len(all_versions) == 1 else None
    receptor_execution_binding = None
    if selection.get("receptor_spec"):
        from . import receptor_execution
        receptor_execution_binding = receptor_execution.bind([baseline, *alternatives], grid_id=grid["id"])
    key = digest({"selection": selection, "baseline": baseline["id"],
                  **({"receptor_execution": receptor_execution.signature(receptor_execution_binding),
                      "receptor_product_version": receptor_execution.PRODUCT_VERSION}
                     if receptor_execution_binding is not None else {}),
                  "application_version": INVEST_VERSION,
                  "native_version_provenance": version_provenance,
                  "map_renderer": cartography.MAP_RENDERER_VERSION,
                  "report_renderer": scientific_report.REPORT_VERSION,
                  "delivery_format": DELIVERY_FORMAT_VERSION,
                  "map_atlas": map_atlas.ATLAS_VERSION,
                  "gis_datasets": delivery_datasets.VERSION,
                  "overlay_labels": OVERLAY_LABELS,
                  **({"parcel_source_lineage": LINEAGE_VERSION}
                     if selection.get("overlays", {}).get("parcels") else {})})
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
            execution_path = directory / "native-execution.json"
            if "native_execution" not in state["files"]:
                atomic_json(execution_path, native_execution)
                state["files"]["native_execution"] = describe_file(directory, execution_path)
                atomic_json(state_path, state)
            else:
                verify_file(directory, state["files"]["native_execution"])
                if read_json(execution_path) != native_execution:
                    raise ValueError("The retained execution provenance differs from this delivery selection")
            observed_product = observed_context.collect(workspace, selection, directory, state)
            if (observed_product is None) != (observed_link is None):
                raise ValueError("Observed report context does not match the selected source")
            if observed_product is not None:
                if observed_product["binding"] != observed_link:
                    raise ValueError("Observed report context differs from its selected source binding")
                for name, item in observed_product["files"].items():
                    verify_file(directory, item)
                    state["files"]["observed_context_" + name] = item
                state["observed_context"] = observed_product["binding"]
                atomic_json(state_path, state)
            analysis_product = analysis_delivery.retain_analysis(workspace, directory, state, analysis_link)
            if analysis_product is not None:
                atomic_json(state_path, state)
            if report_link is not None:
                retain_report(workspace, directory, state, report_link)
                atomic_json(state_path, state)
            decision_product = decision_delivery.retain_decision(workspace, directory, state, decision_link)
            if decision_product is not None:
                atomic_json(state_path, state)
            economic_decision = retain_economic(workspace, directory, state, economic_link)
            if economic_decision is not None:
                atomic_json(state_path, state)
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
            if study_mode:
                records = native_study.source_records(workspace, grid, profile, records)
                native_study.retain(workspace, directory, state, selection, grid, profile,
                                    baseline, alternatives, records)
                atomic_json(state_path, state)
            overlay_choices = selection.get("overlays", {})
            for name in ("drinking_water", "high_quality_waters"):
                if not study_mode and name not in overlay_choices:
                    raise ValueError("Select the actual " + name.replace("_", " ") + " source overlay")
            overlays = {name: _overlay(workspace, overlay_choices[name], crs, reporting, label=label)
                        for name, label in OVERLAY_LABELS if name in overlay_choices}
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
                          grid=grid, sources=records, selection=selection, profile=profile, contact=contact,
                          native_model=baseline_versions[native_versions.models_for_outputs((name,))[0]],
                          native_execution=state["files"]["native_execution"])
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
            water_product = receiving_water_delivery.collect(
                workspace, selection, directory / "receiving-waters",
                priority_settings=state["priority"])
            receiving_water_delivery.attach_state(state, directory, water_product)
            atomic_json(state_path, state)
            receptor_product = None
            receptor_overlays = {}
            if selection.get("receptor_spec"):
                from .receptors import build_inventory
                receptor_root = directory / "receptors"
                receptor_product = build_inventory(workspace, selection["receptor_spec"], grid,
                    baseline, alternatives, receptor_root, priority_path=priority,
                    execution_binding=receptor_execution_binding)
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
                for required_context in ("drinking_water", "high_quality_waters"):
                    if required_context not in overlays and required_context not in receptor_overlays:
                        raise ValueError("Parcel inventory requires its actual " + required_context.replace("_", " ") + " source; select that source or use the original-polygon planning inventory")
                inventory_root = directory / "priorities"
                inventory = parcel_inventory(workspace, overlay_choices["parcels"], grid, mass_paths,
                    priority, comparison, inventory_root, protected=overlays["protected_lands"],
                    drinking_water=receptor_overlays.get("drinking_water") or overlays.get("drinking_water"),
                    high_quality_water=receptor_overlays.get("high_quality_waters") or overlays.get("high_quality_waters"))
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

            }
            if "drinking_water" in overlays:
                all_specs["critical_drinking_water"] = ([score_panel], [overlays["drinking_water"]] +
                    ([overlays["protected_lands"]] if "protected_lands" in overlays else []))
            if "high_quality_waters" in overlays:
                all_specs["high_quality_waters"] = ([score_panel], [overlays["high_quality_waters"]])
            if receptor_product:
                for role, family in (("drinking_water", "critical_drinking_water"),
                                     ("high_quality_waters", "high_quality_waters")):
                    item = receptor_product["inventory"]["priority_rasters"].get(role)
                    if item:
                        focused_panel = {**score_panel,
                            "path": verify_file(receptor_root, item),
                            "label": "Relative export priority in contributing land"}
                        all_specs[family] = ([focused_panel],
                            all_specs.get(family, ([], []))[1] + [receptor_overlays[role]])
            receiving_water_delivery.apply_map_specs(all_specs, water_product)
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
                                         [overlays["drinking_water"]] if "drinking_water" in overlays else [])
                    future_maps.setdefault(family, []).append(map_key)
            footer = ((selection["native_study"]["title"] + "; " if study_mode else "") +
                      "Baseline " + native_versions.run_label(baseline) + "; original " + cells["resolution"] + " grid; baseline " + baseline["id"][:12] +
                      "; profile " + profile["title"] + "; source editions and full native outputs in the working archive.")
            atlas_pages = []
            for map_key, (panels, selected_overlays) in all_specs.items():
                family = next((f for f in MAP_IDS if map_key == f or map_key.startswith(f + "-")), map_key)
                subtitle = "Current selected source editions and biophysical profile."
                if map_key.startswith(("future_sediment_loss-", "future_nutrient_runoff-")):
                    run_id = map_key.rsplit("-", 1)[-1]
                    selected_run = workspace.inspect_run(run_id)
                    scenario = workspace._get("scenarios", selected_run["selection"]["scenario_id"])
                    subtitle = scenario["title"] + " · alternative minus baseline; positive values indicate greater modeled export."
                elif family == "combined_pollutant_export":
                    subtitle = "Explicit pollutant weights " + json.dumps(state["priority"]["weights"], sort_keys=True)
                elif (water_product and family in water_product["inventory"]["families"]
                      and water_product["inventory"]["families"][family]["current_priority"]):
                    subtitle = ("Selected receiving-water contribution footprint; " +
                                water_product["inventory"]["quantity_scope"].replace("_", " ") +
                                " quantities; recorded pollutant normalization and weights.")
                elif receptor_product and family in ("critical_drinking_water", "high_quality_waters"):
                    role = "drinking_water" if family == "critical_drinking_water" else "high_quality_waters"
                    if role in receptor_product["inventory"]["priority_rasters"]:
                        subtitle = "Upstream-connected source HUC12s inside the reporting area; original whole-basin priority scale."
                elif selected_overlays:
                    subtitle = " · ".join(o["label"] for o in selected_overlays)
                atlas_pages.append({"key": map_key, "family": family,
                    "title": cartography.TITLES[family], "panels": panels,
                    "overlays": selected_overlays, "subtitle": subtitle})
            delivery_datasets.retain(workspace, directory, atlas_pages,
                state=state, grid=grid, selection=selection, profile=profile, sources=records,
                baseline=baseline, alternatives=alternatives, comparison=comparison,
                metadata_writer=_fgdc, copy_file=_copy,
                receptor_product=receptor_product, water_product=water_product)
            atomic_json(state_path, state)
            map_atlas.write(directory, atlas_pages, workspace=workspace, selection=selection,
                grid=grid, boundary=boundary, crs=crs, footer=footer,
                state=state, state_path=state_path, water_links=water_links)
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
            from .scenario_summary import build_delivery_summary, write_summary
            summary_keys = ("scenario_summary_json", "scenario_summary_csv", "scenario_summary_markdown")
            if not all(name in state["files"] for name in summary_keys):
                summary = build_delivery_summary(workspace, selection, comparison,
                    baseline=baseline, alternatives=alternatives, grid=grid)
                for name, item in write_summary(directory, summary).items():
                    state["files"]["scenario_summary_" + name] = item
                state["scenario_summary_id"] = summary["id"]
                atomic_json(state_path, state)
            else:
                summary = read_json(verify_file(directory, state["files"]["scenario_summary_json"]))
            if "native_grid_record" not in state["files"]:
                original_grid = workspace.root / "grids" / grid["id"] / "grid.json"
                grid_path = directory / "grid" / "grid.json"
                _copy(original_grid, grid_path, describe_file(workspace.root, original_grid))
                state["files"]["native_grid_record"] = describe_file(directory, grid_path)
                atomic_json(state_path, state)
            else:
                verify_file(directory, state["files"]["native_grid_record"])
            working_relative = "working/scientific-workspace.zip"
            if not all(name in state["files"] for name in ("report", "report_html", "report_markdown", "report_data")):
                sections = [
                    ("Study scope", [report_title,
                     "The reporting polygon is retained separately from the model domain and its " +
                     str(grid["spec"]["upstream_buffer_m"]) + " metre context buffer. "
                     "Model outputs and the explicit current-versus-future scenarios use the same original "
                     + cells["resolution"] + " land-cover reference alignment."]),
                    ("Model and units", [
                     "The retained baseline model versions are " + native_versions.run_label(baseline) + ". "
                     "The original inputs and parameter profile accompany these results. Nitrogen and phosphorus "
                     "are delivered in kg per pixel per year; sediment is in metric tonnes per pixel per year. "
                     "Native per-hectare rates are multiplied by the actual " + cells["hectares"] + "-ha cell area.",
                     *[scientific_report.link(
                         model.upper() + " reference — " + native_versions.version_label(info), guide)
                       for model, info in baseline_versions.items()
                       if (guide := native_versions.guide_url(model, info))]]),
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
                sections = scientific_report.refine_sections(
                    sections, workspace=workspace, baseline=baseline, alternatives=alternatives,
                    comparison=comparison, profile=profile, grid=grid, priority=state["priority"],
                    observation_results=observation_results,
                    receptor_inventory=state.get("receptor_inventory"),
                )
                sections.extend(scenario_treatment_report.sections(
                    summary, baseline_run_id=baseline["id"],
                    alternative_run_ids=[run["id"] for run in alternatives]))
                if study_mode:
                    sections = [("Land-cover alternatives" if heading == "Future conservation and development scenarios" else heading, blocks)
                                for heading, blocks in sections]
                    sections.insert(0, ("Original native study", [
                        state["native_study"]["title"], state["native_study"]["purpose"],
                        *([state["native_study"]["reference"]] if state["native_study"].get("reference") else []),
                        *state["native_study"]["methods"],
                        "Original study metadata, reporting polygon, model domain, mask and biophysical table are retained under native-study."]))
                sections.extend(scientific_report.receiving_sections(water_product))
                sections.extend(analysis_delivery.report_sections(analysis_product))
                sections.extend(decision_delivery.report_sections(decision_product))
                sections.extend(scientific_sections(economic_decision, state))
                if observed_product is not None:
                    sections.extend(observed_product["sections"])
                sections.extend(scientific_report.economic_coverage_sections(economic_decision))
                sections.extend(scientific_report.delivery_sections(
                    state, working_archive_path=working_relative))
                target = directory / "report.pdf"
                scientific_report.report_pdf(target, report_title,
                                             sections, contact=contact, source_records=records)
                state["files"].update(scientific_report.write_companions(
                    directory, report_title, sections,
                    contact=contact, source_records=records,
                    binding={
                        "delivery_id": key, "delivery_mode": native_study.mode(selection),
                        "native_study": state.get("native_study"), "baseline_run_id": baseline["id"],
                        "native_version_provenance": version_provenance,
                        "native_execution": state["files"]["native_execution"],
                        "scenario_run_ids": scenario_ids, "profile_id": profile["id"],
                        "grid_id": grid["id"], "grid_measurements": cells, "comparison_id": comparison["id"],
                        "observation_comparison_ids": selection.get("observation_comparison_ids", []),
                        "receiving_water_identity": (water_product["inventory"]["identity"]
                                                     if water_product else None),
                        "source_scenario_analysis_id": selection.get("source_scenario_analysis_id"),
                        "source_scenario_analysis_sha256": selection.get("source_scenario_analysis_sha256"),
                        "source_report_id": selection.get("source_report_id"),
                        "source_report_sha256": selection.get("source_report_sha256"),
                        "source_report": report_link, "economic_decision": economic_link,
                        "source_decision": decision_link,
                        "client_report_edition": CLIENT_REPORT_EDITION,
                        "observed_context": observed_link,
                    },
                ))
                state["files"]["report"] = describe_file(directory, target)
                atomic_json(state_path, state)
            companion_keys = ("client_report", "client_report_html",
                              "client_report_markdown", "client_report_model",
                              "client_report_briefing", "client_report_briefing_index")
            if not all(name in state["files"] for name in companion_keys):
                generated = client_report.build_report(
                    workspace=workspace, directory=directory, selection=selection,
                    state=state, baseline=baseline, alternatives=alternatives,
                    grid=grid, profile=profile, records=records,
                    observation_results=observation_results, comparison=comparison,
                    scenario_summary=summary,
                    decision_product=decision_product, observed_product=observed_product,
                    additional_sections=receiving_water_delivery.report_section(water_product),
                    output_stem="client-report", file_key_prefix="client_",
                    working_archive_path=working_relative)
                for name, relative in generated.items():
                    state["files"][name] = describe_file(directory, directory / relative)
                state["client_companion_edition"] = client_report.REPORT_EDITION
                atomic_json(state_path, state)
            archive_roles = {"working_archive", "manifest", "package_index", "delivery_archive"}
            manifest = {"schema": native_study.SCHEMA if study_mode else "upstate-ec-sdc-2026/delivery-v1",
                "grid": {"schema": "upstate.retained-grid/v1", "id": grid["id"],
                         "record": state["files"]["native_grid_record"]["path"],
                         "audit_scope": _delivery_audit_scope(selection, grid)},
                "model": {"name": "InVEST NDR and SDR", "version": common_version,
                          "versions": versions, "native_version_provenance": version_provenance,
                          "application_version": INVEST_VERSION,
                          "execution_provenance": state["files"]["native_execution"],
                          "upstream_buffer_m": grid["spec"]["upstream_buffer_m"],
                          "baseline_run_id": baseline["id"], "scenario_run_ids": scenario_ids,
                          "profile_id": profile["id"], "grid_id": grid["id"]},
                "source_data": records, "rasters": {},
                "maps": maps, "report_pdf": state["files"]["report"]["path"],
                "report_edition": CLIENT_REPORT_EDITION,
                "report_renderer_version": scientific_report.REPORT_VERSION,
                "client_companion_edition": client_report.REPORT_EDITION,
                "delivery_edition": DELIVERY_EDITION,
                "project_assets": [state["files"]["combined_priority"]["path"],
                                   working_relative,
                                   state["files"]["display_scales"]["path"]]}
            for name in rasters.MASS_UNITS:
                manifest["rasters"][name] = {"path": state["files"][name]["path"],
                    "fgdc_xml": state["files"][name + "_metadata"]["path"], "units": rasters.MASS_UNITS[name]}
            primary_files = set(rasters.MASS_UNITS) | {
                name + "_metadata" for name in rasters.MASS_UNITS} | {
                "report", "manifest", "package_index", "delivery_archive"}
            map_paths = {item["path"] for item in state["maps"].values()}
            manifest["project_assets"] = list(dict.fromkeys(
                [item["path"] for name, item in state["files"].items()
                 if name not in primary_files and name not in archive_roles
                 and item["path"] not in map_paths] + [working_relative]))
            if report_link is not None:
                manifest["source_report"] = report_link
            if economic_link is not None:
                manifest["economic_decision"] = economic_link
            manifest["client_report"] = {
                "edition": CLIENT_REPORT_EDITION, "renderer": scientific_report.REPORT_VERSION,
                **{name: state["files"][name]["path"] for name in
                   ("report", "report_html", "report_markdown", "report_data")}}
            manifest["client_companion"] = {
                "edition": client_report.REPORT_EDITION,
                **{name: state["files"][name]["path"] for name in companion_keys}}
            if study_mode:
                manifest["delivery_mode"] = "native_study"
                manifest["native_study"] = state["native_study"]
            audit_manifest = directory / "delivery.json"
            receiving_water_delivery.extend_assets(manifest, state)
            analysis_delivery.extend_assets(manifest, state)
            decision_delivery.extend_assets(manifest, state)
            for report_name in ("report_html", "report_markdown", "report_data"):
                report_path = state["files"][report_name]["path"]
                if report_path not in manifest["project_assets"]:
                    manifest["project_assets"].append(report_path)
            # A stable, unique inventory also keeps retries of the final snapshot identical.
            manifest["project_assets"] = sorted(set(
                manifest["project_assets"] + [atlas_browser.BROWSER_PATH]))
            # The browser includes the final scientific/client/analysis inventory.
            # Omit derived package descriptors from its view: a previous working ZIP
            # checksum would change this captured HTML again on every retry.
            atlas_state = {**state, "files": {
                name: item for name, item in state["files"].items()
                if name not in archive_roles}}
            state["files"][atlas_browser.BROWSER_KEY] = atlas_browser.write(
                directory, atlas_state, manifest)
            # Capture the exact final manifest too, so the restored offline atlas
            # can open delivery.json. It names the fixed working path, not ZIP bytes.
            atomic_json(audit_manifest, manifest)
            state["files"]["manifest"] = describe_file(directory, audit_manifest)
            atomic_json(state_path, state)
            working = directory / working_relative
            working.parent.mkdir(parents=True, exist_ok=True)
            snapshot = {
                **{name: item for name, item in state["files"].items()
                   if name not in archive_roles and item["path"] != working_relative},
                "manifest": state["files"]["manifest"],
                **{"map_" + name: item for name, item in state["maps"].items()}}
            registered = state["files"].get("working_archive")
            if registered is not None:
                retained_working = verify_file(directory, registered)
                if retained_working.resolve() != working.resolve():
                    raise ValueError("Registered working archive has a different original path")
            if working.exists():
                previous = portable.inspect_archive(working, verify=True)
                captured = previous.get("delivery", {})
                retained = captured.get("files", {})
                matches = (
                    previous["project"] == workspace.project
                    and captured.get("id") == state["id"]
                    and captured.get("record", {}).get("selection") == state["selection"]
                    and set(retained) == set(snapshot)
                    and all(retained[name].get("path") == "delivery/" + item["path"]
                            and all(retained[name].get(field) == item[field]
                                    for field in ("bytes", "sha256"))
                            for name, item in snapshot.items()))
                if not matches:
                    label = "scientific-workspace-previous-" + digest(previous)
                    retained_path = working.with_name(label + ".zip")
                    suffix = 0
                    while retained_path.exists():
                        suffix += 1
                        retained_path = working.with_name(label + "-" + str(suffix) + ".zip")
                    working.rename(retained_path)
                    state["files"].pop("working_archive", None)
                    state.setdefault("previous_working_archives", []).append({
                        "path": retained_path.relative_to(directory).as_posix(),
                        "project_id": previous["project"].get("id"),
                        "delivery_id": captured.get("id"),
                        "reason": "Retained capture selects different delivery assets",
                        "retained_at": now()})
                    atomic_json(state_path, state)
            if not working.exists():
                portable.backup(workspace, working, include_intermediates=True,
                    include_deliveries=False, delivery_root=directory,
                    delivery_files=snapshot, delivery_state=state)
            state["files"]["working_archive"] = describe_file(directory, working)
            atomic_json(state_path, state)
            working_descriptor = state["files"]["working_archive"]
            if working_descriptor["path"] != working_relative:
                raise ValueError("Working archive differs from the report's package-relative link")
            verify_file(directory, working_descriptor)
            source_root = Path(__file__).resolve().parent.parent
            if str(source_root) not in sys.path:
                sys.path.insert(0, str(source_root))
            spec = importlib.util.spec_from_file_location("_upstate_original_package", source_root / "package_delivery.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            package_root = directory / "package"
            package = None
            current_manifest = describe_file(directory, audit_manifest)
            suffix = 0
            while package_root.exists():
                if (package_root / "package.json").is_file():
                    previous_package = read_json(package_root / "package.json")
                    captured_manifest = next((item for item in previous_package.get("artifacts", [])
                                              if item.get("path") == previous_package.get("manifestPath")), None)
                    if (previous_package.get("auditStatus") == "TECHNICAL_PRECHECK_PASS"
                            and not previous_package.get("missing")
                            and captured_manifest is not None
                            and all(captured_manifest.get(name) == current_manifest[name]
                                    for name in ("bytes", "sha256"))):
                        module.verify(package_root)
                        package = previous_package
                        break
                # Keep prior captures and reuse a matching current-manifest sibling.
                suffix += 1
                label = "package-" + current_manifest["sha256"]
                package_root = directory / (label if suffix == 1 else label + "-" + str(suffix))
            if package is None:
                captures = workspace.root / "delivery-captures"
                captures.mkdir(parents=True, exist_ok=True)
                owner = Path(tempfile.mkdtemp(prefix=key + "-", dir=captures))
                captured = owner / "package"
                state["package_capture"] = captured.relative_to(workspace.root).as_posix()
                atomic_json(state_path, state)
                code = module.pack(audit_manifest, captured)
                if code:
                    raise ValueError("Delivery artifact audit requires correction; inspect " + str(captured / "audit.json"))
                captured.replace(package_root)
                owner.rmdir()
                state.pop("package_capture", None)
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
