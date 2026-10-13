"""Original Workspace -> explicit editable GIS request; no replacement scientific engine."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from . import gis_project as gis


SOURCE_METADATA_FIELDS = (
    "provenance", "webmap_source", "scientific_metadata", "geography_basis",
    "original_fields", "field_vintages", "format", "columns", "column_units",
    "source_format", "source_crs", "encoding", "decoded_bytes", "decoded_sha256",
    "community_metadata",
)


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
           "purpose": selection.get("purpose", entry.get("purpose") or ("categorical" if entry.get("role") == "NLCD" else "context")),
           "source": {"collection_id": collection, "id": source_id, "title": entry["title"],
                      "uri": entry["uri"], "vintage": entry["vintage"],
                      "sha256": entry["body"]["sha256"], "role": entry.get("role"),
                      "units": entry.get("units"), "conversion": entry.get("conversion"),
                      "received_gis":entry.get("received_gis")},
           "visible": selection.get("visible", False)}
    # Keep explicit scientific metadata with the portable originals and working layer.
    # These are the retained source's own values, not inferred units or geography.
    for key in SOURCE_METADATA_FIELDS:
        if key in entry:
            row["source"][key] = deepcopy(entry[key])
    for key in ("layer", "where", "band", "metric", "direction"):
        if key in selection:
            row[key] = selection[key]
        elif key in ("layer", "metric", "direction") and entry.get(key) is not None:
            row[key] = entry[key]
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
    # Adopted working layers always retain their attached originals, licences and
    # edition provenance, including when the operator selected only GIS layers.
    selected_pairs={(x["source_collection_id"],x["source_id"]) for x in source_selections}
    for cid in dict.fromkeys(x["source_collection_id"] for x in source_selections):
        if not cid:continue
        collection=workspace._get("sources",cid)
        context_groups={e.get("gis_context_group") for e in collection["entries"]
                        if (cid,e["id"]) in selected_pairs and e.get("gis_context_group")}
        for entry in collection["entries"]:
            if entry.get("gis_required_context") and entry.get("gis_context_group") in context_groups and (cid,entry["id"]) not in selected_pairs:
                source_selections.append({"source_collection_id":cid,"source_id":entry["id"]})
                selected_pairs.add((cid,entry["id"]))
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
                        "entries":[{k:e.get(k) for k in ("id","title","kind","role","units","gis_context_group","gis_required_context")}
                                   for e in collection["entries"]]})
    runs=[]
    for path in sorted((workspace.root/"runs").glob("*/run.json")):
        r=gis.load(path)
        runs.append({"id":r["id"],"state":r["state"],"selection":r["selection"],
                     "artifacts":[{"id":k,"units":v.get("units")} for k,v in r.get("artifacts",{}).items()]})
    exports=[gis.load(p) for p in sorted((workspace.root/"gis-exports").glob("*/export.json"))]
    return {"schema":"upstate.gis-catalogue/v1","project_id":workspace.project["id"],
            "sources":sources,"runs":runs,"exports":exports}


def received(workspace, receipt_id: str):
    """Read the original retained receiving record and its complete unchanged edition."""
    from .common import identifier
    parent=workspace.root/'gis-received'/identifier(receipt_id)
    value=gis.load(parent/'receipt.json')
    if value.get('id')!=receipt_id or value.get('project_id')!=workspace.project['id'] or value.get('state')!='complete':
        raise ValueError('Choose a complete GIS receiving from this scientific Workspace')
    result=gis.verify(parent/'project')
    if result['fingerprint']!=value['result']['fingerprint']:
        raise ValueError('Receive the newly sealed edition before adopting edited GIS files')
    return parent,value,result


def receive(workspace, archive: str | Path, *, source_upload_id: str | None=None) -> dict:
    """One receiving writer for the original Operator and the installed Workspace CLI."""
    import json
    import zipfile
    archive=Path(archive).resolve(strict=True)
    original=gis.record(archive.parent,archive)
    key=gis.fingerprint({'schema':'upstate.gis-receiving/v1','project_id':workspace.project['id'],
                         'archive_sha256':original['sha256']})
    parent=workspace.root/'gis-received'/key
    parent.mkdir(parents=True,exist_ok=True)
    root=parent/'project'
    with gis.locked(parent/'.receiving.lock'):
        if root.exists():
            result=gis.verify(root)
            with zipfile.ZipFile(archive) as z:
                incoming=json.loads(z.read('inventory.json'))
            if incoming['fingerprint']!=result['fingerprint']:
                raise ValueError('The received directory differs from the supplied GIS edition')
        else:
            result=gis.receive(archive,root)
        target=parent/'editable-gis.zip'
        gis.copy_checked(archive.parent,original,target)
        value={'schema':'upstate.gis-receiving/v1','id':key,'state':'complete',
               'project_id':workspace.project['id'],'title':gis.load(root/'project.json')['title'],
               'result':result,'archive':gis.record(workspace.root,target),
               'source_archive_sha256':original['sha256']}
        receipt=parent/'receipt.json'
        if receipt.exists():
            prior=gis.load(receipt)
            if prior.get('source_archive_sha256')!=original['sha256']:
                raise ValueError('The existing receiving belongs to another archive')
            if prior.get('upload_id'):value['upload_id']=prior['upload_id']
        if source_upload_id and 'upload_id' not in value:value['upload_id']=source_upload_id
        gis.save(receipt,value)
        return value


def adopt_sources(workspace, selection: dict) -> dict:
    """Adopt selected received working layers through the ORIGINAL source importer.

    This appends an independent source edition; it does not edit any original
    source collection, grid, parameter profile, scenario, numerical run or receipt.
    """
    parent,receipt,result=received(workspace,selection['receipt_id'])
    root=parent/'project';project=gis.load(root/'project.json')
    reason=selection.get('reason','').strip()
    title=selection.get('title','').strip()
    if not reason or not title:
        raise ValueError('Name the new source edition and explain the adoption')
    chosen=selection.get('layer_ids')
    if not isinstance(chosen,list) or not chosen or len(set(chosen))!=len(chosen) or any(not isinstance(x,str) for x in chosen):
        raise ValueError('Choose each received working layer once')
    byid={l['id']:l for l in project['layers']}
    if set(chosen)-set(byid):raise ValueError('Choose existing received layer identities')
    adopted={'schema':'upstate.gis-source-adoption-selection/v1','adopter_version':gis.VERSION,
             'project_id':workspace.project['id'],'receipt_id':receipt['id'],
             'received_edition_id':project['edition_id'],'fingerprint':result['fingerprint'],
             'title':title,'reason':reason,'layer_ids':chosen}
    key=gis.fingerprint(adopted)
    directory=workspace.root/'gis-source-adoptions'/key
    directory.mkdir(parents=True,exist_ok=True)
    with gis.locked(directory/'.adoption.lock'):
        state=directory/'adoption.json'
        if state.exists():
            prior=gis.load(state)
            if prior['selection']!=adopted:raise ValueError('Source adoption selection changed')
            collection=workspace._get('sources',prior['source_collection_id'])
            for entry in collection['entries']:workspace.source_file(collection['id'],entry['id'])
            return prior
        # Keep source paths relative to the existing receipt parent. Original
        # Workspace.import_sources performs its normal complete object retention.
        entries=[]
        for layer_id in chosen:
            row=byid[layer_id];path=gis.local(root,row['working_path'])
            data=row['data'];companions=[]
            if data['kind']=='raster':
                import rasterio
                with rasterio.open(path) as src:
                    for filename in src.files:
                        p=Path(filename).resolve(strict=True)
                        if p==path:continue
                        rec=gis.record(root,gis.local(root,p.relative_to(root).as_posix()))
                        companions.append({'path':'project/'+rec['path'],'sha256':rec['sha256']})
            entry={'id':'GIS_'+row['key'],'title':row['title'],'kind':data['kind'],
                   'path':'project/'+row['working_path'],'sha256':gis.sha256(path),'companions':companions,
                   'gis_context_group':key,
                   'uri':'urn:upstate:received-gis:'+receipt['id']+':'+row['key'],
                   'vintage':'Received GIS edition '+project['edition_id'],'units':data['units'],
                   'received_gis':{'receipt_id':receipt['id'],'edition_id':project['edition_id'],
                                   'layer_id':row['id'],'originals':row['originals'],
                                   'source':row.get('source'),'run_id':row.get('run_id'),
                                   'scenario_id':row.get('scenario_id'),'profile_id':row.get('profile_id'),
                                   'purpose':row.get('purpose'),'metric':row.get('metric'),
                                   'direction':row.get('direction'),'adoption_id':key,'reason':reason}}
            for name in ('purpose','metric','direction'):
                if row.get(name) is not None:entry[name]=row[name]
            original_source=row.get('source') or {}
            for name in ('role','conversion'):
                if original_source.get(name) is not None:entry[name]=original_source[name]
            if data['kind']=='vector':entry['layer']=data['layer']
            entries.append(entry)
        seen_context=set()
        def context(title, records, *, context_id, context_role, metadata=None, source=None):
            metadata = deepcopy(metadata or {"kind": "document"})
            source = deepcopy(source or {})
            kind = metadata["kind"]
            if kind not in {"table", "document"}:
                raise ValueError("Retained GIS context must be a table or document")
            if not records:
                raise ValueError("Retained GIS context has no original primary file")
            # Logical source identity is independent of shared content bytes.
            # A generic layer original cannot suppress a typed table attachment.
            signature = {"context_id": context_id, "role": context_role,
                         "metadata": metadata, "source": source,
                         "files": [{"path": row["path"], "bytes": row["bytes"],
                                    "sha256": row["sha256"],
                                    "source_path": row.get("source_path")} for row in records]}
            code=gis.fingerprint(signature)
            if code in seen_context:return
            seen_context.add(code)
            for rec in records:gis.checked(root,rec)
            entry={'id':'GIS_CONTEXT_'+code,'title':title,'kind':kind,
                   'path':'project/'+records[0]['path'],'sha256':records[0]['sha256'],
                   'companions':[{'path':'project/'+r['path'],'sha256':r['sha256']} for r in records[1:]],
                   'uri':source.get('uri') or 'urn:upstate:received-gis:'+receipt['id']+':context:'+code,
                   'vintage':source.get('vintage') or 'Received GIS edition '+project['edition_id'],
                   'gis_context_group':key,'gis_required_context':True,
                   'received_gis':{'receipt_id':receipt['id'],'edition_id':project['edition_id'],
                                   'context_id':context_id,'context_role':context_role,
                                   'originals':deepcopy(records),'source':source,
                                   'adoption_id':key,'reason':reason}}
            if kind == 'table':
                for name in SOURCE_METADATA_FIELDS:
                    # Related Web Map IDs still name the original collection.
                    # Keep that complete relationship under received_gis.source.
                    if name != 'webmap_source' and name in source:
                        entry[name] = deepcopy(source[name])
                for name in ('role','conversion'):
                    if name in source:
                        entry[name] = deepcopy(source[name])
                if 'units' in metadata:
                    entry['units'] = deepcopy(metadata['units'])
            entries.append(entry)
        for layer_id in chosen:
            layer = byid[layer_id]
            context('Retained originals · '+layer['title'],layer['originals'],
                    context_id=layer_id,context_role='layer_originals',source=layer.get('source'))
        for document in project.get('attachments',[]):
            context(document['title'],document['files'],
                    context_id=document['id'],context_role='attachment',
                    metadata=gis.attachment_metadata(project,document),source=document.get('source'))
        history=[gis.record(root,p) for p in sorted((root/'history').rglob('*')) if p.is_file()]
        context('Received GIS edition provenance and retained history',
                [gis.record(root,root/'project.json'),*history],
                context_id=project['edition_id'],context_role='edition_history')
        manifest={'schema':'upstate.sources/v1','title':title,'entries':entries,
                  'notes':[reason,'Selected independently editable working layers adopted from a complete received GIS edition.'],
                  'scope':{'gis_source_adoption':adopted}}
        manifest_path=parent/('source-adoption-'+key+'.json')
        if manifest_path.exists() and gis.load(manifest_path)!=manifest:
            raise ValueError('The retained adoption manifest changed')
        gis.save(manifest_path,manifest)
        collection=workspace.import_sources(manifest_path)
        value={'schema':'upstate.gis-source-adoption/v1','id':key,'state':'complete',
               'project_id':workspace.project['id'],'selection':adopted,
               'source_collection_id':collection['id'],'title':title,
               'sources':[{'layer_id':layer_id,'source_id':'GIS_'+byid[layer_id]['key']}
                          for layer_id in chosen],
               'manifest':gis.record(workspace.root,manifest_path)}
        gis.save(state,value)
        return value
