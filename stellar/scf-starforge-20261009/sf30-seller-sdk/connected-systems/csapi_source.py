"""MIT. Retained OGC API Connected Systems JSON sources for the original SF30 engine.

Raw provider JSON is authoritative. Number tokens, array order, missing members,
nulls, quality flags, nil reasons, units and external result links are preserved.
This consumer does not issue commands to connected equipment.
"""
from __future__ import annotations
import hashlib, io, json, re, stat, sys, zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit

XML=Path(__file__).resolve().parent.parent/"xml"
if str(XML) not in sys.path: sys.path.insert(0,str(XML))
from xml_source import InputError, MAX_SOURCE, validate_plan as xml_plan, dataset_spec as native_spec, typed, utf16_length

SOURCE_SCHEMA="stellar-forge.connected-systems-source.v1"
PLAN_SCHEMA="stellar-forge.connected-systems-mapping.v1"
QUERY_SCHEMA="stellar-forge.connected-systems-query.v1"
MAX_PACKET=2*MAX_SOURCE
MAX_DOCUMENT=32*1024*1024
MAX_PAGES=4096
MAX_ROWS=1000000
MAX_FIELDS=512
HEX=re.compile(r"[0-9a-f]{64}\Z")
NUMBER=re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\Z")
ID=re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
SENSITIVE_QUERY={"access_token","token","api_key","apikey","key","signature","sig","password","secret","authorization"}
RECEIPT_HEADERS={"content-type","content-length","date","etag","last-modified","cache-control","vary","server","retry-after"}
SCHEMA_POLICY="canonical-json-lexical-v1"

class Number(str):
    """One original JSON numeric token, never a binary floating-point surrogate."""

_MISSING=object()

def sha(raw): return hashlib.sha256(raw).hexdigest()

def json_value(raw,lexical=False):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise InputError("Duplicate JSON member: "+key)
            result[key]=value
        return result
    def bad_constant(value):raise InputError("Nonstandard JSON numeric token: "+value)
    try:
        return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad_constant,
            **({"parse_int":Number,"parse_float":Number} if lexical else {}))
    except (ValueError,UnicodeError,TypeError,RecursionError) as error:
        if isinstance(error,InputError):raise
        raise InputError("Expected complete UTF-8 JSON") from error

def lexical_json(value,sort_keys=False,_depth=0):
    if _depth>64:raise InputError("JSON nesting exceeds 64 levels")
    if isinstance(value,Number):
        if not NUMBER.fullmatch(value):raise InputError("Invalid retained JSON number")
        return str(value)
    if value is None:return "null"
    if value is True:return "true"
    if value is False:return "false"
    if isinstance(value,str):return json.dumps(value,ensure_ascii=False)
    if isinstance(value,(int,float)):
        return json.dumps(value,allow_nan=False,separators=(",",":"))
    if isinstance(value,list):
        return "["+",".join(lexical_json(v,sort_keys,_depth+1) for v in value)+"]"
    if isinstance(value,dict):
        keys=sorted(value) if sort_keys else value.keys()
        if any(not isinstance(k,str) for k in keys):raise InputError("JSON object names must be strings")
        return "{"+",".join(json.dumps(k,ensure_ascii=False)+":"+lexical_json(value[k],sort_keys,_depth+1) for k in keys)+"}"
    raise InputError("Unsupported JSON value")

def jbytes(value):
    try:return (json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False)+"\n").encode("utf-8")
    except (ValueError,UnicodeError,TypeError,RecursionError) as error:raise InputError("Invalid JSON value") from error

def schema_sha(value):
    try:return sha(lexical_json(value,True).encode("utf-8"))
    except (ValueError,UnicodeError,RecursionError) as error:raise InputError("Invalid observation schema") from error

def text(value,label,maximum=2048,empty=False):
    if not isinstance(value,str) or (not value and not empty) or len(value)>maximum or re.search(r"[\x00-\x1f\x7f]",value):
        raise InputError(label+" must be printable text")
    return value

def integer(value,low,high,label):
    if type(value)is not int or not low<=value<=high:raise InputError(label+" is outside its supported integer range")
    return value

def exact(value,allowed,label,required=()):
    if not isinstance(value,dict) or set(value)-set(allowed) or set(required)-set(value):raise InputError("Invalid "+label+" fields")
    return value

def origin(value):
    u=urlsplit(value)
    try:port=u.port
    except ValueError as error:raise InputError("Invalid URL port") from error
    host=(u.hostname or "").lower()
    if ":" in host:host="["+host+"]"
    if port and port!=(443 if u.scheme=="https" else 80):host+=":"+str(port)
    return u.scheme.lower()+"://"+host

def url(value,base=None,allowed_origins=None,query=True):
    value=text(value,"Resource URL",8192)
    if any(c in value for c in "\\ \t\r\n"):raise InputError("Resource URL contains whitespace or a backslash")
    value=urljoin(base,value) if base else value
    try:u=urlsplit(value)
    except ValueError as error:raise InputError("Invalid resource URL") from error
    if u.scheme not in {"https","http"} or not u.hostname or u.username is not None or u.password is not None or u.fragment:
        raise InputError("Use an HTTP(S) URL without credentials or fragment")
    if u.scheme=="http" and u.hostname not in {"localhost","127.0.0.1","::1"}:
        raise InputError("Remote Connected Systems sources require HTTPS")
    origin(value)
    if not query and u.query:raise InputError("Base URLs cannot contain a query")
    if any(name.lower() in SENSITIVE_QUERY for name,_ in parse_qsl(u.query,keep_blank_values=True)):
        raise InputError("Authentication belongs in the selected host environment, not source URLs")
    if allowed_origins is not None and origin(value) not in set(allowed_origins):
        raise InputError("Linked resource belongs to an origin not approved in this connection")
    return value

def base_url(value):
    value=url(value,query=False)
    u=urlsplit(value)
    if any(part in {".",".."} for part in u.path.split("/")):raise InputError("Invalid endpoint base path")
    return urlunsplit((u.scheme,u.netloc,u.path.rstrip("/")+"/","",""))

def origin_list(base,values):
    if not isinstance(values,list) or len(values)>16:raise InputError("Choose at most 16 explicit public linked origins")
    result=[]
    for value in [origin(base),*values]:
        checked=url(value)
        u=urlsplit(checked)
        if u.path not in {"","/"} or u.query:raise InputError("Allowed origins must not contain resource paths")
        normalized=origin(checked)
        if normalized not in result:result.append(normalized)
    return result

def parameters(value):
    if value is None:return []
    if not isinstance(value,list) or len(value)>32:raise InputError("Query parameters must be an ordered list of at most 32 name/value pairs")
    result=[]
    for pair in value:
        exact(pair,{"name","value"},"query parameter",{"name","value"})
        name=text(pair["name"],"Parameter name",128);val=text(pair["value"],"Parameter value",4096,True)
        if name.lower() in SENSITIVE_QUERY:raise InputError("Credentials cannot be retained as query parameters")
        result.append({"name":name,"value":val})
    return result

def query_url(resource,params):
    values=parameters(params)
    if not values:return resource
    u=urlsplit(resource)
    added=urlencode([(v["name"],v["value"]) for v in values],quote_via=quote,safe="")
    return urlunsplit((u.scheme,u.netloc,u.path,u.query+("&" if u.query else "")+added,""))

def pointer(value):
    text(value,"JSON pointer",4096,True)
    if value=="" :return value
    if not value.startswith("/") or re.search(r"~(?![01])",value):raise InputError("Use an exact RFC6901 JSON pointer")
    if len(value.split("/"))>65:raise InputError("JSON pointer exceeds supported depth")
    return value

def pointer_token(value):return value.replace("~","~0").replace("/","~1")

def resolve(value,path):
    pointer(path)
    if path=="":return value
    for token in path[1:].split("/"):
        token=token.replace("~1","/").replace("~0","~")
        if isinstance(value,dict):
            if token not in value:return _MISSING
            value=value[token]
        elif isinstance(value,list):
            if not re.fullmatch(r"0|[1-9][0-9]*",token):return _MISSING
            index=int(token)
            if index>=len(value):return _MISSING
            value=value[index]
        else:return _MISSING
    return value

def next_link(document,request_url,allowed_origins):
    if not isinstance(document,dict):raise InputError("Provider JSON must be an object")
    links=document.get("links",[])
    if not isinstance(links,list) or len(links)>4096:raise InputError("Invalid provider links")
    next_urls=[]
    for link in links:
        if not isinstance(link,dict):raise InputError("Invalid provider link")
        if link.get("rel") in {"next","http://www.iana.org/assignments/relation/next"}:
            value=url(link.get("href"),request_url,allowed_origins)
            if value not in next_urls:next_urls.append(value)
    if len(next_urls)>1:raise InputError("Provider returned different next-page links")
    return next_urls[0] if next_urls else None

def collection(document):
    if not isinstance(document,dict):raise InputError("Expected a complete resource collection")
    key="features" if isinstance(document.get("features"),list) else "items"
    if not isinstance(document.get(key),list):raise InputError("Expected provider items or GeoJSON features")
    return document[key]

def observation_items(document,resource="collection"):
    """Select original objects without manufacturing a collection representation."""
    if resource=="single":
        if not isinstance(document,dict):raise InputError("Expected one original observation object")
        return [document]
    if resource!="collection":raise InputError("Unsupported observation resource selection")
    if not isinstance(document,dict) or not isinstance(document.get("items"),list):
        raise InputError("Expected an observation items collection")
    rows=document["items"]
    if "numberReturned" in document and str(document["numberReturned"])!=str(len(rows)):
        raise InputError("Provider numberReturned differs from its complete page")
    return rows

def observation(value,datastream_id):
    if not isinstance(value,dict):raise InputError("An observation must be a JSON object")
    for field in ("id","datastream@id","resultTime"):
        if not isinstance(value.get(field),str) or isinstance(value.get(field),Number) or not value[field]:
            raise InputError("Observation lacks its literal "+field)
    if value["datastream@id"]!=datastream_id:raise InputError("Observation belongs to a different datastream")
    if ("result" in value)==("result@link" in value):raise InputError("Observation must carry either its inline result or its external result link")
    if "result@link" in value:
        link=value["result@link"]
        if not isinstance(link,dict) or not isinstance(link.get("href"),str) or isinstance(link.get("href"),Number) or not link["href"]:raise InputError("Invalid external observation result link")
    if "phenomenonTime" in value and (not isinstance(value["phenomenonTime"],str) or isinstance(value["phenomenonTime"],Number) or not value["phenomenonTime"]):
        raise InputError("Observation phenomenonTime must retain its original string")
    if "parameters" in value and not isinstance(value["parameters"],dict):raise InputError("Observation parameters must be an object")
    lexical_json(value)
    return value

def _filename(name):
    if not isinstance(name,str) or not name or len(name)>200 or "\\" in name:raise InputError("Invalid source member name")
    p=PurePosixPath(name)
    if str(p)!=name or p.is_absolute() or any(v in {".",".."} for v in p.parts):raise InputError("Invalid source member path")
    return name

def receipt(entry,body,name,allowed):
    if not isinstance(entry,dict):raise InputError("Missing original response receipt: "+name)
    if type(entry.get("bytes"))is not int or entry["bytes"]!=len(body) or entry.get("sha256")!=sha(body):
        raise InputError("Retained response differs from its original bytes: "+name)
    if entry.get("status")!=200:raise InputError("Source publication requires successful original responses: "+name)
    for field in ("requestUrl","finalUrl"):url(entry.get(field),allowed_origins=allowed)
    headers=entry.get("headers")
    if not isinstance(headers,dict) or set(headers)-RECEIPT_HEADERS:raise InputError("Response headers must use the documented nonsecret allowlist")
    if any(not isinstance(v,str) or len(v)>8192 or "\r" in v or "\n" in v for v in headers.values()):raise InputError("Invalid retained response header")
    for field in ("startedAt","completedAt"):
        if not isinstance(entry.get(field),(str,int,float)) or isinstance(entry.get(field),bool):raise InputError("Retain actual response timestamps")

class Capture:
    """Read a complete retained ZIP; hash each member and parse one page at a time."""
    def __init__(self,stream):
        try:self.archive=zipfile.ZipFile(stream)
        except (zipfile.BadZipFile,OSError) as error:raise InputError("Expected a Connected Systems source ZIP") from error
        try:
            infos=self.archive.infolist()
            if not 4<=len(infos)<=MAX_PAGES+32 or len({i.filename for i in infos})!=len(infos):
                raise InputError("Source member count or names are invalid")
            if sum(i.file_size for i in infos)>MAX_SOURCE:raise InputError("Uncompressed source exceeds 256 MiB")
            self.infos={}
            for info in infos:
                _filename(info.filename)
                if info.is_dir() or stat.S_ISLNK(info.external_attr>>16) or info.flag_bits&1 or info.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED}:
                    raise InputError("Invalid source ZIP member")
                if info.file_size>MAX_DOCUMENT:raise InputError("One source document exceeds 32 MiB")
                self.infos[info.filename]=info
            if "manifest.json" not in self.infos or self.infos["manifest.json"].file_size>1024*1024:
                raise InputError("Source manifest is missing or excessive")
            self.manifest=json_value(self.read("manifest.json"))
            m=self.manifest
            required={"schema","endpoint","allowedOrigins","selection","resources","pages","coverage","files","rights"}
            exact(m,required,"source manifest",required)
            if m["schema"]!=SOURCE_SCHEMA:raise InputError("Unsupported Connected Systems source schema")
            self.endpoint=base_url(m["endpoint"]);self.allowed=origin_list(self.endpoint,m["allowedOrigins"])
            files=m["files"]
            if not isinstance(files,dict) or set(files)!=set(self.infos)-{"manifest.json"}:raise InputError("Manifest must identify every original response")
            for name,entry in files.items():receipt(entry,self.read(name),name,self.allowed)
            resources=m["resources"]
            exact(resources,{"datastream","schema","schemaAfter","system","landing","conformance"},"source resources",{"datastream","schema","schemaAfter"})
            if any(not isinstance(name,str) or name not in files for name in resources.values()):raise InputError("Resource references an absent response")
            self.datastream=json_value(self.read(resources["datastream"]),True)
            self.schema=json_value(self.read(resources["schema"]),True)
            schema_after=json_value(self.read(resources["schemaAfter"]),True)
            if not isinstance(self.datastream,dict) or not isinstance(self.datastream.get("id"),str) or isinstance(self.datastream.get("id"),Number):
                raise InputError("Datastream must retain its literal source ID")
            self.datastream_id=text(self.datastream["id"],"Datastream ID",2048)
            if not isinstance(self.schema,dict):raise InputError("Observation schema must be a JSON object")
            self.schema_id=schema_sha(self.schema)
            if schema_sha(schema_after)!=self.schema_id:raise InputError("Observation schema changed during this acquisition")
            if self.schema.get("obsFormat","application/json")!="application/json":raise InputError("This mapping consumes original application/json observations")
            self.system=json_value(self.read(resources["system"]),True) if "system" in resources else None
            self.conformance=json_value(self.read(resources["conformance"])) if "conformance" in resources else None
            selection=m["selection"]
            exact(selection,{"datastreamUrl","schemaUrl","observationsUrl","systemUrl","params","obsFormat","limits","observationResource","schemaUrlPolicy"},"source selection",
                {"datastreamUrl","schemaUrl","observationsUrl","systemUrl","params","obsFormat","limits"})
            for field in ("datastreamUrl","schemaUrl","observationsUrl"):
                url(selection[field],allowed_origins=self.allowed)
            if selection["systemUrl"]is not None:url(selection["systemUrl"],allowed_origins=self.allowed)
            if selection["obsFormat"]!="application/json":raise InputError("Unsupported selected observation representation")
            parameters(selection["params"])
            if selection.get("schemaUrlPolicy","format-parameter") not in ("format-parameter","exact"):
                raise InputError("Unsupported selected schema URL policy")
            self.observation_resource=selection.get("observationResource","collection")
            if self.observation_resource not in ("collection","single"):raise InputError("Unsupported observation resource selection")
            limits=selection["limits"];exact(limits,{"maxPages","maxRows","maxBytes"},"acquisition limits",{"maxPages","maxRows","maxBytes"})
            integer(limits["maxPages"],1,MAX_PAGES,"maxPages");integer(limits["maxRows"],1,MAX_ROWS,"maxRows")
            integer(limits["maxBytes"],1024,MAX_SOURCE-2*1024*1024,"maxBytes")
            for role,field in (("datastream","datastreamUrl"),("schema","schemaUrl"),("schemaAfter","schemaUrl"),("system","systemUrl")):
                if role in resources and files[resources[role]]["requestUrl"]!=selection[field]:raise InputError("Retained metadata belongs to another selection")
            pages=m["pages"]
            if not isinstance(pages,list) or not pages or len(pages)>limits["maxPages"]:raise InputError("Acquisition must retain at least one complete observation page")
            if self.observation_resource=="single" and (len(pages)!=1 or limits["maxPages"]!=1):
                raise InputError("A single observation resource must retain exactly one original response")
            if any(not isinstance(page,str) or page not in files for page in pages) or len(set(pages))!=len(pages):
                raise InputError("Original observation page list is invalid")
            if set(files)!=set(resources.values())|set(pages):raise InputError("Unaccounted source response")
            if set(resources.values())&set(pages):raise InputError("Metadata and observation pages need separate identities")
            if files[pages[0]]["requestUrl"]!=query_url(selection["observationsUrl"],selection["params"]):
                raise InputError("First observation request differs from the selected query")
            exact(m["rights"],{"license","attribution","usage","sourceUrl"},"source rights")
            for key,val in m["rights"].items():
                if val is not None:text(val,"Rights "+key,8192,True)
            self._validated=False
        except Exception:
            self.archive.close();raise
    def __enter__(self):return self
    def __exit__(self,*_):self.archive.close()
    def read(self,name):
        if name not in self.infos:raise InputError("Unknown original source member")
        try:
            with self.archive.open(self.infos[name]) as stream:body=stream.read(MAX_DOCUMENT+1)
        except (zipfile.BadZipFile,RuntimeError,EOFError,OSError) as error:raise InputError("Invalid retained ZIP content") from error
        if len(body)!=self.infos[name].file_size or len(body)>MAX_DOCUMENT:raise InputError("Incomplete or excessive retained response")
        return body
    def records(self):
        m=self.manifest;files=m["files"];count=0;next_url=None;seen_urls=set()
        for page_number,name in enumerate(m["pages"],1):
            entry=files[name];request=entry["requestUrl"]
            if request in seen_urls:raise InputError("Repeated observation page URL")
            seen_urls.add(request)
            if page_number>1 and request!=next_url:raise InputError("Observation pages do not follow the original next link")
            document=json_value(self.read(name),True)
            rows=observation_items(document,self.observation_resource)
            next_url=next_link(document,entry["finalUrl"],self.allowed)
            if self.observation_resource=="single" and next_url is not None:
                raise InputError("A single observation resource cannot imply an unreceived next page")
            for index,row in enumerate(rows):
                count+=1
                if count>m["selection"]["limits"]["maxRows"]:raise InputError("Complete source exceeds its selected maxRows")
                yield {"ordinal":count,"page":page_number,"index":index,"observation":observation(row,self.datastream_id)}
        covered=m["coverage"]
        expected={"status":"exhausted" if next_url is None else "page-limit","pages":len(m["pages"]),"observations":count,
            "nextUrl":next_url,"consistency":"sequential-pages-not-transactional-snapshot"}
        if self.observation_resource=="single":expected["scope"]="single-observation-resource"
        if next_url is not None and len(m["pages"])!=m["selection"]["limits"]["maxPages"]:
            raise InputError("A partial source must identify the actual selected page bound")
        if covered!=expected:raise InputError("Coverage differs from the retained response chain")
        response_bytes=sum(v["bytes"] for v in files.values())
        if response_bytes>m["selection"]["limits"]["maxBytes"]:raise InputError("Complete source exceeds its selected maxBytes")
        self._validated=True
    def validate(self):
        for _ in self.records():pass
        return self

def read_capture(stream):
    with Capture(stream) as capture:
        capture.validate()
        return {"manifest":capture.manifest,"datastream":capture.datastream,"system":capture.system,
            "observationSchema":capture.schema,"schemaSha256":capture.schema_id}

def schema_fields(schema):
    """Inspect native SWE Common components or a returned JSON Schema, without fetching references."""
    output=[]
    def walk(node,path,depth=0,frame=None):
        if depth>32 or len(output)>=MAX_FIELDS:return
        if not isinstance(node,dict):return
        kind=node.get("type")
        unit=node.get("uom")
        if unit is None and ("@swe.uomCode" in node or "@swe.uomHref" in node):
            unit={k:node[v] for k,v in (("code","@swe.uomCode"),("href","@swe.uomHref")) if v in node}
        own_frame=node.get("referenceFrame",frame)
        record={"pointer":path,"name":node.get("name") or (path.rsplit("/",1)[-1] if path else "observation"),
            "label":node.get("label",node.get("title")),"type":kind,"units":unit,
            "definition":node.get("definition",node.get("@swe.definition")),"referenceFrame":own_frame,"schema":node}
        output.append(record)
        if isinstance(kind,str) and kind in {"DataRecord","Vector"}:
            fields=node.get("fields") if kind=="DataRecord" else node.get("coordinates")
            if isinstance(fields,list):
                for field in fields:
                    if isinstance(field,dict) and isinstance(field.get("name"),str):
                        walk(field,path+"/"+pointer_token(field["name"]),depth+1,own_frame)
        elif isinstance(node.get("properties"),dict):
            for name,field in node["properties"].items():walk(field,path+"/"+pointer_token(name),depth+1,own_frame)
    if isinstance(schema.get("resultSchema"),dict):
        walk(schema["resultSchema"],"/result")
        if isinstance(schema.get("parametersSchema"),dict):walk(schema["parametersSchema"],"/parameters")
    elif isinstance(schema.get("properties"),dict):walk(schema,"")
    return output

def _kind(value):
    if value is _MISSING:return "missing"
    if isinstance(value,Number):return "number"
    if value is None:return "null"
    if isinstance(value,bool):return "boolean"
    if isinstance(value,str):return "string"
    if isinstance(value,list):return "array"
    return "object"

def inventory(stream):
    with Capture(stream) as capture:
        declared=schema_fields(capture.schema)
        fields={v["pointer"]:{**v,"kinds":[],"present":0,"nulls":0,"samples":[]} for v in declared}
        id_values={};duplicate_count=0;conflicting=0;examples=[];count=0;omitted=0
        def inspect(value,path=""):
            nonlocal omitted
            if path not in fields:
                if len(fields)>=MAX_FIELDS:
                    omitted+=1;return
                fields[path]={"pointer":path,"name":path.rsplit("/",1)[-1] or "observation","label":None,"type":None,
                    "units":None,"definition":None,"referenceFrame":None,"schema":None,"kinds":[],"present":0,"nulls":0,"samples":[]}
            row=fields[path];row["present"]+=1
            kind=_kind(value)
            if kind not in row["kinds"]:row["kinds"].append(kind)
            row["nulls"]+=value is None
            sample=lexical_json(value)
            if len(row["samples"])<3 and len(sample)<=240 and sample not in row["samples"]:row["samples"].append(sample)
            if isinstance(value,dict):
                for key,val in value.items():inspect(val,path+"/"+pointer_token(key))
        for record in capture.records():
            count=record["ordinal"];obs=record["observation"];inspect(obs)
            key=obs["id"];identity=sha(lexical_json(obs,True).encode())
            if key in id_values:
                duplicate_count+=1
                different=id_values[key]!=identity
                conflicting+=different
                if len(examples)<20:examples.append({"id":key,"ordinal":count,"conflicting":different})
            else:id_values[key]=identity
        for field in fields.values():field["missing"]=count-field["present"]
        m=capture.manifest
        return {"schema":"stellar-forge.connected-systems-inventory.v1","endpoint":capture.endpoint,
            "datastream":capture.datastream,"system":capture.system,"observationSchema":capture.schema,
            "schemaSha256":capture.schema_id,"schemaIdentityPolicy":SCHEMA_POLICY,"conformance":capture.conformance,
            "coverage":m["coverage"],"rowCount":count,"fields":list(fields.values()),"unlistedPathOccurrences":omitted,
            "duplicates":{"repeatedOccurrences":duplicate_count,"conflictingOccurrences":conflicting,"examples":examples,
                "policy":"retain every original observation in original page order"},
            "files":m["files"],"resources":m["resources"],"selection":m["selection"],"rights":m["rights"],
            "valuePolicy":"Original JSON numbers remain lexical tokens. No rescaling, unit conversion, interpolation, quality filtering, time fallback or observation deduplication."}

def validate_plan(raw):
    allowed={"schema","endpoint","datastreamId","schemaSha256","name","columns","keys","filters","ranges","sorts",
        "defaultLimit","maxLimit","maxRows","maxBytes","maxCellChars","allowEmpty","coveragePolicy"}
    exact(raw,allowed,"Connected Systems mapping",{"schema","endpoint","datastreamId","schemaSha256","name","columns"})
    if raw["schema"]!=PLAN_SCHEMA:raise InputError("Expected "+PLAN_SCHEMA)
    if not isinstance(raw["schemaSha256"],str) or not HEX.fullmatch(raw["schemaSha256"]):raise InputError("Mapping must bind the reviewed original observation schema")
    cols=raw["columns"]
    if not isinstance(cols,list):raise InputError("Mapping columns must be a list")
    converted=[];extras=[]
    for col in cols:
        exact(col,{"name","source","pointer","type","nullable","encoding"},"column",{"name","source","type","nullable","encoding"})
        kind=col["source"]
        if not isinstance(kind,str) or kind not in {"observation","ordinal","page","index"}:raise InputError("Unknown original record selector")
        path=pointer(col.get("pointer",""))
        if kind!="observation" and path!="":raise InputError("Only observation columns have JSON pointers")
        encoding=col["encoding"]
        if not isinstance(encoding,str) or encoding not in {"plain","json","presence-json"}:raise InputError("Choose an explicit original value encoding")
        if encoding!="plain" and (col["type"]!="string" or col["nullable"]is not False):
            raise InputError("JSON cell encodings require nonnullable native string columns")
        converted.append({"name":col["name"],"path":[],"type":col["type"],"nullable":col["nullable"]})
        extras.append({"source":kind,"pointer":path,"encoding":encoding})
    original={k:v for k,v in raw.items() if k not in {"endpoint","datastreamId","schemaSha256","coveragePolicy"}}
    original.update(schema="stellar-forge.xml-mapping.v1",recordPath=["observation"],columns=converted)
    checked=xml_plan(original)
    result={k:v for k,v in checked.items() if k not in {"schema","recordPath","columns"}}
    coverage=raw.get("coveragePolicy","require-exhausted")
    if not isinstance(coverage,str) or coverage not in {"require-exhausted","allow-partial"}:raise InputError("Choose an explicit acquisition coverage policy")
    result.update(schema=PLAN_SCHEMA,endpoint=base_url(raw["endpoint"]),datastreamId=text(raw["datastreamId"],"Datastream ID",2048),
        schemaSha256=raw["schemaSha256"],coveragePolicy=coverage,
        columns=[{"name":c["name"],"type":c["type"],"nullable":c["nullable"],**extra} for c,extra in zip(checked["columns"],extras)])
    return result

def default_plan(shape,name=None):
    columns=[];used=set()
    by={v["pointer"]:v for v in shape["fields"]}
    def add(alias,path,encoding="plain"):
        if alias in used or len(columns)>=64:return
        used.add(alias);columns.append({"name":alias,"source":"observation","pointer":path,"type":"string","nullable":False,"encoding":encoding})
    add("observation_id","/id");add("datastream_id","/datastream@id");add("result_time","/resultTime")
    add("phenomenon_time","/phenomenonTime","presence-json")
    add("sampling_feature","/samplingFeature@id","presence-json")
    add("parameters","/parameters","presence-json")
    add("result","/result","presence-json");add("original_observation","","json")
    for field in shape["fields"]:
        path=field["pointer"]
        if not path.startswith("/result/") or set(field["kinds"])&{"object","array"}:continue
        alias=re.sub(r"[^A-Za-z0-9_]","_",path.strip("/").replace("/","_"))[:48]
        if not alias or not alias[0].isalpha():alias="field_"+alias
        root_alias=alias;number=2
        while alias in used:alias=(root_alias[:42]+"_"+str(number));number+=1
        add(alias,path,"presence-json" if field["missing"] or field["nulls"] else "plain")
    keys=["observation_id"] if not shape["duplicates"]["repeatedOccurrences"] and shape["rowCount"] else []
    title=name or shape["datastream"].get("name") or shape["datastream"]["id"]
    return validate_plan({"schema":PLAN_SCHEMA,"endpoint":shape["endpoint"],"datastreamId":shape["datastream"]["id"],
        "schemaSha256":shape["schemaSha256"],"name":str(title)[:128],"columns":columns,"keys":keys,
        "filters":["observation_id","datastream_id"],"ranges":[],"sorts":["result_time"],"defaultLimit":50,"maxLimit":1000,
        "maxRows":MAX_ROWS,"maxBytes":MAX_SOURCE,"maxCellChars":1048576,"allowEmpty":False,"coveragePolicy":"require-exhausted"})

def extract(stream,plan,on_record,cancel=None):
    plan=validate_plan(plan)
    with Capture(stream) as capture:
        if (capture.endpoint,capture.datastream_id,capture.schema_id)!=(plan["endpoint"],plan["datastreamId"],plan["schemaSha256"]):
            raise InputError("Mapping belongs to another endpoint, datastream or observation schema")
        if plan["coveragePolicy"]=="require-exhausted" and capture.manifest["coverage"].get("status")!="exhausted":
            raise InputError("This source stopped at its selected page bound; review coverage and explicitly allow-partial")
        count=0
        for record in capture.records():
            if cancel and cancel():raise InputError("Operation cancelled with original source retained")
            count=record["ordinal"]
            if count>plan["maxRows"]:raise InputError("Complete source exceeds mapping maxRows")
            cells=[];values=[]
            for col in plan["columns"]:
                value=resolve(record["observation"],col["pointer"]) if col["source"]=="observation" else Number(str(record[col["source"]]))
                encoding=col["encoding"]
                if encoding=="presence-json":
                    cell=lexical_json({"present":False} if value is _MISSING else {"present":True,"value":value})
                elif encoding=="json":
                    if value is _MISSING:raise InputError("Missing JSON member requires presence-json: "+col["name"])
                    cell=lexical_json(value)
                elif value is _MISSING or value is None:
                    if not col["nullable"]:raise InputError("Missing/null field requires an explicit nullable or presence-json mapping: "+col["name"])
                    cell=""
                elif isinstance(value,(dict,list)):raise InputError("Structured result requires a JSON cell encoding: "+col["name"])
                else:
                    cell=("true" if value else "false") if isinstance(value,bool) else str(value)
                    if cell=="" and col["nullable"]:raise InputError("An empty string differs from missing/null; select presence-json: "+col["name"])
                if utf16_length(cell)>plan["maxCellChars"]:raise InputError("Original observation cell exceeds the selected maxCellChars")
                cells.append(cell);values.append(typed(cell,col,"Observation "+str(count)+", "+col["name"]))
            on_record(count,cells,values)
        return count

def dataset_spec(plan):return native_spec(plan)

def preview(stream,offset=0,limit=100):
    integer(offset,0,MAX_ROWS,"offset");integer(limit,1,250,"limit")
    rows=[];count=0
    with Capture(stream) as capture:
        for row in capture.records():
            count=row["ordinal"]
            if offset<count<=offset+limit:rows.append(row)
        return {"rows":rows,"offset":offset,"nextOffset":offset+len(rows) if offset+len(rows)<count else None,"rowCount":count,
            "representation":"Original JSON number tokens are shown as strings; original schema, field kinds and raw response bytes remain available."}

def write_capture(manifest,files,destination):
    """Deterministic, bounded source carrier. Caller retains original HTTP documents."""
    if set(files)!=set(manifest.get("files",{})):raise InputError("Capture files differ from the complete manifest")
    with zipfile.ZipFile(destination,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name in sorted({"manifest.json",*files}):
            info=zipfile.ZipInfo(name,(2000,1,1,0,0,0));info.create_system=3;info.external_attr=0o100600<<16
            info.compress_type=zipfile.ZIP_DEFLATED
            value=jbytes(manifest) if name=="manifest.json" else files[name]
            with archive.open(info,"w") as out:
                if isinstance(value,(bytes,bytearray)):out.write(value)
                else:
                    with Path(value).open("rb") as stream:
                        while block:=stream.read(65536):out.write(block)
