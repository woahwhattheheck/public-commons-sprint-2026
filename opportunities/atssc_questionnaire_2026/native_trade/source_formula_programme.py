"""Operate and reopen the complete original/native formula library."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

from questionnaire_workspace import Workspace
from workbook_calculation import encoded,digest,timestamp

def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n")

def reopen(directory,expected):
    workspace=Workspace(directory);collection=workspace.invoke("source_formula_inspect",{"collection_id":expected})
    if collection["collection_id"]!=expected or collection["totals"]["native_formula_joins"]!=7661:
        raise RuntimeError("The original complete formula collection did not reopen")
    result={"workspace_id":collection["workspace_id"],"collection_id":expected,"totals":collection["totals"],
        "native_jobs":len(collection["native_jobs"]),"retained_files":len(collection["files"])}
    print(json.dumps(result),flush=True)
    return result

def run(directory):
    workspace=Workspace(directory);started=time.monotonic()
    with workspace.connection() as db:
        before={table:db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0] for table in ("questionnaires","publications","respondents","revisions","reviews","calculations")}
    request={"request_id":"atssc-original-formula-native-library-v2"}
    original=workspace.invoke("source_formula_import",request)
    if original!=workspace.invoke("source_formula_import",request):raise RuntimeError("Original formula receiving replay differs")
    collection=workspace.invoke("source_formula_inspect",{"collection_id":original["collection_id"]})
    members=set();groups=set();families=[]
    for workbook in collection["workbooks"]:
        occurrences=json.loads((workspace.directory/workbook["joined_occurrences_path"]).read_text())["records"]
        structural=json.loads((workspace.directory/workbook["joined_groups_path"]).read_text())["groups"]
        source_keys={r["source_key"] for r in occurrences}
        if len(source_keys)!=workbook["formulas"] or sum(len(g["members"]) for g in structural)!=workbook["formulas"]:
            raise RuntimeError("A complete original workbook formula occurrence is missing")
        if {m["source_key"] for g in structural for m in g["members"]}!=source_keys:
            raise RuntimeError("Original formula groups do not retain the whole source")
        if members&source_keys:raise RuntimeError("Original workbook formula identities overlap")
        members.update(source_keys);groups.update(g["group_key"] for g in structural)
        page=workspace.invoke("source_formula_groups",{"collection_id":collection["collection_id"],"workbook_sha256":workbook["source"]["sha256"],"limit":30})
        if page["total"]!=len(structural):raise RuntimeError("Whole source group pagination differs")
        last=workspace.invoke("source_formula_groups",{"collection_id":collection["collection_id"],"workbook_sha256":workbook["source"]["sha256"],"offset":max(0,len(structural)-10),"limit":30})
        if last["next_offset"] is not None or len(last["groups"])!=min(10,len(structural)):
            raise RuntimeError("The final original source groups are unavailable")
        families.append({"role":workbook["role"],"original_sha256":workbook["source"]["sha256"],"formulas":len(occurrences),
            "groups":len(structural),"native_formula_joins":workbook["native_formula_join_count"],
            "stable_question_count":workbook["stable_question_count"],"native_calculation_id":workbook["native_calculation_id"]})
    if len(members)!=7661 or len(groups)!=1302:raise RuntimeError("The full original-family library is incomplete")
    selected=workspace.invoke("source_formula_groups",{"collection_id":collection["collection_id"],"search":"s_649106f345_5f56359e_c38"})
    group=workspace.invoke("source_formula_group",{"collection_id":collection["collection_id"],"group_key":selected["groups"][0]["group_key"]})
    cell=next(r for r in group["members"] if r["worksheet"]=="Prod" and r["cell"]=="C38")
    entered_id="s_649106f345_5f56359e_c36_i36"
    input_groups=workspace.invoke("source_formula_groups",{"collection_id":collection["collection_id"],"search":entered_id,"limit":100})
    if group["group"]["group_key"] not in {g["group_key"] for g in input_groups["groups"]}:
        raise RuntimeError("The original entered production question does not find its native formula group")
    if not any(r["question_id"]==entered_id and r.get("cell")=="C36" and r.get("column_id")=="c_c" for r in cell["native_question_references"]):
        raise RuntimeError("The exact original input column/physical row is absent from native formula lineage")
    actual=[]
    for job in collection["native_jobs"]:
        if job["original_source_sha256"].startswith("649106"):
            retained=workspace.invoke("source_formula_cell",{"collection_id":collection["collection_id"],"source_key":cell["source_key"],"calculation_id":job["calculation_id"]})
            native=retained["selected_native_edition"]
            actual.append({"calculation_id":job["calculation_id"],"source_sha256":native["source_sha256"],"calculated_sha256":native["calculated_sha256"],
                "kind":native["kind"],"value":native["value"],"error_code":native["error_code"]})
    if not {"0","30","150"}<={r["value"] for r in actual if r["kind"]=="n"}:
        raise RuntimeError("Actual original/entered/zero/cleared native cell editions are absent")
    # A new process uses the retained original code, source files, SQLite graph
    # and native job files. No formula calculation or response mutation runs.
    completed=subprocess.run([sys.executable,str(Path(__file__).resolve()),"--workspace",str(workspace.directory),"--reopen",collection["collection_id"]],
        capture_output=True,text=True,timeout=120)
    if completed.returncode:raise RuntimeError("Fresh original formula reopen failed: "+completed.stderr)
    fresh=json.loads(completed.stdout.strip().splitlines()[-1])
    with workspace.connection() as db:
        after={table:db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0] for table in before}
    if before!=after:raise RuntimeError("Formula inspection changed original native response histories")
    result={"schema":"atssc.complete-original-formula-programme.v1","created":timestamp(),"workspace_id":collection["workspace_id"],
        "collection_id":collection["collection_id"],"source_archive_sha256":collection["original_archive_sha256"],"source_reader_sha256":collection["reader_sha256"],
        "totals":collection["totals"],"families":families,"retained_file_count":len(collection["files"]),
        "retained_file_bytes":sum(f["bytes"] for f in collection["files"]),"native_job_count":len(collection["native_jobs"]),
        "original_c38_source_key":cell["source_key"],"original_entered_question_id":entered_id,"original_c38_group_key":group["group"]["group_key"],
        "input_question_group_count":input_groups["total"],"actual_c38_editions":actual,"fresh_process":fresh,
        "native_lifecycle_counts":after,"seconds":round(time.monotonic()-started,3)}
    root=workspace.directory/"source-evidence"/"formula-library"
    previous=root/"complete-programme.json"
    if previous.exists() and json.loads(previous.read_text())["collection_id"]!=collection["collection_id"]:
        retained=root/"history";retained.mkdir(exist_ok=True)
        save(retained/(json.loads(previous.read_text())["collection_id"]+"-complete-programme.json"),json.loads(previous.read_text()))
    save(root/"complete-programme.json",result)
    print(json.dumps({k:v for k,v in result.items() if k not in {"families","actual_c38_editions"}}),flush=True)
    return result

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--workspace",required=True);parser.add_argument("--reopen")
    args=parser.parse_args()
    if args.reopen:reopen(args.workspace,args.reopen)
    else:run(args.workspace)
