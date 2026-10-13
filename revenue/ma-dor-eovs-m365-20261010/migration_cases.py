"""Case/document destination and rehearsal work on the original migration store."""
from __future__ import annotations
import csv
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from migration_store import MigrationError, canonical, identity, parse_json, text, identifier, integer, page, file_hash
from migration_formats import source_description, row_description

VERSION = "ma-dor.case-migration/v1"
KINDS = ("cases", "documents", "links")
SIDES = ("source", "target", "receipt")
DESTINATIONS = ("dynamics", "sharepoint", "archive")
# Additional destinations are explicit operator-owned identifiers, not connector routes.
STATUSES = ("MATCH", "DIFFERENT", "UNKNOWN", "AMBIGUOUS", "MISSING", "UNEXPECTED")
FIELDS = ("case_id", "document_id", "version_id", "status", "deleted", "target_id", "path",
          "size_bytes", "content_sha256", "principals", "label", "modified_at")
IDENTITIES = {"case_id", "document_id", "version_id", "target_id", "deleted"}
ENTITY_KINDS = ("case_dataset", "case_plan", "case_rehearsal", "case_review", "case_cutover")
MUTATIONS = ("case.dataset.create", "case.plan.create", "case.rehearsal.create", "case.review.create", "case.cutover.create")
READS = ("case.schema", "case.dataset.preview", "case.dataset.get", "case.dataset.rows",
         "case.plan.get", "case.plan.items", "case.rehearsal.get", "case.rehearsal.items",
         "case.rehearsal.compare", "case.review.get", "case.cutover.get", "case.list")
DDL = """
CREATE TABLE IF NOT EXISTS case_dataset_rows(
 id TEXT PRIMARY KEY,dataset_id TEXT NOT NULL,ordinal INTEGER NOT NULL,source_row_id TEXT NOT NULL,
 kind TEXT NOT NULL,identity_key TEXT,case_key TEXT,document_key TEXT,version_key TEXT,
 body_json TEXT NOT NULL,UNIQUE(dataset_id,ordinal));
CREATE INDEX IF NOT EXISTS case_dataset_key ON case_dataset_rows(dataset_id,kind,identity_key);
CREATE INDEX IF NOT EXISTS case_dataset_case ON case_dataset_rows(dataset_id,case_key);
CREATE INDEX IF NOT EXISTS case_dataset_document ON case_dataset_rows(dataset_id,document_key,version_key);
CREATE TABLE IF NOT EXISTS case_items(
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,ordinal INTEGER NOT NULL,kind TEXT NOT NULL,
 identity_key TEXT NOT NULL,status TEXT NOT NULL,body_json TEXT NOT NULL,UNIQUE(owner_id,ordinal));
CREATE INDEX IF NOT EXISTS case_items_identity ON case_items(owner_id,kind,identity_key);
CREATE INDEX IF NOT EXISTS case_items_status ON case_items(owner_id,status);
"""
FIELD_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
SHA = re.compile(r"^[0-9a-fA-F]{64}$")
MISSING = object()

class OriginalNumber:
    """An exact original JSON numeric token; never an object or pointer container."""
    __slots__ = ("token",)
    def __init__(self, token):self.token=token

def retained_value(value):
    """Tag every JSON container/scalar so an original object cannot impersonate a number."""
    if isinstance(value,OriginalNumber):return {"type":"number","lexeme":value.token}
    if value is None:return {"type":"null"}
    if isinstance(value,bool):return {"type":"boolean","value":value}
    if isinstance(value,str):return {"type":"string","value":value}
    if isinstance(value,list):return {"type":"array","items":[retained_value(v) for v in value]}
    if isinstance(value,dict):return {"type":"object","members":{k:retained_value(v) for k,v in value.items()}}
    raise ValueError("Unsupported original value")

def ensure(store):
    if store.conn.in_transaction:
        raise MigrationError("CASE_SCHEMA_TRANSACTION", "Open the case schema outside a write transaction")
    store.conn.executescript(DDL)

def schema():
    return {"schema":VERSION,"kinds":list(KINDS),"sides":list(SIDES),"destinations":list(DESTINATIONS),
            "fields":list(FIELDS),"statuses":list(STATUSES),"mutations":list(MUTATIONS),"reads":list(READS),
            "custom_destinations":True,"destination_policy_fields":["live_cases","live_documents","closed_cases","closed_documents"],
            "dataset_optional":["record_family","identity_scopes"],"plan_optional":["destination_policy","relation_rules","family_checks"],
            "identity_scopes":"Explicit canonical [scope, original ID] normalization; raw source identities remain retained",
            "relation_rule_fields":["id","source_family","field","target_family","target_kind","target_scope","cardinality","required"],
            "dataset_columns":"Explicit {field:{column:original CSV heading}|{pointer:RFC6901 JSON pointer}}",
            "value_maps":"Explicit exact original-string replacements; no inferred identity or status conversion",
            "document_identity":["document_id","document_version"],
            "multi_case_policy":["require_single_destination","copy_per_destination"],
            "review_dispositions":["rework","waiting_evidence","accepted_variance","withdrawn"],
            "cutover_decisions":["hold","ready_for_review","approved"],
            "max_snapshot_age_seconds":{"default":0,"minimum":0},
            "checks_rule":"Any mapped field except case_id, document_id, version_id, target_id and deleted. Identity, destination, links, lifecycle and capture checks are intrinsic.",
            "maximum_page_size":500,
            "meaning":"Original-source projection and recorded operator review. Target writes, effective permissions and buyer acceptance remain their actual separate operations."}

def need(condition, code, message, details=None):
    if not condition:
        raise MigrationError(code,message,details)

def optional_text(value, name, maximum=8192):
    if value is None or value == "":
        return value
    return text(value,name,max_length=maximum)

def stamp(value, name):
    need(isinstance(value,str),"CASE_TIMESTAMP",name+" needs an ISO timestamp with an explicit offset")
    try:
        result=datetime.fromisoformat(value.replace("Z","+00:00"))
        need(result.tzinfo is not None and result.utcoffset() is not None,"CASE_TIMESTAMP",name+" needs an explicit offset")
        return result.astimezone(timezone.utc)
    except ValueError as exc:
        raise MigrationError("CASE_TIMESTAMP","Invalid "+name) from exc

def unique_strings(values, name, empty=True):
    need(isinstance(values,list) and (empty or values) and len(values)<=10000,"CASE_LIST","Use a complete bounded "+name+" list")
    for value in values:text(value,name,max_length=4096)
    need(len(values)==len(set(values)),"CASE_LIST","Repeated "+name+" entry")
    return list(values)

def parent(store, kind, selected, scope=None):
    if selected is None:return None
    value=store.get_entity(kind,identifier(selected))
    if scope is not None:need(value["scope_id"]==scope,"CASE_SCOPE","The predecessor belongs to another scope")
    return value

def record_id(op, name):
    return "case-"+name+"-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]

def metadata(op):
    return {"created_at":op["created_at"],"created_revision":op["reserved_revision"],
            "operation_id":op["id"],"actor":op["actor"]}

def begin(store, op, name):
    result_id=record_id(op,name)
    old=store.get_entity("case_"+name,result_id,required=False)
    if old:return result_id,old
    implementation={"schema":VERSION,"sha256":file_hash(Path(__file__))["sha256"]}
    prior=op.get("checkpoint")
    if prior:
        need(prior.get("case_implementation")==implementation and prior.get("result_id")==result_id,
             "CASE_IMPLEMENTATION_CHANGED","Continue the original case operation with its selected implementation")
    else:store.checkpoint(op["id"],{"case_implementation":implementation,"result_id":result_id})
    return result_id,None

def selector(value):
    need(isinstance(value,dict) and len(value)==1,"CASE_SELECTOR","Choose exactly column or pointer")
    if "column" in value:text(value["column"],"column",max_length=4096)
    elif "pointer" in value:
        p=value["pointer"]
        need(isinstance(p,str) and (p=="" or p.startswith("/")) and len(p)<=4096,
             "CASE_SELECTOR","Use a complete RFC6901 JSON pointer")
        need(not re.search(r"~(?:[^01]|$)",p),"CASE_SELECTOR","Invalid JSON pointer escape")
    else:raise MigrationError("CASE_SELECTOR","Choose exactly column or pointer")
    return dict(value)

def config(store, p):
    source=source_description(store,p.get("source_id"))
    need(source["status"]=="READY" and source["format"] in ("inventory_csv","inventory_jsonl","mm_item_report","mm_item_failure_report"),
         "CASE_SOURCE","Choose a completely retained original inventory or reported-item source")
    kind,side=p.get("kind"),p.get("side")
    need(kind in KINDS and side in SIDES,"CASE_PROFILE","Choose cases/documents/links and source/target/receipt")
    role={"source":"source_inventory","target":"target_inventory","receipt":None}[side]
    if role:need(source["context"]["role"]==role,"CASE_SOURCE_ROLE","Use the original independent "+role)
    else:need(source["context"]["role"] in ("migration_items","migration_failures"),"CASE_SOURCE_ROLE","Receipts must remain reported migration attempts")
    destination=p.get("destination")
    need((side=="source" and destination is None) or (side!="source" and isinstance(destination,str) and identifier(destination)==destination),
         "CASE_DESTINATION","Declare the actual target destination; source rows have no observed destination")
    cols=p.get("columns")
    need(isinstance(cols,dict) and cols and len(cols)<=128,"CASE_COLUMNS","Select explicit original fields")
    for key,value in cols.items():
        need(isinstance(key,str) and FIELD_NAME.fullmatch(key),"CASE_FIELD","Use an ordinary canonical field name")
        selector(value)
        want="pointer" if source["format"]=="inventory_jsonl" else "column"
        need(want in value,"CASE_SELECTOR","Use "+want+" for the original source format")
    required={"cases":{"case_id"},"documents":{"document_id"},"links":{"case_id","document_id"}}[kind]
    need(required<=set(cols),"CASE_COLUMNS","Select every required identity field",{"required":sorted(required)})
    maps=p.get("value_maps",{})
    need(isinstance(maps,dict) and set(maps)<=set(cols),"CASE_VALUE_MAP","Map only selected fields")
    for field,items in maps.items():
        need(isinstance(items,dict) and len(items)<=100000,"CASE_VALUE_MAP","Use an explicit original-string mapping")
        for key,value in items.items():
            need(isinstance(key,str) and isinstance(value,(str,bool)),"CASE_VALUE_MAP","Mappings retain exact text or an explicit boolean")
    family=p.get("record_family")
    if family is not None:identifier(family)
    scopes=p.get("identity_scopes",{})
    need(isinstance(scopes,dict) and set(scopes)<={"case_id","document_id","version_id"},
         "CASE_IDENTITY_SCOPE","Scope only explicit case/document/version identity fields")
    for key,value in scopes.items():
        need(key in cols and isinstance(value,str) and FIELD_NAME.fullmatch(value),
             "CASE_IDENTITY_SCOPE","Scope a mapped identity with an ordinary explicit namespace name")
    return {"source":source,"kind":kind,"side":side,"destination":destination,
            **({"record_family":family} if family is not None else {}),
            **({"identity_scopes":dict(scopes)} if scopes else {}),
            "columns":json.loads(canonical(cols)),"value_maps":json.loads(canonical(maps)),
            "scope_id":source["context"]["scope_id"],"identity_namespace":source["context"]["identity_namespace"]}

def original_object(row):
    raw=row["raw"]
    if raw.get("kind")=="csv":
        headers,cells=raw["headers"],raw["cells"]
        return {header:cells[i] if i<len(cells) else MISSING for i,header in enumerate(headers)}
    if raw.get("kind")=="jsonl":
        def number(token):return OriginalNumber(token)
        def pairs(items):
            out={}
            for key,value in items:
                if key in out:raise ValueError("Repeated original JSON property: "+key)
                out[key]=value
            return out
        return json.loads(raw["text"],object_pairs_hook=pairs,parse_int=number,parse_float=number,
                          parse_constant=lambda value:(_ for _ in ()).throw(ValueError(value)))
    raise ValueError("Original row is neither CSV nor JSONL")

def selected(obj, spec):
    if "column" in spec:return obj.get(spec["column"],MISSING) if isinstance(obj,dict) else MISSING
    value=obj
    if spec["pointer"]=="":return value
    for segment in spec["pointer"][1:].split("/"):
        key=segment.replace("~1","/").replace("~0","~")
        if isinstance(value,dict):
            if key not in value:return MISSING
            value=value[key]
        elif isinstance(value,list):
            if not re.fullmatch(r"0|[1-9][0-9]*",key):return MISSING
            index=int(key)
            if index>=len(value):return MISSING
            value=value[index]
        else:return MISSING
    return value

def normalized(field,value):
    if value is MISSING:return None,"missing",None
    if value is None:return None,"null",None
    if isinstance(value,str) and not value.strip():return value,"empty",None
    if field in ("case_id","document_id","version_id","target_id","status","path","label"):
        return (value,"value",None) if isinstance(value,str) else (None,"invalid","expected_text")
    if field=="deleted":
        return (value,"value",None) if isinstance(value,bool) else (None,"invalid","explicit_boolean_required")
    if field=="size_bytes":
        token=value.token if isinstance(value,OriginalNumber) else value
        if isinstance(token,str) and re.fullmatch(r"[0-9]{1,1000}",token):
            return str(int(token)),"value",None
        return None,"invalid","nonnegative_integer_required"
    if field=="content_sha256":
        return (value.lower(),"value",None) if isinstance(value,str) and SHA.fullmatch(value) else (None,"invalid","explicit_sha256_required")
    if field=="principals":
        try:
            decoded=json.loads(value) if isinstance(value,str) else value
            need(isinstance(decoded,list) and all(isinstance(x,str) and x for x in decoded),
                 "CASE_PRINCIPALS","Use an explicit principal array")
            return sorted(set(decoded)),"value",None
        except (ValueError,TypeError,MigrationError):return None,"invalid","explicit_principal_array_required"
    if field=="modified_at":
        try:stamp(value,field);return value,"value",None
        except MigrationError:return None,"invalid","timestamp_with_offset_required"
    return retained_value(value),"value",None

def project(row, cfg, dataset_id):
    values,presence,original,issues,conversions={},{},{},[],{}
    try:obj=original_object(row)
    except (ValueError,TypeError) as exc:
        obj={};issues.append({"code":"original_record_invalid","message":str(exc)})
    for field,spec in cfg["columns"].items():
        raw=selected(obj,spec)
        original[field]={"present":raw is not MISSING,"value":None if raw is MISSING else retained_value(raw),"encoding":"case.typed-json/v1"}
        mapped=raw
        maps=cfg["value_maps"].get(field,{})
        if isinstance(raw,str) and raw in maps:
            mapped=maps[raw];conversions[field]={"original":raw,"selected":mapped}
        value,seen,error=normalized(field,mapped)
        scope=cfg.get("identity_scopes",{}).get(field)
        if scope and seen=="value":
            value=scoped_identity(value,scope)
            conversions[field]={**conversions.get(field,{}),"identity_scope":scope,"scoped":value}
        values[field],presence[field]=value,seen
        if error:issues.append({"code":error,"field":field})
    required={"cases":["case_id"],"documents":["document_id"],"links":["case_id","document_id"]}[cfg["kind"]]
    for field in required:
        if presence.get(field)!="value":issues.append({"code":"identity_unavailable","field":field})
    key=None if any(presence.get(f)!="value" for f in required) else canonical([values[f] for f in required])
    return {"id":"case-row-"+identity({"dataset_id":dataset_id,"source_row_id":row["id"]})[:40],
            "dataset_id":dataset_id,"source_row_id":row["id"],"ordinal":row["ordinal"],
            "kind":cfg["kind"],"side":cfg["side"],"destination":cfg["destination"],
            "values":values,"presence":presence,"original":original,"conversions":conversions,
            "issues":issues,"source_ref":row["source_ref"],"key":key}

def preview(store,p):
    cfg=config(store,p);offset,limit=page(p)
    rows=[project(row_description(store,r),cfg,"preview") for r in store.conn.execute(
        "SELECT * FROM rows WHERE source_id=? ORDER BY ordinal LIMIT ? OFFSET ?",(cfg["source"]["id"],limit,offset))]
    return {"source":cfg["source"],"fields":list(cfg["columns"]),"rows":rows,"total":cfg["source"]["row_count"],"offset":offset,"limit":limit}

def dataset_create(store,op):
    result_id,old=begin(store,op,"dataset")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("review_note"),"review_note")
    cfg=config(store,p)
    earlier=parent(store,"case_dataset",p.get("parent_dataset_id"),cfg["scope_id"])
    if earlier:need((earlier["kind"],earlier["side"],earlier["identity_namespace"])==(cfg["kind"],cfg["side"],cfg["identity_namespace"]),
                    "CASE_DATASET_PARENT","Previous interpretation must use the same family, side and namespace")
    count,issues,invalid_identity,invalid_version=0,0,0,0
    for saved in store.conn.execute("SELECT * FROM rows WHERE source_id=? ORDER BY ordinal",(cfg["source"]["id"],)):
        row=project(row_description(store,saved),cfg,result_id);count+=1;issues+=len(row["issues"])
        invalid_identity+=row["key"] is None
        invalid_version+=cfg["kind"]!="cases" and row["presence"].get("version_id")!="value"
        record=(row["id"],result_id,count,row["source_row_id"],row["kind"],row["key"],
                row["values"].get("case_id"),row["values"].get("document_id"),row["values"].get("version_id"),canonical(row))
        prior=store.conn.execute("SELECT * FROM case_dataset_rows WHERE dataset_id=? AND ordinal=?",(result_id,count)).fetchone()
        if prior:need(tuple(prior)==record,"CASE_PREFIX_CHANGED","Retained original projection differs")
        else:
            with store.transaction():store.conn.execute("INSERT INTO case_dataset_rows VALUES(?,?,?,?,?,?,?,?,?,?)",record)
    need(store.conn.execute("SELECT count(*) FROM case_dataset_rows WHERE dataset_id=?",(result_id,)).fetchone()[0]==count,
         "CASE_PREFIX_CHANGED","Original projection ended before its retained rows")
    body={"schema":VERSION+"/dataset","id":result_id,**cfg,"title":p["title"],"fields":list(cfg["columns"]),
          "row_count":count,"issue_count":issues,"invalid_identity_count":invalid_identity,"invalid_version_count":invalid_version,
          "review_note":p["review_note"],"parent_dataset_id":p.get("parent_dataset_id"),**metadata(op)}
    return store.put_entity("case_dataset",result_id,body,op["reserved_revision"])

def datasets(store,ids,side,scope=None,namespace=None):
    unique_strings(ids,"dataset IDs",empty=False)
    values=[store.get_entity("case_dataset",identifier(value)) for value in ids]
    scope=scope or values[0]["scope_id"];namespace=namespace or values[0]["identity_namespace"]
    for value in values:
        need(value["side"]==side and value["scope_id"]==scope and value["identity_namespace"]==namespace,
             "CASE_DATASET_SCOPE","All selected projections must have the same original scope/identity namespace and required side")
    need(len({(v["source"]["id"],v["kind"],v["destination"]) for v in values})==len(values),
         "CASE_SOURCE_REPEATED","Select one interpretation of each original source/family/destination")
    return values

def query_rows(store,selected,kind=None,case_id=None,document_id=None):
    ids=[v["id"] for v in selected if kind is None or v["kind"]==kind]
    if not ids:return
    where="dataset_id IN ("+",".join("?" for _ in ids)+")";args=list(ids)
    if case_id is not None:where+=" AND case_key=?";args.append(case_id)
    if document_id is not None:where+=" AND document_key=?";args.append(document_id)
    for row in store.conn.execute("SELECT body_json FROM case_dataset_rows WHERE "+where+" ORDER BY dataset_id,ordinal",args):
        yield parse_json(row[0])

def row_ref(row):
    return {"id":row["id"],"dataset_id":row["dataset_id"],"source_row_id":row["source_row_id"],
            "source_ref":row["source_ref"],"values":row["values"],"presence":row["presence"],"issues":row["issues"]}

def check(status,reason,**values):
    return {"status":status,"reason":reason,**values}

def status(checks):
    states={c["status"] for c in checks.values()}
    for value in ("AMBIGUOUS","DIFFERENT","MISSING","UNEXPECTED","UNKNOWN"):
        if value in states:return value
    return "MATCH"

def clock_check(dataset,policy,target=False):
    context=dataset["source"]["context"];value=context.get("captured_at") or context.get("observed_at")
    try:
        captured=stamp(value,"source capture");cutoff=stamp(policy["cutoff_at"],"cutoff")
    except MigrationError:
        return check("UNKNOWN","Original capture time with offset is unavailable",captured_at=value,cutoff_at=policy["cutoff_at"])
    if target:
        return check("MATCH" if captured>=cutoff else "UNKNOWN","Independent readback capture must be at or after the selected cutoff",captured_at=value,cutoff_at=policy["cutoff_at"])
    age=(cutoff-captured).total_seconds()
    return check("MATCH" if 0<=age<=policy["max_snapshot_age_seconds"] else "UNKNOWN",
                 "Original source capture must be within the explicitly selected cutoff age",captured_at=value,age_seconds=age,
                 max_snapshot_age_seconds=policy["max_snapshot_age_seconds"])

def dataset_clock_checks(selected,policy):
    return {"capture:"+ds["id"]:clock_check(ds,policy) for ds in selected}

def source_evidence(row,by_id,policy):
    out={"capture:"+row["dataset_id"]:clock_check(by_id[row["dataset_id"]],policy)}
    if row["issues"]:out["projection:"+row["id"]]=check("UNKNOWN","Supporting original projection contains unresolved issues",issues=row["issues"])
    if row["values"].get("deleted") is True or row["presence"].get("deleted")=="invalid":
        out["lifecycle:"+row["id"]]=check("UNKNOWN","Supporting original tombstone or invalid lifecycle needs an explicit decision")
    if row["presence"].get("modified_at")=="value" and stamp(row["values"]["modified_at"],"modified_at")>stamp(policy["cutoff_at"],"cutoff_at"):
        out["modified:"+row["id"]]=check("UNKNOWN","Supporting original record changed after the selected cutoff")
    return out

def case_destination(rows,policy):
    if len(rows)!=1:return [],check("AMBIGUOUS" if rows else "UNKNOWN","Case identity requires one retained source occurrence",occurrences=len(rows))
    row=rows[0];values=row["values"];presence=row["presence"]
    if values.get("deleted") is True:return [],check("UNKNOWN","Supplied case tombstone needs an explicit deletion/retention decision")
    if presence.get("deleted")=="invalid":return [],check("UNKNOWN","Case deletion marker is not an explicit boolean")
    state=values.get("status")
    if presence.get("status")!="value":return [],check("UNKNOWN","Original case lifecycle state is unavailable")
    route=policy.get("destination_policy",DEFAULT_DESTINATION_POLICY)
    if state in policy["live_statuses"]:return [route["live_cases"]],check("MATCH","Explicit live status",original_status=state)
    if state in policy["closed_statuses"]:return [route["closed_cases"]],check("MATCH","Explicit closed status",original_status=state)
    return [],check("UNKNOWN","Original state has no selected live/closed rule",original_status=state)

def logical(row,policy):
    fields={"cases":["case_id"],"documents":["document_id"],"links":["case_id","document_id"]}[row["kind"]]
    if policy["document_identity"]=="document_version" and row["kind"]!="cases":fields=fields+["version_id"]
    if any(row["presence"].get(name)!="value" for name in fields):return None
    return canonical([row["values"][name] for name in fields])

def grouped(store,selected,kind,policy):
    # SQL orders identities without holding a complete source cohort in memory.
    ids=[ds["id"] for ds in selected if ds["kind"]==kind]
    if not ids:return
    keys="case_key" if kind=="cases" else "document_key"
    if kind=="links":keys="case_key,document_key"
    if policy["document_identity"]=="document_version" and kind!="cases":keys+=",version_key"
    sql="SELECT body_json FROM case_dataset_rows WHERE dataset_id IN ("+",".join("?" for _ in ids)+") ORDER BY "+keys+",dataset_id,ordinal"
    prior=MISSING;group=[]
    for saved in store.conn.execute(sql,ids):
        row=parse_json(saved[0]);key=logical(row,policy) or canonical(["invalid",row["id"]])
        if prior is not MISSING and key!=prior:
            yield prior,group;group=[]
        prior=key;group.append(row)
    if group:yield prior,group

def persist_item(store,owner_id,ordinal,item):
    item={**item,"id":"case-item-"+identity({"owner_id":owner_id,"kind":item["kind"],"key":item["key"]})[:40]}
    item["status"]=status(item["checks"])
    record=(item["id"],owner_id,ordinal,item["kind"],item["key"],item["status"],canonical(item))
    old=store.conn.execute("SELECT * FROM case_items WHERE owner_id=? AND ordinal=?",(owner_id,ordinal)).fetchone()
    if old:need(tuple(old)==record,"CASE_PREFIX_CHANGED","Retained original plan/result item differs on continuation")
    else:
        with store.transaction():store.conn.execute("INSERT INTO case_items VALUES(?,?,?,?,?,?,?)",record)
    return item

def original_links(store,selected,document,policy):
    doc_id=document["values"].get("document_id")
    if not isinstance(doc_id,str):return []
    version=document["values"].get("version_id");relations=[]
    if document["presence"].get("case_id")=="value":
        relations.append({"case_id":document["values"]["case_id"],"document_id":doc_id,"version_id":version,"row":document,"basis":"document.case_id"})
    for link in query_rows(store,selected,"links",document_id=doc_id):
        if policy["document_identity"]=="document_version" and link["values"].get("version_id")!=version:continue
        relations.append({"case_id":link["values"].get("case_id"),"document_id":doc_id,"version_id":version,"row":link,"basis":"original_link"})
    return relations

def plan_create(store,op):
    result_id,old=begin(store,op,"plan")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("review_note"),"review_note");stamp(p.get("cutoff_at"),"cutoff_at")
    selected=datasets(store,p.get("source_dataset_ids"),"source")
    need(any(ds["kind"]=="cases" for ds in selected),"CASE_PLAN","Select the complete source case population")
    live=unique_strings(p.get("live_statuses"),"live statuses",False);closed=unique_strings(p.get("closed_statuses"),"closed statuses",False)
    need(not set(live)&set(closed),"CASE_STATUS_RULE","Live and closed status sets must be disjoint")
    document_identity=p.get("document_identity","document_id");multi=p.get("multi_case_policy","require_single_destination")
    need(document_identity in ("document_id","document_version") and multi in ("require_single_destination","copy_per_destination"),
         "CASE_PLAN_POLICY","Choose advertised document identity and multi-case policies")
    checks=p.get("checks",{"cases":[],"documents":[]})
    need(isinstance(checks,dict) and set(checks)<={"cases","documents"},"CASE_CHECKS","Select case/document fields explicitly")
    fields={}
    for kind in ("cases","documents"):
        fields[kind]=unique_strings(checks.get(kind,[]),kind+" checks")
        available=set().union(*(set(ds["fields"]) for ds in selected if ds["kind"]==kind))
        need(set(fields[kind])<=available and not set(fields[kind])&IDENTITIES,"CASE_CHECKS","Comparison fields must be explicitly mapped nonidentity fields")
    policy={"cutoff_at":p["cutoff_at"],"live_statuses":live,"closed_statuses":closed,"document_identity":document_identity,
            "multi_case_policy":multi,"checks":fields,"max_snapshot_age_seconds":integer(p.get("max_snapshot_age_seconds",0),"max_snapshot_age_seconds",maximum=31536000)}
    if "destination_policy" in p:policy["destination_policy"]=destination_policy(p["destination_policy"])
    if "relation_rules" in p:policy["relation_rules"]=relation_rules(p["relation_rules"],selected)
    if "family_checks" in p:
        configured=p["family_checks"]
        need(isinstance(configured,dict),"CASE_CHECKS","Select an explicit family-to-fields comparison object")
        policy["family_checks"]={}
        for family,names in configured.items():
            members=[ds for ds in selected if ds.get("record_family")==family]
            need(members,"CASE_CHECKS","Comparison family is not selected")
            names=unique_strings(names,"family checks")
            available=set().union(*(set(ds["fields"]) for ds in members))
            need(set(names)<=available and not set(names)&IDENTITIES,"CASE_CHECKS","Family checks must select mapped nonidentity fields")
            policy["family_checks"][family]=names
    earlier=parent(store,"case_plan",p.get("parent_plan_id"),selected[0]["scope_id"])
    if earlier:need(earlier["identity_namespace"]==selected[0]["identity_namespace"],"CASE_PLAN_PARENT","Keep original logical identity namespace")
    by_id={ds["id"]:ds for ds in selected};count=0;counts={v:0 for v in STATUSES}
    for kind in KINDS:
        for key,rows in grouped(store,selected,kind,policy):
            intrinsic={"identity":check("MATCH" if len(rows)==1 and logical(rows[0],policy) else "AMBIGUOUS" if len(rows)>1 else "UNKNOWN",
                                        "Every selected original occurrence is retained",occurrences=len(rows))}
            intrinsic.update(dataset_clock_checks([by_id[x] for x in sorted({r["dataset_id"] for r in rows})],policy))
            destinations=[];relations=[]
            if kind=="cases":
                destinations,intrinsic["lifecycle"]=case_destination(rows,policy)
            elif kind=="documents":
                if len(rows)==1:
                    document=rows[0]
                    if document["values"].get("deleted") is True:intrinsic["lifecycle"]=check("UNKNOWN","Supplied document tombstone needs an explicit deletion/retention decision")
                    if document["presence"].get("deleted")=="invalid":intrinsic["lifecycle"]=check("UNKNOWN","Document deletion marker is not an explicit boolean")
                    relations=original_links(store,selected,document,policy)
                    if not relations:intrinsic["relationship"]=check("UNKNOWN","No original case/document association selected")
                    else:
                        all_dest=[]
                        for index,rel in enumerate(relations):
                            active=rel["row"]["values"].get("deleted") is not True and rel["row"]["presence"].get("deleted")!="invalid"
                            case_rows=list(query_rows(store,selected,"cases",case_id=rel["case_id"])) if isinstance(rel["case_id"],str) and active else []
                            dest,assessment=case_destination(case_rows,policy)
                            intrinsic["relationship:"+str(index)]=assessment
                            for case_row in case_rows:intrinsic.update(source_evidence(case_row,by_id,policy))
                            if rel["row"]["dataset_id"] in by_id:intrinsic.update(source_evidence(rel["row"],by_id,policy))
                            all_dest += destinations_for_documents(case_rows,policy)
                        destinations=sorted(set(all_dest))
                        if len(destinations)>1 and multi=="require_single_destination":
                            intrinsic["destination_policy"]=check("UNKNOWN","The same document belongs to cases requiring different destinations; select an explicit copy policy")
                            destinations=[]
                else:intrinsic["relationship"]=check("AMBIGUOUS","Duplicate document identity prevents one association result")
            else:
                link=rows[0];case_id=link["values"].get("case_id");doc_id=link["values"].get("document_id")
                case_rows=list(query_rows(store,selected,"cases",case_id=case_id)) if isinstance(case_id,str) else []
                doc_rows=list(query_rows(store,selected,"documents",document_id=doc_id)) if isinstance(doc_id,str) else []
                if document_identity=="document_version":doc_rows=[r for r in doc_rows if r["values"].get("version_id")==link["values"].get("version_id")]
                case_dest,intrinsic["case_reference"]=case_destination(case_rows,policy)
                intrinsic["document_reference"]=check("MATCH" if len(doc_rows)==1 else "AMBIGUOUS" if doc_rows else "UNKNOWN","Link must identify one selected source document",occurrences=len(doc_rows))
                for related in case_rows+doc_rows:intrinsic.update(source_evidence(related,by_id,policy))
                if link["values"].get("deleted") is True or link["presence"].get("deleted")=="invalid":
                    intrinsic["lifecycle"]=check("UNKNOWN","The original link is a tombstone or has an invalid deletion marker")
                    case_dest=[]
                destinations=destinations_for_documents(case_rows,policy) if case_dest else []
                relations=[{"case_id":case_id,"document_id":doc_id,"version_id":link["values"].get("version_id"),"row":link,"basis":"original_link"}]
            for row in rows:
                intrinsic.update(source_evidence(row,by_id,policy))
                intrinsic.update(relation_source_checks(store,row,selected,by_id,policy))
            item={"kind":kind,"key":key,"source_rows":[row_ref(r) for r in rows],"expected_destinations":destinations,
                  "observed_rows":[],"reported_rows":[],"relations":[{k:(row_ref(v) if k=="row" else v) for k,v in rel.items()} for rel in relations],
                  "checks":intrinsic,"issues":[]}
            count+=1;item=persist_item(store,result_id,count,item);counts[item["status"]]+=1
    need(store.conn.execute("SELECT count(*) FROM case_items WHERE owner_id=?",(result_id,)).fetchone()[0]==count,
         "CASE_PREFIX_CHANGED","Original plan ended before retained items")
    body={"schema":VERSION+"/plan","id":result_id,"title":p["title"],"source_dataset_ids":[ds["id"] for ds in selected],
          "datasets":selected,"scope_id":selected[0]["scope_id"],"identity_namespace":selected[0]["identity_namespace"],
          "policy":policy,"summary":{"total":count,"counts":counts},"item_count":count,"review_note":p["review_note"],
          "parent_plan_id":p.get("parent_plan_id"),"note":optional_text(p.get("note"),"note"),**metadata(op)}
    return store.put_entity("case_plan",result_id,body,op["reserved_revision"])

def complete(dataset,policy):
    source=dataset["source"]
    return source["summary"].get("effective_coverage")=="complete" and not source["summary"].get("issues") and dataset["invalid_identity_count"]==0 and (policy["document_identity"]!="document_version" or dataset["kind"]=="cases" or dataset["invalid_version_count"]==0)

def observed_for(store,selected,item,policy):
    expected=item["source_rows"][0]["values"] if item["source_rows"] else {}
    if item["kind"]=="cases":
        rows=query_rows(store,selected,"cases",case_id=expected.get("case_id")) if expected.get("case_id") is not None else []
    else:
        rows=query_rows(store,selected,item["kind"],document_id=expected.get("document_id")) if expected.get("document_id") is not None else []
    return [r for r in rows if logical(r,policy)==item["key"]]

def fields_compare(source,target,fields):
    out={}
    for field in fields:
        a,b=source["presence"].get(field,"missing"),target["presence"].get(field,"missing")
        if a in ("missing","invalid") or b in ("missing","invalid"):
            out[field]=check("UNKNOWN","Mapped original field is missing or invalid",source_presence=a,target_presence=b)
        else:
            equal=a==b and source["values"].get(field)==target["values"].get(field)
            out[field]=check("MATCH" if equal else "DIFFERENT","Compare explicit mapped values and presence",source_presence=a,target_presence=b,
                             expected=source["values"].get(field),observed=target["values"].get(field))
    return out

def actual_links(store,selected,document,policy):
    return original_links(store,selected,document,policy)

def target_relationships(store,selected,by_id,document,policy,destination,expected,wanted):
    found=[rel for rel in actual_links(store,selected,document,policy)
           if rel["row"]["destination"]==destination]
    actual=set();unresolved=[];evidence=[]
    for rel in found:
        row=rel["row"];ds=by_id[row["dataset_id"]];clock=clock_check(ds,policy,True)
        valid=(clock["status"]=="MATCH" and not row["issues"] and
               row["presence"].get("case_id")=="value" and row["presence"].get("deleted")!="invalid")
        deleted=row["values"].get("deleted") is True
        evidence.append({"basis":rel["basis"],"row":row_ref(row),"capture":clock,
                         "usable":valid,"deleted":deleted})
        if not valid:unresolved.append(row["id"])
        elif not deleted:actual.add(rel["case_id"])
    channels=[ds for ds in selected if ds["kind"]=="links" and ds["destination"]==destination]
    inline=by_id[document["dataset_id"]]
    if "case_id" in inline["fields"]:channels.append(inline)
    coverage=[]
    for ds in channels:
        captured=clock_check(ds,policy,True)
        valid=complete(ds,policy) and captured["status"]=="MATCH" and not ds["issue_count"]
        if ds["id"]==inline["id"]:
            valid=valid and document["presence"].get("case_id") in ("value","null","empty")
        coverage.append({"dataset_id":ds["id"],"complete":bool(valid),"capture":captured,
                         "projection_issues":ds["issue_count"]})
    complete_links=bool(coverage) and all(v["complete"] for v in coverage) and not unresolved
    missing=wanted-actual;extra=actual-expected
    result=("DIFFERENT" if extra or (missing and complete_links) else
            "UNKNOWN" if missing or not complete_links else "MATCH")
    return check(result,"Compare independently captured, active case/document associations",
                 expected=sorted(wanted),observed=sorted(actual),missing=sorted(missing),extra=sorted(extra),
                 supporting_rows=evidence,coverage=coverage,unresolved_row_ids=unresolved)

def rehearsal_create(store,op):
    result_id,old=begin(store,op,"rehearsal")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("note"),"note")
    plan=store.get_entity("case_plan",p.get("plan_id"));policy=plan["policy"]
    target=datasets(store,p.get("target_dataset_ids"),"target",plan["scope_id"],plan["identity_namespace"])
    receipt=datasets(store,p["receipt_dataset_ids"],"receipt",plan["scope_id"],plan["identity_namespace"]) if p.get("receipt_dataset_ids") else []
    earlier=parent(store,"case_rehearsal",p.get("parent_rehearsal_id"),plan["scope_id"])
    if earlier:need(earlier["identity_namespace"]==plan["identity_namespace"],"CASE_REHEARSAL_PARENT","Keep original logical namespace")
    target_by_id={ds["id"]:ds for ds in target};count=0;counts={v:0 for v in STATUSES}
    for saved in store.conn.execute("SELECT body_json FROM case_items WHERE owner_id=? ORDER BY ordinal",(plan["id"],)):
        original=parse_json(saved[0]);item={k:v for k,v in original.items() if k not in ("id","status")}
        observed=observed_for(store,target,item,policy);reported=observed_for(store,receipt,item,policy)
        item["observed_rows"]=[row_ref(r)|{"destination":r["destination"]} for r in observed]
        item["reported_rows"]=[row_ref(r)|{"destination":r["destination"]} for r in reported]
        checks=item["checks"];expected_dest=item["expected_destinations"];kind=item["kind"]
        valid_identity=bool(item["source_rows"]) and all(logical({**row,"kind":kind},policy)==item["key"] for row in item["source_rows"])
        source_usable=valid_identity and original["status"]=="MATCH"
        if not expected_dest:checks["destination"]=check("UNKNOWN","No resolved expected destination at this cutoff")
        for destination in expected_dest:
            candidates=[r for r in observed if r["destination"]==destination]
            source_profiles=[ds for ds in plan["datasets"] if ds["id"] in {row["dataset_id"] for row in item["source_rows"]}]
            coverage=[ds for ds in target if ds["kind"]==kind and ds["destination"]==destination and
                      any(ds.get("record_family")==original_ds.get("record_family") and
                          ds.get("identity_scopes",{})==original_ds.get("identity_scopes",{}) for original_ds in source_profiles)]
            if not candidates:
                absent=source_usable and bool(coverage) and all(complete(ds,policy) and clock_check(ds,policy,True)["status"]=="MATCH" for ds in coverage)
                checks["presence:"+destination]=check("MISSING" if absent else "UNKNOWN","Independent target coverage controls absence conclusions",destination=destination,selected_dataset_ids=[ds["id"] for ds in coverage])
            elif len(candidates)>1:checks["presence:"+destination]=check("AMBIGUOUS","Multiple observed target occurrences share the logical identity",occurrences=len(candidates))
            else:
                candidate=candidates[0]
                captured=clock_check(target_by_id[candidate["dataset_id"]],policy,True)
                usable=captured["status"]=="MATCH" and source_usable
                checks["presence:"+destination]=check("MATCH" if usable else "UNKNOWN","Independent target occurrence at the selected cutoff",original_identity_valid=valid_identity)
                checks["target_capture:"+candidate["id"]]=captured
                if candidate["issues"]:checks["target_projection:"+candidate["id"]]=check("UNKNOWN","Target projection has unresolved issues",issues=candidate["issues"])
                if candidate["values"].get("deleted") is True:checks["target_lifecycle:"+candidate["id"]]=check("DIFFERENT" if usable else "UNKNOWN","Observed target is marked deleted; cutoff-valid evidence is required")
                if len(item["source_rows"])==1:
                    source_family=next(ds.get("record_family") for ds in plan["datasets"] if ds["id"]==item["source_rows"][0]["dataset_id"])
                    selected_checks=policy.get("family_checks",{}).get(source_family,policy["checks"].get(kind,[]))
                    for field,assessment in fields_compare(item["source_rows"][0],candidate,selected_checks).items():
                        checks["field:"+destination+":"+field]=assessment if usable else check("UNKNOWN","The observed field comparison lacks valid cutoff/identity evidence",original_comparison=assessment)
                if len(item["source_rows"])==1:
                    relations=relation_target_checks(store,item["source_rows"][0],candidate,plan["datasets"],target,
                        {ds["id"]:ds for ds in plan["datasets"]},target_by_id,policy)
                    for name,assessment in relations.items():
                        checks[name+":"+destination]=assessment if usable else check("UNKNOWN","Cutoff/identity evidence for this relation is unresolved",original_comparison=assessment)
                if kind=="documents":
                    expected_links={rel["case_id"] for rel in item["relations"] if isinstance(rel["case_id"],str)}
                    # Only case relationships belonging in this document destination are required.
                    wanted=set()
                    for rel in item["relations"]:
                        case_rows=list(query_rows(store,plan["datasets"],"cases",case_id=rel["case_id"])) if isinstance(rel["case_id"],str) else []
                        case_dest,_=case_destination(case_rows,policy)
                        if case_dest and destination in destinations_for_documents(case_rows,policy):wanted.add(rel["case_id"])
                    association=target_relationships(store,target,target_by_id,candidate,policy,destination,expected_links,wanted)
                    checks["relationships:"+destination]=association if source_usable else check("UNKNOWN","The source relationship basis at the selected cutoff is unresolved",original_comparison=association)
        extras=[r for r in observed if r["destination"] not in expected_dest]
        if extras:
            valid_extras=[r for r in extras if logical(r,policy)==item["key"] and not r["issues"] and
                          r["values"].get("deleted") is not True and clock_check(target_by_id[r["dataset_id"]],policy,True)["status"]=="MATCH"]
            checks["cross_destination"]=check("DIFFERENT" if expected_dest and source_usable and valid_extras else "UNKNOWN",
                                               "Cutoff-valid active copies outside the selected destination rule require explicit review",
                                               rows=[{"id":r["id"],"destination":r["destination"],"capture":clock_check(target_by_id[r["dataset_id"]],policy,True)} for r in extras])
        count+=1;item=persist_item(store,result_id,count,item);counts[item["status"]]+=1
    # Independent observed identities outside the selected original source population.
    for kind in KINDS:
        for key,rows in grouped(store,target,kind,policy):
            known=store.conn.execute("SELECT 1 FROM case_items WHERE owner_id=? AND kind=? AND identity_key=?",(plan["id"],kind,key)).fetchone()
            if known:continue
            observed_profiles=[target_by_id[row["dataset_id"]] for row in rows]
            baselines=[[ds for ds in plan["datasets"] if ds["kind"]==kind and
                        ds.get("record_family")==observed_ds.get("record_family") and
                        ds.get("identity_scopes",{})==observed_ds.get("identity_scopes",{})]
                       for observed_ds in observed_profiles]
            baseline=[ds for selected_baseline in baselines for ds in selected_baseline]
            valid_identity=all(logical(row,policy)==key for row in rows)
            active_observed=any(not row["issues"] and row["values"].get("deleted") is not True and
                                clock_check(target_by_id[row["dataset_id"]],policy,True)["status"]=="MATCH" for row in rows)
            absent=valid_identity and active_observed and all(baselines) and bool(baseline) and all(complete(ds,policy) and clock_check(ds,policy)["status"]=="MATCH" for ds in baseline)
            checks={"baseline_presence":check("UNEXPECTED" if absent else "UNKNOWN","Independent target identity is absent from the selected original population; completeness controls the conclusion")}
            for row in rows:checks["target_capture:"+row["id"]]=clock_check(target_by_id[row["dataset_id"]],policy,True)
            item={"kind":kind,"key":key,"source_rows":[],"expected_destinations":[],"observed_rows":[row_ref(r)|{"destination":r["destination"]} for r in rows],
                  "reported_rows":[],"relations":[],"checks":checks,"issues":[]}
            count+=1;item=persist_item(store,result_id,count,item);counts[item["status"]]+=1
    need(store.conn.execute("SELECT count(*) FROM case_items WHERE owner_id=?",(result_id,)).fetchone()[0]==count,"CASE_PREFIX_CHANGED","Rehearsal ends before retained results")
    body={"schema":VERSION+"/rehearsal","id":result_id,"title":p["title"],"plan_id":plan["id"],"plan":plan,
          "scope_id":plan["scope_id"],"identity_namespace":plan["identity_namespace"],"target_datasets":target,"receipt_datasets":receipt,
          "summary":{"total":count,"counts":counts},"item_count":count,"parent_rehearsal_id":p.get("parent_rehearsal_id"),
          "note":p["note"],**metadata(op)}
    return store.put_entity("case_rehearsal",result_id,body,op["reserved_revision"])

def item_get(store,owner_id,item_id):
    row=store.conn.execute("SELECT body_json FROM case_items WHERE owner_id=? AND id=?",(owner_id,item_id)).fetchone()
    need(row is not None,"CASE_ITEM_NOT_FOUND","Choose the original item in this retained selection")
    return parse_json(row[0])

def review_tips(store,rehearsal_id,item_id):
    history=[]
    for row in store.conn.execute("SELECT body_json FROM entities WHERE kind='case_review' ORDER BY created_revision,id"):
        value=parse_json(row[0])
        if value["rehearsal_id"]==rehearsal_id and value["item_id"]==item_id:history.append(value)
    superseded={value.get("parent_review_id") for value in history}
    return [value for value in history if value["id"] not in superseded]

def review_create(store,op):
    result_id,old=begin(store,op,"review")
    if old:return old
    p=op["request"];rehearsal=store.get_entity("case_rehearsal",p.get("rehearsal_id"))
    item=item_get(store,rehearsal["id"],p.get("item_id"))
    need(p.get("disposition") in ("rework","waiting_evidence","accepted_variance","withdrawn"),"CASE_REVIEW","Choose an explicit review disposition")
    text(p.get("reason"),"reason");optional_text(p.get("assigned_to"),"assigned_to")
    earlier=parent(store,"case_review",p.get("parent_review_id"),rehearsal["scope_id"])
    if earlier:need(earlier["rehearsal_id"]==rehearsal["id"] and earlier["item_id"]==item["id"],"CASE_REVIEW_PARENT","Review predecessor must address the same exact original finding")
    tips=review_tips(store,rehearsal["id"],item["id"])
    need(not tips and earlier is None or len(tips)==1 and earlier is not None and tips[0]["id"]==earlier["id"],
         "CASE_REVIEW_SUCCESSOR","Follow the current original review; competing review tips require explicit resolution",
         {"current_review_ids":[value["id"] for value in tips]})
    refs=[]
    for value in unique_strings(p.get("evidence_row_ids",[]),"evidence row IDs"):
        row=row_description(store,value);refs.append({"row_id":row["id"],"source_ref":row["source_ref"]})
    body={"schema":VERSION+"/review","id":result_id,"scope_id":rehearsal["scope_id"],
          "rehearsal_id":rehearsal["id"],"item_id":item["id"],"item":item,"disposition":p["disposition"],
          "reason":p["reason"],"assigned_to":p.get("assigned_to"),"parent_review_id":p.get("parent_review_id"),"evidence_rows":refs,
          "review_basis_revision":store.project["revision"],**metadata(op)}
    return store.put_entity("case_review",result_id,body,op["reserved_revision"])

def cutover_create(store,op):
    result_id,old=begin(store,op,"cutover")
    if old:return old
    p=op["request"];rehearsal=store.get_entity("case_rehearsal",p.get("rehearsal_id"))
    for name in ("title","reason","owner","rollback"):text(p.get(name),name)
    decision=p.get("decision");need(decision in ("hold","ready_for_review","approved"),"CASE_CUTOVER","Choose a recorded operator decision")
    start,end=p.get("window_start"),p.get("window_end")
    need((start is None)==(end is None),"CASE_WINDOW","Provide both window boundaries or neither")
    if start is not None:need(stamp(start,"window_start")<stamp(end,"window_end"),"CASE_WINDOW","Window end must follow start")
    earlier=parent(store,"case_cutover",p.get("parent_cutover_id"),rehearsal["scope_id"])
    reviews=[store.get_entity("case_review",value) for value in unique_strings(p.get("review_ids",[]),"review IDs")]
    for review in reviews:
        need(review["rehearsal_id"]==rehearsal["id"] and review["disposition"]=="accepted_variance",
             "CASE_CUTOVER_REVIEW","Select an explicit accepted variance for this exact rehearsal")
        tips=review_tips(store,rehearsal["id"],review["item_id"])
        need(len(tips)==1 and tips[0]["id"]==review["id"],"CASE_CUTOVER_REVIEW_SUPERSEDED",
             "Select the current unsuperseded review of this original finding",
             {"selected_review_id":review["id"],"current_review_ids":[value["id"] for value in tips]})
    waived={r["item_id"] for r in reviews}
    unresolved=[]
    for row in store.conn.execute("SELECT id,kind,identity_key,status FROM case_items WHERE owner_id=? AND status!='MATCH' ORDER BY ordinal",(rehearsal["id"],)):
        if row["id"] not in waived:unresolved.append({"id":row["id"],"kind":row["kind"],"key":row["identity_key"],"status":row["status"]})
    tasks=p.get("tasks",[]);need(isinstance(tasks,list) and len(tasks)<=1000,"CASE_CUTOVER_TASKS","Use the complete selected task list")
    seen=set();clean=[]
    for task in tasks:
        need(isinstance(task,dict),"CASE_CUTOVER_TASKS","Task must be an object")
        task_id=identifier(task.get("id"));need(task_id not in seen,"CASE_CUTOVER_TASKS","Task IDs must be unique");seen.add(task_id)
        for name in ("title","owner"):text(task.get(name),"task."+name)
        need(task.get("status") in ("pending","complete","blocked"),"CASE_CUTOVER_TASKS","Choose actual task status")
        files=[store.file_info(value) for value in unique_strings(task.get("evidence_file_sha256s",[]),"evidence files")]
        need(task["status"]!="complete" or files,"CASE_CUTOVER_TASKS","Completed tasks require retained original evidence files")
        clean.append({"id":task_id,"title":task["title"],"owner":task["owner"],"status":task["status"],"evidence_files":files,"note":optional_text(task.get("note"),"task.note")})
    if decision=="approved":
        need(start is not None and not unresolved and clean and all(t["status"]=="complete" for t in clean),
             "CASE_CUTOVER_NOT_READY","Approval requires an explicit window, disposition of every finding and evidence-backed completed tasks",
             {"unresolved":unresolved,"unfinished_task_ids":[t["id"] for t in clean if t["status"]!="complete"]})
    body={"schema":VERSION+"/cutover","id":result_id,"title":p["title"],"scope_id":rehearsal["scope_id"],
          "rehearsal_id":rehearsal["id"],"decision":decision,"reason":p["reason"],"owner":p["owner"],
          "window_start":start,"window_end":end,"rollback":p["rollback"],"tasks":clean,"reviews":reviews,
          "unresolved":unresolved,"parent_cutover_id":p.get("parent_cutover_id"),"review_basis_revision":store.project["revision"],**metadata(op),
          "meaning":"Explicit recorded operator decision; this does not dispatch a migration or establish buyer acceptance authority"}
    return store.put_entity("case_cutover",result_id,body,op["reserved_revision"])

HANDLERS={"case.dataset.create":dataset_create,"case.plan.create":plan_create,"case.rehearsal.create":rehearsal_create,
          "case.review.create":review_create,"case.cutover.create":cutover_create}

def listed(store,p):
    kind=p.get("kind");need(kind in ("dataset","plan","rehearsal","review","cutover"),"CASE_KIND","Choose an advertised case collection")
    offset,limit=page(p);where="kind=?";args=["case_"+kind]
    if p.get("query"):text(p["query"],"query");where+=" AND instr(lower(body_json),lower(?))>0";args.append(p["query"])
    total=store.conn.execute("SELECT count(*) FROM entities WHERE "+where,args).fetchone()[0]
    rows=[parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM entities WHERE "+where+" ORDER BY created_revision DESC,id LIMIT ? OFFSET ?",(*args,limit,offset))]
    return {"rows":rows,"total":total,"offset":offset,"limit":limit}

def item_page(store,p,kind):
    value=store.get_entity("case_"+kind,p.get("id"));offset,limit=page(p)
    table="case_dataset_rows" if kind=="dataset" else "case_items"
    column="dataset_id" if kind=="dataset" else "owner_id"
    where=column+"=?";args=[value["id"]]
    if p.get("kind"):need(p["kind"] in KINDS,"CASE_KIND","Choose a case family");where+=" AND kind=?";args.append(p["kind"])
    if p.get("status"):
        need(table=="case_items" and p["status"] in STATUSES,"CASE_STATUS","Choose a result status")
        where+=" AND status=?";args.append(p["status"])
    if p.get("query"):text(p["query"],"query");where+=" AND instr(lower(body_json),lower(?))>0";args.append(p["query"])
    total=store.conn.execute("SELECT count(*) FROM "+table+" WHERE "+where,args).fetchone()[0]
    rows=[parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM "+table+" WHERE "+where+" ORDER BY ordinal LIMIT ? OFFSET ?",(*args,limit,offset))]
    return {"rows":rows,"total":total,"offset":offset,"limit":limit}

def compare(store,p):
    before=store.get_entity("case_rehearsal",p.get("before_id"));after=store.get_entity("case_rehearsal",p.get("after_id"))
    need((before["scope_id"],before["identity_namespace"])==(after["scope_id"],after["identity_namespace"]),
         "CASE_COMPARE_SCOPE","Compare the same source scope and logical identity namespace")
    need(before["plan"]["policy"]["document_identity"]==after["plan"]["policy"]["document_identity"],
         "CASE_COMPARE_IDENTITY","Choose the same document identity policy")
    offset,limit=page(p)
    args=(before["id"],after["id"])
    query="SELECT kind,identity_key FROM case_items WHERE owner_id IN (?,?) GROUP BY kind,identity_key"
    total=store.conn.execute("SELECT count(*) FROM ("+query+")",args).fetchone()[0]
    rows=[]
    for kind,key in store.conn.execute(query+" ORDER BY kind,identity_key LIMIT ? OFFSET ?",(*args,limit,offset)):
        values=[]
        for selected in args:
            found=store.conn.execute("SELECT body_json FROM case_items WHERE owner_id=? AND kind=? AND identity_key=?",(selected,kind,key)).fetchone()
            values.append(parse_json(found[0]) if found else None)
        left,right=values
        transition="NEW_IDENTITY" if left is None else "IDENTITY_NOT_SELECTED" if right is None else "DESTINATION_CHANGED" if left["expected_destinations"]!=right["expected_destinations"] else "STATUS_CHANGED" if left["status"]!=right["status"] else "SAME_STATUS"
        rows.append({"kind":kind,"key":key,"before":left,"after":right,"transition":transition})
    return {"rows":rows,"total":total,"offset":offset,"limit":limit,"before_id":before["id"],"after_id":after["id"]}

def read(store,operation,p):
    if operation=="case.schema":return schema()
    if operation=="case.list":return listed(store,p)
    if operation=="case.dataset.preview":return preview(store,p)
    if operation=="case.dataset.rows":return item_page(store,p,"dataset")
    if operation=="case.plan.items":return item_page(store,p,"plan")
    if operation=="case.rehearsal.items":return item_page(store,p,"rehearsal")
    if operation=="case.rehearsal.compare":return compare(store,p)
    for kind in ("dataset","plan","rehearsal","review","cutover"):
        if operation=="case."+kind+".get":return store.get_entity("case_"+kind,p.get("id"))
    raise MigrationError("UNKNOWN_OPERATION","Unknown case reader")


# Reviewed relation semantics share the original projections and stored plan.
DEFAULT_DESTINATION_POLICY = {"live_cases":"dynamics","live_documents":"sharepoint",
                              "closed_cases":"archive","closed_documents":"archive"}

def destination_policy(value):
    if value is None:return dict(DEFAULT_DESTINATION_POLICY)
    need(isinstance(value,dict) and set(value)==set(DEFAULT_DESTINATION_POLICY),
         "CASE_DESTINATION_POLICY","Select all four explicit live/closed case/document destinations")
    return {key:identifier(value[key]) for key in DEFAULT_DESTINATION_POLICY}

def destinations_for_documents(rows,policy):
    if len(rows)!=1:return []
    row=rows[0]
    if row["presence"].get("status")!="value" or row["values"].get("deleted") is True or row["presence"].get("deleted")=="invalid":return []
    route=policy.get("destination_policy",DEFAULT_DESTINATION_POLICY)
    state=row["values"]["status"]
    if state in policy["live_statuses"]:return [route["live_documents"]]
    if state in policy["closed_statuses"]:return [route["closed_documents"]]
    return []

def scoped_identity(value,scope):
    return canonical([scope,value]) if scope else value

def relation_rules(value,selected):
    if value is None:return []
    need(isinstance(value,list) and len(value)<=256,"CASE_RELATIONS","Use at most 256 complete reviewed relation rules")
    result=[];seen=set()
    for rule in value:
        need(isinstance(rule,dict) and set(rule)=={"id","source_family","field","target_family","target_kind","target_scope","cardinality","required"},
             "CASE_RELATIONS","Retain every explicit relation rule field")
        rule=dict(rule)
        for key in ("id","source_family","field","target_family"):identifier(rule[key])
        need(rule["id"] not in seen,"CASE_RELATIONS","Relation rule IDs must be unique");seen.add(rule["id"])
        need(rule["target_kind"] in ("cases","documents") and rule["cardinality"] in ("one","many") and type(rule["required"]) is bool,
             "CASE_RELATIONS","Declare target cases/documents, one/many and an explicit required boolean")
        need(rule["target_scope"] is None or isinstance(rule["target_scope"],str) and FIELD_NAME.fullmatch(rule["target_scope"]),
             "CASE_RELATIONS","Target scope must be the explicit identity scope or null")
        origin=[ds for ds in selected if ds.get("record_family")==rule["source_family"]]
        target=[ds for ds in selected if ds.get("record_family")==rule["target_family"] and ds["kind"]==rule["target_kind"]]
        need(origin and target,"CASE_RELATIONS","Select the complete source and target record families for every rule")
        need(all(rule["field"] in ds["fields"] for ds in origin),"CASE_RELATIONS","Map each relation field on its whole selected source family")
        key="case_id" if rule["target_kind"]=="cases" else "document_id"
        need(all(ds.get("identity_scopes",{}).get(key)==rule["target_scope"] for ds in target),
             "CASE_RELATIONS","Relation target scope must match every referenced family identity")
        result.append(rule)
    return result

def relation_ids(row,rule):
    present=row["presence"].get(rule["field"],"missing")
    value=row["values"].get(rule["field"])
    if present in ("missing","invalid"):return None,"Original relation field is missing or invalid"
    if present in ("null","empty"):
        return (None,"Required relation is empty") if rule["required"] else ([],"Explicitly empty optional relation")
    def scalar(v):
        if isinstance(v,str):return v
        if isinstance(v,dict) and v.get("type")=="string" and set(v)=={"type","value"} and isinstance(v["value"],str):return v["value"]
        return None
    if rule["cardinality"]=="one":
        value=scalar(value)
        if value is None or not value:return None,"A single original text identity is required"
        return [value],"Original single relation"
    if isinstance(value,dict) and value.get("type")=="array":value=value.get("items")
    if not isinstance(value,list):return None,"An explicit original array of text identities is required"
    values=[scalar(item) for item in value]
    if any(item is None or not item for item in values) or len(values)!=len(set(values)):
        return None,"Relation array contains invalid or repeated identities"
    if not values and rule["required"]:return None,"Required relation array is empty"
    return values,"Original relation array"

def related_rows(store,selected,rule,value):
    identity_field="case_id" if rule["target_kind"]=="cases" else "document_id"
    selected=[ds for ds in selected if ds.get("record_family")==rule["target_family"] and ds["kind"]==rule["target_kind"] and
              ds.get("identity_scopes",{}).get(identity_field)==rule["target_scope"]]
    key=scoped_identity(value,rule["target_scope"])
    return list(query_rows(store,selected,rule["target_kind"],**{"case_id" if rule["target_kind"]=="cases" else "document_id":key}))

def relation_source_checks(store,row,selected,by_id,policy):
    checks={}
    family=by_id[row["dataset_id"]].get("record_family")
    for rule in policy.get("relation_rules",[]):
        if rule["source_family"]!=family:continue
        ids,reason=relation_ids(row,rule);key="relation:"+rule["id"]+":"+row["id"]
        if ids is None:
            checks[key]=check("UNKNOWN",reason,field=rule["field"],source_row_id=row["source_row_id"]);continue
        references=[];states=[]
        for value in ids:
            found=related_rows(store,selected,rule,value)
            valid=len(found)==1
            assessment=check("MATCH" if valid else "AMBIGUOUS" if found else "UNKNOWN",
                             "Original relation must identify one retained record in its declared family",
                             original_id=value,scoped_id=scoped_identity(value,rule["target_scope"]),
                             rows=[row_ref(item) for item in found])
            states.append(assessment["status"])
            references.append(assessment)
            for item in found:checks.update(source_evidence(item,by_id,policy))
        checks[key]=check("AMBIGUOUS" if "AMBIGUOUS" in states else "UNKNOWN" if "UNKNOWN" in states else "MATCH",
                          reason,rule=rule,references=references)
    return checks

def relation_target_checks(store,source,target,source_selected,target_selected,source_by_id,target_by_id,policy):
    checks={};family=source_by_id[source["dataset_id"]].get("record_family")
    target_family=target_by_id[target["dataset_id"]].get("record_family")
    original_scopes=source_by_id[source["dataset_id"]].get("identity_scopes",{})
    returned_scopes=target_by_id[target["dataset_id"]].get("identity_scopes",{})
    if original_scopes!=returned_scopes:
        checks["identity_scopes"]=check("DIFFERENT","Independent target identity scopes must equal the selected original scopes",
                                        expected=original_scopes,observed=returned_scopes)
    if target_family!=family:
        checks["record_family"]=check("DIFFERENT","Independent target occurrence belongs to another declared record family",
                                      expected=family,observed=target_family)
    for rule in policy.get("relation_rules",[]):
        if rule["source_family"]!=family:continue
        left,reason=relation_ids(source,rule);right,other=relation_ids(target,rule);key="relation:"+rule["id"]
        if left is None or right is None:
            checks[key]=check("UNKNOWN","Original or returned relationship is unresolved",source_reason=reason,target_reason=other);continue
        # Ordering is retained in original values; relation membership is explicit.
        equal=set(left)==set(right)
        evidence=[];outcomes=[]
        for value in right:
            original=related_rows(store,source_selected,rule,value)
            found=related_rows(store,target_selected,rule,value)
            expected=[]
            for original_row in original:
                if rule["target_kind"]=="cases":expected.extend(case_destination([original_row],policy)[0])
                else:
                    for rel in original_links(store,source_selected,original_row,policy):
                        parent_rows=list(query_rows(store,source_selected,"cases",case_id=rel["case_id"])) if isinstance(rel["case_id"],str) else []
                        expected.extend(destinations_for_documents(parent_rows,policy))
            expected=sorted(set(expected))
            required=[];unknown=len(original)!=1 or not expected
            for destination in expected:
                candidates=[item for item in found if item["destination"]==destination]
                state="MATCH" if len(candidates)==1 else "AMBIGUOUS" if candidates else "UNKNOWN"
                for item in candidates:
                    captured=clock_check(target_by_id[item["dataset_id"]],policy,True)
                    valid=(captured["status"]=="MATCH" and not item["issues"] and
                           item["values"].get("deleted") is not True and item["presence"].get("deleted")!="invalid")
                    if not valid:state="UNKNOWN"
                    required.append({"destination":destination,"row":row_ref(item),"capture":captured,"usable":valid})
                outcomes.append(state)
            if unknown:outcomes.append("UNKNOWN")
            evidence.append({"original_id":value,"expected_destinations":expected,"observed":required,
                             "source_rows":[row_ref(item) for item in original]})
        state="DIFFERENT" if not equal else "AMBIGUOUS" if "AMBIGUOUS" in outcomes else "UNKNOWN" if "UNKNOWN" in outcomes else "MATCH"
        checks[key]=check(state,"Compare original relation membership and independently observed referenced records",
                          expected=left,observed=right,rule=rule,references=evidence)
    return checks
