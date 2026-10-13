"""Receive the three complete invented migration editions and their original-source handovers.

This is the maintained product receiving programme, not a customer result or a
25,000-account / two-million-row benchmark. All inputs are the complete public
demonstration files adjacent to this programme. No provider or customer writes.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from discovery_engine import (
    DiscoveryError, require, read_json, json_bytes, file_digest,
    compare_reports,
)
from migration_reconciliation import verify_case

OPERATION = "WATER-MIGRATION-RECONCILIATION-E258-20261013"
PAIRS = {"customers","accounts","premises","meters","reads","tariffs",
         "bills","payments","allocations","balances"}

def atomic(path,value):
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    require(not path.is_symlink(),"Ordinary owned receipt required")
    fd,temporary = tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            stream.write(json_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def identity(path):
    path = Path(path)
    return {"path":str(path),"bytes":path.stat().st_size,"sha256":file_digest(path)}

def exact(value):
    require(isinstance(value,dict),"An actual rational result is required")
    return Fraction(int(value["numerator"]),int(value["denominator"]))

def records(path):
    with open(path,encoding="utf-8") as stream:
        for line in stream:
            yield json.loads(line)

def selected_row(case,pair,key):
    rows = [row for row in records(case/"migration/rows.jsonl")
            if row["pair"]==pair and row["key"]==[key]]
    require(len(rows)==1,"Expected one original demonstration row: "+pair+"/"+key)
    return rows[0]

def selected_field(case,pair,key,field):
    row = selected_row(case,pair,key)
    values = [x for x in row["fields"] if x["id"]==field]
    require(len(values)==1,"Expected selected field "+field)
    return row,values[0]

def selected_total(case,pair,field,dimensions):
    rows = [row for row in records(case/"migration/totals.jsonl")
            if row["pair"]==pair and row["field"]==field and row["dimensions"]==dimensions]
    require(len(rows)==1,"Expected one exact-context demonstration total: "+pair+"/"+field)
    return rows[0]

def inspect_case(case):
    root,report,result = verify_case(case)
    require(result["data_class"]=="DEMONSTRATION","Only the declared invented course is selected")
    require({p["id"] for p in result["pairs"]}==PAIRS and len(result["pairs"])==10,
            "The complete ten-pair selection must survive")
    require(len(report["tables"])==22,"All twenty-two complete exports/crosswalks must survive")
    table_rows = {t["id"]:t["rows"] for t in report["tables"]}
    selected_tables = {side["table"] for p in read_json(root/"migration/selection.json")["pairs"]
                       for side in (p["source"],p["target"])}
    seen = {table:set() for table in selected_tables}
    status = Counter()
    map_refs = set()
    with sqlite3.connect((root/"migration/comparisons.sqlite").as_uri()+"?mode=ro",uri=True) as db:
        n = 0
        for n,row in enumerate(records(root/"migration/rows.jsonl"),1):
            require(row["row_id"]==n,"Original comparison order/IDs changed")
            indexed = db.execute("SELECT payload FROM comparisons WHERE row_id=?",(n,)).fetchone()
            require(indexed is not None and json.loads(indexed[0])==row,
                    "The complete JSONL row differs from its native index")
            status[row["classification"]] += 1
            for ref in row["source_records"]+row["target_records"]:
                require(ref["table"] in table_rows and 1<=ref["record"]<=table_rows[ref["table"]],
                        "Comparison source ordinal is outside its full original export")
                if ref["table"] in seen:
                    seen[ref["table"]].add(ref["record"])
                if row["classification"]=="CROSSWALK_ISSUE":
                    map_refs.add((ref["table"],ref["record"]))
        require(n==result["rows"]["count"]==result["comparison_records"]==
                db.execute("SELECT COUNT(*) FROM comparisons").fetchone()[0],
                "Full native row counts disagree")
        total_count = 0
        for total_count,row in enumerate(records(root/"migration/totals.jsonl"),1):
            require(row["total_id"]==total_count,"Total IDs changed")
            indexed = db.execute("SELECT payload FROM totals WHERE total_id=?",(total_count,)).fetchone()
            require(indexed is not None and json.loads(indexed[0])==row,
                    "The full exact total differs from its native index")
        require(total_count==result["totals"]["count"]==
                db.execute("SELECT COUNT(*) FROM totals").fetchone()[0],"Complete total count differs")
    for table,ordinals in seen.items():
        require(ordinals==set(range(1,table_rows[table]+1)),
                "An original selected population row disappeared: "+table)
    for pair in result["pairs"]:
        require("rows" not in pair and isinstance(pair["totals"],dict),
                "The summary must retain bounded descriptors instead of full populations")
        require(sum(pair["summary"]["status_counts"].values())==pair["summary"]["comparison_records"],
                "Pair comparison counts differ")
    return {
        "case":str(root),"source_run_identity":report["run_identity"],
        "result":identity(root/"migration/result.json"),
        "report":identity(root/"report.json"),"comparison_records":n,"total_records":total_count,
        "status_counts":dict(status),"crosswalk_issue_refs":[list(x) for x in sorted(map_refs)],
        "source_rows":table_rows,"combined_rows":sum(table_rows.values()),
        "rows":identity(root/"migration/rows.jsonl"),
        "totals":identity(root/"migration/totals.jsonl"),
        "html":identity(root/"migration/report.html"),
    }

def assert_edition(case,edition,observed):
    statuses = observed["status_counts"]
    require(observed["combined_rows"]=={"a":66,"b":68,"c":66}[edition],
            "Complete demonstration source membership changed")
    if edition in ("a","b"):
        require(statuses.get("AMBIGUOUS_KEY",0)>0 and statuses.get("AMBIGUOUS_CROSSWALK",0)>0,
                "The retained duplicate/mapping ambiguities must stay unresolved")
        require(any(t=="account_crosswalk" for t,_ in observed["crosswalk_issue_refs"]),
                "Ambiguous original crosswalk rows must be individually traceable")
    if edition=="a":
        require(selected_row(case,"customers","NC300")["classification"]=="SOURCE_ONLY",
                "The absent migrated customer must remain explicit")
        require(selected_row(case,"reads","R002")["classification"]=="SOURCE_ONLY",
                "The missing read must remain explicit")
        require(selected_row(case,"reads","R003")["classification"]=="INVALID_TARGET_ROW",
                "The rejected target quantity must remain uncomputed")
        _,payment = selected_field(case,"payments","Y002","signed_amount")
        require(exact(payment["source_exact"])==-60 and exact(payment["target_exact"])==60 and
                exact(payment["difference"])==120 and payment["status"]=="DIFFERENCE",
                "The original negative-credit sign error must stay visible")
        total = selected_total(case,"reads","quantity",["M002","2025-12-31","m3"])
        require(total["status"]=="UNCOMPUTED" and total["difference"] is None and
                total["target"]["uncomputed_rows"]==1,
                "Incomplete population totals must not become complete zero")
        fks = read_json(case/"report.json")["foreign_keys"]
        require(any(f["table"]=="target_accounts" and f["unmatched_child_rows"]>0 for f in fks),
                "The original missing migrated parent must remain a source-quality finding")
    else:
        require(selected_row(case,"customers","NC300")["classification"]=="MATCHED" and
                selected_row(case,"reads","R002")["classification"]=="MATCHED" and
                selected_row(case,"reads","R003")["classification"]=="MATCHED",
                "Later complete source corrections were not adopted")
        _,payment = selected_field(case,"payments","Y002","signed_amount")
        require(exact(payment["source_exact"])==-60 and exact(payment["target_exact"])==-60 and
                exact(payment["difference"])==0,"Credit sign correction differs")
    if edition=="c":
        require(set(statuses)=={"MATCHED"} and read_json(case/"report.json")["quality_status"]=="PASS",
                "The final source must close the authored identity and source-quality issues")
        for pair,field,expected in (
            ("reads","quantity",Fraction(430)),("tariffs","rate",Fraction(4)),
            ("bills","water_charge",Fraction(683,4)),
            ("payments","signed_amount",Fraction(-683,4)),
            ("allocations","applied_amount",Fraction(603,4)),
            ("balances","balance",Fraction(0)),
        ):
            left,right,count = Fraction(0),Fraction(0),0
            for total in records(case/"migration/totals.jsonl"):
                if total["pair"]!=pair or total["field"]!=field:
                    continue
                require(total["status"]=="COMPUTED" and exact(total["difference"])==0,
                        "A full-context exact total differs: "+pair)
                left += exact(total["source"]["sum"])
                right += exact(total["target"]["sum"])
                count += 1
            require(count>0 and left==right==expected,
                    "Complete sum of original context totals differs: "+pair)
        _,credit = selected_field(case,"balances","NA200","balance")
        require(exact(credit["source_exact"])==-20 and exact(credit["target_exact"])==-20,
                "A genuine credit balance must survive without absolute-value conversion")

def command(args,root,state,label):
    args = list(map(str,args))
    index = len(state["commands"])+1
    out = root/"logs"/("%02d-%s.stdout"%(index,label))
    err = root/"logs"/("%02d-%s.stderr"%(index,label))
    item = {"label":label,"argv":args,"stdout":str(out),"stderr":str(err),"status":"STARTING"}
    state["commands"].append(item)
    atomic(root/"receiving-progress.json",state)
    with out.open("xb") as stdout,err.open("xb") as stderr:
        child = subprocess.Popen(args,stdout=stdout,stderr=stderr,stdin=subprocess.DEVNULL,
                                 env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"})
        item["pid"] = child.pid
        item["status"] = "RUNNING"
        atomic(root/"receiving-progress.json",state)
        item["exit_code"] = child.wait()
    item["status"] = "COMPLETE" if item["exit_code"]==0 else "RETURNED"
    item["stdout_identity"],item["stderr_identity"] = identity(out),identity(err)
    atomic(root/"receiving-progress.json",state)
    require(item["exit_code"]==0,"Original command returned: "+label+
            "; receive its complete retained stdout/stderr")
    return item

def fetch(origin,path,destination=None):
    request = Request(origin+path,headers={"Accept":"application/json"})
    with urlopen(request,timeout=30) as response:
        if destination is None:
            return json.load(response)
        destination = Path(destination)
        with destination.open("xb") as output:
            while True:
                block = response.read(1024*1024)
                if not block:
                    break
                output.write(block)
    return identity(destination)

def receive_server(root,case,archive,server_source,state,keep=False,label="current"):
    receipt = root/("server-"+label+".json")
    stdout = root/"logs"/("server-"+label+".stdout")
    stderr = root/"logs"/("server-"+label+".stderr")
    args = list(map(str,[sys.executable,server_source,"--case",case,"--archive",archive,
                        "--receipt",receipt,"--port","0"]))
    child = None
    with stdout.open("xb") as out,stderr.open("xb") as err:
        child = subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=out,stderr=err,
                                 env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"})
    runtime = {"argv":args,"pid":child.pid,"receipt":str(receipt),"stdout":str(stdout),
               "stderr":str(stderr),"status":"STARTING","kept_for_browser":False}
    state["servers"].append(runtime)
    atomic(root/"receiving-progress.json",state)
    succeeded = False
    try:
        deadline = time.monotonic()+60
        while not receipt.exists():
            require(child.poll() is None,"Original server returned before its atomic receipt")
            require(time.monotonic()<deadline,"Original server has not returned its receipt")
            time.sleep(0.1)
        saved = read_json(receipt)
        require(saved["schema"]=="tjlabs.migration-reconciliation.server.v1" and
                saved["case"]==str(case) and saved["pid"]==child.pid and saved["read_only"] is True,
                "Actual server receipt differs from its selected case")
        require(saved["archive"]["sha256"]==file_digest(archive),"Server selected another archive")
        origin = saved["origin"]
        require(origin.startswith("http://127.0.0.1:") and origin.endswith("/"),
                "Expected original tokenized loopback origin")
        summary = fetch(origin,"api/summary")
        require(summary==read_json(case/"migration/result.json"),"HTTP summary differs from native result")
        require(fetch(origin,"api/capabilities")["archive_available"] is True,"Full archive unavailable")
        for kind,key in (("rows","row_id"),("totals","total_id")):
            index = 0
            for local in records(case/"migration"/(kind+".jsonl")):
                if index % 7==0:
                    page = fetch(origin,"api/"+kind+"?"+urlencode({"offset":index,"limit":7}))
                    require(page["total"]==summary[kind]["count"],"Paged total differs")
                require(page["rows"][index%7]==local,"Actual indexed page differs from the full original population")
                if index==0:
                    one = fetch(origin,"api/"+("row" if kind=="rows" else "total")+"?id="+str(local[key]))
                    require(one==local,"Full native record selection differs")
                index += 1
            require(index==summary[kind]["count"],"HTTP receiving omitted records")
        original = fetch(origin,"api/source?"+urlencode({"table":"source_customers","record":3}))
        require(original["values"][1]=='Field "Demo"\nAccount',"Original quoted multiline CSV value differs")
        require(original["source"]["sha256"]==
                next(x["sha256"] for x in summary["source_inputs"] if x["table"]=="source_customers"),
                "Original source hash did not survive HTTP receiving")
        filtered = root/("http-"+label+"-payments.jsonl")
        fetch(origin,"download/rows.jsonl?"+urlencode({"pair":"payments"}),filtered)
        with filtered.open(encoding="utf-8") as received:
            selected = (r for r in records(case/"migration/rows.jsonl") if r["pair"]=="payments")
            count = 0
            for count,expected in enumerate(selected,1):
                require(json.loads(next(received))==expected,"Filtered export differs")
            require(not received.read(),"Filtered export contains an extra row")
            require(count==3,"A complete payment export was expected")
        filtered_totals = root/("http-"+label+"-totals.jsonl")
        fetch(origin,"download/totals.jsonl?"+urlencode({"pair":"payments","field":"signed_amount"}),filtered_totals)
        require(list(records(filtered_totals))==
                [r for r in records(case/"migration/totals.jsonl")
                 if r["pair"]=="payments" and r["field"]=="signed_amount"],
                "Filtered complete grouped total export differs")
        downloads = []
        for name,path in (("rows.jsonl",case/"migration/rows.jsonl"),
                          ("totals.jsonl",case/"migration/totals.jsonl"),
                          ("result.json",case/"migration/result.json"),
                          ("source-report.json",case/"report.json"),
                          ("manifest.original.json",case/"manifest.original.json"),
                          ("case.zip",archive)):
            received = fetch(origin,"download/"+name,root/("http-"+label+"-"+name))
            require(received["bytes"]==path.stat().st_size and received["sha256"]==file_digest(path),
                    "Actual complete download changed: "+name)
            downloads.append(received)
        runtime.update({"status":"RECEIVED","origin":origin,"source_run_identity":saved["source_run_identity"],
                        "downloads":downloads,"receipt_identity":identity(receipt)})
        succeeded = True
        return runtime
    finally:
        if child.poll() is None and not(succeeded and keep):
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=10)
        runtime["kept_for_browser"] = bool(succeeded and keep and child.poll() is None)
        runtime["exit_code"] = child.poll()
        runtime["stdout_identity"],runtime["stderr_identity"] = identity(stdout),identity(stderr)
        atomic(root/"receiving-progress.json",state)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,help="New private operation directory")
    parser.add_argument("--keep-server",action="store_true",
                        help="Keep only the fully received current server for the original browser course")
    args = parser.parse_args(argv)
    root = Path(args.directory).resolve()
    here = Path(__file__).resolve().parent
    require(not root.exists(),"Choose a new operation directory; preserve every earlier attempt")
    require(not root.is_relative_to(here),"Receiving outputs must be outside the installed source")
    root.mkdir(parents=True,mode=0o700)
    (root/"logs").mkdir()
    state = {"schema":"tjlabs.migration-reconciliation.receiving.v1","operation_id":OPERATION,
             "status":"RUNNING","directory":str(root),"source":str(here),
             "commands":[],"editions":[],"servers":[],
             "meaning":"Complete invented three-edition functional receiving; no customer or scale result."}
    try:
        originals = []
        for path in sorted(here.rglob("*")):
            if path.is_file() and not path.is_symlink() and "__pycache__" not in path.parts:
                originals.append({"path":path.relative_to(here).as_posix(),
                                  "bytes":path.stat().st_size,"sha256":file_digest(path)})
        atomic(root/"source-selection.json",{"schema":"tjlabs.migration-reconciliation.receiving-source.v1",
                                           "files":originals})
        archives = []
        for edition in ("a","b","c"):
            case = root/("edition-"+edition)
            example = here/"examples"/edition
            command([sys.executable,here/"migration_reconciliation.py","run",
                     "--manifest",example/"manifest.json","--selection",example/"selection.json",
                     "--output",case],root,state,"run-"+edition)
            observed = inspect_case(case)
            assert_edition(case,edition,observed)
            archive = root/("Migration_Edition_"+edition.upper()+".zip")
            command([sys.executable,here/"migration_reconciliation.py","pack",
                     "--run",case,"--output",archive],root,state,"pack-"+edition)
            observed["archive"] = identity(archive)
            archives.append(observed["archive"])
            state["editions"].append({"edition":edition,**observed})
            for prior in archives:
                require(identity(prior["path"])==prior,"A previous full edition archive changed")
            atomic(root/"receiving-progress.json",state)
        for left,right in (("a","b"),("b","c")):
            a,b = root/("edition-"+left),root/("edition-"+right)
            comparison = compare_reports(read_json(a/"report.json"),read_json(b/"report.json"),a,b)
            atomic(root/("source-comparison-"+left+"-"+right+".json"),comparison)
        final = root/"edition-c"
        archive = Path(archives[-1]["path"])
        received = root/"received-final"
        command([sys.executable,here/"migration_reconciliation.py","receive",
                 "--archive",archive,"--output",received],root,state,"receive-final")
        received_observation = inspect_case(received)
        require(received_observation["source_run_identity"]==state["editions"][-1]["source_run_identity"],
                "Original received case identity changed")
        cold = root/"cold-rerun"
        command([sys.executable,received/"workbench/migration_reconciliation.py","run",
                 "--manifest",received/"manifest.receiving.json",
                 "--selection",received/"migration/selection.original.json",
                 "--input-root",received,"--output",cold],root,state,"cold-original-source-rerun")
        cold_observation = inspect_case(cold)
        assert_edition(cold,"c",cold_observation)
        for name in ("rows.jsonl","rows.csv","totals.jsonl","totals.csv","selection.original.json"):
            require(file_digest(final/"migration"/name)==file_digest(cold/"migration"/name),
                    "Cold received original source changed semantic output: "+name)
        first_inputs = read_json(final/"report.json")["lineage"]["inputs"]
        cold_inputs = read_json(cold/"report.json")["lineage"]["inputs"]
        require([(x["table"],x["bytes"],x["sha256"]) for x in first_inputs]==
                [(x["table"],x["bytes"],x["sha256"]) for x in cold_inputs],
                "Cold source population differs")
        cold_archive = root/"Migration_Cold_Original_Source.zip"
        command([sys.executable,received/"workbench/migration_reconciliation.py","pack",
                 "--run",cold,"--output",cold_archive],root,state,"pack-cold")
        cold_observation["archive"] = identity(cold_archive)
        state["received"] = received_observation
        state["cold_rerun"] = cold_observation
        receive_server(root,received,archive,received/"workbench/migration_server.py",state,label="received")
        receive_server(root,final,archive,here/"migration_server.py",state,
                       keep=args.keep_server,label="current")
        for prior in archives:
            require(identity(prior["path"])==prior,"Receiving changed a retained earlier archive")
        for selected in originals:
            path = here/selected["path"]
            require(path.stat().st_size==selected["bytes"] and file_digest(path)==selected["sha256"],
                    "Selected application/example source changed during receiving")
        state["status"] = "COMPLETE"
        state["visual_receiving"] = {
            "status":"PENDING_OPERATOR_BROWSER_AND_VIEWING",
            "instruction":"Use the maintained browser helper on these exact cases and original server receipt; open and inspect the desktop/narrow screenshots, full reports, source exports and every outgoing archive. Captured images alone are not a visual pass."}
        atomic(root/"receiving.json",state)
        print(json.dumps({"status":"COMPLETE","receiving":identity(root/"receiving.json"),
                          "editions":len(state["editions"]),
                          "server":next((s["origin"] for s in state["servers"] if s["kept_for_browser"]),None)}))
        return 0
    except BaseException as error:
        state.update({"status":"RETURNED","error":{"type":type(error).__name__,"message":str(error)}})
        atomic(root/"receiving-error.json",state)
        (root/"receiving-error.txt").write_text(traceback.format_exc(),encoding="utf-8")
        print(json.dumps({"status":"RETURNED","error":state["error"],"directory":str(root)}))
        return 1

if __name__=="__main__":
    raise SystemExit(main())
