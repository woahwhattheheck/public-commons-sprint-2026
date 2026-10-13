"""Carry an actual saved gauge-support edition into the existing report delivery."""
from __future__ import annotations

import argparse
import copy
import html
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import zipfile

from . import gauge_support, observed_context
from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, read_json, verify_file)

VERSION = "1.0.0"
SCHEMA = "upstate.gauge-report-context/v1"
RECIPE = "gauge-report.json"
MANIFEST = "gauge-report.sources.json"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Gauge report members need canonical relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Gauge report members must stay inside the saved edition")
    return path


def _copy(source, target, item):
    """Copy original members without retaining a second large in-memory body."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
            raise ValueError("Existing gauge report member differs: " + target.name)
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".source-", delete=False) as stream:
            pending = Path(stream.name)
            with Path(source).open("rb") as original:
                shutil.copyfileobj(original, stream, 1024 * 1024)
            stream.flush()
            os.fsync(stream.fileno())
        if pending.stat().st_size != item["bytes"] or file_digest(pending) != item["sha256"]:
            raise ValueError("Original gauge member changed during report intake")
        os.replace(pending, target)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _saved_members(workspace, edition):
    indexed = {}
    package_item = next((item for item in edition["files"]
                         if Path(item["path"]).name == "package.json"), None)
    if package_item is None:
        raise ValueError("The saved gauge edition has no original package manifest")
    package_path = verify_file(workspace.root, package_item)
    package = read_json(package_path)
    if (package.get("schema") != "upstate.gauge-support-package/v1"
            or package.get("build_id") != edition["build_id"]
            or package.get("project_id") != workspace.project["id"]
            or package.get("selection") != edition["selection"]):
        raise ValueError("Gauge report package differs from its saved edition")
    original_root = package_path.parent
    for item in package.get("files", []):
        name = _relative(item["path"]).as_posix()
        path = verify_file(original_root, item)
        if name in indexed:
            raise ValueError("Duplicate original gauge package member: " + name)
        indexed[name] = (path, {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]})
    for item in edition["files"]:
        path = verify_file(workspace.root, item)
        if not path.is_relative_to(original_root):
            raise ValueError("Saved gauge output is outside its original package")
        name = path.relative_to(original_root).as_posix()
        descriptor = {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
        if name in indexed and indexed[name][1] != descriptor:
            raise ValueError("Saved gauge output differs from package member: " + name)
        indexed[name] = (path, descriptor)
    return indexed


def _number(value, digits=3):
    if value is None:
        return "Not available"
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Saved gauge quantities must be finite numeric values")
    return format(value, ",." + str(digits) + "f").rstrip("0").rstrip(".") if digits else format(value, ",.0f")


def _area(value):
    return _number(value / 1e6) if value is not None else "Not available"


def _percent(value):
    return _number(100 * value, 2) + "%" if value is not None else "Not available"


def _table(columns, rows, caption=None):
    result = {"kind": "table", "columns": columns, "rows": rows}
    if caption:
        result["caption"] = caption
    return result


def _links(items):
    return {"kind": "links", "items": [{"title": title, "path": path} for title, path in items]}


def _map(edition, station, catchments, hucs, gauges):
    """Use the saved display geometry and the original desk's local display scale."""
    station_id = station["station_id"]
    selected = next((row for row in catchments["features"]
                     if row.get("properties", {}).get("station_id") == station_id), None)
    point = next((row for row in gauges["features"] if row.get("id") == station_id), None)
    huc_ids = {str(row["huc12"]) for row in station["huc_intersections"]}
    selected_hucs = [row for row in hucs["features"]
                     if str(row.get("properties", {}).get("huc12")) in huc_ids]
    coordinates = []
    def visit(value):
        if isinstance(value, list) and len(value) >= 2 and all(
                isinstance(v, (int, float)) and not isinstance(v, bool) for v in value[:2]):
            if any(not math.isfinite(v) for v in value[:2]):
                raise ValueError("Saved gauge display coordinates must be finite")
            coordinates.append(value[:2])
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for feature in [*selected_hucs, *([selected] if selected else []), *([point] if point else [])]:
        visit(feature["geometry"]["coordinates"])
    if not coordinates:
        return None
    x0, x1 = min(p[0] for p in coordinates), max(p[0] for p in coordinates)
    y0, y1 = min(p[1] for p in coordinates), max(p[1] for p in coordinates)
    cosine = math.cos((y0 + y1) / 2 * math.pi / 180)
    width, height = 1000, 560
    dx, dy = max((x1 - x0) * cosine, .001), max(y1 - y0, .001)
    scale = min((width - 48) / dx, (height - 48) / dy)
    ox, oy = (width - dx * scale) / 2, (height - dy * scale) / 2
    def xy(p):
        return (ox + (p[0] - x0) * cosine * scale, height - oy - (p[1] - y0) * scale)
    def path(geometry):
        if geometry["type"] == "Polygon":
            polygons = [geometry["coordinates"]]
        elif geometry["type"] == "MultiPolygon":
            polygons = geometry["coordinates"]
        else:
            raise ValueError("Saved gauge display requires original polygon geometry")
        return " ".join(" ".join(("M" if i == 0 else "L") + "%.3f,%.3f" % xy(p)
                                for i, p in enumerate(ring)) + " Z"
                        for polygon in polygons for ring in polygon)
    esc = lambda value: html.escape(str(value), quote=True)
    title = "Saved whole catchment, regional HUC12s and gauge " + station_id
    shapes = []
    for feature in selected_hucs:
        props = feature.get("properties", {})
        reporting = props.get("reporting_selected") is True
        shapes.append('<path fill="' + ("#e3e3e3" if reporting else "#fff") +
            '" stroke="#777" stroke-width=".7" fill-rule="evenodd" d="' + path(feature["geometry"]) +
            '"><title>' + esc(str(props.get("huc12", "")) + " " + str(props.get("name", "")) +
                              ("; reporting selection" if reporting else "; upstream context")) + "</title></path>")
    if selected:
        shapes.append('<path fill="none" stroke="#202020" stroke-width="1.8" fill-rule="evenodd" d="' +
                      path(selected["geometry"]) + '"><title>Original upstream whole catchment</title></path>')
    if point:
        x, y = xy(point["geometry"]["coordinates"])
        shapes.append('<circle cx="%.3f" cy="%.3f" r="5" fill="#111" stroke="#fff" stroke-width="1.5">' %
                      (x, y) + "<title>" + esc(station_id) + "</title></circle>")
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560" role="img" aria-labelledby="title desc">'
        '<title id="title">' + esc(title) + '</title><desc id="desc">Saved source geometry. Reporting HUC12s are grey; '
        'upstream context is white; the whole catchment has a dark outline; the gauge is a point. '
        'Locally scaled longitude and latitude are used for display. Reported areas retain EPSG:5070 calculations.</desc>'
        '<rect width="1000" height="560" fill="#fff"/>' + "".join(shapes) + "</svg>")


def _sections(edition, maps):
    result = edition["result"]
    stations = result["stations"]
    summary = result["summary"]
    scope_rows = [[row["scope"].replace("_", " "), row.get("label") or row["id"],
                   _area(row["area_m2"]), _area(row["catchment_union_overlap_m2"]),
                   _percent(row["covered_fraction"])] for row in result["scope_summary"]]
    sections = [
        ["Regional gauge and catchment support", [
            result["title"],
            "Saved Gauge support edition " + edition["id"] + "; regional watershed report " +
            result["regional"]["report_id"] + "; original station geography " + result["station_edition_id"] + ".",
            _table(["Retained support", "Count"], [
                ["Gauge catchments", str(summary["gauge_count"])],
                ["Regional HUC12 polygons", str(summary["regional_huc_count"])],
                ["Selected reporting HUC12s", str(summary["reporting_huc_count"])],
                ["Separate utility areas", str(summary["utility_area_count"])],
                ["Gauge points inside the regional domain", str(summary["gauges_with_point_in_region"])],
                ["Complete numeric flow calendars", str(summary["complete_numeric_flow_gauges"])],
                ["Gauge points outside their supplied whole catchment", str(summary["gauges_outside_own_catchment"])],
            ]),
            "The selected source is NHDPlusV2 upstream whole-catchment support, using "
            "simplified=false and splitCatchment=false. Its original station locations, "
            "source identifiers and geometric relations remain attached to this report.",
        ]],
        ["Gauge locations and original catchment support", [
            _table(["Gauge / original series", "Original name", "Point HUC12", "Point relative to own catchment"],
                [[row["station_id"] + " / " + row["ts_id"], row["station_name"],
                  ", ".join(row["point_huc12s"]) or row["point_membership_status"],
                  row["point_own_catchment_relation"]] for row in stations]),
            _table(["Gauge", "Whole catchment km²", "Inside region km²", "Reporting overlap km²", "Outside region km²"],
                [[row["station_id"], _area(row["catchment_area_m2"]), _area(row["regional_domain_area_m2"]),
                  _area(row["reporting_overlap_area_m2"]), _area(row["outside_regional_domain_area_m2"])]
                 for row in stations]),
        ]],
        ["Original daily-flow support", [
            _table(["Gauge / series", "Numeric days", "Calendar days", "Approved", "Estimated", "Provisional"],
                [[row["station_id"] + " / " + row["ts_id"],
                  str(row["flow"]["totals"]["numeric_day_count"]), str(row["flow"]["totals"]["calendar_days"]),
                  str(row["flow"]["totals"]["approved_numeric_days"]),
                  str(row["flow"]["totals"]["estimated_numeric_days"]),
                  str(row["flow"]["totals"]["provisional_numeric_days"])] for row in stations]),
            "Numeric coverage uses each original site and time-series pair. Approved, estimated and provisional "
            "counts can overlap. Missing dates and nonnumeric responses remain in the original annual records. "
            "Observed-day discharge means retain their original units and periods.",
        ]],
        ["Reporting, upstream and utility scopes", [
            _table(["Scope", "Original selection", "Area km²", "Gauge-catchment union km²", "Intersected"],
                   scope_rows),
            "Catchment coverage uses the saved geometric union. Nested or overlapping gauge catchments "
            "retain their individual relationships and are not added as independent drainage areas. "
            "Reporting selection, full upstream/model domain and utility sources remain separate.",
        ]],
    ]
    for station in stations:
        years = station["flow"]["years"]
        blocks = [
            "Original series " + station["ts_id"] + "; station location status " + station["location_status"] +
            "; point relative to the supplied catchment " + station["point_own_catchment_relation"] + ".",
            _table(["Year", "Numeric / calendar", "Approved", "Estimated", "Provisional", "Observed mean cfs", "Missing / nonnumeric"],
                [[str(row["year"]), str(row["numeric_day_count"]) + " / " + str(row["calendar_days"]),
                  str(row["approved_numeric_days"]), str(row["estimated_numeric_days"]),
                  str(row["provisional_numeric_days"]), _number(row.get("mean_observed_daily_cfs")),
                  str(row.get("missing_date_count", 0)) + " / " + str(row.get("non_numeric_count", 0))]
                 for row in years]),
            _table(["HUC12", "Watershed", "Overlap km²", "Catchment fraction", "HUC fraction", "Reporting"],
                [[row["huc12"], row.get("watershed_name") or "", _area(row["overlap_area_m2"]),
                  _percent(row["catchment_fraction"]), _percent(row["huc_fraction"]),
                  "Selected" if row["reporting_selected"] else "Upstream context"]
                 for row in station["huc_intersections"]]),
        ]
        utility = [row for row in result["utility_intersections"] if row["station_id"] == station["station_id"]]
        if utility:
            blocks.append(_table(["Original utility source / feature", "Overlap km²", "Utility fraction", "Catchment fraction"],
                [[row["label"], _area(row["overlap_area_m2"]), _percent(row["scope_fraction"]),
                  _percent(row["catchment_fraction"])] for row in utility]))
        if station["station_id"] in maps:
            blocks.append(_links([("Original geometry map for " + station["station_id"], maps[station["station_id"]])]))
        sections.append([station["station_id"] + " — " + station["station_name"], blocks])
    sections.append(["Catchment overlap and retained interpretation", [
        _table(["Gauge A", "Gauge B", "Relationship", "Shared area km²", "Fraction A", "Fraction B"],
            [[row["station_a"], row["station_b"], row["relationship"], _area(row["overlap_area_m2"]),
              _percent(row["fraction_a"]), _percent(row["fraction_b"])]
             for row in result["catchment_relationships"]]),
        *[key.replace("_", " ").capitalize() + ". " + text for key, text in result["methods"].items()],
    ]])
    sections.append(["Source-bound maps, original data and complete package", [
        _links([
            ("All saved gauge maps with source identities", "maps/OPEN_GAUGE_MAPS.html"),
            ("Complete saved analysis and original references", "retained/analysis.json"),
            ("Original regional watershed report", "retained/regional-report.json"),
            ("Original gauge support HTML report", "retained/OPEN_GAUGE_SUPPORT.html"),
            ("Original HUC intersections", "retained/gauge-huc-intersections.csv"),
            ("Original annual flow coverage", "retained/annual-flow-coverage.csv"),
            ("Original utility intersections", "retained/utility-intersections.csv"),
            ("Original scope union summary", "retained/scope-summary.csv"),
            ("Original package manifest", "retained/package.json"),
            ("Complete gauge/source ZIP", "retained/gauge-support.zip"),
            ("Original station geography ZIP", "retained/original-station-geography.zip"),
        ]),
        "The SVG and self-contained map HTML use the saved output coordinates and the Gauge support desk's "
        "local longitude/latitude display scale. Reporting HUC12s are grey, upstream context is white, "
        "whole catchments have a dark outline and gauges are points. All numeric areas retain the original "
        "EPSG:5070 results. Original source bodies and companion files accompany the report package.",
    ]])
    return sections


def _map_page(edition, content):
    esc = lambda value: html.escape(str(value), quote=True)
    blocks = []
    for row in edition["result"]["stations"]:
        svg = content.get(row["station_id"])
        blocks.append("<section><h2>" + esc(row["station_id"] + " — " + row["station_name"]) + "</h2><p>"
            "Series " + esc(row["ts_id"]) + "; point relative to own whole catchment: " +
            esc(row["point_own_catchment_relation"]) + ".</p>" +
            (svg if svg else "<p>The saved selection contains no display geometry for this station.</p>") +
            "<p>Whole catchment " + esc(_area(row["catchment_area_m2"])) + " km²; reporting overlap " +
            esc(_area(row["reporting_overlap_area_m2"])) + " km²; observed numeric days " +
            esc(row["flow"]["totals"]["numeric_day_count"]) + " / " +
            esc(row["flow"]["totals"]["calendar_days"]) + ".</p></section>")
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
        "<title>" + esc(edition["title"]) + " — original gauge maps</title><style>"
        "body{font:15px system-ui;color:#202020;background:white;max-width:1100px;margin:30px auto;padding:0 20px}"
        "h1{font-size:25px}h2{font-size:19px}p{line-height:1.5}section{border-top:1px solid #aaa;padding-top:18px;margin-top:26px}"
        "svg{display:block;width:100%;height:auto;border:1px solid #bbb}code{overflow-wrap:anywhere}"
        "@media print{body{margin:0;padding:0}section{break-before:page}svg{max-height:70vh}}</style>"
        "<h1>" + esc(edition["title"]) + "</h1><p>Saved Gauge support edition <code>" + esc(edition["id"]) +
        "</code>. Regional report <code>" + esc(edition["regional"]["report_id"]) + "</code>.</p>"
        "<p>Reporting HUC12s: grey fill. Regional upstream context: white fill. Original upstream whole catchment: "
        "dark outline. Gauge: point. Display uses locally scaled longitude and latitude; reported areas retain "
        "the original EPSG:5070 calculations.</p>" + "".join(blocks) + "</html>")


def delivery_selection(workspace, source, delivery_id=None):
    """Append this exact context to an explicit saved delivery or a fresh form."""
    if delivery_id:
        original = workspace.retained_item("deliveries", identifier(delivery_id))
        selection = copy.deepcopy(original.get("selection"))
        if not isinstance(selection, dict):
            raise ValueError("The selected delivery has no retained source selection")
    else:
        selection = {}
    choices = observed_context.source_choices(selection)
    if source not in choices:
        choices.append(dict(source))
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[observed_context.ROLE] = dict(choices[0])
    selection.pop("observed_context_binding", None)
    return selection



def _directory(workspace, edition, members):
    identity = {"version": VERSION, "report_loader_edition": observed_context.EDITION,
        "workspace_id": workspace.project["id"], "gauge_support_id": edition["id"],
        "build_id": edition["build_id"],
        "members": [item for unused, item in sorted(members.values(), key=lambda pair: pair[1]["path"])]}
    operation_id = digest(identity)
    return operation_id, workspace.root / "gauge-support" / edition["build_id"] / "report-context" / operation_id


def _report_records(workspace, edition, source):
    unused, entry = workspace.source_file(source["source_collection_id"], source["source_id"])
    records = [{"id": observed_context.ROLE, **source, "title": entry["title"],
                "vintage": entry["vintage"], "uri": entry["uri"], "sha256": entry["body"]["sha256"]}]
    for index, item in enumerate(edition["result"]["sources"]):
        records.append({"id": "gauge-original-%03d" % index, "source_id": item["source_id"],
            "source_collection_id": item["collection_id"], "title": item.get("title") or item["source_id"],
            "vintage": item.get("vintage") or "Original retained gauge source",
            "uri": item.get("uri") or "", "sha256": item["source_sha256"]})
    return records


def _render(workspace, directory, edition, prepared):
    """Render the registered Gauge source through the maintained scientific formatter."""
    from . import scientific_report
    selection = delivery_selection(workspace, prepared["source"])
    selection["observed_context_binding"] = observed_context.bind(workspace, selection)
    signature = {"schema": "upstate.gauge-scientific-render/v1",
        "source_binding": selection["observed_context_binding"],
        "formatter_sha256": file_digest(Path(scientific_report.__file__)),
        "collector_sha256": file_digest(Path(observed_context.__file__)),
        "figure_renderer_sha256": file_digest(Path(scientific_report.__file__).with_name("scientific_figures.py")),
        "producer_sha256": file_digest(Path(__file__))}
    output = directory / "reports" / digest(signature)
    output.mkdir(parents=True, exist_ok=True)
    receipt = output / "release.json"
    checkpoint = directory / "standalone.json"
    value = {**prepared, "state": "rendering", "report_signature": signature}
    if receipt.exists():
        release = read_json(receipt)
        if release.get("signature") != signature or release.get("state") != "complete":
            raise ValueError("Saved Gauge report release differs from its source or formatter")
        for item in release["members"]:
            verify_file(workspace.root, item)
        for item in release["files"].values():
            verify_file(workspace.root, item)
        value.update(state="complete", report=release,
                     files=[*prepared["files"], *release["files"].values()])
        atomic_json(checkpoint, value)
        return value
    atomic_json(checkpoint, value)
    members, downloads = {}, {}
    try:
        product = observed_context.collect(workspace, selection, output, {})
        if product is None or product["binding"] != selection["observed_context_binding"]:
            raise ValueError("Rendered Gauge source differs from its original selection")
        for item in product["files"].values():
            path = verify_file(output, item)
            members[item["path"]] = describe_file(workspace.root, path)
        recipe = [item for item in product["files"].values()
                  if Path(item["path"]).name == RECIPE and item["sha256"] == prepared["recipe"]["sha256"]]
        if len(recipe) != 1:
            raise ValueError("The rendered Gauge recipe must retain one original source root")
        # Retain the importable original manifest beside its exact recipe and companions.
        target = output / Path(recipe[0]["path"]).parent / MANIFEST
        original = verify_file(workspace.root, prepared["manifest"])
        _copy(original, target, prepared["manifest"])
        members[target.relative_to(output).as_posix()] = describe_file(workspace.root, target)
        atomic_json(output / "selection.json", selection, immutable=True)
        members["selection.json"] = describe_file(workspace.root, output / "selection.json")
        title = edition["title"] + " — gauge and catchment support"
        records = _report_records(workspace, edition, prepared["source"])
        companions = scientific_report.write_companions(output, title, product["sections"],
            contact={}, source_records=records, binding={"gauge_support_id": edition["id"],
                "regional": edition["regional"], "observed_context": product["binding"],
                "workspace_id": workspace.project["id"], "selection": selection})
        for name, item in companions.items():
            descriptor = describe_file(workspace.root, verify_file(output, item))
            members[item["path"]] = descriptor
            downloads[name] = descriptor
        value.update(files=[*prepared["files"], *downloads.values()])
        atomic_json(checkpoint, value)
        scientific_report.report_pdf(output / "report.pdf", title, product["sections"],
                                     contact={}, source_records=records)
        downloads["report_pdf"] = describe_file(workspace.root, output / "report.pdf")
        members["report.pdf"] = downloads["report_pdf"]
        archive = output / "gauge-scientific-report.zip"
        pending = output / ".gauge-scientific-report.pending"
        try:
            with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as writer:
                for name, item in sorted(members.items()):
                    writer.write(verify_file(workspace.root, item), name)
            pending.replace(archive)
        finally:
            pending.unlink(missing_ok=True)
        downloads["report_archive"] = describe_file(workspace.root, archive)
        downloads["report_selection"] = members["selection.json"]
        release = {"schema": "upstate.gauge-scientific-release/v1", "state": "complete",
            "title": title, "signature": signature, "source": prepared["source"],
            "gauge_support_id": edition["id"], "regional_report_id": edition["regional"]["report_id"],
            "section_count": len(product["sections"]), "source_member_count": len(product["files"]),
            "files": downloads, "members": [members[name] for name in sorted(members)]}
        atomic_json(receipt, release, immutable=True)
        value.update(state="complete", report=release,
                     files=[*prepared["files"], *downloads.values()])
        atomic_json(checkpoint, value)
        return value
    except BaseException as error:
        value.update(state="source_ready", files=[*prepared["files"], *downloads.values()],
            error={"type": type(error).__name__, "message": str(error)})
        atomic_json(checkpoint, value)
        raise


def latest(workspace, edition_id):
    """Reopen the last prepared standalone report in the same restored Workspace."""
    edition = gauge_support.inspect(workspace, identifier(edition_id), verify=True, include_result=True)
    members = _saved_members(workspace, edition)
    operation_id, directory = _directory(workspace, edition, members)
    checkpoint = directory / "standalone.json"
    if not checkpoint.exists():
        return None
    value = read_json(checkpoint)
    if (value.get("operation_id") != operation_id or value.get("gauge_support_id") != edition["id"]
            or value.get("workspace_id") != workspace.project["id"]):
        raise ValueError("Saved scientific report belongs to another Gauge edition")
    for item in value.get("files", []):
        verify_file(workspace.root, item)
    for item in value.get("report", {}).get("members", []):
        verify_file(workspace.root, item)
    if value.get("source"):
        selection = delivery_selection(workspace, value["source"])
        if observed_context.bind(workspace, selection) != value["observed_context_binding"]:
            raise ValueError("Saved Gauge report source binding changed")
    return value


def prepare(workspace, edition_id, *, import_source=True, delivery_id=None, render=True):
    """Prepare actual saved results, register their source and render a standalone report."""
    if not isinstance(render, bool) or not isinstance(import_source, bool):
        raise ValueError("Render and source import must be true or false")
    if render and not import_source:
        raise ValueError("Standalone rendering requires the original native source import")
    edition = gauge_support.inspect(workspace, identifier(edition_id), verify=True, include_result=True)
    if edition["result"].get("project_id") != workspace.project["id"]:
        raise ValueError("Choose a Gauge support edition from this original Workspace")
    if edition["result"].get("schema") != gauge_support.SCHEMA:
        raise ValueError("Saved Gauge support result uses another schema")
    members = _saved_members(workspace, edition)
    operation_id, directory = _directory(workspace, edition, members)
    with held(workspace.root / "locks" / ("gauge-report-" + operation_id + ".lock")):
        directory.mkdir(parents=True, exist_ok=True)
        for name, (path, item) in sorted(members.items()):
            _copy(path, directory / "retained" / _relative(name), item)
        geometries = [read_json(members[name][0]) for name in ("catchments.geojson", "regional-hucs.geojson", "gauges.geojson")]
        maps, contents = {}, {}
        for index, station in enumerate(edition["result"]["stations"]):
            svg = _map(edition, station, *geometries)
            if svg:
                name = "maps/gauge-%03d.svg" % (index + 1)
                atomic_bytes(directory / name, svg.encode("utf-8"), immutable=True)
                maps[station["station_id"]] = name
                contents[station["station_id"]] = svg
        map_html = _map_page(edition, contents)
        atomic_bytes(directory / "maps" / "OPEN_GAUGE_MAPS.html", map_html.encode("utf-8"), immutable=True)
        # Keep every original companion and map under the native source's common root.
        inputs = [describe_file(directory, directory / "retained" / _relative(name)) for name in sorted(members)]
        inputs += [describe_file(directory, directory / name) for name in sorted([*maps.values(), "maps/OPEN_GAUGE_MAPS.html"])]
        recipe = {"schema": observed_context.SCHEMA, "title": edition["title"] + " — gauge support",
            "edition": "gauge-support-report-" + VERSION, "report_context_kind": "gauge_support",
            "project_id": workspace.project["id"], "gauge_support_id": edition["id"],
            "gauge_build_id": edition["build_id"], "regional": edition["regional"],
            "station_edition_id": edition["station_edition_id"], "summary": edition["summary"],
            "original_selection": edition["selection"], "inputs": inputs,
            "sections": _sections(edition, maps),
            "source_links": ["retained/package.json", "retained/gauge-support.zip",
                "retained/analysis.json", "retained/original-station-geography.zip", "maps/OPEN_GAUGE_MAPS.html",
                "retained/catchments.geojson", "retained/regional-hucs.geojson", "retained/gauges.geojson"],
            "figures": []}
        atomic_json(directory / RECIPE, recipe, immutable=True)
        source_id = "gauge-support-report-" + operation_id[:20]
        manifest = {"schema": "upstate.sources/v1", "title": recipe["title"],
            "captured_at": edition["created_at"],
            "scope": {"project_id": workspace.project["id"], "gauge_support_id": edition["id"],
                "regional_report_id": edition["regional"]["report_id"],
                "reporting_huc12s": edition["selection"]["reporting_huc12s"],
                "support_kind": gauge_support.SUPPORT_KIND},
            "entries": [{"id": source_id, "kind": "document", "title": recipe["title"],
                "role": "gauge-support-report-context", "path": RECIPE,
                "uri": "workspace://" + workspace.project["id"] + "/gauge-support/" + edition["id"],
                "vintage": edition["created_at"], "sha256": file_digest(directory / RECIPE),
                "metadata": {"report_schema": observed_context.SCHEMA, "report_context_kind": "gauge_support",
                    "gauge_support_id": edition["id"], "regional_report_id": edition["regional"]["report_id"]},
                "companions": inputs}]}
        atomic_json(directory / MANIFEST, manifest, immutable=True)
        result = {"schema": SCHEMA, "version": VERSION, "operation_id": operation_id,
            "workspace_id": workspace.project["id"], "gauge_support_id": edition["id"],
            "gauge_build_id": edition["build_id"], "regional_report_id": edition["regional"]["report_id"],
            "summary": edition["summary"], "member_count": len(inputs) + 1,
            "source_id": source_id, "manifest": describe_file(workspace.root, directory / MANIFEST),
            "recipe": describe_file(workspace.root, directory / RECIPE),
            "files": [describe_file(workspace.root, directory / name) for name in
                (MANIFEST, RECIPE, "maps/OPEN_GAUGE_MAPS.html", "retained/gauge-support.zip")]}
        if import_source:
            collection = workspace.import_sources(directory / MANIFEST)
            source = {"source_collection_id": collection["id"], "source_id": source_id}
            binding = observed_context.bind(workspace, {"observed_context_sources": [source]})
            result.update(source=source, observed_context_binding=binding)
            atomic_json(directory / "registered-context.json", result, immutable=True)
            result["delivery_selection"] = delivery_selection(workspace, source, delivery_id)
            result["selected_delivery_id"] = delivery_id
            result["state"] = "source_ready"
            if render:
                return _render(workspace, directory, edition, result)
        return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--edition-id", required=True)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--prepare-only", action="store_true", help="Write source files without import or rendering")
    modes.add_argument("--source-only", action="store_true", help="Import the complete source without rendering")
    modes.add_argument("--inspect", action="store_true", help="Reopen the retained standalone report and verified files")
    parser.add_argument("--delivery-id")
    args = parser.parse_args(argv)
    if (args.prepare_only or args.inspect) and args.delivery_id:
        parser.error("--delivery-id requires source preparation and native import")
    workspace = Workspace(args.workspace)
    value = latest(workspace, args.edition_id) if args.inspect else prepare(
        workspace, args.edition_id, import_source=not args.prepare_only,
        delivery_id=args.delivery_id, render=not (args.prepare_only or args.source_only))
    print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
