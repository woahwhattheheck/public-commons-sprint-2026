#!/usr/bin/env python3
"""MIT. Full original Green Button and UtilityAPI receiving/customer operation."""
from __future__ import annotations
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import traceback

from utility_shared import HERE,InputError,private_write,json_bytes,load_json,file_digest
from utility_workspace import Workspace
from utility_delivery import copy_private

def timestamp():return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
def main():
    parser=argparse.ArgumentParser(description="Operate the complete original utility reference sources and customer round trip")
    parser.add_argument("--out",required=True)
    parser.add_argument("--merchant-terms",help="Optional existing original public merchant terms JSON")
    args=parser.parse_args()
    out=Path(args.out).expanduser().absolute();out.mkdir(mode=0o700,parents=False,exist_ok=False)
    if os.environ.get("CODEX_PRIMARY_RUNTIME_NODE"):os.environ.setdefault("SF30_XML_NODE",os.environ["CODEX_PRIMARY_RUNTIME_NODE"])
    os.environ["PYTHONDONTWRITEBYTECODE"]="1"
    report={"schema":"stellar-forge.utility-original-operation.v1","started_at":timestamp(),"status":"STARTED","steps":[]}
    def step(name,value):
        report["steps"].append({"name":name,"at":timestamp(),"result":value})
        target=out/"operation.json";staging=out/"operation.next.json"
        private_write(staging,json_bytes(report));os.replace(staging,target)
        print(json.dumps({"step":name,"at":timestamp()},separators=(",",":")),flush=True)
    def act(ws,name,payload):return ws.act(name,payload,ws.meta("revision",0))["result"]
    try:
        provenance=load_json((HERE/"contracts"/"source-contracts.json").read_bytes())
        for original in provenance["greenbutton"]:
            path=HERE/original["path"];data=path.read_bytes()
            actual=hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()
            if actual!=original["git_blob_sha"]:raise InputError("Original GBA file differs: "+original["path"])
        with Workspace(out/"seller",create=True) as ws:
            full=act(ws,"source.import",{"path":str(HERE/"examples"/"test_usage_data.xml"),"name":"Green Button Alliance full original","provider":"greenbutton"})
            if full["counts"]["intervals"]!=1340:raise InputError("The full original GBA source must contain all 1,340 readings")
            single=act(ws,"source.import",{"path":str(HERE/"examples"/"test_usage_data_01.xml"),"name":"Green Button Alliance original day edition","provider":"greenbutton"})
            if single["counts"]["intervals"]!=96:raise InputError("The original GBA day source must contain all 96 readings")
            examples=load_json((HERE/"contracts"/"utilityapi-examples.json").read_bytes())
            received=[]
            input_dir=out/"provider-examples";input_dir.mkdir(mode=0o700)
            for example in examples["examples"]:
                path=input_dir/(example["id"]+".json");private_write(path,example["content"].encode())
                result=act(ws,"source.import",{"path":str(path),"name":example["id"],"provider":"utilityapi",
                    "kind":"meters" if example["resource_kind"]=="meter-object" else example["resource_kind"],
                    "context":{"source_url":example["source_url"],"source_lines":example["source_lines"]}})
                received.append(result)
            step("complete-original-intake",{"full":full,"day":single,"published_examples":[{"id":x["id"],"name":x["name"],"counts":x["counts"]} for x in received]})
            baseline=act(ws,"analysis.preview",{"name":"Original full Green Button receiving","import_ids":[full["id"]],"timezone":"source"})
            if baseline["report"]["selected_rows"]!=1340 or not baseline["can_build"]:raise InputError("Complete original readings were not preserved in the baseline review")
            first=ws.records("interval",import_ids=[full["id"]],limit=1)["rows"][0]
            if first["value_raw"]!="282" or first["energy_kwh"]!="0.282":raise InputError("Original Wh quantity does not match its exact kWh conversion")
            before=act(ws,"review.save",{"preview_id":baseline["id"],"expected_sha256":baseline["report"]["sha256"],
                "reviewer":"Original utility receiving operation","note":"Complete published Green Button source, with original quality, local time and source billing summary retained.",
                "acknowledged_issue_ids":[item["id"] for item in baseline["report"]["issues"]]})
            before_build=act(ws,"edition.build",{"review_id":before["id"]})
            reconciled=act(ws,"bills.reconcile",{"review_id":before["id"]})
            step("baseline-native-build-and-billing",{"build":before_build,"reconciliation":reconciled,"series":baseline["report"]["series"],"first_reading":{key:first.get(key) for key in ("value_raw","energy_kwh","start_utc","start_local","cost","quality")}})
            combined=act(ws,"analysis.preview",{"name":"Original full source with overlapping day provenance",
                "import_ids":[full["id"],single["id"],*[x["id"] for x in received]],"preferred_import_ids":[full["id"],single["id"]],"timezone":"source"})
            if combined["report"]["selected_rows"]!=1340 or len(combined["report"]["equivalent_and_corrected"])!=96:
                raise InputError("The complete original overlapping day did not reconcile to 96 source equivalences")
            after=act(ws,"review.save",{"preview_id":combined["id"],"expected_sha256":combined["report"]["sha256"],
                "reviewer":"Original utility receiving operation","note":"Retain the full original source as the preferred edition and attach all 96 original overlapping day references. Published UtilityAPI meter and block examples remain complete independent resources.",
                "acknowledged_issue_ids":[item["id"] for item in combined["report"]["issues"]]})
            after_build=act(ws,"edition.build",{"review_id":after["id"]})
            comparison=act(ws,"edition.compare",{"before_id":before_build["id"],"after_id":after_build["id"]})
            final_bills=act(ws,"bills.reconcile",{"review_id":after["id"]})
            step("complete-overlapping-source-edition",{"review":after,"build":after_build,"comparison":comparison,"bill_reconciliation":final_bills,
                "equivalent_intervals":len(combined["report"]["equivalent_and_corrected"]),"series":combined["report"]["series"]})
            params={"limit":"100","sort":"start_utc"};total=0;pages=[];seen=set()
            while True:
                response=act(ws,"dataset.query",{"build_id":after_build["id"],"query":params})
                if response["response"]["status"]!=200:raise InputError("Original native query did not return a dataset page")
                body=response["response"]["body"];total+=len(body["rows"])
                pages.append({"rows":len(body["rows"]),"page":body["page"],"snapshot":body["dataset"]["snapshot"]})
                for row in body["rows"]:
                    if row["logical_key"] in seen:raise InputError("Native query returned a duplicate reviewed interval")
                    seen.add(row["logical_key"])
                cursor=body["page"]["nextCursor"]
                if cursor is None:break
                params={**params,"cursor":cursor}
            if total!=1340:raise InputError("Original native paging did not return every reviewed reading")
            step("all-native-query-pages",{"rows":total,"pages":pages})
            if args.merchant_terms:
                terms=load_json(Path(args.merchant_terms).read_bytes());act(ws,"merchant.configure",terms)
            delivery=act(ws,"package.export",{"review_id":after["id"]})
            archive=ws.export_zip(delivery["id"],out/"utility-customer-delivery.zip")
            package=ws.export_file(delivery["id"],"utility-workspace.zip")
            copy_private(package["path"],out/"utility-workspace.zip")
            if args.merchant_terms:
                prepared=act(ws,"publisher.prepare",{"export_id":delivery["id"]})
                step("original-merchant-publisher",{"prepared":prepared,"state":ws.publisher.call("publisher.state",{})})
            step("complete-customer-delivery",{"delivery":delivery,"archive":{**archive,"path":str(archive["path"])},"portable_sha256":file_digest(out/"utility-workspace.zip",2*1024*1024*1024)})
        with Workspace(out/"customer",create=True) as customer:
            restored=act(customer,"package.restore",{"path":str(out/"utility-workspace.zip")})
            receiving=customer.state()
            if len(receiving["imports"])!=20 or len(receiving["reviews"])!=2 or len(receiving["builds"])!=2:
                raise InputError("Complete original imports, reviews and native editions did not reopen")
            after_restored=customer.build_view(after_build["id"])
            if after_restored["native"]["snapshot"]!=after_build["native"]["snapshot"]:
                raise InputError("The customer snapshot differs from the original reviewed native dataset")
            query=act(customer,"dataset.query",{"build_id":after_build["id"],"query":{"limit":"100","sort":"start_utc"}})
            if query["response"]["body"]["page"]["total"]!=1340:raise InputError("The customer native query does not cover the whole dataset")
            second=act(customer,"package.export",{"review_id":after["id"]})
            customer.export_zip(second["id"],out/"utility-customer-reopened-delivery.zip")
            step("cold-customer-receiving",{"restored":restored,"snapshot":after_restored["native"]["snapshot"],
                "query_page":query["response"]["body"]["page"],"new_delivery":second,
                "imports":len(receiving["imports"]),"reviews":len(receiving["reviews"]),"builds":len(receiving["builds"]),
                "comparisons":len(receiving["comparisons"]),"reconciliations":len(receiving["reconciliations"])})
        report.update(status="COMPLETE",completed_at=timestamp())
        step("complete",{"customer_workspace":str(out/"customer"),"seller_workspace":str(out/"seller")})
        print(json.dumps({"status":"COMPLETE","operation":str(out/"operation.json"),"delivery":str(out/"utility-customer-delivery.zip")}),flush=True)
    except BaseException as error:
        report.update(status="FAILED",failed_at=timestamp(),error=str(error),traceback=traceback.format_exc())
        stage=out/"operation.failed.json";private_write(stage,json_bytes(report));os.replace(stage,out/"operation.json")
        raise

if __name__=="__main__":main()
