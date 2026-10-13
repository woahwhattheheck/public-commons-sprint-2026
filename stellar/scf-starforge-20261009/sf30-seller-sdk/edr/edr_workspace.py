"""MIT. EDR acquisition and receiving on the original SF30 Workspace."""
from __future__ import annotations
import datetime, email.utils, hashlib, importlib.util, io, json, os, re, shutil, sqlite3, stat, sys, tempfile, threading, time, urllib.error, urllib.request, zipfile
from pathlib import Path
from urllib.parse import parse_qsl, urljoin, urlsplit
import edr_source as source

HERE=Path(__file__).resolve().parent
XML=HERE.parent/"xml"
if str(XML) not in sys.path:sys.path.insert(0,str(XML))
_MODULE="_sf30_edr_original_xml_workspace"
if _MODULE not in sys.modules:
    spec=importlib.util.spec_from_file_location(_MODULE,XML/"workspace.py")
    _original=importlib.util.module_from_spec(spec);sys.modules[_MODULE]=_original;spec.loader.exec_module(_original)
else:_original=sys.modules[_MODULE]
InputError=source.InputError
MAX_SOURCE=source.MAX_SOURCE
MAX_PACKET=source.MAX_PACKET
json_bytes=_original.json_bytes
load_json=_original.load_json
FORMAT=_original.SourceFormat("edr","EDR",source.inventory,source.validate_plan,source.extract,source.dataset_spec)
_TEMP_LOCK=threading.RLock()
SCHEMA="stellar-forge.edr-operation.v1"

def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z")
def digest(value):return hashlib.sha256(value).hexdigest()
def checked_id(value):
    if not isinstance(value,str) or not source.HEX.fullmatch(value):raise InputError("Expected a complete retained SHA256 identity")
    return value
def operation_id(value):
    if not isinstance(value,str) or not source.ID.fullmatch(value):raise InputError("Choose an explicit stable operation ID")
    return value

def atomic(path,value):
    path=Path(path)
    data=value if isinstance(value,bytes) else json_bytes(value)
    if path.exists() and (path.is_symlink() or not path.is_file()):raise InputError("Atomic destination is not a regular file")
    fd,temp=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    try:
        os.chmod(temp,0o600)
        with os.fdopen(fd,"wb") as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temp,path);_original.sync_dir(path.parent)
    finally:
        try:os.unlink(temp)
        except FileNotFoundError:pass

def retained(path,body):
    """Publish complete immutable bytes without leaving a partial destination."""
    path=Path(path)
    if path.exists():
        _original.regular(path,MAX_PACKET)
        if path.read_bytes()!=body:raise InputError("Retained immutable file contains different bytes")
        return
    fd,temp=tempfile.mkstemp(prefix="."+path.name+".",dir=path.parent)
    existed=False
    try:
        os.chmod(temp,0o600)
        with os.fdopen(fd,"wb") as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
        try:os.link(temp,path)
        except FileExistsError:existed=True
    finally:
        try:os.unlink(temp)
        except FileNotFoundError:pass
    if existed:
        _original.regular(path,MAX_PACKET)
        if path.read_bytes()!=body:raise InputError("Concurrent retained file contains different bytes")
    _original.sync_dir(path.parent)

def private_dir(path):
    path=Path(path)
    path.mkdir(mode=0o700,exist_ok=True)
    st=path.lstat()
    if not stat.S_ISDIR(st.st_mode) or path.is_symlink() or (os.name!="nt" and (st.st_uid!=os.geteuid() or st.st_mode&0o077)):
        raise InputError("Expected a private directory owned by this operator")
    return path

class ProviderError(InputError):
    def __init__(self,code,message,status=None,retry_at=None,document_id=None):
        super().__init__(message);self.code=code;self.status=status;self.retry_at=retry_at;self.document_id=document_id

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

class NativeEngine(_original.NativeEngine):
    def __init__(self,directory):super().__init__();self.directory=directory
    def _start(self):
        with _TEMP_LOCK:
            previous=tempfile.tempdir
            try:tempfile.tempdir=str(self.directory);return super()._start()
            finally:tempfile.tempdir=previous

class Workspace(_original.Workspace):
    def __init__(self,root,create=False):
        super().__init__(root,create=create,source_format=FORMAT)
        try:
            self.native.close();self.native=NativeEngine(self.root/"tmp")
            for name in ("connections","queries","documents","operations","packet-exports"):private_dir(self.root/name)
            self.db.executescript("""
              CREATE TABLE IF NOT EXISTS edr_connections(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS edr_queries(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS edr_documents(id TEXT PRIMARY KEY,receipt TEXT NOT NULL,created REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS edr_operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,request_sha256 TEXT NOT NULL,created REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS edr_cooldowns(connection_id TEXT PRIMARY KEY,until_time REAL NOT NULL,body TEXT NOT NULL);
            """)
            self.provider_lock=threading.RLock()
            self.active_lock=threading.Lock();self.active=set()
        except Exception:super().close();raise

    def close(self):
        lock=getattr(self,"provider_lock",None)
        if lock is None:return super().close()
        with lock:super().close()

    def save_connection(self,raw):
        source.exact(raw,{"name","baseUrl","allowedOrigins","authorizationEnv"},"connection",{"name","baseUrl"})
        base=source.base_url(raw["baseUrl"])
        variable=raw.get("authorizationEnv")
        if variable is not None and (not isinstance(variable,str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}",variable)):
            raise InputError("Authorization must name an existing host environment variable")
        body={"name":source.text(raw["name"],"Connection name",160),"baseUrl":base,
            "allowedOrigins":source.origin_list(base,raw.get("allowedOrigins",[])),"authorizationEnv":variable}
        data=json_bytes(body);ident=digest(data)
        with self.mutex:
            retained(self.root/"connections"/(ident+".json"),data)
            with self.db:self.db.execute("INSERT OR IGNORE INTO edr_connections VALUES(?,?,?)",(ident,data.decode(),time.time()))
            return self.connection(ident)

    def connection(self,ident):
        checked_id(ident)
        with self.mutex:
            row=self.db.execute("SELECT * FROM edr_connections WHERE id=?",(ident,)).fetchone()
            if row is None:raise InputError("Unknown retained connection")
            path=self.root/"connections"/(ident+".json");_original.regular(path,65536)
            raw=path.read_bytes()
            if digest(raw)!=ident or raw.decode()!=row["body"]:raise InputError("Retained connection changed")
            body=load_json(raw)
            return {"id":ident,**body,"authentication":"environment" if body["authorizationEnv"] else "none","created":row["created"]}

    def _resource(self,connection,resource):
        return source.url(resource,connection["baseUrl"],connection["allowedOrigins"])

    def save_query(self,raw):
        allowed={"schema","connectionId","name","collectionUrl","queryType","queryUrl","params","limits","rights","tileSet"}
        source.exact(raw,allowed,"EDR acquisition query",{"schema","connectionId","name","collectionUrl","queryType","queryUrl"})
        if raw["schema"]!=source.QUERY_SCHEMA:raise InputError("Expected "+source.QUERY_SCHEMA)
        conn=self.connection(raw["connectionId"]);kind=raw["queryType"]
        if not isinstance(kind,str) or kind not in source.QUERY_TYPES:raise InputError("Choose a supported advertised EDR query type")
        body={"schema":source.QUERY_SCHEMA,"connectionId":conn["id"],"name":source.text(raw["name"],"Query name",160),
            "collectionUrl":self._resource(conn,raw["collectionUrl"]),"queryType":kind,"queryUrl":self._resource(conn,raw["queryUrl"]),
            "params":source.parameters(raw.get("params",[])),"tileSet":source.integer(raw.get("tileSet",0),0,1000,"tileSet")}
        limits=raw.get("limits",{})
        source.exact(limits,{"maxPages","maxRows","maxBytes","maxLinkedDocuments"},"EDR acquisition limits")
        body["limits"]={"maxPages":source.integer(limits.get("maxPages",16),1,source.MAX_PAGES,"maxPages"),
            "maxRows":source.integer(limits.get("maxRows",100000),1,source.MAX_ROWS,"maxRows"),
            "maxBytes":source.integer(limits.get("maxBytes",64*1024*1024),1024,MAX_SOURCE-2*1024*1024,"maxBytes"),
            "maxLinkedDocuments":source.integer(limits.get("maxLinkedDocuments",128),0,source.MAX_LINKED,"maxLinkedDocuments")}
        rights=raw.get("rights",{});source.exact(rights,{"license","attribution","usage","sourceUrl"},"source rights")
        body["rights"]={key:source.text(rights[key],"Rights "+key,8192,True) if rights.get(key)is not None else None
            for key in ("license","attribution","usage","sourceUrl")}
        data=json_bytes(body)
        if len(data)>65536:raise InputError("EDR query exceeds 64 KiB")
        ident=digest(data)
        with self.mutex:
            retained(self.root/"queries"/(ident+".json"),data)
            with self.db:self.db.execute("INSERT OR IGNORE INTO edr_queries VALUES(?,?,?)",(ident,data.decode(),time.time()))
            return {"id":ident,"query":body}

    def query_definition(self,ident):
        checked_id(ident)
        with self.mutex:
            row=self.db.execute("SELECT body FROM edr_queries WHERE id=?",(ident,)).fetchone()
            if row is None:raise InputError("Unknown acquisition query")
            path=self.root/"queries"/(ident+".json");_original.regular(path,65536);raw=path.read_bytes()
            if digest(raw)!=ident or raw.decode()!=row["body"]:raise InputError("Retained acquisition query changed")
            return load_json(raw)

    def _op_path(self,ident):
        return self.root/"operations"/operation_id(ident)

    def _prepare(self,ident,kind,request):
        path=self._op_path(ident);data=json_bytes(request)
        if len(data)>131072:raise InputError("Operation request exceeds supported size")
        with self.mutex:
            private_dir(path);private_dir(path/"steps");private_dir(path/"attempts")
            retained(path/"request.json",data)
            state_path=path/"state.json"
            if state_path.exists():
                state=load_json(state_path.read_bytes())
                if state.get("kind")!=kind or state.get("requestSha256")!=digest(data):
                    raise InputError("Operation ID already belongs to a different original request")
            else:
                atomic(state_path,{"schema":SCHEMA,"id":ident,"kind":kind,"status":"prepared","requestSha256":digest(data),
                    "progress":{},"result":None,"error":None,"updated":utc()})
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO edr_operations VALUES(?,?,?,?)",(ident,kind,digest(data),time.time()))
            return self.operation(ident)

    def operation(self,ident):
        path=self._op_path(ident)
        if not (path/"request.json").is_file() or not (path/"state.json").is_file():raise InputError("Unknown retained operation")
        _original.regular(path/"request.json",131072);_original.regular(path/"state.json",MAX_SOURCE)
        request=(path/"request.json").read_bytes();state=load_json((path/"state.json").read_bytes())
        if state.get("schema")!=SCHEMA or state.get("id")!=ident or state.get("requestSha256")!=digest(request):
            raise InputError("Retained operation identity changed")
        return {**state,"request":load_json(request)}

    def _state(self,ident,**changes):
        path=self._op_path(ident)
        current=self.operation(ident);current.pop("request",None);current.update(changes,updated=utc())
        atomic(path/"state.json",current)

    def _start_operation(self,ident):
        with self.active_lock:
            if ident in self.active:raise ProviderError("operation_running","The original operation is already running; read its retained status",409)
            self.active.add(ident)
    def _end_operation(self,ident):
        with self.active_lock:self.active.discard(ident)
    def _failure(self,ident,error):
        item={"code":getattr(error,"code","invalid_input" if isinstance(error,InputError) else "local_failure"),
            "message":str(error) if isinstance(error,InputError) else "Local operation failed; original files and request are retained",
            "status":getattr(error,"status",None),"retryAt":getattr(error,"retry_at",None),"documentId":getattr(error,"document_id",None),
            "type":type(error).__name__}
        try:self._state(ident,status="failed",error=item)
        except OSError:pass

    def _store_document(self,body,receipt):
        ident=digest(json_bytes({"schema":"stellar-forge.edr-document.v1","receipt":receipt}))
        with self.mutex:
            retained(self.root/"documents"/(ident+".json"),body)
            retained(self.root/"documents"/(ident+".receipt.json"),json_bytes(receipt))
            with self.db:self.db.execute("INSERT OR IGNORE INTO edr_documents VALUES(?,?,?)",(ident,json_bytes(receipt).decode(),time.time()))
        return ident

    def _document(self,ident,parse=True):
        checked_id(ident)
        with self.mutex:
            row=self.db.execute("SELECT receipt FROM edr_documents WHERE id=?",(ident,)).fetchone()
            receipt_path=self.root/"documents"/(ident+".receipt.json")
            if not receipt_path.is_file():raise InputError("Unknown retained provider document")
            _original.regular(receipt_path,65536);raw=receipt_path.read_bytes();receipt=load_json(raw)
            if digest(json_bytes({"schema":"stellar-forge.edr-document.v1","receipt":receipt}))!=ident:
                raise InputError("Original document receipt changed")
            if row is not None and row["receipt"]!=raw.decode():raise InputError("Document index differs from its original receipt")
            body_path=self.root/"documents"/(ident+".json");_original.regular(body_path,source.MAX_DOCUMENT);body=body_path.read_bytes()
            if len(body)!=receipt["bytes"] or digest(body)!=receipt["sha256"]:raise InputError("Original provider document changed")
            return {"id":ident,"receipt":receipt,"document":source.json_value(body,True) if parse else None,"body":body,"path":body_path}

    def document(self,ident):
        found=self._document(ident);return {key:found[key] for key in ("id","receipt","document")}
    def document_path(self,ident):return self._document(ident,False)["path"]

    def _cooldown(self,connection_id):
        with self.mutex:row=self.db.execute("SELECT * FROM edr_cooldowns WHERE connection_id=?",(connection_id,)).fetchone()
        if row and row["until_time"]>time.time():
            raise ProviderError("provider_cooldown","The provider's recorded retry deadline has not passed",429,datetime.datetime.fromtimestamp(row["until_time"],datetime.timezone.utc).isoformat())

    def _retry_at(self,value):
        if not value:return None
        try:
            if re.fullmatch(r"[0-9]+",value.strip()):return time.time()+int(value.strip())
            date=email.utils.parsedate_to_datetime(value)
            if date.tzinfo is None:date=date.replace(tzinfo=datetime.timezone.utc)
            return date.timestamp()
        except (ValueError,TypeError,OverflowError):return None

    def _http(self,connection,requested,attempt_path):
        requested=self._resource(connection,requested)
        self._cooldown(connection["id"])
        header=None
        if connection["authorizationEnv"]:
            header=os.environ.get(connection["authorizationEnv"])
            if not header:raise ProviderError("authorization_missing","Selected authorization environment variable is unavailable")
            if len(header)>16384 or "\n" in header or "\r" in header:raise InputError("Invalid selected authorization header")
        opener=urllib.request.build_opener(_NoRedirect())
        current=requested;redirects=[];started=utc()
        atomic(attempt_path,{"schema":"stellar-forge.edr-http-attempt.v1","requestUrl":requested,"startedAt":started,"status":"prepared"})
        try:
            for _ in range(6):
                self._resource(connection,current)
                headers={"Accept":"application/prs.coverage+json, application/vnd.cov+json, application/json;q=0.9","Accept-Encoding":"identity","User-Agent":"StellarForge-EDR/1.0"}
                if header and source.origin(current)==source.origin(connection["baseUrl"]):headers["Authorization"]=header
                req=urllib.request.Request(current,headers=headers,method="GET")
                try:response=opener.open(req,timeout=30)
                except urllib.error.HTTPError as error:response=error
                with response:
                    raw=response.read(source.MAX_DOCUMENT+1)
                    if len(raw)>source.MAX_DOCUMENT:raise ProviderError("response_limit","One provider response exceeds 32 MiB")
                    status=response.status
                    safe_headers={k.lower():v for k,v in response.headers.items() if k.lower() in source.RECEIPT_HEADERS}
                    final=self._resource(connection,response.url)
                    location=response.headers.get("Location")
                if status in {301,302,303,307,308}:
                    if not location:raise ProviderError("redirect_invalid","Provider redirect has no Location",status)
                    next_url=self._resource(connection,urljoin(final,location))
                    redirects.append({"requestUrl":current,"status":status,"location":next_url,"bodySha256":digest(raw),"bytes":len(raw)})
                    current=next_url;continue
                receipt={"requestUrl":requested,"finalUrl":final,"status":status,"headers":safe_headers,
                    "startedAt":started,"completedAt":utc(),"bytes":len(raw),"sha256":digest(raw),"redirects":redirects}
                ident=self._store_document(raw,receipt)
                atomic(attempt_path,{"schema":"stellar-forge.edr-http-attempt.v1","requestUrl":requested,"startedAt":started,
                    "status":"received","documentId":ident,"receipt":receipt})
                until=self._retry_at(safe_headers.get("retry-after"))
                if status in {429,503} and until is not None:
                    with self.mutex,self.db:
                        self.db.execute("INSERT INTO edr_cooldowns VALUES(?,?,?) ON CONFLICT(connection_id) DO UPDATE SET until_time=MAX(edr_cooldowns.until_time,excluded.until_time),body=excluded.body",
                            (connection["id"],until,json_bytes({"status":status,"documentId":ident}).decode()))
                if status!=200:
                    raise ProviderError("provider_http","Provider returned HTTP "+str(status),status,
                        datetime.datetime.fromtimestamp(until,datetime.timezone.utc).isoformat() if until else None,ident)
                source.json_value(raw,True)
                return self._document(ident)
            raise ProviderError("redirect_limit","Provider exceeded the redirect limit")
        except (urllib.error.URLError,TimeoutError,ConnectionError,OSError) as error:
            if isinstance(error,ProviderError):raise
            try:atomic(attempt_path,{"schema":"stellar-forge.edr-http-attempt.v1","requestUrl":requested,"startedAt":started,
                "completedAt":utc(),"status":"failed","errorType":type(error).__name__})
            except OSError:pass
            raise ProviderError("transport_failure","Original provider GET did not produce a retained successful response") from error

    def _get(self,ident,step,connection,request_url):
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}",step):raise InputError("Invalid acquisition step")
        path=self._op_path(ident);saved=path/"steps"/(step+".json")
        def verified(document_id):
            doc=self._document(document_id)
            if doc["receipt"]["requestUrl"]!=request_url or doc["receipt"]["status"]!=200:
                raise InputError("Retained HTTP document belongs to another request or failed response")
            return doc
        if saved.exists():
            _original.regular(saved,65536);record=load_json(saved.read_bytes())
            source.exact(record,{"requestUrl","documentId"},"retained HTTP step",{"requestUrl","documentId"})
            if record["requestUrl"]!=request_url:raise InputError("Retained HTTP step belongs to another original request")
            return verified(record["documentId"])
        candidates=[]
        for candidate in (path/"attempts").glob(step+"-*.json"):
            suffix=candidate.stem.rsplit("-",1)[1]
            if suffix.isdigit():candidates.append((int(suffix),candidate))
        # A received response can outlive interruption before its step record.
        # Bind the original complete receipt before issuing another provider GET.
        for _,candidate in sorted(candidates,reverse=True):
            _original.regular(candidate,131072);previous=load_json(candidate.read_bytes())
            if previous.get("schema")!="stellar-forge.edr-http-attempt.v1" or previous.get("requestUrl")!=request_url:
                raise InputError("Retained HTTP attempt belongs to another original request")
            if previous.get("status")!="received":continue
            receipt=previous.get("receipt")
            if not isinstance(receipt,dict):raise InputError("Received HTTP attempt omitted its original receipt")
            if receipt.get("status")!=200:continue
            doc=verified(previous.get("documentId"))
            if receipt!=doc["receipt"]:raise InputError("Received HTTP attempt differs from its verified original document")
            retained(saved,json_bytes({"requestUrl":request_url,"documentId":doc["id"]}))
            return doc
        attempt=path/"attempts"/(step+"-"+str(max((n for n,_ in candidates),default=0)+1).zfill(6)+".json")
        doc=self._http(connection,request_url,attempt)
        if doc["receipt"]["requestUrl"]!=request_url or doc["receipt"]["status"]!=200:
            raise InputError("Original HTTP response differs from this acquisition step")
        retained(saved,json_bytes({"requestUrl":request_url,"documentId":doc["id"]}))
        return doc

    def browse(self,connection_id,resource,params=None,operation_id=None):
        ident=globals()["operation_id"](operation_id);conn=self.connection(connection_id)
        request_url=source.query_url(self._resource(conn,resource),source.parameters(params))
        request={"connectionId":connection_id,"resource":self._resource(conn,resource),"params":source.parameters(params),"requestUrl":request_url}
        state=self._prepare(ident,"browse",request)
        if state["status"]=="complete":
            self._document(state["result"]["documentId"]);return state["result"]
        self._start_operation(ident)
        try:
            with self.provider_lock:
                self._state(ident,status="running",error=None,progress={"phase":"request"})
                doc=self._get(ident,"browse",conn,request_url);value=doc["document"]
                if not isinstance(value,dict):raise InputError("EDR discovery must return a JSON object")
                items=source.collection(value)
                next_url=source.next_link(value,doc["receipt"]["finalUrl"],conn["allowedOrigins"])
                result={"schema":"stellar-forge.edr-browse.v1","operationId":ident,"connectionId":connection_id,
                    "documentId":doc["id"],"requestUrl":request_url,"items":items,"links":value.get("links",[]),"nextUrl":next_url,
                    "numberMatched":value.get("numberMatched"),"numberReturned":len(items),
                    "resourceType":next((name for name in ("collections","instances","features","items") if name in value),"document"),
                    "document":value,"queryTypes":source.query_types(value,doc["receipt"]["finalUrl"],conn["allowedOrigins"])}
                self._state(ident,status="complete",result=result,error=None,progress={"phase":"complete"})
                return result
        except Exception as error:self._failure(ident,error);raise
        finally:self._end_operation(ident)

    def acquire(self,query_id,operation_id,label=None):
        ident=globals()["operation_id"](operation_id);query=self.query_definition(query_id);conn=self.connection(query["connectionId"])
        label=query["name"] if label is None else source.text(label,"Source label",160)
        request={"queryId":query_id,"label":label};state=self._prepare(ident,"acquire",request)
        if state["status"]=="complete":
            self.source(state["result"]["source"]["id"]);return state["result"]
        self._start_operation(ident)
        try:
            with self.provider_lock:
                self._state(ident,status="running",error=None,progress={"phase":"metadata","completedPages":0,"values":0})
                files={};resources={};receipts={};pages=[];linked={};linked_docs={};values=0;coverages=0
                def check_bytes():
                    if sum(r["bytes"] for r in receipts.values())>query["limits"]["maxBytes"]:raise InputError("Complete original responses exceed the selected maxBytes")
                def add(role,step,requested,name=None):
                    doc=self._get(ident,step,conn,requested);member=name or "resources/"+role+".json"
                    files[member]=doc["path"];receipts[member]=doc["receipt"]
                    if role:resources[role]=member
                    check_bytes();return doc
                metadata=add("collection","collection",query["collectionUrl"])
                source.validate_query_route(metadata["document"],metadata["receipt"]["finalUrl"],conn["allowedOrigins"],query)
                def load_link(requested):
                    requested=self._resource(conn,requested)
                    if requested not in linked_docs:
                        if len(linked_docs)>=query["limits"]["maxLinkedDocuments"]:raise InputError("CoverageJSON requires more linked documents than the explicit selected limit")
                        key=digest(requested.encode("utf-8"));member="linked/"+key+".json"
                        doc=add(None,"link-"+key[:58],requested,member)
                        linked[requested]=member;linked_docs[requested]={"document":doc["document"],"finalUrl":doc["receipt"]["finalUrl"]}
                    return linked_docs[requested]
                current=source.query_url(query["queryUrl"],query["params"]);visited=set()
                for number in range(1,query["limits"]["maxPages"]+1):
                    if current in visited:raise InputError("EDR paging repeats an original URL")
                    visited.add(current);member="coverages/"+str(number).zfill(6)+".json"
                    doc=add(None,"page-"+str(number).zfill(6),current,member)
                    parsed=source.CoverageDocument(doc["document"],doc["receipt"]["finalUrl"],conn["allowedOrigins"],load_link,query["tileSet"])
                    values+=parsed.total;coverages+=len(parsed.coverages);pages.append(member)
                    if values>query["limits"]["maxRows"]:raise InputError("A complete provider response exceeds selected maxRows; original bytes are retained for review")
                    current=source.next_link(doc["document"],doc["receipt"]["finalUrl"],conn["allowedOrigins"])
                    self._state(ident,progress={"phase":"coverage","completedPages":len(pages),"coverages":coverages,"values":values,"linkedDocuments":len(linked),"nextUrl":current})
                    if current is None:break
                selection={key:query[key] for key in ("collectionUrl","queryType","queryUrl","params","limits","tileSet")}
                coverage={"status":"exhausted" if current is None else "page-limit","pages":len(pages),"coverages":coverages,"values":values,
                    "linkedDocuments":len(linked),"nextUrl":current,"scope":"selected-query-response","consistency":"sequential-responses-not-transactional-snapshot"}
                manifest={"schema":source.SOURCE_SCHEMA,"endpoint":conn["baseUrl"],"allowedOrigins":conn["allowedOrigins"],"selection":selection,
                    "resources":resources,"pages":pages,"linked":linked,"coverage":coverage,"files":receipts,"rights":query["rights"]}
                destination=self._op_path(ident)/"source.zip"
                with self.scratch() as temp:
                    candidate=temp/"source.zip";_original.private_write(candidate,b"")
                    source.write_capture(manifest,files,candidate)
                    with candidate.open("rb") as stream:source.read_capture(stream)
                    with candidate.open("rb") as stream:os.fsync(stream.fileno())
                    if destination.exists():
                        _original.regular(destination,MAX_SOURCE)
                        if _original.file_digest(destination)!=_original.file_digest(candidate):raise InputError("Retained operation source differs from its completed original responses")
                    else:os.replace(candidate,destination);_original.sync_dir(destination.parent)
                self._state(ident,progress={"phase":"retaining-source","completedPages":len(pages),"values":values,"nextUrl":current})
                with destination.open("rb") as stream:retained_source=self.add_source(stream,label,"edr-source.zip")
                result={"schema":"stellar-forge.edr-acquisition.v1","operationId":ident,"queryId":query_id,"source":retained_source,"coverage":coverage}
                self._state(ident,status="complete",result=result,error=None,progress={"phase":"complete","completedPages":len(pages),"values":values,"nextUrl":current})
                return result
        except Exception as error:self._failure(ident,error);raise
        finally:self._end_operation(ident)

    def source_rows(self,ident,offset=0,limit=100):
        self.source(ident);path=self.root/"sources"/(checked_id(ident)+"."+self.kind)
        if _original.file_digest(path)!=ident:raise InputError("Retained source changed")
        with path.open("rb") as stream:return source.preview(stream,offset,limit)
    def source_files(self,ident):
        info=self.source(ident);shape=info["inventory"]
        return {"source":ident,"files":[{"name":name,"bytes":entry["bytes"],"sha256":entry["sha256"],
            "mediaType":entry["headers"].get("content-type","application/json"),"requestUrl":entry["requestUrl"],"status":entry["status"]}
            for name,entry in sorted(shape["files"].items())]}
    def source_file(self,ident,name):
        self.source(ident);path=self.root/"sources"/(checked_id(ident)+"."+self.kind)
        if _original.file_digest(path)!=ident:raise InputError("Retained source changed")
        with path.open("rb") as stream,source.Capture(stream) as capture:
            if name not in capture.manifest["files"]:raise InputError("Unknown exact source response member")
            body=capture.read(name);entry=capture.manifest["files"][name]
            return {"body":body,"mediaType":entry["headers"].get("content-type","application/json"),"name":name}
    def default_mapping(self,source_id,name=None):return source.default_plan(self.source(source_id)["inventory"],name)


    def records(self,collection,offset=0,limit=100,expected_view_sha256=None):
        """Page the entire retained inventory with an explicit view identity."""
        source.integer(offset,0,100000000,"offset");source.integer(limit,1,250,"limit")
        if expected_view_sha256 is not None:checked_id(expected_view_sha256)
        with self.mutex:
            if collection=="documents":
                values=[{"id":r["id"],**{k:v for k,v in load_json(r["receipt"]).items()
                    if k in {"requestUrl","status","bytes","sha256","completedAt"}}}
                    for r in self.db.execute("SELECT * FROM edr_documents ORDER BY created DESC,id")]
            elif collection=="operations":
                values=[]
                for r in self.db.execute("SELECT id FROM edr_operations ORDER BY created DESC,id"):
                    op=self.operation(r["id"]);values.append({k:v for k,v in op.items() if k!="result"})
            elif collection=="connections":
                values=[self.connection(r["id"]) for r in self.db.execute("SELECT id FROM edr_connections ORDER BY created DESC,id")]
            elif collection=="queries":
                values=[{"id":r["id"],**{k:v for k,v in load_json(r["body"]).items()
                    if k in {"name","connectionId","collectionUrl","queryType","limits"}},"created":r["created"]}
                    for r in self.db.execute("SELECT * FROM edr_queries ORDER BY created DESC,id")]
            elif collection in {"sources","plans","builds","comparisons"}:
                values=super().state()[collection]
            else:raise InputError("Unknown retained record collection")
            identity=digest(json_bytes(values))
            if offset>len(values) or (offset>0 and expected_view_sha256 is None) or (expected_view_sha256 is not None and expected_view_sha256!=identity):
                error=InputError("The retained collection view changed; reopen offset zero and use its viewSha256")
                error.code="EDR_COLLECTION_CHANGED";error.status=409;error.view_sha256=identity
                raise error
            items=values[offset:offset+limit]
            return {"schema":"stellar-forge.edr-records.v1","collection":collection,
                "viewSha256":identity,"total":len(values),"offset":offset,"returned":len(items),
                "nextOffset":offset+len(items) if offset+len(items)<len(values) else None,"items":items}

    def state(self):
        result=super().state()
        with self.mutex:
            result["connections"]=[self.connection(r["id"]) for r in self.db.execute("SELECT id FROM edr_connections ORDER BY created DESC")]
            result["queries"]=[{"id":r["id"],**{k:v for k,v in load_json(r["body"]).items() if k in {"name","connectionId","collectionUrl","queryType","limits"}},"created":r["created"]}
                for r in self.db.execute("SELECT * FROM edr_queries ORDER BY created DESC")]
            result["documents"]=[{"id":r["id"],**{k:v for k,v in load_json(r["receipt"]).items() if k in {"requestUrl","status","bytes","sha256","completedAt"}}}
                for r in self.db.execute("SELECT * FROM edr_documents ORDER BY created DESC LIMIT 200")]
            result["documentCount"]=self.db.execute("SELECT COUNT(*) FROM edr_documents").fetchone()[0]
            result["operations"]=[]
            for r in self.db.execute("SELECT * FROM edr_operations ORDER BY created DESC LIMIT 200"):
                op=self.operation(r["id"]);result["operations"].append({k:v for k,v in op.items() if k not in {"result"}})
            result["operationCount"]=self.db.execute("SELECT COUNT(*) FROM edr_operations").fetchone()[0]
            result["listCoverage"]={"documents":"latest 200; exact documents remain available by ID","operations":"latest 200; original operations remain available by ID"}
        return result


    def export_dataset(self,build_id,destination):
        """Retain an exact native projection and its source-specific seller lineage."""
        with self.mutex:
            view=self.build_view(build_id);original=self.source(view["source"])
            source_path=self.root/"sources"/(view["source"]+"."+self.kind)
            if _original.file_digest(source_path)!=view["source"]:raise InputError("Original capture changed before dataset export")
            shape=original["inventory"];plan=self.plan(view["plan"])
            basis={"schema":"stellar-forge.edr-series-identity.v1",
                "endpoint":shape["endpoint"],"collectionId":shape["collectionId"],
                "schemaSha256":shape["schemaSha256"],"mapping":view["plan"]}
            project={**basis,"id":digest(json_bytes(basis)),"title":plan["name"]}
            paths={name:self._build_path(build_id,name) for name in ("data.csv","dataset.json")}
            files={name:{"bytes":paths[name].stat().st_size,"sha256":_original.file_digest(paths[name])} for name in paths}
            if any(files[name]!=view["files"][name] for name in paths):raise InputError("Saved dataset differs from its original native build")
            lineage={"schema":"stellar-forge.edr-lineage.v1","build":view["id"],
                "project":project,"snapshot":view["native"]["snapshot"],"files":files,
                "sources":[{"id":original["id"],"bytes":original["bytes"],"name":original["name"],
                    "responses":shape["files"],"resources":shape["resources"],
                    "metadata":{"collectionId":shape["collectionId"],"title":shape["collection"].get("title"),
                        "schemaSha256":shape["schemaSha256"],"schemaIdentityPolicy":shape["schemaIdentityPolicy"],
                        "coverages":shape["coverages"],"sourceIssues":shape["sourceIssues"]},
                    "rights":shape["rights"]}],
                "selection":shape["selection"],"coverage":shape["coverage"],"duplicates":shape["duplicates"],
                "mapping":plan,"rowCount":view["rowCount"],"engineBlob":view["engineBlob"],
                "valuePolicy":shape["valuePolicy"],"created_at":original["created"]}
            body=json_bytes(lineage)
            if len(body)>8*1024*1024:raise InputError("Dataset lineage exceeds its complete merchant capacity; reduce the selected source window")
            destination=Path(destination).expanduser().absolute()
            if not destination.parent.is_dir():raise InputError("Select an existing dataset export parent")
            private_dir(destination)
            # This create-only lineage binds an interrupted export before any
            # file is installed. A matching retry fills only missing exact files.
            retained(destination/self.lineage_name,body)
            for name,path in paths.items():
                target=destination/name;expected=files[name]
                if target.exists():
                    _original.regular(target,MAX_SOURCE)
                    if target.stat().st_size!=expected["bytes"] or _original.file_digest(target)!=expected["sha256"]:
                        raise InputError("Dataset export contains a different original file")
                    continue
                fd,temp=tempfile.mkstemp(prefix=".edr-dataset-",dir=destination.parent)
                try:
                    os.chmod(temp,0o600)
                    with path.open("rb") as inp,os.fdopen(fd,"wb") as out:
                        h=hashlib.sha256();size=0
                        while block:=inp.read(65536):
                            size+=len(block)
                            if size>expected["bytes"]:raise InputError("Original native dataset changed during export")
                            h.update(block);out.write(block)
                        out.flush();os.fsync(out.fileno())
                    if size!=expected["bytes"] or h.hexdigest()!=expected["sha256"]:
                        raise InputError("Original native dataset changed during export")
                    try:os.link(temp,target)
                    except FileExistsError:
                        _original.regular(target,MAX_SOURCE)
                        if target.stat().st_size!=expected["bytes"] or _original.file_digest(target)!=expected["sha256"]:
                            raise InputError("Concurrent dataset export contains a different original file")
                finally:
                    try:os.unlink(temp)
                    except FileNotFoundError:pass
            _original.sync_dir(destination);_original.sync_dir(destination.parent)
            return {"directory":str(destination),"dataset":str(destination/"dataset.json"),"build":view,"lineage":lineage}

    def _packet_entries(self,build_id):
        view=self.build_view(build_id)
        paths={self.source_name:self.root/"sources"/(view["source"]+"."+self.kind),"plan.json":self.root/"plans"/(view["plan"]+".json"),
            "data.csv":self._build_path(build_id,"data.csv"),"dataset.json":self._build_path(build_id,"dataset.json"),"review.json":self._build_path(build_id,"review.json")}
        entries={name:{"bytes":_original.regular(path).st_size,"sha256":_original.file_digest(path)} for name,path in paths.items()}
        if entries[self.source_name]["sha256"]!=view["source"] or entries["plan.json"]["sha256"]!=view["plan"]:raise InputError("Original source or mapping changed")
        manifest={"schema":self.packet_schema,"build":build_id,"files":entries}
        return paths,manifest

    def _check_packet(self,path,manifest):
        _original.regular(path,MAX_PACKET)
        try:
            with zipfile.ZipFile(path) as archive:
                infos=archive.infolist()
                if len(infos)!=6 or {i.filename for i in infos}!=set(manifest["files"])|{"manifest.json"}:
                    raise InputError("Retained native packet member set changed")
                for info in infos:
                    if info.is_dir() or stat.S_ISLNK(info.external_attr>>16) or info.flag_bits&1 or info.compress_type not in {zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED}:
                        raise InputError("Invalid cached native packet member")
                    if info.filename=="manifest.json":
                        if info.file_size>16384 or archive.read(info)!=json_bytes(manifest):raise InputError("Retained packet manifest changed")
                        continue
                    expected=manifest["files"][info.filename]
                    if info.file_size!=expected["bytes"]:raise InputError("Retained packet length changed")
                    h=hashlib.sha256()
                    with archive.open(info) as stream:
                        while block:=stream.read(65536):h.update(block)
                    if h.hexdigest()!=expected["sha256"]:raise InputError("Retained packet bytes changed")
        except (zipfile.BadZipFile,OSError,EOFError) as error:raise InputError("Invalid retained native packet") from error

    def export_packet(self,build_id,output):
        output=Path(output)
        with self.mutex:
            paths,manifest=self._packet_entries(build_id);directory=self.root/"packet-exports";cache=directory/(build_id+".zip")
            if not cache.exists():
                with self.scratch() as temp:
                    candidate=temp/"packet.zip";_original.private_write(candidate,b"")
                    with candidate.open("w+b") as raw:
                        with zipfile.ZipFile(raw,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                            for name in sorted({"manifest.json",*paths}):
                                info=zipfile.ZipInfo(name,(2000,1,1,0,0,0));info.create_system=3;info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_DEFLATED
                                with archive.open(info,"w") as dest:
                                    if name=="manifest.json":dest.write(json_bytes(manifest))
                                    else:
                                        with paths[name].open("rb") as stream:shutil.copyfileobj(stream,dest,65536)
                        raw.flush();os.fsync(raw.fileno())
                    self._check_packet(candidate,manifest)
                    os.replace(candidate,cache);_original.sync_dir(directory)
            self._check_packet(cache,manifest)
            identity={"schema":"stellar-forge.edr-export.v1","build":build_id,"bytes":cache.stat().st_size,"sha256":_original.file_digest(cache,MAX_PACKET)}
            retained(directory/(build_id+".json"),json_bytes(identity))
            if output.absolute()!=cache.absolute():
                if output.exists():
                    _original.regular(output,MAX_PACKET)
                    if output.stat().st_size!=identity["bytes"] or _original.file_digest(output,MAX_PACKET)!=identity["sha256"]:raise InputError("Export destination contains different bytes")
                else:
                    fd,temp=tempfile.mkstemp(prefix="."+output.name+".",dir=output.parent)
                    existed=False
                    try:
                        os.chmod(temp,0o600)
                        with cache.open("rb") as inp,os.fdopen(fd,"wb") as out:
                            shutil.copyfileobj(inp,out,65536);out.flush();os.fsync(out.fileno())
                        if _original.file_digest(Path(temp),MAX_PACKET)!=identity["sha256"]:raise InputError("Staged packet export differs from the retained packet")
                        try:os.link(temp,output)
                        except FileExistsError:existed=True
                    finally:
                        try:os.unlink(temp)
                        except FileNotFoundError:pass
                    if existed:
                        _original.regular(output,MAX_PACKET)
                        if output.stat().st_size!=identity["bytes"] or _original.file_digest(output,MAX_PACKET)!=identity["sha256"]:
                            raise InputError("Concurrent export destination contains different bytes")
                    _original.sync_dir(output.parent)
            return {"file":str(output),"bytes":identity["bytes"],"sha256":identity["sha256"],"build":build_id}
