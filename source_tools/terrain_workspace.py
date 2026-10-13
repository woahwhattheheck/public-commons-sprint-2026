"""Additive bindings to the original Upper Savannah scientific Workspace."""
from __future__ import annotations
from pathlib import Path
from .terrain_io import TerrainError, describe, read_json, verify
from .terrain_prepare import plan, prepare, _plan


def plan_from_workspace(root, workspace, *, reference_collection_id, reference_source_id,
                        domain_collection_id, domain_source_id, domain_layer=None, domain_where=None,
                        source_ids=None, buffer_m=1000, title="Upper Savannah retained terrain", **options):
    """Reuse the original grid writer, source views, geometry and exact selection.

    `workspace` is the existing model.workspace.Workspace instance. No operator
    server or Workspace class is patched, and no replacement grid is introduced.
    """
    from .raster_sources import source_grid
    reference, reference_entry = workspace.source_file(reference_collection_id,reference_source_id)
    domain, domain_entry = workspace.source_file(domain_collection_id,domain_source_id)
    if reference_entry["kind"] != "raster" or domain_entry["kind"] != "vector":
        raise TerrainError("Select the existing numeric reference raster and model-domain vector")
    layer = domain_layer or domain_entry.get("layer")
    grid = source_grid(reference,domain,layer=layer,where=domain_where,buffer_m=buffer_m)
    source_reference = {"workspace_id":workspace.project["id"],
                        "reference":{"collection_id":reference_collection_id,"source_id":reference_source_id},
                        "domain":{"collection_id":domain_collection_id,"source_id":domain_source_id,
                                  "layer":layer,"where":domain_where},
                        "buffer_m":buffer_m,"grid_writer":"source_tools.raster_sources.source_grid"}
    return plan(root,grid,title=title,domain_path=domain,domain_layer=layer,domain_where=domain_where,
                source_ids=source_ids,reference_path=reference,source_reference=source_reference,**options)


def import_into_workspace(root,plan_id,workspace):
    """Import through the original source writer, reusing an identical prior import."""
    root = Path(root).resolve()
    _plan(root,plan_id)
    manifest = root/("sources-"+plan_id+".json")
    value = read_json(manifest)
    if value.get("schema") != "upstate.sources/v1":
        raise TerrainError("Select the completed native terrain source manifest")
    for entry in value["entries"]:
        for member in [entry]+entry.get("companions",[]):
            verify(root,member)
    stamp = describe(root,manifest)
    existing = [collection for collection in workspace.sources()
                if collection.get("original_manifest",{}).get("sha256") == stamp["sha256"]]
    if existing:
        collection = existing[0]
        reused = True
    else:
        collection = workspace.import_sources(manifest)
        reused = False
    # Open the native source view as part of receiving, checking original byte retention.
    selected_id = value["entries"][0]["id"]
    original, entry = workspace.source_file(collection["id"], selected_id)
    return {"source_collection_id":collection["id"], "source_id":selected_id,
            "path":str(original), "units":entry["units"], "plan_id":plan_id,"reused":reused}


def prepare_and_import(root,plan_id,workspace,*,progress=None):
    result = prepare(root,plan_id,progress=progress)
    if result["state"] != "complete":
        return result
    return {**result,"workspace_source":import_into_workspace(root,plan_id,workspace)}
