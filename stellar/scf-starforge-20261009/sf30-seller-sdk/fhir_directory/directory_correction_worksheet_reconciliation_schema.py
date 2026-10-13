"""MIT. Strict source-bound three-way worksheet reconciliation contracts."""
from __future__ import annotations
from functools import lru_cache
from pathlib import Path
from directory_runtime import InputError
from directory_source_schema import jbytes,json_value
from directory_correction_worksheets_schema import _check
HERE=Path(__file__).resolve().parent
RECONCILIATION_SCHEMA="stellar-forge.directory-worksheet-reconciliation.v1"
REVIEW_SCHEMA="stellar-forge.directory-worksheet-reconciliation-review.v1"
PACKET_SCHEMA="stellar-forge.directory-worksheet-reconciliation-packet.v1"
KINDS=("correctionWorksheetReconciliations","correctionWorksheetReconciliationReviews")
STATES=("proposable","already-applied","conflict","unbound","structure-conflict")
DECISIONS=("accept-proposed","keep-current","resolve-row")
MAX_INPUT=32*1024*1024
MAX_VALUE=16*1024*1024
MAX_ROWS=10000
MAX_CHANGES=10000

@lru_cache(maxsize=1)
def catalogue():
    value=json_value((HERE/"directory-correction-worksheet-reconciliation-schema.json").read_bytes())
    if value.get("schema")!="stellar-forge.directory-worksheet-reconciliation-catalogue.v1":
        raise InputError("Unknown complete worksheet reconciliation catalogue")
    return value

def reconciliation_catalogue():
    return json_value(jbytes(catalogue()))

def typed(action,raw):
    if action not in catalogue()["inputSchemas"]:raise InputError("Unknown worksheet reconciliation action")
    _check(raw,catalogue()["inputSchemas"][action],"worksheet-reconciliation."+action)
    encoded=jbytes(raw)
    if len(encoded)>MAX_INPUT:raise InputError("Complete worksheet reconciliation input exceeds32MiB")
    value=json_value(encoded)
    for key in ("label","actor"):
        if key in value and not value[key].strip():raise InputError("Name the reconciliation "+key)
    value.setdefault("note","")
    if action=="prepare":
        value.setdefault("predecessorId",None)
        keys=[row["rowKey"]for row in value["bindings"]]
        if len(keys)!=len(set(keys)):raise InputError("Bind every original worksheet row exactly once")
        current=[(row["current"]["sourceId"],row["current"]["recordId"])for row in value["bindings"]if row["current"]is not None]
        if len(current)!=len(set(current)):raise InputError("Do not bind different original rows to the same current row")
        if any(not row["reason"].strip()for row in value["bindings"]):raise InputError("Explain every explicit original-to-current row binding")
    elif action=="review":
        value.setdefault("rowResolutions",[])
        for collection,key in (("choices","changeId"),("rowResolutions","rowKey")):
            rows=value[collection]
            if len({row[key]for row in rows})!=len(rows):raise InputError("Keep one exact "+collection+" decision for each original identity")
            if any(not row["reason"].strip()for row in rows):raise InputError("Explain each reviewer choice and complete-row resolution")
        for row in value["rowResolutions"]:
            if row["representation"]=="json":
                raw_value=row["valueJson"].encode("utf-8")
                if len(raw_value)>MAX_VALUE:raise InputError("One complete authored JSON resolution exceeds16MiB")
                if type(json_value(raw_value,lexical=True))is not dict:raise InputError("Resolve the complete current JSON object")
            elif len(jbytes(row["cells"]))>MAX_VALUE:raise InputError("One complete CSV resolution exceeds16MiB")
    else:value.setdefault("reviewId",None)
    return value
