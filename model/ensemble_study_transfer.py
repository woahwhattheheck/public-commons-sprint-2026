"""Original native-ensemble lineage for selected scientific-report studies.

Read only retained CAS and Workspace members. The original report remains frozen;
the editable native design and complete input/run trees can continue after receive.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

BASIS = "saved_native_ensemble"
SOURCE_ID = "saved-native-ensemble-study"
DIRECTORY = "ensemble-study-sources"
REPORT_SCHEMA = "upstate.observed-report/v1"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A native study source needs an original relative member")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("A native study member must remain in its original directory")
    return value


def _body(closure, item):
    closure.add_file(item["object"], item)
    return closure.read(item["object"])


def _same(first, second):
    return all(first.get(key) == second.get(key) for key in ("bytes", "sha256"))


def _immutable(value, kind, key):
    if value.get("id") != key:
        raise ValueError("A captured native study record changed its identity: " + kind)
    raw = {name: item for name, item in value.items() if name != "id"}
    if raw.get("schema") != "upstate." + kind + "/v1" or digest(raw) != key:
        raise ValueError("A captured native study record changed its original content: " + kind)
    return raw


class _CapturedRuns:
    """Read original run snapshots without resolving IDs in a receiving project."""
    def __init__(self, runs):
        self.runs = runs

    def inspect_run(self, key):
        key = identifier(key)
        if key not in self.runs:
            raise ValueError("The captured comparison names an absent original native run")
        return deepcopy(self.runs[key])


def _captured_comparisons(comparisons, runs):
    # Reuse the original native comparison policy with the producing snapshots.
    # The current Workspace can legitimately have advanced another native stage.
    from .native_versions import validate_run_comparison
    original = _CapturedRuns(runs)
    for key, comparison in comparisons.items():
        validate_run_comparison(original, comparison, expected_id=key)


def _local_comparison(closure, key, captured, runs):
    """Retain a report-bound comparison without reinterpreting its old runtime."""
    prefix = "comparisons/" + identifier(key) + "/"
    if closure.read(prefix + "comparison.json") != captured:
        raise ValueError("The editable native comparison differs from its saved report")
    ids = [captured["baseline_run_id"]] + [
        row["run_id"] for row in captured["alternatives"]]
    outputs = set().union(*(set(row["artifacts"]) for row in captured["alternatives"]))
    for run_id in ids:
        current = closure.read("runs/" + identifier(run_id) + "/run.json")
        original = runs[run_id]
        if current.get("selection") != original["selection"]:
            raise ValueError("The original comparison run changed its scientific selection")
        for name in outputs:
            artifact = original.get("artifacts", {}).get(name)
            if artifact is None or current.get("artifacts", {}).get(name) != artifact:
                raise ValueError("The original comparison output changed after its saved report")
            closure._descriptors(artifact, "runs/" + run_id + "/")
        closure.need("runs", run_id, "Original report-bound comparison native inputs")
    closure.tree(prefix.rstrip("/"))
    closure._descriptors(captured["alternatives"], prefix)
    # This explicit source lineage has already passed the SAME policy against
    # its captured original runs. Keep normal comparison traversal unchanged for
    # independent current comparisons or already queued consumer dependencies.
    node = closure.nodes.setdefault(("comparisons", key), {
        "kind": "comparisons", "id": key, "title": key[:12],
        "state": captured.get("state"), "reasons": []})
    reason = "Original native comparison validated against captured report run states"
    if reason not in node["reasons"]:
        node["reasons"].append(reason)


def _captured(closure, entry):
    metadata = entry["metadata"]
    recipe = _body(closure, entry["body"])
    basis = recipe.get("basis")
    if (entry.get("kind") != "document" or entry.get("id") != SOURCE_ID
            or metadata.get("report_schema") != REPORT_SCHEMA
            or recipe.get("schema") != REPORT_SCHEMA or not isinstance(basis, dict)):
        raise ValueError("The native study source differs from its declared producer")
    for name in ("ensemble_id", "report_id", "summary_signature", "run_signature",
                 "producer_sha256", "figure_helper_sha256"):
        identifier(basis.get(name))
    project = basis.get("workspace_id")
    operation_id = digest(basis)
    if (basis.get("version") != 1 or not isinstance(project, str) or not project
            or metadata.get("workspace_id") != project
            or metadata.get("source_operation_id") != operation_id
            or metadata.get("ensemble_id") != basis["ensemble_id"]
            or metadata.get("report_id") != basis["report_id"]
            or recipe.get("edition") != "native-study-" + basis["report_id"]
            or entry.get("uri") != "urn:upstate:native-ensemble:" + basis["ensemble_id"] + ":" + basis["report_id"]):
        raise ValueError("The native study source lost its original project/report binding")
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("The native study source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ValueError("The native study source lacks its original input descriptors")
    selected = set()
    for item in inputs:
        name = _relative(item["path"])
        if name in selected or name not in members or not _same(item, members[name]):
            raise ValueError("The native study source lost its original input: " + name)
        selected.add(name)

    def original(name):
        if name not in selected:
            raise ValueError("The native study report lacks its original " + name)
        return _body(closure, members[name])

    plan = original("original/ensemble.json")
    _immutable(plan, "ensembles", basis["ensemble_id"])
    content = original("numeric/report.json")
    report, release = content.get("report", {}), original("numeric/release.json")
    if (content.get("schema") != "upstate.ensemble-report-release/v1"
            or content.get("ensemble_id") != plan["id"] or digest(content) != basis["report_id"]
            or report.get("schema") != "upstate.ensemble-report/v1" or report.get("id") != plan["id"]
            or report.get("grid_id") != plan["grid_id"] or report.get("members") != plan["members"]
            or report.get("run_signature") != basis["run_signature"]
            or digest({key: value for key, value in report.items()
                       if key not in {"generated_at", "report_state", "current_run_signature"}})
               != basis["summary_signature"]
            or release.get("id") != basis["report_id"] or release.get("ensemble_id") != plan["id"]
            or release.get("run_signature") != basis["run_signature"]
            or release.get("summary_signature") != basis["summary_signature"]):
        raise ValueError("The native study source changed its original numerical release")
    for name, descriptor in release.get("files", {}).items():
        if name.endswith(".zip"):
            continue
        member = members.get("numeric/" + _relative(name))
        if member is None or "numeric/" + name not in selected or not _same(descriptor, member):
            raise ValueError("The native study source lost an original numeric export")
    runs = original("original/native-runs.json")
    expected_runs = {item["run_id"] for member in plan["members"] for item in member["runs"]}
    if not isinstance(runs, dict) or set(runs) != expected_runs:
        raise ValueError("The native study source changed its selected native run cohort")
    for key, value in runs.items():
        identifier(key)
        if value.get("id") != key or digest(value.get("selection")) != key:
            raise ValueError("The native study source changed an original run selection")
    signature = digest({key: {"state": value["state"], "selection": value["selection"],
                              "runtime": value.get("runtime"), "artifacts": value.get("artifacts", {})}
                        for key, value in runs.items()})
    if signature != basis["run_signature"]:
        raise ValueError("The native study source changed its captured run states")
    grid = original("original/grid.json")
    if (grid.get("id") != plan["grid_id"]
            or digest({"spec": grid.get("spec"), "grid": grid.get("grid")}) != grid["id"]):
        raise ValueError("The native study source changed its prepared grid")
    for member in plan["members"]:
        for key in {member["profile_id"], member.get("parent_profile_id")} - {None}:
            _immutable(original("original/profiles/" + key + ".json"), "profiles", key)
        for choice in member["runs"]:
            key = choice["scenario_id"]
            _immutable(original("original/scenarios/" + key + ".json"), "scenarios", key)
            run = runs[choice["run_id"]]
            if any(run["selection"].get(field) != expected for field, expected in (
                    ("grid_id", plan["grid_id"]), ("profile_id", member["profile_id"]),
                    ("scenario_id", key))):
                raise ValueError("The native study member changed its original run inputs")
    inventory = original("native-input-inventory.json")
    if (inventory.get("schema") != "upstate.ensemble-study-inputs/v1"
            or inventory.get("ensemble_id") != plan["id"] or inventory.get("grid_id") != grid["id"]
            or inventory.get("grid") != grid["grid"]
            or inventory.get("aligned_inputs") != grid["inputs"]
            or inventory.get("aligned_files") != grid["files"]
            or inventory.get("native_output_artifacts") !=
               {key: run.get("artifacts", {}) for key, run in runs.items()}):
        raise ValueError("The native study source changed its original input inventory")
    collections = {}
    for binding in inventory.get("source_bindings", []):
        collection = identifier(binding["source_collection_id"])
        value = original("original/source-collections/" + collection + ".json")
        _immutable(value, "sources", collection)
        matches = [row for row in value["entries"] if row["id"] == binding["source_id"]]
        if len(matches) != 1 or matches[0] != binding["entry"]:
            raise ValueError("The native study input differs from its original source entry")
        collections[collection] = value
    comparisons = {}
    for field in ("paired_rows", "parameter_rows"):
        for row in content.get(field, []):
            key = identifier(row["comparison_id"])
            if key not in comparisons:
                comparisons[key] = original("original/comparisons/" + key + ".json")
            comparison = comparisons[key]
            if (comparison.get("id") != key or comparison.get("baseline_run_id") != row["baseline_run_id"]
                    or row["alternative_run_id"] not in {x["run_id"] for x in comparison.get("alternatives", [])}
                    or row["baseline_run_id"] not in runs or row["alternative_run_id"] not in runs):
                raise ValueError("The native study report changed its original paired comparison")
    _captured_comparisons(comparisons, runs)
    return basis, operation_id, recipe, members, selected, plan, runs, grid, collections, comparisons, content


def _local_operation(closure, operation_id, ensemble_id, project_id):
    prefix = DIRECTORY + "/" + identifier(operation_id) + "/"
    operation = closure.read(prefix + "operation.json")
    basis = operation.get("selection")
    if (operation.get("schema") != "upstate.ensemble-study-source/v1"
            or operation.get("id") != operation_id or not isinstance(basis, dict)
            or digest(basis) != operation_id or operation.get("ensemble_id") != ensemble_id
            or operation.get("workspace_id") != project_id
            or basis.get("workspace_id") != project_id or basis.get("ensemble_id") != ensemble_id):
        raise ValueError("The editable scientific source has another native study identity")
    source = operation.get("source")
    if not isinstance(source, dict) or source.get("source_id") != SOURCE_ID:
        raise ValueError("The editable native study lost its imported scientific source")
    collection_id = identifier(source["source_collection_id"])
    collection = closure.read("sources/" + collection_id + ".json")
    entries = [row for row in collection["entries"] if row["id"] == SOURCE_ID]
    if len(entries) != 1:
        raise ValueError("The editable scientific source lost its original source entry")
    closure.need("sources", collection_id, "Original native-study scientific source")
    closure._descriptors(operation.get("files", {}))
    closure.tree(prefix.rstrip("/"))
    return operation, entries[0]


def _local_release(closure, key, ensemble_id, expected=None):
    prefix = "ensemble_reports/" + identifier(key) + "/"
    release = closure.read(prefix + "release.json")
    if release.get("id") != key or release.get("ensemble_id") != ensemble_id:
        raise ValueError("The editable native report belongs to another study")
    if expected is not None and release != expected:
        raise ValueError("The editable native report changed its captured release")
    closure._descriptors(release.get("files", {}), prefix)
    closure.tree(prefix.rstrip("/"))


def include_source(closure, collection_id, entry):
    """Carry a selected native study report and its original editable design."""
    if (entry.get("metadata") or {}).get("source_basis") != BASIS:
        return False
    identifier(collection_id)
    (basis, operation_id, recipe, members, selected, plan, runs, grid,
     collections, comparisons, content) = _captured(closure, entry)
    local = basis["workspace_id"] == closure.workspace.project["id"]
    required = []
    if local:
        key, project = plan["id"], basis["workspace_id"]
        original_plan = closure.read("ensembles/" + key + ".json")
        if original_plan != _immutable(plan, "ensembles", key):
            raise ValueError("The original editable native design differs from its report")
        operation, imported = _local_operation(closure, operation_id, key, project)
        if operation["selection"] != basis or not _same(imported["body"], entry["body"]):
            raise ValueError("The editable native study source changed its captured recipe")
        prefix = DIRECTORY + "/" + operation_id + "/source/"
        closure.add_file(prefix + "scientific-report.json", entry["body"])
        if closure.read(prefix + "scientific-report.json") != recipe:
            raise ValueError("The editable native study recipe differs from its imported source")
        for name in selected:
            closure.add_file(prefix + name, members[name])
        release = _body(closure, members["numeric/release.json"])
        _local_release(closure, basis["report_id"], key, release)
        closure.need("grids", grid["id"], "Original native study grid")
        if closure.read("grids/" + grid["id"] + "/grid.json") != grid:
            raise ValueError("The editable native study grid differs from its report")
        for collection, captured in collections.items():
            if closure.read("sources/" + collection + ".json") != _immutable(captured, "sources", collection):
                raise ValueError("The editable native study lost an original input source")
            closure.need("sources", collection, "Original native study input edition")
        for member in plan["members"]:
            for profile in {member["profile_id"], member.get("parent_profile_id")} - {None}:
                closure.need("profiles", profile, "Original native study coefficient profile")
            for selection in member["runs"]:
                closure.need("scenarios", selection["scenario_id"], "Original native study mapped alternative")
        for run_id, captured in runs.items():
            current = closure.read("runs/" + run_id + "/run.json")
            if current.get("selection") != captured["selection"]:
                raise ValueError("The editable native run changed its scientific selection")
            # Later unrelated stages may finish. Bind the exact original outputs
            # used by this report, then retain the current complete native tree.
            for field in ("paired_rows", "parameter_rows"):
                for row in content.get(field, []):
                    for role in ("baseline", "alternative"):
                        if row[role + "_run_id"] == run_id:
                            artifact = row[role + "_artifact"]
                            if current.get("artifacts", {}).get(row["pollutant"]) != artifact:
                                raise ValueError("The original paired native output changed after this report")
                            closure._descriptors(artifact, "runs/" + run_id + "/")
            closure.need("runs", run_id, "Original native study member")
            required.append({"kind": "runs", "id": run_id})
        for comparison_id, captured in comparisons.items():
            _local_comparison(closure, comparison_id, captured, runs)
        results = "ensemble_results/" + key
        closure.tree(results)
        state = closure.read(results + "/state.json")
        if state.get("ensemble_id") != key:
            raise ValueError("The editable native study progress belongs to another design")
        for name, field in (("latest-report.json", "report_id"),
                            ("latest-scientific-study.json", "source_operation_id")):
            path = results + "/" + name
            if (closure.root / path).exists() or (closure.root / path).is_symlink():
                pointer = closure.read(path)
                if pointer.get("ensemble_id") != key:
                    raise ValueError("The native study report pointer changed its original design")
                if field == "report_id":
                    _local_release(closure, pointer[field], key)
                else:
                    latest, unused = _local_operation(closure, pointer[field], key, project)
                    _local_release(closure, latest["selection"]["report_id"], key)
        token = ("ensembles", key)
        node = closure.nodes.setdefault(token, {"kind": "ensembles", "id": key,
            "title": plan["title"], "state": state.get("state"), "reasons": []})
        reason = "Original editable native design for selected scientific report"
        if reason not in node["reasons"]:
            node["reasons"].append(reason)
        required.append({"kind": "ensembles", "id": key})
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": basis["workspace_id"],
        "report_context_kind": "native_ensemble_study",
        "ensemble_id": basis["ensemble_id"], "report_id": basis["report_id"],
        "source_operation_id": operation_id, "selection": deepcopy(basis),
        "relationship": "same_project" if local else "external_project",
        "required_records": sorted(required, key=lambda row: (row["kind"], row["id"])),
    }
    previous = closure.report_source_records.get((collection_id, entry["id"]))
    if previous is not None and previous != binding:
        raise ValueError("The selected native-study report lineage changed during capture")
    closure.report_source_records[(collection_id, entry["id"])] = binding
    return True


def lock_paths(closure):
    """Use original native-study locks during selected-study capture."""
    paths = set()
    for record in closure.report_source_records.values():
        if record.get("report_context_kind") != "native_ensemble_study" or record.get("relationship") != "same_project":
            continue
        key = identifier(record["ensemble_id"])
        for name in (".execute.lock", ".report.lock", ".state.lock"):
            paths.add("ensemble_results/" + key + "/" + name)
        paths.add(DIRECTORY + "/" + identifier(record["source_operation_id"]) + "/.prepare.lock")
    # A design may now point to a newer scientific source than the selected
    # saved report. Its retained operation also participates in this capture.
    for prefix in closure.trees:
        pieces = prefix.split("/")
        if len(pieces) == 2 and pieces[0] == DIRECTORY:
            paths.add(DIRECTORY + "/" + identifier(pieces[1]) + "/.prepare.lock")
    return sorted(paths)
