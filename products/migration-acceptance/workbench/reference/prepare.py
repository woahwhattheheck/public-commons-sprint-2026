#!/usr/bin/env python3
"""Realize the unchanged original dlt fruitshop resources under the selected runtime."""
import argparse,csv,decimal,fcntl,hashlib,importlib.util,io,json,os,pathlib,stat,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/"pipeline"))
from worker import atomic,save,read,descriptor,verify,cell,coerce,check
TABLES={
 "customers":[("id","bigint",None),("name","text",None),("city","text",None)],
 "inventory_categories":[("id","bigint",None),("name","text",None)],
 "inventory":[("id","bigint",None),("name","text",None),("price","decimal",2),("category_id","bigint",None)],
 "purchases":[("id","bigint",None),("customer_id","bigint",None),("inventory_id","bigint",None),("quantity","bigint",None),("date","date",None)]}
COUNTS={"customers":13,"inventory_categories":3,"inventory":6,"purchases":100}
TYPES={"bigint":"BIGINT","text":"VARCHAR","decimal":"DECIMAL(38,2)","date":"DATE"}
KINDS={"bigint":"integer","text":"text","decimal":"decimal","date":"date"}
def columns(table):
 return [{"name":n,"data_type":t,"nullable":False,**({"precision":38,"scale":s} if t=="decimal" else {})} for n,t,s in TABLES[table]]
def expected(table,rows):
 hints=columns(table)
 return {"schema":"dlthub.expected-table.v1","table":table,"complete":True,"rowCount":len(rows),"columns":[{"name":c["name"],"type":TYPES[c["data_type"]]} for c in hints],"rows":[[cell(coerce(r[c["name"]],c)) for c in hints] for r in rows]}
def csv_bytes(table,rows):
 stream=io.StringIO(newline="");w=csv.DictWriter(stream,fieldnames=[x[0] for x in TABLES[table]],lineterminator="\n");w.writeheader();w.writerows(rows);return stream.getvalue().encode()
def pipeline_input(edition):
 return {"schema":"dlthub.pipeline-input.v1","title":"Original fruitshop — "+edition,"pipelineName":"definian_fruitshop","datasetName":"definian_fruitshop","phase":"baseline" if edition=="original" else "incremental",
 "resources":[{"name":t,"tableName":t,"sourceId":"DATA_"+t,"format":"csv","columns":columns(t),"primaryKey":["id"],"writeDisposition":"replace","schemaContract":{"tables":"evolve","columns":"freeze","data_type":"freeze"},"maxTableNesting":0,"nullValues":[]} for t in TABLES],
 "acceptance":[{"table":t,"expectedSourceId":"EXPECTED_"+t,"columns":[{"name":n,"cellType":KINDS[k]} for n,k,_ in TABLES[t]],"primaryKey":["id"],"ignoredRightColumns":["_dlt_load_id","_dlt_id"]} for t in TABLES],
 "sourceBoundary":"Original pinned dlt fruitshop resource outputs; orphan edition changes only purchases[0].customer_id to 999 and retains original before/after derivation.",
 "sourceEvidence":[{"repository":"dlt-hub/dlt","commit":"2360d229c77f7f64692acc31a4555f4cfcd50ed3","path":"dlt/_workspace/_templates/_single_file_templates/fruitshop_pipeline.py"}],
 "limits":{"maxRows":1000,"maxBytes":16777216,"workers":1}}
def acceptance(policy):
 return {"schema":"definian.acceptance-input.v1","title":"Complete fruitshop integrity and control totals — "+policy,
 "objects":[{"id":t,"streamId":json.dumps(["definian_fruitshop",t],separators=(",",":")),"key":["id"],"required":[n for n,_,_ in TABLES[t]]} for t in TABLES],
 "relationships":[
 {"id":"inventory-category","parentObjectId":"inventory_categories","childObjectId":"inventory","parentColumns":["id"],"childColumns":["category_id"],"nulls":"forbid","acceptance":"required"},
 {"id":"purchase-customer","parentObjectId":"customers","childObjectId":"purchases","parentColumns":["id"],"childColumns":["customer_id"],"nulls":"forbid","acceptance":policy},
 {"id":"purchase-inventory","parentObjectId":"inventory","childObjectId":"purchases","parentColumns":["id"],"childColumns":["inventory_id"],"nulls":"forbid","acceptance":"required"}],
 "controls":[
 {"id":"customers-by-city","objectId":"customers","groupBy":["city"],"measure":{"kind":"count"},"nulls":"reject","acceptance":"required"},
 {"id":"inventory-price-by-category","objectId":"inventory","groupBy":["category_id"],"measure":{"kind":"sum","column":"price","scale":2},"nulls":"reject","acceptance":"required"},
 {"id":"purchase-quantity-by-customer","objectId":"purchases","groupBy":["customer_id"],"measure":{"kind":"sum","column":"quantity","scale":0},"nulls":"reject","acceptance":"required"},
 {"id":"purchases-by-date","objectId":"purchases","groupBy":["date"],"measure":{"kind":"count"},"nulls":"reject","acceptance":"required"}]}
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--directory",required=True);ap.add_argument("--source",required=True);ap.add_argument("--runtime-ready",required=True);a=ap.parse_args()
 root=pathlib.Path(a.directory).resolve();source=pathlib.Path(a.source).resolve();ready=read(pathlib.Path(a.runtime_ready));lock=root/"lifetime.lock"
 fd=int(os.environ["DLT_WORKSHARE_OPERATION_LOCK_FD"]);check(os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_PATH")==str(lock),"Original operation lock path differs")
 actual=os.fstat(fd);selected=os.stat(lock,follow_symlinks=False);check(stat.S_ISREG(actual.st_mode) and (actual.st_dev,actual.st_ino)==(selected.st_dev,selected.st_ino),"Original operation lock identity differs");fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 import dlt
 check(dlt.__version__=="1.31.0" and ready["runtimeId"],"The original selected dlt runtime differs")
 original=source/"vendor/dlt/upstream_contracts/upstream/dlt/_workspace/_templates/_single_file_templates/fruitshop_pipeline.py"
 spec=importlib.util.spec_from_file_location("definian_original_fruitshop",original);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 data={name:list(getattr(module,name)()) for name in TABLES}
 for name,rows in data.items():
  check(len(rows)==COUNTS[name] and len({r["id"] for r in rows})==COUNTS[name],"Original full resource population or primary key differs")
  check(all(set(r)=={x[0] for x in TABLES[name]} for r in rows),"Original full resource schema differs")
 files={}
 for edition in ("original","orphan"):
  for name,rows in data.items():
   selected=[dict(row) for row in rows]
   if edition=="orphan" and name=="purchases":selected[0]["customer_id"]=999
   for suffix,body in (("csv",csv_bytes(name,selected)),("expected.json",(json.dumps(expected(name,selected),sort_keys=True,separators=(",",":"),ensure_ascii=False)+"\n").encode())):
    p=root/(edition+"-"+name+"."+suffix);atomic(p,body,True);files[p.name]=descriptor(p)
  p=root/(edition+"-input.json");save(p,pipeline_input(edition),True);files[p.name]=descriptor(p)
 for policy in ("required","reviewable"):
  p=root/("acceptance-"+policy+".json");save(p,acceptance(policy),True);files[p.name]=descriptor(p)
 derivation={"schema":"definian.original-fruitshop-derivation.v1","engine":"dlt 1.31.0","runtimeId":ready["runtimeId"],"source":descriptor(original),"counts":COUNTS,
 "nativeResourceCall":"list(original_module.<resource>()) for all four unchanged original resources; no load_shop or second pipeline.",
 "changes":[{"edition":"orphan","table":"purchases","rowId":"1","column":"customer_id","before":str(data["purchases"][0]["customer_id"]),"after":"999","reason":"Explicit receiving-only orphan edition; original resource bytes and rows remain retained."}],
 "files":files}
 save(root/"DERIVATION.json",derivation,True);print(json.dumps(derivation,sort_keys=True))
if __name__=="__main__":main()
