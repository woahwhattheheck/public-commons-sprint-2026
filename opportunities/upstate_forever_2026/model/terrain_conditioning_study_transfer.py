"""Original editable terrain cases, native responses and report-source lineage.

TokenJunkieLabs. This resolver reads retained records/CAS only. It never imports
old source-view manifests, conditions DEMs, prepares grids or executes models.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import digest, identifier, read_json

CASES = "terrain-conditioning-cases"
BINDINGS = "terrain-conditioning-bindings"
RESPONSES = "terrain-conditioning-responses"
REPORTS = "terrain-conditioning-report-sources"
ROOT_KINDS = (CASES, BINDINGS, RESPONSES, REPORTS)
IMMUTABLE_KINDS = ROOT_KINDS
LABELS = {CASES: "Terrain conditioning cases", BINDINGS: "Terrain native bindings",
          RESPONSES: "Terrain native responses", REPORTS: "Terrain scientific report sources"}
FOLDERS = {CASES: "terrain-conditioning-output",
           RESPONSES: "terrain-conditioning-response-output",
           REPORTS: "terrain-conditioning-report-source-output"}
URI = "urn:upstate:terrain-conditioning-report-source:"


def _immutable(kind, key, value):
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != identifier(key):
        raise ValueError("The original terrain record changed: " + kind + "/" + key)
    return value


def _record(closure, kind, key):
    key = identifier(key)
    return _immutable(kind, key, closure.read(kind + "/" + key + ".json"))


def _optional(closure, path):
    target = closure.root / path
    return closure.read(path) if target.exists() or target.is_symlink() else None


def _tree(closure, kind, key):
    prefix = FOLDERS[kind] + "/" + key
    if (closure.root / prefix).exists() or (closure.root / prefix).is_symlink():
        closure.tree(prefix)
    return prefix


def _files(closure, files, prefix=None):
    if not isinstance(files, list):
        raise ValueError("Terrain outputs need their complete original file descriptors")
    seen = set()
    for row in files:
        if not isinstance(row, dict) or not {"path", "bytes", "sha256"}.issubset(row):
            raise ValueError("A terrain output lost its original byte descriptor")
        path = row["path"]
        if path in seen or (prefix is not None and not path.startswith(prefix + "/")):
            raise ValueError("Terrain output paths repeat or leave their original directory")
        seen.add(path)
        closure.add_file(path, row)


def _source(closure, collection_id, source_id, sha=None):
    collection_id = identifier(collection_id)
    collection = _record(closure, "sources", collection_id)
    entries = [row for row in collection["entries"] if row["id"] == source_id]
    if len(entries) != 1:
        raise ValueError("Terrain source choice is absent from its original collection")
    entry = entries[0]
    if sha is not None and entry["body"]["sha256"] != identifier(sha):
        raise ValueError("Terrain source body differs from the retained case")
    closure.need("sources", collection_id, "Complete original terrain source collection")
    closure.add_file(entry["body"]["object"], entry["body"])
    for row in entry.get("companions", []):
        closure.add_file(row["object"], row)
    return entry


def _saved_for_case(closure, kind, case_id, predicate=None):
    # Filter before capture: unrelated records are not silently added to a Study.
    for path in sorted((closure.root / kind).glob("*.json")):
        value = read_json(path)
        if value.get("case_id") != case_id or (predicate is not None and not predicate(value)):
            continue
        key = identifier(path.stem)
        yield key, _record(closure, kind, key)


def _case(closure, key, value):
    closure.need("sources", value["context_collection_id"], "Original terrain context")
    dem = value["dem"]
    _source(closure, dem["collection_id"], dem["source_id"], dem["sha256"])
    if value.get("hydrography"):
        hydro = value["hydrography"]
        _source(closure, hydro["collection_id"], hydro["source_id"], hydro["sha256"])
    prefix = _tree(closure, CASES, key)
    expected = [("raw", None), ("filled", 0.0)] + [
        ("burn-" + str(i + 1) + "-filled", depth)
        for i, depth in enumerate(value["burn_depths_m"])]
    variants = []
    for name, burn in expected:
        row = _optional(closure, prefix + "/" + name + "/variant.json")
        if row is None:
            continue
        if (row.get("case_id") != key or row.get("version") != value["version"]
                or row.get("name") != name or row.get("burn_depth_m") != burn):
            raise ValueError("A retained terrain variant differs from its original case")
        _files(closure, row["files"], prefix + "/" + name)
        source = row["source_entry"]
        if (source.get("conditioning_case_id") != key
                or source.get("conditioning_variant") != name
                or source.get("original_dem") != value["dem"]
                or source.get("original_hydrography") != value.get("hydrography")
                or source.get("grid") != value["grid"]):
            raise ValueError("Terrain variant source binding changed")
        closure.add_file(source["path"], source)
        variants.append(row)
    progress = _optional(closure, prefix + "/progress.json")
    if progress is not None and (progress.get("case_id") != key
                                 or progress.get("version") != value["version"]):
        raise ValueError("Terrain progress belongs to another case")
    result = _optional(closure, prefix + "/result.json")
    if result is not None:
        if (result.get("case_id") != key or result.get("version") != value["version"]
                or result.get("state") != "complete"
                or result.get("case") != {**value, "id": key}
                or result.get("variants") != variants or len(variants) != len(expected)):
            raise ValueError("The completed terrain case lost its exact variant roster")
        # This inventory intentionally excludes the old source-view paths carried
        # in the import manifest; those original bytes live in source CAS.
        _files(closure, result["files"])
        collection = _record(closure, "sources", result["source_collection_id"])
        closure.need("sources", result["source_collection_id"], "Conditioned DEMs and complete source companions")
        for row in variants:
            selected = _source(closure, result["source_collection_id"], row["source_entry"]["id"],
                               row["source_entry"]["sha256"])
            if selected.get("conditioning_case_id") != key or selected.get("conditioning_variant") != row["name"]:
                raise ValueError("The imported terrain variant lost its original case identity")
        if result.get("source_ids") != [row["source_entry"]["id"] for row in variants]:
            raise ValueError("The complete terrain source roster changed")
        original_ids = {row["id"] for row in collection["entries"]}
        if not set(result.get("context_source_ids", [])).issubset(original_ids):
            raise ValueError("Terrain context sources are absent from their retained collection")
    node = closure.nodes[(CASES, key)]
    node.update(title=value["title"], state="complete" if result else (progress or {}).get("state", "prepared"),
                case_id=key)
    if closure.selection["include_related_results"]:
        for kind in (BINDINGS, RESPONSES, REPORTS):
            for related_id, _ in _saved_for_case(closure, kind, key):
                closure.need(kind, related_id, "Saved continuation of the selected terrain case")
    return result


def _grid_binding(closure, key, value, case, result):
    variant = next((row for row in result["variants"] if row["name"] == value["variant"]), None)
    if variant is None or value["source_collection_id"] != result["source_collection_id"]:
        raise ValueError("Terrain binding lost its exact conditioned source")
    grid_id = identifier(value["grid_id"])
    current = closure.read("grids/" + grid_id + "/grid.json")
    if value.get("run_id"):
        run_id = identifier(value["run_id"])
        original_id = identifier(value["original_run_id"])
        run = closure.read("runs/" + run_id + "/run.json")
        original = closure.read("runs/" + original_id + "/run.json")
        if run.get("id") != run_id or original.get("id") != original_id:
            raise ValueError("Terrain native binding run identity changed")
        expected_selection = deepcopy(original["selection"])
        expected_selection["grid_id"] = grid_id
        if run["selection"] != expected_selection:
            raise ValueError("A terrain binding changed inputs beyond its original DEM grid")
        original_grid_id = original["selection"]["grid_id"]
        closure.need("runs", original_id, "Original terrain baseline run")
        closure.need("runs", run_id, "Original prepared or completed terrain native run")
    else:
        original_grid_id = identifier(value["original_grid_id"])
    original = closure.read("grids/" + original_grid_id + "/grid.json")
    if original["spec"]["source_collection_id"] != case["context_collection_id"]:
        raise ValueError("Terrain binding original grid belongs to another context")
    expected_spec = deepcopy(original["spec"])
    expected_spec["source_collection_id"] = result["source_collection_id"]
    expected_spec["input_sources"]["DEM"] = variant["source_entry"]["id"]
    expected_spec["title"] = result["title"] + " / " + value["variant"]
    if current.get("id") != grid_id or current["spec"] != expected_spec:
        raise ValueError("Terrain conditioned grid differs from the original native binding")
    closure.need("grids", original_grid_id, "Original terrain model grid")
    closure.need("grids", grid_id, "Conditioned terrain model grid")
    closure.need("sources", result["source_collection_id"], "Complete conditioned source edition")


def _binding(closure, key, value):
    case_id = identifier(value["case_id"])
    case = _record(closure, CASES, case_id)
    result = closure.read(FOLDERS[CASES] + "/" + case_id + "/result.json")
    if result.get("case_id") != case_id or result.get("state") != "complete":
        raise ValueError("A native terrain binding requires its original completed terrain case")
    closure.need(CASES, case_id, "Original editable terrain case")
    _grid_binding(closure, key, value, case, result)
    closure.nodes[(BINDINGS, key)].update(
        title=case["title"] + " / " + value["variant"], state="prepared",
        case_id=case_id, run_id=value.get("run_id"), grid_id=value["grid_id"])


def _response(closure, key, value):
    case_id = identifier(value["case_id"])
    closure.need(CASES, case_id, "Original terrain case behind native response")
    baseline = identifier(value["baseline_run_id"])
    closure.need("runs", baseline, "Original terrain response baseline")
    case_result = closure.read(FOLDERS[CASES] + "/" + case_id + "/result.json")
    expected_variants = [{"variant": row["name"], "burn_depth_m": row["burn_depth_m"]}
                         for row in case_result["variants"] if row["statistics"]["changed_cells"] != 0]
    actual_variants = [{name: row[name] for name in ("variant", "burn_depth_m")}
                       for row in value["alternatives"]]
    if not expected_variants or actual_variants != expected_variants:
        raise ValueError("Terrain response changed its complete ordered changed-variant roster")
    names = set()
    for row in value["alternatives"]:
        if row["variant"] in names:
            raise ValueError("Terrain response repeats a native variant")
        names.add(row["variant"])
        run_id = identifier(row["run_id"])
        closure.need("runs", run_id, "Original terrain response alternative")
        matching = list(_saved_for_case(closure, BINDINGS, case_id,
            lambda binding: binding.get("original_run_id") == baseline
            and binding.get("run_id") == run_id and binding.get("variant") == row["variant"]))
        if not matching:
            raise ValueError("Terrain response lost its original native preparation binding")
        for binding_id, _ in matching:
            closure.need(BINDINGS, binding_id, "Exact terrain response run binding")
    if value.get("direction") != "alternative minus baseline":
        raise ValueError("Terrain response changed its original signed direction")
    prefix = _tree(closure, RESPONSES, key)
    result = _optional(closure, prefix + "/result.json")
    if result is not None:
        if (result.get("id") != key or result.get("state") != "complete"
                or result.get("schema") != "upstate.terrain-native-response/v1"
                or result.get("selection") != {**value, "id": key}):
            raise ValueError("Terrain native response differs from its frozen selection")
        _files(closure, result["files"], prefix)
        native = closure.read(prefix + "/native-response.json")
        if native != {name: row for name, row in result.items() if name != "files"}:
            raise ValueError("Terrain response machine report differs from its complete result")
        # Copied original run files remain historical source evidence. The live
        # retained runs may subsequently acquire additional original stages.
        _files(closure, result["originals"], prefix)
    closure.nodes[(RESPONSES, key)].update(
        title=(result or {}).get("title", "Terrain response " + key[:12]),
        state="complete" if result else "prepared", case_id=case_id, response_id=key,
        baseline_run_id=baseline)
    if closure.selection["include_related_results"]:
        for report_id, _ in _saved_for_case(closure, REPORTS, case_id,
                                           lambda report: report.get("response_id") == key):
            closure.need(REPORTS, report_id, "Saved scientific source for terrain response")


def _report(closure, key, value):
    if value.get("project_id") != closure.workspace.project["id"]:
        raise ValueError("The terrain report source belongs to another workspace")
    response = _record(closure, RESPONSES, value["response_id"])
    if (response["case_id"] != value["case_id"]
            or value["binding"]["case_id"] != value["case_id"]
            or value["binding"]["response_id"] != value["response_id"]
            or value["binding"]["project_id"] != value["project_id"]):
        raise ValueError("Terrain report source crossed its original case or native response")
    closure.need(CASES, value["case_id"], "Original terrain report case")
    closure.need(RESPONSES, value["response_id"], "Original terrain report native response")
    prefix = _tree(closure, REPORTS, key)
    result = _optional(closure, prefix + "/result.json")
    if result is not None:
        from . import terrain_conditioning_report_source as reports
        checked = reports.inspect(closure.workspace, key)
        if (checked.get("id") != key or checked.get("state") != "complete"
                or checked.get("selection") != {**value, "id": key}):
            raise ValueError("Terrain scientific report source changed its immutable selection")
        _files(closure, checked["files"], prefix)
        closure.need("sources", checked["source"]["source_collection_id"],
                     "Complete terrain scientific report and companions")
    closure.nodes[(REPORTS, key)].update(
        title=value["title"], state="complete" if result else "prepared",
        case_id=value["case_id"], response_id=value["response_id"])


def visit(closure, kind, key, value):
    if kind not in ROOT_KINDS:
        return False
    _immutable(kind, key, value)
    if kind == CASES:
        _case(closure, key, value)
    elif kind == BINDINGS:
        _binding(closure, key, value)
    elif kind == RESPONSES:
        _response(closure, key, value)
    else:
        _report(closure, key, value)
    return True


def lock_paths(closure):
    for kind, key in sorted(closure.nodes):
        if kind == CASES:
            prefix = FOLDERS[CASES] + "/" + key
            yield prefix + "/.case.lock"
            yield prefix + "/engine/.compile.lock"
        elif kind == RESPONSES:
            yield FOLDERS[RESPONSES] + "/" + key + "/.response.lock"
        elif kind == REPORTS:
            yield FOLDERS[REPORTS] + "/" + key + "/.report.lock"


def catalogue(workspace, kind):
    if kind not in ROOT_KINDS:
        return []
    rows = []
    for path in sorted((Path(workspace.root) / kind).glob("*.json")):
        key = path.stem
        try:
            value = _immutable(kind, key, read_json(path))
            state = "prepared"
            title = value.get("title") or value.get("variant") or key[:12]
            result = None
            if kind in FOLDERS:
                target = Path(workspace.root) / FOLDERS[kind] / key / "result.json"
                if target.exists():
                    result = read_json(target)
                    state = result.get("state", state)
                    title = result.get("title", title)
                elif kind == CASES:
                    progress = target.with_name("progress.json")
                    if progress.exists():
                        state = read_json(progress).get("state", state)
            row = {"kind": kind, "id": key, "title": title, "state": state,
                   "updated_at": (result or {}).get("completed_at", ""),
                   "case_id": key if kind == CASES else value["case_id"]}
            if kind in (RESPONSES, REPORTS):
                row["response_id"] = key if kind == RESPONSES else value["response_id"]
            if value.get("run_id"):
                row["run_id"] = value["run_id"]
            rows.append(row)
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"kind": kind, "id": key, "title": key[:12],
                         "state": "unreadable", "updated_at": "",
                         "error": {"type": type(error).__name__, "message": str(error)}})
    return rows


def include_source(closure, collection_id, entry):
    uri = entry.get("uri", "")
    if not isinstance(uri, str) or not uri.startswith(URI):
        return False
    key = identifier(uri[len(URI):])
    metadata = entry.get("metadata") or {}
    if (entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT"
            or metadata.get("report_schema") != "upstate.observed-report/v1"
            or metadata.get("terrain_conditioning_report_source_id") != key
            or entry.get("id") != "terrain-conditioning-report-source-" + key):
        raise ValueError("Terrain scientific source lost its original typed identity")
    members = {}
    for body in [entry["body"], *entry.get("companions", [])]:
        name = body.get("view_path", body["filename"])
        if name in members:
            raise ValueError("Terrain scientific source repeats an original member")
        members[name] = body
        closure.add_file(body["object"], body)
    recipe = closure.read(entry["body"]["object"])
    expected = {row["path"]: (row["bytes"], row["sha256"]) for row in recipe["inputs"]}
    actual = {name: (body["bytes"], body["sha256"]) for name, body in members.items()
              if body is not entry["body"]}
    if (recipe.get("schema") != "upstate.observed-report/v1"
            or expected != actual or len(expected) != len(recipe["inputs"])):
        raise ValueError("Terrain report source lost its complete original report inventory")
    selection_body = members.get("selection.json")
    if selection_body is None:
        raise ValueError("Terrain scientific source lost its immutable original selection")
    selected = closure.read(selection_body["object"])
    raw = {name: item for name, item in selected.items() if name != "id"}
    _immutable(REPORTS, key, raw)
    if (selected.get("id") != key or selected.get("project_id") != metadata.get("project_id")
            or selected.get("case_id") != metadata.get("terrain_conditioning_case_id")
            or selected.get("response_id") != metadata.get("terrain_conditioning_response_id")
            or recipe.get("project_id") != selected["project_id"]):
        raise ValueError("Terrain scientific source metadata differs from its retained selection")
    binding_body = members.get("input-binding.json")
    if binding_body is None or closure.read(binding_body["object"]) != selected["binding"]:
        raise ValueError("Terrain scientific source lost its original input binding")
    lineage = {"source_collection_id": collection_id, "source_id": entry["id"],
               "report_context_kind": "terrain_conditioning",
               "project_id": metadata["project_id"], "report_source_id": key,
               "case_id": identifier(metadata["terrain_conditioning_case_id"]),
               "response_id": identifier(metadata["terrain_conditioning_response_id"]),
               "recipe_sha256": entry["body"]["sha256"],
               "relationship": "same_project" if metadata["project_id"] == closure.workspace.project["id"] else "external"}
    if lineage["relationship"] == "same_project":
        value = _record(closure, REPORTS, key)
        if value != raw:
            raise ValueError("Terrain report source disagrees with its native case and response")
        from . import terrain_conditioning_report_source as reports
        checked = reports.inspect(closure.workspace, key)
        native = _source(closure, checked["source"]["source_collection_id"], checked["source"]["source_id"])
        original_members = {body.get("view_path", body["filename"]): (body["bytes"], body["sha256"])
                            for body in [native["body"], *native.get("companions", [])]}
        selected_members = {name: (body["bytes"], body["sha256"]) for name, body in members.items()}
        if original_members != selected_members:
            raise ValueError("Equivalent terrain report import differs from its native saved source")
        closure.need(REPORTS, key, "Editable terrain case and native response behind selected report")
    closure.report_source_records[(collection_id, entry["id"])] = lineage
    return True
