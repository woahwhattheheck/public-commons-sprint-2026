"""Editable original watershed network, preparation and native programme lineage.

Reads declared records and CAS members only. Scientific quantities, geographic
membership, model execution and report production remain with their original
owners. This helper extends the maintained selected-study closure.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath

from .common import digest, identifier, read_json

ROOT_KINDS = ("receptor-networks", "receptor-scenario-areas", "receptor-programmes",
              "receptor-experiments", "receptor-inventories", "receptor-report-sources")
DOCUMENTS = {kind: "result.json" for kind in ROOT_KINDS}
DOCUMENTS["compute-programmes"] = "programme.json"
LOCKS = dict(zip(ROOT_KINDS, (".network.lock", ".prepare.lock", ".prepare.lock",
                            ".batch.lock", ".inventory.lock", ".report.lock")))
LOCKS["compute-programmes"] = ".programme.lock"
LABELS = dict(zip(ROOT_KINDS, ("Original watershed networks", "Prepared source-water areas",
                              "Source-water native programmes", "Source-water experiment comparisons",
                              "Native receiving-area inventories", "Source geography report sources")))
SCHEMAS = dict(zip(ROOT_KINDS, (
    "upstate.receptor-network-product/v1", "upstate.receptor-scenario-areas/v1",
    "upstate.receptor-programme/v1", "upstate.receptor-experiment/v1",
    "upstate.receptor-inventory/v1", "upstate.receptor-report-source/v1")))
REPORT_SCHEMA = "upstate.observed-report/v1"
SOURCE_SCOPE = "Original watershed topology and prepared source geometry"


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Retain the original watershed member path")
    name = PurePosixPath(value)
    if (not name.parts or name.is_absolute() or ".." in name.parts
            or name.as_posix() != value or any(":" in part for part in name.parts)):
        raise ValueError("A watershed member must remain in its original directory")
    return value


def _prefix(kind, key):
    return kind + "/" + identifier(key) + "/"


def _same(first, second):
    return isinstance(first, dict) and isinstance(second, dict) and all(
        field in first and first[field] == second.get(field) for field in ("bytes", "sha256"))


def _files(closure, prefix, files):
    if not isinstance(files, dict):
        raise ValueError("Retain the original watershed file inventory")
    for item in files.values():
        closure.add_file(prefix + _relative(item["path"]), item)


def _read_file(closure, prefix, item):
    path = prefix + _relative(item["path"])
    closure.add_file(path, item)
    return closure.read(path)


def _record(closure, kind, key):
    return closure.read(_prefix(kind, key) + DOCUMENTS[kind])


def _identity(closure, kind, key, value):
    identity = value.get("identity")
    legacy = kind == "receptor-experiments" and identity is None
    if (value.get("schema") != SCHEMAS[kind] or value.get("id") != key
            or not legacy and (not isinstance(identity, dict) or digest(identity) != key)):
        raise ValueError("The original watershed record changed its retained identity")
    if kind not in ("receptor-networks", "receptor-inventories"):
        if value.get("workspace_id") != closure.workspace.project["id"]:
            raise ValueError("The watershed continuation belongs to another original project")
        if (identity or {}).get("workspace_id") not in (None, closure.workspace.project["id"]):
            raise ValueError("The watershed identity belongs to another original project")
    prefix = _prefix(kind, key)
    closure.tree(prefix.rstrip("/"))
    _files(closure, prefix, value["files"])
    return prefix


def _source(closure, collection_id, source_id, *, body=None):
    collection_id = identifier(collection_id)
    collection = closure.read("sources/" + collection_id + ".json")
    if collection.get("schema") != "upstate.sources/v1" or digest(collection) != collection_id:
        raise ValueError("The original watershed source collection changed")
    rows = [row for row in collection.get("entries", []) if row.get("id") == source_id]
    if len(rows) != 1 or body is not None and not _same(rows[0]["body"], body):
        raise ValueError("The watershed source differs from its retained original body")
    closure.need("sources", collection_id, "Original source-water input edition")
    return rows[0]


def _network(closure, key, value, prefix):
    identity, binding = value["identity"], value["source_binding"]
    if (identity.get("schema") != SCHEMAS["receptor-networks"]
            or identity.get("source_body_sha256") != binding.get("body_sha256")
            or not _same(value["files"]["source_body"],
                         {"bytes": binding.get("body_bytes"), "sha256": binding.get("body_sha256")})
            or _read_file(closure, prefix, value["files"]["profile"]) != identity.get("receptor_spec")):
        raise ValueError("The watershed network lost its original source or receiving-area specification")
    network = _read_file(closure, prefix, value["files"]["network"])
    if (network.get("source_binding") != binding
            or network.get("network_huc12_count") != value.get("network_huc12_count")
            or network.get("selected_huc12_count") != value.get("selected_huc12_count")
            or network.get("shared_huc12s") != value.get("shared_huc12s")
            or [{k: v for k, v in area.items() if k != "memberships"}
                for area in network.get("areas", [])] != value.get("areas")):
        raise ValueError("The retained network summary differs from its original drainage inventory")
    closure._source_refs(identity["receptor_spec"], "Original watershed source reference")


def _prepared(closure, key, value, prefix):
    identity = value["identity"]
    network_id = identifier(value["network_result_id"])
    network = _record(closure, "receptor-networks", network_id)
    if (identity.get("schema") != SCHEMAS["receptor-scenario-areas"]
            or identity.get("network_result_id") != network_id
            or identity.get("source_body_sha256") != network["source_binding"]["body_sha256"]
            or value.get("source_binding") != network["source_binding"]):
        raise ValueError("Prepared polygons differ from their original watershed source")
    closure.need("receptor-networks", network_id, "Original network behind prepared source polygons")
    if _read_file(closure, prefix, value["files"]["network"]) != _read_file(
            closure, _prefix("receptor-networks", network_id), network["files"]["network"]):
        raise ValueError("Prepared source areas changed their retained drainage graph")
    areas = value.get("areas")
    if (not isinstance(areas, list) or [area.get("id") for area in areas] != identity.get("receptor_ids")):
        raise ValueError("Prepared source areas changed their original ordered selection")
    for area in areas:
        entry = _source(closure, value["source_collection_id"], area["source_id"],
                        body=value["files"][area["file_key"]])
        origin = entry.get("origin") or {}
        if (entry.get("kind") != "vector" or entry.get("source_plan_id") != key
                or origin.get("network_result_id") != network_id
                or origin.get("receptor_id") != area["id"]
                or origin.get("huc12s") != area["huc12s"]
                or origin.get("original_source_body_sha256") != value["source_binding"]["body_sha256"]):
            raise ValueError("A prepared original polygon source lost its native watershed binding")
    handoff = _read_file(closure, prefix, value["files"]["handoff"])
    if handoff != value.get("scenario_source_areas"):
        raise ValueError("The prepared original analysis handoff changed")
    origin = handoff.get("origin") or {}
    if (origin.get("workspace_id") != closure.workspace.project["id"]
            or origin.get("source_plan_id") != key
            or origin.get("network_result_id") != network_id
            or origin.get("source_collection_id") != value["source_collection_id"]):
        raise ValueError("The prepared source handoff belongs to another original selection")


def _programme(closure, key, value, prefix):
    identity, selection = value["identity"], value["selection"]
    prepared_id = identifier(value["preparation_id"])
    prepared = _record(closure, "receptor-scenario-areas", prepared_id)
    if (identity.get("schema") != SCHEMAS["receptor-programmes"]
            or identity.get("selection") != selection
            or selection.get("preparation_id") != prepared_id
            or value.get("network_result_id") != prepared["network_result_id"]
            or value.get("source_collection_id") != prepared["source_collection_id"]
            or value.get("source_binding") != prepared["source_binding"]
            or identity.get("source_body_sha256") != prepared["source_binding"]["body_sha256"]
            or identity.get("source_collection_id") != prepared["source_collection_id"]
            or [row.get("run_id") for row in value["runs"]] != identity.get("native_run_ids")
            or _read_file(closure, prefix, value["files"]["selection"]) != selection
            or _read_file(closure, prefix, value["files"]["comparison"]) != value["comparison_selection"]):
        raise ValueError("The source-water programme changed its original prepared-area binding")
    closure.need("receptor-scenario-areas", prepared_id, "Original source-water programme polygons")
    closure.need("grids", selection["grid_id"], "Original source-water native grid")
    closure.need("experiments", value["experiment_id"], "Original paired source-water experiment")
    closure.need("compute-programmes", value["programme_id"], "Original native execution continuation")
    native = _record(closure, "compute-programmes", value["programme_id"])
    if (native.get("selection", {}).get("source_reference") != "upstate.experiment:" + value["experiment_id"]
            or {row["run_id"] for row in native.get("runs", [])} != set(identity["native_run_ids"])):
        raise ValueError("The execution programme changed its original paired run roster")
    for row in value["runs"]:
        closure.need("runs", row["run_id"], "Original prepared source-water native case")
        closure.need("runs", row["paired_baseline_run_id"], "Original paired source-water baseline")
    for kind, field in (("profiles", "profile_ids"), ("scenarios", "scenario_ids")):
        for item in selection[field]:
            closure.need(kind, item, "Original source-water design selection")
    closure.need("scenarios", selection["baseline_scenario_id"], "Original land-cover baseline")


def _compute(closure, key, value):
    from .compute_programme import ComputeProgrammes
    # Both original checks are pure dictionary validation; do not call status(),
    # inspect_execution(), or any native programme writer during closure.
    owner = ComputeProgrammes(closure.workspace)
    owner._check_record(key, value)
    prefix = _prefix("compute-programmes", key)
    closure.tree(prefix.rstrip("/"))
    state = closure.read(prefix + "progress.json")
    owner._check_state(key, state)
    closure.need("grids", value["selection"]["grid_id"], "Original execution-programme grid")
    for row in value["runs"]:
        if digest(row["native_selection"]) != row["run_id"]:
            raise ValueError("The retained programme case changed its original native selection")
        closure.need("runs", row["run_id"], "Original execution-programme case")
        retained = closure.read("runs/" + row["run_id"] + "/run.json")
        if retained.get("selection") != row["native_selection"]:
            raise ValueError("The programme case differs from its original native run")
        for donor in (row.get("source_runs") or {}).values():
            closure.need("runs", donor, "Original producing-stage donor for the retained programme")
    for comparison in state.get("comparisons", {}).values():
        if comparison.get("id"):
            closure.need("comparisons", comparison["id"], "Original programme comparison")
    for delivery in state.get("deliveries", {}).values():
        if delivery.get("delivery_id"):
            closure.need("deliveries", delivery["delivery_id"], "Original programme map delivery")
        if delivery.get("receiving"):
            closure._descriptors(delivery["receiving"])
    for continuation in state.get("pair_completions", {}).values():
        closure.need("compute-programmes", continuation["programme_id"],
                     "Original matched-pair native continuation")
        closure._descriptors(continuation["origin"])
    # Reports and attempts are retained under the original programme tree.
    # Their native dependencies remain the exact immutable case roster above.


def _inventory(closure, key, value, prefix):
    selection = value.get("build_selection")
    if not isinstance(selection, dict) or value["identity"].get("selection") != selection:
        raise ValueError("The receiving-area inventory changed its original native selection")
    closure.need("runs", selection["baseline_run_id"], "Original receiving-area baseline")
    for run_id in selection["scenario_run_ids"]:
        closure.need("runs", run_id, "Original receiving-area land-cover alternative")
    if selection.get("delivery_id"):
        closure.need("deliveries", selection["delivery_id"], "Original receiving-area priority map")
    closure._source_refs(selection["receptor_spec"], "Original receiving-area input geography")
    inventory = _read_file(closure, prefix, value["files"]["inventory"])
    if (inventory.get("schema") != SCHEMAS["receptor-inventories"]
            or inventory.get("baseline_run_id") != value.get("baseline_run_id")
            or inventory.get("alternative_run_ids") != value.get("alternative_run_ids")
            or inventory.get("native_execution") != value.get("native_execution")):
        raise ValueError("The native receiving-area inventory differs from its retained result")


def _experiment(closure, key, value, prefix):
    identity, selected = value.get("identity"), value["selection"]
    if (identity is not None and identity.get("selection") != selected
            or selected.get("experiment_id") != value.get("experiment_id")):
        raise ValueError("The receiving-area comparison changed its original experiment")
    closure.need("experiments", value["experiment_id"], "Original receiving-area parameter experiment")
    if value.get("grid_id"):
        closure.need("grids", value["grid_id"], "Original receiving-area comparison grid")
    snapshot = _read_file(closure, prefix, value["files"]["snapshot"])
    if snapshot.get("id") != value["experiment_id"] or value["files"]["snapshot"]["sha256"] != value["snapshot_sha256"]:
        raise ValueError("The receiving-area experiment lost its retained case snapshot")
    closure._source_refs(selected["receptor_spec"], "Original receiving-area comparison sources")
    for baseline, delivery_id in selected.get("delivery_ids_by_baseline", {}).items():
        closure.need("runs", baseline, "Original receiving-area priority baseline")
        closure.need("deliveries", delivery_id, "Original receiving-area priority delivery")
    for group in value["groups"]:
        if group.get("state") == "complete":
            closure.need("receptor-inventories", group["inventory_id"], "Original completed receiving-area profile result")
            closure._descriptors(group["files"])
            closure.need("runs", group["baseline_run_id"], "Original profile baseline")
            for run_id in group["alternative_run_ids"]:
                closure.need("runs", run_id, "Original profile alternative")


def _report(closure, key, value, prefix):
    identity = value["identity"]
    if (identity.get("schema") != SCHEMAS["receptor-report-sources"]
            or value.get("selection") != identity.get("selection")
            or value.get("network_result_id") != identity["selection"].get("network_id")
            or value.get("preparation_id") != identity["selection"].get("preparation_id")
            or value.get("state") != "complete"):
        raise ValueError("Choose the original completed source geography report")
    network_id = identifier(value["network_result_id"])
    closure.need("receptor-networks", network_id, "Original source geography report network")
    closure.add_file(_prefix("receptor-networks", network_id) + "result.json", identity["network_result"])
    prepared_id = value.get("preparation_id")
    if prepared_id:
        closure.need("receptor-scenario-areas", prepared_id, "Original source geography report polygons")
        closure.add_file(_prefix("receptor-scenario-areas", prepared_id) + "result.json", identity["prepared_result"])
    for name, descriptor in identity["source_members"].items():
        closure.add_file(prefix + _relative(name), descriptor)
    choice = value["source_choice"]
    entry = _source(closure, choice["source_collection_id"], choice["source_id"], body=value["files"]["recipe"])
    include_source(closure, choice["source_collection_id"], entry)


def visit(closure, kind, key, value, reason=None):
    if kind == "compute-programmes":
        _compute(closure, key, value)
        return True
    if kind not in ROOT_KINDS:
        return False
    prefix = _identity(closure, kind, key, value)
    {"receptor-networks": _network, "receptor-scenario-areas": _prepared,
     "receptor-programmes": _programme, "receptor-experiments": _experiment,
     "receptor-inventories": _inventory, "receptor-report-sources": _report}[kind](closure, key, value, prefix)
    return True


def _cas(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _companions(closure, entry):
    result = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in result:
            raise ValueError("The source geography report repeats a companion path")
        closure.add_file(item["object"], item)
        result[name] = item
    return result


def _entry_identity(entry):
    return {
        "id": entry["id"], "kind": entry["kind"], "uri": entry["uri"],
        "metadata": entry.get("metadata", {}),
        "body": {name: entry["body"][name] for name in ("bytes", "sha256")},
        "companions": {item.get("view_path", item["filename"]):
                       {name: item[name] for name in ("bytes", "sha256")}
                       for item in entry.get("companions", [])},
    }


def _map_members(closure, identity, recipe, members, product, prepared, summary):
    """Validate the original R9 map capture without loading a GIS renderer."""
    selected = identity["selection"]
    version = identity.get("version")
    if version == 1:
        if (selected.get("include_maps", False) or "native_map_runtime" in identity
                or "figure_spec" in recipe or "figures" in recipe
                or "projected_maps" in summary):
            raise ValueError("The original source report acquired another map edition")
        return set()
    runtime = identity.get("native_map_runtime")
    if (version != 2 or selected.get("include_maps") is not True
            or not isinstance(runtime, dict)
            or runtime.get("schema") != "upstate.receptor-map-runtime/v1"):
        raise ValueError("Retain the original declared source-map rendering edition")
    inventory_name = "figures/source-water-map-members.json"
    specification_name = "figures/source-water-map-spec.json"
    reader_name = "figures/original-geometry-reader.json"
    inventory = _cas(closure, members[inventory_name])
    chosen = set((prepared or {}).get("identity", {}).get(
        "receptor_ids", [area["id"] for area in product["areas"]]))
    ordered = [area["id"] for area in product["areas"] if area["id"] in chosen]
    expected_identity = {"network_id": product["id"],
                         "preparation_id": (prepared or {}).get("id"),
                         "receptor_ids": ordered,
                         "source_binding": product["source_binding"], "runtime": runtime}
    if (not ordered or len(ordered) != len(chosen)
            or inventory.get("schema") != "upstate.receptor-report-maps/v1"
            or inventory.get("identity") != expected_identity
            or inventory.get("figure_spec") != specification_name
            or recipe.get("figure_spec") != specification_name
            or summary.get("projected_maps") != inventory.get("summary")):
        raise ValueError("The saved projected maps differ from their original selected source areas")
    mapped = {}
    for item in inventory["files"]:
        name = _relative(item["path"])
        if name in mapped or name not in members or not _same(item, members[name]):
            raise ValueError("A retained projected-map companion changed")
        mapped[name] = item
    figures = inventory["figures"]
    if (not isinstance(figures, list) or not figures
            or recipe.get("figures") != [{key: item[key] for key in ("id", "path")}
                                         for item in figures]):
        raise ValueError("The saved report changed its ordered original map figures")
    source_names = set()
    for descriptor in runtime["source"]:
        name = "render-source/" + _relative(descriptor["path"])
        if name in source_names or name not in mapped or not _same(descriptor, mapped[name]):
            raise ValueError("The map capture lost its original renderer source")
        source_names.add(name)
    figure_names, figure_ids = set(), set()
    for figure in figures:
        name = _relative(figure["path"])
        if (not isinstance(figure["id"], str) or not figure["id"]
                or figure["id"] in figure_ids or name in figure_names
                or name != "figures/" + figure["id"] + ".svg"):
            raise ValueError("The saved map repeats or changes an original figure identity")
        figure_names.add(name)
        figure_ids.add(figure["id"])
    expected = source_names | figure_names | {specification_name, reader_name}
    if set(mapped) != expected or inventory_name in expected:
        raise ValueError("The source-map inventory is not the complete original rendering capture")
    specification = _cas(closure, members[specification_name])
    if (specification.get("schema") != "upstate.scientific-figure-spec/v1"
            or specification.get("edition") != "source-water-original-maps/1"
            or specification.get("rendering") != {
                "reportlab_version": runtime["libraries"]["reportlab"], "width_points": 511.2}
            or [(item["id"], item["title"], item["caption"])
                for item in specification.get("figures", [])] != [
                    (item["id"], item["title"], item["caption"]) for item in figures]):
        raise ValueError("The retained map specification differs from its original figure inventory")
    source = product["files"]["source_body"]
    original = {"path": "network/" + source["path"],
                "bytes": source["bytes"], "sha256": source["sha256"]}
    reader = _cas(closure, members[reader_name])
    if (reader.get("schema") != "upstate.receptor-map-original-reader/v1"
            or reader.get("original_source") != original
            or reader.get("source_binding") != product["source_binding"]
            or reader.get("runtime") != runtime):
        raise ValueError("The saved geometry interpretation lost its original source and runtime")
    return expected | {inventory_name}


def include_source(closure, collection_id, entry):
    """Follow only the declared original geography producer of a saved edition."""
    metadata = entry.get("metadata") or {}
    if metadata.get("source_scope") != SOURCE_SCOPE:
        return False
    recipe = _cas(closure, entry["body"])
    if (entry.get("kind") != "document" or metadata.get("report_schema") != REPORT_SCHEMA
            or recipe.get("schema") != REPORT_SCHEMA or recipe.get("source_scope") != SOURCE_SCOPE):
        raise ValueError("Source geography report differs from its declared original producer")
    members = _companions(closure, entry)
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("The source geography report lost its original declared inputs")
    requested = {}
    for item in inputs:
        name = _relative(item["path"])
        if name in requested or name not in members or not _same(item, members[name]):
            raise ValueError("A source geography input differs from its original companion")
        requested[name] = item
    if set(requested) | {"index.html"} != set(members) or "index.html" in requested:
        raise ValueError("The source geography report changed its complete original companion set")
    provenance = _cas(closure, members["provenance.json"])
    identity = provenance.get("identity")
    if not isinstance(identity, dict):
        raise ValueError("The source geography report lost its original identity")
    key = identifier(provenance.get("report_id"))
    selected = identity.get("selection") or {}
    network_id = identifier(selected.get("network_id"))
    prepared_id = selected.get("preparation_id")
    if prepared_id is not None:
        prepared_id = identifier(prepared_id)
    project = identity.get("workspace_id")
    if (provenance.get("schema") != "upstate.receptor-report-provenance/v1"
            or identity.get("schema") != SCHEMAS["receptor-report-sources"]
            or identity.get("version") not in (1, 2) or digest(identity) != key
            or not isinstance(project, str) or not project
            or entry.get("id") != "source-water-geography-" + key[:24]
            or entry.get("uri") != "urn:sha256:" + key
            or recipe.get("title") != selected.get("title")
            or provenance.get("network_id") != network_id
            or provenance.get("preparation_id") != prepared_id
            or metadata.get("network_result_id") != network_id
            or metadata.get("preparation_id") != prepared_id):
        raise ValueError("The source geography report changed its original selection")
    originals = identity.get("source_members")
    if not isinstance(originals, dict) or not set(originals) <= set(requested) - {"summary.json", "provenance.json"}:
        raise ValueError("The source geography report lost its exact original product inventory")
    for name, item in originals.items():
        if not _same(item, members[name]):
            raise ValueError("A source geography product member differs from the frozen original")
    if (not _same(identity["network_result"], members["network/result.json"])
            or (prepared_id is None) != (identity.get("prepared_result") is None)
            or prepared_id is not None and not _same(
                identity["prepared_result"], members.get("prepared/result.json"))):
        raise ValueError("The source geography report lost its exact original product records")
    network = _cas(closure, members["network/result.json"])
    if (network.get("schema") != SCHEMAS["receptor-networks"] or network.get("id") != network_id
            or digest(network.get("identity")) != network_id
            or network.get("source_binding") != provenance.get("original_source_binding")):
        raise ValueError("The captured original watershed network changed")
    prepared = _cas(closure, members["prepared/result.json"]) if prepared_id else None
    if prepared is not None and (
            prepared.get("schema") != SCHEMAS["receptor-scenario-areas"]
            or prepared.get("id") != prepared_id or digest(prepared.get("identity")) != prepared_id
            or prepared.get("workspace_id") != project
            or prepared.get("network_result_id") != network_id
            or prepared.get("source_binding") != network["source_binding"]):
        raise ValueError("The captured prepared areas differ from their original network")
    expected_members = set()
    for prefix, original in [("network", network)] + ([("prepared", prepared)] if prepared else []):
        expected_members.add(prefix + "/result.json")
        for item in original["files"].values():
            name = prefix + "/" + _relative(item["path"])
            if name not in members or not _same(item, members[name]):
                raise ValueError("The source report lost an original product member: " + name)
            expected_members.add(name)
    if expected_members != set(originals):
        raise ValueError("The source report's original product inventory changed")
    summary = _cas(closure, members["summary.json"])
    if (summary.get("schema") != "upstate.receptor-report-summary/v1"
            or summary.get("network_id") != network_id
            or summary.get("preparation_id") != prepared_id
            or summary.get("original_source_binding") != network["source_binding"]):
        raise ValueError("The retained source geography summary names another original network")
    map_members = _map_members(closure, identity, recipe, members, network, prepared, summary)
    if set(requested) != set(originals) | map_members | {"summary.json", "provenance.json"}:
        raise ValueError("The source geography report changed its complete original input inventory")
    local = project == closure.workspace.project["id"]
    required = []
    capture_sha = None
    original_choice = None
    if local:
        closure.need("receptor-report-sources", key, "Original editable source geography report")
        record_path = _prefix("receptor-report-sources", key) + "result.json"
        captured = closure.read(record_path)
        if (captured.get("schema") != SCHEMAS["receptor-report-sources"]
                or captured.get("id") != key or captured.get("identity") != identity
                or captured.get("workspace_id") != project or captured.get("state") != "complete"
                or captured.get("summary") != summary or captured.get("selection") != selected):
            raise ValueError("The selected report differs from its original saved producer")
        original_choice = captured["source_choice"]
        original_entry = _source(closure, original_choice["source_collection_id"],
                                 original_choice["source_id"], body=entry["body"])
        if _entry_identity(original_entry) != _entry_identity(entry):
            raise ValueError("The selected report is not an equivalent original source reimport")
        prefix = _prefix("receptor-report-sources", key)
        _files(closure, prefix, captured["files"])
        if (not _same(captured["files"]["recipe"], entry["body"])
                or _read_file(closure, prefix, captured["files"]["recipe"]) != recipe
                or _read_file(closure, prefix, captured["files"]["provenance"]) != provenance):
            raise ValueError("The selected source recipe differs from its original report capture")
        for name, descriptor in members.items():
            closure.add_file(prefix + name, descriptor)
        for kind, original in [("receptor-networks", network)] + (
                [("receptor-scenario-areas", prepared)] if prepared else []):
            closure.need(kind, original["id"], "Original editable source geography")
            if _record(closure, kind, original["id"]) != original:
                raise ValueError("The frozen report and editable original geography differ")
            required.append({"kind": kind, "id": original["id"]})
        required.append({"kind": "receptor-report-sources", "id": key})
        capture_sha = closure.files[record_path]["sha256"]
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "report_context_kind": "receptor-source-geography",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"], "source_project_id": project,
        "report_source_id": key, "network_result_id": network_id, "preparation_id": prepared_id,
        "capture_record_sha256": capture_sha, "capture_source": original_choice,
        "relationship": "same_project" if local else "external_project",
        "required_records": required,
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != binding:
        raise ValueError("The source geography binding changed during study selection")
    closure.report_source_records[token] = binding
    return True


def _candidates(closure, kind):
    folder = closure.root / kind
    if not folder.exists():
        return
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError("The retained watershed collection is not an original directory")
    for path in sorted(folder.glob("*/" + DOCUMENTS[kind])):
        try:
            identifier(path.parent.name)
        except ValueError:
            continue
        if path.is_symlink() or path.parent.is_symlink():
            raise ValueError("The retained watershed record contains a nonportable alias")
        try:
            value = read_json(path)
            if not isinstance(value, dict):
                raise ValueError("The original watershed record is unreadable")
        except (ValueError, OSError) as error:
            closure.related_issues.append({"path": path.relative_to(closure.root).as_posix(),
                                           "message": str(error)})
            continue
        yield path.parent.name, value


def related(closure):
    """Add original receiving-area continuations only to explicitly related exports."""
    networks = {key for kind, key in closure.nodes if kind == "receptor-networks"}
    prepared = {key for kind, key in closure.nodes if kind == "receptor-scenario-areas"}
    experiments = {key for kind, key in closure.nodes if kind == "experiments"}
    runs = {key for kind, key in closure.nodes if kind == "runs"}
    rules = (
        ("receptor-scenario-areas", lambda row: row.get("network_result_id") in networks),
        ("receptor-report-sources", lambda row: row.get("network_result_id") in networks
         and (row.get("preparation_id") is None or row.get("preparation_id") in prepared)),
        ("receptor-programmes", lambda row: row.get("preparation_id") in prepared),
        ("receptor-experiments", lambda row: row.get("experiment_id") in experiments),
        ("receptor-inventories", lambda row: row.get("baseline_run_id") in runs
         and bool(row.get("alternative_run_ids"))
         and set(row["alternative_run_ids"]).issubset(runs)),
    )
    for kind, selected in rules:
        for key, row in _candidates(closure, kind):
            if selected(row):
                closure.need(kind, key, "Related original source-water continuation")
    # This field is written by receptor_scenarios.save_scenario, not inferred
    # from arbitrary scenario labels, geometries or free-form metadata.
    folder = closure.root / "scenarios"
    for path in sorted(folder.glob("*.json")):
        try:
            key = identifier(path.stem)
        except ValueError:
            continue
        if path.is_symlink():
            raise ValueError("The retained scenario contains a nonportable alias")
        try:
            value = read_json(path)
            source = value.get("source_area_selection") or {}
            if not isinstance(source, dict):
                raise ValueError("The original scenario source-area selection is unreadable")
        except (ValueError, AttributeError, OSError) as error:
            closure.related_issues.append({"path": path.relative_to(closure.root).as_posix(),
                                           "message": str(error)})
            continue
        if source.get("preparation_id") in prepared:
            closure.need("scenarios", key, "Original land-cover design from the selected source areas")


def lock_paths(closure):
    result = set()
    for kind, key in closure.nodes:
        if kind in LOCKS:
            result.add(_prefix(kind, key) + LOCKS[kind])
        if kind == "compute-programmes":
            result.update(_prefix(kind, key) + name for name in (".execution.lock", ".control.lock"))
    return sorted(result)


def catalogue(workspace, kind):
    if kind not in ROOT_KINDS:
        return []
    root = Path(workspace.root).resolve()
    folder = root / kind
    if folder.is_symlink():
        raise ValueError("The source-water catalogue leaves its original workspace")
    result = []
    for path in sorted(folder.glob("*/result.json")):
        key = path.parent.name
        try:
            identifier(key)
        except ValueError:
            continue
        row = {"kind": kind, "id": key, "title": key[:12], "state": "unreadable",
               "updated_at": ""}
        try:
            if path.is_symlink() or path.parent.is_symlink():
                raise ValueError("The source-water catalogue record contains an alias")
            record = read_json(path)
            if record.get("schema") != SCHEMAS[kind] or record.get("id") != key:
                raise ValueError("The source-water catalogue record changed its identity")
            row.update(title=record.get("title") or key[:12],
                       state=record.get("state") or "complete",
                       updated_at=record.get("updated_at") or record.get("created_at") or "",
                       counts=record.get("counts"))
        except Exception as error:
            row["error"] = {"type": type(error).__name__, "message": str(error)}
        result.append(row)
    return result
