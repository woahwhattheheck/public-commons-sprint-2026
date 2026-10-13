"""Retain a saved native monitoring design/campaign as an ordered report source.

The original exporter owns the plan, calendar, station bindings and event history.
This producer packages those saved decisions; it never solves or revises a plan.
"""
from __future__ import annotations

import copy
import html
import json
import math
import os
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, relative_file,
                     verify_file)

SCHEMA = "upstate.monitoring-report-source/v1"
EDITION = "monitoring-report-source/1"
FOLDER = "monitoring-report-sources"
SOURCE_ID = "monitoring-design-and-field-history"
LOCK = ".monitoring-report-source.lock"


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Choose a saved monitoring design or campaign revision")
    value = copy.deepcopy(value)
    if set(value) - {"title", "plan_id", "campaign_id", "expected_revision_id", "delivery_id"}:
        raise ValueError("Unknown monitoring report selection")
    if bool(value.get("plan_id")) == bool(value.get("campaign_id")):
        raise ValueError("Choose exactly one plan_id or campaign_id")
    if value.get("plan_id"):
        value["plan_id"] = identifier(value["plan_id"])
        if value.get("expected_revision_id") is not None:
            raise ValueError("A plan report does not take a campaign revision")
    else:
        value["campaign_id"] = identifier(value["campaign_id"])
        value["expected_revision_id"] = identifier(value.get("expected_revision_id"))
    for key in ("plan_id", "campaign_id", "expected_revision_id"):
        if value.get(key) is None:
            value.pop(key, None)
    if "title" in value:
        if not isinstance(value["title"], str) or not value["title"].strip():
            raise ValueError("Report title must be nonempty text")
        value["title"] = value["title"].strip()
    if value.get("delivery_id") is not None:
        value["delivery_id"] = identifier(value["delivery_id"])
    else:
        value.pop("delivery_id", None)
    return value


def _member(name):
    path = PurePosixPath(name)
    if (not isinstance(name, str) or not path.parts or path.is_absolute()
            or ".." in path.parts or path.as_posix() != name or "\\" in name or "\0" in name):
        raise ValueError("Nonportable monitoring report member")
    return path


def _record_hash(record):
    return digest({key: value for key, value in record.items() if key != "record_sha256"})


def _copy_file(source, destination):
    """Publish an immutable full file without loading a source raster into memory."""
    source, destination = Path(source), Path(destination)
    size, checksum = source.stat().st_size, file_digest(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.stat().st_size != size or file_digest(destination) != checksum:
            raise ValueError("Retained report member differs: " + str(destination))
        return
    pending = None
    try:
        with source.open("rb") as src, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".report-", delete=False) as out:
            pending = Path(out.name)
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        if pending.stat().st_size != size or file_digest(pending) != checksum:
            raise ValueError("Source changed during monitoring report capture")
        try:
            os.link(pending, destination)
        except FileExistsError:
            if destination.stat().st_size != size or file_digest(destination) != checksum:
                raise ValueError("Concurrent report member differs")
        fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _bundle(path, selection, *, target=None):
    """Verify the native archive's exact manifest and optional safe extraction."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(item.is_dir() for item in archive.infolist()):
            raise ValueError("Native monitoring bundle has duplicate or directory members")
        for name in names:
            _member(name)
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("schema") != "eco.monitoring.export/1":
            raise ValueError("Choose the original Monitoring bundle export")
        entries = manifest.get("files", [])
        by_name = {item["path"]: item for item in entries}
        if len(by_name) != len(entries) or set(by_name) != set(names) - {"manifest.json"}:
            raise ValueError("Native monitoring manifest does not cover every original member")
        import hashlib
        for name, item in by_name.items():
            if not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
                raise ValueError("Invalid native monitoring member length")
            if archive.getinfo(name).file_size != item["bytes"]:
                raise ValueError("Native monitoring member length differs: " + name)
            checksum = hashlib.sha256()
            with archive.open(name) as stream:
                for data in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(data)
            if checksum.hexdigest() != item["sha256"]:
                raise ValueError("Native monitoring member checksum differs: " + name)
        plan = json.loads(archive.read("plan.json"))
        network = json.loads(archive.read("network.json"))
        campaign = json.loads(archive.read("campaign.json")) if "campaign.json" in names else None
        if plan.get("status") not in {"optimal", "feasible"} or plan["network_id"] != network["id"]:
            raise ValueError("A monitoring report requires its original feasible saved design/network")
        if selection.get("plan_id"):
            if plan["id"] != selection["plan_id"] or campaign is not None:
                raise ValueError("Native monitoring bundle identifies another design")
        elif (campaign is None or campaign["campaign_id"] != selection["campaign_id"]
              or campaign["id"] != selection["expected_revision_id"]
              or campaign["plan_id"] != plan["id"] or campaign["network_id"] != network["id"]):
            raise ValueError("Native monitoring bundle identifies another campaign revision")
        events = json.loads(archive.read("events.json"))
        history = json.loads(archive.read("campaign-history.json")) if campaign else []
        if campaign:
            if [event["id"] for event in events] != campaign["event_ids"]:
                raise ValueError("Exported field history differs from the selected revision")
            if not history or history[-1]["id"] != campaign["id"]:
                raise ValueError("Exported campaign history ends at another revision")
        elif events:
            raise ValueError("A saved design report cannot have campaign events")
        if target is not None:
            target.mkdir(parents=True, exist_ok=True)
            for name in sorted(names):
                destination = target.joinpath(*_member(name).parts)
                if destination.exists():
                    expected = by_name.get(name)
                    if expected and (destination.stat().st_size != expected["bytes"]
                                     or file_digest(destination) != expected["sha256"]):
                        raise ValueError("Previously retained native member differs")
                    if name == "manifest.json" and destination.read_bytes() != archive.read(name):
                        raise ValueError("Previously retained native manifest differs")
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False,
                                                  prefix=".extract-") as out:
                    pending = Path(out.name)
                    try:
                        with archive.open(name) as src:
                            shutil.copyfileobj(src, out, 1024 * 1024)
                        out.flush()
                        os.fsync(out.fileno())
                    except BaseException:
                        pending.unlink(missing_ok=True)
                        raise
                try:
                    _copy_file(pending, destination)
                finally:
                    pending.unlink(missing_ok=True)
        return {"plan": plan, "network": network, "campaign": campaign,
                "history": history, "events": events, "manifest": manifest}


def _capture(workspace, directory, selection):
    from .monitoring_workspace import MonitoringWorkspace
    destination = directory / "native-monitoring-bundle.zip"
    staging = directory / "native-export"
    if not destination.exists():
        # A completed native ZIP survives death between export and our checkpoint.
        candidates = sorted(staging.glob("monitoring-export-*/monitoring-field-package.zip"))
        original = None
        for candidate in candidates:
            try:
                _bundle(candidate, selection)
            except (ValueError, KeyError, OSError, zipfile.BadZipFile):
                continue
            original = candidate
            break
        if original is None:
            api = MonitoringWorkspace(workspace, export_root=staging)
            result = api.export(plan_id=selection.get("plan_id"),
                                campaign_id=selection.get("campaign_id"),
                                expected_revision_id=selection.get("expected_revision_id"),
                                format="bundle")
            original = Path(result["path"])
            if not original.resolve().is_relative_to(staging.resolve()):
                raise ValueError("Native exporter returned another operation's file")
            if original.stat().st_size != result["bytes"] or file_digest(original) != result["sha256"]:
                raise ValueError("Native export changed before report intake")
        _bundle(original, selection)
        _copy_file(original, destination)
    context = _bundle(destination, selection, target=directory / "native")
    # Only this producer's private native-export staging is removed after retention.
    if staging.exists():
        shutil.rmtree(staging)
    return context


def _history_sources(workspace, directory, context):
    from .monitoring_workspace import MonitoringWorkspace
    from .monitoring_sources import export_source
    api = MonitoringWorkspace(workspace)
    plan_ids = {context["plan"]["id"]}
    network_ids = {context["network"]["id"]}
    for record in context["history"] + context["events"]:
        plan_ids.add(record["plan_id"])
        network_ids.add(record["network_id"])
    records = []
    for kind, ids in (("plans", plan_ids), ("networks", network_ids)):
        for key in sorted(ids):
            value = api.get(kind, key)
            if kind == "plans":
                network_ids.add(value["network_id"])
            if kind == "networks":
                api.verify_sources(value)
            relative = "history/" + kind + "/" + key + ".json"
            atomic_json(directory / relative, value, immutable=True)
            records.append({"kind": kind, "id": key, "path": relative})
            if kind == "networks":
                for label, binding in value["source_bindings"].items():
                    if binding:
                        for name, body in export_source(workspace, label, binding).items():
                            _member(name)
                            atomic_bytes(directory / "history" / "sources" / key / name, body, immutable=True)
                        collection_id = binding.get("source_collection_id")
                        if collection_id:
                            collection = workspace._get("sources", collection_id)
                            original = collection["original_manifest"]
                            path = relative_file(workspace.root, original["object"])
                            if path.stat().st_size != original["bytes"] or file_digest(path) != original["sha256"]:
                                raise ValueError("Original monitoring source manifest changed")
                            _copy_file(path, directory / "history" / "sources" / key
                                       / "sources" / (label + "-original-manifest.json"))
    for kind, values in (("revisions", context["history"]), ("events", context["events"])):
        for value in values:
            if api.get(kind, value["id"]) != value:
                raise ValueError("Native exported monitoring record differs from immutable Workspace")
            records.append({"kind": kind, "id": value["id"]})
    if api.get("plans", context["plan"]["id"]) != context["plan"]:
        raise ValueError("Native exported plan differs from immutable Workspace")
    if api.get("networks", context["network"]["id"]) != context["network"]:
        raise ValueError("Native exported network differs from immutable Workspace")
    return records


def _bridge_sources(workspace, directory, context, intent):
    """Only exact domain edition/entry matches identify a derived water priority."""
    domain = context["network"]["source_bindings"]["domain"]
    ids_path = directory / "bridge-selection.json"
    if ids_path.exists():
        selected = read_json(ids_path)["bridge_ids"]
    else:
        selected = []
        for path in sorted((workspace.root / "receiving-water-monitoring").glob("*/bridge.json")):
            value = read_json(path)
            if (value.get("source_collection_id") == domain.get("source_collection_id")
                    and value.get("source_id") == domain.get("source_id")
                    and value.get("created_at", "") <= intent["created_at"]):
                selected.append(identifier(value["id"]))
        atomic_json(ids_path, {"bridge_ids": selected}, immutable=True)
    result = []
    if selected:
        from .receiving_water_monitoring import inspect as inspect_bridge
        for key in selected:
            value = inspect_bridge(workspace, key, verify=True)
            if (value["source_collection_id"] != domain.get("source_collection_id")
                    or value["source_id"] != domain.get("source_id")):
                raise ValueError("Receiving-water provenance differs from the exact network domain source")
            root = directory / "receiving-water" / key
            atomic_json(root / "bridge.json", value, immutable=True)
            # Copy the producer's complete original inputs, geometry, method and
            # selected raster. Paths in its record are relative to its own folder.
            source_root = workspace.root / "receiving-water-monitoring" / key
            for item in value["files"].values():
                source = verify_file(source_root, item)
                _copy_file(source, root.joinpath(*_member(item["path"]).parts))
            result.append({"id": key, "mode": value["mode"], "plan_id": value["plan_id"],
                           "analysis_id": value.get("analysis_id"), "method": value["method"],
                           "summary": value["summary"], "path": "receiving-water/" + key + "/bridge.json"})
    return result


def _map_svg(network, plan):
    """Render original polygons and source points; no inferred field coordinates."""
    from pyproj import Transformer
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
    polygons, stations, positions = [], [], []
    for key, node in sorted(network["nodes"].items()):
        geometry = node["geometry"]
        groups = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        projected = []
        for polygon in groups:
            rings = []
            for ring in polygon:
                points = [transformer.transform(point[0], point[1]) for point in ring]
                if any(not math.isfinite(x) or not math.isfinite(y) for x, y in points):
                    raise ValueError("Original monitoring geometry cannot be displayed in EPSG:5070")
                positions.extend(points)
                rings.append(points)
            projected.append(rings)
        polygons.append((key, projected))
    for station in network["stations"]:
        point = station["geometry"]["coordinates"]
        x, y = transformer.transform(point[0], point[1])
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError("Original monitoring station cannot be displayed in EPSG:5070")
        stations.append((station["id"], x, y))
        positions.append((x, y))
    if not positions:
        raise ValueError("Saved monitoring network has no geometry")
    left, right = min(p[0] for p in positions), max(p[0] for p in positions)
    bottom, top = min(p[1] for p in positions), max(p[1] for p in positions)
    scale = min(1120 / max(right - left, 1), 660 / max(top - bottom, 1))
    def xy(point):
        return (40 + (point[0] - left) * scale, 100 + (top - point[1]) * scale)
    selected, covered = set(plan["selected_ids"]), set(plan["covered_ids"])
    pieces = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">',
              '<rect width="1200" height="850" fill="white"/>',
              '<g font-family="sans-serif" fill="#161616"><text x="40" y="35" font-size="23">Saved monitoring design: source geometry</text>',
              '<text x="40" y="60" font-size="14">Dark: selected catchment search areas. Gray: covered context. Circles: actual retained source stations.</text></g>']
    for key, groups in polygons:
        paths = []
        for polygon in groups:
            for ring in polygon:
                points = [xy(point) for point in ring]
                if points:
                    paths.append("M" + " L".join(f"{x:.3f},{y:.3f}" for x, y in points) + " Z")
        fill = "#555555" if key in selected else "#c8c8c8" if key in covered else "#ffffff"
        pieces.append('<path d="' + " ".join(paths) + '" fill="' + fill
                      + '" fill-rule="evenodd" stroke="#808080" stroke-width="0.6"><title>'
                      + html.escape(key) + '</title></path>')
    for key, x, y in stations:
        px, py = xy((x, y))
        pieces.append(f'<circle cx="{px:.3f}" cy="{py:.3f}" r="3" fill="white" stroke="black" stroke-width="1.2"><title>'
                      + html.escape(key) + '</title></circle>')
    pieces.append('<text x="40" y="812" font-family="sans-serif" font-size="13">'
                  'Display projection: NAD83 / Conus Albers (EPSG:5070). Original WGS84 GeoJSON is retained.</text>'
                  '<text x="40" y="835" font-family="sans-serif" font-size="13">'
                  'Catchment selection indicates a search area; only retained station points identify field locations.</text></svg>')
    return "\n".join(pieces).encode("utf-8")


def _table(columns, rows):
    return {"kind": "table", "columns": columns, "rows": rows}


def _links(items):
    return {"kind": "links", "items": [{"title": title, "path": path} for title, path in items]}


def _sections(context, bridges):
    plan, network, campaign = context["plan"], context["network"], context["campaign"]
    events = context["events"]
    if campaign:
        recent = {event["visit_key"]: event for event in events
                  if event["plan_id"] == plan["id"] and event["status"] != "note"}
        visits = []
        for visit in plan["calendar"]["visits"]:
            event = recent.get(visit["visit_key"])
            station = campaign["site_bindings"].get(visit["site_id"])
            visits.append({**visit, "station_id": event.get("station_id") if event else station,
                           "status": event["status"] if event else "planned"})
    else:
        visits = plan["calendar"]["visits"]
    fraction = plan["coverage"]["fraction"]
    coverage = "No positive target weights" if fraction is None else f"{fraction * 100:.3f}%"
    rows = [
        ["Saved design", plan["id"]], ["Network", network["id"]],
        ["Solver outcome", plan["status"]],
        ["Selected catchment search areas", len(plan["selected_ids"])],
        ["Weighted planning coverage", coverage],
        ["Explicit campaign planning cost", str(plan["cost"]["currency"]) + " " + str(plan["cost"]["total_display"])],
        ["Scheduled visits", len(visits)], ["Retained field events", len(events)]]
    if campaign:
        rows += [["Campaign", campaign["campaign_id"]], ["Exact campaign revision", campaign["id"]],
                 ["Revision number", campaign["revision"]]]
    sections = [["Monitoring design and field operations", [
        "This section records an existing feasible monitoring design and, when selected, one exact campaign revision. "
        "Source-derived target weights describe planning priorities. They are not pollutant measurements, "
        "a concentration estimate, or a prediction of monitoring effectiveness.",
        _table(["Item", "Saved value"], rows),
        str(plan["coverage_meaning"]) + ". Weight basis: " + str(plan["weight_basis"]) + ".",
        _links([("Complete original native field package", "native-monitoring-bundle.zip"),
                ("Original Monitoring HTML report", "native/report.html"),
                ("Saved design map (original geometry)", "monitoring-map.svg"),
                ("Editable source catchment geometry", "native/catchments.geojson"),
                ("Original source station points", "native/source-stations.geojson")])
    ]], ["Selected catchment search areas and costs", [
        "Polygons remain catchment search areas. A source station binding is required to identify an actual sampling location.",
        _table(["Catchment", "Stratum", "Complete planning cost", "Rounds", "Covered catchments"],
               [[row["id"], row["stratum"], str(row["cost"]["total_cents"] // 100) + "."
                 + str(row["cost"]["total_cents"] % 100).zfill(2), row["cost"]["rounds"],
                 ", ".join(row["coverage_ids"])] for row in plan["selected"]]),
        "Cost currency: " + str(plan["cost"]["currency"]) + ". Existing station cost treatment: "
        + str(plan["cost"]["existing_station_costs"]) + ".",
        _links([("Full saved configuration and solver result", "native/plan.json"),
                ("Complete selected area table", "native/selected-sites.csv")])
    ]], ["Complete saved field calendar", [
        str(plan["calendar"]["scheduling_basis"]) + ". Calendar times are local wall times.",
        _table(["Visit", "Catchment", "Actual source station", "Date", "Local interval", "Crew", "Status"],
               [[v["visit_key"], v["site_id"], v.get("station_id") or "Unbound search area",
                 v["date"], v["start_local"] + "–" + v["finish_local"], v["crew"], v["status"]] for v in visits]),
        _links([("Original complete field calendar CSV", "native/calendar.csv")])
    ]], ["Retained field events", [
        "Events are the original operator records, including their timestamps, notes and supplied values. "
        "A collected status records a sample collection. It does not establish laboratory validation, "
        "detection limits or a unit conversion. Values below remain exactly as entered.",
        _table(["Event", "Plan", "Station", "Sample", "Status", "Occurred", "Recorded", "Note", "Original values"],
               [[e["id"], e["plan_id"], e.get("station_id") or "", e.get("sample_id") or "",
                 e["status"], e["occurred_at"], e["recorded_at"], e["note"],
                 json.dumps(e.get("values", {}), ensure_ascii=False, sort_keys=True, allow_nan=False)]
                for e in events]),
        _links([("Complete original field event JSON", "native/events.json"),
                ("Original event CSV", "native/events.csv")])
    ]], ["Network and original source bindings", [
        _table(["Source role", "Source edition", "Original entry", "Original body SHA256"],
               [[label, binding.get("source_collection_id") or binding.get("source_record_id"),
                 binding["source_id"], binding["object_sha256"]]
                for label, binding in sorted(network["source_bindings"].items()) if binding]),
        _table(["Station", "Catchment assignment", "Assignment method", "Explicit verified outlet"],
               [[station["id"], station["huc_id"] or "Unassigned", station["assignment"],
                 station["outlet_verified"]] for station in network["stations"]]),
        _links([("Original source bindings", "native/source-bindings.json"),
                ("Full original network and topology", "native/network.json"),
                ("Verified source history inventory", "history-records.json")])
    ]]]
    if campaign:
        sections.append(["Campaign revision history", [
            _table(["Revision", "Record", "Saved plan", "Parent", "Change note"],
                   [[r["revision"], r["id"], r["plan_id"], r.get("parent_id") or "", r.get("note", "")]
                    for r in context["history"]]),
            _links([("Exact selected campaign revision", "native/campaign.json"),
                    ("Complete original revision history", "native/campaign-history.json")])]])
    for bridge in bridges:
        sections.append(["Receiving-water planning source: " + bridge["id"], [
            "This network's exact retained domain edition was produced from the following receiving-water study. "
            "Its original source polygons, support accounting, method and any selected raster are retained.",
            _table(["Item", "Source identity"], [
                ["Mode", bridge["mode"]], ["Original water plan", bridge["plan_id"]],
                ["Original water analysis", bridge["analysis_id"] or "Source-area mode"],
                ["Declared method", json.dumps(bridge["method"], ensure_ascii=False, sort_keys=True)],
                ["Original support summary", json.dumps(bridge["summary"], ensure_ascii=False, sort_keys=True)]]),
            _links([("Complete receiving-water provenance and retained inputs", bridge["path"])])]])
    return sections


def delivery_selection(workspace, source, delivery_id=None):
    """Append once while preserving the existing delivery's other source choices."""
    from . import observed_context
    if delivery_id:
        original = workspace.retained_item("deliveries", identifier(delivery_id))
        selection = copy.deepcopy(original.get("selection"))
        if not isinstance(selection, dict):
            raise ValueError("Selected delivery has no original saved selection")
    else:
        selection = {}
    choices = observed_context.source_choices(selection)
    if source not in choices:
        choices.append(dict(source))
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[observed_context.ROLE] = dict(choices[0])
    selection.pop("observed_context_binding", None)
    return selection


def _result(workspace, record, delivery_id=None):
    return {**record, "delivery_selection": delivery_selection(workspace, record["source"], delivery_id)}


def prepare(workspace, selection, *, progress=None):
    """Capture an exact saved design/revision and import its complete report source."""
    selected = _selection(selection)
    delivery_id = selected.pop("delivery_id", None)
    # Validate an optional saved delivery before the first persistent write.
    if delivery_id:
        original = workspace.retained_item("deliveries", delivery_id)
        if not isinstance(original.get("selection"), dict):
            raise ValueError("Selected delivery has no original saved selection")
    identity = {"edition": EDITION, "workspace_id": workspace.project["id"],
                "selection": selected, "producer_sha256": file_digest(Path(__file__))}
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    def report(stage):
        if progress:
            progress({"stage": stage, "report_source_id": key})
    with held(workspace.root / LOCK, blocking=False):
        if (directory / "report.json").exists():
            return _result(workspace, inspect(workspace, key, verify=True), delivery_id)
        directory.mkdir(parents=True, exist_ok=True)
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent["identity"] != identity:
                raise ValueError("Monitoring report intent differs")
        else:
            intent = {"schema": SCHEMA, "id": key, "identity": identity, "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        prepared = directory / "prepared.json"
        if not prepared.exists():
            report("capture-native-export")
            context = _capture(workspace, directory, selected)
            report("retain-original-source-history")
            records = _history_sources(workspace, directory, context)
            atomic_json(directory / "history-records.json", records, immutable=True)
            bridges = _bridge_sources(workspace, directory, context, intent)
            atomic_bytes(directory / "monitoring-map.svg", _map_svg(context["network"], context["plan"]), immutable=True)
            title = selected.get("title") or (context["campaign"]["title"] if context["campaign"] else context["plan"]["title"])
            companions = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
                          if path.is_file() and not path.name.startswith(".")
                          and not (path.parent == directory and path.name in
                                   {"intent.json", "prepared.json", "report.json", "sources.json", "report-source.json"})]
            from . import observed_context
            recipe = {"schema": observed_context.SCHEMA, "title": title, "edition": EDITION,
                      "report_context_kind": "monitoring-design-and-field-history",
                      "project_id": workspace.project["id"], "inputs": companions,
                      "sections": _sections(context, bridges), "figures": [],
                      "source_links": ["native-monitoring-bundle.zip", "native/manifest.json",
                                       "native/plan.json", "native/network.json", "native/events.json",
                                       "native/calendar.csv", "native/catchments.geojson",
                                       "native/source-stations.geojson", "monitoring-map.svg",
                                       "history-records.json", "bridge-selection.json"]}
            atomic_json(directory / "report-source.json", recipe, immutable=True)
            entry = {"id": SOURCE_ID, "kind": "document", "title": title,
                     "uri": "urn:upstate:monitoring-report:" + workspace.project["id"] + ":" + key,
                     "vintage": intent["created_at"], "path": "report-source.json",
                     "sha256": file_digest(directory / "report-source.json"),
                     "companions": companions, "role": "monitoring-report-source",
                     "metadata": {"report_schema": observed_context.SCHEMA, "planning_weights_are_measurements": False}}
            atomic_json(directory / "sources.json", {"schema": "upstate.sources/v1", "title": title,
                        "captured_at": intent["created_at"], "entries": [entry]}, immutable=True)
            plan, network, campaign = context["plan"], context["network"], context["campaign"]
            summary = {"plan_id": plan["id"], "network_id": network["id"],
                       "campaign_id": campaign["campaign_id"] if campaign else None,
                       "revision_id": campaign["id"] if campaign else None, "status": plan["status"],
                       "selected_catchments": len(plan["selected_ids"]), "catchments": len(network["nodes"]),
                       "stations": len(network["stations"]), "visits": len(plan["calendar"]["visits"]),
                       "events": len(context["events"]), "weight_basis": plan["weight_basis"],
                       "coverage": plan["coverage"], "cost": plan["cost"],
                       "receiving_water_bridge_ids": [b["id"] for b in bridges]}
            atomic_json(prepared, {"title": title, "summary": summary, "records": records}, immutable=True)
        ready = read_json(prepared)
        report("import-original-report-source")
        collection = workspace.import_sources(directory / "sources.json")
        source = {"source_collection_id": collection["id"], "source_id": SOURCE_ID}
        from . import observed_context
        observed_context.bind(workspace, {"observed_context_sources": [source]})
        files = [describe_file(workspace.root, path) for path in sorted(directory.rglob("*"))
                 if path.is_file() and not path.name.startswith(".")
                 and path != directory / "report.json"]
        record = {"schema": SCHEMA, "id": key, "state": "complete", "identity": identity,
                  "title": ready["title"], "created_at": intent["created_at"], "selection": selected,
                  "source": source, "summary": ready["summary"], "files": files}
        record["record_sha256"] = _record_hash(record)
        atomic_json(directory / "report.json", record, immutable=True)
        report("complete")
        return _result(workspace, record, delivery_id)


def inspect(workspace, key, *, verify=True):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    record = read_json(directory / "report.json")
    if (record.get("schema") != SCHEMA or record.get("id") != key
            or digest(record["identity"]) != key or record["identity"]["workspace_id"] != workspace.project["id"]
            or record.get("record_sha256") != _record_hash(record)):
        raise ValueError("Monitoring report source identity changed")
    if verify:
        for item in record["files"]:
            verify_file(workspace.root, item)
        context = _bundle(directory / "native-monitoring-bundle.zip", record["selection"])
        from .monitoring_workspace import MonitoringWorkspace
        api = MonitoringWorkspace(workspace)
        for item in read_json(directory / "history-records.json"):
            value = api.get(item["kind"], item["id"])
            if "path" in item and value != read_json(directory / item["path"]):
                raise ValueError("Monitoring history source differs from its immutable original")
        if api.get("plans", context["plan"]["id"]) != context["plan"]:
            raise ValueError("Saved monitoring report plan changed")
        if api.get("networks", context["network"]["id"]) != context["network"]:
            raise ValueError("Saved monitoring report network changed")
        from . import observed_context
        observed_context.bind(workspace, {"observed_context_sources": [record["source"]]})
    return record


def catalog(workspace):
    """Manifest-only saved source inventory for the existing operator."""
    return [{key: record.get(key) for key in
             ("id", "state", "title", "created_at", "selection", "source", "summary")}
            for path in sorted((workspace.root / FOLDER).glob("*/report.json"))
            for record in [inspect(workspace, path.parent.name, verify=False)]]
