"""Retain original native-process report lineage in selected editable studies.

Called only for sources explicitly selected by a saved scientific-report edition.
Reads original CAS objects and recorded Workspace members; never creates source
views, launches a model, renders a report, or changes an original source edition.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

REPORT_SCHEMA = "upstate.observed-report/v1"
PROCESS_SCHEMA = "upstate.native-process-report/v1"
SELECTION_SCHEMA = "upstate.native-process-selection/v1"
ROOT = "native-process-reports"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Native process source needs an original relative member path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("Native process source member must remain in its original directory")
    return value


def _same_file(first, second):
    return all(first.get(field) == second.get(field) for field in ("bytes", "sha256"))


def _body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _register(closure, binding):
    key = (binding["source_collection_id"], binding["source_id"])
    previous = closure.report_source_records.get(key)
    if previous is not None and previous != binding:
        raise ValueError("Native process report lineage changed during study selection")
    closure.report_source_records[key] = binding


def _captured_source(closure, entry):
    metadata = entry["metadata"]
    key = identifier(metadata.get("native_process_report_id"))
    recipe = _body(closure, entry["body"])
    if (entry.get("kind") != "document" or entry.get("id") != "native-process-" + key
            or entry.get("uri") != "urn:upstate:native-process-report:" + key
            or metadata.get("report_schema") != REPORT_SCHEMA
            or metadata.get("scientific_scope") != "modeled_process_quantities"
            or recipe.get("schema") != REPORT_SCHEMA):
        raise ValueError("Native process source differs from its original producer")
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("Native process source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    requested = recipe.get("inputs")
    if not isinstance(requested, list) or not requested:
        raise ValueError("Native process recipe must retain its original inputs")
    selected = set()
    for item in requested:
        name = _relative(item["path"])
        if name in selected or name not in members or not _same_file(item, members[name]):
            raise ValueError("Native process recipe lost an exact original input: " + name)
        selected.add(name)

    def original(name):
        if name not in selected:
            raise ValueError("Native process recipe lacks its original " + name)
        return _body(closure, members[name])

    identity = original("identity.json")
    selection = identity.get("selection")
    project_id = identity.get("project_id")
    if (identity.get("schema") != PROCESS_SCHEMA or digest(identity) != key
            or not isinstance(project_id, str) or not project_id
            or not isinstance(selection, dict) or selection.get("schema") != SELECTION_SCHEMA
            or not isinstance(identity.get("edition"), str) or not identity["edition"]
            or recipe.get("edition") != identity["edition"]
            or recipe.get("title") != selection.get("title")):
        raise ValueError("Native process source changed its immutable scientific identity")
    ids, models, runs = selection.get("run_ids"), selection.get("models"), identity.get("runs")
    if (not isinstance(ids, list) or not ids or len(set(ids)) != len(ids)
            or not isinstance(models, list) or not models or len(set(models)) != len(models)
            or any(model not in ("ndr", "sdr") for model in models)
            or not isinstance(runs, list) or [row.get("id") for row in runs] != ids):
        raise ValueError("Native process identity changed its ordered run/model selection")
    for run in runs:
        identifier(run["id"])
        if (not isinstance(run.get("selection"), dict) or digest(run["selection"]) != run["id"]
                or set(run.get("stages", {})) != set(models)):
            raise ValueError("Native process capture lost an original producing run or stage")
    grid = original("original/grid/grid.json")
    if (grid != identity.get("grid") or grid.get("id") != digest(
            {"spec": grid.get("spec"), "grid": grid.get("grid")})
            or any(run["selection"].get("grid_id") != grid["id"] for run in runs)):
        raise ValueError("Native process capture changed its original prepared grid")
    summary = original("processes.json")
    if (summary.get("schema") != PROCESS_SCHEMA or summary.get("id") != key
            or summary.get("selection") != selection or summary.get("versions") != identity.get("versions")
            or summary.get("grid") != grid.get("grid")
            or summary.get("scope") != "original_native_model_domain_watersheds"
            or metadata.get("native_versions") != identity.get("versions", {}).get("versions")):
        raise ValueError("Native process summary differs from its original identity")
    packets = summary.get("packets")
    if not isinstance(packets, list):
        raise ValueError("Native process summary must retain its original model packets")
    by_case = {}
    for packet in packets:
        case = (packet.get("run_id"), packet.get("model"))
        if case in by_case:
            raise ValueError("Native process summary repeats a producing case")
        by_case[case] = packet
    if set(by_case) != {(run_id, model) for run_id in ids for model in models}:
        raise ValueError("Native process source lost an original producing case")
    for run in runs:
        for model in models:
            stage = run["stages"][model]
            prefix = "original/" + run["id"] + "/" + model + "/"
            if original(prefix + "stage.json") != stage or not stage.get("completed_at"):
                raise ValueError("Native process capture lost its exact completed stage")
            packet = original("derived/" + run["id"] + "-" + model + ".json")
            if (packet != by_case[(run["id"], model)]
                    or packet.get("selection") != run["selection"]
                    or packet.get("source_identity") != digest(stage)
                    or packet.get("version") != stage.get("version")):
                raise ValueError("Native process packet differs from its producing stage")
            for kind, field in (("profiles", "profile_id"), ("scenarios", "scenario_id")):
                value = original(prefix + ("profile.json" if kind == "profiles" else "scenario.json"))
                saved = {name: item for name, item in value.items() if name != "id"}
                if (value.get("schema") != "upstate." + kind + "/v1"
                        or digest(saved) != run["selection"].get(field)
                        or packet.get("profile" if kind == "profiles" else "scenario") != value):
                    raise ValueError("Native process capture lost its original " + kind)
                if kind == "profiles":
                    table = members.get(prefix + "biophysical.csv")
                    if (table is None or prefix + "biophysical.csv" not in selected
                            or table["sha256"] != value.get("table_summary", {}).get("sha256")):
                        raise ValueError("Native process source lost its original parameter table")
            for item in stage.get("files", {}).values():
                name = prefix + "registry/" + _relative(item["path"])
                if name not in selected or not _same_file(item, members[name]):
                    raise ValueError("Native process source lost an original stage output: " + name)
            for item in stage.get("companions", []):
                name = prefix + "registry/" + _relative(item["path"])
                if name not in selected or not _same_file(item, members[name]):
                    raise ValueError("Native process source lost a stage companion: " + name)
            arguments = prefix + "arguments.json"
            if arguments not in selected or not _same_file(stage["arguments"], members[arguments]):
                raise ValueError("Native process source lost original native arguments")
            if packet.get("arguments") != original(arguments):
                raise ValueError("Native process packet changed its native arguments")
    for name, descriptor in identity.get("implementation", {}).items():
        path = "implementation/" + _relative(name)
        if path not in selected or not _same_file(descriptor, members[path]):
            raise ValueError("Native process capture lost its original implementation: " + name)
    return key, identity, recipe, members, selected


def _local_run(closure, captured, models):
    key = captured["id"]
    run = closure.read("runs/" + key + "/run.json")
    if run.get("id") != key or run.get("selection") != captured["selection"]:
        raise ValueError("Native process source and editable native run have different identities")
    for model in models:
        before = captured["stages"][model]
        stage = run.get("stages", {}).get(model, {})
        for field in ("completed_at", "arguments", "input_signature", "reused_from"):
            if stage.get(field) != before.get(field):
                raise ValueError("The original " + model.upper() + " stage changed after this report")
        for name, descriptor in before["files"].items():
            if stage.get("files", {}).get(name) != descriptor:
                raise ValueError("The original native stage output differs from this report")
        companions = stage.get("companions", [])
        if any(item not in companions for item in before["companions"]):
            raise ValueError("The original native stage lost a report companion")
        basis = before["version"].get("basis")
        producing = stage.get("runtime")
        if basis != "completed_stage_runtime" and not producing:
            producing = run.get("runtime")
        retained = before.get("runtime") or {}
        if basis == "completed_stage_runtime":
            matches = producing == retained
        elif basis in ("observed_run_fallback", "observed_runtime"):
            # Native continuation promotes the prior observed runtime onto an
            # already completed stage before another model changes run.runtime.
            # Use that retained stage proof when available without rewriting the
            # report's original fallback basis or unrelated runtime fields.
            producing = producing or {}
            matches = (producing.get("version") == retained.get("version")
                       and producing.get("modules", {}).get(model)
                       == retained.get("modules", {}).get(model))
        else:
            matches = False
        if not matches:
            raise ValueError("The original producing execution differs from this process report")
        prefix = "runs/" + key + "/"
        closure._descriptors(before["files"], prefix)
        closure._descriptors(before["companions"], prefix)
        closure._descriptors(before["arguments"], prefix)
    # An unfinished parent is valid: the exact selected completed stages above
    # remain the authority. The original run visitor retains its current state.
    closure.need("runs", key, "Original producing run for saved native process report")


def _local_capture(closure, collection_id, entry, key, identity, recipe, members, selected):
    prefix = ROOT + "/" + key + "/"
    local_identity = closure.read(prefix + "identity.json")
    operation = closure.read(prefix + "operation.json")
    if (local_identity != identity or operation.get("schema") != PROCESS_SCHEMA
            or operation.get("id") != key or operation.get("selection") != identity["selection"]):
        raise ValueError("The editable native process capture differs from its original source")
    for name in selected:
        closure.add_file(prefix + name, members[name])
    if operation.get("recipe", {}).get("path") != "report.json":
        raise ValueError("The editable native process capture lacks its imported recipe")
    closure.add_file(prefix + "report.json", entry["body"])
    if closure.read(prefix + "report.json") != recipe or not _same_file(
            operation["recipe"], entry["body"]):
        raise ValueError("The editable native process recipe differs from its original source")
    source_choice = operation.get("source_choice")
    if (not isinstance(source_choice, dict) or source_choice.get("source_id") != entry["id"]):
        raise ValueError("The editable native process capture lacks its original source choice")
    source_id = identifier(source_choice.get("source_collection_id"))
    original_collection = closure.read("sources/" + source_id + ".json")
    original_entries = [item for item in original_collection.get("entries", [])
                        if item.get("id") == entry["id"]]
    if (len(original_entries) != 1 or not _same_file(original_entries[0]["body"], entry["body"])):
        raise ValueError("The native process capture changed its imported source edition")
    closure.need("sources", source_id, "Original imported native process report edition")
    manifest = operation.get("source_manifest")
    if not isinstance(manifest, dict) or manifest.get("path") != "sources.json":
        raise ValueError("The native process capture lacks its original source manifest")
    closure.add_file(prefix + "sources.json", manifest)
    for descriptor in operation.get("files") or []:
        path = _relative(descriptor["path"])
        if not path.startswith(prefix):
            raise ValueError("Native process report output belongs to another capture")
        closure.add_file(path, descriptor)
    for descriptor in operation.get("checkpoints", {}).values():
        closure.add_file(prefix + _relative(descriptor["path"]), descriptor)
    closure.tree(prefix.rstrip("/"))
    for run in identity["runs"]:
        _local_run(closure, run, identity["selection"]["models"])


def include_source(closure, collection_id, entry):
    """Follow this producer only for an explicitly ordered saved-report source."""
    metadata = entry.get("metadata") or {}
    if "native_process_report_id" not in metadata:
        return False
    identifier(collection_id)
    key, identity, recipe, members, selected = _captured_source(closure, entry)
    local = identity["project_id"] == closure.workspace.project["id"]
    if local:
        _local_capture(closure, collection_id, entry, key, identity, recipe, members, selected)
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": identity["project_id"],
        "report_context_kind": "native_process_report",
        "native_process_report_id": key, "producer_edition": identity["edition"],
        "selection": deepcopy(identity["selection"]),
        "producing_versions": deepcopy(identity["versions"]),
        "stage_identities": [
            {"run_id": run["id"], "model": model,
             "stage_sha256": digest(run["stages"][model]),
             "completed_at": run["stages"][model]["completed_at"]}
            for run in identity["runs"] for model in identity["selection"]["models"]
        ],
        "relationship": "same_project" if local else "external_project",
        "required_records": [{"kind": "runs", "id": key}
                             for key in identity["selection"]["run_ids"]] if local else [],
    }
    _register(closure, binding)
    return True


def lock_paths(closure):
    """Hold each original producer lock while staging its editable capture."""
    return sorted({
        ROOT + "/" + identifier(value["native_process_report_id"]) + "/.operation.lock"
        for value in closure.report_source_records.values()
        if value.get("report_context_kind") == "native_process_report"
        and value.get("relationship") == "same_project"
    })
