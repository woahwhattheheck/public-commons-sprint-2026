#!/usr/bin/env python3
"""MIT. Assemble complete ERDDAP captures from already returned public source files.

This is an offline receiving command. It never calls the source provider.
Each accepted selection is checked by the maintained source importer before
its deterministic six-member archive is retained.
"""
from __future__ import annotations
import argparse, copy, hashlib, io, json, os, re, stat, sys, tempfile, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from erddap_source import FILES, SCHEMA, MAX_SOURCE, InputError, jbytes, read_capture, sha, server_url

def read_json(path):
    return json.loads(Path(path).read_bytes())

def atomic(path,raw,immutable=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.exists() and immutable:
        if path.read_bytes()!=raw:raise InputError("Retained original output differs: "+str(path))
        return
    fd,name=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb")as stream:
            os.fchmod(stream.fileno(),0o600);stream.write(raw);stream.flush();os.fsync(stream.fileno())
        if immutable:
            try:os.link(name,path)
            except FileExistsError:
                if path.read_bytes()!=raw:raise InputError("Retained original output differs: "+str(path))
        else:os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def source_path(root,record):
    selection=record.get("selection");name=record.get("name")
    if not isinstance(selection,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}",selection) or selection in {".",".."} or name not in FILES:
        raise InputError("Capture record has an invalid selection or source member")
    path=root/selection/name
    if path.exists() and (not stat.S_ISREG(path.lstat().st_mode) or root.resolve() not in path.resolve().parents):
        raise InputError("Use complete regular source files inside the selected raw root")
    return path

def response(record,raw_path,binary_returns):
    transport=copy.deepcopy(record["transport"])
    if not isinstance(transport,dict) or not isinstance(transport.get("upload"),dict):
        raise InputError("Original source import did not complete")
    expected=transport["upload"].get("content_length")
    if type(expected)is not int or not 0<=expected<=MAX_SOURCE or raw_path.stat().st_size!=expected:
        raise InputError("Retained source size differs from its original native upload")
    raw=raw_path.read_bytes()
    blob=record.get("git_blob")
    if blob is not None:
        actual=hashlib.sha1(b"blob "+str(len(raw)).encode("ascii")+b"\0"+raw).hexdigest()
        if not isinstance(blob,str) or not re.fullmatch(r"[0-9a-f]{40}",blob) or actual!=blob:
            raise InputError("Retained source differs from its original immutable Git body")
    elif transport.get("download") is not None:
        raise InputError("Retain the original immutable identity of the complete text response")
    if transport.get("download") is None:
        carrier=binary_returns.get(str(raw_path.resolve()))
        if carrier is None:raise InputError("The original binary attachment has no returned-byte receipt")
        if carrier.get("bytes")!=len(raw) or carrier.get("sha256")!=sha(raw):
            raise InputError("Original binary return differs from retained source bytes")
        upload=transport["upload"]
        if carrier.get("file_upload_id",upload["file_upload_id"])!=upload["file_upload_id"]:
            raise InputError("Binary return identifies another original source upload")
        transport["download"]={k:upload[k]for k in ("file_upload_id","filename","content_type","content_length")}
        transport["download"].update(method="signed-file",fileReference=carrier["fileReference"],
            carrierStatus=carrier["status"],carrierContentType=carrier.get("contentType"))
        transport.update(downloadStartedAt=carrier["startedAt"],downloadCompletedAt=carrier["completedAt"],downloadObservedAt=None)
    receipt={"url":record["sourceUrl"],"bytes":len(raw),"sha256":sha(raw),"transport":transport}
    return raw,receipt

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server",default="https://coastwatch.pfeg.noaa.gov/erddap/")
    parser.add_argument("--receipt",type=Path,required=True)
    parser.add_argument("--raw-root",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--binary-return",type=Path,action="append",default=[])
    args=parser.parse_args()
    receipt_raw=args.receipt.read_bytes();receipt=json.loads(receipt_raw);records=receipt.get("files")
    if not isinstance(records,list) or not records:raise InputError("Choose the complete original source acquisition receipt")
    root=args.raw_root.resolve(strict=True);out=args.output.absolute()
    binary={}
    for path in args.binary_return:
        value=read_json(path);key=str(Path(value["path"]).resolve())
        if key in binary and binary[key]!=value:raise InputError("Conflicting binary returns for the same original file")
        binary[key]=value
    groups={}
    for record in records:
        source_path(root,record)
        groups.setdefault(record["selection"],[]).append(record)
    complete=[];incomplete=[]
    for selection,own in groups.items():
        first=own[0];selected={};missing=[]
        if len({r["name"]for r in own})!=len(own):raise InputError("Repeated member in one source selection")
        if any((r["datasetId"],r["protocol"],r["selection_definition"],r["query"])!=(first["datasetId"],first["protocol"],first["selection_definition"],first["query"])for r in own):
            raise InputError("One named selection has conflicting original query definitions")
        for name in sorted(FILES):
            candidates=[r for r in own if r["name"]==name]
            # Whole-dataset metadata can be shared only when the original receipt
            # identifies exactly one unambiguous response for this dataset/protocol.
            if not candidates and name in {"metadata.json","dataset.dds","dataset.das"}:
                candidates=[r for r in records if r["name"]==name and r["datasetId"]==first["datasetId"] and r["protocol"]==first["protocol"]]
            if len(candidates)!=1:
                missing.append({"name":name,"reason":"missing or ambiguous original response"});continue
            record=candidates[0];path=source_path(root,record)
            if not path.exists():
                missing.append({"name":name,"reason":record.get("state")or"original bytes not returned","sourceUrl":record["sourceUrl"]});continue
            selected[name]=(record,path)
        if missing:
            incomplete.append({"selection":selection,"datasetId":first["datasetId"],"status":"incomplete","missing":missing})
            continue
        values={};manifest_files={}
        for name,(record,path)in selected.items():
            values[name],manifest_files[name]=response(record,path,binary)
        manifest={"schema":SCHEMA,"server":server_url(args.server),
            "datasetId":first["datasetId"],"protocol":first["protocol"],
            "selection":first["selection_definition"],"query":first["query"],
            "completeness":"complete-response-for-explicit-selection",
            "canonicalData":"data.json","comparisonData":"data.csv","files":manifest_files}
        values["manifest.json"]=(json.dumps(manifest,ensure_ascii=False,indent=2,allow_nan=False)+"\n").encode("utf-8")
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,"w",compression=zipfile.ZIP_STORED)as archive:
            for name in ["manifest.json"]+sorted(FILES):
                info=zipfile.ZipInfo(name,date_time=(2000,1,1,0,0,0));info.create_system=3
                info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_STORED
                archive.writestr(info,values[name])
        raw=buffer.getvalue()
        _,metadata,table,_=read_capture(io.BytesIO(raw))
        path=out/(selection+".erddap.zip");atomic(path,raw,immutable=True)
        complete.append({"selection":selection,"datasetId":first["datasetId"],"protocol":first["protocol"],
            "file":str(path),"bytes":len(raw),"sha256":sha(raw),"members":6,"rowCount":len(table["rows"]),
            "columns":table["columnNames"],"types":table["columnTypes"],"units":table["columnUnits"],
            "publisherId":metadata.get("publisherId")})
    result={"schema":"stellar-forge.erddap-assembled-captures.v1",
        "acquisitionReceipt":{"bytes":len(receipt_raw),"sha256":sha(receipt_raw)},
        "complete":complete,"incomplete":incomplete}
    atomic(out/"capture-index.json",jbytes(result))
    print(json.dumps(result,ensure_ascii=False))
    if not complete:raise SystemExit(2)

if __name__=="__main__":main()
