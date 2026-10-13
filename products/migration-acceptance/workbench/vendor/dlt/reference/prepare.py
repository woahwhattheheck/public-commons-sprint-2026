#!/usr/bin/env python3
"""Realize the unchanged 1,000/14-row originals into an explicit dlt migration input."""
import argparse,csv,datetime,decimal,hashlib,io,json,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"pipeline"))
from worker import atomic,save,read,descriptor,verify,cell,coerce,check
COLUMNS=[
 {"name":"id","data_type":"bigint","nullable":False},
 *[{"name":x,"data_type":"text"} for x in ("first_name","last_name","email")],
 {"name":"target","data_type":"bool"},{"name":"create_dt","data_type":"timestamp","timezone":True},
 {"name":"date","data_type":"date"},{"name":"rating","data_type":"decimal","precision":38,"scale":9},
 {"name":"code","data_type":"text"},{"name":"update_dt","data_type":"timestamp","timezone":True}]
KINDS={"bigint":"integer","text":"text","bool":"boolean","timestamp":"timestamp","date":"date","decimal":"decimal"}
NATIVE={"bigint":"BIGINT","text":"VARCHAR","bool":"BOOLEAN","timestamp":"TIMESTAMP WITH TIME ZONE","date":"DATE","decimal":"DECIMAL(38,9)"}
def raw_rows(path):
    with open(path,encoding="utf-8-sig",newline="") as fp:return list(csv.DictReader(fp))
def expected(rows,columns):
    typed=[]
    for row in rows:typed.append([cell(coerce(None if row.get(c["name"]) in ("",None) else row[c["name"]],c)) for c in columns])
    return {"schema":"dlthub.expected-table.v1","table":"records","complete":True,"rowCount":len(typed),"columns":[{"name":c["name"],"type":NATIVE[c["data_type"]]} for c in columns],"rows":typed}
def config(kind,columns):
    contract={"tables":"evolve","columns":"freeze" if kind=="blocked" else "evolve","data_type":"freeze"}
    return {"schema":"dlthub.pipeline-input.v1","title":"Original dlt "+kind+" reference","pipelineName":"migration_reference","datasetName":"migration_reference","phase":"baseline" if kind=="baseline" else "incremental",
      "resources":[{"name":"records","sourceId":"DATA_SOURCE_ID","format":"csv","columns":columns,"primaryKey":["id"],
        "writeDisposition":{"disposition":"merge","strategy":"delete-insert"},"incremental":{"cursor_path":"create_dt","initial_value":"2000-01-01T00:00:00Z"},
        "schemaContract":contract,"nullValues":[""],"maxTableNesting":10}],
      "acceptance":[{"table":"records","expectedSourceId":"EXPECTED_SOURCE_ID","columns":[{"name":c["name"],"cellType":KINDS[c["data_type"]]} for c in columns],"primaryKey":["id"],"ignoredRightColumns":["_dlt_load_id","_dlt_id"]}],
      "sourceBoundary":"Full original Sling test1.csv and test1.upsert.csv at 7641892e24a7023c8012069596698970c7b3e041. data-only reuse; this programme runs dlt.",
      "sourceEvidence":[{"repository":"slingdata-io/sling-cli","commit":"7641892e24a7023c8012069596698970c7b3e041","paths":["tests/files/test1.csv","tests/files/test1.upsert.csv"]}],
      "notes":"CSV empty values are explicitly NULL; code remains text; ratings are exact Decimal(38,9). The derived change expands partial original records by retaining unchanged update_dt from the baseline."}
def main():
    ap=argparse.ArgumentParser();ap.add_argument("--source",required=True);ap.add_argument("--output",required=True);args=ap.parse_args()
    source=pathlib.Path(args.source).resolve();out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True,mode=0o700)
    baseline_path=source/"reference/original/test1.csv";change_path=source/"reference/original/test1.upsert.csv"
    baseline=raw_rows(baseline_path);change=raw_rows(change_path);check(len(baseline)==1000 and len(change)==14,"Original complete source population differs")
    indexed={r["id"]:dict(r) for r in baseline};check(len(indexed)==1000,"Original baseline keys are not unique")
    updated=[];inserted=[];derived=[]
    for original in change:
        key=original["id"]
        if key in indexed:updated.append(key)
        else:inserted.append(key)
        realized={**indexed.get(key,{}),**original};realized.setdefault("update_dt","");derived.append(realized);indexed[key]=realized
    check(len(updated)==12 and set(inserted)=={"1001","1002"} and len(indexed)==1002,"Original change realization differs")
    evolved=COLUMNS+[{"name":"json_data","data_type":"text"}]
    for r in indexed.values():r.setdefault("json_data","")
    buffer=io.StringIO(newline="");writer=csv.DictWriter(buffer,fieldnames=[c["name"] for c in evolved],lineterminator="\n");writer.writeheader();writer.writerows(derived)
    atomic(out/"change-complete.csv",buffer.getvalue().encode(),True)
    save(out/"baseline-expected.json",expected(baseline,COLUMNS),True);save(out/"evolved-expected.json",expected([indexed[k] for k in sorted(indexed,key=int)],evolved),True)
    save(out/"baseline-input.json",config("baseline",COLUMNS),True);save(out/"evolved-input.json",config("evolved",evolved),True)
    # The rejected edition retains the new input but freezes new columns; its
    # actual native contract outcome is reviewed, then explicitly aborted.
    blocked=config("blocked",COLUMNS);blocked["resources"][0]["columns"]=COLUMNS
    save(out/"blocked-input.json",blocked,True)
    backfill=config("evolved",evolved);backfill["title"]="Original native bounded backfill";backfill["resources"][0]["incremental"]={"cursor_path":"create_dt","initial_value":"2018-01-01T00:00:00Z","end_value":"2022-01-01T00:00:00Z"}
    save(out/"backfill-input.json",backfill,True)
    outputs=[descriptor(p,out) for p in sorted(out.iterdir()) if p.is_file() and p.name!="DERIVATION.json"]
    record={"schema":"dlthub.reference-derivation.v1","originalFiles":[descriptor(baseline_path,source),descriptor(change_path,source)],"baselineRows":1000,"changeRows":14,"updatedIds":updated,"insertedIds":inserted,"finalRows":1002,
      "realization":"Preserve each original input. Derive complete changed records by overlaying the original partial change onto the original baseline row, retaining update_dt; add explicit json_data text. Independent expected rows use the same documented source record rules and are never read from dlt destination.", "nativeEngine":"dlt 1.31.0; original files are data-only reuse.","outputs":outputs}
    save(out/"DERIVATION.json",record,True);print(json.dumps(record))
if __name__=="__main__":main()
