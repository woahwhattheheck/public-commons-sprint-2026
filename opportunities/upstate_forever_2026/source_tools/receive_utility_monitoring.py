#!/usr/bin/env python3
"""Receive original utility reports, saved exports and Monitoring in one Workspace.

The default course prepares both original utility networks. A supplied programme
file may additionally solve actual user-selected designs and create campaigns.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import importlib.util
import hashlib
import json
from pathlib import Path
import platform
import sys
import time

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                          held, now, read_json, verify_file)
from model.workspace import Workspace
from model import utility_monitoring
from model.monitoring_workspace import MonitoringWorkspace
from model.monitoring_design import solve_design
from source_tools.prepare_watershed_context import import_source_edition, load_source_edition

SCHEMA = "upstate.utility-monitoring-native-receiving/v1"
PROGRAMME_SCHEMA = "upstate.utility-monitoring-programme/v1"
CODE = (
    "source_tools/receive_utility_monitoring.py", "operator/watershed_context.py",
    "model/utility_monitoring.py", "model/utility_microbial_study.py",
    "model/watershed_context.py", "model/watershed_brief.py", "model/watershed_briefing.py",
    "model/client_briefing.py", "model/utility_watershed_context.py",
    "model/utility_observed_context.py", "model/receiving_waters.py",
    "model/receiving_water_monitoring.py", "model/monitoring_sources.py",
    "model/monitoring_network.py", "model/monitoring_design.py",
    "model/monitoring_campaign.py", "model/monitoring_workspace.py",
    "source_tools/prepare_watershed_context.py", "source_tools/watershed_source_entry.py",
)
UTILITIES = ("ARJWS", "PRWD")


class NativeFault(ValueError):
    def __init__(self, code, message, status=422):
        self.code, self.status = code, status
        super().__init__(message)


class NativeOperator:
    """Only the existing provider's Workspace interface; no second task service."""
    def __init__(self, workspace):
        self.workspace = workspace

    def ws(self, key):
        if key != self.workspace.project["id"]:
            raise ValueError("The native utility course requested another Workspace")
        return self.workspace


def _separate(left, right):
    if left == right or left.is_relative_to(right) or right.is_relative_to(left):
        raise ValueError("Keep the receiving operation outside the application and Workspace")


def _provider(workspace):
    path = APPLICATION / "operator/watershed_context.py"
    name = "_upstate_utility_monitoring_receiver_provider"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError("The installed regional provider is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.WatershedContextActions(NativeOperator(workspace), NativeFault)


def _programme(path, utilities):
    if path is None:
        return None, None
    path = Path(path).expanduser().resolve(strict=True)
    body = path.read_bytes()
    value = json.loads(body)
    if (not isinstance(value, dict) or value.get("schema") != PROGRAMME_SCHEMA
            or set(value) - {"schema", "title", "utilities"}
            or not isinstance(value.get("utilities"), dict)):
        raise ValueError("Choose an original utility monitoring programme JSON")
    if set(value["utilities"]) - set(utilities):
        raise ValueError("Programme utilities must belong to this selected receiving course")
    for key, row in value["utilities"].items():
        if (not isinstance(row, dict) or set(row) - {"title", "configuration"}
                or not isinstance(row.get("configuration"), dict)):
            raise ValueError("Each selected programme requires its original configuration")
        if not isinstance(row.get("title"), str) or not row["title"].strip():
            raise ValueError("Name each original utility monitoring programme")
    return value, body


def _effective_configuration(programme, preparation):
    supplied = deepcopy(programme["configuration"])
    effective = deepcopy(supplied)
    excluded = effective.get("excluded_ids", [])
    if not isinstance(excluded, list) or any(not isinstance(key, str) for key in excluded):
        raise ValueError("Programme excluded_ids must be original string HUC identifiers")
    if len(excluded) != len(set(excluded)):
        raise ValueError("Programme excluded_ids repeats an original HUC")
    effective["excluded_ids"] = sorted(set(excluded) | set(preparation["recommended_excluded_ids"]))
    return supplied, effective


def _design(workspace, preparation, programme, operation_id):
    with held(workspace.root / ".utility-programme-receiving.lock", blocking=False):
        return _design_locked(workspace, preparation, programme, operation_id)


def _design_locked(workspace, preparation, programme, operation_id):
    native = MonitoringWorkspace(workspace)
    supplied, effective = _effective_configuration(programme, preparation)
    binding = {"schema": SCHEMA, "operation_id": operation_id,
               "utility_id": preparation["utility_id"],
               "utility_preparation_id": preparation["id"],
               "network_id": preparation["network_id"],
               "supplied_configuration": supplied, "effective_configuration": effective,
               "title": programme["title"]}
    # A native plan published just before an interrupted checkpoint is retained.
    existing = [row for row in workspace._list("monitoring_plans")
                if row.get("utility_receiving") == binding]
    if len(existing) > 1:
        raise ValueError("More than one native result belongs to this exact receiving decision")
    network = native.get("networks", preparation["network_id"])
    native.verify_sources(network)
    if existing:
        plan = existing[0]
        if (plan["network_id"] != network["id"] or plan["configuration"] != effective
                or plan["source_bindings"] != network["source_bindings"]):
            raise ValueError("The retained utility design changed its original native selection")
    else:
        plan = solve_design(network, effective)
        plan.update(title=programme["title"], utility_receiving=binding)
        plan = native.save("plans", plan)
    result = {"plan_id": plan["id"], "status": plan["status"],
              "selected_ids": plan.get("selected_ids", []), "configuration": effective,
              "supplied_configuration": supplied,
              "context_exclusions": preparation["recommended_excluded_ids"],
              "meaning": "Context-only HUCs are excluded from candidate selection; all supplied costs, calendar, coverage and station choices remain explicit.",
              "diagnostics": plan.get("diagnostics", []), "solver": plan.get("solver"),
              "cost": plan.get("cost"), "coverage": plan.get("coverage")}
    if plan["status"] in {"optimal", "feasible"}:
        campaign = native.create_campaign(
            plan_id=plan["id"], title=programme["title"],
            operation_id=digest({"utility_receiving": binding, "plan_id": plan["id"]}))
        result["campaign_id"] = campaign["campaign_id"]
        result["revision_id"] = campaign["id"]
        result["calendar_visits"] = len(plan["calendar"]["visits"])
    return result


def _reopen(workspace, provider, record):
    """Use fresh maintained readers for every returned original product."""
    directory, original, report = provider._report(workspace, {"report_id": record["report_id"]})
    if original["id"] != record["report_id"]:
        raise ValueError("Fresh receiving opened another regional source report")
    for descriptor in original["files"].values():
        verify_file(directory, descriptor)
    native = MonitoringWorkspace(workspace)
    received = []
    for item in record["utilities"]:
        prepared = utility_monitoring.inspect(workspace, item["operation_id"])
        if (prepared["export_id"] != item["export_id"] or prepared["network_id"] != item["network_id"]
                or prepared["utility_id"] != item["utility_id"]):
            raise ValueError("Fresh receiving changed the selected utility network")
        network = native.get("networks", prepared["network_id"])
        native.verify_sources(network)
        if set(network["nodes"]) != set(record["domain_huc12s"]):
            raise ValueError("Fresh receiving lost original contextual catchments")
        candidate_ids = sorted(set(network["nodes"]) - set(prepared["recommended_excluded_ids"]))
        if candidate_ids != item["huc12s"]:
            raise ValueError("Fresh receiving changed original utility candidate membership")
        result = {"utility_id": item["utility_id"], "operation_id": prepared["id"],
                  "export_id": prepared["export_id"], "network_id": network["id"],
                  "candidate_huc12s": candidate_ids, "summary": network["summary"],
                  "station_assignment_issues": prepared["station_assignment_issues"]}
        design = item.get("design")
        if design:
            plan = native.get("plans", design["plan_id"])
            if (plan["network_id"] != network["id"] or plan["configuration"] != design["configuration"]
                    or plan["selected_ids"] != design["selected_ids"]
                    or plan["status"] != design["status"]):
                raise ValueError("Fresh receiving changed the saved utility design")
            result["plan_id"] = plan["id"]
            if design.get("campaign_id"):
                revision = native.get("revisions", design["revision_id"])
                if (revision["campaign_id"] != design["campaign_id"]
                        or revision["plan_id"] != plan["id"]):
                    raise ValueError("Fresh receiving changed the original campaign revision")
                result.update(campaign_id=revision["campaign_id"], revision_id=revision["id"])
        received.append(result)
    return {"report_id": report["id"], "utilities": received}


def run(workspace_path, operation, *, utilities=UTILITIES, programme_path=None,
        include_microbial=True, context_directory=None, source_manifest=None,
        domain_manifest=None):
    started = time.monotonic()
    workspace = Workspace(Path(workspace_path).expanduser().resolve(strict=True))
    root = Path(operation).expanduser().resolve()
    _separate(root, workspace.root.resolve())
    _separate(root, APPLICATION.resolve())
    utilities = list(utilities)
    if (not utilities or len(utilities) != len(set(utilities))
            or set(utilities) - set(UTILITIES)):
        raise ValueError("Select original ARJWS and/or PRWD utility IDs once")
    utilities.sort()
    if type(include_microbial) is not bool:
        raise ValueError("Choose original microbial station inclusion explicitly")
    context_root = Path(context_directory or APPLICATION / "source/water_context/20261013").expanduser().resolve(strict=True)
    manifest = Path(source_manifest or context_root / "complete-native-sources.json").expanduser().resolve(strict=True)
    programme, programme_body = _programme(programme_path, utilities)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".utility-monitoring-receiving.lock", blocking=False):
        # Validate all available original model and supporting members before import.
        edition = load_source_edition(context_root)
        source_files = [*edition["source_files"], *edition.get("supporting_files", [])]
        selection = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
                     "utilities": utilities, "include_microbial": include_microbial,
                     "source_manifest": describe_file(manifest.parent, manifest),
                     "source_inputs": [{key: row[key] for key in ("name", "bytes", "sha256")} for row in source_files],
                     "programme_file": {"bytes": len(programme_body), "sha256": hashlib.sha256(programme_body).hexdigest()} if programme_body is not None else None,
                     "implementation": {name: describe_file(APPLICATION, APPLICATION / name) for name in CODE}}
        if domain_manifest:
            domain_manifest = Path(domain_manifest).expanduser().resolve(strict=True)
            selection["domain_manifest"] = describe_file(domain_manifest.parent, domain_manifest)
        key = digest(selection)
        atomic_json(root / "selection.json", selection, immutable=True)
        if programme_body is not None:
            atomic_bytes(root / "original-programme.json", programme_body, immutable=True)
        state_path = root / "state.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "id": key, "created_at": now(), "utilities": {}}
        if state.get("id") != key:
            raise ValueError("Resume with the same original sources, implementation and programme")
        def checkpoint(phase, **values):
            state.update(phase=phase, updated_at=now(), **values)
            atomic_json(state_path, state)
            print(json.dumps({"phase": phase, **values}, ensure_ascii=False, default=str), flush=True)
        try:
            if domain_manifest:
                checkpoint("import_original_domain")
                workspace.import_sources(domain_manifest)
            domain, _, rows, _, _, _ = utility_monitoring._domain(workspace, None)
            domain_hucs = sorted(str(row["properties"][domain["id_field"]]) for row in rows)
            checkpoint("receive_original_regional_sources")
            imported = import_source_edition(workspace, context_root, source_manifest=manifest)
            provider = _provider(workspace)
            task = {"workspace": workspace.project["id"], "action": "watershed.context.analyze",
                    "payload": {"selection": {"source_collection_id": imported["source_collection_id"],
                                             "source_id": imported["source_id"]},
                                "title": "Original Upper Savannah utility source context"}}
            report_summary = provider.invoke(task)
            directory, regional_record, report = provider._report(workspace, {"report_id": report_summary["id"]})
            choices, _ = provider._utility_choices(report)
            selected = []
            for utility_id in utilities:
                matches = [row for row in choices if row["utility_id"] == utility_id and row["available"]]
                if len(matches) != 1:
                    raise ValueError("Select one available original utility profile for " + utility_id)
                selected.append(matches[0])
            checkpoint("regional_report", report_id=report["id"],
                       source_collection_id=imported["source_collection_id"])
            for choice in selected:
                utility_id = choice["utility_id"]
                checkpoint("utility_export", current_utility=utility_id)
                exported = provider.invoke({
                    "workspace": workspace.project["id"], "action": "watershed.context.export",
                    "payload": {"report_id": report["id"], "utility_key": choice["key"]}})
                checkpoint("utility_network", current_utility=utility_id)
                prepared = utility_monitoring.prepare(
                    workspace, {"export_id": exported["id"], "include_microbial": include_microbial},
                    progress=lambda value: print(json.dumps(value, ensure_ascii=False), flush=True))
                item = {"utility_id": utility_id, "title": choice["title"], "huc12s": choice["huc12s"],
                        "export_id": exported["id"], "operation_id": prepared["id"],
                        "receiving_plan_id": prepared["receiving_plan_id"],
                        "monitoring_id": prepared["monitoring_id"], "network_id": prepared["network_id"],
                        "source_collection_id": prepared["source_collection_id"],
                        "summary": prepared["summary"], "network_summary": prepared["network_summary"],
                        "station_assignment_issues": prepared["station_assignment_issues"],
                        "method": prepared["method"], "recommended_excluded_ids": prepared["recommended_excluded_ids"]}
                native_directory = workspace.root / utility_monitoring.FOLDER / prepared["id"]
                item["files"] = {}
                for member in ("original/utility-watershed-packet.zip", "original/selected-watersheds.json",
                               "original/original-utility-profile.json", "method.json"):
                    descriptor = prepared["files"][member]
                    item["files"][member] = utility_monitoring._copy_file(
                        verify_file(native_directory, descriptor), root, utility_id + "/" + member, descriptor)
                if programme is not None and utility_id in programme["utilities"]:
                    checkpoint("utility_design", current_utility=utility_id)
                    item["design"] = _design(workspace, prepared, programme["utilities"][utility_id], key)
                state["utilities"][utility_id] = item
                checkpoint("utility_complete", current_utility=utility_id)
            record = {"schema": SCHEMA, "id": key, "state": "complete",
                      "workspace_id": workspace.project["id"], "selection": selection,
                      "created_at": state["created_at"], "completed_at": now(),
                      "python": platform.python_version(), "elapsed_seconds": time.monotonic() - started,
                      "report_id": report["id"], "regional_summary": report["summary"],
                      "regional_source_collection_id": imported["source_collection_id"],
                      "domain_huc12s": domain_hucs, "domain": domain,
                      "utilities": [state["utilities"][name] for name in utilities]}
            checkpoint("fresh_workspace_reopen")
            fresh = Workspace(workspace.root)
            record["received"] = _reopen(fresh, _provider(fresh), record)
            for item in record["utilities"]:
                for descriptor in item["files"].values():
                    verify_file(root, descriptor)
            record["record_sha256"] = digest(record)
            atomic_json(root / "receiving.json", record)
            checkpoint("complete", receiving_file="receiving.json")
            return record
        except Exception as error:
            checkpoint("failed", error={"type": type(error).__name__, "message": str(error)})
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--utility", action="append", choices=UTILITIES)
    parser.add_argument("--programme", help="Original supplied costs/calendar/configuration by utility")
    parser.add_argument("--without-microbial", action="store_true")
    parser.add_argument("--context-directory")
    parser.add_argument("--source-manifest")
    parser.add_argument("--domain-manifest", help="Optional existing original 217-HUC Workspace manifest")
    args = parser.parse_args(argv)
    result = run(args.workspace, args.operation, utilities=args.utility or UTILITIES,
                 programme_path=args.programme, include_microbial=not args.without_microbial,
                 context_directory=args.context_directory, source_manifest=args.source_manifest,
                 domain_manifest=args.domain_manifest)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
