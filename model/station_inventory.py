"""Read retained station inventories without changing their original source files.

Known normalized assessment banks retain their record-array identity, publisher
record identity and publisher-source hash independently of the imported body hash.
"""
from __future__ import annotations
import csv
import gzip
import json
from pathlib import Path

SCHEMA="upstate.water-quality-assessments/v1"
PUBLISHED_BANKS=(
    {"sha256":"69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c",
     "vintage":"2024","record_count":108},
    {"sha256":"cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522",
     "vintage":"2026-07-28","record_count":84},
)

def _same(left,right):
    if isinstance(left,bool) or isinstance(right,bool):
        return type(left) is type(right) and left==right
    return left==right

def _selected(original,reference):
    for key,expected in (reference.get("where") or {}).items():
        if key not in original:
            raise ValueError("Original inventory does not contain selected field "+key)
        if not _same(original[key],expected):
            return False
    for key,values in (reference.get("where_in") or {}).items():
        if key not in original:
            raise ValueError("Original inventory does not contain selected field "+key)
        if not isinstance(values,list):
            raise ValueError("Inventory where_in must map original fields to value lists")
        if not any(_same(original[key],expected) for expected in values):
            return False
    return True

def _open(path):
    path=Path(path)
    with path.open("rb") as stream:
        compressed=stream.read(2)==b"\x1f\x8b"
    return gzip.open(path,"rt",encoding="utf-8-sig",newline="") if compressed else path.open(
        encoding="utf-8-sig",newline="")

def read_inventory(path,reference,entry):
    """Return exact selected original dictionaries with stable source positions."""
    for key in ("where","where_in"):
        if reference.get(key) is not None and not isinstance(reference[key],dict):
            raise ValueError("Inventory "+key+" must map original field names to exact values")
    with _open(path) as stream:
        prefix=stream.read(256).lstrip();stream.seek(0)
        if prefix.startswith("{"):
            document=json.load(stream)
            if not isinstance(document,dict) or document.get("schema")!=SCHEMA:
                raise ValueError("Choose a retained upstate.water-quality-assessments/v1 JSON inventory")
            if document.get("complete") is not True or document.get("unparsed_rows"):
                raise ValueError("The original normalized assessment inventory has incomplete source rows")
            records=document.get("records")
            source=document.get("source")
            if not isinstance(records,list) or not isinstance(source,dict):
                raise ValueError("The original assessment inventory needs records and publisher metadata")
            if document.get("row_count",len(records))!=len(records):
                raise ValueError("The original assessment record count differs from its complete array")
            field=reference.get("station_id_field") or entry.get("station_id_field") or "site"
            rows=[];seen=set()
            for index,original in enumerate(records):
                if not isinstance(original,dict):
                    raise ValueError("Each original assessment record must be an object")
                native_id=original.get("id")
                if not isinstance(native_id,str) or not native_id:
                    raise ValueError("Each original assessment record needs its native record ID")
                identity=(original.get("source_id"),original.get("source_sha256"),native_id)
                if not all(isinstance(value,str) and value for value in identity):
                    raise ValueError("Retain publisher source ID, publisher source SHA and native record ID")
                if identity in seen:
                    raise ValueError("Original assessment record identity repeats")
                seen.add(identity)
                if identity[:2]!=(source.get("source_id"),source.get("source_sha256")):
                    raise ValueError("Assessment record publisher identity differs from its original bank")
                if field not in original or not isinstance(original[field],str) or not original[field].strip():
                    raise ValueError("An original assessment record has no exact station identifier")
                if not _selected(original,reference):
                    continue
                rows.append((index+1,original,{"record_index":index,"record_pointer":"/records/"+str(index),
                    "record_id":native_id,"row_number_basis":"original_record_array_one_based",
                    "publisher_source_id":identity[0],"publisher_source_sha256":identity[1],
                    "original_source_row":original.get("source_row"),
                    "original_source_page":original.get("source_page")}))
            return field,rows,{"format":"assessment_json","schema":SCHEMA,
                "original_record_count":len(records),"selected_record_count":len(rows),"publisher":source}
        field=reference.get("station_id_field") or entry.get("station_id_field")
        if not field:
            raise ValueError("Select the exact station field in the original study inventory")
        table=csv.DictReader(stream)
        if not table.fieldnames or len(table.fieldnames)!=len(set(table.fieldnames)) or field not in table.fieldnames:
            raise ValueError("Original station inventory needs distinct headers and its station field")
        rows=[]
        for number,original in enumerate(table,2):
            if None in original:
                raise ValueError("Original station inventory has an extra cell")
            if _selected(original,reference):
                rows.append((number,original,{"row_number_basis":"original_csv_line"}))
        return field,rows,{"format":"csv","fields":table.fieldnames,"selected_record_count":len(rows)}

def catalogue_fields(entry):
    """Recognize declared normalized banks without scanning unrelated source bodies."""
    metadata=entry.get("metadata") or {}
    recognized=(entry.get("schema")==SCHEMA or metadata.get("schema")==SCHEMA or
                entry.get("body",{}).get("sha256") in {row["sha256"] for row in PUBLISHED_BANKS})
    if entry.get("kind")=="table" and recognized:
        return {"station_id_field":entry.get("station_id_field") or "site",
                "inventory_format":"assessment_json","inventory_schema":SCHEMA,
                "inventory_record_identity":"original records[index] and publisher record id",
                "inventory_where_fields":["huc12","source_vintage","publication_status","evidence_kind"]}
    return {}

def published_inventory(workspace,entries,domain):
    """Bind the existing 159-site study directly to both original statewide JSON banks.

    Returning None preserves the existing completed CSV producer as a fallback.
    The publisher HUC selection uses the exact retained original domain identifiers.
    """
    selected=[]
    for spec in PUBLISHED_BANKS:
        matches=[(collection,entry) for collection,entry in entries
                 if entry["kind"]=="table" and entry["body"]["sha256"]==spec["sha256"]]
        if not matches:
            return None
        selected.append((spec,matches[0]))
    if domain is None:
        return None
    path,_=workspace.source_file(domain["collection_id"],domain["source_id"])
    with _open(path) as stream:
        original=json.load(stream)
    field=domain["id_field"]
    features=original.get("features")
    if not isinstance(features,list):
        raise ValueError("The retained assessment domain has no original feature array")
    hucs=[feature.get("attributes",feature.get("properties",{})).get(field) for feature in features]
    if len(hucs)!=217 or len(set(hucs))!=217 or any(
            not isinstance(value,str) or len(value)!=12 or not value.isdigit() for value in hucs):
        raise ValueError("Use the actual retained 217 original HUC12 identifiers")
    references,records,editions=[],[],[]
    for spec,(collection,entry) in selected:
        reference={"collection_id":collection["id"],"source_id":entry["id"],
                   "source_sha256":entry["body"]["sha256"],"station_id_field":"site",
                   "format":"assessment_json","where_in":{"huc12":sorted(hucs)}}
        path,_=workspace.source_file(collection["id"],entry["id"])
        _,rows,info=read_inventory(path,reference,entry)
        originals=[row for _,row,_ in rows]
        if len(originals)!=spec["record_count"] or {row["source_vintage"] for row in originals}!={spec["vintage"]}:
            raise ValueError("The selected original assessment edition differs from its accepted 217-HUC scope")
        references.append(reference);records.extend(originals)
        editions.append({"source_vintage":spec["vintage"],"record_count":len(originals),
                         "station_count":len({row["site"] for row in originals}),
                         "source_id":entry["id"],"source_sha256":entry["body"]["sha256"],
                         "publisher_source_id":info["publisher"]["source_id"],
                         "publisher_source_sha256":info["publisher"]["source_sha256"]})
    if len(records)!=192 or len({row["site"] for row in records})!=159:
        raise ValueError("The original published assessment domain requires 192 records at 159 sites")
    return {"references":references,"records":records,"editions":editions,
            "format":"original_normalized_json","station_count":159,"record_count":192}
