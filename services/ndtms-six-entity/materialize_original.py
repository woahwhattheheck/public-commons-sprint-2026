#!/usr/bin/env python3
"""Install one complete hash-verified NELC source map; perform no application operation."""
from __future__ import annotations
import argparse,hashlib,json,os,sqlite3,sys
from pathlib import Path,PurePosixPath

def require(value,message):
    if not value:raise ValueError(message)
def checked_path(value):
    require(isinstance(value,str) and value and "\\" not in value and "\x00" not in value,"Invalid source path.")
    path=PurePosixPath(value)
    require(not path.is_absolute() and str(path)==value and all(p not in ("",".","..") for p in path.parts),"Source path leaves the selected application.")
    return path
def ordinary_parents(root,path):
    parent=root
    require(not root.is_symlink(),"The selected source directory cannot be a symlink.")
    for part in path.parts:
        parent=parent/part
        require(not parent.is_symlink(),"A source parent cannot be a symlink.")
        parent.mkdir(exist_ok=True)
        require(parent.is_dir(),"A source parent is not a directory.")
def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_map");parser.add_argument("--output",required=True)
    args=parser.parse_args(argv)
    original=Path(args.source_map).read_bytes();packet=json.loads(original)
    require(packet.get("schema")=="commons.source-map/v1" and isinstance(packet.get("files"),dict),"Select the complete original source-map object.")
    files={}
    for name,item in packet["files"].items():
        relative=checked_path(name)
        require(isinstance(item,dict) and isinstance(item.get("content"),str),"Source members must contain complete original UTF-8 text.")
        body=item["content"].encode("utf-8")
        require((len(body),hashlib.sha256(body).hexdigest())==(item["bytes"],item["sha256"]),"A source body differs from its manifest: "+name)
        files[name]=(relative,body,item["sha256"])
    require("APPLICATION.json" in files,"The complete application manifest is missing.")
    app=json.loads(files["APPLICATION.json"][1])
    require(app.get("schema")=="nelc.application-source/v1","Unsupported complete application edition.")
    wanted={item["path"]:item for item in app["files"]}
    require(len(wanted)==len(app["files"]) and set(files)==set(wanted)|{"APPLICATION.json"},"The carrier and application source inventory differ.")
    for name,item in wanted.items():
        require((len(files[name][1]),files[name][2])==(item["bytes"],item["sha256"]),"The application selection differs: "+name)
    root=Path(args.output).absolute();root.mkdir(parents=True,exist_ok=True)
    require(root.is_dir() and not root.is_symlink(),"Select an ordinary owned source directory.")
    owner_path=root/".source-install.sqlite"
    require(not owner_path.is_symlink(),"The source owner path cannot be a symlink.")
    owner=sqlite3.connect(owner_path,timeout=0,isolation_level=None)
    try:
        owner.execute("CREATE TABLE IF NOT EXISTS selected(id INTEGER PRIMARY KEY,application_sha TEXT NOT NULL)")
        owner.execute("BEGIN IMMEDIATE")
        app_sha=files["APPLICATION.json"][2]
        prior=owner.execute("SELECT application_sha FROM selected WHERE id=1").fetchone()
        require(prior is None or prior[0]==app_sha,"This source directory already belongs to another complete application.")
        if prior is None:owner.execute("INSERT INTO selected VALUES(1,?)",(app_sha,))
        owner.execute("COMMIT");owner.execute("BEGIN IMMEDIATE")
        for name,(relative,body,sha) in sorted(files.items(),key=lambda entry:(entry[0]=="APPLICATION.json",entry[0])):
            ordinary_parents(root,relative.parent)
            target=root/str(relative)
            require(not target.is_symlink(),"A selected source file cannot be a symlink.")
            if target.exists():
                require(target.is_file() and target.read_bytes()==body,"A selected installed source differs: "+name)
                continue
            temp=target.with_name("."+target.name+"."+sha[:16]+".source-receiving")
            require(not temp.is_symlink() and (not temp.exists() or temp.is_file()),"A source staging path is not ordinary.")
            with temp.open("wb") as stream:
                stream.write(body);stream.flush();os.fsync(stream.fileno())
            require(temp.read_bytes()==body,"An installed source member is incomplete.")
            try:os.link(temp,target)
            except FileExistsError:require(target.is_file() and not target.is_symlink() and target.read_bytes()==body,"The selected source publication differs.")
            temp.unlink()
            fd=os.open(target.parent,os.O_RDONLY)
            try:os.fsync(fd)
            finally:os.close(fd)
        for name,(_,body,sha) in files.items():
            require((root/name).is_file() and not (root/name).is_symlink() and (root/name).read_bytes()==body,"The complete source readback differs: "+name)
        owner.execute("COMMIT")
        print(json.dumps({"schema":"nelc.source-install/v1","status":"COMPLETE","application":str(root),
             "applicationSha256":app_sha,"sourceMapSha256":hashlib.sha256(original).hexdigest(),"files":len(files),
             "sourceBytes":sum(len(body) for _,body,_ in files.values()),"applicationOperationStarted":False},indent=2))
    finally:owner.close()
    return 0
if __name__=="__main__":raise SystemExit(main())
