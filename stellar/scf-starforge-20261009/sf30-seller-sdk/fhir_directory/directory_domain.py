"""MIT. Exact source references and reviewed directory field transformations."""
from __future__ import annotations
from collections import defaultdict,OrderedDict
import copy
import hashlib
import json
import re
from directory_runtime import InputError,source
import directory_schema as schema

MISSING=object()
TYPE_TABLE={"Organization":"organization","Location":"location","HealthcareService":"service","Endpoint":"endpoint"}
TABLE_TYPE={v:k for k,v in TYPE_TABLE.items()}

def value(row):
    return source.json_value(row["json"],lexical=True)

def key(value):
    return source.lexical_json(value)

def ref_key(ref):
    return (ref["sourceId"],ref["recordId"])

def public_ref(row):
    return {k:row[k] for k in ["sourceId","recordId","rowSha256"] if row.get(k) is not None}

def at_pointer(obj,path,default=MISSING):
    schema.pointer(path)
    if path=="":return obj
    for token in path[1:].split("/"):
        token=token.replace("~1","/").replace("~0","~")
        if isinstance(obj,dict) and token in obj:obj=obj[token]
        elif isinstance(obj,list) and re.fullmatch(r"0|[1-9][0-9]*",token) and int(token)<len(obj):obj=obj[int(token)]
        else:return default
    return obj

def put_pointer(obj,path,val,append=False):
    schema.pointer(path,empty=False)
    tokens=[p.replace("~1","/").replace("~0","~") for p in path[1:].split("/")]
    current=obj
    for pos,token in enumerate(tokens[:-1]):
        following=tokens[pos+1]
        if isinstance(current,dict):
            if token not in current:current[token]=[] if re.fullmatch(r"0|[1-9][0-9]*|-",following) else {}
            current=current[token]
        elif isinstance(current,list) and re.fullmatch(r"0|[1-9][0-9]*",token):
            idx=int(token)
            if idx>10000:raise InputError("Mapped array position exceeds the original resource bound")
            while len(current)<=idx:current.append({})
            current=current[idx]
        else:raise InputError("Mapping traverses a scalar field at "+path)
    last=tokens[-1]
    if isinstance(current,dict):
        if append and last in current:
            if not isinstance(current[last],list) or not isinstance(val,list):raise InputError("Many-valued mappings append only to an array")
            current[last].extend(val)
        else:current[last]=val
    elif isinstance(current,list):
        if last=="-":current.append(val)
        elif re.fullmatch(r"0|[1-9][0-9]*",last):
            idx=int(last)
            if idx>10000:raise InputError("Mapped array position exceeds the original resource bound")
            while len(current)<=idx:current.append(None)
            current[idx]=val
        else:raise InputError("A mapped array uses a numeric position or '-'")
    else:raise InputError("Mapping destination is inside a scalar")

def compact(value):
    if isinstance(value,list):
        return [v for item in value if (v:=compact(item)) is not MISSING and v is not None and v!=""]
    if isinstance(value,dict):
        return {k:v for k,item in value.items() if (v:=compact(item)) is not MISSING and v is not None and v!=""}
    return value

def template(spec,item,current):
    if spec=="$value":return copy.deepcopy(item)
    if isinstance(spec,str) and spec.startswith("$record:"):
        return copy.deepcopy(at_pointer(current,spec[len("$record:"):],None))
    if isinstance(spec,list):return compact([template(s,item,current) for s in spec])
    if isinstance(spec,dict):return compact({k:template(v,item,current) for k,v in spec.items()})
    return copy.deepcopy(spec)

def cast(value,kind):
    if kind=="original":return value
    if kind=="string":
        if isinstance(value,(dict,list)):raise InputError("A string mapping must choose a scalar source value")
        return str(value)
    if kind in {"number","integer"}:
        text=str(value)
        pattern=r"-?(0|[1-9][0-9]*)" if kind=="integer" else r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?"
        if not re.fullmatch(pattern,text):raise InputError("The original token is not a "+kind)
        return source.json_value(text,lexical=True)
    if kind=="boolean":
        if type(value)is bool:return value
        if isinstance(value,str) and value in {"true","false"}:return value=="true"
        raise InputError("A boolean mapping needs the exact true/false token or a reviewed value map")
    raise InputError("Unknown mapped value type")

class DirectoryView:
    def __init__(self,ws,edition_id):
        self.ws=ws;self.edition_id=edition_id
        self.edition=ws.directory_record("editions",edition_id)
        self.cache=OrderedDict();self.joins={}
    def rows(self,table=None):
        yield from self.ws.directory_iter_rows("editions",self.edition_id,table=table)
    def row(self,ref):
        k=ref_key(ref)
        if k not in self.cache:
            row=self.ws.directory_edition_row(self.edition_id,ref["sourceId"],ref["recordId"])
            if ref.get("rowSha256") and row["rowSha256"]!=ref["rowSha256"]:
                raise InputError("Selected directory record changed its original row hash")
            self.cache[k]=row
            if len(self.cache)>512:self.cache.popitem(last=False)
        row=self.cache[k]
        if ref.get("rowSha256") and row["rowSha256"]!=ref["rowSha256"]:
            raise InputError("Selected directory row hash differs")
        return row
    def links(self,row):
        links=[];offset=0
        while True:
            page=self.ws.directory_edition_links(self.edition_id,offset=offset,limit=250,record_id=row["recordId"])
            links.extend(link for link in page["rows"]if link["sourceId"]==row["sourceId"])
            if page["nextOffset"]is None:break
            offset=page["nextOffset"]
        return links
    def targets(self,link):
        refs=[];offset=0
        while True:
            page=self.ws.directory_link_targets(self.edition_id,link["sourceId"],link["id"],offset=offset,limit=250)
            refs.extend(page["rows"])
            if page["nextOffset"]is None:break
            offset=page["nextOffset"]
        return [self.row(r)for r in refs]
    def children(self,row,table,fields):
        found=[]
        for link in self.links(row):
            if link.get("kind")!="hsds-nested" or link.get("targetTable")!=table:continue
            tokens=link.get("pointer","").lstrip("/").split("/")
            if tokens and tokens[0]in fields:found.extend(self.targets(link))
        return list({ref_key(r):r for r in found}.values())
    def related(self,row,table,foreign_path,local_path="/id"):
        join_key=(table,foreign_path)
        if join_key not in self.joins:
            groups=defaultdict(list)
            for candidate in self.rows(table):
                foreign=at_pointer(value(candidate),foreign_path)
                if foreign is not MISSING:groups[key(foreign)].append(public_ref(candidate))
            self.joins[join_key]=groups
        local=at_pointer(value(row),local_path)
        direct=[] if local is MISSING else [self.row(r) for r in self.joins[join_key].get(key(local),[])]
        nested_fields={"phone":["phones"],"address":["addresses"],"schedule":["schedules","operating_hours","events"],
            "service_capacity":["capacities"],"language":["languages"],"attribute":["attributes"],
            "service_at_location":["service_at_locations"],"contact":["contacts"],"url":["additional_urls"],
            "taxonomy_term":["taxonomy_terms"],"organization":["organization"],"program":["program"]}
        # Nested membership is an exact original pointer relation, never a fabricated foreign key.
        if table in nested_fields:
            direct.extend(self.children(row,table,nested_fields[table]))
        unique={}
        for candidate in direct:unique[ref_key(candidate)]=candidate
        return list(unique.values())

def finding(code,message,*,row=None,rule=None,severity="warning",details=None):
    value={"code":code,"message":message,"severity":severity}
    if row:value["ref"]=public_ref(row)
    if rule:value["ruleId"]=rule["id"]
    if details is not None:value["details"]=details
    value["id"]=source.sha(source.jbytes(value))
    return value

def selected_roots(view,mapping):
    selected={ref_key(r) for r in mapping.get("selectedRefs",[])}
    roots=[]
    for row in view.rows():
        table=row["table"]
        allowed=table in schema.TARGETS if mapping["mode"]=="fhir-pass-through" else table in schema.ROOT_TABLES
        if allowed and (not selected or ref_key(row) in selected):roots.append(row)
        if len(roots)>schema.MAX_RESOURCES:raise InputError("Choose at most10,000 original directory resource rows for this native FHIR conversion")
    if selected and selected-{ref_key(r) for r in roots}:raise InputError("The selected mapping rows are absent or not original directory resource tables")
    if not roots:raise InputError("The selected edition contains no resource rows for this mapping mode")
    return roots

def convert(view,mapping):
    roots=selected_roots(view,mapping)
    overrides={ref_key(x["ref"]):x for x in mapping["identityOverrides"]}
    targets={};native=defaultdict(list);findings=[];entries=[];fields=[];row_map=[]
    if len(overrides)!=len(mapping["identityOverrides"]):raise InputError("Identity assignment repeats an original row")
    if mapping["mode"]=="fhir-pass-through" and overrides:raise InputError("Use the original source correction workflow to change FHIR identities before pass-through")
    for row in roots:
        raw=value(row);table=row["table"];typ=table if mapping["mode"]=="fhir-pass-through" else schema.ROOT_TABLES[table]
        native_id=raw.get("id")
        assigned=overrides.get(ref_key(row))
        if assigned:
            view.row(assigned["ref"]);ident=assigned["logicalId"]
            if not assigned["reason"].strip():raise InputError("A reviewed identity assignment retains its reason")
        elif mapping["mode"]=="fhir-pass-through":ident=native_id
        elif native_id is not None and native_id!="":
            ident="dir-"+source.sha(source.jbytes({"system":mapping["identitySystem"],"table":table,"native":key(native_id)}))[:40]
        else:
            findings.append(finding("missing-identity","Choose an explicit reviewed identity for this original resource row",row=row,severity="error"));continue
        if not isinstance(ident,str) or not re.fullmatch(r"[A-Za-z0-9.-]{1,64}",ident):
            findings.append(finding("invalid-fhir-identity","The selected FHIR logical ID does not meet its native syntax",row=row,severity="error"));continue
        full=row.get("fullUrl") if mapping["mode"]=="fhir-pass-through" else None
        full=full or mapping["referenceBase"]+"/"+typ+"/"+ident
        info={"type":typ,"id":ident,"fullUrl":full,"row":row,"originalNativeId":native_id}
        targets[ref_key(row)]=info
        native[(typ,key(native_id))].append(info)
    duplicate_urls=defaultdict(list)
    for info in targets.values():duplicate_urls[info["fullUrl"]].append(info)
    for url,items in duplicate_urls.items():
        if len(items)>1:
            for info in items:findings.append(finding("ambiguous-resource-identity","Several selected original rows map to the same resource identity",row=info["row"],severity="error",details={"fullUrl":url,"refs":[public_ref(i["row"])for i in items]}))
    for row in roots:
        info=targets.get(ref_key(row))
        if not info:continue
        raw=value(row)
        if mapping["mode"]=="fhir-pass-through":
            if raw.get("resourceType")!=info["type"]:
                findings.append(finding("resource-type","Original FHIR resource type differs from its directory table",row=row,severity="error"));continue
            resource=copy.deepcopy(raw)
            fields.append({"ref":public_ref(row),"target":info["fullUrl"],"ruleId":None,"sourcePath":"","targetPath":"","operation":"unchanged-fhir-resource","sourceValue":raw})
        else:
            resource={"resourceType":info["type"],"id":info["id"]}
            if info["originalNativeId"] is not None and info["originalNativeId"]!="":
                resource["identifier"]=[{"system":mapping["identitySystem"],"value":str(info["originalNativeId"])}]
            for rule in mapping["rules"]:
                if rule["table"]!=row["table"] or rule["targetType"]!=info["type"]:continue
                current_rows=[row]
                if rule.get("join"):
                    j=rule["join"];current_rows=view.related(row,j["table"],j["foreignPath"],j["localPath"])
                selected={ref_key(x) for x in rule["includeRefs"]}
                if selected:current_rows=[r for r in current_rows if ref_key(r) in selected]
                collected=[];used=[]
                if rule["operation"]=="constant":current_rows=[row]
                for current in current_rows:
                    original=value(current)
                    v=rule["value"] if rule["operation"]=="constant" else at_pointer(original,rule["sourcePath"])
                    if v is MISSING or v is None or v=="" or v==[]:continue
                    values=v if isinstance(v,list) and rule["cardinality"]=="many" else [v]
                    for item in values:
                        before=copy.deepcopy(item)
                        try:
                            if rule["operation"]=="map":
                                token=item if isinstance(item,str) else key(item)
                                if token not in rule["valueMap"]:
                                    findings.append(finding("unmapped-token","No reviewed mapping exists for this exact source token",row=current,rule=rule,details={"token":token}));continue
                                item=copy.deepcopy(rule["valueMap"][token])
                            elif rule["operation"]=="reference":
                                matches=native.get((rule["referenceType"],key(item)),[])
                                if len(matches)!=1:
                                    findings.append(finding("reference-"+("ambiguous" if matches else "unresolved"),"Select exactly one original directory identity for this reference",row=current,rule=rule,severity="error" if rule["missing"]=="error" else "warning",details={"nativeId":item,"candidateRefs":[public_ref(x["row"])for x in matches]}));continue
                                item=matches[0]["fullUrl"]
                            item=cast(item,rule.get("valueType","original"))
                            if "template" in rule:item=template(rule["template"],item,original)
                            item=compact(item)
                            if item is MISSING or item=={} or item==[]:continue
                            collected.append(item);used.append(public_ref(current))
                            fields.append({"ref":public_ref(current),"rootRef":public_ref(row),"target":info["fullUrl"],"ruleId":rule["id"],"sourcePath":rule["sourcePath"],"targetPath":rule["targetPath"],"operation":rule["operation"],"sourceValue":before,"mappedValue":item,"reason":rule["reason"],"reviewIds":rule["reviewIds"],"authoredConstant":rule["operation"]=="constant"})
                        except InputError as error:findings.append(finding("field-transform",str(error),row=current,rule=rule,severity="error"))
                if not collected:
                    if rule["missing"]!="omit":findings.append(finding("missing-field","No selected original value was mapped to "+rule["targetPath"],row=row,rule=rule,severity="error" if rule["missing"]=="error" else "warning"))
                    continue
                if rule["cardinality"]=="one" and len(collected)!=1:
                    findings.append(finding("multiple-values","This scalar mapping has several original values; retain an explicit includeRefs choice",row=row,rule=rule,severity="error",details={"refs":used}));continue
                try:put_pointer(resource,rule["targetPath"],collected if rule["cardinality"]=="many" else collected[0],append=rule["cardinality"]=="many")
                except InputError as error:findings.append(finding("field-destination",str(error),row=row,rule=rule,severity="error"))
        entries.append({"fullUrl":info["fullUrl"],"resource":resource})
        row_map.append({"ref":public_ref(row),"table":row["table"],"nativeId":info["originalNativeId"],"resourceType":info["type"],"logicalId":info["id"],"fullUrl":info["fullUrl"],"resourceSha256":source.sha(source.lexical_json(resource).encode())})
        if info["type"]=="Organization" and "active"not in resource:findings.append(finding("organization-active-review","The original source has no observed Organization.active value; review the published proposed fixed value or retain this mapping gap",row=row))
    reviews={r["id"]:r for r in mapping["reviews"]}
    for review_id in {r for rule in mapping["rules"] for r in rule["reviewIds"]}:
        if review_id not in reviews or reviews[review_id]["disposition"]=="unresolved":
            findings.append(finding("guidance-review","The field map retains an unresolved original guidance disposition",details={"reviewId":review_id}))
    bundle={"resourceType":"Bundle","type":"collection","id":"directory-"+mapping["id"][:40],"entry":entries}
    return {"schema":"stellar-forge.human-services-directory-mapping-preview.v1","mappingId":mapping["id"],"editionId":mapping["editionId"],"sourceRefs":[public_ref(r)for r in roots],"bundle":bundle,"resources":row_map,"fields":fields,"findings":findings,
        "summary":{"resources":len(entries),"mappedFields":len(fields),"errors":sum(x["severity"]=="error" for x in findings),"warnings":sum(x["severity"]=="warning" for x in findings),"originalSourceRows":len(roots),"unresolvedGuidance":sum(x["code"]=="guidance-review"for x in findings)}}
