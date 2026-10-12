"""Retain an original ACS county API capture and verify its projection cells.

Input is a commons.public-housing-study-source.v1 SOURCE_MANIFEST.json and
adjacent original response files. This adapter performs no source acquisition.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs,urlsplit

from model import digest,dump,encoded,fail,identity,member,parse,private_directory,read,write

VARIABLE=re.compile(r"(B[0-9]{5}[A-I]?_[0-9]{3})E\Z")
GROUP=re.compile(r"B[0-9]{5}[A-I]?\Z")
GEO=re.compile(r"[0-9]{5}\Z")
SCHEMA="commons.public-housing-study-source.v1"

def original(root,name,limit):
    name=member(name)
    path=root/name
    if path.resolve(strict=True)!=path:
        fail("ACS_API_ORIGINAL_PATH_CHANGED",path=name)
    return read(path,limit)

def source_url(value,year,kind,key):
    if not isinstance(value,str):
        fail("ACS_API_PUBLIC_URL_REQUIRED")
    parts=urlsplit(value)
    query=parse_qs(parts.query,keep_blank_values=True)
    if parts.scheme!="https" or parts.netloc!="api.census.gov" or parts.fragment or any(k.lower()=="key" for k in query):
        fail("ACS_API_PUBLIC_URL_REQUIRED")
    expected="/data/"+str(year)+"/acs/acs5"+("/groups/"+key+".json" if kind=="metadata" else "")
    if parts.path!=expected:
        fail("ACS_API_SOURCE_URL_MISMATCH")
    return query

def number(raw):
    if raw is None:return None
    if not isinstance(raw,str) or not re.fullmatch(r"-?[0-9]+",raw):
        fail("ACS_API_ORIGINAL_INTEGER_REQUIRED")
    value=int(raw)
    return value if value>=0 else None

def retain_api_capture(manifest_file,out):
    manifest_file=Path(manifest_file).expanduser().resolve(strict=True)
    root=manifest_file.parent
    input_raw=read(manifest_file,16*1024*1024)
    raw_manifest=input_raw
    manifest=parse(raw_manifest)
    if manifest.get("schema")=="stellar-forge.study-acs-api-source.v1":
        relative=member(manifest.get("manifest"))
        target=root/relative
        if target.resolve(strict=True)!=target:
            fail("ACS_API_SOURCE_POINTER_CHANGED")
        raw_manifest=read(target,16*1024*1024)
        if digest(raw_manifest)!=manifest.get("captureSha256"):
            fail("ACS_API_CAPTURE_IDENTITY_CHANGED")
        root=target.parent
        manifest=parse(raw_manifest)
    if manifest.get("schema")!=SCHEMA:
        fail("ACS_API_CAPTURE_SCHEMA_REQUIRED")
    entries=manifest.get("all_source_files")
    if not isinstance(entries,list) or not 1<=len(entries)<=10000:
        fail("ACS_API_SOURCE_INVENTORY_REQUIRED")
    original_rows=original(root,"county_housing_observations.json",128*1024*1024)
    rows=parse(original_rows)
    if not isinstance(rows,list) or not rows or len(rows)>1000000 or len(rows)!=manifest.get("rows"):
        fail("ACS_API_OBSERVATION_COUNT_CHANGED")
    out=Path(out).absolute()
    if out.exists():fail("ACS_API_OUTPUT_EXISTS")
    private_directory(out);capture=private_directory(out/"capture")
    files={}
    def put(name,raw):
        name=member(name)
        if name in files:fail("ACS_API_DUPLICATE_CAPTURE_MEMBER",path=name)
        path=out/name;private_directory(path.parent)
        write(path,raw,exclusive=True)
        files[name]={"path":name,"bytes":len(raw),"sha256":digest(raw)}
    metadata={};data={};expected=set()
    for entry in entries:
        name=member(entry.get("file"))
        if name in ("SOURCE_MANIFEST.json","county_housing_observations.json"):
            fail("ACS_API_RESERVED_SOURCE_MEMBER")
        if name in data or any(value[0]["file"]==name for value in metadata.values()):
            fail("ACS_API_DUPLICATE_SOURCE_MEMBER")
        year,kind,key=entry.get("year"),entry.get("kind"),entry.get("key")
        if type(year) is not int or not 2009<=year<=3000 or kind not in ("data","metadata") or not isinstance(key,str):
            fail("ACS_API_RELEASE_IDENTITY_INVALID")
        if kind=="metadata" and not GROUP.fullmatch(key):
            fail("ACS_API_GROUP_IDENTITY_INVALID")
        query=source_url(entry.get("url"),year,kind,key)
        source_url(entry.get("final_url"),year,kind,key)
        if entry.get("status")!=200 or not isinstance(entry.get("retrieved_at"),str) or not entry["retrieved_at"]:
            fail("ACS_API_CAPTURE_RECEIPT_REQUIRED")
        size=entry.get("bytes")
        if type(size) is not int or not 0<size<=64*1024*1024:
            fail("ACS_API_SOURCE_SIZE_INVALID")
        raw=original(root,name,size)
        if len(raw)!=size or digest(raw)!=entry.get("sha256"):
            fail("ACS_API_SOURCE_HASH_CHANGED",path=name)
        document=parse(raw);put("capture/"+name,raw)
        if kind=="metadata":
            if not isinstance(document,dict) or not isinstance(document.get("variables"),dict):
                fail("ACS_API_GROUP_METADATA_REQUIRED")
            if (year,key) in metadata:fail("ACS_API_DUPLICATE_GROUP")
            metadata[(year,key)]=(entry,document["variables"])
            continue
        if not isinstance(document,list) or len(document)<2 or not isinstance(document[0],list):
            fail("ACS_API_DATA_ROWS_REQUIRED")
        header=document[0]
        if any(not isinstance(x,str) for x in header) or len(header)!=len(set(header)) or not {"NAME","state","county"}<=set(header):
            fail("ACS_API_DATA_HEADER_INVALID")
        requested=query.get("get")
        geography=query.get("for")
        state=query.get("in")
        if (not requested or len(requested)!=1 or header!=requested[0].split(",")+["state","county"]
                or not geography or len(geography)!=1 or not geography[0].startswith("county:")
                or not state or len(state)!=1 or not re.fullmatch(r"state:[0-9]{2}",state[0])):
            fail("ACS_API_QUERY_HEADER_MISMATCH")
        requested_counties=geography[0][7:].split(",")
        if any(not re.fullmatch(r"[0-9]{3}",x) for x in requested_counties) or len(set(requested_counties))!=len(requested_counties):
            fail("ACS_API_EXPLICIT_COUNTY_SELECTION_REQUIRED")
        actual_counties=set();indexed={}
        estimate_variables=[x for x in header if VARIABLE.fullmatch(x)]
        if not estimate_variables:fail("ACS_API_ESTIMATE_VARIABLES_REQUIRED")
        for position,values in enumerate(document[1:],2):
            if not isinstance(values,list) or len(values)!=len(header):
                fail("ACS_API_DATA_ROW_WIDTH_CHANGED")
            record=dict(zip(header,values))
            if (record["state"]!=state[0][6:] or record["county"] not in requested_counties
                    or record["county"] in actual_counties or not isinstance(record["NAME"],str)):
                fail("ACS_API_SOURCE_GEOGRAPHY_CHANGED")
            actual_counties.add(record["county"])
            geoid=record["state"]+record["county"]
            indexed[geoid]=(position,record,identity(values))
            for variable in estimate_variables:
                if not {variable[:-1]+suffix for suffix in ("E","M","EA","MA")}<=set(header):
                    fail("ACS_API_ESTIMATE_ANNOTATIONS_REQUIRED")
                item=(year,geoid,variable)
                if item in expected:fail("ACS_API_DUPLICATE_SOURCE_CELL")
                expected.add(item)
        if actual_counties!=set(requested_counties):
            fail("ACS_API_SOURCE_COUNTY_SELECTION_INCOMPLETE")
        data[name]=(entry,header,indexed)
    put("capture/SOURCE_MANIFEST.json",raw_manifest)
    put("capture/county_housing_observations.json",original_rows)
    # The optional original CSV is retained as an alternate source export.
    if (root/"county_housing_observations.csv").exists():
        put("capture/county_housing_observations.csv",original(root,"county_housing_observations.csv",128*1024*1024))
    projected=[];seen=set();release_years=set();aliases={}
    for row in rows:
        if not isinstance(row,dict):fail("ACS_API_OBSERVATION_INVALID")
        year=row.get("period_end")
        if (not isinstance(row.get("state"),str) or not isinstance(row.get("county"),str)
                or not re.fullmatch(r"[0-9]{2}",row["state"]) or not re.fullmatch(r"[0-9]{3}",row["county"])):
            fail("ACS_API_OBSERVATION_GEOGRAPHY_INVALID")
        geoid=row["state"]+row["county"]
        variable=row.get("variable");match=VARIABLE.fullmatch(variable) if isinstance(variable,str) else None
        if not match or not GEO.fullmatch(geoid) or type(year) is not int or row.get("period_start")!=year-4:
            fail("ACS_API_OBSERVATION_IDENTITY_INVALID")
        table=match[1].split("_")[0]
        observation_id=(year,geoid,variable)
        if observation_id in seen or observation_id not in expected:
            fail("ACS_API_OBSERVATION_SELECTION_CHANGED")
        seen.add(observation_id);release_years.add(year)
        original_data=data.get(row.get("data_file"))
        original_metadata=metadata.get((year,table))
        if not original_data or not original_metadata:
            fail("ACS_API_OBSERVATION_SOURCE_MISSING")
        source_entry,header,geo_rows=original_data
        meta_entry,definitions=original_metadata
        if (source_entry["year"]!=year or row.get("metadata_file")!=meta_entry["file"] or row.get("table")!=table
                or row.get("geography")!="05000US"+geoid or geoid not in geo_rows):
            fail("ACS_API_OBSERVATION_SOURCE_IDENTITY_CHANGED")
        position,record,row_hash=geo_rows[geoid]
        prefix=variable[:-1]
        if any(prefix+suffix not in definitions for suffix in ("E","M","EA","MA")):
            fail("ACS_API_VARIABLE_METADATA_MISSING")
        definition=definitions[variable]
        if (row.get("moe_variable")!=prefix+"M" or row.get("name")!=record["NAME"]
                or row.get("concept")!=definition.get("concept") or row.get("label")!=definition.get("label")):
            fail("ACS_API_OBSERVATION_METADATA_CHANGED")
        for field,suffix in (("estimate_raw","E"),("moe_raw","M"),("estimate_annotation","EA"),("moe_annotation","MA")):
            if field not in row or row[field]!=record[prefix+suffix]:
                fail("ACS_API_ORIGINAL_VALUE_CHANGED",field=field)
        for prefix_name in ("estimate","moe"):
            value=number(row[prefix_name+"_raw"])
            status="numeric" if value is not None else "source_special_or_missing"
            if (row.get(prefix_name)!=value or value is not None and type(row.get(prefix_name)) is not int
                    or row.get(prefix_name+"_status")!=status):
                fail("ACS_API_NORMALIZATION_CHANGED",field=prefix_name)
        if not isinstance(row.get("unit"),str) or not row["unit"] or not isinstance(row.get("measure"),str) or not row["measure"]:
            fail("ACS_API_SOURCE_UNIT_OR_ALIAS_REQUIRED")
        old=aliases.setdefault(variable,(row["measure"],row["unit"]))
        if old!=(row["measure"],row["unit"]):fail("ACS_API_MEASURE_ALIAS_CHANGED")
        projected.append({"original":row,"source_provenance":{
            "source_file":source_entry["file"],"source_sha256":source_entry["sha256"],"source_row":position,
            "source_row_sha256":row_hash,"source_url":source_entry["url"],"retrieved_at":source_entry["retrieved_at"],
            "estimate_column":header.index(variable)+1,"moe_column":header.index(prefix+"M")+1,
            "estimate_annotation_column":header.index(prefix+"EA")+1,"moe_annotation_column":header.index(prefix+"MA")+1,
            "metadata_file":meta_entry["file"],"metadata_sha256":meta_entry["sha256"],"metadata_url":meta_entry["url"],
            "metadata_variable":variable,"capture_manifest_sha256":digest(raw_manifest)}})
    if seen!=expected or len(aliases)!=manifest.get("measure_count"):
        fail("ACS_API_COMPLETE_SOURCE_SELECTION_REQUIRED")
    capture_id=digest(raw_manifest)
    configuration={"schema":"stellar-forge.study-acs-api-source.v1",
                   "manifest":"capture/SOURCE_MANIFEST.json","captureSha256":capture_id}
    put("intake-source.json",input_raw)
    put("source.json",encoded(configuration)+b"\n")
    payload=b"".join(encoded(row)+b"\n" for row in projected)
    put("projections/api_observations.jsonl",payload)
    projection={**files["projections/api_observations.jsonl"],"query":"api_observations","rows":len(projected),
                "native":{"schema":"stellar-forge.study-acs-api-verification.v1","source_cells":len(expected),
                          "original_response_files":len(entries),"source_rows_verified":True,
                          "original_projection_sha256":digest(original_rows)}}
    descriptor={"schema":"stellar-forge.study-retained-source.v1","provider":"acs_api",
                "protocol":"census-api-county-json","capture_id":capture_id,"source_sha256":digest(input_raw),
                "manifest_path":"SOURCE_MANIFEST.json","source_file":"source.json",
                "release_label":"ACS API "+"/".join(map(str,sorted(release_years)))+" 5-year",
                "projections":[projection],"files":sorted(files.values(),key=lambda x:x["path"])}
    dump(out/"descriptor.json",descriptor,exclusive=True)
    return descriptor

if __name__=="__main__":
    try:
        descriptor=retain_api_capture(sys.argv[1],sys.argv[2])
        print(json.dumps({"capture_id":descriptor["capture_id"],"rows":descriptor["projections"][0]["rows"]}))
    except Exception as error:
        print(json.dumps({"code":getattr(error,"code",type(error).__name__),
                          "details":getattr(error,"details",{})}),file=sys.stderr)
        raise SystemExit(1)
