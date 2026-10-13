"""Complete original Highway commissioning and customer receiving programme.

This entry is invoked by the sole delivery owner. It performs read-only County
capture and local proposed work only. Every effect has an immutable input and
stable request identity before dispatch; completed native results are reused.
"""
import argparse, contextlib, datetime as dt, fcntl, hashlib, json, math, os
from pathlib import Path
import subprocess, sys, time, uuid

def canonical(v):
    return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()
def digest(v): return hashlib.sha256(v if isinstance(v,bytes) else canonical(v)).hexdigest()
def now(): return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00","Z")
def check(v,m):
    if not v: raise ValueError(m)
def read(path): return json.loads(Path(path).read_bytes())
def retain(path,value,immutable=True):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    raw=value if isinstance(value,bytes) else canonical(value)
    check(not path.is_symlink(),"Original result cannot be a link")
    if immutable and path.exists():
        check(path.read_bytes()==raw,"Original retained bytes differ: "+str(path));return
    temporary=path.with_name(path.name+".partial")
    check(not temporary.is_symlink(),"Original partial cannot be a link")
    with open(temporary,"wb") as f:
        os.chmod(temporary,0o600);f.write(raw);f.flush();os.fsync(f.fileno())
    os.replace(temporary,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

class Programme:
    def __init__(self,input):
        self.input=input
        self.root=Path(input["directory"]).absolute()
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        check(self.root.resolve()==self.root and not self.root.stat().st_mode&0o077,"Use a private canonical programme directory")
        self.guard=os.open(self.root/"programme.lock",os.O_CREAT|os.O_RDWR|getattr(os,"O_NOFOLLOW",0),0o600)
        fcntl.flock(self.guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            retain(self.root/"input.json",input)
            self.ns=uuid.UUID(input["operationId"])
            self.steps=self.root/"steps";self.steps.mkdir(exist_ok=True,mode=0o700)
            self.started=time.monotonic()
            self.journal=read(self.root/"journal.json") if (self.root/"journal.json").exists() else {
                "schema":"geocove.original-programme.v1","operationId":input["operationId"],
                "inputSha256":digest(input),"createdAt":now(),"state":"PREPARED","phases":{}}
            check(self.journal["inputSha256"]==digest(input),"Retain the original complete programme input")
        except BaseException:os.close(self.guard);raise
    def id(self,label): return str(uuid.uuid5(self.ns,label))
    def phase(self,name,state,**details):
        self.journal["state"]="RUNNING";self.journal["phases"][name]={"state":state,**details}
        retain(self.root/"journal.json",self.journal,False)
        print(json.dumps({"phase":name,"state":state}),flush=True)
    def effect(self,label,body,perform):
        directory=self.steps/label;directory.mkdir(exist_ok=True,mode=0o700)
        intent=directory/"input.json";output=directory/"result.json"
        if intent.exists():frozen=read(intent)
        else:
            frozen=body() if callable(body) else body
            retain(intent,frozen)
        if output.exists():return read(output)
        self.phase(label,"RUNNING",inputSha256=digest(frozen))
        result=perform(frozen)
        retain(output,result);self.phase(label,"COMPLETE",inputSha256=digest(frozen),resultSha256=digest(result))
        return result
    def command(self,w,label,kind,body,request_id=None):
        def request():
            value=body() if callable(body) else body
            return {"expectedRevision":w.current()["revision"],"command":{
                "requestId":request_id or self.id("command/"+label),"kind":kind,
                "actor":self.input["actor"],"at":now(),"body":value}}
        return self.effect(label,request,lambda f:w.execute(f["command"],f["expectedRevision"]))
    def native(self,w,bridge,label,operation,body):
        response=self.effect(label,lambda:{"operationId":self.id("native/"+label),"operation":operation,
            "body":body() if callable(body) else body},
            lambda f:bridge.perform(f["operationId"],f["operation"],f["body"]))
        self.command(w,label+"-record","reconciliation.record",response["recordBody"],response["recordRequestId"])
        return response
    def close(self):os.close(self.guard)

def choose_source(w,capture_id,layer_ids,input):
    from highway import domain
    state=w.current()["state"]
    for layer in layer_ids:
        dataset=domain.dataset_records(state,capture_id,layer,w.read_blob)
        meta=dataset["metadata"]
        oid=meta.get("objectIdField") or next((f["name"] for f in meta["fields"] if f["type"]=="esriFieldTypeOID"),None)
        check(oid is not None,"Original ObjectID declaration is required")
        requested=input.get("proposedEdit")
        candidates=[x for x in meta["fields"] if not domain._read_only(x,meta)]
        if requested:
            candidates=[x for x in candidates if x["name"]==requested["field"]]
        for row in dataset["records"]:
            if requested and requested.get("objectId") is not None and row["objectId"]!=requested["objectId"]:continue
            for field in candidates:
                old=row["feature"]["attributes"].get(field["name"])
                if requested:value=requested["value"]
                elif field.get("domain",{}):
                    codes=field["domain"].get("codedValues",[]) if isinstance(field.get("domain"),dict) else []
                    other=next((x["code"] for x in codes if x["code"]!=old),None)
                    if other is None:continue
                    value=other
                elif field["type"]=="esriFieldTypeString" and field.get("length",200)>=12:
                    value="REVIEW PLAN" if old!="REVIEW PLAN" else "REVIEW PLAN 2"
                    if len(value)>field.get("length",len(value)):continue
                else:continue
                # The resulting form and original domain validators remain authority.
                return {"captureId":capture_id,"layerId":layer,"objectId":row["objectId"],
                    "objectIdField":oid,"editField":field["name"],"originalValue":old,"proposedValue":value,
                    "fieldMetadata":field,"sourceName":dataset["name"],
                    "meaning":"Explicit local commissioning proposal on an actual captured County object; not a reported field observation or GIS update."}
    raise ValueError("No actual editable source field is suitable. Supply proposedEdit explicitly; no County value is invented.")

def run(input):
    p=Programme(input)
    result_path=p.root/"result.json"
    try:
        if result_path.exists():
            result=read(result_path);check(result["state"]=="COMPLETE","Completed original programme result is required")
            for f in result["artifacts"]:
                b=Path(f["path"]).read_bytes();check(len(b)==f["bytes"] and digest(b)==f["sha256"],"Completed programme artifact changed")
            return result
        source=Path(input["sourceRoot"]).resolve(strict=True)
        sys.path.insert(0,str(source))
        from highway.cli import selected_source, import_capture
        from highway.workspace import Workspace
        from highway.capture import capture
        from highway import domain,dispatch
        from highway.dataset import prepare_dataset
        from highway.native_bridge import NativeBridge,restore_operation
        from highway.exchange import export_workspace,receive_archive,validate_archive
        from highway.server import Application
        root,selection=selected_source(source)
        check(selection["sha256"]==input["sourceSha256"],"Original selected application source differs")
        python_root=source/"vendor/original-paired/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
        sys.path.insert(0,str(python_root))
        from stellar_forge_buyer.duckdb_dataset import DuckDBWorkspace
        from stellar_forge_buyer.reconciliation.model import Reconciliation
        ids={x:p.id(x) for x in ("workspace","capture-first","capture-following","form","crew","package","assignment","inspection","followup","proposal-first","proposal-following","report")}
        created=p.journal["createdAt"]
        due=(dt.datetime.fromisoformat(created.replace("Z","+00:00"))+dt.timedelta(days=1)).isoformat().replace("+00:00","Z")
        workspace=p.root/"workspace";native_dir=p.root/"paired-workspace"
        app=None;w=None;native=None;receiver=None;received_native=None
        artifacts=[]
        try:
            w=Workspace(workspace,create=True,workspace_id=ids["workspace"],title="Livingston Highway — proposed field commissioning",created_at=created)
            native=DuckDBWorkspace(native_dir,memory_limit="128MB",threads=1)
            bridge=NativeBridge(w,native)
            def capture_stage(label,capture_id):
                directory=p.root/label
                args={"service":input["service"],"layer_ids":input["layerIds"],"table_ids":input.get("tableIds",[]),
                    "directory":str(directory),"operation_id":p.id(label+"/capture"),"capture_id":capture_id,
                    "batch_size":input.get("batchSize",100),"max_bytes":input.get("captureMaxBytes",100663296),
                    "max_features":input.get("maxFeatures",100000),"max_attachments":input.get("maxAttachments",10000),
                    "token_env":input.get("tokenEnv"),"retry_failed":input.get("retryFailed",False)}
                manifest=p.effect(label,args,lambda f:capture(**f))
                check(manifest["coverage"]["complete"] and not manifest["coverage"]["sourceChanged"],"Complete stable actual source is required before field approval")
                request=lambda:{"expectedRevision":w.current()["revision"],"command":{"requestId":p.id(label+"/import"),
                    "kind":"capture.import","actor":input["actor"],"at":now(),"body":{"manifest":manifest}}}
                p.effect(label+"-import",request,lambda f:import_capture(w,directory,f["command"],f["expectedRevision"]))
                return manifest
            first=capture_stage("capture-first",ids["capture-first"])
            chosen=p.effect("source-selection",{},lambda _:choose_source(w,ids["capture-first"],input["layerIds"],input))
            def retain_source_attachment(frozen):
                entry=next(x for x in first["datasets"] if x["id"]==chosen["layerId"])
                for descriptor in entry["featurePages"]:
                    raw=w.read_blob(descriptor["sha256"]);page=json.loads(raw)
                    if any(row["attributes"].get(chosen["objectIdField"])==chosen["objectId"] for row in page["features"]):
                        check(len(raw)==descriptor["bytes"] and digest(raw)==descriptor["sha256"],"Original feature page changed")
                        w.put_blob(raw,descriptor["sha256"])
                        return {"id":p.id("source-attachment"),"name":"Original_County_Feature_Page.json",
                            "mediaType":"application/json","bytes":len(raw),"sha256":descriptor["sha256"],
                            "originalDescriptor":descriptor,"captureId":first["id"],
                            "meaning":"Exact originally captured County response containing this object; commissioning source evidence, not a field photograph."}
                raise ValueError("The actual selected object has no retained original feature page")
            attachment=p.effect("source-attachment",{"captureId":first["id"],"layerId":chosen["layerId"],"objectId":chosen["objectId"]},retain_source_attachment)
            def inspection():return domain.inspection_view(w.current()["state"],ids["inspection"],w.read_blob)
            def assignment():return w.current()["state"]["dispatch"]["assignments"][ids["assignment"]]
            form={"id":ids["form"],"key":"commissioning-field-review","captureId":ids["capture-first"],
                "layerId":chosen["layerId"],"previousFormId":None,
                "title":"Highway source review — proposed commissioning form",
                "description":chosen["meaning"],"fields":[
                    {"key":"object-id","label":"Original ObjectID","kind":"source","sourceField":chosen["objectIdField"],"readOnly":True},
                    {"key":"proposed-value","label":"Proposed "+chosen["editField"],"kind":"source","sourceField":chosen["editField"]},
                    {"key":"review-note","label":"Commissioning review note","kind":"text","required":True,"maxLength":3000}],
                "geometryEditable":False,"attachments":{"enabled":True,"required":False,"maxFiles":20,"maxBytes":67108864,"allowedTypes":[]}}
            p.command(w,"form-create","form.save",form)
            p.command(w,"crew-create","dispatch.crew.save",{"id":ids["crew"],"expectedVersion":0,
                "name":"Proposed commissioning crew","members":[{"id":input["actor"]["id"],"name":input["actor"]["name"],"role":"Commissioning operator"}],
                "contact":"","active":True,"notes":"Proposed application staffing configuration; no County assignment is asserted."})
            p.command(w,"package-create","dispatch.package.save",{"id":ids["package"],"expectedVersion":0,
                "title":"Proposed Highway field review","description":chosen["meaning"],"plannedMinutes":60,"dueAt":due,
                "scopeNotes":"One actual source object, one proposed form and local review; no service edits."})
            p.command(w,"assignment-create","dispatch.assignment.save",{"id":ids["assignment"],"expectedVersion":0,
                "packageId":ids["package"],"crewId":ids["crew"],"formId":ids["form"],"objectId":chosen["objectId"],
                "title":"Review original "+chosen["sourceName"]+" ObjectID "+str(chosen["objectId"]),
                "instructions":chosen["meaning"],"dueAt":due,"plannedMinutes":60,"priority":"NORMAL"})
            for target in ("READY","IN_FIELD"):
                p.command(w,"assignment-"+target.lower(),"dispatch.assignment.status",lambda target=target:{
                    "id":ids["assignment"],"expectedVersion":assignment()["version"],"status":target,
                    "reason":"Local commissioning workflow; proposed work remains separate from County records."})
            p.command(w,"inspection-open","inspection.open",{"id":ids["inspection"],"formId":ids["form"],
                "objectId":chosen["objectId"],"assignmentId":ids["assignment"]})
            p.command(w,"inspection-link","dispatch.assignment.link_inspection",lambda:{"id":ids["assignment"],
                "expectedVersion":assignment()["version"],"inspectionId":ids["inspection"]})
            def answer_body():
                v=inspection()["version"];answers=dict(v["answers"])
                answers["proposed-value"]=chosen["proposedValue"];answers["review-note"]=chosen["meaning"]
                return {"id":ids["inspection"],"expectedVersion":v["number"],"answers":answers,
                    "geometry":v["geometry"],"attachments":[{k:attachment[k] for k in ("id","name","mediaType","bytes","sha256")}],"note":"Application commissioning proposal only. The attachment is an exact original captured County feature response, not a field photograph."}
            p.command(w,"inspection-save","inspection.save",answer_body)
            def approve(label):
                p.command(w,label+"-submit","inspection.submit",lambda:{"id":ids["inspection"],
                    "expectedVersion":inspection()["version"]["number"],"submissionId":p.id(label+"/submission")})
                p.command(w,label+"-approve","inspection.decide",{"id":ids["inspection"],"submissionId":p.id(label+"/submission"),
                    "decisionId":p.id(label+"/approval"),"decision":"approve",
                    "note":"Approve the explicit local commissioning proposal for comparison only; no County publication."})
                p.command(w,label+"-dispatch-submit","dispatch.assignment.status",lambda:{"id":ids["assignment"],
                    "expectedVersion":assignment()["version"],"status":"SUBMITTED","reason":"Original local inspection is submitted and approved."})
            approve("first")
            p.command(w,"followup-open","dispatch.followup.save",{"id":ids["followup"],"expectedVersion":0,"assignmentId":ids["assignment"],
                "title":"Supervisor confirms proposal/source separation","owner":input["actor"]["name"],"dueAt":due,"status":"OPEN",
                "notes":"Commissioning follow-through on the application record."})
            p.command(w,"followup-resolve","dispatch.followup.save",lambda:{"id":ids["followup"],
                "expectedVersion":w.current()["state"]["dispatch"]["followups"][ids["followup"]]["version"],
                "assignmentId":ids["assignment"],"title":"Supervisor confirms proposal/source separation",
                "owner":input["actor"]["name"],"dueAt":due,"status":"RESOLVED",
                "notes":"The record is explicitly proposed local work. Original County bytes remain unchanged; no edits are submitted."})
            p.command(w,"dispatch-close-first","dispatch.assignment.status",lambda:{"id":ids["assignment"],
                "expectedVersion":assignment()["version"],"status":"CLOSED","reason":"Actual saved local approval and supervisor follow-through are complete."})
            p.command(w,"proposal-first","proposal.create",{"id":ids["proposal-first"],"inspectionIds":[ids["inspection"]]})
            following=capture_stage("capture-following",ids["capture-following"])
            p.command(w,"inspection-source-refresh","inspection.rebase",lambda:{"id":ids["inspection"],
                "expectedVersion":inspection()["version"]["number"],"captureId":ids["capture-following"],"formId":ids["form"],
                "conflictChoices":{chosen["editField"]:"keep"},"note":"Retain the original local proposal while explicitly adopting this following actual County capture."})
            p.effect("stale-closure-observation",{},lambda _:dispatch.dispatch_view(w.current()["state"],w.read_blob))
            p.command(w,"assignment-source-refresh","dispatch.assignment.refresh",lambda:{"id":ids["assignment"],
                "expectedVersion":assignment()["version"],"inspectionId":ids["inspection"],
                "expectedInspectionVersion":inspection()["version"]["number"],"reason":"Adopt the original rebased inspection and retain the former source/closure history."})
            approve("following")
            p.command(w,"dispatch-close-following","dispatch.assignment.status",lambda:{"id":ids["assignment"],
                "expectedVersion":assignment()["version"],"status":"CLOSED","reason":"Following source edition has its own actual saved local approval."})
            p.command(w,"proposal-following","proposal.create",{"id":ids["proposal-following"],"inspectionIds":[ids["inspection"]]})
            p.command(w,"commissioning-effort","dispatch.effort.record",lambda:{"id":p.id("commissioning-effort"),
                "assignmentId":ids["assignment"],"crewId":ids["crew"],"minutes":max(1,math.ceil((time.monotonic()-p.started)/60)),
                "performedAt":now(),"note":"Measured active programme commissioning interval, rounded up to a whole minute; application/source review, not County field labor."})
            p.command(w,"operating-report","dispatch.report.freeze",{"id":ids["report"],
                "title":"Highway commissioning operating handover","notes":"Actual application records and native source capture; staffing, due dates and field changes are explicit proposed configuration."})
            report_path=p.root/"Highway_Operating_Report.html"
            retain(report_path,dispatch.dispatch_report_html(w.current()["state"],ids["report"]).encode())
            proposal=next(x for x in w.current()["state"]["proposals"] if x["id"]==ids["proposal-following"])
            common={"captureId":ids["capture-following"],"layerId":chosen["layerId"],"formId":ids["form"],
                "objectIdColumn":"object_id","fieldMap":[
                    {"captureField":chosen["objectIdField"],"deliveryField":"object_id","encoding":"native"},
                    {"captureField":chosen["editField"],"deliveryField":"reviewed_value","encoding":"json-text"},
                    {"captureField":"@geometry","deliveryField":"geometry_json","encoding":"json-text"},
                    {"captureField":"@feature","deliveryField":"feature_json","encoding":"json-text"}]}
            bindings=[]
            for side in ("captured","approved-proposal"):
                selected={**common,"sourceKind":side}
                if side=="approved-proposal":selected.update(proposalId=proposal["id"],proposalSha256=proposal["sha256"])
                prepared=p.effect("dataset-"+side,{"operationId":p.id("dataset/"+side),"selection":selected},
                    lambda f:prepare_dataset(w,source,f["operationId"],f["selection"]))
                # The reusable application owner returns the original producer result.
                produced=prepared.get("result",prepared)
                report=produced.get("reportPath") or prepared.get("reportPath")
                check(isinstance(report,str),"Dataset preparation must return its actual finalized reportPath")
                review=p.native(w,bridge,"review-import-"+side,"review-import",{
                    "requestId":p.id("review-import/"+side),"reportPath":report,"selection":selected})
                binding=review["result"]["bindings"][0]
                imported=p.native(w,bridge,"import-"+side,"import",{"requestId":p.id("import/"+side),"binding":binding})
                bindings.append(imported["result"]["bindings"][0])
            definition={"name":"HighwayCapturedVsApprovedProposal","label":"Actual County capture versus approved local proposal",
                "source_edition":bindings[0]["editionId"],"target_edition":bindings[1]["editionId"],
                "columns":[{"name":"ObjectID","source":"object_id","target":"object_id","role":"key","meaning":"Original captured ObjectID"},
                    {"name":"ReviewedValue","source":"reviewed_value","target":"reviewed_value","role":"value","meaning":"Lossless JSON text of the selected original attribute"},
                    {"name":"Geometry","source":"geometry_json","target":"geometry_json","role":"value","meaning":"Full original geometry JSON"},
                    {"name":"CompleteFeature","source":"feature_json","target":"feature_json","role":"value","meaning":"Complete original attributes and geometry, or actual approved local proposal"}],
                "notes":"Same complete captured ObjectID set. The target carries the saved approved local proposal, never a County edit or a synthetic delivery."}
            review=p.native(w,bridge,"pair-review","review-pair",{"definition":definition,"bindings":bindings})
            pair=p.native(w,bridge,"pair-save","save-pair",{"requestId":p.id("pair-save"),"definition":definition,
                "bindings":bindings,"expected_revision":0,"review_sha256":review["result"]["result"]["review_sha256"]})["result"]["result"]
            run_result=p.native(w,bridge,"paired-run","run",{"requestId":p.id("paired-run"),"pair_id":pair["pair_id"],
                "expected_revision":pair["revision"],"definition_sha256":pair["definition_sha256"],"bindings":bindings})["result"]["result"]
            engine=Reconciliation(native)
            def pages(kind,run_id):
                offset=0;out=[]
                while True:
                    page=engine.grid(run_id,kind,offset=offset,limit=100)
                    out.append(page)
                    if page["next_offset"] is None:break
                    check(page["next_offset"]>offset,"Original native cursor did not advance");offset=page["next_offset"]
                return out
            rows=p.effect("native-complete-rows",{},lambda _:pages("rows",run_result["run_id"]))
            groups=p.effect("native-complete-groups",{},lambda _:pages("groups",run_result["run_id"]))
            def group_rows():
                for page in groups:
                    names=[x["name"] for x in page["columns"]]
                    for row in page["rows"]:yield dict(zip(names,row))
            actual=list(group_rows());check(actual,"Complete native comparison has no actual groups")
            picked=next((x for x in actual if str(x.get("key:ObjectID"))==str(chosen["objectId"])),None)
            check(picked is not None,"Original native groups omitted the actual selected ObjectID")
            decision=p.native(w,bridge,"paired-decision","decision",{"requestId":p.id("paired-decision"),
                "run_id":run_result["run_id"],"expected_revision":run_result["review_revision"],
                "subject":{"kind":"group","group_id":picked["group_id"]},"outcome":"ACCEPTED_DIFFERENCE",
                "actor":input["actor"]["name"],"reason":"Reviewed actual approved local commissioning proposal against its complete original captured source; no County publication.",
                "bindings":bindings})["result"]["result"]
            report=p.native(w,bridge,"paired-report","report",{"requestId":p.id("paired-report"),"run_id":run_result["run_id"],
                "expected_revision":decision["run"]["review_revision"],"bindings":bindings})["result"]["result"]
            exported=p.native(w,bridge,"paired-export","export",{"requestId":p.id("paired-export"),"report_id":report["report_id"],"bindings":bindings})
            # Close the original warehouse before proving cold restoration.
            native.close();native=None
            first_archive=p.effect("highway-export",lambda:{"publicationId":p.id("publication-first"),"revision":w.current()["revision"]},
                lambda f:export_workspace(w,f["publicationId"],source,selection,revision=f["revision"]))
            w.close();w=None
            received=p.effect("highway-receive",{"archive":first_archive["path"],"directory":str(p.root/"received-workspace"),
                "operationId":p.id("highway-receive"),"sha256":first_archive["sha256"],"bytes":first_archive["bytes"]},
                lambda f:receive_archive(f["archive"],f["directory"],f["operationId"],f["sha256"],f["bytes"]))
            receiver=Workspace(received["directory"])
            attachment_bytes=receiver.read_blob(attachment["sha256"])
            check(len(attachment_bytes)==attachment["bytes"] and digest(attachment_bytes)==attachment["sha256"],"Complete receiving omitted the actual captured source attachment")
            restored=p.effect("paired-cold-restore",{"recordId":exported["recordBody"]["id"],"operationId":p.id("paired-cold-restore")},
                lambda f:restore_operation(receiver,f["recordId"],f["operationId"]))
            p.command(receiver,"paired-cold-restore-record","reconciliation.record",restored["recordBody"],restored["recordRequestId"])
            # Native restore descriptor is retained in the original result; the same owner can open it for UI.
            original_restore=read(receiver.directory/"native-receiving"/p.id("paired-cold-restore")/"input.json")
            destination=original_restore["body"]["destination"]
            check(Path(destination)==receiver.directory/"native-receiving"/p.id("paired-cold-restore")/"workspace","Original cold receiving destination changed")
            received_native=DuckDBWorkspace(destination,memory_limit="128MB",threads=1)
            cold=Reconciliation(received_native)
            p.effect("cold-native-report",{},lambda _:cold.report(report["report_id"]))
            p.command(receiver,"received-followup","dispatch.followup.save",{"id":p.id("received-followup"),"expectedVersion":0,
                "assignmentId":ids["assignment"],"title":"Receiving operator confirms handover","owner":input["actor"]["name"],
                "dueAt":due,"status":"RESOLVED","notes":"Original field history and full paired report reopened from the complete handover."})
            before_repeat=receiver.current()
            repeated=receive_archive(first_archive["path"],received["directory"],p.id("highway-receive"),first_archive["sha256"],first_archive["bytes"])
            check(repeated["reused"] and repeated["current"]==before_repeat,"Repeated receiving changed later valid local work")
            app=Application(receiver,source,selection,native_workspace=received_native)
            launch=app.start()
            browser_input={"schema":"geocove.browser-programme.v1","operationId":p.id("browser"),"url":launch["url"],
                "origin":launch["origin"],"directory":str(p.root/"browser"),"executablePath":input["browserExecutable"],
                "workspaceId":ids["workspace"],"sourceSha256":selection["sha256"],"actor":input["actor"],"inspectionId":ids["inspection"],"assignmentId":ids["assignment"],
                "reportRecordId":exported["recordBody"]["id"],"runId":run_result["run_id"],"reportId":report["report_id"]}
            browser_dir=p.root/"browser";browser_dir.mkdir(exist_ok=True,mode=0o700)
            # A new loopback port/token is connection metadata, while the browser's saved action is immutable.
            retain(browser_dir/"connection.json",browser_input,False)
            completed=browser_dir/"result.json"
            if completed.exists():browser=read(completed)
            else:
                p.phase("browser","RUNNING")
                with open(browser_dir/"stdout.log","ab") as stdout,open(browser_dir/"stderr.log","ab") as stderr:
                    child=subprocess.run([input.get("node","node"),str(source/"tools/browser_program.cjs"),str(browser_dir/"connection.json")],
                        stdout=stdout,stderr=stderr,pass_fds=(p.guard,),check=False)
                check(child.returncode==0,"Original browser programme interrupted; inspect its exact saved intent/result/log")
                browser=read(completed)
            check(browser["state"]=="COMPLETE","Browser programme did not complete")
            app.close();app=None
            received_native.close();received_native=None
            second_archive=p.effect("following-highway-export",lambda:{"publicationId":p.id("publication-following"),"revision":receiver.current()["revision"]},
                lambda f:export_workspace(receiver,f["publicationId"],source,selection,revision=f["revision"]))
            final_current=receiver.current();receiver.close();receiver=None
            second=p.effect("following-highway-receive",{"archive":second_archive["path"],"directory":str(p.root/"second-received-workspace"),
                "operationId":p.id("second-receive"),"sha256":second_archive["sha256"],"bytes":second_archive["bytes"]},
                lambda f:receive_archive(f["archive"],f["directory"],f["operationId"],f["sha256"],f["bytes"]))
            check(second["current"]==final_current,"All-history second receiving changed original workspace")
            result={"schema":"geocove.original-programme-result.v1","state":"COMPLETE","operationId":input["operationId"],
                "inputSha256":digest(input),"sourceSha256":selection["sha256"],"workspaceId":ids["workspace"],
                "captureIds":[first["id"],following["id"]],"selected":chosen,"sourceAttachment":attachment,"inspectionId":ids["inspection"],
                "assignmentId":ids["assignment"],"proposalIds":[ids["proposal-first"],ids["proposal-following"]],
                "nativeWorkspaceId":exported["result"]["nativeWorkspaceId"],"pairId":pair["pair_id"],"runId":run_result["run_id"],
                "reportId":report["report_id"],"nativeExportRecordId":exported["recordBody"]["id"],
                "originalArchive":first_archive,"followingArchive":second_archive,"current":final_current,
                "browser":browser,"allOwnedResourcesClosed":True,"completedAt":now(),"artifacts":[]}
            paths=[report_path,Path(first_archive["path"]),Path(second_archive["path"]),completed]
            paths.extend(Path(x["path"]) for x in browser["screenshots"])
            for path in paths:
                raw=path.read_bytes();result["artifacts"].append({"path":str(path),"bytes":len(raw),"sha256":digest(raw)})
            retain(result_path,result)
            p.journal["state"]="COMPLETE";p.journal["resultSha256"]=digest(result);retain(p.root/"journal.json",p.journal,False)
            return result
        finally:
            errors=[]
            for value in (app,received_native,native,receiver,w):
                if value is not None:
                    try:value.close()
                    except BaseException as e:errors.append(str(e))
            if errors:raise RuntimeError("Owned resource closure failed: "+"; ".join(errors))
    except BaseException as error:
        p.journal["state"]="INTERRUPTED";p.journal["error"]={"type":type(error).__name__,"message":str(error),"at":now()}
        retain(p.root/"journal.json",p.journal,False)
        raise
    finally:p.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--input",required=True)
    a=parser.parse_args();result=run(read(a.input));print(json.dumps({"state":result["state"],"operationId":result["operationId"],"sourceSha256":result["sourceSha256"],"allOwnedResourcesClosed":result["allOwnedResourcesClosed"]}),flush=True)
if __name__=="__main__":main()

