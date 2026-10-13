from __future__ import annotations
import json
from .common import *
from .storage import Store
from .intake import import_edition,correct,row_page
from .contracts import save_contract,approve_contract,assess,findings_page
from .reporting import report,compare_reports
from .releases import release
from .migration import import_return,accept_baseline,compare_target,comparison_page,plan_delta,verify_plan,plan_rollback
from .local_target import open_target,export_target,apply_plan
from .presets import nhs_contract,nhs_report
from .ndtms import analyse_ndtms,publish_ndtms,ndtms_page,verify_ndtms

ACTIONS={
 "analyse-ndtms":analyse_ndtms,"publish-ndtms":publish_ndtms,
 "draft-nhs-contract":nhs_contract,"nhs-report":nhs_report,
 "import-edition":import_edition,"save-contract":save_contract,"approve-contract":approve_contract,
 "correct-cell":correct,"assess":assess,"release":release,"import-target-return":import_return,
 "accept-baseline":accept_baseline,"compare-target":compare_target,"plan-delta":plan_delta,
 "verify-plan":verify_plan,"plan-rollback":plan_rollback,"report":report,"compare-reports":compare_reports,
 "open-local-target":open_target,"export-local-target":export_target,"apply-local-plan":apply_plan
}

class Workspace(Store):
    def mutate(self,request,signal=None):
        require(isinstance(request,dict) and set(request)=={"requestId","expectedRevision","actor","action","data"},
                "REQUEST_SHAPE","An operation contains exactly requestId, expectedRevision, actor, action and data.")
        request=json.loads(canonical(request))
        request_id=text(request["requestId"],"request ID",maximum=160)
        integer(request["expectedRevision"],"expected revision")
        actor=request["actor"];require(isinstance(actor,dict) and set(actor)=={"id","name"},"ACTOR","Supply a local workflow actor ID and name.")
        text(actor["id"],"actor ID",maximum=160);text(actor["name"],"actor name",maximum=300)
        action=request["action"];require(action in ACTIONS,"ACTION","Select a supported workbench operation.")
        require(isinstance(request["data"],dict),"OPERATION_DATA","Operation data must be an object.")
        request_sha=digest(request);check_stop(signal)
        with self.lock,self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                old=db.execute("SELECT request_sha,result_json FROM events WHERE request_id=?",(request_id,)).fetchone()
                if old:
                    require(old["request_sha"]==request_sha,"REQUEST_ID_CONFLICT","This request ID already belongs to different original input.")
                    result=json.loads(old["result_json"]);db.execute("ROLLBACK")
                    return {**result,"duplicate":True}
                meta=self.meta(db)
                require(meta["revision"]==request["expectedRevision"],"REVISION_CONFLICT",
                        "The workspace changed after review. Refresh it before preparing a new request.",
                        {"expected":request["expectedRevision"],"current":meta["revision"]})
                revision=meta["revision"]+1;at=now()
                ctx={"revision":revision,"at":at,"actor":actor,"signal":signal,"requestId":request_id}
                result=ACTIONS[action](self,db,request["data"],ctx)
                check_stop(signal)
                operation_id="operation-"+request_sha[:28]
                response={"schema":"nelc.operation/v1","operationId":operation_id,"requestId":request_id,
                          "workspaceId":meta["id"],"revision":revision,"action":action,"result":result,"duplicate":False}
                previous=db.execute("SELECT sha256 FROM events ORDER BY seq DESC LIMIT 1").fetchone()
                previous_sha=previous[0] if previous else "0"*64
                event={"seq":revision,"id":operation_id,"requestSha256":request_sha,"request":request,
                       "result":response,"createdAt":at,"previousSha256":previous_sha}
                db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)",(revision,operation_id,request_id,request_sha,
                    canonical(request),canonical(response),at,previous_sha,digest(event)))
                db.execute("UPDATE meta SET value=? WHERE key='revision'",(str(revision),))
                db.execute("COMMIT")
                return response
            except BaseException:
                if db.in_transaction:db.execute("ROLLBACK")
                raise
    def metadata(self):
        with self.connect() as db:return self.meta(db)
    def overview(self):
        with self.lock,self.connect() as db:
            db.execute("BEGIN")
            meta=self.meta(db);groups={}
            for kind in KINDS:
                rows=self.list(db,kind,0,30);items=[]
                for value in rows["items"]:
                    definition=value.get("definition",{})
                    label=value.get("name") or definition.get("name") or value.get("targetName") or value.get("id")
                    summary={k:value[k] for k in ("id","schema","createdAt","rows","mappedRows","ready","findingCounts","findingCount",
                            "counts","contractId","editionId","targetSignature","snapshotSha256","allFieldsMatched","allRowsAccepted",
                            "kind","targetId","planId") if k in value}
                    summary["name"]=label
                    if kind=="edition":summary["tables"]=[{"id":t["id"],"name":t["name"],"rows":t["rows"],"headers":t["headers"]} for t in value["tables"]]
                    if kind=="contract":summary["definitionSha256"]=value["definitionSha256"]
                    items.append(summary)
                groups[kind]={"items":items,"total":rows["total"],"nextOffset":rows["nextOffset"]}
            return {"schema":"nelc.overview/v1","workspace":meta,"records":groups,
                    "sourceRows":db.execute("SELECT count(*) FROM rows").fetchone()[0],
                    "originalBytes":db.execute("SELECT coalesce(sum(bytes),0) FROM objects").fetchone()[0],
                    "actorScope":"Actor names label this local workflow. They do not establish multi-user identities or supplier approval."}
    def record(self,kind,id):
        require(kind in KINDS,"RECORD_KIND","Select a supported record kind.")
        with self.lock,self.connect() as db:return self.get(db,kind,id)
    def page(self,kind,selection=None,revision=None,offset=0,limit=50):
        selection=selection or {};integer(offset,"offset");integer(limit,"limit",1,200)
        with self.lock,self.connect() as db:
            db.execute("BEGIN");meta=self.meta(db)
            if offset or revision is not None:
                require(revision==meta["revision"],"PAGE_REVISION","Continue pages at the same workspace revision.",meta["revision"])
            if kind=="source-rows":
                result=row_page(self,db,selection.get("editionId"),selection.get("tableId"),offset,limit,selection.get("filters",[]))
            elif kind in ("ndtms-findings","ndtms-rows","ndtms-lineage"):
                result=ndtms_page(self,db,kind,selection,offset,limit)
            elif kind=="findings":
                self.get(db,"assessment",selection.get("assessmentId"));result=findings_page(db,selection["assessmentId"],offset,limit)
            elif kind=="comparison-rows":
                self.get(db,"comparison",selection.get("comparisonId"))
                result=comparison_page(db,selection["comparisonId"],offset,limit,selection.get("status"))
            elif kind=="plan-rows":
                self.get(db,"plan",selection.get("planId"))
                count=db.execute("SELECT count(*) FROM plan_rows WHERE plan_id=?",(selection["planId"],)).fetchone()[0]
                rows=db.execute("SELECT data_json FROM plan_rows WHERE plan_id=? ORDER BY row_id LIMIT ? OFFSET ?",(selection["planId"],limit,offset)).fetchall()
                result={"items":[json.loads(r[0]) for r in rows],"total":count,"offset":offset,"nextOffset":offset+len(rows) if offset+len(rows)<count else None}
            elif kind=="operations":
                count=meta["revision"]
                rows=db.execute("SELECT * FROM events ORDER BY seq DESC LIMIT ? OFFSET ?",(limit,offset)).fetchall()
                result={"items":[{"revision":r["seq"],"id":r["id"],"request":json.loads(r["request_json"]),
                         "response":json.loads(r["result_json"]),"createdAt":r["created_at"],"sha256":r["sha256"]} for r in rows],
                        "total":count,"offset":offset,"nextOffset":offset+len(rows) if offset+len(rows)<count else None}
            else:
                require(kind in KINDS,"PAGE_KIND","Select a supported record table.");result=self.list(db,kind,offset,limit)
            return {"schema":"nelc.page/v1","revision":meta["revision"],"kind":kind,**result}
    def verify(self,full=True,signal=None):
        with self.lock,self.connect() as db:
            db.execute("BEGIN")
            require(db.execute("PRAGMA integrity_check").fetchone()[0]=="ok","DATABASE_INTEGRITY","The received SQLite database failed its integrity check.")
            history=self.audit(db,signal)
            count=0;size=0
            for row in db.execute("SELECT * FROM objects ORDER BY sha256"):
                check_stop(signal)
                require(file_hash(self.object_path(row["sha256"]),signal)==(row["sha256"],row["bytes"]),"OBJECT_CHANGED","A retained original or artifact failed its hash.")
                count+=1;size+=row["bytes"]
            checked_rows=0
            if full:
                table_sources={}
                for record in db.execute("SELECT data_json FROM records WHERE kind='edition'"):
                    e=json.loads(record[0])
                    for table in e["tables"]:table_sources[table["id"]]=table["object"]["sha256"]
                for row in db.execute("SELECT * FROM rows ORDER BY edition_id,table_id,ordinal"):
                    check_stop(signal)
                    require(digest({"sourceSha256":table_sources[row["table_id"]],"sourceRow":row["ordinal"],"values":json.loads(row["cells_json"])})==row["sha256"],
                            "SOURCE_ROW_HASH","A retained source row differs from its intake proof.",row["row_id"])
                    checked_rows+=1
                for row in db.execute("SELECT * FROM mapped_rows ORDER BY assessment_id,mapping_id,row_id"):
                    check_stop(signal)
                    require(digest({"sourceRowId":row["row_id"],"key":json.loads(row["target_key"]),"values":json.loads(row["cells_json"])})==row["sha256"],
                            "MAPPED_ROW_HASH","A mapped row differs from its reviewed projection.")
            ndtms_count=verify_ndtms(self,db,signal) if full else None
            return {"ndtmsAnalyses":ndtms_count,"schema":"nelc.workspace-verification/v1","workspace":self.meta(db),"history":history,
                    "objects":count,"bytes":size,"checkedSourceRows":checked_rows,"complete":True}
