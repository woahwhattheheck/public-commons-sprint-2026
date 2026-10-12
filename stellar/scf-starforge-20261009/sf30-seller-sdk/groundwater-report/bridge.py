# SPDX-License-Identifier: MIT
"""Use the installed original groundwater readers; never dispatch a model or rewrite report numbers."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import zipfile

sys.dont_write_bytecode = True
os.umask(0o077)

def need(value, message):
    if not value:
        raise ValueError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def report_view(work, report_id):
    detail = work.report_detail(report_id)
    snapshot, report, manifest = detail["snapshot"], detail["report"], detail["manifest"]
    exports = {}
    for format in ("zip", "json", "html", "csv"):
        row = work.report_export(report_id, format)
        exports[format] = {**row, "path": str(row["path"])}
    result = snapshot["result"]
    return {
        "schema": "stellar-forge.groundwater-report-source.v1",
        "workspaceId": snapshot["workspace_id"],
        "project": {"id": snapshot["project"]["id"], "name": snapshot["project"]["name"]},
        "report": {"id": report["id"], "sha256": report["sha256"], "title": snapshot["title"],
                   "operationId": report["operation_id"], "requestSha256": report["request_sha256"],
                   "frozenAt": snapshot["frozen_at"]},
        "run": {"id": result["run_id"], "sourceSha256": result["source_sha256"],
                "editionSha256": result["edition_sha256"], "resultSha256": manifest["result_sha256"]},
        "edition": {"id": snapshot["edition"]["id"], "name": snapshot["edition"]["name"]},
        "review": snapshot["review"],
        "timeSemantics": result["time_semantics"],
        "units": {key: value["units"] for key, value in result["engines"].items()},
        "findings": result["findings"],
        "manifest": {"bytes": report["manifest"]["bytes"], "sha256": report["manifest"]["sha256"],
                     "files": len(manifest["files"])},
        "exports": exports,
        "interpretation": "This is the exact frozen scientific report and its named technical review. Merchant terms, payment, independent use and customer acceptance remain separate records."
    }

def compare_package(package, expected):
    m = package["manifest"]
    need(m.get("schema") == "starforge.groundwater-package.v1" and m.get("kind") == "report",
         "Select an original complete groundwater report package.")
    for key, target in (("workspace_id","workspaceId"),("project_id","projectId"),
                        ("report_id","reportId"),("report_sha256","reportSha256"),
                        ("result_sha256","resultSha256"),("source_sha256","sourceSha256"),
                        ("edition_sha256","editionSha256"),("run_id","runId")):
        need(m.get(key) == expected.get(target), "The original report binding differs: " + key)
    need(package["manifest_sha256"] == expected["manifestSha256"],
         "The original report manifest differs.")
    need(package["archive"]["sha256"] == expected["archiveSha256"]
         and package["archive"]["bytes"] == expected["archiveBytes"],
         "The original report ZIP differs.")

def pack_directory(root, destination, originals):
    from groundwater_workspace.common import (Lock, contained, verify_inventory, verify_file,
                                              json_bytes, read_json, sync_directory, write_json)
    root, destination = Path(root).resolve(), Path(destination).resolve()
    need(root.is_dir() and not root.is_symlink(), "Select the original report desk.")
    need(root not in destination.parents and root != destination,
         "The complete export must be outside the original report desk.")
    verify_inventory(root, originals)
    manifest = {"schema":"stellar-forge.groundwater-report-desk-package.v1",
                "desk":read_json(root/"desk.json"),"files":originals}
    mraw = json_bytes(manifest)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Lock(destination.with_name("." + destination.name + ".lock")):
        # The same expected manifest is checked on an existing completed export.
        # A missing committed archive is rejected by the Node operation before here.
        if destination.exists():
            checked=inspect_desk_archive(destination)
            need(checked["manifest"]==manifest,"The existing complete export contains a different frozen file set.")
            return checked
        temporary = destination.with_name("." + destination.name + ".pending")
        if temporary.exists():
            need(temporary.is_file() and not temporary.is_symlink(), "The retained export staging path differs.")
            temporary.unlink()
        with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for row in originals:
                path = contained(root, row["path"])
                verify_file(path,row)
                archive.write(path,"desk/"+row["path"])
            archive.writestr("MANIFEST.json",mraw)
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        checked = inspect_desk_archive(temporary)
        need(checked["manifest"] == manifest,"The staged complete desk export differs.")
        os.link(temporary,destination)
        sync_directory(destination.parent)
        temporary.unlink()
        return inspect_desk_archive(destination)

def inspect_desk_archive(path):
    from groundwater_workspace.common import relative, file_info
    path=Path(path).resolve()
    need(path.is_file() and not path.is_symlink(),"Select the retained complete desk archive.")
    identity=file_info(path)
    with zipfile.ZipFile(path) as archive:
        rows=archive.infolist()
        files=[r for r in rows if not r.is_dir()]
        need(len(files)<=20000 and sum(r.file_size for r in files)<=512*1024*1024,
             "The complete desk archive exceeds its supported bound.")
        names=[r.filename for r in files]
        need(len(names)==len(set(names)) and "MANIFEST.json" in names,"Retain unique complete desk members.")
        for r in rows:
            relative(r.filename.rstrip("/"))
            mode=(r.external_attr>>16)&0xFFFF
            need(not stat.S_ISLNK(mode) and (r.is_dir() or not mode or stat.S_IFMT(mode) in (0,stat.S_IFREG)),
                 "A desk archive contains a linked or special member.")
        raw=archive.read("MANIFEST.json")
        need(len(raw)<=16*1024*1024,"The desk manifest exceeds its bound.")
        manifest=json.loads(raw)
        need(manifest.get("schema")=="stellar-forge.groundwater-report-desk-package.v1"
             and manifest.get("desk",{}).get("schema")=="stellar-forge.groundwater-report-desk.v1",
             "Select the original report-desk package.")
        expected={"desk/"+relative(row["path"]):row for row in manifest["files"]}
        need(len(expected)==len(manifest["files"]) and set(expected)|{"MANIFEST.json"}==set(names),
             "The complete desk manifest and archive member sets differ.")
        need("desk/desk.json" in expected and json.loads(archive.read("desk/desk.json"))==manifest["desk"],
             "The original desk identity differs.")
        for name,row in expected.items():
            h=hashlib.sha256();count=0
            with archive.open(name) as stream:
                while chunk:=stream.read(1024*1024):
                    h.update(chunk);count+=len(chunk)
            need(h.hexdigest()==row["sha256"] and count==row["bytes"],
                 "An original desk archive member differs: "+name)
    need(file_info(path)==identity,"The complete archive changed while reading.")
    return {"archive":identity,"manifestSha256":sha(raw),"manifest":manifest}

def restore_desk(path,destination):
    from groundwater_workspace.common import (Lock, atomic_bytes, contained, json_bytes,
                                              read_json, verify_inventory, write_json)
    checked=inspect_desk_archive(path)
    root=Path(destination).resolve()
    root.mkdir(parents=True,exist_ok=True)
    request={"schema":"stellar-forge.groundwater-report-desk-restore.v1",
             "archive":checked["archive"],"manifestSha256":checked["manifestSha256"],
             "deskId":checked["manifest"]["desk"]["id"]}
    with Lock(root/".restore.lock"):
        from groundwater_workspace.delivery import _publish_destination_request
        _publish_destination_request(root,"restore-request.json",request,".restore.lock")
        desk=root/"desk"
        with zipfile.ZipFile(path) as archive:
            for row in checked["manifest"]["files"]:
                raw=archive.read("desk/"+row["path"])
                need(len(raw)==row["bytes"] and sha(raw)==row["sha256"],"The original archive changed.")
                atomic_bytes(contained(desk,row["path"]),raw,create_only=True)
        verify_inventory(desk,checked["manifest"]["files"])
        write_json(root/"restore.json",{**request,"directory":str(desk)},create_only=True)
    return {**request,"directory":str(desk),"files":len(checked["manifest"]["files"])}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--application",required=True)
    args=parser.parse_args()
    application=Path(args.application).resolve()
    need((application/"groundwater_workspace"/"store.py").is_file(),"Install the reviewed original groundwater application.")
    sys.path.insert(0,str(application))
    from groundwater_workspace import Workbench
    from groundwater_workspace.common import Problem, verify_file
    from groundwater_workspace.delivery import inspect_package, receive_package
    value=json.loads(sys.stdin.buffer.read(16*1024*1024+1))
    action,p=value["action"],value["payload"]
    if action in ("list","describe"):
        work=Workbench(p["workspace"],application=application,existing_only=True)
        if action=="list":
            state=work.state()
            return {"workspace":state["workspace"],"projects":state["projects"],"reports":state["reports"]}
        return report_view(work,p["reportId"])
    if action == "inspect-unbound":
        package=inspect_package(p["archive"])
        m=package["manifest"]
        need(m.get("schema")=="starforge.groundwater-package.v1" and m.get("kind")=="report", "Select a complete original groundwater report ZIP.")
        binding={"workspaceId":m["workspace_id"],"projectId":m["project_id"],"reportId":m["report_id"],"reportSha256":m["report_sha256"],"runId":m["run_id"],"sourceSha256":m["source_sha256"],"editionSha256":m["edition_sha256"],"resultSha256":m["result_sha256"],"manifestSha256":package["manifest_sha256"],"archiveSha256":package["archive"]["sha256"],"archiveBytes":package["archive"]["bytes"]}
        return {"package":package,"binding":binding}
    if action in ("inspect","receive"):
        package=inspect_package(p["archive"])
        compare_package(package,p["expected"])
        if action=="inspect":
            return {"package":package}
        result=receive_package(p["archive"],p["directory"])
        need(result["receipt"]["decision"]=="unreviewed","The original package receiving decision differs.")
        return result
    if action=="pack":
        return pack_directory(p["directory"],p["destination"],p["files"])
    if action=="inspect-desk":
        return inspect_desk_archive(p["archive"])
    if action=="restore":
        return restore_desk(p["archive"],p["destination"])
    raise ValueError("Unknown original report adapter command.")

if __name__=="__main__":
    try:
        print(json.dumps(main(),ensure_ascii=False,default=str))
    except BaseException as exc:
        method=getattr(exc,"as_dict",None)
        error=method() if callable(method) else {"code":type(exc).__name__,"message":str(exc)}
        print(json.dumps({"error":error},ensure_ascii=False))
        sys.exit(0)
