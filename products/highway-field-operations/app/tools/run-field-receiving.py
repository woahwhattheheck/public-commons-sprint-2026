"""Following field-exchange receiving, owned by the original Highway programme.

Uses the maintained Workspace/export/receive APIs. No ArcGIS capture, network
provider, native paired-engine rerun, replacement store or original case rewrite.
"""
import argparse, datetime as dt, fcntl, hashlib, json, os, signal, stat, subprocess, sys, time, uuid, zipfile, shutil
from pathlib import Path

SCHEMA="geocove.field-following-programme.v1"
ORIGINAL="352d7b0a-548a-4d96-82fc-27394485a43f"
ORIGINAL_INPUT_SHA="0c95eafa47df3a7017427cbee6da025c00b5b9ccaa8efabc6c208e6e7681a3ee"
MAX_FILE=512*1024*1024
def canonical(v):return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode("utf-8")
def digest(v):return hashlib.sha256(v if isinstance(v,bytes) else canonical(v)).hexdigest()
def now():return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z")
def need(value,message):
    if not value:raise ValueError(message)
def read_bytes(path,limit=MAX_FILE):
    path=Path(path);s=path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==os.geteuid(),"Read one owned original regular file: "+str(path))
    need(s.st_size<=limit,"Complete file exceeds its declared allowance: "+str(path))
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    try:
        st=os.fstat(fd);need((s.st_dev,s.st_ino)==(st.st_dev,st.st_ino),"Original file changed before read")
        with os.fdopen(fd,"rb",closefd=False) as stream:raw=stream.read(limit+1)
        need(len(raw)==st.st_size and len(raw)<=limit,"Complete original file changed during read")
        return raw
    finally:os.close(fd)
def read(path):return json.loads(read_bytes(path))
def sync_dir(path):
    fd=os.open(path,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def retain(path,value,immutable=True):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    raw=value if isinstance(value,bytes) else canonical(value)
    need(not path.is_symlink(),"Retained file cannot be a link")
    if path.exists() and immutable:
        need(read_bytes(path)==raw,"Original retained bytes differ: "+str(path));return
    temporary=path.with_name(path.name+".new-"+str(uuid.uuid4()))
    fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        with os.fdopen(fd,"wb",closefd=False) as stream:stream.write(raw);stream.flush();os.fsync(fd)
    finally:os.close(fd)
    if immutable and path.exists():
        need(read_bytes(path)==raw,"Original retained bytes differ before publication")
        temporary.unlink()
    else:
        # All calls are under the original single-owner flock, or write the
        # unique self-identity of its sole inherited child. Atomic rename avoids
        # a two-link interval that would make a completed file unreadable.
        os.replace(temporary,path)
    sync_dir(path.parent)
def private(path,create=False):
    p=Path(path).absolute()
    if create:p.mkdir(parents=True,exist_ok=True,mode=0o700)
    need(p.resolve(strict=True)==p and p.is_dir(),"Use an existing canonical private directory")
    s=p.stat();need(s.st_uid==os.geteuid() and not s.st_mode&0o077,"Use an owned private directory")
    return p
def descriptor(path):
    path=Path(path).absolute();before=path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink==1,"Complete descriptor requires one original regular file")
    h=hashlib.sha256();length=0
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    try:
        current=os.fstat(fd);need((before.st_dev,before.st_ino)==(current.st_dev,current.st_ino),"File changed before hashing")
        with os.fdopen(fd,"rb",closefd=False) as stream:
            while True:
                block=stream.read(1024*1024)
                if not block:break
                h.update(block);length+=len(block)
        after=os.fstat(fd)
        need(length==before.st_size and (after.st_size,after.st_mtime_ns)==(before.st_size,before.st_mtime_ns),"File changed while hashing")
    finally:os.close(fd)
    return {"path":str(path),"bytes":length,"sha256":h.hexdigest()}
def executable(value):
    actual=shutil.which(value) if not os.path.isabs(value) else value
    need(actual is not None,"Selected executable is unavailable: "+value)
    resolved=Path(actual).resolve(strict=True);need(os.access(resolved,os.X_OK),"Selected executable cannot run")
    return descriptor(resolved)
def process_identity():
    proc_pid=int(os.readlink("/proc/self"));raw=Path("/proc/self/stat").read_text();fields=raw[raw.rfind(")")+2:].split()
    need(int(raw.split("(",1)[0].strip())==proc_pid,"Visible process identity differs")
    return {"procPid":proc_pid,"procPgid":int(fields[2]),"procSession":int(fields[3]),"namespacePid":os.getpid(),"namespacePgid":os.getpgrp(),"bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),"pidNamespace":os.readlink("/proc/self/ns/pid"),"startTicks":fields[19]}
def same_host(record):return record["bootId"]==Path("/proc/sys/kernel/random/boot_id").read_text().strip() and record["pidNamespace"]==os.readlink("/proc/self/ns/pid")
def alive(record):
    need(same_host(record),"Reconcile the original host/namespace before continuation")
    path=Path("/proc")/str(record["procPid"])/"stat"
    try:raw=path.read_text()
    except FileNotFoundError:return False
    fields=raw[raw.rfind(")")+2:].split()
    return fields[19]==record["startTicks"] and fields[0]!="Z"
def child_entry(args):
    payload=read(args[0]);need(payload["schema"]=="geocove.field-node-attempt.v1","Original child request is required")
    guard=int(os.environ["HIGHWAY_FIELD_GUARD_FD"]);os.fstat(guard)
    identity={**process_identity(),"inputSha256":payload["inputSha256"],"attempt":payload["attempt"]}
    retain(Path(args[0]).parent/"process.json",identity)
    argv=payload["argv"];need(isinstance(argv,list) and argv,"Original complete executable argument vector is required")
    os.execvpe(argv[0],argv,os.environ)
class Following:
    def __init__(self,args):
        self.args=args;self.original_input_path=Path(args.original_input).absolute()
        self.original_raw=read_bytes(self.original_input_path)
        self.original=json.loads(self.original_raw)
        need(self.original["operationId"]==ORIGINAL and digest(self.original)==ORIGINAL_INPUT_SHA,"Use the exact original352d input")
        self.root=private(self.original["directory"])
        need(self.original_input_path==self.root/"input.json","Original input path must belong to the original programme")
        self.guard=os.open(self.root/"programme.lock",os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)
        try:
            st=os.fstat(self.guard);need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==os.geteuid() and not st.st_mode&0o077,"Original programme guard must be a private owned inode")
            fcntl.flock(self.guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.directory=private(self.root/"field-exchange-following",True)
            self.ns=uuid.uuid5(uuid.UUID(ORIGINAL),"following-field-exchange-v1")
            self.source=private(args.source_root)
            sys.path.insert(0,str(self.source))
            from highway.exchange import source_inventory
            self.selection=read(self.source/"source-selection.json")
            source_inventory(self.source,self.selection)
            need(self.selection["sha256"]==args.source_sha256,"Select the exact complete following source")
            self.source_files=self.selection["files"]
            self.executables={k:executable(getattr(args,k)) for k in ("node","python","chromium")}
            self.journal_path=self.directory/"journal.json"
            self.journal=read(self.journal_path) if self.journal_path.exists() else {"schema":SCHEMA,"id":str(self.ns),"originalOperationId":ORIGINAL,"phases":{},"createdAt":now(),"status":"PREPARED"}
            self.intent_path=self.directory/"input.json"
            self.intent=read(self.intent_path) if self.intent_path.exists() else None
            saved_journal=self.directory/"original/journal-at-following-selection.json"
            self.original_journal_raw=read_bytes(saved_journal) if saved_journal.exists() else read_bytes(self.root/"journal.json")
            original_journal=json.loads(self.original_journal_raw)
            need(original_journal["inputSha256"]==ORIGINAL_INPUT_SHA,"Original journal belongs to another input")
            retain(self.directory/"original/input.json",self.original_raw)
            retain(self.directory/"original/journal-at-following-selection.json",self.original_journal_raw)
            self.child=None;self.app=None;self.staff=None;self.original_workspace=None;self.receiver=None;self.final_receiver=None
        except BaseException:
            os.close(self.guard);self.guard=-1
            raise
    def id(self,label):return str(uuid.uuid5(self.ns,label))
    def save(self):retain(self.journal_path,self.journal,False)
    def effect(self,label,factory,perform):
        d=self.directory/"steps"/label
        intent=d/"input.json";output=d/"result.json"
        if intent.exists():frozen=read(intent)
        else:frozen=factory() if callable(factory) else factory;retain(intent,frozen)
        if output.exists():return read(output)
        self.journal["status"]="RUNNING";self.journal["phases"][label]={"state":"PENDING","inputSha256":digest(frozen)};self.save()
        print(json.dumps({"phase":label,"state":"RUNNING"}),flush=True)
        result=perform(frozen);retain(output,result)
        self.journal["phases"][label]={"state":"COMPLETE","inputSha256":digest(frozen),"resultSha256":digest(result)};self.save()
        print(json.dumps({"phase":label,"state":"COMPLETE"}),flush=True)
        return result
    def command(self,w,label,kind,body):
        return self.effect(label,lambda:{"expectedRevision":w.current()["revision"],"command":{"requestId":self.id(label),"kind":kind,"actor":self.original["actor"],"at":now(),"body":body()}},lambda f:w.execute(f["command"],f["expectedRevision"]))
    def original_unchanged(self):
        need(read_bytes(self.original_input_path)==self.original_raw and read_bytes(self.root/"journal.json")==self.original_journal_raw,"Original input or interrupted journal changed during following course")
        if self.original_workspace is not None:
            current=self.original_workspace.current()
            need(current["revision"]==self.intent["baseline"]["revision"] and current["sha256"]==self.intent["baseline"]["sha256"],"Original business history changed; preserve both branches for review")
    def node(self,config,label="browser"):
        stable={k:v for k,v in config.items() if k not in ("url","token","origin")}
        stable_hash=digest(stable);attempts=self.directory/(label+"-attempts");attempts.mkdir(exist_ok=True,mode=0o700)
        previous=sorted(attempts.iterdir(),key=lambda p:p.name)
        for directory in previous:
            need(directory.is_dir() and not directory.is_symlink(),"Original child attempt directory changed")
            inp=read(directory/"input.json");need(inp["inputSha256"]==stable_hash,"Original Node attempt input changed")
            result=directory/"return.json";proc=directory/"process.json"
            if result.exists():
                value=read(result)
                need(value["inputSha256"]==stable_hash and value["attempt"]==inp["attempt"],"Original Node return identity changed")
                for label in ("stdout","stderr"):
                    got=descriptor(directory/(label+".log"));need({k:got[k] for k in ("bytes","sha256")}==value[label],"Original child output changed")
                continue
            if proc.exists():
                identity=read(proc);need(identity["inputSha256"]==stable_hash and identity["attempt"]==inp["attempt"],"Original child process identity changed")
                need(not alive(identity),"Original Node owner is still active; continue that exact owner")
                # A closed crashed owner does not invent an exit status. Its
                # durable browser process records are reconciled by the next
                # attempt while this same original flock is held.
                retain(directory/"interrupted.json",{"inputSha256":stable_hash,"attempt":inp["attempt"],"owner":identity,"ownerClosed":True,"returnCode":None})
            else:
                # PREPARED precedes Popen dispatch. STARTING without process
                # receipt is deliberately unresolved, not assumed absent.
                state=read(directory/"dispatch.json")
                need(state["state"]=="PREPARED","Original dispatched Node owner has no self-identity; reconcile before continuation")
                retain(directory/"interrupted.json",{"inputSha256":stable_hash,"attempt":inp["attempt"],"notDispatched":True,"returnCode":None})
        browser_result=Path(config["directory"])/"result.json"
        if browser_result.exists():
            result=read(browser_result)
            if result.get("status")=="COMPLETE":
                need(result["inputSha256"]==stable_hash and result.get("browserClosed") and result.get("serverClosed"),"Original completed browser binding or closure differs")
                for item in result["artifacts"]:
                    d=descriptor(Path(config["directory"])/item["path"]);need(d["bytes"]==item["bytes"] and d["sha256"]==item["sha256"],"Original complete browser artifact changed")
                return result
        number=len(previous)+1;directory=private(attempts/("%04d"%number),True)
        config_path=directory/"connection.json";retain(config_path,config)
        argv=[self.args.node,"--max-old-space-size=256",str(self.source/"tools/field-browser-receiving.mjs"),str(config_path)]
        request={"schema":"geocove.field-node-attempt.v1","attempt":number,"inputSha256":stable_hash,"argv":argv}
        retain(directory/"input.json",request);retain(directory/"dispatch.json",{"state":"PREPARED"},False)
        env=dict(os.environ,HIGHWAY_FIELD_GUARD_FD=str(self.guard),HIGHWAY_FIELD_PYTHON=self.args.python,HIGHWAY_FIELD_CHROMIUM=self.args.chromium)
        out=open(directory/"stdout.log","xb");err=open(directory/"stderr.log","xb")
        for stream in (out,err):os.chmod(stream.name,0o600)
        try:
            retain(directory/"dispatch.json",{"state":"STARTING"},False)
            self.child=subprocess.Popen([self.args.python,str(Path(__file__).resolve()),"--child",str(directory/"input.json")],cwd=self.source,env=env,stdout=out,stderr=err,pass_fds=(self.guard,),start_new_session=True)
            return_code=self.child.wait()
        finally:
            if self.child is not None and self.child.poll() is None:
                self.child.terminate()
                # Node's shared signal cleanup drains an in-flight launch and
                # closes its owned Chromium group. Do not kill it early and
                # strand an unrecorded browser; inherited flock preserves owner.
                self.child.wait()
            for stream in (out,err):stream.flush();os.fsync(stream.fileno());stream.close()
        ret={"attempt":number,"inputSha256":stable_hash,"returnCode":return_code,"closedAt":now(),"stdout":{k:descriptor(directory/"stdout.log")[k] for k in ("bytes","sha256")},"stderr":{k:descriptor(directory/"stderr.log")[k] for k in ("bytes","sha256")}}
        retain(directory/"return.json",ret)
        need(return_code==0,"Original browser course did not complete; retain its exact attempt and local state")
        result=read(browser_result);need(result["status"]=="COMPLETE" and result["inputSha256"]==stable_hash and result["browserClosed"] and result["serverClosed"],"Original browser did not retain complete closure")
        for item in result["artifacts"]:
            got=descriptor(Path(config["directory"])/item["path"]);need(got["bytes"]==item["bytes"] and got["sha256"]==item["sha256"],"Browser artifact changed")
        return result
    def run(self):
        from highway.workspace import Workspace
        from highway.exchange import export_workspace,receive_archive,validate_archive
        from highway.server import Application
        from highway import domain,field_exchange
        from highway.field_delivery import field_file,compare_field
        final_path=self.directory/"result.json"
        if final_path.exists():
            result=read(final_path);need(result["status"]=="COMPLETE" and result["originalOperationId"]==ORIGINAL,"Original following result differs")
            for item in result["artifacts"]:
                got=descriptor(item["path"]);need(got==item,"Complete following artifact changed")
            return result
        self.original_workspace=Workspace(self.root/"workspace")
        current=self.original_workspace.current()
        if self.intent is None:
            if self.args.expected_revision is not None:need(current["revision"]==self.args.expected_revision and current["sha256"]==self.args.expected_state_sha256,"Original reviewed workspace selection changed")
            inspection_id=str(uuid.uuid5(uuid.UUID(ORIGINAL),"inspection"))
            iv=domain.inspection_view(current["state"],inspection_id,self.original_workspace.read_blob)
            need(iv["source"]["binding"]["captureId"]==str(uuid.uuid5(uuid.UUID(ORIGINAL),"capture-first")),"Select the actual original completed first-capture inspection")
            self.intent={"schema":SCHEMA,"id":str(self.ns),"originalOperationId":ORIGINAL,"originalInputSha256":ORIGINAL_INPUT_SHA,"sourceRoot":str(self.source),"sourceSha256":self.selection["sha256"],"actor":self.original["actor"],"inspectionId":inspection_id,"baseline":{"workspaceId":current["state"]["id"],"revision":current["revision"],"sha256":current["sha256"]},"meaning":"Explicit local commissioning continuation on the actual retained County source; not a field finding, field photograph, supervisor approval, or GIS change.","node":self.args.node,"python":self.args.python,"chromium":self.args.chromium,"executables":self.executables}
            retain(self.intent_path,self.intent)
        need(self.intent["sourceRoot"]==str(self.source) and self.intent["sourceSha256"]==self.selection["sha256"] and self.intent["node"]==self.args.node and self.intent["python"]==self.args.python and self.intent["chromium"]==self.args.chromium and self.intent["executables"]==self.executables,"Keep the same source and executable selection on continuation")
        self.original_unchanged()
        seed=self.effect("original-staff-export",{"publicationId":self.id("original-staff-export"),"revision":self.intent["baseline"]["revision"]},lambda f:export_workspace(self.original_workspace,f["publicationId"],self.source,self.selection,f["revision"]))
        first=self.effect("following-branch-receive",{"operationId":self.id("following-branch-receive"),"directory":str(self.directory/"staff-workspace"),"sha256":seed["sha256"],"bytes":seed["bytes"],"archive":seed["path"]},lambda f:receive_archive(f["archive"],f["directory"],f["operationId"],f["sha256"],f["bytes"]))
        self.staff=Workspace(first["directory"])
        retained=self.staff.current();need(retained["state"]["id"]==self.intent["baseline"]["workspaceId"],"Following physical branch lost portable workspace identity")
        self.app=Application(self.staff,self.source,self.selection)
        connection=self.app.start()
        config={"schema":"geocove.field-following-browser.v1","directory":str(self.directory/"browser"),"operationId":str(self.ns),"sourceRoot":str(self.source),"sourceSha256":self.selection["sha256"],"workspaceId":retained["state"]["id"],"workspaceDirectory":str(self.staff.directory),"baseline":self.intent["baseline"],"inspectionId":self.intent["inspectionId"],"actor":self.intent["actor"],"meaning":self.intent["meaning"],"origin":connection["origin"],"url":connection["url"],"token":self.app.token}
        browser=self.node(config)
        self.app.close();self.app=None
        selected=browser["steps"]["final-original"]["result"];current=self.staff.current()
        need(current["revision"]==selected["revision"] and current["sha256"]==selected["sha256"],"Following staff history advanced after its reviewed browser result")
        domain.validate_state(current["state"],self.staff.read_blob)
        export=self.effect("following-staff-export",{"publicationId":self.id("following-staff-export"),"revision":current["revision"]},lambda f:export_workspace(self.staff,f["publicationId"],self.source,self.selection,f["revision"]))
        cold=self.effect("cold-full-receive",{"archive":export["path"],"operationId":self.id("cold-full-receive"),"directory":str(self.directory/"cold-workspace"),"sha256":export["sha256"],"bytes":export["bytes"]},lambda f:receive_archive(f["archive"],f["directory"],f["operationId"],f["sha256"],f["bytes"]))
        self.receiver=Workspace(cold["directory"])
        def verify_cold(_):
            received=self.receiver.current();need(received["revision"]==selected["revision"] and received["sha256"]==selected["sha256"],"Independent receiving did not recreate the whole original selected state")
            domain.validate_state(received["state"],self.receiver.read_blob)
            rows=[]
            for item in browser["steps"]["returned-byte-reopen"]["result"]:
                raw,_,_=field_file(self.receiver,item["kind"],item["id"],item["format"])
                need(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Cold received field bytes differ")
                rows.append(item)
            comparison=compare_field(self.receiver,selected["returnId"],adoption_id=selected["adoptionId"])
            need(comparison["readOnly"] and comparison["historicalAdoption"]["id"]==selected["adoptionId"],"Original frozen adoption comparison is unavailable")
            iv=domain.inspection_view(received["state"],self.intent["inspectionId"],self.receiver.read_blob)
            need(iv["version"]["status"]=="draft","Received field work must remain unapproved")
            for attachment in iv["version"]["attachments"]:
                raw=self.receiver.read_blob(attachment["sha256"]);need(len(raw)==attachment["bytes"],"Cold original attachment is incomplete")
            retain(self.directory/"outputs/cold-inspection.json",iv)
            retain(self.directory/"outputs/cold-comparison.json",comparison)
            return {"revision":received["revision"],"sha256":received["sha256"],"files":rows,"inspectionVersion":iv["version"]["number"]}
        self.effect("cold-original-verification",{},verify_cold)
        self.app=Application(self.receiver,self.source,self.selection)
        connection=self.app.start()
        cold_config={**config,"mode":"COLD_REOPEN","directory":str(self.directory/"cold-browser"),"operationId":self.id("cold-browser"),"workspaceDirectory":str(self.receiver.directory),"origin":connection["origin"],"url":connection["url"],"token":self.app.token,"expected":{"revision":selected["revision"],"sha256":selected["sha256"],"files":browser["steps"]["returned-byte-reopen"]["result"]}}
        cold_browser=self.node(cold_config,"cold-browser")
        self.app.close();self.app=None
        continued=self.receiver.current()
        cold_selected=cold_browser["steps"]["final-original"]["result"]
        need(continued["revision"]==cold_selected["revision"] and continued["sha256"]==cold_selected["sha256"],"Cold browser continuation state differs")
        final_export=self.effect("cold-following-export",{"publicationId":self.id("cold-following-export"),"revision":continued["revision"]},lambda f:export_workspace(self.receiver,f["publicationId"],self.source,self.selection,f["revision"]))
        last=self.effect("final-independent-receive",{"archive":final_export["path"],"operationId":self.id("final-independent-receive"),"directory":str(self.directory/"final-workspace"),"sha256":final_export["sha256"],"bytes":final_export["bytes"]},lambda f:receive_archive(f["archive"],f["directory"],f["operationId"],f["sha256"],f["bytes"]))
        self.final_receiver=Workspace(last["directory"])
        actual=self.final_receiver.current();need(actual==continued,"Following cold edits did not receive completely")
        domain.validate_state(actual["state"],self.final_receiver.read_blob)
        self.original_unchanged()
        for workspace in (self.final_receiver,self.receiver,self.staff,self.original_workspace):workspace.close()
        self.final_receiver=self.receiver=self.staff=self.original_workspace=None
        finalization_path=self.directory/"finalization.json"
        if finalization_path.exists():finalization=read(finalization_path)
        else:
            finalization={"operationId":str(self.ns),"sourceSha256":self.selection["sha256"],"businessCompletedAt":now(),"originalRevision":self.intent["baseline"],"followingRevision":{"revision":selected["revision"],"sha256":selected["sha256"]},"continuedRevision":{"revision":continued["revision"],"sha256":continued["sha256"]}}
            retain(finalization_path,finalization)
        need(finalization["operationId"]==str(self.ns) and finalization["sourceSha256"]==self.selection["sha256"] and finalization["continuedRevision"]=={"revision":continued["revision"],"sha256":continued["sha256"]},"Original frozen finalization differs")
        self.journal["status"]="BUSINESS_COMPLETE";self.journal["businessCompletedAt"]=finalization["businessCompletedAt"];self.save()
        files=[("original/input.json",self.directory/"original/input.json"),("original/journal-at-following-selection.json",self.directory/"original/journal-at-following-selection.json"),("following/input.json",self.intent_path),("following/journal.json",self.journal_path),("following/browser-result.json",self.directory/"browser/result.json")]
        files.extend([("workspaces/original-staff-seed.zip",Path(seed["path"])),("workspaces/following-field-workspace.zip",Path(export["path"])),("workspaces/continued-cold-workspace.zip",Path(final_export["path"]))])
        files.extend(("browser/"+f["path"],self.directory/"browser"/f["path"]) for f in browser["artifacts"])
        files.append(("following/cold-browser-result.json",self.directory/"cold-browser/result.json"))
        files.extend(("cold-browser/"+f["path"],self.directory/"cold-browser"/f["path"]) for f in cold_browser["artifacts"])
        files.extend(("outputs/"+p.name,p) for p in sorted((self.directory/"outputs").iterdir()))
        files.extend(("source/"+f["path"],self.source/f["path"]) for f in self.selection["files"])
        files.append(("source/source-selection.json",self.source/"source-selection.json"))
        files.append(("following/finalization.json",finalization_path))
        # Retain full immutable original inputs/results, including all returned
        # API envelopes. Exclude capabilities, profiles, process/control records.
        for base,prefix in [(self.directory/"steps","following/steps"),(self.directory/"browser-attempts","following/browser-attempts"),(self.directory/"cold-browser-attempts","following/cold-browser-attempts")]:
            for p in sorted(base.rglob("*")):
                if p.is_file() and (base.name=="steps" or p.name in ("input.json","return.json","stdout.log","stderr.log","interrupted.json")):
                    if base.name.endswith("-attempts") and p.name=="input.json":
                        # argv contains only local configuration path, never token.
                        need("token" not in read_bytes(p).decode().lower(),"Private launch capability in child input")
                    files.append((prefix+"/"+p.relative_to(base).as_posix(),p))
        need(len({n for n,_ in files})==len(files),"Complete archive repeats a member")
        members=[]
        for name,path in files:
            need(not name.startswith("/") and ".." not in name.split("/") and not any(x in name.split("/") for x in ("control","profiles")),"Private/unsafe archive member")
            d=descriptor(path);members.append({"path":name,"bytes":d["bytes"],"sha256":d["sha256"],"sourcePath":str(path)})
        need(sum(x["bytes"] for x in members)<=1024*1024*1024,"Complete delivery exceeds1GiB; retain all files and resolve capacity without truncation")
        manifest={"schema":"geocove.field-following-delivery.v1","operationId":str(self.ns),"originalOperationId":ORIGINAL,"sourceSha256":self.selection["sha256"],"originalRevision":self.intent["baseline"],"followingRevision":{"revision":selected["revision"],"sha256":selected["sha256"]},"continuedRevision":{"revision":continued["revision"],"sha256":continued["sha256"]},"files":[{k:x[k] for k in ("path","bytes","sha256")} for x in sorted(members,key=lambda x:x["path"])]}
        manifest["sha256"]=digest(manifest)
        retain(self.directory/"finalization-selection.json",{"operationId":str(self.ns),"files":sorted(members,key=lambda x:x["path"]),"manifest":manifest})
        retain(self.directory/"delivery-manifest.json",manifest)
        destination=self.directory/"Highway_Field_Exchange_Complete_Receiving.zip"
        temporary=self.directory/"delivery.partial.zip"
        need(not temporary.is_symlink(),"Original delivery partial cannot be a link")
        with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            def member(name,data):
                info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
            member("manifest.json",canonical(manifest))
            for m in sorted(members,key=lambda x:x["path"]):
                raw=read_bytes(m["sourcePath"])
                need(len(raw)==m["bytes"] and digest(raw)==m["sha256"],"Source changed before complete delivery publication")
                member(m["path"],raw)
        os.chmod(temporary,0o600)
        with temporary.open("rb") as f:os.fsync(f.fileno())
        with zipfile.ZipFile(temporary) as z:
            need(z.namelist()==["manifest.json"]+[x["path"] for x in sorted(members,key=lambda x:x["path"])],"Complete delivery member inventory differs")
            for item in manifest["files"]:
                b=z.read(item["path"]);need(len(b)==item["bytes"] and digest(b)==item["sha256"],"Complete delivery member differs")
        if destination.exists():need({k:descriptor(destination)[k] for k in ("bytes","sha256")}=={k:descriptor(temporary)[k] for k in ("bytes","sha256")},"Existing exact delivery archive differs");temporary.unlink()
        else:os.replace(temporary,destination);sync_dir(destination.parent)
        result={"schema":SCHEMA,"status":"COMPLETE","originalOperationId":ORIGINAL,"operationId":str(self.ns),"sourceSha256":self.selection["sha256"],"originalWorkspacePreserved":self.intent["baseline"],"followingWorkspace":first["directory"],"coldWorkspace":cold["directory"],"finalWorkspace":last["directory"],"browserClosed":True,"serverClosed":True,"archive":descriptor(destination),"artifacts":[descriptor(destination),descriptor(self.directory/"delivery-manifest.json")],"completedAt":finalization["businessCompletedAt"]}
        retain(final_path,result);return result
    def close(self):
        failures=[]
        if self.child is not None and self.child.poll() is None:
            try:self.child.terminate();self.child.wait()
            except BaseException as e:failures.append(e)
        if self.app is not None:
            try:self.app.close()
            except BaseException as e:failures.append(e)
        for w in (self.final_receiver,self.receiver,self.staff,self.original_workspace):
            if w is not None:
                try:w.close()
                except BaseException as e:failures.append(e)
        try:os.close(self.guard)
        except BaseException as e:failures.append(e)
        if failures:raise RuntimeError("Original following resource closure needs reconciliation: "+",".join(type(x).__name__ for x in failures))
def main():
    if len(sys.argv)>1 and sys.argv[1]=="--child":return child_entry(sys.argv[2:])
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original-input",default="/workspace/scratch/9b238a12a516/geocove-highway/operation-"+ORIGINAL+"/input.json")
    parser.add_argument("--source-root",required=True);parser.add_argument("--source-sha256",required=True)
    parser.add_argument("--node",required=True);parser.add_argument("--chromium",required=True)
    parser.add_argument("--python",default=sys.executable)
    parser.add_argument("--expected-revision",type=int);parser.add_argument("--expected-state-sha256")
    args=parser.parse_args();need((args.expected_revision is None)==(args.expected_state_sha256 is None),"Supply both exact reviewed revision and state hash")
    owner=None
    def interrupted(signum,frame):raise KeyboardInterrupt("Original field receiving interrupted by "+signal.Signals(signum).name)
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:owner=Following(args);result=owner.run();print(json.dumps(result),flush=True)
    finally:
        if owner is not None:owner.close()
if __name__=="__main__":main()
