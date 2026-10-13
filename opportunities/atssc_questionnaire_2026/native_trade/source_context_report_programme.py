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
from workbook_intake import source_display_definition

DISPLAY_KEYS=("label","original_question_text","original_row_label","original_french_text","original_row_french_label","original_context","original_period_context","original_question_heading","original_answer_option","original_choice_labels","original_choice_french_labels","section")

def presentation(question):
    return {**{k:question.get(k) for k in DISPLAY_KEYS},"columns":[{"id":c["id"],"label":c["label"]} for c in question.get("columns",[])]}

def retained_files(workspace,directory):
    manifest=json.loads((directory/"manifest.json").read_text())
    files=[]
    for entry in manifest["files"]:
        path=directory/entry["path"];body=path.read_bytes()
        if len(body)!=entry["bytes"] or hashlib.sha256(body).hexdigest()!=entry["sha256"]:
            raise RuntimeError("A retained original customer report download differs")
        files.append({**entry,"path":path.relative_to(workspace.directory).as_posix()})
    return files

def freeze_current(workspace,role,respondent_id,publication_id,question_ids,root,stage,previous=None):
    original=workspace.invoke("get_respondent",{"respondent_id":respondent_id})
    respondent=original["respondent"]
    if respondent["status"]!="accepted" or respondent["publication_id"]!=publication_id:
        raise RuntimeError("Freeze the original current accepted family edition")
    display=source_display_definition(workspace,original["definition"])
    context=display["source_display_context"]
    request="atssc-source-context-v4-"+context["identity"]+"-"+respondent["accepted_revision"]
    prior=next((r for r in (previous or {}).get("reports",[]) if r.get("selection")=="current-customer-subset" and r.get("role")==role and r.get("stage")==stage
        and r.get("accepted_revision_id")==respondent["accepted_revision"] and r.get("publication_id")==publication_id),None)
    reusable=False
    if prior:
        retained=workspace.invoke("get_report",{"report_id":prior["report_id"]})
        old=retained["edition"]["protected"]["questions"];shown={q["id"]:q for q in display["questions"]}
        reusable=[q["id"] for q in old]==question_ids and all(presentation(q)==presentation(shown[q["id"]]) for q in old)
    if reusable:
        created={"report_id":prior["report_id"]};released={"public_path":prior["public_path"]}
    else:
        created=workspace.invoke("create_report",{"publication_id":publication_id,"respondent_ids":[respondent_id],"question_ids":question_ids,
            "refresh_source_context":True,"request_id":request})
        released=workspace.invoke("release_report",{"report_id":created["report_id"],"note":"Current original-source customer report: complete static question context, original typed answers and native dependent disclosure reviewed.",
            "request_id":request+"-release"})
    result=workspace.invoke("get_report",{"report_id":created["report_id"]})
    for edition in ("public","protected"):
        for q in result["edition"][edition]["questions"]:
            source=next(x for x in display["questions"] if x["id"]==q["id"])
            for key in DISPLAY_KEYS:
                if source.get(key) and q.get(key)!=source[key]:raise RuntimeError("The original static source question context is absent from "+edition)
            if q["kind"]=="table" and [c["label"] for c in q["columns"]]!=[c["label"] for c in source["columns"]]:
                raise RuntimeError("The exact original period header differs in "+edition)
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
        "question_count":len(question_ids),"source_display_context":context,"public_path":released["public_path"],"selection":"current-customer-subset","files":files}

def run_programme(directory):
    workspace=Workspace(directory);root=workspace.directory/"source-evidence"/"whole-family-programme"
    complete=json.loads((root/"complete-family-programme.json").read_text())
    previous_path=root/"delivered-report-index.json"
    previous=json.loads(previous_path.read_text()) if previous_path.exists() else {"reports":[]}
    with workspace.connection() as db:
        before={name:db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in ("questionnaires","publications","respondents","revisions","reviews","calculations")}
    reports=[]
    for family in complete["families"]:
        reports.append(freeze_current(workspace,family["role"],family["respondent_id"],family["publication_id"],family["initial_report"]["question_ids"],
            root/"current-customer-reports","current-accepted-family",previous))
        if family.get("original_workbook_receiving"):
            received=family["original_workbook_receiving"]
            reports.append(freeze_current(workspace,family["role"],received["respondent_id"],family["publication_id"],received["report"]["question_ids"],
                root/"current-customer-reports","complete-original-workbook-receiving",previous))
        print(json.dumps({"role":family["role"],"state":"source-context-downloads-complete"}),flush=True)
    historical=[]
    manifest_paths=set(root.glob("*/reports/*/manifest.json"))|set(root.glob("current-customer-reports/*/manifest.json"))
    for manifest_path in sorted(manifest_paths):
        manifest=json.loads(manifest_path.read_text());report=workspace.invoke("get_report",{"report_id":manifest["report_id"]})
        edition=report["edition"]["protected"];response=edition["accepted_responses"][0]
        historical.append({"report_id":report["id"],"role":manifest_path.parents[2].name,"selection":"retained-historical-report",
            "publication_id":edition["publication"]["id"],"definition_version":edition["publication"]["definition_version"],
            "respondent_id":response["respondent_id"],"accepted_revision_id":response["revision_id"],"accepted_number":response["accepted_number"],
            "question_count":len(edition["questions"]),"files":retained_files(workspace,manifest_path.parent)})
    current_ids={r["report_id"] for r in reports};retained={r["report_id"]:r for r in historical if r["report_id"] not in current_ids}
    for entry in previous["reports"]:
        if entry["report_id"] not in current_ids:
            retained[entry["report_id"]]={**entry,"selection":"retained-historical-report"}
    historical=list(retained.values())
    # Report successors revise source presentation only. The same accepted
    # native values, public masks, calculations and response history are used.
    for row in reports:
        old=next((r for r in previous["reports"] if r.get("selection")=="current-customer-subset" and r.get("role")==row["role"] and r.get("stage")==row["stage"]),None)
        if old:
            a=workspace.invoke("get_report",{"report_id":old["report_id"]})["edition"]
            b=workspace.invoke("get_report",{"report_id":row["report_id"]})["edition"]
            for edition in ("public","protected"):
                for key in ("accepted_responses","numeric_totals"):
                    if a[edition][key]!=b[edition][key]:raise RuntimeError("Original accepted native answers or disclosure masks changed")
    with workspace.connection() as db:
        after={name:db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in before}
    if before!=after:raise RuntimeError("Source display must preserve the original questionnaire, response and native job histories")
    summary={"schema":"atssc.complete-source-family-report-index.v3","workspace_id":complete["workspace_id"],
        "source_display_version":4,"native_lifecycle_counts":after,
        "current_report_count":len(reports),"historical_report_count":len(historical),"reports":reports+historical}
    save(root/"delivered-report-index.json",summary)
    print(json.dumps({k:v for k,v in summary.items() if k!="reports"}),flush=True)
    return summary

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--workspace",required=True)
    run_programme(parser.parse_args().workspace)
