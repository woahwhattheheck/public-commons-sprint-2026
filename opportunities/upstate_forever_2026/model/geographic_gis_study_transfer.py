"""Carry completed reference GIS and execution history in selected native Studies.

This reader follows existing records only. It neither exports GIS nor receives
an archive, generates history, prepares a comparison, or executes a model.
"""
from __future__ import annotations

from pathlib import PurePosixPath

from .common import digest, identifier
from . import native_run_history as history

KIND = "geographic-gis-handovers"
SCHEMA = "upstate.geographic-reference-gis/v1"


def _member(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Retain the original portable GIS member path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != value:
        raise ValueError("The geographic GIS member leaves its original Workspace")
    return value


def matches(record, prepared):
    """Discover only records for this exact original geographic preparation."""
    if not isinstance(record, dict):
        return False
    identity = record.get("identity")
    binding = identity.get("geographic_binding") if isinstance(identity, dict) else None
    return (isinstance(binding, dict)
            and binding.get("geographic_id") == prepared["id"]
            and record.get("project_id") == prepared["project_id"])


def _descriptor(closure, descriptor, *, exact=None, prefix=None):
    if not isinstance(descriptor, dict):
        raise ValueError("The original reference handover lost a file descriptor")
    relative = _member(descriptor.get("path"))
    if exact is not None and relative != exact:
        raise ValueError("The reference handover changed its original member path")
    if prefix is not None and not relative.startswith(prefix + "/"):
        raise ValueError("The reference handover changed its original owned directory")
    closure.add_file(relative, descriptor)
    return relative


def _read(closure, descriptor, **scope):
    return closure.read(_descriptor(closure, descriptor, **scope))


def _same_run(current, frozen):
    return (current.get("id") == frozen.get("id")
            and current.get("state") == frozen.get("state") == "complete"
            and current.get("selection") == frozen.get("selection")
            and current.get("stages", {}).get("landcover") == frozen.get("stages", {}).get("landcover")
            and current.get("artifacts", {}) == frozen.get("artifacts", {}))


def _source(closure, choice):
    if not isinstance(choice, dict) or not isinstance(choice.get("source_id"), str):
        raise ValueError("Keep the original reference source pair")
    key = identifier(choice.get("source_collection_id"))
    collection = closure.read("sources/" + key + ".json")
    if collection.get("schema") != "upstate.sources/v1" or digest(collection) != key:
        raise ValueError("The reference GIS source edition changed")
    entries = [entry for entry in collection.get("entries", [])
               if entry.get("id") == choice["source_id"]]
    if len(entries) != 1:
        raise ValueError("The reference GIS lost its original source entry")
    closure.need("sources", key, "Original reference GIS source and all declared companions")
    return entries[0]


def include(closure, prepared, key):
    """Add the complete already-built reference export to this native closure."""
    key = identifier(key)
    prefix = KIND + "/" + key
    record = closure.read(prefix + "/record.json")
    identity = record.get("identity")
    ids = [prepared["baseline_run_id"], *prepared["alternative_run_ids"]]
    if (record.get("schema") != SCHEMA or record.get("id") != key
            or not matches(record, prepared) or not isinstance(identity, dict)
            or digest(identity) != key or identity.get("project_id") != prepared["project_id"]
            or record.get("reference_run_ids") != ids):
        raise ValueError("The saved GIS handover differs from this original reference trio")
    binding = identity["geographic_binding"]
    if (binding.get("project_id") != prepared["project_id"]
            or binding.get("grid_id") != prepared["grid_id"]
            or binding.get("profile_id") != prepared["profile_id"]
            or binding.get("source_collection_id") != prepared["source_collection_id"]
            or binding.get("run_ids") != ids
            or binding.get("scenario_ids") != [prepared["baseline_scenario_id"], *prepared["alternative_scenario_ids"]]):
        raise ValueError("The saved reference GIS changed its original native input binding")
    original_prefix = "geographic-headwaters/" + prepared["id"]
    if _read(closure, binding["prepared"], exact=original_prefix + "/prepared.json") != prepared:
        raise ValueError("The reference GIS preparation differs")
    _read(closure, binding["input_receipt"], exact=original_prefix + "/inputs/input-receipt.json")
    files = record.get("files")
    if not isinstance(files, dict):
        raise ValueError("The complete reference GIS file inventory is missing")
    context = _read(closure, files["context"], exact=prefix + "/reference-context.json")
    if (context.get("schema") != SCHEMA or context.get("id") != key
            or context.get("identity") != identity or context.get("prepared") != prepared
            or set(context.get("reference_runs", {})) != set(ids)
            or context.get("planned_study", {}).get("ensemble_id") != prepared["ensemble_id"]
            or context.get("planned_study", {}).get("selected_physical_run_ids") != ids):
        raise ValueError("The complete frozen reference GIS context changed")
    for run_id in ids:
        current = closure.read("runs/" + run_id + "/run.json")
        frozen = context["reference_runs"][run_id]
        if not _same_run(current, frozen):
            raise ValueError("A reference native output differs from its saved GIS context")
        closure.need("runs", run_id, "Original frozen reference GIS native output")

    comparison_id = identifier(record["comparison_id"])
    if identity.get("reference_basis", {}).get("comparison_id") != comparison_id:
        raise ValueError("The frozen reference GIS changed its original joint comparison")
    comparison_path = "comparisons/" + comparison_id + "/comparison.json"
    if "comparison" in identity:
        comparison = _read(closure, identity["comparison"], exact=comparison_path)
    else:
        # The original v1 record preceded the explicit joint descriptor. Its
        # complete frozen context still pins that original comparison body.
        comparison = closure.read(comparison_path)
    if (comparison != context.get("comparison")
            or comparison.get("baseline_run_id") != ids[0]
            or [row.get("run_id") for row in comparison.get("alternatives", [])] != ids[1:]):
        raise ValueError("The reference GIS lost its original ordered joint comparison")
    closure.need("comparisons", comparison_id, "Original three-run reference GIS comparison")

    delivery = _read(closure, identity["delivery"], prefix="deliveries")
    delivery_id = identifier(delivery.get("id"))
    if (identity["delivery"]["path"] != "deliveries/" + delivery_id + "/delivery-state.json"
            or delivery.get("state") != "complete"
            or delivery.get("selection", {}).get("baseline_run_id") != ids[0]
            or delivery.get("selection", {}).get("scenario_run_ids") != ids[1:]):
        raise ValueError("The reference GIS changed its original mapped delivery")
    closure.need("deliveries", delivery_id, "Original mapped reference delivery")

    history_id = identifier(record["history_id"])
    execution = history.inspect(closure.workspace, history_id)
    if (identity.get("history_id") != history_id or execution != context.get("history")
            or execution.get("selection", {}).get("run_ids") != ids):
        raise ValueError("The reference GIS execution history is not its exact frozen trio")
    history_prefix = history.ROOT + "/" + history_id
    if closure.read(history_prefix + "/report.json") != execution:
        raise ValueError("The original execution history changed during Study capture")
    for name, descriptor in execution["files"].items():
        if _member(name) != descriptor.get("path"):
            raise ValueError("The original history member lost its relative path")
        closure.add_file(history_prefix + "/" + name, descriptor)
    originals = closure.read(history_prefix + "/originals.json")
    if ([run.get("id") for run in originals.get("runs", [])] != ids
            or any(not _same_run(run, context["reference_runs"][run["id"]])
                   for run in originals["runs"])):
        raise ValueError("The frozen execution history and reference GIS select different outputs")
    closure.tree(history_prefix)

    exported = record.get("export")
    if (not isinstance(exported, dict) or exported.get("schema") != "upstate.gis-export/v1"
            or exported.get("state") != "complete"
            or exported.get("project_id") != prepared["project_id"]):
        raise ValueError("Keep the original completed reference GIS export")
    export_id = identifier(exported.get("id"))
    export_prefix = "gis-exports/" + export_id
    if closure.read(export_prefix + "/export.json") != exported:
        raise ValueError("The retained GIS export differs from its original handover")
    selection = closure.read(export_prefix + "/selection.json")
    if (selection.get("baseline_run_id") != ids[0] or selection.get("scenario_run_ids") != ids[1:]
            or selection.get("grid_id") != prepared["grid_id"]
            or selection.get("delivery_id") != delivery_id
            or selection.get("comparison_ids") != [comparison_id]):
        raise ValueError("The exported GIS changed its original reference selection")
    project_prefix = export_prefix + "/project"
    project = closure.read(project_prefix + "/project.json")
    inventory = closure.read(project_prefix + "/inventory.json")
    if (project.get("schema") != "upstate.editable-gis/v1"
            or project.get("selection_id") != export_id
            or project.get("provenance", {}).get("project_id") != prepared["project_id"]
            or digest({"request": project.get("source_request"),
                       "builder_version": project.get("builder_version")}) != export_id
            or inventory.get("schema") != "upstate.editable-gis/v1/inventory"
            or digest(inventory.get("files")) != inventory.get("fingerprint")
            or inventory.get("fingerprint") != exported.get("result", {}).get("fingerprint")):
        raise ValueError("The original editable GIS project or inventory changed")
    provenance = project.get("source_request", {}).get("provenance", {})
    if (project.get("provenance") != provenance
            or [row.get("id") for row in provenance.get("runs", [])] != ids
            or any(row.get("selection") != context["reference_runs"][row["id"]]["selection"]
                   for row in provenance["runs"])
            or provenance.get("grid_ids") != [prepared["grid_id"]]):
        raise ValueError("The editable GIS provenance changed its selected native inputs")
    physical = {}
    for layer in project.get("layers", []):
        if layer.get("source", {}).get("kind") != "original completed model artifact":
            continue
        pair = (layer.get("run_id"), layer.get("metric"))
        if pair in physical:
            raise ValueError("The editable GIS repeats a physical native quantity")
        physical[pair] = layer
    expected_artifacts = {
        (run_id, metric): artifact
        for run_id, run in context["reference_runs"].items()
        for metric, artifact in run.get("artifacts", {}).items()
        if PurePosixPath(artifact.get("path", "")).suffix.lower() in {".tif", ".tiff"}
    }
    if set(physical) != set(expected_artifacts):
        raise ValueError("The editable GIS lost a captured reference quantity")
    for pair, artifact in expected_artifacts.items():
        layer = physical[pair]
        original = (layer.get("originals") or [{}])[0]
        if (layer["source"].get("artifact") != artifact
                or layer.get("units") != artifact.get("units")
                or original.get("bytes") != artifact.get("bytes")
                or original.get("sha256") != artifact.get("sha256")):
            raise ValueError("The editable GIS changed a captured quantity or its units")
    names = set()
    for descriptor in inventory["files"]:
        name = _member(descriptor["path"])
        if name in names or name == "inventory.json":
            raise ValueError("The original GIS inventory repeats a member")
        names.add(name)
        closure.add_file(project_prefix + "/" + name, descriptor)
    closure.tree(project_prefix)
    expected = {project_prefix + "/" + name for name in names | {"inventory.json"}}
    if set(closure.trees[project_prefix]) != expected:
        raise ValueError("The editable reference GIS has missing or untracked members")
    _descriptor(closure, exported["archive"], exact=export_prefix + "/editable-gis.zip")
    if (files.get("editable_gis") != exported["archive"]
            or exported.get("open") != project_prefix + "/OPEN_GIS.html"
            or exported.get("project") != project_prefix + "/project.qgz"):
        raise ValueError("The reference GIS opening and archive paths changed")
    _descriptor(closure, files["offline_opening"], exact=exported["open"])
    _descriptor(closure, files["qgis_project"], exact=exported["project"])
    manifest = _read(closure, files["source_manifest"], exact=prefix + "/sources.json")
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Keep the original reference context source manifest")
    choices = {}
    for choice in selection.get("sources", []):
        entry = _source(closure, choice)
        pair = (choice["source_collection_id"], choice["source_id"])
        if pair in choices:
            raise ValueError("The reference GIS repeats an original selected source")
        choices[pair] = entry
    source_pairs = []
    for field in ("context_source", "history_source"):
        choice = record[field]
        pair = (choice["source_collection_id"], choice["source_id"])
        if pair not in choices:
            raise ValueError("The exported GIS omitted its original context or history source")
        source_pairs.append(pair)
    if (source_pairs[0][0] != source_pairs[1][0]
            or source_pairs[0][1] != "GEOGRAPHIC_REFERENCE_GIS_CONTEXT"
            or source_pairs[1][1] != "GEOGRAPHIC_REFERENCE_GIS_CONTEXT_HISTORY"):
        raise ValueError("The saved reference sources changed their original producer binding")
    for pair, original in zip(source_pairs, (files["context"], execution["files"]["index.html"])):
        if any(choices[pair].get("body", {}).get(field) != original[field]
               for field in ("bytes", "sha256")):
            raise ValueError("The selected context source differs from its frozen original body")
    declared = {entry.get("id"): entry for entry in manifest.get("entries", [])}
    if (len(declared) != 2 or len(manifest.get("entries", [])) != 2
            or set(declared) != {pair[1] for pair in source_pairs}):
        raise ValueError("The retained context manifest changed its original two entries")
    for pair, relative, original in (
            (source_pairs[0], "reference-context.json", files["context"]),
            (source_pairs[1], "history/index.html", execution["files"]["index.html"])):
        if (declared[pair[1]].get("path") != relative
                or declared[pair[1]].get("sha256") != original["sha256"]):
            raise ValueError("The original context manifest changed a captured source")
    expected_companions = [{"path": "history/" + name, "sha256": descriptor["sha256"]}
                           for name, descriptor in execution["files"].items() if name != "index.html"]
    if declared[source_pairs[1][1]].get("companions") != expected_companions:
        raise ValueError("The original history source lost its ordered companion closure")
    for name, descriptor in execution["files"].items():
        closure.add_file(prefix + "/history/" + name, descriptor)
    scientific = identity["scientific_source"]
    pair = (scientific["source_collection_id"], scientific["source_id"])
    if (pair not in choices
            or choices[pair].get("body", {}).get("sha256") != scientific.get("sha256")):
        raise ValueError("The GIS project changed its original scientific report source")
    closure.tree(prefix)
    closure.nodes.setdefault((KIND, key), {
        "kind": KIND, "id": key, "title": exported.get("title", key),
        "state": "complete", "reasons": ["Original completed reference GIS and frozen execution history"]})
    cache = getattr(closure, "geographic_gis_dependencies", None)
    if cache is None:
        cache = {}
        closure.geographic_gis_dependencies = cache
    cache[key] = {"history_id": history_id, "export_id": export_id}
    return record


def lock_paths(closure):
    """Join the original history and GIS owners during locked Study capture."""
    paths = set()
    for item in getattr(closure, "geographic_gis_dependencies", {}).values():
        paths.add(history.ROOT + "/" + item["history_id"] + "/.history.lock")
        paths.add("gis-exports/" + item["export_id"] + "/.project.lock")
    return sorted(paths)
