"""Attach original discharge source calendars to retained native scenario analyses."""
from __future__ import annotations

from contextlib import ExitStack
import csv
import hashlib
import html
import io
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse, parse_qs

from .common import atomic_bytes, describe_file, digest, held, read_json, verify_file
from . import rasters
from source import retained_point_sources

VERSION = "1.1.0"
KIND = "scenario-source-contexts"
OUTPUTS = {
    "nitrogen_export": ("Nitrogen", "kg/year"),
    "phosphorus_export": ("Phosphorus", "kg/year"),
    "sediment_export": ("Sediment", "metric_tonnes/year"),
}
ARTIFACTS = {"report": "source-context.html", "json": "source-context.json",
             "native_csv": "native-changes.csv", "calendar_csv": "source-calendar.csv",
             "facilities_csv": "source-facilities.csv"}
INTERPRETATION = [
    "Native changes are alternative minus baseline on the retained common valid cells for each pollutant. Negative change means less modeled annual export to streams.",
    "Discharge quantities describe the original reporting facilities, species and represented calendar periods. Their upstream or downstream relation follows the retained network source and same-reach measures.",
    "The original whole-basin polygon establishes spatial context. Its footprint can include a discharge location downstream of the gauge; polygon membership does not establish upstream contribution.",
    "The selected analysis polygon, original gauge basin and native common valid raster cells describe separate supports. Native quantities remain for the selected analysis polygon and are not recalculated over the displayed geometric intersection.",
    "Native landscape export and reported facility discharge remain separate quantities. A landscape scenario does not imply a facility discharge reduction, and this report does not add the two or estimate their combined delivered river load.",
    "Repeated source context attached to multiple reporting regions represents the same original facility quantities; overlapping regions and repeated contexts are not additive.",
]


def _key(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Select a retained " + name + " identity")
    return value


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Select a retained analysis and source-context links")
    analysis_id = _key(value.get("analysis_id"), "analysis")
    title = str(value.get("title") or "Scenario changes and original discharge sources").strip()
    if not title or len(title) > 240:
        raise ValueError("Use a source-context report title of 1–240 characters")
    links = value.get("links")
    if not isinstance(links, list) or not links:
        raise ValueError("Link at least one retained reporting region to an original source binding")
    result, seen = [], set()
    for item in links:
        if not isinstance(item, dict):
            raise ValueError("Each source-context link must be an object")
        row = {"region_id": item.get("region_id"),
               "binding_id": _key(item.get("binding_id"), "point-source binding"),
               "gauge_id": item.get("gauge_id")}
        if any(not isinstance(row[key], str) or not row[key].strip()
               for key in ("region_id", "gauge_id")):
            raise ValueError("Each link needs the actual analysis region and gauge identifiers")
        identity = tuple(row.values())
        if identity in seen:
            raise ValueError("Keep each region, binding and gauge link once")
        seen.add(identity)
        result.append(row)
    return {"analysis_id": analysis_id, "title": title, "links": result}


def _analysis(workspace, key):
    directory = workspace.root / "analyses" / _key(key, "analysis")
    path = directory / "analysis.json"
    record = read_json(path)
    if (record.get("schema") != "upstate.scenario-analysis/v1"
            or record.get("id") != key or record.get("state") != "complete"):
        raise ValueError("Complete the retained native scenario analysis before adding source context")
    for name in ("regions_gpkg", "physical_csv"):
        if name not in record.get("files", {}):
            raise ValueError("Receive the analysis's original region and physical-result files")
        verify_file(directory, record["files"][name])
    return record, directory, describe_file(directory, path)


def _native_rows(record, region_id):
    rows = [dict(row) for row in record["physical"] if row["region_id"] == region_id]
    expected = {(run, pollutant) for run in record["run_ids"]
                for pollutant in record["comparison_pollutants"]}
    if len(rows) != len(expected) or {(r["run_id"], r["pollutant"]) for r in rows} != expected:
        raise ValueError("The original region needs one physical row for every selected run and pollutant")
    for row in rows:
        if row["pollutant"] not in OUTPUTS or row["units"] != OUTPUTS[row["pollutant"]][1]:
            raise ValueError("The native annual-mass unit differs from its retained pollutant")
        for name in ("baseline_common_sum", "common_sum", "change", "common_area_ha",
                     "common_coverage_fraction"):
            value = row.get(name)
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))
                                      or not math.isfinite(value)):
                raise ValueError("The original native result has a nonfinite physical quantity")
        base, future, change = (row.get(k) for k in ("baseline_common_sum", "common_sum", "change"))
        if base is not None and future is not None:
            if change is None or not math.isclose(change, future - base, rel_tol=1e-12, abs_tol=1e-10):
                raise ValueError("The retained signed native change does not reconcile")
        elif change is not None:
            raise ValueError("The native change lacks common-support baseline or alternative mass")
    return rows


def _companion(view, entry, suffix):
    body = entry["body"]
    relative = Path(body.get("view_path") or body["filename"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("The original source view has an unsafe native path")
    root = Path(view)
    for _ in relative.parts:
        root = root.parent
    matches = [item for item in entry.get("companions", [])
               if str(item.get("source_path") or item.get("view_path") or item.get("filename", ""))
               .replace("\\", "/").endswith(suffix)]
    if len(matches) != 1:
        raise ValueError("Retain the unique original gauge source companion: " + suffix)
    item = matches[0]
    part = Path(item.get("view_path") or item["filename"])
    if part.is_absolute() or ".." in part.parts:
        raise ValueError("The original companion view has an unsafe native path")
    path = root / part
    path.resolve(strict=True).relative_to(root.resolve(strict=True))
    body = path.read_bytes()
    if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
        raise ValueError("The retained gauge source bytes differ")
    return path, {key: item[key] for key in ("sha256", "bytes", "source_path", "view_path", "filename")
                  if key in item}


def _gauge_sources(workspace, selection, gauge_id):
    """Reopen original source closure without requiring the receiver's GIS libraries."""
    choice = selection["relations"]
    view, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    point_path, point_lineage = _companion(view, entry, "routing/originals/gauge_reference.json")
    basin_path, basin_lineage = _companion(view, entry, "routing/originals/gauge_whole_basin.geojson")
    capture_path, capture_lineage = _companion(view, entry, "routing/capture.json")
    reference, basin, capture = read_json(point_path), read_json(basin_path), read_json(capture_path)
    features = reference.get("features", [])
    if (len(features) != 1 or features[0].get("properties", {}).get("identifier") != gauge_id
            or features[0].get("geometry", {}).get("type") != "Point"):
        raise ValueError("The original gauge geometry must identify the selected source-calendar gauge")
    if capture.get("gauge_id") != gauge_id:
        raise ValueError("The original source capture identifies another gauge")
    declared = {}
    for suffix, original in (("routing/originals/gauge_reference.json", point_lineage),
                             ("routing/originals/gauge_whole_basin.geojson", basin_lineage)):
        matches = [item for item in capture.get("source_files", []) if item.get("path") == suffix]
        if len(matches) != 1 or any(matches[0].get(name) != original[name] for name in ("sha256", "bytes")):
            raise ValueError("The original gauge capture and retained source companion differ")
        uri = matches[0].get("url")
        if not isinstance(uri, str) or gauge_id not in urlparse(uri).path.split("/"):
            raise ValueError("The original source URL lacks the selected gauge identity")
        declared[suffix] = matches[0]
    basin_source = declared["routing/originals/gauge_whole_basin.geojson"]
    parameters = parse_qs(urlparse(basin_source["url"]).query)
    split = parameters.get("splitCatchment", [])
    if split != ["false"] or basin_source.get("splitCatchment") is not False:
        raise ValueError("Retain the explicitly declared unsplit whole-catchment source edition")
    source = {"gauge": features[0]["properties"],
              "gauge_reference": point_lineage, "whole_basin": basin_lineage,
              "routing_capture": capture_lineage,
              "source_collection_id": choice["source_collection_id"],
              "source_id": choice["source_id"], "uri": entry["uri"], "vintage": entry["vintage"],
              "gauge_reference_url": declared["routing/originals/gauge_reference.json"]["url"],
              "whole_basin_url": basin_source["url"], "split_catchment": False,
              "source_capture_date": capture.get("source_capture_date"),
              "load_calendar_year": capture.get("load_calendar_year")}
    return reference, basin, source


def _gauge_geometry(workspace, selection, gauge_id, target_crs):
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform, unary_union
    reference, basin, source = _gauge_sources(workspace, selection, gauge_id)
    def original_crs(value):
        declaration = value.get("crs")
        if declaration:
            name = declaration.get("properties", {}).get("name")
            if not name:
                raise ValueError("The original gauge GeoJSON has an unreadable CRS")
            return CRS.from_user_input(name)
        return CRS.from_epsg(4326)
    projector = Transformer.from_crs(original_crs(reference), target_crs, always_xy=True).transform
    point = transform(projector, shape(reference["features"][0]["geometry"]))
    geometries = [shape(row["geometry"]) for row in basin.get("features", [])]
    if not geometries or any(g.is_empty or not g.is_valid or g.geom_type not in ("Polygon", "MultiPolygon")
                              for g in geometries):
        raise ValueError("The original gauge basin requires valid retained polygon geometry")
    projector = Transformer.from_crs(original_crs(basin), target_crs, always_xy=True).transform
    geometry = transform(projector, unary_union(geometries))
    if geometry.is_empty or not geometry.is_valid or geometry.area <= 0:
        raise ValueError("The projected original gauge basin is invalid")
    return geometry, point, {**source, "projected_crs": target_crs.to_string()}


def _gauge_relationships(basis, gauge_id, source):
    from decimal import Decimal
    gauge = source["gauge"]
    for row in basis["facilities"]:
        if row["gauge_id"] != gauge_id:
            continue
        if any(row.get(key) in (None, "") for key in ("gauge_comid", "gauge_reachcode", "gauge_measure")):
            raise ValueError("Retain the original gauge COMID, reach code and measure on each source relationship")
        if (str(row.get("gauge_comid")) != str(gauge.get("comid"))
                or row.get("gauge_reachcode") != gauge.get("reachcode")
                or Decimal(str(row.get("gauge_measure"))) != Decimal(str(gauge.get("measure")))):
            raise ValueError("The retained source relationship and original gauge reach/measure differ")
    if source["load_calendar_year"] != basis["calendar_year"]:
        raise ValueError("The source routing capture and quantity calendar identify different years")

def _prepare(workspace, raw):
    from pyproj import CRS
    selection = _selection(raw)
    record, directory, lineage = _analysis(workspace, selection["analysis_id"])
    geometries, crs = rasters.vector_geometry(
        verify_file(directory, record["files"]["regions_gpkg"]), layer="analysis_regions")
    crs = CRS.from_user_input(crs)
    if not crs.is_projected or len(crs.axis_info) < 2 or any(
            not math.isclose(axis.unit_conversion_factor, 1.0) for axis in crs.axis_info[:2]):
        raise ValueError("Use the native projected metre reporting-region geometry")
    by_id = {row["properties"]["region_id"]: row["geometry"] for row in geometries}
    if len(by_id) != len(geometries):
        raise ValueError("The native analysis region identity is repeated")
    regions = {row["id"]: row for row in record["regions"]}
    bindings, gauges, linked = {}, {}, []
    for link in selection["links"]:
        region_id, binding_id, gauge_id = (link[k] for k in ("region_id", "binding_id", "gauge_id"))
        if region_id not in regions or region_id not in by_id:
            raise ValueError("Select a reporting region retained by this native analysis")
        if binding_id not in bindings:
            binding = workspace._get("point-source-bindings", binding_id)
            basis = retained_point_sources.preview(workspace, binding["selection"])
            if basis["source_signature"] != binding["source_signature"]:
                raise ValueError("The retained binding differs from its exact original source tables")
            bindings[binding_id] = (binding, basis)
        binding, basis = bindings[binding_id]
        groups = [group for group in basis["source_calendar"]["groups"] if group["gauge_id"] == gauge_id]
        if not groups:
            raise ValueError("Select a gauge represented by the original retained source calendar")
        key = (binding_id, gauge_id)
        if key not in gauges:
            gauges[key] = _gauge_geometry(workspace, binding["selection"], gauge_id, crs)
        basin, point, source = gauges[key]
        _gauge_relationships(basis, gauge_id, source)
        region = by_id[region_id]
        if region.is_empty or not region.is_valid or region.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Select a valid positive-area native reporting region")
        overlap = region.intersection(basin).area
        if overlap <= 0 or region.area <= 0:
            raise ValueError("The selected reporting region has no area overlap with this original gauge basin")
        linked.append({
            **link, "region": regions[region_id], "gauge_source": source,
            "spatial_support": {
                "region_area_ha": region.area / 10000.0, "whole_basin_area_ha": basin.area / 10000.0,
                "intersection_area_ha": overlap / 10000.0,
                "region_fraction_in_whole_basin": overlap / region.area,
                "whole_basin_fraction_in_region": overlap / basin.area,
                "gauge_point_inside_or_on_region": bool(region.covers(point)),
                "basis": "Exact original polygon intersection in the retained native projected metre CRS",
                "routing_basis": "Original network relation; polygon overlap does not determine upstream membership"},
            "native_changes": _native_rows(record, region_id),
            "source_calendar": {**basis["source_calendar"], "groups": groups},
            "facilities": [row for row in basis["facilities"] if row["gauge_id"] == gauge_id],
            "cohort_quantities": [row for row in basis["cohort_quantities"] if row["gauge_id"] == gauge_id],
            "observations": binding["observations"], "source_signature": binding["source_signature"],
            "sources": basis["sources"],
        })
    runs = []
    for run in record["runs"]:
        profile = workspace._get("profiles", run["selection"]["profile_id"])
        runs.append({**run, "profile_context": {
            "profile_id": profile["id"], "title": profile.get("title"),
            "model_period": profile.get("model_period"),
            "time_support": profile.get("time_support"),
            "source_vintages": profile.get("source_vintages"),
            "period_note": "Values copied only from declared profile fields; an annual model output does not imply a measured calendar-year observation."}})
    result = {"schema": "upstate.scenario-source-context-preview/v1", "version": VERSION,
              "selection": selection, "analysis_id": record["id"], "analysis_title": record["title"],
              "analysis_source": lineage, "baseline_run_id": record["baseline_run_id"],
              "analysis_selection": record["selection"], "runs": runs,
              "comparison_pollutants": record["comparison_pollutants"],
              "analysis_coverage": record.get("coverage"), "input_binding": record["input_binding"],
              "links": linked, "interpretation": INTERPRETATION}
    result["source_signature"] = digest(result)
    return result


def preview(workspace, selection):
    return _prepare(workspace, selection)


def summaries(workspace, analysis_id=None):
    return [{"id": item["id"], "title": item["selection"]["title"],
             "analysis_id": item["analysis_id"], "version": item["version"],
             "source_signature": item["source_signature"], "link_count": len(item["links"])}
            for item in workspace._list(KIND)
            if analysis_id is None or item["analysis_id"] == analysis_id]


def catalog(workspace, analysis_id):
    record, _, _ = _analysis(workspace, analysis_id)
    bindings = []
    for item in workspace._list("point-source-bindings"):
        bindings.append({"id": item["id"], "calendar_year": item["calendar_year"],
                         "original_facilities": item["original_facilities"],
                         "original_series": item["original_series"],
                         "gauges": sorted({g["gauge_id"] for g in item["source_calendar"]["groups"]}),
                         "observations": item["observations"]})
    return {"analysis_id": analysis_id, "title": record["title"], "regions": record["regions"],
            "bindings": bindings, "reports": summaries(workspace, analysis_id)}


def _csv(rows):
    rows = list(rows)
    columns = list(dict.fromkeys(key for row in rows for key in row))
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        safe = {}
        for key in columns:
            value = row.get(key)
            if isinstance(value, (list, dict)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            safe[key] = "" if value is None else value
        writer.writerow(safe)
    return output.getvalue().encode("utf-8")


def _exports(record):
    native, calendar, facilities = [], [], []
    for index, link in enumerate(record["links"], 1):
        identity = {"link": index, "region_id": link["region_id"], "binding_id": link["binding_id"],
                    "gauge_id": link["gauge_id"]}
        native.extend({**identity, **row} for row in link["native_changes"])
        facilities.extend({**identity, **row} for row in link["facilities"])
        for group in link["source_calendar"]["groups"]:
            for month in group["months"]:
                calendar.append({**identity, **{key: group[key] for key in (
                    "calendar_year", "gauge_relation", "parameter_code", "parameter_name", "amount_unit",
                    "complete_year", "annual_amount", "quantified_period_amount",
                    "selected_permits", "permits_without_species")},
                    **month})
    return {"native_csv": _csv(native), "calendar_csv": _csv(calendar),
            "facilities_csv": _csv(facilities)}


def _html(record):
    e = lambda value: html.escape(str(value) if value is not None else "—")
    def table(headers, rows):
        return ('<div class="table"><table><thead><tr>' +
                "".join("<th>" + e(x) + "</th>" for x in headers) +
                "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row)
                + "</tr>" for row in rows) + "</tbody></table></div>")
    run_names = {r["id"]: r["title"] for r in record["runs"]}
    content = ['<h1>' + e(record["selection"]["title"]) + '</h1>',
               '<p>Retained native analysis: ' + e(record["analysis_title"]) + '</p>',
               '<p>Context report ' + e(record["id"]) + '</p>']
    for link in record["links"]:
        support = link["spatial_support"]
        content.extend(['<section><h2>' + e(link["region"]["title"]) + ' · ' + e(link["gauge_id"]) + '</h2>',
            '<h3>Native landscape changes</h3><p>Change = alternative minus baseline. Negative change means lower modeled annual export on the same valid cells.</p>',
            table(["Run", "Pollutant", "Units", "Baseline", "Alternative", "Signed change",
                   "Common area (ha)", "Common fraction"], [
                [run_names[r["run_id"]], OUTPUTS[r["pollutant"]][0], r["units"],
                 r.get("baseline_common_sum"), r.get("common_sum"), r.get("change"),
                 r.get("common_area_ha"), r.get("common_coverage_fraction")]
                for r in link["native_changes"]]),
            '<h3>Original source calendar · ' + e(link["source_calendar"]["calendar_year"]) + '</h3>',
            ('<p>' + e(link["source_calendar"]["method"]) + '</p>' if record["version"] != "1.0.0" else ''),
            '<p>Each species retains its actual reporting period. A blank annual amount means complete-year coverage is unavailable; quantified-period quantities remain visible.</p>',
            table(["Relation", "Species", "Units", "Complete annual amount", "Quantified-period amount",
                   "Complete year", "Peak complete month"], [
                 [g["gauge_relation"], g["parameter_name"] + " (" + g["parameter_code"] + ")",
                  g["amount_unit"], g["annual_amount"], g["quantified_period_amount"],
                  g["complete_year"], g.get("peak_complete_month")]
                 for g in link["source_calendar"]["groups"]]),
            '<h3>Actual facility network relationships</h3>',
            table(["Facility", "Permit", "Mapped outfall", "Relation to gauge", "Inside whole-basin polygon"], [
                [r["facility_name"], r["permit_id"], r["state_outfall_id"], r["gauge_relation"],
                 r["in_original_whole_basin"]] for r in link["facilities"]]),
            '<h3>Spatial coverage</h3>',
            table(["Quantity", "Value"], [[key.replace("_", " "), value] for key, value in support.items()]),
            '<details><summary>Monthly quantities and facility shares</summary>'])
        for group in link["source_calendar"]["groups"]:
            content.append('<h4>' + e(group["gauge_relation"] + " · " + group["parameter_name"]) + '</h4>')
            content.append(table(["Month", "Quantified amount", "Complete cohort amount", "Units"], [
                [m["month"], m["quantified_amount"], m["complete_cohort_amount"], group["amount_unit"]]
                for m in group["months"]]))
            content.append(table(["Facility", "Permit", "Complete annual amount", "Share of complete source cohort (%)"], [
                [r["facility_name"], r["permit_id"], r["annual_amount"], r["annual_share_percent"]]
                for r in group["facility_mix"]]))
        content.extend(['</details><details><summary>Original source and observation lineage</summary><pre>' +
                        e(json.dumps({key: link[key] for key in ("binding_id", "gauge_source", "sources", "observations")},
                                     indent=2, ensure_ascii=False)) + '</pre></details></section>'])
    content.append('<section><h2>Interpretation</h2>' + "".join("<p>" + e(t) + "</p>" for t in record["interpretation"])
                   + '<details><summary>Retained native profiles and periods</summary><pre>'
                   + e(json.dumps(record["runs"], indent=2, ensure_ascii=False)) + '</pre></details></section>')
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
            '<title>' + e(record["selection"]["title"]) + '</title><style>'
            'body{max-width:1440px;margin:auto;padding:28px;font:14px/1.5 system-ui;color:#20242a;background:#fff}'
            'h1{font-size:26px}h2{font-size:21px}h3{font-size:17px}section{border-top:1px solid #bbb;margin-top:28px;padding-top:18px}'
            '.table{overflow:auto}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:8px}'
            'th{background:#f3f4f5}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600}details{margin:16px 0}'
            '@media print{body{padding:0;font-size:10pt}.table{overflow:visible}h2,h3{break-after:avoid}tr{break-inside:avoid}}</style>'
            '<main>' + "".join(content) + '</main></html>').encode("utf-8")


def _materialize(workspace, record, *, workspace_locked=False):
    directory = workspace.root / KIND / record["id"]
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "files.json"
    if manifest.exists():
        saved = read_json(manifest)
        if saved.get("record_digest") != digest(record) or set(saved.get("files", {})) != set(ARTIFACTS):
            raise ValueError("The retained contextual export manifest differs")
        for name, item in saved["files"].items():
            if item.get("path") != ARTIFACTS[name]:
                raise ValueError("The retained contextual artifact name differs")
            verify_file(directory, item)
        return {**record, "files": saved["files"]}
    bodies = _exports(record)
    bodies["report"] = _html(record)
    bodies["json"] = (json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode()
    files = {}
    with ExitStack() as locks:
        if not workspace_locked:
            locks.enter_context(held(workspace.root / ".workspace.lock", blocking=False))
        locks.enter_context(held(directory / ".exports.lock", blocking=False))
        for name, body in bodies.items():
            path = directory / ARTIFACTS[name]
            if path.exists():
                if path.read_bytes() != body:
                    raise ValueError("The retained contextual report artifact differs: " + name)
            else:
                atomic_bytes(path, body, immutable=True)
            files[name] = describe_file(directory, path)
        atomic_bytes(manifest, (json.dumps({"record_digest": digest(record), "files": files},
                     sort_keys=True, allow_nan=False) + "\n").encode(), immutable=True)
    return {**record, "files": files}


def create(workspace, selection, *, expected_signature):
    result = _prepare(workspace, selection)
    if expected_signature != result["source_signature"]:
        raise ValueError("Preview the exact native analysis and original source links before retaining the report")
    with held(workspace.root / ".workspace.lock", blocking=False):
        record = workspace._save(KIND, result)
        return _materialize(workspace, record, workspace_locked=True)


def inspect(workspace, key):
    return _materialize(workspace, workspace._get(KIND, _key(key, "source-context report")))


def artifact(workspace, key, name):
    if name not in ARTIFACTS:
        raise ValueError("Choose a retained source-context report artifact")
    result = inspect(workspace, key)
    return verify_file(workspace.root / KIND / key, result["files"][name]), result["files"][name]


def verify_workspace(workspace):
    """Verify received context dependencies and exports without rerunning native/GIS analysis."""
    results, binding_cache, analysis_cache = [], {}, {}
    for record in workspace._list(KIND):
        if record.get("version") not in ("1.0.0", "1.1.0"):
            raise ValueError("Receive the source-context method matching this saved edition")
        selected = _selection(record["selection"])
        if selected != record["selection"] or len(selected["links"]) != len(record["links"]):
            raise ValueError("The retained context link selection differs")
        signature_body = {key: value for key, value in record.items()
                          if key not in ("id", "schema", "source_signature")}
        signature_body["schema"] = "upstate.scenario-source-context-preview/v1"
        if digest(signature_body) != record["source_signature"]:
            raise ValueError("The retained context preview signature differs")
        analysis_id = selected["analysis_id"]
        if analysis_id not in analysis_cache:
            analysis_cache[analysis_id] = _analysis(workspace, analysis_id)
        analysis, _, original = analysis_cache[analysis_id]
        if (record["analysis_id"] != analysis_id or record["analysis_source"] != original
                or record["analysis_title"] != analysis["title"]
                or record["analysis_coverage"] != analysis.get("coverage")
                or record["analysis_selection"] != analysis["selection"]
                or record["baseline_run_id"] != analysis["baseline_run_id"]
                or record["input_binding"] != analysis["input_binding"]
                or record["comparison_pollutants"] != analysis["comparison_pollutants"]):
            raise ValueError("The contextual report's original native analysis differs")
        for run in record["runs"]:
            original_run = next((r for r in analysis["runs"] if r["id"] == run["id"]), None)
            if original_run is None or {k: v for k, v in run.items() if k != "profile_context"} != original_run:
                raise ValueError("The contextual native run identity differs")
            profile = workspace._get("profiles", run["selection"]["profile_id"])
            context = run["profile_context"]
            if context["profile_id"] != profile["id"] or any(context.get(key) != profile.get(key)
                    for key in ("title", "model_period", "time_support", "source_vintages")):
                raise ValueError("The contextual native profile differs")
        if {run["id"] for run in record["runs"]} != set(analysis["run_ids"]):
            raise ValueError("The contextual report is missing an original native run")
        for selected_link, link in zip(selected["links"], record["links"]):
            if any(link[key] != selected_link[key] for key in selected_link):
                raise ValueError("The retained report has a different original region or source binding")
            region_id, binding_id, gauge_id = (link[k] for k in ("region_id", "binding_id", "gauge_id"))
            region = next((r for r in analysis["regions"] if r["id"] == region_id), None)
            if link["region"] != region or link["native_changes"] != _native_rows(analysis, region_id):
                raise ValueError("The contextual native region or physical results differ")
            if binding_id not in binding_cache:
                binding = workspace._get("point-source-bindings", binding_id)
                basis = retained_point_sources.preview(workspace, binding["selection"])
                if basis["source_signature"] != binding["source_signature"]:
                    raise ValueError("The received point-source binding differs from its original files")
                for observation in binding["observations"]:
                    workspace._get("observations", observation["id"])
                binding_cache[binding_id] = (binding, basis)
            binding, basis = binding_cache[binding_id]
            groups = [g for g in basis["source_calendar"]["groups"] if g["gauge_id"] == gauge_id]
            expected_calendar = {**basis["source_calendar"], "groups": groups}
            if (link["source_signature"] != binding["source_signature"]
                    or link["source_calendar"] != expected_calendar or link["sources"] != basis["sources"]
                    or link["observations"] != binding["observations"]
                    or link["facilities"] != [r for r in basis["facilities"] if r["gauge_id"] == gauge_id]
                    or link["cohort_quantities"] != [r for r in basis["cohort_quantities"] if r["gauge_id"] == gauge_id]):
                raise ValueError("The contextual discharge quantities or original network members differ")
            _, _, source = _gauge_sources(workspace, binding["selection"], gauge_id)
            _gauge_relationships(basis, gauge_id, source)
            original_source = {key: value for key, value in link["gauge_source"].items() if key != "projected_crs"}
            if any(key not in source or value != source[key] for key, value in original_source.items()):
                raise ValueError("The contextual original gauge source differs")
            if record["version"] == "1.1.0" and set(original_source) != set(source):
                raise ValueError("The contextual source capture is incomplete")
        complete = _materialize(workspace, record)
        expected_bodies = _exports(record)
        expected_bodies["report"] = _html(record)
        expected_bodies["json"] = (json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False,
                                             allow_nan=False) + "\n").encode()
        for name, body in expected_bodies.items():
            item = complete["files"][name]
            if item["bytes"] != len(body) or item["sha256"] != hashlib.sha256(body).hexdigest():
                raise ValueError("The contextual export differs from its saved physical/source record: " + name)
        results.append({"id": record["id"], "analysis_id": analysis_id,
                        "linked_sources": len(record["links"]), "artifacts": len(complete["files"]),
                        "source_signature": record["source_signature"]})
    return {"schema": "upstate.scenario-source-context-verification/v1", "reports": results}
