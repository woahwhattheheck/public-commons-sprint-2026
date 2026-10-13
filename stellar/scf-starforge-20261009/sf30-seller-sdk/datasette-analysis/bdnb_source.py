"""Complete original BDNB file custody and exact, separate typed projection.

The original Analysis document store retains ordered source segments; the
original DatasetDatabase owns every imported row. No new database is created.
"""
from __future__ import annotations
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
import tempfile

from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.storage import private_directory, sync_directory
from stellar_forge_buyer.response_documents import validate_manifest, document_path

HERE = Path(__file__).resolve().parent
CHUNK = 65536
SEGMENT = 16 * 1024 * 1024
MAX_ROW = 2 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024 * 1024
FIELDS = ["id","key_json","key_valid","group_id","address_id","department_code",
          "commune_code","old_edition","new_edition","old_id","new_id","change_type",
          "classification","evidence_sha256","body_json"]
HEX = re.compile(r"[a-f0-9]{64}")
ID = re.compile(r"[a-f0-9]{32}")

def need(value, code, detail=""):
    if not value:
        error = StateError("BDNB_" + code)
        error.detail = str(detail)
        raise error

def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode("utf-8")

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def clone(value):
    return json.loads(encoded(value))

def text(value, name, maximum=12000, empty=False):
    need(isinstance(value,str) and len(value)<=maximum and "\x00" not in value and (empty or value.strip()),"TEXT_INVALID",name)
    return value

def identifier(value):
    need(isinstance(value,str) and ID.fullmatch(value),"ID_INVALID")
    return value

def quote(value):
    need(isinstance(value,str) and value and "\x00" not in value,"SQL_IDENTIFIER")
    return '"' + value.replace('"','""') + '"'

def now():
    return datetime.now(timezone.utc).isoformat()

def signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns

def folder(path):
    path=Path(path)
    missing=[]
    p=path
    while not p.exists():
        missing.append(p);p=p.parent
    for value in reversed(missing):
        try:value.mkdir(mode=0o700)
        except FileExistsError:pass
        need(not value.is_symlink() and value.is_dir(),"DIRECTORY_CHANGED")
        sync_directory(value.parent)
    return private_directory(path,create=False)

@contextmanager
def opened(path):
    path=Path(path)
    need(path.is_absolute(),"ABSOLUTE_FILE_REQUIRED")
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode),"REGULAR_FILE_REQUIRED")
        stream=os.fdopen(fd,"rb");fd=None
        try:
            yield stream,before
            named=os.stat(path,follow_symlinks=False)
            need(signature(before)==signature(os.fstat(stream.fileno()))==signature(named),"FILE_CHANGED",str(path))
        finally:stream.close()
    finally:
        if fd is not None:os.close(fd)

def file_identity(path):
    with opened(path) as (stream,info):
        h=hashlib.sha256();count=0
        while block:=stream.read(CHUNK):
            h.update(block);count+=len(block)
        need(count==info.st_size,"FILE_CHANGED")
        return {"bytes":count,"sha256":h.hexdigest()}

def publish(path,raw):
    path=Path(path);folder(path.parent)
    expected={"bytes":len(raw),"sha256":sha(raw)}
    if path.exists():
        need(file_identity(path)==expected,"RETAINED_FILE_CHANGED",str(path))
        with opened(path) as (stream,_):os.fsync(stream.fileno())
        sync_directory(path.parent)
        return expected
    fd,temp=tempfile.mkstemp(prefix=".bdnb-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(raw);out.flush();os.fsync(out.fileno())
        try:os.link(temp,path,follow_symlinks=False)
        except FileExistsError:need(file_identity(path)==expected,"RETAINED_FILE_CHANGED")
        sync_directory(path.parent)
    finally:
        os.unlink(temp);sync_directory(path.parent)
    return expected

def publish_spool(path,temporary,expected):
    path=Path(path)
    need(file_identity(temporary)==expected,"SPOOL_CHANGED")
    try:os.link(temporary,path,follow_symlinks=False)
    except FileExistsError:need(file_identity(path)==expected,"RETAINED_FILE_CHANGED")
    with opened(path) as (stream,_):os.fsync(stream.fileno())
    sync_directory(path.parent)

def dictionary():
    raw=(HERE/"bdnb_dictionary.json").read_bytes()
    value=json.loads(raw)
    need(value.get("schema")=="stellar-forge.bdnb-dictionary.v1","DICTIONARY_CHANGED")
    return value,sha(raw)

def normalize_descriptor(value):
    value=clone(value)
    need(isinstance(value,dict) and value.get("schema")=="stellar-forge.bdnb-source.v1","SOURCE_SCHEMA")
    required={"schema","title","publisher","source_url","license","captured_at","millesime","structure_version","scope","tables"}
    need(required<=set(value)<=required|{"dictionary"},"SOURCE_FIELDS")
    for key in ("title","publisher","license","millesime","structure_version"):text(value.get(key),key,12000 if key=="license" else 200)
    from urllib.parse import urlsplit
    url=text(value["source_url"],"source_url",3000)
    parsed=urlsplit(url)
    need(parsed.scheme=="https" and parsed.hostname and not parsed.username and not parsed.password and not parsed.fragment,"SOURCE_URL")
    try:
        stamp=datetime.fromisoformat(value["captured_at"].replace("Z","+00:00"))
        need(stamp.utcoffset() is not None,"CAPTURE_TIME")
    except (ValueError,TypeError,AttributeError):need(False,"CAPTURE_TIME")
    scope=value["scope"]
    need(isinstance(scope,dict) and set(scope)=={"kind","codes","description"} and scope["kind"] in {"department","commune","custom"},"SOURCE_SCOPE")
    text(scope["description"],"scope.description",12000)
    need(isinstance(scope["codes"],list) and len(scope["codes"])<=10000 and len(set(scope["codes"]))==len(scope["codes"]) and all(isinstance(c,str) and 0<len(c)<=100 for c in scope["codes"]),"SOURCE_SCOPE_CODES")
    selected_dictionary=source_dictionary(value)
    tables=value["tables"];defs={t["name"]:t for t in selected_dictionary["tables"]}
    need(isinstance(tables,list) and 1<=len(tables)<=len(defs),"SOURCE_TABLES")
    names=[]
    for item in tables:
        need(isinstance(item,dict),"SOURCE_TABLE")
        need(set(item)=={"table","path","bytes","sha256","format","delimiter","encoding","null_values","geometry_encoding","extra_fields"},"SOURCE_TABLE_FIELDS")
        name=item["table"];need(name in defs and name not in names,"SOURCE_TABLE_NAME");names.append(name)
        text(item["path"],"path",4096);need(Path(item["path"]).is_absolute(),"ABSOLUTE_FILE_REQUIRED")
        need(type(item["bytes"]) is int and 0<=item["bytes"]<=MAX_FILE and isinstance(item["sha256"],str) and HEX.fullmatch(item["sha256"]),"SOURCE_IDENTITY")
        need(item["format"]=="csv" and item["encoding"]=="utf-8","SOURCE_FORMAT")
        need(isinstance(item["delimiter"],str) and len(item["delimiter"])==1 and item["delimiter"] not in "\r\n\0\"","CSV_DELIMITER")
        need(isinstance(item["null_values"],list) and len(item["null_values"])<=32 and all(isinstance(v,str) for v in item["null_values"]),"NULL_VALUES")
        need(item["geometry_encoding"] in {"wkt","ewkb-hex","geojson-text","opaque"},"GEOMETRY_ENCODING")
        known={f["name"] for f in defs[name]["fields"]}
        need(isinstance(item["extra_fields"],list) and len(item["extra_fields"])<=1024,"EXTRA_FIELDS")
        seen=set()
        for f in item["extra_fields"]:
            need(isinstance(f,dict) and set(f)=={"name","type","nullable","description","unit"},"EXTRA_FIELD")
            text(f["name"],"extra field",512);need(f["name"] not in known|seen,"EXTRA_FIELD_DUPLICATE");seen.add(f["name"])
            need(f["type"] in {"text","integer","decimal","boolean","date","geometry"} and type(f["nullable"]) is bool,"EXTRA_FIELD_TYPE")
            text(f["description"],"description",12000,True)
            need(f["unit"] is None or isinstance(f["unit"],str),"EXTRA_FIELD_UNIT")
    need("batiment_groupe" in names,"GROUP_TABLE_REQUIRED")
    return value

def source_dictionary(descriptor):
    selected=descriptor.get("dictionary") or dictionary()[0]
    need(isinstance(selected,dict) and selected.get("schema")=="stellar-forge.bdnb-dictionary.v1","SOURCE_DICTIONARY_SCHEMA")
    tables=selected.get("tables")
    known={t["name"] for t in dictionary()[0]["tables"]}
    need(isinstance(tables,list) and len(tables)==5 and {t.get("name") for t in tables}==known,"SOURCE_DICTIONARY_TABLES")
    for table in tables:
        need(table.get("source",{}).get("publisher_structure")==descriptor["structure_version"],"SOURCE_DICTIONARY_VERSION",table["name"])
        need(isinstance(table.get("source",{}).get("url"),str) and table["source"]["url"].startswith("https://"),"SOURCE_DICTIONARY_REFERENCE")
        fields=table.get("fields");need(isinstance(fields,list) and 0<len(fields)<=1024,"SOURCE_DICTIONARY_FIELDS")
        names=[]
        for field in fields:
            need(isinstance(field,dict),"SOURCE_DICTIONARY_FIELD")
            name=text(field.get("name"),"dictionary field",512);need(name not in names,"SOURCE_DICTIONARY_DUPLICATE");names.append(name)
            need(field.get("type") in {"text","integer","decimal","boolean","date","geometry"} and type(field.get("nullable")) is bool,"SOURCE_DICTIONARY_TYPE")
            text(field.get("description",""),"dictionary description",12000,True)
            for key in ("max_length","precision","scale","bits"):
                if key in field:need(type(field[key]) is int and 0<=field[key]<=10000,"SOURCE_DICTIONARY_CONSTRAINT")
            if "precision" in field:need("scale" in field and field["scale"]<=field["precision"],"SOURCE_DICTIONARY_DECIMAL")
        keys=table.get("primary_key")
        need(isinstance(keys,list) and len(set(keys))==len(keys) and set(keys)<=set(names),"SOURCE_DICTIONARY_PRIMARY_KEY")
        original=next(t for t in dictionary()[0]["tables"] if t["name"]==table["name"])
        need(keys==original["primary_key"],"SOURCE_DICTIONARY_KEY_CHANGE_REQUIRES_REVIEW")
    return selected

def decimal_token(value):
    number=Decimal(value)
    need(number.is_finite(),"NONFINITE_NUMBER")
    if not number:return "0"
    sign,digits,exponent=number.as_tuple()
    digits=list(digits)
    while digits and digits[-1]==0:
        digits.pop();exponent+=1
    # Construct the exact token without Decimal context rounding.
    need(abs(exponent)<=10000 and len(digits)+max(0,exponent)<=MAX_ROW,"DECIMAL_EXPONENT")
    raw="".join(str(x) for x in digits) or "0"
    if exponent>=0:raw+="0"*exponent
    elif len(raw)+exponent>0:raw=raw[:exponent]+"."+raw[exponent:]
    else:raw="0."+"0"*(-exponent-len(raw))+raw
    return ("-" if sign else "")+raw

def _geometry(value,encoding,expected=None):
    result={"state":"review","crs":"EPSG:2154","encoding":encoding,"raw":value,"geojson":None,"findings":[]}
    try:
        def coord(v):
            need(isinstance(v,(list,tuple)) and 2<=len(v)<=4,"GEOMETRY_COORDINATE")
            return [decimal_token(str(n)) for n in v]
        if encoding=="geojson-text":
            obj=json.loads(value,parse_int=Decimal,parse_float=Decimal,parse_constant=lambda x:need(False,"NONFINITE_NUMBER"))
            need(isinstance(obj,dict) and "crs" not in obj,"GEOMETRY_DECLARED_CRS")
            def convert(o):
                kind=o.get("type")
                if kind=="GeometryCollection":return {"type":kind,"geometries":[convert(x) for x in o["geometries"]]}
                depth={"Point":0,"MultiPoint":1,"LineString":1,"MultiLineString":2,"Polygon":2,"MultiPolygon":3}.get(kind)
                need(depth is not None,"GEOMETRY_TYPE")
                def walk(a,n):
                    need(isinstance(a,list),"GEOMETRY_COORDINATES")
                    return coord(a) if n==0 else [walk(b,n-1) for b in a]
                return {"type":kind,"coordinates":walk(o["coordinates"],depth)}
            exact=convert(obj)
        elif encoding=="wkt":
            value2=value.strip();srid=re.match(r"SRID=(\d+);",value2,re.I)
            if srid:
                need(int(srid[1])==2154,"GEOMETRY_CRS");value2=value2[srid.end():]
            match=re.match(r"^\s*(POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON)\s*(ZM|Z|M)?\s*",value2,re.I)
            need(match is not None,"GEOMETRY_WKT")
            kind={"POINT":"Point","MULTIPOINT":"MultiPoint","LINESTRING":"LineString","MULTILINESTRING":"MultiLineString","POLYGON":"Polygon","MULTIPOLYGON":"MultiPolygon"}[match[1].upper()]
            tail=value2[match.end():];need(tail.upper()!="EMPTY","GEOMETRY_EMPTY")
            tokens=re.findall(r"[(),]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?",tail)
            need("".join(tokens)==re.sub(r"\s+","",tail),"GEOMETRY_WKT_TOKEN")
            pos=0
            def group():
                nonlocal pos
                need(pos<len(tokens) and tokens[pos]=="(","GEOMETRY_WKT_GROUP");pos+=1;items=[]
                while True:
                    need(pos<len(tokens),"GEOMETRY_WKT_END")
                    if tokens[pos]=="(":item=group()
                    else:
                        item=[]
                        while pos<len(tokens) and tokens[pos] not in {",",")","("}:
                            item.append(decimal_token(tokens[pos]));pos+=1
                        need(2<=len(item)<=4,"GEOMETRY_COORDINATE")
                    items.append(item)
                    need(pos<len(tokens),"GEOMETRY_WKT_END")
                    separator=tokens[pos];pos+=1
                    if separator==")":break
                    need(separator==",","GEOMETRY_WKT_SEPARATOR")
                return items
            coordinates=group();need(pos==len(tokens),"GEOMETRY_WKT_TRAILING")
            if kind=="Point":need(len(coordinates)==1,"GEOMETRY_POINT");coordinates=coordinates[0]
            if kind=="MultiPoint":coordinates=[c[0] if isinstance(c[0],list) and len(c)==1 else c for c in coordinates]
            exact={"type":kind,"coordinates":coordinates}
        elif encoding=="ewkb-hex":
            data=bytes.fromhex(value.removeprefix("\\x"));position=0
            def unpack(fmt,end):
                nonlocal position
                size=struct.calcsize(fmt);need(position+size<=len(data),"GEOMETRY_WKB_END")
                v=struct.unpack_from(end+fmt,data,position);position+=size;return v[0] if len(v)==1 else v
            def geom():
                nonlocal position
                endian=unpack("B","<");need(endian in (0,1),"GEOMETRY_WKB_ENDIAN");end="<" if endian else ">"
                code=unpack("I",end);z=bool(code&0x80000000);m=bool(code&0x40000000);has_srid=bool(code&0x20000000);base=code&0x0fffffff
                if base>=1000:
                    dimension=base//1000;z=z or dimension in (1,3);m=m or dimension in (2,3);base%=1000
                if has_srid:need(unpack("I",end)==2154,"GEOMETRY_CRS")
                dims=2+z+m
                def point():
                    values=[unpack("d",end) for _ in range(dims)]
                    need(all(math.isfinite(n) for n in values),"GEOMETRY_NONFINITE")
                    return [decimal_token(str(n)) for n in values]
                if base==1:return {"type":"Point","coordinates":point()}
                if base==2:return {"type":"LineString","coordinates":[point() for _ in range(unpack("I",end))]}
                if base==3:return {"type":"Polygon","coordinates":[[point() for _ in range(unpack("I",end))] for _ in range(unpack("I",end))]}
                need(base in (4,5,6,7),"GEOMETRY_WKB_TYPE")
                children=[geom() for _ in range(unpack("I",end))]
                if base==7:return {"type":"GeometryCollection","geometries":children}
                childkind={4:"Point",5:"LineString",6:"Polygon"}[base]
                need(all(c["type"]==childkind for c in children),"GEOMETRY_WKB_CHILD")
                return {"type":"Multi"+childkind,"coordinates":[c["coordinates"] for c in children]}
            exact=geom();need(position==len(data),"GEOMETRY_WKB_TRAILING")
        else:
            result["findings"].append({"code":"GEOMETRY_OPAQUE","detail":"Original geometry retained; no coordinate interpretation selected."})
            return result
        def validate(g):
            k=g["type"]
            if k=="GeometryCollection":
                for child in g["geometries"]:validate(child)
                return
            a=g["coordinates"]
            if k=="Point":coord(a)
            elif k=="LineString":need(len(a)>=2,"GEOMETRY_LINE")
            elif k=="Polygon":
                need(len(a)>0,"GEOMETRY_POLYGON")
                for ring in a:need(len(ring)>=4 and ring[0]==ring[-1],"GEOMETRY_RING")
            elif k.startswith("Multi"):
                for child in a:validate({"type":k[5:],"coordinates":child})
        validate(exact)
        need(expected is None or exact["type"]==expected,"GEOMETRY_DECLARED_TYPE")
        def render(a):
            if isinstance(a,dict):return {k:render(v) for k,v in a.items()}
            if isinstance(a,list):return [render(v) for v in a]
            if isinstance(a,str) and re.fullmatch(r"-?\d+(?:\.\d+)?",a):
                v=float(a);need(math.isfinite(v),"GEOMETRY_RENDER_RANGE");return v
            return a
        result.update(state="valid",geojson=render(exact),exact=exact,rendering_note="Projected-coordinate rendering uses binary numbers; exact coordinate tokens and original geometry remain retained.")
    except (ValueError,TypeError,KeyError,IndexError,OverflowError,RecursionError,InvalidOperation,StateError) as exc:
        result["findings"].append({"code":getattr(exc,"code","BDNB_GEOMETRY_INVALID"),"detail":str(exc)})
    return result

def typed(raw,field,null_values,geometry_encoding):
    out={"type":field["type"],"state":"value","value":raw,"raw":raw,"unit":field.get("unit")}
    if raw is None:out.update(state="missing",value=None);return out,None
    if raw in null_values:
        out.update(state="null" if field["nullable"] else "invalid",value=None)
        return out,None
    geometry=None
    try:
        kind=field["type"]
        if kind=="text":
            need("max_length" not in field or len(raw)<=field["max_length"],"TEXT_WIDTH")
        elif kind=="integer":
            need(re.fullmatch(r"[+-]?\d+",raw) is not None,"INTEGER_TOKEN")
            number=int(raw)
            need("bits" not in field or -(2**(field["bits"]-1))<=number<2**(field["bits"]-1),"INTEGER_RANGE")
            out["value"]=str(number)
        elif kind=="decimal":
            need(re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?",raw) is not None,"DECIMAL_TOKEN")
            token=decimal_token(raw);out["value"]=token
            if "precision" in field:
                a=token.lstrip("-");whole,_,fraction=a.partition(".")
                need(len(whole.lstrip("0"))<=field["precision"]-field["scale"] and len(fraction)<=field["scale"],"DECIMAL_WIDTH")
        elif kind=="boolean":
            need(raw.lower() in {"true","false","t","f","1","0"},"BOOLEAN_TOKEN");out["value"]=raw.lower() in {"true","t","1"}
        elif kind=="date":
            out["value"]=date.fromisoformat(raw).isoformat();need(out["value"]==raw,"DATE_TOKEN")
        elif kind=="geometry":
            geometry=_geometry(raw,geometry_encoding,field.get("geometry_type"))
            need(geometry["state"]=="valid","GEOMETRY_REVIEW");out["value"]=geometry["exact"]
        else:need(False,"FIELD_TYPE")
    except (StateError,ValueError,InvalidOperation) as error:
        out.update(state="invalid",value=None,error=getattr(error,"code","BDNB_TYPED_INVALID"))
    return out,geometry

def csv_rows(path,table_spec,descriptor,edition_id):
    spec={t["name"]:t for t in source_dictionary(descriptor)["tables"]}[table_spec["table"]]
    fields={f["name"]:dict(f) for f in spec["fields"]}
    for field in table_spec["extra_fields"]:fields[field["name"]]=field
    if spec.get("geometry"):fields[spec["geometry"]["field"]]["geometry_type"]=spec["geometry"]["type"]
    prior_field_limit=csv.field_size_limit(MAX_ROW)
    with opened(path) as (binary,_):
        stream=io.TextIOWrapper(binary,encoding="utf-8-sig",newline="")
        try:
            class Lines:
                def __init__(self):self.count=0
                def __iter__(self):return self
                def __next__(self):
                    line=stream.readline(MAX_ROW+1)
                    if not line:raise StopIteration
                    self.count+=len(line.encode("utf-8"))
                    need(self.count<=MAX_ROW,"CSV_LOGICAL_RECORD_CAPACITY")
                    return line
            lines=Lines()
            reader=csv.reader(lines,delimiter=table_spec["delimiter"],strict=True)
            headers=next(reader,None)
            lines.count=0
            need(headers is not None and 0<len(headers)<=1024 and all(isinstance(h,str) and h and "\x00" not in h for h in headers) and len(set(headers))==len(headers),"CSV_HEADER")
            unknown=set(headers)-set(fields)
            for name in unknown:fields[name]={"name":name,"type":"text","nullable":True,"description":"Unmapped original column retained as text."}
            for ordinal,values in enumerate(reader,1):
                need(len(values)==len(headers),"CSV_ROW_WIDTH",str(ordinal))
                raw=dict(zip(headers,values));projection={};findings=[];geometry={"state":"absent","crs":"EPSG:2154","encoding":table_spec["geometry_encoding"],"raw":None,"geojson":None,"findings":[]}
                for name,field in fields.items():
                    value,geo=typed(raw.get(name),field,table_spec["null_values"],table_spec["geometry_encoding"])
                    projection[name]=value
                    if value["state"] in {"invalid","missing"}:findings.append({"code":"FIELD_"+value["state"].upper(),"field":name,"detail":value.get("error","Original field is absent.")})
                    if name in unknown:findings.append({"code":"UNDECLARED_COLUMN","field":name,"detail":"Original text retained; declare extra field semantics for typed comparison."})
                    if geo is not None:geometry=geo
                keys=[projection.get(name) for name in spec["primary_key"]]
                valid=bool(keys) and all(v and v["state"]=="value" and isinstance(v["value"],str) and v["value"] for v in keys)
                key=[v["value"] for v in keys] if valid else None
                if spec["primary_key"] and not valid:findings.append({"code":"IDENTITY_UNAVAILABLE","field":",".join(spec["primary_key"]),"detail":"Retained row has no usable original primary key."})
                source={"edition_id":edition_id,"table":spec["name"],"file_sha256":table_spec["sha256"],"ordinal":ordinal}
                row={"id":sha(encoded({"source":source,"raw":raw})),"table":spec["name"],"ordinal":ordinal,"key":key,"original_columns":headers,"raw":raw,"typed":projection,"findings":findings,"geometry":geometry,"source":source}
                if geometry and spec.get("geometry",{}).get("fictive_flag"):
                    flag=projection.get(spec["geometry"]["fictive_flag"]);geometry["contains_fictive"]=flag["value"] if flag and flag["state"]=="value" else None
                need(len(encoded(row))<MAX_ROW-4096,"PROJECTED_ROW_CAPACITY",str(ordinal))
                lines.count=0
                yield row
        finally:
            stream.detach()
            csv.field_size_limit(prior_field_limit)

def storage_row(row):
    values=row.get("typed",{})
    def val(k):
        value=values.get(k)
        return value["value"] if value and value["state"]=="value" and isinstance(value["value"],(str,bool)) else None
    return {"id":row["id"],"key_json":encoded(row.get("key")).decode(),"key_valid":int(row.get("key") is not None),
            "group_id":val("batiment_groupe_id"),"address_id":val("cle_interop_adr"),"department_code":val("code_departement_insee"),
            "commune_code":val("code_commune_insee"),"old_edition":val("ancien_millesime"),"new_edition":val("nouveau_millesime"),
            "old_id":val("ancien_id"),"new_id":val("nouvel_id"),"change_type":val("type_modification"),
            "classification":row.get("classification"),"evidence_sha256":row.get("evidence_sha256"),"body_json":encoded(row).decode()}

def retain_csv(adapter,edition_id,descriptor,table_spec):
    """Retain every source byte through the original portable document owner."""
    table=table_spec["table"];expected={k:table_spec[k] for k in ("bytes","sha256")}
    root=folder(adapter.directory/"sources"/edition_id/table)
    original=root/"original.csv"
    if original.exists():
        need(file_identity(original)==expected,"ORIGINAL_CHANGED")
        with opened(original) as (stream,_):os.fsync(stream.fileno())
        sync_directory(root)
    else:
        fd,temp=tempfile.mkstemp(prefix=".original-",dir=root)
        try:
            with os.fdopen(fd,"wb") as output,opened(Path(table_spec["path"])) as (source,before):
                need(before.st_size==expected["bytes"],"SOURCE_SIZE_CHANGED")
                h=hashlib.sha256();count=0
                while block:=source.read(CHUNK):
                    count+=len(block);need(count<=expected["bytes"],"SOURCE_GREW")
                    h.update(block);output.write(block)
                need({"bytes":count,"sha256":h.hexdigest()}==expected,"SOURCE_HASH_CHANGED")
                output.flush();os.fsync(output.fileno())
            publish_spool(original,Path(temp),expected)
        finally:
            os.unlink(temp);sync_directory(root)
    receipts=[];batch=[];offset=0;part=0
    def flush(items,part_number):
        selected=folder(root/("document-"+str(part_number).zfill(6)))
        document={"schema":"stellar-forge.bdnb-original-segments.v1","edition_id":edition_id,"table":table,
                  "original":expected,"descriptor":descriptor,"table_descriptor":table_spec,"segments":items}
        body=encoded(document);content_sha=sha(body)
        payload={"path":"files/"+content_sha+".json","bytes":len(body),"sha256":content_sha,"contentType":"application/json"}
        publish(selected/payload["path"],body)
        originals=[];mapping={payload["path"]:selected/payload["path"]}
        for item in items:
            record={"path":"files/"+item["sha256"]+".bin","bytes":item["bytes"],"sha256":item["sha256"],"contentType":"application/octet-stream","role":"segment-"+str(item["index"]).zfill(8)}
            originals.append(record);mapping[record["path"]]=root/("segment-"+str(item["index"]).zfill(8)+".bin")
        manifest={"schema":"stellar-forge.analysis-source-document.v1","title":descriptor["title"][:160]+" "+table[:30],"format":"json","document":payload,"originals":originals,"complete":True,
                  "provenance":{"kind":"public-source","publisher":descriptor["publisher"],"sourceUrl":descriptor["source_url"],"capturedAt":descriptor["captured_at"],"scope":descriptor["scope"]["description"][:500],"description":"Ordered complete binary segments of the exact publisher CSV; whole bytes and hash plus offsets bind the original file."}}
        # The standard public-source URL contract excludes query strings.
        # Keep the complete operator-selected URL in the descriptor/payload;
        # use the standard operator-file provenance kind for such sources.
        from urllib.parse import urlsplit
        if urlsplit(descriptor["source_url"]).query:
            manifest["provenance"]["kind"]="operator-file"
            manifest["provenance"].pop("sourceUrl",None)
        validate_manifest(manifest);publish(selected/"source.json",encoded(manifest))
        name="bdnb_"+edition_id[:12]+"_"+sha(table.encode())[:8]+"_"+str(part_number)
        registered=adapter.analysis.responses.register(name,"document",manifest=str(selected/"source.json"),document_files=mapping)
        return {"name":name,"revision":registered["revision"],"document_id":registered["document_id"],"segments":items}
    with opened(original) as (stream,_):
        index=0
        while block:=stream.read(SEGMENT):
            item={"index":index,"offset":offset,"bytes":len(block),"sha256":sha(block)}
            publish(root/("segment-"+str(index).zfill(8)+".bin"),block)
            batch.append(item);offset+=len(block);index+=1
            if len(batch)==14:
                receipts.append(flush(batch,part));part+=1;batch=[]
        if batch or not receipts:receipts.append(flush(batch,part))
    need(offset==expected["bytes"],"SEGMENT_LENGTH")
    return original,{"original":expected,"documents":receipts}
