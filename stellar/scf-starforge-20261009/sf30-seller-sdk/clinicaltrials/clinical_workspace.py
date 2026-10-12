"""MIT. Registry cohorts and PRS review joined to the original retained source engine."""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import uuid

from clinical_shared import (HERE, SourceWorkspace, InputError, json_bytes, load_json,
                             private_write, file_digest, sync_dir, source_json)
import clinical_source as registry
import clinical_prs as prs
from clinical_package import PackageOperations
from clinical_batch import BatchOperations

VERSION = "stellar-forge.clinicaltrials-workspace.v1"
CAPTURE = "stellar-forge.clinicaltrials-capture.v1"
SHA = re.compile(r"[0-9a-f]{64}\Z")
ID = re.compile(r"(?:capture|export)-[0-9a-f-]{36}\Z")

def checked_id(value):
    if not isinstance(value,str) or not ID.fullmatch(value):
        raise InputError("Use the complete retained capture or export ID")
    return value

def checked_sha(value):
    if not isinstance(value,str) or not SHA.fullmatch(value):
        raise InputError("Use the complete retained SHA256")
    return value

def immutable(path, data):
    """The original workspace lease serializes publication; final files are complete."""
    if path.exists():
        if path.is_symlink() or path.read_bytes()!=data:
            raise InputError("Retained bytes conflict with this operation: "+path.name)
        return
    fd,name=tempfile.mkstemp(prefix=".stage-",dir=path.parent)
    temporary=Path(name)
    try:
        with os.fdopen(fd,"wb") as out:
            os.chmod(temporary,0o600);out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(temporary,path);sync_dir(path.parent)
    finally:
        temporary.unlink(missing_ok=True)

class PublisherBridge:
    """One original Node publisher owned by the same Python operator process."""
    def __init__(self, directory):
        self.directory=directory
        self.process=None
        self.lock=threading.RLock()
        self.sequence=0
        self.replies=None
        self.errors=None
        self.opened=False

    def call(self, action, payload=None):
        with self.lock:
            if self.process is None:
                self.errors=tempfile.TemporaryFile()
                self.replies=queue.Queue()
                self.process=subprocess.Popen([os.environ.get("SF30_XML_NODE","node"),"--max-old-space-size=384",
                    str(HERE/"publisher-bridge.mjs"),"--directory",str(self.directory)],
                    stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.errors)
                process,replies=self.process,self.replies
                def reader():
                    try:
                        while line:=process.stdout.readline(24*1024*1024):
                            if not line.endswith(b"\n"):
                                raise InputError("Original publisher response exceeds its transport limit")
                            replies.put(line)
                    finally:
                        replies.put(None)
                threading.Thread(target=reader,daemon=True).start()
            self.sequence+=1
            ident=self.sequence
            self.process.stdin.write(json_bytes({"id":ident,"action":action,"payload":payload or {}}))
            self.process.stdin.flush()
            while True:
                try:
                    raw=self.replies.get(timeout=30)
                    break
                except queue.Empty:
                    if self.process.poll() is not None:
                        raw=None
                        break
                    # The original operation keeps its identity while a client reconnects.
                    # HTTP operation lookup observes RUNNING; no second call is sent.
            if raw is None:
                self.errors.seek(0);detail=self.errors.read()[-1800:].decode("utf-8",errors="replace")
                self.close()
                raise InputError("Original publisher exited: "+detail)
            value=load_json(raw)
            if value.get("id")!=ident:
                raise InputError("Original publisher response identity changed")
            if not value.get("ok"):
                raise InputError(value.get("error","Original publisher rejected this action"))
            if action.startswith("publisher."):
                self.opened=True
            return value["result"]

    def state(self):
        return self.call("publisher.state") if self.process is not None and self.opened else None

    def close(self):
        with self.lock:
            if self.process is not None:
                p,self.process=self.process,None
                try:
                    p.stdin.close();p.wait(timeout=30)
                except (OSError,subprocess.TimeoutExpired):
                    p.terminate()
                    try:p.wait(timeout=10)
                    except subprocess.TimeoutExpired:p.kill();p.wait()
                finally:
                    p.stdout.close()
            if self.errors is not None:self.errors.close();self.errors=None
            self.opened=False

class Workspace(BatchOperations, PackageOperations, SourceWorkspace):
    def __init__(self, root, create=False):
        super().__init__(root,create=create)
        self.publisher=PublisherBridge(self.root/"publisher")
        self.current_action=None
        try:
            for name in ["registry","prs","exports"]:
                path=self.root/name
                path.mkdir(mode=0o700,exist_ok=True)
                if path.is_symlink() or not path.is_dir():
                    raise InputError("Use original private registry directories")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS registry_meta(k TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_captures(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_studies(capture TEXT NOT NULL,nct TEXT NOT NULL,
                    page INTEGER NOT NULL,offset INTEGER NOT NULL,bytes INTEGER NOT NULL,sha TEXT NOT NULL,
                    summary TEXT NOT NULL,PRIMARY KEY(capture,nct));
                CREATE TABLE IF NOT EXISTS registry_reviews(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_prs(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_exports(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_prs_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_prs_reconciliations(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_prs_previews(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_batches(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_batch_exports(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS registry_actions(id TEXT PRIMARY KEY,request_sha TEXT NOT NULL,body TEXT NOT NULL);
            """)
            if self._meta("revision") is None:self._set("revision",0)
            if self._meta("application") is None:self._set("application",VERSION)
            if self._meta("application")!=VERSION:raise InputError("Unsupported registry workspace version")
        except BaseException:
            self.publisher.close();super().close();raise

    def close(self):
        try:self.publisher.close()
        finally:super().close()

    def _meta(self,key,default=None):
        row=self.db.execute("SELECT body FROM registry_meta WHERE k=?",(key,)).fetchone()
        return load_json(row[0]) if row else default

    def _set(self,key,value):
        with self.db:self.db.execute("INSERT OR REPLACE INTO registry_meta VALUES(?,?)",(key,json_bytes(value).decode()))

    def _all(self,table):
        return [load_json(row[0]) for row in self.db.execute("SELECT body FROM "+table+" ORDER BY rowid")]

    def _capture(self,ident=None):
        ident=checked_id(ident or self._meta("currentCapture"))
        row=self.db.execute("SELECT body FROM registry_captures WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained cohort capture")
        return load_json(row[0])

    def _save_capture(self,capture):
        with self.db:self.db.execute("INSERT OR REPLACE INTO registry_captures VALUES(?,?)",
                                    (capture["id"],json_bytes(capture).decode()))

    def _capture_summary(self,c):
        return {key:c.get(key) for key in ["id","configuration","status","version","pageCount","rowCount",
            "expectedRows","byteCount","source","createdAt","completedAt","error"]}

    def state(self):
        with self.mutex:
            result=super().state()
            captures=self._all("registry_captures")
            selected=self._meta("currentCapture")
            current=next((c for c in captures if c["id"]==selected),None)
            return {**result,"applicationSchema":VERSION,"revision":self._meta("revision",0),
                "configuration":self._meta("configuration"),"capture":self._capture_summary(current) if current else None,
                "captures":[self._capture_summary(c) for c in captures],"activeBuild":self._meta("activeBuild"),
                "activePlan":self._meta("activePlan"),"lastQuery":self._meta("lastQuery"),
                "reviews":self._all("registry_reviews"),"prs":self._all("registry_prs"),
                "prsPlans":self._all("registry_prs_plans"),"prsReconciliations":self._all("registry_prs_reconciliations"),
                "prsPreviews":self._all("registry_prs_previews"),
                "batches":self.batch_index(),"batchExports":self._all("registry_batch_exports"),
                "merchant":self._meta("merchant"),"exports":self._all("registry_exports"),
                "publisher":self.publisher.state(),"runtime":{"prs":prs.doctor()},
                "contract":{"apiVersion":registry.CONTRACT["apiVersion"],
                    "sourceSha256":registry.CONTRACT["sourceSha256"],"statuses":registry.CONTRACT["statuses"],
                    "parameters":[{"name":p["name"],"description":p["description"]} for p in registry.CONTRACT["parameters"]
                                  if p["name"] not in registry.MANAGED]}}

    def _relative(self,path):
        return str(path.relative_to(self.root)).replace(os.sep,"/")

    def _verified(self,relative,expected=None,maximum=registry.MAX_RESPONSE):
        if not isinstance(relative,str) or "\\" in relative:
            raise InputError("Use a canonical retained relative path")
        p=Path(relative)
        if p.is_absolute() or any(x in {"..","."} for x in p.parts):
            raise InputError("Invalid retained relative path")
        path=self.root/p
        if self.root not in path.resolve(strict=True).parents:
            raise InputError("Retained source escaped its original workspace")
        actual=file_digest(path,maximum)
        if expected is not None and actual!=expected:
            raise InputError("Retained source bytes changed")
        return path

    def _receipt(self,capture,kind,body,receipt):
        folder=self.root/"registry"/capture["id"]
        folder.mkdir(mode=0o700,exist_ok=True)
        row=dict(receipt)
        if body is not None:
            name=kind+"-"+registry.sha(body)+".json"
            immutable(folder/name,body)
            row["bodyPath"]=self._relative(folder/name)
            row["sha256"]=registry.sha(body);row["bytes"]=len(body)
        encoded=json_bytes(row)
        path=folder/("receipt-"+registry.sha(encoded)+".json")
        immutable(path,encoded)
        return {**row,"receiptPath":self._relative(path),"receiptSha256":registry.sha(encoded)}

    def _version(self,capture,kind):
        body,receipt=registry.request(registry.BASE+"/version")
        retained=self._receipt(capture,kind,body,receipt)
        try:
            observed=registry.version(body)
            retained["version"]=observed
        except InputError as error:
            retained["validationError"]=str(error)
            capture.setdefault("versionRequests",[]).append(retained)
            self._save_capture(capture)
            raise
        capture.setdefault("versionRequests",[]).append(retained)
        self._save_capture(capture)
        return observed

    def _capture_start(self,request_id):
        configuration=self._meta("configuration")
        if configuration is None:raise InputError("Configure the registry cohort first")
        ident="capture-"+request_id
        existing=self.db.execute("SELECT 1 FROM registry_captures WHERE id=?",(ident,)).fetchone()
        if existing:return self._capture_summary(self._capture(ident))
        capture={"schema":CAPTURE,"id":ident,"configuration":configuration,"status":"starting",
            "createdAt":registry.now(),"pages":[],"pageCount":0,"rowCount":0,"byteCount":0,
            "nextPageToken":None,"source":None,"expectedRows":None,"versionRequests":[],"attempts":[]}
        self._save_capture(capture);self._set("currentCapture",ident)
        try:
            capture["version"]=self._version(capture,"version-start")
            capture["status"]="running";capture["error"]=None
        except (registry.ProviderError,InputError) as error:
            capture["status"]="error";capture["error"]=str(error)
            if isinstance(error,registry.ProviderError):
                capture["attempts"].append(self._receipt(capture,"version-error",error.body,error.receipt or {}))
            self._save_capture(capture);raise
        self._save_capture(capture)
        return self._capture_summary(capture)

    def _finalize(self,capture):
        observed=self._version(capture,"version-finish")
        if observed!=capture["version"]:
            capture.update(status="changed",error="Registry data edition changed during capture. Start a new capture; the earlier whole pages remain retained.")
            self._save_capture(capture);raise InputError(capture["error"])
        if capture["expectedRows"] is not None and capture["expectedRows"]!=capture["rowCount"]:
            capture.update(status="changed",error="The completed page chain differs from the provider's original totalCount. Review the retained pages and create a new capture.")
            self._save_capture(capture);raise InputError(capture["error"])
        with self.scratch() as temp:
            path=temp/"whole-studies.ndjson"
            with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                for page in capture["pages"]:
                    original=self._verified(page["ndjsonPath"],page["ndjsonSha256"],256*1024*1024)
                    with original.open("rb") as inp:shutil.copyfileobj(inp,out,1048576)
                out.flush();os.fsync(out.fileno())
            with path.open("rb") as inp:
                source=self.add_source(inp,capture["configuration"]["name"],"clinicaltrials-whole-studies.ndjson")
        if source["inventory"]["records"]!=capture["rowCount"]:
            raise InputError("Whole-study inventory count differs from the captured registry cohort")
        capture.update(status="completed",source=source["id"],completedAt=registry.now(),error=None)
        self._save_capture(capture)
        return self._capture_summary(capture)

    def _advance(self,ident):
        capture=self._capture(ident)
        if capture["status"]=="completed":return self._capture_summary(capture)
        if capture["status"]!="running":raise InputError("Resume the retained capture before requesting another page")
        if capture["pages"] and capture["nextPageToken"] is None:
            return self._finalize(capture)
        url=registry.study_url(capture["configuration"],capture["nextPageToken"],not capture["pages"])
        retained=None
        try:
            body,receipt=registry.request(url)
            retained=self._receipt(capture,"studies",body,receipt)
            studies,token,total=registry.page(body)
            if token is not None and token in [p.get("tokenUsed") for p in capture["pages"]]+[capture["nextPageToken"]]:
                raise InputError("Registry returned a repeated page token; retained pagination cannot advance")
            if capture["byteCount"]+len(body)>capture["configuration"]["maxBytes"]:
                raise InputError("Capture reached its declared raw-source byte capacity. Review the retained response and start a narrower cohort or increase the configured capacity.")
            if capture["rowCount"]+len(studies)>capture["configuration"]["maxStudies"]:
                raise InputError("Capture reached its declared study capacity. Retained pages remain available; choose a larger capacity or a narrower cohort.")
            existing={r[0] for r in self.db.execute("SELECT nct FROM registry_studies WHERE capture=?",(capture["id"],))}
            new=[row["nctId"] for row,_ in studies]
            if len(set(new))!=len(new) or existing.intersection(new):
                raise InputError("The registry page repeats an NCT study already retained in this cohort")
            page_number=len(capture["pages"])
            encoded=b"".join(raw for _,raw in studies)
            ndjson=self.root/"registry"/capture["id"]/("page-"+str(page_number+1).zfill(6)+"-"+registry.sha(encoded)+".ndjson")
            immutable(ndjson,encoded)
            page={**retained,"index":page_number,"tokenUsed":capture["nextPageToken"],"nextPageToken":token,
                  "rowCount":len(studies),"ndjsonPath":self._relative(ndjson),"ndjsonSha256":registry.sha(encoded)}
            capture["pages"].append(page)
            capture.update(pageCount=len(capture["pages"]),rowCount=capture["rowCount"]+len(studies),
                           byteCount=capture["byteCount"]+len(body),nextPageToken=token,error=None)
            if page_number==0:capture["expectedRows"]=total
            with self.db:
                offset=0
                for brief,raw in studies:
                    self.db.execute("INSERT INTO registry_studies VALUES(?,?,?,?,?,?,?)",
                        (capture["id"],brief["nctId"],page_number,offset,len(raw),registry.sha(raw),json_bytes(brief).decode()))
                    offset+=len(raw)
                self.db.execute("UPDATE registry_captures SET body=? WHERE id=?",(json_bytes(capture).decode(),capture["id"]))
            return self._finalize(capture) if token is None else self._capture_summary(capture)
        except (registry.ProviderError,InputError) as error:
            # Any returned body is retained before parsing or monetary/customer preparation.
            if isinstance(error,registry.ProviderError):
                capture["attempts"].append(self._receipt(capture,"request-error",error.body,error.receipt or {}))
            elif retained is not None and not any(p.get("receiptPath")==retained["receiptPath"] for p in capture["pages"]):
                capture["attempts"].append(retained)
            if capture.get("status")!="changed":capture["status"]="error"
            capture["error"]=str(error)
            self._save_capture(capture);raise

    def _resume(self,ident):
        capture=self._capture(ident)
        if capture["status"]=="completed":return self._capture_summary(capture)
        if capture["status"]=="changed":raise InputError("Start a new capture for the changed registry data edition")
        try:
            observed=self._version(capture,"version-resume")
        except (registry.ProviderError,InputError) as error:
            if isinstance(error,registry.ProviderError):
                capture["attempts"].append(self._receipt(capture,"resume-error",error.body,error.receipt or {}))
            capture.update(status="error",error=str(error));self._save_capture(capture);raise
        if capture.get("version") is None:capture["version"]=observed
        if observed!=capture["version"]:
            capture.update(status="changed",error="The registry edition changed while this cohort was paused; start a new capture.")
            self._save_capture(capture);raise InputError(capture["error"])
        capture.update(status="running",error=None);self._save_capture(capture)
        return self._capture_summary(capture)

    def studies(self,capture_id=None,offset=0,limit=50,query=""):
        with self.mutex:
            capture=self._capture(capture_id)
            if type(offset) is not int or offset<0 or type(limit)is not int or not 1<=limit<=250:
                raise InputError("Choose a retained study offset and page size up to 250")
            query=registry.text(query,"Study search",200,empty=True).casefold()
            rows=[load_json(r[0]) for r in self.db.execute("SELECT summary FROM registry_studies WHERE capture=? ORDER BY nct",(capture["id"],))]
            if query:rows=[r for r in rows if query in " ".join(str(r.get(k) or "") for k in ["nctId","title","status","sponsor"]).casefold()]
            reviews={r["nctId"]:r for r in self._all("registry_reviews") if r["captureId"]==capture["id"]}
            selected=[{**r,"review":reviews.get(r["nctId"])} for r in rows[offset:offset+limit]]
            return {"captureId":capture["id"],"rows":selected,"total":len(rows),"offset":offset,
                    "nextOffset":offset+len(selected) if offset+len(selected)<len(rows) else None}

    def study(self,capture_id,nct_id):
        with self.mutex:
            capture=self._capture(capture_id)
            if not isinstance(nct_id,str) or not registry.NCT.fullmatch(nct_id):
                raise InputError("Choose an original NCT identifier")
            row=self.db.execute("SELECT * FROM registry_studies WHERE capture=? AND nct=?",(capture["id"],nct_id)).fetchone()
            if row is None:raise InputError("This study is not in the selected captured cohort")
            page=capture["pages"][row["page"]]
            path=self._verified(page["ndjsonPath"],page["ndjsonSha256"],256*1024*1024)
            with path.open("rb") as inp:inp.seek(row["offset"]);raw=inp.read(row["bytes"])
            if registry.sha(raw)!=row["sha"]:raise InputError("Retained whole study changed")
            value=registry.parse_document(raw)
            return {"captureId":capture["id"],"nctId":nct_id,"sourceSha256":row["sha"],
                    "page":{key:page[key] for key in ["index","url","receivedAt","sha256","bodyPath"]},
                    "summary":load_json(row["summary"]),"study":value,"json":raw.decode("utf-8"),
                    "sectionJson":{k:registry.pretty_json(v) for k,v in value.items()},
                    "reviews":[r for r in self._all("registry_reviews") if r["captureId"]==capture["id"] and r["nctId"]==nct_id]}

    def study_compare(self,before,after,nct_id):
        a,b=self.study(before,nct_id),self.study(after,nct_id)
        changes=registry.field_changes(a["study"],b["study"])
        return {"nctId":nct_id,"before":{k:a[k] for k in ["captureId","sourceSha256"]},
                "after":{k:b[k] for k in ["captureId","sourceSha256"]},"changes":changes,"changedFields":len(changes)}

    def import_prs(self,data,name,schema="protocol",original=None,reviewed_by=None,note=None):
        with self.mutex:
            report=prs.inspect(data,schema)
            ident=report["inputSha256"]
            current=self.db.execute("SELECT body FROM registry_prs WHERE id=?",(ident,)).fetchone()
            if current:return load_json(current[0])
            record={"id":ident,"name":Path(name).name[:160],"createdAt":registry.now(),"report":report,"status":"DRAFT"}
            if original:
                original=checked_sha(original)
                prior=self.db.execute("SELECT body FROM registry_prs WHERE id=?",(original,)).fetchone()
                if prior is None:raise InputError("Choose the retained original PRS document")
                operator=registry.text(reviewed_by,"Reviewer",160)
                reason=registry.text(note,"Change explanation",8192)
                old=self._verified("prs/"+original+".xml",original,prs.MAX_XML).read_bytes()
                record.update(originalId=original,reviewedBy=operator,note=reason,comparison=prs.compare(old,data,schema))
            immutable(self.root/"prs"/(ident+".xml"),data)
            immutable(self.root/"prs"/(ident+".json"),json_bytes(record))
            with self.db:self.db.execute("INSERT INTO registry_prs VALUES(?,?)",(ident,json_bytes(record).decode()))
            return record

    def prs_document(self,ident):
        ident=checked_sha(ident)
        row=self.db.execute("SELECT body FROM registry_prs WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained PRS document")
        data=self._verified("prs/"+ident+".xml",ident,prs.MAX_XML).read_bytes()
        record=load_json(row[0])
        encoding=record["report"].get("encoding") or "utf-8-sig"
        warning=None
        try:display=data.decode(encoding)
        except (LookupError,UnicodeDecodeError):
            display=data.decode("utf-8",errors="replace")
            warning="The inspection could not supply a complete text decoding. Download the retained original bytes."
        return {"record":record,"xml":display,"displayEncoding":encoding,"displayWarning":warning}


    def prs_plan(self,ident):
        ident=checked_sha(ident)
        row=self.db.execute("SELECT body FROM registry_prs_plans WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained PRS modernization plan")
        record=load_json(row[0])
        data=self._verified("prs/plan-"+ident+".json",ident,64*1024*1024).read_bytes()
        return {**record,"plan":load_json(data)}

    def prs_reconciliation(self,ident):
        ident=checked_sha(ident)
        row=self.db.execute("SELECT body FROM registry_prs_reconciliations WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained PRS reconciliation")
        record=load_json(row[0])
        data=self._verified("prs/reconciliation-"+ident+".json",ident,64*1024*1024).read_bytes()
        return {**record,"report":load_json(data)}

    def prs_catalog(self):
        return prs.catalog()

    def prs_preview(self,ident):
        ident=checked_sha(ident)
        row=self.db.execute("SELECT body FROM registry_prs_previews WHERE id=?",(ident,)).fetchone()
        if row is None:raise InputError("Unknown retained PRS upload preview")
        record=load_json(row[0])
        data=self._verified("prs/preview-"+ident+".json",ident,64*1024*1024).read_bytes()
        return {**record,"report":load_json(data)}

    def preview_prs(self,p):
        base=self.prs_document(p["baseDocumentId"])["record"]
        incoming=self.prs_document(p["incomingDocumentId"])["record"]
        schema=base["report"]["schemaKind"]
        if incoming["report"]["schemaKind"]!=schema:
            raise InputError("The retained base and incoming documents use different original PRS schemas")
        reviewer=registry.text(p["reviewer"],"Reviewer",160)
        before=self._verified("prs/"+base["id"]+".xml",base["id"],prs.MAX_XML).read_bytes()
        after=self._verified("prs/"+incoming["id"]+".xml",incoming["id"],prs.MAX_XML).read_bytes()
        candidate,report=prs.preview_upload(before,after,schema,p.get("rules"),reviewer)
        created=self.import_prs(candidate,"composed-"+incoming["name"],schema,base["id"],reviewer,
            "Reviewed local composition of retained incoming document "+incoming["id"])
        retained={"schema":"stellar-forge.clinicaltrials-prs-preview.v1","baseDocumentId":base["id"],
            "incomingDocumentId":incoming["id"],"candidateId":created["id"],"reviewer":reviewer,
            "rules":p.get("rules"),"report":report}
        encoded=json_bytes(retained);ident=registry.sha(encoded)
        summary={"id":ident,"baseDocumentId":base["id"],"incomingDocumentId":incoming["id"],
            "candidateId":created["id"],"reviewer":reviewer,"createdAt":registry.now(),
            "bytes":len(encoded),"complete":report.get("complete")}
        immutable(self.root/"prs"/("preview-"+ident+".json"),encoded)
        with self.db:self.db.execute("INSERT OR IGNORE INTO registry_prs_previews VALUES(?,?)",(ident,json_bytes(summary).decode()))
        return {"document":created,"previewId":ident,"report":self.prs_preview(ident)}

    def prepare_prs(self,p):
        document=self.prs_document(p["documentId"])
        ident=document["record"]["id"]
        data=self._verified("prs/"+ident+".xml",ident,prs.MAX_XML).read_bytes()
        plan=prs.prepare(data,p["decisions"],p["reviewer"],p.get("rationale",""))
        encoded=json_bytes(plan);key=registry.sha(encoded)
        record={"id":key,"documentId":ident,"createdAt":registry.now(),"reviewer":p["reviewer"],
                "rationale":p.get("rationale",""),"bytes":len(encoded)}
        immutable(self.root/"prs"/("plan-"+key+".json"),encoded)
        with self.db:self.db.execute("INSERT OR IGNORE INTO registry_prs_plans VALUES(?,?)",(key,json_bytes(record).decode()))
        return self.prs_plan(key)

    def apply_prs(self,p):
        retained=self.prs_plan(p["planId"])
        if retained["documentId"]!=p["documentId"]:raise InputError("PRS plan belongs to another original document")
        ident=retained["documentId"]
        old=self._verified("prs/"+ident+".xml",ident,prs.MAX_XML).read_bytes()
        candidate,report=prs.apply(old,retained["plan"])
        original=self.prs_document(ident)["record"]
        created=self.import_prs(candidate,"reviewed-"+original["name"],original["report"]["schemaKind"],ident,
                                retained["reviewer"],retained["rationale"] or "Applied the reviewed original modernization plan")
        return {"document":created,"planId":retained["id"],"report":report}

    def reconcile_prs(self,p):
        document=self.prs_document(p["documentId"])["record"]
        capture=self._capture(p["captureId"])
        plan=p["plan"]
        if not isinstance(plan,dict) or not isinstance(plan.get("studyLinks"),list):
            raise InputError("Supply explicit PRS study links and reviewer decisions")
        identifiers=list(dict.fromkeys(link["nctId"] for link in plan["studyLinks"]))
        records=[]
        for nct in identifiers:
            item=self.study(capture["id"],nct)
            records.append({"rawJson":item["json"],"source":{"captureId":capture["id"],
                "pageReference":item["page"],"observedAt":item["page"]["receivedAt"],
                "apiVersion":capture["version"]["apiVersion"],"dataTimestamp":capture["version"]["dataTimestamp"],
                "sourceSha256":item["sourceSha256"],"sha256":item["sourceSha256"]}})
        raw=self._verified("prs/"+document["id"]+".xml",document["id"],prs.MAX_XML).read_bytes()
        report=prs.reconcile(raw,records,plan)
        retained={"schema":"stellar-forge.clinicaltrials-prs-reconciliation.v1","documentId":document["id"],
                  "captureId":capture["id"],"plan":plan,"apiSources":[r["source"] for r in records],"report":report}
        encoded=json_bytes(retained);ident=registry.sha(encoded)
        summary={"id":ident,"documentId":document["id"],"captureId":capture["id"],
                 "createdAt":registry.now(),"reviewer":plan.get("reviewer"),"studies":len(records),"bytes":len(encoded)}
        immutable(self.root/"prs"/("reconciliation-"+ident+".json"),encoded)
        with self.db:self.db.execute("INSERT OR IGNORE INTO registry_prs_reconciliations VALUES(?,?)",
                                    (ident,json_bytes(summary).decode()))
        return self.prs_reconciliation(ident)

    def capture_manifest(self,ident=None):
        with self.mutex:
            capture=self._capture(ident)
            folder=self.root/"registry"/capture["id"]
            files=[]
            if folder.exists():
                for path in sorted(folder.iterdir()):
                    if path.name.startswith(".stage-"):continue
                    files.append({"name":path.name,"bytes":path.stat().st_size,"sha256":file_digest(path,256*1024*1024)})
            return {**capture,"files":files}

    def source_file(self,capture_id,name):
        if not isinstance(name,str) or Path(name).name!=name or name.startswith("."):
            raise InputError("Choose one declared retained capture member")
        manifest=self.capture_manifest(capture_id)
        entry=next((x for x in manifest["files"] if x["name"]==name),None)
        if entry is None:raise InputError("Unknown retained capture member")
        return self._verified("registry/"+manifest["id"]+"/"+name,entry["sha256"],256*1024*1024)

    def operation(self,request_id):
        try:
            if str(uuid.UUID(request_id))!=request_id:raise ValueError()
        except (ValueError,TypeError):raise InputError("Use the original action request UUID")
        if self.current_action and self.current_action["requestId"]==request_id:
            return {**self.current_action,"status":"RUNNING"}
        with self.mutex:
            row=self.db.execute("SELECT body FROM registry_actions WHERE id=?",(request_id,)).fetchone()
            if row is None:return {"requestId":request_id,"status":"UNKNOWN"}
            saved=load_json(row[0])
            status=saved.get("status") or ("FAILED" if saved.get("error") else "COMPLETE")
            if status=="RUNNING":status="INTERRUPTED"
            return {**saved,"requestId":request_id,"status":status,"state":self.state()}

    def query(self,build_id,params):
        with self.mutex:
            result=SourceWorkspace.query(self,build_id,params)
            if result["response"]["status"]==200:
                body=result["response"]["body"]
                self._set("lastQuery",{"buildId":build_id,"query":params,
                    "initialQuery":{k:v for k,v in params.items() if k!="cursor"},
                    "snapshot":result["dataset"]["snapshot"],"nextCursor":body.get("page",{}).get("nextCursor"),
                    "queriedAt":registry.now()})
            return result

    def _execute(self,action,p,request_id):
        if action=="cohort.configure":
            normalized=registry.config(p);self._set("configuration",normalized);return normalized
        if action=="version.inspect":
            body,receipt=registry.request(registry.BASE+"/version");return {"version":registry.version(body),"source":receipt}
        if action=="capture.start":return self._capture_start(request_id)
        if action=="capture.select":
            capture=self._capture(p["captureId"]);self._set("currentCapture",capture["id"]);return self._capture_summary(capture)
        if action=="capture.advance":return self._advance(p.get("captureId"))
        if action=="capture.resume":return self._resume(p.get("captureId"))
        if action=="capture.pause":
            capture=self._capture(p.get("captureId"))
            if capture["status"]=="running":capture["status"]="paused";self._save_capture(capture)
            return self._capture_summary(capture)
        if action=="review.record":
            study=self.study(p["captureId"],p["nctId"])
            if p.get("expectedSha256")!=study["sourceSha256"]:raise InputError("The reviewed study bytes changed")
            if p.get("decision") not in {"ready","follow-up","exclude"}:raise InputError("Choose ready, follow-up or exclude")
            record={"captureId":study["captureId"],"nctId":study["nctId"],"sourceSha256":study["sourceSha256"],
                "decision":p["decision"],"reviewedBy":registry.text(p.get("reviewedBy"),"Reviewer",160),
                "note":registry.text(p.get("note"),"Review note",8192),"createdAt":registry.now()}
            record["id"]=registry.sha(json_bytes({"requestId":request_id,"captureId":record["captureId"],"nctId":record["nctId"]}))
            with self.db:self.db.execute("INSERT INTO registry_reviews VALUES(?,?)",(record["id"],json_bytes(record).decode()))
            return record
        if action=="mapping.default":
            mapped=self.save_plan(registry.default_mapping(p.get("name","Registry review")))
            self._set("activePlan",mapped["id"]);return mapped
        if action=="mapping.save":
            mapped=self.save_plan(p["plan"]);self._set("activePlan",mapped["id"]);return mapped
        if action=="edition.build":
            capture=self._capture(p.get("captureId"))
            if capture["status"]!="completed":raise InputError("Finish the complete registry cohort before building its dataset")
            plan=p.get("planId") or self._meta("activePlan")
            result=self.build(capture["source"],plan)
            self._set("activeBuild",result["id"]);self._set("currentCapture",capture["id"]);return result
        if action=="dataset.query":
            return self.query(p.get("buildId") or self._meta("activeBuild"),p.get("query",{}))["response"]
        if action=="edition.compare":return self.compare(p["beforeId"],p["afterId"])
        if action=="merchant.configure":
            if set(p)!={"payment","origin","path"}:raise InputError("Supply the original payment terms, public origin and path")
            if not isinstance(p["payment"],dict):raise InputError("Payment terms must be an object")
            # Original native offer validation runs before any merchant configuration is saved.
            build=self.build_view(self._meta("activeBuild"))
            result=self.publisher.call("merchant.validate",{**p,"datasetConfig":str(self._build_path(build["id"],"dataset.json"))})
            self._set("merchant",result);return result
        if action=="package.export":return self.export_customer(p.get("buildId") or self._meta("activeBuild"),request_id)
        if action=="package.import":
            path=Path(p["packagePath"])
            if p.get("sha256") is not None and file_digest(path,2*1024*1024*1024)!=p["sha256"]:
                raise InputError("Uploaded portable package bytes changed")
            return self.restore_customer(path)
        if action=="prs.import":
            path=Path(p["path"])
            if p.get("sha256") is not None and file_digest(path,prs.MAX_XML)!=p["sha256"]:
                raise InputError("Uploaded PRS document bytes changed")
            return self.import_prs(path.read_bytes(),p.get("name",path.name),p.get("schema","protocol"))
        if action=="prs.candidate":
            old=self.prs_document(p["originalId"])["record"]
            return self.import_prs(registry.text(p["xml"],"Candidate XML",prs.MAX_XML).encode(),
                p.get("name","reviewed-candidate.xml"),old["report"]["schemaKind"],p["originalId"],p["reviewedBy"],p["note"])
        if action=="prs.plan":return self.prepare_prs(p)
        if action=="prs.apply":return self.apply_prs(p)
        if action=="prs.reconcile":return self.reconcile_prs(p)
        if action=="prs.preview":return self.preview_prs(p)
        if action.startswith("batch."):return self.batch_action(action,p,request_id)
        if action.startswith("publisher."):
            if action=="publisher.prepare":
                directory=Path(p.get("exportDirectory","")).resolve()
                exported=next((e for e in self._all("registry_exports") if Path(e["directory"]).resolve()==directory),None)
                if not exported:raise InputError("Choose a retained ClinicalTrials export from this operator")
                self.verify_export(exported["id"])
            response=self.publisher.call(action,p)
            return response.get("result",response)
        raise InputError("Unknown ClinicalTrials workspace action")

    def act(self,action,payload=None,expected_revision=None,request_id=None):
        if not isinstance(action,str) or not isinstance(payload or {},dict):
            raise InputError("Use a declared action and object payload")
        request_id=request_id or str(uuid.uuid4())
        try:
            if str(uuid.UUID(request_id))!=request_id:raise ValueError()
        except (ValueError,TypeError):raise InputError("Use a canonical action request UUID")
        payload=payload or {}
        fingerprint=registry.sha(json_bytes({"action":action,"payload":payload}))
        with self.mutex:
            prior=self.db.execute("SELECT request_sha,body FROM registry_actions WHERE id=?",(request_id,)).fetchone()
            if prior:
                if prior["request_sha"]!=fingerprint:raise InputError("Action request ID already belongs to different input")
                saved=load_json(prior["body"])
                if saved.get("status")=="RUNNING":
                    raise InputError("This earlier process ended during the operation. Read its retained state and continue with a new reviewed request.")
                if saved.get("error"):raise InputError(saved["error"])
                return {"state":self.state(),"result":saved["result"],"replayed":True}
            revision=self._meta("revision",0)
            if expected_revision is not None and (type(expected_revision) is not int or expected_revision!=revision):
                raise InputError("The retained workspace changed. Refresh its current revision before this action.")
            started={"requestId":request_id,"status":"RUNNING","action":action,"startedAt":registry.now(),"revision":revision}
            with self.db:self.db.execute("INSERT INTO registry_actions VALUES(?,?,?)",
                                        (request_id,fingerprint,json_bytes(started).decode()))
            self.current_action=started
            try:
                result=self._execute(action,payload,request_id)
                saved={**started,"status":"COMPLETE","completedAt":registry.now(),"revision":revision+1,"result":result}
                with self.db:
                    self.db.execute("INSERT OR REPLACE INTO registry_meta VALUES(?,?)",("revision",json_bytes(revision+1).decode()))
                    self.db.execute("UPDATE registry_actions SET body=? WHERE id=?",(json_bytes(saved).decode(),request_id))
                return {"result":result,"state":self.state()}
            except BaseException as error:
                try:
                    if isinstance(error,Exception):
                        saved={**started,"status":"FAILED","completedAt":registry.now(),"revision":revision+1,"error":str(error)}
                        with self.db:
                            self.db.execute("INSERT OR REPLACE INTO registry_meta VALUES(?,?)",("revision",json_bytes(revision+1).decode()))
                            self.db.execute("UPDATE registry_actions SET body=? WHERE id=?",(json_bytes(saved).decode(),request_id))
                except Exception:
                    pass  # Preserve the original operation error if storage cannot retain the final receipt.
                raise
            finally:
                self.current_action=None
