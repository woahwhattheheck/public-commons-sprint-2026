#!/usr/bin/env python3
"""Continue the original Monitoring workflow and its observed context.

Select retained sources with explicit planning costs, or an existing saved plan
or campaign. The original Workspace archive creates an independently editable
receiving project, with source and immutable record identities preserved.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.workspace import Workspace
from model import portable
from model.common import atomic_json, digest, file_digest, held, read_json
from model.monitoring_workspace import MonitoringWorkspace


def _download(descriptor):
    path = Path(descriptor["path"])
    if (not path.is_file() or path.stat().st_size != descriptor["bytes"]
            or file_digest(path) != descriptor["sha256"]):
        raise ValueError("A retained receiving export changed: " + str(path))
    return path


def _export_members(descriptor, expected_schema, *, context=None, campaign=None):
    """Read actual exported bytes, including all retained original companions."""
    path = _download(descriptor)
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("A monitoring export repeats a member")
        manifest = json.loads(archive.read("manifest.json"))
        members = manifest.get("files", [])
        if manifest.get("schema") != expected_schema or not isinstance(members, list):
            raise ValueError("A monitoring export has a different manifest")
        declared = [row["path"] for row in members]
        if len(declared) != len(set(declared)) or set(names) != {"manifest.json", *declared}:
            raise ValueError("The monitoring export inventory differs")
        for row in members:
            value = hashlib.sha256()
            size = 0
            with archive.open(row["path"]) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    size += len(block)
                    value.update(block)
            if size != row["bytes"] or value.hexdigest() != row["sha256"]:
                raise ValueError("A monitoring export member changed: " + row["path"])
        if context is not None:
            actual = json.loads(archive.read("observed-context/context.json"))
            if actual != context:
                raise ValueError("The exported observational context differs")
        if campaign is not None:
            actual = json.loads(archive.read("campaign.json"))
            if actual != campaign:
                raise ValueError("The exported campaign revision differs")
        return {"schema": manifest["schema"], "members": len(members),
                "context_id": context["id"] if context else None}


def _records(service, selection, state, saved):
    """Reuse the supplied original saved roots, or the existing native designer."""
    if selection.get("campaign_id"):
        if "network" in selection or "configuration" in selection:
            raise ValueError("An existing campaign already retains its network and configuration")
        campaign = service.campaign(selection["campaign_id"])
        plan = campaign["plan"]
        network = service.get("networks", plan["network_id"])
        if selection.get("plan_id", plan["id"]) != plan["id"]:
            raise ValueError("Selected campaign belongs to a different plan")
        saved("campaign_id", campaign["revision"]["campaign_id"])
    elif selection.get("plan_id"):
        if "network" in selection or "configuration" in selection:
            raise ValueError("An existing plan already retains its network and configuration")
        plan = service.get("plans", selection["plan_id"])
        network = service.get("networks", plan["network_id"])
    else:
        if "configuration" not in selection or bool(selection.get("network_id")) == bool(selection.get("network")):
            raise ValueError("Select an existing campaign/plan, or one network and explicit configuration")
        network_id = state.get("network_id") or selection.get("network_id")
        network = service.get("networks", network_id) if network_id else service.import_network(**selection["network"])
        service.verify_sources(network)
        saved("network_id", network["id"])
        plan = (service.get("plans", state["plan_id"]) if state.get("plan_id")
                else service.design(network_id=network["id"], configuration=selection["configuration"],
                                    title=selection.get("title", "Monitoring campaign")))
    if selection.get("network_id", network["id"]) != network["id"]:
        raise ValueError("The selected saved plan belongs to a different network")
    for key, value in (("network_id", network["id"]), ("plan_id", plan["id"])):
        if key in state and state[key] != value:
            raise ValueError("An original receiving record changed: " + key)
        saved(key, value)
    service.verify_sources(network)
    return network, plan


def _observed_context(workspace, selection, selection_path, campaign, state, saved, output):
    from model import monitoring_observed_context as observed
    choice = selection.get("observed_context")
    if choice is None:
        return None
    if not isinstance(choice, dict):
        raise ValueError("observed_context must name a retained context or an original source")
    allowed = {"context_id", "source_manifest", "source_collection_id", "source_id",
               "station_mapping", "title"}
    if set(choice) - allowed:
        raise ValueError("Unknown observational context selection fields")
    if choice.get("context_id"):
        if set(choice) != {"context_id"}:
            raise ValueError("A saved context already retains its exact source and mapping")
        record = observed.inspect(workspace, choice["context_id"])
    else:
        if not choice.get("source_id"):
            raise ValueError("Choose the exact observational source entry ID")
        manifest = choice.get("source_manifest")
        collection_id = choice.get("source_collection_id")
        if bool(manifest) == bool(collection_id):
            raise ValueError("Select one source manifest or retained source collection")
        if manifest:
            manifest_path = Path(manifest)
            if not manifest_path.is_absolute():
                manifest_path = selection_path.parent / manifest_path
            if state.get("observed_source_collection_id"):
                collection_id = state["observed_source_collection_id"]
                collection = workspace._get("sources", collection_id)
                if manifest_path.exists() and file_digest(manifest_path) != collection["original_manifest"]["sha256"]:
                    raise ValueError("The original observation manifest changed")
            else:
                collection = workspace.import_sources(manifest_path)
                collection_id = saved("observed_source_collection_id", collection["id"])
            saved("observed_manifest_sha256", collection["original_manifest"]["sha256"])
        request = {
            "source_collection_id": collection_id, "source_id": choice["source_id"],
            "campaign_id": campaign["revision"]["campaign_id"],
            "station_mapping": choice.get("station_mapping", {}),
            "title": choice.get("title", "Observed support for the monitoring campaign"),
        }
        preview = observed.preview(workspace, **request)
        atomic_json(output / "observed-context-preview.json", preview)
        if state.get("observed_context_id"):
            record = observed.inspect(workspace, state["observed_context_id"])
        else:
            record = observed.prepare(workspace, **request)
        if digest(preview) != record["id"]:
            raise ValueError("The saved context differs from the exact receiving preview")
        saved("observed_preview_sha256", digest(preview))
    if (record.get("campaign_id") != campaign["revision"]["campaign_id"]
            or record.get("campaign_revision_id") != campaign["revision"]["id"]
            or record.get("plan_id") != campaign["plan"]["id"]):
        raise ValueError("The observational context belongs to another campaign revision")
    if state.get("observed_context_id", record["id"]) != record["id"]:
        raise ValueError("The retained receiving context changed")
    saved("observed_context_id", record["id"])
    saved("observed_context_sha256", digest(record))
    saved("observed_source_binding", record["source_binding"])
    atomic_json(output / "observed-context.json", record)
    if "observed_context_export" not in state:
        saved("observed_context_export", observed.export_context(
            workspace, context_id=record["id"], export_root=output / "exports"))
    saved("observed_export_verification", _export_members(
        state["observed_context_export"], "upstate.monitoring-context-export/v1", context=record))
    return record


def receive(workspace_path, selection_path, output):
    output = Path(output).resolve()
    workspace = Workspace(workspace_path)
    if output.is_relative_to(workspace.root.resolve()):
        raise ValueError("The receiving directory must be outside the original Workspace")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock", blocking=False):
        return _receive(workspace, Path(selection_path).resolve(), output)


def _receive(workspace, selection_path, output):
    selection = read_json(selection_path)
    if not isinstance(selection, dict):
        raise ValueError("Selection must be an original Monitoring selection object")
    archive_scope = selection.get("archive_scope", "complete")
    if archive_scope not in {"complete", "selected"}:
        raise ValueError("archive_scope must be complete or selected")
    service = MonitoringWorkspace(workspace, export_root=output / "exports")
    receipt_path = output / "receiving.json"
    identity = digest({"project": workspace.project, "workspace": str(workspace.root), "selection": selection})
    state = read_json(receipt_path) if receipt_path.exists() else {"request": identity, "selection": selection}
    if state["request"] != identity:
        raise ValueError("Receiving directory belongs to a different original selection")

    def saved(name, value):
        state[name] = value
        atomic_json(receipt_path, state)
        return value

    network, plan = _records(service, selection, state, saved)
    if plan["status"] not in {"optimal", "feasible"}:
        saved("design_outcome", plan)
        return state
    if "campaign_id" not in state:
        revision = service.create_campaign(plan_id=plan["id"], title=selection.get("title", "Monitoring campaign"),
                                           operation_id="receiving-" + identity)
        saved("campaign_id", revision["campaign_id"])
    campaign = service.campaign(state["campaign_id"])
    if campaign["plan"]["id"] != plan["id"]:
        raise ValueError("The original campaign changed to a different plan")
    original_revision = campaign["revision"]["id"]
    if state.get("campaign_revision_id", original_revision) != original_revision:
        raise ValueError("The sender campaign advanced; use a new receiving selection/output for its new revision")
    saved("campaign_revision_id", original_revision)
    context = _observed_context(workspace, selection, selection_path, campaign, state, saved, output)
    export_selection = {"campaign_id": state["campaign_id"], "expected_revision_id": original_revision}
    if context:
        export_selection["context_id"] = context["id"]
    if "field_package" not in state:
        saved("field_package", service.export(**export_selection))
    saved("field_package_verification", _export_members(
        state["field_package"], "eco.monitoring.export/1", context=context, campaign=campaign["revision"]))
    if "workspace_archive" not in state:
        if archive_scope == "selected":
            from model.study_transfer import export_study
            roots = [{"kind": "monitoring_heads", "id": state["campaign_id"]}]
            if context:
                roots.append({"kind": "monitoring_observed_contexts", "id": context["id"]})
            exported = export_study(workspace, output / "selected-monitoring-study.zip", {
                "title": selection.get("title", plan["title"]),
                "roots": roots, "include_related_results": True,
            })
            saved("workspace_archive", exported)
        else:
            saved("workspace_archive", service.export(**export_selection, format="workspace"))
    archive = _download(state["workspace_archive"])
    manifest = portable.inspect_archive(archive, verify=True)
    if "received" not in state:
        destination = output / "received"
        if destination.exists():
            # A restore that finished before its receipt was saved can be recovered
            # only when every original archive member still has its original bytes.
            for name, body in manifest["members"].items():
                path = destination / name
                if not path.is_file() or path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
                    raise ValueError("Unrecorded receiving directory differs from the native archive")
            result = {"workspace": str(destination / "workspace"), "application": str(destination / "application")}
        else:
            result = portable.restore(archive, destination)
        saved("received", result)
    received_workspace = Workspace(state["received"]["workspace"])
    if received_workspace.project != workspace.project:
        raise ValueError("The received original project identity differs")
    recipient = MonitoringWorkspace(received_workspace)
    for kind, record in (("networks", network), ("plans", plan), ("revisions", campaign["revision"])):
        if recipient.get(kind, record["id"]) != record:
            raise ValueError("A restored original Monitoring record differs: " + kind)
    recipient.verify_sources(network)
    if context:
        from model import monitoring_observed_context as observed
        restored_context = observed.inspect(received_workspace, context["id"])
        if restored_context != context:
            raise ValueError("The received original observational context differs")
        binding = context["source_binding"]
        if received_workspace._get("sources", binding["source_collection_id"]) != workspace._get("sources", binding["source_collection_id"]):
            raise ValueError("The received original observation source collection differs")
        saved("received_observed_context", {
            "id": restored_context["id"], "sha256": digest(restored_context),
            "source_binding": restored_context["source_binding"],
            "campaign_revision_id": restored_context["campaign_revision_id"],
        })
    if archive_scope == "selected":
        from model.study_transfer import verify_received_studies
        saved("selected_study_verification", verify_received_studies(received_workspace))
    reopened = recipient.campaign(state["campaign_id"])
    if "independent_revision" not in state:
        request = state.get("independent_request") or {
            "campaign_id": state["campaign_id"], "expected_revision_id": original_revision,
            "operation_id": "recipient-" + identity,
            "title": selection.get("title", plan["title"]) + " — receiving copy",
        }
        if "independent_request" not in state and reopened["revision"]["id"] != original_revision:
            raise ValueError("The received campaign advanced before the independent receiving edit")
        saved("independent_request", request)
        revision = recipient.revise_campaign(**request)
        saved("independent_revision", revision["id"])
    recipient.get("revisions", state["independent_revision"])
    if service.campaign(state["campaign_id"])["revision"]["id"] != original_revision:
        raise ValueError("Sender changed during independent receiving")
    if context:
        # The saved source context still reopens against its historical revision
        # after the receiving campaign appends an independently editable revision.
        if observed.inspect(received_workspace, context["id"]) != context:
            raise ValueError("Original observed context changed after receiving continuation")
    if archive_scope == "selected":
        saved("continued_study_verification", verify_received_studies(received_workspace))
    saved("summary", {
        "source_catchments": len(network["nodes"]), "source_stations": len(network["stations"]),
        "selected_ids": plan["selected_ids"], "scheduled_visits": len(plan["calendar"]["visits"]),
        "campaign_cost": plan["cost"], "original_source_bindings": network["source_bindings"],
        "original_project": workspace.project, "original_campaign_revision_id": original_revision,
        "observed_context_id": context["id"] if context else None,
        "observed_context_summary": context["summary"] if context else None,
        "received_independent_revision_id": state["independent_revision"],
        "archive_scope": archive_scope, "complete": True,
    })
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(receive(args.workspace, args.selection, args.output), indent=2))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        parser.exit(2, "Monitoring receiving: " + str(exc) + "\n")


if __name__ == "__main__":
    main()
