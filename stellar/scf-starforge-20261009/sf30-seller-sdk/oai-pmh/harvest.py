"""MIT. Durable OAI requests and full continuation in the original XML workspace."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import io
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from bridge import xml, storage, InputError
from protocol import base_url, request_url, parse_page, date, same_request_url

SCHEMA = "stellar-forge.oai-pmh-workspace.v1"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
stamp = lambda: datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
jbytes, decode, sha = storage.json_bytes, storage.load_json, storage.digest

def plain(value, label, maximum=4096):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise InputError("Supply " + label)
    return value

def page_values(offset, limit):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
        raise InputError("Choose a page of 1–200 rows and a nonnegative offset")
    return offset, limit

class HarvestWorkspace:
    def __init__(self, root, create=False):
        self.xml = storage.Workspace(root, create=create)
        self.root, self.db, self.mutex = self.xml.root, self.xml.db, self.xml.mutex
        self.area = self.root / "oai"
        self.area.mkdir(mode=0o700, exist_ok=True)
        for name in ("http", "builds", "tmp"):
            p = self.area / name
            p.mkdir(mode=0o700, exist_ok=True)
            if p.is_symlink(): raise InputError("OAI directories must be real directories")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS oai_repositories(id TEXT PRIMARY KEY,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS oai_operations(id TEXT PRIMARY KEY,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS oai_requests(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,
                attempt INTEGER NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,
                UNIQUE(operation_id,attempt,ordinal));
            CREATE TABLE IF NOT EXISTS oai_http_exchanges(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS oai_observations(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,
                attempt INTEGER NOT NULL,request_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
                identifier TEXT NOT NULL,datestamp TEXT NOT NULL,status TEXT NOT NULL,
                semantic_hash TEXT NOT NULL,body TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS oai_observation_selection ON oai_observations(operation_id,attempt,identifier,datestamp);
            CREATE TABLE IF NOT EXISTS oai_catalog(repository_id TEXT NOT NULL,kind TEXT NOT NULL,
                name TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,
                PRIMARY KEY(repository_id,kind,name));
            CREATE TABLE IF NOT EXISTS oai_previews(id TEXT PRIMARY KEY,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS oai_candidates(preview_id TEXT NOT NULL,identifier TEXT NOT NULL,
                before_id TEXT,after_id TEXT,kind TEXT NOT NULL,conflicts TEXT NOT NULL,
                PRIMARY KEY(preview_id,identifier));
            CREATE TABLE IF NOT EXISTS oai_editions(id TEXT PRIMARY KEY,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS oai_edition_records(edition_id TEXT NOT NULL,identifier TEXT NOT NULL,
                observation_id TEXT NOT NULL,PRIMARY KEY(edition_id,identifier));
            CREATE TABLE IF NOT EXISTS oai_builds(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        """)
        with self.db:
            for row in self.db.execute("SELECT id,body FROM oai_operations").fetchall():
                op = decode(row["body"])
                if op["status"] == "FETCHING":
                    op["status"] = "READY"
                    op["lastError"] = "Previous process ended during the retained read; resume its same request"
                    self._put("oai_operations", op)
        self.cancel = threading.Event()
        self.active = None

    def close(self):
        self.cancel.set()
        self.xml.close()

    def _get(self, table, identity):
        row = self.db.execute("SELECT body FROM " + table + " WHERE id=?", (identity,)).fetchone()
        if row is None: raise InputError("Retained object was not found: " + str(identity))
        return decode(row["body"])

    def _put(self, table, value):
        self.db.execute("INSERT INTO " + table + "(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                        (value["id"], jbytes(value).decode()))
        return value

    def repository(self, identity):
        with self.mutex: return self._get("oai_repositories", identity)

    def operation(self, identity):
        with self.mutex: return self._get("oai_operations", identity)

    def add_repository(self, url, label=None, interval=2.1):
        url = base_url(url)
        if type(interval) not in (int, float) or not 0 <= interval <= 3600:
            raise InputError("Request spacing must be 0–3600 seconds")
        ident = sha(url.encode())
        with self.mutex, self.db:
            existing = self.db.execute("SELECT body FROM oai_repositories WHERE id=?", (ident,)).fetchone()
            if existing: return decode(existing["body"])
            return self._put("oai_repositories", {"id": ident, "baseURL": url,
                "label": plain(label or url, "a repository name", 256), "interval": interval,
                "createdAt": stamp(), "identify": None, "formatsComplete": False,
                "setsComplete": False, "setsSupported": None, "nextRequestAt": 0})

    def catalog(self, repository, kind, offset=0, limit=100):
        page_values(offset, limit)
        if kind not in {"formats", "sets"}: raise InputError("Choose formats or sets")
        with self.mutex:
            total = self.db.execute("SELECT COUNT(*) FROM oai_catalog WHERE repository_id=? AND kind=?", (repository,kind)).fetchone()[0]
            rows = self.db.execute("SELECT name,request_id,body FROM oai_catalog WHERE repository_id=? AND kind=? ORDER BY name LIMIT ? OFFSET ?",
                                   (repository,kind,limit,offset)).fetchall()
            return {"total": total, "offset": offset, "limit": limit,
                    "next": offset+len(rows) if offset+len(rows)<total else None,
                    "items": [{"name":r["name"],"requestId":r["request_id"],"value":decode(r["body"])} for r in rows]}

    def start(self, repository_id, verb, arguments, operation_id, baseline=None):
        if not isinstance(operation_id, str) or not IDENTIFIER.fullmatch(operation_id):
            raise InputError("Use a stable operation ID of 1–128 letters, numbers, dots, colons, dashes or underscores")
        repo = self.repository(repository_id)
        request_url(repo["baseURL"], verb, arguments)
        if "resumptionToken" in arguments:
            raise InputError("Start with the original selection; tokens are continued from retained responses")
        if baseline is not None:
            if verb != "ListRecords": raise InputError("A record edition baseline belongs to ListRecords")
            prior=self._get("oai_editions",baseline)
            if prior["repository"]["id"]!=repository_id or prior["selection"].get("metadataPrefix")!=arguments.get("metadataPrefix") or prior["selection"].get("set")!=arguments.get("set"):
                raise InputError("Choose a baseline for the same repository, metadata format and set")
        if verb in {"ListRecords", "ListIdentifiers", "GetRecord"}:
            if not repo["identify"] or not repo["formatsComplete"]:
                raise InputError("Complete Identify and ListMetadataFormats for this repository first")
            formats = self.db.execute("SELECT 1 FROM oai_catalog WHERE repository_id=? AND kind='formats' AND name=?",
                                     (repository_id,arguments["metadataPrefix"])).fetchone()
            if not formats: raise InputError("Choose a metadataPrefix returned by this repository")
            for key in ("from", "until"):
                if key in arguments and len(arguments[key])==20 and repo["identify"]["granularity"]=="YYYY-MM-DD":
                    raise InputError("This repository accepts day-granularity selections")
            if arguments.get("set") and repo.get("setsSupported") is False:
                raise InputError("This repository declared no set hierarchy")
        scope = {"repositoryId": repository_id, "verb": verb, "selection": arguments, "baseline": baseline}
        with self.mutex, self.db:
            existing = self.db.execute("SELECT body FROM oai_operations WHERE id=?", (operation_id,)).fetchone()
            if existing:
                op = decode(existing["body"])
                if any(op[k] != v for k,v in scope.items()):
                    raise InputError("This operation ID already belongs to a different selection")
                return op
            return self._put("oai_operations", {"schema":"stellar-forge.oai-pmh-operation.v1","id":operation_id,
                **scope,"repositorySnapshot":repo,"createdAt":stamp(),"status":"READY","attempt":1,"pageCount":0,
                "nextArguments":dict(arguments),"token":None,"revision":0,"cooldownUntil":0,"lastError":None})

    def _begin(self, operation_id, already_captured=False):
        op = self.operation(operation_id)
        if op["status"] == "COMPLETE": return op, None
        if op["status"] in {"TOKEN_EXPIRED", "RESTART_REQUIRED"}:
            raise InputError("Restart this operation's original selection to replace its expired continuation")
        if op["status"] == "PROTOCOL_ERROR": raise InputError(op.get("lastError") or "Review the OAI protocol error")
        repo = self.repository(op["repositoryId"])
        wait_until = max(repo.get("nextRequestAt",0),op.get("cooldownUntil",0))
        if wait_until > time.time() and not already_captured:
            return {**op,"waitUntil":wait_until}, None
        ordinal = op["pageCount"] + 1
        request_id = sha(jbytes([operation_id,op["attempt"],ordinal]))
        request = {"id":request_id,"operationId":operation_id,"attempt":op["attempt"],"ordinal":ordinal,
                   "verb":op["verb"],"arguments":op["nextArguments"],
                   "url":request_url(repo["baseURL"],op["verb"],op["nextArguments"]),"state":"STARTED","startedAt":stamp()}
        with self.mutex, self.db:
            previous = self.db.execute("SELECT body FROM oai_requests WHERE id=?", (request_id,)).fetchone()
            if previous:
                retained = decode(previous["body"])
                if retained.get("state")=="PARSED": raise InputError("A parsed response awaits operation recovery")
                request["exchange"] = retained.get("exchange",1)+1
            else: request["exchange"] = 1
            self.db.execute("INSERT INTO oai_requests VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                            (request_id,operation_id,op["attempt"],ordinal,jbytes(request).decode()))
            self._save_request(request)
            op.update(status="FETCHING",revision=op["revision"]+1,lastError=None)
            self._put("oai_operations",op)
            repo["nextRequestAt"] = time.time()+repo["interval"]
            self._put("oai_repositories",repo)
        return op, request

    def _save_request(self, request):
        exchange_id=sha(jbytes([request["id"],request.get("exchange",1)]))
        self.db.execute("INSERT INTO oai_http_exchanges VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                        (exchange_id,request["id"],jbytes(request).decode()))
        self.db.execute("UPDATE oai_requests SET body=? WHERE id=?", (jbytes(request).decode(),request["id"]))

    def ingest(self, operation_id, filename, requested_url, status=200, headers=None,
               final_url=None, observed_at=None, prepared=None):
        """Import a real response from this host or an equipped source-acquisition host."""
        op, req = prepared if prepared is not None else self._begin(operation_id,already_captured=True)
        if req is None: raise InputError("This operation is complete or waiting for its recorded request time")
        if not same_request_url(requested_url,req["url"]): raise InputError("The captured response URL differs from this operation's next request")
        req["plannedURL"],req["url"]=req["url"],requested_url
        path = Path(filename)
        if not path.is_file() or path.is_symlink() or path.stat().st_size > xml.MAX_SOURCE:
            raise InputError("Use a complete response file within 256 MiB")
        if type(status) is not int or not 100 <= status <= 599:
            raise InputError("Supply the observed HTTP status")
        pairs = list(headers or [])
        if any(not isinstance(x,(list,tuple)) or len(x)!=2 or any(not isinstance(v,str) for v in x) for x in pairs):
            raise InputError("HTTP headers must be retained name/value pairs")
        body = path.read_bytes()
        body_sha = sha(body)
        source = None
        parsed = None
        parse_error = None
        if 200 <= status < 300:
            try:
                parsed = parse_page(io.BytesIO(body),op["verb"])
                source = self.xml.add_source(io.BytesIO(body),"OAI "+operation_id+" page "+str(req["ordinal"]),body_sha+".xml")
                source = source["id"]
            except InputError as error: parse_error = str(error)
        if source:
            relative = "sources/"+source+".xml"
        else:
            destination = self.area/"http"/(body_sha+".bin")
            if not destination.exists(): storage.private_write(destination,body)
            elif storage.file_digest(destination) != body_sha: raise InputError("Retained HTTP bytes changed")
            relative = "oai/http/"+body_sha+".bin"
        req.update(state="RECEIVED",observedAt=observed_at or stamp(),
                   http={"status":status,"headers":pairs,"finalURL":final_url or requested_url},
                   response={"path":relative,"sha256":body_sha,"bytes":len(body),"xmlSourceId":source})
        with self.mutex, self.db:
            self._save_request(req)
            op["lastResponseId"]=req["id"]
            if status in (429,503):
                delays = []
                for k,v in pairs:
                    if k.lower()=="retry-after":
                        try: delays.append(max(0,int(v)))
                        except ValueError:
                            try: delays.append(max(0,parsedate_to_datetime(v).timestamp()-time.time()))
                            except (TypeError,ValueError,OverflowError): pass
                delay = max(delays or [30])
                op.update(status="COOLDOWN",cooldownUntil=time.time()+delay,lastError="HTTP "+str(status))
            elif not 200 <= status < 300:
                op.update(status="RESTART_REQUIRED" if status==422 and "resumptionToken" in req["arguments"] else "HTTP_ERROR",
                          lastError="HTTP "+str(status))
            elif parse_error:
                op.update(status="RESPONSE_ERROR",lastError=parse_error)
            else:
                import hashlib
                record_digest=hashlib.sha256()
                def receive(ordinal,value):
                    if op["verb"] not in {"ListRecords","GetRecord","ListIdentifiers"}: return
                    record_digest.update(jbytes(value))
                    expected = op["selection"].get("metadataPrefix")
                    if value["status"]=="deleted" and self.repository(op["repositoryId"])["identify"]["deletedRecord"]=="no":
                        raise InputError("This record conflicts with the repository declaration that deletions are never exposed")
                    if len(value["datestamp"]) != (10 if self.repository(op["repositoryId"])["identify"]["granularity"]=="YYYY-MM-DD" else 20):
                        raise InputError("The record datestamp differs from the repository's declared granularity")
                    identity = sha(jbytes([req["id"],ordinal]))
                    semantic = sha(jbytes({k:v for k,v in value.items() if k!="identifier"}))
                    document = {**value,"id":identity,"repositoryId":op["repositoryId"],"metadataPrefix":expected,
                                "sourceId":source,"requestId":req["id"],"ordinal":ordinal,"semanticHash":semantic}
                    self.db.execute("INSERT OR REPLACE INTO oai_observations VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (identity,operation_id,op["attempt"],req["id"],ordinal,value["identifier"],
                         value["datestamp"],value["status"],semantic,jbytes(document).decode()))
                before_parse=dict(op)
                try:
                    # This pass streams record observations into the same transaction.
                    parsed = parse_page(io.BytesIO(body),op["verb"],receive)
                    if not parsed["errors"] and parsed["request"]["arguments"] != {"verb":op["verb"],**req["arguments"]}:
                        raise InputError("OAI request echo does not match this retained selection or continuation")
                    req.update(state="PARSED",parsed=parsed,recordDigest=record_digest.hexdigest())
                    errors = {x["code"] for x in parsed["errors"]}
                    empty = errors=={"noRecordsMatch"} and op["verb"] in {"ListRecords","ListIdentifiers"}
                    no_sets = errors=={"noSetHierarchy"} and op["verb"]=="ListSets"
                    if errors and not empty and not no_sets:
                        op.update(status="TOKEN_EXPIRED" if "badResumptionToken" in errors else "PROTOCOL_ERROR",
                                  lastError="; ".join(x["code"]+": "+x["message"] for x in parsed["errors"]))
                    else:
                        token=parsed["token"]
                        op.update(pageCount=req["ordinal"],token=token,cooldownUntil=0,lastError=None)
                        if token and token["value"]:
                            if req["arguments"].get("resumptionToken")==token["value"] and op.get("lastPageDigest")==sha(jbytes([req["recordDigest"],parsed["items"],token["value"]])):
                                raise InputError("Repository repeated the same continuation with the same record page")
                            op.update(status="READY",nextArguments={"resumptionToken":token["value"]})
                        else:
                            op.update(status="COMPLETE",completedAt=stamp(),nextArguments=None)
                        op["lastPageDigest"]=sha(jbytes([req["recordDigest"],parsed["items"],token["value"] if token else None]))
                        self._catalog_response(op,req,parsed,no_sets)
                except InputError as error:
                    self.db.execute("DELETE FROM oai_observations WHERE request_id=?", (req["id"],))
                    req.update(state="RESPONSE_ERROR",parseError=str(error))
                    op=before_parse
                    op.update(status="RESPONSE_ERROR",lastError=str(error))
                self._save_request(req)
            op["revision"] += 1
            self._put("oai_operations",op)
        return self.operation(operation_id)

    def _catalog_response(self,op,request,parsed,no_sets):
        repo=self.repository(op["repositoryId"])
        if op["verb"]=="Identify" and "identify" in parsed:
            repo.update(identify=parsed["identify"],identifyRequestId=request["id"])
        if op["verb"]=="ListMetadataFormats" and op["selection"].get("identifier"): return
        kind="formats" if op["verb"]=="ListMetadataFormats" else "sets" if op["verb"]=="ListSets" else None
        if kind:
            if request["ordinal"]==1:
                self.db.execute("DELETE FROM oai_catalog WHERE repository_id=? AND kind=?", (repo["id"],kind))
            for item in parsed["items"]:
                key=item["metadataPrefix"] if kind=="formats" else item["setSpec"]
                self.db.execute("INSERT OR REPLACE INTO oai_catalog VALUES(?,?,?,?,?)",
                                (repo["id"],kind,key,request["id"],jbytes(item).decode()))
            repo[kind+"Complete"]=op["status"]=="COMPLETE"
            repo[kind+"RequestIds"]=[r[0] for r in self.db.execute("SELECT id FROM oai_requests WHERE operation_id=? AND attempt=? ORDER BY ordinal",(op["id"],op["attempt"]))]
            if kind=="sets": repo["setsSupported"]=not no_sets
        self._put("oai_repositories",repo)

    def restart(self,operation_id,expected_revision):
        with self.mutex,self.db:
            op=self.operation(operation_id)
            if op["revision"]!=expected_revision or op["status"]=="FETCHING":
                raise InputError("Refresh this operation before restarting its retained selection")
            if op["status"]=="COMPLETE": raise InputError("This operation completed; create an explicit new harvest for a new edition")
            op.update(attempt=op["attempt"]+1,pageCount=0,status="READY",nextArguments=dict(op["selection"]),
                      token=None,cooldownUntil=0,revision=op["revision"]+1,lastError=None)
            return self._put("oai_operations",op)

    def fetch_next(self,operation_id):
        with self.mutex: op,req=self._begin(operation_id)
        if req is None: return op
        path=None
        try:
            request=Request(req["url"],headers={"Accept":"application/xml,text/xml;q=0.9,*/*;q=0.1",
                "Accept-Encoding":"identity","User-Agent":"Starforge-OAI-PMH/1.0 (operator-selected metadata harvest)"})
            try: response=urlopen(request,timeout=90)
            except HTTPError as e: response=e
            with response, tempfile.NamedTemporaryFile(dir=self.area/"tmp",delete=False) as out:
                path=Path(out.name)
                count=0
                while chunk:=response.read(65536):
                    if self.cancel.is_set(): raise InputError("Harvest cancelled after retaining earlier complete pages")
                    count+=len(chunk)
                    if count>xml.MAX_SOURCE: raise InputError("HTTP response exceeds the declared 256 MiB page limit")
                    out.write(chunk)
                out.flush();os.fsync(out.fileno())
                status=response.status
                headers=list(response.headers.raw_items())
                final_url=response.geturl()
            try: return self.ingest(operation_id,path,req["url"],status,headers,final_url,prepared=(op,req))
            finally: path.unlink(missing_ok=True)
        except (OSError,ValueError,InputError,URLError) as error:
            if path is not None: path.unlink(missing_ok=True)
            with self.mutex,self.db:
                req.update(state="READ_ERROR",endedAt=stamp(),error=str(error))
                self._save_request(req)
                op.update(status="CANCELLED" if self.cancel.is_set() else "READ_ERROR",lastError=str(error),
                          revision=op["revision"]+1)
                self._put("oai_operations",op)
            return op

    def run(self,operation_id):
        """Follow the entire native continuation; every page is a durable checkpoint."""
        with self.mutex:
            if self.active is not None: raise InputError("Another OAI harvest is running in this workspace")
            self.active=operation_id
        self.cancel.clear()
        try:
            while not self.cancel.is_set():
                op=self.operation(operation_id)
                if op["status"] in {"TOKEN_EXPIRED","RESTART_REQUIRED"}:
                    op=self.restart(operation_id,op["revision"])
                if op["status"]=="COMPLETE": return op
                if op["status"] in {"PROTOCOL_ERROR","RESPONSE_ERROR","HTTP_ERROR","READ_ERROR","CANCELLED"}:
                    return op
                repo=self.repository(op["repositoryId"])
                wait=max(op.get("cooldownUntil",0),repo.get("nextRequestAt",0))-time.time()
                if wait>0:
                    self.cancel.wait(min(wait,1));continue
                op=self.fetch_next(operation_id)
            return self.operation(operation_id)
        finally: self.active=None

    def resume(self,operation_id):
        with self.mutex,self.db:
            op=self.operation(operation_id)
            if op["status"] in {"READ_ERROR","CANCELLED","HTTP_ERROR","RESPONSE_ERROR"}:
                op.update(status="READY",revision=op["revision"]+1)
                self._put("oai_operations",op)
        return self.run(operation_id)

    def requests(self,operation_id,offset=0,limit=50):
        page_values(offset,limit)
        with self.mutex:
            total=self.db.execute("SELECT COUNT(*) FROM oai_requests WHERE operation_id=?", (operation_id,)).fetchone()[0]
            rows=self.db.execute("SELECT body FROM oai_requests WHERE operation_id=? ORDER BY attempt,ordinal LIMIT ? OFFSET ?",
                                 (operation_id,limit,offset)).fetchall()
            return {"items":[decode(r[0]) for r in rows],"total":total,"offset":offset,
                    "next":offset+len(rows) if offset+len(rows)<total else None}

    def history(self,kind,offset=0,limit=100):
        page_values(offset,limit)
        tables={"repositories":"oai_repositories","operations":"oai_operations","previews":"oai_previews",
                "editions":"oai_editions","builds":"oai_builds"}
        if kind not in tables: raise InputError("Unknown workspace history")
        with self.mutex:
            table=tables[kind]
            total=self.db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0]
            rows=self.db.execute("SELECT body FROM "+table+" ORDER BY rowid DESC LIMIT ? OFFSET ?",(limit,offset)).fetchall()
            return {"items":[decode(r[0]) for r in rows],"total":total,"offset":offset,
                    "next":offset+len(rows) if offset+len(rows)<total else None}

    def state(self):
        with self.mutex:
            histories={name:self.history(name,limit=50) for name in ("repositories","operations","previews","editions","builds")}
            return {"schema":SCHEMA,"directory":str(self.root),"active":self.active,
                    **{name:value["items"] for name,value in histories.items()},
                    "pages":{name:{k:v for k,v in value.items() if k!="items"} for name,value in histories.items()},
                    "mappings":[{"id":r["id"],"name":decode(r["body"])["name"]}
                                for r in self.db.execute("SELECT id,body FROM plans ORDER BY created DESC")]}
