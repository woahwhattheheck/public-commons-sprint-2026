#!/usr/bin/env python3
"""Native ClickHouse HTTP commissioning with retained original requests/effects."""
import argparse, base64, datetime, fcntl, hashlib, json, os, pathlib, sys, tempfile, urllib.error, urllib.parse, urllib.request, uuid
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z")
def encoded(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n").encode()
def sha(data): return hashlib.sha256(data).hexdigest()
def read(path): return json.loads(path.read_text("utf-8"))
def check(condition,message):
    if not condition: raise ValueError(message)
def syncdir(path):
    fd=os.open(path,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def atomic(path,data,immutable=False):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if immutable and path.exists():
        check(path.read_bytes()==data,"Retained immutable bytes differ: "+str(path.name));return
    fd,temp=tempfile.mkstemp(prefix=path.name+".pending-",dir=path.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(temp,path);syncdir(path.parent)
    finally:
        if os.path.exists(temp):os.unlink(temp)
def save(path,value,immutable=False):atomic(path,encoded(value),immutable)
def desc(path,root):return {"path":path.relative_to(root).as_posix(),"bytes":path.stat().st_size,"sha256":sha(path.read_bytes())}
def verify(path,d):check(path.is_file() and path.stat().st_size==d["bytes"] and sha(path.read_bytes())==d["sha256"],"Retained native file identity differs")
def ident(value):return chr(96)+value.replace("\\","\\\\").replace(chr(96),"\\"+chr(96))+chr(96)
def lit(value):return "'"+value.replace("\\","\\\\").replace("'","\\'")+"'"
class Stop(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise ValueError("Native credentials cannot follow a redirect")
class Worker:
    def __init__(self,root):
        self.root=root;self.selection=read(root/"selection.json");self.plan=self.selection["plan"];self.path=root/"journal.json"
        self.state=read(self.path) if self.path.exists() else {"schema":"altinity.native-journal.v1","selectionSha256":sha((root/"selection.json").read_bytes()),"status":"prepared","attempts":[],"steps":{},"usedDecisions":[],"usedCancellations":[],"connections":{}}
        check(self.state["selectionSha256"]==sha((root/"selection.json").read_bytes()),"Original native selection changed")
        self.attempt=None;self.connections={};self.state.setdefault("tableIdentities",{});self.state.setdefault("targetUuids",{})
    def persist(self):self.state["updatedAt"]=now();save(self.path,self.state)
    def endpoint(self,key):
        if key in self.connections:return self.connections[key]
        p=self.plan[key];url=os.environ.get(p["endpointEnv"],"");u=urllib.parse.urlsplit(url)
        local=p.get("allowLocal") and u.scheme=="http" and u.hostname in ("localhost","127.0.0.1","::1")
        check((u.scheme=="https" or local) and u.hostname and not u.username and not u.password and not u.query and not u.fragment and u.path.endswith("/"),"Select the reviewed HTTPS or explicit loopback endpoint")
        user=os.environ.get(p["userEnv"]);password=os.environ.get(p["passwordEnv"])
        check(user is not None and password is not None,"The existing host secret environment is incomplete")
        identity=sha(encoded({"url":url,"user":user}))
        if p.get("endpointIdentity"):check(identity==p["endpointIdentity"],"Endpoint/account identity differs from review")
        old=self.state["connections"].get(key);check(not old or old["identity"]==identity,"The original operation cannot move to another endpoint/account")
        if not old:self.state["connections"][key]={"identity":identity,"profileId":p["id"],"boundAt":now()};self.persist()
        self.connections[key]=(url,user,password);return self.connections[key]
    def cancel(self):
        path=self.root/"control/cancel.json"
        if not path.exists():return
        c=read(path)
        if c["id"] in self.state["usedCancellations"] or c.get("attemptId") not in (None,self.attempt["id"]):return
        self.state["usedCancellations"].append(c["id"]);self.state["status"]="cancelled";self.state["cancelReceipt"]=c;self.persist();raise Stop()
    def decision(self,step):
        paths=sorted((self.root/"control/decisions").glob("*.json")) if (self.root/"control/decisions").exists() else []
        for path in paths:
            d=read(path)
            if d["id"] in self.state["usedDecisions"] or d.get("stepId")!=step["id"] or d.get("attemptId")!=step.get("attemptId"):continue
            decision=d["decision"]
            if decision=="abandon":step["resolution"]=d;self.state["usedDecisions"].append(d["id"]);self.state["status"]="failed";self.persist();raise Stop()
            if decision=="adopt":
                response=step.get("response");proof=step.get("effectObservation")
                if response and response.get("usableSuccess"):verify(self.root/response["body"]["path"],response["body"])
                else:
                    check(proof,"Adoption requires an actual successful response or the complete current original effect observation")
                    verify(self.root/proof["path"],proof);value=read(self.root/proof["path"])
                    check(value["stepId"]==step["id"] and value["contract"]==step["contract"] and value["attemptId"]==self.attempt["id"] and value["equal"] is True,"Original effect proof does not bind this current native decision")
                    for receipt in value["files"]:verify(self.root/receipt["path"],receipt)
                    step["completionEvidence"]={"kind":"operator-adopted-native-effect","observation":proof,"decision":d,"completedAt":now()}
                step["status"]="complete";step["resolution"]=d;self.state["usedDecisions"].append(d["id"]);self.persist();return "adopt"
            check(decision=="retry","Unknown decision")
            step["retryPermit"]=d;self.state["usedDecisions"].append(d["id"]);self.persist();return "retry"
        if step.get("retryPermit"):return "retry"
        self.state["status"]="awaiting_reconciliation";self.persist();raise Stop()
    def retained_success(self,step):
        evidence=step.get("completionEvidence")
        if evidence:
            proof=evidence["observation"];verify(self.root/proof["path"],proof)
            for receipt in read(self.root/proof["path"])["files"]:verify(self.root/receipt["path"],receipt)
            return b""
        response=step["response"];check(response.get("usableSuccess"),"The original completed response has no usable success")
        verify(self.root/response["body"]["path"],response["body"]);return (self.root/response["body"]["path"]).read_bytes()
    def request(self,key,stepid,query,body=b"",writes=False,max_bytes=536870912):
        self.cancel();p=self.plan[key];url,user,password=self.endpoint(key)
        contract={"profileId":p["id"],"endpointIdentity":self.state["connections"][key]["identity"],"query":query,"bodySha256":sha(body),"bodyBytes":len(body),"writesTarget":writes}
        old=self.state["steps"].get(stepid)
        if old:
            check(old["contract"]==contract,"Original native step input changed")
            if old["status"]=="complete":
                return self.retained_success(old)
            response=old.get("response")
            if response and response.get("usableSuccess"):
                verify(self.root/response["body"]["path"],response["body"]);old["status"]="complete";self.persist();return (self.root/response["body"]["path"]).read_bytes()
            if writes:
                action=self.decision(old)
                if action=="adopt":return self.retained_success(old)
        history=old.get("history",[])+[{k:v for k,v in old.items() if k!="history"}] if old else []
        step={"id":stepid,"attemptId":self.attempt["id"],"status":"started","writesTarget":writes,"contract":contract,"startedAt":now(),"history":history}
        self.state["steps"][stepid]=step;self.persist()
        attemptdir=self.root/"attempts"/self.attempt["id"]/stepid;attemptdir.mkdir(parents=True,exist_ok=True,mode=0o700)
        save(attemptdir/"request.json",contract,True);atomic(attemptdir/"request.body",body,True)
        params={"query":query,"query_id":self.selection["jobId"]+"-"+self.attempt["id"]+"-"+stepid,"wait_end_of_query":"1","max_threads":str(self.plan["limits"]["maxThreads"]),"max_memory_usage":str(self.plan["limits"]["maxMemoryBytes"]),"max_execution_time":"120","timeout_overflow_mode":"throw","result_overflow_mode":"throw"}
        if not writes:params.update({"readonly":"2","max_result_bytes":str(max_bytes),"cancel_http_readonly_queries_on_client_close":"1"})
        headers={"X-ClickHouse-User":user,"X-ClickHouse-Key":password,"Content-Type":"application/octet-stream"}
        req=urllib.request.Request(url+"?"+urllib.parse.urlencode(params),data=body if writes else None,headers=headers,method="POST" if writes else "GET")
        response_file=attemptdir/"response.body";partial=attemptdir/"response.part";code=None;response_headers={};error=None
        try:
            opener=urllib.request.build_opener(NoRedirect())
            try:response=opener.open(req,timeout=150)
            except urllib.error.HTTPError as e:response=e
            code=response.status
            response_headers={k.lower():v for k,v in response.headers.items() if k.lower() in ("content-type","content-length","x-clickhouse-query-id","x-clickhouse-summary","x-clickhouse-exception-code","x-clickhouse-server-display-name")}
            count=0
            with response,open(partial,"wb") as out:
                os.chmod(partial,0o600)
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk:break
                    count+=len(chunk);check(count<=max_bytes,"Native full response exceeded its reviewed byte cap");out.write(chunk)
                out.flush();os.fsync(out.fileno())
            expected=response_headers.get("content-length")
            if expected:check(count==int(expected),"Native response ended before Content-Length")
            os.replace(partial,response_file);syncdir(attemptdir)
        except Exception as e:error={"type":type(e).__name__,"message":str(e)[:2000]}
        usable=error is None and code is not None and 200<=code<300 and response_headers.get("x-clickhouse-exception-code","0")=="0"
        if usable and writes and response_file.read_bytes().strip():usable=False;error={"type":"UnexpectedNativeWriteResponse","message":"Original native command returned nonempty bytes; retain them for reconciliation."}
        receipt={"status":code,"headers":response_headers,"error":error,"usableSuccess":usable,"completedAt":now(),"body":desc(response_file,self.root) if response_file.exists() else None,"partial":desc(partial,self.root) if partial.exists() else None}
        step["response"]=receipt;step["status"]="response";self.persist()
        if not usable:self.state["status"]="awaiting_reconciliation" if writes else "failed";self.persist();raise Stop()
        step["status"]="complete";self.persist();return response_file.read_bytes()
    def jsonquery(self,key,stepid,query,cap=536870912):
        return json.loads(self.request(key,stepid,query,max_bytes=cap).decode("utf-8","strict"))
    def metadata(self,key,prefix,table,columns):
        data=self.jsonquery(key,prefix+"-metadata","SELECT toString(uuid) AS uuid, engine, create_table_query FROM system.tables WHERE database="+lit(table[0])+" AND name="+lit(table[1])+" FORMAT JSON",4194304)
        check(len(data["data"])==1,"Native table is absent or ambiguous")
        rows=self.jsonquery(key,prefix+"-columns","SELECT name,type FROM system.columns WHERE database="+lit(table[0])+" AND table="+lit(table[1])+" ORDER BY position FORMAT JSON",4194304)["data"]
        check(rows==[{"name":c["name"],"type":c["type"]} for c in columns],"Actual native columns differ from the reviewed complete schema")
        if key=="target":
            database=self.jsonquery(key,prefix+"-database","SELECT engine FROM system.databases WHERE name="+lit(table[0])+" FORMAT JSON",1048576)["data"]
            check(len(database)==1 and database[0]["engine"]=="Atomic" and data["data"][0]["uuid"]!="00000000-0000-0000-0000-000000000000","Candidate receiving requires the selected Atomic database and actual nonzero UUID")
        return {"table":table,**data["data"][0],"columns":rows}
    def typed(self,key,stepid,query,columns,max_rows,max_bytes):
        value=self.jsonquery(key,stepid,query,max_bytes);count=len(value["data"])
        check(count<=max_rows,"Native export reached the incomplete sentinel row; raise its reviewed cap explicitly")
        check(len(value["meta"])==2*len(columns),"Native scalar/null projection width changed")
        rows=[]
        for row in value["data"]:
            check(len(row)==2*len(columns),"Native export row width changed");cells=[]
            for i,c in enumerate(columns):
                check(row[len(columns)+i] in ("0","1"),"Native null-mask changed")
                if row[len(columns)+i]=="1":cells.append({"type":"null"});continue
                v=row[i];check(isinstance(v,str),"Native exact cell was not text")
                if c["cellType"]=="float64":v=int(v).to_bytes(8,"big",signed=False).hex()
                elif c["cellType"]=="boolean":check(v in ("0","1"),"Native Bool encoding changed");v="true" if v=="1" else "false"
                elif c["cellType"]=="binary":base64.b64decode(v,validate=True)
                cells.append({"type":c["cellType"],"value":v})
            rows.append(cells)
        body=self.state["steps"][stepid]["response"]["body"]
        return {"columns":[{"name":c["name"],"type":c["type"]} for c in columns],"rows":rows,"source":{"kind":"clickhouse-native-jsoncompactstrings","path":body["path"],"sha256":body["sha256"],"bytes":body["bytes"],"recordedAt":self.state["steps"][stepid]["response"]["completedAt"],"rowCount":count,"complete":True}}
    def same_rows(self,left,right):return sorted(encoded(r) for r in left["rows"])==sorted(encoded(r) for r in right["rows"])
    def bound_metadata(self,key,prefix,table,columns,expected_uuid=None):
        value=self.metadata(key,prefix+"-"+self.attempt["id"],table,columns)
        if expected_uuid:check(value["uuid"].lower()==expected_uuid.lower(),"The retained original table UUID changed before this attempt")
        identity_key=key+":"+json.dumps(table,separators=(",",":"))
        original=self.state["tableIdentities"].get(identity_key)
        check(original is None or encoded(original)==encoded(value),"The actual original UUID/schema/engine changed; no native effect is replayed")
        if original is None:self.state["tableIdentities"][identity_key]=value;self.persist()
        return value
    def finish(self,candidate):
        # The candidate is committed before immutable final files. Recovery adopts
        # this exact completed observation, without another database request.
        self.state["completion"]=candidate;self.persist()
        save(self.root/"artifacts/observations.json",candidate["observation"],True)
        save(self.root/"artifacts/native-identities.json",candidate["identities"],True)
        self.state["result"]=candidate["result"]
        attempt=next(a for a in self.state["attempts"] if a["id"]==candidate["attemptId"])
        attempt["status"]="complete";attempt["completedAt"]=candidate["completedAt"]
        self.state["status"]="complete";self.state.pop("error",None);self.persist()
        return self.state
    def run(self,resume=False):
        if self.state.get("completion"):return self.finish(self.state["completion"])
        if self.state["status"]=="complete":return self.state
        check(resume or not self.state["attempts"],"Resume the original native attempt explicitly")
        self.attempt={"id":"attempt_"+uuid.uuid4().hex,"startedAt":now(),"resume":resume};self.state["attempts"].append(self.attempt);self.state["status"]="running";self.persist()
        try:
            self.cancel()
            for key in ("source","target"):
                v=self.jsonquery(key,key+"-version-"+self.attempt["id"],"SELECT version() AS version,currentUser() AS user FORMAT JSON",1048576)["data"]
                check(len(v)==1 and v[0]["version"] in self.plan[key]["versions"],"Actual native server version differs from the reviewed original runtime")
                self.state["connections"][key]["native"]=v[0];self.persist()
            streams=[];source_stable=True;identities=[]
            for i,table in enumerate(self.selection["tables"]):
                prefix="table_"+str(i);fresh=prefix+"-"+self.attempt["id"];spec=table["spec"]
                source_meta=self.bound_metadata("source",prefix+"-source-before",spec["source"],table["leftColumns"],spec.get("sourceExpectedUuid"))
                current_left=self.typed("source",fresh+"-source-before",table["sourceExport"]["sql"],table["sourceExport"]["columns"],spec["maxRows"],spec["maxBytes"])
                # The transfer baseline is captured exactly once, alongside the
                # original RowBinary; retries retain it rather than relabeling data.
                baseline=self.state.setdefault("sourceBaselines",{}).get(prefix)
                if baseline is None:
                    self.state["sourceBaselines"][prefix]=current_left;self.persist();baseline=current_left
                left=baseline if self.selection["mode"]=="transfer" else current_left
                insert_old=self.state["steps"].get(prefix+"-insert")
                insert_complete=insert_old and (insert_old["status"]=="complete" or (insert_old.get("response") or {}).get("usableSuccess"))
                if self.selection["mode"]=="transfer":
                    if not insert_complete:check(self.same_rows(left,current_left),"The original quiesced source changed before its unfinished native transfer")
                    raw=self.request("source",prefix+"-rowbinary",table["rowBinarySql"],max_bytes=spec["maxBytes"])
                    target_uuid=self.state["targetUuids"].get(prefix)
                    if not target_uuid:
                        check(prefix+"-create" not in self.state["steps"],"The original CREATE lacks a retained UUID and requires explicit original reconciliation")
                        target_uuid=str(uuid.uuid4());self.state["targetUuids"][prefix]=target_uuid;self.persist()
                    head="CREATE TABLE "+".".join(ident(x) for x in spec["target"])
                    check(spec["createSql"].startswith(head+" ("),"Original candidate DDL shape changed")
                    create_sql=head.replace("CREATE TABLE ","CREATE TABLE IF NOT EXISTS ",1)+" UUID "+lit(target_uuid)+spec["createSql"][len(head):]
                    # UUID is committed before CREATE, closing a crash between
                    # original creation and its first metadata observation.
                    self.request("target",prefix+"-create",create_sql,writes=True,max_bytes=4194304)
                else:target_uuid=None
                target_meta=self.bound_metadata("target",prefix+"-target-before",spec["target"],table["rightColumns"],target_uuid)
                check(target_meta["engine"]==spec["engine"],"Candidate engine differs")
                if self.selection["mode"]=="transfer":
                    if not insert_complete:
                        count=self.jsonquery("target",fresh+"-empty","SELECT toString(count()) AS count FROM "+".".join(ident(x) for x in spec["target"])+" FORMAT JSON",1048576)["data"]
                        check(len(count)==1,"The original candidate count is unavailable")
                        if count[0]["count"]!="0":
                            check(insert_old,"The candidate was not empty before the original first INSERT")
                            effect=self.typed("target",fresh+"-effect-observation",table["targetExport"]["sql"],table["targetExport"]["columns"],spec["maxRows"],spec["maxBytes"])
                            proof={"schema":"altinity.native-effect-observation.v1","stepId":insert_old["id"],"attemptId":self.attempt["id"],"contract":insert_old["contract"],"target":target_meta,"equal":self.same_rows(left,effect),"files":[left["source"],effect["source"]],"observedAt":now(),"kind":"complete native target export; original INSERT HTTP result remains separately retained"}
                            proof_path=self.root/"attempts"/self.attempt["id"]/(prefix+"-effect-proof.json");save(proof_path,proof,True)
                            insert_old["effectObservation"]=desc(proof_path,self.root);self.persist()
                            # Only an explicit adoption may close a nonempty
                            # original effect; retrying would append duplicates.
                            check(self.decision(insert_old)=="adopt","A nonempty original candidate cannot retry INSERT; inspect and explicitly adopt its complete effect or abandon")
                    self.request("target",prefix+"-insert",table["insertSql"],raw,writes=True,max_bytes=4194304)
                # Fresh same-attempt reads surround completion, never cached reads
                # from a different native owner lifetime.
                right=self.typed("target",fresh+"-target-export",table["targetExport"]["sql"],table["targetExport"]["columns"],spec["maxRows"],spec["maxBytes"])
                after=self.typed("source",fresh+"-source-after",table["sourceExport"]["sql"],table["sourceExport"]["columns"],spec["maxRows"],spec["maxBytes"])
                same=self.same_rows(left,after) and self.same_rows(current_left,after);source_stable=source_stable and same
                source_final=self.bound_metadata("source",prefix+"-source-after",spec["source"],table["leftColumns"],source_meta["uuid"])
                final_meta=self.bound_metadata("target",prefix+"-target-after",spec["target"],table["rightColumns"],target_meta["uuid"])
                identities.append({"streamId":spec["id"],"source":source_final,"target":final_meta,"sourceBoundary":spec["sourceBoundary"],"sourceRowsStable":same,"attemptId":self.attempt["id"]})
                command=self.state["steps"][prefix+"-insert" if self.selection["mode"]=="transfer" else fresh+"-target-export"]
                read_receipt=self.state["steps"][fresh+"-target-export"]["response"]
                receipt=read_receipt if command.get("completionEvidence") else command["response"]
                streams.append({"streamId":spec["id"],"left":left,"right":right,"native":{"commandId":command["id"],"exitCode":0,"startedAt":command["startedAt"],"completedAt":receipt["completedAt"],"httpStatus":receipt["status"],"response":receipt["body"],"effectAdoption":command.get("completionEvidence"),"originalWriteResponse":command.get("response") if command.get("completionEvidence") else None}})
            observation={"schema":"slingdata.migration-observations.v1","planId":self.selection["comparisonPlanId"],"acceptancePlanId":self.plan["planId"],"phase":self.selection["phase"],"sourceStable":source_stable,"targetIdentityVerified":True,"identities":identities,"streams":streams}
            result={"rows":[{"streamId":s["streamId"],"left":len(s["left"]["rows"]),"right":len(s["right"]["rows"])} for s in streams],"native":{"mode":self.selection["mode"],"connections":self.state["connections"],"targetIdentityVerified":True,"sourceStable":source_stable}}
            self.finish({"attemptId":self.attempt["id"],"completedAt":now(),"observation":observation,"identities":{"connections":self.state["connections"],"tables":identities},"result":result})
        except Stop:self.attempt["completedAt"]=now();self.persist()
        except Exception as e:self.attempt["completedAt"]=now();self.state["status"]="failed";self.state["error"]={"type":type(e).__name__,"message":str(e)[:4000]};self.persist()
        return self.state
def main():
    p=argparse.ArgumentParser();p.add_argument("action",choices=["inspect","run"]);p.add_argument("--directory",required=True);p.add_argument("--resume",action="store_true");args=p.parse_args()
    root=pathlib.Path(args.directory).resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    with open(root/"lifetime.lock","a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);busy=False
        except BlockingIOError:busy=True
        if args.action=="inspect":print(json.dumps({"busy":busy,"state":read(root/"journal.json") if (root/"journal.json").exists() else None}));return
        check(not busy,"Original native operation is still owned")
        result=Worker(root).run(args.resume);print(json.dumps({"status":result["status"],"attempts":len(result["attempts"])}))
        if result["status"]!="complete":sys.exit(2)
if __name__=="__main__":main()
