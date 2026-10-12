#!/usr/bin/env python3
"""MIT. Operate original PRS examples through the installed batch console, MCP and CLI."""
from __future__ import annotations
import argparse,ast,hashlib,json,os,shutil,subprocess,sys,threading,time,traceback,zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-root",required=True,help="Original repository-shaped installed source or pinned checkout")
parser.add_argument("--out",required=True,help="Persistent private output directory")
parser.add_argument("--work",help="New private working directory; defaults to OUT/work")
parser.add_argument("--resume-empty",action="store_true",help="Continue the same initialized empty workspace after an interrupted pre-intake browser step")
parser.add_argument("--node",default=shutil.which("node") or "node")
parser.add_argument("--browser-executable",required=True,help="Existing Chromium executable")
parser.add_argument("--playwright-package",required=True,help="Existing playwright/package.json")
args=parser.parse_args()
source_root=Path(args.source_root).expanduser().resolve(strict=True)
output=Path(args.out).expanduser().absolute();output.mkdir(mode=0o700,parents=True,exist_ok=True);output.chmod(0o700)
work=Path(args.work).expanduser().absolute() if args.work else output/"work"
if args.resume_empty:
    if not work.is_dir() or not (output/"Customer_Operation.json").is_file():raise RuntimeError("Resume requires the original working directory and operation report")
else:
    work.mkdir(mode=0o700,parents=True,exist_ok=False)
clinical=source_root/"stellar/scf-starforge-20261009/sf30-seller-sdk/clinicaltrials"
manifest=json.loads((HERE/"batch-operator-source.json").read_text())
report={"schema":"stellar-forge.disclosure-batch-customer-operation.v1","sourceCommit":manifest["sourceCommit"],"startedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"phases":[],"passed":False}
if args.resume_empty:
    prior=(output/"Customer_Operation.json").read_bytes()
    previous=json.loads(prior)
    if previous.get("passed") or previous.get("batchId"):raise RuntimeError("This entrypoint resumes only a pre-intake operation; continue an existing batch through its retained actions")
    previous_path=output/("Previous_Operation_"+hashlib.sha256(prior).hexdigest()[:16]+".json")
    if previous_path.exists() and previous_path.read_bytes()!=prior:raise RuntimeError("Original prior operation changed")
    previous_path.write_bytes(prior);previous_path.chmod(0o600)
    report["resumedFrom"]={"file":previous_path.name,"sha256":hashlib.sha256(prior).hexdigest(),"startedAt":previous.get("startedAt")}
workspace=server=worker=None
def sha(data):return hashlib.sha256(data).hexdigest()
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    raw=data.encode("utf-8") if isinstance(data,str) else data
    with path.open("wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
    path.chmod(0o600)
def jsonfile(path,value):write(path,json.dumps(value,ensure_ascii=False,allow_nan=False,indent=2)+"\n")
def phase(name,**values):
    row={"phase":name,"at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),**values};report["phases"].append(row)
    jsonfile(output/"Customer_Operation.json",report);print(json.dumps(row,ensure_ascii=False),flush=True)
def required(value,message):
    if not value:raise RuntimeError(message)
def invoke(argv,*,env,timeout=300):
    result=subprocess.run(argv,capture_output=True,text=True,env=env,timeout=timeout)
    if result.returncode:raise RuntimeError("Original command failed ("+str(result.returncode)+"): "+result.stderr[-3500:]+" "+result.stdout[-1000:])
    return json.loads(result.stdout)
def close_server():
    global server,worker
    if server is not None:
        if worker is not None and worker.is_alive():server.shutdown();worker.join()
        server.server_close();server=None;worker=None
def close_workspace():
    global workspace
    if workspace is not None:workspace.close();workspace=None
def archive_workspace(directory,target):
    with zipfile.ZipFile(target,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(directory.rglob("*")):
            if p.is_file() and not p.is_symlink() and not p.name.endswith(("-wal","-shm")) and "tmp" not in p.relative_to(directory).parts:
                z.write(p,p.relative_to(directory).as_posix())
    target.chmod(0o600)
try:
    for item in manifest["files"]:
        path=source_root/item["path"];raw=path.read_bytes()
        required(len(raw)==item["bytes"],"Original source length changed: "+item["path"])
        actual=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
        required(actual==item["gitBlob"],"Original source identity changed: "+item["path"])
        if path.suffix==".py":ast.parse(raw.decode("utf-8"),filename=str(path))
    for name in ["run-browser-receiving.mjs","run-mcp-receiving.mjs"]:
        completed=subprocess.run([args.node,"--check",str(HERE/name)],capture_output=True,text=True,timeout=30)
        required(completed.returncode==0,completed.stderr)
    import lxml.etree
    env=dict(os.environ);env["TMPDIR"]=str(work);env["SF30_XML_NODE"]=args.node;env["NODE_OPTIONS"]="--max-old-space-size=192"
    env["SCF_BROWSER_EXECUTABLE"]=str(Path(args.browser_executable).expanduser().resolve(strict=True))
    env["SCF_PLAYWRIGHT_PACKAGE"]=str(Path(args.playwright_package).expanduser().resolve(strict=True))
    examples=clinical/manifest["examplesDirectory"]
    for item in manifest["examples"]:
        raw=(examples/item["name"]).read_bytes()
        required(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"Published example input changed: "+item["name"])
    jsonfile(output/"Source_Manifest.json",manifest)
    cli=[args.node,str(clinical/"cli.mjs"),"--python",sys.executable]
    original=work/"original-workspace"
    initial=invoke(cli+["--workspace",str(original),"status" if args.resume_empty else "init"],env=env)
    required(not initial["batches"] and not initial["prs"],"Original initialized workspace must be empty")
    phase("original_empty_workspace_resumed" if args.resume_empty else "original_cli_initialized",revision=initial["revision"],lxml=lxml.etree.LXML_VERSION)
    sys.path.insert(0,str(clinical))
    from clinical_workspace import Workspace
    from clinical_server import OperatorServer
    workspace=Workspace(original);server=OperatorServer(workspace,0);worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    browser_output=output/"browser";browser_output.mkdir(mode=0o700,exist_ok=args.resume_empty)
    browser_entry=work/"browser-entry.mjs"
    write(browser_entry,"import {runBatchReceiving} from "+json.dumps((HERE/"run-browser-receiving.mjs").as_uri())+";\nconst result=await runBatchReceiving(JSON.parse(process.env.BATCH_BROWSER_INPUT));\nprocess.stdout.write(JSON.stringify({passed:result.passed,batchId:result.batchId,exportId:result.export?.id})+'\\n');\n")
    browser_env={**env,"BATCH_BROWSER_INPUT":json.dumps({"consoleUrl":server.url,"sourceRoot":str(source_root),"exampleDirectory":str(examples),"outputDirectory":str(browser_output)})}
    browser=subprocess.run([args.node,str(browser_entry)],capture_output=True,text=True,env=browser_env,timeout=600)
    report["browser"]=json.loads((browser_output/"browser-operation.json").read_text()) if (browser_output/"browser-operation.json").exists() else {}
    required(browser.returncode==0,"Browser operation: "+browser.stderr[-4000:])
    required(report["browser"].get("passed") is True,"Whole original browser operation must complete")
    batch_id=report["browser"]["batchId"];batch=workspace.batch(batch_id)
    native_export=workspace.verify_batch_export(report["browser"]["export"]["id"]);declared={f["name"]:f for f in native_export["files"]}
    used=set()
    for entry in batch["entries"]:
        for kind,ident,record in workspace._batch_artifact_closure(entry):
            if kind=="document":
                used.add(ident);required("prs/"+ident+".xml" in declared,"Export omitted an original/candidate XML")
    required(len(batch["entries"])==4 and len({e["inputDocumentId"] for e in batch["entries"]})==3,"Four references must preserve three original inputs")
    required(all(e["review"] for e in batch["entries"]),"Every reference requires its retained disposition")
    portable=output/"Disclosure_Workspace.zip";workspace._portable(portable)
    report.update({"batchId":batch_id,"originalExport":native_export,"originalBatch":batch})
    jsonfile(output/"Original_State.json",workspace.state())
    phase("whole_batch_source_closure",batchId=batch_id,exportId=native_export["id"],sourceDocuments=len(used),files=len(declared),summary=batch["summary"],portableSha256=sha(portable.read_bytes()))
    mcp_entry=work/"mcp-entry.mjs"
    write(mcp_entry,"import {runClinicalTrialsBatchMcpJourney} from "+json.dumps((HERE/"run-mcp-receiving.mjs").as_uri())+";\nconst result=await runClinicalTrialsBatchMcpJourney(JSON.parse(process.env.BATCH_MCP_INPUT));\nprocess.stdout.write(JSON.stringify(result)+'\\n');\n")
    mcp_env={**env,"BATCH_MCP_INPUT":json.dumps({"consoleUrl":server.url,"sourceRoot":str(source_root),"outputDirectory":str(output/"batch-mcp"),"batchId":batch_id,"exportId":native_export["id"],"expectedEntries":len(batch["entries"]),"expectedRevision":workspace._meta("revision"),"sourceManifest":str(HERE/"source-manifest.json")})}
    report["mcp"]=invoke([args.node,str(mcp_entry)],env=mcp_env,timeout=480)
    required(report["mcp"].get("passed") is True,"Original same-owner MCP receiving must complete")
    phase("same_owner_mcp_complete",files=report["mcp"]["receivedFiles"],bytes=report["mcp"]["receivedBytes"],ownerRevision=report["mcp"]["ownerRevision"])
    close_server();close_workspace()
    archive_workspace(original,output/"Original_Workspace_Backup.zip")
    receiving=work/"customer-workspace"
    invoke(cli+["--workspace",str(receiving),"init"],env=env)
    imported=invoke(cli+["--workspace",str(receiving),"restore","--file",str(portable)],env=env)
    required(imported["result"]["restored"] is True,"Original customer CLI restore must complete")
    exported=invoke(cli+["--workspace",str(receiving),"act","batch.export","--json",json.dumps({"batchId":batch_id})],env=env)
    workspace=Workspace(receiving);reopened=workspace.batch(batch_id)
    for field in ["id","createdAt","updatedAt","name","reviewer","note","entries"]:
        required(reopened.get(field)==batch.get(field),"Cold receiving changed batch "+field)
    for ident in used:
        workspace.prs_document(ident);required(sha(workspace._verified("prs/"+ident+".xml",ident).read_bytes())==ident,"Cold receiving changed original XML")
    received_export=workspace.verify_batch_export(exported["result"]["id"])
    report["receiving"]={"revision":workspace._meta("revision"),"batchId":batch_id,"exportId":received_export["id"],"summary":reopened["summary"],"sourceDocumentIds":sorted(used),"files":received_export["files"]}
    phase("cold_cli_receiving_complete",batchId=batch_id,sourceDocuments=len(used),reviewedEntries=len(reopened["entries"]),exportId=received_export["id"])
    close_workspace()
    final=invoke(cli+["--workspace",str(receiving),"status"],env=env)
    required(any(b["id"]==batch_id for b in final["batches"]),"Cold CLI status lost original batch")
    report["passed"]=True;report["completedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
except BaseException as error:
    report["error"]={"type":type(error).__name__,"message":str(error),"traceback":traceback.format_exc()}
    print(json.dumps({"operationError":report["error"]}),flush=True)
finally:
    try:close_server()
    except BaseException as error:report["serverCloseError"]=str(error)
    try:close_workspace()
    except BaseException as error:report["workspaceCloseError"]=str(error)
    try:
        original=work/"original-workspace"
        if original.exists():archive_workspace(original,output/"Original_Workspace_Backup.zip")
        for p in sorted((clinical/"prs"/manifest["provenanceDirectory"]).rglob("*")):
            if p.is_file():write(output/"Original_Example_Provenance"/p.relative_to(clinical/"prs"/manifest["provenanceDirectory"]),p.read_bytes())
        for p in sorted((HERE/"partner").glob("*.md")):write(output/"Partner_Workshare"/p.name,p.read_bytes())
        write(output/"BATCH_RECEIVING.md",(clinical/"BATCH_RECEIVING.md").read_bytes())
        jsonfile(output/"Customer_Operation.json",report)
        bundle=output/"Disclosure_Batch_Customer_Receiving.zip"
        with zipfile.ZipFile(bundle,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for p in sorted(output.rglob("*")):
                if p.is_file() and p!=bundle and work not in p.parents:archive.write(p,p.relative_to(output).as_posix())
        bundle.chmod(0o600)
        print(json.dumps({"completed":report["passed"],"batchId":report.get("batchId"),"outputDirectory":str(output),"bundle":{"path":str(bundle),"bytes":bundle.stat().st_size,"sha256":sha(bundle.read_bytes())},"phases":report["phases"]}),flush=True)
    except BaseException as error:
        print(json.dumps({"preservationError":str(error),"outputDirectory":str(output),"traceback":traceback.format_exc()}),flush=True)
sys.exit(0 if report["passed"] else 1)
