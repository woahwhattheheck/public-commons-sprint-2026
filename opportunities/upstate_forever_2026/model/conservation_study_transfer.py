"""Original editable Conservation studies, portfolios and report source history.

This extends the maintained selected-study closure. All reads use original JSON
records and CAS descriptors; no GIS calculation, source-view materialization,
candidate SQL migration, report rendering or native model execution is invoked.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath

from .common import digest, identifier, read_json
from . import observed_context

ROOT_KINDS = ("conservation", "conservation-plans", "conservation-exports",
              "conservation-report-sources")
DOCUMENTS = dict(zip(ROOT_KINDS, ("study.json", "plan.json", "export.json", "receipt.json")))
LOCKS = {"conservation": ".build.lock", "conservation-plans": ".plan.lock",
         "conservation-exports": ".export.lock", "conservation-report-sources": ".source.lock"}
LABELS = {"conservation": "Conservation studies", "conservation-plans": "Conservation portfolios",
          "conservation-exports": "Conservation decision packets",
          "conservation-report-sources": "Conservation report sources"}
REPORT_SCHEMA = "upstate.conservation-report-source/v1"
REPORT_EDITION = "conservation-saved-plan-report/1"


def _path(kind, key):
    return kind + "/" + identifier(key) + "/" + DOCUMENTS[kind]


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Keep the original Conservation member path.")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("Keep the original relative Conservation member path.")
    return value


def _same(left, right):
    return isinstance(left, dict) and isinstance(right, dict) and all(
        name in left and left[name] == right.get(name) for name in ("bytes", "sha256"))


def _files(closure, files, prefix=None):
    for item in files.values():
        name = _relative(item["path"])
        if prefix is not None and not name.startswith(prefix + "/"):
            raise ValueError("A Conservation output leaves its original record directory.")
        closure.add_file(name, item)


def _read_file(closure, item):
    closure.add_file(_relative(item["path"]), item)
    return closure.read(item["path"])


def _record(closure, kind, key):
    return closure.read(_path(kind, key))


def _identity(kind, key, value):
    if value.get("id") != key:
        raise ValueError("The retained Conservation record has another identity.")
    if kind == "conservation":
        schema = "upstate.conservation-study/v1"
    elif kind == "conservation-plans":
        schema = "upstate.conservation-plan/v1"
    elif kind == "conservation-report-sources":
        schema = REPORT_SCHEMA
    else:
        schema = value.get("schema")
        if schema not in ("upstate.conservation-export/v1",
                          "upstate.conservation-decision-export/v1"):
            raise ValueError("Choose an original Conservation decision packet.")
    if value.get("schema") != schema:
        raise ValueError("The retained Conservation record has another schema.")
    if kind != "conservation-exports" or schema == "upstate.conservation-decision-export/v1":
        if digest(value.get("selection")) != key:
            raise ValueError("The retained Conservation selection changed.")


def _source_entry(closure, choice, expected=None):
    collection_id = identifier(choice["source_collection_id"])
    value = closure.read("sources/" + collection_id + ".json")
    if value.get("schema") != "upstate.sources/v1" or digest(value) != collection_id:
        raise ValueError("The original Conservation source collection changed.")
    rows = [entry for entry in value.get("entries", []) if entry.get("id") == choice["source_id"]]
    if len(rows) != 1:
        raise ValueError("The Conservation source no longer identifies one original entry.")
    entry = rows[0]
    if expected is not None and entry != expected:
        raise ValueError("The Conservation report source differs from its original source edition.")
    closure.need("sources", collection_id, "Original Conservation source edition")
    for item in [entry["body"], *entry.get("companions", [])]:
        closure.add_file(item["object"], item)
    return entry


def _entry_identity(entry):
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("A Conservation source repeats an original companion.")
        members[name] = {field: item[field] for field in ("bytes", "sha256")}
    return {**{name: entry.get(name) for name in
               ("id", "kind", "title", "uri", "vintage", "role", "metadata")},
            "body": {field: entry["body"][field] for field in ("bytes", "sha256")},
            "companions": members}


def _study(closure, key, value):
    from .conservation_reporting import source_register
    selection = value["selection"]
    if selection.get("version") != 1 or value.get("mode") != selection["spec"].get("mode"):
        raise ValueError("The original Conservation study mode or selection differs.")
    closure.tree("conservation/" + key)
    _files(closure, value.get("files", {}), "conservation/" + key)
    for row in source_register(value):
        original = _source_entry(closure, row)
        if not _same(original["body"], row["body"]):
            raise ValueError("A Conservation planning source differs from its saved body.")
        if row.get("companions") and row["companions"] != original.get("companions"):
            raise ValueError("A Conservation planning source differs from its saved companions.")
    bound = selection["bindings"]
    for run_id, native in bound.get("runs", {}).items():
        if native.get("id") != run_id:
            raise ValueError("The Conservation study names another bound native run.")
        closure.need("runs", run_id, "Original Conservation producing-stage native run")
        current = closure.read("runs/" + identifier(run_id) + "/run.json")
        if current.get("selection") != native.get("selection"):
            raise ValueError("The Conservation study's original native run selection differs.")
        for output in native.get("outputs", {}).values():
            for name in ("rate", "stream", "arguments"):
                if isinstance(output.get(name), dict):
                    closure._descriptors(output[name], "runs/" + run_id + "/")
    grid = bound.get("grid")
    if grid:
        closure.need("grids", grid["id"], "Original Conservation model grid")
        closure._descriptors(grid["reporting_area"], "grids/" + identifier(grid["id"]) + "/")
    # These are explicit bound source choices, including published criterion inputs.
    closure._source_refs(bound, "Original Conservation bound criteria and geography")


def _plan(closure, key, value):
    study_id = identifier(value["study_id"])
    closure.need("conservation", study_id, "Original Conservation portfolio candidate study")
    study = _record(closure, "conservation", study_id)
    _identity("conservation", study_id, study)
    selection = value["selection"]
    if (selection.get("study_id") != study_id
            or selection.get("candidates_sha256") != study["files"]["candidates"]["sha256"]
            or selection.get("geometries_sha256") != study["files"]["geometries"]["sha256"]):
        raise ValueError("The portfolio differs from its original candidate or geometry inventory.")
    closure.tree("conservation-plans/" + key)
    _files(closure, value.get("files", {}), "conservation-plans/" + key)
    if value.get("state") == "complete":
        portfolio = _read_file(closure, value["files"]["portfolio"])
        if (portfolio.get("schema") != "upstate.conservation-portfolio/v1"
                or portfolio.get("id") != key or portfolio.get("study_id") != study_id
                or portfolio.get("selected_ids") != value.get("selected_ids")
                or portfolio.get("summary") != value.get("summary")):
            raise ValueError("The original portfolio artifact differs from its saved selection.")
    optimization = selection.get("optimization")
    if optimization:
        analysis_id = identifier(optimization["analysis_id"])
        prefix = "conservation/" + study_id + "/optimization/" + analysis_id
        state = closure.read(prefix + "/analysis-state.json")
        if (state.get("schema") != "upstate.conservation-optimization-reference/v1"
                or state.get("id") != analysis_id or state.get("study_id") != study_id
                or state.get("files") != optimization.get("files")):
            raise ValueError("The portfolio lost its original optimization analysis.")
        _files(closure, state["files"], prefix)
        analysis = _read_file(closure, state["files"]["analysis"])
        if analysis.get("id") != analysis_id or digest(
                {name: item for name, item in analysis.items() if name != "id"}) != analysis_id:
            raise ValueError("The portfolio optimization content identity changed.")
        closure.tree(prefix)
    catalog = selection.get("catalog_selection")
    if catalog:
        selection_id = identifier(catalog["selection_id"])
        prefix = "conservation/" + study_id + "/catalog-selections/" + selection_id
        saved = closure.read(prefix + "/selection.json")
        if (saved.get("schema") != "upstate.conservation-candidate-selection/v1"
                or saved.get("id") != selection_id or digest(saved.get("reference")) != selection_id
                or saved.get("study_id") != study_id or saved.get("index_id") != catalog.get("index_id")
                or saved.get("source_inventory") != study["files"]["candidates"]
                or saved.get("source_inventory") != catalog.get("source_inventory")
                or saved.get("reference") != catalog.get("reference")
                or saved["files"]["selected_ids"] != catalog.get("selected_ids_file")):
            raise ValueError("The portfolio lost its exact retained candidate selection.")
        _files(closure, saved["files"], prefix)
        selected = _read_file(closure, saved["files"]["selected_ids"])
        ids = selected.get("selected_ids")
        if (selected.get("schema") != "upstate.conservation-selected-ids/v1"
                or selected.get("reference") != saved["reference"]
                or not isinstance(ids, list) or any(not isinstance(item, str) for item in ids)
                or ids != sorted(set(ids)) or len(ids) != saved["count"]
                or catalog.get("original_count") != saved["count"]):
            raise ValueError("The original candidate selection file differs.")
        resolved = sorted((set(ids) | set(catalog.get("include_ids", [])))
                          - set(catalog.get("exclude_ids", [])))
        if (resolved != selection.get("selected_ids")
                or catalog.get("resolved_count") != len(resolved)):
            raise ValueError("The portfolio differs from its original retained candidate edits.")
        closure.tree(prefix)


def _export(closure, key, value):
    study_id = identifier(value["study_id"])
    closure.need("conservation", study_id, "Original Conservation decision-packet study")
    plan_id = value.get("plan_id")
    if plan_id:
        closure.need("conservation-plans", plan_id, "Original Conservation decision-packet portfolio")
    subject = _record(closure, "conservation-plans" if plan_id else "conservation", plan_id or study_id)
    prefix = "conservation-exports/" + key
    closure.tree(prefix)
    _files(closure, {"archive": value}, prefix)
    if value["schema"] == "upstate.conservation-export/v1":
        identity = {"version": 1, "study_id": study_id, "plan_id": plan_id,
                    "files": subject["files"], "presentation": value["presentation"]}
        execution_name = prefix + "/native-execution.json"
        if (closure.root / execution_name).exists():
            execution = closure.read(execution_name)
            if (execution.get("schema") != "upstate.conservation-native-execution/v1"
                    or execution.get("study_id") != study_id):
                raise ValueError("The packet native execution belongs to another study.")
            identity["native_execution"] = execution["runs"]
        if digest(identity) != key:
            raise ValueError("The decision packet differs from its original selected files.")
    else:
        selection = value["selection"]
        if selection.get("plan_id") != plan_id or selection.get("study_id") != study_id:
            raise ValueError("The optimization packet selects another original portfolio.")
        original = selection["original_packet"]
        path = PurePosixPath(_relative(original["path"]))
        if len(path.parts) != 3 or path.parts[0] != "conservation-exports":
            raise ValueError("The optimized decision packet needs its original Conservation packet.")
        closure.add_file(original["path"], original)
        closure.need("conservation-exports", path.parts[1], "Original packet beneath optimized Conservation export")
        reference = subject["selection"].get("optimization") or {}
        if (selection.get("analysis_id") != reference.get("analysis_id")
                or selection.get("analysis_files") != reference.get("files")):
            raise ValueError("The optimized packet lost its original saved analysis.")


def _receipt(closure, key, value):
    if value.get("state") != "complete" or value.get("edition") != REPORT_EDITION:
        raise ValueError("Choose a completed original Conservation report-source capture.")
    selection = value["selection"]
    if (selection.get("project_id") != closure.workspace.project["id"]
            or selection.get("edition") != REPORT_EDITION
            or any(selection.get(name) != value.get(name) for name in ("plan_id", "study_id", "title"))):
        raise ValueError("The Conservation report source belongs to another original selection.")
    closure.tree("conservation-report-sources/" + key)
    _files(closure, value["files"], "conservation-report-sources/" + key)
    _files(closure, value["members"], "conservation-report-sources/" + key)
    for kind, name in (("conservation", "study"), ("conservation-plans", "plan")):
        record_id = identifier(value[name + "_id"])
        if selection[name].get("path") != _path(kind, record_id):
            raise ValueError("The Conservation report retained another original record path.")
        closure.add_file(selection[name]["path"], selection[name])
        closure.need(kind, record_id, "Original editable Conservation report study")
    packet = selection["packet"]
    closure.add_file(packet["path"], packet)
    closure.need("conservation-exports", packet["id"], "Original Conservation report decision packet")
    for original in selection["source_entries"]:
        _source_entry(closure, original, original["entry"])
    entry = _source_entry(closure, value["source"])
    if (entry.get("id") != "conservation-portfolio-" + key
            or not _same(entry["body"], value["files"]["recipe"])):
        raise ValueError("The Conservation report receipt differs from its imported source.")
    include_source(closure, value["source"]["source_collection_id"], entry)


def visit(closure, kind, key, value):
    if kind not in ROOT_KINDS:
        return False
    _identity(kind, key, value)
    {"conservation": _study, "conservation-plans": _plan,
     "conservation-exports": _export, "conservation-report-sources": _receipt}[kind](closure, key, value)
    return True


def _reference(closure, plan, study):
    return {"schema": "upstate.conservation-plan-reference/v1", "kind": "conservation_plan",
            "workspace_id": closure.workspace.project["id"], "plan_id": plan["id"], "study_id": study["id"],
            "selected_ids": list(plan["selected_ids"]),
            "candidate_table_sha256": study["files"]["candidates"]["sha256"],
            "geometry_inventory_sha256": study["files"]["geometries"]["sha256"],
            "footprint": deepcopy(plan["files"]["footprint"])}


def _scenario(closure, path, value, plan):
    key, relative = path.parent.name, path.relative_to(closure.root).as_posix()
    names = ("schema", "project_id", "selection", "study_id", "footprint_sha256", "layer", "selected_ids")
    if (value.get("schema") != "upstate.conservation-scenario/v1" or value.get("id") != key
            or digest({name: value[name] for name in names}) != key
            or value.get("project_id") != closure.workspace.project["id"]
            or value.get("study_id") != plan["study_id"]
            or value.get("selected_ids") != plan.get("selected_ids")
            or value.get("footprint_sha256") != plan["files"]["footprint"]["sha256"]):
        raise ValueError("The Conservation scenario bridge differs from its original portfolio.")
    closure.read(relative)
    closure.tree("conservation-scenarios/" + key)
    _files(closure, value.get("files", {}), "conservation-scenarios/" + key)
    for field, kind in (("scenario_id", "scenarios"), ("run_id", "runs"),
                        ("source_collection_id", "sources")):
        if value.get(field):
            closure.need(kind, value[field], "Original Conservation scenario continuation")
    run = value["selection"].get("prepare_run")
    if run:
        for field, kind in (("grid_id", "grids"), ("profile_id", "profiles")):
            closure.need(kind, run[field], "Original Conservation scenario preparation")
    for handoff_path in sorted(path.parent.glob("experiments/*/handoff.json")):
        handoff = closure.read(handoff_path.relative_to(closure.root).as_posix())
        link = closure.read((handoff_path.parent / "selection.json").relative_to(closure.root).as_posix())
        if (handoff.get("schema") != "upstate.conservation-experiment-handoff/v1"
                or handoff.get("id") != handoff_path.parent.name or digest(link) != handoff["id"]
                or handoff.get("conservation_scenario_id") != key
                or link.get("source_reference") != handoff.get("source_reference")
                or link.get("selection") != handoff.get("selection")):
            raise ValueError("The retained Conservation experiment handoff changed.")
        for field, kind in (("experiment_id", "experiments"), ("baseline_run_id", "runs"),
                            ("alternative_run_id", "runs")):
            if handoff.get(field):
                closure.need(kind, handoff[field], "Original Conservation paired experiment")


def _design(closure, path, value, plan):
    key = path.parent.name
    kind = "preparation" if path.name == "preparation.json" else "receiving"
    study = _record(closure, "conservation", plan["study_id"])
    expected = (digest(value.get("selection")) if kind == "preparation" else
                digest({"workspace_id": closure.workspace.project["id"],
                        "handover_sha256": value.get("input", {}).get("sha256")}))
    reference = value["selection"].get("source_reference") if kind == "preparation" else value.get("source_reference")
    if (value.get("schema") != "upstate.conservation-design/v1" or value.get("kind") != kind
            or value.get("id") != key or key != expected or value.get("state") != "complete"
            or value.get("workspace_id") != closure.workspace.project["id"]
            or value.get("study_id") != study["id"] or reference != _reference(closure, plan, study)):
        raise ValueError("The Conservation editable design lost its original portfolio binding.")
    relative = path.parent.relative_to(closure.root).as_posix()
    closure.read(path.relative_to(closure.root).as_posix())
    closure.tree(relative)
    _files(closure, value["files"], relative)
    if kind == "preparation":
        binding = _read_file(closure, value["files"]["binding"])
        if (binding.get("id") != value["binding_id"]
                or binding.get("source_reference") != reference
                or digest({name: item for name, item in binding.items() if name != "id"}) != binding["id"]):
            raise ValueError("The Conservation editable project binding changed.")
    else:
        for field, group in (("scenario_id", "scenarios"), ("run_id", "runs"),
                             ("source_collection_id", "sources")):
            if value.get(field):
                closure.need(group, value[field], "Original received Conservation design")
        closure._source_refs(value.get("input", {}), "Original Conservation design input edition")


def related(closure):
    """Include saved portfolios and their existing original editing continuations."""
    studies = {key for kind, key in closure.nodes if kind == "conservation"}
    plans = {key for kind, key in closure.nodes if kind == "conservation-plans"}
    if not studies and not plans:
        return
    for kind in ("conservation-plans", "conservation-exports", "conservation-report-sources"):
        for path in sorted((closure.root / kind).glob("*/" + DOCUMENTS[kind])):
            if (kind, path.parent.name) in closure.nodes:
                continue
            try:
                value = read_json(path)
                if not isinstance(value, dict) or not (
                        value.get("study_id") in studies or value.get("plan_id") in plans):
                    continue
                _identity(kind, identifier(path.parent.name), value)
                closure.need(kind, path.parent.name, "Retained result of the selected Conservation study")
            except (OSError, ValueError, KeyError, TypeError) as error:
                issue = {"path": path.relative_to(closure.root).as_posix(), "message": str(error)}
                if issue not in closure.related_issues:
                    closure.related_issues.append(issue)
    # Original bridge/design owners keep their own directory shape. Retain that
    # shape directly; do not invent generic record kinds or rewrite their IDs.
    patterns = ("conservation-scenarios/*/scenario.json",
                "conservation-design/preparations/*/preparation.json",
                "conservation-design/received/*/receiving.json")
    for pattern in patterns:
        for path in sorted(closure.root.glob(pattern)):
            value = read_json(path)
            plan_id = (value.get("selection") or {}).get("plan_id") if pattern.startswith("conservation-scenarios") else value.get("plan_id")
            if plan_id not in plans:
                continue
            plan = _record(closure, "conservation-plans", plan_id)
            (_scenario if pattern.startswith("conservation-scenarios") else _design)(closure, path, value, plan)
    for path in sorted(closure.root.glob("conservation-exports/catalog/*/export.json")):
        value = read_json(path)
        reference = value.get("reference") or {}
        if reference.get("study_id") not in studies:
            continue
        if (value.get("schema") != "upstate.conservation-candidate-export/v1"
                or value.get("id") != path.parent.name or digest(reference) != path.parent.name):
            raise ValueError("The Conservation candidate export changed its original selection.")
        prefix = path.parent.relative_to(closure.root).as_posix()
        closure.read(path.relative_to(closure.root).as_posix())
        closure.tree(prefix)
        _files(closure, value["files"], prefix)


def lock_paths(closure):
    paths = set()
    for kind, key in closure.nodes:
        if kind == "conservation":
            base = closure.root / kind / key
            for folder, filename in (("catalog", ".catalog.lock"), ("catalog-selections", ".selection.lock")):
                for path in base.glob(folder + "/*"):
                    if path.is_dir():
                        paths.add((path / filename).relative_to(closure.root).as_posix())
        elif kind == "conservation-exports":
            paths.add(kind + "/" + key + "/.optimization-export.lock")
    for prefix in closure.trees:
        if prefix.startswith("conservation-scenarios/") and len(PurePosixPath(prefix).parts) == 2:
            paths.add(prefix + "/.create.lock")
            for path in (closure.root / prefix).glob("experiments/*"):
                paths.add((path / ".handoff.lock").relative_to(closure.root).as_posix())
        elif prefix.startswith("conservation-design/preparations/"):
            paths.add(prefix + "/.prepare.lock")
        elif prefix.startswith("conservation-design/received/"):
            paths.add(prefix + "/.receive.lock")
        elif prefix.startswith("conservation-exports/catalog/"):
            paths.add(prefix + "/.catalog-export.lock")
    return sorted(paths)


def include_source(closure, collection_id, entry):
    """Resolve only the original saved-Conservation scientific-report producer."""
    metadata = entry.get("metadata") or {}
    origin = metadata.get("origin") or {}
    if metadata.get("source_kind") != "saved_conservation_portfolio" and origin.get("schema") != REPORT_SCHEMA:
        return False
    closure.add_file(entry["body"]["object"], entry["body"])
    recipe = closure.read(entry["body"]["object"])
    origin = recipe.get("origin") or {}
    key = identifier(origin.get("id"))
    if (entry.get("kind") != "document" or entry.get("role") != observed_context.ROLE
            or entry.get("id") != "conservation-portfolio-" + key
            or recipe.get("schema") != observed_context.SCHEMA or recipe.get("edition") != REPORT_EDITION
            or origin.get("schema") != REPORT_SCHEMA or metadata.get("origin") != origin):
        raise ValueError("The saved Conservation report differs from its original source producer.")
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("The Conservation report repeats an original companion path.")
        closure.add_file(item["object"], item)
        members[name] = item
    inputs = {item["path"]: item for item in recipe.get("inputs", [])}
    if (len(inputs) != len(recipe.get("inputs", [])) or set(inputs) != set(members)
            or any(not _same(item, members[name]) for name, item in inputs.items())):
        raise ValueError("The Conservation report lost an original declared input.")
    def read(name):
        if name not in members:
            raise ValueError("The Conservation report needs its original companion " + name)
        return closure.read(members[name]["object"])
    study, plan = read("records/study.json"), read("records/plan.json")
    study_id, plan_id = identifier(origin["study_id"]), identifier(origin["plan_id"])
    _identity("conservation", study_id, study)
    _identity("conservation-plans", plan_id, plan)
    portfolio = read("records/portfolio.json")
    originals = read("records/source-bindings.json")
    if (plan.get("study_id") != study_id or plan["selection"].get("study_id") != study_id
            or portfolio.get("schema") != "upstate.conservation-portfolio/v1"
            or portfolio.get("id") != plan_id or portfolio.get("study_id") != study_id
            or portfolio.get("selected_ids") != plan.get("selected_ids")
            or portfolio.get("summary") != plan.get("summary")
            or not _same(members["records/portfolio.json"], plan["files"]["portfolio"])
            or not _same(members["records/candidates.json"], study["files"]["candidates"])
            or plan["selection"].get("candidates_sha256") != study["files"]["candidates"]["sha256"]
            or plan["selection"].get("geometries_sha256") != study["files"]["geometries"]["sha256"]
            or originals.get("schema") != "upstate.conservation-report-originals/v1"
            or originals.get("study_id") != study_id):
        raise ValueError("The Conservation report lost its original study, portfolio or candidates.")
    local = origin.get("project_id") == closure.workspace.project["id"]
    if not isinstance(origin.get("project_id"), str) or not origin["project_id"]:
        raise ValueError("The Conservation report needs its original project identity.")
    for original in originals["sources"]:
        source_collection = identifier(original["source_collection_id"])
        original_entry = original["entry"]
        if original_entry.get("id") != original.get("source_id"):
            raise ValueError("The Conservation report source inventory changed.")
        prefix = "originals/" + source_collection + "/" + digest(original["source_id"]) + "/"
        for item in [original_entry["body"], *original_entry.get("companions", [])]:
            name = prefix + _relative(item.get("view_path", item["filename"]))
            if name not in members or not _same(item, members[name]):
                raise ValueError("The Conservation report lost an original planning-source body.")
        if local:
            _source_entry(closure, original, original_entry)
    required = []
    if local:
        receipt = _record(closure, "conservation-report-sources", key)
        identity = receipt.get("selection") or {}
        _identity("conservation-report-sources", key, receipt)
        original_entry = _source_entry(closure, receipt["source"])
        if (identity.get("project_id") != origin["project_id"]
                or identity.get("source_entries") != originals["sources"]
                or identity.get("plan_id") != plan_id or identity.get("study_id") != study_id
                or identity.get("packet", {}).get("id") != origin.get("packet_id")
                or _entry_identity(original_entry) != _entry_identity(entry)
                or not _same(identity.get("packet"), members["decision-packet.zip"])
                or not _same(receipt.get("files", {}).get("recipe"), entry["body"])
                or not _same(identity.get("plan"), members["records/plan.json"])
                or not _same(identity.get("study"), members["records/study.json"])):
            raise ValueError("The Conservation report differs from its original editable capture.")
        for kind, record_id, original in (("conservation", study_id, study),
                                         ("conservation-plans", plan_id, plan)):
            if _record(closure, kind, record_id) != original:
                raise ValueError("The Conservation report and original editable study differ.")
        for kind, record_id in (("conservation-report-sources", key), ("conservation", study_id),
                                ("conservation-plans", plan_id), ("conservation-exports", origin["packet_id"])):
            closure.need(kind, record_id, "Original editable saved Conservation report")
            required.append({"kind": kind, "id": record_id})
    binding = {"schema": "upstate.study-report-lineage/v1",
               "source_collection_id": collection_id, "source_id": entry["id"],
               "source_body_sha256": entry["body"]["sha256"], "source_project_id": origin["project_id"],
               "report_context_kind": "conservation_portfolio", "report_source_id": key,
               "study_id": study_id, "plan_id": plan_id, "packet_id": origin["packet_id"],
               "relationship": "same_project" if local else "external_project", "required_records": required}
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != binding:
        raise ValueError("A Conservation report source changed during study selection.")
    closure.report_source_records[token] = binding
    return True


def catalogue(workspace, kind):
    if kind not in ROOT_KINDS:
        return []
    root = Path(workspace.root).resolve()
    rows = []
    for path in sorted((root / kind).glob("*/" + DOCUMENTS[kind])):
        key = path.parent.name
        try:
            identifier(key)
            if path.is_symlink() or path.parent.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError("Keep the Conservation study in its original Workspace.")
            value = read_json(path)
            _identity(kind, key, value)
            rows.append({"kind": kind, "id": key, "title": value.get("title") or LABELS[kind] + " " + key[:12],
                         "state": value.get("state", "complete"),
                         "updated_at": value.get("completed_at") or value.get("created_at", ""),
                         "study_id": value.get("study_id"), "plan_id": value.get("plan_id")})
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"kind": kind, "id": key, "title": key[:12], "state": "unreadable",
                         "updated_at": "", "error": {"type": type(error).__name__, "message": str(error)}})
    return rows
