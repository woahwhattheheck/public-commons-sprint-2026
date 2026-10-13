"""Complete five-original retained calculation, replay and process handover."""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from questionnaire_workspace import Workspace,OperationError

ORIGINALS=[
 ("foreign_producer","649106f345787fb9f3154b5f2fcd418503e4bbfe5b46b191e714c1d7370df8c4"),
 ("importer_purchaser","6f69da68fec452a6d248b8a96f55c533c53afb0dc103183fe5978271e21525e9"),
 ("producer","321ec7fb3af87cf6f1d1eb595c242f8f1133483c0e51c199b12a278c6a71e127"),
 ("union","8135ff3fc5ff5f529c79db9c69bedb70876b41d653c121b8b34be6610f377596"),
 ("certification","1680f22bd259465ff779521e3170787a4adc86eb37ecceb4c8a8faa30d765e57"),
]

def run_programme(directory):
    workspace=Workspace(directory)
    authority=workspace.invoke("status")["workspace_id"]
    started=time.monotonic();results=[];requests=[]
    for role,sha in ORIGINALS:
        original=workspace.workbook(sha)
        if hashlib.sha256(workspace.get_workbook_bytes(sha)).hexdigest()!=sha:
            raise RuntimeError("The issuer's original workbook bytes differ")
        params={"request_id":"atssc-original-native-calculation-20261013-"+role,"workbook_sha256":sha}
        result=workspace.invoke("calculate_workbook",params)
        if result!=workspace.invoke("calculate_workbook",params):raise RuntimeError("Exact original request replay differs")
        calculated=workspace.workbook(result["calculated_sha256"])
        if [(s["name"],s["state"]) for s in original["sheets"]]!=[(s["name"],s["state"]) for s in calculated["sheets"]]:
            raise RuntimeError("The original sheet family changed")
        if original["formulaCount"]!=calculated["formulaCount"] or original["cellCount"]!=calculated["cellCount"]:
            raise RuntimeError("The original full cell/formula catalogue changed")
        item={"role":role,"source_sha256":sha,"calculated_sha256":result["calculated_sha256"],
            "calculation_id":result["calculation_id"],"sheet_count":original["sheetCount"],
            "hidden_sheet_count":sum(s["state"]!="visible" for s in original["sheets"]),
            "original_cell_count":original["cellCount"],"original_formula_count":original["formulaCount"],
            "native_precedent_formula_count":len(result["native_precedents"]["formulas"]),
            "native_reference_range_count":sum(len(f["ranges"]) for f in result["native_precedents"]["formulas"]),
            "native_error_count":sum(f["status"]=="formula_error" for f in result["cache_manifest"]["formula_results"]),
            "job_attachment_count":len(result["files"]),"exact_replay":True}
        results.append(item);requests.append((params,result))
        print(json.dumps({"role":role,"calculation_id":result["calculation_id"],"state":"complete"}),flush=True)
    try:
        workspace.invoke("calculate_workbook",{**requests[0][0],"workbook_sha256":ORIGINALS[1][1]})
    except OperationError as error:
        if error.code!="REQUEST_CONFLICT":raise
    else:raise RuntimeError("A different source reused an immutable calculation request")
    root=workspace.directory/"calculations"
    output=root/"original-family-fresh-process.jsonl"
    lines="".join(json.dumps({"id":str(i),"method":"calculate_workbook","params":p})+"\n" for i,(p,_) in enumerate(requests))
    with output.open("w") as destination:
        process=subprocess.run([sys.executable,str(Path(__file__).parent/"cli.py"),"--workspace",str(workspace.directory),"rpc"],
            input=lines,text=True,stdout=destination,stderr=subprocess.PIPE,timeout=60)
    if process.returncode:raise RuntimeError("Fresh original process receiving failed: "+process.stderr)
    records=[json.loads(line) for line in output.read_text().splitlines()]
    if len(records)!=len(requests):raise RuntimeError("Fresh process returned an incomplete original family")
    for record,(_,expected) in zip(records,requests):
        if record.get("result")!=expected:raise RuntimeError("The freshly reopened original calculation edition differs")
    summary={"schema":"atssc.complete-original-calculation-programme.v1","workspace_id":authority,
        "elapsed_seconds":time.monotonic()-started,"workbooks":results,
        "original_sheet_count":sum(x["sheet_count"] for x in results),
        "original_hidden_sheet_count":sum(x["hidden_sheet_count"] for x in results),
        "original_cell_count":sum(x["original_cell_count"] for x in results),
        "original_formula_count":sum(x["original_formula_count"] for x in results),
        "fresh_process_exact_replay":True,"changed_source_request_conflict":True}
    (root/"original-family-programme.json").write_text(json.dumps(summary,indent=2)+"\n")
    print(json.dumps(summary),flush=True)
    return summary

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--workspace",required=True)
    run_programme(parser.parse_args().workspace)
