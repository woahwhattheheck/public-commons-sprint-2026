#!/usr/bin/env python3
"""Operate the complete Directory conformance review over retained publisher examples.

Use a separate received copy of the completed Directory workspace. This command
opens no publisher endpoint and does not modify an existing producer workspace.
It retains the original source, exact authored successor and published HSD
snapshots, operates native assessment/review/comparison and verifies a complete
editable restore. Review dispositions do not certify the example data.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import threading
import tempfile
import urllib.request
import zipfile
from datetime import datetime,timezone

from directory_runtime import source,original_workspace,InputError,atomic_json
from directory_workspace import Workspace
from directory_server import OperatorServer
import directory_schema as schema
from directory_conformance import engine_identity,KINDS

OPERATION="SCF-DIRECTORY-CONFORMANCE-450E-20261012"
HSDS="52065ef66b20f630185cac5be2d4f5b67fdf943405afc4c664687953f716cf56"
SUCCESSOR="673059de52097499f340fe295f57fc6fc95b2bf229bc7d2ce74d64c5ce506d38"
HSD="eaffd46bd6613ba532f026565bdb4cca4a63cf4f0777a5fa9bb2ddf6edebb93f"
ORIGINALS={HSDS:"c52af2a15dbc9152c27cf011e98e9a6e3c12a6e7d9dde42e918a4af163752fc6",
    SUCCESSOR:"2d69659aba2548579596a00bb6b038b47f7d9bf34f19bab475eb3f8c48ff0581",
    HSD:"4672df71b76626493fb3ef84f48b937841435098600a4b230d206392fe0ec5d3"}
ACTOR="450E source-bound Directory conformance receiving"
MAX_FILE=2147483648

def utc():return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
def require(ok,message):
    if not ok:raise RuntimeError(message)
def emit(stage,**value):print(source.lexical_json({"stage":stage,"operation":OPERATION,**value}),flush=True)
def read_json(path):return source.json_value(Path(path).read_bytes())
def write_json(path,value):
    path=Path(path)
    raw=source.jbytes(value)
    if path.exists():
        require(path.read_bytes()==raw,"Retain the existing complete original output: "+str(path));return
    original_workspace.private_write(path,raw)
def replace_json(path,value):atomic_json(Path(path),value)
def info(path):
    path=Path(path);size=original_workspace.regular(path,MAX_FILE).st_size
    return {"file":str(path),"bytes":size,"sha256":original_workspace.file_digest(path,MAX_FILE)}

class Operation:
    def __init__(self,args):
        self.args=args;self.root=Path(args.out).absolute()
        self.root.mkdir(mode=0o700,parents=True,exist_ok=True);os.chmod(self.root,0o700)
        self.workspace=Path(args.workspace).absolute();self.path=self.root/"CONFORMANCE_JOURNEY.json"
        self.inputs={"operation":OPERATION,"workspace":str(self.workspace),"sourceRoot":str(Path(__file__).parent),
            "sourceIds":[HSDS,SUCCESSOR,HSD],"originalSha256":ORIGINALS,"engine":engine_identity()}
        if self.path.exists():
            self.journal=read_json(self.path)
            require(self.journal["inputs"]==self.inputs,"Resume the original conformance operation with its exact source and workspace")
        else:
            self.journal={"schema":"stellar-forge.directory-conformance-journey.v1","inputs":self.inputs,
                "createdAt":utc(),"steps":{},"files":{},"failures":[]}
            self.save()
    def save(self):
        self.journal["updatedAt"]=utc();atomic_json(self.path,self.journal)
    def step(self,key,request,call):
        old=self.journal["steps"].get(key)
        request_sha=source.sha(source.jbytes(request))
        if old:
            require(old["requestSha256"]==request_sha,"Retain the exact original prepared conformance request")
            if old.get("state")=="complete":return old["result"]
        else:
            self.journal["steps"][key]={"state":"prepared","requestSha256":request_sha,"request":request,"preparedAt":utc()}
            self.save()
        result=call()
        self.journal["steps"][key].update(state="complete",result=result,completedAt=utc());self.save()
        emit("CONFORMANCE_NATIVE_STEP",key=key,id=result.get("id")if isinstance(result,dict)else None)
        return result
    def copy(self,key,path,descriptor,name):
        target=self.root/name
        old=self.journal["files"].get(key)
        if old:
            require(info(old["file"])==old,"Retain the exact complete conformance output");return old
        expected={"bytes":descriptor["bytes"],"sha256":descriptor["sha256"]}
        if target.exists():
            actual=info(target);require(all(actual[k]==v for k,v in expected.items()),"Keep original completed file bytes")
        else:
            fd,pending_name=tempfile.mkstemp(prefix=".complete-conformance-",dir=self.root);pending=Path(pending_name)
            try:
                with Path(path).open("rb")as inp,os.fdopen(fd,"wb")as out:
                    os.fchmod(out.fileno(),0o600)
                    while block:=inp.read(65536):out.write(block)
                    out.flush();os.fsync(out.fileno())
                received=info(pending);require(all(received[k]==v for k,v in expected.items()),"Complete native conformance output differs")
                try:os.link(pending,target)
                except FileExistsError:
                    require(all(info(target)[k]==v for k,v in expected.items()),"Another file occupies the original complete output")
            finally:pending.unlink(missing_ok=True)
            actual=info(target)
        self.journal["files"][key]=actual;self.save();return actual
    def pages(self,ws,assessment):
        counts={"findings":0,"rows":0};first=[]
        for name,call in (("findings",ws.directory_conformance_findings),("rows",ws.directory_conformance_rows)):
            offset=0
            while True:
                page=call(assessment["id"],offset,100)
                require(page["offset"]==offset,"Native page offset changed")
                counts[name]+=len(page["rows"])
                if name=="findings"and not first:first=page["rows"][:1]
                nxt=page["nextOffset"]
                if nxt is None:
                    require(counts[name]==page["total"],"Receive every original native page");break
                require(nxt>offset,"Native conformance cursor did not advance");offset=nxt
        require(counts["findings"]==assessment["summary"]["findings"]and counts["rows"]==assessment["summary"]["selectedRows"],
            "Complete native pages differ from the assessment")
        if first:require(ws.directory_conformance_finding(assessment["id"],first[0]["id"])==first[0],"Exact original finding getter differs")
        return counts
    def review(self,ws,key,assessment):
        groups=[];offset=0;selected=set()
        while True:
            page=ws.directory_conformance_findings(assessment["id"],offset,250)
            for finding in page["rows"]:
                group=(finding["code"],finding["severity"],finding["table"])
                if group in selected:continue
                selected.add(group)
                disposition="requires-correction"if finding["severity"]in {"error","not-evaluated"}else"accepted-deviation"
                reason=("The exact published example is retained. This requirement needs source correction or a full standards/reviewer assessment before a production conformance claim."
                    if disposition=="requires-correction"else
                    "The exact published-example reference/population observation remains visible. This technical receiving review accepts retaining it, without asserting remote completeness or a current service promise.")
                value={"code":group[0],"severity":group[1],"disposition":disposition,"reason":reason}
                if group[2]is not None:value["table"]=group[2]
                groups.append(value)
            if page["nextOffset"]is None:break
            offset=page["nextOffset"]
        request={"label":"Complete published-example conformance review — "+key,"actor":ACTOR,
            "assessmentId":assessment["id"],"disposition":"needs-correction"if assessment["summary"]["severityCounts"]["error"]else"defer",
            "declaration":"This authored technical review preserves every exact publisher finding and unevaluated requirement. It is not production acceptance or certification. The complete rule, source and profile evidence remains available for the selected implementation owner.",
            "groups":groups,"decisions":[],"predecessorId":None,
            "note":"No publisher source is corrected, rewritten or reacquired by this review."}
        result=self.step(key+"-review",request,lambda:ws.review_directory_conformance(request))
        require(ws.review_directory_conformance(request)==result,"Repeating the exact review must reopen its original immutable record")
        return result
    def http(self,ws,assessment):
        with OperatorServer(ws,0,expected_workspace_id=ws.workspace_id)as server:
            thread=threading.Thread(target=server.serve_forever,kwargs={"poll_interval":0.05},daemon=True);thread.start()
            try:
                base=server.url.split("#",1)[0].rstrip("/")
                routes=[
                    ("/api/directory/conformanceAssessments/"+assessment["id"],None),
                    ("/api/directory/conformance/assessments/"+assessment["id"]+"/findings?offset=0&limit=5",None),
                    ("/api/directory/conformance/assessments/"+assessment["id"]+"/files/report",assessment["files"]["report"]),
                    ("/api/directory/conformance/assessments/"+assessment["id"]+"/files/findings",assessment["files"]["findings"])]
                results=[]
                for route,expected in routes:
                    request=urllib.request.Request(base+route,headers={"Authorization":"Bearer "+server.token})
                    sha=hashlib.sha256();size=0;body=[]
                    with urllib.request.urlopen(request,timeout=60)as response:
                        status=response.status
                        while block:=response.read(65536):
                            size+=len(block);sha.update(block)
                            if expected is None:body.append(block)
                    require(status==200,"Original authenticated conformance route failed")
                    if expected:require(size==expected["bytes"]and sha.hexdigest()==expected["sha256"],"Full native HTTP file differs")
                    else:
                        value=source.json_value(b"".join(body))
                        if route.endswith(assessment["id"]):require(value==assessment,"Original full HTTP assessment record differs")
                        else:require(value["assessmentId"]==assessment["id"],"Original finding page belongs to another assessment")
                    results.append({"route":route,"status":status,"bytes":size,"sha256":sha.hexdigest()})
                return {"workspaceId":ws.workspace_id,"routes":results}
            finally:server.shutdown();thread.join(10)
    def operate(self):
        with Workspace(self.workspace,create=False)as ws:
            self.journal.setdefault("workspaceId",ws.workspace_id);self.save()
            require(self.journal["workspaceId"]==ws.workspace_id,"Keep the original received workspace UUID")
            for ident,expected in ORIGINALS.items():
                record=ws.directory_source(ident)
                require(record["originalSha256"]==expected,"Select only the exact retained original example source")
            definitions=[]
            for row in ws.directory_iter_rows("sources",HSD,"StructureDefinition"):
                resource=source.json_value(row["json"])
                if resource.get("url")in {"http://hl7.org/fhir/us/hsds/StructureDefinition/hsds-"+x for x in ("Organization","Location","HealthcareService")}:
                    require(resource.get("version")=="1.0.0","Select the exact published HSD profile version")
                    definitions.append({"sourceId":row["sourceId"],"recordId":row["recordId"]})
            require(len(definitions)==3,"Receive all three original published profile snapshots")
            assessments=[];reviews=[];plans=[]
            for key,ident,family in (("original-csv",HSDS,"hsds-3.3.1"),("authored-successor",SUCCESSOR,"hsds-3.3.1"),("published-hsd",HSD,"fhir-hsd-1.0.0")):
                plan_request={"label":"Retained publisher conformance — "+key,"actor":ACTOR,
                    "subjectKind":"sources","subjectId":ident,"family":family,"tables":[],
                    "profileDisposition":"selected-standard","publisherProfile":"HSDS 3.3.1 selected release; compiled data-package metadata retains 3.0.0"if family=="hsds-3.3.1"else"http://hl7.org/fhir/us/hsds/ImplementationGuide/hl7.fhir.us.hsds|1.0.0",
                    "scope":"Complete retained publisher example source; only selected canonical tables or the three exact published HSD resource profiles are assessed. The separately authored CSV description successor remains explicitly authored. No current directory, live capacity or remote completeness is inferred.",
                    "formatPolicy":"assert","definitionRefs":definitions if family=="fhir-hsd-1.0.0"else[],
                    "note":"Source-native application receiving from the completed original Directory example; every source/member byte and original identity remains unchanged."}
                plan=self.step(key+"-plan",plan_request,lambda r=plan_request:ws.save_directory_conformance_plan(r));plans.append(plan)
                request={"label":"Complete retained-source assessment — "+key,"actor":ACTOR,"planId":plan["id"],
                    "note":"Evaluate selected original assertions, record all coverage limits and retain full native reference observations."}
                assessment=self.step(key+"-assessment",request,lambda r=request:ws.assess_directory_conformance(r))
                require(ws.assess_directory_conformance(request)==assessment,"Exact assessment retry must return the original result")
                assessments.append(assessment)
                pages=self.pages(ws,assessment);self.journal["steps"][key+"-assessment"]["completePages"]=pages;self.save()
                review=self.review(ws,key,assessment);reviews.append(review)
                for kind,record in (("conformanceAssessments",assessment),("conformanceReviews",review)):
                    for file_kind in record["files"]:
                        path,descriptor=ws.directory_conformance_file(kind,record["id"],file_kind)
                        self.copy(key+"-"+kind+"-"+file_kind,path,descriptor,descriptor["name"])
            compare_request={"label":"Complete publisher-to-authored successor rule outcomes","actor":ACTOR,
                "beforeAssessmentId":assessments[0]["id"],"afterAssessmentId":assessments[1]["id"],
                "scopeNote":"The exact original CSV examples and their retained authored one-description-cell successor are the selected populations. This compares rule-outcome counts only; original native edition comparison remains the authority for entity changes.",
                "note":"The complete before/after original assessment packages are included."}
            comparison=self.step("complete-comparison",compare_request,lambda:ws.compare_directory_conformance(compare_request))
            require(ws.compare_directory_conformance(compare_request)==comparison,"Exact comparison retry must return its original record")
            for file_kind in comparison["files"]:
                path,d=ws.directory_conformance_file("conformanceComparisons",comparison["id"],file_kind)
                self.copy("comparison-"+file_kind,path,d,d["name"])
            http=self.step("authenticated-complete-native-files",{"assessmentId":assessments[0]["id"]},lambda:self.http(ws,assessments[0]))
            packet_path=self.root/"Directory_Conformance_Complete_Editable_Workspace.zip"
            request={"workspaceId":ws.workspace_id,"conformanceIds":{k:[r["id"]for r in ws.directory_records(k)]for k in sorted(KINDS)}}
            def export():
                if packet_path.exists():
                    actual=info(packet_path)
                    with zipfile.ZipFile(packet_path)as archive:
                        registry=source.json_value(archive.read("directory-registry.json"))
                    require(registry["workspaceId"]==ws.workspace_id,"Existing complete conformance export has another UUID")
                    for kind,ids in request["conformanceIds"].items():require([r["id"]for r in registry["records"][kind]]==ids,"Existing full export lacks an original conformance record")
                    return {"workspaceId":ws.workspace_id,**actual}
                return ws.export_workspace(packet_path)
            packet=self.step("complete-editable-export",request,export)
            # Read the actual exported registry: native source synchronization may
            # record an acquisition updatedAt during the original export.
            with zipfile.ZipFile(packet_path)as archive:
                registry_raw=archive.read("directory-registry.json")
                manifest=source.json_value(archive.read("manifest.json"))
                require(source.sha(registry_raw)==manifest["registrySha256"],"Original export registry differs")
                registry=source.json_value(registry_raw)
            write_json(self.root/"EXPORTED_DIRECTORY_REGISTRY.json",registry)
            state={"workspaceId":ws.workspace_id,"sourceIds":[HSDS,SUCCESSOR,HSD],
                "planIds":[r["id"]for r in plans],"assessmentIds":[r["id"]for r in assessments],
                "reviewIds":[r["id"]for r in reviews],"comparisonIds":[comparison["id"]],
                "summaries":[r["summary"]for r in assessments],"http":http,"workspacePacket":packet}
        restored=self.root/"received-workspace"
        with Workspace(restored,create=not restored.exists())as receiver:
            receipt=self.step("complete-editable-receive",{"sha256":info(packet_path)["sha256"],"workspaceId":state["workspaceId"]},
                lambda:{"result":receiver.import_workspace(packet_path),"workspaceId":receiver.workspace_id})
            require(receiver.workspace_id==state["workspaceId"],"Complete receiving must preserve original UUID")
            for kind,records in registry["records"].items():
                require(receiver.directory_records(kind)==records,"Complete received original collection differs: "+kind)
            for ident in state["assessmentIds"]:
                record=receiver.directory_record("conformanceAssessments",ident)
                receiver._verify_conformance_assessment(record)
                self.pages(receiver,record)
            restored_counts={kind:len(receiver.directory_records(kind))for kind in registry["records"]}
        result_path=self.root/"OPERATED_DIRECTORY_CONFORMANCE.json"
        # Bind completion before the immutable result write, so a lost final
        # journal update can reopen the exact same complete result.
        if not self.journal.get("completedAt"):
            self.journal["completedAt"]=utc();self.save()
        result={"schema":"stellar-forge.directory-conformance-operated.v1","operation":OPERATION,
            "completedAt":self.journal["completedAt"],"sourceRoot":str(Path(__file__).parent),
            "workspace":str(self.workspace),**state,"files":self.journal["files"],
            "restoration":{"workspace":str(restored),"workspaceId":state["workspaceId"],"collections":restored_counts,
                "originalRegistrySha256":source.sha(registry_raw),"allOriginalCollectionsEqual":True},
            "reviewMeaning":"Authored standards review of retained publisher examples. Error and unevaluated findings remain open; no production conformance or customer acceptance is claimed."}
        if result_path.exists():require(read_json(result_path)==result,"Reuse the complete original operation result")
        else:write_json(result_path,result)
        self.journal["completedAt"]=result["completedAt"];self.journal["result"]=info(result_path);self.save()
        emit("DIRECTORY_CONFORMANCE_NATIVE_COMPLETE",workspaceId=state["workspaceId"],
            selectedRows=[s["selectedRows"]for s in state["summaries"]],
            findings=[s["findings"]for s in state["summaries"]],result=info(result_path),workspacePacket=packet)
        return result

def main(argv=None):
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--workspace",required=True);p.add_argument("--out",required=True)
    args=p.parse_args(argv);operation=Operation(args)
    try:operation.operate();return 0
    except BaseException as error:
        import traceback
        operation.journal["failures"].append({"at":utc(),"type":type(error).__name__,"message":str(error),"traceback":traceback.format_exc()});operation.save()
        emit("DIRECTORY_CONFORMANCE_INTERRUPTED",error={"type":type(error).__name__,"message":str(error)},journal=str(operation.path));raise
if __name__=="__main__":raise SystemExit(main())
