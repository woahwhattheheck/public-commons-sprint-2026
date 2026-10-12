"""Run and retain the whole original Research receiving and operating journey."""
import datetime,hashlib,json,os,stat,subprocess,sys,tarfile,uuid
from pathlib import Path
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def need(value,message):
    if not value:raise RuntimeError(message)
def sha(path):
    h=hashlib.sha256();size=0
    with path.open("rb") as stream:
        for part in iter(lambda:stream.read(1024*1024),b""):h.update(part);size+=len(part)
    return {"bytes":size,"sha256":h.hexdigest()}
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temporary=path.with_name("."+path.name+"."+uuid.uuid4().hex)
    with temporary.open("x",encoding="utf-8") as stream:
        os.chmod(temporary,0o600);json.dump(value,stream,ensure_ascii=False,indent=2);stream.write("\n");stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)
def selected_input(path,value):
    if path.exists():
        need(json.loads(path.read_text())==value,"Existing original operation input differs: "+str(path))
    else:save(path,value)
input_file=Path(sys.argv[1]).resolve(strict=True)
config=json.loads(input_file.read_text())
root=input_file.parent
need(config["directory"]==str(root),"Original native directory differs.")
source=root/"project";out=source/"results";out.mkdir(parents=True,exist_ok=True,mode=0o700)
result_path=out/"run-result.json"
prior=json.loads(result_path.read_text()) if result_path.exists() else None
need(not prior or prior["operationId"]==config["operationId"],"Existing native result belongs to another operation.")
result={"schema":"sf88.research-client.native-worker-result.v1","operationId":config["operationId"],
 "sourceMerge":config["sourceMerge"],"dossierId":config["dossierId"],"questionId":config["questionId"],
 "startedAt":prior.get("startedAt") if prior else now(),"attempts":[*(prior.get("attempts",[]) if prior else []),now()],
 "state":"running","steps":dict(prior.get("steps",{})) if prior else {}}
env=dict(os.environ,NODE_OPTIONS="--max-old-space-size=256")
def command(name,argv):
    result["currentStep"]=name;save(result_path,result)
    print(json.dumps({"step":name,"state":"running","at":now()}),flush=True)
    completed=subprocess.run(argv,cwd=source,env=env,check=False)
    result["steps"][name]={"state":"complete" if completed.returncode==0 else "attention",
      "exitCode":completed.returncode,"at":now()}
    save(result_path,result)
    need(completed.returncode==0,"Original "+name+" operation needs its retained continuation.")
try:
    setup=json.loads((root/"setup-result.json").read_text())
    need(setup["operationId"]==config["operationId"] and setup["sourceMerge"]==config["sourceMerge"],"Original setup/source identity differs.")
    portable=Path(config["portable"]["path"])
    need(sha(portable)=={"bytes":config["portable"]["bytes"],"sha256":config["portable"]["sha256"]},"Current-master portable changed.")
    receiving={"schema":"sf88.research-client.original-receiving-input.v1",
      "operationId":config["operationId"],"sourceMerge":config["sourceMerge"],
      "sourceRoot":str(source),"directory":str(root/"workspace"),"sourceState":str(root/"source-state"),
      "portableFile":str(portable),"portableBytes":config["portable"]["bytes"],"portableSha256":config["portable"]["sha256"],
      "companionDirectory":str(root/"private-inputs/original-crossref"),"outputDirectory":str(out),
      "dossierId":config["dossierId"],"questionId":config["questionId"],"questionText":config["questionText"],
      "originalRevision":config["originalRevision"],"originalRevisionSha256":config["originalRevisionSha256"],
      "originalEditionCount":config["originalEditionCount"],"originalFindingCount":config["originalFindingCount"],
      "reviewedEditionBytes":config["reviewedEditionBytes"],"reviewedEditionSha256":config["reviewedEditionSha256"],
      "crossrefOperationId":config["crossrefOperationId"]}
    receiving_input=root/"original-receiving-input.json";selected_input(receiving_input,receiving)
    command("original-current-master-and-reviewed-source",[config["node"],str(root/"inbox/receive-original-crossref-operation.mjs"),str(receiving_input)])
    adopted=json.loads((out/"original-receiving-result.json").read_text())
    need(adopted["dossierId"]==config["dossierId"] and adopted["questionId"]==config["questionId"],"Receiving changed original case selectors.")
    operating={"schema":"sf88.research-client.original-native-operation.v1",
      "operationId":config["operationId"],"sourceMerge":config["sourceMerge"],
      "sourceRoot":str(source),"directory":str(root/"workspace"),"outputDirectory":str(out),
      "dossierId":config["dossierId"],"questionId":config["questionId"],"questionText":config["questionText"],
      "serverArguments":["--crossref-state",str(root/"source-state")],"crossrefOperationId":config["crossrefOperationId"],
      "expectedOriginalRevision":config["originalRevision"],"expectedEditionCount":config["originalEditionCount"]+1,
      "expectedFindingCount":config["originalFindingCount"],"analystNote":config["analystNote"],
      "noteSources":config["noteSources"]}
    operating_input=root/"original-operating-input.json";selected_input(operating_input,operating)
    entry=source/"stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/examples/original-client-operation.mjs"
    command("original-cli-merchant-and-delivery",[config["node"],str(entry),str(operating_input)])
    native=json.loads((out/"native-report.json").read_text())
    need(native["state"]=="complete" and native["dossierId"]==config["dossierId"],"Original operating journey is incomplete.")
    need(native["steps"]["same-crossref-operation"]["value"]["operationId"]==config["crossrefOperationId"],"Operating journey changed the original source operation.")
    result.update(state="complete",completedAt=now(),finalRevision=native["finalRevision"],
      originalRevision=config["originalRevision"],receivedEditionId=adopted["editionId"],
      nativeReport="native-report.json",originalReceiving="original-receiving-result.json")
    result.pop("currentStep",None);save(result_path,result)
    selected={}
    def add(path,name):
        path=Path(path);st=path.lstat()
        need(stat.S_ISREG(st.st_mode),"The returned source is not an ordinary file.")
        identity=sha(path)
        need(name not in selected or selected[name]["identity"]==identity,"Duplicate returned file differs.")
        selected[name]={"path":path,"identity":identity}
    for name in ("run-result.json","native-report.json","original-receiving-result.json"):
        add(out/name,"results/"+name)
    add(root/"setup-result.json","source/setup-result.json")
    add(root/"inbox/receive-original-crossref-operation.mjs","source/receive-original-crossref-operation.mjs")
    for name,row in native["artifacts"].items():
        if not isinstance(row,dict) or not row.get("file"):continue
        file=Path(row["file"]).resolve(strict=True)
        need(file.is_relative_to(out.resolve()),"Original returned artifact leaves its selected output directory.")
        identity=sha(file)
        need(identity["bytes"]==row["bytes"] and identity["sha256"]==row["sha256"],"Original returned artifact identity differs.")
        add(file,"delivery/"+name+"/"+file.name)
    for folder,prefix in [(root/"workspace/crossref/operations","crossref/operations"),(root/"source-state/captures","crossref/source-captures")]:
        for path in sorted(folder.rglob("*")):
            if path.is_dir():continue
            add(path,prefix+"/"+str(path.relative_to(folder)))
    manifest={"schema":"sf88.research-client.native-return.v1","operationId":config["operationId"],
      "sourceMerge":config["sourceMerge"],"dossierId":config["dossierId"],"questionId":config["questionId"],
      "originalRevision":config["originalRevision"],"finalRevision":native["finalRevision"],
      "authoritativePortable":native["artifacts"]["portable-gzip"]["sha256"],
      "files":[{"path":name,**row["identity"]} for name,row in sorted(selected.items())]}
    manifest_path=out/"delivery-manifest.json";save(manifest_path,manifest);add(manifest_path,"delivery-manifest.json")
    destination=out/"native-return.tar.gz"
    temporary=out/(".native-return-"+uuid.uuid4().hex+".tar.gz")
    try:
        with tarfile.open(temporary,"w:gz",compresslevel=6) as carrier:
            for name,row in sorted(selected.items()):
                need(sha(row["path"])==row["identity"],"Returned source changed during packaging.")
                carrier.add(row["path"],arcname=name,recursive=False)
        os.chmod(temporary,0o600)
        with temporary.open("rb") as stream:os.fsync(stream.fileno())
        os.replace(temporary,destination)
    finally:temporary.unlink(missing_ok=True)
    artifacts={"schema":"sf88.research-client.native-worker-artifacts.v1","operationId":config["operationId"],
      "sourceMerge":config["sourceMerge"],"state":"complete","finalRevision":native["finalRevision"],
      "nativeReturn":{"file":str(destination),**sha(destination)},
      "portable":native["artifacts"]["portable-gzip"],"html":native["artifacts"]["html"],
      "files":len(selected)}
    save(out/"run-artifacts.json",artifacts)
    print(json.dumps({"state":"complete","operationId":config["operationId"],"finalRevision":native["finalRevision"],
      "nativeReturn":artifacts["nativeReturn"],"report":str(result_path)}),flush=True)
except BaseException as error:
    result.update(state="attention",endedAt=now(),error={"type":type(error).__name__,"message":str(error)})
    save(result_path,result);print(json.dumps({"state":"attention","operationId":config["operationId"],
      "step":result.get("currentStep"),"error":result["error"]}),file=sys.stderr,flush=True)
    raise
