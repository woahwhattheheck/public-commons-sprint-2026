"""Explicit source-register, relationship and financial-control migration on the original store."""
from __future__ import annotations
import json
import re
from datetime import date
from pathlib import Path
from migration_store import MigrationError, canonical, identity, parse_json, text, identifier, integer, page, file_hash
from migration_formats import source_description, row_description
from migration_cases import OriginalNumber, MISSING, retained_value, original_object, selected, selector, stamp

VERSION="ma-dor.register-migration/v1"
NAMES=("dataset","plan","rehearsal","review","cutover")
ENTITY_KINDS=tuple("register_"+name for name in NAMES)
MUTATIONS=tuple("register."+name+".create" for name in NAMES)
READS=("register.schema","register.list","register.dataset.preview","register.dataset.get","register.dataset.rows",
       "register.plan.get","register.plan.items","register.rehearsal.get","register.rehearsal.items",
       "register.rehearsal.compare","register.review.get","register.cutover.get")
TYPES=("text","decimal","date","datetime","boolean","json")
STATUSES=("MATCH","DIFFERENT","UNKNOWN","AMBIGUOUS","MISSING","UNEXPECTED")
FIELD=re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
DECIMAL=re.compile(r"^([+-]?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$")
DDL="""
CREATE TABLE IF NOT EXISTS register_rows(
 id TEXT PRIMARY KEY,dataset_id TEXT NOT NULL,ordinal INTEGER NOT NULL,source_row_id TEXT NOT NULL,
 register_name TEXT NOT NULL,identity_key TEXT,body_json TEXT NOT NULL,UNIQUE(dataset_id,ordinal));
CREATE INDEX IF NOT EXISTS register_rows_key ON register_rows(dataset_id,identity_key);
CREATE TABLE IF NOT EXISTS register_items(
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,ordinal INTEGER NOT NULL,kind TEXT NOT NULL,
 register_name TEXT NOT NULL,identity_key TEXT NOT NULL,status TEXT NOT NULL,body_json TEXT NOT NULL,
 UNIQUE(owner_id,ordinal),UNIQUE(owner_id,kind,register_name,identity_key));
CREATE INDEX IF NOT EXISTS register_items_status ON register_items(owner_id,status);
"""
def need(ok,code,message,details=None):
    if not ok:raise MigrationError(code,message,details)
def ensure(store):
    need(not store.conn.in_transaction,"REGISTER_SCHEMA","Open the register schema outside a write transaction")
    store.conn.executescript(DDL)
def strings(value,name,empty=False,maximum=1000):
    need(isinstance(value,list) and (empty or value) and len(value)<=maximum,"REGISTER_LIST","Select a complete bounded "+name+" list")
    for entry in value:text(entry,name,max_length=4096)
    need(len(value)==len(set(value)),"REGISTER_LIST","Repeated "+name)
    return list(value)
def optional(value,name):
    if value is not None and value!="":text(value,name)
    return value
def metadata(op):
    return {"created_at":op["created_at"],"created_revision":op["reserved_revision"],"operation_id":op["id"],"actor":op["actor"]}
def begin(store,op,name):
    rid="register-"+name+"-"+identity({"operation":op["id"],"request":op["request_sha256"]})[:40]
    old=store.get_entity("register_"+name,rid,required=False)
    if old:return rid,old
    root=Path(__file__).parent
    implementation={"schema":VERSION,"files":{name:file_hash(root/name)["sha256"] for name in
                    ("migration_registers.py","migration_cases.py","migration_formats.py","migration_store.py")}}
    checkpoint={"register_implementation":implementation,"result_id":rid}
    if op.get("checkpoint"):need(op["checkpoint"]==checkpoint,"REGISTER_IMPLEMENTATION_CHANGED","Continue the original operation with its complete selected source edition")
    else:store.checkpoint(op["id"],checkpoint)
    return rid,None
def parent(store,name,rid,scope=None):
    if rid is None:return None
    value=store.get_entity("register_"+name,identifier(rid))
    if scope is not None:need(value["scope_id"]==scope,"REGISTER_PARENT","Predecessor has a different source scope")
    return value
def decimal_parts(value):
    token=value.token if isinstance(value,OriginalNumber) else value
    need(isinstance(token,str) and len(token)<=2048,"REGISTER_DECIMAL","Select an exact finite decimal token")
    match=DECIMAL.fullmatch(token)
    need(match is not None,"REGISTER_DECIMAL","Invalid exact decimal")
    sign,whole,fraction,exponent=match.groups();fraction=fraction or ""
    need(len(whole)+len(fraction)<=1000 and (exponent is None or len(exponent.lstrip("+-"))<=4),
         "REGISTER_DECIMAL","Decimal coefficient or exponent exceeds the explicit 1000-digit bound")
    power=int(exponent or "0");need(abs(power)<=1000,"REGISTER_DECIMAL","Decimal exponent exceeds the explicit bound")
    coefficient=int(whole+fraction)*(-1 if sign=="-" else 1);scale=len(fraction)-power
    if scale<0:coefficient*=10**(-scale);scale=0
    while scale and coefficient%10==0:coefficient//=10;scale-=1
    return coefficient,scale
def canonical_decimal_parts(value):
    # Only values emitted by the bounded original-token parser or exact sums
    # reach this path. Their normalized expansion can exceed the source token.
    need(isinstance(value,str) and len(value)<=4096 and re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?",value) is not None,
         "REGISTER_DECIMAL","Invalid internal exact canonical decimal")
    negative=value.startswith("-");parts=value.lstrip("-").split(".");fraction=parts[1] if len(parts)==2 else ""
    coefficient=int(parts[0]+fraction)*(-1 if negative else 1);scale=len(fraction)
    while scale and coefficient%10==0:coefficient//=10;scale-=1
    return coefficient,scale
def decimal_text(pair):
    coefficient,scale=pair
    if coefficient==0:return "0"
    sign="-" if coefficient<0 else "";digits=str(abs(coefficient))
    if scale:digits=digits.rjust(scale+1,"0");digits=digits[:-scale]+"."+digits[-scale:]
    return sign+digits
def decimal_add(left,right):
    a,sa=left;b,sb=right;scale=max(sa,sb)
    return (a*10**(scale-sa)+b*10**(scale-sb),scale)
def normalize(value,kind):
    if value is MISSING:return None,"missing",None
    if value is None:return None,"null",None
    if isinstance(value,str) and not value.strip():return value,"empty",None
    try:
        if kind=="text":need(isinstance(value,str),"REGISTER_TYPE","Exact text required");result=value
        elif kind=="boolean":need(isinstance(value,bool),"REGISTER_TYPE","Explicit boolean required");result=value
        elif kind=="decimal":result=decimal_text(decimal_parts(value))
        elif kind=="date":
            need(isinstance(value,str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}",value),"REGISTER_TYPE","ISO date required")
            date.fromisoformat(value);result=value
        elif kind=="datetime":
            need(isinstance(value,str),"REGISTER_TYPE","ISO timestamp with an explicit offset required")
            fractions=re.findall(r"[.,]([0-9]+)",value)
            need(all(not part[6:].strip("0") for part in fractions),"REGISTER_TYPE","Timestamp precision beyond microseconds is not representable; retain the original and select an explicit convention")
            result=stamp(value,"mapped timestamp").isoformat()
        elif kind=="json":result=retained_value(value)
        else:raise MigrationError("REGISTER_TYPE","Unknown projected type")
        return result,"value",None
    except (MigrationError,ValueError,TypeError,OverflowError) as exc:return None,"invalid",str(exc)
def config(store,p):
    source=source_description(store,p.get("source_id"))
    need(source["status"]=="READY" and source["format"] in ("inventory_csv","inventory_jsonl"),"REGISTER_SOURCE","Select a completely retained original CSV or JSONL inventory")
    register=identifier(p.get("register"),"register");system=text(p.get("system"),"system",max_length=512);side=p.get("side")
    need(side in ("source","target"),"REGISTER_SIDE","Select independent source or target inventory")
    need(source["context"]["role"]==side+"_inventory","REGISTER_ROLE","Select the original declared "+side+" inventory")
    fields=p.get("fields");need(isinstance(fields,dict) and fields and len(fields)<=128,"REGISTER_FIELDS","Select 1–128 explicit projected fields")
    clean={}
    for name,spec in fields.items():
        need(isinstance(name,str) and FIELD.fullmatch(name) and isinstance(spec,dict) and not set(spec)-{"selector","type","required"},
             "REGISTER_FIELD","Use an exact field name and advertised field definition")
        kind=spec.get("type");need(kind in TYPES,"REGISTER_TYPE","Select an advertised projected type")
        chosen=selector(spec.get("selector"));want="column" if source["format"]=="inventory_csv" else "pointer"
        need(want in chosen,"REGISTER_SELECTOR","Select an exact "+want+" for this original format")
        required=spec.get("required",False);need(isinstance(required,bool),"REGISTER_FIELD","required must be an explicit boolean")
        clean[name]={"selector":chosen,"type":kind,"required":required}
    keys=strings(p.get("key_fields"),"key fields",maximum=128)
    need(all(key in clean and clean[key]["type"]=="text" for key in keys),"REGISTER_KEY","Identity fields must be mapped exact text")
    maps=p.get("value_maps",{});need(isinstance(maps,dict) and set(maps)<=set(clean),"REGISTER_VALUE_MAP","Map only selected fields")
    for field,mapping in maps.items():
        need(isinstance(mapping,dict) and len(mapping)<=100000,"REGISTER_VALUE_MAP","Use complete exact source-value mappings")
        need(all(isinstance(k,str) and isinstance(v,(str,bool)) for k,v in mapping.items()),"REGISTER_VALUE_MAP","Each value map retains exact source text and selected text or boolean")
    return {"source":source,"register":register,"system":system,"side":side,"fields":clean,"key_fields":keys,
            "value_maps":json.loads(canonical(maps)),"scope_id":source["context"]["scope_id"],"identity_namespace":source["context"]["identity_namespace"]}
def project(row,cfg,dataset_id):
    values,presence,original,conversions,issues={},{},{},{},[]
    try:obj=original_object(row)
    except (ValueError,TypeError) as exc:obj={};issues.append({"code":"original_record_invalid","message":str(exc)})
    for name,spec in cfg["fields"].items():
        raw=selected(obj,spec["selector"])
        original[name]={"present":raw is not MISSING,"value":None if raw is MISSING else retained_value(raw),"encoding":"case.typed-json/v1"}
        mapped=raw;mapping=cfg["value_maps"].get(name,{})
        if isinstance(raw,str) and raw in mapping:mapped=mapping[raw];conversions[name]={"original":raw,"selected":mapped}
        value,seen,error=normalize(mapped,spec["type"]);values[name]=value;presence[name]=seen
        if error:issues.append({"code":"invalid_projection","field":name,"message":error})
        if spec["required"] and seen!="value":issues.append({"code":"required_value_unavailable","field":name,"presence":seen})
    for name in cfg["key_fields"]:
        if presence[name]!="value":issues.append({"code":"identity_unavailable","field":name,"presence":presence[name]})
    key=canonical([values[name] for name in cfg["key_fields"]]) if all(presence[name]=="value" for name in cfg["key_fields"]) else None
    return {"id":"register-row-"+identity({"dataset":dataset_id,"source_row":row["id"]})[:40],"dataset_id":dataset_id,
            "source_row_id":row["id"],"ordinal":row["ordinal"],"register":cfg["register"],"system":cfg["system"],"side":cfg["side"],
            "key":key,"values":values,"presence":presence,"original":original,"conversions":conversions,"issues":issues,"source_ref":row["source_ref"]}
def preview(store,p):
    cfg=config(store,p);offset,limit=page(p)
    rows=[project(row_description(store,row),cfg,"preview") for row in store.conn.execute("SELECT * FROM rows WHERE source_id=? ORDER BY ordinal LIMIT ? OFFSET ?",(cfg["source"]["id"],limit,offset))]
    return {"configuration":cfg,"rows":rows,"total":cfg["source"]["row_count"],"offset":offset,"limit":limit}
def dataset_create(store,op):
    rid,old=begin(store,op,"dataset")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("review_note"),"review_note");cfg=config(store,p)
    earlier=parent(store,"dataset",p.get("parent_dataset_id"),cfg["scope_id"])
    if earlier:need(all(earlier[key]==cfg[key] for key in ("register","system","side","identity_namespace")),"REGISTER_PARENT","Correction retains register, system, side and namespace")
    count,issues,invalid=0,0,0
    for saved in store.conn.execute("SELECT * FROM rows WHERE source_id=? ORDER BY ordinal",(cfg["source"]["id"],)):
        row=project(row_description(store,saved),cfg,rid);count+=1;issues+=len(row["issues"]);invalid+=row["key"] is None
        record=(row["id"],rid,count,row["source_row_id"],row["register"],row["key"],canonical(row))
        prior=store.conn.execute("SELECT * FROM register_rows WHERE dataset_id=? AND ordinal=?",(rid,count)).fetchone()
        if prior:need(tuple(prior)==record,"REGISTER_PREFIX_CHANGED","Original projected row changed during continuation")
        else:
            with store.transaction():store.conn.execute("INSERT INTO register_rows VALUES(?,?,?,?,?,?,?)",record)
    need(store.conn.execute("SELECT count(*) FROM register_rows WHERE dataset_id=?",(rid,)).fetchone()[0]==count==cfg["source"]["row_count"],
         "REGISTER_PREFIX_CHANGED","Retain the complete original projected population")
    body={"schema":VERSION+"/dataset","id":rid,**cfg,"title":p["title"],"review_note":p["review_note"],"note":optional(p.get("note"),"note"),
          "row_count":count,"issue_count":issues,"invalid_identity_count":invalid,"parent_dataset_id":p.get("parent_dataset_id"),**metadata(op)}
    return store.put_entity("register_dataset",rid,body,op["reserved_revision"])

def datasets(store,ids,side,scope=None,namespace=None):
    values=[store.get_entity("register_dataset",identifier(value)) for value in strings(ids,"dataset IDs")]
    scope=scope or values[0]["scope_id"];namespace=namespace or values[0]["identity_namespace"]
    for value in values:
        need(value["side"]==side and value["scope_id"]==scope and value["identity_namespace"]==namespace,
             "REGISTER_SCOPE","Select one source scope/identity namespace and the requested evidence side")
    need(len({(v["source"]["id"],v["register"]) for v in values})==len(values),"REGISTER_REPEAT","Select one interpretation of each source/register")
    return values
def definitions(selected):
    result={}
    for ds in selected:
        definition={"key_fields":ds["key_fields"],"fields":{name:{"type":spec["type"],"required":spec["required"]} for name,spec in ds["fields"].items()}}
        if ds["register"] in result:need(result[ds["register"]]==definition,"REGISTER_SCHEMA","Each register requires the same complete canonical key/type/required-field definition")
        result[ds["register"]]=definition
    return result
def query_rows(store,selected,register=None,key=MISSING):
    ids=[v["id"] for v in selected if register is None or v["register"]==register]
    if not ids:return
    where="dataset_id IN ("+",".join("?" for _ in ids)+")";args=list(ids)
    if key is not MISSING:where+=" AND identity_key IS ?";args.append(key)
    for saved in store.conn.execute("SELECT body_json FROM register_rows WHERE "+where+" ORDER BY dataset_id,ordinal",args):yield parse_json(saved[0])
def groups(store,selected,register):
    ids=[v["id"] for v in selected if v["register"]==register]
    if not ids:return
    where="dataset_id IN ("+",".join("?" for _ in ids)+")"
    # Group in SQLite; each returned key retains all matching occurrences.
    for saved in store.conn.execute("SELECT identity_key FROM register_rows WHERE "+where+" AND identity_key IS NOT NULL GROUP BY identity_key ORDER BY identity_key",ids):
        key=saved[0];yield key,list(query_rows(store,selected,register,key))
    for row in query_rows(store,selected,register,None):yield canonical(["invalid",row["id"]]),[row]
def check(status,reason,**evidence):return {"status":status,"reason":reason,**evidence}
def status(checks):
    states={value["status"] for value in checks.values()}
    for state in ("AMBIGUOUS","DIFFERENT","MISSING","UNEXPECTED","UNKNOWN"):
        if state in states:return state
    return "MATCH"
def clock(ds,policy):
    context=ds["source"]["context"];value=context.get("captured_at") or context.get("observed_at")
    try:captured=stamp(value,"capture timestamp");cutoff=stamp(policy["cutoff_at"],"cutoff")
    except MigrationError:return check("UNKNOWN","Original capture time with an offset is unavailable",captured_at=value)
    age=(cutoff-captured).total_seconds()
    usable=captured>=cutoff if ds["side"]=="target" else 0<=age<=policy["max_snapshot_age_seconds"]
    return check("MATCH" if usable else "UNKNOWN","Capture must support the selected source cutoff or independent target readback",
                 captured_at=value,cutoff_at=policy["cutoff_at"],age_seconds=age,max_snapshot_age_seconds=policy["max_snapshot_age_seconds"])
def coverage(selected,register,policy):
    found=[v for v in selected if v["register"]==register];evidence=[]
    for ds in found:
        context=ds["source"]["context"];declared=context.get("coverage",{});expected=declared.get("expected_rows")
        ready=declared.get("mode")=="complete" and context.get("scan_mode")=="full" and (expected is None or expected==ds["row_count"])
        usable=ready and clock(ds,policy)["status"]=="MATCH" and ds["invalid_identity_count"]==0 and ds["issue_count"]==0
        evidence.append({"dataset_id":ds["id"],"source_id":ds["source"]["id"],"coverage":declared,"scan_mode":context.get("scan_mode"),
                         "row_count":ds["row_count"],"invalid_identity_count":ds["invalid_identity_count"],"issue_count":ds["issue_count"],
                         "capture":clock(ds,policy),"usable":usable})
    return check("MATCH" if found and all(v["usable"] for v in evidence) else "UNKNOWN",
                 "Absence and population totals require complete full usable independently selected inventories",datasets=evidence)
def row_basis(rows,by_id,policy):
    return bool(rows) and all(row["key"] is not None and not row["issues"] and clock(by_id[row["dataset_id"]],policy)["status"]=="MATCH" for row in rows)
def policy_for(selected,p):
    defs=definitions(selected);destinations=p.get("destinations")
    need(isinstance(destinations,dict) and set(destinations)==set(defs),"REGISTER_DESTINATIONS","Declare one exact expected target system for every selected register")
    for value in destinations.values():text(value,"destination",max_length=512)
    cutoff=p.get("cutoff_at");stamp(cutoff,"cutoff_at");age=integer(p.get("max_snapshot_age_seconds",0),"max_snapshot_age_seconds")
    given=p.get("checks",{});need(isinstance(given,dict) and set(given)<=set(defs),"REGISTER_CHECKS","Select checks only for the selected registers")
    checks={}
    for name,definition in defs.items():
        fields=set(definition["fields"]);keys=set(definition["key_fields"])
        checks[name]=strings(given[name],"comparison fields",empty=True,maximum=128) if name in given else sorted(fields-keys)
        need(set(checks[name])<=fields-keys,"REGISTER_CHECKS","Compare only explicitly mapped nonidentity fields")
    refs=p.get("references",[]);controls=p.get("controls",[])
    need(isinstance(refs,list) and len(refs)<=1000 and isinstance(controls,list) and len(controls)<=1000,"REGISTER_RULES","Select complete bounded rule lists")
    clean_refs=[];seen=set()
    for value in refs:
        need(isinstance(value,dict) and not set(value)-{"id","register","fields","to_register","to_fields","required","cardinality"},"REGISTER_REFERENCE","Use advertised reference fields")
        rid=identifier(value.get("id"));need(rid not in seen,"REGISTER_RULE_ID","Reference IDs must be unique");seen.add(rid)
        name,to=value.get("register"),value.get("to_register");need(name in defs and to in defs,"REGISTER_REFERENCE","References require both selected registers")
        fields=strings(value.get("fields"),"reference fields",maximum=128);target_fields=strings(value.get("to_fields"),"referenced identity",maximum=128)
        need(target_fields==defs[to]["key_fields"] and len(fields)==len(target_fields),"REGISTER_REFERENCE","Reference the complete ordered target identity")
        need(all(f in defs[name]["fields"] and defs[name]["fields"][f]["type"]=="text" for f in fields),"REGISTER_REFERENCE","Reference components must be mapped exact text")
        required=value.get("required",True);cardinality=value.get("cardinality")
        need(isinstance(required,bool) and cardinality in ("one","many"),"REGISTER_REFERENCE","Select explicit required and one/many cardinality")
        clean_refs.append({"id":rid,"register":name,"fields":fields,"to_register":to,"to_fields":target_fields,"required":required,"cardinality":cardinality})
    clean_controls=[];seen=set()
    for value in controls:
        need(isinstance(value,dict) and not set(value)-{"id","register","measure_fields","unit_fields","group_fields"},"REGISTER_CONTROL","Use advertised control fields")
        rid=identifier(value.get("id"));need(rid not in seen,"REGISTER_RULE_ID","Control IDs must be unique");seen.add(rid)
        name=value.get("register");need(name in defs,"REGISTER_CONTROL","Select an original register")
        measures=strings(value.get("measure_fields"),"measure fields",maximum=128)
        units=strings(value.get("unit_fields"),"unit fields",maximum=128);group=strings(value.get("group_fields",[]),"group fields",empty=True,maximum=128)
        fields=defs[name]["fields"]
        need(all(f in fields and fields[f]["type"]=="decimal" for f in measures),"REGISTER_CONTROL","Control measures require exact decimal projection")
        need(all(f in fields and fields[f]["type"]=="text" for f in units),"REGISTER_CONTROL","Units require exact mapped text")
        need(all(f in fields and fields[f]["type"] in ("text","date","datetime","boolean") for f in group),"REGISTER_CONTROL","Groups require explicit comparable scalar fields")
        need(len(set(measures+units+group))==len(measures+units+group),"REGISTER_CONTROL","Measures, units and groups must be distinct")
        clean_controls.append({"id":rid,"register":name,"measure_fields":measures,"unit_fields":units,"group_fields":group})
    return {"cutoff_at":cutoff,"max_snapshot_age_seconds":age,"destinations":dict(destinations),"checks":checks,
            "references":clean_refs,"controls":clean_controls,"definitions":defs}
def put_item(store,owner,ordinal,kind,register,key,source,target,checks,details=None):
    rid="register-item-"+identity({"owner":owner,"kind":kind,"register":register,"key":key})[:40]
    value={"id":rid,"owner_id":owner,"ordinal":ordinal,"kind":kind,"register":register,"key":key,"source_rows":source,"target_rows":target,
           "checks":checks,"status":status(checks),"details":details or {}}
    record=(rid,owner,ordinal,kind,register,key,value["status"],canonical(value))
    previous=store.conn.execute("SELECT * FROM register_items WHERE owner_id=? AND ordinal=?",(owner,ordinal)).fetchone()
    if previous:need(tuple(previous)==record,"REGISTER_PREFIX_CHANGED","Original result prefix changed on continuation")
    else:
        with store.transaction():store.conn.execute("INSERT INTO register_items VALUES(?,?,?,?,?,?,?,?)",record)
    return value
def finish_items(store,owner,count):
    need(store.conn.execute("SELECT count(*) FROM register_items WHERE owner_id=?",(owner,)).fetchone()[0]==count,
         "REGISTER_PREFIX_CHANGED","Original result ended before retained items")
    counts={state:0 for state in STATUSES};by_kind={kind:dict(counts) for kind in ("record","reference","control")}
    for kind,state,total in store.conn.execute("SELECT kind,status,count(*) FROM register_items WHERE owner_id=? GROUP BY kind,status",(owner,)):
        counts[state]+=total;by_kind[kind][state]=total
    return {"total":count,"counts":counts,"statusCountsByKind":by_kind}
def record_checks(left,right,source,target,register,policy,by_id,rehearsal):
    checks={}
    identity_ok=bool(left or right) and all(r["key"] is not None for r in left+right)
    checks["identity"]=check("MATCH" if identity_ok else "UNKNOWN","Use complete exact original logical identities")
    if len(left)>1 or len(right)>1:checks["uniqueness"]=check("AMBIGUOUS","Logical identity has multiple original occurrences",source_count=len(left),target_count=len(right))
    for row in left+right:
        checks["capture:"+row["id"]]=clock(by_id[row["dataset_id"]],policy)
        if row["issues"]:checks["projection:"+row["id"]]=check("UNKNOWN","Projection retains unresolved original fields",issues=row["issues"])
    if not rehearsal:return checks
    if not right:
        usable=identity_ok and row_basis(left,by_id,policy) and coverage(target,register,policy)["status"]=="MATCH"
        checks["presence"]=check("MISSING" if usable else "UNKNOWN","No independently selected target occurrence",target_coverage=coverage(target,register,policy))
    elif not left:
        usable=identity_ok and row_basis(right,by_id,policy) and coverage(source,register,policy)["status"]=="MATCH"
        checks["presence"]=check("UNEXPECTED" if usable else "UNKNOWN","No selected original source occurrence",source_coverage=coverage(source,register,policy))
    else:
        checks["presence"]=check("MATCH","Both sides retain the logical identity")
        if len(left)==len(right)==1:
            a,b=left[0],right[0]
            for field in policy["checks"][register]:
                sa,sb=a["presence"].get(field,"missing"),b["presence"].get(field,"missing")
                if "invalid" in (sa,sb):state="UNKNOWN"
                elif sa==sb and sa in ("missing","null","empty"):
                    state=("MATCH" if a["values"].get(field)==b["values"].get(field) else "DIFFERENT") if sa!="missing" and not policy["definitions"][register]["fields"][field]["required"] else "UNKNOWN"
                elif sa!= "value" or sb!="value":state="UNKNOWN"
                else:state="MATCH" if a["values"][field]==b["values"][field] else "DIFFERENT"
                checks["field:"+field]=check(state,"Compare explicit typed source and independently observed target field",
                                             source_presence=sa,target_presence=sb,source=a["values"].get(field),target=b["values"].get(field))
    return checks
def reference_side(store,rows,selected,rule,policy,by_id):
    if len(rows)!=1:return check("AMBIGUOUS" if len(rows)>1 else "UNKNOWN","Reference needs one original referring record"),[]
    row=rows[0];seen=[row["presence"].get(f,"missing") for f in rule["fields"]]
    if all(value in ("missing","null","empty") for value in seen) and not rule["required"]:
        return check("MATCH","Optional relationship has no supplied identity",presence=seen),[]
    if any(value!="value" for value in seen) or not row_basis(rows,by_id,policy):
        return check("UNKNOWN","Referring identity/capture/projection is unresolved",presence=seen),[]
    key=canonical([row["values"][f] for f in rule["fields"]]);matches=list(query_rows(store,selected,rule["to_register"],key))
    if len(matches)>1:return check("AMBIGUOUS","Referenced logical identity has duplicate original occurrences",key=key,count=len(matches)),matches
    if not matches:
        declared=coverage(selected,rule["to_register"],policy)
        return check("MISSING" if declared["status"]=="MATCH" else "UNKNOWN","Referenced record is absent from the selected population",key=key,coverage=declared),[]
    if not row_basis(matches,by_id,policy):return check("UNKNOWN","Referenced record/capture evidence is unresolved",key=key),matches
    return check("MATCH","Complete explicit relationship reaches the selected original identity",key=key),matches

def control_groups(store,source,target,rule,policy,by_id):
    import hashlib
    selected=source+target;ids=[ds["id"] for ds in selected if ds["register"]==rule["register"]]
    if not ids:return
    group_fields=rule["unit_fields"]+rule["group_fields"]
    valid=" AND ".join("json_extract(body_json,'$.presence."+f+"')='value'" for f in group_fields)
    values="json_array("+",".join("json_extract(body_json,'$.values."+f+"')" for f in group_fields)+")"
    expression="CASE WHEN "+valid+" THEN "+values+" ELSE NULL END"
    clause="dataset_id IN ("+",".join("?" for _ in ids)+")"
    sql="SELECT body_json FROM register_rows WHERE "+clause+" ORDER BY "+expression+",dataset_id,ordinal"
    # A row without a unit/group cannot be assigned conclusively to any known
    # bucket. Retain its null bucket and also withhold every group total.
    allocation_valid=" AND ".join("COALESCE(json_extract(body_json,'$.presence."+f+"'),'missing')='value'" for f in group_fields)
    unallocated={"source":0,"target":0}
    for dataset_id,total in store.conn.execute("SELECT dataset_id,count(*) FROM register_rows WHERE "+clause+" AND NOT ("+allocation_valid+") GROUP BY dataset_id",ids):
        unallocated[by_id[dataset_id]["side"]]+=total
    current=MISSING;state=None
    def new(key):
        return {"key":key,"values":None if key is None else json.loads(key),"unallocated":dict(unallocated),
                "source":{"count":0,"sums":{f:(0,0) for f in rule["measure_fields"]},"unresolved":0,"digest":hashlib.sha256()},
                "target":{"count":0,"sums":{f:(0,0) for f in rule["measure_fields"]},"unresolved":0,"digest":hashlib.sha256()}}
    for saved in store.conn.execute(sql,ids):
        row=parse_json(saved[0])
        key=canonical([row["values"][f] for f in group_fields]) if all(row["presence"].get(f)=="value" for f in group_fields) else None
        if current is MISSING or key!=current:
            if state is not None:yield state
            state=new(key);current=key
        bucket=state[row["side"]];bucket["count"]+=1
        bucket["digest"].update((canonical(row)+"\n").encode("utf-8"))
        duplicate=row["key"] is not None and store.conn.execute(
            "SELECT count(*) FROM register_rows WHERE dataset_id IN ("+",".join("?" for _ in ids if by_id[_]["side"]==row["side"])+") AND identity_key IS ?",
            (*[dsid for dsid in ids if by_id[dsid]["side"]==row["side"]],row["key"])).fetchone()[0]>1
        usable=key is not None and row_basis([row],by_id,policy) and not duplicate and all(row["presence"].get(f)=="value" for f in rule["measure_fields"])
        if not usable:bucket["unresolved"]+=1
        for field in rule["measure_fields"]:
            if row["presence"].get(field)=="value":bucket["sums"][field]=decimal_add(bucket["sums"][field],canonical_decimal_parts(row["values"][field]))
    if state is not None:yield state
    else:yield new(None)
def build_items(store,owner,source,target,policy,rehearsal):
    selected=source+target;by_id={ds["id"]:ds for ds in selected};count=0
    for register in sorted(policy["definitions"]):
        checks={"source_population":coverage(source,register,policy)}
        if rehearsal:checks["target_population"]=coverage(target,register,policy)
        count+=1;put_item(store,owner,count,"control",register,canonical(["register_population"]),[],[],checks,
                         {"type":"population","register":register,"source_dataset_ids":[d["id"] for d in source if d["register"]==register],
                          "target_dataset_ids":[d["id"] for d in target if d["register"]==register],
                          "expected_system":policy["destinations"][register]})
        for key,left in groups(store,source,register):
            right=list(query_rows(store,target,register,left[0]["key"])) if rehearsal and left[0]["key"] is not None else []
            checks=record_checks(left,right,source,target,register,policy,by_id,rehearsal)
            count+=1;put_item(store,owner,count,"record",register,key,left,right,checks,{"expected_system":policy["destinations"][register]})
        if rehearsal:
            for key,right in groups(store,target,register):
                if right[0]["key"] is not None and next(query_rows(store,source,register,right[0]["key"]),None) is not None:continue
                count+=1;put_item(store,owner,count,"record",register,key,[],right,
                                 record_checks([],right,source,target,register,policy,by_id,True),{"expected_system":policy["destinations"][register]})
    for rule in policy["references"]:
        register=rule["register"]
        for record in store.conn.execute("SELECT body_json FROM register_items WHERE owner_id=? AND kind='record' AND register_name=? ORDER BY ordinal",(owner,register)):
            item=parse_json(record[0]);left,right=item["source_rows"],item["target_rows"]
            a,source_matches=reference_side(store,left,source,rule,policy,by_id)
            checks={"source_reference":a};target_matches=[]
            if rehearsal:
                b,target_matches=reference_side(store,right,target,rule,policy,by_id);checks["target_reference"]=b
                if a["status"]==b["status"]=="MATCH" and a.get("key")!=b.get("key"):
                    checks["relationship_identity"]=check("DIFFERENT","Original and target relationship select different identities",source=a.get("key"),target=b.get("key"))
            count+=1;put_item(store,owner,count,"reference",register,canonical([rule["id"],item["key"]]),left,right,checks,
                             {"rule":rule,"source_referenced_rows":source_matches,"target_referenced_rows":target_matches,"record_item_id":item["id"]})
    for rule in policy["controls"]:
        register=rule["register"];source_coverage=coverage(source,register,policy);target_coverage=coverage(target,register,policy)
        for group in control_groups(store,source,target,rule,policy,by_id):
            checks={"source_population":source_coverage};details={"rule":rule,"group_values":group["values"],
                       "group_fields":rule["unit_fields"]+rule["group_fields"],"source_dataset_ids":[d["id"] for d in source if d["register"]==register],
                       "target_dataset_ids":[d["id"] for d in target if d["register"]==register],
                       "row_selection":"Every retained projected row of these datasets whose exact declared unit/group values equal group_values; null selects missing/invalid group fields.",
                       "unallocated_group_row_counts":group["unallocated"]}
            if rehearsal:checks["target_population"]=target_coverage
            for side in ("source","target") if rehearsal else ("source",):
                if group["unallocated"][side]:
                    checks[side+"_allocation"]=check("UNKNOWN","Selected rows lack usable unit/group values and may belong to this group",
                                                       unallocated_row_count=group["unallocated"][side])
            for side in ("source","target"):
                bucket=group[side]
                # Decimal sums are observed values; conclusive population comparisons require every selected row.
                sums={f:decimal_text(total) for f,total in bucket["sums"].items()}
                details[side]={"row_count":bucket["count"],"unresolved_row_count":bucket["unresolved"],"observed_sums":sums,
                               "complete_rows_sha256":bucket["digest"].hexdigest(),"row_digest_encoding":"sha256(concatenated canonical projected row JSON + LF in dataset_id/ordinal order)"}
                if (side=="source" or rehearsal) and bucket["unresolved"]:
                    checks[side+"_values"]=check("UNKNOWN","Control retains unresolved identity/projection/unit/amount/capture rows",count=bucket["unresolved"])
            if rehearsal:
                usable=source_coverage["status"]==target_coverage["status"]=="MATCH" and not group["source"]["unresolved"] and not group["target"]["unresolved"] and not any(group["unallocated"].values())
                checks["population_count"]=check("MATCH" if usable and group["source"]["count"]==group["target"]["count"] else "DIFFERENT" if usable else "UNKNOWN",
                                                   "Compare the full selected unit/group population",source=group["source"]["count"],target=group["target"]["count"])
                for field in rule["measure_fields"]:
                    a,b=details["source"]["observed_sums"][field],details["target"]["observed_sums"][field]
                    checks["total:"+field]=check("MATCH" if usable and canonical_decimal_parts(a)==canonical_decimal_parts(b) else "DIFFERENT" if usable else "UNKNOWN",
                                                "Compare exact signed sums only within this explicit unit/group",source=a,target=b)
            count+=1;put_item(store,owner,count,"control",register,canonical([rule["id"],group["values"]]),[],[],checks,details)
    return finish_items(store,owner,count)
def plan_create(store,op):
    rid,old=begin(store,op,"plan")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("review_note"),"review_note")
    source=datasets(store,p.get("source_dataset_ids"),"source");scope=source[0]["scope_id"];namespace=source[0]["identity_namespace"]
    policy=policy_for(source,p);earlier=parent(store,"plan",p.get("parent_plan_id"),scope)
    if earlier:need(earlier["identity_namespace"]==namespace,"REGISTER_PARENT","Keep the predecessor identity namespace")
    summary=build_items(store,rid,source,[],policy,False)
    value={"schema":VERSION+"/plan","id":rid,"title":p["title"],"review_note":p["review_note"],"note":optional(p.get("note"),"note"),
           "scope_id":scope,"identity_namespace":namespace,"source_dataset_ids":[v["id"] for v in source],"datasets":source,"policy":policy,
           "summary":summary,"item_count":summary["total"],"parent_plan_id":p.get("parent_plan_id"),**metadata(op)}
    return store.put_entity("register_plan",rid,value,op["reserved_revision"])
def rehearsal_create(store,op):
    rid,old=begin(store,op,"rehearsal")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("review_note"),"review_note")
    plan=store.get_entity("register_plan",p.get("plan_id"));target=datasets(store,p.get("target_dataset_ids"),"target",plan["scope_id"],plan["identity_namespace"])
    defs=definitions(target)
    need(set(defs)<=set(plan["policy"]["definitions"]) and all(defs[k]==plan["policy"]["definitions"][k] for k in defs),
         "REGISTER_TARGET_SCHEMA","Independent target fields/types/required flags and keys must match the selected canonical plan")
    for ds in target:need(ds["system"]==plan["policy"]["destinations"][ds["register"]],"REGISTER_TARGET_SYSTEM","Select the exact declared independent destination")
    earlier=parent(store,"rehearsal",p.get("parent_rehearsal_id"),plan["scope_id"])
    if earlier:need(earlier["identity_namespace"]==plan["identity_namespace"] and earlier["plan"]["policy"]["definitions"]==plan["policy"]["definitions"],
                    "REGISTER_PARENT","Compare corrected evidence with the same canonical identities/field definitions")
    summary=build_items(store,rid,plan["datasets"],target,plan["policy"],True)
    value={"schema":VERSION+"/rehearsal","id":rid,"title":p["title"],"review_note":p["review_note"],"note":optional(p.get("note"),"note"),
           "scope_id":plan["scope_id"],"identity_namespace":plan["identity_namespace"],"plan_id":plan["id"],"plan":plan,
           "target_dataset_ids":[v["id"] for v in target],"target_datasets":target,"summary":summary,"item_count":summary["total"],
           "parent_rehearsal_id":p.get("parent_rehearsal_id"),**metadata(op)}
    return store.put_entity("register_rehearsal",rid,value,op["reserved_revision"])
def item_get(store,owner,item):
    row=store.conn.execute("SELECT body_json FROM register_items WHERE owner_id=? AND id=?",(owner,item)).fetchone()
    need(row is not None,"REGISTER_ITEM","Select an original complete result item")
    return parse_json(row[0])
def review_tips(store,rehearsal_id,item_id):
    rows=[]
    for saved in store.conn.execute("SELECT body_json FROM entities WHERE kind='register_review' ORDER BY created_revision,id"):
        value=parse_json(saved[0])
        if value["rehearsal_id"]==rehearsal_id and value["item_id"]==item_id:rows.append(value)
    superseded={r.get("parent_review_id") for r in rows}
    return [r for r in rows if r["id"] not in superseded]
def review_create(store,op):
    rid,old=begin(store,op,"review")
    if old:return old
    p=op["request"];text(p.get("title"),"title");text(p.get("reason"),"reason")
    rehearsal=store.get_entity("register_rehearsal",p.get("rehearsal_id"));item=item_get(store,rehearsal["id"],p.get("item_id"))
    need(p.get("disposition") in ("rework","waiting_evidence","accepted_variance","withdrawn"),"REGISTER_REVIEW","Choose an advertised finding disposition")
    earlier=parent(store,"review",p.get("parent_review_id"),rehearsal["scope_id"]);tips=review_tips(store,rehearsal["id"],item["id"])
    if earlier:need(earlier["rehearsal_id"]==rehearsal["id"] and earlier["item_id"]==item["id"],"REGISTER_REVIEW_PARENT","Follow the same original finding")
    need((not tips and earlier is None) or (len(tips)==1 and earlier is not None and tips[0]["id"]==earlier["id"]),
         "REGISTER_REVIEW_TIP","Follow the current original review tip",{"current_review_ids":[v["id"] for v in tips]})
    evidence=[]
    for row_id in strings(p.get("evidence_row_ids",[]),"evidence rows",empty=True):
        row=row_description(store,identifier(row_id));need(row["source_ref"]["source_status"]=="READY","REGISTER_EVIDENCE","Select complete original evidence")
        evidence.append({"row_id":row["id"],"source_ref":row["source_ref"]})
    value={"schema":VERSION+"/review","id":rid,"title":p["title"],"scope_id":rehearsal["scope_id"],"identity_namespace":rehearsal["identity_namespace"],
           "rehearsal_id":rehearsal["id"],"item_id":item["id"],"item":item,"disposition":p["disposition"],"reason":p["reason"],
           "evidence_rows":evidence,"parent_review_id":p.get("parent_review_id"),"note":optional(p.get("note"),"note"),
           "basis_revision":store.project["revision"],**metadata(op)}
    return store.put_entity("register_review",rid,value,op["reserved_revision"])
def cutover_create(store,op):
    rid,old=begin(store,op,"cutover")
    if old:return old
    p=op["request"]
    for name in ("title","reason","acceptance_owner"):text(p.get(name),name)
    ids=strings(p.get("rehearsal_ids"),"rehearsal IDs");results=[store.get_entity("register_rehearsal",identifier(value)) for value in ids]
    scope,namespace=results[0]["scope_id"],results[0]["identity_namespace"]
    need(all(v["scope_id"]==scope and v["identity_namespace"]==namespace for v in results),"REGISTER_SCOPE","Select one reviewed source scope/namespace")
    need(p.get("decision") in ("hold","ready_for_review","approved"),"REGISTER_CUTOVER","Choose an advertised recorded decision")
    earlier=parent(store,"cutover",p.get("parent_cutover_id"),scope)
    if earlier:need(earlier["identity_namespace"]==namespace,"REGISTER_PARENT","Keep the original namespace")
    review_ids=strings(p.get("accepted_review_ids",[]),"accepted review IDs",empty=True);reviews=[]
    for review_id in review_ids:
        review=store.get_entity("register_review",identifier(review_id));tips=review_tips(store,review["rehearsal_id"],review["item_id"])
        need(review["rehearsal_id"] in ids and review["disposition"]=="accepted_variance" and len(tips)==1 and tips[0]["id"]==review["id"],
             "REGISTER_ACCEPTANCE","Select only the current unsuperseded acceptance for an exact selected finding")
        reviews.append(review)
    waived={v["item_id"] for v in reviews};unresolved=[]
    for result in results:
        for row in store.conn.execute("SELECT id,kind,register_name,identity_key,status FROM register_items WHERE owner_id=? AND status!='MATCH' ORDER BY ordinal",(result["id"],)):
            if row["id"] not in waived:unresolved.append({"id":row["id"],"rehearsal_id":result["id"],"kind":row["kind"],"register":row["register_name"],"key":row["identity_key"],"status":row["status"]})
    if p["decision"]=="approved":need(not unresolved,"REGISTER_NOT_READY","Every original nonmatching result requires current explicit disposition",{"unresolved":unresolved})
    value={"schema":VERSION+"/cutover","id":rid,"title":p["title"],"scope_id":scope,"identity_namespace":namespace,
           "rehearsal_ids":ids,"rehearsals":[{"id":v["id"],"plan_id":v["plan_id"],"summary":v["summary"]} for v in results],
           "decision":p["decision"],"reason":p["reason"],"acceptance_owner":p["acceptance_owner"],"accepted_review_ids":review_ids,"reviews":reviews,
           "summary":{"total":sum(v["item_count"] for v in results),"accepted_variance_count":len(waived),"unresolved_count":len(unresolved),"unresolved":unresolved},
           "parent_cutover_id":p.get("parent_cutover_id"),"note":optional(p.get("note"),"note"),"basis_revision":store.project["revision"],**metadata(op),
           "meaning":"A recorded review of supplied evidence. Target execution and actual client acceptance use their original separate authorization and contracts."}
    return store.put_entity("register_cutover",rid,value,op["reserved_revision"])

def item_page(store,p,name):
    entity=store.get_entity("register_"+name,p.get("id"));offset,limit=page(p)
    table,column=("register_rows","dataset_id") if name=="dataset" else ("register_items","owner_id")
    where=[column+"=?"];args=[entity["id"]]
    if p.get("query") is not None:
        text(p["query"],"query",max_length=4096);where.append("instr(lower(body_json),lower(?))>0");args.append(p["query"])
    if name!="dataset":
        for field,column,allowed in (("register","register_name",None),("status","status",STATUSES),("kind","kind",("record","reference","control"))):
            if p.get(field) is not None:
                value=p[field];text(value,field)
                if allowed:need(value in allowed,"REGISTER_FILTER","Unknown "+field)
                where.append(column+"=?");args.append(value)
    clause=" AND ".join(where)
    total=store.conn.execute("SELECT count(*) FROM "+table+" WHERE "+clause,args).fetchone()[0]
    rows=[parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM "+table+" WHERE "+clause+" ORDER BY ordinal LIMIT ? OFFSET ?",(*args,limit,offset))]
    return {"rows":rows,"total":total,"offset":offset,"limit":limit}
def compare(store,p):
    before=store.get_entity("register_rehearsal",p.get("before_id"));after=store.get_entity("register_rehearsal",p.get("after_id"))
    need(before["scope_id"]==after["scope_id"] and before["identity_namespace"]==after["identity_namespace"] and
         before["plan"]["policy"]["definitions"]==after["plan"]["policy"]["definitions"],
         "REGISTER_COMPARISON","Compare the same source scope/namespace and full canonical definitions")
    offset,limit=page(p);ids=(before["id"],after["id"])
    query="SELECT kind,register_name,identity_key FROM register_items WHERE owner_id IN (?,?) GROUP BY kind,register_name,identity_key"
    total=store.conn.execute("SELECT count(*) FROM ("+query+")",ids).fetchone()[0]
    rows=[]
    for kind,register,key in store.conn.execute(query+" ORDER BY kind,register_name,identity_key LIMIT ? OFFSET ?",(*ids,limit,offset)):
        found=[]
        for owner in ids:
            saved=store.conn.execute("SELECT body_json FROM register_items WHERE owner_id=? AND kind=? AND register_name=? AND identity_key=?",(owner,kind,register,key)).fetchone()
            found.append(parse_json(saved[0]) if saved else None)
        a,b=found
        if a is None:transition="entered_selected_result"
        elif b is None:transition="left_selected_result"
        elif a["status"]!=b["status"]:transition="status_changed"
        elif canonical(a["checks"])!=canonical(b["checks"]) or canonical(a["details"])!=canonical(b["details"]):transition="evidence_changed"
        else:transition="same_findings"
        rows.append({"kind":kind,"register":register,"key":key,"before":a,"after":b,"transition":transition})
    return {"rows":rows,"total":total,"offset":offset,"limit":limit,"before_id":before["id"],"after_id":after["id"],
            "before_policy":before["plan"]["policy"],"after_policy":after["plan"]["policy"],
            "meaning":"Original result editions retain their own selected source and cutoff. Leaving this selection is not a deletion instruction."}
def listed(store,p):
    name=p.get("kind");need(name in NAMES,"REGISTER_KIND","Choose dataset, plan, rehearsal, review or cutover")
    offset,limit=page(p);where="kind=?";args=["register_"+name]
    if p.get("query") is not None:text(p["query"],"query",max_length=4096);where+=" AND instr(lower(body_json),lower(?))>0";args.append(p["query"])
    total=store.conn.execute("SELECT count(*) FROM entities WHERE "+where,args).fetchone()[0]
    rows=[parse_json(r[0]) for r in store.conn.execute("SELECT body_json FROM entities WHERE "+where+" ORDER BY created_revision DESC,id LIMIT ? OFFSET ?",(*args,limit,offset))]
    return {"rows":rows,"total":total,"offset":offset,"limit":limit}
def schema():
    return {"schema":VERSION,"mutations":list(MUTATIONS),"reads":list(READS),"kinds":list(NAMES),"statuses":list(STATUSES),"types":list(TYPES),
            "sides":["source","target"],"field_definition":{"selector":"exact column or RFC6901 pointer","type":list(TYPES),"required":"boolean, default false"},
            "key_fields":"Ordered exact text fields; values and scopes are explicitly selected",
            "dataset_required":["title","review_note","source_id","register","system","side","fields","key_fields"],
            "plan_required":["title","review_note","source_dataset_ids","cutoff_at","destinations"],
            "plan_optional":["checks","references","controls","max_snapshot_age_seconds","parent_plan_id","note"],
            "reference_fields":["id","register","fields","to_register","to_fields","required","cardinality"],
            "reference_meaning":"Each original referring row supplies a complete ordered scalar text identity. Duplicate referenced keys remain ambiguous for either declared cardinality.",
            "control_fields":["id","register","measure_fields","unit_fields","group_fields"],
            "control_meaning":"Exact signed decimal sums and population counts per explicit unit/group, with complete row selection/digest; unresolved rows and coverage withhold conclusive comparisons",
            "decimal_bounds":{"coefficient_digits":1000,"absolute_exponent":1000},
            "rehearsal_required":["title","review_note","plan_id","target_dataset_ids"],
            "review_dispositions":["rework","waiting_evidence","accepted_variance","withdrawn"],
            "cutover_decisions":["hold","ready_for_review","approved"],"maximum_page_size":500,
            "meaning":"Source-bound interpretation and independent target reconciliation in the original retained workspace. Recorded cutover review preserves actual supplier/client authority."}
HANDLERS={"register.dataset.create":dataset_create,"register.plan.create":plan_create,"register.rehearsal.create":rehearsal_create,
          "register.review.create":review_create,"register.cutover.create":cutover_create}
def read(store,operation,p):
    if operation=="register.schema":return schema()
    if operation=="register.list":return listed(store,p)
    if operation=="register.dataset.preview":return preview(store,p)
    if operation=="register.dataset.rows":return item_page(store,p,"dataset")
    if operation=="register.plan.items":return item_page(store,p,"plan")
    if operation=="register.rehearsal.items":return item_page(store,p,"rehearsal")
    if operation=="register.rehearsal.compare":return compare(store,p)
    for name in NAMES:
        if operation=="register."+name+".get":return store.get_entity("register_"+name,p.get("id"))
    raise MigrationError("UNKNOWN_OPERATION","Unknown retained register reader")
