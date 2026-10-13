#!/usr/bin/env python3
"""Continue the original programme with labelled authored NDTMS data and owned receiving."""
from __future__ import annotations
import argparse, io, json, os, signal, sqlite3, sys, threading, zipfile
from pathlib import Path
APPLICATION=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(APPLICATION))
from nelc.common import *
from nelc.workspace import Workspace
from nelc.ndtms import profile_document, PROFILE_ID, PROFILE_SHA256, KEYS, SCOPE_COLUMN
from nelc.portable import application_files,backup
from receive_workspace import receive_archive
from ndtms_cli import retained_request
from native.receiving import Programme as OriginalProgramme

ACTOR={"id":"ndtms-authored-receiving","name":"Authored NDTMS receiving operator"}
def fixture():
    profile,raw=profile_document();headers=[f["header"] for f in profile["fields"]]
    def row(changes):
        require(set(changes)<=set(headers),"NATIVE_FIXTURE","The authored source uses an unknown original header.")
        values=dict.fromkeys(headers,"")
        values.update(changes);return [values[h] for h in headers]
    base={"AGNCY":"EX001","CLIENTID":"authored-client-01","EPISODID":"authored-episode-01",
          "CONSENT":"Y","FINITIAL":"A","SINITIAL":"Z","DOB":"19800101","CMSID":"authored-original"}
    records=[
      row({**base,"MODID":"authored-intervention-01","MODST":"20260402","MODAL":"96","MODSET":"99"}),
      row({**base,"SUBMID":"authored-sir-01","SUBMODDT":"20260403","PHDOSBUP":"2.5"}),
      row({**base,"TOPID":"authored-top-01","TOPDATE":"20260404","ALCUSE":"99","CONSMP":"0.0"}),
      row({**base,"CIRID":"authored-cir-01","CIRDT":"20260405","CIRHEPBSTAT":"N"}),
      row({**base,"MODID":"authored-intervention-01","MODST":"20260402","MODAL":"96","MODSET":"99"}),
      row({**base,"CMSID":"authored-conflict"}),
      row({"AGNCY":"EX001","CLIENTID":"authored-client-01","EPISODID":"authored-no-consent","CONSENT":"N"}),
      row({"AGNCY":"EX001","CLIENTID":"authored-client-02","EPISODID":"authored-episode-02","CONSENT":"Y",
           "FINITIAL":"B","SINITIAL":"Z","DOB":"19810101","CMSID":"authored-second"})
    ]
    return csv_bytes(headers,records),headers

class Course(OriginalProgramme):
    def __init__(self,args,stop):
        self.args=args;self.stop=stop;self.children=[];self.child_logs=[];self.root=Path(args.work).absolute()
        self.root.mkdir(parents=True,exist_ok=True)
        require(self.root.is_dir() and not self.root.is_symlink(),"NATIVE_ROOT","Use the same ordinary programme work directory.")
        lock=self.root/"ndtms-owner.sqlite";require(not lock.is_symlink(),"NATIVE_ROOT","The native owner file is not ordinary.")
        self.owner=sqlite3.connect(lock,timeout=0,isolation_level=None)
        try:
            self.owner.execute("CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY)")
            self.owner.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            self.owner.close();raise Problem("NATIVE_IN_USE","The original NDTMS programme still has an active process.")
        try:
            app_sha,files=application_files(APPLICATION,stop)
            self.csv,self.headers=fixture()
            binding={"schema":"nelc.ndtms-native-selection/v1","operationId":args.operation_id,
                     "applicationSha256":app_sha,"profileSha256":PROFILE_SHA256,
                     "authoredInput":{"bytes":len(self.csv),"sha256":hashlib.sha256(self.csv).hexdigest()},
                     "scope":"Fictional structural receiving example only; no real people, supplier tenant or clinical acceptance."}
            self.path=self.root/"NDTMS_NATIVE.json"
            if self.path.exists():
                require(not self.path.is_symlink(),"NATIVE_JOURNAL","Use the original regular journal.")
                self.state=json.loads(self.path.read_text("utf-8"))
                require(self.state["selection"]==binding,"NATIVE_SELECTION","Resume the same source/application/operation.")
            else:
                allowed={"ndtms-owner.sqlite","ndtms-owner.sqlite-journal","ndtms-owner.sqlite-wal","ndtms-owner.sqlite-shm"}
                require(all(p.name in allowed for p in self.root.iterdir()),"NATIVE_ROOT","Use a fresh programme directory or its original journal.")
                self.state={"schema":"nelc.ndtms-native-receiving/v1","selection":binding,"steps":{},"createdAt":now()};self.save()
            self.requests=self.root/"requests";self.requests.mkdir(exist_ok=True)
            self.output=self.root/"artifacts";self.output.mkdir(exist_ok=True)
            self.sender=self.open("source-workspace");self.target=self.open("owned-target-workspace")
        except BaseException:
            self.owner.close();raise
    def close(self):
        super().close()
    def save(self):
        atomic_bytes(self.path,(canonical(self.state)+"\n").encode("utf-8"))
    def open(self,name):
        path=self.root/name
        return Workspace(path) if (path/"workspace.sqlite").is_file() else Workspace(path,create=True,name="Authored NDTMS "+name)
    def step(self,name,workspace,action,data):
        path=self.requests/(name+".json")
        if path.exists():
            request=json.loads(path.read_text("utf-8"))
            require(request["action"]==action and request["data"]==data and request["actor"]==ACTOR,
                    "NATIVE_REQUEST_CHANGED","Preserve the exact original receiving request.",name)
        else:
            request={"requestId":self.args.operation_id+":"+name,"expectedRevision":workspace.metadata()["revision"],
                     "actor":ACTOR,"action":action,"data":data}
            retained_request(path,request)
        result=workspace.mutate(request,self.stop)
        previous=self.state["steps"].get(name)
        if previous:require(previous["operationId"]==result["operationId"] and previous["result"]==result["result"],
                            "NATIVE_RECEIPT_CHANGED","The retained original step differs.")
        else:self.state["steps"][name]=result;self.save()
        return result["result"]
    def rows(self,workspace,kind,selection):
        revision=workspace.metadata()["revision"];offset=0;items=[]
        while True:
            page=workspace.page(kind,selection,revision,offset,200);items.extend(page["items"])
            if page["nextOffset"] is None:return items
            offset=page["nextOffset"]
    def transfer(self,source,target,ref):
        with source.connect() as db:path=source.object(db,ref,self.stop)
        with path.open("rb") as stream:copied=target.put_stream(stream,ref["name"],signal=self.stop)
        require((copied["sha256"],copied["bytes"])==(ref["sha256"],ref["bytes"]),"NATIVE_TRANSFER","The original transferred bytes differ.")
        return copied
    def returned(self,name,contract,export):
        archive=self.transfer(self.target,self.sender,export["archive"]);mf=self.transfer(self.target,self.sender,export["manifest"])
        ed=self.step(name+"-edition",self.sender,"import-edition",{"name":name+" complete owned local return","object":archive,
            "source":{"kind":"owned-local-export","manifest":mf},"csv":{"default":{"encoding":"utf-8-sig"}}})
        tables=[]
        for row in export["snapshot"]["tables"]:
            table=next(t for t in ed["tables"] if t["name"]==row["file"])
            require(table["headers"]==row["headers"],"NATIVE_RETURN","The owned return headers changed.")
            tables.append({k:row[k] for k in ("mappingId","fields","identityColumn","versionColumn","dispositionColumn","dispositions")}|
                          {"tableId":table["id"]})
        value=self.step(name,self.sender,"import-target-return",{"contractId":contract["id"],"editionId":ed["id"],
            "kind":"owned-local-export","basis":"Actual export of the owned authored receiving database; not a supplier system.",
            "completeSnapshot":True,"coverageNote":"Every record and table in the authored local target.","tables":tables})
        require(value["ready"] and value["snapshotSha256"]==export["snapshot"]["snapshotSha256"],"NATIVE_RETURN","Complete returned rows differ.")
        return value
    def release(self,name,contract):
        self.step(name+"-approval",self.sender,"approve-contract",{"contractId":contract["id"],
            "definitionSha256":contract["definitionSha256"],"sourceReviewed":True,"authorityConfirmed":True,
            "reason":"Reviewed explicit authored local schema and separate consent partition; no supplier or clinical approval."})
        assessment=self.step(name+"-assessment",self.sender,"assess",{"contractId":contract["id"]})
        require(assessment["ready"] and assessment["mappedRows"]==10,"NATIVE_ASSESSMENT","The ten authored normalized rows and parent relationships must agree.")
        return self.step(name,self.sender,"release",{"contractId":contract["id"],"assessmentId":assessment["id"],
            "name":name,"reason":"Release the complete exact authored local receiving contract only."})
    def apply(self,name,target,plan):
        archive=self.transfer(self.sender,self.target,plan["archive"])
        return self.step(name,self.target,"apply-local-plan",{"targetId":target["id"],"archive":archive,"planId":plan["id"],"confirmOwnedLocal":True})
    def compare(self,name,release,current,baseline):
        return self.step(name,self.sender,"compare-target",{"releaseId":release["id"],"currentReturnId":current["id"],
            "baselineId":baseline["id"],"name":name,"reason":"Compare every actual returned field, preserving later target edits."})
    def plan(self,name,comparison):
        return self.step(name,self.sender,"plan-delta",{"comparisonId":comparison["id"],"allEligible":True,
            "reason":name+" explicitly selects eligible authored local rows only."})
    def verify(self,name,plan,current):
        v=self.step(name,self.sender,"verify-plan",{"planId":plan["id"],"returnId":current["id"],"reason":"Read back every field and actual local disposition."})
        require(v["allFieldsMatched"] and v["allRowsAccepted"],"NATIVE_VERIFICATION","The full local return did not match.")
        return v
    def export_object(self,name,workspace,ref):
        with workspace.connect() as db:source=workspace.object(db,ref,self.stop)
        path=self.output/name
        def exact():
            require(path.is_file() and not path.is_symlink() and file_hash(path,self.stop)==(ref["sha256"],ref["bytes"]),
                    "NATIVE_OUTPUT","Preserve the differing original artifact.")
        if path.exists() or path.is_symlink():exact()
        else:
            fd,temporary=tempfile.mkstemp(prefix=".ndtms-artifact-",dir=self.output)
            try:
                with source.open("rb") as body,os.fdopen(fd,"wb") as target:
                    while True:
                        check_stop(self.stop);chunk=body.read(1024*1024)
                        if not chunk:break
                        target.write(chunk)
                    target.flush();os.fsync(target.fileno())
                require(file_hash(temporary,self.stop)==(ref["sha256"],ref["bytes"]),"NATIVE_OUTPUT","The complete copied artifact differs.")
                try:os.link(temporary,path)
                except FileExistsError:exact()
                directory=os.open(self.output,os.O_RDONLY)
                try:os.fsync(directory)
                finally:os.close(directory)
            finally:
                try:os.unlink(temporary)
                except FileNotFoundError:pass
        return {"path":str(path),"sha256":ref["sha256"],"bytes":ref["bytes"]}

    def completed(self):
        result=self.state.get("result")
        if result is None:return None
        require(result.get("state")=="CORE_COMPLETE" and result["selection"]==self.state["selection"],
                "NATIVE_RESULT","Retain the original complete receiving result.")
        by_id={self.sender.metadata()["id"]:self.sender,self.target.metadata()["id"]:self.target}
        for label,saved in self.state["steps"].items():
            workspace=by_id.get(saved["workspaceId"])
            require(workspace is not None,"NATIVE_WORKSPACE","The completed request belongs to another original workspace.")
            request_path=self.requests/(label+".json")
            require(request_path.is_file() and not request_path.is_symlink(),"NATIVE_REQUEST","Retain every complete original request.")
            request=json.loads(request_path.read_text("utf-8"));retained_request(request_path,request)
            observed=workspace.operation(request["requestId"])
            require(observed is not None and all(observed[k]==saved[k] for k in ("operationId","requestId","workspaceId","revision","action","result"))
                    and observed["operationId"]=="operation-"+digest(request)[:28],
                    "NATIVE_RECEIPT_CHANGED","The original saved request/commit changed.",label)
        failed=self.state.get("staleRejection")
        require(failed is not None,"NATIVE_FAILED_REQUEST","Retain the actual stale-request refusal.")
        refused=json.loads((self.requests/"stale-apply-rejection.json").read_text("utf-8"))
        require(digest(refused)==failed["requestSha256"] and self.target.operation(refused["requestId"]) is None,
                "NATIVE_FAILED_REQUEST","The original refused request was changed or committed.")
        for artifact in result["artifacts"]:
            path=Path(artifact["path"])
            require(path.parent==self.output,"NATIVE_OUTPUT","Keep the original receiving output directory.")
            self.export_object(path.name,self.sender,{**artifact,"name":path.name})
        archive=result["backup"];path=Path(archive["path"])
        require(path.is_file() and not path.is_symlink() and file_hash(path,self.stop)==(archive["sha256"],archive["bytes"]),
                "NATIVE_BACKUP","Retain the complete exact original archive.")
        received=receive_archive(path,self.root/"independent-reopen",archive["sha256"],signal=self.stop)
        cold=Workspace(self.root/"independent-reopen"/"workspace")
        require(cold.metadata()["id"]==result["sourceWorkspaceId"]
                and cold.record("ndtms-analysis",result["analysisId"])==self.sender.record("ndtms-analysis",result["analysisId"]),
                "NATIVE_REOPEN","The independently received original analysis differs.")
        observed={**result,"replayed":True,"reopenedAt":now(),"currentSource":self.sender.metadata(),
                  "currentTarget":self.target.metadata(),"currentRecipient":cold.metadata(),
                  "receivedOriginalArchive":received,
                  "replayMeaning":"Original completed course retained; later native source, target and recipient operations are preserved, not rerun or represented as the original target state."}
        return observed

    def run(self):
        completed=self.completed()
        if completed is not None:return completed
        original=self.sender.put_bytes(self.csv,"Authored_NDTMS_Receiving.csv",signal=self.stop)
        ed=self.step("authored-original",self.sender,"import-edition",{"name":"Authored NDTMS structural example — no real people",
            "object":original,"source":{"kind":"authored-receiving-example","clinicalUse":False},"csv":{"encoding":"utf-8-sig"}})
        table=ed["tables"][0]
        data={"editionId":ed["id"],"tableId":table["id"],"profileId":PROFILE_ID,"cohort":"mixed",
              "scope":{"kind":"full","from":None,"to":None,"agency":"EX001","note":"Complete fictional eight-record receiving example; no clinical or reporting completeness claim."}}
        blocked=self.step("conflicting-analysis",self.sender,"analyse-ndtms",data)
        require(not blocked["ready"] and blocked["counts"]["conflictedEntities"]==1,"NATIVE_CONFLICT","The repeated episode conflict must remain visible.")
        raw_rows=self.rows(self.sender,"source-rows",{"editionId":ed["id"],"tableId":table["id"]})
        row=next(r for r in raw_rows if r["sourceRow"]==7);column=self.headers.index("CMSID")
        correction=self.step("review-source-conflict",self.sender,"correct-cell",{"editionId":ed["id"],"tableId":table["id"],
            "rowId":row["id"],"column":column,"from":"authored-conflict","to":"authored-original","supersedes":None,
            "reason":"The labelled authored fixture explicitly identifies the one conflicting repeated episode token.",
            "basis":{"kind":"authored-native-course","sourceRow":7,"expected":"authored-original"}})
        ready=self.step("corrected-analysis",self.sender,"analyse-ndtms",data)
        require(ready["ready"] and ready["counts"]["nativeClients"]==2 and ready["counts"]["clientPartitionRows"]==3,
                "NATIVE_CONSENT","Two native clients must retain three separate consent partition rows.")
        projected=self.rows(self.sender,"ndtms-rows",{"analysisId":ready["id"]})
        limited=next(r for r in projected if r["entity"]=="client" and r["consentScope"]=="N")
        require(all(v=="" for k,v in limited["values"].items() if k not in ("AGNCY","CLIENTID",SCOPE_COLUMN)),
                "NATIVE_CONSENT","No-consent projection acquired protected data.")
        published=self.step("publish-six-tables",self.sender,"publish-ndtms",{"analysisId":ready["id"]})
        normalized=published["edition"]
        require(len(normalized["tables"])==6 and normalized["rows"]==10,"NATIVE_SIX_TABLES","The complete normalized source must expose exactly six tables and ten rows.")
        mappings=[]
        for t in normalized["tables"]:
            entity=Path(t["name"]).stem;keys=KEYS[entity]+([SCOPE_COLUMN] if entity=="client" else [])
            mappings.append({"id":entity,"entity":"Authored "+entity,"sourceTableId":t["id"],"sourceKey":[t["headers"].index(h) for h in keys],
                "scope":[],"target":{"table":entity+".csv","key":keys,"encoding":"utf-8-sig","delimiter":",",
                "allowRollbackDeleteCreated":True,"columns":[{"name":h,"source":i,"transform":"identity","type":"text","required":h in keys}
                for i,h in enumerate(t["headers"])]+[{"name":"Receiving_note","source":None,"transform":"constant","constant":"Authored initial","type":"text","required":True}]}})
        relationships=[{"id":"episode_client","fromTable":"episode","toTable":"client",
            "fromFields":["AGNCY","CLIENTID",SCOPE_COLUMN],"toFields":["AGNCY","CLIENTID",SCOPE_COLUMN],
            "cardinality":"many-to-one","required":True,"reason":"Generated adapter privacy partition; never enrich minimal N rows from consented Y client projections."}]
        for entity in KEYS:
            if entity in ("client","episode"):continue
            relationships.append({"id":entity+"_episode","fromTable":entity,"toTable":"episode",
                "fromFields":KEYS["episode"],"toFields":KEYS["episode"],"cardinality":"many-to-one","required":True,
                "reason":"Exact original agency/client/episode tuple in the authored local schema."})
        definition={"name":"Authored six-entity local receiving contract","authority":"Owned example only; not a vendor schema",
                    "editionId":normalized["id"],"tables":mappings,"relationships":relationships,"rules":[],"sourceTokens":{}}
        contract=self.step("explicit-owned-contract",self.sender,"save-contract",{"definition":definition})
        initial=self.release("initial-reviewed-release",contract)
        target=self.step("open-owned-target",self.target,"open-local-target",{"name":"Independent authored NDTMS target",
            "manifest":self.transfer(self.sender,self.target,initial["manifest"]),
            "archive":self.transfer(self.sender,self.target,initial["archive"]),"confirmOwnedLocal":True})
        empty=self.returned("empty-return",contract,self.step("empty-export",self.target,"export-local-target",{"targetId":target["id"]}))
        baseline=self.step("empty-baseline",self.sender,"accept-baseline",{"returnId":empty["id"],"snapshotSha256":empty["snapshotSha256"],"reason":"Actual complete empty owned target."})
        comparison=self.compare("initial-comparison",initial,empty,baseline)
        plan=self.plan("initial-plan",comparison);receipt=self.apply("initial-apply",target,plan)
        received=self.returned("initial-return",contract,self.step("initial-export",self.target,"export-local-target",{"targetId":target["id"]}))
        self.verify("initial-verification",plan,received)
        accepted=self.step("accepted-baseline",self.sender,"accept-baseline",{"returnId":received["id"],"snapshotSha256":received["snapshotSha256"],"reason":"Full actual local returned field/identity/disposition comparison."})
        next_definition=json.loads(canonical(contract["definition"]))
        for m in next_definition["tables"]:m["target"]["columns"][-1]["constant"]="Authored successor"
        following=self.step("successor-contract",self.sender,"save-contract",{"definition":next_definition,"supersedes":contract["id"],"reason":"Change only authored target-only receiving notes."})
        next_release=self.release("successor-release",following)
        changes=self.compare("successor-comparison",next_release,received,accepted)
        delta=self.plan("successor-plan",changes);stale=self.plan("separate-stale-plan",changes)
        delta_receipt=self.apply("successor-apply",target,delta)
        stale_archive=self.transfer(self.sender,self.target,stale["archive"])
        failure_name="stale-apply-rejection"
        failure_data={"targetId":target["id"],"archive":stale_archive,"planId":stale["id"],"confirmOwnedLocal":True}
        failed=self.state.get("staleRejection")
        if failed:
            original_request=json.loads((self.requests/(failure_name+".json")).read_text("utf-8"))
            require(digest(original_request)==failed["requestSha256"] and original_request["action"]=="apply-local-plan"
                    and original_request["data"]==failure_data and original_request["actor"]==ACTOR
                    and self.target.operation(original_request["requestId"]) is None,
                    "NATIVE_FAILED_REQUEST","Retain the exact refused request and its unchanged absence of a committed operation.")
        else:
            try:self.step(failure_name,self.target,"apply-local-plan",failure_data)
            except Problem as error:
                require(error.code in ("TARGET_SNAPSHOT_STALE","LOCAL_RECORD_STALE"),
                        "NATIVE_STALE_CODE","The original target returned an unexpected error.",error.as_dict())
                original_request=json.loads((self.requests/(failure_name+".json")).read_text("utf-8"))
                require(self.target.operation(original_request["requestId"]) is None,"NATIVE_FAILED_REQUEST","The refused request unexpectedly committed.")
                self.state["staleRejection"]={"requestSha256":digest(original_request),"error":error.as_dict()};self.save()
            else:raise Problem("NATIVE_STALE_ACCEPTED","A separate stale write was unexpectedly accepted.")
        current=self.returned("successor-return",following,self.step("successor-export",self.target,"export-local-target",{"targetId":target["id"]}))
        verified=self.verify("successor-verification",delta,current)
        row_ids=[r["rowId"] for r in self.rows(self.sender,"plan-rows",{"planId":delta["id"]})]
        undo=self.step("rollback-plan",self.sender,"plan-rollback",{"verificationId":verified["id"],"currentReturnId":current["id"],
            "rowIds":row_ids,"reason":"Restore the original authored target-only notes while preserving all source values and actual native identities."})
        self.apply("rollback-apply",target,undo)
        final_export=self.step("final-export",self.target,"export-local-target",{"targetId":target["id"]})
        final_return=self.returned("final-return",following,final_export);self.verify("rollback-verification",undo,final_return)
        restored=self.compare("restored-comparison",initial,final_return,accepted)
        require(restored["counts"]=={"UNCHANGED":10},"NATIVE_RESTORATION","The full original values were not restored.")
        artifacts=[self.export_object("Authored_Original_290.csv",self.sender,original),
                   self.export_object("Complete_Six_Entity_Source.zip",self.sender,published["archive"]),
                   self.export_object("Final_Actual_Local_Target.zip",self.target,final_export["archive"])]
        for name,ref in ready["artifacts"].items():artifacts.append(self.export_object("analysis-"+name+"-"+ref["name"],self.sender,ref))
        source_check=self.sender.verify(True,self.stop);target_check=self.target.verify(True,self.stop)
        if "backupSelection" not in self.state:
            self.state["backupSelection"]={"revision":self.sender.metadata()["revision"],"workspaceId":self.sender.metadata()["id"],
                                          "applicationSha256":self.state["selection"]["applicationSha256"]};self.save()
        selected=self.state["backupSelection"]
        require(selected["workspaceId"]==self.sender.metadata()["id"]
                and selected["applicationSha256"]==self.state["selection"]["applicationSha256"],
                "NATIVE_BACKUP_SELECTION","Retain the original complete backup selection.")
        if "backup" not in self.state:
            self.state["backup"]=backup(self.sender,APPLICATION,revision=selected["revision"],signal=self.stop);self.save()
        archive=self.state["backup"]
        require(Path(archive["path"]).is_file() and not Path(archive["path"]).is_symlink()
                and file_hash(archive["path"],self.stop)==(archive["sha256"],archive["bytes"]),
                "NATIVE_BACKUP","The retained complete original backup differs.")
        received_workspace=receive_archive(archive["path"],self.root/"independent-reopen",archive["sha256"],signal=self.stop)
        cold=Workspace(self.root/"independent-reopen"/"workspace")
        require(cold.metadata()["id"]==self.sender.metadata()["id"] and cold.record("ndtms-analysis",ready["id"])==ready,
                "NATIVE_REOPEN","The complete independent workspace lost its original analysis.")
        result={"schema":"nelc.ndtms-native-result/v1","state":"CORE_COMPLETE","selection":self.state["selection"],
                "sourceWorkspace":str(self.sender.root),"sourceWorkspaceId":self.sender.metadata()["id"],
                "sourceRevision":self.sender.metadata()["revision"],"originalEditionId":ed["id"],"originalTableId":table["id"],
                "sourceCorrectionId":correction["id"],"sourceCorrectionRowId":row["id"],
                "blockedAnalysisId":blocked["id"],"analysisId":ready["id"],
                "normalizedEditionId":normalized["id"],"contractId":contract["id"],"targetId":target["id"],
                "restoredComparison":restored,"artifacts":artifacts,"backup":archive,"received":received_workspace,
                "sourceVerification":source_check,"targetVerification":target_check,
                "renderedStatus":"PENDING: original operator/browser owner must open/use/look at exact application, all reports and attachments at desktop and narrow widths."}
        self.state["result"]=result;self.save();return result

    def browser_inputs(self):
        """Freeze original executable selections and complete outgoing input bytes."""
        root=self.root/"browser-inputs";root.mkdir(exist_ok=True)
        require(root.is_dir() and not root.is_symlink(),"NATIVE_BROWSER_INPUT","Use the original ordinary input directory.")
        def identity(path):
            path=Path(path)
            require(path.is_absolute() and path.is_file() and not path.is_symlink(),
                    "NATIVE_BROWSER_INPUT","Select a complete ordinary absolute input file.",str(path))
            sha,size=file_hash(path,self.stop);return {"path":str(path),"sha256":sha,"bytes":size}
        def publish(path,source,expected):
            if path.exists() or path.is_symlink():
                actual=identity(path)
                require(all(actual[k]==expected[k] for k in ("sha256","bytes")),
                        "NATIVE_BROWSER_INPUT","Preserve the differing retained original input.",str(path));return
            require(source is not None,"NATIVE_BROWSER_INPUT","The original and retained input are both absent.",str(path))
            fd,temporary=tempfile.mkstemp(prefix=".ndtms-input-",dir=root)
            try:
                with Path(source).open("rb") as inp,os.fdopen(fd,"wb") as out:
                    while True:
                        check_stop(self.stop);chunk=inp.read(1024*1024)
                        if not chunk:break
                        out.write(chunk)
                    out.flush();os.fsync(out.fileno())
                require(file_hash(temporary,self.stop)==(expected["sha256"],expected["bytes"]),
                        "NATIVE_BROWSER_INPUT","The selected input changed while being retained.")
                try:os.link(temporary,path)
                except FileExistsError:
                    actual=identity(path);require(all(actual[k]==expected[k] for k in ("sha256","bytes")),
                        "NATIVE_BROWSER_INPUT","A differing input appeared during publication.")
                directory=os.open(root,os.O_RDONLY)
                try:os.fsync(directory)
                finally:os.close(directory)
            finally:
                try:os.unlink(temporary)
                except FileNotFoundError:pass
        runtime={}
        for name in ("node","playwright","chromium"):
            chosen=Path(getattr(self.args,name))
            require(chosen.is_absolute(),"NATIVE_RUNTIME","Use an absolute existing runtime path.",name)
            actual=identity(chosen.resolve(strict=True));runtime[name]={"selectedPath":str(chosen),**actual}
        require(not self.args.attachments or Path(self.args.attachments).is_absolute(),
                "NATIVE_ATTACHMENTS","Use an absolute original attachment selection path.")
        manifest_path=str(Path(self.args.attachments).absolute()) if self.args.attachments else None
        archive_path=str(Path(self.args.application_archive).absolute()) if self.args.application_archive else None
        require(not self.args.application_archive or Path(self.args.application_archive).is_absolute(),
                "NATIVE_APPLICATION_ARCHIVE","Select the absolute exact outgoing application ZIP.")
        saved=self.state.get("browserInputs")
        if saved is None:
            manifest=None;attachments=[]
            if manifest_path is not None:
                manifest=identity(manifest_path)
                require(manifest["bytes"]<=1024*1024,"NATIVE_ATTACHMENTS","The attachment selection exceeds 1 MiB.")
                manifest_raw=Path(manifest_path).read_bytes()
                require((len(manifest_raw),hashlib.sha256(manifest_raw).hexdigest())==(manifest["bytes"],manifest["sha256"]),
                        "NATIVE_ATTACHMENTS","The original attachment selection changed while being read.")
                rows=json.loads(manifest_raw.decode("utf-8"))
                require(isinstance(rows,list) and len(rows)<=64,"NATIVE_ATTACHMENTS","Select at most 64 complete attachment identities.")
                seen=set()
                for index,row in enumerate(rows):
                    require(isinstance(row,dict) and isinstance(row.get("path"),str),"NATIVE_ATTACHMENTS","Use complete path/bytes/sha256 rows.")
                    actual=identity(row["path"])
                    require(actual["path"] not in seen and all(actual[k]==row.get(k) for k in ("bytes","sha256")),
                            "NATIVE_ATTACHMENTS","Select each complete exact outgoing file once.",row["path"]);seen.add(actual["path"])
                    target=root/("attachment-"+str(index+1).zfill(2)+"-"+Path(actual["path"]).name)
                    attachments.append({**actual,"originalPath":actual["path"],"path":str(target)})
                manifest={**manifest,"retainedPath":str(root/"Attachment_Selection.json")}
            saved={"schema":"nelc.ndtms-browser-inputs/v1","runtime":runtime,
                   "manifestPath":manifest_path,"manifest":manifest,"applicationArchivePath":archive_path,"attachments":attachments}
            self.state["browserInputs"]=saved;self.save()
        require(saved["runtime"]==runtime and saved["manifestPath"]==manifest_path
                and saved.get("applicationArchivePath")==archive_path,
                "NATIVE_BROWSER_SELECTION","Continue the original runtime and outgoing attachment selection.")
        selected=([{"originalPath":saved["manifest"]["path"],"path":saved["manifest"]["retainedPath"],
                    "sha256":saved["manifest"]["sha256"],"bytes":saved["manifest"]["bytes"]}] if saved["manifest"] else [])+saved["attachments"]
        for row in selected:
            original=Path(row["originalPath"])
            if original.exists() or original.is_symlink():
                actual=identity(original)
                require(all(actual[k]==row[k] for k in ("sha256","bytes")),
                        "NATIVE_BROWSER_INPUT","The original selected input now differs.",str(original))
                source=original
            else:source=None
            publish(Path(row["path"]),source,row)
        if archive_path is not None:
            matches=[row for row in saved["attachments"] if row["originalPath"]==archive_path]
            require(len(matches)==1,"NATIVE_APPLICATION_ARCHIVE","Include the exact application ZIP in the frozen outgoing attachment selection.")
            self.check_application_archive(matches[0])
        return saved


    def check_application_archive(self,selection):
        """Bind the actually running application to every member of its outgoing ZIP."""
        manifest_raw=(APPLICATION/"APPLICATION.json").read_bytes()
        require(hashlib.sha256(manifest_raw).hexdigest()==self.state["selection"]["applicationSha256"],
                "NATIVE_APPLICATION_ARCHIVE","The executing source manifest changed.")
        manifest=json.loads(manifest_raw)
        expected={row["path"]:row for row in manifest["files"]}
        require(len(expected)==len(manifest["files"]) and "APPLICATION.json" not in expected,
                "NATIVE_APPLICATION_ARCHIVE","The complete selected application manifest repeats a member.")
        expected["APPLICATION.json"]={"sha256":hashlib.sha256(manifest_raw).hexdigest(),"bytes":len(manifest_raw)}
        path=Path(selection["path"])
        require(file_hash(path,self.stop)==(selection["sha256"],selection["bytes"]),
                "NATIVE_APPLICATION_ARCHIVE","The complete retained outgoing ZIP differs.")
        with zipfile.ZipFile(path) as archive:
            members=archive.infolist()
            require(len(members)==len(expected) and len({row.filename for row in members})==len(members)
                    and {row.filename for row in members}==set(expected),
                    "NATIVE_APPLICATION_ARCHIVE","The outgoing ZIP must contain APPLICATION.json and only its exact complete file inventory at the root.")
            for member in members:
                check_stop(self.stop)
                require(not member.is_dir() and not member.flag_bits&1
                        and ((member.external_attr>>16)&0o170000) in (0,0o100000)
                        and member.file_size==expected[member.filename]["bytes"],
                        "NATIVE_APPLICATION_ARCHIVE","An outgoing member differs from its regular complete source selection.",member.filename)
                h=hashlib.sha256();size=0
                with archive.open(member) as inp:
                    while True:
                        check_stop(self.stop);chunk=inp.read(1024*1024)
                        if not chunk:break
                        size+=len(chunk);require(size<=member.file_size,"NATIVE_APPLICATION_ARCHIVE","An outgoing member exceeds its declared size.")
                        h.update(chunk)
                require((h.hexdigest(),size)==(expected[member.filename]["sha256"],expected[member.filename]["bytes"]),
                        "NATIVE_APPLICATION_ARCHIVE","An outgoing application member differs from the exact executing source.",member.filename)
        require(file_hash(path,self.stop)==(selection["sha256"],selection["bytes"]),
                "NATIVE_APPLICATION_ARCHIVE","The selected outgoing ZIP changed while being read.")

    def browser_phase(self,phase,application,workspace,core,source=None):
        inputs=self.browser_inputs();label="ndtms-browser-"+phase
        output=self.output/label;output.mkdir(exist_ok=True)
        require(output.is_dir() and not output.is_symlink(),"NATIVE_BROWSER_OUTPUT","Use the original browser output directory.")
        process,ready=self.operator(application,workspace,"ndtms-operator-"+phase)
        try:
            require(ready["workspaceId"]==core["sourceWorkspaceId"],"NATIVE_BROWSER_WORKSPACE","The actual listener opened another workspace.")
            config={"schema":"nelc.ndtms-browser-receiving/v1","phase":phase,"operationId":self.args.operation_id,
                    "workspaceId":ready["workspaceId"],"baseUrl":ready["baseUrl"],"sessionUrl":ready["url"],
                    "output":str(output),"playwright":inputs["runtime"]["playwright"]["path"],
                    "chromium":inputs["runtime"]["chromium"]["path"],
                    "receiveName":"original-ndtms-"+digest(self.args.operation_id)[:16],
                    "nativeResult":core,"attachments":[{k:row[k] for k in ("path","bytes","sha256")} for row in inputs["attachments"]]}
            if source is not None:config["sourceBrowserResult"]=source["course"]
            result=self.command([inputs["runtime"]["node"]["path"],str(application/"native/browser.mjs")],label,
                                stdin=(canonical(config)+"\n").encode("utf-8"))
            expected="nelc.ndtms-browser-course/v1" if phase=="source" else "nelc.ndtms-browser-independent/v1"
            require(result.get("schema")=="nelc.ndtms-browser-result/v1" and result.get("status")=="COMPLETE"
                    and result.get("phase")==phase and result.get("course",{}).get("schema")==expected
                    and result["course"].get("state")=="COMPLETE" and result["course"].get("workspaceId")==ready["workspaceId"],
                    "NATIVE_BROWSER_RESULT","The original browser phase did not complete its exact workspace.")
            previous=self.state.setdefault("browser",{}).get(phase)
            require(previous is None or previous==result,"NATIVE_BROWSER_RESULT","Preserve the original complete browser result.")
            self.state["browser"][phase]=result;self.save()
            return result
        finally:self.close_child(process)

    def operate_browser(self):
        # Keep the original frozen core result in the browser selection. Reopening
        # observations contain current descendant heads and must not replace it.
        core=self.state["result"];self.browser_inputs()
        source=self.browser_phase("source",APPLICATION,self.sender.root,core)
        portable=source["course"]["portable"];receipt=portable["receiving"]
        require(receipt.get("schema")=="nelc.receiving-receipt/v1"
                and receipt["archiveSha256"]==portable["backup"]["sha256"]
                and receipt["originalWorkspace"]["id"]==core["sourceWorkspaceId"],
                "NATIVE_BROWSER_RECEIVING","The actual browser returned another archive or workspace.")
        archive=Path(portable["backupPath"])
        require(archive.is_file() and not archive.is_symlink()
                and file_hash(archive,self.stop)==(portable["backup"]["sha256"],portable["backup"]["bytes"]),
                "NATIVE_BROWSER_BACKUP","Retain the full original browser backup.")
        destination=Path(receipt["destination"])
        require(destination.is_absolute() and destination.is_dir() and not destination.is_symlink(),
                "NATIVE_BROWSER_RECEIVING","Use the actual original independent receiving destination.")
        received=receive_archive(archive,destination,receipt["archiveSha256"],signal=self.stop)
        application=destination/"application";workspace=destination/"workspace"
        require(application_files(application,self.stop)[0]==core["selection"]["applicationSha256"],
                "NATIVE_BROWSER_APPLICATION","The independent application differs from the full selected source.")
        independent=self.browser_phase("received",application,workspace,core,source)
        current=Workspace(workspace)
        verification=current.verify(True,self.stop)
        replay=receive_archive(archive,destination,receipt["archiveSha256"],signal=self.stop)
        require(replay["alreadyReceived"] and replay["currentWorkspace"]["revision"]>=receipt["originalWorkspace"]["revision"],
                "NATIVE_BROWSER_REPLAY","The original receiving replay did not preserve recipient history.")
        require(application_files(APPLICATION,self.stop)[0]==core["selection"]["applicationSha256"],
                "NATIVE_BROWSER_APPLICATION","The original application changed during receiving.")
        self.browser_inputs()
        result={"schema":"nelc.ndtms-complete-receiving/v1","state":"RECEIVING_COMPLETE",
                "operationId":self.args.operation_id,"native":core,"browserInputs":self.state["browserInputs"],
                "sourceBrowser":source,"receivedBrowser":independent,"receivingReplay":replay,
                "receivedVerification":verification,"currentSource":self.sender.metadata(),"currentRecipient":current.metadata(),
                "renderedStatus":"BROWSER_COURSE_COMPLETE; producer must personally open and inspect the actual retained images and exact selected outgoing files before declaring their visible presentation ready."}
        self.state["browserResult"]=result;self.save();return result

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--work",required=True);parser.add_argument("--operation-id",required=True)
    parser.add_argument("--node");parser.add_argument("--playwright");parser.add_argument("--chromium")
    parser.add_argument("--application-archive",help="The exact selected outgoing ZIP, also present in --attachments; its complete members must match this executing application.")
    parser.add_argument("--attachments",help="Absolute JSON array of exact outgoing attachment {path,bytes,sha256} identities.")
    args=parser.parse_args()
    selected=[bool(args.node),bool(args.playwright),bool(args.chromium)]
    require(not any(selected) or all(selected),"NATIVE_RUNTIME","Provide --node, --playwright and --chromium together.")
    require(not args.attachments or all(selected),"NATIVE_ATTACHMENTS","Outgoing attachment inspection requires the complete browser runtime selection.")
    require(not args.application_archive or (args.attachments and all(selected)),
            "NATIVE_APPLICATION_ARCHIVE","The exact outgoing application ZIP requires its attachment selection and original browser runtime.")
    stop=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *unused:stop.set())
    course=None
    try:
        course=Course(args,stop)
        if all(selected):course.browser_inputs()
        result=course.run()
        if all(selected):result=course.operate_browser()
    finally:
        if course:course.close()
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=="__main__":
    try:main()
    except Problem as error:
        print(json.dumps({"error":error.as_dict()}),file=sys.stderr);raise SystemExit(2)
    except (Cancelled,KeyboardInterrupt):raise SystemExit(130)
