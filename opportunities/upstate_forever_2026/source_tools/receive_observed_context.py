#!/usr/bin/env python3
"""Receive original observed hydrology, lake study and public-water context."""
from __future__ import annotations

import argparse
import copy
import csv
import html
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

SCHEMA = "upstate.observed-context-receiving/v1"
HYDROLOGY = "observations/observed_hydrology_20261013/model-sources.json"
STUDY = "observations/eighteenmile_2023/model-sources.json"
PUBLIC_WATER = "source/water_context/20261012/public-water"
ASSESSMENT = "assessment"


def _selection(args, application):
    from model.common import file_digest, read_json
    paths = [
        ("assessment", Path(args.assessment_dir or application / ASSESSMENT) / "geography-model-sources.json"),
        ("observed_hydrology", Path(args.hydrology_manifest or application / HYDROLOGY)),
        ("lake_study", Path(args.study_manifest or application / STUDY)),
        ("public_water", Path(args.public_water_dir or application / PUBLIC_WATER) / "sources.public-native.json"),
    ]
    for role, relative in (
            ("reported_discharge", "observations/eighteenmile_2023/npdes/model-sources.json"),
            ("monthly_discharge_flow", "observations/eighteenmile_2023/npdes/flow_context/model-sources.json"),
            ("discharge_routing", "observations/eighteenmile_2023/npdes/routing-model-sources.json"),
            ("lake_paired_analysis", "eighteenmile_lake_paired_analysis.sources.json"),
            ("nutrient_flow", "eighteenmile_routine_nutrient_flow.sources.json"),
            ("calibration_hydrology", "source/hydrology-huc05-07-20261013/model-sources.json"),
            ("calibration_basins", "source/hydrology-huc05-07-20261013/nldi/model-sources.json"),
            ("calibration_geographic_support", "source/hydrology-huc05-07-20261013/nldi/geographic-support-sources.json"),
            ("calibration_station_study", "calibration_station_geography.sources.json"),
            ("study_figures", "eighteenmile_scientific_figures.sources.json"),
            ("flow_report", "observed_hydrology_context.sources.json")):
        context_manifest = application / relative
        if context_manifest.is_file():
            paths.append((role, context_manifest))
    report_manifest = application / "eighteenmile_lake_observation_report.sources.json"
    if report_manifest.is_file():
        paths.append(("lake_report", report_manifest))
    paths.extend(("domain", Path(path)) for path in args.domain_manifest)
    paths.extend(("context", Path(path)) for path in args.context_manifest)
    manifests, seen = [], set()
    for role, path in paths:
        path = path.resolve(strict=True)
        signature = file_digest(path)
        if (role, signature) in seen:
            continue
        seen.add((role, signature))
        manifest = read_json(path)
        if manifest.get("schema") != "upstate.sources/v1" or not manifest.get("entries"):
            raise ValueError("Select a populated original upstate.sources/v1 manifest: " + str(path))
        manifests.append({"role": role, "path": path, "sha256": signature,
                          "title": manifest.get("title", path.name)})
    spec_path = Path(args.public_water_dir or application / PUBLIC_WATER).resolve() / "receiving-waters.public-spec.json"
    identity = {
        "schema": "upstate.observed-context-selection/v1",
        "manifests": [{key: item[key] for key in ("role", "sha256")} for item in manifests],
        "public_water_spec_sha256": file_digest(spec_path),
        "domain_layer_ids": list(dict.fromkeys(args.domain_layer_id)),
        "context_layer_ids": list(dict.fromkeys(args.context_layer_id)),
        "primary_layer_id": args.primary_layer_id,
        "comparison_layer_id": args.comparison_layer_id,
        "mode": args.mode, "paper": args.paper, "dpi": args.dpi,
        "skip_export": bool(args.skip_export),
    }
    return identity, manifests, spec_path


def _public_water(workspace, collection, spec_path, output):
    """Bind the maintained public-water preparation to this actual source import."""
    from model.common import atomic_json, read_json
    from model.receiving_waters import prepare
    from source_tools.prepare_public_source_water import validate_original_selection

    selection = copy.deepcopy(read_json(spec_path))
    receptors = selection.get("receptors", [])
    expected = {"arjws-swpa-1500", "arjws-swpa-200", "prwd-swpa-1500", "prwd-swpa-200"}
    if (selection.get("analysis_crs") != "EPSG:26917" or len(receptors) != 4
            or {item.get("id") for item in receptors} != expected):
        raise ValueError("Select the four original ARJWS/PRWD public-water receptor records")
    validate_original_selection(spec_path.parent, receptors)
    entries = {entry["id"]: entry for entry in collection["entries"]}
    needed = {"scdes-public-surface-intakes-20261012", "scdes-arjws-prwd-swpa-20261012"}
    if not needed.issubset(entries):
        raise ValueError("The public-water import lacks its original intake or protection source")
    for receptor in receptors:
        if receptor.get("relation", {}).get("method") != "source_area":
            raise ValueError("The original public-water selection uses source_area")
        if receptor["source"].get("source_collection_id") not in (None, collection["id"]):
            raise ValueError("The original public-water selection refers to another collection")
        receptor["source"]["source_collection_id"] = collection["id"]
        receptor["metadata"]["intake_reference"]["source_collection_id"] = collection["id"]
    plan = prepare(workspace, selection)
    atomic_json(output / "receiving-waters-spec.json", selection)
    zones = []
    for receptor in receptors:
        metadata = copy.deepcopy(receptor.get("metadata", {}))
        metadata.update(source_plan_id=plan["id"], receptor_ids=[receptor["id"]],
                        source_relation_method="source_area", source_geometry_scope="published_polygon",
                        source_classification=copy.deepcopy(receptor.get("classification", {})))
        zones.append({**copy.deepcopy(receptor["source"]), "id": receptor["id"],
                      "title": receptor["title"], "map_family": receptor["family"],
                      "metadata": metadata})
    source_areas = {
        "schema": "upstate.scenario-source-areas/v1",
        "selection": {"title": "Published source-water planning areas", "zones": zones},
        "origin": {"source_plan_id": plan["id"], "source_collection_id": collection["id"],
                   "analysis_crs": selection["analysis_crs"],
                   "original_protection_sha256": entries["scdes-arjws-prwd-swpa-20261012"]["body"]["sha256"]},
    }
    atomic_json(output / "scenario-source-areas.json", source_areas)
    return {"plan_id": plan["id"], "state": plan["state"], "source_collection_id": collection["id"],
            "analysis_crs": selection["analysis_crs"], "receptor_ids": [item["id"] for item in receptors],
            "selection": "receiving-waters-spec.json", "source_areas": "scenario-source-areas.json"}


def _nutrient_flow(workspace, manifest, collection_id, application, output):
    """Run the original retained endpoint importer against the same Workspace."""
    import subprocess
    from model.common import read_json, file_digest, relative_file

    dated, entry = workspace.source_file(
        collection_id, "observed-hydrology-nutrient-flow-dated-20261013")
    importers = [item for item in entry["companions"]
                 if Path(item.get("source_path", "")).name == "import_into_workspace.py"]
    if len(importers) != 1:
        raise ValueError("Select the single retained original nutrient-flow importer companion")
    original = importers[0]
    body_relative = entry["body"].get("view_path", entry["body"]["filename"])
    view_root = dated
    for _ in Path(body_relative).parts:
        view_root = view_root.parent
    if relative_file(view_root, body_relative) != dated.resolve():
        raise ValueError("The nutrient-flow source view no longer matches its retained primary body")
    script = relative_file(
        view_root, original.get("view_path", original["filename"]))
    if script.stat().st_size != original["bytes"] or file_digest(script) != original["sha256"]:
        raise ValueError("The original nutrient-flow importer differs from its source companion")
    receipt_path = output / "nutrient-flow-observations.json"
    command = [
        sys.executable, "-B", str(script),
        "--application", str(application), "--workspace", str(workspace.root),
        "--manifest", str(manifest), "--output", str(receipt_path),
    ]
    subprocess.run(command, cwd=application, check=True, stdout=sys.stderr, stderr=sys.stderr)
    receipt = read_json(receipt_path)
    if (receipt.get("schema") != "upstate.nutrient-flow-native-import/v1"
            or receipt.get("project_id") != workspace.project["id"]
            or receipt.get("source_collection_id") != collection_id):
        raise ValueError("The nutrient-flow intake returned another original Workspace or source edition")
    return receipt


def _physical_support(workspace, application, manifests, collections, output, state):
    """Extend the same source intake with original routed discharge quantities."""
    from source.import_observation_support import import_sources, MANIFEST, BASE_MANIFEST
    selected = {item["role"]: item for item in manifests
                if item["role"] in {"reported_discharge", "discharge_routing"}}
    if len(selected) != 2:
        return False
    retained = {item["role"]: item for item in collections
                if item["role"] in selected}
    if len(retained) != 2:
        raise ValueError("Import both original discharge and network source editions first")
    receipt = import_sources(
        workspace.root, application, output / "physical-support-observations.json",
        manifest_paths={BASE_MANIFEST: selected["reported_discharge"]["path"],
                        MANIFEST: selected["discharge_routing"]["path"]})
    if (receipt.get("project_id") != workspace.project["id"]
            or receipt["source_collection_id"] != retained["discharge_routing"]["source_collection_id"]
            or receipt["original_source_collection_id"] != retained["reported_discharge"]["source_collection_id"]
            or receipt["source_manifest_sha256"] != selected["discharge_routing"]["sha256"]
            or receipt["original_manifest_sha256"] != selected["reported_discharge"]["sha256"]):
        raise ValueError("Physical support intake returned another selected source edition")
    rows = receipt["observations"]
    if len(rows) != 2 or any(item["admitted_count"] for item in rows):
        raise ValueError("Retain both original outfall quantity views as source context")
    summary = state["observation_import"]
    ids = summary["observation_ids"]
    for item in rows:
        if item["id"] not in ids:
            ids.append(item["id"])
            summary["rows_across_views"] += item["rows"]
            summary["context_rows_across_views"] += item["context_count"]
    summary["views"] = len(ids)
    summary["additional_receipts"] = list(dict.fromkeys([
        *summary.get("additional_receipts", []), "physical-support-observations.json"]))
    state["physical_support_import"] = receipt
    return True


def _calibration_station_studies(workspace, output, state, *, execute=False):
    """Continue the two original-coordinate recipes through the maintained engine."""
    from model.common import atomic_json, describe_file, now, read_json, verify_file
    if not any(item["role"] == "calibration_station_study" for item in state["source_imports"]):
        return False
    study_ids = ("huc05-07-calibration-gauges-13-nwis",
                 "huc05-07-calibration-gauges-13-nldi")
    if not execute:
        previous = state.get("calibration_station_preparations")
        if previous:
            if (previous.get("project_id") != workspace.project["id"]
                    or previous.get("receiving_id") != state["id"]
                    or tuple(item.get("study_id") for item in previous.get("studies", [])) != study_ids):
                raise ValueError("Retain the original calibration station preparation identity")
            for item in previous["studies"]:
                selection = read_json(verify_file(workspace.root, item["selection"]))
                for reference in [*selection["sources"], *selection["watersheds"],
                                  *selection["observation_tables"]]:
                    unused_path, entry = workspace.source_file(
                        reference["collection_id"], reference["source_id"])
                    if entry["body"]["sha256"] != reference["source_sha256"]:
                        raise ValueError("A prepared calibration geography original source changed")
            atomic_json(output / "calibration-station-preparations.json", previous)
            return True
        from model.observed_station_studies import prepare
        prepared = []
        for study_id in study_ids:
            result = prepare(workspace, study_id)
            study = result["study"]
            if not study["ready"]:
                raise ValueError("Prepare the retained calibration station study: " +
                                 "; ".join(study["missing"]))
            selection_path = Path(result["selection_path"])
            prepared.append({
                "study_id": study_id, "title": study["title"],
                "operation_id": result["operation_id"],
                "selection": describe_file(workspace.root, selection_path),
                "source_summary": study["source_summary"],
                "state": "prepared",
            })
        record = {"schema": "upstate.calibration-station-preparations/v1",
                  "project_id": workspace.project["id"], "receiving_id": state["id"],
                  "studies": prepared}
        atomic_json(output / "calibration-station-preparations.json", record)
        state["calibration_station_preparations"] = record
        return True

    from model import station_geography
    prepared = state["calibration_station_preparations"]
    if (prepared["project_id"] != workspace.project["id"]
            or prepared["receiving_id"] != state["id"]
            or tuple(item["study_id"] for item in prepared["studies"]) != study_ids):
        raise ValueError("Continue the original prepared calibration station studies")
    previous = state.get("calibration_station_geography", {})
    completed = {}
    for item in previous.get("studies", []):
        completed[item["study_id"]] = item
    record = {"schema": "upstate.calibration-station-geography/v1",
              "project_id": workspace.project["id"], "receiving_id": state["id"],
              "studies": []}
    state["calibration_station_geography"] = record
    for item in prepared["studies"]:
        selection_path = verify_file(workspace.root, item["selection"])
        selection = read_json(selection_path)
        saved = completed.get(item["study_id"])
        if saved and saved.get("selection") == item["selection"] and saved.get("edition_id"):
            edition = station_geography.inspect(workspace, saved["edition_id"], verify=True)
        else:
            edition = station_geography.build(workspace, selection)
            edition = station_geography.inspect(workspace, edition["id"], verify=True)
        counts = edition["summary"]
        expected = {"station_count": 13, "located_count": 13, "observation_count": 26242,
                    "unassigned_observation_count": 0, "original_candidate_count": 26}
        if any(counts.get(key) != value for key, value in expected.items()):
            raise ValueError("The completed calibration geography differs from its original 13-gauge source counts")
        completed_item = {
            **item, "state": "complete", "edition_id": edition["id"],
            "build_id": edition["build_id"], "summary": counts,
            "files": edition["files"],
        }
        record["studies"].append(completed_item)
        state["updated_at"] = now()
        atomic_json(output / "calibration-station-geography.json", record)
        inventory = read_json(output / "source-inventory.json")["sources"]
        _index(output, state, inventory, {}, workspace)
        retained_files = {item["path"]: item for item in state.get("files", [])}
        for name in ("calibration-station-geography.json", "index.html"):
            descriptor = describe_file(workspace.root, output / name)
            retained_files[descriptor["path"]] = descriptor
        state["files"] = list(retained_files.values())
        atomic_json(output / "receiving.json", state)
    return True


def _source_inventory(workspace, collections, output):
    """Describe original retained tables and point to their complete original bodies."""
    from model.common import file_digest
    records = []
    seen = set()
    for imported in collections:
        collection = workspace._get("sources", imported["source_collection_id"])
        for entry in collection["entries"]:
            key = (collection["id"], entry["id"])
            if key in seen:
                continue
            seen.add(key)
            body = entry["body"]
            path = workspace.root / body["object"]
            if path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
                raise ValueError("The retained observed source body changed: " + entry["id"])
            record = {
                "role": imported["role"], "source_collection_id": collection["id"],
                "source_id": entry["id"], "title": entry["title"], "kind": entry["kind"],
                "uri": entry["uri"], "vintage": entry["vintage"], "units": entry.get("units"),
                "source_crs": entry.get("source_crs"), "filename": body["filename"],
                "bytes": body["bytes"], "sha256": body["sha256"],
                "download": Path(os.path.relpath(path, output)).as_posix(),
                "companion_count": len(entry.get("companions", [])),
                "source_scope": collection.get("scope", {}),
            }
            if entry["kind"] == "document" and Path(body["filename"]).suffix.lower() in {".html", ".htm"}:
                native_path, _ = workspace.source_file(collection["id"], entry["id"])
                record["native_view"] = Path(os.path.relpath(native_path, output)).as_posix()
            if entry["kind"] == "table" and Path(body["filename"]).suffix.lower() in {".csv", ".tsv"}:
                with path.open("r", encoding="utf-8-sig", newline="") as original:
                    reader = csv.DictReader(original, delimiter="\t" if path.suffix.lower() == ".tsv"
                                            or body["filename"].lower().endswith(".tsv") else ",")
                    record["columns"] = reader.fieldnames or []
                    record["rows"] = sum(1 for _ in reader)
            records.append(record)
    return records


def _index(output, state, inventory, assessment, workspace):
    from model.common import atomic_bytes
    e = lambda value: html.escape(str(value), quote=True)
    source_rows = []
    for item in inventory:
        columns = ", ".join(item.get("columns", []))
        source_rows.append(
            "<tr><td>" + e(item["title"]) + "<br><small>" + e(item["source_id"]) +
            "</small></td><td>" + e(item["kind"]) + "</td><td>" + e(item.get("rows", "")) +
            "</td><td>" + e(item.get("units") or item.get("source_crs") or "") +
            "</td><td>" + (("<a href=\"" + e(item["native_view"]) + "\">Open report</a><br>") if item.get("native_view") else "") + "<a href=\"" + e(item["download"]) + "\" download=\"" + e(item["filename"]) +
            "\">Original file</a><br><a href=\"" + e(item["uri"]) + "\">Agency source</a></td></tr>" +
            ("<tr><td colspan=\"5\"><details><summary>Table columns</summary>" + e(columns) +
             "</details></td></tr>" if columns else ""))
    packs = []
    for item in assessment.get("map_packs", []):
        pack_path = workspace.root / "spatial-exports" / item["id"] / "files" / "index.html"
        packs.append("<li><a href=\"" + e(Path(os.path.relpath(pack_path, output)).as_posix()) +
                     "\">" + e(item["title"]) + "</a></li>")
    document = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Observed watershed context</title><style>
:root{font-family:system-ui,sans-serif;color:#202020;background:#fff}body{max-width:1200px;margin:32px auto;padding:0 24px}
h1{font-size:28px}h2{font-size:20px;margin-top:32px}p{line-height:1.5}a{color:inherit}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border:1px solid #ccc;text-align:left;vertical-align:top}
th{background:#f1f1f1}small{overflow-wrap:anywhere}code{overflow-wrap:anywhere}summary{cursor:pointer}
</style><h1>Observed watershed context</h1>
<p>The original observed hydrology, dated lake-study measurements, draft assessment and published source-water areas are retained together in this scientific Workspace. Native vector datums, table units, sampling dates, censor conditions and companion files remain attached to their original source IDs.</p>
"""
    document += "<p>Workspace: " + e(workspace.project["title"]) + "<br>Receiving operation: <code>" + e(state["id"]) + "</code></p>"
    observation_import = state.get("observation_import", {})
    document += "<h2>Dated observation views</h2><p>The existing Observed water quality desk now contains " + e(observation_import.get("views", 0)) + " retained views of original measurements, discharge, stage and available effluent source context. Choose a view, station and parameter to inspect original dated values, censor bounds and coverage. <a href=\"observations.json\">Open the observation import record</a>.</p>"
    if state.get("nutrient_flow_import"):
        document += '<p><a href="nutrient-flow-observations.json">Routine nutrient interval views</a> retain the paired lower and upper endpoints of the same original records, alongside their sampling calendar and flow contrasts.</p>'
    if state.get("physical_support_import"):
        document += '<p><a href="physical-support-observations.json">Original outfall quantities and source calendar</a> retains complete annual and quantified-period quantities, original EPA reporting features, mapped outfalls, species, actual gauge relationships and unknown days in the same observation desk.</p>'
    document += "<h2>Maps and geographic joins</h2>"
    if assessment:
        document += "<ul>" + "".join(packs) + "</ul>"
        document += '<p><a href="assessment/operation.json">Saved native views and source selections</a> · <a href="assessment/station-domain-joins.csv">Original station–watershed joins</a> · <a href="scenario-source-areas.json">Four public-water source areas</a></p>'
    else:
        document += '<p>Original source intake and observation views are complete. Continue this receiving operation to add source-water selections, station–watershed joins and geographic exports.</p>'
    if state.get("calibration_station_preparations"):
        document += '<h2>Calibration gauge geography</h2><p>Two prepared selections retain the original NWIS and NLDI locations of thirteen gauges and link all 26,242 original daily records. <a href="calibration-station-preparations.json">Open the selected sources and coordinate choices</a>.</p>'
        rows = state.get("calibration_station_geography", {}).get("studies", [])
        if rows:
            document += '<ul>'
            for item in rows:
                maps = [entry for entry in item["files"] if Path(entry["path"]).name == "OPEN_STATIONS.html"]
                if maps:
                    href = Path(os.path.relpath(workspace.root / maps[0]["path"], output)).as_posix()
                    document += '<li><a href="' + e(href) + '">' + e(item["title"]) + '</a></li>'
            document += '</ul><p><a href="calibration-station-geography.json">Native geography results</a> retain both original coordinate candidates, whole catchments and any selected original model-domain memberships.</p>'
    document += "<h2>Source tables and geographic layers</h2><p>Table counts describe actual retained rows. Source scope and complete collection identities are in <a href=\"source-inventory.json\">the source inventory</a>. The existing operator Sources desk provides table previews and every original companion download; Spatial review and Exports display these same saved views.</p>"
    document += "<table><thead><tr><th>Source</th><th>Kind</th><th>Rows</th><th>Units / datum</th><th>Open</th></tr></thead><tbody>" + "".join(source_rows) + "</tbody></table>"
    document += "<h2>Reading the observations</h2><p>Gauge discharge and stage keep their original units and quality flags. Laboratory concentrations keep their sample dates, fractions, analytical methods and detection conditions. The published 2023 seasonal statistics and independently reconciled individual activities retain separate source identities. Same-date upstream discharge supplies hydrologic context for the lake samples. The four published public-water protection polygons retain their original regulatory footprint and source-area relation.</p>"
    document += '<p><a href="receiving.json">Receiving record</a> · <a href="source-inventory.json">Complete source inventory</a></p></html>\n'
    atomic_bytes(output / "index.html", document.encode("utf-8"))


def receive(args):
    application = Path(args.app_root or Path(__file__).resolve().parents[1]).resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Choose the complete existing native application root")
    sys.path.insert(0, str(application))
    from model.common import atomic_json, describe_file, digest, held, now, read_json, file_digest
    from model.workspace import Workspace
    workspace = Workspace(Path(args.workspace).resolve(strict=True), create=False)
    selection, manifests, spec_path = _selection(args, application)
    identity = {"project_id": workspace.project["id"], "selection": selection}
    key = digest(identity)
    output = workspace.root / "observed-context" / key
    output.mkdir(parents=True, exist_ok=True)
    state_path = output / "receiving.json"
    sources_only = bool(getattr(args, "sources_only", False))
    with held(output / ".receiving.lock", blocking=False):
        previous = read_json(state_path) if state_path.is_file() else {}
        if previous and (previous.get("id") != key or previous.get("identity") != identity):
            raise ValueError("The retained observed-context operation identity changed")
        if sources_only and previous.get("state") == "complete":
            from model.common import verify_file
            for item in previous.get("files", []):
                verify_file(workspace.root, item)
            if previous.get("calibration_station_preparations"):
                _calibration_station_studies(workspace, output, previous)
            if not previous.get("physical_support_import"):
                upgraded = copy.deepcopy(previous)
                if _physical_support(workspace, application, manifests,
                                     upgraded["source_imports"], output, upgraded):
                    inventory = read_json(output / "source-inventory.json")["sources"]
                    assessment = read_json(output / "assessment" / "operation.json")
                    _index(output, upgraded, inventory, assessment, workspace)
                    receipt = describe_file(workspace.root, output / "physical-support-observations.json")
                    index = describe_file(workspace.root, output / "index.html")
                    upgraded["files"] = [item for item in upgraded["files"]
                                         if item["path"] != index["path"]] + [index, receipt]
                    phase = upgraded.setdefault("source_phase", {
                        "state": "complete", "completed_at": previous.get("updated_at", now()),
                        "sources": len(inventory),
                        "tables": sum(item["kind"] == "table" for item in inventory),
                        "vectors": sum(item["kind"] == "vector" for item in inventory),
                        "files": [item for item in previous["files"] if Path(item["path"]).name in {
                            "source-inventory.json", "observations.json", "nutrient-flow-observations.json"}],
                    })
                    phase["files"].append(receipt)
                    phase["observation_views"] = upgraded["observation_import"]["views"]
                    upgraded["observed_context"]["observation_views"] = phase["observation_views"]
                    upgraded.update(updated_at=now(), application=str(application),
                                    workspace=str(workspace.root))
                    atomic_json(state_path, upgraded)
                    previous = upgraded
            return {**previous, "application": str(application), "workspace": str(workspace.root),
                    "directory": str(output), "index": str(output / "index.html")}
        attempts = copy.deepcopy(previous.get("attempts", []))
        if attempts and attempts[-1].get("state") in (None, "receiving", "running"):
            attempts[-1].update(state="interrupted", ended_at=now(),
                                error={"type": "InterruptedReceivingAttempt",
                                       "message": "A continuation acquired the original operation lock"})
        state = {
            **previous,
            "schema": SCHEMA, "id": key, "identity": identity,
            "state": "receiving", "created_at": previous.get("created_at", now()), "updated_at": now(),
            "application": str(application), "workspace": str(workspace.root),
            "source_imports": previous.get("source_imports", []),
            "attempts": attempts + [{"started_at": now(), "state": "receiving"}],
        }
        state.pop("error", None)
        atomic_json(state_path, state)
        try:
            collections = []
            for item in manifests:
                collection = workspace.import_sources(item["path"])
                record = {key: item[key] for key in ("role", "sha256", "title")}
                record.update(source_collection_id=collection["id"],
                              original_manifest_sha256=collection["original_manifest"]["sha256"],
                              entries=len(collection["entries"]))
                collections.append(record)
                state["source_imports"] = collections
                state["updated_at"] = now()
                atomic_json(state_path, state)
            from measurement_workspace.published_studies import PublishedStudyStore
            study_root = next(item["path"].parent for item in manifests if item["role"] == "lake_study")
            study_result = PublishedStudyStore(
                workspace, workspace.root / "published_studies").import_source(
                    study_root, operation_id=key)
            study_record = study_result["record"]
            state["published_study"] = {
                name: study_record[name] for name in ("study_id", "version_id", "source_collection_id", "counts")}
            state["published_study"]["reused"] = study_result["reused"]
            study_collection = workspace._get("sources", study_record["source_collection_id"])
            collections.append({
                "role": "published_study", "title": study_record["title"],
                "source_collection_id": study_record["source_collection_id"],
                "original_manifest_sha256": study_collection["original_manifest"]["sha256"],
                "entries": len(study_collection["entries"])})
            state["source_imports"] = collections
            state["updated_at"] = now()
            atomic_json(state_path, state)
            from source.import_observed_context import import_context
            context_roles = {
                "lake_study": STUDY,
                "observed_hydrology": HYDROLOGY,
                "monthly_discharge_flow": "observations/eighteenmile_2023/npdes/flow_context/model-sources.json",
            }
            observation_manifests = {
                context_roles[item["role"]]: item["path"]
                for item in manifests if item["role"] in context_roles
            }
            state.update(state="importing_observations", updated_at=now())
            atomic_json(state_path, state)
            observations = import_context(
                workspace.root, application, list(observation_manifests),
                output / "observations.json", manifest_paths=observation_manifests)
            state["observation_import"] = {
                "receipt": "observations.json",
                "observation_ids": [item["id"] for item in observations["observations"]],
                "views": len(observations["observations"]),
                "rows_across_views": sum(item["rows"] for item in observations["observations"]),
                "context_rows_across_views": sum(item["context_count"] for item in observations["observations"]),
            }
            nutrient_manifest = next(
                (item for item in manifests if item["role"] == "nutrient_flow"), None)
            if nutrient_manifest is not None:
                nutrient_collection = next(
                    item for item in collections if item["role"] == "nutrient_flow")
                nutrient = _nutrient_flow(
                    workspace, nutrient_manifest["path"],
                    nutrient_collection["source_collection_id"], application, output)
                state["nutrient_flow_import"] = nutrient
                observation_summary = state["observation_import"]
                observation_summary["additional_receipts"] = ["nutrient-flow-observations.json"]
                observation_summary["observation_ids"].extend(
                    item["id"] for item in nutrient["observations"])
                observation_summary["views"] += len(nutrient["observations"])
                observation_summary["rows_across_views"] += sum(
                    item["rows"] for item in nutrient["observations"])
                observation_summary["context_rows_across_views"] += sum(
                    item["context_count"] for item in nutrient["observations"])
            _physical_support(workspace, application, manifests, collections, output, state)
            _calibration_station_studies(workspace, output, state)
            state["updated_at"] = now()
            atomic_json(state_path, state)
            inventory = _source_inventory(workspace, collections, output)
            atomic_json(output / "source-inventory.json", {
                "schema": "upstate.observed-context-source-inventory/v1",
                "operation_id": key, "project_id": workspace.project["id"], "sources": inventory})
            source_files = ["source-inventory.json", "observations.json"]
            if state.get("nutrient_flow_import"):
                source_files.append("nutrient-flow-observations.json")
            if state.get("physical_support_import"):
                source_files.append("physical-support-observations.json")
            if state.get("calibration_station_preparations"):
                source_files.append("calibration-station-preparations.json")
            state["source_phase"] = {
                "state": "complete", "completed_at": now(),
                "observation_views": state["observation_import"]["views"],
                "sources": len(inventory),
                "tables": sum(item["kind"] == "table" for item in inventory),
                "vectors": sum(item["kind"] == "vector" for item in inventory),
                "files": [describe_file(workspace.root, output / name) for name in source_files],
            }
            state.update(state="sources_complete", updated_at=now())
            _index(output, state, inventory, {}, workspace)
            state["files"] = state["source_phase"]["files"] + [
                describe_file(workspace.root, output / "index.html")]
            atomic_json(state_path, state)
            if sources_only:
                state["attempts"][-1].update(state="sources_complete", completed_at=now())
                atomic_json(state_path, state)
                return {**state, "directory": str(output), "index": str(output / "index.html")}
            state.update(state="mapping_calibration_stations", updated_at=now())
            atomic_json(state_path, state)
            _calibration_station_studies(workspace, output, state, execute=True)
            water = next(item for item in collections if item["role"] == "public_water")
            state["public_water"] = _public_water(
                workspace, workspace._get("sources", water["source_collection_id"]), spec_path, output)
            state.update(state="mapping", updated_at=now())
            atomic_json(state_path, state)
            assessment_path = next(item["path"].parent for item in manifests if item["role"] == "assessment")
            assessment_args = SimpleNamespace(
                source_dir=str(assessment_path), workspace=str(workspace.root), create_workspace=False,
                require_domain=True,
                domain_manifest=[str(item["path"]) for item in manifests if item["role"] == "domain"],
                context_manifest=[str(item["path"]) for item in manifests if item["role"] not in {"assessment", "domain"}],
                domain_layer_id=list(selection["domain_layer_ids"]),
                context_layer_id=list(selection["context_layer_ids"]),
                primary_layer_id=args.primary_layer_id, comparison_layer_id=args.comparison_layer_id,
                mode=args.mode, paper=args.paper, dpi=args.dpi, skip_export=args.skip_export,
                output=str(output / "assessment"))
            from source_tools.operate_assessment_context import operate
            assessment = operate(assessment_args)
            _index(output, state, inventory, assessment, workspace)
            state.update(state="complete", updated_at=now(),
                         observed_context={
                             "observation_views": state["observation_import"]["views"],
                             "sources": len(inventory),
                             "tables": sum(item["kind"] == "table" for item in inventory),
                             "vectors": sum(item["kind"] == "vector" for item in inventory),
                             "assessment_stations": assessment["located_station_count"],
                             "inspected_stations": assessment["inspected_stations"],
                             "domain_join_rows": assessment["domain_join_rows"]},
                         saved_review_ids=[item["id"] for item in assessment["saved_reviews"]],
                         map_pack_ids=[item["id"] for item in assessment["map_packs"]],
                         empty_scopes=assessment.get("empty_scopes", []),
                         files=[describe_file(workspace.root, output / name) for name in (
                             "source-inventory.json", "observations.json", "index.html", "receiving-waters-spec.json",
                             "scenario-source-areas.json", "assessment/operation.json",
                             "assessment/point-inspections.json", "assessment/station-domain-joins.csv")])
            if state.get("nutrient_flow_import"):
                state["files"].append(describe_file(
                    workspace.root, output / "nutrient-flow-observations.json"))
            if state.get("physical_support_import"):
                state["files"].append(describe_file(
                    workspace.root, output / "physical-support-observations.json"))
            if state.get("calibration_station_preparations"):
                state["files"].append(describe_file(
                    workspace.root, output / "calibration-station-preparations.json"))
            if state.get("calibration_station_geography"):
                state["files"].append(describe_file(
                    workspace.root, output / "calibration-station-geography.json"))
            state["attempts"][-1].update(state="complete", completed_at=now())
            atomic_json(state_path, state)
        except BaseException as error:
            state.update(state="interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed",
                         updated_at=now(), error={"type": type(error).__name__, "message": str(error)})
            state["attempts"][-1].update(state=state["state"], ended_at=now(), error=state["error"])
            atomic_json(state_path, state)
            raise
    return {**state, "directory": str(output), "index": str(output / "index.html")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Existing regional scientific Workspace")
    parser.add_argument("--app-root", help="Complete native application; defaults to this installed source root")
    parser.add_argument("--assessment-dir", help="Original complete 24-file assessment source directory")
    parser.add_argument("--hydrology-manifest", help="Original observed-hydrology model-sources.json")
    parser.add_argument("--study-manifest", help="Original lake-study model-sources.json")
    parser.add_argument("--public-water-dir", help="Original public-water source directory")
    parser.add_argument("--domain-manifest", action="append", default=[])
    parser.add_argument("--domain-layer-id", action="append", default=[])
    parser.add_argument("--context-manifest", action="append", default=[])
    parser.add_argument("--context-layer-id", action="append", default=[])
    parser.add_argument("--primary-layer-id")
    parser.add_argument("--comparison-layer-id")
    parser.add_argument("--mode", choices=("single", "compare", "swipe", "difference"))
    parser.add_argument("--paper", choices=("letter", "a4"), default="letter")
    parser.add_argument("--dpi", type=int, choices=(150, 220, 300), default=150)
    parser.add_argument("--skip-export", action="store_true", help="Save the same native views without print rendering")
    parser.add_argument("--sources-only", action="store_true",
                        help="Complete original source, published-study and observation intake; retain geographic continuation")
    args = parser.parse_args(argv)
    result = receive(args)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
