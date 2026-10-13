"""Capture complete selected original forms assets through documented GETs or local custody.

No field mapping, vendor import, workflow extraction inference, mutation or account setup.
All original outputs are private case data; the collector itself is generic software.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

SCHEMA = "tjlabs.forms-capture.selection.v1"
CAPTURE = "tjlabs.forms-capture.v1"
SOFTWARE = ("forms_capture.py","FORMS_CAPTURE.md","FORMS_CAPTURE_API.json","LICENSE")
CLASSES = ("definitions","settings","responses","uploads","workflow","downstream")
API_SOURCE = "https://github.com/FormAssembly/formassembly-api"
API_BLOB = "45c1369e687e0e9f73ec919accb3a521379b8316"
ROUTES = {
    "forms_index": ("api_v1/forms/index.{format}",("json","xml"),False),
    "admin_forms_index": ("admin/api_v1/forms/index.{format}",("json","xml"),False),
    "form_definition": ("api_v1/forms/view/{id}.{format}",("json","xml"),True),
    "responses_export": ("api_v1/responses/export/{id}.{format}",("csv","json","xml","zip"),True),
    "connectors_index": ("api_v1/connectors/index/{id}.{format}",("json","xml"),True),
    "connector_definition": ("admin/api_v1/connectors/view/{id}.{format}",("json","xml"),True),
    "themes_index": ("api_v1/themes/index.{format}",("json",),False),
    "theme_definition": ("admin/api_v1/themes/view/{id}.{format}",("json",),True),
    "form_elements_index": ("api_v1/form_elements/index.{format}",("xml",),False),
    "form_element_definition": ("admin/api_v1/form_elements/view/{id}.{format}",("xml",),True),
}
DEFAULT_LIMITS = {"max_body_bytes":536870912,"max_archive_members":100000,
                  "max_expanded_bytes":4294967296,"timeout_seconds":120}
SAFE_HEADERS = ("content-type","content-length","content-encoding","etag","last-modified",
                "date","retry-after","x-request-id","x-correlation-id")

class CaptureError(Exception):
    pass

def require(value,message):
    if not value:
        raise CaptureError(message)

def now():
    return datetime.now(timezone.utc).isoformat()

def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n").encode("utf-8")

def parse(data):
    def pairs(items):
        result = {}
        for k,v in items:
            require(k not in result,"Repeated JSON key")
            result[k] = v
        return result
    return json.loads(data.decode("utf-8"),object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(CaptureError("Nonfinite JSON value")))

def read(path):
    return parse(Path(path).read_bytes())

def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):
            h.update(block)
    return h.hexdigest()

def measure(path):
    p = Path(path)
    return {"bytes":p.stat().st_size,"sha256":digest(p)}

def safe_id(value):
    return isinstance(value,str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,47}",value)

def relpath(value):
    require(isinstance(value,str) and value and "\\" not in value and "\0" not in value,
            "A complete ordinary relative source path is required")
    path = PurePosixPath(value)
    require(not path.is_absolute() and not any(p in ("",".","..") for p in value.split("/")) and
            not re.match(r"^[A-Za-z]:",value),"Source path leaves its selected root")
    return path

def selected_path(root,relative):
    path = root.joinpath(*relpath(relative).parts)
    current = root
    for part in relpath(relative).parts:
        current = current / part
        require(not current.is_symlink(),"Symbolic links are not selected original members")
    require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()),
            "Selected original file is unavailable or outside its root")
    return path

def atomic_bytes(path,body,replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp = tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            require(not path.is_symlink(),"Ordinary retained receipt required")
            os.replace(temp,path)
        else:
            os.link(temp,path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

def atomic(path,value,replace=False):
    atomic_bytes(path,json_bytes(value),replace)

def copy_complete(stream,path,limit,expected=None):
    path = Path(path)
    h,total = hashlib.sha256(),0
    with path.open("xb") as out:
        while True:
            block = stream.read(1024*1024)
            if not block:
                break
            total += len(block)
            require(total<=limit,"Selected complete body exceeds its explicit capture limit")
            out.write(block)
            h.update(block)
        out.flush()
        os.fsync(out.fileno())
    identity = {"bytes":total,"sha256":h.hexdigest()}
    if expected is not None:
        require(identity=={k:expected[k] for k in ("bytes","sha256")},"Original full source bytes differ")
    return identity

def validate_asset(a):
    require(isinstance(a,dict) and safe_id(a.get("id")),"Original asset ID must be a safe unique identifier")
    require(a.get("asset_class") in CLASSES and a.get("side") in ("source","target","shared"),
            "Select an exact original class and side")
    require(a.get("availability") in ("PRESENT","MISSING","REDACTED"),"Explicit body availability required")
    require(a.get("content_state","UNASSESSED") in ("COMPLETE","PARTIAL","REDACTED","UNASSESSED"),
            "Explicit content coverage state is invalid")
    require(isinstance(a.get("provenance"),str) and a["provenance"].strip(),"Original provenance required")
    for key in ("filename","media_type"):
        require(isinstance(a.get(key),str) and a[key],"Original filename and media type required")
    if a["availability"]=="PRESENT":
        relpath(a.get("path"))
        require(type(a.get("bytes")) is int and a["bytes"]>=0 and
                isinstance(a.get("sha256"),str) and re.fullmatch(r"[0-9a-f]{64}",a["sha256"]),
                "Every present original needs exact bytes and SHA256")
    else:
        require(a.get("path") is None and a.get("bytes") is None and a.get("sha256") is None,
                "Unavailable bodies must not invent paths or byte identities")

def tenant_origin(value):
    u = urllib.parse.urlsplit(value)
    require(u.scheme=="https" and u.hostname and not u.username and not u.password and
            u.path in ("","/") and not u.query and not u.fragment,
            "Select the exact authorized HTTPS tenant origin, without credentials or a path")
    require(u.port in (None,443),"The documented tenant uses HTTPS port443")
    return "https://"+u.netloc.rstrip("/")

def request_route(item):
    require(item.get("route") in ROUTES,"Only documented read-only routes are supported")
    template,formats,needs_id = ROUTES[item["route"]]
    require(item.get("format") in formats,"Selected format is not documented for this route")
    identity = item.get("object_id")
    require(not needs_id or isinstance(identity,str) and re.fullmatch(r"[0-9]+",identity),
            "The documented route requires its explicit numeric original ID")
    params = item.get("params",{})
    require(isinstance(params,dict),"Explicit request parameters must be an object")
    query = {}
    if item["route"]=="responses_export":
        require(set(params)<=set(("date_from","date_to","filter","response_ids","flag","unlock","page","page_size")),
                "An export parameter is undocumented")
        coverage = item.get("coverage",{})
        require(isinstance(coverage,dict) and isinstance(coverage.get("reference"),str) and coverage["reference"].strip(),
                "Original response selection needs its explicit coverage reference")
        ids = params.get("response_ids")
        if ids is not None:
            require(coverage.get("basis")=="EXPLICIT_RESPONSE_IDS" and isinstance(ids,list) and ids and
                    all(isinstance(x,str) and re.fullmatch(r"[0-9]+",x) for x in ids) and len(ids)==len(set(ids))
                    and "page" not in params and "page_size" not in params,
                    "Use one exact response-ID selection, without page inference")
            query["response_ids"] = ",".join(ids)
        else:
            require(coverage.get("basis")=="REVIEWED_PAGE_INVENTORY" and
                    type(params.get("page")) is int and params["page"]>=1 and
                    type(params.get("page_size")) is int and params["page_size"]>=1,
                    "Declare each selected page explicitly; a short CSV is not a terminal marker")
            require(isinstance(coverage.get("inventory_id"),str) and coverage["inventory_id"].strip(),
                    "Reviewed pages require a shared original inventory identity")
        for k,v in params.items():
            if k=="response_ids":
                continue
            require(isinstance(v,(str,int)) and not isinstance(v,bool),"API parameter values must be literal strings or integers")
            query[k] = str(v)
        require(query.get("filter") in (None,"all") and query.get("flag") in (None,"","1") and
                query.get("unlock") in (None,"1"),"Preserve documented export filter values")
    elif item["route"]=="form_definition":
        require(set(params)<= {"raw"} and all(v in ("1",1) for v in params.values()),
                "Only explicit documented raw selection is supported for a definition")
        query = {k:str(v) for k,v in params.items()}
    else:
        require(not params,"This read route has no selected documented extra parameters")
    route = template.format(id=identity,format=item["format"])
    return route,query

def validate_link(link):
    require(isinstance(link,dict),"Each original attachment link must be an object")
    for key in ("entry_id","logical_id","form_key","response_key","field_key","ordinal",
                "filename","media_type","reference"):
        require(isinstance(link.get(key),str) and bool(link[key].strip()),
                "Every explicit attachment link requires "+key)
    require(safe_id(link["entry_id"]) and link.get("side") in ("source","target"),
            "Attachment entry ID and side are invalid")
    require(link.get("availability") in ("PRESENT","MISSING","REDACTED"),"Attachment body availability is required")
    if link["availability"]=="PRESENT":
        require(isinstance(link.get("asset_id"),str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}",link["asset_id"]),
                "A present attachment must select one exact captured asset ID")
    else:
        require(link.get("asset_id") is None or isinstance(link.get("asset_id"),str) and
                re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}",link["asset_id"]),
                "An unavailable attachment may retain only an exact original declaration ID or null")
    parent = link.get("parent")
    require(isinstance(parent,dict) and isinstance(parent.get("table"),str) and parent["table"] and
            type(parent.get("record")) is int and parent["record"]>=1,"Declare the actual original parent table and record")
    columns,values = parent.get("key_columns"),parent.get("key_values")
    require(isinstance(columns,list) and columns and len(columns)==len(set(columns)) and
            all(isinstance(v,str) and v for v in columns) and isinstance(values,list) and
            len(columns)==len(values) and all(isinstance(v,str) for v in values),
            "Declare complete original parent key columns and literal values")

def no_credentials(value):
    if isinstance(value,dict):
        require(not any(str(k).lower() in ("access_token","refresh_token","client_secret","password") for k in value),
                "Credentials belong only in the existing token environment, never in the saved selection")
        for item in value.values():
            no_credentials(item)
    elif isinstance(value,list):
        for item in value:
            no_credentials(item)

def validate(selection):
    require(isinstance(selection,dict),"The complete capture selection must be an object")
    no_credentials(selection)
    require(selection.get("schema")==SCHEMA,"Unsupported original capture selection")
    for k in ("label","edition","authority_reference"):
        require(isinstance(selection.get(k),str) and selection[k].strip(),"Selected "+k+" is required")
    require(selection.get("data_class") in ("DEMONSTRATION","AUTHORIZED_CUSTOMER_EXPORT"),"Explicit capture data class required")
    require(set(selection.get("classes",{}))==set(CLASSES),"Give an explicit disposition for all six asset classes")
    for c in selection["classes"].values():
        require(c.get("disposition") in ("include","exclude","defer") and
                isinstance(c.get("reference"),str) and c["reference"].strip(),"Each class needs a disposition and reference")
    local,requests = selection.get("local_assets",[]),selection.get("requests",[])
    require(isinstance(local,list) and isinstance(requests,list),"Complete source lists are required")
    ids = []
    for a in local:
        validate_asset(a)
        ids.append(a["id"])
    for r in requests:
        require(safe_id(r.get("id")) and r.get("asset_class") in CLASSES and
                r.get("side") in ("source","target","shared") and
                isinstance(r.get("provenance"),str) and r["provenance"].strip(),"Complete original request identity required")
        require(r.get("content_state","UNASSESSED") in ("COMPLETE","PARTIAL","REDACTED","UNASSESSED"),"Invalid request content state")
        request_route(r)
        z = r.get("zip",{"mode":"none"})
        require(z.get("mode") in ("none","direct","pointer_text","pointer_json_string") and
                z.get("authentication","none") in ("none","same_token"),"Choose an explicit attachment archive response contract")
        require(z["mode"]=="none" or r["route"]=="responses_export" and r["format"]=="zip",
                "Only the documented ZIP export may follow an attachment pointer")
        ids.append(r["id"])
    require(len(ids)==len(set(ids)),"All operation and original asset IDs must be unique")
    if requests:
        tenant_origin(selection.get("tenant",""))
    limits = {**DEFAULT_LIMITS,**selection.get("limits",{})}
    require(set(limits)==set(DEFAULT_LIMITS) and all(type(v) is int and v>0 for v in limits.values()),
            "Capture limits must be explicit positive integers")
    require(limits["timeout_seconds"]<=3600,"Choose a bounded original request timeout")
    links = selection.get("attachment_links",[])
    require(isinstance(links,list),"Explicit attachment links must be an array")
    for link in links:
        validate_link(link)
    require(len({x["entry_id"] for x in links})==len(links),"Original attachment entry IDs must be unique")
    return limits

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def http_get(origin,route,params,token,directory,name,limits,authenticate=True):
    require(not route.startswith("/") and "\\" not in route and not any(x in ("",".","..") for x in route.split("/")),
            "Only an exact relative documented path is permitted")
    query = dict(params)
    if authenticate:
        require(token,"An existing authorized user token must be supplied through the named environment variable")
        query["access_token"] = token
    url = origin+"/"+route
    if query:
        url += "?"+urllib.parse.urlencode(query)
    start = {"schema":"tjlabs.forms-capture.http.v1","method":"GET","tenant":origin,
             "route":route,"parameters":params,"authentication":"EXISTING_USER_TOKEN" if authenticate else "NONE",
             "started_at":now(),"status":"REQUESTED"}
    atomic(directory/(name+".request.json"),start)
    response = None
    try:
        request = urllib.request.Request(url,headers={"Accept":"*/*","Accept-Encoding":"identity"})
        opener = urllib.request.build_opener(NoRedirect())
        try:
            response = opener.open(request,timeout=limits["timeout_seconds"])
        except urllib.error.HTTPError as error:
            response = error
        status = response.code
        headers = {k:response.headers[k] for k in SAFE_HEADERS if response.headers.get(k) is not None}
        atomic(directory/(name+".headers.json"),{"status":status,"headers":headers,"received_at":now()})
        body = directory/(name+".body")
        original = copy_complete(response,body,limits["max_body_bytes"])
        length = headers.get("content-length")
        if length is not None:
            require(length.isdecimal() and int(length)==original["bytes"],"Original Content-Length differs from received full bytes")
        result = {**start,"status":"RECEIVED" if 200<=status<300 else "HTTP_ERROR",
                  "http_status":status,"headers":headers,"body":body.name,**original,"completed_at":now()}
        atomic(directory/(name+".receipt.json"),result)
        require(200<=status<300,"Original GET returned HTTP"+str(status)+"; complete received body retained")
        return result
    except (urllib.error.URLError,TimeoutError,ConnectionError,OSError,http.client.HTTPException) as error:
        # Exception strings may include the authenticated URL. Never log them.
        raise CaptureError("Original GET transport interrupted ("+type(error).__name__+"); retained request and partial bytes require receiving") from None
    finally:
        if response is not None:
            response.close()

def pointer_route(body,mode):
    require(len(body)<=16384,"Attachment pointer response is larger than its supported textual contract")
    text = body.decode("utf-8")
    value = parse(body) if mode=="pointer_json_string" else text.strip()
    require(isinstance(value,str),"Select the actual returned string pointer contract")
    u = urllib.parse.urlsplit(value)
    require(not u.scheme and not u.netloc and not u.query and not u.fragment and
            re.fullmatch(r"/?uploads/get_zip/[A-Za-z0-9_.-]+\.zip",u.path),
            "Returned ZIP pointer is not the documented same-tenant uploads/get_zip path")
    route = u.path.lstrip("/")
    require(".." not in route.split("/"),"Invalid attachment pointer")
    return route

def original_asset(a,path,identity,provenance=None):
    return {"id":a["id"],"asset_class":a["asset_class"],"side":a["side"],
            "availability":"PRESENT","content_state":a.get("content_state","UNASSESSED"),
            "path":path,"bytes":identity["bytes"],"sha256":identity["sha256"],
            "filename":a["filename"],"media_type":a["media_type"],
            "provenance":provenance if provenance is not None else a["provenance"]}

def inspect_archive(archive,owner,directory,root,limits):
    assets,members,expanded = [],[],0
    archive_sha = digest(archive)
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        require(len(entries)<=limits["max_archive_members"],"Whole archive exceeds selected member count; original ZIP retained")
        name_counts = {}
        for info in entries:
            name_counts[info.filename] = name_counts.get(info.filename,0)+1
        listing = [{"ordinal":n,"original_name":i.filename,"declared_bytes":i.file_size,
                    "compressed_bytes":i.compress_size,"crc32":i.CRC,"mode":i.external_attr>>16,
                    "flag_bits":i.flag_bits,"duplicate_name_count":name_counts[i.filename]}
                   for n,i in enumerate(entries,1)]
        atomic(directory/"original-inventory.json",{"archive_asset_id":owner["id"],
               "archive_sha256":archive_sha,"members":listing})
        for ordinal,info in enumerate(entries,1):
            mode = info.external_attr>>16
            kind = "DIRECTORY" if info.is_dir() else "FILE" if not stat.S_IFMT(mode) or stat.S_ISREG(mode) else "UNSUPPORTED_TYPE"
            item = {"archive_asset_id":owner["id"],"archive_sha256":archive_sha,
                    "ordinal":ordinal,"original_name":info.filename,"duplicate_name_count":name_counts[info.filename],
                    "declared_bytes":info.file_size,"compressed_bytes":info.compress_size,"crc32":info.CRC,
                    "mode":mode,"flag_bits":info.flag_bits,"kind":kind,"asset_id":None,"body_status":"NOT_A_REGULAR_FILE"}
            if kind=="FILE":
                require(not(info.flag_bits&1),"Encrypted archive member requires its original authorized decrypting owner")
                require(info.file_size<=limits["max_body_bytes"],"Complete attachment exceeds selected body limit")
                expanded += info.file_size
                require(expanded<=limits["max_expanded_bytes"],"Complete archive expansion exceeds selected explicit limit")
                asset_id = owner["id"]+"-m"+str(ordinal).zfill(6)
                body = directory/(str(ordinal).zfill(6)+".body")
                with z.open(info) as stream:
                    identity = copy_complete(stream,body,limits["max_body_bytes"])
                require(identity["bytes"]==info.file_size,"Whole original member length differs")
                source = {**owner,"id":asset_id,"filename":PurePosixPath(info.filename).name or "unnamed-member",
                          "media_type":"application/octet-stream","content_state":"UNASSESSED"}
                asset = original_asset(source,body.relative_to(root).as_posix(),identity,
                    "Complete original ZIP member "+str(ordinal)+"; archive "+owner["id"]+
                    " SHA256 "+item["archive_sha256"]+"; original name "+info.filename+
                    ". Parent/form/response/field linkage is not inferred.")
                assets.append(asset)
                item.update({"asset_id":asset_id,"body_status":"PRESENT","bytes":identity["bytes"],"sha256":identity["sha256"]})
            members.append(item)
    return assets,members

def operation(root,item,kind,input_root,origin,token,limits,selection_sha):
    pointer = root/"operations"/(item["id"]+".json")
    if pointer.exists():
        existing = read(pointer)
        receipt_path = selected_path(root,existing["receipt"])
        receipt = read(receipt_path)
        if existing.get("status")=="COMPLETE" or receipt.get("status")=="COMPLETE":
            if existing.get("status")=="COMPLETE":
                require(measure(receipt_path)==existing.get("receipt_identity"),"Original operation receipt changed")
            require(receipt["selection_sha256"]==selection_sha,"Original operation selection differs")
            for f in receipt["files"]:
                require(measure(selected_path(root,f["path"]))=={k:f[k] for k in ("bytes","sha256")},
                        "Original completed capture member changed")
            atomic(pointer,{"status":"COMPLETE","receipt":existing["receipt"],
                            "receipt_identity":measure(receipt_path)},True)
            return receipt
    directory = root/"attempts"/(item["id"]+"-"+uuid.uuid4().hex)
    directory.mkdir(parents=True)
    receipt = {"schema":"tjlabs.forms-capture.operation.v1","operation_id":item["id"],
               "selection_sha256":selection_sha,"kind":kind,"started_at":now(),"status":"RUNNING",
               "assets":[],"members":[],"requests":[]}
    atomic(directory/"operation.json",receipt)
    atomic(pointer,{"status":"RUNNING","receipt":(directory/"operation.json").relative_to(root).as_posix(),
                    "receipt_identity":measure(directory/"operation.json")},True)
    try:
        if kind=="local":
            if item["availability"]!="PRESENT":
                receipt["assets"].append({k:item.get(k) for k in
                    ("id","asset_class","side","availability","content_state","path","bytes","sha256","filename","media_type","provenance")})
                receipt["assets"][-1]["content_state"] = item.get("content_state","UNASSESSED")
            else:
                original = selected_path(input_root,item["path"])
                body = directory/"original.body"
                with original.open("rb") as stream:
                    identity = copy_complete(stream,body,limits["max_body_bytes"],item)
                asset = original_asset(item,body.relative_to(root).as_posix(),identity)
                receipt["assets"].append(asset)
                if item.get("inspect_zip",False):
                    members_dir = directory/"members"
                    members_dir.mkdir()
                    extra,members = inspect_archive(body,asset,members_dir,root,limits)
                    receipt["assets"] += extra
                    receipt["members"] += members
        else:
            route,params = request_route(item)
            first = http_get(origin,route,params,token,directory,"export",limits)
            receipt["requests"].append(first)
            primary = {**item,"filename":item["id"]+"."+item["format"],
                       "media_type":first["headers"].get("content-type","application/octet-stream").split(";",1)[0]}
            receipt["assets"].append(original_asset(primary,(directory/first["body"]).relative_to(root).as_posix(),first))
            expected = item.get("expected_media_type")
            require(expected is None or primary["media_type"]==expected,
                    "Actual response media type differs; original body retained for operator review")
            mode = item.get("zip",{}).get("mode","none")
            if mode!="none":
                archive = directory/first["body"]
                archive_owner = receipt["assets"][-1]
                if mode.startswith("pointer"):
                    route = pointer_route(archive.read_bytes(),mode)
                    second = http_get(origin,route,{},token,directory,"attachment-zip",limits,
                                      item["zip"].get("authentication","none")=="same_token")
                    receipt["requests"].append(second)
                    archive = directory/second["body"]
                    archive_owner = original_asset({**item,"id":item["id"]+"-zip","filename":PurePosixPath(route).name,
                        "media_type":"application/zip"},archive.relative_to(root).as_posix(),second,
                        item["provenance"]+"; original same-tenant ZIP pointer retained in "+item["id"])
                    receipt["assets"].append(archive_owner)
                members_dir = directory/"members"
                members_dir.mkdir()
                extra,members = inspect_archive(archive,archive_owner,members_dir,root,limits)
                receipt["assets"] += extra
                receipt["members"] += members
        receipt["status"] = "COMPLETE"
    except (CaptureError,ValueError,KeyError,TypeError,OSError,zipfile.BadZipFile,RuntimeError) as error:
        receipt["status"] = "INCOMPLETE"
        # Only controlled messages are retained; library errors can echo private URLs.
        receipt["error"] = {"type":type(error).__name__,"message":str(error) if isinstance(error,CaptureError) else "Original source operation returned; complete raw attempts remain retained"}
    receipt["completed_at"] = now()
    receipt["files"] = [{"path":p.relative_to(root).as_posix(),**measure(p)}
                        for p in sorted(directory.rglob("*")) if p.is_file() and p.name!="operation.json"]
    atomic(directory/"operation.json",receipt,True)
    atomic(pointer,{"status":receipt["status"],"receipt":(directory/"operation.json").relative_to(root).as_posix(),
                    "receipt_identity":measure(directory/"operation.json")},True)
    return receipt

@contextmanager
def capture_lock(root,resume):
    lock = root/"capture.lock"
    owner = {"pid":os.getpid(),"hostname":socket.gethostname(),"id":uuid.uuid4().hex}
    try:
        atomic(lock,owner)
    except FileExistsError:
        prior = read(lock)
        require(resume and prior.get("hostname")==socket.gethostname() and type(prior.get("pid")) is int and prior["pid"]>0,
                "Original capture lock remains with its named owner")
        try:
            os.kill(prior["pid"],0)
        except ProcessLookupError:
            require(read(lock)==prior,"Original lock changed")
            os.rename(lock,root/("retired-lock-"+prior["id"]+".json"))
            atomic(lock,owner)
        else:
            raise CaptureError("Original capture process is still active")
    try:
        yield
    finally:
        if lock.exists() and read(lock)==owner:
            lock.unlink()

def source_files():
    here = Path(__file__).resolve().parent
    result = []
    for name in SOFTWARE:
        path = selected_path(here,name)
        result.append({"path":name,**measure(path)})
    return result

def inventory(root,exclude=()):
    result = []
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink(),"A retained capture may not contain symbolic links")
        if path.is_file():
            name = path.relative_to(root).as_posix()
            if name not in exclude:
                result.append({"path":name,**measure(path)})
        else:
            require(path.is_dir(),"An original capture member is not an ordinary file")
    return result

def capture(selection_path,input_root,output,token_env=None,resume=False):
    original = Path(selection_path).read_bytes()
    selection = parse(original)
    limits = validate(selection)
    selection_sha = hashlib.sha256(original).hexdigest()
    root,input_root = Path(output).resolve(),Path(input_root).resolve()
    require(input_root.is_dir(),"Original input root is missing")
    require(root!=input_root and not root.is_relative_to(input_root),"Capture output must be outside the original selected input root")
    software = source_files()
    if root.exists():
        require(resume and (root/"selection.original.json").read_bytes()==original,"Use the same original selection with --resume")
        require(read(root/"source-files.json")==software,"Continue with the exact original collector source and guides")
    else:
        root.parent.mkdir(parents=True,exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix="."+root.name+"-",dir=root.parent))
        try:
            atomic_bytes(stage/"selection.original.json",original)
            atomic(stage/"selection.json",selection)
            atomic(stage/"source-files.json",software)
            (stage/"workbench").mkdir()
            for entry in software:
                with selected_path(Path(__file__).resolve().parent,entry["path"]).open("rb") as stream:
                    copy_complete(stream,stage/"workbench"/entry["path"],entry["bytes"],entry)
            os.rename(stage,root)
        finally:
            shutil.rmtree(stage,ignore_errors=True)
    if not (root/"capture.lock").exists() and (root/"capture.json").exists() and (root/"delivery.json").exists() and read(root/"capture.json")["status"]=="COMPLETE_SELECTED_CAPTURE":
        return verify(root)
    with capture_lock(root,resume):
        origin = tenant_origin(selection["tenant"]) if selection.get("requests") else None
        token = os.environ.get(token_env) if token_env else None
        results = []
        for item in selection.get("local_assets",[]):
            results.append(operation(root,item,"local",input_root,origin,token,limits,selection_sha))
        for item in selection.get("requests",[]):
            result = operation(root,item,"http",input_root,origin,token,limits,selection_sha)
            results.append(result)
            if result["status"]!="COMPLETE":
                break
        assets = [a for result in results for a in result["assets"]]
        require(len({a["id"] for a in assets})==len(assets),"Generated source asset identities collide; revise the source selection")
        members = [m for result in results for m in result["members"]]
        atomic_bytes(root/"assets.jsonl",b"".join(json.dumps(a,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf-8")+b"\n" for a in assets),True)
        atomic_bytes(root/"archive-members.jsonl",b"".join(json.dumps(m,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode("utf-8")+b"\n" for m in members),True)
        completed_ids = {r["operation_id"] for r in results if r["status"]=="COMPLETE"}
        wanted = selection.get("local_assets",[])+selection.get("requests",[])
        coverage = {"schema":"tjlabs.forms-capture.coverage.v1","selected_operations":len(wanted),
            "complete_selected_operations":len(completed_ids),"unfinished_operations":[r["id"] for r in wanted if r["id"] not in completed_ids],
            "response_selection":[{"operation_id":r["id"],"coverage":r.get("coverage"),
                "parameters":r.get("params",{}),
                "incomplete_responses":"EXPLICITLY_INCLUDED" if r.get("params",{}).get("filter")=="all" else "PROVIDER_DEFAULT_EXCLUDES_INCOMPLETE",
                "historical_field_versions":"UNASSESSED_LATEST_FIELD_VERSION_EXPORT_LIMITATION",
                "status":"RAW_CAPTURED_IDENTIFIERS_UNRECONCILED" if r["id"] in completed_ids else "NOT_RECEIVED"}
                for r in selection.get("requests",[]) if r["route"]=="responses_export"],
            "meaning":"Selected GET/file capture is not response, revision, workflow or attachment-parent completeness. No row-count/page-size terminal inference is used."}
        coverage["classes"] = {name:{"selection":selection["classes"][name],
            "declared_operations":sum(x["asset_class"]==name for x in wanted),
            "captured_assets":sum(x["asset_class"]==name and x["availability"]=="PRESENT" for x in assets),
            "unavailable_assets":sum(x["asset_class"]==name and x["availability"]!="PRESENT" for x in assets)}
            for name in CLASSES}
        atomic(root/"coverage.json",coverage,True)
        by_id = {a["id"]:a for a in assets}
        link_reviews = []
        for link in selection.get("attachment_links",[]):
            asset = by_id.get(link.get("asset_id"))
            same_scope = asset is not None and asset["asset_class"]=="uploads" and asset["side"]==link["side"]
            if link["availability"]=="PRESENT":
                body_status = "CAPTURED" if same_scope and asset["availability"]=="PRESENT" else "BODY_NOT_RECEIVED_OR_DIFFERENT_SCOPE"
            else:
                body_status = "DECLARED_UNAVAILABLE" if link.get("asset_id") is None or (
                    same_scope and asset["availability"]==link["availability"]) else "DECLARATION_NOT_RECEIVED_OR_DIFFERENT_SCOPE"
            link_reviews.append({"entry_id":link["entry_id"],"asset_id":link.get("asset_id"),
                                 "body_status":body_status,"parent_status":"UNRECONCILED"})
        worksheet = {"schema":"tjlabs.forms-capture.mapping-worksheet.v1","label":selection["label"],
            "data_class":selection["data_class"],"edition":selection["edition"],"classes":selection["classes"],
            "assets":assets,"attachments":selection.get("attachment_links",[]),"attachment_link_review":link_reviews,
            "status":"MAPPING_REQUIRED","authority_reference":selection["authority_reference"],
            "table_assets":{},"discovery_manifest":None,"migration_selection":None,
            "reference":"Complete raw originals retained. Supply explicit CSV projection mappings, actual parent/form/response/field links, source/target interpretation and returned-identifier coverage before workbench acceptance."}
        atomic(root/"mapping-worksheet.json",worksheet,True)
        status = "COMPLETE_SELECTED_CAPTURE" if len(completed_ids)==len(wanted) else "CAPTURED_WITH_GAPS"
        outcome = {"schema":CAPTURE,"status":status,"selection_sha256":selection_sha,
            "label":selection["label"],"edition":selection["edition"],"data_class":selection["data_class"],
            "classes":selection["classes"],"assets":len(assets),"archive_members":len(members),
            "coverage":coverage,"operations":[{"id":r["operation_id"],"status":r["status"]} for r in results],
            "source_files":software,"api_source":{"url":API_SOURCE,"git_blob":API_BLOB},"completed_at":now()}
        atomic(root/"capture.json",outcome,True)
        files = inventory(root,("capture.lock","delivery.json"))
        atomic(root/"delivery.json",{"schema":"tjlabs.forms-capture.delivery.v1","selection_sha256":selection_sha,"files":files},True)
        return outcome

def verify(directory):
    root = Path(directory).resolve()
    require(root.is_dir() and not (root/"capture.lock").exists(),"Select a complete inactive original capture")
    declaration = read(root/"delivery.json")
    require(declaration.get("schema")=="tjlabs.forms-capture.delivery.v1","Original capture declaration required")
    expected = declaration["files"]
    names = [x["path"] for x in expected]
    actual = inventory(root,("delivery.json",))
    require(len(names)==len(set(names)) and {x["path"] for x in actual}==set(names),"Complete original capture member set differs")
    actual_by_name = {x["path"]:x for x in actual}
    for item in expected:
        relpath(item["path"])
        require(actual_by_name[item["path"]]==item,"Original capture member changed: "+item["path"])
    original = (root/"selection.original.json").read_bytes()
    require(hashlib.sha256(original).hexdigest()==declaration["selection_sha256"] and
            parse(original)==read(root/"selection.json"),"Original capture selection binding differs")
    validate(parse(original))
    outcome = read(root/"capture.json")
    require(outcome["schema"]==CAPTURE and outcome["selection_sha256"]==declaration["selection_sha256"],
            "Original capture result binding differs")
    require(outcome["source_files"]==read(root/"source-files.json") and
            {x["path"] for x in outcome["source_files"]}==set(SOFTWARE),"Complete collector source selection differs")
    for item in outcome["source_files"]:
        require(measure(selected_path(root/"workbench",item["path"]))=={k:item[k] for k in ("bytes","sha256")},
                "Original collector software differs")
    return outcome

def pack(directory,destination):
    root = Path(directory).resolve()
    outcome = verify(root)
    destination = Path(destination).resolve()
    require(not destination.exists() and destination.parent.is_dir() and not destination.is_relative_to(root),
            "Choose a new archive outside the original capture")
    entries = inventory(root)
    declaration = {"schema":"tjlabs.forms-capture.handover.v1","selection_sha256":outcome["selection_sha256"],"files":entries}
    fd,temp = tempfile.mkstemp(prefix="."+destination.name+"-",dir=destination.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp,"w",compression=zipfile.ZIP_DEFLATED,allowZip64=True) as z:
            for entry in entries:
                info = zipfile.ZipInfo(entry["path"],(1980,1,1,0,0,0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                h,count = hashlib.sha256(),0
                with selected_path(root,entry["path"]).open("rb") as inp,z.open(info,"w",force_zip64=True) as out:
                    for block in iter(lambda:inp.read(1024*1024),b""):
                        out.write(block)
                        h.update(block)
                        count += len(block)
                require({"bytes":count,"sha256":h.hexdigest()}=={k:entry[k] for k in ("bytes","sha256")},
                        "Original capture changed during complete packing")
            z.writestr("capture-handover.json",json_bytes(declaration))
        with open(temp,"rb") as stream:
            os.fsync(stream.fileno())
        verify(root)
        os.link(temp,destination)
    finally:
        os.unlink(temp)
    return {"status":"PACKED","path":str(destination),**measure(destination),"selection_sha256":outcome["selection_sha256"]}

def receive(archive,output,max_bytes=20*1024**3):
    archive,output = Path(archive).resolve(),Path(output).resolve()
    require(not output.exists(),"Choose a new independent capture receiving directory")
    require(type(max_bytes) is int and max_bytes>0,"Receiving capacity must be a positive byte count")
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="."+output.name+"-",dir=output.parent))
    inner = temporary/"capture"
    inner.mkdir()
    try:
        archive_identity = measure(archive)
        with zipfile.ZipFile(archive) as z:
            infos = z.infolist()
            require(len(infos)<=500000 and len({i.filename for i in infos})==len(infos),"Archive member count or repeated member is invalid")
            require(sum(i.file_size for i in infos)<=max_bytes,"Archive exceeds selected expanded receiving capacity")
            require(z.getinfo("capture-handover.json").file_size<=64*1024**2,"Complete handover declaration exceeds capacity")
            declaration = parse(z.read("capture-handover.json"))
            require(declaration["schema"]=="tjlabs.forms-capture.handover.v1","Original collector handover required")
            expected = {i["path"]:i for i in declaration["files"]}
            require(len(expected)==len(declaration["files"]) and
                    set(z.namelist())==set(expected)|{"capture-handover.json"},"Full original archive member set differs")
            for info in infos:
                if info.filename=="capture-handover.json":
                    continue
                relative = relpath(info.filename)
                mode = info.external_attr>>16
                require(not info.is_dir() and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)) and not(info.flag_bits&1),
                        "Only original ordinary unencrypted source files can be received")
                descriptor = expected[info.filename]
                require(type(descriptor["bytes"]) is int and descriptor["bytes"]>=0 and
                        info.file_size==descriptor["bytes"],"Original declared member size differs")
                target = inner.joinpath(*relative.parts)
                target.parent.mkdir(parents=True,exist_ok=True)
                with z.open(info) as stream:
                    copy_complete(stream,target,descriptor["bytes"],descriptor)
            outcome = verify(inner)
            require(outcome["selection_sha256"]==declaration["selection_sha256"],
                    "Original received capture identity differs")
        require(measure(archive)==archive_identity,"Original archive changed while receiving")
        atomic(temporary/"receiving.json",{"schema":"tjlabs.forms-capture.receiving.v1",
               "archive":archive_identity,"selection_sha256":declaration["selection_sha256"],
               "capture":"capture","status":outcome["status"],
               "meaning":"Exact original capture plus selected collector software; response and parent coverage remain as recorded."})
        os.rename(temporary,output)
    finally:
        shutil.rmtree(temporary,ignore_errors=True)
    return {"status":"RECEIVED","path":str(output),"capture":str(output/"capture"),
            "selection_sha256":declaration["selection_sha256"]}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command",required=True)
    p = sub.add_parser("capture")
    p.add_argument("--selection",required=True)
    p.add_argument("--input-root",required=True)
    p.add_argument("--output",required=True)
    p.add_argument("--token-env")
    p.add_argument("--resume",action="store_true")
    p = sub.add_parser("verify");p.add_argument("--capture",required=True)
    p = sub.add_parser("pack");p.add_argument("--capture",required=True);p.add_argument("--output",required=True)
    p = sub.add_parser("receive");p.add_argument("--archive",required=True);p.add_argument("--output",required=True)
    p.add_argument("--max-bytes",type=int,default=20*1024**3)
    a = parser.parse_args(argv)
    try:
        if a.command=="capture":
            result = capture(a.selection,a.input_root,a.output,a.token_env,a.resume)
        elif a.command=="verify":
            result = verify(a.capture)
        elif a.command=="pack":
            result = pack(a.capture,a.output)
        else:
            result = receive(a.archive,a.output,a.max_bytes)
        print(json.dumps(result,ensure_ascii=False))
        return 0 if result.get("status")!="CAPTURED_WITH_GAPS" else 3
    except (CaptureError,ValueError,KeyError,TypeError,OSError,zipfile.BadZipFile) as error:
        message = str(error) if isinstance(error,CaptureError) else "Original local source operation returned; preserve its existing records"
        print(json.dumps({"status":"ERROR","type":type(error).__name__,"message":message}))
        return 2

if __name__=="__main__":
    raise SystemExit(main())
