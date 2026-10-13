"""Install the complete Maximo addon onto its exact existing municipal application."""
from __future__ import annotations
import argparse
import ast
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

SCHEMA = "municipal.maximo-install.v1"
def need(value, message):
    if not value: raise ValueError(message)
def sha(body): return hashlib.sha256(body).hexdigest()
def regular(path, maximum=2*1024*1024):
    need(not path.is_symlink(), "Preserve the selected regular source: "+str(path))
    with path.open("rb") as stream:
        info=os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_size<=maximum, "Source file is not a bounded regular file")
        body=stream.read(maximum+1)
    need(len(body)==info.st_size and len(body)<=maximum,"Source changed during read")
    return body
def beneath(root, relative):
    need(isinstance(relative,str) and not relative.startswith(("/", "\\")) and "\\" not in relative,
         "Use a relative original source path")
    parts=relative.split("/")
    need(all(x and x not in (".","..") for x in parts), "Invalid original source path")
    path=root
    for part in parts:
        path=path/part
        need(not path.is_symlink(),"Preserve the original source; symlink found: "+str(path))
    need(path.resolve().is_relative_to(root.resolve()),"Source path leaves the application")
    return path
def atomic(path, body):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd, temporary=tempfile.mkstemp(prefix=".maximo-install-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            os.chmod(temporary,0o600);stream.write(body);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
        if os.name!="nt":
            directory=os.open(path.parent,os.O_RDONLY)
            try:os.fsync(directory)
            finally:os.close(directory)
    finally:Path(temporary).unlink(missing_ok=True)
@contextmanager
def lock(path):
    need(not path.is_symlink(),"Preserve the original installer lock")
    with path.open("a+b") as stream:
        os.chmod(path,0o600)
        if os.name=="nt":
            import msvcrt
            stream.seek(0)
            if not stream.read(1):stream.write(b"0");stream.flush()
            stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:yield
        finally:
            if os.name=="nt":
                stream.seek(0);msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(stream.fileno(),fcntl.LOCK_UN)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application",type=Path,required=True,
                        help="existing application root containing workspace/engine.py")
    parser.add_argument("--check",action="store_true",help="read and report exact installation state")
    args=parser.parse_args()
    source=Path(__file__).resolve().parent
    root=args.application.absolute()
    need(root.is_dir() and not root.is_symlink(),"Select the existing original application directory")
    manifest_body=regular(source/"INSTALL_MANIFEST.json")
    manifest=json.loads(manifest_body)
    need(manifest.get("schema")==SCHEMA and isinstance(manifest.get("files"),list),"Use the complete original addon manifest")
    binding={"schema":SCHEMA,"application":str(root.resolve()),"manifest_sha256":sha(manifest_body)}
    selected, names=[],set()
    for item in manifest["files"]:
        name=item["path"]
        need(name not in names and name.startswith("workspace/"),"Repeated or unsupported installed path")
        names.add(name)
        body=regular(beneath(source,name))
        need(len(body)==item["bytes"] and sha(body)==item["sha256"],"Complete addon source identity differs: "+name)
        if name.endswith(".py"):ast.parse(body,filename=name)
        target=beneath(root,name)
        current=regular(target) if target.exists() else None
        observed=sha(current) if current is not None else None
        need(observed in (item.get("preimage_sha256"),item["sha256"]),"Existing application differs; compose its current source first: "+name)
        selected.append((item,body,target,current,observed))
    for item in manifest.get("dependencies",[]):
        current=regular(beneath(root,item["path"]))
        need(hashlib.sha1(b"blob "+str(len(current)).encode()+b"\0"+current).hexdigest()==item["git_blob_sha"],
             "Existing application dependency differs: "+item["path"])
    report={"binding":binding,"files":[{"path":item["path"],"state":"installed" if observed==item["sha256"] else "selected-original"}
                 for item,body,target,current,observed in selected]}
    if args.check:
        print(json.dumps(report,indent=2));return
    journal_root=beneath(root,"maximo-install-record")
    journal_root.mkdir(mode=0o700,exist_ok=True)
    with lock(journal_root/"install.lock"):
        journal_path=journal_root/"operation.json"
        if journal_path.exists():
            journal=json.loads(regular(journal_path))
            need(journal.get("binding")==binding,"Existing installation belongs to another exact source edition")
        else:
            journal={"binding":binding,"completed":[]}
            atomic(journal_path,(json.dumps(journal,indent=2)+"\n").encode())
        # Recheck every preimage under the original operation lock before any change.
        for item,body,target,previous,observed in selected:
            current=regular(target) if target.exists() else None
            need((sha(current) if current is not None else None) in (item.get("preimage_sha256"),item["sha256"]),
                 "Application changed before installation: "+item["path"])
        for item,body,target,previous,observed in selected:
            current=regular(target) if target.exists() else None
            current_hash=sha(current) if current is not None else None
            if current_hash!=item["sha256"]:
                need(current_hash==item.get("preimage_sha256"),"Application changed during installation")
                if current is not None:
                    backup=beneath(journal_root,"originals/"+item["path"])
                    if backup.exists():need(regular(backup)==current,"Retained original source differs")
                    else:atomic(backup,current)
                atomic(target,body)
            need(regular(target)==body,"Installed complete source differs")
            if item["path"] not in journal["completed"]:journal["completed"].append(item["path"])
            atomic(journal_path,(json.dumps(journal,indent=2)+"\n").encode())
        journal["state"]="installed"
        atomic(journal_path,(json.dumps(journal,indent=2)+"\n").encode())
    print(json.dumps({**report,"state":"installed","journal":str(journal_path)},indent=2))

if __name__=="__main__":main()
