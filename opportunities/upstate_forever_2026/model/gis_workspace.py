"""Original Workspace -> explicit editable GIS request; no replacement scientific engine."""
from __future__ import annotations

from pathlib import Path
from . import gis_project as gis


def _artifact(workspace, directory, item):
    """Translate the original describe_file contract without altering its identity."""
    path = gis.checked(directory, item)
    result = {"path": path.relative_to(workspace.root).as_posix(),
              "bytes": item["bytes"], "sha256": item["sha256"]}
    return result


def _raster_companions(workspace, item):
    import rasterio
    result = []
    primary = gis.local(workspace.root, item["path"])
    with rasterio.open(primary) as src:
        for filename in src.files:
            p = Path(filename).resolve(strict=True)
            if p == primary:
                continue
            if not p.is_relative_to(workspace.root):
                raise ValueError("Raster companion is outside the retained Workspace")
            result.append(gis.record(workspace.root, p))
    return result


def source_layer(workspace, selection: dict) -> dict:
    collection = selection["source_collection_id"]
    source_id = selection["source_id"]
    path, entry = workspace.source_file(collection, source_id)
    native = Path(entry["body"].get("view_path", entry["body"]["filename"]))
    view = path
    for _ in native.parts:
        view = view.parent
    primary = gis.record(workspace.root, path)
    if primary["sha256"] != entry["body"]["sha256"] or primary["bytes"] != entry["body"]["bytes"]:
        raise ValueError("Original source view identity differs")
    companions = []
    for body in entry.get("companions", []):
        p = view / body.get("view_path", body["filename"])
        rec = gis.record(workspace.root, p)
        if rec["sha256"] != body["sha256"] or rec["bytes"] != body["bytes"]:
            raise ValueError("Original source companion identity differs")
        companions.append(rec)
    row = {"id": selection.get("id", "source:"+collection+":"+source_id),
           "title": selection.get("title", entry["title"]), "kind": entry["kind"],
           "file": primary, "companions": companions,
           "group": selection.get("group", "Original source layers"),
           "units": selection.get("units", entry.get("units", "source attributes")),
           "purpose": selection.get("purpose", "categorical" if entry.get("role") == "NLCD" else "context"),
           "source": {"collection_id": collection, "id": source_id, "title": entry["title"],
                      "uri": entry["uri"], "vintage": entry["vintage"],
                      "sha256": entry["body"]["sha256"], "role": entry.get("role"),
                      "units": entry.get("units"), "conversion": entry.get("conversion")},
           "visible": selection.get("visible", False)}
    for key in ("layer", "where", "band", "metric", "direction"):
        if key in selection:
            row[key] = selection[key]
        elif key == "layer" and entry.get("layer"):
            row[key] = entry["layer"]
    return row


def request(workspace, selection: dict) -> dict:
    """Select retained source editions, prepared grids and completed run artifacts.

    A source-only selection is fully usable before model execution. A selected run
    must be complete. No invented native-stage unit mappings are supplied here.
    """
    layers, attachments, grid_ids, run_ids = [], [], [], []
    source_selections = list(selection.get("sources", []))
    collection_id = selection.get("source_collection_id")
    if collection_id and not source_selections:
        source_selections = [{"source_collection_id": collection_id, "source_id": e["id"]}
                             for e in workspace._get("sources", collection_id)["entries"]]
    source_selections = [{**item, "source_collection_id": item.get("source_collection_id") or collection_id}
                         for item in source_selections]
    for item in source_selections:
        if not item["source_collection_id"]:
            raise ValueError("Select the retained source collection for every source")
        row = source_layer(workspace, item)
        (layers if row["kind"] in {"vector", "raster"} else attachments).append(row)
    if selection.get("grid_id"):
        grid_ids.append(selection["grid_id"])
    if selection.get("baseline_run_id"):
        run_ids.append(selection["baseline_run_id"])
    run_ids.extend(selection.get("scenario_run_ids", []))
    if len(set(run_ids)) != len(run_ids):
        raise ValueError("Select each retained run once")
    runs = []
    for index, run_id in enumerate(run_ids):
        state = workspace.inspect_run(run_id)
        if state["state"] != "complete":
            raise ValueError("Finish the selected run before including its physical results: "+run_id)
        case = workspace._get("scenarios", state["selection"]["scenario_id"])
        profile = workspace._get("profiles", state["selection"]["profile_id"])
        run_directory = workspace.root / "runs" / run_id
        prefix = "Baseline" if index == 0 and selection.get("baseline_run_id") else "Case"
        for metric, item in state["artifacts"].items():
            if Path(item["path"]).suffix.lower() not in {".tif", ".tiff"}:
                continue
            if not item.get("units"):
                raise ValueError("Retained model artifact lacks declared physical units: "+metric)
            rec = _artifact(workspace, run_directory, item)
            layers.append({"id":"run:"+run_id+":"+metric,
                           "title":metric.replace("_", " ").capitalize()+" · "+case["title"],
                           "kind":"raster", "file":rec, "companions":_raster_companions(workspace, rec),
                           "group":prefix+" · "+case["title"]+" · "+run_id[:10],
                           "purpose":"physical", "metric":metric, "units":item["units"],
                           "run_id":run_id, "scenario_id":case["id"], "profile_id":profile["id"],
                           "visible":index == 0 and metric == "nitrogen_export",
                           "source":{"kind":"original completed model artifact", "artifact":item,
                                     "run_selection":state["selection"], "runtime":state.get("runtime", {}),
                                     "scenario":case, "profile":profile}})
        if "landcover" in state.get("stages", {}):
            item=state["stages"]["landcover"]["artifact"]
            rec=_artifact(workspace,run_directory,item)
            layers.append({"id":"scenario-landcover:"+run_id,"title":"Land cover · "+case["title"],
                           "kind":"raster","file":rec,"companions":_raster_companions(workspace,rec),
                           "group":prefix+" · "+case["title"]+" · "+run_id[:10],
                           "purpose":"categorical","units":item.get("units","class"),
                           "scenario_id":case["id"],"run_id":run_id,"visible":False})
        grid_ids.append(state["selection"]["grid_id"])
        runs.append({"id":run_id,"selection":state["selection"],"scenario_title":case["title"],
                     "profile_title":profile["title"],"runtime":state.get("runtime",{})})
    grids=[]
    for grid_id in dict.fromkeys(grid_ids):
        grid=workspace.get_grid(grid_id)
        grids.append(grid)
        if not selection.get("include_grid", True):
            continue
        directory=workspace.root/"grids"/grid_id
        for role,item in grid["files"].items():
            ext=Path(item["path"]).suffix.lower()
            if ext not in {".tif",".tiff",".gpkg"}:
                continue
            rec=_artifact(workspace,directory,item)
            kind="vector" if ext==".gpkg" else "raster"
            row={"id":"grid:"+grid_id+":"+role,"title":role.replace("_"," ").capitalize(),
                 "kind":kind,"file":rec,"group":"Prepared study grid · "+grid_id[:10],
                 "units":item.get("units","source geometry" if kind=="vector" else None),
                 "purpose":"categorical" if role in {"NLCD","reporting_mask"} else "context",
                 "source":{"kind":"original prepared grid","grid_id":grid_id,"role":role,
                           "input":grid.get("inputs",{}).get(role),"spec":grid["spec"]},
                 "visible":role=="reporting_area"}
            if kind=="raster":
                row["companions"]=_raster_companions(workspace,rec)
            else:
                row["layer"]=role
            layers.append(row)
    # Explicit existing comparison results: preserve their actual sign convention.
    for comparison_id in selection.get("comparison_ids", []):
        if not isinstance(comparison_id,str) or not __import__('re').fullmatch(r"[0-9a-f]{64}",comparison_id):
            raise ValueError("Select a retained comparison identity")
        directory=workspace.root/"comparisons"/comparison_id
        comparison=gis.load(directory/"comparison.json")
        if comparison["id"]!=comparison_id:
            raise ValueError("Comparison identity differs")
        for alternative in comparison["alternatives"]:
            for metric,item in alternative["artifacts"].items():
                rec=_artifact(workspace,directory,item)
                layers.append({"id":"comparison:"+comparison_id+":"+alternative["run_id"]+":"+metric,
                    "title":metric.replace("_"," ").capitalize()+" change · "+alternative["run_id"][:10],
                    "kind":"raster","file":rec,"companions":_raster_companions(workspace,rec),
                    "group":"Signed changes · "+comparison_id[:10],"purpose":"difference",
                    "metric":metric,"units":item["units"],"direction":comparison["direction"],
                    "run_id":alternative["run_id"],"profile_id":alternative["selection"]["profile_id"],
                    "scenario_id":alternative["selection"]["scenario_id"],"visible":False,
                    "source":{"comparison_id":comparison_id,"baseline_run_id":comparison["baseline_run_id"],
                              "profile_changed":alternative.get("profile_changed")}})
    if not layers:
        raise ValueError("Choose actual source layers, a prepared grid or completed runs")
    project_crs=selection.get("project_crs")
    if not project_crs and grids:
        # Read the real retained reference rather than assuming a grid-JSON spelling.
        import rasterio
        grid=grids[0]
        path=gis.checked(workspace.root/"grids"/grid["id"],grid["files"]["NLCD"])
        with rasterio.open(path) as src:
            project_crs=src.crs.to_string()
    if not project_crs:
        raise ValueError("Select the GIS project's display CRS for a source-only handover")
    focus=selection.get("focus_layer_id")
    if not focus:
        focus=next((l["id"] for l in layers if l["id"].endswith(":reporting_area")),None)
    if not any(l.get("visible") for l in layers):
        layers[0]["visible"]=True
    result={"schema":gis.REQUEST_SCHEMA,"title":selection.get("title",workspace.project["title"]+" · editable GIS"),
            "project_crs":project_crs,"layers":layers,"attachments":attachments,
            "provenance":{"project_id":workspace.project["id"],"project_title":workspace.project["title"],
                          "runs":runs,"grid_ids":list(dict.fromkeys(grid_ids)),
                          "source_collection_ids":list(dict.fromkeys(x["source_collection_id"] for x in source_selections)),
                          "notes":selection.get("notes",[])}}
    if focus:
        result["focus_layer_id"]=focus
    return result


def export(workspace, selection: dict, *, progress=None) -> dict:
    spec=request(workspace,selection)
    key=gis.fingerprint({"request":spec,"builder_version":gis.VERSION})
    folder=workspace.root/"gis-exports"/key
    folder.mkdir(parents=True,exist_ok=True)
    gis.save(folder/"selection.json",selection)
    result=gis.build(spec,workspace.root,folder/"project",progress=progress)
    archive=gis.pack(folder/"project",folder/"editable-gis.zip")
    value={"schema":"upstate.gis-export/v1","id":key,"state":"complete",
           "project_id":workspace.project["id"],"title":spec["title"],"result":result,
           "archive":gis.record(workspace.root,folder/"editable-gis.zip"),
           "open":(folder/"project"/"OPEN_GIS.html").relative_to(workspace.root).as_posix(),
           "project":(folder/"project"/"project.qgz").relative_to(workspace.root).as_posix()}
    gis.save(folder/"export.json",value)
    return value


def catalogue(workspace) -> dict:
    """Small, direct operator inventory; no complete source objects on every refresh."""
    sources=[]
    for collection in workspace.sources():
        sources.append({"id":collection["id"],"title":collection["title"],
                        "entries":[{k:e.get(k) for k in ("id","title","kind","role","units")}
                                   for e in collection["entries"]]})
    runs=[]
    for path in sorted((workspace.root/"runs").glob("*/run.json")):
        r=gis.load(path)
        runs.append({"id":r["id"],"state":r["state"],"selection":r["selection"],
                     "artifacts":[{"id":k,"units":v.get("units")} for k,v in r.get("artifacts",{}).items()]})
    exports=[gis.load(p) for p in sorted((workspace.root/"gis-exports").glob("*/export.json"))]
    return {"schema":"upstate.gis-catalogue/v1","project_id":workspace.project["id"],
            "sources":sources,"runs":runs,"exports":exports}
