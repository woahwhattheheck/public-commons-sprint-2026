"""Original saved Monitoring budget choices in the maintained scientific report."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path

from .common import atomic_bytes, atomic_json, file_digest, read_json
from . import monitoring_frontier_comparison as comparison

EDITION = "monitoring-budget-report/2"


def _bundle(path, selection, *, target=None):
    from .monitoring_report_source import _copy_file, _member
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(item.is_dir() for item in archive.infolist()):
            raise ValueError("The original comparison packet has duplicate or directory members")
        for name in names:
            _member(name)
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("schema") != "upstate.monitoring-frontier-comparison-export/v1":
            raise ValueError("Choose the original saved Monitoring comparison packet")
        entries = manifest.get("members", [])
        by_name = {item["path"]: item for item in entries}
        if len(by_name) != len(entries) or set(by_name) != set(names) - {"manifest.json"}:
            raise ValueError("The comparison manifest must retain every original member")
        for name, item in by_name.items():
            if (not isinstance(item.get("bytes"), int) or item["bytes"] < 0
                    or archive.getinfo(name).file_size != item["bytes"]):
                raise ValueError("Original comparison member length differs: " + name)
            checksum = hashlib.sha256()
            with archive.open(name) as stream:
                for data in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(data)
            if checksum.hexdigest() != item["sha256"]:
                raise ValueError("Original comparison member checksum differs: " + name)
        record = json.loads(archive.read("comparison.json"))
        frontier = json.loads(archive.read("native/frontier.json"))
        network = json.loads(archive.read("native/network.json"))
        plans = [json.loads(archive.read("native/plans/" + identity + ".json"))
                 for identity in record["plan_ids"]]
        if (record.get("schema") != comparison.SCHEMA
                or record["id"] != selection["comparison_id"]
                or manifest["comparison_id"] != record["id"]
                or manifest["project_id"] != record["project_id"]
                or manifest["frontier_id"] != record["frontier_id"]
                or frontier["id"] != record["frontier_id"]
                or network["id"] != record["network_id"]
                or [plan["id"] for plan in plans] != record["plan_ids"]):
            raise ValueError("The original packet identifies another saved comparison")
        contexts = {identity: json.loads(archive.read(
            "contexts/" + identity + "/observed-context/context.json"))
            for identity in record["selection"]["context_ids"]}
        from . import utility_monitoring_comparison
        utility_context = utility_monitoring_comparison.read_bundle(
            archive, manifest, record, network, plans)
        if target is not None:
            target.mkdir(parents=True, exist_ok=True)
            for name in sorted(names):
                destination = target.joinpath(*_member(name).parts)
                if destination.exists():
                    expected = by_name.get(name)
                    if expected and (destination.stat().st_size != expected["bytes"]
                                     or file_digest(destination) != expected["sha256"]):
                        raise ValueError("A retained original comparison member changed")
                    if name == "manifest.json" and destination.read_bytes() != archive.read(name):
                        raise ValueError("The retained original comparison manifest changed")
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".comparison-", delete=False) as out:
                    pending = Path(out.name)
                    try:
                        with archive.open(name) as stream:
                            shutil.copyfileobj(stream, out, 1024 * 1024)
                        out.flush()
                        os.fsync(out.fileno())
                    except BaseException:
                        pending.unlink(missing_ok=True)
                        raise
                try:
                    _copy_file(pending, destination)
                finally:
                    pending.unlink(missing_ok=True)
    return {"comparison": record, "frontier": frontier, "network": network,
            "plans": plans, "contexts": contexts, "manifest": manifest,
            "utility_context": utility_context}


def verify(workspace, directory, selection):
    """Check the complete retained packet against its exact native source records."""
    from .monitoring_workspace import MonitoringWorkspace
    from .monitoring_observed_context import inspect as inspect_context
    context = _bundle(directory / "native-monitoring-comparison.zip", selection)
    record = comparison.inspect(workspace, selection["comparison_id"])
    service = MonitoringWorkspace(workspace)
    if context["comparison"] != record:
        raise ValueError("The report's comparison differs from its original native record")
    if (context["frontier"] != service.get("frontiers", record["frontier_id"])
            or context["network"] != service.get("networks", record["network_id"])):
        raise ValueError("The report's frontier or network differs from its original")
    for plan in context["plans"]:
        if plan != service.get("plans", plan["id"]):
            raise ValueError("The report's retained plan differs from its original")
    for identity, value in context["contexts"].items():
        if value != inspect_context(workspace, identity):
            raise ValueError("The report's observed context differs from its original")
    return context


def _amount(cents, currency):
    if cents is None:
        return "Unavailable"
    sign = "-" if cents < 0 else ""
    whole, fraction = divmod(abs(cents), 100)
    return currency + " " + sign + str(whole) + "." + str(fraction).zfill(2)


def _value(value):
    return "Unavailable" if value is None else value


def _sections(context, bridges):
    from .monitoring_report_source import _table, _links
    record = context["comparison"]
    sections = [["Monitoring budget choices", [
        "These choices reopen the original saved frontier. Each row keeps its own solver outcome, "
        "calendar and selected search areas. The selected baseline is " + record["baseline_plan_id"] + ".",
        "Objective and units: " + record["weight_basis"] + ". "
        "Total covered weight includes existing-station baseline support; new covered weight excludes that support.",
        _table(["Plan", "Budget", "Solver outcome", "Search areas", "Total cost", "Total covered weight",
                "New covered weight", "Change from baseline", "Visits"], [
            [row["title"], _amount(row["budget_cents"], row["currency"]), row["status"],
             _value(row["selected_sites"]),
             _amount((row["cost"] or {}).get("total_cents"), row["currency"]),
             _value((row["coverage"] or {}).get("covered_weight")), _value(row["new_covered_weight"]),
             _value((row["delta"] or {}).get("covered_weight")),
             _value(row["calendar"]["visits"] if row["calendar"] else None)]
            for row in record["rows"]]),
        _links([("Complete original comparison packet", "native-monitoring-comparison.zip"),
                ("Printable original comparison report", "native-comparison/report.html"),
                ("Exact comparison table", "native-comparison/comparison.csv"),
                ("Complete saved comparison", "native-comparison/comparison.json"),
                ("Original ordered frontier", "native-comparison/native/frontier.json"),
                ("Original source network and geometry", "native-comparison/native/network.json")]),
        *record["interpretation"],
    ]]]
    by_id = {plan["id"]: plan for plan in context["plans"]}
    for row in record["rows"]:
        plan = by_id[row["plan_id"]]
        delta = row["delta"]
        items = [
            "Original plan: " + row["plan_id"] + ". Solver outcome: " + row["status"] + ".",
            str(row["coverage_meaning"]) + ". Units: " + str(row["weight_basis"]) + ".",
            _links([("Complete original plan and configuration",
                     "native-comparison/native/plans/" + row["plan_id"] + ".json")]),
        ]
        if row["available"]:
            items.append(_links([("Original plan map", "maps/" + row["plan_id"] + ".svg")]))
            items.append(_table(["Cost item", "Original amount"], [
                ["Programme overhead", _amount(row["cost"]["program_overhead_cents"], row["currency"])],
                ["Total", _amount(row["cost"]["total_cents"], row["currency"])],
                ["Budget remaining", _amount(row["cost"]["remaining_cents"], row["currency"])]]))
            items.append("Cost scope: " + str(row["cost"]["scope"]) + ". "
                         + str(row["cost"]["existing_station_costs"]) + ".")
            items.append(_table(["Visit", "Search area", "Date", "Local interval", "Crew", "Status"], [
                [visit["visit_key"], visit["site_id"], visit["date"],
                 visit["start_local"] + "–" + visit["finish_local"], visit["crew"], visit["status"]]
                for visit in plan["calendar"]["visits"]]))
        else:
            items.append("This solver outcome has no available cost, coverage or calendar result.")
        if delta is not None:
            items.append(_table(["Change from selected baseline", "Original search-area IDs"], [
                ["Added", ", ".join(delta["added_search_area_ids"]) or "None"],
                ["Removed", ", ".join(delta["removed_search_area_ids"]) or "None"],
                ["Retained", ", ".join(delta["retained_search_area_ids"]) or "None"]]))
            items.append("Cost change from baseline: " + _amount(delta["total_cost_cents"], row["currency"]) + ".")
        items.extend(str(value) for value in row["diagnostics"] + row["warnings"])
        observed = row["observed"]
        if observed:
            original = context["contexts"][observed["context_id"]]
            items.append(_table(["Observed support", "Original selection"], [
                ["Context", observed["context_id"]],
                ["Source edition", observed["source_binding"]["source_collection_id"]],
                ["Source entry", observed["source_binding"]["source_id"]],
                ["Source period", json.dumps(observed["source_period"], ensure_ascii=False, sort_keys=True)],
                ["Station mapping", json.dumps(observed["station_mapping"], ensure_ascii=False, sort_keys=True)],
                ["Flow scope", json.dumps(observed["flow_scope"], ensure_ascii=False, sort_keys=True)],
                ["Retained campaign revision", observed["campaign_revision_id"] or "Plan-only context"],
                ["Source stations in selected search areas", observed["selected_search_area_source_stations"]],
                ["Original activities in selected search areas", observed["selected_search_area_activities"]],
                ["Original observations in selected search areas", observed["selected_search_area_observations"]],
                ["Same observed source and mapping as baseline", row["same_observed_source_as_baseline"]]]))
            items.append(_table(["Source station", "Native station", "Search area", "Activities", "Observations"], [
                [station["source_station_id"], station["network_station_id"], station["catchment_id"],
                 station["activities"], station.get("observations", 0)]
                for station in observed["selected_station_matches"]]))
            prefix = "native-comparison/contexts/" + original["id"] + "/observed-context/"
            items.append(_links([("Complete original observed-context report", prefix + "report.html"),
                                 ("Exact context and complete original source summaries", prefix + "context.json")]))
            items.extend(observed["interpretation"])
        else:
            items.append("No original observed context is selected for this plan.")
        sections.append(["Budget choice: " + row["title"], items])
    for bridge in bridges:
        sections.append(["Receiving-water planning source: " + bridge["id"], [
            "The retained model domain matches this exact receiving-water source edition.",
            _table(["Item", "Source identity"], [
                ["Original water plan", bridge["plan_id"]],
                ["Analysis", bridge["analysis_id"] or "Source-area mode"],
                ["Method", json.dumps(bridge["method"], ensure_ascii=False, sort_keys=True)],
                ["Original support", json.dumps(bridge["summary"], ensure_ascii=False, sort_keys=True)]]),
            _links([("Complete original receiving-water inputs", bridge["path"]])]]))
    from . import utility_monitoring_comparison
    sections.extend(utility_monitoring_comparison.scientific_sections(context.get("utility_context")))
    return sections



def figure_implementation():
    """Bind the installed vector renderer and projection edition used by new sources."""
    import pyproj
    from reportlab import Version
    from . import scientific_figures, scientific_map_figures
    return {"scientific_figures_sha256": file_digest(scientific_figures.__file__),
            "scientific_map_figures_sha256": file_digest(scientific_map_figures.__file__),
            "pyproj_version": pyproj.__version__, "proj_version": pyproj.proj_version_str,
            "reportlab_version": Version}


def _figures(directory, context):
    """Use the shared vector renderer for complete original budget and geography figures."""
    import math
    from pyproj import CRS, Transformer
    from reportlab.graphics import renderSVG
    from .common import describe_file, digest
    from . import scientific_figures, scientific_map_figures

    record, network = context["comparison"], context["network"]
    feasible = [plan for plan in context["plans"] if plan["status"] in comparison.FEASIBLE]
    if not feasible:
        return {"figures": []}
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
    crs = CRS.from_epsg(5070)
    network_source = describe_file(directory, directory / "native-comparison/native/network.json")
    geometries, layers = {}, []
    xmin = ymin = float("inf")
    xmax = ymax = float("-inf")

    def project(geometry):
        def coordinates(value, depth):
            if depth:
                return [coordinates(child, depth - 1) for child in value]
            x, y = transformer.transform(value[0], value[1])
            if not math.isfinite(x) or not math.isfinite(y):
                raise ValueError("Original Monitoring geometry cannot be projected to EPSG:5070")
            return [x, y, *value[2:]]
        kind = geometry["type"]
        depths = {"Point": 0, "Polygon": 2, "MultiPolygon": 3}
        if kind not in depths:
            raise ValueError("Monitoring figures require the original catchment polygons or station points")
        return {"type": kind, "coordinates": coordinates(geometry["coordinates"], depths[kind])}

    def retain(geometry, identifier, kind):
        nonlocal xmin, ymin, xmax, ymax
        projected = project(geometry)
        key = digest(projected)
        geometries[key] = projected
        for point in scientific_map_figures.positions(projected):
            xmin, xmax = min(xmin, point[0]), max(xmax, point[0])
            ymin, ymax = min(ymin, point[1]), max(ymax, point[1])
        layers.append({"geometry": key, "receptor_id": identifier,
                       "source": network_source, "source_kind": kind})
    for identifier, node in sorted(network["nodes"].items()):
        retain(node["geometry"], identifier, "catchment")
    for station in network["stations"]:
        retain(station["geometry"], station["id"], "station")
    if not layers:
        raise ValueError("The original Monitoring network has no map geometry")
    margin = max(xmax - xmin, ymax - ymin, 1.0) * .08
    bounds = [xmin - margin, ymin - margin, xmax + margin, ymax + margin]
    figures = []
    covered_label = ("Total covered target overlap (ha)" if context.get("utility_context")
                     else "Total covered planning weight")
    currencies = {row["currency"] for row in record["rows"]}
    if len(currencies) != 1:
        raise ValueError("A budget figure requires the original common planning currency")
    currency = next(iter(currencies))
    rows = [row for row in record["rows"] if row["available"]]
    points = [{"x": row["budget_cents"] / 100,
               "y": row["coverage"]["covered_weight"], "plan_id": row["plan_id"],
               "budget_cents": row["budget_cents"], "currency": row["currency"],
               "weight_basis": row["weight_basis"]} for row in rows]
    xmax_plot = max(1.0, max(point["x"] for point in points) * 1.05)
    ymax_plot = max(1.0, max(point["y"] for point in points) * 1.05)
    def ticks(high):
        return [{"value": high * fraction, "label": format(high * fraction, ".6g")}
                for fraction in (0, .25, .5, .75, 1)]
    baseline = [point for point in points if point["plan_id"] == record["baseline_plan_id"]]
    other = [point for point in points if point["plan_id"] != record["baseline_plan_id"]]
    series = []
    if other:
        series.append({"label": "Saved choices", "geometry": "scatter", "marker": "circle", "points": other})
    if baseline:
        series.append({"label": "Selected baseline", "geometry": "scatter", "marker": "square-open", "points": baseline})
    figures.append({
        "id": "saved-budget-coverage", "title": "Saved budgets and planning coverage",
        "caption": "Each point is one original feasible saved plan. Horizontal position is its planning budget in "
                   + currency + "; vertical position is its total covered planning weight, including existing-station "
                   "baseline support. Original weight basis: " + record["weight_basis"] + ". "
                   "The complete table retains every outcome, including unavailable solver results. "
                   "Point spacing does not predict unsolved budgets or measured water-quality improvement.",
        "source_binding": {"comparison_id": record["id"], "frontier_id": record["frontier_id"],
                           "source": describe_file(directory, directory / "native-comparison/comparison.json")},
        "panels": [{"title": "Original feasible budget choices",
                    "x": {"label": "Planning budget (" + currency + ")", "domain": [0, xmax_plot], "ticks": ticks(xmax_plot)},
                    "y": {"label": covered_label, "domain": [0, ymax_plot], "ticks": ticks(ymax_plot)},
                    "series": series}],
    })
    for index, plan in enumerate(feasible, 1):
        selected = set(plan["selected_ids"])
        panel_layers = [{**layer, "role": "receptor" if (
            layer["source_kind"] == "station" or layer["receptor_id"] in selected) else "contribution"}
            for layer in layers]
        title = plan["title"]
        figures.append({
            "id": "saved-plan-map-" + format(index, "04d"), "title": title,
            "caption": "Original network catchments are gray; dark polygon outlines identify the "
                       + str(len(selected)) + " selected catchment search areas. Circles show actual retained source "
                       "station coordinates. All choices use the same map extent. Display transformation is WGS84 "
                       "(EPSG:4326) to NAD83 / Conus Albers (EPSG:5070), preserving every original polygon vertex "
                       "and hole. Grid scale is projected metres. Search areas do not assign future sampling "
                       "coordinates or establish monitoring effectiveness.",
            "source_binding": {"comparison_id": record["id"], "network_id": network["id"],
                               "plan_id": plan["id"], "selected_ids": plan["selected_ids"],
                               "covered_ids": plan["covered_ids"], "source": network_source},
            "method": {"source_crs": "EPSG:4326", "display_crs": "EPSG:5070",
                       "always_xy": True, "simplification": False, "basemap": None,
                       "station_coordinates": "Original retained source points",
                       "original_network_sha256": network_source["sha256"]},
            "geometries": geometries,
            "panels": [{"kind": "projected_geometry_map", "title": title, "bounds": bounds,
                        "crs": {"name": "NAD83 / Conus Albers", "wkt": crs.to_wkt(),
                                "axes": "XY", "units": "metre"},
                        "layers": panel_layers, "legend": [],
                        "role_labels": {"contribution": "Original network catchments",
                                        "receptor": "Selected search areas and source stations"}}],
        })
    spec_path = "figures/monitoring-comparison-spec.json"
    specification = {"schema": "upstate.scientific-figure-spec/v1",
                     "edition": EDITION, "title": record["title"],
                     "rendering": {"width_points": 511.2, **figure_implementation()},
                     "figures": figures}
    atomic_json(directory / spec_path, specification, immutable=True)
    choices = []
    for figure in figures:
        drawings = scientific_figures.panel_drawings(figure, 511.2)
        if len(drawings) != 1:
            raise ValueError("Each saved comparison figure must retain its one native drawing")
        relative = "figures/" + figure["id"] + ".svg"
        atomic_bytes(directory / relative, renderSVG.drawToString(drawings[0]).encode("utf-8"), immutable=True)
        choices.append({"id": figure["id"], "path": relative})
    return {"figure_spec": spec_path, "figures": choices}


def capture(workspace, directory, selection, intent, report):
    """Retain the original packet and typed report sections using the existing producer."""
    from .monitoring_report_source import _copy_file, _bridge_sources, _map_svg
    destination = directory / "native-monitoring-comparison.zip"
    staging = directory / "native-export"
    record = comparison.inspect(workspace, selection["comparison_id"])
    report("capture-original-budget-comparison")
    if not destination.exists():
        result = comparison.export_comparison(workspace, comparison_id=record["id"], export_root=staging)
        path = Path(result["path"])
        if (not path.resolve().is_relative_to(staging.resolve())
                or path.stat().st_size != result["bytes"]
                or file_digest(path) != result["sha256"]):
            raise ValueError("The original comparison export changed before report capture")
        _bundle(path, selection)
        _copy_file(path, destination)
    context = verify(workspace, directory, selection)
    _bundle(destination, selection, target=directory / "native-comparison")
    if staging.exists():
        shutil.rmtree(staging)
    report("retain-budget-maps-and-scientific-context")
    maps = []
    for plan in context["plans"]:
        if plan["status"] in comparison.FEASIBLE:
            name = "maps/" + plan["id"] + ".svg"
            atomic_bytes(directory / name, _map_svg(context["network"], plan), immutable=True)
            maps.append(name)
    figures = _figures(directory, context)
    bridges = _bridge_sources(workspace, directory, {"network": context["network"]}, intent)
    records = {"comparison_id": record["id"], "frontier_id": record["frontier_id"],
               "network_id": record["network_id"], "plan_ids": record["plan_ids"],
               "context_ids": record["selection"]["context_ids"]}
    atomic_json(directory / "comparison-records.json", records, immutable=True)
    summary = {"comparison_id": record["id"], "frontier_id": record["frontier_id"],
               "network_id": record["network_id"], "baseline_plan_id": record["baseline_plan_id"],
               "plan_ids": record["plan_ids"], "plan_count": len(record["plan_ids"]),
               "context_ids": record["selection"]["context_ids"],
               "weight_basis": record["weight_basis"], "rows": record["rows"],
               "catchments": len(context["network"]["nodes"]),
               "stations": len(context["network"]["stations"]),
               "figure_count": len(figures["figures"]),
               **({"utility_presentation_id": context["utility_context"]["record"]["id"]}
                  if context.get("utility_context") else {}),
               "receiving_water_bridge_ids": [bridge["id"] for bridge in bridges]}
    from . import utility_monitoring_comparison
    return {
        "title": selection.get("title") or record["title"], "summary": summary, "records": records,
        "edition": EDITION, "report_context_kind": "monitoring-budget-comparison",
        "sections": _sections(context, bridges), **figures,
        "source_links": ["native-monitoring-comparison.zip", "native-comparison/manifest.json",
                         "native-comparison/comparison.json", "native-comparison/comparison.csv",
                         "native-comparison/native/frontier.json", "native-comparison/native/network.json",
                         "comparison-records.json", "bridge-selection.json"] + maps
                        + utility_monitoring_comparison.source_links(context.get("utility_context")),
    }
