#!/usr/bin/env python3
"""Complete authored adviser migration course using the original workspace and portable receiver."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
from migration_workspace import MigrationWorkspace
from migration_store import canonical, file_hash, regular, MigrationError
from migration_cli import _stage
from migration_portable import publish_bytes, canonical as encoded, ordinary_directory, receive_delivery, inspect_delivery
from adviser_workspace import FAMILIES

HERE=Path(__file__).resolve().parent
SCHEMA="commons.adviser-migration-receiving/v1"
ACTOR="authored-adviser-course-operator"
MEANING="Authored local software course. Every person, workflow, recurrence and returned target value is an example, not an observation of a customer or Wealthbox tenant."

def source_rows(documents):
    recurring={"frequency":"monthly","interval":1,"timezone":"America/New_York","local_start":"09:00",
               "start_date":"2026-11-01","end_rule":{"kind":"none"},"owner_id":"staff-current",
               "next_occurrence":"2026-11-01T09:00:00-05:00"}
    rows={key:[{"id":key+"-1","contact_id":"001","definition":{"kind":key,"title":"EXAMPLE: "+hint["title"]}}] for key,hint in FAMILIES.items()}
    rows["contacts"]=[
        {"id":"001","contact_id":"001","definition":{"type":"person","name":"EXAMPLE: Taylor Reed","owner_id":"staff-current","visibility":["team-service"]}},
        {"id":"01","contact_id":"01","definition":{"type":"person","name":"EXAMPLE: Morgan Reed","owner_id":"staff-current","visibility":["team-service"]}},
        {"id":"H1","contact_id":"H1","definition":{"type":"household","name":"EXAMPLE: Reed household","visibility":["team-service"]}}]
    rows["relationships"]=[{"id":"relationship-1","contact_id":"001","definition":{"from":"001","to":"H1","role":"household member"}},
                           {"id":"relationship-2","contact_id":"01","definition":{"from":"01","to":"H1","role":"household member"}}]
    rows["principals"]=[{"id":"staff-current","contact_id":"001","definition":{"name":"EXAMPLE: current adviser","active":True,"team":"team-service","roles":["adviser"]}},
                        {"id":"staff-legacy","contact_id":"001","definition":{"name":"EXAMPLE: historical author","active":False,"roles":[],"history_attribution":"Retain original author; no active login"}}]
    rows["recurring_work"]=[{"id":"recurrence-1","contact_id":"001","definition":recurring}]
    rows["workflow_templates"][0]["definition"]={"title":"EXAMPLE: Annual review","steps":[{"id":"prepare","owner":"staff-current"},{"id":"meeting","depends_on":["prepare"]},{"id":"followup","depends_on":["meeting"]}]}
    rows["active_workflows"][0]["definition"]={"template_id":"workflow_templates-1","completed":["prepare"],"active":["meeting"],"future":["followup"],"owner_id":"staff-current"}
    rows["document_versions"]=[{"id":"doc-v"+str(i),"contact_id":"001","definition":{"document_id":"doc-original","version":str(i),"filename":v["filename"],"content_sha256":v["sha256"],"bytes":v["bytes"],"visibility":["team-service"]}} for i,v in enumerate(documents,1)]
    rows["access_rules"][0]["definition"]={"workspace":"EXAMPLE: service workspace","principal":"team-service","record_id":"001","visibility":"team","observation":"Authored explicit configuration only"}
    rows["email_templates"][0]["definition"]={"title":"EXAMPLE: Review invitation","subject":"Your review","body":"Hello {{first_name}},\nPlease choose a review time.\nRegards,\nEXAMPLE adviser"}
    rows["report_templates"][0]["definition"]={"title":"EXAMPLE: Upcoming reviews","columns":["contact_id","owner_id","next_occurrence"],"filters":{"status":"active"},"sort":["next_occurrence","contact_id"]}
    return rows

def run(directory, browser_command=None):
    root=ordinary_directory(directory,create=True);os.chmod(root,0o700)
    lock=os.open(root/"course.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    ws=None
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        marker=root/"course.json"
        if not marker.exists():
            publish_bytes(marker,encoded({"schema":SCHEMA,"operation_id":"adviser-authored-course",
                "created_at":datetime.now(timezone.utc).isoformat(),"meaning":MEANING}))
        state=json.loads(marker.read_text())
        if state["schema"]!=SCHEMA:raise ValueError("Choose the original adviser course directory")
        cutoff=state["created_at"]
        requests=ordinary_directory(root/"requests",create=True)
        originals=ordinary_directory(root/"originals",create=True)
        wpath=root/"workspace"
        ws=MigrationWorkspace(wpath,create=not (wpath/"workspace.sqlite3").exists(),title="EXAMPLE: Adviser migration commissioning")
        results={}
        def apply(key,operation,payload):
            path=requests/(key+".json")
            intent={**payload,"operation_id":"adviser-course-"+key,"actor":ACTOR,"expected_revision":ws.project["revision"]}
            if path.exists():
                saved=json.loads(path.read_text())
                if {k:v for k,v in saved.items() if k!="expected_revision"}!={k:v for k,v in intent.items() if k!="expected_revision"}:
                    raise ValueError("The original selected course request changed: "+key)
                intent=saved
            publish_bytes(path,encoded(intent))
            observed=ws.dispatch("operation.get",{"id":intent["operation_id"]})
            if observed["found"] and observed["operation"]["status"]!="SUCCEEDED":
                resume_path=requests/(key+"-resume.json")
                resume={"operation_id":intent["operation_id"]+"-resume","actor":ACTOR,
                        "expected_revision":ws.project["revision"],"target_operation_id":intent["operation_id"],
                        "reason":"Continue the same complete authored adviser course request."}
                if resume_path.exists():resume=json.loads(resume_path.read_text())
                publish_bytes(resume_path,encoded(resume))
                ws.dispatch("operation.resume",resume)
            answer=ws.dispatch(operation,intent)
            result=answer["result"];results[key]=result
            publish_bytes(root/("accepted-"+key+".json"),encoded({"operation":operation,"request":intent,"result":result}))
            return result
        rejections=[]
        def reject(key,payload,expected_code):
            path=requests/(key+".json")
            intent={**payload,"operation_id":"adviser-course-"+key,"actor":ACTOR,"expected_revision":ws.project["revision"]}
            if path.exists():
                saved=json.loads(path.read_text())
                if {k:v for k,v in saved.items() if k!="expected_revision"}!={k:v for k,v in intent.items() if k!="expected_revision"}:
                    raise ValueError("The original rejected course request changed: "+key)
                intent=saved
            publish_bytes(path,encoded(intent))
            observed=ws.dispatch("operation.get",{"id":intent["operation_id"]})
            if not observed["found"]:
                try:ws.dispatch("adviser.work.create",intent)
                except MigrationError as exc:
                    if exc.code!=expected_code:raise
                else:raise AssertionError("Invalid identity was accepted: "+key)
                observed=ws.dispatch("operation.get",{"id":intent["operation_id"]})
            retained=observed["operation"]
            if retained["status"]!="INTERRUPTED" or retained["error"]["code"]!=expected_code:
                raise AssertionError("The original rejected identity receipt changed: "+key)
            if any(ws.get_entity("adviser_work",row[0])["operation_id"]==intent["operation_id"] for row in ws.conn.execute("SELECT id FROM entities WHERE kind='adviser_work'")):
                raise AssertionError("Rejected identity produced an accepted work record")
            receipt={"operation":"adviser.work.create","request":intent,"receipt":retained}
            publish_bytes(root/("rejected-"+key+".json"),encoded(receipt))
            rejections.append(receipt)
        def intake(key,body,filename,format_name,side=None,count=0):
            path=originals/filename;publish_bytes(path,body)
            staged=_stage(ws,path)
            context={"scope_id":"adviser-authored-course","identity_namespace":"authored-adviser-records",
                     "role":side+"_inventory" if side else "attachment","capture_kind":"local_reference",
                     "scan_mode":"full","captured_at":cutoff,
                     "coverage":{"mode":"complete","expected_rows":count,"description":"Complete original authored "+key},
                     "note":MEANING}
            return apply(key,"source.import",{"file_sha256":staged["sha256"],"bytes":staged["bytes"],"filename":filename,"format":format_name,"context":context})
        document_specs=[]
        for number in (1,2):
            body=("EXAMPLE original document version "+str(number)+".\nOriginal version history remains complete.\n").encode()
            filename="example-document-v"+str(number)+".txt"
            src=intake("document-file-"+str(number),body,filename,"attachment")
            document_specs.append({"source":src,"filename":filename,"sha256":src["file_sha256"],"bytes":src["bytes"]})
        evidence=intake("inspection-evidence",encoded({"schema":SCHEMA+"/evidence","meaning":MEANING,
            "review":"Original authored target definitions observed in this local course.","captured_at":cutoff}),"example-inspection.json","attachment")
        populations=source_rows(document_specs)
        datasets={"source":{},"target-first":{},"target-final":{}}
        fields={"id":{"selector":{"pointer":"/id"},"type":"text","required":True},
                "contact_id":{"selector":{"pointer":"/contact_id"},"type":"text","required":True},
                "definition":{"selector":{"pointer":"/definition"},"type":"json","required":True}}
        for edition in datasets:
            side="source" if edition=="source" else "target"
            for family,population in populations.items():
                rows=json.loads(json.dumps(population))
                if edition=="target-first" and family=="recurring_work":
                    rows[0]["definition"]={"history_imported":True,"repeating_settings":None}
                if edition=="target-first" and family=="document_versions":rows=rows[:1]
                key=edition+"-"+family
                src=intake(key+"-source","".join(canonical(row)+"\n" for row in rows).encode(),key+".jsonl","inventory_jsonl",side,len(rows))
                selected_fields=json.loads(json.dumps(fields))
                if family=="document_versions":
                    selected_fields.update({"content_sha256":{"selector":{"pointer":"/definition/content_sha256"},"type":"text","required":True},
                                            "bytes":{"selector":{"pointer":"/definition/bytes"},"type":"decimal","required":True}})
                datasets[edition][family]=apply(key,"register.dataset.create",{
                    "title":"EXAMPLE: "+key,"review_note":"Exact authored columns and values, selected by the software course operator.",
                    "source_id":src["id"],"register":family,"system":"authored-origin" if side=="source" else "authored-destination",
                    "side":side,"fields":selected_fields,"key_fields":["id"],
                    **({"parent_dataset_id":datasets["target-first"][family]["id"]} if edition=="target-final" else {})})
        plan=apply("plan","register.plan.create",{"title":"EXAMPLE: Adviser original source and destination","review_note":MEANING,
            "source_dataset_ids":[v["id"] for v in datasets["source"].values()],"cutoff_at":cutoff,
            "destinations":{key:"authored-destination" for key in FAMILIES},"max_snapshot_age_seconds":0,
            "references":[{"id":key+"_contact","register":key,"fields":["contact_id"],"to_register":"contacts","to_fields":["id"],"required":True,"cardinality":"one"} for key in FAMILIES if key!="contacts"]})
        programme=apply("programme","adviser.programme.create",{"title":"EXAMPLE: Complete adviser migration",
            "purpose":"Original people, relationships, historical attribution, reconstructed configuration and complete document versions.",
            "owner":ACTOR,"source_system":"authored-origin","target_system":"authored-destination","review_note":MEANING,
            "plan_id":plan["id"],"families":{key:{"status":"selected","reason":"Complete authored original family retained.",
                "source_dataset_ids":[datasets["source"][key]["id"]],"reconstruction_required":hint["reconstruction"]} for key,hint in FAMILIES.items()},
            "evidence_source_ids":[evidence["id"]]})
        first=apply("first-rehearsal","register.rehearsal.create",{"title":"EXAMPLE: Initial independent return",
            "review_note":"Retains missing document version and history-only recurrence as actual authored differences.",
            "plan_id":plan["id"],"target_dataset_ids":[v["id"] for v in datasets["target-first"].values()]})
        first_cutover=apply("first-cutover","register.cutover.create",{"title":"EXAMPLE: Hold initial return","decision":"hold",
            "reason":"Original recurrence configuration and a document version remain unresolved.","acceptance_owner":ACTOR,
            "rehearsal_ids":[first["id"]],"accepted_review_ids":[]})
        if not first_cutover["summary"]["unresolved_count"]:raise AssertionError("The original incomplete return lost its differences")
        apply("first-release","adviser.release.create",{"programme_id":programme["id"],"title":"EXAMPLE: Initial commissioning hold",
            "decision":"hold","reason":"Retain all unassigned configuration work and actual returned differences.",
            "acceptance_owner":ACTOR,"cutover_id":first_cutover["id"],"work_ids":[]})
        all_work=[]
        for family,hint in FAMILIES.items():
            if not hint["reconstruction"]:continue
            source_page=ws.dispatch("register.dataset.rows",{"id":datasets["source"][family]["id"],"limit":500})
            target_page=ws.dispatch("register.dataset.rows",{"id":datasets["target-final"][family]["id"],"limit":500})
            original_by_id={v["id"]:v for v in populations[family]}
            for item in source_page["rows"]:
                actual=original_by_id[item["values"]["id"]]
                target=next(v for v in target_page["rows"] if v["key"]==item["key"])
                key=family+"-"+str(item["ordinal"])
                source_ref={"dataset_id":item["dataset_id"],"row_id":item["id"]}
                planned=apply(key+"-planned","adviser.work.create",{"programme_id":programme["id"],"family":family,
                    "source_rows":[source_ref],"title":"EXAMPLE: Reconstruct "+actual["id"],"owner":ACTOR,
                    "reason":"Selected full original definition for the local authored reconstruction.","method":"recreate",
                    "status":"planned","requested_definition":actual["definition"]})
                payload={"programme_id":programme["id"],"family":family,"source_rows":[source_ref],
                    "title":planned["title"],"owner":ACTOR,"reason":"Exact original typed definition matches the independent authored target capture.",
                    "method":"recreate","status":"verified","parent_work_id":planned["id"],
                    "requested_definition":actual["definition"],"expected_fields":{"definition":actual["definition"]},
                    "target_rows":[{"dataset_id":target["dataset_id"],"row_id":target["id"]}],
                    "target_links":[{"source_row_id":item["id"],"target_row_id":target["id"],"reason":"The authored original external identity and full definition identify this exact returned occurrence."}],
                    "verified_by":ACTOR,"verified_at":cutoff,"evidence_source_ids":[evidence["id"]]}
                if family=="document_versions":
                    spec=document_specs[int(actual["definition"]["version"])-1]
                    payload["document_files"]=[{"source_row_id":item["id"],"source_id":spec["source"]["id"],"sha256_field":"content_sha256","bytes_field":"bytes"}]
                    if actual["definition"]["version"]=="1":
                        wrong=json.loads(json.dumps(payload))
                        wrong["document_files"][0]["source_id"]=document_specs[1]["source"]["id"]
                        reject("wrong-document-version",wrong,"ADVISER_DOCUMENT_IDENTITY")
                all_work.append(apply(key+"-verified","adviser.work.create",payload))
        # The separate person/household rows retain explicit individual associations.
        people=ws.dispatch("register.dataset.rows",{"id":datasets["source"]["contacts"]["id"],"limit":500})["rows"]
        returned_people=ws.dispatch("register.dataset.rows",{"id":datasets["target-final"]["contacts"]["id"],"limit":500})["rows"]
        person_values={v["id"]:v["definition"] for v in populations["contacts"]}
        person_refs=[{"dataset_id":v["dataset_id"],"row_id":v["id"]} for v in people]
        people_plan=apply("people-associations-planned","adviser.work.create",{"programme_id":programme["id"],"family":"contacts",
            "source_rows":person_refs,"title":"EXAMPLE: Separate people and household identities","owner":ACTOR,
            "reason":"Retain 001, 01 and H1 as distinct source identities.","method":"link_existing","status":"planned"})
        people_payload={"programme_id":programme["id"],"family":"contacts","source_rows":person_refs,
            "title":people_plan["title"],"owner":ACTOR,"reason":"Each original person and household is associated with its exact returned definition.",
            "method":"link_existing","status":"verified","parent_work_id":people_plan["id"],
            "target_rows":[{"dataset_id":v["dataset_id"],"row_id":v["id"]} for v in returned_people],
            "target_links":[{"source_row_id":v["id"],"target_row_id":next(t["id"] for t in returned_people if t["key"]==v["key"]),
                            "reason":"Original external identity "+v["values"]["id"]+" and complete record type agree.",
                            "expected_fields":{"definition":person_values[v["values"]["id"]]}} for v in people],
            "verified_by":ACTOR,"verified_at":cutoff,"evidence_source_ids":[evidence["id"]]}
        wrong_people=json.loads(json.dumps(people_payload))
        wrong_people["target_links"][0]["target_row_id"],wrong_people["target_links"][1]["target_row_id"]=(
            wrong_people["target_links"][1]["target_row_id"],wrong_people["target_links"][0]["target_row_id"])
        reject("wrong-person-association",wrong_people,"ADVISER_VERIFICATION")
        all_work.append(apply("people-associations-verified","adviser.work.create",people_payload))
        final=apply("final-rehearsal","register.rehearsal.create",{"title":"EXAMPLE: Complete independently returned target",
            "review_note":"All original definitions and exact document versions are retained in this authored target return.",
            "plan_id":plan["id"],"target_dataset_ids":[v["id"] for v in datasets["target-final"].values()]})
        cutover=apply("final-cutover","register.cutover.create",{"title":"EXAMPLE: Complete original register review",
            "decision":"approved","reason":"All authored record and relationship checks match the complete independent return.",
            "acceptance_owner":ACTOR,"rehearsal_ids":[final["id"]],"accepted_review_ids":[],"parent_cutover_id":first_cutover["id"]})
        current=ws.dispatch("adviser.programme.assessment",{"id":programme["id"]})
        release=apply("final-release","adviser.release.create",{"programme_id":programme["id"],"title":"EXAMPLE: Commissioning review complete",
            "decision":"approved","reason":"Full original reconstruction, actual authored target checks and original document bytes retained.",
            "acceptance_owner":ACTOR,"cutover_id":cutover["id"],"work_ids":current["current_work_ids"],"evidence_source_ids":[evidence["id"]]})
        exports=ordinary_directory(root/"exports",create=True)
        for kind,value in (("adviser_programme",programme),("adviser_release",release)):
            for fmt in ("csv","ndjson"):
                body=b"".join(ws.iter_export(kind,value["id"],format=fmt))
                publish_bytes(exports/(kind+"."+fmt),body)
        before_revision=ws.project["revision"]
        request=json.loads((requests/"final-release.json").read_text())
        replay=ws.dispatch("adviser.release.create",request)
        if replay["result"]!=release or ws.project["revision"]!=before_revision:raise AssertionError("The original accepted release replay changed its result or revision")
        delivery=apply("portable","delivery.prepare",{"title":"EXAMPLE: Complete adviser commissioning workspace",
            "note":"All original files, accepted operations, reconstruction evidence and complete application source."})
        archive=ws.root/delivery["relative_path"]
        inspected=inspect_delivery(archive)
        destination=root/"received"
        received=receive_delivery(archive,destination)
        ws.close();ws=None
        cold=MigrationWorkspace(destination/"workspace")
        try:
            if cold.dispatch("adviser.release.get",{"id":release["id"]})!=release:raise AssertionError("Cold receive changed the complete release")
            if cold.dispatch("adviser.programme.assessment",{"id":programme["id"]})["current_work_ids"]!=current["current_work_ids"]:raise AssertionError("Cold receive lost current reconstruction ownership")
            for original in document_specs:
                with cold.open_file(original["sha256"]) as handle:
                    if handle.read()!= (originals/original["filename"]).read_bytes():raise AssertionError("Cold receive lost original document bytes")
            native=cold.dispatch("adviser.release.create",request)
            if native["result"]!=release:raise AssertionError("Cold receive changed the original accepted request")
            # Ordinary editable continuation: later work remains after repeated same-source receiving.
            later_request_path=requests/"received-workspace-update.json"
            later={"operation_id":"adviser-course-received-note","actor":ACTOR,"expected_revision":cold.project["revision"],
                   "title":"EXAMPLE: Received adviser commissioning workspace","note":"Recipient opened the complete source, reviewed it and continued the original project."}
            if later_request_path.exists():later=json.loads(later_request_path.read_text())
            publish_bytes(later_request_path,encoded(later))
            edited=cold.dispatch("workspace.update",later)
            continued_revision=cold.project["revision"]
        finally:cold.close()
        receive_delivery(archive,destination)
        cold=MigrationWorkspace(destination/"workspace")
        try:
            if cold.project["revision"]!=continued_revision:raise AssertionError("Repeated source receiving replaced later recipient work")
            if cold.dispatch("operation.get",{"id":"adviser-course-received-note"})["operation"]["status"]!="SUCCEEDED":raise AssertionError("Recipient continuation is absent")
        finally:cold.close()
        receipt={"schema":SCHEMA,"state":"NATIVE_COMPLETE","meaning":MEANING,"project_id":inspected["manifest"]["workspace_id"],
            "programme_id":programme["id"],"release_id":release["id"],"first_rehearsal_id":first["id"],"final_rehearsal_id":final["id"],
            "source_families":len(FAMILIES),"source_rows":sum(len(v) for v in populations.values()),"verified_work_count":len(all_work),
            "identity_rejections":[{"operation_id":v["request"]["operation_id"],"code":v["receipt"]["error"]["code"]} for v in rejections],
            "original_archive":str(archive),"archive":file_hash(archive),"received_directory":str(destination),
            "source_revision":inspected["manifest"]["revision"],"recipient_revision":continued_revision,
            "exports":[{"path":str(path),**file_hash(path)} for path in sorted(exports.iterdir())],"replay":True,"cold_receive":True,"recipient_continuation":True}
        publish_bytes(root/"native-receipt.json",encoded(receipt))
        print(canonical(receipt),flush=True)
        if browser_command:
            process=subprocess.run([*browser_command,"--course",str(root)],cwd=HERE,check=False)
            if process.returncode:raise RuntimeError("The original browser continuation did not complete; preserve its same course directory")
        return receipt
    finally:
        if ws is not None:ws.close()
        os.close(lock)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True,help="Private original directory for this complete authored course.")
    args=parser.parse_args()
    run(args.directory)
if __name__=="__main__":main()
