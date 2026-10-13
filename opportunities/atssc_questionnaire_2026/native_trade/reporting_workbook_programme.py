"""Materialize current accepted reporting responses in their original workbooks.

This programme reads the investigation's existing accepted editions. It authors
and calculates their original source-bound fields, retains complete workbook
successors in the same workspace, and checks the return projection without
changing the accepted questionnaire, respondent, review or report history.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import time
from pathlib import Path
from questionnaire_workspace import Workspace,encoded,is_calculated,scalar
from workbook_calculation import project_answers,verify_source_successor
from whole_family_programme import save

def normalized(definition,answers,source_values):
    result={}
    for question in definition["questions"]:
        if is_calculated(question) or not question.get("source"):continue
        key=question["id"]
        if question["kind"]=="table":
            rows=[]
            for index,row in enumerate(answers.get(key,[])):
                item={}
                for column in question["columns"]:
                    value=row.get(column["id"])
                    if column.get("source_readonly"):
                        value=source_values[key][index][column["id"]]
                    item[column["id"]]=scalar(column,value)
                rows.append(item)
            result[key]=rows
        else:result[key]=scalar(question,answers.get(key))
    return result

def run_programme(directory,selection_path):
    workspace=Workspace(directory);authority=workspace.invoke("status")["workspace_id"]
    selection=json.loads(Path(selection_path).read_text())
    if selection.get("workspace_id")!=authority:raise ValueError("The original accepted selection belongs to another workspace")
    root=workspace.directory/"source-evidence"/"accepted-workbook-cohort"
    save(root/"original-selection.json",selection)
    results=[];started=time.monotonic()
    for rid in selection["selected_respondent_ids"]:
        record=workspace.invoke("get_respondent",{"respondent_id":rid});respondent=record["respondent"]
        if respondent["status"]!="accepted" or respondent["publication_id"]!=selection["publication_id"]:
            raise ValueError("The selected original response is not currently accepted in this publication")
        revision=next(r for r in record["revisions"] if r["id"]==respondent["accepted_revision"])
        if revision["number"]!=respondent["version"]:raise ValueError("The original response has an unaccepted successor")
        answers=revision["answers"];definition=record["definition"]
        result=workspace.invoke("calculate_response",{"respondent_id":rid,"answers":answers,
            "request_id":"atssc-accepted-workbook-cohort-"+revision["id"]})
        replay=workspace.invoke("calculate_response",{"respondent_id":rid,"answers":answers,
            "request_id":"atssc-accepted-workbook-cohort-"+revision["id"]})
        if replay!=result:raise RuntimeError("The retained original workbook response replay differs")
        projected={};bindings=[]
        for binding in result["source_successor_bindings"]:
            source=binding["source_sha256"];calculated=binding["calculated_sha256"]
            verify_source_successor(workspace.get_workbook_bytes(source),workspace.get_workbook_bytes(calculated))
            edition=project_answers(definition,workspace.workbook(calculated),source)
            if edition["issues"]:raise RuntimeError("Original entered answer projection failed: "+json.dumps(edition["issues"]))
            projected.update(edition["answers"])
            job=workspace.invoke("get_calculation",{"calculation_id":binding["calculation_id"]})
            descriptor=job.get("result",job)
            bindings.append({**binding,"original_formula_count":descriptor["cache_manifest"]["formula_count"],
                "native_reference_range_count":sum(len(f["ranges"]) for f in descriptor["native_precedents"]["formulas"]),
                "retained_report_origin_count":len(descriptor["report_mapping"]),"job_attachment_count":len(descriptor["files"])})
        expected=normalized(definition,answers,record["source_values"])
        returned=normalized(definition,projected,record["source_values"])
        if returned!=expected:raise RuntimeError("The original accepted values changed on the actual native workbook return journey")
        after=workspace.invoke("get_respondent",{"respondent_id":rid})
        if after["respondent"]!=respondent or after["revisions"]!=record["revisions"]:
            raise RuntimeError("The source-native operation altered an accepted response's retained history")
        item={"respondent_id":rid,"name":respondent["name"],"accepted_revision_id":revision["id"],"accepted_number":revision["number"],
            "source_question_ids":list(expected),"input_hash":result["input_hash"],"source_successor_bindings":bindings,
            "retained_original_values":expected,"roundtrip_original_values":returned,"native_exact_replay":True,
            "original_history_retained":True,"context_provenance":{q["id"]:q["source_context"] for q in definition["questions"] if q.get("source_context")}}
        save(root/rid/"complete-response-workbooks.json",item)
        results.append(item);save(root/"progress.json",{"workspace_id":authority,"responses":results})
        print(json.dumps({"respondent_id":rid,"revision":revision["number"],"native_original_workbooks":len(bindings),"state":"complete"}),flush=True)
    report=workspace.invoke("get_report",{"report_id":selection["report_id"]})
    current={(r["respondent_id"],r["revision_id"]) for r in report["edition"]["protected"]["accepted_responses"]}
    if current!={(r["respondent_id"],r["accepted_revision_id"]) for r in results}:
        raise RuntimeError("The original current report differs from this accepted workbook cohort")
    summary={"schema":"atssc.current-accepted-original-workbook-cohort.v1","workspace_id":authority,
        "publication_id":selection["publication_id"],"current_report_id":selection["report_id"],
        "elapsed_seconds":time.monotonic()-started,"response_count":len(results),
        "native_workbook_count":sum(len(x["source_successor_bindings"]) for x in results),"responses":results}
    save(root/"complete-cohort-programme.json",summary);print(json.dumps({k:v for k,v in summary.items() if k!="responses"}),flush=True)
    return summary

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--workspace",required=True);parser.add_argument("--selection",required=True)
    args=parser.parse_args();run_programme(args.workspace,args.selection)
