#!/usr/bin/env python3
"""Run the complete authored register example and two editable receiving destinations."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path

from migration_workspace import MigrationWorkspace
from migration_store import canonical, file_hash, regular
from migration_cli import _stage
from migration_portable import APPLICATION_FILES, publish_bytes, canonical as encoded, ordinary_directory
from register_receiving import RegisterReceiving, SCHEMA

HERE = Path(__file__).resolve().parent
OPERATION = "register-authored-example"
ACTOR = "authored-example-operator"
MEANING = ("Authored software example: seven related register families, two complete local editions, "
           "signed financial controls and editable recipient continuation.")

# Every field below belongs to this authored example, not to an external vendor interface.
FIELDS = {
    "people": {"id":"text", "display":"text", "born":"date", "active":"boolean", "attributes":"json"},
    "episodes": {"id":"text", "person":"text", "opened":"date", "closed":"date", "state":"text"},
    "relationships": {"id":"text", "episode":"text", "person":"text", "role":"text", "effective":"datetime"},
    "finance": {"id":"text", "episode":"text", "amount":"decimal", "currency":"text", "period":"text", "category":"text"},
    "documents": {"id":"text", "episode":"text", "version":"text", "name":"text", "recorded":"datetime"},
    "workflow": {"id":"text", "episode":"text", "stage":"text", "owner":"text", "changed":"datetime"},
    "access": {"id":"text", "episode":"text", "principal":"text", "role":"text", "enabled":"boolean", "effective":"date"},
}
REFERENCES = [
    {"id":"episode_person", "register":"episodes", "fields":["person"],
     "to_register":"people", "to_fields":["id"], "required":True, "cardinality":"one"},
    {"id":"relationship_person", "register":"relationships", "fields":["person"],
     "to_register":"people", "to_fields":["id"], "required":True, "cardinality":"one"},
] + [{"id":name+"_episode", "register":name, "fields":["episode"],
      "to_register":"episodes", "to_fields":["id"], "required":True, "cardinality":"one"}
     for name in ("relationships","finance","documents","workflow","access")]
CONTROLS = [{"id":"signed_amount_by_period", "register":"finance", "measure_fields":["amount"],
             "unit_fields":["currency"], "group_fields":["period","category"]}]

def ref(key, lane="producer"):
    return {"$result":lane+":"+key, "pointer":"/id"}

def resolve(value, results):
    if isinstance(value,dict):
        if set(value)=={"$result","pointer"}:
            if value["pointer"]!="/id" or not value["$result"].startswith("producer:"):
                raise ValueError("The example selects exact producer result IDs")
            return results[value["$result"].split(":",1)[1]]["id"]
        return {key:resolve(item,results) for key,item in value.items()}
    if isinstance(value,list):
        return [resolve(item,results) for item in value]
    return value

def definitions(edition, side):
    rows = {
        "people":[
            {"id":"001","display":"Example person A","born":"1980-02-29","active":True,"attributes":{"cohort":"A","tags":["authored"]}},
            {"id":"01","display":"Example person B","born":"1976-07-14","active":True,"attributes":{"cohort":"B","tags":[]}},
        ],
        "episodes":[
            {"id":"E-A","person":"001","opened":"2026-01-01","closed":None,"state":"open"},
            {"id":"E-B","person":"01","opened":"2026-02-01","closed":"2026-09-30","state":"closed"},
        ],
        "relationships":[
            {"id":"R-A","episode":"E-A","person":"001","role":"subject","effective":"2026-01-01T09:00:00+00:00"},
            {"id":"R-B","episode":"E-A","person":"01","role":"contact","effective":"2026-01-01T10:00:00+01:00"},
        ],
        "finance":[
            {"id":"F-1","episode":"E-A","amount":"100.05","currency":"GBP","period":"2026-09","category":"service"},
            {"id":"F-2","episode":"E-A","amount":"50.10","currency":"GBP","period":"2026-09","category":"service"},
            {"id":"F-3","episode":"E-A","amount":"-25.15","currency":"GBP","period":"2026-09","category":"service"},
            {"id":"F-4","episode":"E-B","amount":"70.00","currency":"USD","period":"2026-09","category":"service"},
        ],
        "documents":[
            {"id":"D-1-v1","episode":"E-A","version":"1","name":"Example review record","recorded":"2026-09-01T12:00:00Z"},
            {"id":"D-1-v2","episode":"E-A","version":"2","name":"Example review record","recorded":"2026-09-02T12:00:00Z"},
        ],
        "workflow":[
            {"id":"W-A","episode":"E-A","stage":"review","owner":"example-review-team","changed":"2026-09-03T08:00:00Z"},
            {"id":"W-B","episode":"E-B","stage":"closed","owner":"example-review-team","changed":"2026-09-30T17:00:00Z"},
        ],
        "access":[
            {"id":"A-A","episode":"E-A","principal":"example-operator","role":"reviewer","enabled":True,"effective":"2026-01-01"},
            {"id":"A-B","episode":"E-B","principal":"example-operator","role":"reader","enabled":False,"effective":"2026-09-30"},
        ],
    }
    if edition==2:
        rows["people"].append({"id":"003","display":"Example person C","born":"1990-10-12","active":True,"attributes":{"cohort":"C","tags":["new"]}})
        rows["episodes"].append({"id":"E-C","person":"003","opened":"2026-10-01","closed":None,"state":"open"})
        rows["finance"].append({"id":"F-5","episode":"E-C","amount":"25.00","currency":"GBP","period":"2026-10","category":"service"})
        rows["workflow"].append({"id":"W-C","episode":"E-C","stage":"intake","owner":"example-intake-team","changed":"2026-10-01T09:00:00Z"})
    if edition==1 and side=="target":
        rows["finance"][2]["amount"]="-20.15"
        rows["workflow"][0]["owner"]="example-unassigned"
    for family, population in rows.items():
        for row in population:
            row["source_id"]=family+":"+row["id"]
    return rows

def run(directory):
    root=ordinary_directory(directory,create=True)
    os.chmod(root,0o700)
    lock=os.open(root/"example.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    workspace=None
    runner=None
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BaseException:
        os.close(lock)
        raise
    try:
        marker=root/"EXAMPLE.json"
        if not marker.exists():
            publish_bytes(marker,encoded({"schema":"commons.register-migration-authored-example/v1",
                "created_at":datetime.now(timezone.utc).isoformat(),"meaning":MEANING,
                "identity":"Exact text; 001 and 01 are distinct.",
                "temporal_convention":"Dates are literal values; no interval overlap or endpoint rule is inferred.",
                "finance":"Signed original decimals, currencies and periods; GBP and USD stay separate.",
                "document_meaning":"Authored inventory metadata and versions; external document content is not selected.",
                "access_meaning":"Authored role records; effective target permissions require their own observations."}))
        regular(marker)
        for edition in (1,2):
            folder=ordinary_directory(root/("edition-"+str(edition)),create=True)
            timing=folder/"edition.json"
            if not timing.exists():
                publish_bytes(timing,encoded({"edition":edition,"captured_at":datetime.now(timezone.utc).isoformat(),
                    "meaning":"Publication time of this authored local inventory edition."}))
        input_path=root/"receiving-input.json"
        if not input_path.exists():
            workspace_path=root/"original-workspace"
            workspace=MigrationWorkspace(workspace_path,create=not (workspace_path/"workspace.sqlite3").exists(),
                                         title="Authored register migration example")
            files=[{"key":"example-description","path":str(marker),"filename":marker.name,**file_hash(marker)}]
            steps=[]
            results={}
            first_finding=None
            def apply(key,operation,payload):
                step={"key":key,"operation_id":OPERATION+"-"+key,"operation":operation,"payload":payload,
                      "resume_reason":"Continue this exact retained authored example action."}
                actual=resolve(payload,results)
                request={**actual,"operation_id":step["operation_id"],"actor":ACTOR,
                         "expected_revision":workspace.project["revision"]}
                request_path=root/("request-"+key+".json")
                if request_path.exists():
                    original=json.loads(request_path.read_text())
                    if {k:v for k,v in original.items() if k!="expected_revision"} != {k:v for k,v in request.items() if k!="expected_revision"}:
                        raise ValueError("The authored original action changed")
                    request=original
                publish_bytes(request_path,encoded(request))
                observed=workspace.dispatch("operation.get",{"id":step["operation_id"]})
                if observed["found"] and observed["operation"]["status"]!="SUCCEEDED":
                    resume_path=root/("resume-"+key+".json")
                    control={"operation_id":step["operation_id"]+"-continue", "actor":ACTOR,
                        "expected_revision":workspace.project["revision"],"target_operation_id":step["operation_id"],
                        "reason":step["resume_reason"]}
                    if resume_path.exists():
                        control=json.loads(resume_path.read_text())
                    publish_bytes(resume_path,encoded(control))
                    workspace.dispatch("operation.resume",control)
                returned=workspace.dispatch(operation,request)
                results[key]=returned["result"]
                steps.append(step)
                publish_bytes(root/("accepted-"+key+".json"),encoded({"operation":operation,
                    "operation_id":step["operation_id"],"result":returned["result"]}))
                return returned["result"]
            for edition in (1,2):
                prefix="e"+str(edition)
                folder=root/("edition-"+str(edition))
                captured=json.loads((folder/"edition.json").read_text())["captured_at"]
                selected={"source":[],"target":[]}
                for side in ("source","target"):
                    for family,population in definitions(edition,side).items():
                        key=prefix+"-"+side+"-"+family
                        path=folder/(side+"-"+family+".jsonl")
                        publish_bytes(path,"".join(canonical(row)+"\n" for row in population).encode("utf-8"))
                        files.append({"key":key,"path":str(path),"filename":path.name,**file_hash(path)})
                        staged=_stage(workspace,path)
                        apply(key+"-import","source.import",{
                            "file_sha256":staged["sha256"],"bytes":staged["bytes"],"filename":staged["filename"],
                            "format":"inventory_jsonl","context":{"scope_id":"authored-register-example",
                                "identity_namespace":"authored-records","role":side+"_inventory",
                                "capture_kind":"local_reference","scan_mode":"full","captured_at":captured,
                                "coverage":{"mode":"complete","expected_rows":len(population),
                                    "description":"Complete authored local "+family+" population for edition "+str(edition)+"."},
                                "note":MEANING}})
                        fields={name:{"selector":{"pointer":"/"+name},"type":kind,
                                      "required":not (family=="episodes" and name=="closed")}
                                for name,kind in FIELDS[family].items()}
                        apply(key,"register.dataset.create",{
                            "title":key,"review_note":"Explicit authored source fields; exact text identities and typed values.",
                            "source_id":ref(key+"-import"),"register":family,
                            "system":"authored-origin" if side=="source" else "authored-destination",
                            "side":side,"fields":fields,"key_fields":["id"],
                            **({"parent_dataset_id":ref("e1-"+side+"-"+family)} if edition==2 else {})})
                        selected[side].append(ref(key))
                plan={"title":"Authored edition "+str(edition),"review_note":"Seven complete related authored register populations.",
                    "source_dataset_ids":selected["source"],"cutoff_at":captured,
                    "destinations":{family:"authored-destination" for family in FIELDS},
                    "references":REFERENCES,"controls":CONTROLS,"max_snapshot_age_seconds":0}
                if edition==2:
                    plan["parent_plan_id"]=ref("e1-plan")
                apply(prefix+"-plan","register.plan.create",plan)
                rehearsal={"title":"Authored rehearsal "+str(edition),"review_note":"Independent local authored target inventory.",
                    "plan_id":ref(prefix+"-plan"),"target_dataset_ids":selected["target"]}
                if edition==2:
                    rehearsal["parent_rehearsal_id"]=ref("e1-rehearsal")
                actual_rehearsal=apply(prefix+"-rehearsal","register.rehearsal.create",rehearsal)
                if edition==1:
                    found=workspace.dispatch("register.rehearsal.items",{"id":actual_rehearsal["id"],
                        "kind":"record","register":"finance","status":"DIFFERENT","offset":0,"limit":500})
                    if found["total"]!=1 or len(found["rows"])!=1:
                        raise ValueError("The original authored finance difference is not retained")
                    first_finding=found["rows"][0]
                    evidence=[row["source_row_id"] for row in first_finding["source_rows"]]
                    apply("finding-review","register.review.create",{
                        "title":"Correct the original signed amount","rehearsal_id":ref("e1-rehearsal"),
                        "item_id":first_finding["id"],"disposition":"rework",
                        "reason":"The first target refund differs by 5 GBP; the second authored edition corrects it.",
                        "evidence_row_ids":evidence})
                    apply("first-cutover","register.cutover.create",{
                        "title":"First authored edition review","rehearsal_ids":[ref("e1-rehearsal")],
                        "decision":"hold","reason":"The selected first target retains a refund and workflow-owner difference.",
                        "acceptance_owner":ACTOR})
                else:
                    apply("second-cutover","register.cutover.create",{
                        "title":"Second authored edition review","rehearsal_ids":[ref("e2-rehearsal")],
                        "decision":"approved","reason":"The complete second authored populations and exact selected controls agree.",
                        "acceptance_owner":ACTOR,"parent_cutover_id":ref("first-cutover")})
            if first_finding is None:
                raise ValueError("The original first finding was not selected")
            value={"schema":SCHEMA,"operation_id":OPERATION,"title":"Authored register migration and editable receiving",
                "actor":ACTOR,"authorization":MEANING,
                "workspace":{"path":str(workspace.root),"id":workspace.project["id"],
                             "expected_revision":workspace.project["revision"]},
                "application":[{"path":name,**file_hash(HERE/name)} for name in APPLICATION_FILES],
                "source_files":files,"steps":steps,"delivery_resume_reason":"Continue the exact retained authored delivery.",
                "comparison":{"before_id":ref("e1-rehearsal"),"after_id":ref("e2-rehearsal")},
                "customer_steps":[
                    {"key":"recipient-note","operation_id":OPERATION+"-recipient-note","operation":"workspace.update",
                     "payload":{"title":"Recipient edition of the authored register example",
                                "note":"Recipient independently retained review and cutover continuation."}},
                    {"key":"recipient-review","operation_id":OPERATION+"-recipient-review","operation":"register.review.create",
                     "payload":{"title":"Close the superseded first-edition rework","rehearsal_id":ref("e1-rehearsal"),
                        "item_id":first_finding["id"],"disposition":"withdrawn","parent_review_id":ref("finding-review"),
                        "reason":"The second independent target edition corrects the signed amount; retain the original finding.",
                        "evidence_row_ids":[row["source_row_id"] for row in first_finding["source_rows"]]}},
                    {"key":"recipient-cutover","operation_id":OPERATION+"-recipient-cutover","operation":"register.cutover.create",
                     "payload":{"title":"Recipient second-edition review","rehearsal_ids":[ref("e2-rehearsal")],
                        "decision":"approved","reason":"Recipient reviewed the complete corrected authored edition.",
                        "acceptance_owner":"authored-example-recipient","parent_cutover_id":ref("second-cutover")}},
                ]}
            for step in value["customer_steps"]:
                step["resume_reason"]="Continue this exact retained recipient action."
            publish_bytes(input_path,encoded(value))
            workspace.close()
            workspace=None
        runner=RegisterReceiving.__new__(RegisterReceiving)
        runner.owned=[]
        runner.lock=None
        runner.__init__(input_path,root/"receiving")
        result=runner.run()
        return {"state":result["state"],"operation_id":result["operation_id"],
                "report":str(runner.out/"COMPLETE.json"),"meaning":MEANING}
    finally:
        errors=[]
        if workspace is not None:
            try:workspace.close()
            except BaseException as error:errors.append(error)
        if runner is not None:
            try:runner.close_all()
            except BaseException as error:errors.append(error)
            if not runner.owned and runner.lock is not None:
                fcntl.flock(runner.lock,fcntl.LOCK_UN)
                os.close(runner.lock)
                runner.lock=None
        # Preserve the native lease when an owned resource cannot close; process exit releases it.
        if not errors:
            fcntl.flock(lock,fcntl.LOCK_UN)
            os.close(lock)
        if errors:
            raise errors[0]

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,help="Private original authored-example directory")
    args=parser.parse_args(argv)
    print(canonical(run(args.directory)))

if __name__=="__main__":
    main()
