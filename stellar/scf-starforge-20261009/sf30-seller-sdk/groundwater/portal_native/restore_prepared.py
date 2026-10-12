#!/usr/bin/env python3
"""Restore one exact private prepared portal on a compatible host at its original paths."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path,PurePosixPath
import stat
import tempfile
import zipfile
from common import digest,info,owned_lock,publish,publish_bytes,read,read_bytes,require,sync_dir,verify,verify_archive

def restore(archive,expected,work_directory,driver_directory,source_capsule):
    archive=Path(archive).resolve()
    manifest=verify_archive(archive,expected)
    require(manifest["schema"]=="groundwater.tethys-prepared-portal.v1" and manifest["all_owned_services_closed"] is True,
            "Select the actual stopped original portal preparation archive.")
    roots={"work":Path(work_directory),"driver":Path(driver_directory),
           "incoming":Path(source_capsule).parent}
    for key,value in roots.items():
        require(value.is_absolute() and value.resolve()==value and not value.is_symlink(),"Select explicit unlinked absolute restore paths.")
    require(str(roots["work"])==manifest["original_work_directory"]
            and str(roots["driver"])==manifest["original_driver_directory"]
            and str(Path(source_capsule))==manifest["original_source_capsule"],
            "The installed runtime/configuration and actor Paths are bound to their original paths; this restore does not rebind them.")
    require(not archive.is_relative_to(roots["work"]) and not archive.is_relative_to(roots["driver"]),
            "Keep the actual incoming carrier outside the restored portal and source.")
    request={"schema":"groundwater.tethys-preparation-restore.v1","archive":{**expected,"path":str(archive)},
             "operation_id":manifest["operation_id"],"work_directory":str(roots["work"]),
             "driver_directory":str(roots["driver"]),"source_capsule":str(source_capsule)}
    # Sibling control exists before destination creation. An interruption has one resumable original identity.
    control=roots["work"].with_name(roots["work"].name+".restore-control")
    if control.exists():
        require(control.is_dir() and not control.is_symlink(),"The original restore control is linked or not a directory.")
    control.mkdir(parents=True,exist_ok=True,mode=0o700)
    with owned_lock(control/"restore.lock"):
        publish(control/"request.json",request)
        completed=control/"result.json"
        if completed.exists():
            result=read(completed)
            require(result["request_sha256"]==digest(request),"The completed restore belongs to another archive.")
            return {**result,"historical_replay":True,"current_business_files_not_overwritten":True}
        work=roots["work"]
        marker=work/".prepared-restore-request.json"
        if work.exists():
            require(work.is_dir() and not work.is_symlink(),"The restore destination is linked.")
            if not marker.exists():
                allowed={"portal.lock"}
                require(all(p.name in allowed or (p.name.startswith(".prepared-restore-request.json.") and p.name.endswith(".tmp"))
                            for p in work.iterdir()),"The occupied portal has no original restore request; it was not replaced.")
        work.mkdir(parents=True,exist_ok=True,mode=0o700)
        with owned_lock(work/"portal.lock"):
            publish(marker,request)
            rows=manifest["files"]
            seen=set();targets=[]
            for row in rows:
                member=PurePosixPath(row["path"])
                require(not member.is_absolute() and ".." not in member.parts and "." not in member.parts
                        and len(member.parts)>1 and member.parts[0] in roots and str(member)==row["path"],
                        "A retained archive path is not a selected original member.")
                require(row["path"] not in seen,"An original member is duplicated.");seen.add(row["path"])
                target=Path(source_capsule) if member.parts[0]=="incoming" else roots[member.parts[0]].joinpath(*member.parts[1:])
                if member.parts[0]=="incoming":
                    require(row["path"]=="incoming/original-source-capsule.json","An unsupported external input was selected.")
                require(not target.is_symlink() or row["kind"]=="symlink","A target file is linked.")
                for parent in target.parents:
                    require(not parent.is_symlink(),"An original target parent is linked.")
                targets.append((row,target))
            with zipfile.ZipFile(archive) as z:
                for row,target in targets:
                    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                    if row["kind"]=="symlink":continue
                    require(row["kind"]=="file","Unsupported prepared archive member type.")
                    if target.exists():
                        verify(target,row);continue
                    fd,temp=tempfile.mkstemp(prefix="."+target.name+".",suffix=".tmp",dir=target.parent)
                    try:
                        h=hashlib.sha256();count=0
                        with os.fdopen(fd,"wb") as out,z.open(row["path"]) as stream:
                            while block:=stream.read(1024*1024):out.write(block);count+=len(block);h.update(block)
                            out.flush();os.fsync(out.fileno())
                        require(count==row["bytes"] and h.hexdigest()==row["sha256"],"The original restored member changed.")
                        os.chmod(temp,int(row["mode"])&0o777);os.link(temp,target);sync_dir(target.parent)
                    finally:Path(temp).unlink(missing_ok=True)
                for row,target in targets:
                    if row["kind"]!="symlink":continue
                    raw=z.read(row["path"]);link=raw.decode("utf-8")
                    require(link==row["target"] and not Path(link).is_absolute()
                            and (target.parent/link).resolve().is_relative_to(work),"An original runtime symlink leaves its private restored root.")
                    if target.is_symlink():require(os.readlink(target)==link,"The original runtime link changed.")
                    else:
                        require(not target.exists(),"An original runtime link is occupied.")
                        os.symlink(link,target);sync_dir(target.parent)
            # Frozen initial material is verified once; completed replay permits later legitimate business edits.
            for row,target in targets:
                if row["kind"]=="file":verify(target,row)
                else:require(target.is_symlink() and os.readlink(target)==row["target"],"An original restored link differs.")
            result={"state":"complete","request_sha256":digest(request),"operation_id":manifest["operation_id"],
                    "work_directory":str(work),"driver_directory":str(roots["driver"]),"source_capsule":str(source_capsule),
                    "files":len(rows),"original_accounts_and_configuration_preserved":True,
                    "native_model_runs_started":0,"portal_started":False}
            publish(completed,result)
            return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("archive","sha256","work-directory","driver-directory","source-capsule"):p.add_argument("--"+name,required=True)
    p.add_argument("--bytes",required=True,type=int);a=p.parse_args();previous=os.umask(0o077)
    try:
        result=restore(a.archive,{"bytes":a.bytes,"sha256":a.sha256},a.work_directory,a.driver_directory,a.source_capsule)
        print(json.dumps(result),flush=True)
    finally:os.umask(previous)

if __name__=="__main__":main()
