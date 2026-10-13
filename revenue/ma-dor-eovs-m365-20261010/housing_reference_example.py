#!/usr/bin/env python3
"""Operate the complete authored housing course in the maintained workbench.

Every record, capture, actor, policy and returned export below is authored
software reference data. No ForHousing, Infoshare+, housing tenant, contractor,
payment or vendor system is read or written. A completed local course remains
NOT_VERIFIED for rendered product readiness until its actual UI is inspected.
"""
from __future__ import annotations
import argparse
import copy
from datetime import datetime, timezone
import fcntl
import json
import os
import sys
from pathlib import Path

from migration_workspace import MigrationWorkspace
from migration_store import canonical, identity, file_hash, regular
from migration_cli import _stage
from migration_portable import APPLICATION_FILES, ordinary_directory, publish_bytes, canonical as encoded
from housing_receiving import HousingReceiving, SCHEMA

HERE = Path(__file__).resolve().parent
OPERATION = "housing-authored-complete-course-v1"
ACTORS = {"producer":"Authored housing producer", "customer":"Authored housing first recipient",
          "second_customer":"Authored housing second recipient"}
MEANING = ("Authored housing software course: complete property/tenancy, joint-party, "
           "contractor-return and rent populations; deliberate differences and coherent "
           "corrections; two independently editable recipients and three full archives. "
           "No customer dataset, vendor schema, production approval or posting is asserted.")
PERIOD = {"label":"Authored October 1–12 closing balances", "start":"2026-10-01",
          "end":"2026-10-12", "date_basis":"posting_date", "mode":"balance"}
RESUME = "Continue this exact original local authored course action with its retained request and sources."

def require(condition, message):
    if not condition:
        raise ValueError(message)

def ref(key, lane="producer", pointer="/id"):
    return {"$result":lane+":"+key, "pointer":pointer}

def file_ref(key, field="sha256"):
    return {"$file":key, "field":field}

def evidence(key="course-context"):
    return {"sha256":file_ref(key), "filename":file_ref(key,"filename"), "bytes":file_ref(key,"bytes")}

def field(kind="text", required=True):
    return {"type":kind, "required":required}

def relation(key, fields, target, target_fields):
    return {"id":key, "fields":fields, "target_family":target,
            "target_fields":target_fields, "optional":False}

def property_contract():
    families = [
        {"id":"property","platform":"housing","identity":["property_id"],
         "fields":{"property_id":field(),"label":field()},"relations":[]},
        {"id":"space","platform":"housing","identity":["property_id","space_id"],
         "fields":{"property_id":field(),"space_id":field(),"label":field()},
         "relations":[relation("space-property",["property_id"],"property",["property_id"])]},
        {"id":"tenancy","platform":"housing","identity":["tenancy_id"],
         "fields":{"tenancy_id":field(),"property_id":field(),"space_id":field(),"state":field(),
                   "start":field("date"),"end":field("date",False),"charge":field("decimal"),
                   "currency":field()},
         "relations":[relation("tenancy-space",["property_id","space_id"],"space",["property_id","space_id"])]},
        {"id":"rent_account","platform":"finance","identity":["rent_account"],
         "fields":{"rent_account":field(),"tenancy_id":field(),"currency":field()},
         "relations":[relation("account-tenancy",["tenancy_id"],"tenancy",["tenancy_id"])]},
    ]
    return {"title":"Authored housing identity and declared tenancy contract",
            "scope_id":"authored-housing-complete-course",
            "platforms":[{"id":name,"writer":"Authored "+name+" export reviewer",
                          "contract_reference":"Local authored export comparison; no actual platform write"}
                         for name in ("housing","finance")],
            "families":families,
            "lease_rule":{"family":"tenancy","space_family":"space",
                          "space_fields":["property_id","space_id"],"space_identity":["property_id","space_id"],
                          "status_field":"state","active_values":["LIVE"],"start_field":"start","end_field":"end",
                          "time_kind":"date","end_boundary":"inclusive","open_end":True,
                          "cardinality_mode":"declared"},
            "review":{"actor":ACTORS["producer"],"note":
                      "Authored course policy only. Joint people are separate relationships; this does not impose a universal one-tenancy housing rule.",
                      "evidence_files":[evidence()]}}

def property_rows(phase, side):
    value = {
        "property":[{"property_id":"001","label":"Authored Court North"},
                    {"property_id":"01","label":"Authored Court South"}],
        "space":[{"property_id":"001","space_id":"01","label":"Authored North dwelling"},
                 {"property_id":"01","space_id":"01","label":"Authored South dwelling"}],
        "tenancy":[{"tenancy_id":"T001","property_id":"001","space_id":"01","state":"LIVE",
                    "start":"2026-01-01","end":"","charge":"140","currency":"GBP"},
                   {"tenancy_id":"T002","property_id":"01","space_id":"01","state":"LIVE",
                    "start":"2026-02-01","end":"","charge":"120","currency":"GBP"}],
        "rent_account":[{"rent_account":"RA001","tenancy_id":"T001","currency":"GBP"},
                        {"rent_account":"RA002","tenancy_id":"T002","currency":"GBP"}],
    }
    if phase == "a" and side == "target":
        value["tenancy"][0]["charge"] = "139"
    return value

REGISTER_FIELDS = {
    "property_keys":{"property_id":"text","space_id":"text","label":"text"},
    "tenancies":{"tenancy_id":"text","property_id":"text","space_id":"text","state":"text","start":"date"},
    "parties":{"party_id":"text","display":"text"},
    "tenancy_parties":{"tenancy_id":"text","party_id":"text","role":"text","effective":"date"},
    "rent_accounts":{"rent_account":"text","tenancy_id":"text","currency":"text"},
    "repairs":{"job_id":"text","property_id":"text","space_id":"text","tenancy_id":"text",
               "stage":"text","sor":"text","sor_version":"text","units":"decimal","recorded_at":"datetime"},
    "appointments":{"appointment_id":"text","job_id":"text","revision":"text",
                    "state":"text","starts_at":"datetime","recorded_at":"datetime"},
    "returns":{"return_id":"text","job_id":"text","request_id":"text","stage":"text","recorded_at":"datetime"},
    "claims":{"claim_id":"text","job_id":"text","amount":"decimal","currency":"text",
              "state":"text","sor_version":"text","period":"text"},
    "safety_evidence":{"evidence_id":"text","property_id":"text","space_id":"text",
                       "version":"text","recorded_at":"datetime","meaning":"text"},
}
REGISTER_KEYS = {"property_keys":["property_id","space_id"],"tenancies":["tenancy_id"],
                 "parties":["party_id"],"tenancy_parties":["tenancy_id","party_id"],
                 "rent_accounts":["rent_account"],"repairs":["job_id"],
                 "appointments":["appointment_id"],"returns":["return_id"],
                 "claims":["claim_id"],"safety_evidence":["evidence_id","version"]}

def register_references():
    declarations = [
        ("tenancy-space","tenancies",["property_id","space_id"],"property_keys",["property_id","space_id"]),
        ("joint-tenancy","tenancy_parties",["tenancy_id"],"tenancies",["tenancy_id"]),
        ("joint-party","tenancy_parties",["party_id"],"parties",["party_id"]),
        ("account-tenancy","rent_accounts",["tenancy_id"],"tenancies",["tenancy_id"]),
        ("repair-space","repairs",["property_id","space_id"],"property_keys",["property_id","space_id"]),
        ("repair-tenancy","repairs",["tenancy_id"],"tenancies",["tenancy_id"]),
        ("appointment-job","appointments",["job_id"],"repairs",["job_id"]),
        ("return-job","returns",["job_id"],"repairs",["job_id"]),
        ("claim-job","claims",["job_id"],"repairs",["job_id"]),
        ("safety-space","safety_evidence",["property_id","space_id"],"property_keys",["property_id","space_id"]),
    ]
    return [{"id":key,"register":family,"fields":fields,"to_register":target,"to_fields":target_fields,
             "required":True,"cardinality":"one"} for key,family,fields,target,target_fields in declarations]

def register_rows(phase, side):
    value = {
        "property_keys":[{"property_id":"001","space_id":"01","label":"Authored North dwelling"},
                         {"property_id":"01","space_id":"01","label":"Authored South dwelling"}],
        "tenancies":[{"tenancy_id":"T001","property_id":"001","space_id":"01","state":"LIVE","start":"2026-01-01"},
                     {"tenancy_id":"T002","property_id":"01","space_id":"01","state":"LIVE","start":"2026-02-01"}],
        "parties":[{"party_id":"P001","display":"Authored person one"},
                   {"party_id":"P002","display":"Authored person two"},
                   {"party_id":"P003","display":"Authored person three"}],
        "tenancy_parties":[{"tenancy_id":"T001","party_id":"P001","role":"joint-holder","effective":"2026-01-01"},
                          {"tenancy_id":"T001","party_id":"P002","role":"joint-holder","effective":"2026-01-01"},
                          {"tenancy_id":"T002","party_id":"P003","role":"holder","effective":"2026-02-01"}],
        "rent_accounts":[{"rent_account":"RA001","tenancy_id":"T001","currency":"GBP"},
                         {"rent_account":"RA002","tenancy_id":"T002","currency":"GBP"}],
        "repairs":[{"job_id":"J001","property_id":"001","space_id":"01","tenancy_id":"T001",
                    "stage":"booked","sor":"SOR-A","sor_version":"authored-v1","units":"1",
                    "recorded_at":"2026-10-11T09:00:00Z"}],
        "appointments":[{"appointment_id":"AP001","job_id":"J001","revision":"1","state":"booked",
                         "starts_at":"2026-10-14T09:00:00Z","recorded_at":"2026-10-11T09:01:00Z"}],
        "returns":[{"return_id":"R001","job_id":"J001","request_id":"REQ001","stage":"acknowledged",
                    "recorded_at":"2026-10-11T09:02:00Z"}],
        "claims":[{"claim_id":"CL001","job_id":"J001","amount":"75","currency":"GBP",
                   "state":"submitted","sor_version":"authored-v1","period":"2026-10"}],
        "safety_evidence":[{"evidence_id":"SE001","property_id":"001","space_id":"01","version":"1",
                            "recorded_at":"2026-10-01T12:00:00Z",
                            "meaning":"Authored evidence-register row; no certification or compliance finding"}],
    }
    if phase == "a" and side == "target":
        value["returns"][0]["stage"] = "received"
        value["claims"][0]["amount"] = "80"
    if phase == "c":
        value["appointments"][0].update({"revision":"2","state":"rebooked",
            "starts_at":"2026-10-15T13:00:00Z","recorded_at":"2026-10-12T10:00:00Z"})
        value["returns"].append({"return_id":"R002","job_id":"J001","request_id":"REQ002",
            "stage":"rebooking-acknowledged","recorded_at":"2026-10-12T10:01:00Z"})
    for family, rows in value.items():
        for row in rows:
            row["source_id"] = family+":"+canonical([row[key] for key in REGISTER_KEYS[family]])
    return value

def finance_rows(which):
    if which == "opening":
        return [{"id":"OPEN-RA001","rent_account":"RA001","account":"RENT","amount":"500","currency":"GBP","posting_date":"2026-09-30"},
                {"id":"OPEN-RA002","rent_account":"RA002","account":"RENT","amount":"100","currency":"GBP","posting_date":"2026-09-30"}]
    if which in ("movements","movements-d"):
        rows = [{"id":"M001","rent_account":"RA001","account":"RENT","amount":"140","currency":"GBP","posting_date":"2026-10-01"},
                {"id":"M002","rent_account":"RA001","account":"RENT","amount":"-130","currency":"GBP","posting_date":"2026-10-03"},
                {"id":"M003","rent_account":"RA001","account":"RENT","amount":"-25","currency":"GBP","posting_date":"2026-10-05"},
                {"id":"M004","rent_account":"RA002","account":"RENT","amount":"120","currency":"GBP","posting_date":"2026-10-01"},
                {"id":"M005","rent_account":"RA002","account":"RENT","amount":"-100","currency":"GBP","posting_date":"2026-10-06"}]
        if which == "movements-d":
            rows.append({"id":"M006","rent_account":"RA001","account":"RENT","amount":"-5","currency":"GBP","posting_date":"2026-10-12"})
        return rows
    amount = {"output-a":"490","output-b":"485","output-d":"480"}[which]
    # These are separately authored expected-return tables, never copied from a
    # calculation result or presented as observations from a housing/finance API.
    return [{"id":"OUT-RA001","rent_account":"RA001","account":"RENT","amount":amount,"currency":"GBP","posting_date":"2026-10-12"},
            {"id":"OUT-RA002","rent_account":"RA002","account":"RENT","amount":"120","currency":"GBP","posting_date":"2026-10-12"}]

FINANCE_MAPPING = {"keys":["id"],"amount":"amount","currency":{"column":"currency"},
                   "account":"account","posting_date":"posting_date","dimensions":{"rent_account":"rent_account"}}

def finance_definition():
    return {"title":"Authored closing rent balance by exact account","family":"authored-rent-balance",
            "company":"Authored housing organisation","tool":"Authored plain-text definition; no vendor execution",
            "native_files":[evidence("finance-definition")],"basis_role":"actual","measure":"signed-rent-balance",
            "currency_basis":"original GBP","group_fields":["dimension:rent_account"],"filters":[],
            "sign":"1","rounding":{"mode":"none","scale":2},
            "review":{"actor":ACTORS["producer"],"note":"Authored definition: opening plus posted signed movements, exact rent-account and currency grouping.",
                      "evidence_files":[evidence()]}}


def read_json(path):
    regular(path)
    return json.loads(path.read_text(encoding="utf-8"))

def complete_rows(workspace, operation, payload):
    rows, offset, total = [], 0, None
    revision = workspace.project["revision"]
    while True:
        page = workspace.dispatch(operation,{**payload,"offset":offset,"limit":250})
        require(page.get("offset") == offset and isinstance(page.get("rows"),list),
                "Original complete result pagination changed")
        if total is None:
            total = page["total"]
            require(type(total) is int and total >= 0,"Invalid complete result count")
        require(page["total"] == total and len(page["rows"]) <= 250 and offset+len(page["rows"]) <= total,
                "Original result population changed between pages")
        rows.extend(page["rows"]); offset += len(page["rows"])
        require(workspace.project["revision"] == revision,"Read changed the original workspace")
        if offset == total:
            return rows
        require(page["rows"],"Original result ended before its declared complete population")

def create_inputs(root):
    inputs = ordinary_directory(root/"inputs",create=True)
    files = []
    def keep(key, name, raw):
        require(isinstance(raw,bytes) and len(raw) <= 64*1024*1024,
                "Complete authored file exceeds the maintained parser bound")
        path = inputs/name
        publish_bytes(path,raw)
        files.append({"key":key,"path":str(path),"filename":name,**file_hash(path)})
    keep("course-context","authored-housing-context.txt",(
        MEANING+"\n"
        "All identifiers, policy, actor labels, capture metadata and amounts are authored. "
        "Source and expected-return tables are separately authored files, not external observations. "
        "Text property identifiers 001 and 01 remain distinct. Two spaces both display 01 but have composite identities. "
        "T001 is one legal agreement with two separately retained joint holders; T002 is a different agreement. "
        "The declared interval rule is the course's reviewed policy, not a universal housing constraint.\n"
        "Property A has charge 140 versus 139. Register A has a return-stage difference and claim 75 versus 80, "
        "including the resulting signed claim control. B corrects complete source and target editions at the same cutoff. "
        "Every original finding is read from the actual local result before its review is authored. "
        "Register B is the second complete local rehearsal; there is no actual production cutover. "
        "Recipient one creates complete register C with a rebooked appointment and an additional acknowledgement. "
        "The job remains booked and the claim remains submitted: acknowledgement is neither completion nor payment.\n"
        "Opening balances on 30 September are RA001=500 and RA002=100 GBP. Complete 1–12 October movements yield "
        "485 and 120. A separate authored output first says 490, then B corrects it to 485. "
        "Recipient two retains a new -5 credit, complete descendant movements and authored output 480/120. "
        "This course uses one reporting period plus its opening; it does not satisfy a commercial two-period release requirement. "
        "No finance.release or property.release is fabricated.\n"
        "The selected software accepts complete bounded files, currently 64 MiB each for property/finance. "
        "This small course establishes no million-row throughput, 50 GB document capacity or deployment timing. "
        "Actual customer capacity needs accepted inventory, supported partition contracts and measured timings.\n"
        "Every customer-facing ready claim requires running the exact outgoing product, looking at actual desktop "
        "and narrow rendered views, and operating important controls, download and reopen paths; source review alone "
        "is not product readiness. The receiving receipt remains rendered_product NOT_VERIFIED until that work occurs.\n"
    ).encode("utf-8"))
    keep("finance-definition","authored-rent-definition.txt",(
        "AUTHORED REFERENCE DEFINITION — not a Business Central, QL, Jet or other vendor definition.\n"
        "Select actual signed RENT movements by posting_date 2026-10-01 through 2026-10-12 inclusive. "
        "Add the complete 2026-09-30 opening balances. Group by exact rent_account and original currency. "
        "Do not negate, round, net between accounts or treat claim submission as a rent movement. "
        "Keep source entry identities and opening/movement lineage. Output A deliberately differs by 5 GBP; "
        "output B corrects the same period; recipient D adds the separately retained M006 -5 credit.\n"
    ).encode("utf-8"))
    for phase in ("a","b"):
        for side in ("source","target"):
            for family,rows in property_rows(phase,side).items():
                key="property-"+phase+"-"+side+"-"+family
                keep(key,key+".json",(canonical(rows)+"\n").encode("utf-8"))
    for phase in ("a","b","c"):
        for side in ("source","target"):
            for family,rows in register_rows(phase,side).items():
                key="register-"+phase+"-"+side+"-"+family
                keep(key,key+".jsonl","".join(canonical(row)+"\n" for row in rows).encode("utf-8"))
    for which in ("opening","movements","output-a","output-b","movements-d","output-d"):
        key="finance-"+which
        keep(key,key+".json",(canonical(finance_rows(which))+"\n").encode("utf-8"))
    require(len(files)==84 and len({item["key"] for item in files})==84,
            "Retain all 84 complete authored source/evidence files")
    return files

def frozen_intent(root, files, capture):
    current = [{"path":name,**file_hash(HERE/name)} for name in APPLICATION_FILES]
    require(len(current)==59 and {"housing_reference_example.py","housing_receiving.py",
            "HOUSING_COMMISSIONING.md"}.issubset(APPLICATION_FILES),
            "Install the complete reviewed 59-file housing application before the course")
    runtime = Path(sys.executable).resolve()
    regular(runtime)
    selected = {"schema":"commons.housing-authored-intent/v1","operation_id":OPERATION,
                "root":str(root),"meaning":MEANING,"actors":ACTORS,"application":current,
                "runtime":{"path":str(runtime),"version":sys.version,**file_hash(runtime)},
                "source_files":files,"course_version":1,"captured_at":capture,
                "rendered_product":{"status":"NOT_VERIFIED","client_ready":False}}
    path = root/"INTENT.json"
    if path.exists():
        require(read_json(path)==selected,"The original source selection or directory changed")
    publish_bytes(path,encoded(selected))
    return selected

class Producer:
    """Build real producer actions; the mixed receiver later reuses these IDs."""
    def __init__(self, root, workspace, intent):
        self.root,self.workspace,self.intent = root,workspace,intent
        self.files = {item["key"]:item for item in intent["source_files"]}
        self.results,self.steps = {},[]
        self.recorder = HousingReceiving.__new__(HousingReceiving)
        self.recorder.out = ordinary_directory(root/"producer-journal",create=True)
        self.recorder.artifacts = {}
        self.recorder.input_sha = identity(intent)
        self.recorder.operation_id = OPERATION
        # All business action IDs use OPERATION+'-'; native resume IDs use the
        # separate maintained 'housing-resume-' namespace. The selected set grows
        # only as exact original business requests are declared and persisted.
        self.recorder.selected_action_ids = set()
        for item in intent["source_files"]:
            staged=_stage(workspace,Path(item["path"]),item["filename"],item["sha256"],item["bytes"])
            require(all(staged[key]==item[key] for key in ("sha256","bytes","filename")),
                    "Staging changed an original source descriptor")

    def resolve(self,value):
        if isinstance(value,dict):
            if set(value)=={"$result","pointer"}:
                require(value["$result"].startswith("producer:"),"Producer cannot read future recipient results")
                result=self.results[value["$result"].split(":",1)[1]]
                for part in value["pointer"].split("/")[1:]:
                    part=part.replace("~1","/").replace("~0","~")
                    result=result[int(part)] if isinstance(result,list) else result[part]
                return copy.deepcopy(result)
            if set(value)=={"$file","field"}:
                return self.files[value["$file"]][value["field"]]
            return {key:self.resolve(item) for key,item in value.items()}
        if isinstance(value,list):
            return [self.resolve(item) for item in value]
        return value

    def apply(self,key,operation,payload):
        step=make_step(key,operation,payload,"producer")
        require(not any(old["key"]==key for old in self.steps),"Producer action key repeated")
        operation_id=step["operation_id"]
        require(operation_id.startswith(OPERATION+"-"),"Original business namespace changed")
        self.recorder.selected_action_ids.add(operation_id)
        actual=self.resolve(payload)
        semantic={"operation":operation,"payload":{**actual,"actor":ACTORS["producer"]}}
        semantic_sha=identity(semantic)
        folder="actions/"+key
        path=self.recorder.out/folder/"request.json"
        if path.exists():
            saved=read_json(path)
            request=saved["request"]
            require(saved["workspace_id"]==self.workspace.project["id"] and
                    saved["operation"]==operation and request["operation_id"]==operation_id and
                    identity({"operation":operation,"payload":{k:v for k,v in request.items()
                        if k not in ("operation_id","expected_revision")}})==semantic_sha,
                    "The original authored request, actor or workspace changed")
        else:
            request={**actual,"operation_id":operation_id,"actor":ACTORS["producer"],
                     "expected_revision":self.workspace.project["revision"]}
            self.recorder.put(folder+"/request.json",encoded(
                {"operation":operation,"workspace_id":self.workspace.project["id"],"request":request}))
        prior=self.workspace.dispatch("operation.get",{"id":operation_id})
        if prior["found"]:
            require(prior["operation"]["operation"]==operation and
                    prior["operation"]["request_sha256"]==semantic_sha,
                    "An original operation belongs to a different request")
            if prior["operation"]["status"]!="SUCCEEDED":
                self.recorder.continue_original(self.workspace,folder,operation_id,
                    ACTORS["producer"],step["resume_reason"])
        try:
            self.workspace.dispatch(operation,request)
        finally:
            observation=self.workspace.dispatch("operation.get",{"id":operation_id})
            self.recorder.put(folder+"/observation-"+identity(observation)+".json",encoded(observation))
        require(observation["found"] and observation["operation"]["status"]=="SUCCEEDED" and
                observation["operation"]["request_sha256"]==semantic_sha,
                "Preserve the original incomplete action and its observed return")
        returned=observation["operation"]["result"]["result"]
        self.recorder.put(folder+"/accepted.json",encoded({"operation":operation,
            "operation_id":operation_id,"workspace_id":self.workspace.project["id"],
            "request_sha256":semantic_sha,"result":returned}))
        self.results[key]=returned
        self.steps.append(step)
        return returned

def make_step(key,operation,payload,lane):
    return {"key":key,"operation_id":OPERATION+"-"+lane+"-"+key,
            "operation":operation,"payload":payload,"actor":ACTORS[lane],"resume_reason":RESUME}

def property_context(phase,side,family,capture):
    return {"scope_id":"authored-housing-complete-course","family":family["id"],"role":side,
            "system":"Authored housing reference exports","source_reference":"authored:property:"+phase+":"+side+":"+family["id"],
            "captured_at":capture,"cutoff":"2026-10-12","coverage":"complete",
            "authority":"authored-legacy" if side=="source" else family["platform"],
            "extraction_reference":"authored-local:"+phase+":"+side+":"+family["id"],
            "independent":side=="target","parameters":{"meaning":MEANING},
            "review":{"actor":ACTORS["producer"],"note":"Complete separately authored local table; no vendor return.",
                      "evidence_files":[evidence()]}}

def build_property(producer,capture):
    contract=property_contract()
    producer.apply("property-contract","property.contract.create",{"contract":contract})
    for phase in ("a","b"):
        for side in ("source","target"):
            ids=[]
            for family in contract["families"]:
                key="property-"+phase+"-"+side+"-"+family["id"]
                payload={"title":"Authored "+key,"contract_id":ref("property-contract"),"family":family["id"],
                         "file_sha256":file_ref(key),"filename":file_ref(key,"filename"),
                         "format":"json-table","dialect":{"encoding":"utf-8"},
                         "mapping":{name:name for name in family["fields"]},
                         "context":property_context(phase,side,family,capture)}
                if phase=="b":
                    payload["parent_id"]=ref("property-a-"+side+"-"+family["id"])
                producer.apply(key,"property.dataset.create",payload);ids.append(ref(key))
            key="property-"+phase+"-"+side+"-edition"
            payload={"title":"Authored "+key,"contract_id":ref("property-contract"),"role":side,
                     "cutoff":"2026-10-12","dataset_ids":ids,"note":"All four original families retained."}
            if phase=="b":payload["parent_id"]=ref("property-a-"+side+"-edition")
            producer.apply(key,"property.edition.create",payload)
        key="property-"+phase+"-reconciliation"
        result=producer.apply(key,"property.reconciliation.create",
            {"title":"Authored "+phase+" full property comparison",
             "source_edition_id":ref("property-"+phase+"-source-edition"),
             "target_edition_id":ref("property-"+phase+"-target-edition"),"note":MEANING})
        sections={section:complete_rows(producer.workspace,"property.rows",
            {"kind":"property.reconciliation","id":result["id"],"section":section})
            for section in ("items","checks")}
        if phase=="a":
            findings=[{"subject":subject,**item} for subject,section,success in
                (("item","items","MATCH"),("check","checks","PASS"))
                for item in sections[section] if item["status"]!=success]
            require(len(findings)==1 and findings[0]["subject"]=="item" and findings[0]["status"]=="DIFFERENT",
                    "The authored 140 versus 139 charge must be the exact original property finding")
        else:
            require(result["assessment"]["complete"] and result["assessment"]["ready"] and
                    all(row["status"]=="MATCH" for row in sections["items"]) and
                    all(row["status"]=="PASS" for row in sections["checks"]),
                    "The complete corrected property edition did not match")
    decisions=[{"subject":item["subject"],"id":item["id"],"status":"resolved","owner":ACTORS["producer"],
                "note":"The same-cutoff complete descendant source and independent authored return correct the charge.",
                "evidence_files":[evidence()],"correction_reconciliation_id":ref("property-b-reconciliation")}
               for item in findings]
    for key,reconciliation,selected in (("property-a-review","property-a-reconciliation",decisions),
                                         ("property-b-review","property-b-reconciliation",[])):
        result=producer.apply(key,"property.review.create",{"title":"Authored complete property review",
            "reconciliation_id":ref(reconciliation),"decisions":selected,
            "reviewer_role":"Authored software reviewer","note":MEANING,"evidence_files":[evidence()]})
        require(result["ready"],"The original property review is not complete")


def register_steps(phase,lane,capture,parent_phase=None,parent_lane="producer"):
    steps=[]
    def add(key,operation,payload):
        steps.append(make_step(key,operation,payload,lane))
    selected={"source":[],"target":[]}
    for side in ("source","target"):
        for family,rows in register_rows(phase,side).items():
            key="register-"+phase+"-"+side+"-"+family
            add(key+"-import","source.import",{
                "file_sha256":file_ref(key),"filename":file_ref(key,"filename"),"bytes":file_ref(key,"bytes"),
                "format":"inventory_jsonl","context":{"scope_id":"authored-housing-complete-course",
                "identity_namespace":"authored-housing-records","role":side+"_inventory",
                "capture_kind":"local_reference","scan_mode":"full","captured_at":capture,
                "coverage":{"mode":"complete","expected_rows":len(rows),
                            "description":"Complete authored "+family+" table for edition "+phase+"."},
                "note":MEANING}})
            payload={"title":"Authored "+key,"source_id":ref(key+"-import",lane),"register":family,
                     "system":"authored-origin" if side=="source" else "authored-destination",
                     "side":side,"review_note":"Exact authored keys and typed cells; no vendor export contract.",
                     "fields":{name:{"selector":{"pointer":"/"+name},"type":kind,"required":True}
                               for name,kind in REGISTER_FIELDS[family].items()},
                     "key_fields":REGISTER_KEYS[family]}
            if parent_phase:
                payload["parent_dataset_id"]=ref("register-"+parent_phase+"-"+side+"-"+family,parent_lane)
            add(key,"register.dataset.create",payload);selected[side].append(ref(key,lane))
    key="register-"+phase+"-plan"
    payload={"title":"Authored complete register edition "+phase,
             "review_note":"Ten complete related registers, typed composite relationships and signed claim control.",
             "source_dataset_ids":selected["source"],"cutoff_at":capture,
             "destinations":{family:"authored-destination" for family in REGISTER_FIELDS},
             "references":register_references(),
             "controls":[{"id":"signed-claim-by-period","register":"claims","measure_fields":["amount"],
                          "unit_fields":["currency"],"group_fields":["period"]}],
             "max_snapshot_age_seconds":0}
    if parent_phase:payload["parent_plan_id"]=ref("register-"+parent_phase+"-plan",parent_lane)
    add(key,"register.plan.create",payload)
    payload={"title":"Authored complete rehearsal "+phase,"review_note":
             "Complete separately authored target rows; no vendor execution or input-echo comparison.",
             "plan_id":ref(key,lane),"target_dataset_ids":selected["target"]}
    if parent_phase:payload["parent_rehearsal_id"]=ref("register-"+parent_phase+"-rehearsal",parent_lane)
    add("register-"+phase+"-rehearsal","register.rehearsal.create",payload)
    return steps

def build_registers(producer,capture):
    originals=[]
    for phase in ("a","b"):
        for step in register_steps(phase,"producer",capture,"a" if phase=="b" else None):
            producer.apply(step["key"],step["operation"],step["payload"])
        rehearsal=producer.results["register-"+phase+"-rehearsal"]
        rows=complete_rows(producer.workspace,"register.rehearsal.items",{"id":rehearsal["id"]})
        faults=[row for row in rows if row["status"]!="MATCH"]
        if phase=="a":
            require(len(faults)==3 and all(row["status"]=="DIFFERENT" for row in faults) and
                    {(row["kind"],row["register"]) for row in faults}==
                    {("record","returns"),("record","claims"),("control","claims")},
                    "Expected exactly the original stage, claim and signed-control differences")
            for ordinal,item in enumerate(faults):
                key="register-a-review-"+str(ordinal)
                producer.apply(key,"register.review.create",{
                    "title":"Authored original "+item["kind"]+" finding","rehearsal_id":ref("register-a-rehearsal"),
                    "item_id":item["id"],"disposition":"rework","reason":
                    "Retain this actual original discrepancy; correct the complete independent target edition before approval.",
                    "evidence_row_ids":sorted({row["source_row_id"] for row in item["source_rows"]})})
                originals.append((key,item))
            producer.apply("register-a-cutover","register.cutover.create",{
                "title":"Authored first rehearsal hold","rehearsal_ids":[ref("register-a-rehearsal")],
                "decision":"hold","reason":"The original complete return retains three nonmatching checks.",
                "acceptance_owner":ACTORS["producer"]})
        else:
            require(rows and not faults,"The complete corrected second register rehearsal must match")
            matched={(row["kind"],row["register"],row["key"]):row for row in rows}
            for ordinal,(key,original) in enumerate(originals):
                correction=matched.get((original["kind"],original["register"],original["key"]))
                require(correction is not None and correction["status"]=="MATCH",
                        "The exact original register finding was not corrected in the complete second edition")
                producer.apply("register-a-withdrawn-"+str(ordinal),"register.review.create",{
                    "title":"Authored rework superseded by complete corrected evidence",
                    "rehearsal_id":ref("register-a-rehearsal"),"item_id":original["id"],
                    "parent_review_id":ref(key),"disposition":"withdrawn",
                    "reason":"Original finding retained. Complete second rehearsal "+rehearsal["id"]+
                             " matches the same original typed key and every selected control.",
                    "evidence_row_ids":sorted({row["source_row_id"] for row in correction["source_rows"]})})
            producer.apply("register-b-cutover","register.cutover.create",{
                "title":"Authored corrected second rehearsal decision",
                "rehearsal_ids":[ref("register-b-rehearsal")],"decision":"approved",
                "reason":"Local authored complete evidence agrees. This records course review only, not a production release.",
                "acceptance_owner":ACTORS["producer"],"parent_cutover_id":ref("register-a-cutover")})

def finance_context(which,capture,lane):
    role="opening_balance" if which=="opening" else "report_output" if which.startswith("output") else "actual"
    value={"company":"Authored housing organisation","system":"Authored rent reference tables",
           "source_reference":"authored:finance:"+which,"captured_at":capture,"coverage":"complete","role":role,
           "measure":"signed-rent-balance","currency_basis":"original GBP",
           "window":{"start":"2026-09-30","end":"2026-09-30"} if which=="opening" else
                    {"start":PERIOD["start"],"end":PERIOD["end"]},
           "parameters":{"meaning":"Complete separately authored software input, no vendor acquisition"},
           "review":{"actor":ACTORS[lane],"note":"Original authored population and exact definition retained.",
                     "evidence_files":[evidence()]}}
    if role in ("opening_balance","report_output"):value["basis_role"]="actual"
    if role=="opening_balance":value["opening_as_of"]="2026-09-30"
    return value

def finance_dataset_step(which,lane,capture,parent=None):
    key="finance-"+which
    payload={"title":"Authored "+which,"file_sha256":file_ref(key),"filename":file_ref(key,"filename"),
             "format":"json-table","dialect":{"encoding":"utf-8"},"mapping":FINANCE_MAPPING,
             "context":finance_context(which,capture,lane)}
    if parent:payload["parent_id"]=ref(parent)
    return make_step(key,"finance.dataset.create",payload,lane)

def finance_reconciliation_payload(phase,lane):
    return {"title":"Authored "+phase+" full closing balance return",
            "run_id":ref("finance-run-d","second_customer") if phase=="d" else ref("finance-run"),
            "output_dataset_id":ref("finance-output-"+phase,lane),
            "native_binding":{"definition_sha256":ref("finance-definition",pointer="/definition_sha256"),
                              "period":PERIOD,"actor":ACTORS[lane],
                              "note":"Authored expected-return table tied to retained plain-text reference definition; no native vendor result.",
                              "evidence_files":[evidence("finance-definition"),evidence()]},"note":MEANING}

def finance_review_payload(key,decisions):
    return {"title":"Authored complete balance review","reconciliation_id":key,"decisions":decisions,
            "reviewer_role":"Authored rent reconciliation reviewer","note":MEANING,"evidence_files":[evidence()]}

def assert_balances(workspace,run_id,expected):
    rows=complete_rows(workspace,"finance.rows",{"kind":"finance.run","id":run_id,"section":"rows"})
    actual={row["key"][0]["value"]:row["amount"] for row in rows}
    require(actual==expected,"The exact complete closing balances differ from the authored course")
    return actual

def build_finance(producer,capture):
    for which in ("opening","movements","output-a","output-b"):
        step=finance_dataset_step(which,"producer",capture,"finance-output-a" if which=="output-b" else None)
        producer.apply(step["key"],step["operation"],step["payload"])
    producer.apply("finance-definition","finance.definition.create",{"definition":finance_definition()})
    run=producer.apply("finance-run","finance.run.create",{
        "title":"Authored original complete rent calculation","definition_id":ref("finance-definition"),
        "dataset_id":ref("finance-movements"),"opening_dataset_id":ref("finance-opening"),
        "period":PERIOD,"note":MEANING})
    require(run["calculation"]["complete"],"The complete authored finance calculation is provisional")
    assert_balances(producer.workspace,run["id"],{"RA001":"485","RA002":"120"})
    for phase in ("a","b"):
        rec=producer.apply("finance-"+phase+"-reconciliation","finance.reconciliation.create",
                           finance_reconciliation_payload(phase,"producer"))
        rows=complete_rows(producer.workspace,"finance.rows",{"kind":"finance.reconciliation","id":rec["id"]})
        faults=[row for row in rows if row["status"]!="MATCH"]
        if phase=="a":
            require(len(rows)==2 and len(faults)==1 and faults[0]["status"]=="DIFFERENT" and
                    faults[0]["expected"]=="485" and faults[0]["observed"]=="490" and faults[0]["delta"]=="5",
                    "The deliberate original 5 GBP difference was not retained")
            original=faults
        else:
            require(len(rows)==2 and not faults and rec["comparison"]["all_matched"],
                    "The complete corrected authored rent return does not match")
    decisions=[{"item_id":row["id"],"status":"resolved","owner":ACTORS["producer"],
                "note":"Complete separately authored B return corrects the original account to 485 GBP.",
                "evidence_files":[evidence()],"correction_reconciliation_id":ref("finance-b-reconciliation")}
               for row in original]
    for phase,decided in (("a",decisions),("b",[])):
        result=producer.apply("finance-"+phase+"-review","finance.review.create",
                             finance_review_payload(ref("finance-"+phase+"-reconciliation"),decided))
        require(result["ready"],"The complete authored finance review remains open")

def recipient_steps(capture):
    first=register_steps("c","customer",capture,"b","producer")
    first.append(make_step("register-c-cutover","register.cutover.create",{
        "title":"Authored recipient rebooking edition review","rehearsal_ids":[ref("register-c-rehearsal","customer")],
        "decision":"approved","reason":"Complete authored rebooking and new acknowledgement agree; job and claim states remain separate.",
        "acceptance_owner":ACTORS["customer"],"parent_cutover_id":ref("register-b-cutover")},"customer"))
    second=[
        finance_dataset_step("movements-d","second_customer",capture,"finance-movements"),
        finance_dataset_step("output-d","second_customer",capture,"finance-output-b"),
        make_step("finance-run-d","finance.run.create",{
            "title":"Authored recipient credit and complete closing balance","definition_id":ref("finance-definition"),
            "dataset_id":ref("finance-movements-d","second_customer"),"opening_dataset_id":ref("finance-opening"),
            "period":PERIOD,"note":"New separately retained M006 credit; original complete movement dataset is preserved."},"second_customer"),
        make_step("finance-d-reconciliation","finance.reconciliation.create",
                  finance_reconciliation_payload("d","second_customer"),"second_customer"),
        make_step("finance-d-review","finance.review.create",
                  finance_review_payload(ref("finance-d-reconciliation","second_customer"),[]),"second_customer"),
    ]
    return first,second


def course_assertions(result):
    accepted={(row["lane"],row["key"]):row["original_result"]["result"] for row in result["actions"]}
    original_run=accepted[("producer","finance-run")]
    later_run=accepted[("second_customer","finance-run-d")]
    c=accepted[("customer","register-c-rehearsal")]
    d=accepted[("second_customer","finance-d-reconciliation")]
    require(d["comparison"]["all_matched"],"The second recipient's full independent authored return does not match")
    workspace=MigrationWorkspace(result["locations"]["final"],create=False)
    try:
        original=assert_balances(workspace,original_run["id"],{"RA001":"485","RA002":"120"})
        later=assert_balances(workspace,later_run["id"],{"RA001":"480","RA002":"120"})
        items=complete_rows(workspace,"register.rehearsal.items",{"id":c["id"]})
        require(items and all(row["status"]=="MATCH" for row in items),
                "The first recipient's complete rebooking rehearsal did not match")
        def table(key):
            record=accepted[("customer",key)]
            return complete_rows(workspace,"register.dataset.rows",{"id":record["id"]})
        appointment=table("register-c-source-appointments")
        returns=table("register-c-source-returns")
        jobs=table("register-c-source-repairs")
        claims=table("register-c-source-claims")
        require(len(appointment)==1 and appointment[0]["values"]["state"]=="rebooked" and
                appointment[0]["values"]["revision"]=="2" and len(returns)==2 and
                any(row["values"]["stage"]=="rebooking-acknowledged" for row in returns) and
                jobs[0]["values"]["stage"]=="booked" and claims[0]["values"]["state"]=="submitted",
                "An acknowledgement was confused with completion/payment or the real recipient edit disappeared")
        movements=accepted[("second_customer","finance-movements-d")]
        original_movements=accepted[("producer","finance-movements")]
        require(movements["row_count"]==6 and original_movements["row_count"]==5 and
                movements["parent_id"]==original_movements["id"] and
                later_run["definition_id"]==original_run["definition_id"],
                "The new credit lost its complete original ancestry or exact definition")
        require(len(result["deliveries"])==3 and result["lifetimes"]=={"workspaces":"CLOSED","children":"NONE_CREATED"},
                "The original mixed receiving must close three complete archives")
        return {"initial_balances":original,"second_recipient_balances":later,
                "original_movement_rows":5,"later_movement_rows":6,"first_recipient_return_rows":2,
                "first_recipient_rehearsal_items":len(items),
                "acknowledgement_is_not_completion_or_payment":True,
                "archives":len(result["deliveries"]),"definition_id":original_run["definition_id"]}
    finally:
        workspace.close()

def run(directory):
    root=ordinary_directory(Path(directory).expanduser().absolute(),create=True)
    os.chmod(root,0o700)
    lock=os.open(root/"example.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    workspace,runner=None,None
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BaseException:
        os.close(lock)
        raise
    try:
        files=create_inputs(root)
        clock_path=root/"COURSE.json"
        if not clock_path.exists():
            require(not (root/"INTENT.json").exists(),"Do not replace a missing original course clock")
            publish_bytes(clock_path,encoded({"schema":"commons.housing-authored-course/v1",
                "operation_id":OPERATION,"captured_at":datetime.now(timezone.utc).isoformat(),
                "meaning":"Actual creation time of these authored local files; not a vendor extraction."}))
        clock=read_json(clock_path)
        require(clock.get("operation_id")==OPERATION and clock.get("schema")=="commons.housing-authored-course/v1",
                "The original authored course identity changed")
        capture=clock["captured_at"]
        require(datetime.fromisoformat(capture).tzinfo is not None,"Retain the original timezone-aware creation time")
        intent=frozen_intent(root,files,capture)
        input_path=root/"housing-input.json"
        prepared_path=root/"PREPARED.json"
        if not input_path.exists() or not prepared_path.exists():
            # Reconstruct a partially published preparation using the SAME
            # original producer IDs/results. Create-only publication rejects
            # any changed plan; no fresh workspace or replacement request.
            workspace_path=root/"original-workspace"
            workspace_marker=root/"WORKSPACE.json"
            existed=(workspace_path/"workspace.sqlite3").exists()
            require(not workspace_marker.exists() or existed,
                    "An original workspace disappeared; restore its exact retained bytes, do not recreate it")
            workspace=MigrationWorkspace(workspace_path,create=not existed,
                                         title="Authored complete housing course")
            if workspace_marker.exists():
                bound=read_json(workspace_marker)
                require(bound=={"workspace_id":workspace.project["id"],"path":str(workspace.root),
                                "intent_sha256":identity(intent)},
                        "The original workspace or source selection changed")
            else:
                # Recovery after initial empty Store creation only. Never adopt
                # an unrelated populated workspace under the authored course.
                require(workspace.project["revision"]==0 and workspace.project["title"]=="Authored complete housing course",
                        "The unbound workspace is not the original empty authored workspace")
                publish_bytes(workspace_marker,encoded({"workspace_id":workspace.project["id"],
                    "path":str(workspace.root),"intent_sha256":identity(intent)}))
            producer=Producer(root,workspace,intent)
            build_property(producer,capture)
            build_registers(producer,capture)
            build_finance(producer,capture)
            first,second=recipient_steps(capture)
            value={"schema":SCHEMA,"operation_id":OPERATION,"title":"Authored complete housing commissioning course",
                   "actor":ACTORS["producer"],"customer_actor":ACTORS["customer"],
                   "second_customer_actor":ACTORS["second_customer"],"authorization":MEANING,
                   "modules":["register","property","finance"],
                   "workspace":{"path":str(workspace.root),"id":workspace.project["id"],
                                "expected_revision":workspace.project["revision"]},
                   "application":intent["application"],"source_files":files,
                   "steps":producer.steps,"customer_steps":first,"second_customer_steps":second,
                   "delivery_resume_reason":RESUME,
                   "comparisons":[{"key":"original-correction","before_id":ref("register-a-rehearsal"),
                                   "after_id":ref("register-b-rehearsal")},
                                  {"key":"recipient-rebooking","before_id":ref("register-b-rehearsal"),
                                   "after_id":ref("register-c-rehearsal","customer")}]}
            require(len(producer.steps)>100 and len(first)>40 and len(second)==5,
                    "The complete authored course unexpectedly lost a domain or recipient action")
            # The exact final plan becomes immutable only after every producer
            # result/finding ID has actually been observed and bound above.
            publish_bytes(input_path,encoded(value))
            publish_bytes(root/"PREPARED.json",encoded({"schema":"commons.housing-authored-preparation/v1",
                "operation_id":OPERATION,"input":str(input_path),**file_hash(input_path),
                "workspace_id":workspace.project["id"],"producer_revision":workspace.project["revision"],
                "source_files":len(files),"producer_steps":len(producer.steps),
                "recipient_steps":[len(first),len(second)],"meaning":MEANING,
                "state":"PRODUCER_PREPARED","rendered_product":{"status":"NOT_VERIFIED","client_ready":False}}))
            workspace.close();workspace=None
        selected=read_json(input_path)
        binding=read_json(root/"WORKSPACE.json")
        require(selected["operation_id"]==OPERATION and selected["application"]==intent["application"] and
                selected["source_files"]==files and selected["workspace"]["id"]==binding["workspace_id"] and
                selected["workspace"]["path"]==binding["path"] and binding["intent_sha256"]==identity(intent),
                "The original prepared housing plan lost its source/workspace binding")
        prepared=read_json(prepared_path)
        expected_preparation={"schema":"commons.housing-authored-preparation/v1",
            "operation_id":OPERATION,"input":str(input_path),**file_hash(input_path),
            "workspace_id":selected["workspace"]["id"],
            "producer_revision":selected["workspace"]["expected_revision"],
            "source_files":len(files),"producer_steps":len(selected["steps"]),
            "recipient_steps":[len(selected["customer_steps"]),len(selected["second_customer_steps"])],
            "meaning":MEANING,"state":"PRODUCER_PREPARED",
            "rendered_product":{"status":"NOT_VERIFIED","client_ready":False}}
        require(prepared==expected_preparation,
                "The complete frozen housing input or its original preparation receipt changed")
        runner=HousingReceiving.__new__(HousingReceiving)
        runner.owned=[];runner.lock=None
        runner.__init__(input_path,root/"receiving")
        result=runner.run()
        checks=course_assertions(result)
        summary={"schema":"commons.housing-authored-result/v1","state":result["state"],
                 "operation_id":OPERATION,"meaning":MEANING,"input":str(input_path),**file_hash(input_path),
                 "workspace_id":binding["workspace_id"],"locations":result["locations"],
                 "report":str(runner.out/"COMPLETE.json"),"assertions":checks,
                 "archives":[{"path":str(runner.out/entry["archive"]["path"]),
                              "bytes":entry["archive"]["bytes"],"sha256":entry["archive"]["sha256"]}
                             for entry in result["deliveries"]],
                 "rendered_product":{"status":"NOT_VERIFIED","client_ready":False},
                 "external_activity":"NONE; local authored source and reference returns only"}
        publish_bytes(root/"COURSE-RESULT.json",encoded(summary))
        return summary
    finally:
        if workspace is not None:
            workspace.close()
        if runner is not None:
            runner.close_all()
            if not runner.owned and runner.lock is not None:
                fcntl.flock(runner.lock,fcntl.LOCK_UN);os.close(runner.lock);runner.lock=None
        fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,
        help="A new owned private directory, or the exact original directory to continue the same operation.")
    args=parser.parse_args(argv)
    result=run(args.directory)
    print(canonical(result))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
