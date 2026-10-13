"""Freeze current full-family customer report downloads with source context.

Earlier initial/zero/cleared report files remain sealed history. Current
customer report successors use the existing accepted editions and original
report/export API, with the complete static original question stems.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from questionnaire_workspace import Workspace
from whole_family_programme import save

def retained_files(workspace,directory):
    manifest=json.loads((directory/"manifest.json").read_text())
    files=[]
    for entry in manifest["files"]:
        path=directory/entry["path"];body=path.read_bytes()
        if len(body)!=entry["bytes"] or hashlib.sha256(body).hexdigest()!=entry["sha256"]:
            raise RuntimeError("A retained original customer report download differs")
        files.append({**entry,"path":path.relative_to(workspace.directory).as_posix()})
    return files

def freeze_current(workspace,role,respondent_id,publication_id,question_ids,root,stage):
    original=workspace.invoke("get_respondent",{"respondent_id":respondent_id})
    respondent=original["respondent"]
    if respondent["status"]!="accepted" or respondent["publication_id"]!=publication_id:
        raise RuntimeError("Freeze the original current accepted family edition")
    request="atssc-source-context-current-"+respondent["accepted_revision"]
    created=workspace.invoke("create_report",{"publication_id":publication_id,"respondent_ids":[respondent_id],"question_ids":question_ids,"request_id":request})
    released=workspace.invoke("release_report",{"report_id":created["report_id"],"note":"Current original-source customer report: complete static question context, original typed answers and native dependent disclosure reviewed.",
        "request_id":request+"-release"})
    result=workspace.invoke("get_report",{"report_id":created["report_id"]})
    for edition in ("public","protected"):
        for q in result["edition"][edition]["questions"]:
            source=next(x for x in original["definition"]["questions"] if x["id"]==q["id"])
            for key in ("original_question_text","original_row_label","original_french_text","original_question_heading","section"):
                if source.get(key) and q.get(key)!=source[key]:raise RuntimeError("The original static source question context is absent from "+edition)
    destination=root/created["report_id"]
    if not (destination/"manifest.json").is_file():
        if destination.exists():
            # Preserve an interrupted file export and finish a separate full
            # attempt. Its original partial files remain available for reopen.
            attempt=1
            while (root/(created["report_id"]+"-attempt-"+str(attempt))).exists():attempt+=1
            destination=root/(created["report_id"]+"-attempt-"+str(attempt))
        workspace.invoke("export_report",{"report_id":created["report_id"],"directory":str(destination)})
    files=retained_files(workspace,destination)
    if {x["path"].rsplit(".",1)[-1] for x in files}!={"json","csv","html","pdf","docx","xlsx","pptx"} or len(files)!=14:
        raise RuntimeError("The full current paired customer download set is incomplete")
    return {"role":role,"stage":stage,"report_id":created["report_id"],"publication_id":publication_id,
        "respondent_id":respondent_id,"accepted_revision_id":respondent["accepted_revision"],"accepted_number":respondent["version"],
        "question_count":len(question_ids),"public_path":released["public_path"],"selection":"current-customer-subset","files":files}

def run_programme(directory):
    workspace=Workspace(directory);root=workspace.directory/"source-evidence"/"whole-family-programme"
    complete=json.loads((root/"complete-family-programme.json").read_text())
    reports=[]
    for family in complete["families"]:
        reports.append(freeze_current(workspace,family["role"],family["respondent_id"],family["publication_id"],family["initial_report"]["question_ids"],
            root/"current-customer-reports","current-accepted-family"))
        if family.get("original_workbook_receiving"):
            received=family["original_workbook_receiving"]
            reports.append(freeze_current(workspace,family["role"],received["respondent_id"],family["publication_id"],received["report"]["question_ids"],
                root/"current-customer-reports","complete-original-workbook-receiving"))
        print(json.dumps({"role":family["role"],"state":"source-context-downloads-complete"}),flush=True)
    historical=[]
    for manifest_path in sorted(root.glob("*/reports/*/manifest.json")):
        manifest=json.loads(manifest_path.read_text());report=workspace.invoke("get_report",{"report_id":manifest["report_id"]})
        edition=report["edition"]["protected"];response=edition["accepted_responses"][0]
        historical.append({"report_id":report["id"],"role":manifest_path.parents[2].name,"selection":"retained-historical-report",
            "publication_id":edition["publication"]["id"],"definition_version":edition["publication"]["definition_version"],
            "respondent_id":response["respondent_id"],"accepted_revision_id":response["revision_id"],"accepted_number":response["accepted_number"],
            "question_count":len(edition["questions"]),"files":retained_files(workspace,manifest_path.parent)})
    summary={"schema":"atssc.complete-source-family-report-index.v2","workspace_id":complete["workspace_id"],
        "current_report_count":len(reports),"historical_report_count":len(historical),"reports":reports+historical}
    save(root/"delivered-report-index.json",summary)
    print(json.dumps({k:v for k,v in summary.items() if k!="reports"}),flush=True)
    return summary

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--workspace",required=True)
    run_programme(parser.parse_args().workspace)
