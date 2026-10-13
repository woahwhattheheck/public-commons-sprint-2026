#!/usr/bin/env python3
"""Prepare actual Upper Savannah monitoring sources and run the original receiver.

Retains the original polygon/topology and station editions. The original native
vector reader projects a clearly named station planning view; the original
Monitoring network, optimizer, calendar, campaign and portable receiver operate it.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))

from model.common import atomic_bytes, atomic_json, canonical, digest, file_digest, held, read_json, relative_file
from model.workspace import Workspace
from model import portable
from model.monitoring_sources import read_source, source_record, verify_retained_binding
from model.monitoring_network import build_network
from model.monitoring_campaign import calendar_site_capacity, cost_table, money_cents, rounds
from model.monitoring_workspace import MonitoringWorkspace
from model.monitoring_network import existing_coverage

DOMAIN_ID = "upstate-wbd-upstream-domain-20261012"
DOMAIN_DECODED_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
STATIONS = (
    "scdes-listed-stations-wgs84-2026",
    "scdes-listed-stations-nad83-2026",
    "scdes-listed-stations-scdes-utm17n-2026",
)
DEFAULT_STATIONS = APPLICATION / "source/assessment_2026/assessment/geography-model-sources.json"
DEFAULT_PLANNING = APPLICATION / "source/monitoring/upper_savannah_winter_2026_planning.json"
SCHEMA = "upstate.regional-monitoring-opening/v1"


def strict_json(body):
    def invalid(value):
        raise ValueError("Nonfinite JSON number: " + value)
    return json.loads(body, parse_constant=invalid)


def nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be a nonempty string")
    return value


def checked_body(workspace, description):
    path = relative_file(workspace.root, description["object"])
    body = path.read_bytes()
    if len(body) != description["bytes"] or hashlib.sha256(body).hexdigest() != description["sha256"]:
        raise ValueError("An original source body or companion changed")
    return body


def entry_for(collection, source_id):
    matches = [entry for entry in collection["entries"] if entry["id"] == source_id]
    if len(matches) != 1:
        raise ValueError("Source edition must contain exactly one named entry: " + source_id)
    return matches[0]


def select_collection(workspace, source_ids, *, manifest=None, collection_id=None):
    if manifest is not None:
        imported = workspace.import_sources(Path(manifest).resolve(strict=True))
        if collection_id and imported["id"] != collection_id:
            raise ValueError("The selected manifest differs from the explicit retained collection")
        selected = imported
    elif collection_id:
        selected = workspace._get("sources", collection_id)
    else:
        matches = [edition for edition in workspace.sources()
                   if set(source_ids) <= {entry["id"] for entry in edition["entries"]}]
        if len(matches) != 1:
            raise ValueError("Select one retained collection or original manifest for " + ", ".join(source_ids))
        selected = matches[0]
    for source_id in source_ids:
        entry_for(selected, source_id)
    return selected


def native_domain_fields(workspace, collection, entry, *, id_field=None, downstream_field=None):
    metadata = entry.get("metadata") or {}
    binding_name = metadata.get("binding_file", "feature-bindings.json")
    matching = [body for body in entry.get("companions", [])
                if binding_name in (body.get("source_path"), body.get("view_path"), body.get("filename"))]
    binding = strict_json(checked_body(workspace, matching[0])) if len(matching) == 1 else {}
    if len(matching) > 1:
        raise ValueError("The original domain binding companion is ambiguous")
    if binding and binding.get("source_id") != entry["id"]:
        raise ValueError("Original feature bindings name a different domain source")
    declared_id = binding.get("native_huc12_field") or metadata.get("native_huc12_field")
    declared_downstream = binding.get("native_tohuc_field") or metadata.get("native_tohuc_field")
    for chosen, declared, name in ((id_field, declared_id, "HUC12"), (downstream_field, declared_downstream, "ToHUC")):
        if chosen and declared and chosen != declared:
            raise ValueError("Explicit " + name + " field differs from the retained original binding")
    return nonempty(id_field or declared_id, "Native HUC12 field"), nonempty(downstream_field or declared_downstream, "Native ToHUC field"), binding


def retain_collection(workspace, collection, destination, prefix):
    """Retain complete original editions with their original relative filenames."""
    companions, index = [], []
    records = [("original_manifest", None, collection["original_manifest"])]
    for entry in collection["entries"]:
        records.append(("body", entry["id"], entry["body"]))
        records.extend(("companion", entry["id"], body) for body in entry.get("companions", []))
    unique = {}
    for role, source_id, description in records:
        body = checked_body(workspace, description)
        native_name = description.get("source_path") or description["filename"]
        member = PurePosixPath(native_name)
        if member.is_absolute() or not member.parts or ".." in member.parts or "\\" in native_name or str(member) != native_name:
            raise ValueError("Original source member must keep a portable relative name")
        relative = f"{prefix}/native/{native_name}"
        if relative in unique and unique[relative] != description["sha256"]:
            raise ValueError("Original edition contains conflicting native filenames")
        if relative not in unique:
            atomic_bytes(destination / relative, body, immutable=True)
            companions.append({"path": relative, "bytes": len(body), "sha256": description["sha256"]})
            unique[relative] = description["sha256"]
        index.append({"role": role, "source_id": source_id, "body": description, "retained_path": relative})
    record_name = f"{prefix}/native-source-edition.json"
    atomic_json(destination / record_name, collection, immutable=True)
    companions.append({"path": record_name, "bytes": (destination / record_name).stat().st_size,
                       "sha256": file_digest(destination / record_name)})
    return companions, {"collection_id": collection["id"], "original_manifest": collection["original_manifest"],
                        "records": index, "edition_path": record_name}


def verify_declared_crs(entry, binding):
    from pyproj import CRS
    declared = entry.get("source_crs")
    if not declared:
        raise ValueError("Original vector source must declare its coordinate reference system")
    if not CRS.from_user_input(declared).equals(CRS.from_user_input(binding["native_crs"]), ignore_axis_order=True):
        raise ValueError("Native geometry CRS differs from the original source manifest: " + entry["id"])


def planning_input(path):
    body = Path(path).resolve(strict=True).read_bytes()
    value = strict_json(body)
    if not isinstance(value, dict) or value.get("schema") != "upstate.monitoring-planning/v1":
        raise ValueError("Planning JSON must use upstate.monitoring-planning/v1")
    for name in ("title", "cost_basis", "calendar_basis"):
        nonempty(value.get(name), "Planning " + name)
    configuration = value.get("configuration")
    if not isinstance(configuration, dict):
        raise ValueError("Planning input must contain the original Monitoring configuration object")
    # Explicit baseline selection avoids inferring active coverage from a historical
    # assessment listing. An empty array is an intentional planning choice.
    if not isinstance(configuration.get("existing_station_ids"), list):
        raise ValueError("Name existing_station_ids explicitly; use [] for no funded existing baseline")
    if not isinstance(configuration.get("calendar"), dict):
        raise ValueError("Supply the original complete calendar configuration")
    money_cents(configuration.get("budget"), "budget")
    calendar_site_capacity(configuration["calendar"])
    budgets = value.get("frontier_budgets", [])
    if not isinstance(budgets, list):
        raise ValueError("frontier_budgets must be an array of exact monetary choices")
    cents = [money_cents(budget, "frontier budget") for budget in budgets]
    if len(cents) != len(set(cents)):
        raise ValueError("frontier_budgets must be distinct")
    return body, value


def prepare(workspace, output, *, planning, domain_manifest=None, domain_collection=None,
            domain_source_id=DOMAIN_ID, station_manifest=None, station_collection=None,
            station_source_ids=STATIONS, context_manifests=(), context_collections=(),
            id_field=None, downstream_field=None, expected_domain_count=217):
    output = Path(output).resolve()
    if output == workspace.root or output.is_relative_to(workspace.root):
        raise ValueError("Use a receiving output outside the scientific Workspace")
    planning_body, plan = planning_input(planning)
    source_ids = tuple(station_source_ids)
    if not source_ids or len(source_ids) != len(set(source_ids)):
        raise ValueError("Select distinct actual station source IDs")
    domain = select_collection(workspace, [domain_source_id], manifest=domain_manifest, collection_id=domain_collection)
    stations = select_collection(workspace, source_ids, manifest=station_manifest, collection_id=station_collection)
    context = [workspace._get("sources", value) for value in context_collections]
    context.extend(workspace.import_sources(Path(path).resolve(strict=True)) for path in context_manifests)
    context = list({value["id"]: value for value in context}.values())
    domain_entry = entry_for(domain, domain_source_id)
    if domain_source_id == DOMAIN_ID and domain_entry.get("decoded_sha256") != DOMAIN_DECODED_SHA256:
        raise ValueError("The original Upper Savannah domain must retain its reviewed decoded source identity")
    huc, tohuc, original_binding = native_domain_fields(
        workspace, domain, domain_entry, id_field=id_field, downstream_field=downstream_field)
    request = {"project_id": workspace.project["id"], "workspace": str(workspace.root),
               "domain_collection_id": domain["id"], "domain_source_id": domain_source_id,
               "station_collection_id": stations["id"], "station_source_ids": list(source_ids),
               "context_collection_ids": sorted(value["id"] for value in context),
               "planning_sha256": hashlib.sha256(planning_body).hexdigest(),
               "id_field": huc, "downstream_field": tohuc, "expected_domain_count": expected_domain_count}
    operation_id = digest(request)
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".regional-monitoring.lock", blocking=False):
        request_path = output / "request.json"
        atomic_json(request_path, request, immutable=True)
        receipt_path = output / "monitoring-opening.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt.get("request_sha256") != operation_id:
                raise ValueError("Receiving output belongs to a different native source/planning selection")
            for artifact in receipt["artifacts"].values():
                path = output / artifact["path"]
                if not path.is_file() or path.stat().st_size != artifact["bytes"] or file_digest(path) != artifact["sha256"]:
                    raise ValueError("Prepared monitoring artifact changed; preserve its existing operation")
            for binding in receipt["source_bindings"]:
                verify_retained_binding(workspace, binding)
            return receipt

        staged = output / "source-edition"
        staged.mkdir(exist_ok=True)
        atomic_bytes(staged / "planning.json", planning_body, immutable=True)
        domain_view, domain_source = read_source(workspace, domain_source_id, collection_id=domain["id"])
        verify_declared_crs(domain_entry, domain_source)
        if huc not in domain_source["native_fields"] or tohuc not in domain_source["native_fields"]:
            raise ValueError("Original HUC12/ToHUC fields are absent from the retained native polygon schema")
        features, bindings, station_index, station_fields = [], [], [], set()
        seen = set()
        for source_id in source_ids:
            entry = entry_for(stations, source_id)
            field = (entry.get("metadata") or {}).get("station_id_field")
            nonempty(field, source_id + " station_id_field metadata")
            station_fields.add(field)
            view, binding = read_source(workspace, source_id, collection_id=stations["id"])
            verify_declared_crs(entry, binding)
            bindings.append(binding)
            for index, feature in enumerate(view["features"]):
                station_id = nonempty((feature.get("properties") or {}).get(field), "Original station ID")
                if station_id in seen:
                    raise ValueError("Station occurs in multiple selected original cohorts: " + station_id)
                seen.add(station_id)
                if (feature.get("geometry") or {}).get("type") != "Point":
                    raise ValueError("Original station geometry must be a Point")
                features.append(feature)
                station_index.append({"station_id": station_id, "source_id": source_id,
                                      "source_collection_id": stations["id"], "source_feature_index": index,
                                      "source_feature_id": feature.get("id"), "native_source_sha256": binding["object_sha256"]})
        if len(station_fields) != 1:
            raise ValueError("Selected native cohorts must share one declared station ID field")
        station_field = next(iter(station_fields))
        station_view = {"type": "FeatureCollection", "name": "Retained regional station planning view",
                        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                        "features": features}
        atomic_json(staged / "stations-wgs84.geojson", station_view, immutable=True)
        companions = [{"path": "planning.json", "bytes": len(planning_body), "sha256": request["planning_sha256"]}]
        original_collections = {value["id"]: value for value in [stations, *context]}
        original_index = []
        for collection_id, collection in sorted(original_collections.items()):
            kept, index = retain_collection(workspace, collection, staged, "originals/" + collection_id)
            companions.extend(kept)
            original_index.append(index)
        lineage = {"schema": "upstate.monitoring-station-planning-view/v1",
                   "operation_id": operation_id, "planning_crs": "EPSG:4326", "source_bindings": bindings,
                   "method": "Original monitoring_sources.read_source / Fiona / pyproj always_xy; retain every source point and property, combine declared cohorts, preserve complete original editions.",
                   "station_id_field": station_field, "stations": station_index,
                   "original_collections": original_index,
                   "context_meaning": "Additional retained source context; not monitoring stations, field observations or coverage weights."}
        atomic_json(staged / "station-lineage.json", lineage, immutable=True)
        companions.append({"path": "station-lineage.json", "bytes": (staged / "station-lineage.json").stat().st_size,
                           "sha256": file_digest(staged / "station-lineage.json")})
        derived_id = "regional-monitoring-stations-" + operation_id[:20]
        manifest = {"schema": "upstate.sources/v1", "title": plan["title"] + " — retained station planning edition",
                    "captured_at": stations.get("captured_at"), "scope": {"original_station_count": len(features),
                    "original_station_collection_id": stations["id"], "planning_request": operation_id},
                    "notes": ["Original assessment labels remain source context. Native polygon containment owns network assignment.",
                              "Original costs/calendar are the named planning policy in planning.json."],
                    "entries": [{"id": derived_id, "title": plan["title"] + " — original station locations",
                                 "kind": "vector", "role": "MONITORING_STATIONS",
                                 "path": "stations-wgs84.geojson",
                                 "uri": "urn:upstate:monitoring:source-planning:" + operation_id,
                                 "vintage": stations.get("captured_at") or "Original retained source editions",
                                 "source_crs": "EPSG:4326", "source_format": "GeoJSON",
                                 "bytes": (staged / "stations-wgs84.geojson").stat().st_size,
                                 "sha256": file_digest(staged / "stations-wgs84.geojson"),
                                 "metadata": {"station_id_field": station_field, "station_count": len(features),
                                              "lineage_file": "station-lineage.json", "derived_planning_view": True},
                                 "companions": companions}]}
        atomic_json(staged / "sources.json", manifest, immutable=True)
        combined = workspace.import_sources(staged / "sources.json")
        station_view, station_source = read_source(workspace, derived_id, collection_id=combined["id"])
        network_options = {"domain_collection_id": domain["id"], "domain_source_id": domain_source_id,
                           "station_collection_id": combined["id"], "station_source_id": derived_id,
                           "id_field": huc, "downstream_field": tohuc, "station_id_field": station_field,
                           "title": plan["title"]}
        network = build_network(domain_view, station_view,
                                source_bindings={"domain": domain_source, "stations": station_source},
                                id_field=huc, downstream_field=tohuc, station_id_field=station_field, title=plan["title"])
        if len(network["nodes"]) != expected_domain_count:
            raise ValueError("Actual domain catchment count differs from the explicit regional selection")
        if original_binding.get("selected_huc12") and set(network["nodes"]) != set(original_binding["selected_huc12"]):
            raise ValueError("Native network IDs differ from the original retained domain binding")
        # These are the exact original validations/units. Optimization occurs once
        # inside the original receiving workflow, not in an alternative planner.
        configuration = plan["configuration"]
        existing_coverage(network, configuration.get("coverage_mode", "local"), configuration["existing_station_ids"])
        costs, breakdown = cost_table(network, configuration, configuration["calendar"])
        selection = {"network": network_options, "configuration": configuration, "title": plan["title"]}
        selection_path = output / "monitoring-selection.json"
        atomic_json(selection_path, selection, immutable=True)
        assessment_differences = [
            {"station_id": row["id"], "listed_huc12": row["source_properties"].get("listed_huc12"),
             "native_huc12": row["huc_id"], "assignment": row["assignment"]}
            for row in network["stations"]
            if row["source_properties"].get("listed_huc12") != row["huc_id"]]
        summary = {"native_network": network["summary"], "field_mapping": network["field_mapping"],
                   "weight_basis": network["weight_basis"], "station_assignment_issues": network["station_assignment_issues"],
                   "assessment_label_differences": assessment_differences,
                   "existing_station_ids": configuration["existing_station_ids"],
                   "calendar_rounds": rounds(configuration["calendar"]),
                   "calendar_site_capacity": calendar_site_capacity(configuration["calendar"]),
                   "cost_basis": plan["cost_basis"], "calendar_basis": plan["calendar_basis"],
                   "cost_by_catchment_cents": costs, "original_cost_breakdown": breakdown}
        atomic_json(output / "monitoring-source-summary.json", summary, immutable=True)
        artifacts = {}
        for label, path in (("selection", selection_path), ("summary", output / "monitoring-source-summary.json"),
                            ("planning", staged / "planning.json"), ("station_manifest", staged / "sources.json")):
            artifacts[label] = {"path": path.relative_to(output).as_posix(), "bytes": path.stat().st_size,
                                "sha256": file_digest(path)}
        receipt = {"schema": SCHEMA, "request_sha256": operation_id, "project_id": workspace.project["id"],
                   "workspace": str(workspace.root), "operator_workspace_key": digest({"directory": str(workspace.root)}),
                   "domain_collection_id": domain["id"], "station_original_collection_id": stations["id"],
                   "station_planning_collection_id": combined["id"], "station_planning_source_id": derived_id,
                   "context_collection_ids": request["context_collection_ids"],
                   "frontier_budgets": plan.get("frontier_budgets", []),
                   "selection": selection, "source_bindings": [domain_source, station_source, *bindings],
                   "summary": summary, "artifacts": artifacts,
                   "monitoring_selection": str(selection_path),
                   "receiver_arguments": ["--workspace", str(workspace.root), "--selection", str(selection_path),
                                          "--output", str(output / "receiving")]}
        atomic_json(receipt_path, receipt, immutable=True)
        return receipt


def receive(workspace, output, receipt, *, frontier=False):
    selection = Path(receipt["monitoring_selection"])
    expected = receipt["artifacts"]["selection"]
    if selection.stat().st_size != expected["bytes"] or file_digest(selection) != expected["sha256"]:
        raise ValueError("The prepared native Monitoring selection changed")
    name = "_regional_original_monitoring_receiver"
    spec = importlib.util.spec_from_file_location(name, APPLICATION / "operator/monitoring_receiving.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with held(Path(output) / ".regional-monitoring-receiving.lock", blocking=False):
        result = module.receive(workspace.root, selection, Path(output) / "receiving")
        if not result.get("summary", {}).get("complete"):
            raise ValueError("Original monitoring design outcome retained in receiving/receiving.json: " +
                             str(result.get("design_outcome", {}).get("status", "incomplete")))
        if frontier:
            budgets = receipt.get("frontier_budgets")
            if not budgets:
                raise ValueError("Named planning edition must supply frontier_budgets")
            service = MonitoringWorkspace(workspace)
            comparison = service.frontier(network_id=result["network_id"],
                                          configuration=receipt["selection"]["configuration"],
                                          budgets=budgets, title=receipt["selection"]["title"] + " — budget comparison")
            atomic_json(Path(output) / "monitoring-frontier.json", comparison)
            transfer_path = Path(output) / "frontier-transfer.json"
            transfer = read_json(transfer_path) if transfer_path.exists() else {
                "frontier_id": comparison["id"], "campaign_id": result["campaign_id"]}
            if transfer["frontier_id"] != comparison["id"] or transfer["campaign_id"] != result["campaign_id"]:
                raise ValueError("Retained frontier transfer belongs to a different original design")
            if "archive" not in transfer:
                revision = service.campaign(result["campaign_id"])["revision"]["id"]
                transfer["archive"] = service.export(campaign_id=result["campaign_id"],
                                                     expected_revision_id=revision, format="workspace")
                atomic_json(transfer_path, transfer)
            archive = transfer["archive"]["path"]
            archive_manifest = portable.inspect_archive(archive, verify=True)
            destination = Path(output) / "frontier-received"
            if "received" not in transfer:
                if destination.exists():
                    # Recover death after native restore publication by checking
                    # every archived original member before adopting the directory.
                    for member, body in archive_manifest["members"].items():
                        path = destination / member
                        if not path.is_file() or path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
                            raise ValueError("Unrecorded frontier receiving directory differs from the archive")
                    received = {"workspace": str(destination / "workspace"),
                                "application": str(destination / "application")}
                else:
                    received = portable.restore(archive, destination)
                transfer["received"] = received
                atomic_json(transfer_path, transfer)
            recipient = MonitoringWorkspace(Workspace(transfer["received"]["workspace"]))
            if recipient.get("frontiers", comparison["id"]) != comparison:
                raise ValueError("Original budget comparison changed during native receiving")
            for plan_id in comparison["plan_ids"]:
                if recipient.get("plans", plan_id) != service.get("plans", plan_id):
                    raise ValueError("Native frontier plan changed during receiving")
            recipient.verify_sources(recipient.get("networks", result["network_id"]))
            transfer["complete"] = True
            atomic_json(transfer_path, transfer)
            result = {**result, "frontier": comparison, "frontier_transfer": transfer}
        return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--planning", type=Path, default=DEFAULT_PLANNING)
    domain = p.add_mutually_exclusive_group()
    domain.add_argument("--domain-manifest", type=Path)
    domain.add_argument("--domain-collection")
    p.add_argument("--domain-source-id", default=DOMAIN_ID)
    station = p.add_mutually_exclusive_group()
    station.add_argument("--station-manifest", type=Path)
    station.add_argument("--station-collection")
    p.add_argument("--station-source-id", action="append")
    p.add_argument("--context-manifest", type=Path, action="append", default=[])
    p.add_argument("--context-collection", action="append", default=[])
    p.add_argument("--id-field")
    p.add_argument("--downstream-field")
    p.add_argument("--expected-domain-count", type=int, default=217)
    p.add_argument("--frontier", action="store_true", help="Also run the original resumable budget comparison after campaign receiving")
    p.add_argument("--prepare-only", action="store_true",
                   help="Prepare the exact selection for the same-workspace regional progression")
    a = p.parse_args()
    if a.expected_domain_count < 1:
        p.error("--expected-domain-count must be positive")
    try:
        workspace = Workspace(a.workspace)
        result = prepare(workspace, a.output, planning=a.planning, domain_manifest=a.domain_manifest,
                         domain_collection=a.domain_collection, domain_source_id=a.domain_source_id,
                         station_manifest=a.station_manifest or (None if a.station_collection else DEFAULT_STATIONS),
                         station_collection=a.station_collection, station_source_ids=a.station_source_id or STATIONS,
                         context_manifests=a.context_manifest, context_collections=a.context_collection,
                         id_field=a.id_field, downstream_field=a.downstream_field,
                         expected_domain_count=a.expected_domain_count)
        if not a.prepare_only:
            result = {**result, "receiving": receive(workspace, a.output.resolve(), result, frontier=a.frontier)}
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, ImportError) as error:
        p.exit(2, "Regional monitoring: " + str(error) + "\n")


if __name__ == "__main__":
    main()
