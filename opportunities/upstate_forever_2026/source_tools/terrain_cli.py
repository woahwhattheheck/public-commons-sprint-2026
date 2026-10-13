"""USGS static terrain: discover → acquire/adopt → prepare → import/receive."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from . import terrain_catalog as catalog
from . import terrain_prepare as preparation
from . import terrain_portable as portable
from .terrain_io import TerrainError, read_json


def _workspace(path, create=False):
    from model.workspace import Workspace
    return Workspace(path, create=create)


def _prepared_summary(value):
    if value.get("state") != "complete":
        return value
    entry = value["entry"]
    return {"state":value["state"], "plan_id":value["plan_id"], "manifest":value["manifest"],
            "source_entry":"source-entry-"+value["plan_id"]+".json", "source_id":entry["id"],
            "dem":{k:entry[k] for k in ("path","bytes","sha256","units","vertical_datum")},
            "observed":entry["observed"], "inspector":"prepared/"+value["plan_id"]+"/inspector/report.html",
            "reused":value.get("reused",False), "workspace_source":value.get("workspace_source")}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", help="Independent retained terrain source directory")
    parser.add_argument("--debug", action="store_true")
    commands = parser.add_subparsers(dest="command", required=True)
    d = commands.add_parser("discover",help="Read complete original USGS directory listings")
    extent = d.add_mutually_exclusive_group(required=True)
    extent.add_argument("--bounds",type=float,nargs=4,metavar=("WEST","SOUTH","EAST","NORTH"))
    extent.add_argument("--domain",help="Original complete model-domain vector")
    d.add_argument("--layer")
    d.add_argument("--where-json")
    d.add_argument("--buffer-m",type=float,default=1000)
    d.add_argument("--buffer-crs",default="EPSG:5070",help="Metre CRS for discovery buffer only; never the model grid")
    d.add_argument("--title",default="USGS 3DEP original static source edition")
    a = commands.add_parser("acquire",help="Download retained catalog members with prefix recovery")
    a.add_argument("catalog")
    a.add_argument("--workers",type=int,default=2)
    a = commands.add_parser("adopt",help="Receive an existing complete original or documented crop")
    for name in ("raster","metadata","origin","label"):
        a.add_argument("--"+name,required=True)
    for name in ("vintage","units","datum","unit-reference","derivation"):
        a.add_argument("--"+name)
    a.add_argument("--companion",action="append",default=[])
    p = commands.add_parser("plan",help="Freeze a source selection on the original exact 30m grid")
    origin = p.add_mutually_exclusive_group(required=True)
    origin.add_argument("--grid-json")
    origin.add_argument("--reference",help="Actual original 30m numeric reference; with domain uses original grid writer")
    p.add_argument("--domain")
    p.add_argument("--layer")
    p.add_argument("--where-json")
    p.add_argument("--buffer-m",type=float,default=1000)
    p.add_argument("--source-id",action="append")
    p.add_argument("--title",default="Upper Savannah retained terrain")
    p.add_argument("--resampling",choices=("bilinear","nearest","average"),default="bilinear")
    p.add_argument("--chunk-size",type=int,default=1024)
    w = commands.add_parser("plan-workspace",help="Reuse original Workspace source views and grid writer")
    for name in ("workspace","reference-collection-id","reference-source-id","domain-collection-id","domain-source-id"):
        w.add_argument("--"+name,required=True)
    w.add_argument("--domain-layer")
    w.add_argument("--where-json")
    w.add_argument("--source-id",action="append")
    w.add_argument("--buffer-m",type=float,default=1000)
    w.add_argument("--title",default="Upper Savannah retained terrain")
    w.add_argument("--resampling",choices=("bilinear","nearest","average"),default="bilinear")
    w.add_argument("--chunk-size",type=int,default=1024)
    for action in ("prepare","resume"):
        run = commands.add_parser(action)
        run.add_argument("plan_id")
        run.add_argument("--workspace",help="Also import complete terrain into this existing native Workspace")
        run.add_argument("--progress",action="store_true",help="Emit chunk progress as JSON to stderr")
    for action in ("pause","status"):
        commands.add_parser(action).add_argument("plan_id")
    commands.add_parser("list")
    pack = commands.add_parser("pack")
    pack.add_argument("plan_id")
    pack.add_argument("--output",required=True)
    receive = commands.add_parser("receive")
    receive.add_argument("archive")
    receive.add_argument("--output",required=True)
    receive.add_argument("--sha256")
    native = commands.add_parser("import")
    native.add_argument("plan_id")
    native.add_argument("--workspace",required=True)
    native.add_argument("--create-workspace",action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command != "receive" and not args.store:
            parser.error("--store is required for this command")
        root = Path(args.store).resolve() if args.store else None
        if args.command == "discover":
            bounds, reference = args.bounds, None
            if args.domain:
                import math
                from pyproj import CRS,Transformer
                from shapely.ops import transform
                from .terrain_io import file_sha
                crs = CRS.from_user_input(args.buffer_crs)
                if (not crs.is_projected or any(abs(axis.unit_conversion_factor-1)>1e-12 for axis in crs.axis_info[:2])
                        or not math.isfinite(args.buffer_m) or args.buffer_m < 0):
                    raise TerrainError("Discovery needs a projected metre buffer CRS and nonnegative buffer")
                domain, metadata = preparation.read_geometry(args.domain,crs,layer=args.layer,
                                                             where=read_json(args.where_json) if args.where_json else None)
                projected = domain.buffer(args.buffer_m)
                geographic = transform(Transformer.from_crs(crs,"EPSG:4326",always_xy=True).transform,projected)
                bounds = list(geographic.bounds)
                reference = {"domain_sha256":file_sha(args.domain),"features":metadata["features"],
                             "layer":args.layer,"where":read_json(args.where_json) if args.where_json else None,
                             "buffer_m":args.buffer_m,"buffer_crs":crs.to_wkt()}
            result = catalog.discover(root,bounds,title=args.title,source_reference=reference)
            result = {key:result[key] for key in ("id","catalog_path","bounds_wgs84","tiles")}
        elif args.command == "acquire":
            result = catalog.acquire(root,args.catalog,workers=args.workers)
        elif args.command == "adopt":
            value = catalog.adopt(root,args.raster,args.metadata,origin=args.origin,label=args.label,
                                  vintage=args.vintage,units=args.units,datum=args.datum,unit_reference=args.unit_reference,
                                  companions=args.companion,derivation=read_json(args.derivation) if args.derivation else None)
            result = {key:value[key] for key in ("id","uri","vintage","raster","files","vertical_units","vertical_datum")}
        elif args.command == "plan":
            where = read_json(args.where_json) if args.where_json else None
            if args.grid_json:
                grid = read_json(args.grid_json)
                grid = grid.get("grid",grid)
            elif args.domain:
                from .raster_sources import source_grid
                grid = source_grid(args.reference,args.domain,layer=args.layer,where=where,buffer_m=args.buffer_m)
            else:
                grid = preparation.reference_grid(args.reference)
            value = preparation.plan(root,grid,source_ids=args.source_id,title=args.title,
                                     domain_path=args.domain,domain_layer=args.layer,domain_where=where,
                                     reference_path=args.reference,resampling=args.resampling,chunk_size=args.chunk_size)
            result = {"plan_id":value["id"],"grid":value["grid"],"source_ids":value["source_ids"],
                      "domain_features":value["domain"]["features"] if value["domain"] else None}
        elif args.command == "plan-workspace":
            from .terrain_workspace import plan_from_workspace
            value = plan_from_workspace(root,_workspace(args.workspace),reference_collection_id=args.reference_collection_id,
                    reference_source_id=args.reference_source_id,domain_collection_id=args.domain_collection_id,
                    domain_source_id=args.domain_source_id,domain_layer=args.domain_layer,
                    domain_where=read_json(args.where_json) if args.where_json else None,source_ids=args.source_id,
                    title=args.title,buffer_m=args.buffer_m,resampling=args.resampling,chunk_size=args.chunk_size)
            result = {"plan_id":value["id"],"grid":value["grid"],"source_ids":value["source_ids"]}
        elif args.command in ("prepare","resume"):
            if args.command == "resume":
                preparation.pause(root,args.plan_id,resume=True)
            callback = (lambda state: print(json.dumps(state,sort_keys=True),file=sys.stderr,flush=True)) if args.progress else None
            if args.workspace:
                from .terrain_workspace import prepare_and_import
                value = prepare_and_import(root,args.plan_id,_workspace(args.workspace),progress=callback)
            else:
                value = preparation.prepare(root,args.plan_id,progress=callback)
            result = _prepared_summary(value)
        elif args.command == "pause":
            result = preparation.pause(root,args.plan_id)
        elif args.command == "status":
            selection = preparation._plan(root,args.plan_id)
            path = root/"jobs"/("prepare-"+args.plan_id+".json")
            result = read_json(path) if path.exists() else {"plan_id":args.plan_id,"state":"planned"}
            result = {**result,"title":selection["title"],"source_count":len(selection["source_ids"]),
                      "pause_requested":(root/"jobs"/("prepare-"+args.plan_id+".pause.json")).exists()}
            # Portable receiving omits transient jobs but retains completed outputs.
            if (root/("source-entry-"+args.plan_id+".json")).exists():
                result.update(state="complete",manifest="sources-"+args.plan_id+".json")
        elif args.command == "list":
            result = {"sources":[{key:item[key] for key in ("id","label","vintage","vertical_units","vertical_datum")}
                                 for item in catalog.sources(root,check=False)],
                      "plans":[{"plan_id":path.stem,"title":read_json(path)["title"]}
                               for path in sorted((root/"plans").glob("*.json"))]}
        elif args.command == "pack":
            result = portable.pack(root,args.plan_id,args.output)
        elif args.command == "receive":
            result = portable.receive(args.archive,args.output,expected_sha256=args.sha256)
        elif args.command == "import":
            from .terrain_workspace import import_into_workspace
            result = import_into_workspace(root,args.plan_id,_workspace(args.workspace,args.create_workspace))
        print(json.dumps(result,sort_keys=True,indent=2,allow_nan=False))
        return 0
    except Exception as error:
        if args.debug:
            raise
        print(json.dumps({"state":"error","type":type(error).__name__,"message":str(error)},sort_keys=True),file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
