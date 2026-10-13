"""MIT. Receive the retained pygeoapi ICOADS responses through the original EDR product.

The five supplied HTTP representations remain their original captured responses.
The optional quarter-window phase is one separately identified live GET acquisition
through this same Workspace, followed by a real 12-to-3-cell edition comparison.
"""
from __future__ import annotations
import argparse,base64,hashlib,importlib.util,io,json,os,sys,time
from pathlib import Path

PINS={
 "collection":(5764,"9e234141986c61c5273543f1a23fb25f0bc078e9142ef04fda46791809ab23ad"),
 "position-sst":(2885,"f97df145b4eac8e45323a8276dee1467f57c9bf23d24bd9c9eb9c6dc8976fd37"),
 "cube-sst-airt":(4714,"0b825c426849aabd94878f7e3bee708fc5b639d2694bae541b325f2f1b68a31e"),
 "invalid-parameter":(118,"91b61e28595efe34c788834714d1b513f3439659590e6d32f2568d84ae297a85"),
 "conformance":(3307,"5169d41df998168424c3145c098746330c679f8e9b14784cedd33cc2a3eafc6a"),
}
def main(argv=None):
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument("--source-root",type=Path,required=True)
 p.add_argument("--operation-root",type=Path,required=True)
 p.add_argument("--operation-id",default="SCF-EDR-COVERAGEJSON-F1CB-20261013")
 p.add_argument("--responses",type=Path)
 p.add_argument("--node")
 p.add_argument("--quarter-window",action="store_true",help="Acquire the actual Jan–Mar 2000 point window through the retained original provider operation")
 a=p.parse_args(argv);source_root=a.source_root.resolve(strict=True)
 sys.path.insert(0,str(source_root))
 import edr_source as s
 from edr_workspace import Workspace,private_dir,retained,json_bytes,atomic,operation_id
 operation_id(a.operation_id)
 if a.node:os.environ["SF30_XML_NODE"]=str(Path(a.node).resolve(strict=True))
 spec=importlib.util.spec_from_file_location("edr_original_native_receiver",source_root/"delivery"/"native-receive.py")
 native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
 root=a.operation_root.expanduser().absolute();root.parent.mkdir(parents=True,exist_ok=True)
 private_dir(root);inputs=private_dir(root/"original-inputs")
 workspace=root/"workspace"
 envelope=native.read_json(a.responses or source_root/"delivery"/"publisher-responses.json",1024*1024)
 rows=envelope["responses"]
 if len(rows)!=5:raise ValueError("Select the complete five original publisher response representations")
 originals={};raws={}
 for row in rows:
  name=row["request"]["id"]
  if name not in PINS or name in originals:raise ValueError("Original publisher response selection changed")
  raw=base64.b64decode(row["bodyBase64"],validate=True);expected=PINS[name]
  if (len(raw),hashlib.sha256(raw).hexdigest())!=expected or (row["bytes"],row["sha256"])!=expected:
   raise ValueError("Original provider response bytes changed: "+name)
  if row["request"]["method"]!="GET" or row["status"]!=(400 if name=="invalid-parameter" else 200):
   raise ValueError("Original provider response method/status changed")
  originals[name]=row;raws[name]=raw
  retained(inputs/(name+".response.json"),json_bytes(row))
  retained(inputs/(name+".body.json"),raw)
 error=s.json_value(raws["invalid-parameter"])
 if error.get("code")!="InvalidParameterValue":raise ValueError("Original provider error code changed")
 def receipt(name):
  row=originals[name]
  return {"requestUrl":row["request"]["url"],"finalUrl":row["url"],"status":row["status"],
   "headers":{k.lower():v for k,v in row["headers"].items() if k.lower() in s.RECEIPT_HEADERS},
   "startedAt":row["startedAt"],"completedAt":row["finishedAt"],"bytes":row["bytes"],"sha256":row["sha256"],"redirects":[]}
 rights={"license":None,"attribution":"pygeoapi demonstration / NOAA ICOADS",
  "usage":"Original public demonstration query; original publication and source terms retained for review.",
  "sourceUrl":"https://psl.noaa.gov/data/gridded/data.coads.1deg.html"}
 selection_rows=[];projection_checks=[];packets=[]
 for name,kind,expected in (("position-sst","position",12),("cube-sst-airt","cube",54)):
  files={"resources/collection.json":raws["collection"],"resources/conformance.json":raws["conformance"],"coverages/000001.json":raws[name]}
  receipts={"resources/collection.json":receipt("collection"),"resources/conformance.json":receipt("conformance"),"coverages/000001.json":receipt(name)}
  selection={"collectionUrl":originals["collection"]["request"]["url"],"queryType":kind,
   "queryUrl":originals[name]["request"]["url"],"params":[],
   "limits":{"maxPages":16,"maxRows":100000,"maxBytes":64*1024*1024,"maxLinkedDocuments":128},"tileSet":0}
  coverage={"status":"exhausted","pages":1,"coverages":1,"values":expected,"linkedDocuments":0,"nextUrl":None,
   "scope":"selected-query-response","consistency":"sequential-responses-not-transactional-snapshot"}
  manifest={"schema":s.SOURCE_SCHEMA,"endpoint":"https://demo.pygeoapi.io/master/","allowedOrigins":["https://demo.pygeoapi.io"],
   "selection":selection,"resources":{"collection":"resources/collection.json","conformance":"resources/conformance.json"},
   "pages":["coverages/000001.json"],"linked":{},"coverage":coverage,"files":receipts,"rights":rights}
  out=io.BytesIO();s.write_capture(manifest,files,out);raw=out.getvalue()
  shape=s.inventory(io.BytesIO(raw));mapping=s.default_plan(shape);projection=[]
  count=s.extract(io.BytesIO(raw),mapping,lambda ordinal,cells,values:projection.append(values))
  if count!=expected or shape["rowCount"]!=expected:raise ValueError("Original source cell count changed")
  preview=s.preview(io.BytesIO(raw),0,100);original=s.json_value(raws[name],True)
  for parameter,range_value in original["ranges"].items():
   actual=[r["cell"]["value"] for r in preview["rows"] if r["cell"]["parameter"]==parameter]
   if s.lexical_json(actual)!=s.lexical_json(range_value["values"]):raise ValueError("Original lexical range values or row order changed")
  if len({r["cell"]["id"] for r in preview["rows"]})!=expected:raise ValueError("Original parameter cell identity is not unique")
  if name=="cube-sst-airt":
   first=preview["rows"][0]["cell"];center=preview["rows"][4]["cell"]
   if s.number_fraction(first["coordinates"]["x"],"x")!=149 or s.number_fraction(first["coordinates"]["y"],"y")!=3:
    raise ValueError("Original ascending/descending grid orientation changed")
   if s.number_fraction(center["coordinates"]["x"],"x")!=151 or s.number_fraction(center["coordinates"]["y"],"y")!=1:
    raise ValueError("Exact original grid coordinates changed")
  path=inputs/(name+".edr.zip");retained(path,raw);packets.append(path)
  native_rows=[dict(zip((column["name"] for column in mapping["columns"]),values)) for values in projection]
  projection_checks.append({"source":hashlib.sha256(raw).hexdigest(),"fields":[c["name"] for c in mapping["columns"]],
   "representation":"native named-column objects in original cell order",
   "expectedNativeRowsSha256":hashlib.sha256(b"".join(json_bytes(row) for row in native_rows)).hexdigest(),
   "extractionValuesSha256":hashlib.sha256(b"".join(json_bytes(values) for values in projection)).hexdigest()})
  selection_rows.append({"name":name,"source":hashlib.sha256(raw).hexdigest(),"bytes":len(raw),"rowCount":expected,
   "schemaSha256":shape["schemaSha256"],"sourceIssues":shape["sourceIssues"],
   "originalLexicalRangesVerified":True,"expectedNativeRowsSha256":hashlib.sha256(b"".join(json_bytes(v) for v in projection)).hexdigest()})
 retained(inputs/"source-receiving.json",json_bytes({"schema":"stellar-forge.edr-publisher-source-receiving.v1",
  "operationId":a.operation_id,"sources":selection_rows,"originalError":{"status":400,"code":error["code"],**native.identity(inputs/"invalid-parameter.body.json")}}))
 args=["--source-root",str(source_root),"--operation-root",str(root),"--operation-id",a.operation_id,
  "--workspace",str(workspace),"--page-size","5","--coverage-policy","require-exhausted"]
 for packet in packets:args+=["--source-packet",str(packet)]
 if a.node:args+=["--node",a.node]
 # Preserve the original extraction-array receipt. Native query rows are named-column
 # objects, so bind that original public API representation explicitly for the check.
 projection_path=inputs/"source-native-projection-v2.json"
 projection_review={"schema":"stellar-forge.edr-publisher-native-projection.v2","operationId":a.operation_id,
  "originalSourceReceiving":native.identity(inputs/"source-receiving.json"),"sources":projection_checks}
 retained(projection_path,json_bytes(projection_review))
 result=native.main(args)
 if len(result["sources"])!=len(selection_rows):raise ValueError("Native product changed the complete source selection")
 for supplied,received,checked in zip(selection_rows,result["sources"],projection_checks):
  if (received["source"]!=supplied["source"] or received["source"]!=checked["source"] or
      received["traversal"]["fields"]!=checked["fields"] or
      received["traversal"]["orderedRowsSha256"]!=checked["expectedNativeRowsSha256"]):
   raise ValueError("Native product changed the original typed named-column projection or complete cell order")
 print(json.dumps({"event":"original_edr_native_projection_verified","sources":len(projection_checks),
  "rows":sum(row["rowCount"] for row in selection_rows),"projection":native.identity(projection_path)}),flush=True)
 quarter={"state":"NOT_REQUESTED"}
 if a.quarter_window:
  destination=private_dir(root/"quarter-window")
  with native.owner_lock(destination/"original-owner.lock"):
   progress=destination/"progress.json"
   previous=native.read_json(progress) if progress.exists() else None
   if previous and previous.get("state")=="complete":
    result_path=destination/"result.json"
    if native.identity(result_path)!=previous.get("result"):raise ValueError("The completed original quarter-window result changed")
    quarter=native.read_json(result_path,32*1024*1024)
    if quarter.get("state")!="COMPLETE" or quarter.get("operationId")!=a.operation_id+"-quarter" or quarter.get("plan")!=result["sources"][0]["plan"]:
     raise ValueError("Completed quarter-window receipt belongs to another original selection")
    for item in (quarter["packet"],quarter["receiving"]):
     if native.identity(item["file"])!={key:item[key] for key in ("bytes","sha256")}:
      raise ValueError("Completed quarter-window project bytes changed")
   else:
    phase={"schema":"stellar-forge.edr-quarter-window-progress.v1","operationId":a.operation_id+"-quarter","state":"running"}
    atomic(progress,phase)
    try:
     with Workspace(workspace) as ws:
      connection=ws.save_connection({"name":"Original public pygeoapi ICOADS","baseUrl":"https://demo.pygeoapi.io/master/"})
      query=ws.save_query({"schema":s.QUERY_SCHEMA,"connectionId":connection["id"],"name":"ICOADS SST Jan–Mar 2000",
       "collectionUrl":originals["collection"]["request"]["url"],"queryType":"position",
       "queryUrl":"https://demo.pygeoapi.io/master/collections/icoads-sst/position",
       "params":[{"name":"coords","value":"POINT(150 0)"},{"name":"parameter-name","value":"SST"},
        {"name":"datetime","value":"2000-01-01/2000-03-31"},{"name":"f","value":"json"}],
       "limits":{"maxPages":16,"maxRows":100000,"maxBytes":64*1024*1024,"maxLinkedDocuments":128},"tileSet":0,"rights":rights})
      retained(destination/"query.json",json_bytes(query))
      print(json.dumps({"event":"original_edr_quarter_acquisition","operationId":phase["operationId"],"queryId":query["id"]}),flush=True)
      acquired=ws.acquire(query["id"],phase["operationId"],label="Original ICOADS SST Jan–Mar 2000")
      retained(destination/"acquisition.json",json_bytes(acquired))
      source=acquired["source"];before=result["sources"][0]
      if source["inventory"]["rowCount"]!=3 or source["inventory"]["coverage"]["status"]!="exhausted":
       raise ValueError("The actual quarter-window response did not contain the three complete expected source cells")
      build=ws.build(source["id"],before["plan"])
      traversal=native.page_native(ws,build,2,json_bytes)
      comparison=ws.compare(before["build"]["id"],build["id"])
      if comparison["counts"]!={"added":0,"removed":9,"changed":0,"unchanged":3}:
       raise ValueError("The actual original 12-to-3-cell comparison differs: "+str(comparison["counts"]))
      packet=ws.export_packet(build["id"],destination/"quarter.project.zip")
      dataset=ws.export_dataset(build["id"],destination/"quarter.dataset")
      native.copy_original(ws.root/"sources"/(source["id"]+".edr"),inputs/"quarter-sst.edr.zip",{"bytes":source["bytes"],"sha256":source["id"]})
      retained(destination/"comparison.json",json_bytes(comparison))
     with Workspace(root/"native-receiving-workspace") as receiver:
      received=receiver.import_packet(Path(packet["file"]))
      restored=native.page_native(receiver,received["build"],2,json_bytes)
      if restored!=traversal:raise ValueError("Quarter-window independent receiving changed native rows")
      second=receiver.export_packet(received["build"]["id"],destination/"quarter.received-project.zip")
      if (second["bytes"],second["sha256"])!=(packet["bytes"],packet["sha256"]):raise ValueError("Quarter-window receiving changed exact project bytes")
     with Workspace(root/"native-receiving-workspace") as receiver:
      if receiver.build_view(build["id"])["native"]["snapshot"]!=build["native"]["snapshot"]:
       raise ValueError("Quarter-window cold reopen changed the native snapshot")
     quarter={"state":"COMPLETE","operationId":phase["operationId"],"queryId":query["id"],"source":source["id"],
      "sourceIssues":source["inventory"]["sourceIssues"],"plan":before["plan"],"build":build,"traversal":traversal,
      "comparison":comparison,"packet":packet,"receiving":second,"coldReopen":True,"dataset":dataset["directory"]}
     retained(destination/"result.json",json_bytes(quarter));phase.update(state="complete",result=native.identity(destination/"result.json"));atomic(progress,phase)
    except BaseException as error:
     phase.update(state="retained-for-continuation",error={"type":type(error).__name__,"message":str(error)})
     print(json.dumps(phase,ensure_ascii=False),file=sys.stderr,flush=True)
     try:atomic(progress,phase)
     except BaseException as second:print(json.dumps({"event":"edr_quarter_progress_save_failed","message":str(second)}),file=sys.stderr,flush=True)
     raise
 final={"schema":"stellar-forge.edr-publisher-native-receiving.v1","operationId":a.operation_id,"native":result,
  "publisherSources":[{**row,"expectedExtractionValuesSha256":checked["extractionValuesSha256"],
   "expectedNativeRowsSha256":checked["expectedNativeRowsSha256"],"nativeRowRepresentation":checked["representation"]}
   for row,checked in zip(selection_rows,projection_checks)],"projectionReview":projection_review,
  "quarterWindow":quarter,"status":"EDR_PUBLISHER_NATIVE_RECEIVING_COMPLETE"}
 result_path=root/("publisher-native-with-quarter-result.json" if a.quarter_window else "publisher-native-result.json")
 retained(result_path,json_bytes(final))
 print(json.dumps({"event":"original_edr_publisher_native_complete","result":str(result_path),
  "identity":native.identity(result_path),"sources":len(result["sources"])+(quarter["state"]=="COMPLETE"),
  "workspace":str(workspace),"receiver":str(root/"native-receiving-workspace")},ensure_ascii=False),flush=True)
 return final
if __name__=="__main__":main()
