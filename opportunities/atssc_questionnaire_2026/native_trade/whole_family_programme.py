"""Run original five-family intake, native revision, review and paired reports.

This is an editable customer operating programme for the retained source
workbooks. Its entered examples are declared in a separate JSON plan. It uses
the existing workspace authority, its normal API and the original formula
engine; it does not create a second database or evaluator.
"""
from __future__ import annotations
import argparse
import base64
import copy
import hashlib
import json
import time
from decimal import Decimal
from pathlib import Path
from questionnaire_workspace import Workspace,OperationError,scalar
from original_calculation_programme import ORIGINALS

METRICS={
    "foreign_producer":[("Prod","C38","150"),("Public Summary | Résumé pub INT","C16","X")],
    "importer_purchaser":[("Imp - China | Chine","C31","2500")],
    "producer":[("Prod","C44","100"),("Public Summary | Résumé pub INT","C16","X")],
    "union":[("Conf","C19","25"),("Conf","C24","37000")],
    "certification":[],
}

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    pending=path.with_suffix(path.suffix+".pending")
    pending.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")
    pending.replace(path)

def bound_field(definition,sheet,address):
    from workbooks import cell_parts,col_letters
    row,column=cell_parts(address)
    for question in definition["questions"]:
        source=question.get("source",{})
        if source.get("sheet")!=sheet:continue
        if question["kind"]!="table" and source.get("cell")==address:return question,None,None
        if question["kind"]=="table" and row in source.get("rows",range(source.get("start_row",0),source.get("end_row",-1)+1)):
            for field in question["columns"]:
                if field.get("source_column")==col_letters(column):
                    rows=source.get("rows",list(range(source["start_row"],source["end_row"]+1)))
                    return question,field,rows.index(row)
    raise ValueError("Declared entered cell is absent from the complete original definition: "+sheet+"!"+address)

def enter(answers,definition,sheet,address,value):
    question,column,index=bound_field(definition,sheet,address)
    field=column or question
    if question.get("source_calculated") or field.get("source_readonly"):
        raise ValueError("An entered example cannot replace an original readonly source field")
    if field["kind"] in {"text","choice"} and value is not None:value=str(value)
    value=scalar(field,value)
    if column:
        rows=answers.setdefault(question["id"],[{} for _ in question["source"]["rows"]])
        rows[index][column["id"]]=value
    else:answers[question["id"]]=value
    return question["id"]

def check_value(actual,expected,label):
    if expected in {"X","-"}:
        equal=actual==expected
    else:equal=actual is not None and Decimal(str(actual))==Decimal(expected)
    if not equal:raise RuntimeError("The actual original native result differs at "+label+": "+repr(actual))

def report(workspace,publication,respondent,question_ids,directory,request_prefix):
    created=workspace.invoke("create_report",{"publication_id":publication,"respondent_ids":[respondent],"question_ids":question_ids,
        "request_id":request_prefix+"-report"})
    released=workspace.invoke("release_report",{"report_id":created["report_id"],"note":"Entered original-source programme: exact protected inputs and dependent native metrics stay masked; public answers and alternatives reviewed.",
        "request_id":request_prefix+"-release"})
    output=directory/created["report_id"]
    if not output.exists():workspace.invoke("export_report",{"report_id":created["report_id"],"directory":str(output)})
    else:
        manifest=json.loads((output/"manifest.json").read_text())
        for item in manifest["files"]:
            body=(output/item["path"]).read_bytes()
            if len(body)!=item["bytes"] or hashlib.sha256(body).hexdigest()!=item["sha256"]:
                raise RuntimeError("A retained report download differs")
    return {"report_id":created["report_id"],"public_path":released["public_path"],"report_directory":output.relative_to(workspace.directory).as_posix(),
        "question_ids":question_ids,"public_questions":created["public_questions"],"protected_questions":created["protected_questions"]}

def run_programme(directory,plan_path):
    workspace=Workspace(directory);authority=workspace.invoke("status")["workspace_id"]
    root=workspace.directory/"source-evidence"/"whole-family-programme"
    plan=json.loads(Path(plan_path).read_text());save(root/"entered-plan.json",plan)
    samples={item["role"]:item for item in plan["workbooks"]}
    results=[];started=time.monotonic()
    for role,source_sha in ORIGINALS:
        prefix="atssc-whole-family-20261013-"+role
        imported=workspace.invoke("import_workbook_definition",{"workbook_sha256":source_sha,"request_id":prefix+"-intake"})
        replay=workspace.invoke("import_workbook_definition",{"workbook_sha256":source_sha,"request_id":prefix+"-intake"})
        if replay!=imported:raise RuntimeError("The original full definition replay changed")
        prior=None
        if imported["definition"].get("source_intake",{}).get("compiler_version",0)<2:
            # The original native first attempt exposed mixed numeric/X source
            # indicators. Retain that entire attempt and append its corrected
            # full definition under the same original questionnaire authority.
            prior={"questionnaire_id":imported["questionnaire_id"],"definition_version":imported["version"]}
            prefix+="-source-types2"
            corrected={"workbook_sha256":source_sha,"questionnaire_id":imported["questionnaire_id"],"expected_version":imported["version"],"request_id":prefix+"-intake"}
            imported=workspace.invoke("import_workbook_definition",corrected)
            if imported!=workspace.invoke("import_workbook_definition",corrected):raise RuntimeError("The corrected original intake replay differs")
        if role=="importer_purchaser":
            percentage,_,_=bound_field(imported["definition"],"Pub - Questions","E97")
            if percentage["kind"]!="number":
                prior={"questionnaire_id":imported["questionnaire_id"],"definition_version":imported["version"]}
                prefix+="-original-units3"
                corrected={"workbook_sha256":source_sha,"questionnaire_id":imported["questionnaire_id"],"expected_version":imported["version"],"request_id":prefix+"-intake"}
                imported=workspace.invoke("import_workbook_definition",corrected)
                if imported!=workspace.invoke("import_workbook_definition",corrected):raise RuntimeError("Original unit-header intake replay changed")
                percentage,_,_=bound_field(imported["definition"],"Pub - Questions","E97")
                if percentage["kind"]!="number" or percentage.get("workbook_scale"):raise RuntimeError("Original E97 is an unscaled numeric percentage")
        definition=imported["definition"]
        publication=workspace.invoke("publish",{"questionnaire_id":imported["questionnaire_id"],"expected_version":imported["version"],"request_id":prefix+"-publish"})
        invitation=workspace.invoke("invite",{"publication_id":publication["publication_id"],"name":"Original native family sample — "+role,"request_id":prefix+"-invite"})
        rid=invitation["respondent_id"];answers={};selected=[]
        for edit in samples[role]["edits"]:
            qid=enter(answers,definition,edit["sheet"],edit["cell"],edit["value"])
            if qid not in selected:selected.append(qid)
        save(root/role/"entered-answers.json",answers)
        current=workspace.invoke("get_respondent",{"respondent_id":rid})
        if current["respondent"]["version"]==0:
            draft=workspace.invoke("save_progress",{"respondent_id":rid,"expected_version":0,"expected_draft_version":0,
                "answers":answers,"public_confirmed":True,"request_id":prefix+"-draft"})
            reopened=Workspace(directory).invoke("get_respondent",{"respondent_id":rid})
            if reopened["draft"]["answers"]!=answers or reopened["draft"]["version"]!=draft["draft_version"]:
                raise RuntimeError("The original entered draft did not survive process handover")
        submit={"respondent_id":rid,"expected_version":0,"answers":answers,"public_confirmed":True,"request_id":prefix+"-seal"}
        revision=workspace.invoke("submit_revision",submit)
        save(root/role/"initial-revision.json",revision)
        if not revision["validation"]["valid"]:raise RuntimeError("Original family validation: "+json.dumps(revision["validation"]["issues"]))
        if revision["validation"].get("native_calculation_pending"):raise RuntimeError("A source-native field was sealed without its authoritative calculation")
        if revision!=workspace.invoke("submit_revision",submit):raise RuntimeError("Exact original sealed revision replay changed")
        checks=[]
        for sheet,cell,expected in METRICS[role]:
            field,_,_=bound_field(definition,sheet,cell)
            value=revision["validation"]["values"].get(field["id"]);check_value(value,expected,sheet+"!"+cell)
            selected.append(field["id"])
            if "Summary" in sheet and revision["validation"]["public_values"].get(field["id"]) is not None:
                raise RuntimeError("The original public native summary exposed a protected precedent")
            checks.append({"sheet":sheet,"cell":cell,"question_id":field["id"],"value":value,
                "public_value":revision["validation"]["public_values"].get(field["id"]),"disclosure":revision["validation"]["disclosures"].get(field["id"])})
        selected=list(dict.fromkeys(selected))
        review=workspace.invoke("review_revision",{"revision_id":revision["revision_id"],"expected_version":1,"decision":"accept",
            "note":"Complete original-family native result, source cache, exact bindings and disclosure reviewed.","request_id":prefix+"-review"})
        first_report=report(workspace,publication["publication_id"],rid,selected,root/role/"reports",prefix+"-initial")
        native=revision["validation"]["native_calculation"]
        if not native.get("calculation_ids"):raise RuntimeError("The original family retained no native calculation")
        binding=next(b for b in native["source_successor_bindings"] if b["source_sha256"]==source_sha)
        answered=workspace.workbook(binding["answered_sha256"]);source_input_checks=[]
        for edit in samples[role]["edits"]:
            cell=next(s for s in answered["sheets"] if s["name"]==edit["sheet"])["cells"][edit["cell"]]
            if type(edit["value"]) in {int,float}:
                if cell["kind"]!="n" or Decimal(str(cell["value"]))!=Decimal(str(edit["value"])):
                    raise RuntimeError("An entered numeric source control lost its native numeric type: "+edit["sheet"]+"!"+edit["cell"])
            elif cell["value"]!=edit["value"]:raise RuntimeError("An entered original source control changed")
            source_input_checks.append({"sheet":edit["sheet"],"cell":edit["cell"],"kind":cell["kind"],"value":cell["value"]})
        item={"role":role,"source_sha256":source_sha,"questionnaire_id":imported["questionnaire_id"],"definition_version":imported["version"],
            "publication_id":publication["publication_id"],"respondent_id":rid,"initial_revision_id":revision["revision_id"],
            "review_id":review["review_id"],"source_summary":imported["summary"],"catalogue_path":imported["catalogue_path"],
            "native_calculation":native,"native_result_checks":checks,"typed_native_issue_count":len(revision["validation"].get("formula_issues",[])),
            "source_input_checks":source_input_checks,
            "initial_report":first_report,"exact_definition_replay":True,"exact_revision_replay":True,"saved_draft_reopened":True}
        if prior:item["retained_prior_source_attempt"]=prior
        if role=="foreign_producer":
            zero_clear=[]
            for version,label,value in [(1,"zero",0),(2,"cleared",None)]:
                successor_answers=copy.deepcopy(answers);qid=enter(successor_answers,definition,"Prod","C36",value)
                sealed=workspace.invoke("submit_revision",{"respondent_id":rid,"expected_version":version,"answers":successor_answers,
                    "public_confirmed":True,"request_id":prefix+"-"+label+"-seal"})
                save(root/role/(label+"-revision.json"),sealed)
                if not sealed["validation"]["valid"]:raise RuntimeError("The original "+label+" successor is invalid")
                total,_,_=bound_field(definition,"Prod","C38")
                check_value(sealed["validation"]["values"][total["id"]],"30","Prod!C38")
                entered_field,entered_column,entered_row=bound_field(definition,"Prod","C36")
                entered_value=sealed["validation"]["values"][qid]
                if entered_column:entered_value=entered_value[entered_row][entered_column["id"]]
                if entered_value!=("0" if value==0 else None):raise RuntimeError("Zero and cleared input lost their original typed distinction")
                workspace.invoke("review_revision",{"revision_id":sealed["revision_id"],"expected_version":version+1,"decision":"accept",
                    "note":"Original "+label+" input and authoritative native successor reviewed.","request_id":prefix+"-"+label+"-review"})
                frozen=report(workspace,publication["publication_id"],rid,selected,root/role/"reports",prefix+"-"+label)
                binding=sealed["validation"]["native_calculation"]["source_successor_bindings"][0]
                book=workspace.workbook(binding["answered_sha256"])
                sourcecell=next(s for s in book["sheets"] if s["name"]=="Prod")["cells"]["C36"]
                zero_clear.append({"label":label,"revision_id":sealed["revision_id"],"number":sealed["number"],"input_value":entered_value,
                    "original_cell_kind":sourcecell["kind"],"original_cell_value":sourcecell["value"],"native_total":"30","binding":binding,"report":frozen})
            if zero_clear[0]["binding"]["answered_sha256"]==zero_clear[1]["binding"]["answered_sha256"]:
                raise RuntimeError("Zero and cleared workbook editions were collapsed")
            retained=workspace.invoke("get_report",{"report_id":first_report["report_id"]})
            first=retained["edition"]["protected"]["accepted_responses"][0]
            if first["revision_id"]!=revision["revision_id"]:raise RuntimeError("A sealed original report changed after its successor")
            item["zero_and_cleared_successors"]=zero_clear;item["prior_report_retained"]=True
            # Receive a complete answered original workbook into another
            # respondent of the SAME immutable publication. The original core
            # extracts typed source inputs and recalculates its readonly fields
            # before sealing, retaining this actual uploaded package as base.
            upload_prefix=prefix+"-original-workbook-receiving"
            uploader=workspace.invoke("invite",{"publication_id":publication["publication_id"],"name":"Original full workbook receiving — foreign producer",
                "request_id":upload_prefix+"-invite"})
            uploaded=workspace.get_workbook_bytes(binding["calculated_sha256"])
            received=workspace.invoke("import_workbook",{"name":"received-answered-original-c1.xlsx","data_base64":base64.b64encode(uploaded).decode(),
                "expected_sha256":binding["calculated_sha256"],"request_id":upload_prefix+"-upload"})
            extracted=workspace.invoke("workbook_answers",{"respondent_id":uploader["respondent_id"],"sha256":received["sha256"],"source_binding_sha256":source_sha})
            upload_params={"respondent_id":uploader["respondent_id"],"expected_version":0,"workbook_sha256":received["sha256"],
                "source_binding_sha256":source_sha,"public_confirmed":True,"request_id":upload_prefix+"-seal"}
            upload_revision=workspace.invoke("submit_revision",upload_params)
            if not upload_revision["validation"]["valid"]:raise RuntimeError("The actual original uploaded workbook response is invalid")
            if workspace.invoke("submit_revision",upload_params)!=upload_revision:raise RuntimeError("The uploaded original revision replay differs")
            metric,_,_=bound_field(definition,"Prod","C38")
            check_value(upload_revision["validation"]["values"][metric["id"]],"30","received cleared original Prod!C38")
            upload_native=upload_revision["validation"]["native_calculation"]
            upload_binding=upload_native["source_successor_bindings"][0]
            input_manifest=json.loads((workspace.directory/upload_binding["original_input_manifest"]).read_text())
            if input_manifest.get("retained_uploaded_sha256")!=received["sha256"]:raise RuntimeError("The original uploaded package was discarded during calculation")
            workspace.invoke("review_revision",{"revision_id":upload_revision["revision_id"],"expected_version":1,"decision":"accept",
                "note":"Complete original workbook upload, typed return projection and authoritative native successor reviewed.","request_id":upload_prefix+"-review"})
            uploaded_report=report(workspace,publication["publication_id"],uploader["respondent_id"],selected,root/role/"reports",upload_prefix)
            item["original_workbook_receiving"]={"respondent_id":uploader["respondent_id"],"revision_id":upload_revision["revision_id"],
                "received_sha256":received["sha256"],"source_binding_sha256":source_sha,"projected_input_question_count":len(extracted["answers"]),
                "native_calculation":upload_native,"native_production_total":"30","source_edition":"original-cleared-successor",
                "exact_revision_replay":True,"uploaded_package_retained":True,"report":uploaded_report}
        results.append(item);save(root/"progress.json",{"workspace_id":authority,"families":results})
        print(json.dumps({"role":role,"questionnaire_id":item["questionnaire_id"],"state":"accepted-and-reported","questions":imported["summary"]["question_count"]}),flush=True)
    summary={"schema":"atssc.complete-original-family-customer-programme.v1","workspace_id":authority,
        "purpose":plan["purpose"],"elapsed_seconds":time.monotonic()-started,"families":results,
        "question_count":sum(x["source_summary"]["question_count"] for x in results),
        "input_cell_count":sum(x["source_summary"]["input_cell_count"] for x in results),
        "source_calculated_question_count":sum(x["source_summary"]["calculated_question_count"] for x in results),
        "original_cell_count":sum(x["source_summary"]["original_cell_count"] for x in results)}
    save(root/"complete-family-programme.json",summary);print(json.dumps({k:v for k,v in summary.items() if k!="families"}),flush=True)
    return summary

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--workspace",required=True);parser.add_argument("--plan",required=True)
    args=parser.parse_args();run_programme(args.workspace,args.plan)
