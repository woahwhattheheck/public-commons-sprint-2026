#!/usr/bin/env python3
"""Receive and open the complete original Analysis project in a private workspace."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys


def relative(value):
    if not isinstance(value,str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Use a canonical package member.")
    path=PurePosixPath(value)
    if path.is_absolute() or path.as_posix()!=value or any(x in {".",".."} for x in path.parts):
        raise ValueError("Use a canonical package member.")
    return value


def verified(path,expected):
    if path.resolve()!=path:
        raise ValueError("The selected project member is a symlink: "+str(path))
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,"rb") as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size!=expected["bytes"]:
            raise ValueError("The complete project member has changed: "+str(path))
        actual=hashlib.file_digest(stream,"sha256").hexdigest()
        after=os.fstat(stream.fileno())
        stamp=lambda info:(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
        if actual!=expected["sha256"] or stamp(before)!=stamp(after):
            raise ValueError("The complete project member has changed: "+str(path))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project",type=Path,default=Path(__file__).resolve().parent)
    parser.add_argument("--workspace",type=Path,required=True,
                        help="New or previously received workspace below a private parent.")
    parser.add_argument("--operation",help="Optional original native receiving UUID32.")
    parser.add_argument("--node",help="Installed Node executable; otherwise use the current runtime or PATH.")
    parser.add_argument("--checkout",type=Path,help="Matching native checkout; defaults to this package's runtime/native.")
    parser.add_argument("--receive-only",action="store_true")
    parser.add_argument("--no-open",action="store_true",help="Print the native launch URL without opening a browser.")
    parser.add_argument("--port",type=int,default=0)
    args=parser.parse_args()
    if sys.version_info<(3,12):
        raise RuntimeError("Use Python 3.12 or later for this retained native source.")
    if not 0<=args.port<=65535:
        raise ValueError("Use a local port from 0 to 65535.")
    root=args.project.expanduser().resolve(strict=True)
    manifest_path=root/"project-manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size>16*1024*1024:
        raise ValueError("Select the complete project manifest.")
    manifest=json.loads(manifest_path.read_bytes())
    if manifest.get("schema")!="stellar-forge.analysis-project-delivery.v1":
        raise ValueError("Select a complete Analysis project package.")
    rows=manifest.get("files")
    if not isinstance(rows,list) or not rows:
        raise ValueError("The complete package file inventory is required.")
    selected={}
    for row in rows:
        path=relative(row["path"])
        if path in selected:
            raise ValueError("The package repeats a file.")
        selected[path]=row
        verified(root/path,row)
    archive_record=manifest["archive"]
    archive_name=relative(archive_record["file"])
    if archive_name not in selected or any(selected[archive_name][key]!=archive_record[key] for key in ("bytes","sha256")):
        raise ValueError("The native archive differs from the complete project.")
    python_root=root/"runtime"/"python"
    if "runtime/python/stellar_forge_buyer/workspace_archive_receive.py" not in selected:
        raise ValueError("Retain the complete original Python receiver.")
    expected_python={name for name in selected if name.startswith("runtime/python/") and name.endswith(".py")}
    actual_python={path.relative_to(root).as_posix() for path in python_root.rglob("*.py")}
    if actual_python!=expected_python:
        raise ValueError("The complete selected Python source inventory has changed.")
    sys.path.insert(0,str(python_root))
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.storage import private_directory
    target=args.workspace.expanduser().absolute()
    parent=private_directory(target.parent)
    target=parent/target.name
    received=restore_archive(root/archive_name,target,operation=args.operation,
                             expected_sha256=archive_record["sha256"])
    if received["workspace_id"]!=manifest["workspace_id"]:
        raise ValueError("The received original workspace identity differs.")
    print(json.dumps({"project":str(root),"receiving":received}),flush=True)
    if args.receive_only:
        return 0
    selected_node=args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "node"
    node=shutil.which(selected_node)
    if node is None:
        raise RuntimeError("Select the installed Node executable with --node.")
    checkout=(args.checkout or root/"runtime"/"native").expanduser().resolve(strict=True)
    if not (checkout/"stellar-forge"/"mcp-paid-agent"/"result-store.mjs").is_file():
        raise ValueError("Retain the original native MCP source and its dependencies.")
    command=[sys.executable,"-B","-m","stellar_forge_buyer.analysis_workspace",
             "--database",str(target),"--checkout",str(checkout),"--node",str(Path(node).resolve()),
             "serve","--port",str(args.port)]
    if not args.no_open:
        command.append("--open")
    environment={**os.environ,"PYTHONPATH":str(python_root),"PYTHONDONTWRITEBYTECODE":"1"}
    # The original native application becomes the foreground owner.
    os.execve(sys.executable,command,environment)


if __name__=="__main__":
    raise SystemExit(main())
