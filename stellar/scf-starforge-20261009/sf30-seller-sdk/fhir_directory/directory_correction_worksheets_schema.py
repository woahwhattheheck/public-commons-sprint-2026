"""MIT. Complete original Directory worksheet and customer-return contracts."""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import re
from directory_runtime import InputError, fhir
from directory_source_schema import jbytes,json_value,lexical_json
HERE=Path(__file__).resolve().parent
WORKSHEET_SCHEMA="stellar-forge.directory-correction-worksheet.v1"
IMPORT_SCHEMA="stellar-forge.directory-correction-worksheet-import.v1"
RETURN_SCHEMA="stellar-forge.directory-correction-worksheet-return-record.v1"
REVIEW_SCHEMA="stellar-forge.directory-correction-worksheet-review.v1"
PACKET_SCHEMA="stellar-forge.directory-correction-worksheet-packet.v1"
KINDS=("correctionWorksheets","correctionWorksheetImports","correctionWorksheetReturns","correctionWorksheetReviews")
MAX_INPUT=32*1024*1024
MAX_DOCUMENT=64*1024*1024
MAX_VALUE=16*1024*1024
MAX_CHANGES=10000

@lru_cache(maxsize=1)
def catalogue():
    value=json_value((HERE/"directory-correction-worksheets-schema.json").read_bytes())
    if value.get("schema")!="stellar-forge.directory-correction-worksheets-catalogue.v1":
        raise InputError("Unknown complete Directory worksheet catalogue")
    return value

def worksheet_catalogue():
    return json_value(jbytes(catalogue()))

def _check(value,spec,path):
    """Enforce all catalogue branches, literal discriminators and exact cardinality."""
    if "anyOf"in spec or "oneOf"in spec:
        key="oneOf"if"oneOf"in spec else"anyOf";matched=0
        for choice in spec[key]:
            try:_check(value,choice,path);matched+=1
            except InputError:pass
        if matched==0 or key=="oneOf"and matched!=1:raise InputError(path+" has an unsupported input shape")
    kind=spec.get("type")
    valid={"object":type(value)is dict,"array":type(value)is list,"string":type(value)is str,
        "integer":type(value)is int,"boolean":type(value)is bool,"null":value is None}
    if kind and not valid.get(kind,False):raise InputError(path+" must be "+kind)
    if "const"in spec and (type(value)is not type(spec["const"])or value!=spec["const"]):
        raise InputError(path+" has another literal schema or representation")
    if "enum"in spec and value not in spec["enum"]:raise InputError(path+" has an unsupported choice")
    if kind=="object":
        props=spec.get("properties",{})
        if spec.get("additionalProperties")is False and set(value)-set(props):raise InputError(path+" has unsupported fields")
        if set(spec.get("required",[]))-set(value):raise InputError(path+" is missing required fields")
        for key,child in value.items():
            if key in props:_check(child,props[key],path+"."+key)
    elif kind=="array":
        if not spec.get("minItems",0)<=len(value)<=spec.get("maxItems",1000000):raise InputError(path+" has an unsupported item count")
        for i,child in enumerate(value):_check(child,spec.get("items",{}),path+"["+str(i)+"]")
    elif kind=="string":
        if not spec.get("minLength",0)<=len(value)<=spec.get("maxLength",10000000):raise InputError(path+" has an unsupported text length")
        if "pattern"in spec and not re.fullmatch(spec["pattern"],value):raise InputError(path+" requires an exact content identity")
        if any(ord(c)<32 and c not in "\r\n\t"for c in value):raise InputError(path+" contains unsupported controls")
    elif kind=="integer":
        if not spec.get("minimum",-10**100)<=value<=spec.get("maximum",10**100):raise InputError(path+" has an unsupported integer")

def typed(action,raw):
    if action not in catalogue()["inputSchemas"]:raise InputError("Unknown Directory worksheet action")
    _check(raw,catalogue()["inputSchemas"][action],"worksheet."+action)
    encoded=jbytes(raw)
    if len(encoded)>MAX_INPUT:raise InputError("Complete worksheet input exceeds32MiB")
    value=json_value(encoded)
    for key in ("label","actor","filename"):
        if key in value and not value[key].strip():raise InputError("Name the worksheet "+key)
    value.setdefault("note","")
    if action=="prepare":
        value.setdefault("predecessorId",None)
        refs=[(r["sourceId"],r["recordId"])for r in value["rows"]]
        if len(set(refs))!=len(refs):raise InputError("Include each complete original worksheet row once")
    if action=="import"and ("/"in value["filename"]or"\\"in value["filename"]or value["filename"]in {".",".."}):
        raise InputError("Use the returned file's plain filename")
    if action=="review":
        ids=[r["changeId"]for r in value["choices"]]
        if len(set(ids))!=len(ids):raise InputError("Choose each returned change exactly once")
        if any(not r["reason"].strip()for r in value["choices"]):raise InputError("Explain each accepted or retained-original choice")
    return value

def returned_document(raw):
    if not isinstance(raw,bytes)or len(raw)>MAX_INPUT:raise InputError("Receive the complete returned JSON file within32MiB")
    value=json_value(raw)
    _check(value,catalogue()["returnDocumentSchema"],"worksheet.return")
    for key in ("returnedBy","returnedAt"):
        if not value[key].strip():raise InputError("Name the complete returned worksheet "+key)
    fhir.instant(value["returnedAt"],"Customer return time",False)
    value.setdefault("note","")
    seen=set()
    for row in value["candidates"]:
        if row["rowKey"]in seen:raise InputError("Each original worksheet row has at most one complete proposal")
        seen.add(row["rowKey"])
        if not row["reason"].strip():raise InputError("Describe each customer proposal")
        if row["representation"]=="json":
            encoded=row["valueJson"].encode("utf-8")
            if len(encoded)>MAX_VALUE:raise InputError("One complete proposed JSON row exceeds16MiB")
            if type(json_value(encoded,lexical=True))is not dict:raise InputError("Keep the complete selected JSON object")
        elif len(jbytes(row["cells"]))>MAX_VALUE:raise InputError("One complete proposed CSV row exceeds16MiB")
    return value
