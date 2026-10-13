"""Adviser CRM commissioning on the maintained migration Store and register engines."""
from __future__ import annotations
import csv
import io
import json
from pathlib import Path
from migration_store import MigrationError, canonical, identity, parse_json, text, identifier, integer, page, file_hash
from migration_formats import source_description
import migration_registers as registers
from migration_cases import stamp

VERSION = "commons.adviser-migration/v1"
FAMILIES = {
 "contacts": {"title":"People, households, companies and trusts","reconstruction":False,"fields":["contact_id","record_type","display_name","owner_id","details","visibility"]},
 "relationships": {"title":"Household and other relationships","reconstruction":False,"fields":["relationship_id","from_contact_id","to_contact_id","relationship_type"]},
 "principals": {"title":"Current and legacy staff, teams and roles","reconstruction":True,"fields":["principal_id","display_name","active","roles","legacy_attribution"]},
 "activity_history": {"title":"Notes, tasks, events and retained history","reconstruction":False,"fields":["activity_id","contact_id","activity_type","owner_id","occurred_at","definition"]},
 "recurring_work": {"title":"Recurring tasks and events","reconstruction":True,"fields":["recurring_id","contact_id","owner_id","timezone","definition","next_occurrence"]},
 "workflow_templates": {"title":"Workflow templates","reconstruction":True,"fields":["template_id","title","definition"]},
 "active_workflows": {"title":"Active workflows and linked steps","reconstruction":True,"fields":["workflow_id","contact_id","template_id","owner_id","status","definition"]},
 "document_versions": {"title":"Original document versions and links","reconstruction":True,"fields":["document_id","version_id","contact_id","filename","content_sha256","bytes","location","visibility"]},
 "note_templates": {"title":"Note templates","reconstruction":True,"fields":["template_id","title","definition"]},
 "task_templates": {"title":"Task templates","reconstruction":True,"fields":["template_id","title","definition"]},
 "email_templates": {"title":"Email templates","reconstruction":True,"fields":["template_id","title","definition"]},
 "report_templates": {"title":"Report templates","reconstruction":True,"fields":["template_id","title","definition"]},
 "access_rules": {"title":"Workspace placement and visibility rules","reconstruction":True,"fields":["rule_id","entity_id","principal_id","workspace","definition"]},
}
KINDS = ("adviser_programme","adviser_work","adviser_release")
MUTATIONS = ("adviser.programme.create","adviser.work.create","adviser.release.create")
READS = ("adviser.schema","adviser.list","adviser.programme.get","adviser.programme.rows",
         "adviser.programme.assessment","adviser.work.get","adviser.work.history","adviser.release.get")
WORK_STATES = ("planned","in_progress","verified","deferred","accepted_omission")
DDL = """
CREATE TABLE IF NOT EXISTS adviser_work_rows (
 programme_id TEXT NOT NULL,row_id TEXT NOT NULL,work_id TEXT NOT NULL,created_revision INTEGER NOT NULL,
 PRIMARY KEY(programme_id,row_id,work_id));
CREATE INDEX IF NOT EXISTS adviser_work_current ON adviser_work_rows(programme_id,row_id,created_revision DESC);
"""

def need(ok,code,message,details=None):
    if not ok: raise MigrationError(code,message,details)
def ensure(store):
    need(not store.conn.in_transaction,"ADVISER_SCHEMA","Initialize the original workspace outside a write transaction")
    store.conn.executescript(DDL)
def clone(value): return parse_json(canonical(value))
def strings(value,name,empty=False,maximum=1000):
    need(isinstance(value,list) and (empty or value) and len(value)<=maximum,"ADVISER_LIST","Supply the complete "+name+" list")
    for item in value: text(item,name,max_length=4096)
    need(len(value)==len(set(value)),"ADVISER_LIST","Repeated "+name)
    return list(value)
def meta(op):
    return {"operation_id":op["id"],"created_at":op["created_at"],"created_revision":op["reserved_revision"],"actor":op["actor"]}
def begin(store,op,kind):
    rid=kind.replace("_","-")+"-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    old=store.get_entity(kind,rid,required=False)
    if old: return rid,old
    root=Path(__file__).parent
    basis={"schema":VERSION,"files":{name:file_hash(root/name)["sha256"] for name in
           ("adviser_workspace.py","migration_registers.py","migration_store.py","migration_formats.py","migration_cases.py")},"result_id":rid}
    if op.get("checkpoint"): need(op["checkpoint"]==basis,"ADVISER_IMPLEMENTATION","Continue this original operation with its original complete source edition")
    else: store.checkpoint(op["id"],basis)
    return rid,None
def get(store,kind,rid): return store.get_entity(kind,identifier(rid))
def row(store,dataset_id,row_id):
    ds=get(store,"register_dataset",dataset_id)
    r=store.conn.execute("SELECT body_json FROM register_rows WHERE dataset_id=? AND id=?",(ds["id"],identifier(row_id))).fetchone()
    need(r is not None,"ADVISER_ROW","Choose an original row in the selected complete dataset")
    return ds,parse_json(r[0])
def evidence(store,ids,scope,namespace):
    result=[]
    for sid in strings(ids,"original evidence sources",empty=True):
        src=source_description(store,identifier(sid))
        need(src["status"]=="READY" and src["context"]["scope_id"]==scope and src["context"]["identity_namespace"]==namespace,
             "ADVISER_EVIDENCE","Use complete original evidence from this exact scope and identity namespace")
        result.append({k:src[k] for k in ("id","filename","format","file_sha256","bytes","context","row_count")})
    return result
def normalize_expectation(value,kind):
    # Native JSON projections retain tagged original number lexemes. Reparse the
    # exact request JSON through that same number representation before comparison.
    prepared=json.loads(canonical(value),parse_int=registers.OriginalNumber,parse_float=registers.OriginalNumber) if kind=="json" else value
    return registers.normalize(prepared,kind)
def all_source_ids(programme):
    return [did for f in programme["families"].values() for did in f["source_dataset_ids"]]
def current_work(store,programme_id,row_id):
    found=store.conn.execute("SELECT work_id FROM adviser_work_rows WHERE programme_id=? AND row_id=? ORDER BY created_revision DESC,work_id DESC LIMIT 1",(programme_id,row_id)).fetchone()
    return get(store,"adviser_work",found[0]) if found else None

def programme_create(store,op):
    rid,old=begin(store,op,"adviser_programme")
    if old:return old
    p=op["request"]
    for k in ("title","purpose","owner","source_system","target_system","review_note"):text(p.get(k),k)
    plan=get(store,"register_plan",p.get("plan_id"))
    supplied=p.get("families")
    need(isinstance(supplied,dict) and set(supplied)==set(FAMILIES),"ADVISER_COVERAGE","Explicitly account for every advertised source family")
    families={};used=[]
    for key,hint in FAMILIES.items():
        f=supplied[key];need(isinstance(f,dict),"ADVISER_FAMILY","Family selection must be an object")
        need(not set(f)-{"status","reason","source_dataset_ids","reconstruction_required"},"ADVISER_FAMILY","Use the advertised complete family fields")
        status=f.get("status");need(status in ("selected","not_applicable","awaiting_source"),"ADVISER_FAMILY","Choose selected, not_applicable or awaiting_source")
        text(f.get("reason"),"family reason")
        ids=strings(f.get("source_dataset_ids",[]),"family datasets",empty=True)
        need(bool(ids)==(status=="selected"),"ADVISER_FAMILY","Only a selected family has original datasets")
        required=f.get("reconstruction_required",hint["reconstruction"])
        need(isinstance(required,bool),"ADVISER_FAMILY","Reconstruction applicability must be explicit")
        datasets=[]
        for did in ids:
            ds=get(store,"register_dataset",did)
            need(ds["side"]=="source" and ds["scope_id"]==plan["scope_id"] and ds["identity_namespace"]==plan["identity_namespace"],
                 "ADVISER_SCOPE","All selected original families belong to the plan's exact scope and namespace")
            need(ds["system"]==p["source_system"],"ADVISER_SYSTEM","The original source system must match every selected dataset")
            need(plan["policy"]["destinations"].get(ds["register"])==p["target_system"],"ADVISER_SYSTEM","The declared destination must match the original native plan")
            datasets.append({k:ds[k] for k in ("id","title","register","system","side","source","row_count","issue_count","invalid_identity_count","fields","key_fields")})
        used.extend(ids)
        families[key]={"title":hint["title"],"status":status,"reason":f["reason"],"reconstruction_required":required,
                       "source_dataset_ids":ids,"datasets":datasets}
    need(len(used)==len(set(used)) and set(used)==set(plan["source_dataset_ids"]),"ADVISER_PLAN","Every native plan source dataset must occur in exactly one family")
    previous=None
    if p.get("parent_programme_id"):
        previous=get(store,"adviser_programme",p["parent_programme_id"])
        need(previous["scope_id"]==plan["scope_id"] and previous["identity_namespace"]==plan["identity_namespace"],
             "ADVISER_PARENT","A successor remains in its original scope and namespace")
    sources=evidence(store,p.get("evidence_source_ids",[]),plan["scope_id"],plan["identity_namespace"])
    value={"schema":VERSION+"/programme","id":rid,**{k:p[k] for k in ("title","purpose","owner","source_system","target_system","review_note")},
           "scope_id":plan["scope_id"],"identity_namespace":plan["identity_namespace"],"plan_id":plan["id"],
           "plan":{"id":plan["id"],"title":plan["title"],"source_dataset_ids":plan["source_dataset_ids"],"policy":plan["policy"]},
           "families":families,"evidence_sources":sources,"parent_programme_id":previous["id"] if previous else None,
           "meaning":"Reviewed local commissioning of supplied original source. The CRM migration team and customer's target writer retain their original authority.",**meta(op)}
    return store.put_entity("adviser_programme",rid,value,op["reserved_revision"])

def work_create(store,op):
    rid,old=begin(store,op,"adviser_work")
    if old:return old
    p=op["request"];programme=get(store,"adviser_programme",p.get("programme_id"))
    for k in ("title","owner","reason","method"):text(p.get(k),k)
    need(p["method"] in ("recreate","link_existing","retain_history","archive_original","review_configuration"),"ADVISER_METHOD","Choose an explicit reconstruction method")
    status=p.get("status");need(status in WORK_STATES,"ADVISER_STATUS","Choose an advertised work state")
    family=p.get("family");need(family in programme["families"] and programme["families"][family]["status"]=="selected","ADVISER_FAMILY","Choose a selected programme family")
    refs=p.get("source_rows")
    need(isinstance(refs,list) and 1<=len(refs)<=100,"ADVISER_WORK","Choose 1–100 exact original rows for this assignment")
    selected=[];seen=set()
    previous=get(store,"adviser_work",p["parent_work_id"]) if p.get("parent_work_id") else None
    if previous:need(previous["programme_id"]==programme["id"] and previous["family"]==family,"ADVISER_PARENT","Follow the same programme and family")
    for ref in refs:
        need(isinstance(ref,dict) and set(ref)=={"dataset_id","row_id"},"ADVISER_ROW","Use exact original dataset_id and row_id")
        need(ref["dataset_id"] in programme["families"][family]["source_dataset_ids"],"ADVISER_ROW","Source row belongs to another family or programme")
        ds,item=row(store,ref["dataset_id"],ref["row_id"])
        need(item["id"] not in seen,"ADVISER_ROW","Original assignment repeats a row");seen.add(item["id"])
        tip=current_work(store,programme["id"],item["id"])
        need((tip is None and previous is None) or (previous is not None and tip is not None and tip["id"]==previous["id"]),
             "ADVISER_WORK_TIP","Follow the actual current assignment for every selected original row",{"row_id":item["id"],"current_work_id":tip["id"] if tip else None})
        selected.append(item)
    if previous:need(seen<={r["id"] for r in previous["source_rows"]},"ADVISER_PARENT","A successor can continue selected original rows, not add unrelated source rows")
    due=p.get("due_at") or None
    if due:stamp(due,"due_at")
    requested=p.get("requested_definition",{})
    need(isinstance(requested,dict),"ADVISER_DEFINITION","Retain the full explicitly reviewed reconstruction definition as an object")
    expected=p.get("expected_fields",{})
    need(isinstance(expected,dict) and len(expected)<=128,"ADVISER_EXPECTATION","Provide the exact target field/value expectations")
    for name in expected:need(isinstance(name,str) and registers.FIELD.fullmatch(name),"ADVISER_EXPECTATION","Use exact mapped target field names")
    target_refs=p.get("target_rows",[])
    need(isinstance(target_refs,list) and len(target_refs)<=100,"ADVISER_TARGET","Choose complete original target row references")
    targets=[];target_seen=set()
    source_registers={r["register"] for r in selected}
    for ref in target_refs:
        need(isinstance(ref,dict) and set(ref)=={"dataset_id","row_id"},"ADVISER_TARGET","Use exact target dataset_id and row_id")
        ds,item=row(store,ref["dataset_id"],ref["row_id"])
        need(ds["side"]=="target" and ds["scope_id"]==programme["scope_id"] and ds["identity_namespace"]==programme["identity_namespace"] and
             ds["system"]==programme["target_system"] and ds["register"] in source_registers,"ADVISER_TARGET","Target observation must match the original scope, namespace, register and destination")
        need(item["id"] not in target_seen,"ADVISER_TARGET","Repeated target occurrence");target_seen.add(item["id"]);targets.append(item)
    sources=evidence(store,p.get("evidence_source_ids",[]),programme["scope_id"],programme["identity_namespace"])
    document_files=[]
    supplied_files=p.get("document_files",[])
    need(isinstance(supplied_files,list) and len(supplied_files)<=1000,"ADVISER_DOCUMENTS","Supply complete original document file references")
    need(not supplied_files or family=="document_versions","ADVISER_DOCUMENTS","Document file bindings belong to the selected document family")
    source_by_id={item["id"]:item for item in selected}
    target_by_id={item["id"]:item for item in targets}
    document_keys=set()
    for item in supplied_files:
        need(isinstance(item,dict) and {"source_row_id","source_id"}<=set(item) and
             not set(item)-{"source_row_id","source_id","sha256_field","bytes_field"} and item["source_row_id"] in seen,
             "ADVISER_DOCUMENTS","Bind each original document file to its exact selected inventory row and mapped original hash/size fields")
        need(item["source_row_id"] not in document_keys,"ADVISER_DOCUMENTS","Each document-version row identifies one complete original file")
        document_keys.add(item["source_row_id"])
        original=evidence(store,[item["source_id"]],programme["scope_id"],programme["identity_namespace"])[0]
        inventory=source_by_id[item["source_row_id"]]
        definition=get(store,"register_dataset",inventory["dataset_id"])["fields"]
        binding={"source_row_id":item["source_row_id"],"source":original,"inventory_fields":{}}
        for key,default,kind,actual in (("sha256_field","content_sha256","text",original["file_sha256"]),
                                         ("bytes_field","bytes","decimal",str(original["bytes"]))):
            name=item.get(key,default)
            need(isinstance(name,str) and registers.FIELD.fullmatch(name) and name in definition and definition[name]["type"]==kind,
                 "ADVISER_DOCUMENTS","Map the document inventory's original SHA-256 as text and original byte count as decimal before binding its file")
            raw=inventory["original"].get(name,{})
            encoded=raw.get("value") if raw.get("present") else None
            need(isinstance(encoded,dict) and encoded.get("type") in (("string",) if kind=="text" else ("number","string")),
                 "ADVISER_DOCUMENTS","Document identity must come from an explicit usable original inventory value")
            original_value=encoded.get("lexeme") if encoded["type"]=="number" else encoded.get("value")
            normalized,presence,error=registers.normalize(original_value,kind)
            need(presence=="value" and error is None and inventory["presence"].get(name)=="value" and
                 name not in inventory.get("conversions",{}) and canonical(inventory["values"].get(name))==canonical(normalized),
                 "ADVISER_DOCUMENTS","Document file identity must match the unchanged original mapped value")
            if kind=="text":
                need(isinstance(normalized,str) and len(normalized)==64 and all(c in "0123456789abcdefABCDEF" for c in normalized),
                     "ADVISER_DOCUMENTS","Retain a complete original SHA-256 value")
                matches=normalized.lower()==actual
            else:
                expected,actual_presence,actual_error=registers.normalize(actual,"decimal")
                matches=actual_presence=="value" and actual_error is None and normalized==expected
            need(matches,"ADVISER_DOCUMENT_IDENTITY","Retained file does not match this exact original document-version inventory",
                 {"source_row_id":inventory["id"],"field":name,"original_value":original_value,"file_value":actual})
            binding[key]=name
            binding["inventory_fields"][name]={"selector":clone(definition[name]["selector"]),"type":kind,
                                               "original":clone(raw),"normalized":normalized,"matches":True}
        info=store.file_info(original["file_sha256"])
        need(info["bytes"]==original["bytes"],"ADVISER_DOCUMENT_IDENTITY","Original source and retained file byte counts differ")
        # The original store verifies the complete object on this same descriptor.
        with store.open_file(original["file_sha256"]):
            pass
        document_files.append(binding)
    if family=="document_versions" and status=="verified" and p["method"] in ("recreate","archive_original"):
        need({item["source_row_id"] for item in document_files}==seen,"ADVISER_DOCUMENTS",
             "Every reconstructed document version needs its inventory-matched original file; use link_existing for a reviewed retained external link")
    supplied_links=p.get("target_links",[])
    need(isinstance(supplied_links,list) and len(supplied_links)<=1000,"ADVISER_TARGET_LINK","Provide explicit source-to-target identity associations")
    links=[];link_keys=set();checks=[]
    for supplied in supplied_links:
        need(isinstance(supplied,dict) and {"source_row_id","target_row_id","reason"}<=set(supplied) and
             not set(supplied)-{"source_row_id","target_row_id","reason","expected_fields"},
             "ADVISER_TARGET_LINK","Use source_row_id, target_row_id, reason and optional per-association expected_fields")
        source=source_by_id.get(supplied["source_row_id"]);target=target_by_id.get(supplied["target_row_id"])
        need(source is not None and target is not None,"ADVISER_TARGET_LINK","Associate only exact selected original and returned occurrences")
        need(source["register"]==target["register"],"ADVISER_TARGET_LINK","An association retains the original register meaning")
        text(supplied["reason"],"source-to-target association reason")
        pair=(source["id"],target["id"])
        need(pair not in link_keys,"ADVISER_TARGET_LINK","Repeated source-to-target association")
        link_keys.add(pair)
        specific=supplied.get("expected_fields",{})
        need(isinstance(specific,dict) and len(specific)<=128 and all(isinstance(name,str) and registers.FIELD.fullmatch(name) for name in specific),
             "ADVISER_EXPECTATION","Use exact mapped field names for per-association expectations")
        effective={**expected,**specific}
        need(effective,"ADVISER_EXPECTATION","Every association needs explicit typed expectations")
        links.append({"source_row_id":source["id"],"source_dataset_id":source["dataset_id"],"source_key":source["key"],
                      "target_row_id":target["id"],"target_dataset_id":target["dataset_id"],"target_key":target["key"],
                      "reason":supplied["reason"],"expected_fields":clone(specific),"effective_expected_fields":clone(effective)})
        definition=get(store,"register_dataset",target["dataset_id"])["fields"]
        for name,wanted in effective.items():
            need(name in definition,"ADVISER_EXPECTATION","Expected field is not mapped in the associated target")
            normalized,presence,error=normalize_expectation(wanted,definition[name]["type"])
            need(presence=="value" and error is None,"ADVISER_EXPECTATION","Use an explicit valid target expectation under its original field type")
            checks.append({"source_row_id":source["id"],"target_row_id":target["id"],"field":name,"expected":clone(wanted),
                           "normalized_expected":normalized,"type":definition[name]["type"],
                           "observed":target["values"].get(name),"presence":target["presence"].get(name,"missing"),
                           "matches":target["presence"].get(name)=="value" and canonical(target["values"].get(name))==canonical(normalized)})
    if status=="verified":
        need(links and checks and all(c["matches"] for c in checks) and
             {link["source_row_id"] for link in links}==seen and {link["target_row_id"] for link in links}==target_seen,
             "ADVISER_VERIFICATION","Every selected source and returned row needs an explicit association with matching typed expectations")
        need(all(s["key"] is not None and not s["issues"] for s in selected),"ADVISER_VERIFICATION","Resolve source identity/projection issues before verification")
        need(all(t["key"] is not None and not t["issues"] for t in targets),"ADVISER_VERIFICATION","Resolve target identity/projection issues before verification")
        for ref in target_refs:
            ds=get(store,"register_dataset",ref["dataset_id"])
            need(registers.clock(ds,programme["plan"]["policy"])["status"]=="MATCH","ADVISER_VERIFICATION","Verification uses an independent target observation at or after the original cutoff")
        text(p.get("verified_by"),"verified_by");stamp(p.get("verified_at"),"verified_at")
        need(sources,"ADVISER_VERIFICATION","Retain the original operating or inspection evidence with verification")
    if status=="accepted_omission":text(p.get("accepted_by"),"accepted_by")
    value={"schema":VERSION+"/work","id":rid,"programme_id":programme["id"],"family":family,
           **{k:p[k] for k in ("title","owner","reason","method")},"status":status,"due_at":due,
           "source_rows":selected,"document_files":document_files,"requested_definition":clone(requested),"expected_fields":clone(expected),
           "target_rows":targets,"target_links":links,"target_checks":checks,"evidence_sources":sources,"parent_work_id":previous["id"] if previous else None,
           "verified_by":p.get("verified_by") if status=="verified" else None,"verified_at":p.get("verified_at") if status=="verified" else None,
           "accepted_by":p.get("accepted_by") if status=="accepted_omission" else None,**meta(op)}
    need(len(canonical(value).encode("utf-8"))<=8*1024*1024,"ADVISER_WORK_SIZE","Choose fewer original rows; the complete retained assignment exceeds 8 MiB")
    with store.transaction():
        store.put_entity("adviser_work",rid,value,op["reserved_revision"])
        for item in selected:store.conn.execute("INSERT OR IGNORE INTO adviser_work_rows VALUES(?,?,?,?)",(programme["id"],item["id"],rid,op["reserved_revision"]))
    return value

def programme_rows(store,p):
    programme=get(store,"adviser_programme",p.get("id"));offset,limit=page(p)
    family=p.get("family");need(family in programme["families"],"ADVISER_FAMILY","Choose an advertised programme family")
    ids=programme["families"][family]["source_dataset_ids"]
    if not ids:return {"rows":[],"total":0,"offset":offset,"limit":limit,"programme_id":programme["id"],"family":family}
    clause="dataset_id IN ("+",".join("?" for _ in ids)+")";args=list(ids)
    if p.get("query") is not None:text(p["query"],"query",max_length=4096);clause+=" AND instr(lower(body_json),lower(?))>0";args.append(p["query"])
    total=store.conn.execute("SELECT count(*) FROM register_rows WHERE "+clause,args).fetchone()[0]
    rows=[]
    for saved in store.conn.execute("SELECT body_json FROM register_rows WHERE "+clause+" ORDER BY dataset_id,ordinal LIMIT ? OFFSET ?",(*args,limit,offset)):
        item=parse_json(saved[0]);work=current_work(store,programme["id"],item["id"])
        rows.append({"source":item,"current_work":work,"reconstruction_required":programme["families"][family]["reconstruction_required"]})
    return {"rows":rows,"total":total,"offset":offset,"limit":limit,"programme_id":programme["id"],"family":family}

def assessment(store,programme_id,rehearsal_ids=None):
    programme=get(store,"adviser_programme",programme_id);families={};blocking=[];work_ids=set()
    for key,f in programme["families"].items():
        counts={"source_rows":0,"unassigned":0,**{s:0 for s in WORK_STATES}}
        if f["status"]=="awaiting_source":blocking.append({"family":key,"reason":"Original family source has not been supplied","kind":"source"})
        ids=f["source_dataset_ids"]
        if ids:
            q="SELECT body_json FROM register_rows WHERE dataset_id IN ("+",".join("?" for _ in ids)+") ORDER BY dataset_id,ordinal"
            for saved in store.conn.execute(q,ids):
                item=parse_json(saved[0]);counts["source_rows"]+=1;work=current_work(store,programme["id"],item["id"])
                if work:counts[work["status"]]+=1;work_ids.add(work["id"])
                else:counts["unassigned"]+=1
            if f["reconstruction_required"]:
                unfinished=sum(counts[s] for s in ("unassigned","planned","in_progress","deferred"))
                if unfinished:blocking.append({"family":key,"reason":"Original reconstruction work remains","kind":"reconstruction","count":unfinished})
        families[key]={"title":f["title"],"status":f["status"],"reason":f["reason"],"reconstruction_required":f["reconstruction_required"],"counts":counts}
    results=[]
    for rid in strings(rehearsal_ids or [],"rehearsal IDs",empty=True):
        r=get(store,"register_rehearsal",rid)
        need(r["plan_id"]==programme["plan_id"],"ADVISER_REHEARSAL","Select independent rehearsals of this exact original programme plan")
        results.append({"id":r["id"],"summary":r["summary"],"target_dataset_ids":r["target_dataset_ids"]})
    return {"schema":VERSION+"/assessment","programme_id":programme["id"],"revision":store.project["revision"],
            "families":families,"current_work_ids":sorted(work_ids),"blockers":blocking,"rehearsals":results,
            "reconstruction_complete":not blocking,"meaning":"Reconstruction completeness is separate from native register reconciliation and actual customer acceptance."}

def release_create(store,op):
    rid,old=begin(store,op,"adviser_release")
    if old:return old
    p=op["request"];programme=get(store,"adviser_programme",p.get("programme_id"))
    for k in ("title","reason","acceptance_owner"):text(p.get(k),k)
    decision=p.get("decision");need(decision in ("hold","ready_for_review","approved"),"ADVISER_RELEASE","Choose hold, ready_for_review or approved")
    cutover=get(store,"register_cutover",p.get("cutover_id"))
    for selection in cutover["rehearsals"]:need(selection["plan_id"]==programme["plan_id"],"ADVISER_RELEASE","Native cutover must select this programme's exact original plan")
    current=assessment(store,programme["id"],cutover["rehearsal_ids"])
    chosen=strings(p.get("work_ids",[]),"selected current work IDs",empty=True)
    need(set(chosen)==set(current["current_work_ids"]),"ADVISER_RELEASE","Select the whole current reconstruction review set",{"current_work_ids":current["current_work_ids"]})
    if decision=="approved":
        need(cutover["decision"]=="approved" and current["reconstruction_complete"],"ADVISER_NOT_READY","Native findings and all applicable reconstruction work require their current decisions")
        # A previously approved native cutover cannot carry a since-withdrawn finding acceptance.
        for review in cutover["reviews"]:
            tips=registers.review_tips(store,review["rehearsal_id"],review["item_id"])
            need(len(tips)==1 and tips[0]["id"]==review["id"] and tips[0]["disposition"]=="accepted_variance","ADVISER_STALE_ACCEPTANCE","Refresh the native cutover after a changed finding decision")
    previous=get(store,"adviser_release",p["parent_release_id"]) if p.get("parent_release_id") else None
    if previous:need(previous["programme_id"]==programme["id"],"ADVISER_PARENT","Continue the same original programme release")
    sources=evidence(store,p.get("evidence_source_ids",[]),programme["scope_id"],programme["identity_namespace"])
    value={"schema":VERSION+"/release","id":rid,"programme_id":programme["id"],"title":p["title"],"decision":decision,
           "reason":p["reason"],"acceptance_owner":p["acceptance_owner"],"cutover_id":cutover["id"],"cutover":cutover,
           "work_ids":chosen,"assessment":current,"evidence_sources":sources,"parent_release_id":previous["id"] if previous else None,
           "meaning":"An attributed review of supplied source and actual returned observations. External CRM execution remains with the authorized original operator.",**meta(op)}
    return store.put_entity("adviser_release",rid,value,op["reserved_revision"])

def listed(store,p):
    kind=p.get("kind");need(kind in KINDS,"ADVISER_KIND","Select programme, reconstruction work or release")
    offset,limit=page(p);where="kind=?";args=[kind]
    if p.get("programme_id"):
        get(store,"adviser_programme",p["programme_id"]);where+=" AND json_extract(body_json,'$.programme_id')=?";args.append(p["programme_id"])
    if p.get("query") is not None:text(p["query"],"query",max_length=4096);where+=" AND instr(lower(body_json),lower(?))>0";args.append(p["query"])
    total=store.conn.execute("SELECT count(*) FROM entities WHERE "+where,args).fetchone()[0]
    rows=[parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM entities WHERE "+where+" ORDER BY created_revision DESC,id LIMIT ? OFFSET ?",(*args,limit,offset))]
    return {"rows":rows,"total":total,"offset":offset,"limit":limit}

def schema():
    return {"schema":VERSION,"mutations":list(MUTATIONS),"reads":list(READS),"kinds":list(KINDS),"families":clone(FAMILIES),
            "programme_required":["title","purpose","owner","source_system","target_system","review_note","plan_id","families"],
            "programme_optional":["evidence_source_ids","parent_programme_id"],
            "family_fields":["status","reason","source_dataset_ids","reconstruction_required"],
            "family_statuses":["selected","not_applicable","awaiting_source"],
            "work_required":["programme_id","family","source_rows","title","owner","reason","method","status"],
            "work_optional":["parent_work_id","due_at","document_files","requested_definition","expected_fields","target_rows","target_links","evidence_source_ids","verified_by","verified_at","accepted_by"],
            "work_states":list(WORK_STATES),"work_methods":["recreate","link_existing","retain_history","archive_original","review_configuration"],
            "release_required":["programme_id","title","decision","reason","acceptance_owner","cutover_id","work_ids"],
            "release_optional":["evidence_source_ids","parent_release_id"],"maximum_page_size":500,
            "meaning":"Use native register projections, plans, rehearsals, reviews and cutover; adviser records organize the complete practical reconstruction and handover."}
def read(store,operation,p):
    if operation=="adviser.schema":return schema()
    if operation=="adviser.list":return listed(store,p)
    if operation=="adviser.programme.rows":return programme_rows(store,p)
    if operation=="adviser.programme.assessment":return assessment(store,p.get("id"),p.get("rehearsal_ids"))
    if operation=="adviser.work.history":
        programme=get(store,"adviser_programme",p.get("programme_id"));offset,limit=page(p);row_id=identifier(p.get("row_id"))
        total=store.conn.execute("SELECT count(*) FROM adviser_work_rows WHERE programme_id=? AND row_id=?",(programme["id"],row_id)).fetchone()[0]
        ids=[r[0] for r in store.conn.execute("SELECT work_id FROM adviser_work_rows WHERE programme_id=? AND row_id=? ORDER BY created_revision,work_id LIMIT ? OFFSET ?",(programme["id"],row_id,limit,offset))]
        return {"rows":[get(store,"adviser_work",wid) for wid in ids],"total":total,"offset":offset,"limit":limit}
    for name in ("programme","work","release"):
        if operation=="adviser."+name+".get":return get(store,"adviser_"+name,p.get("id"))
    raise MigrationError("UNKNOWN_OPERATION","Unknown adviser commissioning read")
def iter_export(store,kind,entity_id,format_name):
    need(kind in KINDS and format_name in ("csv","ndjson"),"ADVISER_EXPORT","Choose a complete adviser CSV or NDJSON export")
    value=get(store,kind,entity_id)
    def records():
        yield {"type":"selection","value":value}
        if kind=="adviser_programme":
            for family in FAMILIES:
                offset=0
                while True:
                    result=programme_rows(store,{"id":value["id"],"family":family,"offset":offset,"limit":500})
                    for item in result["rows"]:yield {"type":"original_reconstruction","family":family,"value":item}
                    offset+=len(result["rows"])
                    if offset>=result["total"]:break
                    need(result["rows"],"ADVISER_EXPORT","Original source pagination did not advance")
            yield {"type":"current_assessment","value":assessment(store,value["id"])}
    if format_name=="csv":
        out=io.StringIO(newline="");csv.writer(out,lineterminator="\r\n").writerow(["record_type","family","complete_original_record_json"]);yield out.getvalue().encode("utf-8")
    for record in records():
        if format_name=="ndjson":yield (canonical(record)+"\n").encode("utf-8")
        else:
            out=io.StringIO(newline="");csv.writer(out,lineterminator="\r\n").writerow([record["type"],record.get("family",""),canonical(record)]);yield out.getvalue().encode("utf-8")
HANDLERS={"adviser.programme.create":programme_create,"adviser.work.create":work_create,"adviser.release.create":release_create}
