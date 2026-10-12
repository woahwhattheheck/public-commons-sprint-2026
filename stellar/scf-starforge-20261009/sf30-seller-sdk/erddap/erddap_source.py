"""MIT. Exact ERDDAP JSON/CSV/metadata sources mapped into the ORIGINAL SF30 engine.
Destination values are preserved; source scale/offset, masks and units are never reapplied.
"""
from __future__ import annotations
import csv, datetime, hashlib, importlib.util, io, json, math, re, stat, sys, zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

HERE=Path(__file__).resolve().parent
XML=HERE.parent/"xml"
if str(XML) not in sys.path: sys.path.insert(0,str(XML))
from xml_source import InputError, MAX_SOURCE, validate_plan as xml_plan, dataset_spec as native_spec, typed, utf16_length

SCHEMA="stellar-forge.erddap-source.v1"
PLAN="stellar-forge.erddap-mapping.v1"
NAME=re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,127}\Z")
HEX=re.compile(r"[0-9a-f]{64}\Z")
NUMBER=re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
TYPES={"byte","ubyte","short","ushort","int","uint","long","ulong","float","double","String","char"}
MAX_ROWS=1000000
MAX_COLUMNS=256
FILES={"metadata.json","dataset.dds","dataset.das","data.json","data.csv"}

class Number(str):
    """An original JSON number token; it is never routed through binary floating point."""

def json_value(raw, lexical=False):
    def pairs(items):
        d={}
        for k,v in items:
            if k in d: raise InputError("Duplicate JSON member: "+k)
            d[k]=v
        return d
    def constant(s): raise InputError("Nonstandard JSON numeric constant: "+s)
    try:
        return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant,
            **({"parse_int":Number,"parse_float":Number} if lexical else {}))
    except (ValueError,UnicodeError,TypeError,RecursionError) as e:
        if isinstance(e,InputError):raise
        raise InputError("Expected complete UTF-8 JSON") from e

def jbytes(o):
    return (json.dumps(o,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode()

def sha(b): return hashlib.sha256(b).hexdigest()

def server_url(value):
    if not isinstance(value,str) or len(value)>2048:raise InputError("Choose the ERDDAP server URL")
    u=urlsplit(value)
    if u.scheme not in {"https","http"} or not u.hostname or u.username is not None or u.password is not None or u.query or u.fragment:
        raise InputError("ERDDAP server must be an HTTP(S) base URL without credentials, query or fragment")
    if u.scheme=="http" and u.hostname not in {"localhost","127.0.0.1","::1"}:
        raise InputError("Use HTTPS for a remote ERDDAP server")
    if any(c in value for c in "\r\n\t\\") or any(x in {".",".."} for x in u.path.split("/")):
        raise InputError("Invalid server path")
    return urlunsplit((u.scheme,u.netloc,u.path.rstrip("/")+"/","",""))

def dataset_id(value):
    if not isinstance(value,str) or not NAME.fullmatch(value) or value in {".",".."}:raise InputError("Invalid literal ERDDAP dataset ID")
    return value

def table(raw, max_rows=MAX_ROWS):
    root=json_value(raw,True)
    if not isinstance(root,dict) or set(root)!={"table"} or not isinstance(root["table"],dict):
        raise InputError("Expected ERDDAP's complete table JSON response")
    t=root["table"];names=t.get("columnNames");types=t.get("columnTypes");units=t.get("columnUnits")
    rows=t.get("rows")
    if not isinstance(names,list) or not 1<=len(names)<=MAX_COLUMNS or any(not isinstance(n,str) or not n or len(n)>256 for n in names) or len(set(names))!=len(names):
        raise InputError("Response column names are missing, duplicated or too numerous")
    if not isinstance(types,list) or len(types)!=len(names) or any(x not in TYPES for x in types):
        raise InputError("Response column types do not match the declared ERDDAP table")
    if units is None:units=[None]*len(names)
    if not isinstance(units,list) or len(units)!=len(names) or any(x is not None and not isinstance(x,str) for x in units):
        raise InputError("Response units must correspond to every column")
    if not isinstance(rows,list) or len(rows)>max_rows:raise InputError("Complete response exceeds the configured row limit")
    for row in rows:
        if not isinstance(row,list) or len(row)!=len(names) or any(isinstance(v,(dict,list,bool)) for v in row):
            raise InputError("Response row width or scalar value is invalid")
        for i,v in enumerate(row):
            if v is None:continue
            if types[i] in {"String","char"}:
                if not isinstance(v,str) or isinstance(v,Number):raise InputError("String response column contains a numeric value")
            elif not isinstance(v,Number) or not NUMBER.fullmatch(v):
                raise InputError("Numeric response column does not contain its original JSON number")
    return {"columnNames":names,"columnTypes":types,"columnUnits":units,"rows":rows}

def metadata(raw, did=None, dds=None):
    t=table(raw,200000);required=["Row Type","Variable Name","Attribute Name","Data Type","Value"]
    if any(k not in t["columnNames"] for k in required):raise InputError("Expected ERDDAP info/index.json metadata")
    idx={k:t["columnNames"].index(k) for k in required};attrs={};variables=[];dimensions=[];unknown=[]
    for row in t["rows"]:
        r={k:row[i] for k,i in idx.items()};name=r["Variable Name"]
        if r["Row Type"]=="attribute":
            target=attrs.setdefault(name,{})
            key=r["Attribute Name"]
            if key in target:raise InputError("Duplicate metadata attribute "+str(name)+"."+str(key))
            target[key]={"type":r["Data Type"],"value":r["Value"]}
        elif r["Row Type"] in {"variable","dimension"}:
            item={"name":name,"type":r["Data Type"],"declaration":r["Value"],"kind":r["Row Type"]}
            (dimensions if r["Row Type"]=="dimension" else variables).append(item)
        else:unknown.append(r)
    declared=variables+dimensions
    if len({x["name"] for x in declared})!=len(declared):raise InputError("Metadata repeats a variable or dimension")
    for item in declared:item["attributes"]=attrs.get(item["name"],{})
    global_attrs=attrs.get("NC_GLOBAL",{})
    supplied_id=global_attrs.get("id",{}).get("value")
    # NC_GLOBAL.id is the publisher's scientific identifier, not ERDDAP's route ID.
    # MUR uses MUR-JPL-L4-GLOB-v04.1 while its route is jplMURSST41.
    shapes={}
    if dds is not None:
        try:s=dds.decode("ascii")
        except UnicodeError as e:raise InputError("DDS must retain its original ASCII declaration") from e
        for m in re.finditer(r"\b(?:Byte|Int16|UInt16|Int32|UInt32|Int64|UInt64|Float32|Float64|String|Url)\s+([A-Za-z_][A-Za-z0-9_.-]*)\s*((?:\[[^\]]+\]\s*)*);",s):
            dims=[]
            for part in re.findall(r"\[([^\]]+)\]",m.group(2)):
                d=re.fullmatch(r"\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([0-9]+)\s*",part)
                if not d:raise InputError("Unsupported DDS dimension declaration; retain and inspect the original DDS")
                dims.append({"name":d.group(1),"size":int(d.group(2))})
            if dims:
                if m.group(1) in shapes and shapes[m.group(1)]!=dims:raise InputError("Conflicting DDS variable dimensions")
                shapes[m.group(1)]=dims
    for item in declared:item["dimensions"]=shapes.get(item["name"],[])
    return {"datasetId":did or supplied_id,"publisherId":supplied_id,"variables":variables,"dimensions":dimensions,
      "globalAttributes":global_attrs,"attributes":attrs,"unknownRows":unknown,
      "title":global_attrs.get("title",{}).get("value",did),
      "license":global_attrs.get("license",{}).get("value",""),
      "metadataSha256":sha(raw),"ddsSha256":sha(dds) if dds is not None else None}

def _atom(v,label):
    if not isinstance(v,str) or not v or len(v)>256 or re.search(r"[\s,\[\]()&\"\\\x00-\x1f]",v):
        raise InputError(label+" must be an explicit coordinate, time or index")
    if not NUMBER.fullmatch(v) and not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}(?::[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?)?Z?)?",v):
        raise InputError(label+" must be a fixed numeric or ISO time value")
    return v

def selection(raw, protocol, meta=None):
    if protocol not in {"griddap","tabledap"} or not isinstance(raw,dict):raise InputError("Choose griddap or tabledap with an explicit selection")
    allowed={"variables","axes"} if protocol=="griddap" else {"variables","constraints","orderBy"}
    if set(raw)-allowed:raise InputError("Unsupported selection field")
    vs=raw.get("variables")
    if not isinstance(vs,list) or not 1<=len(vs)<=64 or len(set(vs))!=len(vs) or any(not isinstance(v,str) or not NAME.fullmatch(v) for v in vs):
        raise InputError("Select 1–64 distinct exact provider variable names")
    known={v["name"]:v for v in (meta["variables"]+meta["dimensions"] if meta else [])}
    if meta and any(v not in known for v in vs):raise InputError("Selection contains a variable not present in the retained metadata")
    result={"variables":list(vs)}
    if protocol=="griddap":
        axes=raw.get("axes")
        if not isinstance(axes,list) or not 1<=len(axes)<=12:raise InputError("Provide every grid dimension in original DDS order")
        result["axes"]=[];names=[]
        for a in axes:
            if not isinstance(a,dict) or set(a)!={"name","mode","start","stop","stride"} or a["mode"] not in {"value","index"} or not NAME.fullmatch(str(a["name"])):
                raise InputError("Grid axes require name, value/index mode, explicit start/stop and stride")
            stride=a["stride"]
            if type(stride) is not int or not 1<=stride<=100000000:raise InputError("Grid stride must be a positive integer")
            start=_atom(a["start"],"Grid start");stop=_atom(a["stop"],"Grid stop")
            if a["mode"]=="index":
                if not start.isdigit() or not stop.isdigit() or int(start)>int(stop):raise InputError("Grid indices must be ascending nonnegative integers")
            # Coordinate values follow the original axis index order; a descending
            # latitude/depth axis legitimately has start > stop. The provider validates it.
            names.append(a["name"]);result["axes"].append({"name":a["name"],"mode":a["mode"],"start":start,"stop":stop,"stride":stride})
        if len(set(names))!=len(names):raise InputError("Grid dimension repeated")
        if meta:
            for v in vs:
                dims=known[v]["dimensions"]
                if not dims or [d["name"] for d in dims]!=names:
                    raise InputError("Selected variable "+v+" must use every original DDS dimension in order")
                for a,d in zip(result["axes"],dims):
                    if a["mode"]=="index" and int(a["stop"])>=d["size"]:raise InputError("Grid index exceeds the retained DDS dimension")
    else:
        cs=raw.get("constraints",[])
        if not isinstance(cs,list) or len(cs)>32:raise InputError("Choose up to 32 explicit table constraints")
        result["constraints"]=[]
        for c in cs:
            if not isinstance(c,dict) or set(c)!={"variable","operator","value","kind"} or not NAME.fullmatch(str(c["variable"])) or c["operator"] not in {"=","!=","<","<=",">",">=","=~"} or c["kind"] not in {"string","number","time"}:
                raise InputError("Invalid table constraint")
            if meta and c["variable"] not in known:raise InputError("Constraint variable is absent from retained metadata")
            value=c["value"]
            if not isinstance(value,str) or len(value)>2048 or "\x00" in value:raise InputError("Constraint value must be an explicit scalar string")
            if c["kind"]=="number" and not NUMBER.fullmatch(value):raise InputError("Numeric constraint must retain a finite JSON number")
            if c["kind"]=="time":_atom(value,"Table time")
            if c["operator"]=="=~" and c["kind"]!="string":raise InputError("Regex constraints require a string value")
            result["constraints"].append(dict(c))
        if "orderBy" in raw:
            order=raw["orderBy"]
            if not isinstance(order,list) or not 1<=len(order)<=8 or len(set(order))!=len(order) or any(v not in vs for v in order):
                raise InputError("Table ordering must name selected variables")
            result["orderBy"]=list(order)
    return result

def query_text(s,protocol):
    if protocol=="griddap":
        suffix=""
        for a in s["axes"]:
            start,stop=(("("+a["start"]+")"),("("+a["stop"]+")")) if a["mode"]=="value" else (a["start"],a["stop"])
            suffix+="["+start+":"+str(a["stride"])+":"+stop+"]"
        return ",".join(v+suffix for v in s["variables"])
    parts=[",".join(s["variables"])]
    for c in s["constraints"]:
        v=json.dumps(c["value"],ensure_ascii=False,separators=(",",":")) if c["kind"]=="string" else c["value"]
        parts.append(c["variable"]+c["operator"]+v)
    if s.get("orderBy"):parts.append("orderBy("+json.dumps(",".join(s["orderBy"]))+")")
    return "&".join(parts)

def encode_query(s,protocol):
    if protocol=="griddap":return quote(query_text(s,protocol),safe="")
    # Quoted user values may themselves contain '&'; encode components before joining.
    parts=[",".join(s["variables"])]
    for c in s["constraints"]:
        val=json.dumps(c["value"],ensure_ascii=False,separators=(",",":")) if c["kind"]=="string" else c["value"]
        parts.append(c["variable"]+c["operator"]+val)
    if s.get("orderBy"):parts.append("orderBy("+json.dumps(",".join(s["orderBy"]))+")")
    return "&".join(quote(x,safe="") for x in parts)

def urls(server,did,protocol,s):
    base=server_url(server);did=dataset_id(did);q=encode_query(s,protocol)
    return {"metadata.json":base+"info/"+quote(did,safe="")+"/index.json",
      "dataset.dds":base+protocol+"/"+quote(did,safe="")+".dds",
      "dataset.das":base+protocol+"/"+quote(did,safe="")+".das",
      "data.json":base+protocol+"/"+quote(did,safe="")+".json?"+q,
      "data.csv":base+protocol+"/"+quote(did,safe="")+".csv?"+q}

def _decode_sv(s):
    # ERDDAP emits JSON backslash escapes plus CSV doubled quotes; csv.reader already unquotes the latter.
    try:return json.loads('"'+s.replace('"','\\"')+'"')
    except (ValueError,UnicodeError) as e:raise InputError("Unsupported original ERDDAP separated-value escaping") from e

def csv_comparison(raw,t,*,comparison_version="decimal-v1"):
    if comparison_version not in {"lexical-v1","decimal-v1"}:
        raise InputError("Unsupported original JSON/CSV comparison version")
    try:reader=csv.reader(io.StringIO(raw.decode("iso-8859-1"),newline=""),strict=True)
    except (UnicodeError,csv.Error) as e:raise InputError("Invalid original ERDDAP CSV") from e
    differences=[];count=0;numeric_missing=0;numeric_equivalent_spellings=0
    try:
        names=next(reader);units=next(reader)
        names=[_decode_sv(x) for x in names];units=[_decode_sv(x) for x in units]
        if names!=t["columnNames"] or units!=[x or "" for x in t["columnUnits"]]:
            return {"status":"different","reason":"column names or units differ","jsonColumns":t["columnNames"],"csvColumns":names,"csvUnits":units}
        for row in reader:
            count+=1
            if count>MAX_ROWS:raise InputError("CSV exceeds complete row limit")
            if len(row)!=len(names):raise InputError("CSV row has a different width")
            if count>len(t["rows"]):
                if len(differences)<20:differences.append({"row":count,"reason":"CSV has an additional row"})
                continue
            for i,(actual,expected) in enumerate(zip(row,t["rows"][count-1])):
                kind=t["columnTypes"][i]
                if expected is None:
                    equal=actual=="" if kind in {"String","char"} else actual in {"","NaN"}
                    numeric_missing+=kind not in {"String","char"} and equal
                elif kind in {"String","char"}:equal=_decode_sv(actual)==expected
                else:
                    equal=actual==expected
                    if not equal and comparison_version=="decimal-v1" and NUMBER.fullmatch(actual):
                        # Compare exact decimal values while keeping both original spellings.
                        # JSON 36 and CSV 36.0 are the same provider value, without float rounding.
                        try:equal=Decimal(actual)==Decimal(expected)
                        except InvalidOperation:equal=False
                        numeric_equivalent_spellings+=int(equal)
                if not equal and len(differences)<20:
                    differences.append({"row":count,"column":names[i],"json":expected,"csv":actual})
        if count!=len(t["rows"]) and len(differences)<20:differences.append({"reason":"row counts differ"})
    except (StopIteration,csv.Error) as e:raise InputError("Incomplete original ERDDAP CSV") from e
    result={"status":"equivalent" if not differences else "different","jsonRows":len(t["rows"]),"csvRows":count,
            "numericMissingRepresentations":numeric_missing,"differences":differences}
    if comparison_version=="decimal-v1":result["numericEquivalentSpellings"]=numeric_equivalent_spellings
    return result

def validate_response_receipt(record,name,raw,expected_url,server):
    """Bind complete source bytes to the original request and observed transport."""
    if not isinstance(record,dict) or type(record.get("bytes"))is not int or record["bytes"]!=len(raw) or record.get("sha256")!=sha(raw) or record.get("url")!=expected_url:
        raise InputError("Original response identity or request differs: "+name)
    if "transport" not in record:
        if record.get("status")!=200:raise InputError("Original HTTP response was not successful: "+name)
        final=record.get("finalUrl",record["url"])
        if not isinstance(final,str) or urlsplit(final).scheme not in {"https","http"} or urlsplit(final).netloc!=urlsplit(server).netloc:
            raise InputError("Source response left the reviewed provider origin")
        return
    transport=record["transport"]
    time_fields={"startedAt","completedAt","observedAt","downloadStartedAt","downloadCompletedAt","downloadObservedAt"}
    fields={"kind","sourceUrl","upload","download"}|time_fields
    if not isinstance(transport,dict) or set(transport)!=fields or transport.get("kind")!="notion-public-https-import.v1" or transport.get("sourceUrl")!=expected_url or urlsplit(expected_url).scheme!="https":
        raise InputError("Unsupported or different original source import: "+name)
    if any(field in record for field in ("status","headers","finalUrl")):
        raise InputError("Native URL import does not report upstream HTTP status, headers or redirects: "+name)
    upload=transport["upload"];download=transport["download"]
    metadata_fields={"file_upload_id","filename","content_type","content_length"}
    if not isinstance(upload,dict) or set(upload)!=metadata_fields|{"status"} or upload.get("status")!="uploaded" or not isinstance(download,dict):
        raise InputError("Retain completed native upload and full download metadata: "+name)
    binary=download.get("method")=="signed-file"
    expected_download=metadata_fields|({"method","fileReference","carrierStatus","carrierContentType"}if binary else set())
    if set(download)!=expected_download or any(upload.get(field)!=download.get(field) for field in metadata_fields):
        raise InputError("Native download belongs to another uploaded source file: "+name)
    uuid=r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
    if not isinstance(upload["file_upload_id"],str) or not re.fullmatch(uuid,upload["file_upload_id"]):
        raise InputError("Retain the original native source upload identity: "+name)
    if type(upload["content_length"])is not int or upload["content_length"]!=len(raw):
        raise InputError("Native source differs from the original uploaded byte length: "+name)
    for field in ("filename","content_type"):
        value=upload[field]
        if not isinstance(value,str) or not value or len(value)>512 or re.search(r"[\x00-\x1f\x7f]",value):
            raise InputError("Retain the original native source file metadata: "+name)
    if binary:
        ref=download["fileReference"];content_type=download["carrierContentType"]
        if not isinstance(ref,str) or len(ref)>4096 or re.search(r"[\x00-\x20\x7f]",ref):
            raise InputError("Retain the stable original Notion file reference: "+name)
        try:u=urlsplit(ref)
        except ValueError as e:raise InputError("Invalid stable original Notion file reference: "+name)from e
        if u.scheme!="notion-file-block" or not re.fullmatch(uuid,u.netloc) or not re.fullmatch("/"+uuid,u.path) or u.fragment or download["carrierStatus"]!=200:
            raise InputError("Retain the successful original binary file download: "+name)
        if content_type is not None and (not isinstance(content_type,str) or len(content_type)>512 or re.search(r"[\x00-\x1f\x7f]",content_type)):
            raise InputError("Invalid binary carrier content type: "+name)
    else:
        try:raw.decode("utf-8",errors="strict")
        except UnicodeError as e:raise InputError("Native text download requires the original complete UTF-8 bytes: "+name)from e
    try:
        times={}
        for key in time_fields:
            value=transport[key]
            if value is None:times[key]=None;continue
            if not isinstance(value,str) or len(value)>64:raise ValueError("Invalid observed time")
            instant=datetime.datetime.fromisoformat(value.replace("Z","+00:00"))
            if instant.tzinfo is None or instant.utcoffset() is None:raise ValueError("Observed time requires its original timezone")
            times[key]=instant
        for start,end,observed in (("startedAt","completedAt","observedAt"),("downloadStartedAt","downloadCompletedAt","downloadObservedAt")):
            if times[end] is None and times[observed] is None:raise ValueError("Retain completion or its separately labeled observation time")
            if times[start] is not None and times[end] is not None and times[end]<times[start]:raise ValueError("Completion precedes the original request")
        if times["completedAt"] is not None and times["downloadStartedAt"] is not None and times["downloadStartedAt"]<times["completedAt"]:raise ValueError("Download precedes the completed source import")
    except (ValueError,OverflowError)as e:
        raise InputError("Retain observed source import/download times; unavailable timestamps remain null: "+name)from e

def read_capture(stream):
    try:
        with zipfile.ZipFile(stream) as z:
            infos=z.infolist()
            if len(infos)!=6 or {i.filename for i in infos}!=FILES|{"manifest.json"}:raise InputError("ERDDAP source must contain its manifest and five exact original response files")
            if sum(i.file_size for i in infos)>MAX_SOURCE:raise InputError("Complete uncompressed ERDDAP source exceeds its declared source budget")
            values={}
            for i in infos:
                if i.file_size>MAX_SOURCE or i.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED} or i.flag_bits&1 or i.is_dir() or stat.S_ISLNK(i.external_attr>>16):
                    raise InputError("Invalid ERDDAP source ZIP member")
                if i.filename=="manifest.json" and i.file_size>262144:raise InputError("Source manifest exceeds supported size")
                with z.open(i) as f:
                    b=f.read(MAX_SOURCE+1)
                if len(b)!=i.file_size or len(b)>MAX_SOURCE:raise InputError("Incomplete or excessive ERDDAP source")
                values[i.filename]=b
    except (zipfile.BadZipFile,OSError,EOFError) as e:raise InputError("Expected a complete ERDDAP source ZIP") from e
    m=json_value(values["manifest.json"])
    if not isinstance(m,dict) or m.get("schema")!=SCHEMA or m.get("canonicalData")!="data.json" or m.get("comparisonData")!="data.csv" or m.get("completeness")!="complete-response-for-explicit-selection" or set(m.get("files",{}))!=FILES:
        raise InputError("Invalid ERDDAP source manifest")
    server=server_url(m.get("server"));did=dataset_id(m.get("datasetId"));protocol=m.get("protocol")
    meta=metadata(values["metadata.json"],did,values["dataset.dds"])
    sel=selection(m.get("selection"),protocol,meta)
    expected_urls=urls(server,did,protocol,sel)
    if m.get("query")!=encode_query(sel,protocol):raise InputError("Source query is not the reviewed explicit selection")
    for n,r in m["files"].items():
        validate_response_receipt(r,n,values[n],expected_urls[n],server)
    t=table(values["data.json"]);expected=sel["variables"] if protocol=="tabledap" else [a["name"] for a in sel["axes"]]+sel["variables"]
    if t["columnNames"]!=expected:raise InputError("Original data columns differ from the selected variables or grid dimensions")
    return m,meta,t,values

def inventory(stream):
    m,meta,t,values=read_capture(stream);columns=[]
    by={v["name"]:v for v in meta["variables"]+meta["dimensions"]}
    for i,n in enumerate(t["columnNames"]):
        observed=[row[i] for row in t["rows"]];present=[v for v in observed if v is not None]
        samples=list(dict.fromkeys(present))[:5];nums=[Decimal(v) for v in present if isinstance(v,Number)]
        columns.append({"name":n,"type":t["columnTypes"][i],"units":t["columnUnits"][i],
          "metadata":by.get(n,{}),"missing":sum(v is None for v in observed),
          "emptyStrings":sum(v=="" for v in present),"samples":samples,
          "minimum":str(min(nums)) if nums else None,"maximum":str(max(nums)) if nums else None})
    return {"schema":"stellar-forge.erddap-inventory.v1","server":m["server"],"datasetId":m["datasetId"],"protocol":m["protocol"],
      "selection":m["selection"],"query":m["query"],"completeness":m["completeness"],
      "rowCount":len(t["rows"]),"metadata":meta,"columns":columns,"files":m["files"],
      "csvComparison":csv_comparison(values["data.csv"],t),
      "valuePolicy":"Original JSON number tokens and strings; null remains missing. No rescaling, unit conversion, interpolation or quality filtering."}

def validate_plan(raw):
    if not isinstance(raw,dict) or raw.get("schema")!=PLAN:raise InputError("Expected "+PLAN)
    allowed={"schema","server","datasetId","protocol","name","columns","filters","ranges","sorts","keys","defaultLimit","maxLimit","maxRows","maxBytes","maxCellChars","allowEmpty","csvPolicy"}
    if set(raw)-allowed:raise InputError("Unknown ERDDAP mapping fields")
    if raw.get("protocol") not in {"griddap","tabledap"}:raise InputError("Mapping protocol is required")
    columns=raw.get("columns")
    if not isinstance(columns,list):raise InputError("Mapping columns are required")
    converted=[];extras=[]
    for c in columns:
        if not isinstance(c,dict) or set(c)-{"source","name","type","nullable","encoding","sourceType","units"} or not isinstance(c.get("source"),str) or not NAME.fullmatch(c["source"]):
            raise InputError("Mapping column must name its exact original response field")
        if c.get("encoding","plain") not in {"plain","json"}:raise InputError("Choose plain lexical values or JSON-cell encoding")
        if c.get("sourceType") not in TYPES or c.get("units") is not None and not isinstance(c["units"],str):raise InputError("Retain the reviewed original type and units for every column")
        if c.get("encoding","plain")=="json" and (c.get("type","string")!="string" or c.get("nullable",False)):raise InputError("JSON-cell encoding requires a nonnullable string column")
        converted.append({"name":c.get("name"),"path":[],"type":c.get("type","string"),"nullable":c.get("nullable",False)})
        extras.append({"source":c["source"],"encoding":c.get("encoding","plain"),"sourceType":c["sourceType"],"units":c.get("units")})
    original={k:v for k,v in raw.items() if k not in {"server","datasetId","protocol","csvPolicy"}}
    original.update(schema="stellar-forge.xml-mapping.v1",recordPath=["row"],columns=converted)
    checked=xml_plan(original)
    result={k:v for k,v in checked.items() if k not in {"recordPath","columns"}}
    result.update(schema=PLAN,server=server_url(raw.get("server")),datasetId=dataset_id(raw.get("datasetId")),protocol=raw["protocol"],
      csvPolicy=raw.get("csvPolicy","require-equivalent"))
    if result["csvPolicy"]not in {"require-equivalent","canonical-json"}:raise InputError("Choose an explicit original JSON/CSV edition policy")
    result["columns"]=[{"name":c["name"],"type":c["type"],"nullable":c["nullable"],**e} for c,e in zip(checked["columns"],extras)]
    return result

def default_plan(shape,name=None):
    columns=[]
    for c in shape["columns"]:
        target=re.sub(r"[^A-Za-z0-9_]","_",c["name"])
        if not target or not target[0].isalpha():target="field_"+target
        target=target[:48]
        if any(x["name"]==target for x in columns):raise InputError("Provider names need explicit distinct native aliases")
        text=c["type"] in {"String","char"};json_cell=text and c["missing"]>0
        columns.append({"source":c["name"],"name":target,"type":"string","nullable":c["missing"]>0 and not json_cell,
          "encoding":"json" if json_cell else "plain","sourceType":c["type"],"units":c["units"]})
    desired=[a["name"] for a in shape["selection"]["axes"]] if shape["protocol"]=="griddap" else ["station","time"]
    keys=[c["name"] for v in desired for c in columns if c["source"]==v and not c["nullable"]]
    if len(keys)!=len(desired):keys=[]
    filters=[c["name"] for c in columns if c["source"] in {"station","time","latitude","longitude"}][:8]
    return validate_plan({"schema":PLAN,"server":shape["server"],"datasetId":shape["datasetId"],"protocol":shape["protocol"],
      "name":(name or shape["metadata"].get("title") or shape["datasetId"])[:128],
      "columns":columns,"keys":keys,"filters":filters,"ranges":[],"sorts":keys[:8],
      "maxRows":1000000,"maxBytes":MAX_SOURCE,"maxCellChars":65536,"defaultLimit":50,"maxLimit":1000,"allowEmpty":False,"csvPolicy":"require-equivalent"})

def extract(stream,plan,on_record,cancel=None):
    m,meta,t,values=read_capture(stream)
    if (m["server"],m["datasetId"],m["protocol"])!=(plan["server"],plan["datasetId"],plan["protocol"]):raise InputError("Mapping belongs to another original dataset/provider")
    if plan["csvPolicy"]=="require-equivalent" and csv_comparison(values["data.csv"],t)["status"]!="equivalent":
        raise InputError("Original JSON and CSV responses differ; inspect both editions or explicitly select canonical-json policy")
    slots=[]
    for c in plan["columns"]:
        if c["source"]not in t["columnNames"]:raise InputError("Mapped source column is missing")
        i=t["columnNames"].index(c["source"])
        if (t["columnTypes"][i],t["columnUnits"][i])!=(c["sourceType"],c["units"]):raise InputError("Original response type/units changed; review and save a new mapping")
        slots.append(i)
    for ordinal,row in enumerate(t["rows"],1):
        if cancel and cancel():raise InputError("Operation cancelled with original source retained")
        if ordinal>plan["maxRows"]:raise InputError("Complete response exceeds the selected native maxRows")
        cells=[];typed_values=[]
        for c,i in zip(plan["columns"],slots):
            v=row[i]
            if c["encoding"]=="json":
                cell=str(v) if isinstance(v,Number) else json.dumps(v,ensure_ascii=False,separators=(",",":"))
            elif v is None:
                if not c["nullable"]:raise InputError("Missing value requires nullable or JSON-cell mapping: "+c["name"])
                cell=""
            else:
                cell=str(v)
                if cell=="" and c["nullable"]:raise InputError("An empty source string differs from null; select JSON-cell encoding")
            if utf16_length(cell)>plan["maxCellChars"]:raise InputError("Projected cell exceeds maxCellChars")
            cells.append(cell);typed_values.append(typed(cell,c,"Row "+str(ordinal)+", "+c["name"]))
        on_record(ordinal,cells,typed_values)
    return len(t["rows"])

def dataset_spec(plan):return native_spec(plan)

def preview(stream,offset=0,limit=100):
    if type(offset)is not int or offset<0 or type(limit)is not int or not 1<=limit<=250:raise InputError("Invalid source row page")
    m,meta,t,values=read_capture(stream)
    return {"columns":[{"name":n,"type":t["columnTypes"][i],"units":t["columnUnits"][i]}for i,n in enumerate(t["columnNames"])],
      "rows":t["rows"][offset:offset+limit],"offset":offset,"nextOffset":offset+limit if offset+limit<len(t["rows"]) else None,
      "rowCount":len(t["rows"]),"representation":"Exact JSON number tokens are returned as strings alongside provider columnTypes."}
