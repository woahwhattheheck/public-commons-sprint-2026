"""MIT. Retained ERDDAP acquisition and the original SF30 edition/receiving workspace."""
from __future__ import annotations
import datetime, email.utils, hashlib, importlib.util, io, json, os, re, shutil, stat, sys, tempfile, threading, time
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit
import urllib.error, urllib.request
import zipfile
import erddap_source as source
from erddap_source import InputError, MAX_SOURCE, jbytes as json_bytes, json_value as load_json

HERE=Path(__file__).resolve().parent
XML=HERE.parent/"xml"
if str(XML) not in sys.path:sys.path.insert(0,str(XML))
_name="_sf30_erddap_original_xml_workspace"
if _name not in sys.modules:
    _spec=importlib.util.spec_from_file_location(_name,XML/"workspace.py")
    _module=importlib.util.module_from_spec(_spec);sys.modules[_name]=_module;_spec.loader.exec_module(_module)
_original=sys.modules[_name]
MAX_PACKET=2*MAX_SOURCE
HEX=re.compile(r"[0-9a-f]{64}\Z")
OP=re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z")
FORMAT=_original.SourceFormat("erddap","ERDDAP",source.inventory,source.validate_plan,source.extract,source.dataset_spec)
_TEMP_LOCK=threading.RLock()

def ident(value):
    if not isinstance(value,str) or not HEX.fullmatch(value):raise InputError("Expected a full retained content identity")
    return value

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def atomic(path,raw):
    path=Path(path);fd,temp=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb")as f:f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(temp,path);_original.sync_dir(path.parent)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def retained(path,raw):
    if path.exists():
        _original.regular(path,MAX_SOURCE)
        if path.read_bytes()!=raw:raise InputError("Retained source identity conflicts: "+path.name)
    else:_original.private_write(path,raw);_original.sync_dir(path.parent)

class ProviderError(InputError):
    def __init__(self,message,status=None,retry_after=None,receipt=None):
        super().__init__(message);self.status=502;self.provider_status=status;self.retry_after=retry_after;self.receipt=receipt

class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self,origin):self.origin=origin
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        u=urlsplit(newurl)
        if (u.scheme,u.netloc)!=self.origin:raise ProviderError("Provider redirected outside the selected ERDDAP origin",code)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def response_identity(path):
    p=Path(path);r=load_json(p.with_name(p.name+".receipt.json").read_bytes())
    raw=p.read_bytes()
    if r.get("bytes")!=len(raw) or r.get("sha256")!=source.sha(raw):raise InputError("Retained original response was changed")
    return r,raw

def fetch(folder,name,url,max_bytes=64*1024*1024):
    """Resume only this exact GET. Completed original response bytes are never silently refreshed."""
    folder=Path(folder);path=folder/name;receipt=folder/(name+".receipt.json");pending=folder/(name+".response.partial")
    if receipt.exists():
        r=load_json(receipt.read_bytes())
        if r.get("url")!=url:raise InputError("This original response belongs to a different URL")
        if not path.exists() and pending.exists() and source.sha(pending.read_bytes())==r.get("sha256"):
            os.replace(pending,path);_original.sync_dir(folder)
        if path.exists():
            r,raw=response_identity(path)
            if r.get("status")!=200:raise InputError("Saved source response was not successful")
            return r
    cooldown=folder/(name+".cooldown.json")
    if cooldown.exists():
        c=load_json(cooldown.read_bytes())
        if time.time()<c.get("notBefore",0):raise ProviderError("The original provider retry time has not arrived",c.get("status"),c.get("retryAfter"),c)
    request=urllib.request.Request(url,headers={"Accept":"*/*","Accept-Encoding":"identity","User-Agent":"Commons-ERDDAP-Receiving/1.0"})
    u=urlsplit(url);opener=urllib.request.build_opener(SameOriginRedirect((u.scheme,u.netloc)))
    started=now()
    try:r=opener.open(request,timeout=90)
    except urllib.error.HTTPError as e:
        raw=e.read(262144);stamp=str(time.time_ns())
        headers={k:v for k,v in e.headers.items()if k.lower()not in {"set-cookie","authorization","cookie"}}
        rec={"url":url,"status":e.code,"startedAt":started,"retrievedAt":now(),"headers":headers,"bytes":len(raw),"sha256":source.sha(raw)}
        retained(folder/(name+".http-error-"+stamp+".body"),raw)
        retained(folder/(name+".http-error-"+stamp+".json"),json_bytes(rec))
        retry=e.headers.get("Retry-After");not_before=0
        if retry:
            try:not_before=time.time()+max(0,int(retry))
            except ValueError:
                try:not_before=email.utils.parsedate_to_datetime(retry).timestamp()
                except (ValueError,TypeError,OverflowError):pass
        if not_before:atomic(cooldown,json_bytes({"url":url,"status":e.code,"retryAfter":retry,"notBefore":not_before}))
        raise ProviderError("ERDDAP returned HTTP "+str(e.code)+"; the exact error response is retained",e.code,retry,rec)from e
    except (OSError,urllib.error.URLError)as e:raise ProviderError("Original ERDDAP request failed: "+str(e.reason if isinstance(e,urllib.error.URLError)else e))from e
    size=0;h=hashlib.sha256()
    try:
        with r,os.fdopen(os.open(pending,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),"wb")as out:
            while block:=r.read(65536):
                size+=len(block)
                if size>max_bytes:raise InputError("Complete original response exceeds maxBytes; increase the declared budget or select a smaller complete region")
                out.write(block);h.update(block)
            out.flush();os.fsync(out.fileno())
            rec={"url":url,"finalUrl":r.url,"status":r.status,"startedAt":started,"retrievedAt":now(),
                 "headers":{k:v for k,v in r.headers.items()if k.lower()not in {"set-cookie","authorization","cookie"}},
                 "bytes":size,"sha256":h.hexdigest()}
        if rec["status"]!=200:raise ProviderError("Original source requires HTTP200",rec["status"])
        atomic(receipt,json_bytes(rec));os.replace(pending,path);_original.sync_dir(folder)
        cooldown.unlink(missing_ok=True);return rec
    except (OSError,urllib.error.URLError)as e:raise ProviderError("Original response did not finish; the same query and partial body are retained: "+str(e))from e

def semantic_signature(meta,sel):
    selected=set(sel["variables"])
    selected.update(a["name"]for a in sel.get("axes",[]))
    selected.update(c["variable"]for c in sel.get("constraints",[]))
    entries=[]
    for v in meta["variables"]+meta["dimensions"]:
        if v["name"]not in selected:continue
        attrs={k:a for k,a in v["attributes"].items()if k not in {"actual_range","colorBarMinimum","colorBarMaximum"}}
        entries.append({"name":v["name"],"type":v["type"],"attributes":attrs,
                        "dimensions":[x["name"]for x in v["dimensions"]]})
    return source.sha(json_bytes({"variables":entries,"license":meta["license"]}))

class NativeEngine(_original.NativeEngine):
    """Only selects a writable private temp directory around the unchanged original engine start."""
    def __init__(self,directory):super().__init__();self.directory=Path(directory)
    def _start(self):
        with _TEMP_LOCK:
            previous=tempfile.tempdir
            try:tempfile.tempdir=str(self.directory);super()._start()
            finally:tempfile.tempdir=previous

class Workspace(_original.Workspace):
    def __init__(self,root,create=False):
        super().__init__(root,create=create,source_format=FORMAT)
        self.native=NativeEngine(self.root/"tmp")
        for name in ["provider","acquisitions"]:
            p=self.root/name
            if not p.exists():p.mkdir(mode=0o700)
            if p.is_symlink()or not p.is_dir():raise InputError("Provider directories must be real private directories")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS erddap_metadata(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS erddap_queries(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS erddap_operations(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS erddap_searches(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
        """)

    def state(self):
        with self.mutex:
            result=super().state()
            result["metadata"]=[{k:v for k,v in load_json(r["body"]).items()if k not in {"metadata","files"}}for r in self.db.execute("SELECT body FROM erddap_metadata ORDER BY created DESC")]
            result["queries"]=[{"id":r["id"],"query":load_json(r["body"])}for r in self.db.execute("SELECT * FROM erddap_queries ORDER BY created DESC")]
            result["operations"]=[load_json(r["body"])for r in self.db.execute("SELECT body FROM erddap_operations ORDER BY created DESC")]
            result["searches"]=[{k:v for k,v in load_json(r["body"]).items()if k!="table"}for r in self.db.execute("SELECT body FROM erddap_searches ORDER BY created DESC")]
            return result

    def _folder(self,kind,key):
        p=self.root/kind/key
        p.mkdir(mode=0o700,exist_ok=True)
        if p.is_symlink()or not p.is_dir():raise InputError("Operation directory is not a real directory")
        return p

    def search(self,server,text,page=1,limit=50):
        server=source.server_url(server)
        if not isinstance(text,str)or len(text)>512 or type(page)is not int or page<1 or type(limit)is not int or not 1<=limit<=1000:
            raise InputError("Catalogue search requires text, a positive page and 1–1000 items per page")
        url=server+"search/index.json?"+urlencode({"page":page,"itemsPerPage":limit,"searchFor":text})
        with self.mutex:
            folder=self._folder("provider","search-"+str(time.time_ns()))
            rec=fetch(folder,"catalogue.json",url,8*1024*1024)
            raw=(folder/"catalogue.json").read_bytes();t=source.table(raw,limit)
            record={"schema":"stellar-forge.erddap-search.v1","id":source.sha(json_bytes(rec)),"server":server,"text":text,"page":page,"limit":limit,
                    "nextPage":page+1 if len(t["rows"])==limit else None,"table":t,"response":rec}
            with self.db:self.db.execute("INSERT INTO erddap_searches VALUES(?,?,?)",(record["id"],json_bytes(record).decode(),time.time()))
            return record

    def load_metadata(self,server,dataset_id,protocol):
        server=source.server_url(server);did=source.dataset_id(dataset_id)
        if protocol not in {"griddap","tabledap"}:raise InputError("Choose griddap or tabledap")
        with self.mutex:
            folder=self._folder("provider","metadata-"+str(time.time_ns()))
            files={}
            for name,url in {"metadata.json":server+"info/"+quote(did,safe="")+"/index.json",
                             "dataset.dds":server+protocol+"/"+quote(did,safe="")+".dds",
                             "dataset.das":server+protocol+"/"+quote(did,safe="")+".das"}.items():
                files[name]=fetch(folder,name,url,8*1024*1024)
            meta=source.metadata((folder/"metadata.json").read_bytes(),did,(folder/"dataset.dds").read_bytes())
            body={"server":server,"datasetId":did,"protocol":protocol,"metadata":meta,"files":files}
            mid=source.sha(json_bytes(body));destination=self.root/"provider"/mid
            if destination.exists():
                for n,r in files.items():
                    if source.sha((destination/n).read_bytes())!=r["sha256"]:raise InputError("Retained metadata identity conflict")
                shutil.rmtree(folder)
            else:os.replace(folder,destination);_original.sync_dir(destination.parent)
            body={"id":mid,**body}
            with self.db:self.db.execute("INSERT OR IGNORE INTO erddap_metadata VALUES(?,?,?)",(mid,json_bytes(body).decode(),time.time()))
            return body

    def metadata_item(self,mid):
        with self.mutex:
            row=self.db.execute("SELECT body FROM erddap_metadata WHERE id=?",(ident(mid),)).fetchone()
            if row is None:raise InputError("Unknown retained provider metadata")
            body=load_json(row["body"]);folder=self.root/"provider"/mid
            for n,r in body["files"].items():
                _original.regular(folder/n,8*1024*1024)
                if source.sha((folder/n).read_bytes())!=r["sha256"]:raise InputError("Retained metadata response changed")
            return body

    def save_query(self,body):
        if not isinstance(body,dict)or set(body)-{"metadataId","selection","label","maxBytes"}:raise InputError("Invalid query review fields")
        with self.mutex:
            meta=self.metadata_item(body.get("metadataId"));sel=source.selection(body.get("selection"),meta["protocol"],meta["metadata"])
            label=body.get("label",meta["metadata"].get("title")or meta["datasetId"])
            if not isinstance(label,str)or not label.strip()or len(label)>160:raise InputError("Query label must be 1–160 characters")
            maximum=body.get("maxBytes",64*1024*1024)
            if type(maximum)is not int or not 1024<=maximum<=MAX_SOURCE:raise InputError("Choose a complete response byte budget from1KiB to256MiB")
            query={"schema":"stellar-forge.erddap-query.v1","server":meta["server"],"datasetId":meta["datasetId"],"protocol":meta["protocol"],
                   "metadataId":meta["id"],"selection":sel,"label":label,"maxBytes":maximum,
                   "semanticSha256":semantic_signature(meta["metadata"],sel)}
            qid=source.sha(json_bytes(query))
            with self.db:self.db.execute("INSERT OR IGNORE INTO erddap_queries VALUES(?,?,?)",(qid,json_bytes(query).decode(),time.time()))
            return {"id":qid,"query":query,"decodedQuery":source.query_text(sel,meta["protocol"]),"urls":source.urls(meta["server"],meta["datasetId"],meta["protocol"],sel)}

    def query_plan(self,qid):
        with self.mutex:
            row=self.db.execute("SELECT body FROM erddap_queries WHERE id=?",(ident(qid),)).fetchone()
            if row is None:raise InputError("Unknown saved query")
            body=load_json(row["body"])
            if source.sha(json_bytes(body))!=qid:raise InputError("Saved query identity changed")
            return {"id":qid,"query":body,"decodedQuery":source.query_text(body["selection"],body["protocol"]),
                    "urls":source.urls(body["server"],body["datasetId"],body["protocol"],body["selection"])}

    def operation(self,operation_id):
        if not isinstance(operation_id,str)or not OP.fullmatch(operation_id):raise InputError("Use a stable short original acquisition operation ID")
        with self.mutex:
            row=self.db.execute("SELECT body FROM erddap_operations WHERE id=?",(operation_id,)).fetchone()
            if row is None:raise InputError("Unknown original acquisition operation")
            return load_json(row["body"])

    def _save_operation(self,body):
        atomic(self.root/"acquisitions"/body["id"]/"operation.json",json_bytes(body))
        with self.db:self.db.execute("INSERT INTO erddap_operations VALUES(?,?,?,?) ON CONFLICT(id)DO UPDATE SET body=excluded.body,updated=excluded.updated",
            (body["id"],json_bytes(body).decode(),body["created"],time.time()))

    def acquire(self,query_id,operation_id,label=None):
        if not isinstance(operation_id,str)or not OP.fullmatch(operation_id):raise InputError("Save the acquisition operation ID before sending")
        if label is not None and(not isinstance(label,str)or not label.strip()or len(label)>160):raise InputError("Acquisition label must be short text")
        with self.mutex:
            selected=self.query_plan(query_id);query=selected["query"]
            folder=self._folder("acquisitions",operation_id)
            request={"queryId":query_id,"label":label or query["label"]}
            request_hash=source.sha(json_bytes(request))
            retained(folder/"request.json",json_bytes(request))
            row=self.db.execute("SELECT body FROM erddap_operations WHERE id=?",(operation_id,)).fetchone()
            if row:op=load_json(row["body"])
            elif(folder/"operation.json").exists():op=load_json((folder/"operation.json").read_bytes())
            else:op={"schema":"stellar-forge.erddap-acquisition.v1","id":operation_id,"queryId":query_id,"requestSha256":request_hash,"created":time.time(),"status":"prepared","responses":{}}
            if op.get("requestSha256")!=request_hash or op.get("queryId")!=query_id:raise InputError("Original acquisition belongs to another reviewed request")
            if op["status"]=="complete":
                retained_source=self.source(op["sourceId"])
                if source.sha((self.root/"sources"/(retained_source["id"]+".erddap")).read_bytes())!=retained_source["id"]:raise InputError("Accepted original source changed")
                return {"operationId":operation_id,"source":retained_source,"metadataChanged":op.get("metadataChanged",False),"replayed":True}
            op.update(status="acquiring",lastError=None);self._save_operation(op)
            try:
                urls=selected["urls"]
                for name in ["metadata.json","dataset.dds","dataset.das"]:
                    op["responses"][name]=fetch(folder,name,urls[name],min(query["maxBytes"],8*1024*1024));self._save_operation(op)
                actual=source.metadata((folder/"metadata.json").read_bytes(),query["datasetId"],(folder/"dataset.dds").read_bytes())
                source.selection(query["selection"],query["protocol"],actual)
                if semantic_signature(actual,query["selection"])!=query["semanticSha256"]:
                    e=InputError("Provider variable semantics or license changed since query review; inspect fresh metadata and save a new query");e.status=409;raise e
                op["metadataChanged"]=actual["metadataSha256"]!=self.metadata_item(query["metadataId"])["metadata"]["metadataSha256"]
                for name in ["data.json","data.csv"]:
                    op["responses"][name]=fetch(folder,name,urls[name],query["maxBytes"]);self._save_operation(op)
                manifest={"schema":source.SCHEMA,"server":query["server"],"datasetId":query["datasetId"],"protocol":query["protocol"],
                    "selection":query["selection"],"query":source.encode_query(query["selection"],query["protocol"]),
                    "completeness":"complete-response-for-explicit-selection","files":op["responses"],
                    "canonicalData":"data.json","comparisonData":"data.csv"}
                atomic(folder/"manifest.json",json_bytes(manifest))
                packet=folder/"source.erddap.zip";pending=folder/"source.erddap.zip.partial"
                with zipfile.ZipFile(pending,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6)as z:
                    for name in ["manifest.json"]+sorted(source.FILES):
                        info=zipfile.ZipInfo(name,(2000,1,1,0,0,0));info.create_system=3;info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_DEFLATED
                        z.writestr(info,(folder/name).read_bytes(),compresslevel=6)
                os.chmod(pending,0o600);os.replace(pending,packet);_original.sync_dir(folder)
                with packet.open("rb")as f:added=self.add_source(f,request["label"],query["datasetId"]+".erddap.zip")
                op.update(status="complete",sourceId=added["id"],completedAt=now(),lastError=None);self._save_operation(op)
                return {"operationId":operation_id,"source":added,"metadataChanged":op["metadataChanged"],"replayed":False}
            except Exception as e:
                op.update(status="failed",lastError={"type":type(e).__name__,"message":str(e),"providerStatus":getattr(e,"provider_status",None),"retryAfter":getattr(e,"retry_after",None)},updatedAt=now())
                self._save_operation(op);raise

    def source_rows(self,sid,offset=0,limit=100):
        with self.mutex:
            self.source(sid);path=self.root/"sources"/(ident(sid)+".erddap")
            if source.sha(path.read_bytes())!=sid:raise InputError("Original source bytes changed")
            with path.open("rb")as f:return source.preview(f,offset,limit)

    def source_member(self,sid,name):
        if name not in source.FILES|{"manifest.json"}:raise InputError("Unknown original response member")
        with self.mutex:
            self.source(sid);path=self.root/"sources"/(ident(sid)+".erddap")
            if source.sha(path.read_bytes())!=sid:raise InputError("Original source bytes changed")
            with zipfile.ZipFile(path)as z:return z.read(name)

    def default_mapping(self,sid,name=None):
        return source.default_plan(self.source(sid)["inventory"],name)

    def changes(self,comparison_id,offset=0,limit=100):
        return self.comparison_page(comparison_id,offset,limit)
