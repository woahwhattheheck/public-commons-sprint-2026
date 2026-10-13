#!/usr/bin/env python3
"""Build and operate one complete authored property continuity course.

All names, amounts, records, captures and reviewer labels are authored examples.
This is not an IDA/partner export, platform run, customer approval or release.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path
from migration_store import canonical, file_hash
from migration_portable import ordinary_directory, publish_bytes
import property_domain as domain
from property_receiving import run

def field(kind="text", required=True):
    return {"type":kind, "required":required}

def relation(name, fields, parent, parent_fields, optional=False):
    return {"id":name,"fields":fields,"target_family":parent,"target_fields":parent_fields,"optional":optional}

def contract():
    families = [
        {"id":"property","platform":"process","identity":["property_id"],
         "fields":{"property_id":field(),"name":field(),"parent_id":field(required=False)},
         "relations":[relation("parent-property",["parent_id"],"property",["property_id"],True)]},
        {"id":"space","platform":"process","identity":["property_id","space_id"],
         "fields":{"property_id":field(),"space_id":field(),"label":field()},
         "relations":[relation("property",["property_id"],"property",["property_id"])]},
        {"id":"lease","platform":"process","identity":["lease_id"],
         "fields":{"lease_id":field(),"property_id":field(),"space_id":field(),"tenant":field(),
                   "state":field(),"start":field("date"),"end":field("date",False),
                   "rent":field("decimal"),"currency":field()},
         "relations":[relation("rental-space",["property_id","space_id"],"space",["property_id","space_id"])]},
        {"id":"capital","platform":"process","identity":["kpn"],
         "fields":{"kpn":field(),"title":field()},"relations":[]},
        {"id":"project_link","platform":"process","identity":["kpn","property_id"],
         "fields":{"kpn":field(),"property_id":field()},
         "relations":[relation("capital",["kpn"],"capital",["kpn"]),relation("property",["property_id"],"property",["property_id"])]},
        {"id":"document","platform":"documents","identity":["document_id","version"],
         "fields":{"document_id":field(),"version":field(),"lease_id":field(),"filename":field(),
                   "sha256":field(),"signature_state":field()},
         "relations":[relation("lease",["lease_id"],"lease",["lease_id"])]},
        {"id":"finance","platform":"finance","identity":["centros_id"],
         "fields":{"centros_id":field(),"lease_id":field(),"counterparty":field(),"currency":field(),"amount":field("decimal")},
         "relations":[relation("lease",["lease_id"],"lease",["lease_id"])]},
        {"id":"billing","platform":"finance","identity":["request_id"],
         "fields":{"request_id":field(),"lease_id":field(),"outcome":field(),"invoice_id":field(required=False)},
         "relations":[relation("lease",["lease_id"],"lease",["lease_id"])]},
        {"id":"spatial","platform":"spatial","identity":["feature_id"],
         "fields":{"feature_id":field(),"property_id":field(),"crs":field(),"units":field(),"area":field("decimal")},
         "relations":[relation("property",["property_id"],"property",["property_id"])]}
    ]
    return {"title":"Authored nine-family property continuity course","scope_id":"authored-property-course",
            "platforms":[{"id":name,"writer":"Authored "+name+" operator",
                          "contract_reference":"Authored export comparison only; no actual vendor route"}
                         for name in ("process","documents","finance","spatial")],
            "families":families,
            "lease_rule":{"family":"lease","space_family":"space","space_fields":["property_id","space_id"],
                          "space_identity":["property_id","space_id"],"status_field":"state",
                          "active_values":["LIVE","ACTIVE"],"start_field":"start","end_field":"end",
                          "time_kind":"date","end_boundary":"inclusive","open_end":True,"cardinality_mode":"declared"},
            "review":{"actor":"Authored course designer","note":"Explicit software example; these are not customer schemas or approved business rules.",
                      "evidence_files":[{"$file":"course-context"}]}}

def data(phase, target=False):
    document_one = hashlib.sha256(b"Authored lease document version one.\n").hexdigest()
    document_two = hashlib.sha256(b"Authored lease document version two.\n").hexdigest()
    value = {
        "property":[{"property_id":"9007199254740993","name":"Example Holding, North","parent_id":""},
                    {"property_id":"P-02","name":"Example Building","parent_id":"9007199254740993"}],
        "space":[{"property_id":"9007199254740993","space_id":"01","label":"North rental space"},
                 {"property_id":"P-02","space_id":"01","label":"Building rental space"}],
        "lease":[{"lease_id":"L-01","property_id":"9007199254740993","space_id":"01","tenant":"Example Tenant",
                  "state":"LIVE" if phase=="a" else "TERMINATED","start":"2026-01-01",
                  "end":"" if phase=="a" else "2026-05-31","rent":"4100.00","currency":"EUR"},
                 {"lease_id":"L-02","property_id":"9007199254740993","space_id":"01","tenant":"Example Tenant",
                  "state":"ACTIVE","start":"2026-06-01","end":"","rent":"5000.01","currency":"EUR"}],
        "capital":[{"kpn":"KPN-9007199254740993","title":"Example capital project"}],
        "project_link":[{"kpn":"KPN-9007199254740993","property_id":"P-02"}],
        "document":[{"document_id":"DOC-01","version":"1","lease_id":"L-02","filename":"Authored lease, version 1.txt",
                     "sha256":document_one,"signature_state":"superseded"},
                    {"document_id":"DOC-01","version":"2","lease_id":"L-02","filename":"Authored lease, version 2.txt",
                     "sha256":document_two,"signature_state":"signed-example"}],
        "finance":[{"centros_id":"FIN-01","lease_id":"L-02","counterparty":"Example Tenant","currency":"EUR","amount":"5000.01"}],
        "billing":[{"request_id":"BILL-01","lease_id":"L-02","outcome":"posted-example","invoice_id":"INV-EXAMPLE-01"}],
        "spatial":[{"feature_id":"FEATURE-01","property_id":"9007199254740993","crs":"EPSG:2157","units":"m2","area":"1200.00"},
                   {"feature_id":"FEATURE-02","property_id":"P-02","crs":"EPSG:2157","units":"m2","area":"350.50"}]
    }
    if phase in ("c","d","e"):
        value["document"].append({"document_id":"DOC-02","version":"1","lease_id":"L-02",
            "filename":"Authored renewal correspondence.txt","sha256":hashlib.sha256(b"Authored renewal correspondence.\n").hexdigest(),
            "signature_state":"unsigned-example"})
    if phase in ("d","e"): value["property"][1]["name"]="Example Building — recipient corrected display name"
    if phase=="e":
        value["lease"][1]["rent"]="5000.02";value["finance"][0]["amount"]="5000.02"
    if phase=="a" and target:
        value["document"].pop()
        value["finance"][0]["amount"]="5000.10"
        value["billing"][0]["outcome"]="acknowledged-example"
        value["billing"][0]["invoice_id"]=""
    return value

def context(phase, side, family, cutoff):
    hour={"a":9,"b":10,"c":11,"d":12,"e":13}[phase]
    return {"scope_id":"authored-property-course","family":family["id"],"role":side,
            "system":"Authored original export exercise","source_reference":"authored:"+phase+":"+side+":"+family["id"],
            "captured_at":"2026-10-13T"+str(hour).zfill(2)+(":00:00Z" if side=="source" else ":05:00Z"),
            "cutoff":cutoff,"coverage":"complete","authority":"authored-legacy" if side=="source" else family["platform"],
            "extraction_reference":"authored-acquisition:"+phase+":"+side+":"+family["id"],
            "independent":side=="target","parameters":{"meaning":"Authored complete reference export; no provider request."},
            "review":{"actor":"Authored acquisition reviewer","note":"All generated original rows are included; this is a software course.",
                      "evidence_files":[{"$file":"course-context"}]}}

def build(directory):
    directory=ordinary_directory(directory,create=True)
    inputs=ordinary_directory(directory/"inputs",create=True)
    file_specs=[]
    def keep(name, raw, key, purpose="input"):
        path=inputs/name;publish_bytes(path,raw)
        actual=file_hash(path)
        file_specs.append({"key":key,"path":str(path),"filename":name,**actual,"purpose":purpose})
        return key
    keep("authored-course-context.txt",(
        "Authored property continuity software course. All data, reviewer labels, captures, identifiers and amounts "
        "are invented reference examples. No IDA, Bluewave, Salesforce, CLM, Centros or ArcGIS tenant was contacted. "
        "A genuine operator run records local results only. No customer release or approval is asserted.\n"
        "The complete nine-family inventory is property, space, lease, capital, project_link, document, finance, billing and spatial. "
        "The two Rental Spaces deliberately share their display ID but have different complete property identities. "
        "KPN identity is independent. Every document version and finance/request/spatial row is retained.\n"
        "Phase a has two declared active leases with overlapping intervals, an incomplete document return, an amount "
        "difference and an acknowledgment where the authored expected record has an invoice outcome. Phase b corrects all "
        "at the same effective cutoff. Phase c is a later full rehearsal with a new document. "
        "Recipient one edits a property display name; recipient two changes the authored lease amount and its matching finance record. "
        "Each recipient keeps all families, originals and predecessor editions and produces a new complete assessment.\n"
    ).encode("utf-8"),"course-context","evidence")
    for name,body in [("Authored lease, version 1.txt","Authored lease document version one.\n"),
                      ("Authored lease, version 2.txt","Authored lease document version two.\n"),
                      ("Authored renewal correspondence.txt","Authored renewal correspondence.\n")]:
        keep(name,body.encode("utf-8"),"document-"+str(len(file_specs)),"evidence")
    definition=contract()
    keep("authored-contract.json",(canonical(definition)+"\n").encode("utf-8"),"authored-contract","evidence")
    steps=[{"key":"contract","operation":"property.contract.create","payload":{"contract":definition}}]
    lanes={"a":steps,"b":steps,"c":steps,"d":[],"e":[]}
    previous_datasets={};previous_editions={}
    ref=lambda key:{"$step":key}
    for phase in ("a","b","c","d","e"):
        cutoff="2026-10-01" if phase in ("a","b") else "2026-10-12"
        lane=lanes[phase]
        for side in ("source","target"):
            raw=data(phase,target=side=="target")
            dataset_steps=[]
            for family in definition["families"]:
                fid=family["id"];key=phase+"-"+side+"-"+fid
                keep(key+".json",(canonical(raw[fid])+"\n").encode("utf-8"),key)
                payload={"title":"Authored "+key,"contract_id":ref("contract"),"family":fid,
                         "file_sha256":{"$sha":key},"filename":key+".json","format":"json-table",
                         "dialect":{"encoding":"utf-8"},"mapping":{name:name for name in family["fields"]},
                         "context":context(phase,side,family,cutoff)}
                parent=previous_datasets.get((side,fid))
                if parent:payload["parent_id"]=ref(parent)
                lane.append({"key":key,"operation":"property.dataset.create","payload":payload})
                previous_datasets[(side,fid)]=key;dataset_steps.append(ref(key))
            edition=phase+"-"+side+"-edition"
            payload={"title":"Authored "+edition,"contract_id":ref("contract"),"role":side,"cutoff":cutoff,
                     "dataset_ids":dataset_steps,"note":"Complete authored nine-family "+side+" population."}
            if side in previous_editions:payload["parent_id"]=ref(previous_editions[side])
            lane.append({"key":edition,"operation":"property.edition.create","payload":payload})
            previous_editions[side]=edition
        lane.append({"key":phase+"-reconciliation","operation":"property.reconciliation.create",
                     "payload":{"title":"Authored "+phase+" complete reconciliation",
                                "source_edition_id":ref(phase+"-source-edition"),"target_edition_id":ref(phase+"-target-edition"),
                                "note":"All nine families; explicit interval and authority rules; no vendor run."}})
        if phase=="b":
            # Actual domain code computes original finding identities. Dataset
            # IDs are placeholders here; item/check identities depend on source
            # keys, rule and ordinal, not those local fixture labels.
            inputs_for={}
            for side in ("source","target"):
                original=data("a",target=side=="target")
                inputs_for[side]={f["id"]:{"dataset":{"id":"fixture-"+side+"-"+f["id"],
                    "context":context("a",side,f,"2026-10-01")},
                    "rows":domain.normalize(original[f["id"]],{n:n for n in f["fields"]},f)}
                    for f in definition["families"]}
            assessment=domain.assess(definition,inputs_for["source"],inputs_for["target"],"2026-10-01")
            decisions=[]
            for subject,section,success in (("item","items","MATCH"),("check","checks","PASS")):
                for item in assessment[section]:
                    if item["status"]!=success:
                        decisions.append({"subject":subject,"id":item["id"],"status":"resolved",
                            "owner":"Authored course reviewer","note":"Resolved against the full same-cutoff corrected source and independent return.",
                            "evidence_files":[{"$file":"course-context"}],"correction_reconciliation_id":ref("b-reconciliation")})
            lane.append({"key":"a-corrected-review","operation":"property.review.create",
                         "payload":{"title":"Authored first findings resolved coherently",
                                    "reconciliation_id":ref("a-reconciliation"),"decisions":decisions,
                                    "reviewer_role":"Software course reviewer","note":"Every original finding resolves in one complete corrected assessment.",
                                    "evidence_files":[{"$file":"course-context"}]}})
        if phase!="a":
            lane.append({"key":phase+"-review","operation":"property.review.create",
                         "payload":{"title":"Authored "+phase+" full assessment review",
                                    "reconciliation_id":ref(phase+"-reconciliation"),"decisions":[],
                                    "reviewer_role":"Authored working-record reviewer",
                                    "note":"Complete authored source/target comparison; no external acceptance.",
                                    "evidence_files":[{"$file":"course-context"}]}})
    plan={"schema":"commons.property-receiving-plan/v1","operation_id":"authored-property-complete-course-v1",
          "title":"Authored property continuity and two recipient edits","actor":"Authored producer operator",
          "files":file_specs,"steps":steps,"first_edit":{"actor":"Authored first recipient","steps":lanes["d"]},
          "second_edit":{"actor":"Authored second recipient","steps":lanes["e"]},"release_required":False}
    path=directory/"authored-plan.json";publish_bytes(path,(canonical(plan)+"\n").encode("utf-8"))
    return path,plan

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,help="One new owned directory, or the same original directory for continuation.")
    parser.add_argument("--prepare-only",action="store_true",help="Write complete authored originals and receiving plan without running it.")
    parser.add_argument("--resume",action="store_true",help="Continue the same original local receiving programme.")
    args=parser.parse_args(argv)
    root=Path(args.directory).expanduser().absolute()
    path,plan=build(root)
    if args.prepare_only:
        print(canonical({"schema":"commons.property-authored-input/v1","plan":str(path),"files":len(plan["files"]),
                         "producer_steps":len(plan["steps"]),"recipient_steps":[len(plan["first_edit"]["steps"]),len(plan["second_edit"]["steps"])],
                         "meaning":"Prepared authored source only; no operating result."}))
        return 0
    result=run(path,root/"workspace",root/"receiving",create=True,resume=args.resume)
    print(canonical(result))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
