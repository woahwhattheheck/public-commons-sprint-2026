"""Install the complete additive terrain extension without replacing peer files."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path,PurePosixPath
import tempfile


def sha(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as src:
        for block in iter(lambda:src.read(1024*1024),b""):h.update(block)
    return h.hexdigest()


def safe(root,name):
    selected=PurePosixPath(name)
    if (not name or selected.is_absolute() or selected.as_posix()!=name or ".." in selected.parts
            or "\\" in name or "\0" in name or ":" in selected.parts[0]):
        raise ValueError("Invalid distributed source path")
    path=root.joinpath(*selected.parts)
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
        raise ValueError("Source path escapes the selected application")
    return path


def install(target,*,standalone=False):
    bundle=Path(__file__).resolve().parent
    manifest=json.loads((bundle/"terrain-source-manifest.json").read_text())
    if manifest.get("schema")!="upstate.terrain-source-distribution/v1":
        raise ValueError("Select the complete original terrain source distribution")
    target=Path(target).resolve()
    if not standalone and not (target/"model"/"workspace.py").is_file():
        raise ValueError("Select the existing Upper Savannah product root, or use --standalone for independent terrain tools")
    rows=manifest["files"]
    if len({row["path"] for row in rows})!=len(rows):
        raise ValueError("The distribution repeats a source filename")
    conflicts=[]
    for row in rows:
        original=safe(bundle,row["path"])
        if not original.is_file() or original.stat().st_size!=row["bytes"] or sha(original)!=row["sha256"]:
            raise ValueError("Distributed source differs: "+row["path"])
        destination=safe(target,row["path"])
        if destination.exists() and (not destination.is_file() or sha(destination)!=row["sha256"]):
            conflicts.append(row["path"])
    if conflicts:
        raise ValueError("Existing differing source is preserved; reconcile these exact files: "+", ".join(conflicts))
    installed,reused=[],[]
    for row in rows:
        destination=safe(target,row["path"])
        if destination.exists():
            reused.append(row["path"]);continue
        destination.parent.mkdir(parents=True,exist_ok=True)
        fd,name=tempfile.mkstemp(prefix=".terrain-install-",dir=destination.parent)
        pending=Path(name)
        try:
            with os.fdopen(fd,"wb") as out:
                out.write(safe(bundle,row["path"]).read_bytes());out.flush();os.fsync(out.fileno())
            try:os.link(pending,destination)
            except FileExistsError:
                if sha(destination)!=row["sha256"]:raise ValueError("Concurrent source differs: "+row["path"])
                reused.append(row["path"])
            else:installed.append(row["path"])
        finally:pending.unlink(missing_ok=True)
    return {"state":"installed","application":str(target),"installed":installed,"reused":reused,
            "source_bytes":sum(row["bytes"] for row in rows),"source_manifest_sha256":sha(bundle/"terrain-source-manifest.json"),
            "entrypoint":"python -m source_tools.terrain_cli --help"}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application")
    parser.add_argument("--standalone",action="store_true")
    args=parser.parse_args()
    try:print(json.dumps(install(args.application,standalone=args.standalone),indent=2))
    except Exception as error:
        parser.exit(2,type(error).__name__+": "+str(error)+"\n")

if __name__=="__main__":main()
