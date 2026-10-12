#!/usr/bin/env python3
"""Operate the retained four-feature ArcGIS customer through the GIS application."""
from __future__ import annotations

import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import traceback
import urllib.request
import uuid


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package",required=True,help="Original SF88 Python package directory from this checkout")
    parser.add_argument("--original-workspace",required=True,help="Original closed/guarded four-feature ArcGIS customer")
    parser.add_argument("--operation-dir",required=True)
    parser.add_argument("--spatial-extension",required=True,help="Installed signed spatial extension matching DuckDB1.5.6")
    parser.add_argument("--chromium",help="Continue the same completed customer in an existing Chromium runtime")
    parser.add_argument("--node",help="Existing Node executable for browser continuation")
    parser.add_argument("--playwright",help="Existing Playwright index.js for browser continuation")
    args=parser.parse_args()
    package=Path(args.package).resolve(strict=True)
    original=Path(args.original_workspace).resolve(strict=True)
    operation=Path(args.operation_dir).resolve()
    operation.mkdir(mode=0o700,parents=True,exist_ok=True)
    sys.path.insert(0,str(package))
    from stellar_forge_buyer.duckdb_dataset import DuckDBWorkspace
    from stellar_forge_buyer.duckdb_spatial import DuckDBSpatial
    from stellar_forge_buyer.duckdb_http import serve
    from stellar_forge_buyer.duckdb_agent import copy_sparse
    from stellar_forge_buyer.storage import lock,dump,digest,private_directory
    result_file=operation/"native-gis-result.json"
    def finish_browser():
        if not args.chromium:return 0
        command=[sys.executable,"-B",str(Path(__file__).with_name("native_spatial_browser.py")),
                 "--operation-dir",str(operation),"--chromium",args.chromium]
        if args.node:command += ["--node",args.node]
        if args.playwright:command += ["--playwright",args.playwright]
        try:
            receiving=subprocess.run(command,capture_output=True,text=True,timeout=300)
            if receiving.stdout:print(receiving.stdout,flush=True)
            if receiving.stderr:print(receiving.stderr,file=sys.stderr,flush=True)
            return receiving.returncode
        except Exception as error:
            print(json.dumps({"state":"BROWSER_INTERRUPTED","native_result":str(result_file),
                              "detail":str(error)}),flush=True)
            return 1
    source_files={}
    for module in sorted((package/"stellar_forge_buyer").glob("*.py")):
        raw=module.read_bytes()
        source_files[str(module.relative_to(package))]=hashlib.sha1(
            b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
    result={"schema":"stellar-forge.duckdb-gis.native-operation.v1","operation":"SCF-DUCKDB-GIS-CUSTOMER-5EEE-20261012",
            "started_at":datetime.now(timezone.utc).isoformat(),"original_workspace":str(original),
            "package":str(package),"extension":str(Path(args.spatial_extension).resolve()),"stages":[]}
    if result_file.exists():
        previous=json.loads(result_file.read_text())
        if previous.get("operation")!=result["operation"] or previous.get("original_workspace")!=str(original):
            raise RuntimeError("Native operation destination belongs to another source")
        result=previous
        if result.get("state")=="COMPLETE":
            print(json.dumps({"state":"REUSED_COMPLETE_NATIVE","result":str(result_file)}),flush=True)
            return finish_browser()
    revisions=result.setdefault("source_revisions",[])
    if not revisions or revisions[-1]["files"]!=source_files:
        revisions.append({"at":datetime.now(timezone.utc).isoformat(),"files":source_files})
    completed={s["name"]:s["value"] for s in result["stages"]}
    def reuse(name,operation):
        if name in completed:return completed[name]
        return stage(name,operation())
    def stage(name,value):
        result["stages"].append({"name":name,"value":value})
        dump(result_file,result)
        print(json.dumps({"stage":name,"complete":True}),flush=True)
        return value
    def hash_file(path):
        with open(path,"rb") as stream:return hashlib.file_digest(stream,"sha256").hexdigest()
    def check(condition,message):
        if not condition:raise AssertionError(message)
    server=None
    try:
        workspace_dir=private_directory(operation/"customer")
        if not (workspace_dir/"warehouse.duckdb").exists():
            with lock(original):
                check(not (original/"warehouse.duckdb.wal").exists(),"Original warehouse has an active WAL; finish its current operation first")
                original_hash=hash_file(original/"warehouse.duckdb")
                with open(original/"warehouse.duckdb","rb") as source,open(workspace_dir/"warehouse.duckdb","xb") as destination:
                    copy_sparse(source,destination,1024*1024)
                    destination.flush();os.fsync(destination.fileno())
                os.chmod(workspace_dir/"warehouse.duckdb",0o600)
                check(hash_file(workspace_dir/"warehouse.duckdb")==original_hash,"Original warehouse copy changed")
                dump(operation/"original-source.json",{"original_workspace":str(original),"warehouse_sha256":original_hash})
        stage("original-source",json.loads((operation/"original-source.json").read_text()))
        workspace=DuckDBWorkspace(workspace_dir,memory_limit="64MB",threads=1)
        gis=DuckDBSpatial(workspace,extension_path=args.spatial_extension)
        runtime=stage("native-spatial-runtime",gis.runtime())
        check(runtime["duckdb"]=="1.5.6","Operate the exact1.5.6 runtime")
        editions=workspace.editions(limit=100)["editions"]
        candidates=[e for e in editions if e["row_count"]==4 and {"GEOID","geometry_json","spatial_reference_json"}.issubset({c["name"] for c in e["columns"]})]
        check(len(candidates)>=1,"The original four-feature ArcGIS edition is required")
        edition=sorted(candidates,key=lambda e:e["sequence"])[0]
        stage("original-edition",edition)
        review=stage("review-geometry",gis.review_layer(edition["edition_id"],geometry_column="geometry_json",
            source_format="esri-json",crs="EPSG:3857",spatial_reference_column="spatial_reference_json",
            geometry_type="esriGeometryPolygon",keys=["object_id"]))
        check(review["row_count"]==4 and review["source_spatial_reference"]["latestWkid"]==3857,"Original CRS and rows")
        check(review["coordinate_count"]>0 and review["transformation"] is None,"Original coordinates retained")
        check(gis.review_layer(edition["edition_id"],geometry_column="geometry_json",source_format="esri-json",
            crs="EPSG:3857",spatial_reference_column="spatial_reference_json",geometry_type="esriGeometryPolygon",
            keys=["object_id"])==review,"Same review must reopen")
        layer=stage("adopt-layer",gis.adopt_layer(review["review_id"]))
        check(gis.adopt_layer(review["review_id"])==layer,"Layer adoption is idempotent")
        prior=next((v for v in gis.status()["bindings"]["layers"] if v["name"]=="current_map"),None)
        stage("activate-layer",gis.activate("current_map",layer["layer_id"],expected_revision=prior["revision"] if prior else 0))
        stage("original-native-map",gis.preview(layer["layer_id"]))
        area=stage("projected-area",gis.query("SELECT object_id,GEOID,ST_Area(ST_Transform(geometry,'EPSG:5070')) AS area_m2 FROM current_map ORDER BY object_id"))
        check(len(area["rows"])==4 and all(row[2]>0 for row in area["rows"]),"Native projected polygon areas")
        extent=review["extent"]
        bounds=[extent[0],extent[1],(extent[0]+extent[2])/2,extent[3]]
        selection=stage("spatial-selection",gis.query("SELECT object_id,GEOID FROM current_map WHERE ST_Intersects(geometry,ST_SetCRS(ST_MakeEnvelope(?,?,?,?),'EPSG:3857')) ORDER BY object_id",bounds))
        sql="SELECT * FROM current_map ORDER BY object_id"
        existing=next((q for q in gis.status()["queries"] if q["name"]=="arcgis_original_gis"),None)
        saved=reuse("save-gis-query",lambda:gis.save_query("arcgis_original_gis",sql,expected_revision=existing["revision"] if existing else 0))
        preview=reuse("spatial-query-preview",lambda:gis.query(sql))
        export=stage("original-crs-gis-export",gis.export_query(saved["query_id"],operation/"exports"/"original",
            expected_revision=saved["revision"],expected_bindings=preview["bindings"]))
        check(export["rows"]==4 and export["receiving"]["state"]=="COMPLETE","Original GeoPackage/GeoParquet receiving")
        check(all(export["receiving"][key]==0 for key in ("parquet_minus_gpkg","gpkg_minus_parquet")),"Exact two-way native receiving")
        original_files={f["name"]:(f["bytes"],f["sha256"]) for f in export["files"]}
        revised=reuse("save-query-revision",lambda:gis.save_query("arcgis_original_gis","SELECT * FROM current_map WHERE object_id=-1",expected_revision=saved["revision"]))
        reused=stage("reopen-original-export",gis.export_query(saved["query_id"],operation/"exports"/"original",expected_revision=saved["revision"]))
        check(original_files=={f["name"]:(f["bytes"],f["sha256"]) for f in reused["files"]},"Original saved file bytes after SQL revision")
        transformed_query=reuse("save-geographic-query",lambda:gis.save_query("arcgis_geographic",sql,expected_revision=0))
        transformed=stage("reprojected-gis-export",gis.export_query(transformed_query["query_id"],operation/"exports"/"geographic",
            expected_revision=transformed_query["revision"],target_crs="EPSG:4326"))
        check(transformed["transformation"]=={"source":"EPSG:3857","target":"EPSG:4326"},"Actual CRS transformation recorded")
        empty_query=reuse("save-empty-query",lambda:gis.save_query("arcgis_empty","SELECT * FROM current_map WHERE false",expected_revision=0))
        empty=stage("empty-typed-gis-export",gis.export_query(empty_query["query_id"],operation/"exports"/"empty",expected_revision=empty_query["revision"]))
        check(empty["rows"]==0 and empty["crs"]=="EPSG:3857","Empty GIS layer preserves schema/CRS")
        if len(candidates)>1:
            second=sorted(candidates,key=lambda e:e["sequence"])[1]
            next_review=gis.review_layer(second["edition_id"],geometry_column="geometry_json",source_format="esri-json",
                crs="EPSG:3857",spatial_reference_column="spatial_reference_json",geometry_type="esriGeometryPolygon",keys=["object_id"])
            next_layer=gis.adopt_layer(next_review["review_id"])
            active=next(v for v in gis.status()["bindings"]["layers"] if v["name"]=="current_map")
            stage("second-mapping-active-layer",gis.activate("current_map",next_layer["layer_id"],expected_revision=active["revision"]))
            old=gis.export_query(saved["query_id"],operation/"exports"/"original",expected_revision=saved["revision"])
            check(original_files=={f["name"]:(f["bytes"],f["sha256"]) for f in old["files"]},"Original export after layer revision")
        stage("portable-workspace",workspace.backup(operation/"portable"))
        workspace.close()
        receiver=DuckDBWorkspace(operation/"portable",memory_limit="64MB",threads=1)
        receiver_gis=DuckDBSpatial(receiver,extension_path=args.spatial_extension)
        stage("portable-layer-reopen",receiver_gis.status())
        stage("portable-spatial-query",receiver_gis.query("SELECT count(*) FROM current_map"))
        independent=DuckDBWorkspace(operation/"independent",memory_limit="64MB",threads=1)
        stage("independent-gis-receiving",DuckDBSpatial(independent,extension_path=args.spatial_extension).receive_files(operation/"exports"/"original"))
        independent.close()
        env=dict(os.environ,PYTHONPATH=str(package),PYTHONDONTWRITEBYTECODE="1")
        cli=subprocess.run([sys.executable,"-B","-m","stellar_forge_buyer.duckdb_cli","--workspace",str(operation/"portable"),
             "--spatial-extension",args.spatial_extension,"spatial","query","--sql","SELECT count(*) FROM current_map"],
             env=env,capture_output=True,text=True,timeout=60)
        check(cli.returncode==0,cli.stderr)
        stage("installed-cli",json.loads(cli.stdout))
        server,control,url=serve(receiver,spatial_extension=args.spatial_extension,
                                 export_root=operation/"http-exports",handoff_root=operation/"http-handoffs")
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base,token=url.split("#")
        def request(path,body=None):
            headers={"X-DuckDB-Capability":token}
            data=None if body is None else json.dumps(body).encode()
            if body is not None:headers["Content-Type"]="application/json"
            with urllib.request.urlopen(urllib.request.Request(base.rstrip("/")+path,data=data,headers=headers),timeout=90) as response:
                raw=response.read();return response.status,response.headers.get_content_type(),raw
        code,mime,raw=request("/api/spatial/state")
        check(code==200 and len(json.loads(raw)["layers"])>=1,"HTTP GIS state")
        stage("http-spatial-query",json.loads(request("/api/spatial/query",{"sql":"SELECT count(*) FROM current_map"})[2]))
        for asset in ("/","/app.js","/spatial.js","/style.css"):
            code,mime,raw=request(asset);check(code==200 and len(raw)>100,"Complete original UI asset "+asset)
        # Original export descriptors are in the portable DB; its exact exported files remain in this operation.
        for file in export["files"]:
            if file["name"] in {"result.gpkg","result.parquet"}:
                path="/api/exports/"+export["export_id"]+"/file?name="+file["name"]
                code,mime,raw=request(path);check(code==200 and digest(raw)==file["sha256"],"Exact HTTP GIS file "+file["name"])
        stage("http-gis-downloads",{"files":["result.gpkg","result.parquet"],"complete":True})
        # Browser continuation uses this same operated workspace and host-selected extension.
        dump(operation/"browser-continuation.json",{"package":str(package),"workspace":str(operation/"portable"),
             "spatial_extension":args.spatial_extension,"layer_id":layer["layer_id"],"query_id":saved["query_id"],
             "export_id":export["export_id"],"source_result":str(result_file)})
        server.shutdown();server.server_close();thread.join(timeout=5);server=None;receiver.close()
        result.pop("error",None)
        result.update(state="COMPLETE",completed_at=datetime.now(timezone.utc).isoformat())
        dump(result_file,result);print(json.dumps({"state":"COMPLETE","result":str(result_file),"stages":len(result["stages"])}),flush=True)
        return finish_browser()
    except BaseException as exc:
        result.update(state="INTERRUPTED",error={"type":type(exc).__name__,"code":getattr(exc,"code",None),
                      "detail":str(exc),"traceback":traceback.format_exc()},updated_at=datetime.now(timezone.utc).isoformat())
        try:dump(result_file,result)
        except Exception:pass
        print(json.dumps({"state":"INTERRUPTED","result":str(result_file),"error":result["error"]}),flush=True)
        return 1
    finally:
        if server is not None:
            server.shutdown();server.server_close()


if __name__=="__main__":
    raise SystemExit(main())
