"""MIT. One private Directory/Gravity/FHIR operator and complete native file transport."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import uuid
from directory_runtime import (InputError,ConflictError,original_server,source,atomic_json,safe_read)
from directory_workspace import Workspace
from directory_receiving import MAX_PACKET
from directory_operating_plans import MAX_REQUEST as OPERATING_PLAN_REQUEST
from directory_operating_returns import MAX_REQUEST as OPERATING_RETURN_REQUEST
from directory_corrections_schema import MAX_INPUT as CORRECTION_REQUEST, KINDS as CORRECTION_KINDS
from directory_correction_worksheets_schema import MAX_INPUT as WORKSHEET_REQUEST, KINDS as WORKSHEET_KINDS
from directory_correction_worksheet_reconciliation_schema import MAX_INPUT as RECONCILIATION_REQUEST, KINDS as RECONCILIATION_KINDS
from referral_server import Handler as BaseHandler
import directory_schema as schema

HERE=Path(__file__).resolve().parent
CONNECTION_SCHEMA="stellar-forge.human-services-directory-operator-connection.v1"
STARTUP_SCHEMA="stellar-forge.human-services-directory-startup.v1"

class OperatorServer(original_server.OperatorServer):
    def __init__(self,workspace,port=0,*,expected_workspace_id=None,**kwargs):
        if expected_workspace_id is not None and expected_workspace_id!=workspace.workspace_id:
            raise ConflictError("The selected original Directory workspace UUID differs")
        kwargs.setdefault("assets_directory",HERE/"public");kwargs.setdefault("handler_class",Handler)
        super().__init__(workspace,port,**kwargs)
        self.instance_id=str(uuid.uuid4());self.connection_path=workspace.root/"directory"/"operator-connection.json"
        try:self.publish_connection()
        except Exception:super().server_close();raise
    def operator_identity(self):
        return {"schema":CONNECTION_SCHEMA,"active":True,"workspace":str(self.workspace.root),
            "workspaceId":self.workspace.workspace_id,"instanceId":self.instance_id,"processId":os.getpid(),
            "url":self.url.split("#",1)[0]}
    def publish_connection(self):
        with self.workspace.mutex:atomic_json(self.connection_path,{**self.operator_identity(),"accessToken":self.token})
    def startup(self):
        return {"schema":STARTUP_SCHEMA,"url":self.url,"workspace":str(self.workspace.root),
            "workspaceId":self.workspace.workspace_id,"instanceId":self.instance_id,"pid":os.getpid(),
            "connectionFile":str(self.connection_path)}
    def server_close(self):
        super().server_close()
        path=getattr(self,"connection_path",None)
        if path is None:return
        with self.workspace.mutex:
            try:record=source.json_value(safe_read(path,65536))
            except FileNotFoundError:return
            if record.get("instanceId")==self.instance_id:atomic_json(path,{**self.operator_identity(),"active":False})

class Handler(BaseHandler):
    server_version="SF30-Human-Services-Directory"
    def _page_args(self,target,extra=()):
        q=self._query(target,("offset","limit")+tuple(extra))
        return q,self._integer(q.get("offset","0"),"offset"),self._integer(q.get("limit","50"),"limit",1,250)
    def _native_download(self,result):
        path,d=result;self._download(path,d.get("name",d.get("filename",Path(path).name)),d.get("contentType","application/octet-stream"))
    def _get(self):
        target=self._gate(api=False)
        if not target.path.startswith("/api/directory"):return super()._get()
        self._gate();p=self._parts(target.path);ws=self.server.workspace;t=p[2:]
        if len(t)==3 and t[0]=="operatingPlanReturns"and t[2]in {"review","comparison","input","rows"}:
            if t[2]=="rows":
                q,offset,limit=self._page_args(target,("kind","conflict","unresolved"))
                flags={}
                for key in ("conflict","unresolved"):
                    if key in q:
                        if q[key]not in {"true","false"}:raise InputError(key+" must be true or false")
                        flags[key]=q[key]=="true"
                return self._json(ws.directory_operating_return_rows(t[1],offset,limit,q.get("kind"),**flags))
            self._query(target,())
            method={"review":ws.directory_operating_return_review,"comparison":ws.directory_operating_return_comparison,"input":ws.directory_operating_return_input}[t[2]]
            return self._json(method(t[1]))
        if len(t)==4 and t[0]=="operatingPlanReturns"and t[2]=="files":
            self._query(target,());return self._native_download(ws.directory_operating_return_file(t[1],t[3]))
        if t==["operating-plans","catalog"]:
            self._query(target,());return self._json(ws.directory_operating_catalogue())
        if len(t)==3 and t[0]=="operatingPlans"and t[2]in {"document","draft","input","basis"}:
            if t[2]=="draft":
                q=self._query(target,("revision",));revision=self._integer(q["revision"],"revision",1)if "revision"in q else None
                return self._json(ws.directory_operating_plan_draft(t[1],revision))
            self._query(target,())
            method={"document":ws.directory_operating_plan_document,"input":ws.directory_operating_plan_input,"basis":ws.directory_operating_plan_basis}[t[2]]
            return self._json(method(t[1]))
        if t==["catalogue"]:
            self._query(target,());return self._json(ws.directory_catalogue())
        if t==["state"]:
            self._query(target,());return self._json(ws.directory_state())
        if t==["guidance"]:
            self._query(target,());return self._json(ws.directory_guidance())
        if t==["guidance","file"]:
            q=self._query(target,("member",));return self._native_download(ws.directory_guidance_file(q.get("member")))
        if t==["workspace","file"]:
            self._query(target,())
            with ws.mutex,ws.scratch()as tmp:
                path=Path(tmp)/"Human_Services_Directory_Editable_Workspace.zip";ws.export_workspace(path)
                return self._download(path,path.name,"application/zip")
        if len(t)==3 and t[0]=="handoffs"and t[2]=="file":
            self._query(target,())
            with ws.mutex,ws.scratch()as tmp:
                path=Path(tmp)/"Human_Services_Directory_Complete_Handoff.zip";ws.export_directory_handoff(t[1],path)
                return self._download(path,path.name,"application/zip")
        if len(t)==3 and t[0]=="exports"and t[2]=="file":
            self._query(target,());record=ws.directory_record("exports",t[1])
            return self._download(ws._directory_file_path(record["file"]),record["name"],record["contentType"])
        if len(t)==4 and t[0]in {"sources","editions","comparisons"}and t[2:]==["index","file"]:
            self._query(target,());return self._native_download(ws.directory_index_file(t[0],t[1]))
        if len(t)>=3 and t[0]=="sources":
            if t[2]=="file"and len(t)==3:
                q=self._query(target,("member",));return self._native_download(ws.directory_source_file(t[1],q.get("member")))
            if t[2]=="members"and len(t)==3:
                self._query(target,());return self._json(ws.directory_source_members(t[1]))
            if t[2]=="rows":
                if len(t)==5 and t[4]=="file":
                    self._query(target,());return self._native_download(ws.directory_record_file(t[1],t[3]))
                if len(t)==4:
                    self._query(target,());return self._json(ws.directory_source_row(t[1],t[3]))
                if len(t)==3:
                    q,offset,limit=self._page_args(target,("table","query"))
                    return self._json(ws.directory_source_rows(t[1],offset,limit,q.get("table"),q.get("query","")))
        if len(t)>=3 and t[0]=="editions":
            if t[2]=="rows":
                if len(t)==5:
                    self._query(target,());return self._json(ws.directory_edition_row(t[1],t[3],t[4]))
                if len(t)==3:
                    q,offset,limit=self._page_args(target,("table","query"))
                    return self._json(ws.directory_edition_rows(t[1],offset,limit,q.get("table"),q.get("query","")))
            if t[2]=="links":
                if len(t)==6 and t[5]=="targets":
                    _,offset,limit=self._page_args(target);return self._json(ws.directory_link_targets(t[1],t[3],t[4],offset,limit))
                if len(t)==3:
                    q,offset,limit=self._page_args(target,("record_id",));return self._json(ws.directory_edition_links(t[1],offset,limit,q.get("record_id")))
        if len(t)>=3 and t[0]=="comparisons"and t[2]=="changes":
            if len(t)==4 and t[3]=="file":
                self._query(target,());return self._native_download(ws.directory_changes_file(t[1]))
            if len(t)==3:
                q,offset,limit=self._page_args(target,("state",));return self._json(ws.directory_changes(t[1],offset,limit,q.get("state")))
        if len(t)==3 and t[0]=="operations"and t[2]=="file":
            self._query(target,());return self._native_download(ws.directory_capture_file(t[1]))
        if len(t)==3 and t[0]=="mappingPreviews"and t[2]=="details":
            q,offset,limit=self._page_args(target,("group",));return self._json(ws.directory_preview_page(t[1],q.get("group","findings"),offset,limit))
        if len(t)==3 and t[0]=="selections"and t[2]=="candidates":
            q,offset,limit=self._page_args(target,("query",));return self._json(ws.directory_selection_page(t[1],offset,limit,q.get("query","")))
        if len(t)>=4 and t[:2]==["conformance","assessments"]:
            if len(t)==4 and t[3]=="foreign-keys":
                q,offset,limit=self._page_args(target,("table","state","ruleId","sourceId","recordId"))
                return self._json(ws.directory_conformance_foreign_keys(t[2],offset,limit,
                    q.get("table"),q.get("state"),q.get("ruleId"),q.get("sourceId"),q.get("recordId")))
            if len(t)==4 and t[3]=="foreign-key-candidates":
                q,offset,limit=self._page_args(target,("table","state","groupId","sourceId","recordId"))
                return self._json(ws.directory_conformance_foreign_key_candidates(t[2],offset,limit,
                    q.get("table"),q.get("state"),q.get("groupId"),q.get("sourceId"),q.get("recordId")))
            if len(t)==4 and t[3]=="foreign-key-matches":
                q,offset,limit=self._page_args(target,("outcomeId","candidateId"))
                return self._json(ws.directory_conformance_foreign_key_matches(t[2],offset,limit,
                    q.get("outcomeId"),q.get("candidateId")))
            if len(t)==4 and t[3]in {"findings","rows"}:
                if t[3]=="findings":
                    q,offset,limit=self._page_args(target,("severity","table","code","sourceId","recordId"))
                    return self._json(ws.directory_conformance_findings(t[2],offset,limit,q.get("severity"),q.get("table"),q.get("code"),q.get("sourceId"),q.get("recordId")))
                q,offset,limit=self._page_args(target,("table",))
                return self._json(ws.directory_conformance_rows(t[2],offset,limit,q.get("table")))
            if len(t)==5 and t[3]=="findings":
                self._query(target,());return self._json(ws.directory_conformance_finding(t[2],t[4]))
        if len(t)==5 and t[0]=="conformance"and t[3]=="files":
            collections={"assessments":"conformanceAssessments","reviews":"conformanceReviews","comparisons":"conformanceComparisons"}
            if t[1]in collections:
                self._query(target,());return self._native_download(ws.directory_conformance_file(collections[t[1]],t[2],t[4]))
        if len(t)==3 and t[0]=="correctionWorksheets" and t[2]=="document":
            self._query(target,());return self._json(ws.directory_correction_worksheet_document(t[1]))
        if t==["correction-worksheet-reconciliations","catalogue"]:
            self._query(target,());return self._json(ws.directory_correction_worksheet_reconciliation_catalogue())
        if len(t)==3 and t[0]in RECONCILIATION_KINDS and t[2]=="rows":
            q,offset,limit=self._page_args(target,("rowKey","state"))
            return self._json(ws.directory_correction_worksheet_reconciliation_rows(t[0],t[1],offset,limit,row_key=q.get("rowKey"),state=q.get("state")))
        if len(t)==4 and t[0]in RECONCILIATION_KINDS and t[2]=="files":
            self._query(target,());return self._native_download(ws.directory_correction_worksheet_reconciliation_file(t[0],t[1],t[3]))
        if len(t)==3 and t[0]in WORKSHEET_KINDS and t[2]=="rows":
            q,offset,limit=self._page_args(target,("rowKey","state"))
            return self._json(ws.directory_correction_worksheet_rows(t[0],t[1],offset,limit,row_key=q.get("rowKey"),state=q.get("state")))
        if len(t)==4 and t[0]in WORKSHEET_KINDS and t[2]=="files":
            self._query(target,());return self._native_download(ws.directory_correction_worksheet_file(t[0],t[1],t[3]))
        if len(t)==3 and t[0]in CORRECTION_KINDS and t[2]=="rows":
            _,offset,limit=self._page_args(target)
            return self._json(ws.directory_correction_rows(t[0],t[1],offset,limit))
        if len(t)==4 and t[0]in CORRECTION_KINDS and t[2]=="files":
            self._query(target,());return self._native_download(ws.directory_correction_file(t[0],t[1],t[3]))
        if len(t)in {1,2}:
            kind="acquisitions"if t[0]=="operations"else t[0]
            if kind in schema.KINDS:
                if len(t)==1:
                    q,offset,limit=self._page_args(target,("query",));return self._json(ws.directory_records(kind,offset,limit,q.get("query","")))
                self._query(target,())
                record=ws.directory_operation(t[1])if kind=="acquisitions"else ws.directory_source(t[1])if kind=="sources"else ws.directory_record(kind,t[1])
                return self._json(record)
        return self._json({"error":"Unknown original Directory route"},404)

    def do_PUT(self):
        # Reuse the original handler's exception/authentication/body lifecycle.
        return self.do_POST()
    def _post(self):
        target=self._gate();p=self._parts(target.path);ws=self.server.workspace
        if self.command=="PUT":
            self._query(target,())
            if len(p)==6 and p[:4]==["api","directory","correction-worksheets","imports"]and p[5]=="content":
                with ws.mutex,ws.scratch()as tmp:
                    path=Path(tmp)/"complete-returned-directory-worksheet"
                    with path.open("xb")as out:
                        path.chmod(0o600);shutil.copyfileobj(self._body(WORKSHEET_REQUEST),out,65536)
                    return self._json(ws.import_directory_correction_worksheet_return(p[4],path),201)
            if len(p)==5 and p[:3]==["api","directory","imports"]and p[4]=="content":
                with ws.mutex,ws.scratch()as tmp:
                    path=Path(tmp)/"complete-directory-original"
                    with path.open("xb")as out:
                        path.chmod(0o600);shutil.copyfileobj(self._body(source.MAX_SOURCE),out,65536)
                    return self._json(ws.import_directory_profile(p[3],path),201)
            return self._json({"error":"PUT selects only an original saved import profile's complete content"},405)
        if not target.path.startswith("/api/directory"):return super()._post()
        self._query(target,());t=p[2:]
        routes={tuple(a["path"].split("/")[3:]):getattr(ws,a["python"])for a in schema.catalogue()["actions"]}
        routes.update({("connections",):ws.directory_connection,("requests",):ws.directory_request,
            ("editions",):ws.directory_edition,("comparisons",):ws.directory_compare,("imports",):ws.save_directory_import})
        if tuple(t)in routes:
            if t and t[0]=="correction-worksheet-reconciliations":
                value=source.json_value(self._body(RECONCILIATION_REQUEST).read())
                if not isinstance(value,dict):raise InputError("Expected one complete three-way reconciliation input object")
            elif t and t[0]=="correction-worksheets":
                value=source.json_value(self._body(WORKSHEET_REQUEST).read())
                if not isinstance(value,dict):raise InputError("Expected one complete worksheet input object")
            elif t and t[0]=="corrections":
                value=source.json_value(self._body(CORRECTION_REQUEST).read())
                if not isinstance(value,dict):raise InputError("Expected one complete original correction JSON object")
            elif t and t[0]=="operating-returns":
                value=source.json_value(self._body(OPERATING_RETURN_REQUEST).read())
                if not isinstance(value,dict):raise InputError("Expected one complete returned-procedure JSON object")
            elif t and t[0]=="operating-plans":
                value=source.json_value(self._body(OPERATING_PLAN_REQUEST).read())
                if not isinstance(value,dict):raise InputError("Expected one complete Operating Plans JSON object")
            else:value=self._json_body()
            return self._json(routes[tuple(t)](value),201)
        if t==["discover"]:
            v=self._json_body(("connectionId","operationId"),("connectionId","operationId"))
            return self._json(ws.directory_discover(v["connectionId"],v["operationId"]),201)
        if t==["acquire"]:
            v=self._json_body(("requestId","operationId"),("requestId","operationId"))
            return self._json(ws.directory_acquire(v["requestId"],v["operationId"]),201)
        if len(t)==3 and t[0]=="operations"and t[2]in{"advance","pause","resume","capture-source"}:
            self._json_body((),())
            method={"advance":ws.directory_advance,"pause":ws.directory_pause,"resume":ws.directory_resume,"capture-source":ws.directory_capture_source}[t[2]]
            return self._json(method(t[1]))
        if t in (["workspace","receive"],["handoffs","receive"]):
            with ws.mutex,ws.scratch()as tmp:
                path=Path(tmp)/"complete-directory-receiving.zip"
                with path.open("xb")as out:
                    path.chmod(0o600);shutil.copyfileobj(self._body(MAX_PACKET),out,65536)
                try:result=ws.import_workspace(path)if t[0]=="workspace"else ws.import_directory_handoff(path)
                finally:self.server.publish_connection()
                return self._json(result,201)
        return self._json({"error":"Unknown original Directory mutation"},404)

def main(argv=None):
    p=argparse.ArgumentParser(description="Open the private Human Services Directory operator")
    p.add_argument("--workspace",required=True);p.add_argument("--port",type=int,default=0);p.add_argument("--host",default="127.0.0.1")
    p.add_argument("--credentials-file");p.add_argument("--expected-workspace-id");args=p.parse_args(argv)
    if args.host!="127.0.0.1":p.error("The original private operator binds to127.0.0.1")
    if not 0<=args.port<=65535:p.error("Choose a valid loopback port")
    root=Path(args.workspace).expanduser().absolute()
    with Workspace(root,create=not root.exists(),credentials_file=args.credentials_file)as ws:
        with OperatorServer(ws,args.port,expected_workspace_id=args.expected_workspace_id)as server:
            print(json.dumps(server.startup(),ensure_ascii=False),flush=True)
            try:server.serve_forever(poll_interval=0.2)
            except KeyboardInterrupt:pass
    return 0
if __name__=="__main__":sys.exit(main())
