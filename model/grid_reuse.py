"""Extend a retained model grid using its exact original common preparations."""
from __future__ import annotations
from .common import digest
from .model_selection import required_roles
from .reuse import copy_verified, native_companions


def source_identity(workspace, collection_id, source_id):
    _, entry = workspace.source_file(collection_id, source_id)
    def body(value):
        return {"bytes": value["bytes"], "sha256": value["sha256"],
                "view_path": value.get("view_path", value["filename"])}
    return {
        "kind": entry["kind"], "body": body(entry["body"]),
        "companions": sorted((body(value) for value in entry["companions"]),
                             key=lambda value: value["view_path"]),
        "layer": entry.get("layer"), "units": entry.get("units"),
        "conversion": entry.get("conversion"), "resampling": entry.get("resampling"),
    }


def geometry_identity(workspace, spec, name):
    selection = spec[name]
    return {"source": source_identity(workspace, spec["source_collection_id"],
                                      selection["source_id"]),
            "layer": selection.get("layer"),
            "where": selection.get("where")}


def retain_grid_definition(workspace, spec, definition):
    """Keep an explicitly selected grid's identity across description changes."""
    base_id = spec.get("base_grid_id")
    if not base_id:
        return definition
    original = workspace.get_grid(base_id)["grid"]
    def identity(value):
        retained = dict(value)
        retained.pop("reference_alignment", None)
        normalization = dict(retained["reference_normalization"])
        normalization.pop("method", None)
        retained["reference_normalization"] = normalization
        return retained
    # All numeric fields, source provenance and unknown future fields remain
    # part of this comparison. Geometry, buffer and source guards still apply
    # in reuse_grid_inputs before any original preparation is copied.
    if digest(identity(original)) == digest(identity(definition)):
        return original
    return definition


def reuse_grid_inputs(workspace, state, directory, selected_models):
    """Return the same state with byte-identical available inputs carried forward.

    Selecting base_grid_id is explicit. A different source/filter, model domain,
    reporting area, buffer or grid cannot silently inherit the older preparation.
    The source collection itself may be a new edition containing added inputs.
    """
    spec = state["spec"]
    base_id = spec.get("base_grid_id")
    if not base_id:
        return state
    if base_id == state["id"]:
        raise ValueError("A grid cannot extend itself")
    original = workspace.get_grid(base_id)
    old_spec = original["spec"]
    if (digest(original["grid"]) != digest(state["grid"])
            or float(old_spec["upstream_buffer_m"]) != float(spec["upstream_buffer_m"])):
        raise ValueError("Grid extension requires the original exact grid and context buffer")
    for name in ("reporting_area", "model_domain"):
        if digest(geometry_identity(workspace, old_spec, name)) != digest(
                geometry_identity(workspace, spec, name)):
            raise ValueError("Grid extension changes the original " + name + " source selection")
    old_directory = workspace.root / "grids" / base_id
    reused = dict(state.get("reused_inputs", {}))
    for name in ("model_domain", "reporting_area", "reporting_mask"):
        if name not in original["files"]:
            raise ValueError("Original grid lacks its complete " + name)
        if name not in state["files"]:
            state["files"][name] = copy_verified(old_directory, original["files"][name], directory)
            reused[name] = {"grid_id": base_id, "path": original["files"][name]["path"],
                            "sha256": original["files"][name]["sha256"]}
    for role in required_roles(selected_models):
        if role in state["files"] or role not in original["files"]:
            continue
        old_source = old_spec["input_sources"].get(role)
        new_source = spec["input_sources"].get(role)
        if old_source is None or new_source is None:
            continue
        old_identity = source_identity(workspace, old_spec["source_collection_id"], old_source)
        new_identity = source_identity(workspace, spec["source_collection_id"], new_source)
        if digest(old_identity) != digest(new_identity):
            continue
        state["files"][role] = copy_verified(old_directory, original["files"][role], directory)
        companions = native_companions(old_directory, {role: original["files"][role]})
        if companions:
            state.setdefault("input_companions", {})[role] = [
                copy_verified(old_directory, item, directory) for item in companions]
        _, entry = workspace.source_file(spec["source_collection_id"], new_source)
        state["inputs"][role] = {
            **original["inputs"][role], "source_id": entry["id"],
            "source_sha256": entry["body"]["sha256"], "source_uri": entry["uri"],
            "vintage": entry["vintage"], "reused_from_grid": base_id,
            "original_source_collection_id": old_spec["source_collection_id"],
            "original_source_id": old_source,
        }
        reused[role] = {"grid_id": base_id, "path": original["files"][role]["path"],
                        "sha256": original["files"][role]["sha256"]}
    state["reused_inputs"] = reused
    return state
