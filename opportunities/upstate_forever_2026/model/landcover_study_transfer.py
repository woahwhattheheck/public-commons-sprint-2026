"""Editable original land-cover ledgers behind selected scientific reports.

This joins the maintained Study closure through raw CAS records. It does not
materialize source views, open raster datasets, render reports or run a reducer.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

SOURCE_SCHEMA = "upstate.landcover-report-source/v1"
REPORT_SCHEMA = "upstate.observed-report/v1"
EDITION_SCHEMA = "upstate.landcover-edition/v1"
SOURCE_BINDING = "upstate.landcover-source-binding/v1"
RUN_BINDING = "upstate.landcover-binding/v1"
REPORT_ROOT = "landcover-report-sources"
LEDGER_ROOT = "landcover-ledgers"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Land-cover source needs canonical relative member paths")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in item for item in path.parts)):
        raise ValueError("Land-cover source member escapes its original directory")
    return value


def _same_file(first, second):
    return all(first.get(field) == second.get(field) for field in ("bytes", "sha256"))


def _body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _captured(closure, entry):
    recipe = _body(closure, entry["body"])
    metadata = entry["metadata"]
    origin = recipe.get("origin")
    if not isinstance(origin, dict) or origin.get("schema") != SOURCE_SCHEMA:
        raise ValueError("Land-cover report lost its original producer identity")
    source_id = identifier(origin.get("id"))
    ledger_id = identifier(origin.get("ledger_id"))
    project_id = origin.get("project_id")
    if (entry.get("kind") != "document" or entry.get("role") != "OBSERVED_CONTEXT"
            or recipe.get("schema") != REPORT_SCHEMA or metadata.get("origin") != origin
            or not isinstance(project_id, str) or not project_id
            or entry.get("id") != "landcover-ledger-" + source_id
            or entry.get("uri") != "workspace://" + project_id + "/landcover-ledgers/" + ledger_id):
        raise ValueError("Land-cover report source differs from its original producer")
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("Land-cover source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    selected = set()
    requested = recipe.get("inputs")
    if not isinstance(requested, list) or not requested:
        raise ValueError("Land-cover source must retain its original inputs")
    for item in requested:
        name = _relative(item["path"])
        if name in selected or name not in members or not _same_file(item, members[name]):
            raise ValueError("Land-cover source lost an exact original input: " + name)
        selected.add(name)
    if selected != set(members):
        raise ValueError("Land-cover source companion inventory differs from its recipe")

    def original(name):
        if name not in members:
            raise ValueError("Land-cover source lacks original member: " + name)
        return _body(closure, members[name])

    edition = original("ledger/edition.json")
    binding = original("ledger/input-bindings.json")
    report = original("ledger/results/ledger.json")
    originals = original("records/source-bindings.json")
    if (edition.get("schema") != EDITION_SCHEMA or edition.get("id") != ledger_id
            or edition.get("workspace_id") != project_id or edition.get("state") != "complete"
            or binding.get("workspace_id") != project_id or digest(binding) != ledger_id
            or edition.get("binding_sha256") != ledger_id
            or edition.get("selection") != binding.get("selection")
            or edition.get("grid_id") != binding.get("grid_id")
            or edition.get("signature") != origin.get("signature")
            or report.get("schema") != "upstate.landcover-ledger/1"
            or report.get("signature") != origin.get("signature") or report.get("complete") is not True
            or originals.get("schema") != "upstate.landcover-report-originals/v1"
            or originals.get("ledger_id") != ledger_id
            or origin.get("area_method") != "fractional_polygon_overlap"
            or origin.get("area_basis") != report.get("grid", {}).get("area_basis")):
        raise ValueError("Land-cover source changed its saved ledger or original binding")
    selection = binding["selection"]
    source_mode = selection.get("input_mode") == "sources"
    if (binding.get("schema") != (SOURCE_BINDING if source_mode else RUN_BINDING)
            or origin.get("input_mode") != selection.get("input_mode", "runs")):
        raise ValueError("Land-cover source changed its original operand mode")
    if source_mode and (binding.get("grid_id") is not None
                        or original("ledger/results/input-editions.json") != binding):
        raise ValueError("Annual-source ledger lost its exact portable source binding")
    files = edition.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("Land-cover source lacks its completed original artifacts")
    for item in files.values():
        name = "ledger/" + _relative(item["path"])
        if name not in members or not _same_file(item, members[name]):
            raise ValueError("Land-cover source lost an original ledger artifact: " + name)
    for role, path in (("binding", "input-bindings.json"), ("ledger.json", "results/ledger.json"),
                       ("original_zones", "zones-original.geojson")):
        if files.get(role, {}).get("path") != path:
            raise ValueError("Land-cover source changed an original artifact role")
    operands = binding.get("operands")
    if not isinstance(operands, list) or len(operands) < 2:
        raise ValueError("Land-cover source needs its ordered baseline and alternatives")
    if edition.get("alternative_count") != len(operands) - 1:
        raise ValueError("Land-cover source changed its original alternative count")
    if not source_mode and [row.get("run_id") for row in operands] != [
            selection.get("baseline_run_id"), *selection.get("alternative_run_ids", [])]:
        raise ValueError("Land-cover source changed its ordered native runs")
    if source_mode:
        references = [selection.get("baseline_source"), *selection.get("alternative_sources", [])]
        if [row.get("source_selection") for row in operands] != references:
            raise ValueError("Land-cover source changed its ordered raster sources or bands")
        keys = ["source-" + digest(choice)[:20] for choice in references[1:]]
    else:
        keys = [row["run_id"] for row in operands[1:]]
    if report.get("scenarios") != keys:
        raise ValueError("Land-cover source changed its original computed alternative order")
    return origin, recipe, members, edition, binding, report, originals


def _original_entries(closure, binding, originals, members, *, local):
    requested = [(binding["zones"]["selection"], binding["zones"]["source_entry"])]
    if binding["schema"] == SOURCE_BINDING:
        requested.extend((row["source_selection"], row["source_entry"]) for row in binding["operands"])
    expected = {}
    for choice, entry in requested:
        collection_id = identifier(choice["source_collection_id"])
        key = (collection_id, choice["source_id"])
        if key in expected and expected[key] != entry:
            raise ValueError("Land-cover operands disagree about an original source entry")
        expected[key] = entry
    captured = {}
    for row in originals.get("sources", []):
        key = (identifier(row["source_collection_id"]), row["source_id"])
        if key in captured or expected.get(key) != row.get("entry"):
            raise ValueError("Land-cover source changed its original source roster")
        captured[key] = row["entry"]
        prefix = "originals/" + key[0] + "/" + digest(key[1]) + "/"
        for item in [row["entry"]["body"], *row["entry"].get("companions", [])]:
            name = prefix + _relative(item.get("view_path", item["filename"]))
            if name not in members or not _same_file(item, members[name]):
                raise ValueError("Land-cover source lost an original source body: " + name)
        if local:
            collection = closure.read("sources/" + key[0] + ".json")
            entries = [entry for entry in collection.get("entries", []) if entry.get("id") == key[1]]
            if (collection.get("schema") != "upstate.sources/v1" or digest(collection) != key[0]
                    or entries != [row["entry"]]):
                raise ValueError("Editable land-cover input differs from its captured source")
            closure.need("sources", key[0], "Original land-cover raster or reporting source")
    if set(captured) != set(expected):
        raise ValueError("Land-cover source omitted an original input edition")
    return [{"kind": "sources", "id": key} for key in sorted({pair[0] for pair in expected})]


def _native_members(closure, binding, report, originals, members, *, local):
    native = originals.get("native_raster_members")
    if not isinstance(native, list):
        raise ValueError("Land-cover source lacks its native dependency inventory")
    if binding["schema"] == SOURCE_BINDING:
        if native:
            raise ValueError("Annual-source ledger unexpectedly declares native run members")
        return []
    accepted = {(item["bytes"], item["sha256"]) for item in report["inputs"]
                if item["role"] == "baseline" or item["role"].startswith("scenario:")
                or item["role"] == "raster-companion"}
    paths = {}
    for item in native:
        path = _relative(item["path"])
        if (path in paths or (item["bytes"], item["sha256"]) not in accepted
                or "run-rasters/" + path not in members
                or not _same_file(item, members["run-rasters/" + path])):
            raise ValueError("Land-cover native raster differs from its computed input")
        paths[path] = item
        if local:
            closure.add_file(path, item)
    for operand in binding["operands"]:
        raster = operand["raster"]
        if raster["path"] not in paths or not _same_file(paths[raster["path"]], raster):
            raise ValueError("Land-cover source lost a native baseline or alternative raster")
    if not local:
        return []
    grid_id = identifier(binding["grid_id"])
    grid = closure.read("grids/" + grid_id + "/grid.json")
    if (grid.get("id") != grid_id or grid.get("grid") != binding["grid_definition"]
            or grid.get("spec") != binding["grid_spec"]):
        raise ValueError("Editable land-cover prepared grid differs from its binding")
    closure.need("grids", grid_id, "Original prepared grid for retained land-cover ledger")
    required = [{"kind": "grids", "id": grid_id}]
    for operand in binding["operands"]:
        run_id = identifier(operand["run_id"])
        run = closure.read("runs/" + run_id + "/run.json")
        if (run.get("id") != run_id or run.get("selection") != operand["selection"]
                or digest(run["selection"]) != run_id
                or run["selection"].get("grid_id") != grid_id):
            raise ValueError("Editable land-cover run differs from its captured selection")
        scenario_id = identifier(run["selection"]["scenario_id"])
        scenario = closure.read("scenarios/" + scenario_id + ".json")
        if digest(scenario) != scenario_id or {**scenario, "id": scenario_id} != operand["scenario"]:
            raise ValueError("Editable land-cover scenario differs from its captured edition")
        if operand["basis"] == "retained_landcover_stage":
            descriptor = run.get("stages", {}).get("landcover", {}).get("artifact")
            if not isinstance(descriptor, dict):
                raise ValueError("Original land-cover stage artifact is missing")
            current = {**descriptor, "path": "runs/" + run_id + "/" + _relative(descriptor["path"])}
        elif operand["basis"] == "retained_grid_NLCD":
            descriptor = grid["files"]["NLCD"]
            current = {**descriptor, "path": "grids/" + grid_id + "/" + _relative(descriptor["path"])}
        else:
            raise ValueError("Unknown original land-cover raster basis")
        if current != operand["raster"]:
            raise ValueError("Editable land-cover raster descriptor changed")
        closure.need("runs", run_id, "Original selected run for saved land-cover ledger")
        required.append({"kind": "runs", "id": run_id})
    return required


def _local(closure, collection_id, entry, origin, recipe, members, edition, binding):
    key, ledger_id = origin["id"], origin["ledger_id"]
    prefix = REPORT_ROOT + "/" + key + "/"
    receipt = closure.read(prefix + "receipt.json")
    if (receipt.get("schema") != SOURCE_SCHEMA or receipt.get("state") != "complete"
            or receipt.get("id") != key or digest(receipt.get("selection")) != key
            or receipt["selection"].get("project_id") != origin["project_id"]
            or receipt.get("ledger_id") != ledger_id
            or receipt["selection"].get("ledger_id") != ledger_id
            or receipt["selection"].get("signature") != origin["signature"]
            or receipt.get("title") != recipe.get("title")):
        raise ValueError("Editable land-cover report receipt differs from its source")
    source = receipt["source"]
    original_collection_id = identifier(source["source_collection_id"])
    collection = closure.read("sources/" + original_collection_id + ".json")
    original = [row for row in collection.get("entries", []) if row.get("id") == source.get("source_id")]
    if (digest(collection) != original_collection_id or len(original) != 1
            or source.get("source_id") != entry["id"]
            or not _same_file(original[0]["body"], entry["body"])):
        raise ValueError("Editable land-cover report lost its original imported source")
    original_members = {}
    for item in original[0].get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in original_members:
            raise ValueError("Editable land-cover report repeats a source companion")
        original_members[name] = item
    if (set(original_members) != set(members)
            or any(not _same_file(original_members[name], item) for name, item in members.items())):
        raise ValueError("Editable land-cover report lost its original imported source")
    closure.need("sources", original_collection_id, "Original imported land-cover report source")
    retained = receipt.get("members")
    if not isinstance(retained, dict) or set(retained) != set(members):
        raise ValueError("Editable land-cover source changed its member roster")
    for name, descriptor in retained.items():
        if descriptor.get("path") != prefix + name or not _same_file(descriptor, members[name]):
            raise ValueError("Editable land-cover source changed an original member")
        closure.add_file(descriptor["path"], descriptor)
    for descriptor in receipt["files"].values():
        path = _relative(descriptor["path"])
        if not path.startswith(prefix):
            raise ValueError("Land-cover report file belongs to another original source")
        closure.add_file(path, descriptor)
    if (receipt["files"]["recipe"]["path"] != prefix + "landcover-report.json"
            or not _same_file(receipt["files"]["recipe"], entry["body"])
            or closure.read(prefix + "landcover-report.json") != recipe):
        raise ValueError("Editable land-cover report recipe differs from its source")
    ledger_prefix = LEDGER_ROOT + "/" + ledger_id + "/"
    for name, expected in (("edition.json", edition), ("input-bindings.json", binding)):
        closure.add_file(ledger_prefix + name, members["ledger/" + name])
        if closure.read(ledger_prefix + name) != expected:
            raise ValueError("Editable land-cover ledger changed its original " + name)
    for descriptor in edition["files"].values():
        closure.add_file(ledger_prefix + _relative(descriptor["path"]), descriptor)
    # Capture the original completed reducer database/checkpoints as well as every
    # declared report artifact. The maintained closure detects concurrent changes.
    closure.tree(ledger_prefix.rstrip("/"))
    closure.tree(prefix.rstrip("/"))
    return original_collection_id


def include_source(closure, collection_id, entry):
    """Follow this producer only for an explicitly ordered saved-report source."""
    if (entry.get("metadata") or {}).get("source_kind") != "saved_landcover_ledger":
        return False
    identifier(collection_id)
    origin, recipe, members, edition, binding, report, originals = _captured(closure, entry)
    local = origin["project_id"] == closure.workspace.project["id"]
    required = _original_entries(closure, binding, originals, members, local=local)
    native_required = _native_members(closure, binding, report, originals, members, local=local)
    if local:
        original_source_id = _local(closure, collection_id, entry, origin, recipe, members, edition, binding)
        required.extend(native_required)
        if {"kind": "sources", "id": original_source_id} not in required:
            required.append({"kind": "sources", "id": original_source_id})
    record = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": origin["project_id"],
        "report_context_kind": "landcover_ledger", "landcover_ledger_id": origin["ledger_id"],
        "landcover_report_source_id": origin["id"], "producer_edition": recipe["edition"],
        "signature": origin["signature"], "selection": deepcopy(binding["selection"]),
        "input_mode": origin["input_mode"], "area_method": origin["area_method"],
        "area_basis": origin["area_basis"],
        "relationship": "same_project" if local else "external_project",
        "required_records": required if local else [],
        "source_entries": [{"source_collection_id": row["source_collection_id"],
                            "source_id": row["source_id"], "body_sha256": row["entry"]["body"]["sha256"]}
                           for row in originals["sources"]],
        "original_members": {name: members[name]["sha256"] for name in sorted(members)},
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != record:
        raise ValueError("Land-cover source lineage changed during Study selection")
    closure.report_source_records[token] = record
    return True
