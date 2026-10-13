#!/usr/bin/env python3
"""Original dlt stage owner; retained load state is the recovery authority."""
import argparse,base64,csv,datetime,decimal,fcntl,hashlib,json,os,pathlib,signal,stat,struct,sys,tempfile,traceback,uuid
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z")
def plain(v):
    if v is None or isinstance(v,(str,int,bool)):return v
    if isinstance(v,float):return v if abs(v)!=float("inf") and v==v else str(v)
    if isinstance(v,(datetime.datetime,datetime.date,datetime.time)):return v.isoformat()
    if isinstance(v,decimal.Decimal):return str(v)
    if isinstance(v,(bytes,bytearray,memoryview)):return {"base64":base64.b64encode(v).decode()}
    if hasattr(v,"asdict"):return plain(v.asdict())
    if hasattr(v,"_asdict"):return plain(v._asdict())
    if isinstance(v,dict):return {str(k):plain(x) for k,x in v.items()}
    if isinstance(v,(list,tuple,set)):return [plain(x) for x in v]
    return str(v)
def encoded(v):return (json.dumps(plain(v),ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode()
def sha(v):return hashlib.sha256(v).hexdigest()
def read(p):return json.loads(p.read_text("utf-8"))
def check(ok,message):
    if not ok:raise ValueError(message)
def syncdir(p):
    fd=os.open(p,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def atomic(p,data,immutable=False):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if immutable and p.exists():check(p.read_bytes()==data,"Retained immutable output differs: "+p.name);return
    fd,temp=tempfile.mkstemp(prefix=p.name+".pending-",dir=p.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as out:out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(temp,p);syncdir(p.parent)
    finally:
        if os.path.exists(temp):os.unlink(temp)
def save(p,v,immutable=False):atomic(p,encoded(v),immutable)
def descriptor(p,root):
    h=hashlib.sha256()
    with open(p,"rb") as inp:
        for b in iter(lambda:inp.read(1024*1024),b""):h.update(b)
    return {"path":p.relative_to(root).as_posix(),"bytes":p.stat().st_size,"sha256":h.hexdigest()}
def verify(p,d):
    check(p.is_file() and not p.is_symlink(),"Missing original retained file")
    check(descriptor(p,p.parent)["sha256"]==d["sha256"] and p.stat().st_size==d["bytes"],"Original file identity differs: "+p.name)
def ident(v):return '"'+v.replace('"','""')+'"'
class Halt(Exception):pass
def coerce(v,h):
    if v is None:return None
    t=h["data_type"]
    if t=="bigint":return int(v)
    if t=="decimal":return decimal.Decimal(str(v))
    if t=="double":return float(v)
    if t=="bool":
        if isinstance(v,bool):return v
        check(str(v).lower() in ("true","false","1","0"),"Boolean input must be explicit");return str(v).lower() in ("true","1")
    if t=="timestamp":
        x=datetime.datetime.fromisoformat(str(v).replace("Z","+00:00"));return x if x.tzinfo else x.replace(tzinfo=datetime.timezone.utc)
    if t=="date":return datetime.date.fromisoformat(str(v))
    if t=="time":return datetime.time.fromisoformat(str(v))
    if t=="binary":return base64.b64decode(v,validate=True)
    if t=="json":return json.loads(v) if isinstance(v,str) else v
    return str(v)
def cell(v):
    if v is None:return {"type":"null"}
    if isinstance(v,bool):return {"type":"boolean","value":"true" if v else "false"}
    if isinstance(v,int):return {"type":"integer","value":str(v)}
    if isinstance(v,decimal.Decimal):return {"type":"decimal","value":str(v)}
    if isinstance(v,float):return {"type":"float64","value":struct.pack(">d",v).hex()}
    if isinstance(v,datetime.datetime):return {"type":"timestamp","value":v.isoformat()}
    if isinstance(v,datetime.date):return {"type":"date","value":v.isoformat()}
    if isinstance(v,(bytes,bytearray,memoryview)):return {"type":"binary","value":base64.b64encode(v).decode()}
    return {"type":"text","value":v.isoformat() if isinstance(v,datetime.time) else str(v)}
class Worker:
    def __init__(self,root,ready):
        self.root=root;self.selection=read(root/"selection.json");self.plan=self.selection["plan"];self.path=root/"journal.json";self.ready=ready;self.pipe=None
        self.state=read(self.path) if self.path.exists() else {"schema":"dlthub.native-journal.v1","selectionSha256":sha((root/"selection.json").read_bytes()),"status":"prepared","attempts":[],"steps":{},"usedDecisions":[],"usedCancellations":[]}
        check(self.state["selectionSha256"]==sha((root/"selection.json").read_bytes()),"The original native selection changed")
        self.attempt=None;self.stop_requested=False
    def persist(self):self.state["updatedAt"]=now();save(self.path,self.state)
    def cancelled(self):
        if self.stop_requested:
            self.state["status"]="cancelled";self.persist();raise Halt()
        p=self.root/"control/cancel.json"
        if not p.exists():return
        c=read(p)
        if c["id"] in self.state["usedCancellations"] or c.get("attemptId") not in (None,self.attempt["id"]):return
        self.state["usedCancellations"].append(c["id"]);self.state["cancelReceipt"]=c;self.state["status"]="cancelled";self.persist();raise Halt()
    def initialize(self):
        import dlt,duckdb,importlib.metadata
        check(dlt.__version__=="1.31.0","The original dlt version changed")
        check(self.ready["schema"]=="dlt-workshare.runtime-ready.v1" and self.ready["state"]=="ready","Select the original ready receipt")
        check(self.ready["runtimeId"]==self.selection["runtime"]["runtimeId"],"The retained native job belongs to another runtime")
        check(os.path.abspath(sys.executable)==os.path.abspath(self.ready["python"]["executable"]),"Use the selected original interpreter invocation")
        check(importlib.metadata.version("duckdb")==self.ready["duckdb"]["version"],"The installed native DuckDB version differs")
        check(tuple(int(x) for x in duckdb.__version__.split(".")[:2])>=(1,4),"This reviewed original merge requires DuckDB 1.4 or newer")
        self.dlt=dlt;self.duckdb=duckdb;self.target=self.root/"data/target.duckdb";self.target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        # Explicit relative receiving roots override old machine paths; original
        # state, names, source cursor and native package IDs remain unchanged.
        self.pipe=dlt.pipeline(pipeline_name=self.plan["pipelineName"],pipelines_dir=str(self.root/"data/pipelines"),
            destination=dlt.destinations.duckdb(credentials=str(self.target)),dataset_name=self.plan["datasetName"],
            dev_mode=False,restore_from_destination=False,enable_runtime_trace=True)
        check(self.pipe.pipeline_name==self.plan["pipelineName"] and self.pipe.dataset_name==self.plan["datasetName"],"The retained pipeline identity changed")
    def resource(self,spec):
        inp=next(x for x in self.selection["inputs"] if x.get("sourceId")==spec["sourceId"]);path=self.root/inp["path"];verify(path,inp)
        hints={c["name"]:c for c in spec["columns"]}
        def rows():
            count=0
            if spec["format"]=="csv":
                with open(path,encoding="utf-8-sig",newline="") as fp:
                    yield from values(csv.DictReader(fp,delimiter=spec["csvDelimiter"]))
            elif spec["format"]=="json":
                with open(path,encoding="utf-8") as fp:body=json.load(fp,parse_float=decimal.Decimal)
                check(isinstance(body,list),"The retained JSON source must be the full array");yield from values(body)
            else:
                with open(path,encoding="utf-8") as fp:yield from values(json.loads(line,parse_float=decimal.Decimal) for line in fp if line.strip())
        def values(items):
            for i,row in enumerate(items):
                self.cancelled();check(i<self.plan["limits"]["maxRows"],"Source exceeds the complete-input row cap");check(isinstance(row,dict),"Native records must be objects")
                mapped={spec["fieldMap"].get(k,k):v for k,v in row.items()}
                check(len(mapped)==len(row),"Reviewed field mapping collapses two original fields")
                if spec["format"]=="csv":
                    mapped={k:(None if v in spec["nullValues"] else v) for k,v in mapped.items()}
                for k,h in hints.items():
                    if k in mapped:
                        mapped[k]=coerce(mapped[k],h)
                yield mapped
        inc=spec.get("incremental")
        if inc:
            inc=dict(inc)
            if inc.get("last_value_func"):inc["last_value_func"]=max if inc["last_value_func"]=="max" else min
            hint=hints.get(inc["cursor_path"])
            if hint:
                for k in ("initial_value","end_value"):
                    if inc.get(k) is not None:inc[k]=coerce(inc[k],hint)
            inc=self.dlt.sources.incremental(**inc,primary_key=spec["primaryKey"] or None)
        return self.dlt.resource(rows(),name=spec["name"],table_name=spec["tableName"],columns=spec["columns"],primary_key=spec["primaryKey"] or None,
            write_disposition=spec["writeDisposition"],schema_contract=spec["schemaContract"],max_table_nesting=spec["maxTableNesting"],incremental=inc)
    def inspect_pipeline(self):
        p=self.pipe;extracted=list(p.list_extracted_load_packages());normalized=list(p.list_normalized_load_packages());completed=list(p.list_completed_load_packages())
        packages=[]
        for load_id in sorted(set(extracted+normalized+completed)):
            info=p.get_load_package_info(load_id)
            packages.append({"loadId":load_id,"info":plain(info),"state":plain(p.get_load_package_state(load_id)) if load_id not in extracted else None,
                "failedJobs":plain(p.list_failed_jobs_in_package(load_id)) if load_id not in extracted else [],
                "pendingRetries":plain(p.list_pending_retry_jobs_in_package(load_id)) if load_id in normalized else []})
        schemas={name:p.schemas[name].to_dict() for name in p.schema_names}
        return {"schema":"dlthub.native-pipeline-inspection.v1","pipelineName":p.pipeline_name,"datasetName":p.dataset_name,"pipelineState":plain(p.state),
            "extracted":extracted,"normalized":normalized,"completed":completed,"packages":packages,"schemas":plain(schemas),"hasPendingData":p.has_pending_data,
            "trace":plain(p.last_trace),"inspectedAt":now()}
    def resolve(self,step):
        controls=self.root/"control/decisions";paths=sorted(controls.glob("*.json")) if controls.exists() else []
        for path in paths:
            d=read(path)
            if d["id"] in self.state["usedDecisions"] or d.get("stepId")!=step["id"] or d.get("attemptId")!=step["attemptId"]:continue
            if d["decision"]=="abandon":
                step["resolution"]=d;self.state["usedDecisions"].append(d["id"]);self.state["status"]="failed";self.persist();raise Halt()
            if d["decision"]=="adopt":
                check(step.get("result"),"Adoption requires the original complete native result receipt; no fabricated success")
                verify(self.root/step["result"]["path"],step["result"]);step["status"]="complete";step["resolution"]=d;self.state["usedDecisions"].append(d["id"]);self.persist();return "adopt"
            check(d["decision"]=="retry","Unknown original decision")
            step["retryPermit"]=d;self.state["usedDecisions"].append(d["id"]);self.persist();return "retry"
        if step.get("retryPermit"):return "retry"
        self.state["status"]="awaiting_reconciliation";self.persist();raise Halt()
    def step(self,key,fn,*,reentrant=False):
        self.cancelled();old=self.state["steps"].get(key)
        if old and not old.get("result"):
            original_path=self.root/"attempts"/old["attemptId"]/(key+"-result.json")
            if original_path.exists():
                original=read(original_path)
                check(original.get("schema")=="dlthub.native-step-receipt.v1" and original.get("stage")==key and original.get("attemptId")==old["attemptId"] and original.get("selectionSha256")==self.state["selectionSha256"],"The original deterministic native completion receipt differs")
                old["result"]=descriptor(original_path,self.root);old["status"]="response";self.persist()
        if old and old.get("result"):
            verify(self.root/old["result"]["path"],old["result"])
            if old["status"]!="complete":old["status"]="complete";self.persist()
            return read(self.root/old["result"]["path"])
        if old and not reentrant and self.resolve(old)=="adopt":return read(self.root/old["result"]["path"])
        step={"id":key,"attemptId":self.attempt["id"],"status":"started","writesTarget":True,"startedAt":now(),"history":old.get("history",[])+[{k:v for k,v in old.items() if k!="history"}] if old else []}
        self.state["steps"][key]=step;self.persist()
        result=fn();value={"schema":"dlthub.native-step-receipt.v1","stage":key,"attemptId":self.attempt["id"],"selectionSha256":self.state["selectionSha256"],"result":plain(result),"pipeline":self.inspect_pipeline(),"completedAt":now()}
        path=self.root/"attempts"/self.attempt["id"]/(key+"-result.json");save(path,value,True)
        step["result"]=descriptor(path,self.root);step["status"]="response";self.persist();step["status"]="complete";self.persist();return value
    def export(self,inspection):
        streams=[];schema=self.plan["datasetName"]
        check(self.target.exists(),"No native destination database exists yet")
        with self.duckdb.connect(str(self.target),read_only=True) as db:
            tables=db.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE' ORDER BY table_name",[schema]).fetchall()
            actual=[r[0] for r in tables if not r[0].startswith("_dlt")];coverage={t["table"] for t in self.plan["acceptance"]}
            native_inventory=[]
            for table in actual:
                info=db.execute("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position",[schema,table]).fetchall()
                count=db.execute("SELECT count(*) FROM "+ident(schema)+"."+ident(table)).fetchone()[0]
                native_inventory.append({"table":table,"rowCount":count,"columns":[{"name":x[0],"type":x[1],"nullable":x[2]=="YES"} for x in info]})
            for selected in self.plan["acceptance"]:
                expected_input=next(x for x in self.selection["inputs"] if x.get("sourceId")==selected["expectedSourceId"]);ep=self.root/expected_input["path"];verify(ep,expected_input);left=read(ep)
                check(left.get("schema")=="dlthub.expected-table.v1" and left["complete"] is True and left["table"]==selected["table"],"Independent expected full table is missing or mismatched")
                check(left["rowCount"]==len(left["rows"])<=self.plan["limits"]["maxRows"],"Expected full row count differs")
                present=next((x for x in native_inventory if x["table"]==selected["table"]),None);check(present,"A selected native table is absent")
                wanted={c["right"] if c.get("right") else c["name"] for c in selected["columns"]};check(wanted.issubset({c["name"] for c in present["columns"]}),"Native selected columns are absent")
                # Full actual schema accompanies selected values, making an omitted
                # business column visible to the maintained comparator.
                query="SELECT "+", ".join(ident(c["name"]) for c in present["columns"])+" FROM "+ident(schema)+"."+ident(selected["table"])+" LIMIT "+str(self.plan["limits"]["maxRows"]+1)
                cursor=db.execute(query);rows=[]
                for row in cursor.fetchall():rows.append([cell(v) for v in row])
                check(len(rows)<=self.plan["limits"]["maxRows"] and len(rows)==present["rowCount"],"Native full export exceeded its cap")
                native_path=self.root/"artifacts"/("table-"+selected["table"]+"-"+self.attempt["id"]+".json")
                export_bytes=encoded({"columns":present["columns"],"rows":rows,"query":query,"complete":True})
                check(len(export_bytes)<=self.plan["limits"]["maxBytes"],"The complete native typed export exceeds its reviewed byte cap")
                atomic(native_path,export_bytes,True);nd=descriptor(native_path,self.root)
                right={"columns":[{"name":c["name"],"type":c["type"]} for c in present["columns"]],"rows":rows,"source":{**nd,"kind":"duckdb-original-full-export","recordedAt":now(),"rowCount":len(rows),"complete":True}}
                left={**left,"source":{**expected_input,"kind":"retained-independent-expected-full-export","recordedAt":now(),"rowCount":len(left["rows"]),"complete":True}}
                streams.append({"streamId":selected["id"],"left":left,"right":right,"native":{"commandId":self.selection["jobId"],"exitCode":0,"startedAt":self.attempt["startedAt"],"completedAt":now(),"pipelineName":self.pipe.pipeline_name,"loadIds":inspection["completed"]}})
        return {"schema":"slingdata.migration-observations.v1","planId":self.selection["comparisonPlanId"],"pipelinePlanId":self.plan["planId"],"phase":self.plan["phase"],"streams":streams,
            "pendingPackages":bool(inspection["extracted"] or inspection["normalized"]),"failedJobs":any(p["failedJobs"] and p["info"].get("state")!="aborted" for p in inspection["packages"]),
            "completeTables":set(actual)==coverage,"nativeTables":native_inventory,"unmappedTables":sorted(set(actual)-coverage)}
    def finish(self,candidate):
        for key,value in candidate["artifacts"].items():save(self.root/"artifacts"/key,value,True)
        self.state["result"]=candidate["result"];self.state["status"]="complete";self.state.pop("error",None)
        for a in self.state["attempts"]:
            if a["id"]==candidate["attemptId"]:a["status"]="complete";a["completedAt"]=candidate["completedAt"]
        self.persist();return self.state
    def run(self,resume=False):
        if self.state.get("completion"):return self.finish(self.state["completion"])
        check(resume or not self.state["attempts"],"Resume the same original native operation explicitly")
        self.attempt={"id":"attempt_"+uuid.uuid4().hex,"startedAt":now(),"resume":resume};self.state["attempts"].append(self.attempt);self.state["status"]="running";self.persist()
        try:
            self.cancelled()
            for d in self.selection["inputs"]:
                if d["path"].startswith("inputs/"):verify(self.root/d["path"],d)
            self.initialize();before=self.inspect_pipeline();save(self.root/"attempts"/self.attempt["id"]/"pipeline-before.json",before,True)
            stage=self.selection["stage"];options=self.selection.get("options",{})
            if stage in ("extract","run"):
                old=self.state["steps"].get("extract")
                if not old:check(not self.pipe.has_pending_data,"Finish or explicitly abort original pending packages before extracting another source edition")
                self.step("extract",lambda:self.pipe.extract([self.resource(r) for r in self.plan["resources"]],workers=1))
            if stage in ("normalize","run"):self.step("normalize",lambda:self.pipe.normalize(workers=1),reentrant=True)
            if stage in ("load","run"):self.step("load",lambda:self.pipe.load(workers=self.plan["limits"]["workers"],raise_on_failed_jobs=True),reentrant=True)
            if stage=="retry_failed":
                load_id=options["loadId"];filename=options["jobFileName"]
                self.step("retry_failed",lambda:self.pipe.retry_failed_job(load_id,filename))
            if stage=="abort":
                # Full pre-abort native files already belong to the selected
                # closed parent job. The original dlt abort plan/intent is retained.
                plan=self.pipe.abort_packages(options.get("loadId"),dry_run=True)
                save(self.root/"attempts"/self.attempt["id"]/"abort-plan.json",plain(plan),True)
                self.step("abort",lambda:self.pipe.abort_packages(options.get("loadId")),reentrant=True)
            self.cancelled();inspection=self.inspect_pipeline();artifacts={"pipeline.json":inspection}
            if stage in ("load","run","verify"):artifacts["observations.json"]=self.export(inspection)
            candidate={"attemptId":self.attempt["id"],"completedAt":now(),"artifacts":artifacts,"result":{"stage":stage,"pipelineName":self.pipe.pipeline_name,"packages":{"extracted":inspection["extracted"],"normalized":inspection["normalized"],"completed":inspection["completed"]},"pending":inspection["hasPendingData"],"tables":artifacts.get("observations.json",{}).get("nativeTables",[]),"rows":[{"streamId":s["streamId"],"left":len(s["left"]["rows"]),"right":len(s["right"]["rows"])} for s in artifacts.get("observations.json",{}).get("streams",[])],"native":{"engine":"dlt","version":"1.31.0","stage":stage}}}
            self.state["completion"]=candidate;self.persist();return self.finish(candidate)
        except Halt:
            self.attempt["status"]=self.state["status"];self.attempt["completedAt"]=now();self.persist()
        except BaseException as error:
            self.state["status"]="cancelled" if isinstance(error,(KeyboardInterrupt,SystemExit)) else "failed"
            self.state["error"]={"type":type(error).__name__,"message":str(error)[:12000]};self.attempt["status"]=self.state["status"];self.attempt["completedAt"]=now()
            save(self.root/"attempts"/self.attempt["id"]/"error.json",{"error":self.state["error"],"traceback":traceback.format_exc()},True)
            if self.pipe:
                try:save(self.root/"attempts"/self.attempt["id"]/"pipeline-failed.json",self.inspect_pipeline(),True)
                except Exception as observation:self.state["inspectionError"]={"type":type(observation).__name__,"message":str(observation)}
            self.persist()
        return self.state
def main():
    p=argparse.ArgumentParser();p.add_argument("action",choices=["inspect","run"]);p.add_argument("--directory",required=True);p.add_argument("--runtime-ready");p.add_argument("--resume",action="store_true");args=p.parse_args()
    root=pathlib.Path(args.directory).resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock_path=root/"lifetime.lock"
    if args.action=="inspect":
        with open(lock_path,"a+") as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);busy=False
            except BlockingIOError:busy=True
            print(json.dumps({"busy":busy,"state":read(root/"journal.json") if (root/"journal.json").exists() else None}))
        return
    inherited=os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_FD")
    check(inherited is not None and inherited.isdigit(),"Use the original verified runtime wrapper for this native operation")
    inherited_fd=int(inherited);check(inherited_fd>=3,"The inherited original operation lease descriptor is invalid")
    check(os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_PATH")==str(lock_path),"The inherited original operation lease belongs to another path")
    actual=os.fstat(inherited_fd);expected=os.stat(lock_path,follow_symlinks=False)
    check(stat.S_ISREG(actual.st_mode) and stat.S_ISREG(expected.st_mode) and (actual.st_dev,actual.st_ino)==(expected.st_dev,expected.st_ino),"The inherited operation lease does not select this exact original lock")
    fcntl.flock(inherited_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    check(args.runtime_ready,"Select the installed runtime receipt")
    os.environ["DLT_TELEMETRY"]="false";os.environ["RUNTIME__DLTHUB_TELEMETRY"]="false"
    worker=Worker(root,read(pathlib.Path(args.runtime_ready)))
    def stop(*_):worker.stop_requested=True;raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,stop)
    result=worker.run(args.resume);print(json.dumps({"status":result["status"],"attempts":len(result["attempts"]),"result":result.get("result")}))
    if result["status"]!="complete":sys.exit(2)

if __name__=="__main__":main()
