import argparse,json,sys
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument("--app-root",required=True)
p.add_argument("--workspace",required=True)
p.add_argument("--manifest",required=True)
p.add_argument("--output",required=True)
p.add_argument("--contact-json")
a=p.parse_args()
app=Path(a.app_root).resolve(strict=True)
sys.path.insert(0,str(app))
from model.workspace import Workspace
from model.common import atomic_json,describe_file,digest,held,verify_file
from model import observed_context,scientific_report
ws=Workspace(a.workspace)
collection=ws.import_sources(Path(a.manifest).resolve(strict=True))
matches=[e for e in collection["entries"] if e.get("metadata",{}).get("report_schema")=="upstate.observed-report/v1"]
if len(matches)!=1: raise ValueError("Select exactly one original observed-report source")
entry=matches[0]
choice={"source_collection_id":collection["id"],"source_id":entry["id"]}
selection={"source_roles":{"OBSERVED_CONTEXT":choice}}
bound=observed_context.bind(ws,selection)
if bound is None: raise ValueError("The original observed-report source was not selected")
selection["observed_context_binding"]=bound
contact={"name":"Upper Savannah project team","organization":"Internal scientific review","email":""}
if a.contact_json:
    contact=json.loads(Path(a.contact_json).read_text(encoding="utf-8"))
output=Path(a.output).resolve()
output.mkdir(parents=True,exist_ok=True)
with held(output/".observed-report.lock"):
    identity={"schema":"upstate.observed-report-native/v1","workspace":str(ws.root),
              "selection":selection,"binding":bound,"contact":contact,
              "report_version":scientific_report.REPORT_VERSION}
    atomic_json(output/"selection.json",identity,immutable=True)
    state={"files":{}}
    product=observed_context.collect(ws,selection,output,state)
    if product is None or product["binding"]!=bound:
        raise ValueError("The rendered source differs from the original selection")
    records=[{"id":"OBSERVED_CONTEXT","source_id":entry["id"],"title":entry["title"],
              "vintage":entry["vintage"],"uri":entry["uri"],"sha256":entry["body"]["sha256"]}]
    title=entry["title"]
    files=dict(product["files"])
    for item in files.values(): verify_file(output,item)
    scientific_report.report_pdf(output/"report.pdf",title,product["sections"],
                                 contact=contact,source_records=records)
    files.update(scientific_report.write_companions(
        output,title,product["sections"],contact=contact,source_records=records,
        binding={"observed_context":bound,"workspace":str(ws.root),"selection":selection}))
    files["report_pdf"]=describe_file(output,output/"report.pdf")
    files["selection"]=describe_file(output,output/"selection.json")
    for item in files.values(): verify_file(output,item)
    result={**identity,"state":"complete","operation_id":"observed-report-"+digest(identity)[:20],
            "source_collection_id":collection["id"],"source_id":entry["id"],
            "section_count":len(product["sections"]),
            "figure_count":sum(isinstance(block,dict) and block.get("kind")=="figure"
                               for _,blocks in product["sections"] for block in blocks),
            "output":str(output),"files":files}
    atomic_json(output/"operation.json",result)
print(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2))
