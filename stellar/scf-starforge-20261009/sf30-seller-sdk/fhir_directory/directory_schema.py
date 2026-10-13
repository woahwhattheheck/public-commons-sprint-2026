"""MIT. One strict, source-owned input catalogue for directory UI, HTTP and CLI."""
from __future__ import annotations
import copy
import json
import math
from pathlib import Path
import re
from urllib.parse import urlsplit
from directory_runtime import InputError,source

HERE=Path(__file__).resolve().parent
SCHEMA="stellar-forge.human-services-directory.v1"
KINDS={"connections","discoveries","requests","sources","editions","comparisons",
    "acquisitions","importProfiles","mappings","mappingPreviews","sourceConversions","selections",
    "referralJoins","handoffs","exports","receivingReviews","receives",
    "conformancePlans","conformanceAssessments","conformanceReviews","conformanceComparisons","operatingPlans","operatingPlanReturns","correctionPlans","correctionPreviews","corrections","correctionWorksheets","correctionWorksheetImports","correctionWorksheetReturns","correctionWorksheetReviews","correctionWorksheetReconciliations","correctionWorksheetReconciliationReviews"}
MUTABLE={"acquisitions","receives"}
TARGETS={"Organization","Location","HealthcareService","Endpoint"}
ROOT_TABLES={"organization":"Organization","location":"Location","service":"HealthcareService"}
MAX_RECORD=64*1024*1024
MAX_RESOURCES=10000
MAX_CANDIDATES=1000

def catalogue():
    value=source.json_value((HERE/"directory-schema.json").read_bytes())
    from directory_source_schema import source_catalogue
    native=source_catalogue()
    value["sourceCatalogue"]=native
    value["conformanceCatalogue"]=source.json_value((HERE/"directory-conformance-schema.json").read_bytes())
    value["operatingPlansCatalogue"]=source.json_value((HERE/"directory-operating-plans-schema.json").read_bytes())
    value["operatingReturnsCatalogue"]=source.json_value((HERE/"directory-operating-returns-schema.json").read_bytes())
    value["correctionsCatalogue"]=source.json_value((HERE/"directory-corrections-schema.json").read_bytes())
    value["correctionWorksheetsCatalogue"]=source.json_value((HERE/"directory-correction-worksheets-schema.json").read_bytes())
    value["correctionWorksheetReconciliationCatalogue"]=source.json_value((HERE/"directory-correction-worksheet-reconciliation-schema.json").read_bytes())
    profile=guidance()
    value["guidance"]={"schema":profile["schema"],"publishedMappingRows":len(profile["publishedMappings"]),
        "migrations":profile["migrations"],"selectedSources":profile["selectedSources"]}
    value["defaultMappings"]=source.json_value((HERE/"directory-mapping-profiles.json").read_bytes())["profiles"]
    return value

def guidance():
    return source.json_value((HERE/"directory-guidance.json").read_bytes())

def _json(value,label):
    if isinstance(value,float) and not math.isfinite(value):
        raise InputError(label+" must contain finite JSON numbers")
    if isinstance(value,dict):
        if any(not isinstance(k,str) for k in value):
            raise InputError(label+" keys must be text")
        for k,v in value.items():_json(v,label+"."+k)
    elif isinstance(value,list):
        for i,v in enumerate(value):_json(v,label+"["+str(i)+"]")
    elif value is not None and not isinstance(value,(str,int,float,bool)):
        raise InputError(label+" must contain original JSON values")
    return value

def validate(value,spec,label="Input"):
    if "oneOf" in spec:
        matches=0
        for alternative in spec["oneOf"]:
            try:validate(value,alternative,label);matches+=1
            except InputError:pass
        if matches!=1:raise InputError(label+" must match exactly one declared input form")
        return value
    if "const" in spec and (type(value)is not type(spec["const"])or value!=spec["const"]):
        raise InputError(label+" differs from its declared fixed value")
    if "anyOf" in spec:
        for alternative in spec["anyOf"]:
            try:return validate(value,alternative,label)
            except InputError:pass
        raise InputError(label+" does not match the selected input form")
    expected=spec.get("type")
    matches={"null":value is None,"object":isinstance(value,dict),"array":isinstance(value,list),
        "string":isinstance(value,str),"boolean":type(value)is bool,
        "integer":type(value)is int,"number":type(value)in(int,float)}
    if expected and not matches.get(expected,False):
        raise InputError(label+" must be "+expected)
    if "enum" in spec and value not in spec["enum"]:
        raise InputError(label+" is not one of the declared selections")
    if isinstance(value,str):
        if len(value)>spec.get("maxLength",2**31) or len(value)<spec.get("minLength",0):
            raise InputError(label+" has an invalid length")
        if spec.get("pattern") and not re.fullmatch(spec["pattern"],value):
            raise InputError(label+" has an invalid original identity")
    if type(value)in(int,float):
        if not math.isfinite(value) or value<spec.get("minimum",-math.inf) or value>spec.get("maximum",math.inf):
            raise InputError(label+" is outside the supported range")
    if isinstance(value,list):
        if len(value)>spec.get("maxItems",2**31) or len(value)<spec.get("minItems",0):
            raise InputError(label+" has an invalid item count")
        if spec.get("uniqueItems") and len({source.jbytes(v) for v in value})!=len(value):
            raise InputError(label+" repeats an item")
        if "items" in spec:
            for i,entry in enumerate(value):validate(entry,spec["items"],label+"["+str(i)+"]")
    if isinstance(value,dict):
        properties=spec.get("properties",{})
        missing=set(spec.get("required",[]))-set(value)
        if missing:raise InputError(label+" requires "+", ".join(sorted(missing)))
        if spec.get("additionalProperties")is False and set(value)-set(properties):
            raise InputError(label+" contains undeclared fields: "+", ".join(sorted(set(value)-set(properties))))
        for k,v in value.items():
            if k in properties:validate(v,properties[k],label+"."+k)
            elif isinstance(spec.get("additionalProperties"),dict):validate(v,spec["additionalProperties"],label+"."+k)
    _json(value,label)
    return value

def input_value(name,raw):
    spec=source.json_value((HERE/"directory-schema.json").read_bytes())["inputSchemas"].get(name)
    if spec is None:raise InputError("Unknown directory input form")
    value=copy.deepcopy(validate(raw,spec,name))
    for key in ["label","actor"]:
        if key in value and not value[key].strip():raise InputError(key+" must identify the actual selected record or owner")
    if "note" not in value and name not in {"mapping_preview","page"}:value["note"]=""
    return value

def token(value,label="Original operation"):
    if not isinstance(value,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,95}",value):
        raise InputError(label+" requires its original 1–96 character identity")
    return value

def uri(value,label="Selected URI",http=False):
    if not isinstance(value,str) or not value or len(value)>8192 or any(ord(c)<32 for c in value):
        raise InputError(label+" requires an explicit URI")
    p=urlsplit(value)
    if not p.scheme or http and (p.scheme not in {"https","http"} or not p.netloc):
        raise InputError(label+" requires "+("an HTTP(S) URL" if http else "a URI with an explicit scheme"))
    if p.username or p.password:
        raise InputError(label+" keeps authentication in the original credential profile")
    return value

def pointer(value,label="JSON Pointer",empty=True):
    if not isinstance(value,str) or len(value)>1024 or (value!="" and not value.startswith("/")):
        raise InputError(label+" requires an exact JSON Pointer")
    if not empty and value=="":raise InputError(label+" requires a selected field")
    if re.search(r"~(?![01])",value):raise InputError(label+" contains an invalid escape")
    return value

def mapping(raw):
    v=input_value("mapping",raw)
    uri(v["identitySystem"],"Publisher identity namespace")
    uri(v["referenceBase"],"Reviewed resource reference base",True)
    v["referenceBase"]=v["referenceBase"].rstrip("/")
    for key,default in [("predecessorId",None),("selectedRefs",[]),("identityOverrides",[]),("reviews",[])]:v.setdefault(key,default)
    if len({r["id"]for r in v["rules"]})!=len(v["rules"]):raise InputError("Mapping repeats an original rule identifier")
    if len({r["id"]for r in v["reviews"]})!=len(v["reviews"]):raise InputError("Mapping repeats a guidance disposition")
    allowed={r["id"]for r in guidance()["publishedMappings"]}|{r["id"]for r in guidance()["migrations"]}
    for review in v["reviews"]:
        if review["id"]not in allowed:raise InputError("A mapping review must cite an actual retained guidance row")
    for rule in v["rules"]:
        for key,default in [("sourcePath",""),("cardinality","one"),("missing","finding"),
            ("valueMap",{}),("includeRefs",[]),("reviewIds",[])]:rule.setdefault(key,default)
        pointer(rule["sourcePath"]);pointer(rule["targetPath"],empty=False)
        if rule["targetPath"]in {"/id","/resourceType","/meta"} or any(rule["targetPath"].startswith(p)for p in ("/id/","/resourceType/")):
            raise InputError("Resource identity and type come from the selected original identity mapping")
        if not rule["reason"].strip():raise InputError("Each field rule retains its reviewed source interpretation")
        if not set(rule["reviewIds"])<=allowed:raise InputError("Field rule cites an absent original guidance row")
        if rule["operation"]=="constant" and "value" not in rule:raise InputError("A constant rule retains its explicitly authored value")
        if rule["operation"]=="reference" and not rule.get("referenceType"):raise InputError("A reference rule selects the exact target resource type")
        if rule.get("join"):
            pointer(rule["join"]["foreignPath"],empty=False);pointer(rule["join"]["localPath"],empty=False)
    return v
