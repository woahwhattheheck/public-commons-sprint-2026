"""Restore the exact retained public NLCD prefix for its original receiving operation.

Authored by TokenJunkieLabs. This restores only the known prefix, verifies its
complete original SHA256, then leaves the existing adopter and receiver in charge.
"""
from __future__ import annotations
import argparse, fcntl, hashlib, json, os, re, shutil, sys, time, urllib.request
from pathlib import Path

SCHEMA = "upstate.original-nlcd-prefix-handoff/v1"
HANDOFF_SHA = "7fecf93725718e268e6f911abe456e5d9016aed52acced1b0c20310964ede7bb"
ORIGINAL = {"url":"https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2025_CU_C1V2.zip",
 "etag":'"56e711ce-64fec1a6cfdae"', "total_bytes":1457983950, "prefix_bytes":218248092,
 "prefix_sha256":"2d1b6efed9193ffbb5dd9499567fef15c8e13de31c275506a421c110c465c25e",
 "archive_name":"Annual_NLCD_LndCov_2025_CU_C1V2.zip"}

def sha(path, length=None):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        remaining=length
        while remaining is None or remaining:
            body=stream.read(1024*1024 if remaining is None else min(1024*1024,remaining))
            if not body:
                if remaining: raise ValueError("The retained prefix is shorter than its checkpoint.")
                break
            h.update(body)
            if remaining is not None: remaining-=len(body)
    return h.hexdigest()

def regular(path):
    path=Path(path).absolute()
    for item in (path,*path.parents):
        if item.is_symlink(): raise ValueError("Use the ordinary original receiving path: "+str(item))
    if path.exists() and not path.is_file(): raise ValueError("Expected an ordinary file: "+str(path))
    return path

def save(path,value):
    body=(json.dumps(value,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
    temp=regular(path.with_name(path.name+".writing"))
    with temp.open("wb") as stream:
        stream.write(body);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)

def read(path): return json.loads(path.read_bytes())

def recover(handoff, root):
    raw=regular(handoff).read_bytes()
    packet=json.loads(raw)
    if hashlib.sha256(raw).hexdigest()!=HANDOFF_SHA or packet.get("schema")!=SCHEMA or packet.get("operation_id")!="UPSTATE-ORIGINAL-SOURCES-DBC61":
        raise ValueError("Select the complete saved original prefix handoff.")
    if any(packet["source"].get(key)!=value for key,value in ORIGINAL.items()):
        raise ValueError("The handoff selects another original entity.")
    root=Path(root).absolute()
    regular(root/"adoption.lock")
    root.mkdir(parents=True,exist_ok=True)
    inputs=root/"inputs"
    inputs.mkdir(parents=True,exist_ok=True)
    capture_lock=regular(inputs/(ORIGINAL["archive_name"]+".lock"))
    with (root/"adoption.lock").open("a+b") as lock, capture_lock.open("a+b") as capture:
        fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        fcntl.flock(capture.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        target=regular(inputs/(ORIGINAL["archive_name"]+".partial"))
        archive=regular(inputs/ORIGINAL["archive_name"])
        journal=root/"original-prefix-byte-recovery"
        regular(journal/"selection.json");journal.mkdir(exist_ok=True)
        selection={"schema":"upstate.original-prefix-byte-recovery/v1","operation_id":packet["operation_id"],
                   "handoff_sha256":HANDOFF_SHA,"source":ORIGINAL}
        if (journal/"selection.json").exists():
            if read(journal/"selection.json")!=selection: raise ValueError("The original prefix selection changed.")
        else: save(journal/"selection.json",selection)
        for existing in (archive,target):
            if existing.exists():
                if existing.stat().st_size<ORIGINAL["prefix_bytes"] or sha(existing,ORIGINAL["prefix_bytes"])!=ORIGINAL["prefix_sha256"]:
                    raise ValueError("The receiving path contains a different original prefix.")
                if existing==archive or existing.stat().st_size>ORIGINAL["prefix_bytes"]:
                    raise ValueError("An adopted original capture has progressed; continue its existing receiver.")
                print(json.dumps({"state":"ORIGINAL_PREFIX_RESTORED","prefix":str(existing),"source":ORIGINAL,"reused":True}),flush=True)
                return
        stage=regular(target.with_name(target.name+".restoring"))
        state_path=journal/"state.json"
        if state_path.exists():
            state=read(state_path)
            size=stage.stat().st_size if stage.exists() else 0
            count=state["bytes"]
            if size<count or sha(stage,count)!=state["sha256"]:
                raise ValueError("The retained prefix byte checkpoint changed.")
            if size>count:
                active=state.get("active")
                if not active or active.get("start")!=count or active.get("etag")!=ORIGINAL["etag"] or size>active["end"]+1:
                    raise ValueError("An unbound prefix restoration tail occupies the receiving path.")
                state["responses"].append({**active,"received_bytes":size-count,
                    "complete":False,"recovered_after_interruption":True})
                state.update(bytes=size,sha256=sha(stage),active=None)
                save(state_path,state)
        else:
            if stage.exists() and stage.stat().st_size: raise ValueError("An unbound prefix restoration file already exists.")
            stage.touch(exist_ok=True)
            state={"bytes":0,"sha256":hashlib.sha256(b"").hexdigest(),"active":None,"responses":[]}
            save(state_path,state)
        count=state["bytes"]
        if count>ORIGINAL["prefix_bytes"]: raise ValueError("The recovered source exceeds the exact original prefix.")
        available=shutil.disk_usage(root).free
        if available<ORIGINAL["prefix_bytes"]-count+64*1024*1024:
            raise OSError("Use the equipped host's persistent directory with room for the remaining original prefix.")
        while count<ORIGINAL["prefix_bytes"]:
            end=min(ORIGINAL["prefix_bytes"]-1,count+32*1024*1024-1)
            requested={"start":count,"end":end,"time":time.time(),"etag":ORIGINAL["etag"]}
            request=urllib.request.Request(ORIGINAL["url"],headers={
                "Range":f"bytes={count}-{end}","If-Range":ORIGINAL["etag"],
                "Accept-Encoding":"identity","User-Agent":"TokenJunkieLabs-Upstate-original-prefix-recovery/1"})
            with urllib.request.urlopen(request,timeout=90) as response:
                expected=f"bytes {count}-{end}/{ORIGINAL['total_bytes']}"
                if response.status!=206 or response.headers.get("Content-Range")!=expected or response.headers.get("ETag")!=ORIGINAL["etag"]:
                    raise ValueError("The source did not return the exact selected range and validator.")
                if response.headers.get("Content-Encoding","identity").lower()!="identity":
                    raise ValueError("The selected byte range was content encoded.")
                length=response.headers.get("Content-Length")
                if length is not None and (not length.isdecimal() or int(length)!=end-count+1):
                    raise ValueError("The returned original range length differs.")
                requested.update(content_range=expected,response_url=response.geturl())
                state["active"]=requested;save(state_path,state)
                failure=None
                with stage.open("r+b") as output:
                    output.seek(count)
                    try:
                        remaining=end-count+1
                        while remaining:
                            body=response.read(min(1024*1024,remaining))
                            if not body: raise IOError("The original source closed before its declared range ended.")
                            output.write(body);remaining-=len(body)
                        if response.read(1):
                            output.truncate(count)
                            raise ValueError("The source exceeded its declared original range.")
                    except Exception as error: failure=error
                    finally: output.flush();os.fsync(output.fileno())
                received=stage.stat().st_size
                state["responses"].append({**requested,"received_bytes":received-count,
                    "complete":failure is None,"error":None if failure is None else str(failure)})
                state.update(bytes=received,sha256=sha(stage),active=None)
                save(state_path,state)
                print(json.dumps({"state":"ORIGINAL_PREFIX_RANGE","bytes":received,"prefix_bytes":ORIGINAL["prefix_bytes"],"content_range":expected,"complete":failure is None}),flush=True)
                if failure is not None: raise failure
                count=received
        if sha(stage)!=ORIGINAL["prefix_sha256"]:
            raise ValueError("The complete source prefix does not match its original retained SHA256.")
        os.link(stage,target)
        stage.unlink()
        directory_fd=os.open(inputs,os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
        save(journal/"result.json",{"state":"ORIGINAL_PREFIX_RESTORED","prefix":str(target),"source":ORIGINAL,
            "handoff_sha256":HANDOFF_SHA,"restoration":str(state_path),"time":time.time()})
        print(json.dumps({"state":"ORIGINAL_PREFIX_RESTORED","prefix":str(target),"source":ORIGINAL,"reused":False}),flush=True)

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("handoff",type=Path)
    parser.add_argument("--root",type=Path,required=True)
    args=parser.parse_args()
    recover(args.handoff,args.root)
