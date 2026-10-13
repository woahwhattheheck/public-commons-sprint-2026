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


def _retained_preparation(workspace, output, selection_bytes, normalized_selection):
    """Read the exact original admission without changing its native progress."""
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
    return original, state, prepared


def reference_snapshot(workspace, prepared, reference_basis):
    """Verify the selected reference trio and the retained full-design snapshot."""
    from source_tools.headwaters_parameter_course import _load, reference_report_basis
    from model.model_selection import run_models, validate_completed_run
    from model.native_versions import validate_run_comparison

    _require(isinstance(reference_basis, dict), "Retain the exact reference report basis")
    record, plan, directory = _load(workspace, prepared["ensemble_id"])
    course = read_json(directory / "headwaters-results.json")
    actual = reference_report_basis(workspace, plan["id"], course)
    selected = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    expected = {"grid_id": prepared["grid_id"], "base_profile_id": prepared["profile_id"],
                "baseline_scenario_id": prepared["baseline_scenario_id"],
                "alternative_scenario_ids": prepared["alternative_scenario_ids"]}
    _require(prepared["project_id"] == workspace.project["id"]
             and record["selection"] == expected
             and digest(record["selection"]) == record["selection_sha256"]
             and plan["grid_id"] == expected["grid_id"]
             and plan["baseline_scenario_id"] == expected["baseline_scenario_id"]
             and plan["base_profile_ids"] == [expected["base_profile_id"]]
             and plan["alternative_scenario_ids"] == expected["alternative_scenario_ids"]
             and plan["members"][0]["profile_id"] == expected["base_profile_id"]
             and record["input_source_collection_id"] == prepared["source_collection_id"]
             and actual == reference_basis and actual["reference_ready"] is True
             and actual["state"] == "reference_complete"
             and actual["course_state"] in {"partial", "complete"}
             and actual["reference_profile_id"] == prepared["profile_id"]
             and len(selected) == 3 and len(set(selected)) == 3
             and actual["reference_run_ids"] == selected
             and actual["baseline_run_id"] == selected[0]
             and actual["alternative_run_ids"] == selected[1:],
             "Select the original completed reference trio and unchanged full-design progress")
    for key in selected:
        run = workspace.inspect_run(key)
        validate_completed_run(run)
        _require(tuple(run_models(run)) == ("ndr", "sdr"),
                 "The original reference requires both completed NDR and SDR")
    comparison = workspace.retained_item("comparisons", actual["comparison_id"])
    _require(comparison["baseline_run_id"] == selected[0]
             and [row["run_id"] for row in comparison["alternatives"]] == selected[1:],
             "The reference comparison changed its original three-run order")
    validate_run_comparison(workspace, comparison)
    members = {}
    root = workspace.root.resolve()
    def keep(relative, expected=None):
        relative = portable.member_name(relative).as_posix()
        path = root / relative
        _require(not path.is_symlink() and path.resolve(strict=True).is_relative_to(root)
                 and stat.S_ISREG(path.stat().st_mode), "Retain an original reference record")
        body = path.read_bytes()
        value = json.loads(body)
        _require(expected is None or value == expected,
                 "Original reference record changed: " + relative)
        members[relative] = {"path": relative, "bytes": len(body),
                             "sha256": hashlib.sha256(body).hexdigest()}
        return value
    def artifacts(directory, values):
        values = values.values() if isinstance(values, dict) else values
        for item in values:
            relative = (Path(directory) / portable.member_name(item["path"])).as_posix()
            entry = {"path": relative, "bytes": item["bytes"], "sha256": identifier(item["sha256"])}
            _require(relative not in members or members[relative] == entry,
                     "Reference artifacts have conflicting original identities")
            members[relative] = entry
    ensemble_directory = "ensemble_results/" + plan["id"]
    keep("ensembles/" + plan["id"] + ".json")
    keep(ensemble_directory + "/headwaters-course.json", record)
    keep(ensemble_directory + "/headwaters-results.json", course)
    keep(ensemble_directory + "/state.json")
    keep(ensemble_directory + "/operation.json", course["operation"])
    keep("comparisons/" + comparison["id"] + "/comparison.json", comparison)
    for alternative in comparison["alternatives"]:
        artifacts("comparisons/" + comparison["id"], alternative["artifacts"])
    scalar = course["operation"].get("report")
    _require(scalar and scalar.get("state") == "complete",
             "Retain the actual rendered scalar report for the reference edition")
    artifacts("ensemble_reports/" + scalar["id"], scalar["files"])
    joint = course["joint_decisions"]
    for product in joint.get("support_group_reports") or [joint["report"]]:
        report_id = identifier(product["report_id"])
        directory = ensemble_directory + "/joint-decisions/" + report_id
        manifest = keep(directory + "/manifest.json")
        report = keep(directory + "/report.json")
        _require(manifest["report_id"] == report_id and report["id"] == report_id,
                 "Retain each original reference support-group decision report")
        artifacts(directory, manifest["members"])
        _require(product["archive_identity"]["path"] == directory + "/decision-package.zip",
                 "Retain the original reference decision archive path")
        artifacts("", [product["archive_identity"]])
        keep(ensemble_directory + "/joint-decisions/" + report_id + "-selection.json")
    paired = []
    for product in course["operation"].get("raster_products", []):
        if product.get("state") != "complete":
            continue  # Original pending/failed product status remains in the captured course.
        from model.paired_ensemble import EnsembleWorkspace
        analysis_id = identifier(product["analysis_id"])
        directory = "ensemble-products/" + analysis_id
        keep(directory + "/analysis.json")
        keep(directory + "/reports.json")
        saved = EnsembleWorkspace(workspace).describe(analysis_id)
        choice, reports = saved["selection"], saved["reports"]
        scenario = product["scenario_id"]
        expected_pairs = {}
        for member in plan["members"]:
            by_scenario = {item["scenario_id"]: item for item in member["runs"]}
            left, right = by_scenario[plan["baseline_scenario_id"]], by_scenario[scenario]
            if left["state"] == right["state"] == "complete":
                expected_pairs[member["profile_id"]] = (left["run_id"], right["run_id"], scenario)
        chosen = {member["profile_id"]: (member["baseline_run_id"], member["alternative_run_id"],
                                        member["scenario_id"]) for member in choice["members"]}
        refs = choice["source_references"]
        _require(saved["state"] == "complete" and chosen == expected_pairs
                 and len(chosen) == len(choice["members"])
                 and choice["planned_member_count"] == len(plan["members"])
                 and choice["selected_member_count"] == len(chosen)
                 and prepared["profile_id"] in chosen
                 and refs["project_id"] == workspace.project["id"]
                 and refs["grid_id"] == plan["grid_id"]
                 and refs["baseline_scenario"]["id"] == plan["baseline_scenario_id"]
                 and refs["alternative_scenario"]["id"] == scenario
                 and reports["ensemble_id"] == analysis_id
                 and digest(reports) == product["report_signature"],
                 "Retain the actual available-member paired product and full planned count")
        artifacts(directory, saved["artifacts"])
        artifacts(directory, reports["files"])
        artifacts("", [product["archive"]])
        paired.append({"id": analysis_id, "scenario_id": scenario,
                       "selected_member_count": len(chosen),
                       "planned_member_count": len(plan["members"]),
                       "report_signature": product["report_signature"]})
    return {"basis": actual, "record": record, "plan": plan, "course": course,
            "comparison": comparison, "members": members, "paired_products": paired}


def retained_prepared(workspace, output, selection_bytes, normalized_selection):
    """Resume full handover only after every original native run completes."""
    original, state, prepared = _retained_preparation(
        workspace, output, selection_bytes, normalized_selection)
    plan = workspace._get("ensembles", prepared["ensemble_id"])
    run_ids = {item["run_id"] for member in plan["members"] for item in member["runs"]}
    _require(run_ids and all(workspace.inspect_run(key)["state"] == "complete" for key in run_ids),
             "Adopt report-only handover after all original native runs complete")
    return original, state, prepared


def retained_reference_prepared(workspace, output, selection_bytes, normalized_selection):
    """Read a completed reference edition without completing or dispatching sensitivities."""
    from source_tools.headwaters_parameter_course import reference_report_basis
    original, state, prepared = _retained_preparation(
        workspace, output, selection_bytes, normalized_selection)
    course = read_json(workspace.root / "ensemble_results" / prepared["ensemble_id"]
                       / "headwaters-results.json")
    basis = reference_report_basis(workspace, prepared["ensemble_id"], course)
    reference_snapshot(workspace, prepared, basis)
    return original, state, prepared, basis


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
            archive_selection=None, handover=None, utility_context=None, reference_basis=None):
    """Bind full-course completion, or an explicitly separate reference edition."""
    members = {}
    cache = {}
    source_ids = set()
    root = workspace.root.resolve()
    reference = (reference_snapshot(workspace, prepared, reference_basis)
                 if reference_basis is not None else None)

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
    run_states = {}
    for run_id in run_ids:
        run = workspace.inspect_run(run_id)
        _require(run["id"] == run_id
                 and (run["state"] == "complete" or
                      (reference is not None and run_id not in selected_runs)),
                 "Finish every selected original native run before complete handover")
        run_states[run_id] = run["state"]
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

    if reference is not None:
        for item in reference["members"].values():
            descriptor("", item)

    scientific_id = identifier(scientific["id"])
    operation = record("ensemble-study-sources/" + scientific_id + "/operation.json",
                       {k: v for k, v in scientific.items() if k != "source_state"})
    if reference is not None:
        from model.ensembles import Ensembles
        from model import ensemble_report
        release = record("ensemble_reports/" + operation["selection"]["report_id"] + "/report.json")
        report = release["report"]
        actual_runs = {key: workspace.inspect_run(key) for key in run_ids}
        _require(operation.get("native_state") == report["state"]
                 and operation.get("progress") == report.get("progress", {})
                 and report.get("progress") == reference["basis"]["native_progress"]
                 and operation["selection"]["run_signature"] == Ensembles(workspace)._signature(actual_runs)
                 and operation["selection"]["summary_signature"] == ensemble_report.summary_signature(report)
                 and report["run_signature"] == operation["selection"]["run_signature"],
                 "Reference scientific report must retain this exact full-design progress")
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
                 and handover_record.get("reference_basis") == reference_basis
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
    if reference is not None:
        value.update(schema="upstate.geographic-reference-handover-binding/v1",
                     completion_scope="reference", reference_basis=reference["basis"],
                     completed_run_ids=sorted(key for key, state in run_states.items() if state == "complete"),
                     pending_run_ids=sorted(key for key, state in run_states.items() if state != "complete"),
                     run_states=run_states)
    return {"id": digest(value), **value}



def retain_binding(workspace, output, prepared, scientific, delivery, review, response_id, *,
                   archive_selection=None, handover=None, utility_context=None, reference_basis=None):
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
    if reference_basis is not None:
        reference_snapshot(workspace, prepared, reference_basis)
        scope.update(completion_scope="reference", reference_basis=reference_basis)
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
                       utility_context=utility_context, reference_basis=reference_basis)
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
