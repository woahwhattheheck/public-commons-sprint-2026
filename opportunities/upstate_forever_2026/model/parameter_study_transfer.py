"""Editable original Parameter studies behind selected scientific-report editions.

The report's frozen source remains unchanged. Same-project transfers additionally
carry its original study specification, current checkpoint, prepared native cases
and source/rasters. Different-project report sources retain their captured inputs
without inventing an editable producer in the recipient Workspace.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier, read_json, relative_file
from .model_selection import selected

BASIS = "saved_parameter_study"
SOURCE_ID = "saved-parameter-study"
DIRECTORY = "parameter-report-sources"
REPORT_SCHEMA = "upstate.observed-report/v1"
STUDY_SCHEMA = "upstate.parameter-experiment/v1"
OPERATION_SCHEMA = "upstate.parameter-report-source/v1"
CONTEXT = "parameter_study"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A Parameter source needs canonical original member paths")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("A Parameter source member must remain inside its original directory")
    return value


def _same(first, second):
    return all(first.get(name) == second.get(name) for name in ("bytes", "sha256"))


def _body(closure, item):
    closure.add_file(item["object"], item)
    return closure.read(item["object"])


def _immutable(value, kind, key):
    raw = {name: item for name, item in value.items() if name != "id"}
    if (value.get("id") != key or raw.get("schema") != "upstate." + kind + "/v1"
            or digest(raw) != key):
        raise ValueError("The original Parameter " + kind + " changed its retained identity")
    return raw


def _cases(state):
    cases = state.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("The original Parameter design has no prepared cases")
    indexed = {}
    for case in cases:
        key = case.get("id")
        if not isinstance(key, str) or not key or key in indexed:
            raise ValueError("The original Parameter design repeats or omits a case identity")
        for name in ("profile_id", "run_id"):
            identifier(case.get(name))
        indexed[key] = case
    baseline = indexed.get("baseline")
    if (baseline is None or baseline["run_id"] != state["selection"].get("baseline_run_id")
            or baseline["profile_id"] != state["baseline_selection"].get("profile_id")
            or digest(state["baseline_selection"]) != baseline["run_id"]):
        raise ValueError("The Parameter reference differs from its original saved baseline")
    return indexed


def _captured(closure, entry):
    recipe = _body(closure, entry["body"])
    basis = recipe.get("basis")
    metadata = entry["metadata"]
    if (entry.get("kind") != "document" or entry.get("id") != SOURCE_ID
            or metadata.get("report_schema") != REPORT_SCHEMA
            or recipe.get("schema") != REPORT_SCHEMA or not isinstance(basis, dict)):
        raise ValueError("The Parameter source differs from its declared producer")
    selection = basis.get("selection")
    if not isinstance(selection, dict):
        raise ValueError("The Parameter source lost its original selected result")
    key = identifier(selection.get("experiment_id"))
    result_sha = identifier(selection.get("expected_artifact_sha256"))
    project = selection.get("workspace_id")
    if (type(selection.get("edition")) is not int or selection["edition"] not in (1, 2)
            or not isinstance(project, str) or not project
            or metadata.get("experiment_id") != key or recipe.get("edition") != result_sha
            or entry.get("uri") != "urn:upstate:parameter-study:" + key + ":" + result_sha):
        raise ValueError("The Parameter source changed its original project/study/result binding")
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("The Parameter source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ValueError("The Parameter source has no original input inventory")
    seen = set()
    for item in inputs:
        name = _relative(item["path"])
        if name in seen or name not in members or not _same(item, members[name]):
            raise ValueError("The Parameter source lost an exact original input: " + name)
        seen.add(name)

    def original(name):
        if name not in seen:
            raise ValueError("The Parameter source lacks its original " + name)
        return _body(closure, members[name])

    if original("selection.json") != basis:
        raise ValueError("The Parameter report recipe and selected result differ")
    checkpoint = original("original-study/checkpoint.json")
    if (checkpoint.get("schema") != STUDY_SCHEMA or checkpoint.get("id") != key
            or checkpoint.get("workspace_id") != project):
        raise ValueError("The Parameter source checkpoint belongs to another study")
    cases = _cases(checkpoint)
    chosen = selection.get("case_ids")
    if (not isinstance(chosen, list) or not chosen or len(set(chosen)) != len(chosen)
            or any(case not in cases for case in chosen)
            or [case.get("id") for case in basis.get("cases", [])] != chosen):
        raise ValueError("The Parameter source changed its selected case order")
    for case in basis["cases"]:
        if any(case.get(name) != cases[case["id"]].get(name)
               for name in ("label", "run_id", "profile_id", "overrides", "axis_values")):
            raise ValueError("The selected Parameter case differs from its original design")
    artifact = checkpoint.get("artifacts", {}).get("results")
    if (not isinstance(artifact, dict) or artifact.get("sha256") != result_sha
            or not _same(artifact, members.get("original-study/" + _relative(artifact["path"]), {}))):
        raise ValueError("The Parameter source lost its exact original results")
    exported = checkpoint.get("artifacts", {}).get("export_manifest")
    if not isinstance(exported, dict):
        raise ValueError("The Parameter source lost its native export manifest")
    manifest_name = "original-study/" + _relative(exported["path"])
    manifest = original(manifest_name)
    if (not _same(exported, members[manifest_name])
            or manifest.get("schema") != "upstate.parameter-export-members/v1"
            or manifest.get("study_id") != key or manifest.get("workspace_id") != project
            or manifest.get("selection_sha256") != digest(checkpoint["selection"])):
        raise ValueError("The Parameter export manifest changed its original study selection")
    names = set()
    for item in manifest.get("files", []):
        name = "original-study/" + _relative(item["path"])
        if name in names or name not in seen or not _same(item, members.get(name, {})):
            raise ValueError("The Parameter source lost a complete original export: " + name)
        names.add(name)
    inventory = original("native-input-inventory.json")
    grid = original("grid.json")
    if (inventory.get("workspace_id") != project or inventory.get("experiment_id") != key
            or inventory.get("baseline_selection") != checkpoint.get("baseline_selection")
            or inventory.get("grid") != grid
            or grid.get("id") != checkpoint["baseline_selection"].get("grid_id")
            or digest({"spec": grid.get("spec"), "grid": grid.get("grid")}) != grid.get("id")):
        raise ValueError("The Parameter source changed its original reference grid or inputs")
    for profile in {cases[case]["profile_id"] for case in chosen}:
        _immutable(original("profiles/" + profile + ".json"), "profiles", profile)
    reference_profile = checkpoint["baseline_selection"]["profile_id"]
    # Older source editions could omit an unplotted reference profile. Its exact
    # live immutable profile is still included below; the captured source is not rewritten.
    if "profiles/" + reference_profile + ".json" in seen:
        _immutable(original("profiles/" + reference_profile + ".json"), "profiles", reference_profile)
    if basis.get("reference") is not None:
        expected = {"run_id": checkpoint["selection"]["baseline_run_id"],
                    "profile_id": reference_profile,
                    "scenario_id": checkpoint["baseline_selection"]["scenario_id"],
                    "grid_id": grid["id"], "run_selection": checkpoint["baseline_selection"]}
        if basis["reference"] != expected:
            raise ValueError("The Parameter source changed its fixed comparison reference")
    return recipe, basis, checkpoint, cases, inventory, members, seen


def _operation(closure, operation_id, study_id, project):
    prefix = DIRECTORY + "/" + identifier(operation_id)
    operation = closure.read(prefix + "/operation.json")
    identity = operation.get("identity")
    if (operation.get("schema") != OPERATION_SCHEMA or operation.get("id") != operation_id
            or operation.get("workspace_id") != project or operation.get("experiment_id") != study_id
            or not isinstance(identity, dict) or digest(identity) != operation_id
            or operation.get("selection") != identity.get("selection")
            or operation["selection"].get("experiment_id") != study_id
            or operation["selection"].get("workspace_id") != project):
        raise ValueError("The editable Parameter source changed its original operation")
    source = operation.get("source")
    if not isinstance(source, dict) or source.get("source_id") != SOURCE_ID:
        raise ValueError("The Parameter source operation has no retained source edition")
    collection_id = identifier(source.get("source_collection_id"))
    collection = closure.read("sources/" + collection_id + ".json")
    if collection.get("schema") != "upstate.sources/v1" or digest(collection) != collection_id:
        raise ValueError("The Parameter operation source collection changed")
    entries = [entry for entry in collection.get("entries", []) if entry.get("id") == SOURCE_ID]
    if len(entries) != 1:
        raise ValueError("The Parameter operation lost its original source document")
    closure.need("sources", collection_id, "Original editable Parameter scientific source")
    closure.tree(prefix)
    for item in operation.get("files", {}).values():
        closure._descriptors(item)
    return operation, entries[0]


def _local(closure, collection_id, entry, recipe, basis, captured, cases, inventory, members, seen):
    key, project = captured["id"], captured["workspace_id"]
    prefix = "experiments/" + key
    spec = closure.read("experiment-specs/" + key + ".json")
    if spec.get("schema") != "upstate.experiment-specs/v1" or digest(spec) != key:
        raise ValueError("The original Parameter specification changed")
    state = closure.read(prefix + "/experiment.json")
    expected = {name: value for name, value in spec.items() if name != "schema"}
    for checkpoint in (captured, state):
        if (checkpoint.get("schema") != STUDY_SCHEMA or checkpoint.get("id") != key
                or checkpoint.get("workspace_id") != project
                or {name: value for name, value in checkpoint.get("selection", {}).items()
                    if name != "schema"} != expected
                or checkpoint.get("baseline_selection") != captured["baseline_selection"]):
            raise ValueError("The editable Parameter study changed its original specification")
    current_cases = _cases(state)
    if list(current_cases) != list(cases):
        raise ValueError("The editable Parameter study changed its original case order")
    required = []
    for case_id, original in cases.items():
        current = current_cases[case_id]
        if any(current.get(name) != original.get(name) for name in
               ("label", "profile_id", "run_id", "overrides", "axis_values", "run_selection")):
            raise ValueError("The editable Parameter study changed a prepared case selection")
        run_id = current["run_id"]
        run = closure.read("runs/" + run_id + "/run.json")
        selection = run.get("selection")
        if (run.get("id") != run_id or not isinstance(selection, dict) or digest(selection) != run_id
                or selection.get("profile_id") != current["profile_id"]
                or any(selection.get(name) != state["baseline_selection"].get(name)
                       for name in ("grid_id", "scenario_id"))
                or selected(selection) != selected(state["baseline_selection"])
                or ("run_selection" in current and selection != current["run_selection"])
                or ("run_selection" not in current and selection.get("invest_version") !=
                    state["baseline_selection"].get("invest_version"))
                or (case_id == "baseline" and selection != state["baseline_selection"])):
            raise ValueError("The original prepared Parameter run changed its inputs")
        closure.need("runs", run_id, "Original Parameter case, including unfinished cases")
        required.append({"kind": "runs", "id": run_id})
    closure._native_selection(state["baseline_selection"], "Original Parameter comparison reference")
    closure._source_refs(state["selection"], "Original Parameter reporting-area sources")
    for binding in inventory.get("source_bindings", []):
        original_collection = identifier(binding.get("source_collection_id"))
        value = closure.read("sources/" + original_collection + ".json")
        found = [item for item in value.get("entries", []) if item.get("id") == binding.get("source_id")]
        if (value.get("schema") != "upstate.sources/v1" or digest(value) != original_collection
                or len(found) != 1 or found[0] != binding.get("entry")):
            raise ValueError("The editable Parameter source lost an original input edition")
        closure.need("sources", original_collection, "Original Parameter input source edition")
    if closure.read("grids/" + inventory["grid"]["id"] + "/grid.json") != inventory["grid"]:
        raise ValueError("The editable Parameter grid differs from its report source")
    for name in seen:
        if name.startswith("profiles/") and name.endswith(".json"):
            profile = identifier(name[len("profiles/"):-len(".json")])
            original = _body(closure, members[name])
            if closure.read("profiles/" + profile + ".json") != _immutable(original, "profiles", profile):
                raise ValueError("The editable Parameter profile differs from the selected report")
            closure.need("profiles", profile, "Original Parameter report coefficient profile")
    # Keep an interrupted export exactly as captured. The ordinary portable
    # Parameter verifier marks missing/changed declared exports for refresh.
    closure.tree(prefix)
    for comparison in {captured.get("comparison_id"), state.get("comparison_id"), basis.get("comparison_id")} - {None}:
        comparison = identifier(comparison)
        record = closure.read("comparisons/" + comparison + "/comparison.json")
        cohort = [record.get("baseline_run_id"), *[row.get("run_id") for row in record.get("alternatives", [])]]
        if (record.get("baseline_run_id") != state["selection"]["baseline_run_id"]
                or any(run_id not in {case["run_id"] for case in cases.values()} for run_id in cohort)):
            raise ValueError("The Parameter comparison belongs to another original run cohort")
        closure.need("comparisons", comparison, "Original Parameter native comparison")
        if comparison in {captured.get("comparison_id"), basis.get("comparison_id")}:
            required.append({"kind": "comparisons", "id": comparison})
    # Find the exact retained producer through its original source binding, not a
    # computed new producer hash. A later code edition can share identical inputs.
    matched = []
    directory = closure.root / DIRECTORY
    for path in sorted(directory.glob("*/operation.json")):
        operation_id = identifier(path.parent.name)
        operation = read_json(relative_file(closure.root,
            DIRECTORY + "/" + operation_id + "/operation.json"))
        if (operation.get("workspace_id") == project and operation.get("experiment_id") == key
                and operation.get("selection") == basis["selection"]
                and operation.get("source") == {"source_collection_id": collection_id, "source_id": SOURCE_ID}):
            operation, imported = _operation(closure, operation_id, key, project)
            if not _same(imported["body"], entry["body"]):
                raise ValueError("The editable Parameter operation changed its selected report source")
            source_prefix = DIRECTORY + "/" + operation_id + "/source/"
            if closure.read(source_prefix + "scientific-report.json") != recipe:
                raise ValueError("The editable Parameter recipe differs from its imported source")
            for name in seen:
                closure.add_file(source_prefix + name, members[name])
            matched.append(operation_id)
    if not matched:
        raise ValueError("The selected Parameter report lost its original editable source operation")
    pointer_path = prefix + "/latest-scientific-source.json"
    if (closure.root / pointer_path).exists() or (closure.root / pointer_path).is_symlink():
        pointer = closure.read(pointer_path)
        if pointer.get("experiment_id") != key:
            raise ValueError("The Parameter source pointer belongs to another study")
        _operation(closure, pointer["source_operation_id"], key, project)
    token = ("parameter-studies", key)
    node = closure.nodes.setdefault(token, {"kind": token[0], "id": key,
        "title": state["selection"]["title"], "state": state.get("state"), "reasons": []})
    reason = "Original editable Parameter design for selected scientific report"
    if reason not in node["reasons"]:
        node["reasons"].append(reason)
    required.append({"kind": token[0], "id": key})
    return sorted({(row["kind"], row["id"]) for row in required})


def include_source(closure, collection_id, entry):
    metadata = entry.get("metadata") or {}
    if metadata.get("source_basis") != BASIS:
        return False
    recipe, basis, captured, cases, inventory, members, seen = _captured(closure, entry)
    local = captured["workspace_id"] == closure.workspace.project["id"]
    required = _local(closure, collection_id, entry, recipe, basis, captured, cases,
                      inventory, members, seen) if local else []
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": captured["workspace_id"], "report_context_kind": CONTEXT,
        "experiment_id": captured["id"], "selection": deepcopy(basis["selection"]),
        "baseline_run_id": captured["selection"]["baseline_run_id"],
        "baseline_selection": deepcopy(captured["baseline_selection"]),
        "relationship": "same_project" if local else "external_project",
        "required_records": [{"kind": kind, "id": key} for kind, key in required],
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != binding:
        raise ValueError("The selected Parameter report lineage changed during capture")
    closure.report_source_records[token] = binding
    return True


def lock_paths(closure):
    paths = set()
    for record in closure.report_source_records.values():
        if record.get("report_context_kind") == CONTEXT and record.get("relationship") == "same_project":
            paths.add("experiments/" + identifier(record["experiment_id"]) + "/.experiment.lock")
    for prefix in closure.trees:
        pieces = prefix.split("/")
        if len(pieces) == 2 and pieces[0] == DIRECTORY:
            paths.add(prefix + "/.prepare.lock")
    return sorted(paths)
