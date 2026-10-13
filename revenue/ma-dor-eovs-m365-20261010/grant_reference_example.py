#!/usr/bin/env python3
"""Full local requirements-review example; never a Grant Tracker or OmniStar tenant export."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path

from migration_workspace import MigrationWorkspace
from migration_store import canonical, identity, file_hash
from migration_cli import _stage
from migration_portable import APPLICATION_FILES, publish_bytes, canonical as encoded, ordinary_directory
from grant_receiving import GrantReceiving, FAMILIES, SCHEMA

HERE=Path(__file__).resolve().parent
SOURCES=[
 {"id":"S1","url":"https://www.symplectic.co.uk/blog/important-update-symplectic-grant-tracker-to-be-sunset-by-december-2026/",
  "meaning":"Published 14 July 2025; planned 31 December 2026 sunset. Individual customer offboarding controls."},
 {"id":"S2","url":"https://www.omnistar.cloud/compare/symplectic-omnistar-migration-toolkit",
  "meaning":"Twelve capability areas and existing automated/hybrid migration services; no selected field schema."},
 {"id":"S3","url":"https://www.omnistar.cloud/security",
  "meaning":"Supplied migration templates, bespoke implementation service and ID-bearing spreadsheet export. Public page does not specify API routes/signature construction."},
 {"id":"S4","url":"https://www.omnistar.cloud/products",
  "meaning":"Spreadsheet migration can create/update supported entities; the institution's actual template/version remains required."},
 {"id":"S5","url":"https://dementiaconnect.alzheimers.org.uk/what-we-do/researchers/our-application-process/migration-grant-tracker-omnistar",
  "meaning":"Historical institution transition guidance illustrates outline/full continuity and separate credentials. It is not a selected customer export."}
]
AREAS=[
 ("applications","Retain form and outline/full application continuity."),
 ("review_panels","Retain panel membership and decision context."),
 ("workflow","Review state transitions, approvals and cutoff authority."),
 ("reviewers","Retain assignments, conflicts and confidentiality decisions."),
 ("programmes","Retain programme, round and form-version meaning."),
 ("documents","Retain each document version and its original associations."),
 ("awards","Retain award letters and amendment history."),
 ("payments","Distinguish scheduled, milestone and claim payments, partial payments and refunds."),
 ("reporting","Review report definitions and configurations separately from copied rows."),
 ("integrations","Review supported interfaces and re-authentication separately."),
 ("access","Review roles and round access independently from copied records."),
 ("training","Retain operator training and transition responsibilities.")
]

def ref(key):return {"$result":"producer:"+key,"pointer":"/id"}
def resolve(value,results):
    if isinstance(value,dict):
        if set(value)=={"$result","pointer"}:
            if value["pointer"]!="/id":raise ValueError("Example selects exact IDs only")
            return results[value["$result"].split(":",1)[1]]["id"]
        return {k:resolve(v,results) for k,v in value.items()}
    if isinstance(value,list):return [resolve(v,results) for v in value]
    return value

def run(directory):
    root=ordinary_directory(directory,create=True)
    os.chmod(root,0o700)
    lock=os.open(root/"example.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    workspace=None;runner=None
    try:
        seed_path=root/"source-register.json"
        if not seed_path.exists():
            publish_bytes(seed_path,encoded({"schema":"commons.grant-public-reference-example/v1",
             "created_at":datetime.now(timezone.utc).isoformat(),"sources":SOURCES,
             "meaning":"Operator-authored requirements and mapping review. All rows are local design records, not tenant/application/award rows."}))
        seed=json.loads(seed_path.read_text())
        # Both edition times are actual local publication times and retained before any action.
        for period in (1,2):
            folder=ordinary_directory(root/("edition-"+str(period)),create=True)
            marker=folder/"edition.json"
            if not marker.exists():
                now=datetime.now(timezone.utc).isoformat()
                publish_bytes(marker,encoded({"period":period,"captured_at":now,
                 "meaning":"Local operator requirements-review edition; no vendor load or returned tenant result."}))
        input_path=root/"receiving-input.json"
        if not input_path.exists():
            workspace_path=root/"original-workspace"
            workspace=MigrationWorkspace(workspace_path,create=not (workspace_path/"workspace.sqlite3").exists(),
                                         title="Public grant migration requirements review")
            files=[{"key":"public_register","path":str(seed_path),"filename":seed_path.name,**file_hash(seed_path)}]
            _stage(workspace,seed_path)
            steps=[];results={};periods=[];first_rehearsal=None
            def apply(key,operation,payload):
                step={"key":key,"operation_id":"grant-public-reference-"+key,"operation":operation,"payload":payload}
                actual=resolve(payload,results)
                request={**actual,"operation_id":step["operation_id"],"actor":"public-reference-operator",
                         "expected_revision":workspace.project["revision"]}
                # Native Store reserves and retains the original ID/request before executing.
                returned=workspace.dispatch(operation,request)
                results[key]=returned["result"];steps.append(step)
                publish_bytes(root/("accepted-"+key+".json"),encoded({"operation":operation,"operation_id":step["operation_id"],
                              "result":returned["result"]}))
                return returned["result"]
            for period in (1,2):
                prefix="e"+str(period);folder=root/("edition-"+str(period))
                captured=json.loads((folder/"edition.json").read_text())["captured_at"]
                definitions={
                  "programmes":[{"id":"grant_migration","status":"active","label":"Public migration requirements",
                                 "requirement":"Institution-specific source, target template and acceptance remain required.","source_ids":["S1","S2","S3","S4","S5"]}],
                  "workflows":[{"id":key,"status":"active","label":key.replace("_"," ").title(),"requirement":meaning,
                                "programme":"grant_migration","source_ids":["S2"]} for key,meaning in AREAS]}
                selected={}
                for side in ("source","target"):
                    selected[side]=[]
                    for family,records in definitions.items():
                        # These are actual operator design selections. Target means the
                        # local review register only, never an OmniStar returned export.
                        rows=[dict(row) for row in records]
                        if side=="target" and period==1 and family=="workflows":
                            rows[3]["requirement"]="Operator review pending: retain complete reviewer obligations."
                        file=folder/(side+"-"+family+".jsonl")
                        raw="".join(canonical(row)+"\n" for row in rows).encode("utf-8")
                        publish_bytes(file,raw);key=prefix+"-"+side+"-"+family
                        item={"key":key,"path":str(file),"filename":file.name,**file_hash(file)};files.append(item)
                        staged=_stage(workspace,file)
                        imported=apply(key+"-import","source.import",{
                          "file_sha256":staged["sha256"],"bytes":staged["bytes"],"filename":staged["filename"],"format":"inventory_jsonl",
                          "context":{"scope_id":"grant-public-requirements","identity_namespace":"operator_requirements",
                           "role":"source_inventory" if side=="source" else "target_inventory","capture_kind":"local_reference",
                           "coverage":"complete","captured_at":captured,"note":"Complete operator-authored requirements register only; no tenant data."}})
                        columns={name:{"pointer":"/"+original} for name,original in
                                 {"case_id":"id","status":"status","label":"label","requirement":"requirement","source_ids":"source_ids"}.items()}
                        if family=="workflows":columns["programme"]={"pointer":"/programme"}
                        apply(key,"case.dataset.create",{"title":key,"review_note":"Exact local design fields; not native vendor columns.",
                          "source_id":ref(key+"-import"),"kind":"cases","side":side,
                          "destination":None if side=="source" else "operator_review","record_family":family,
                          "identity_scopes":{"case_id":family},"columns":columns})
                        selected[side].append(ref(key))
                plan=prefix+"-plan";rehearsal=prefix+"-rehearsal"
                payload={"title":"Public requirements edition "+str(period),"review_note":"Operator source specification review; no customer acceptance.",
                  "source_dataset_ids":selected["source"],"cutoff_at":captured,"live_statuses":["active"],"closed_statuses":["historical"],
                  "document_identity":"document_id","multi_case_policy":"require_single_destination",
                  "destination_policy":{"live_cases":"operator_review","live_documents":"operator_review","closed_cases":"operator_history","closed_documents":"operator_history"},
                  "family_checks":{"programmes":["label","requirement","source_ids"],"workflows":["label","requirement","source_ids"]},
                  "relation_rules":[{"id":"workflow_programme","source_family":"workflows","field":"programme",
                                    "target_family":"programmes","target_kind":"cases","target_scope":"programmes","cardinality":"one","required":True}]}
                if period==2:payload["parent_plan_id"]=ref("e1-plan")
                apply(plan,"case.plan.create",payload)
                rp={"title":"Local requirements review "+str(period),"note":"Independent operator register, not a vendor migrated-data result.",
                    "plan_id":ref(plan),"target_dataset_ids":selected["target"]}
                if period==2:rp["parent_rehearsal_id"]=ref("e1-rehearsal")
                value=apply(rehearsal,"case.rehearsal.create",rp)
                if period==1:
                    first_rehearsal=value
                    item=workspace.dispatch("case.rehearsal.items",{"id":value["id"],"status":"DIFFERENT","limit":1})["rows"][0]
                    apply("review","case.review.create",{"rehearsal_id":ref(rehearsal),"item_id":item["id"],
                       "disposition":"rework","reason":"Complete the explicitly pending reviewer obligations in this local requirements design."})
                    apply("hold","case.cutover.create",{"rehearsal_id":ref(rehearsal),"title":"Public requirements example",
                       "decision":"hold","reason":"No institution, template, tenant export or vendor load is supplied.",
                       "owner":"public-reference-operator","rollback":"Preserve the original design and both review editions.","tasks":[]})
                periods.append({"label":"operator-design-"+str(period),"cutoff_at":captured,"plan_key":plan,"rehearsal_key":rehearsal})
            value={"schema":"commons.case-migration-receiving/v1","operation_id":"grant-public-reference",
             "title":"Public grant requirements review and editable receiving","actor":"public-reference-operator",
             "authorization":"Local operator-authored public-source design review, complete portable receiving and recipient edit; no institution/vendor operation.",
             "workspace":{"path":str(workspace.root),"id":workspace.project["id"],"expected_revision":workspace.project["revision"]},
             "application":[{"path":name,**file_hash(HERE/name)} for name in APPLICATION_FILES],
             "source_files":files,"steps":steps,"customer_steps":[{"key":"recipient-note","operation_id":"grant-public-reference-recipient-note",
              "operation":"workspace.update","payload":{"title":"Recipient review of public grant requirements","note":"Recipient edited this local design. No customer migration is inferred."}}],
             "comparison":{"before_id":ref("e1-rehearsal"),"after_id":ref("e2-rehearsal")},
             "grant_contract":{"schema":SCHEMA,"mode":"public_reference_review","title":"Public requirements operating example",
              "scope_note":"Thirteen operator-authored programme/workflow design records. Two local review editions, zero tenant rows or vendor returns.",
              "source_owner":"public-reference-operator","target_loader":"None; local operator review register",
              "acceptance_owner":"None; no institution acceptance claimed",
              "families":{family:{"kind":"cases","identity_scope":family,
                 "meaning":"Local public-requirements "+family+" definition, not tenant records",
                 "compare_fields":["label","requirement","source_ids"]} for family in ("programmes","workflows")},
              "excluded_families":{family:"No institution export or population supplied; excluded from this public requirements example."
                                    for family in FAMILIES if family not in ("programmes","workflows")},
              "interface_evidence":[{"kind":"public_source","status":"retained","source_file":"public_register",
                 "description":"Exact authored source register, URLs and explicit factual limitations."}],
              "periods":periods}}
            publish_bytes(input_path,encoded(value))
            workspace.close();workspace=None
        runner=GrantReceiving.__new__(GrantReceiving);runner.owned=[];runner.lock=None
        runner.__init__(input_path,root/"receiving");result=runner.run()
        return {"state":result["state"],"operation_id":result["operation_id"],
                "report":str(runner.out/"COMPLETE.json"),"meaning":"Completed local public requirements review and two editable receivers only."}
    finally:
        if workspace is not None:workspace.close()
        if runner is not None:
            runner.close_all()
            if runner.lock is not None:fcntl.flock(runner.lock,fcntl.LOCK_UN);os.close(runner.lock)
        fcntl.flock(lock,fcntl.LOCK_UN);os.close(lock)

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--directory",required=True);a=p.parse_args(argv)
    print(canonical(run(a.directory)))
if __name__=="__main__":main()
