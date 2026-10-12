#!/usr/bin/env python3
"""MIT. Capture the complete original NOAA ERDDAP selections for the maintained workbench.
Run once, or repeat against the SAME output directory to finish only missing responses.
No service, credential or data-generation dependency is required.
"""
from __future__ import annotations
import argparse, datetime, hashlib, json, os, pathlib, tempfile, urllib.error, urllib.parse, urllib.request, zipfile
BASE = "https://coastwatch.pfeg.noaa.gov/erddap/"
SCHEMA = "stellar-forge.erddap-source.v1"
SELECTIONS = [
 {"name":"mur-sst-june-2025", "datasetId":"jplMURSST41", "protocol":"griddap",
  "selection":{"variables":["analysed_sst","analysis_error","mask","sea_ice_fraction"],
   "axes":[{"name":"time","mode":"value","start":"2025-06-01T09:00:00Z","stop":"2025-06-03T09:00:00Z","stride":1},
           {"name":"latitude","mode":"value","start":"36.00","stop":"36.04","stride":2},
           {"name":"longitude","mode":"value","start":"-123.00","stop":"-122.96","stride":2}]}},
 {"name":"ndbc-46042-june-2025", "datasetId":"cwwcNDBCMet", "protocol":"tabledap",
  "selection":{"variables":["station","longitude","latitude","time","WD","WSPD","WVHT","ATMP","WTMP"],
   "constraints":[{"variable":"station","operator":"=","value":"46042","kind":"string"},
                  {"variable":"time","operator":">=","value":"2025-06-01T00:00:00Z","kind":"time"},
                  {"variable":"time","operator":"<","value":"2025-06-02T00:00:00Z","kind":"time"}]}}
]
def encoded_query(item):
    s=item["selection"]
    if item["protocol"]=="griddap":
        selectors="".join("[("+a["start"]+"):"+str(a["stride"])+":("+a["stop"]+")]" for a in s["axes"])
        return urllib.parse.quote(",".join(v+selectors for v in s["variables"]),safe="")
    pieces=[",".join(s["variables"])]
    for c in s["constraints"]:
        val=json.dumps(c["value"],ensure_ascii=False) if c["kind"]=="string" else c["value"]
        pieces.append(c["variable"]+c["operator"]+val)
    return "&".join(urllib.parse.quote(p,safe="") for p in pieces)
def jbytes(o):
    return (json.dumps(o,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode()
def atomic(path,raw):
    fd,tmp=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def capture(folder,name,url,max_bytes):
    path=folder/name; receipt=folder/(name+".receipt.json")
    if path.exists() and receipt.exists():
        r=json.loads(receipt.read_bytes());b=path.read_bytes()
        if r["url"]!=url or r["bytes"]!=len(b) or r["sha256"]!=hashlib.sha256(b).hexdigest() or r["status"]!=200:
            raise ValueError("Saved original response identity differs: "+name)
        return r
    req=urllib.request.Request(url,headers={"Accept":"*/*","Accept-Encoding":"identity","User-Agent":"Commons-ERDDAP-Receiving/1.0 (complete fixed historical selections)"})
    start=datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        response=urllib.request.urlopen(req,timeout=90)
    except urllib.error.HTTPError as e:
        raw=e.read(131072)
        atomic(folder/(name+".error.body"),raw)
        atomic(folder/(name+".error.json"),jbytes({"url":url,"status":e.code,"retrievedAt":start,
            "headers":{k:v for k,v in e.headers.items() if k.lower() not in {"set-cookie","authorization","cookie"}},
            "bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}))
        raise
    with response as r:
        chunks=[];size=0
        while True:
            b=r.read(65536)
            if not b:break
            size+=len(b)
            if size>max_bytes:raise ValueError("Complete response exceeds selected byte budget: "+name)
            chunks.append(b)
        body=b"".join(chunks)
        rec={"url":url,"finalUrl":r.url,"status":r.status,"startedAt":start,
             "retrievedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "headers":{k:v for k,v in r.headers.items() if k.lower() not in {"set-cookie","authorization","cookie"}},
             "bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()}
    atomic(path,body);atomic(receipt,jbytes(rec));return rec
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--out",required=True)
    p.add_argument("--max-bytes",type=int,default=64*1024*1024);a=p.parse_args()
    out=pathlib.Path(a.out).absolute();out.mkdir(mode=0o700,parents=True,exist_ok=True);results=[]
    for item in SELECTIONS:
        folder=out/item["name"];folder.mkdir(mode=0o700,exist_ok=True);did=item["datasetId"];protocol=item["protocol"]
        query=encoded_query(item)
        urls={"metadata.json":BASE+"info/"+did+"/index.json",
              "dataset.dds":BASE+protocol+"/"+did+".dds",
              "dataset.das":BASE+protocol+"/"+did+".das",
              "data.json":BASE+protocol+"/"+did+".json?"+query,
              "data.csv":BASE+protocol+"/"+did+".csv?"+query}
        records={}
        for name,url in urls.items():
            records[name]=capture(folder,name,url,a.max_bytes)
            if name=="metadata.json":
                table=json.loads((folder/name).read_bytes())["table"]
                names=table["columnNames"]; vr=names.index("Variable Name"); rt=names.index("Row Type")
                declared={r[vr] for r in table["rows"] if r[rt] in ("variable","dimension")}
                missing=set(item["selection"]["variables"])-declared
                if missing:raise ValueError("Current official metadata does not declare "+repr(sorted(missing)))
            print(json.dumps({"dataset":did,"file":name,"bytes":records[name]["bytes"],"sha256":records[name]["sha256"]}),flush=True)
        table=json.loads((folder/"data.json").read_bytes())["table"]
        if any(len(row)!=len(table["columnNames"]) for row in table["rows"]):raise ValueError("Truncated table shape")
        manifest={"schema":SCHEMA,"server":BASE,"datasetId":did,"protocol":protocol,
          "selection":item["selection"],"query":query,"completeness":"complete-response-for-explicit-selection",
          "files":records,"canonicalData":"data.json","comparisonData":"data.csv"}
        atomic(folder/"manifest.json",jbytes(manifest))
        archive=out/(item["name"]+".erddap.zip"); temp=out/(item["name"]+".erddap.zip.partial")
        with zipfile.ZipFile(temp,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for name in ["manifest.json"]+sorted(records):
                info=zipfile.ZipInfo(name,date_time=(2000,1,1,0,0,0));info.create_system=3;info.external_attr=0o100600<<16
                info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,(folder/name).read_bytes(),compresslevel=6)
        os.replace(temp,archive);raw=archive.read_bytes()
        results.append({"datasetId":did,"archive":str(archive),"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest(),
           "rows":len(table["rows"]),"columns":table["columnNames"],"types":table["columnTypes"],"units":table.get("columnUnits"),"manifest":manifest})
    atomic(out/"capture-result.json",jbytes({"schema":"stellar-forge.erddap-capture-result.v1","datasets":results}))
    print(json.dumps({"complete":True,"result":str(out/"capture-result.json"),"datasets":[{k:v for k,v in r.items() if k!="manifest"} for r in results]}))
if __name__=="__main__":main()
