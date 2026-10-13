"""MIT. Exact source-bound HSDS correction inputs and lexical JSON edits."""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import re
from directory_runtime import InputError, fhir
from directory_source_schema import _check, MAX_RECORD, json_value, jbytes, lexical_json

HERE=Path(__file__).resolve().parent
PLAN_SCHEMA="stellar-forge.directory-correction-plan.v1"
PREVIEW_SCHEMA="stellar-forge.directory-correction-preview.v1"
CORRECTION_SCHEMA="stellar-forge.directory-correction.v1"
PACKET_SCHEMA="stellar-forge.directory-correction-packet.v1"
KINDS=("correctionPlans","correctionPreviews","corrections")
MAX_INPUT=32*1024*1024

@lru_cache(maxsize=1)
def catalogue():
    value=json_value((HERE/"directory-corrections-schema.json").read_bytes())
    if value.get("schema")!="stellar-forge.directory-corrections-catalogue.v1":
        raise InputError("Unknown Directory correction catalogue")
    return value

def correction_catalogue():
    return json_value(jbytes(catalogue()))

def tokens(pointer):
    if type(pointer)is not str or len(pointer)>16384:
        raise InputError("Use the exact relative JSON pointer")
    if pointer=="":return []
    if not pointer.startswith("/")or re.search(r"~(?![01])",pointer):
        raise InputError("Use an RFC6901 pointer with exact ~0 and ~1 escapes")
    return [part.replace("~1","/").replace("~0","~")for part in pointer[1:].split("/")]

def path_at(value,path):
    for token in path:
        if isinstance(value,dict):
            if token not in value:raise InputError("The selected original JSON pointer is absent")
            value=value[token]
        elif isinstance(value,list):
            if not re.fullmatch(r"0|[1-9][0-9]*",token)or int(token)>=len(value):
                raise InputError("The selected original array position is absent")
            value=value[int(token)]
        else:raise InputError("The selected JSON pointer crosses a scalar value")
    return value

def typed(action,raw):
    if action not in catalogue()["inputSchemas"]:raise InputError("Unknown correction action")
    _check(raw,catalogue()["inputSchemas"][action],"correction."+action)
    encoded=jbytes(raw)
    if len(encoded)>MAX_INPUT:raise InputError("Complete correction input exceeds32MiB")
    value=json_value(encoded)
    for name in ("label","actor"):
        if name in value and not value[name].strip():raise InputError("Name the actual correction "+name)
    if action in {"prepare","apply","export"}:value.setdefault("note","")
    if action=="prepare":
        value.setdefault("predecessorId",None)
        if not value["edits"]:raise InputError("Select at least one authored correction")
        for edit in value["edits"]:
            if not edit["reason"].strip():raise InputError("Describe the reason for every authored edit")
            selected=edit["action"]
            allowed={"sourceId","recordId","rowSha256","resourceSha256","memberSha256","action","reason"}
            extra={"json-set":{"pointer","valueJson"},"json-remove":{"pointer"},"csv-cell":{"column","value"},"csv-row":{"cells"}}[selected]
            if set(edit)-allowed!=extra:raise InputError("Keep exactly the fields required by the selected correction action")
            if selected.startswith("json-"):
                parts=tokens(edit["pointer"])
                if selected=="json-remove"and not parts:raise InputError("Remove a named JSON field; retain the complete selected row")
                if selected=="json-set":
                    content=edit["valueJson"].encode("utf-8")
                    if len(content)>MAX_RECORD:raise InputError("One complete authored JSON value exceeds16MiB")
                    json_value(content,lexical=True)
            elif selected=="csv-row"and not edit["cells"]:
                raise InputError("Retain a nonempty explicit CSV cell row")
    return value
