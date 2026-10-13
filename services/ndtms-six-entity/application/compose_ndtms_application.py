#!/usr/bin/env python3
"""Compose the complete NDTMS extension with an exact existing application edition."""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, stat, tempfile
from pathlib import Path, PurePosixPath

def need(ok,message):
    if not ok:raise ValueError(message)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def safe(value):
    need(isinstance(value,str) and value and "\\" not in value and ":" not in value and
         all(ord(c)>31 and ord(c)!=127 for c in value),"Use a portable relative source path.")
    path=PurePosixPath(value)
    need(not path.is_absolute() and str(path)==value and all(p not in ("",".","..") for p in path.parts),"Unsafe source path.")
    return path
def read(root,path,maximum=32*1024*1024):
    target=root/safe(path);s=target.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_size<=maximum,"Read the complete regular original source: "+str(target))
    need(target.resolve().is_relative_to(root),"The selected source path leaves its original directory.")
    raw=target.read_bytes();after=target.lstat()
    sig=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
    need(sig(s)==sig(after) and len(raw)==s.st_size,"Source changed during reading: "+path)
    return raw
def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--overlay",type=Path,required=True)
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args(argv)
    source=args.source.resolve(strict=True);out=args.out.absolute()
    need(source.is_dir() and not args.source.is_symlink() and out!=source,"Keep the original application and choose its separate continuation directory.")
    overlay_raw=read(args.overlay.parent.resolve(),args.overlay.name,16*1024*1024)
    packet=json.loads(overlay_raw)
    need(packet.get("schema")=="nelc.ndtms-application-overlay/v1","Choose the complete source overlay.")
    original_manifest=read(source,"APPLICATION.json")
    need(digest(original_manifest)==packet.get("base",{}).get("applicationSha256"),
         "Select the exact original application edition declared by this overlay.")
    original=json.loads(original_manifest)
    need(original.get("schema")=="nelc.application-source/v1","Choose the actual complete original application.")
    bodies={}
    for row in original["files"]:
        path=str(safe(row["path"]));need(path not in bodies and path!="APPLICATION.json","The original manifest repeats a source.")
        raw=read(source,path)
        need(len(raw)==row["bytes"] and digest(raw)==row["sha256"],"The original application source changed: "+path)
        bodies[path]=raw
    originals=dict(bodies)
    changes=packet["files"];need(isinstance(changes,list) and changes,"Read every complete source postimage.")
    seen=set()
    for row in changes:
        path=str(safe(row["path"]));need(path not in seen and path!="APPLICATION.json","Overlay paths repeat or replace the generated manifest.")
        seen.add(path);body=row["content"].encode("utf-8")
        need(len(body)==row["bytes"] and digest(body)==row["sha256"],"A complete overlay leaf differs: "+path)
        before=row.get("preimage")
        if before is None:need(path not in bodies,"A new helper already has an original owner: "+path)
        else:
            need(path in bodies and len(bodies[path])==before["bytes"] and digest(bodies[path])==before["sha256"],
                 "Reconcile this changed original file before composing: "+path)
        bodies[path]=body
    manifest={**original,"edition":packet["edition"],"ndtmsSourceAncestry":{
        "originalApplicationSha256":digest(original_manifest),"overlaySha256":digest(overlay_raw),
        "originalEdition":original.get("edition"),"operation":packet["operation"]},
        "files":[{"path":path,"bytes":len(raw),"sha256":digest(raw)} for path,raw in sorted(bodies.items())]}
    bodies["APPLICATION.json"]=(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    def check_output(root):
        need(root.is_dir() and not root.is_symlink(),"The original composed output is not an ordinary directory.")
        for path,raw in bodies.items():need(read(root.resolve(),path)==raw,"Preserve the differing composed output: "+path)
    out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists():check_output(out)
    else:
        stage=Path(tempfile.mkdtemp(prefix=".ndtms-compose-",dir=out.parent))
        try:
            for path,raw in bodies.items():
                target=stage/path;target.parent.mkdir(parents=True,exist_ok=True)
                with target.open("xb") as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
                target.chmod(0o600)
            # No source is changed; an existing output is accepted only after exact full-byte comparison.
            if out.exists():check_output(out)
            else:
                try:os.rename(stage,out)
                except OSError:
                    if not out.exists():raise
                    check_output(out)
            fd=os.open(out.parent,os.O_RDONLY)
            try:os.fsync(fd)
            finally:os.close(fd)
        finally:
            if stage.exists():shutil.rmtree(stage)
    need(read(source,"APPLICATION.json")==original_manifest,"Original manifest changed while composing.")
    for path,raw in originals.items():need(read(source,path)==raw,"Original source changed while composing: "+path)
    print(json.dumps({"schema":"nelc.ndtms-source-composition/v1","source":str(source),"directory":str(out),
       "originalApplicationSha256":digest(original_manifest),"applicationSha256":digest(bodies["APPLICATION.json"]),
       "overlaySha256":digest(overlay_raw),"files":len(bodies),"workspaceMutation":False},indent=2))
    return 0
if __name__=="__main__":
    try:raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error":type(error).__name__,"message":str(error)}));raise SystemExit(2)
