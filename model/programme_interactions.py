"""Retained native interaction results in the original computation programme.

Programme execution, native run identities, cache ownership and archive format
remain with their maintained services. This adapter supplies exact selections,
completed-result synchronization and immutable report attachments.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import io
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     identifier, now, read_json, verify_file)
from .compute_programme import ComputeProgrammes, SELECTION_SCHEMA, _models
from .profiles import scenario_spec

PREFIX = "upstate.native-interactions:"
LINK_SCHEMA = "upstate.programme-interaction-link/v1"
INDEX_SCHEMA = "upstate.programme-interaction-links/v1"
CONTEXT_SCHEMA = "upstate.programme-interaction-report/v1"
LINK_DIRECTORY = "interaction-links"
RESULT_FIELDS = (
    "title", "application_order", "estimator", "permutation_samples", "metrics",
    "support", "scopes", "summaries", "action_attribution", "pair_interactions",
    "interpretation", "native_versions", "native_version_binding",
)


def _engine():
    from . import native_interactions
    return native_interactions


def _plan(workspace, plan_id):
    engine = _engine()
    plan = engine.get_plan(workspace, identifier(plan_id))
    engine._check_snapshot(workspace, plan)
    return plan


def _directory(manager, programme_id):
    return manager._directory(identifier(programme_id)) / LINK_DIRECTORY


def _index(manager, programme_id):
    path = _directory(manager, programme_id) / "active.json"
    if not path.exists():
        return {"schema": INDEX_SCHEMA, "programme_id": programme_id,
                "workspace_id": manager.workspace.project["id"], "links": {}}
    value = read_json(path)
    if (value.get("schema") != INDEX_SCHEMA or value.get("programme_id") != programme_id
            or value.get("workspace_id") != manager.workspace.project["id"]
            or not isinstance(value.get("links"), dict)):
        raise ValueError("Programme interaction index changed its retained identity")
    for plan_id, link_id in value["links"].items():
        identifier(plan_id)
        identifier(link_id)
    return value


def _descriptor(workspace, path, **metadata):
    return describe_file(workspace.root, path, **metadata)


def _verify(workspace, descriptor, verified_members=None):
    if verified_members is not None:
        name = "workspace/" + descriptor["path"]
        member = verified_members.get(name)
        if (member is None or member["sha256"] != descriptor["sha256"]
                or member["bytes"] != descriptor["bytes"]):
            raise ValueError("Transferred interaction file differs from its retained descriptor: " + name)
        # The original archive reader already verified and extracted this member.
        from .portable import member_name
        return Path(workspace.root).joinpath(*member_name(descriptor["path"]).parts)
    return verify_file(workspace.root, descriptor)


def _mask_context(workspace, plan):
    state = plan.get("state") or {}
    collection_id = state.get("source_collection_id")
    if not collection_id:
        raise ValueError("Prepare the original conservation action masks first")
    collection = workspace._get("sources", identifier(collection_id))
    expected = {}
    baseline = plan["snapshot"]["baseline_scenario"]
    groups = [(baseline.get("source_collection_id"), baseline.get("patches", []))]
    groups.extend((action["source_collection_id"], action["patches"])
                  for action in plan["actions"])
    mapping = {}
    for source_collection_id, patches in groups:
        original = plan["snapshot"]["source_collections"].get(source_collection_id)
        for patch in patches:
            source_id = patch["mask_source_id"]
            key = digest({"collection_id": source_collection_id, "source_id": source_id})
            value = deepcopy(_engine()._source_entry(original, source_id))
            value["id"] = "interaction-mask-" + key
            value["original_source"] = {"collection_id": source_collection_id,
                                        "source_id": source_id}
            expected[key] = value
            mapping[key] = value["id"]
    if collection.get("entries") != [expected[key] for key in sorted(expected)]:
        raise ValueError("Composed conservation masks differ from their original retained sources")
    return collection_id, mapping


def _cases(workspace, plan, records=None, *, completed=False):
    """Check exact generated scenarios; a mutable case checkpoint is not authority."""
    engine = _engine()
    state = plan.get("state") or {}
    retained = state.get("cases", {}) if records is None else {
        row["key"]: row for row in records}
    if set(retained) != {row["key"] for row in plan["coalitions"]}:
        raise ValueError("Retain every exact coalition case before programme adoption")
    collection_id, mapping = _mask_context(workspace, plan)
    baseline_scenario = plan["snapshot"]["baseline_scenario"]
    baseline_selection = plan["snapshot"]["baseline_selection"]
    rows = []
    for case in plan["coalitions"]:
        bound = retained[case["key"]]
        if any(bound.get(key) != case[key] for key in ("mask", "action_ids")):
            raise ValueError("A coalition binding differs from its immutable selected actions")
        native = workspace.inspect_run(identifier(bound["run_id"]))
        if (native["selection"] != bound["selection"]
                or native["id"] != digest(native["selection"])):
            raise ValueError("A coalition binding differs from its original native selection")
        if case["mask"] == 0:
            expected_run = plan["selection"]["baseline_run_id"]
            if native["id"] != expected_run or native["selection"] != baseline_selection:
                raise ValueError("The empty coalition must retain the exact original baseline run")
        else:
            patches = engine._remapped_patches(
                baseline_scenario.get("patches", []),
                baseline_scenario.get("source_collection_id"), mapping)
            for index, action in enumerate(plan["actions"]):
                if case["mask"] & (1 << index):
                    patches.extend(engine._remapped_patches(
                        action["patches"], action["source_collection_id"], mapping))
            expected = deepcopy(baseline_scenario)
            expected.update(
                title=plan["title"] + " / " + ", ".join(case["action_ids"]),
                kind="landcover", source_collection_id=collection_id,
                reason="Ordered coalition of retained conservation actions: " + ", ".join(case["action_ids"]),
                patches=patches,
                interaction_context={"plan_id": plan["id"], "coalition_key": case["key"],
                                     "action_ids": case["action_ids"]})
            expected = {key: value for key, value in scenario_spec(expected).items()
                        if key not in ("id", "schema")}
            expected["schema"] = "upstate.scenarios/v1"
            if native["selection"].get("scenario_id") != digest(expected):
                raise ValueError("A coalition does not use its exact ordered conservation scenario")
            selected = {**baseline_selection, "scenario_id": digest(expected)}
            # New cases may have a newer requested InVEST declaration than the
            # retained baseline. Every other selection field stays exact; actual
            # completed-stage versions are checked by the native cohort engine.
            without_requested_version = lambda value: {
                key: item for key, item in value.items() if key != "invest_version"}
            requested_version = native["selection"].get("invest_version")
            if (without_requested_version(native["selection"]) != without_requested_version(selected)
                    or not isinstance(requested_version, str) or not requested_version.strip()
                    or _models(native["selection"].get("models")) != _models(baseline_selection.get("models"))):
                raise ValueError("A coalition changed its baseline grid, profile, model scope or original scenario")
        if completed and native.get("state") != "complete":
            raise ValueError("Complete the original native coalition before attaching it: " + case["key"])
        rows.append({**deepcopy(case), "run_id": native["id"],
                     "selection": deepcopy(native["selection"]), "state": native["state"]})
    return rows


def catalog(workspace):
    if not (Path(__file__).resolve().parent / "native_interactions.py").is_file():
        return {"interactions_available": False, "interaction_plans": [], "interaction_results": []}
    plans = _engine().list_plans(workspace)
    results = [{"id": row["result_id"], "result_id": row["result_id"],
                "plan_id": row["id"], "title": row["title"],
                "baseline_run_id": row["baseline_run_id"], "updated_at": row.get("updated_at"),
                "state": "complete"}
               for row in plans if row.get("state") == "complete" and row.get("result_id")]
    return {"interactions_available": True, "interaction_plans": plans,
            "interaction_results": results}


def preview(workspace, plan_id):
    plan = _plan(workspace, plan_id)
    state = plan.get("state") or {}
    bindings = state.get("cases", {})
    cases = []
    for case in plan["coalitions"]:
        row = bindings.get(case["key"], {})
        native = workspace.inspect_run(row["run_id"]) if row.get("run_id") else None
        cases.append({**deepcopy(case), "run_id": native["id"] if native else None,
                      "state": native.get("state") if native else "unprepared"})
    base = plan["snapshot"]["baseline_selection"]
    return {
        "schema": "upstate.interaction-programme-preview/v1", "plan_id": plan["id"],
        "title": plan["title"], "baseline_run_id": plan["selection"]["baseline_run_id"],
        "grid_id": base["grid_id"], "profile_id": base["profile_id"],
        "models": _models(base.get("models")), "estimator": plan["selection"]["estimator"],
        "counts": {"cases": len(cases), "prepared": sum(row["run_id"] is not None for row in cases),
                   "complete": sum(row["state"] == "complete" for row in cases)},
        "actions": [{key: deepcopy(action[key]) for key in
                    ("id", "title", "scenario_id", "patch_indexes")} for action in plan["actions"]],
        "cases": cases, "state": state.get("state", "planned"),
        "result_id": state.get("result_id"), "can_create": True,
        "interpretation": {
            "execution": "The original programme consumes the same retained native run IDs.",
            "order": "All subsets retain the study's fixed global raster edit order.",
            "report": "Programme pairwise comparisons and all-coalition common-support attribution retain separate quantities.",
        },
    }


def _selection(plan, cases):
    baseline_key = next(row["key"] for row in cases if row["mask"] == 0)
    rows = []
    for case in cases:
        native = case["selection"]
        row = {
            "key": case["key"],
            "title": (plan["title"] + " / baseline" if not case["action_ids"]
                      else plan["title"] + " / " + ", ".join(case["action_ids"])),
            "profile_id": native["profile_id"], "scenario_id": native["scenario_id"],
            "native_run_id": case["run_id"],
            "reason": "Original retained conservation coalition; global action order is unchanged.",
            "changes": {"interaction": {
                "plan_id": plan["id"], "coalition_key": case["key"],
                "mask": case["mask"], "action_ids": deepcopy(case["action_ids"]),
                "run_id": case["run_id"],
                "baseline_run_id": plan["selection"]["baseline_run_id"],
            }},
        }
        if "models" in native:
            row["models"] = deepcopy(native["models"])
        rows.append(row)
    return {
        "schema": SELECTION_SCHEMA, "title": plan["title"],
        "description": "Original native conservation interaction study " + plan["id"],
        "grid_id": plan["snapshot"]["baseline_selection"]["grid_id"],
        "baseline_run": baseline_key, "runs": rows, "source_reference": PREFIX + plan["id"],
    }


def _selection_matches(retained, proposed):
    if retained == proposed:
        return True
    # Earlier successful adoptions predate the explicit per-row native ID.
    # Exact original run bindings are separately required at both call sites.
    legacy = deepcopy(proposed)
    for row in legacy["runs"]:
        row.pop("native_run_id", None)
    return retained == legacy


def create(workspace, plan_id):
    """Prepare once, then adopt the exact native selections into the existing programme."""
    plan = _plan(workspace, plan_id)
    state = plan.get("state") or {}
    if set(state.get("cases", {})) != {case["key"] for case in plan["coalitions"]}:
        _engine().apply_plan(workspace, plan["id"], run_models=False)
        plan = _plan(workspace, plan["id"])
    cases = _cases(workspace, plan)
    manager = ComputeProgrammes(workspace)
    selection = _selection(plan, cases)
    proposed = manager.preview(selection)
    expected = {row["key"]: row["run_id"] for row in cases}
    if {row["key"]: row["run_id"] for row in proposed["runs"]} != expected:
        raise ValueError("Programme preparation must preserve every original coalition run ID")
    # Find an existing adopted programme even if only coordinator source changed.
    # Its own execution method retains the scientific source compatibility check.
    matches = []
    for path in sorted(manager.root.glob("*/programme.json")):
        retained = manager._load(path.parent.name)
        if _selection_matches(retained["selection"], proposed["selection"]):
            if {row["key"]: row["run_id"] for row in retained["runs"]} != expected:
                raise ValueError("An existing conservation programme changed its original native bindings")
            matches.append(retained)
    if matches:
        retained = sorted(matches, key=lambda row: (row.get("created_at", ""), row["id"]))[0]
        result = manager.status(retained["id"])
    else:
        result = manager.create(proposed["selection"])
    result["interaction_plan_id"] = plan["id"]
    # Creating an adopted programme never clears a previously completed study.
    prior = (plan.get("state") or {}).get("result_id")
    if prior:
        attached = attach(workspace, result["id"], prior)
        result = {**manager.status(result["id"]), "interaction_plan_id": plan["id"],
                  "interaction_attachment": attached["interaction_link"],
                  "files": attached["files"]}
    return result


def _matching_baseline(manager, record, plan):
    baseline = next(row for row in record["runs"]
                    if row["key"] == record["selection"]["baseline_run"])
    expected = plan["snapshot"]["baseline_selection"]
    if (baseline["run_id"] != plan["selection"]["baseline_run_id"]
            or baseline["native_selection"] != expected
            or record["selection"]["grid_id"] != expected["grid_id"]):
        raise ValueError("Attach an interaction result with this programme's exact retained baseline run")
    return baseline


def _verified_result(workspace, result_id, *, verified_members=None):
    engine = _engine()
    result = engine.get_result(workspace, identifier(result_id), verify=False)
    plan = _plan(workspace, result["plan_id"])
    identity = result["selection"]
    if (identity.get("plan_id") != plan["id"]
            or identity.get("baseline_run_id") != plan["selection"]["baseline_run_id"]
            or identity.get("grid_id") != plan["snapshot"]["baseline_selection"]["grid_id"]
            or [{key: value for key, value in row.items() if key != "native_versions"}
                for row in result.get("runs", [])] != identity.get("runs")):
        raise ValueError("Interaction result changed its retained study or native run references")
    cases = _cases(workspace, plan, identity["runs"], completed=True)
    by_key = {row["key"]: row for row in identity["runs"]}
    for case in cases:
        current = workspace.inspect_run(case["run_id"])
        expected_artifacts = by_key[case["key"]]["artifacts"]
        for name, descriptor in expected_artifacts.items():
            if current.get("artifacts", {}).get(name) != descriptor:
                raise ValueError("An attached native export changed from its analyzed output")
            _verify(workspace, {**descriptor,
                "path": "runs/" + case["run_id"] + "/" + descriptor["path"]}, verified_members)
    directory = Path(workspace.root) / engine.RESULT_KIND / result["id"]
    files = [_descriptor(workspace, directory / "result.json",
                         label="Complete native interaction result", media_type="application/json")]
    for name, descriptor in result.get("artifacts", {}).items():
        item = {**deepcopy(descriptor), "path": engine.RESULT_KIND + "/" + result["id"] + "/" + descriptor["path"],
                "label": "Interaction " + name.replace("_", " ")}
        _verify(workspace, item, verified_members)
        files.append(item)
    return result, plan, cases, files


def _load_link(manager, programme_id, link_id, *, verify=True, verified_members=None):
    link_id = identifier(link_id)
    path = _directory(manager, programme_id) / (link_id + ".json")
    value = read_json(path)
    identity = {key: item for key, item in value.items() if key not in ("id", "attached_at")}
    if (value.get("schema") != LINK_SCHEMA or value.get("id") != link_id
            or digest(identity) != link_id or value.get("programme_id") != programme_id
            or value.get("workspace_id") != manager.workspace.project["id"]):
        raise ValueError("Retained programme interaction link identity changed")
    if verify:
        _verify(manager.workspace, value["result_file"], verified_members)
        for item in value["files"]:
            _verify(manager.workspace, item, verified_members)
    return value


def attach(workspace, programme_id, result_id):
    """Attach exact completed outputs; retain historical links and refresh the original report."""
    manager = ComputeProgrammes(workspace)
    programme_id = identifier(programme_id)
    record = manager._load(programme_id)
    result, plan, cases, files = _verified_result(workspace, result_id)
    baseline = _matching_baseline(manager, record, plan)
    by_run = {}
    for row in record["runs"]:
        by_run.setdefault(row["run_id"], []).append(row["key"])
    context = {key: deepcopy(result[key]) for key in RESULT_FIELDS if key in result}
    context.update(
        plan_id=plan["id"], result_id=result["id"], baseline_run_id=baseline["run_id"],
        models=_models(plan["snapshot"]["baseline_selection"].get("models")),
        programme_run_matches=[{"coalition_key": row["key"], "run_id": row["run_id"],
                               "programme_run_keys": by_run.get(row["run_id"], [])} for row in cases],
        files=files)
    identity = {
        "schema": LINK_SCHEMA, "workspace_id": workspace.project["id"],
        "programme_id": programme_id, "plan_id": plan["id"], "result_id": result["id"],
        "baseline_run_id": baseline["run_id"], "result_file": files[0], "files": files,
        "context": context,
    }
    link_id = digest(identity)
    directory = _directory(manager, programme_id)
    with held(manager._directory(programme_id) / ".programme.lock", blocking=False):
        target = directory / (link_id + ".json")
        if target.exists():
            link = _load_link(manager, programme_id, link_id)
        else:
            link = {**identity, "id": link_id, "attached_at": now()}
            atomic_json(target, link, immutable=True)
        index = _index(manager, programme_id)
        index["links"][plan["id"]] = link_id
        atomic_json(directory / "active.json", index)
        report = manager.report(programme_id, _locked=True)
    return {
        "schema": "upstate.programme-interaction-adoption/v1", "programme_id": programme_id,
        "interaction_plan_id": plan["id"], "result_id": result["id"],
        "interaction_link": {"id": link_id, "plan_id": plan["id"], "result_id": result["id"],
                             "attached_at": link["attached_at"]},
        "report": report, "files": report.get("files", []),
    }


def sync_completed(workspace, programme):
    """Analyze original completed cases and attach them; never launch a native calculation."""
    manager = ComputeProgrammes(workspace)
    programme_id = identifier(programme.get("programme_id", programme.get("id")))
    record = manager._load(programme_id)
    reference = record["selection"].get("source_reference", "")
    if not isinstance(reference, str) or not reference.startswith(PREFIX):
        return None
    plan = _plan(workspace, identifier(reference[len(PREFIX):]))
    cases = _cases(workspace, plan, completed=True)
    expected = {row["key"]: row["run_id"] for row in cases}
    if (not _selection_matches(record["selection"], _selection(plan, cases))
            or {row["key"]: row["run_id"] for row in record["runs"]} != expected):
        raise ValueError("Programme does not retain the complete original coalition selection")
    # Native programme/dispatcher locks have already released. The interaction
    # analysis owns its original plan lock and verifies all actual output bytes.
    state = _engine().analyze_plan(workspace, plan["id"])
    attached = attach(workspace, programme_id, state["result_id"])
    return {
        **attached, "plan_id": plan["id"], "state": "complete",
        "completed_cases": state["completed_cases"],
        "native_execution": "original completed runs only",
    }


def report_context(workspace, programme_id):
    """Lightweight immutable summaries; original file tickets verify actual downloads."""
    manager = ComputeProgrammes(workspace)
    record = manager._load(programme_id)
    index = _index(manager, programme_id)
    studies = []
    for plan_id, link_id in sorted(index["links"].items()):
        link = _load_link(manager, programme_id, link_id, verify=False)
        if link["plan_id"] != plan_id:
            raise ValueError("Active programme attachment points to a different conservation study")
        baseline = next(row for row in record["runs"]
                        if row["key"] == record["selection"]["baseline_run"])
        if baseline["run_id"] != link["baseline_run_id"]:
            raise ValueError("Programme attachment changed its retained baseline binding")
        studies.append({**deepcopy(link["context"]), "link_id": link_id,
                        "attached_at": link["attached_at"]})
    return {
        "schema": CONTEXT_SCHEMA, "programme_id": programme_id, "studies": studies,
        "interpretation": {
            "support": "Attribution uses one finite reporting support shared by every selected coalition and every selected pollutant.",
            "direction": "Positive benefit means baseline annual export minus coalition annual export.",
            "comparison": "Programme native pairwise changes retain their own common-cell supports and alternative-minus-baseline direction.",
            "nonadditivity": "Combined benefit minus the sum of standalone action benefits on the interaction study's common support.",
            "allocation": "Shapley values allocate the retained native coalition game; they do not replace direct combined native outcomes.",
            "sampling": "Permutation standard errors describe allocation sampling, not physical model uncertainty.",
        },
    }


def _csv_cell(value):
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + value
    return value


def _markdown(value):
    return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def _number(value):
    return "" if value is None else format(value, ".10g")


def write_report_files(workspace, directory, context):
    """Export programme-level comparison, allocation and pair tables with exact study IDs."""
    directory = Path(directory)
    studies = context.get("studies", [])
    if not studies:
        return [], []
    fields = {
        "summaries": ("scope_id", "zone_id", "metric", "units", "support_status",
            "common_valid_cells", "common_area_ha", "baseline_annual_export", "combined_annual_export",
            "combined_benefit", "sum_standalone_benefit", "combined_nonadditivity",
            "sum_pair_nonadditivity", "higher_order_remainder", "sum_allocated_benefit",
            "allocation_efficiency_residual", "allocation_method"),
        "action_attribution": ("scope_id", "zone_id", "metric", "units", "support_status",
            "common_valid_cells", "common_area_ha", "action_id", "action_title",
            "standalone_benefit", "shapley_benefit", "allocation_method", "permutation_samples",
            "permutation_sampling_standard_error"),
        "pair_interactions": ("scope_id", "zone_id", "metric", "units", "support_status",
            "common_valid_cells", "common_area_ha", "action_a", "action_b", "pair_benefit",
            "sum_standalone_benefit", "pair_nonadditivity"),
    }
    files, lines = [], ["", "## Conservation interaction studies", ""]
    for name, columns in fields.items():
        path = directory / ("interaction-" + name.replace("_", "-") + ".csv")
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=("plan_id", "result_id", "study_title") + columns,
                                extrasaction="ignore")
        writer.writeheader()
        for study in studies:
            for row in study.get(name, []):
                values = {**row, "plan_id": study["plan_id"], "result_id": study["result_id"],
                          "study_title": study["title"]}
                writer.writerow({key: _csv_cell(value) for key, value in values.items()})
        atomic_bytes(path, stream.getvalue().encode("utf-8"), immutable=True)
        files.append(_descriptor(workspace, path, label="Programme interaction " + name.replace("_", " ")))
    context_path = directory / "interaction-studies.json"
    atomic_json(context_path, context, immutable=True)
    files.append(_descriptor(workspace, context_path, label="Programme interaction study references"))
    lines.append("These rows use each study's shared all-coalition, all-pollutant finite support. Positive benefit is baseline minus coalition annual export.")
    for study in studies:
        lines.extend(["", "### " + _markdown(study["title"]), "",
                      "Plan: " + study["plan_id"] + "  Result: " + study["result_id"], "",
                      "| Scope | Pollutant | Baseline export | Combined export | Combined benefit | Sum standalone benefits | Nonadditivity | Allocated benefit | Allocation residual | Units | Shared ha |",
                      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |"])
        for row in study["summaries"]:
            values = (row["scope_id"], row["metric"], _number(row["baseline_annual_export"]),
                      _number(row["combined_annual_export"]), _number(row["combined_benefit"]),
                      _number(row["sum_standalone_benefit"]), _number(row["combined_nonadditivity"]),
                      _number(row["sum_allocated_benefit"]), _number(row["allocation_efficiency_residual"]),
                      row["units"], _number(row["common_area_ha"]))
            lines.append("| " + " | ".join(_markdown(value) for value in values) + " |")
        lines.extend(["", "| Scope | Pollutant | Action | Standalone benefit | Allocated benefit | Allocation sampling SE | Units |",
                      "| --- | --- | --- | ---: | ---: | ---: | --- |"])
        for row in study["action_attribution"]:
            values = (row["scope_id"], row["metric"], row["action_title"],
                      _number(row["standalone_benefit"]), _number(row["shapley_benefit"]),
                      _number(row["permutation_sampling_standard_error"]), row["units"])
            lines.append("| " + " | ".join(_markdown(value) for value in values) + " |")
        lines.extend(["", "| Scope | Pollutant | Action pair | Pair benefit | Pair nonadditivity | Units |",
                      "| --- | --- | --- | ---: | ---: | --- |"])
        for row in study["pair_interactions"]:
            values = (row["scope_id"], row["metric"], row["action_a"] + " + " + row["action_b"],
                      _number(row["pair_benefit"]), _number(row["pair_nonadditivity"]), row["units"])
            lines.append("| " + " | ".join(_markdown(value) for value in values) + " |")
        files.extend(deepcopy(study["files"]))
    seen = {}
    for item in files:
        prior = seen.setdefault(item["path"], item)
        if prior["sha256"] != item["sha256"] or prior["bytes"] != item["bytes"]:
            raise ValueError("Programme interaction files disagree on retained bytes")
    return list(seen.values()), lines


def receiving_context(workspace, programme_id, selected_run_ids):
    """Retain linked study outputs in the original GIS receiving handoff."""
    context = report_context(workspace, programme_id)
    selected = set(selected_run_ids)
    studies = []
    for study in context["studies"]:
        row = deepcopy(study)
        row["delivery_run_matches"] = [
            {**match, "included_in_delivery": match["run_id"] in selected}
            for match in row["programme_run_matches"]]
        studies.append(row)
    return {**context, "studies": studies,
            "delivery_interpretation": (
                "Interaction results retain their complete coalition cases and common support. "
                "The GIS release's selected baseline and future maps are identified separately.")}


def validate_workspace(workspace, *, verified_members=None):
    """Reopen every historical link using original workspace IDs after portable restore."""
    manager = ComputeProgrammes(workspace)
    checked_results = {}
    count = 0
    for folder in sorted(manager.root.glob("*/" + LINK_DIRECTORY)):
        programme_id = identifier(folder.parent.name)
        record = manager._load(programme_id)
        index = _index(manager, programme_id)
        known = {}
        for path in sorted(folder.glob("*.json")):
            if path.name == "active.json":
                continue
            link = _load_link(manager, programme_id, path.stem, verified_members=verified_members)
            if link["result_id"] not in checked_results:
                checked_results[link["result_id"]] = _verified_result(
                    workspace, link["result_id"], verified_members=verified_members)
            result, plan, cases, files = checked_results[link["result_id"]]
            _matching_baseline(manager, record, plan)
            if (link["plan_id"] != plan["id"] or link["files"] != files
                    or any(link["context"].get(key) != result.get(key)
                           for key in RESULT_FIELDS if key in result)):
                raise ValueError("Transferred programme attachment changed its scientific result context")
            known[link["id"]] = link
            count += 1
        for plan_id, link_id in index["links"].items():
            if link_id not in known or known[link_id]["plan_id"] != plan_id:
                raise ValueError("Transferred programme index refers to a missing original study link")
    return {"schema": "upstate.programme-interaction-receiving/v1",
            "workspace_id": workspace.project["id"], "links": count,
            "results": len(checked_results)}
