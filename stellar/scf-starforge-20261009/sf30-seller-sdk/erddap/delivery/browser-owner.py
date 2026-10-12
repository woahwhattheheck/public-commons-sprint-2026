"""MIT. One original ERDDAP HTTP/browser/customer receiving lifetime.

The caller supplies actual complete source packets. The two original Workspaces,
their servers and one Chromium process are owned and closed by this invocation.
No provider acquisition is repeated by this driver.
"""
from __future__ import annotations
import argparse
import datetime
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import zipfile

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1048576),b""):h.update(block)
    return h.hexdigest()

def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)+"\n").encode()

def save(path,value):
    path=Path(path)
    fd,name=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            os.fchmod(stream.fileno(),0o600);stream.write(encoded(value));stream.flush();os.fsync(stream.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def load(path,default=None):
    return json.loads(Path(path).read_text()) if Path(path).exists() else default

def private_dir(path):
    path=Path(path).resolve()
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    return path

def stop_child(child):
    if child and child.poll() is None:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            child.wait(timeout=8)

def source_manifest(root):
    names=["erddap_source.py","erddap_workspace.py","erddap_server.py","public/index.html","public/app.js","public/style.css",
           "delivery/browser-owner.py","delivery/browser-phase.cjs","provider_handoff.py","provider_handoff_workspace.py"]
    return {name:{"bytes":(root/name).stat().st_size,"sha256":digest(root/name)} for name in names}

def verify_exports(output,result):
    verified=[]
    for item in result.get("exports",[]):
        name=item.get("file")
        if not isinstance(name,str) or Path(name).name!=name:raise ValueError("Unexpected original export filename")
        target=output/name
        if not target.is_file() or target.stat().st_size!=item["bytes"] or digest(target)!=item["sha256"]:
            raise ValueError("Completed original export changed: "+name)
        with zipfile.ZipFile(target) as archive:
            names=archive.namelist()
            if len(names)!=len(set(names)) or any(n.startswith("/") or ".." in Path(n).parts for n in names):
                raise ValueError("Unexpected original export members")
            members={}
            for info in archive.infolist():
                h=hashlib.sha256()
                with archive.open(info) as stream:
                    for block in iter(lambda:stream.read(65536),b""):h.update(block)
                members[info.filename]={"bytes":info.file_size,"sha256":h.hexdigest()}
            if name.startswith("dataset-"):
                if set(names)!={"data.csv","dataset.json","erddap-lineage.json"}:raise ValueError("Seller dataset export is incomplete")
                index=int(name.split("-")[1].split(".")[0]);build=result["builds"][index]
                for filename in ("data.csv","dataset.json"):
                    if members[filename]["sha256"]!=build["files"][filename]["sha256"]:
                        raise ValueError("Exported native dataset differs from the completed build")
                lineage=json.loads(archive.read("erddap-lineage.json"))
                if lineage.get("snapshot")!=build["snapshot"]:raise ValueError("ERDDAP lineage snapshot differs")
            elif name.startswith("project-"):
                if len(names)!=6 or not {"manifest.json","plan.json","data.csv","dataset.json","review.json"}.issubset(names):
                    raise ValueError("Complete original customer project is incomplete")
        verified.append({**item,"members":members})
    return verified

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root",type=Path,required=True)
    parser.add_argument("--operation-root",type=Path,required=True)
    parser.add_argument("--workspace",type=Path)
    parser.add_argument("--source-packet",type=Path,action="append",default=[])
    parser.add_argument("--csv-policy",choices=("require-equivalent","canonical-json"),default="require-equivalent",
                        help="Explicit original JSON/CSV policy for the native dataset mapping")
    parser.add_argument("--handoff-profile",type=Path,action="append",default=[],
                        help="Complete original provider profile JSON, bound to a retained source")
    parser.add_argument("--temporary-root",type=Path)
    parser.add_argument("--screenshots",action="store_true")
    args=parser.parse_args()
    root=args.source_root.resolve()
    if not (root/"erddap_workspace.py").is_file():raise ValueError("Select the complete maintained ERDDAP source directory")
    operation=private_dir(args.operation_root)
    output=private_dir(operation/"browser")
    workspace=(args.workspace or operation/"workspace").resolve()
    receiver=operation/"browser-receiving-workspace"
    if workspace==receiver.resolve():raise ValueError("Customer receiving requires its separate saved workspace")
    lock=(output/"owner.lock").open("a+b")
    os.fchmod(lock.fileno(),0o600)
    try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError("This original browser continuation already has an owner")
    # The controller's retained root remains on the caller's selected persistent
    # volume. Only this invocation's browser/native scratch may use another volume.
    temporary_base=args.temporary_root.resolve() if args.temporary_root else private_dir(output/"temporary")
    if not temporary_base.is_dir():raise ValueError("The temporary-root volume does not exist")
    child=None;servers=[];workspaces=[]
    public_path=output/"owner-result.json"
    public=load(public_path,{"schema":"stellar-forge.erddap-browser-owner.v1","generations":[]})
    generation={"startedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"pid":os.getpid(),"state":"starting","csvPolicy":args.csv_policy}
    public["generations"].append(generation)
    with tempfile.TemporaryDirectory(prefix="erddap-browser-",dir=temporary_base) as scratch_name:
        scratch=Path(scratch_name)
        os.environ["TMPDIR"]=str(scratch);os.environ["SQLITE_TMPDIR"]=str(scratch);tempfile.tempdir=str(scratch)
        node=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
        if not node:raise RuntimeError("Select the existing Node runtime")
        os.environ.setdefault("SF30_XML_NODE",node)
        sys.path.insert(0,str(root))
        from erddap_workspace import Workspace, load_json
        from erddap_server import OperatorServer
        from provider_handoff_workspace import HandoffStore
        from provider_handoff import MAX_PROFILE
        try:
            original=Workspace(workspace,create=not workspace.exists());workspaces.append(original)
            # Each engine is the maintained original native engine. These leases
            # remain held until both HTTP workers and their accepted calls drain.
            receiving=Workspace(receiver,create=not receiver.exists());workspaces.append(receiving)
            inputs=[]
            packets=list(args.source_packet)
            if not packets:
                for item in original.state()["sources"]:
                    packets.append(original.root/"sources"/(item["id"]+".erddap"))
            if not packets:raise ValueError("Provide at least one actual complete ERDDAP source packet or a workspace retaining one")
            seen=set()
            for packet in packets:
                p=packet.resolve()
                if not p.is_file() or p.is_symlink():raise ValueError("Original source packet must be a retained regular file")
                sha=digest(p)
                if sha in seen:continue
                seen.add(sha)
                inputs.append({"path":str(p),"name":p.name,"label":p.stem,"sha256":sha,"bytes":p.stat().st_size})
            input_identity=hashlib.sha256(encoded({"csvPolicy":args.csv_policy,
                "sources":[{"sha256":x["sha256"],"bytes":x["bytes"],"name":x["name"]} for x in inputs]})).hexdigest()
            handoff_inputs=[];handoff_sources=set();handoffs=HandoffStore(original)
            for filename in args.handoff_profile:
                profile_path=filename.resolve()
                with profile_path.open("rb") as stream:raw=stream.read(MAX_PROFILE+1)
                if len(raw)>MAX_PROFILE:raise ValueError("The supplied provider profile exceeds the original profile byte limit")
                profile=load_json(raw)
                if not isinstance(profile,dict) or profile.get("schema")!="stellar-forge.erddap-provider-handoff.v1":
                    raise ValueError("Supply the complete direct original provider profile object")
                source_id=profile.get("sourceId")
                if source_id in handoff_sources:raise ValueError("Choose one original provider profile per source")
                if source_id not in seen:raise ValueError("The profile must bind one of this owner's original complete source packets")
                handoff_sources.add(source_id)
                # A review bundle preserves unanswered provider appointments.
                # A fresh packet is imported by the same browser before preview;
                # an already retained source can be reviewed immediately.
                retained_ids={item["id"] for item in original.state()["sources"]}
                preview=handoffs.preview(source_id,profile) if source_id in retained_ids else None
                chosen=preview["profile"] if preview else profile
                if profile.get("dataEdition") not in ("require-equivalent","canonical-json"):
                    raise ValueError("The complete provider profile must retain its explicit source edition policy")
                if chosen.get("dataEdition")!=profile["dataEdition"]:
                    raise ValueError("Provider preview changed the supplied source edition policy")
                handoff_inputs.append({"path":str(profile_path),"name":profile_path.name,"bytes":len(raw),
                    "sha256":hashlib.sha256(raw).hexdigest(),"sourceId":source_id,"profile":chosen,
                    "profileSha256":hashlib.sha256(encoded(chosen)).hexdigest(),"review":preview["review"] if preview else None})
            handoff_identity=hashlib.sha256(encoded([{"sourceId":x["sourceId"],"sha256":x["sha256"],"bytes":x["bytes"]} for x in handoff_inputs])).hexdigest()
            ports=load(output/"ports.json",{})
            original_server=OperatorServer(original,ports.get("original",0))
            original_thread=threading.Thread(target=original_server.serve_forever,name="erddap-original-http")
            original_thread.start();servers.append((original_server,original_thread))
            receiver_server=OperatorServer(receiving,ports.get("receiver",0))
            receiver_thread=threading.Thread(target=receiver_server.serve_forever,name="erddap-customer-http")
            receiver_thread.start();servers.append((receiver_server,receiver_thread))
            save(output/"ports.json",{"original":original_server.server_port,"receiver":receiver_server.server_port})
            ready={"schema":"stellar-forge.erddap-browser-ready.v1","workspace":str(workspace),"receiverWorkspace":str(receiver),
                   "workspaceId":original_server.workspace_id,"receiverWorkspaceId":receiver_server.workspace_id,
                   "original":original_server.startup(),"receiver":receiver_server.startup(),
                   "inputs":inputs,"inputManifestSha256":input_identity,"csvPolicy":args.csv_policy,"sourceFiles":source_manifest(root),
                   "handoffProfiles":handoff_inputs,"handoffManifestSha256":handoff_identity,
                   "outputDirectory":str(output),"screenshots":args.screenshots}
            save(output/"ready.private.json",ready)
            generation.update(state="browser",inputManifestSha256=input_identity,sourceFiles=ready["sourceFiles"])
            save(public_path,public)
            child=subprocess.Popen([node,str(root/"delivery/browser-phase.cjs"),str(output/"ready.private.json")],
                                   env=os.environ.copy(),start_new_session=True)
            code=child.wait()
            result=load(output/"browser-result.json",{})
            if code or result.get("status")!="ERDDAP_BROWSER_COMPLETE" or result.get("csvPolicy")!=args.csv_policy:
                raise RuntimeError("The retained browser phase did not complete; inspect browser/browser-result.json")
            generation["exports"]=verify_exports(output,result)
            # Shut down HTTP first; no subsequent request may borrow either
            # workspace while its native engine and SQLite connection are closed.
            for server,thread in reversed(servers):
                server.shutdown();server.server_close();thread.join(timeout=10)
                if thread.is_alive():raise RuntimeError("Original HTTP worker has not closed")
            servers.clear()
            for current in reversed(workspaces):current.close()
            workspaces.clear()
            reopened=[];handoff_reopened=[]
            with Workspace(receiver) as check:
                for item in result["receiving"]:
                    view=check.build_view(item["build"])
                    query=check.query(item["build"],{"limit":"1"})
                    if (view["native"]["snapshot"]!=item["snapshot"] or query["response"]["status"]!=200 or
                        query["response"]["body"]["rows"]!=item["firstQuery"]["rows"]):
                        raise ValueError("The closed and reopened customer workspace differs from its original edition")
                    reopened.append({"build":item["build"],"snapshot":view["native"]["snapshot"],"rowCount":view["rowCount"],
                                     "fields":query["response"]["body"]["fields"],"rows":query["response"]["body"]["rows"]})
                receiving_handoffs=HandoffStore(check)
                for item in result.get("providerReceiving",[]):
                    value=receiving_handoffs.received(item["sha256"])
                    receipt=value["receipt"]
                    retained=receiving_handoffs.received_path(item["sha256"])
                    if (digest(retained)!=item["sha256"] or retained.stat().st_size!=item["bytes"] or
                        receipt["revision"]!=item["revision"] or receipt["sourceId"]!=item["sourceId"] or
                        receipt["rowCount"]!=item["rowCount"] or receipt["mode"]!=item["mode"]):
                        raise ValueError("The reopened provider handoff differs from its original exact bundle")
                    handoff_reopened.append({"sha256":item["sha256"],"bytes":item["bytes"],"revision":receipt["revision"],
                        "sourceId":receipt["sourceId"],"mode":receipt["mode"],"rowCount":receipt["rowCount"],
                        "stationCount":receipt["stationCount"],"ready":receipt["ready"]})
            generation.update(state="complete",receiverReopened=reopened,handoffReceiverReopened=handoff_reopened,
                              completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            public["status"]="ERDDAP_OPERATOR_RECEIVING_COMPLETE"
            public["result"]={"file":"browser-result.json","bytes":(output/"browser-result.json").stat().st_size,
                              "sha256":digest(output/"browser-result.json")}
            save(public_path,public)
            print(json.dumps({"status":public["status"],"result":str(public_path),"sources":len(inputs),
                              "builds":len(result["builds"]),"csvPolicy":args.csv_policy,"receiverReopened":len(reopened),"providerBundlesReopened":len(handoff_reopened)}),flush=True)
        except BaseException as error:
            generation.update(state="failed",error={"type":type(error).__name__,"message":str(error)[:1600]},
                              endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            public["status"]="RETAINED_FOR_CONTINUATION"
            # Original workspaces, exact source packets, completed exports and
            # browser checkpoints remain in the persistent operation directory.
            save(public_path,public)
            raise
        finally:
            stop_child(child)
            for server,thread in reversed(servers):
                server.shutdown();server.server_close();thread.join(timeout=10)
            for current in reversed(workspaces):current.close()
            lock.close()

if __name__=="__main__":
    main()
