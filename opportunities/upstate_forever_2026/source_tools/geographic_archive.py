"""Bind the existing geographic receiving archive to its original saved science.

The maintained portable writer/reader owns serialization and restoration.
This helper adds the selected original records and artifact identities; it never
prepares inputs, runs models, renders a report, or changes a received Workspace.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import stat
import zipfile

from model.common import atomic_json, digest, identifier, read_json
from model import portable, reviews


def _require(value, message):
    if not value:
        raise ValueError(message)


def retained_prepared(workspace, output, selection_bytes, normalized_selection):
    """Resume a completed preparation under the original admitted operation."""
    output = Path(output)
    original = read_json(output / "admission.json")
    state = read_json(output / "receiving.json")
    prepared = read_json(output / "prepared.json")
    original_bytes = (output / "original-selection.json").read_bytes()
    operation = original.get("id")
    _require(operation == digest({k: v for k, v in original.items() if k != "id"}),
             "Original geographic admission identity changed")
    _require(state.get("operation_id") == operation
             and state.get("project_id") == workspace.project["id"]
             and original.get("project_id") == workspace.project["id"],
             "Resume the original geographic operation and Workspace")
    _require(original_bytes == selection_bytes
             and hashlib.sha256(original_bytes).hexdigest() == original.get("selection_bytes_sha256")
             and original.get("selection") == normalized_selection,
             "Resume the original complete geographic selection")
    _require(prepared == state.get("prepared")
             and prepared.get("selection") == normalized_selection
             and prepared.get("project_id") == workspace.project["id"]
             and prepared.get("id") == state.get("geographic_edition_id")
             and prepared.get("ensemble_id") == state.get("ensemble_id"),
             "Retained preparation differs from its admitted geographic operation")
    relative = portable.member_name(prepared["directory"])
    original_prepared = read_json(workspace.root.joinpath(*relative.parts) / "prepared.json")
    _require(original_prepared == prepared, "Original Workspace geographic preparation changed")
    plan = workspace._get("ensembles", prepared["ensemble_id"])
    run_ids = {item["run_id"] for member in plan["members"] for item in member["runs"]}
    _require(run_ids and all(workspace.inspect_run(key)["state"] == "complete" for key in run_ids),
             "Adopt report-only handover after all original native runs complete")
    return original, state, prepared


def _archive_selection(requested, handover):
    requested = ({"include_intermediates": True, "include_deliveries": True}
                 if requested is None else dict(requested))
    _require(set(requested) == {"include_intermediates", "include_deliveries"}
             and all(type(value) is bool for value in requested.values()),
             "Bind the exact requested native archive policy")
    if handover is not None:
        requested.update(delivery_id=identifier(handover["id"]), include_delivery_assets=True)
    return requested


def binding(workspace, prepared, scientific, delivery, review, response_id, *,
            archive_selection=None, handover=None, utility_context=None):
    """Describe the exact original selection required in a complete archive."""
    members = {}
    cache = {}
    source_ids = set()
    root = workspace.root.resolve()

    def add(relative, expected):
        relative = portable.member_name(relative).as_posix()
        item = {"bytes": expected["bytes"], "sha256": expected["sha256"]}
        identifier(item["sha256"])
        _require(type(item["bytes"]) is int and item["bytes"] >= 0,
                 "Original archive member length is invalid")
        key = "workspace/" + relative
        _require(key not in members or members[key] == item,
                 "Selected original member has conflicting identities: " + relative)
        members[key] = item

    def record(relative, expected=None):
        member = portable.member_name(relative)
        path = root.joinpath(*member.parts)
        _require(not path.is_symlink() and path.resolve(strict=True).is_relative_to(root),
                 "Selected original record escapes its Workspace")
        _require(stat.S_ISREG(path.stat().st_mode), "Select an original regular record")
        body = path.read_bytes()
        value = json.loads(body)
        _require(expected is None or value == expected,
                 "Selected original record changed: " + relative)
        add(relative, {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
        return value

    def immutable(kind, key):
        key = identifier(key)
        value = workspace._get(kind, key)
        record(kind + "/" + key + ".json", {k: v for k, v in value.items() if k != "id"})
        return value

    def descriptor(directory, item):
        path = portable.member_name(item["path"])
        add((Path(directory) / Path(*path.parts)).as_posix(), item)

    def collection(key):
        key = identifier(key)
        if key in source_ids:
            return
        value = immutable("sources", key)
        source_ids.add(key)
        cache[("sources", key)] = value
        for entry in value["entries"]:
            cache[(key, entry["id"])] = entry
        bodies = [value["original_manifest"]]
        for entry in value["entries"]:
            bodies.extend([entry["body"], *entry["companions"]])
        for body in bodies:
            add(body["object"], body)

    _require(prepared["project_id"] == workspace.project["id"]
             and scientific.get("workspace_id") == workspace.project["id"]
             and scientific.get("ensemble_id") == prepared["ensemble_id"]
             and scientific.get("state") == "complete",
             "Select the completed original geographic scientific report")
    record("workspace.json", workspace.project)
    geo_directory = portable.member_name(prepared["directory"]).as_posix()
    _require(geo_directory == "geographic-headwaters/" + identifier(prepared["id"]),
             "Selected preparation has another geographic directory")
    record(geo_directory + "/prepared.json", prepared)
    input_receipt = record(geo_directory + "/inputs/input-receipt.json")
    _require(input_receipt.get("identity", {}).get("id") == prepared["id"],
             "Original geographic input receipt belongs to another edition")
    omitted_runtime_members = []
    for item in input_receipt["files"]:
        # WAT retains its held .prepare.lock in the original input directory.
        # The full portable writer intentionally omits locks; the unchanged
        # input receipt still records that original zero-content runtime file.
        if portable.member_name(item["path"]).name.endswith(".lock"):
            omitted_runtime_members.append(geo_directory + "/inputs/" + item["path"])
            continue
        descriptor(geo_directory + "/inputs", item)

    plan = immutable("ensembles", prepared["ensemble_id"])
    run_ids = sorted({item["run_id"] for member in plan["members"] for item in member["runs"]})
    selected_runs = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    selected_scenarios = [prepared["baseline_scenario_id"], *prepared["alternative_scenario_ids"]]
    _require(len(selected_runs) == len(set(selected_runs))
             and len(selected_runs) == len(selected_scenarios)
             and set(selected_runs).issubset(run_ids),
             "Selected geographic baseline and alternatives differ from the original ensemble")
    grids = {}
    profiles = {}
    scenarios = {}
    for run_id in run_ids:
        run = workspace.inspect_run(run_id)
        _require(run["id"] == run_id and run["state"] == "complete",
                 "Finish every selected original native run before complete handover")
        record("runs/" + run_id + "/run.json", run)
        for item in run["artifacts"].values():
            descriptor("runs/" + run_id, item)
        selected = run["selection"]
        if run_id in selected_runs:
            index = selected_runs.index(run_id)
            _require(selected["grid_id"] == prepared["grid_id"]
                     and selected["profile_id"] == prepared["profile_id"]
                     and selected["scenario_id"] == selected_scenarios[index],
                     "Original geographic run changed its selected grid, profile or scenario")
        grids[selected["grid_id"]] = workspace.get_grid(selected["grid_id"])
        profiles[selected["profile_id"]] = immutable("profiles", selected["profile_id"])
        scenarios[selected["scenario_id"]] = immutable("scenarios", selected["scenario_id"])
    for grid_id, grid in grids.items():
        record("grids/" + grid_id + "/grid.json", grid)
        for item in grid["files"].values():
            descriptor("grids/" + grid_id, item)
        collection(grid["spec"]["source_collection_id"])
    for value in [*profiles.values(), *scenarios.values()]:
        collection(value["source_collection_id"])
    collection(prepared["source_collection_id"])
    collection(scientific["source"]["source_collection_id"])

    scientific_id = identifier(scientific["id"])
    operation = record("ensemble-study-sources/" + scientific_id + "/operation.json",
                       {k: v for k, v in scientific.items() if k != "source_state"})
    for item in operation["files"].values():
        descriptor("", item)
    delivery_id = identifier(delivery["id"])
    saved_delivery = record("deliveries/" + delivery_id + "/delivery-state.json")
    _require(saved_delivery.get("id") == delivery_id
             and saved_delivery.get("state") == "complete"
             and saved_delivery.get("selection", {}).get("baseline_run_id") == prepared["baseline_run_id"]
             and saved_delivery.get("selection", {}).get("scenario_run_ids") == prepared["alternative_run_ids"],
             "Selected geographic delivery changed its original model cohort")

    utility_id = None
    utility_sources = set()
    if utility_context is not None:
        from model import geographic_receiving_context as utilities
        from model import receiving_waters as waters, receiving_water_report_source as reports
        utility_id = identifier(utility_context["id"])
        original_context = utilities.inspect(workspace, utility_id)
        _require(original_context == utility_context
                 and original_context["prepared_id"] == prepared["id"]
                 and original_context["baseline_run_id"] == prepared["baseline_run_id"]
                 and original_context["alternative_run_ids"] == prepared["alternative_run_ids"],
                 "Retain the utility context of the selected geographic native cohort")
        context_directory = "geographic-receiving-contexts/" + utility_id
        record(context_directory + "/context.json", original_context)
        record(context_directory + "/selection.json", original_context["identity"])
        # The declared source selectors include contextual original intake
        # entries as well as the geometry/report source collections.
        def context_sources(value):
            if isinstance(value, dict):
                if "source_collection_id" in value:
                    collection(value["source_collection_id"])
                for item in value.values():
                    context_sources(item)
            elif isinstance(value, list):
                for item in value:
                    context_sources(item)
        context_sources(original_context["identity"]["plan_selections"])
        for plan_id in original_context["plan_ids"].values():
            original_plan = waters.inspect_plan(workspace, plan_id)
            directory = "receiving-water-plans/" + identifier(plan_id)
            record(directory + "/plan.json", original_plan)
            for item in original_plan["files"].values():
                descriptor(directory, item)
        for item in original_context["analyses"]:
            analysis_id = identifier(item["analysis_id"])
            analysis = waters.inspect(workspace, analysis_id, verify=True)
            directory = "receiving-water-analyses/" + analysis_id
            record(directory + "/analysis.json", analysis)
            for artifact in analysis["files"].values():
                descriptor(directory, artifact)
            report_id = identifier(item["report_source_id"])
            report = reports.inspect(workspace, report_id, verify=True)
            record("receiving-water-report-sources/" + report_id + "/report.json", report)
            for artifact in report["files"]:
                descriptor("", artifact)
            collection(item["source"]["source_collection_id"])
        utility_sources.update(utilities.source_collection_ids(original_context))

    archive_delivery = None
    if handover is not None:
        handover_id = identifier(handover["id"])
        _require(handover.get("project_id") == workspace.project["id"]
                 and handover_id == digest(handover["identity"]),
                 "Retain the original geographic handover identity")
        directory = Path(handover["directory"]).resolve(strict=True)
        _require(directory.name == handover_id,
                 "Use the handover's original immutable directory")
        handover_record = read_json(directory / "handover-record.json")
        handover_complete = read_json(directory / "handover-complete.json")
        _require(handover_record.get("prepared") == prepared
                 and handover_record.get("scientific", {}).get("id") == scientific_id
                 and handover_record.get("delivery_id") == delivery_id
                 and handover_record.get("review", {}).get("review_id") == review["id"]
                 and handover_record.get("review", {}).get("latest_response_id") == response_id
                 and digest(handover_record) == handover["identity"]["content_sha256"]
                 and handover_complete.get("id") == handover_id
                 and handover_complete.get("identity") == handover["identity"],
                 "Opening page belongs to another geographic scientific/review edition")
        _inputs, delivery_members, archive_delivery = portable._delivery_inputs(
            directory, handover["files"])
        _require(archive_delivery["id"] == handover_id
                 and archive_delivery["files"].get("opening_page", {}).get("path")
                     == "delivery/START_HERE.html",
                 "Retain the native geographic opening page")
        for name, item in delivery_members.items():
            members[name] = item

    retained_review = immutable("reviews", review["id"])
    _require(retained_review == review, "Selected original review changed")
    selected = retained_review["selection"]
    _require(delivery_id in selected["delivery_ids"]
             and set(selected_runs).issubset(selected["run_ids"])
             and {prepared["source_collection_id"], scientific["source"]["source_collection_id"]}
                 .union(utility_sources).issubset(selected["source_collection_ids"]),
             "Selected review omits the original geographic science")
    for key in selected["source_collection_ids"]:
        collection(key)
    responses = reviews.response_prefix(reviews.history(workspace, review["id"]),
                                        through_response_id=response_id)
    for response in responses:
        immutable("review-responses", response["id"])
    for artifact in retained_review["artifacts"]:
        path = reviews._resolve(workspace, artifact, cache).resolve(strict=True)
        _require(path.is_relative_to(root), "Original review artifact escapes its Workspace")
        add(path.relative_to(root).as_posix(), artifact)
    value = {
        "schema": "upstate.geographic-handover-binding/v1",
        "project": workspace.project,
        "archive_selection": _archive_selection(archive_selection, handover),
        "archive_delivery": archive_delivery,
        "handover_id": handover["id"] if handover is not None else None,
        "utility_context_id": utility_id,
        "geographic_edition_id": prepared["id"], "ensemble_id": prepared["ensemble_id"],
        "baseline_run_id": prepared["baseline_run_id"],
        "alternative_run_ids": prepared["alternative_run_ids"], "run_ids": run_ids,
        "grid_ids": sorted(grids), "profile_ids": sorted(profiles),
        "scenario_ids": sorted(scenarios), "source_collection_ids": sorted(source_ids),
        "scientific_source_id": scientific_id, "delivery_id": delivery_id,
        "review_id": review["id"], "review_response_id": response_id,
        "review_response_ids": [row["id"] for row in responses],
        "omitted_runtime_locks": sorted(omitted_runtime_members),
        "members": dict(sorted(members.items())),
    }
    return {"id": digest(value), **value}



def retain_binding(workspace, output, prepared, scientific, delivery, review, response_id, *,
                   archive_selection=None, handover=None, utility_context=None):
    """Retain the pre-backup selection before the archive's publication window.

    Its immutable generation survives a lost outer receiving checkpoint.
    A later recipient may keep editing its own received Workspace; those edits
    are not substituted into this original archived science binding.
    """
    scope = {
        "project_id": workspace.project["id"], "geographic_edition_id": prepared["id"],
        "ensemble_id": prepared["ensemble_id"], "scientific_source_id": scientific["id"],
        "delivery_id": delivery["id"], "review_id": review["id"],
        "review_response_id": response_id,
        "archive_selection": _archive_selection(archive_selection, handover),
        "handover_id": handover["id"] if handover is not None else None,
        "utility_context_id": utility_context["id"] if utility_context is not None else None,
    }
    path = Path(output) / "archive-bindings" / (digest(scope) + ".json")
    if path.exists():
        selected = read_json(path)
        _require(selected.get("id") == digest({k: v for k, v in selected.items() if k != "id"})
                 and selected.get("project", {}).get("id") == scope["project_id"]
                 and all(selected.get(key) == value for key, value in scope.items()
                         if key != "project_id"),
                 "Saved geographic archive binding differs from the selected original edition")
        return selected
    selected = binding(workspace, prepared, scientific, delivery, review, response_id,
                       archive_selection=archive_selection, handover=handover,
                       utility_context=utility_context)
    atomic_json(path, selected, immutable=True)
    return selected

def verify_archive(path, selected, previous=None):
    """Verify one opened archive and its exact selected original member closure."""
    path = Path(path)
    _require(selected.get("id") == digest({k: v for k, v in selected.items() if k != "id"}),
             "Selected geographic handover binding changed")
    with path.open("rb") as stream:
        before = portable._archive_identity(stream)
        with zipfile.ZipFile(stream) as archive:
            manifest = portable._inspect_archive(archive, verify=True)
        checksum = portable._archive_digest(stream, before)
        current = path.lstat()
        _require(stat.S_ISREG(current.st_mode)
                 and (current.st_dev, current.st_ino, current.st_size,
                      current.st_mtime_ns, current.st_ctime_ns) == before,
                 "Geographic archive pathname changed during verification")
    _require(manifest["project"] == selected["project"]
             and manifest.get("selection") == selected["archive_selection"]
             and manifest.get("delivery") == selected.get("archive_delivery"),
             "Select the original complete geographic Workspace archive")
    for name, expected in selected["members"].items():
        actual = manifest["members"].get(name)
        _require(isinstance(actual, dict)
                 and all(actual.get(key) == expected[key] for key in ("bytes", "sha256")),
                 "Archive omits or changes selected geographic science: " + name)
    if previous is not None:
        _require(previous.get("bytes") == before[2] and previous.get("sha256") == checksum
                 and previous.get("binding_id", selected["id"]) == selected["id"],
                 "Geographic archive differs from its original saved bytes")
    record = {"path": str(path), "bytes": before[2], "sha256": checksum,
              "binding_id": selected["id"]}
    return manifest, record
