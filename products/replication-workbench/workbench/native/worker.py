"""One original Sling replication lifetime with retained commands and explicit recovery."""
import argparse, base64, fcntl, hashlib, json, os, pathlib, signal, sqlite3, subprocess, sys, time, uuid
from datetime import datetime, timezone
from sqlite_exports import digest, snapshot, observations, export_table, schema as sqlite_schema, quote, table_name

TERMINAL={"complete","failed","cancelled","awaiting_reconciliation"}
def now(): return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
def encoded(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n").encode()
def identity(value): return hashlib.sha256(encoded(value)).hexdigest()
def read(path): return json.loads(pathlib.Path(path).read_text())
def atomic(path,data,immutable=False):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    body=data if isinstance(data,bytes) else encoded(data)
    if immutable and path.exists():
        if path.read_bytes()!=body: raise ValueError("Retained file identity differs: "+path.name)
        return
    tmp=path.with_name(path.name+".pending-"+uuid.uuid4().hex)
    try:
        fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,"wb") as f: f.write(body);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
        d=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if tmp.exists(): tmp.unlink()
def safe(root,relative):
    p=pathlib.PurePosixPath(relative)
    if p.is_absolute() or any(x in ("",".","..") for x in p.parts) or "\\" in relative: raise ValueError("Operation-relative path required")
    out=(root/pathlib.Path(*p.parts)).resolve()
    if not out.is_relative_to(root.resolve()): raise ValueError("Path outside original operation")
    return out
def lease(path):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);fd=os.open(path,os.O_CREAT|os.O_RDWR,0o600)
    try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: os.close(fd);return None
    return fd
def inspect(directory):
    root=pathlib.Path(directory).resolve()
    if not root.is_dir(): return {"schema":"tjlabs.sling-native-status.v1","busy":False,"state":None,"unrestored":True}
    fd=lease(root/"lifetime.lock")
    value=read(root/"state.json") if (root/"state.json").exists() else None
    busy=fd is None
    if fd is not None: os.close(fd)
    return {"schema":"tjlabs.sling-native-status.v1","busy":busy,"state":value}
def proc_info(pid):
    try:
        text=pathlib.Path("/proc",str(pid),"stat").read_text();tail=text.rsplit(")",1)[1].split()
        return {"pid":pid,"state":tail[0],"pgid":int(tail[2]),"sid":int(tail[3]),"startTicks":tail[19],"namespace":os.stat("/proc/"+str(pid)+"/ns/pid").st_ino}
    except (OSError,IndexError,ValueError): return None
def group_members(group,namespace):
    members=[]
    for item in pathlib.Path("/proc").iterdir():
        if not item.name.isdigit(): continue
        p=proc_info(int(item.name))
        if p and p["namespace"]==namespace and p["pgid"]==group and p["sid"]==group and p["state"] not in ("Z","X"): members.append(p)
    return members
class Halt(Exception):
    def __init__(self,state,message): self.state=state;super().__init__(message)

class Worker:
    def __init__(self,args,fd):
        self.args=args;self.root=pathlib.Path(args.directory).resolve();self.fd=fd
        self.selection=read(self.root/"selection.json");self.selection_sha=digest(self.root/"selection.json")["sha256"]
        if self.selection.get("schema")!="tjlabs.sling-native-selection.v1": raise ValueError("Unexpected native selection")
        if digest(self.root/"replication.json")["sha256"]!=self.selection["replicationSha256"]: raise ValueError("The original native replication document differs")
        expected=self.selection["runtime"]["executable"]
        actual=digest(args.executable)
        if actual!=expected: raise ValueError("Actual Sling executable differs from the retained runtime")
        self.executable=os.path.abspath(args.executable)
        self.state_path=self.root/"state.json"
        self.state=read(self.state_path) if self.state_path.exists() else {"schema":"tjlabs.sling-native-operation.v1","jobId":self.selection["jobId"],"projectId":self.selection["projectId"],"selectionSha256":self.selection_sha,"status":"queued","attempts":[],"steps":{},"usedDecisionIds":[],"createdAt":now()}
        if self.state["selectionSha256"]!=self.selection_sha: raise ValueError("Native selection changed")
        self.attempt=None;self.child=None;self.current_step=None
        self.env=os.environ.copy();self.env.update({"SLING_DISABLE_TELEMETRY":"true","SLING_THREADS":"1"})
        source_name=self.selection["connections"]["source"]; target_name=self.selection["connections"]["target"]
        for name,path in ((source_name,"data/source.sqlite"),(target_name,"data/target.sqlite")):
            if not isinstance(name,str) or not name.replace("_","").isalnum(): raise ValueError("Named native connection required")
            if name!="LOCAL": self.env[name]="sqlite://"+str(safe(self.root,path))
        (self.root/"tmp").mkdir(exist_ok=True,mode=0o700);self.env["TMPDIR"]=str(self.root/"tmp")
        self.env["SLING_HOME_DIR"]=str(self.root/"sling-home");pathlib.Path(self.env["SLING_HOME_DIR"]).mkdir(exist_ok=True,mode=0o700)
    def save(self): atomic(self.state_path,self.state)
    def cancelled(self):
        path=self.root/"control/cancel.json"
        if not path.exists(): return False
        value=read(path)
        if value.get("jobId")!=self.selection["jobId"] or not self.attempt: return False
        target=value.get("attemptId")
        if target in (None,""):
            control_id=value.get("id")
            if not isinstance(control_id,str) or not control_id: raise ValueError("The original cancellation needs its stable control ID")
            bindings=self.state.setdefault("cancelBindings",{})
            bound=bindings.get(control_id)
            if bound:
                if bound.get("control")!=value: raise ValueError("A retained cancellation ID changed")
                target=bound["attemptId"]
            else:
                target=self.attempt["id"]
                bindings[control_id]={"control":value,"attemptId":target,"observedAt":now()}
                self.save()
        return target==self.attempt["id"]
    def decision(self,step):
        folder=self.root/"control/decisions"
        if not folder.exists(): return None
        for path in sorted(folder.glob("*.json")):
            d=read(path)
            if d.get("id") in self.state["usedDecisionIds"]: continue
            if d.get("jobId")==self.selection["jobId"] and d.get("stepId")==step.get("id") and d.get("attemptId")==step.get("attemptId"): return d
        return None
    def resolve_prior(self):
        for key,step in list(self.state["steps"].items()):
            if step.get("status")=="complete": self.verify_step(step);continue
            receipt_path=safe(self.root,step["receiptPath"])
            if receipt_path.exists():
                receipt=read(receipt_path)
                if receipt.get("inputSha256")!=step["inputSha256"] or receipt.get("commandId")!=step["id"]: raise ValueError("Original command receipt differs")
                if receipt["exitCode"]==0:
                    step["status"]="complete";step["receipt"]=receipt;self.save();continue
            if not step.get("writesTarget"):
                self.state["steps"].pop(key);self.save();continue
            decision=self.decision(step)
            if not decision: raise Halt("awaiting_reconciliation","The original target-write outcome needs its exact retained staff decision before another effect.")
            kind=decision.get("decision")
            if kind not in ("retry","adopt","abandon") or not decision.get("reason"): raise ValueError("Invalid original target-write decision")
            if kind=="adopt":
                # Retain the staff decision and commit its consumption with the adopted
                # outcome. It is never consumed ahead of the state transition.
                step["status"]="complete";step["adopted"]=decision;step["receipt"]=receipt if receipt_path.exists() else None
            elif kind=="retry":
                self.state.setdefault("supersededSteps",[]).append(dict(step));self.state["steps"].pop(key)
                self.state.setdefault("retryPermits",[]).append({"step":key,"decision":decision})
            else:
                self.state["usedDecisionIds"].append(decision["id"]);self.state["status"]="cancelled";self.state["resolution"]=decision;self.save();raise Halt("cancelled","The original target operation was explicitly abandoned.")
            self.state["usedDecisionIds"].append(decision["id"]);self.save()
    def verify_step(self,row):
        if row.get("receipt"):
            actual=read(safe(self.root,row["receiptPath"]))
            if actual!=row["receipt"]: raise ValueError("Retained original command receipt differs")
            for key in ("stdout","stderr"):
                if digest(safe(self.root,row[key]))!=actual[key]: raise ValueError("Retained original native output differs")
    def command(self,key,argv,*,writes=False,stdout_target=None):
        selected={"argv":argv,"writesTarget":writes,"selectionSha256":self.selection_sha};expected=identity(selected)
        prior=self.state["steps"].get(key)
        if prior and prior.get("status")=="complete":
            if prior["inputSha256"]!=expected: raise ValueError("A committed native command was selected with different input")
            self.verify_step(prior)
            return prior
        if self.cancelled(): raise Halt("cancelled","The original operation was cancelled before the next command.")
        number=len(self.attempt["commands"])+1;command_id=self.attempt["id"]+"-"+str(number)
        relative="attempts/"+self.attempt["id"]+"/commands/"+str(number)
        folder=safe(self.root,relative);folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        out=folder/"stdout";err=folder/"stderr";receipt_path=relative+"/receipt.json"
        row={"id":command_id,"attemptId":self.attempt["id"],"key":key,"inputSha256":expected,"writesTarget":writes,"status":"started","startedAt":now(),"argv":[self.executable,*argv],"receiptPath":receipt_path,"stdout":relative+"/stdout","stderr":relative+"/stderr"}
        self.state["steps"][key]=row;self.attempt["commands"].append(command_id);self.current_step=key;self.save();atomic(folder/"input.json",{**row,"connectionBindings":{"source":"data/source.sqlite","target":"data/target.sqlite"}},immutable=True)
        with out.open("wb") as stdout,err.open("wb") as stderr:
            # The actual engine inherits the original operation lifetime lease.
            # A dead observer cannot start another target writer while it survives.
            child=subprocess.Popen([self.executable,*argv],cwd=self.root,env=self.env,stdout=stdout,stderr=stderr,start_new_session=True,pass_fds=(self.fd,))
            self.child=child; owner=proc_info(child.pid);row["owner"]=owner;self.save()
            cancelled=False
            while child.poll() is None:
                if self.cancelled():
                    cancelled=True
                    if owner and proc_info(child.pid) and proc_info(child.pid)["startTicks"]==owner["startTicks"]:
                        os.killpg(child.pid,signal.SIGTERM)
                    try: child.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        if owner and proc_info(child.pid) and proc_info(child.pid)["startTicks"]==owner["startTicks"]: os.killpg(child.pid,signal.SIGKILL)
                    break
                time.sleep(0.2)
            code=child.wait()
            # Keep the original lease until any remaining original process group
            # has drained. No ancestor-namespace PID is used as a local signal.
            if owner:
                while group_members(child.pid,owner["namespace"]):
                    if self.cancelled(): os.killpg(child.pid,signal.SIGTERM)
                    time.sleep(0.2)
            stdout.flush();stderr.flush();os.fsync(stdout.fileno());os.fsync(stderr.fileno())
        receipt={"schema":"tjlabs.sling-command-receipt.v1","commandId":command_id,"inputSha256":expected,"startedAt":row["startedAt"],"completedAt":now(),"exitCode":code,"cancelled":cancelled,"stdout":digest(out),"stderr":digest(err)}
        atomic(safe(self.root,receipt_path),receipt,immutable=True)
        row["receipt"]=receipt;row["status"]="complete" if code==0 else "failed";self.child=None;self.current_step=None;self.save()
        if code!=0: raise Halt("awaiting_reconciliation" if writes else ("cancelled" if cancelled else "failed"),"Original Sling command did not complete successfully.")
        if stdout_target: atomic(safe(self.root,stdout_target),out.read_bytes(),immutable=True)
        return row
    def artifact(self,path,value): atomic(safe(self.root,path),value,immutable=True)
    def run(self):
        if self.state["status"]=="complete":
            for row in self.state["result"]["artifacts"]:
                if digest(safe(self.root,row["path"]))!={"bytes":row["bytes"],"sha256":row["sha256"]}: raise ValueError("Completed native artifact differs")
            for row in self.state["steps"].values(): self.verify_step(row)
            return self.state
        if self.state["attempts"] and not self.args.resume: raise Halt(self.state["status"],"The existing native operation requires --resume, preserving its original selection.")
        for entry in self.selection.get("inputs",[]):
            observed=digest(safe(self.root,entry["path"]))
            if observed!={"bytes":entry["bytes"],"sha256":entry["sha256"]}: raise ValueError("Retained original input differs")
        try: self.resolve_prior()
        except Halt as error:
            self.state["status"]=error.state;self.state["error"]=str(error);self.save();return self.state
        self.attempt={"id":"attempt_"+uuid.uuid4().hex,"startedAt":now(),"status":"running","commands":[]}
        self.state["attempts"].append(self.attempt);self.state["status"]="running";self.state.pop("error",None);self.state.pop("completedAt",None);self.save()
        try:
            if self.cancelled(): raise Halt("cancelled","The original pending cancellation applies to this retained attempt.")
            target=safe(self.root,"data/target.sqlite")
            if not target.exists():
                target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                with sqlite3.connect(target) as db: db.execute("PRAGMA user_version=0");db.commit()
                fd=os.open(target,os.O_RDONLY)
                try: os.fsync(fd)
                finally: os.close(fd)
            self.command("validate",["validate","replication.json","--output","json"])
            native=self.command("replicate",["run","-r","replication.json"],writes=True)
            receipt=native.get("receipt")
            stamp=receipt["completedAt"] if receipt else native["adopted"]["createdAt"]
            selected_receipt={"commandId":native["id"],"exitCode":receipt["exitCode"] if receipt else None,"startedAt":native["startedAt"],"completedAt":stamp}
            if native.get("adopted"): selected_receipt["reconciliation"]=native["adopted"]
            if self.selection.get("kind")=="source_import":
                table=table_name(self.selection["tables"][0]["target"]);sql="SELECT * FROM "+quote(table["namespace"])+"."+quote(table["name"])
                row=self.command("export-imported-source",["conns","exec",self.selection["connections"]["target"],sql,"--limit","0","--output","csv"])
                self.artifact("artifacts/imported-source.csv",safe(self.root,row["stdout"]).read_bytes())
                path=safe(self.root,"artifacts/target.sqlite");meta=safe(self.root,"artifacts/target-snapshot.json")
                if meta.exists():
                    if digest(path)!=read(meta): raise ValueError("The original imported source snapshot differs")
                else: self.artifact("artifacts/target-snapshot.json",snapshot(safe(self.root,"data/target.sqlite"),path))
                exported=export_table(path,table,relative_path="artifacts/target.sqlite",recorded_at=stamp)
                exported["source"]["rowCount"]=len(exported["rows"]);exported["source"]["complete"]=True
                self.artifact("artifacts/imported-source.json",exported);self.artifact("artifacts/target-schema.json",sqlite_schema(path))
                self.attempt["status"]="complete";self.attempt["completedAt"]=now();self.state["status"]="complete";self.state["completedAt"]=self.attempt["completedAt"]
                self.state["result"]={"targetSnapshot":"artifacts/target.sqlite","sourceSnapshot":"artifacts/target.sqlite","streams":1,"rows":[{"streamId":self.selection["tables"][0]["streamId"],"left":len(exported["rows"]),"right":len(exported["rows"])}],"native":selected_receipt,"sourceImport":True}
                self.state["result"]["artifacts"]=[{"path":str(path.relative_to(self.root)),**digest(path)} for path in sorted((self.root/"artifacts").glob("*")) if path.is_file()]
                self.save();return self.state
            for i,table in enumerate(self.selection["tables"]):
                for side,connection_name in (("source",self.selection["connections"]["source"]),("target",self.selection["connections"]["target"])):
                    t=table_name(table[side]);sql="SELECT * FROM "+quote(t["namespace"])+"."+quote(t["name"])
                    row=self.command("export-"+side+"-"+str(i),["conns","exec",connection_name,sql,"--limit","0","--output","csv"])
                    output=safe(self.root,row["stdout"]).read_bytes();self.artifact("artifacts/"+side+"-"+str(i)+".csv",output)
            # Snapshots are first captured into original deterministic candidates.
            # Reopening a completed snapshot verifies and reuses those bytes.
            for side in ("source","target"):
                path=safe(self.root,"artifacts/"+side+".sqlite");meta=safe(self.root,"artifacts/"+side+"-snapshot.json")
                if meta.exists():
                    expected=read(meta)
                    if digest(path)!=expected: raise ValueError("Original SQLite snapshot differs")
                else:
                    path.parent.mkdir(exist_ok=True,mode=0o700);info=snapshot(safe(self.root,"data/"+side+".sqlite"),path);self.artifact("artifacts/"+side+"-snapshot.json",info)
                self.artifact("artifacts/"+side+"-schema.json",sqlite_schema(path))
            observed=observations(self.root,self.selection["tables"],self.selection["phase"],selected_receipt)
            observed["planId"]=self.selection["planId"]
            for stream in observed["streams"]:
                for side in ("left","right"):
                    stream[side]["source"]["rowCount"]=len(stream[side]["rows"]);stream[side]["source"]["complete"]=True
            self.artifact("artifacts/observations.json",observed)
            self.attempt["status"]="complete";self.attempt["completedAt"]=now()
            self.state["status"]="complete";self.state["completedAt"]=self.attempt["completedAt"];self.state["result"]={"observations":"artifacts/observations.json","sourceSnapshot":"artifacts/source.sqlite","targetSnapshot":"artifacts/target.sqlite","streams":len(observed["streams"]),"rows":[{"streamId":s["streamId"],"left":len(s["left"]["rows"]),"right":len(s["right"]["rows"])} for s in observed["streams"]],"native":selected_receipt}
            self.state["result"]["artifacts"]=[{"path":str(path.relative_to(self.root)),**digest(path)} for path in sorted((self.root/"artifacts").glob("*")) if path.is_file()]
            self.save();return self.state
        except Halt as error:
            self.state["status"]=error.state;self.state["error"]=str(error);self.attempt["status"]=error.state;self.attempt["completedAt"]=now();self.save();return self.state
        except BaseException as error:
            self.state["status"]="awaiting_reconciliation" if self.current_step and self.state["steps"][self.current_step].get("writesTarget") else "failed"
            self.state["error"]=type(error).__name__+": "+str(error);self.attempt["status"]=self.state["status"];self.attempt["completedAt"]=now();self.save();raise

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("action",choices=["run","inspect"]);p.add_argument("--directory",required=True);p.add_argument("--executable");p.add_argument("--resume",action="store_true");a=p.parse_args()
    root=pathlib.Path(a.directory).resolve()
    if a.action=="inspect": print(json.dumps(inspect(root)));return
    if not a.executable: p.error("--executable is required for the original run")
    root.mkdir(parents=True,exist_ok=True,mode=0o700);fd=lease(root/"lifetime.lock")
    if fd is None: print(json.dumps({"schema":"tjlabs.sling-native-status.v1","busy":True,"state":read(root/"state.json") if (root/"state.json").exists() else None}));return
    try:
        worker=Worker(a,fd);result=worker.run();print(json.dumps({"schema":"tjlabs.sling-native-status.v1","busy":False,"state":result}))
        if result["status"]!="complete": sys.exit(2)
    finally: os.close(fd)
if __name__=="__main__": main()
