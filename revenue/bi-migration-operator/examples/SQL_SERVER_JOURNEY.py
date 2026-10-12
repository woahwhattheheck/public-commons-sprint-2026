#!/usr/bin/env python3
"""One restartable, complete SQL/BI published-data operation; no database connection."""
from __future__ import annotations
import argparse
import base64
import contextlib
import csv
import hashlib
import gzip
import io
import json
import math
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bi_operator.service import Service
from bi_operator import archive
from bi_operator.store import atomic_write, digest, encoded, now
from bi_operator.example import example_bytes, EXAMPLE, load_example
from bi_operator.sql_server import worker, record_ref
from bi_operator.compare import read_csv, csv_bytes, compare_outputs

def save(path, value):
    atomic_write(path, encoded(value).encode() + b"\n")

def fixture():
    source = example_bytes(EXAMPLE / "data/OffenseCells.csv")
    info = json.loads((EXAMPLE / "SOURCE.json").read_text())
    expected = next(x for x in info["datasets"] if x["table"] == "OffenseCells")
    assert digest(source) == expected["sha256"], "Original complete public source differs"
    headers, original_rows = read_csv(source)
    model = json.loads((EXAMPLE / "reviewed-project.json").read_text())
    table = next(t for t in model["tables"] if t["name"] == "OffenseCells")
    model_by_source = {c["source_column"]:c for c in table["columns"]}
    extras = {"sql_exact_decimal":"123456789012345678901234567890.12345678",
              "sql_exact_bigint":"9223372036854775807",
              "sql_exact_timestamp":"2026-10-12T00:00:00.1234567",
              "sql_exact_binary":{"base64":"AAFDb21tb25z/w=="}}
    rows = []
    for row in original_rows:
        native = {}
        for name in headers:
            value = row[name]
            kind = model_by_source.get(name, {}).get("data_type", "string")
            native[name] = None if value == "\\N" else ("1" if value == "true" else "0") if kind == "boolean" else value
        rows.append({**native, **extras})
    rows.sort(key=lambda r:r["source_record_id"])
    assert len({r["source_record_id"] for r in rows}) == len(rows) == 5037
    columns, catalog = [], []
    for index, name in enumerate([*headers,*extras]):
        kind = model_by_source.get(name, {}).get("data_type", "string")
        native_type = "bigint" if kind == "int64" else "bit" if kind == "boolean" else "nvarchar(max)"
        precision, scale, width, encoding = (19,0,8,"numeric") if kind == "int64" else (1,0,1,"numeric") if kind == "boolean" else (0,0,-1,"text")
        if name == "sql_exact_decimal":
            native_type,precision,scale,width,encoding = "decimal(38,8)",38,8,17,"numeric"
        elif name == "sql_exact_bigint":
            native_type,precision,scale,width,encoding = "bigint",19,0,8,"numeric"
        elif name == "sql_exact_timestamp":
            native_type,precision,scale,width,encoding = "datetime2(7)",27,7,8,"temporal"
        elif name == "sql_exact_binary":
            native_type,precision,scale,width,encoding = "varbinary(32)",0,0,32,"binary"
        nullable = any(row[name] is None for row in rows)
        collation = "Latin1_General_100_BIN2" if native_type.startswith("nvarchar") else None
        columns.append({"name":name,"type":native_type,"nullable":nullable,"precision":precision,"scale":scale,
                        "maxLength":width,"collation":collation,"encoding":encoding})
        catalog.append({"name":name,"position":index+1,"dataType":native_type.split("(")[0],"baseType":native_type.split("(")[0],
            "columnType":native_type,"nullable":"YES" if nullable else "NO","keyKind":"PRI" if name=="source_record_id" else "",
            "collation":collation,"numericPrecision":precision,"numericScale":scale,"maxLength":width,
            "schemaName":"public_example","tableName":"OffenseCells"})
    largest = max(len(json.dumps(row,ensure_ascii=False,separators=(",",":")).encode()) for row in rows)
    page_rows = min(1000, max(1, (917504 - len(encoded(columns).encode()) - 5000) // (largest + 1)))
    return {"schema":"commons-bi-sql-protocol-example/1",
        "origin":"Actual bundled public aggregate rows with four separately identified native-type Practice fields",
        "source":{"file":"data/OffenseCells.csv","sha256":digest(source),"rows":5037,"url":info["url"]},
        "practice_fields":list(extras),"rows":rows,"column_types":columns,"page_rows":page_rows,
        "catalog":{"schema":"stellar-forge.mssql-catalog.v1","serverVersion":"explicit-protocol-example",
            "table":"[public_example].[OffenseCells]","schemaName":"public_example","tableName":"OffenseCells",
            "columns":catalog,"truncated":False}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    parser.add_argument("--node", default=os.environ.get("BI_SQL_NODE") or shutil.which("node"))
    args = parser.parse_args()
    if not args.node:
        raise ValueError("Use the existing Node22.16+ executable.")
    root = Path(args.operation).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with worker().operation_lock(root):
        journal_path = root / "JOURNEY.json"
        state = json.loads(journal_path.read_text()) if journal_path.exists() else {
            "schema":"commons-bi-sql-complete-journey/1","operation_id":"sqljourney-"+secrets.token_hex(10),
            "phase":0,"records":{},"events":[],"started_at":now()}
        if state.get("status") == "complete":
            print((root / "RESULT.json").read_text())
            return
        def checkpoint(phase, note):
            state["phase"]=phase
            state["events"].append({"at":now(),"phase":phase,"event":note})
            save(journal_path,state)
        def call(service, name, step, request):
            if step in state["records"]:
                r=state["records"][step]
                return service.store.get(r["kind"],r["id"],r["revision"])
            operation_id=state["operation_id"]+"-"+step
            row=service.store.db.execute("SELECT state,result FROM operations WHERE id=?", (operation_id,)).fetchone()
            if row and row["state"]=="complete":
                result=json.loads(row["result"])
            else:
                # A prior explicit local validation failure stays in the journal.
                # It can be corrected on a later invocation without replaying any native job.
                suffix=0
                while row and row["state"]=="failed":
                    suffix+=1
                    operation_id=state["operation_id"]+"-"+step+"-correction-"+str(suffix)
                    row=service.store.db.execute("SELECT state,result FROM operations WHERE id=?", (operation_id,)).fetchone()
                result=(json.loads(row["result"]) if row and row["state"]=="complete" else
                        service.dispatch(name,{**request,"operation_id":operation_id,"actor":"SQL published-data operator"})["record"])
            state["records"][step]=record_ref(result)
            save(journal_path,state)
            return result
        data=fixture()
        fixture_path=root/"protocol-source.json.gz"
        original_fixture=encoded(data).encode()+b"\n"
        if fixture_path.exists():
            assert gzip.decompress(fixture_path.read_bytes())==original_fixture
        else: atomic_write(fixture_path,gzip.compress(original_fixture,compresslevel=6,mtime=0))
        service=Service(root/"workspace")
        receiver=None
        try:
            if state["phase"] < 1:
                original=load_example(service,False)
                state["example"]=original
                profile=call(service,"sql.profile.save","profile",{
                    "label":"Published aggregate SQL protocol exercise",
                    "origin":"protocol-example",
                    "connection":{"host":"127.0.0.1","port":1433,"database":"Published_Example","user":"practice_reader",
                                  "passwordEnv":"PRACTICE_SQL_PASSWORD_NOT_USED","tls":"local-plaintext"},
                    "description":"One explicit local protocol carrier. No SQL Server or customer database connection."})
                state["profile"]=record_ref(profile)
                checkpoint(1,"Original public source and private profile retained")
            profile=service.store.get("sql_profile",state["profile"]["id"],state["profile"]["revision"])
            def receive_native(job, step, *, mode="execute", loss=False, cancel=None):
                latest=service.store.get("sql_job",job["id"])
                target=service.sql._materialize(latest)
                operation=target/"operation"
                before={}
                if (operation/"state.json").exists():
                    before=json.loads((operation/"state.json").read_text())
                command=[args.node,str(ROOT/"examples/SQL_CAPTURE_PRACTICE.mjs"),"--job="+str(target/"job.json"),
                    "--operation="+str(operation),"--fixture="+str(fixture_path),"--mode="+mode,
                    "--loss="+str(loss).lower()]
                if cancel is not None:command.append("--cancel="+str(cancel))
                receipt_file=root/(step+"-controller.json")
                if not receipt_file.exists():
                    save(root/(step+"-intent.json"),{"job_id":job["id"],"mode":mode,"at":now(),
                        "before_generation":before.get("generation",0),"origin":"protocol-example"})
                    with (root/(step+"-native.log")).open("ab") as output:
                        completed=subprocess.run(command,stdout=output,stderr=subprocess.STDOUT,check=False)
                    if completed.returncode:
                        raise ValueError("The original local protocol process ended; read "+str(root/(step+"-native.log")))
                    save(receipt_file,{"job_id":job["id"],"mode":mode,"exit_code":completed.returncode,"at":now()})
                native, result, _=worker().package_result(target/"job.json",operation)
                atomic_write(operation/"result.bundle.zip",native)
                returned=call(service,"sql.result.import",step,{"id":job["id"],"base64":base64.b64encode(native).decode()})
                return service.store.get("sql_job",returned["id"]),result,operation
            if state["phase"] < 2:
                catalog=call(service,"sql.job.prepare","catalog-job",{
                    "profile_id":profile["id"],"action":"catalog","table":"[public_example].[OffenseCells]","start":False})
                catalog,result,_=receive_native(catalog,"catalog-result")
                assert result["complete"]
                query=call(service,"sql.query.from_table","query",{
                    "catalog_job_id":catalog["id"],"label":"All5037 published offense cells and explicit native-type cases",
                    "columns":[{"source":c["name"],"alias":c["name"]} for c in data["catalog"]["columns"]],
                    "key_columns":["source_record_id"],"page_rows":data["page_rows"],"filters":[]})
                state["query"]=record_ref(query)
                preflight=call(service,"sql.job.prepare","preflight-job",{"query_id":query["id"],"action":"preflight"})
                preflight,result,_=receive_native(preflight,"preflight-result")
                query=call(service,"sql.query.review","review",{"id":query["id"],"expected":query["revision"],
                    "preflight_job_id":preflight["id"],
                    "note":"Exact original public source IDs form a complete unique nonnull key. Types and byte/page limits retained; protocol carrier explicitly identified."})
                state["query"]=record_ref(query)
                capture=call(service,"sql.job.prepare","capture-job",{"query_id":query["id"],"action":"capture",
                    "label":"Full original5037-row capture","start":False})
                state["capture_job"]=record_ref(capture)
                checkpoint(2,"Native catalog, source-generated keyset and exact schema review complete")
            capture=service.store.get("sql_job",state["capture_job"]["id"])
            if state["phase"] < 3:
                capture,result,operation=receive_native(capture,"lost-response",loss=True)
                assert result["status"]=="failed" and result["rows"]==2*data["page_rows"]
                native_state=json.loads((operation/"state.json").read_text())
                assert native_state["pending"] is not None
                assert not service.store.get("sql_capture",capture["payload"]["capture_id"])["payload"]["complete"]
                assert capture["payload"]["dataset_id"] is None
                service.sql.prepare_backup()
                checkpoint(3,"Original third response deliberately lost; committed pages and pending cursor checkpointed")
            if state["phase"] < 4:
                service.close()
                service=Service(root/"workspace")
                capture=service.store.get("sql_job",state["capture_job"]["id"])
                capture,result,operation=receive_native(capture,"operator-canceled",mode="continue",cancel=4)
                assert result["status"]=="canceled" and result["rows"]==4*data["page_rows"]
                checkpoint(4,"Same original job reopened and canceled after four committed pages")
            if state["phase"] < 5:
                capture=service.store.get("sql_job",state["capture_job"]["id"])
                capture,result,operation=receive_native(capture,"completed-capture",mode="continue")
                assert result["complete"] and result["rows"]==5037
                request_log=operation/"protocol-requests.jsonl"
                before=request_log.read_bytes()
                target=operation.parent
                completed=subprocess.run([args.node,str(ROOT/"examples/SQL_CAPTURE_PRACTICE.mjs"),"--job="+str(target/"job.json"),
                    "--operation="+str(operation),"--fixture="+str(fixture_path),"--mode=continue","--loss=false"],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
                assert request_log.read_bytes()==before, "Completed replay issued another native read"
                state["native_result"]={"job_id":capture["id"],"pages":result["pages"],"rows":result["rows"],
                    "query_calls":sum(json.loads(line).get("operation")=="query" for line in before.decode().splitlines()),
                    "complete_replay_added_queries":0,"original_result_sha256":capture["payload"]["result_bundle"]["digest"]}
                state["dataset_id"]=capture["payload"]["dataset_id"]
                state["capture_id"]=capture["payload"]["capture_id"]
                checkpoint(5,"Complete original page collection accepted; completed replay issued zero reads")
            capture_data=service.store.get("dataset",state["dataset_id"])
            if state["phase"] < 6:
                original=service.store.get("dataset",state["example"]["datasets"]["OffenseCells"]["id"])
                model=json.loads((EXAMPLE/"reviewed-project.json").read_text())
                table=next(t for t in model["tables"] if t["name"]=="OffenseCells")
                fields=[{"left":c["source_column"],"right":c["source_column"],
                         "type":"boolean" if c["data_type"]=="boolean" else "number" if c["data_type"]=="int64" else "text",
                         "absolute":"0","relative":"0"} for c in table["columns"]]
                clean=call(service,"comparison.run","original-comparison",{
                    "label":"All original public rows against complete received SQL contract",
                    "left":record_ref(original),"right":record_ref(capture_data),"spec":{"keys":["source_record_id"],"fields":fields}})
                assert clean["payload"]["result"]["status"]=="PASS"
                headers,rows=read_csv(service.store.bytes(capture_data["payload"]["file"]["digest"]))
                index=next(i for i,row in enumerate(rows,1) if row["value"]!=capture_data["payload"]["null_token"])
                old=rows[index-1]["value"];changed=str(int(old)+1)
                incorrect=call(service,"dataset.correct","one-change",{"id":capture_data["id"],"revision":capture_data["revision"],
                    "changes":[{"row":index,"column":"value","expected":old,"value":changed}],
                    "note":"Explicit one-cell Practice variance; original source remains unchanged."})
                different=call(service,"comparison.run","changed-comparison",{
                    "left":record_ref(original),"right":record_ref(incorrect),"spec":{"keys":["source_record_id"],"fields":fields}})
                assert different["payload"]["result"]["status"]=="DIFFERENT" and different["payload"]["result"]["counts"]["different_cells"]==1
                corrected=call(service,"dataset.correct","corrected-data",{"id":incorrect["id"],"revision":incorrect["revision"],
                    "changes":[{"row":index,"column":"value","expected":changed,"value":old}],
                    "note":"Correct the retained Practice variance to the exact original published value."})
                fixed=call(service,"comparison.run","corrected-comparison",{
                    "left":record_ref(original),"right":record_ref(corrected),"spec":{"keys":["source_record_id"],"fields":fields},
                    "previous_id":different["id"]})
                assert fixed["payload"]["result"]["status"]=="PASS"
                # These native-type cases are explicitly separate from published agency fields.
                case_fields=[{"left":"sql_exact_decimal","right":"sql_exact_decimal","type":"number"},
                    {"left":"sql_exact_bigint","right":"sql_exact_bigint","type":"number"},
                    {"left":"sql_exact_timestamp","right":"sql_exact_timestamp","type":"date"},
                    {"left":"sql_exact_binary","right":"sql_exact_binary","type":"text"},
                    {"left":"source_record_id","right":"source_record_id","type":"text"}]
                modified=[dict(r) for r in rows]
                modified[0]["sql_exact_decimal"]="123456789012345678901234567890.12345679"
                modified[0]["sql_exact_timestamp"]="2026-10-12T00:00:00.1234568"
                precision=compare_outputs(csv_bytes(headers,rows),csv_bytes(headers,modified),
                    {"keys":["source_record_id"],"fields":case_fields,"null_token":capture_data["payload"]["null_token"]})
                assert precision["counts"]["different_cells"]==2, "Native decimal/timestamp precision was rounded"
                plan=service.store.get("plan",state["example"]["plan"]["id"])
                mapping=call(service,"sql.mapping.save","model-mapping",{
                    "capture_id":state["capture_id"],"plan_id":plan["id"],"plan_revision":plan["revision"],"table":"OffenseCells",
                    "fields":[{"target":c["name"],"source":c["source_column"]} for c in table["columns"]],
                    "review_note":"Map every original model field; preserve exact SQL text/NULLs, and convert only Boolean text losslessly."})
                mapped=call(service,"sql.mapping.apply","apply-mapping",{"id":mapping["id"]})
                native=call(service,"artifact.build","native-model",{"plan_id":mapped["id"],"plan_revision":mapped["revision"]})
                state["mapping"]=record_ref(mapping)
                state["mapped_plan"]=record_ref(mapped)
                state["artifact"]=record_ref(native)
                state["comparisons"]={"initial":clean["payload"]["result"]["status"],"changed":different["payload"]["result"]["counts"],
                    "corrected":fixed["payload"]["result"]["status"],"native_precision_changes_detected":2}
                checkpoint(6,"Complete source comparison, linked correction, exact precision and native model mapping/build complete")
            if state["phase"] < 7:
                delivery=call(service,"sql.handoff","workstream",{"label":"Original complete SQL/BI implementation workstream",
                    "notes":"Published source; explicit local protocol/native-type exercise; no customer database execution."})
                state["delivery"]=record_ref(delivery)
                receiver=Service(root/"receiver")
                data_bytes=service.store.bytes(delivery["payload"]["package"]["digest"])
                preview=call(receiver,"sql.receive.preview","receive-preview",{"base64":base64.b64encode(data_bytes).decode()})
                accepted=call(receiver,"sql.receive.apply","receive-adopt",{"id":preview["id"],"expected":preview["revision"],
                    "plan_sha256":preview["payload"]["plan"]["sha256"],"choice":"preserve","reason":"Original complete receiving operation."})
                replay=receiver.dispatch("sql.receive.preview",{"operation_id":state["operation_id"]+"-receive-replay",
                    "base64":base64.b64encode(data_bytes).decode()})["record"]
                assert replay["id"]==accepted["id"] and replay["revision"]==accepted["revision"]
                assert receiver.store.get("dataset",state["dataset_id"])["payload"]["file"]["digest"]==capture_data["payload"]["file"]["digest"]
                assert receiver.store.get("sql_job",state["capture_job"]["id"])["payload"]["document"]==service.store.get("sql_job",state["capture_job"]["id"])["payload"]["document"]
                state["receiving"]={"first_receipt":accepted["id"],"records":accepted["payload"]["records"],"revisions":accepted["payload"]["revisions"],
                    "replay_same_receipt":True,"database_calls":0}
                checkpoint(7,"Full second-workspace receiving and exact same-bundle replay complete")
            if receiver is None:receiver=Service(root/"receiver")
            if state["phase"] < 8:
                base_profile=service.store.get("sql_profile",state["profile"]["id"])
                incoming=call(service,"sql.profile.save","source-edit",{"id":base_profile["id"],"expected":base_profile["revision"],
                    "label":base_profile["payload"]["label"],"connection":base_profile["payload"]["connection"],
                    "description":"Original source operator's later reviewed connection notes."})
                receiver_profile=receiver.store.get("sql_profile",state["profile"]["id"])
                local=call(receiver,"sql.profile.save","receiver-edit",{"id":receiver_profile["id"],"expected":receiver_profile["revision"],
                    "label":receiver_profile["payload"]["label"],"connection":receiver_profile["payload"]["connection"],
                    "description":"Receiving operator's independent connection notes."})
                later=call(service,"sql.handoff","changed-workstream",{"label":"Changed original source workstream"})
                bytes_in=service.store.bytes(later["payload"]["package"]["digest"])
                preview=call(receiver,"sql.receive.preview","conflict-preview",{"base64":base64.b64encode(bytes_in).decode()})
                assert preview["payload"]["plan"]["conflicts"]>=1
                accepted=call(receiver,"sql.receive.apply","keep-both",{"id":preview["id"],"expected":preview["revision"],
                    "plan_sha256":preview["payload"]["plan"]["sha256"],"choice":"keep_both",
                    "reason":"Both operators changed the same original profile; retain each complete branch and source identity."})
                assert receiver.store.get("sql_profile",local["id"])["payload"]["description"]==local["payload"]["description"]
                new_profile=next(x["local_id"] for x in accepted["payload"]["id_mapping"] if x["kind"]=="sql_profile" and x["original_id"]==local["id"])
                assert receiver.store.get("sql_profile",new_profile)["payload"]["description"]==incoming["payload"]["description"]
                second=call(receiver,"sql.handoff","received-branch-handoff",{"label":"Both retained original receiving branches"})
                state["receiving"].update(conflicts=preview["payload"]["plan"]["conflicts"],retained_both=True,
                    received_branch_package=second["payload"]["package"]["digest"])
                checkpoint(8,"Conflicting source change preserved both complete branches and re-exported intact")
            if state["phase"] < 9:
                receiver.sql.prepare_backup()
                backup_path=root/"complete-original-workspace.bi-backup"
                key_path=root/"recovery-passphrase.txt"
                if not key_path.exists():atomic_write(key_path,(secrets.token_urlsafe(32)+"\n").encode())
                password=key_path.read_text().strip()
                before_workspace=receiver.store.setting("workspace_id")
                before_token=receiver.store.setting("access_token")
                identities=[(r["kind"],r["id"],r["revision"],digest(encoded(r["payload"]).encode()))
                    for kind in ("source","plan","dataset","sql_profile","sql_query","sql_job","sql_capture","sql_mapping","sql_receipt")
                    for r in receiver.store.list(kind)]
                if not backup_path.exists():
                    archive.backup(receiver.store,backup_path,password)
                receiver.close();receiver=None
                restored=root/"restored"
                if not restored.exists():archive.restore(backup_path,restored,password)
                restored_service=Service(restored)
                try:
                    assert restored_service.store.setting("workspace_id")==before_workspace
                    assert restored_service.store.setting("access_token")!=before_token
                    for kind,ident,revision,sha in identities:
                        record=restored_service.store.get(kind,ident)
                        assert record["revision"]==revision and digest(encoded(record["payload"]).encode())==sha
                    assert restored_service.sql.runtime()["active_local_children"]==0
                finally:restored_service.close()
                state["recovery"]={"records_verified":len(identities),"original_ids_preserved":True,"browser_key_rotated":True,
                    "database_calls":0,"backup_sha256":digest(backup_path.read_bytes())}
                checkpoint(9,"Encrypted cold restoration preserved all original IDs, record bytes and completed jobs")
            result={"schema":"commons-bi-sql-complete-journey-result/1","operation_id":state["operation_id"],"status":"PASS",
                "completed_at":now(),"source":data["source"],"practice_fields":data["practice_fields"],
                "native":state["native_result"],"comparisons":state["comparisons"],"receiving":state["receiving"],
                "recovery":state["recovery"],"sql_server_connections":0,"browser_executed":False,
                "scope":"Full local operator and original driver declaration/page/result protocol; actual SQL Server execution uses its separately retained equipped-host job."}
            save(root/"RESULT.json",result)
            state["status"]="complete";save(journal_path,state)
            print(encoded(result))
        finally:
            if receiver is not None:receiver.close()
            service.close()

if __name__=="__main__":
    main()
