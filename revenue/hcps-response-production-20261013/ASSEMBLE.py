#!/usr/bin/env python3
"""Assemble selected original PDF pages from one complete HCPS workspace."""
from __future__ import annotations
import argparse, base64, hashlib, io, json, os, pathlib, shutil, subprocess, sys, uuid
def identity(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
def parent_sync(path):
    fd=os.open(str(path),os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def retain(path, raw):
    path=pathlib.Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    candidate=path.parent/("."+path.name+"."+str(uuid.uuid4())+".receiving")
    try:
        with candidate.open("xb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try: os.link(candidate,path,follow_symlinks=False)
        except FileExistsError:
            if path.is_symlink() or not path.is_file() or path.read_bytes()!=raw:
                raise ValueError("Existing complete output differs: "+str(path))
        parent_sync(path.parent)
    finally:
        try: candidate.unlink()
        except FileNotFoundError: pass
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package",type=pathlib.Path)
    parser.add_argument("--out",type=pathlib.Path,required=True)
    parser.add_argument("--edition",type=int)
    parser.add_argument("--node",default=os.environ.get("HCPS_NODE","node"))
    args=parser.parse_args()
    from pypdf import PdfReader,PdfWriter
    source=args.package.resolve(strict=True); root=pathlib.Path(__file__).resolve().parent
    command=[args.node,str(root/"VERIFY.cjs"),str(source)]
    if args.edition is not None: command.append(str(args.edition))
    lease=()
    if os.environ.get("HCPS_LEASE_FD"):
        inherited=int(os.environ["HCPS_LEASE_FD"]); actual=os.fstat(inherited); expected=os.stat(pathlib.Path(os.environ["HCPS_CASE_ROOT"])/"operation.lock")
        if (actual.st_dev,actual.st_ino)!=(expected.st_dev,expected.st_ino): raise ValueError("Original inherited case lease differs.")
        lease=(inherited,)
    validation=subprocess.run(command,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=lease)
    verified=json.loads(validation.stdout); original=source.read_bytes()
    if verified["packageSha256"]!=hashlib.sha256(original).hexdigest():
        raise ValueError("Original package changed after complete validation.")
    outer=json.loads(original); package=outer["package"] if outer.get("format")=="commons.hcps.working-copy.v1" else outer
    workspace=package["workspace"]; draft=workspace["draft"]
    if args.edition is not None: draft=next(e["draft"] for e in workspace["editions"] if e["number"]==args.edition)
    rows=verified["manifest"]["rows"]
    if not rows: raise ValueError("Select the complete explicit PDF page order before assembly.")
    out=args.out.resolve()
    if out==source.parent or source.is_relative_to(out):
        raise ValueError("Use a dedicated output directory outside the input package location.")
    out.mkdir(parents=True,exist_ok=True)
    writer=PdfWriter(); used={}; pages=[]; source_pages={}
    for row in rows:
        doc=row["document"]; raw=base64.b64decode(workspace["objects"][doc["sha256"]]["base64"],validate=True)
        if identity(raw)!={"bytes":doc["bytes"],"sha256":doc["sha256"]}:
            raise ValueError("An original selected document differs.")
        try: reader=PdfReader(io.BytesIO(raw),strict=True)
        except Exception as error: raise ValueError("Selected source is not a readable original PDF: "+doc["name"]) from error
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("Provide an unlocked approved original PDF: "+doc["name"])
        source_pages[doc["id"]]=len(reader.pages)
        relative="originals/"+doc["sha256"]+".pdf"
        if doc["id"] not in used:
            retain(out/relative,raw); used[doc["id"]]={**doc,"retainedPath":relative,"pageCount":len(reader.pages)}
        for page in row["pages"]:
            if page<1 or page>len(reader.pages): raise ValueError("Requested page outside complete original: "+doc["name"]+" page "+str(page))
            writer.add_page(reader.pages[page-1])
            pages.append({"outputPage":len(pages)+1,"documentId":doc["id"],"sourceSha256":doc["sha256"],"originalPage":page,"sourceName":doc["name"]})
    writer.add_metadata({"/Title":"HCPS commissioning response — assembled original pages","/Subject":"Exact selected original pages; review original signed forms and issuer checklist before submission"})
    buffer=io.BytesIO(); writer.write(buffer); combined=buffer.getvalue()
    inspection=PdfReader(io.BytesIO(combined),strict=True)
    if len(inspection.pages)!=len(pages): raise ValueError("Complete output page count differs.")
    retain(out/"Complete_Response_Original_Pages.pdf",combined)
    retain(out/"Original_Complete_Workspace.json",original)
    record={"format":"commons.hcps.complete-pdf-assembly.v1","originalPackage":identity(original),
            "workspaceId":workspace["workspaceId"],"edition":verified["edition"],"manifest":verified["manifest"],
            "sourceDocuments":list(used.values()),"pages":pages,"output":{"path":"Complete_Response_Original_Pages.pdf",**identity(combined)},
            "readiness":verified["readiness"],"pageRepresentation":"Original selected PDF page objects are copied into the combined PDF; each unchanged complete original file is retained separately."}
    retain(out/"assembly.json",(json.dumps(record,indent=2,ensure_ascii=False)+"\n").encode())
    print(json.dumps(record,ensure_ascii=False))
if __name__=="__main__":
    try: main()
    except Exception as error:
        print(type(error).__name__+": "+str(error),file=sys.stderr); sys.exit(1)
