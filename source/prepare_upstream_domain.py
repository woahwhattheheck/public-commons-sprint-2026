#!/usr/bin/env python3
"""Compose the selected native Upper Savannah hydrologic domain from retained WBD responses."""
from __future__ import annotations
import argparse, errno, gzip, hashlib, json, os, pathlib, shutil, tempfile, zipfile
from decimal import Decimal
from capture_upstream_network import exact_write, encode, digest

SOURCE_ID = "upstate-wbd-upstream-domain-20261012"

def exact_json(value):
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, Decimal):
        if not value.is_finite(): raise ValueError("Nonfinite original number")
        return str(value)
    if type(value) is int: return str(value)
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list): return "[" + ",".join(exact_json(x) for x in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(x, str) for x in value): raise ValueError("Non-string object key")
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + exact_json(v) for k,v in value.items()) + "}"
    raise TypeError("Unsupported original JSON value: " + type(value).__name__)

def parsed(body):
    def bad(value): raise ValueError("Nonfinite original JSON value: " + value)
    return json.loads(body, parse_float=Decimal, parse_constant=bad)

def safe_relative(value):
    p=pathlib.PurePosixPath(value)
    if not value or p.is_absolute() or ".." in p.parts or "\\" in value:
        raise ValueError("Unsafe retained source path")
    return p

def same_crs(left,right):
    def key(v): return v.get("latestWkid",v.get("wkid")) if isinstance(v,dict) else None
    return key(left) is not None and key(left)==key(right)

def retain(source,destination,expected):
    body=source.read_bytes()
    if len(body)!=expected["bytes"] or digest(body)!=expected["sha256"]:
        raise ValueError("Original source changed: "+str(source))
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.exists():
        if destination.read_bytes()!=body: raise ValueError("Another retained source owns "+str(destination))
        return
    try: os.link(source,destination)
    except OSError as error:
        if error.errno!=errno.EXDEV: raise
        exact_write(destination,body)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--capture",required=True)
    p.add_argument("--capture-sha256",required=True)
    p.add_argument("--output",required=True)
    args=p.parse_args()
    root=pathlib.Path(args.capture).absolute()
    output=pathlib.Path(args.output).absolute()
    original=root/"capture.json"
    original_bytes=original.read_bytes()
    if digest(original_bytes)!=args.capture_sha256: raise ValueError("Use the reviewed original WBD capture")
    capture=json.loads(original_bytes)
    if capture.get("schema")!="upstate.wbd-network-capture/v1": raise ValueError("Unsupported original capture")
    files={}
    for item in capture["files"]:
        name=str(safe_relative(item["path"]))
        if name in files: raise ValueError("Duplicate original member")
        body=(root/name).read_bytes()
        if len(body)!=item["bytes"] or digest(body)!=item["sha256"]: raise ValueError("Changed original member: "+name)
        files[name]=item
    files["capture.json"]={"path":"capture.json","bytes":len(original_bytes),"sha256":digest(original_bytes)}
    selection=json.loads((root/str(safe_relative(capture["selection_file"]))).read_bytes())
    topology=json.loads((root/str(safe_relative(capture["topology_file"]))).read_bytes())
    if selection.get("schema")!="upstate.wbd-upstream-selection/v1": raise ValueError("Unsupported original selection")
    rows=selection["selected_huc12"]
    if len(rows)!=selection["model_huc12_count"] or len({r["huc12"] for r in rows})!=len(rows):
        raise ValueError("Selected HUC12 identities are not unique")
    oid,huc,tohuc=topology["object_id_field"],topology["huc12_field"],topology["tohuc_field"]
    topology_rows={str(x["object_id"]):x["attributes"] for x in topology["records"]}
    response_cache={}
    features=[];bindings=[];fields=None;crs=None;flags={}
    xmin=ymin=xmax=ymax=None
    for row in rows:
        locator=row["geometry"];name=str(safe_relative(locator["file"]))
        if name not in files: raise ValueError("Geometry locator is outside the retained capture")
        if name not in response_cache:
            stored=(root/name).read_bytes()
            raw=gzip.decompress(stored) if name.endswith(".gz") else stored
            page=parsed(raw)
            if page.get("geometryType")!="esriGeometryPolygon": raise ValueError("Expected original native polygon geometry")
            if not same_crs(page.get("spatialReference"),selection["source_crs"]): raise ValueError("Original CRS differs")
            response_cache[name]=(page,digest(raw),len(raw))
        page,raw_hash,raw_size=response_cache[name]
        if type(locator["feature_index"]) is not int or locator["feature_index"]<0: raise ValueError("Invalid original feature index")
        feature=page["features"][locator["feature_index"]]
        attributes=feature["attributes"]
        original_row=topology_rows[str(row["object_id"])]
        if (str(attributes[oid])!=str(row["object_id"]) or str(attributes[huc])!=row["huc12"]
                or str(attributes[tohuc])!=row["tohuc"]
                or str(original_row[huc])!=row["huc12"]
                or str(original_row[tohuc])!=row["tohuc"]):
            raise ValueError("The native feature does not match its original topology selection")
        if fields is None:
            fields=page["fields"];crs=page["spatialReference"]
        elif [(f["name"],f["type"]) for f in page["fields"]]!=[(f["name"],f["type"]) for f in fields]:
            raise ValueError("Native page field contracts differ")
        for key in ("hasZ","hasM"):
            if key in page and page[key] is not None:
                if key in flags and flags[key]!=page[key]: raise ValueError("Native coordinate flags differ")
                flags[key]=page[key]
        for ring in feature["geometry"].get("rings",[]):
            for point in ring:
                x,y=point[:2]
                xmin=x if xmin is None or x<xmin else xmin
                xmax=x if xmax is None or x>xmax else xmax
                ymin=y if ymin is None or y<ymin else ymin
                ymax=y if ymax is None or y>ymax else ymax
        features.append(feature)
        bindings.append({"huc12":row["huc12"],"object_id":row["object_id"],"tohuc":row["tohuc"],
            "feature_index":len(features)-1,"original_feature_index":locator["feature_index"],
            "original_body":"original-wbd/"+name,"original_stored_sha256":files[name]["sha256"],
            "original_decoded_sha256":raw_hash,"original_decoded_bytes":raw_size,
            "captured_at":locator["captured_at"],"intersects_reporting_area":row["intersects_reporting_area"],
            "upstream_ancestor":row["upstream_ancestor"]})
    body=(exact_json({"objectIdFieldName":oid,"geometryType":"esriGeometryPolygon","spatialReference":crs,
                      "fields":fields,**flags,"features":features})+"\n").encode("utf-8")
    packed=gzip.compress(body,mtime=0)
    output.mkdir(parents=True,exist_ok=True)
    exact_write(output/"model-domain.esri.json.gz",packed)
    for name,item in sorted(files.items()):
        retain(root/name,output/"original-wbd"/name,item)
    original_timestamp=max(r["captured_at"] for r in capture["responses"])
    binding_record={"schema":"upstate.wbd-domain-bindings/v1","source_id":SOURCE_ID,
        "original_capture_sha256":digest(original_bytes),"selection_sha256":files[capture["selection_file"]]["sha256"],
        "selected_huc12":[r["huc12"] for r in rows],"feature_count":len(features),
        "native_object_id_field":oid,"native_huc12_field":huc,"native_tohuc_field":tohuc,
        "geometry_method":"Select complete original native Esri features by the reviewed HUC12/OBJECTID/ToHUC and source-body feature index; no coordinate reprojection, clipping, union or simplification.",
        "number_method":"Original noninteger JSON tokens are parsed as Decimal and serialized as exact decimal numbers.",
        "features":bindings}
    exact_write(output/"feature-bindings.json",encode(binding_record))
    summary={"schema":"upstate.wbd-domain-summary/v1","source_id":SOURCE_ID,"feature_count":len(features),
        "source_crs":selection["source_crs"],"native_bounds":json.loads(exact_json([xmin,ymin,xmax,ymax])),
        "reporting_intersections":selection["reporting_intersection_count"],
        "upstream_ancestors":sum(bool(r["upstream_ancestor"]) for r in rows),
        "original_context_geometry_count":selection["captured_geometry_count"],
        "topology_record_count":selection["all_topology_record_count"],
        "huc8_counts":dict(sorted(__import__("collections").Counter(r["huc12"][:8] for r in rows).items())),
        "reporting_source":selection["reporting_source"],"captured_at":original_timestamp,
        "source_capture_sha256":digest(original_bytes)}
    exact_write(output/"domain-summary.json",encode(summary))
    for source in (pathlib.Path(__file__),pathlib.Path(__file__).with_name("capture_upstream_network.py")):
        exact_write(output/"methods"/source.name,source.read_bytes())
    companions=[]
    for target in sorted(output.rglob("*")):
        if target.is_file() and target.relative_to(output).as_posix() not in ("sources.json","model-domain.esri.json.gz","delivery.json"):
            raw=target.read_bytes();companions.append({"path":target.relative_to(output).as_posix(),"sha256":digest(raw),"bytes":len(raw)})
    wkid=selection["source_crs"].get("latestWkid",selection["source_crs"].get("wkid"))
    source_manifest={"schema":"upstate.sources/v1","title":"Selected original Upper Savannah upstream model domain",
        "captured_at":original_timestamp,"scope":{"source_id":SOURCE_ID,"selected_huc12":len(features),
            "reporting_source":"PlanningBasins2023 Upper Savannah native record5","original_context_geometry":selection["captured_geometry_count"]},
        "entries":[{"id":SOURCE_ID,"title":"Original WBD selected Upper Savannah upstream hydrologic domain",
            "kind":"vector","role":"MODEL_DOMAIN","path":"model-domain.esri.json.gz","sha256":digest(packed),
            "bytes":len(packed),"encoding":"gzip","decoded_sha256":digest(body),"decoded_bytes":len(body),
            "source_crs":"EPSG:"+str(wkid),"source_format":"Esri JSON","uri":capture["source_url"],
            "vintage":original_timestamp,"metadata":{"feature_count":len(features),
                "native_object_id_field":oid,"native_huc12_field":huc,
                "binding_file":"feature-bindings.json","source_capture_sha256":digest(original_bytes),
                "selection_method":selection["upstream_method"]},"companions":companions}]}
    exact_write(output/"sources.json",encode(source_manifest))
    delivery_files=[]
    for target in sorted(output.rglob("*")):
        if target.is_file() and target.relative_to(output).as_posix()!="delivery.json":
            raw=target.read_bytes();delivery_files.append({"path":target.relative_to(output).as_posix(),"bytes":len(raw),"sha256":digest(raw)})
    delivery={"schema":"upstate.wbd-domain-delivery/v1","source_id":SOURCE_ID,"files":delivery_files,
        "source_manifest_sha256":digest((output/"sources.json").read_bytes()),"original_capture_sha256":digest(original_bytes)}
    exact_write(output/"delivery.json",encode(delivery))
    archive=output.with_suffix(".zip")
    with tempfile.TemporaryDirectory(dir=output.parent,prefix=".wbd-domain-zip-") as temporary:
        staged=pathlib.Path(temporary)/"domain.zip"
        with zipfile.ZipFile(staged,"x",compression=zipfile.ZIP_STORED,allowZip64=True) as z:
            for target in sorted(output.rglob("*")):
                if target.is_file(): z.write(target,target.relative_to(output).as_posix())
        with zipfile.ZipFile(staged) as z:
            expected={x["path"]:x for x in delivery_files}
            own=(output/"delivery.json").read_bytes()
            expected["delivery.json"]={"bytes":len(own),"sha256":digest(own)}
            if set(z.namelist())!=set(expected) or len(z.namelist())!=len(expected): raise ValueError("Delivery member mismatch")
            for name,item in expected.items():
                raw=z.read(name)
                if len(raw)!=item["bytes"] or digest(raw)!=item["sha256"]: raise ValueError("Delivery byte mismatch: "+name)
        if archive.exists():
            if archive.read_bytes()!=staged.read_bytes(): raise ValueError("A different domain archive exists")
        else: os.link(staged,archive)
    print(json.dumps({"complete":True,"output":str(output),"source_manifest_sha256":delivery["source_manifest_sha256"],
        "native_body_sha256":digest(body),"native_body_bytes":len(body),"stored_bytes":len(packed),
        "zip":str(archive),"zip_bytes":archive.stat().st_size,"zip_sha256":digest(archive.read_bytes()),"summary":summary},ensure_ascii=True),flush=True)

if __name__=="__main__": main()
