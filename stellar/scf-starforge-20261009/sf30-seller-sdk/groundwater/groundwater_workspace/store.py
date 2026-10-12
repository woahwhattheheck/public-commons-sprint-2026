"""The one original SQLite domain for source, scenario, native run and receiving."""
from __future__ import annotations

import copy
import contextlib
import json
import mimetypes
import os
from pathlib import Path
import sqlite3
import sys
import uuid

from .common import (Problem, Objects, Lock, decode_upload, digest, file_info,
                     identifier, integer, inventory, json_text, now, read_json, relative,
                     text, timestamp, verify_file, write_json, sync_directory)
from . import sources

_PACKAGE = Path(__file__).resolve().parent
APPLICATION = _PACKAGE / "_application" if (_PACKAGE / "_application" / "workspace.py").is_file() else _PACKAGE.parent

class Workbench:
    def __init__(self, directory, application=None, *, existing_only=False, initial_workspace_id=None):
        self.directory = Path(directory).resolve()
        self.application = Path(application or APPLICATION).resolve()
        self.db_path = self.directory / "groundwater.sqlite"
        if initial_workspace_id is not None:
            identifier(initial_workspace_id,"Initial workspace ID")
        if existing_only and not self.db_path.is_file():
            raise Problem("workspace_missing","The original workspace database is unavailable; no replacement was created.",404)
        self.directory.mkdir(parents=True, exist_ok=True)
        with Lock(self.directory/"workspace.lock"):
            if self.db_path.exists() or self.db_path.is_symlink():
                retained=self._verify_existing()
                if initial_workspace_id is not None and retained["id"]!=initial_workspace_id:
                    raise Problem("initial_workspace_mismatch","This database belongs to another original workspace identity.")
            elif existing_only:
                raise Problem("workspace_missing","The original workspace database is unavailable; no replacement was created.",404)
            else:
                self._initialize(initial_workspace_id)
        self.objects = Objects(self.directory / "objects")
    def _verify_existing(self, path=None):
        path=Path(path or self.db_path)
        if not path.is_file() or path.is_symlink() or path.stat().st_size==0:
            raise Problem("existing_workspace_invalid","The existing database is empty, linked or unavailable; its original bytes were preserved.")
        try:
            db=sqlite3.connect(path.as_uri()+"?mode=ro",uri=True)
            try:
                db.execute("PRAGMA query_only=ON")
                tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type=\'table\'")}
                if not {"meta","operations","projects","records","history"}<=tables:
                    raise ValueError("Original schema is incomplete")
                meta=dict(db.execute("SELECT key,value FROM meta"))
                identifier(meta["id"],"Original workspace ID")
                if not meta["version"].isdigit() or "created" not in meta:
                    raise ValueError("Original workspace metadata is incomplete")
                # Required columns must be present before any writable request opens this DB.
                for query in ("SELECT id,request_sha256,request,action,result,created FROM operations LIMIT 0","SELECT id,version,body,created,updated FROM projects LIMIT 0","SELECT id,project_id,kind,body,created,updated FROM records LIMIT 0","SELECT seq,operation_id,project_id,action,actor,body,created FROM history LIMIT 0"):
                    db.execute(query)
                return meta
            finally:
                db.close()
        except (sqlite3.DatabaseError,KeyError,ValueError,Problem) as exc:
            raise Problem("existing_workspace_invalid","The retained original database could not be validated; no schema or identity was initialized.",detail=str(exc)) from exc
    def close(self):
        pass
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.close()
    @contextlib.contextmanager
    def connect(self):
        try:
            db = sqlite3.connect(self.db_path.as_uri()+"?mode=rw",uri=True,timeout=30)
        except sqlite3.OperationalError as exc:
            raise Problem("workspace_unavailable","The original database cannot be opened; no replacement was created.",detail=str(exc)) from exc
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=30000")
        try:
            with db:
                yield db
        finally:
            db.close()
    def _initialize(self, initial_workspace_id=None):
        intent_path=self.directory/"initialization.json"
        if not intent_path.exists():
            candidates=sorted(self.directory.glob(".initialization.json.*.tmp"))
            if candidates:
                # A completed original atomic-write temporary is a recoverable publication,
                # never permission to generate a new identity or adopt unrelated slot files.
                if len(candidates)!=1 or candidates[0].is_symlink() or not candidates[0].is_file() or candidates[0].stat().st_size>16384:
                    raise Problem("initialization_pending_ambiguous","The original initialization publication cannot be uniquely recovered; preserve the existing slot.")
                try:
                    pending=read_json(candidates[0])
                    identifier(pending.get("id"),"Original initialization ID")
                    timestamp(pending.get("created"),"Original initialization time")
                    if set(pending)!={"schema","id","created"} or pending["schema"]!="starforge.groundwater-initialization.v1":
                        raise ValueError("Unexpected initialization schema")
                except (ValueError,KeyError,Problem) as exc:
                    raise Problem("initialization_pending_incomplete","The original initialization temporary is incomplete; its bytes were preserved.",detail=str(exc)) from exc
                if initial_workspace_id is not None and pending["id"]!=initial_workspace_id:
                    raise Problem("initial_workspace_mismatch","The original pending initialization retains another workspace ID.")
                if any(path.name not in ("workspace.lock",candidates[0].name) for path in self.directory.iterdir()):
                    raise Problem("workspace_not_empty","Unbound files remain beside the original pending initialization; no replacement was created.")
                os.link(candidates[0],intent_path)
                sync_directory(self.directory)
                candidates[0].unlink()
                sync_directory(self.directory)
        if not intent_path.exists() and any(path.name!="workspace.lock" for path in self.directory.iterdir()):
            raise Problem("workspace_not_empty","Choose an empty original workspace directory; existing files without an initialization intent were not adopted.")
        if intent_path.exists():
            intent=read_json(intent_path)
            identifier(intent.get("id"),"Original initialization ID")
            if initial_workspace_id is not None and intent["id"]!=initial_workspace_id:
                raise Problem("initial_workspace_mismatch","The interrupted initialization retains another original workspace ID.")
        else:
            intent={"schema":"starforge.groundwater-initialization.v1","id":initial_workspace_id or "groundwater-"+uuid.uuid4().hex,"created":now()}
            write_json(intent_path,intent,create_only=True)
        temporary=self.directory/(".groundwater-"+intent["id"]+".sqlite.init")
        publication=self.directory/"initialization-publication.json"
        completion=self.directory/"initialization-complete.json"
        if completion.exists():
            raise Problem("original_database_unavailable","The original initialized database was published and is now missing. Restore its retained backup; no empty replacement was created.")
        if publication.exists():
            prior=read_json(publication)
            if prior.get("id")!=intent["id"] or prior.get("temporary")!=temporary.name:
                raise Problem("initialization_identity","The retained publication belongs to a different original database.")
            if not temporary.is_file():
                raise Problem("initialization_publication_unavailable","An original publication attempt exists without its database or temporary source. Preserve this original request and restore the retained database.")
        if temporary.is_symlink():
            raise Problem("initialization_path","The original initialization path is linked; no database was replaced.")
        if not publication.exists():
            db=sqlite3.connect(temporary)
            try:
                db.executescript("""
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,request TEXT NOT NULL,action TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,project_id TEXT,kind TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS records_project ON records(project_id,kind);
                CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT,project_id TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL);
                """)
                db.execute("INSERT OR IGNORE INTO meta VALUES('id',?)", (intent["id"],))
                db.execute("INSERT OR IGNORE INTO meta VALUES('version','0')")
                db.execute("INSERT OR IGNORE INTO meta VALUES('created',?)", (intent["created"],))
                db.commit()
            finally:
                db.close()
        retained=self._verify_existing(temporary)
        if retained["id"]!=intent["id"] or retained["created"]!=intent["created"] or retained["version"]!="0":
            raise Problem("initialization_identity","The retained initial database differs from its original creation intent.")
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        publication_value={"schema":"starforge.groundwater-initialization-publication.v1","id":intent["id"],"temporary":temporary.name,"database":file_info(temporary)}
        if publication.exists():
            previous=read_json(publication)
            if previous!=publication_value:
                raise Problem("initialization_identity","The original temporary database changed after its publication attempt.")
        write_json(publication,publication_value,create_only=True)
        os.link(temporary,self.db_path)
        sync_directory(self.directory)
        write_json(completion,{"schema":"starforge.groundwater-initialization-complete.v1","id":intent["id"],"database":publication_value["database"],"published_at":now()},create_only=True)
        temporary.unlink()
        sync_directory(self.directory)
    def _meta(self, db):
        return dict(db.execute("SELECT key,value FROM meta").fetchall())
    def _record(self, db, record_id, kind=None):
        identifier(record_id)
        row = db.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
        if row is None or (kind and row["kind"] != kind):
            raise Problem("record_not_found", "The original record was not found.", 404, id=record_id)
        return {**json.loads(row["body"]), "id":row["id"], "project_id":row["project_id"], "created":row["created"], "updated":row["updated"]}
    def _put(self, db, record_id, kind, body, project_id=None):
        created = now()
        prior = db.execute("SELECT created,kind,project_id FROM records WHERE id=?", (record_id,)).fetchone()
        if prior and (prior["kind"] != kind or prior["project_id"] != project_id):
            raise Problem("record_identity", "An original record cannot change its kind or project.")
        db.execute("INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated",
                   (record_id, project_id, kind, json_text(body), prior["created"] if prior else created, created))
        return self._record(db, record_id, kind)
    def _project(self, db, project_id):
        row = db.execute("SELECT * FROM projects WHERE id=?", (identifier(project_id),)).fetchone()
        if row is None:
            raise Problem("project_not_found", "The selected project does not exist.", 404)
        return {**json.loads(row["body"]),"id":row["id"],"version":row["version"],"created":row["created"],"updated":row["updated"]}
    def record(self, record_id, kind=None):
        with self.connect() as db:
            return self._record(db, record_id, kind)
    def _list(self, db, kind, project_id=None):
        sql = "SELECT * FROM records WHERE kind=?"
        args = [kind]
        if project_id is not None:
            sql += " AND project_id=?"; args.append(project_id)
        sql += " ORDER BY created,id"
        return [{**json.loads(x["body"]),"id":x["id"],"project_id":x["project_id"],"created":x["created"],"updated":x["updated"]} for x in db.execute(sql,args)]
    def _latest_review(self, db, subject_kind, subject_id, subject_sha):
        reviews = [r for r in self._list(db,"review") if r["subject_kind"] == subject_kind and r["subject_id"] == subject_id and r["subject_sha256"] == subject_sha]
        return reviews[-1] if reviews else None
    def runtime(self):
        with self.connect() as db:
            row = db.execute("SELECT value FROM meta WHERE key='runtime'").fetchone()
            return json.loads(row["value"]) if row else None
    def operation(self, operation_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM operations WHERE id=?", (identifier(operation_id,"Operation ID"),)).fetchone()
            if row is None:
                raise Problem("operation_not_recorded", "No committed original operation is recorded. An in-progress request may still finish.", 404)
            return {"id":row["id"],"state":"committed","action":row["action"],"request_sha256":row["request_sha256"],"request":json.loads(row["request"]),"result":json.loads(row["result"]),"created":row["created"]}
    def state(self, project_id=None):
        from .native import run_summary
        with self.connect() as db:
            meta = self._meta(db)
            projects = [self._project(db,r[0]) for r in db.execute("SELECT id FROM projects ORDER BY created")]
            selected = self._project(db,project_id) if project_id else None
            value = {"workspace":{"id":meta["id"],"version":int(meta["version"]),"created":meta["created"]},
                     "projects":projects,"project":selected,"runtime":json.loads(meta["runtime"]) if "runtime" in meta else None}
            for key, kind in (("sources","source"),("editions","edition"),("reviews","review"),("runs","run"),("reports","report"),("receivers","receiver"),("deliveries","delivery"),("acknowledgments","acknowledgment"),("backups","backup")):
                rows = self._list(db,kind,project_id if kind not in ("receiver","backup") else None)
                if kind == "edition":
                    for row in rows:
                        review = self._latest_review(db,"edition",row["id"],row["sha256"])
                        row["review_state"] = review["decision"] if review else "unreviewed"
                if kind == "run":
                    rows = [run_summary(self,row) for row in rows]
                if kind == "report":
                    rows = [{k:r[k] for k in ("id","project_id","run_id","title","sha256","created","downloads") if k in r} for r in rows]
                value[key] = rows
            sql = "SELECT * FROM history" + (" WHERE project_id=?" if project_id else "") + " ORDER BY seq"
            value["history"] = [{**dict(r),"body":json.loads(r["body"])} for r in db.execute(sql,(project_id,) if project_id else ())]
            return value
    def source_detail(self, source_id):
        with self.connect() as db:
            source = self._record(db,source_id,"source")
            return {"source":source,"editions":[r for r in self._list(db,"edition",source["project_id"]) if r["source_id"]==source_id]}
    def edition_detail(self, edition_id):
        with self.connect() as db:
            edition = self._record(db,edition_id,"edition")
            return {"edition":edition,"source":self._record(db,edition["source_id"],"source"),"reviews":[r for r in self._list(db,"review",edition["project_id"]) if r["subject_id"]==edition_id],"runs":[r for r in self._list(db,"run",edition["project_id"]) if r["edition_id"]==edition_id]}
    def source_file(self, source_id, name):
        source = self.record(source_id,"source")
        row = next((r for r in source["files"] if r["path"] == relative(name)),None)
        if row is None:
            raise Problem("file_not_found","The original source member is not in this source edition.",404)
        return self._file(self.objects.path(row),row,Path(name).name)
    def _file(self,path,record=None,filename=None,mime=None):
        info = verify_file(path,record) if record else file_info(path)
        return {"path":Path(path),"filename":filename or Path(path).name,"mime":mime or mimetypes.guess_type(filename or str(path))[0] or "application/octet-stream",**info}
    def static_file(self,name):
        if name not in ("index.html","app.js","style.css"):
            raise Problem("asset_not_found","Operator asset does not exist.",404)
        return self._file(self.application/"ui"/name)
    def guide_file(self):
        return self._file(self.application/"OPERATOR.md",mime="text/markdown; charset=utf-8")
    def run_detail(self,run_id):
        from .native import run_detail
        return run_detail(self,run_id)
    def run_file(self,run_id,name):
        from .native import run_file
        return run_file(self,run_id,name)
    def compare(self,run_id,baseline_run_id):
        from .analysis import compare_results
        current = self.run_detail(run_id)
        baseline = self.run_detail(baseline_run_id)
        if current["run"]["project_id"] != baseline["run"]["project_id"]:
            raise Problem("comparison_project","Choose retained runs in the same project.")
        if current.get("result") is None or baseline.get("result") is None:
            raise Problem("run_incomplete","Both original runs must be complete.")
        return compare_results(baseline["result"],current["result"])
    def report_detail(self,report_id):
        from .delivery import report_detail
        return report_detail(self,report_id)
    def report_export(self,report_id,format):
        from .delivery import report_export
        return report_export(self,report_id,format)
    def backup_file(self,backup_id):
        from .delivery import backup_file
        return backup_file(self,backup_id)
    def _normalize_request(self, request):
        if not isinstance(request,dict):
            raise Problem("request","Request must be an object.",400)
        action = text(request.get("action"),"Action",100,True)
        actor = text(request.get("actor"),"Actor",200,True)
        operation_id = identifier(request.get("operation_id"),"Operation ID")
        expected = integer(request.get("expected_version"),"Expected workspace version",0,2**53-1)
        payload = copy.deepcopy(request.get("payload",{}))
        if not isinstance(payload,dict):
            raise Problem("payload","Payload must be an object.",400)
        upload = None
        if action == "source.import":
            upload = decode_upload(payload.pop("content_base64",None))
            payload["original_upload"] = {"sha256":digest(upload),"bytes":len(upload)}
        value = {"action":action,"actor":actor,"operation_id":operation_id,"expected_version":expected,"payload":payload}
        return value, upload
    def dispatch(self,request):
        normalized, upload = self._normalize_request(request)
        request_sha = digest(normalized)
        op, action, actor, payload = (normalized[k] for k in ("operation_id","action","actor","payload"))
        effect = None
        with Lock(self.directory/"workspace.lock"), self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT * FROM operations WHERE id=?",(op,)).fetchone()
            if prior:
                if prior["request_sha256"] != request_sha:
                    raise Problem("operation_mismatch","This operation ID already belongs to different original request bytes.")
                result, created, replayed = json.loads(prior["result"]),prior["created"],True
                # A commit can precede runtime inspection and dispatch. Replaying
                # its exact request may finish that never-dispatched side effect.
                # A prior dispatched attempt still requires explicit run.resume.
                if action in ("run.execute","run.resume"):
                    from .native import run_directory
                    run=self._record(db,payload["id"],"run")
                    attempt=run_directory(self,run["id"])/"attempts"/str(run.get("attempt",0))
                    if run["state"]=="queued" and not (attempt/"dispatch.json").exists():
                        effect=("run",run["id"],{"retry_incomplete":False})
            else:
                current = int(self._meta(db)["version"])
                if normalized["expected_version"] != current:
                    raise Problem("stale_version","The workspace changed. Your draft is preserved; reload and review before a new request.",current_version=current,input_preserved=True)
                if upload is not None:
                    self.objects.put(upload)
                result,effect,project_id = self._apply(db,action,payload,actor,op,request_sha)
                created,replayed = now(),False
                result = {**result,"workspace_version":current+1}
                db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?)",(op,request_sha,json_text(normalized),action,json_text(result),created))
                db.execute("UPDATE meta SET value=? WHERE key='version'",(str(current+1),))
                db.execute("INSERT INTO history(operation_id,project_id,action,actor,body,created) VALUES(?,?,?,?,?,?)",(op,project_id,action,actor,json_text({"result":result,"request":normalized}),created))
            db.commit()
        if effect is not None:
            kind, record_id, options = effect
            try:
                if kind == "run":
                    from .native import launch
                    launch(self,record_id,**options)
                elif kind == "delivery":
                    from .delivery import deliver
                    deliver(self,record_id)
                elif kind == "backup":
                    from .delivery import finish_backup
                    finish_backup(self,record_id)
            except Problem:
                raise
        project_id = result.get("project_id")
        return {"state":self.state(project_id),"result":result,"operation":{"id":op,"action":action,"state":"committed","replayed":replayed,"created":created}}
    def _id(self,prefix,operation):
        return prefix+"-"+digest(operation.encode())[:24]
    def _same_project(self,record,project_id):
        if record["project_id"] != project_id:
            raise Problem("project_binding","The selected original belongs to a different project.")
    def _review(self,db,kind,subject,sha,payload,actor,op,findings):
        decision = payload.get("decision")
        if decision not in ("approved","changes_requested"):
            raise Problem("decision","Choose approved or changes_requested.",400)
        reason = text(payload.get("reason"),"Review reason",8000,True)
        choices = payload.get("findings",[])
        if not isinstance(choices,list):
            raise Problem("findings","Finding dispositions must be an array.",400)
        ids = {x["id"] for x in findings}
        seen = set()
        for value in choices:
            if value.get("id") not in ids or value["id"] in seen or value.get("disposition") not in ("acknowledged","requires_change"):
                raise Problem("finding_disposition","Use each actual finding ID once with an explicit disposition.",400)
            seen.add(value["id"])
            text(value.get("reason"),"Finding reason",4000,True)
        if decision == "approved":
            required = {x["id"] for x in findings if x.get("severity") in ("review","blocking")}
            acknowledged = {x["id"] for x in choices if x["disposition"]=="acknowledged"}
            if not required <= acknowledged or any(x["disposition"]=="requires_change" for x in choices):
                raise Problem("unresolved_findings","Review each source/result finding explicitly before approval.",required=sorted(required-acknowledged))
            if any(x.get("severity") == "blocking" for x in findings):
                raise Problem("blocking_finding","An incomplete native source/result must be corrected before approval.")
        record = self._put(db,self._id("review",op),"review",{"subject_kind":kind,"subject_id":subject["id"],"subject_sha256":sha,"decision":decision,"reason":reason,"findings":choices,"actor":actor},subject["project_id"])
        return {"id":record["id"],"project_id":subject["project_id"],"subject_id":subject["id"],"decision":decision}
    def _apply(self,db,action,p,actor,op,request_sha):
        effect = None
        project_id = p.get("project_id")
        if action == "project.create":
            project_id = self._id("project",op)
            body = {"name":text(p.get("name"),"Project name",300,True),"description":text(p.get("description",""),"Description",12000),"site_label":text(p.get("site_label",""),"Site label",1000)}
            created = now()
            db.execute("INSERT INTO projects VALUES(?,?,?,?,?)",(project_id,1,json_text(body),created,created))
            result = {"id":project_id,"project_id":project_id}
        elif action == "project.update":
            current = self._project(db,p["id"])
            if p.get("expected_project_version") != current["version"]:
                raise Problem("project_version","The original project settings changed.",current_version=current["version"])
            project_id = current["id"]
            body = {"name":text(p.get("name"),"Project name",300,True),"description":text(p.get("description",""),"Description",12000),"site_label":text(p.get("site_label",""),"Site label",1000)}
            db.execute("UPDATE projects SET body=?,version=version+1,updated=? WHERE id=?",(json_text(body),now(),project_id))
            result = {"id":project_id,"project_id":project_id}
        elif action in ("source.publisher","source.import"):
            self._project(db,project_id)
            source_id,edition_id = self._id("source",op),self._id("edition",op)
            if action == "source.publisher":
                originals = sources.publisher_source(self.application)
                files = [{**self.objects.put(raw),"path":name,"role":"publisher_source","origin":{k:v for k,v in metadata.items() if k not in ("content","path","bytes","sha256")}} for name,raw,metadata in originals]
                profile,findings,param = sources.twri_profile(),copy.deepcopy(sources.FINDINGS),sources.parameters()
                kind,name,archive = "publisher_twri",p.get("name","Unchanged USGS TWRI publisher baseline"),None
            else:
                from .common import zip_members
                archive = p["original_upload"]
                raw = self.objects.bytes(archive)
                members = zip_members(raw)
                files = [{**self.objects.put(content),"path":name,"role":"original_model"} for name,content in members]
                profile,findings = sources.package_profile(members,p)
                param = None
                kind,name = "native_package",text(p.get("name"),"Source name",300,True)
                archive = {**archive,"filename":text(p.get("filename"),"Original ZIP filename",500,True)}
            source_body = {"kind":kind,"name":text(name,"Source name",300,True),"files":files,"archive":archive,"profile":profile,"findings":findings,"actor":actor}
            source_body["sha256"] = digest(source_body)
            self._put(db,source_id,"source",source_body,project_id)
            body = {"source_id":source_id,"parent_id":None,"baseline_id":edition_id,"kind":"baseline","name":name,"description":"Unchanged original source baseline.","changes":[],"parameters":param,"profile":profile,"source_sha256":source_body["sha256"],"actor":actor}
            body["sha256"] = digest(body)
            self._put(db,edition_id,"edition",body,project_id)
            result = {"id":source_id,"source_id":source_id,"edition_id":edition_id,"project_id":project_id}
        elif action == "edition.create":
            parent = self._record(db,p["parent_id"],"edition")
            project_id = parent["project_id"]
            if p.get("project_id") != project_id:
                raise Problem("project_binding","Scenario parent belongs to another project.")
            params,profile,changes = sources.derive(parent,p.get("changes"),p.get("description",""))
            record_id = self._id("edition",op)
            body = {"source_id":parent["source_id"],"parent_id":parent["id"],"baseline_id":parent["baseline_id"],"kind":"scenario","name":text(p.get("name"),"Scenario name",300,True),"description":text(p.get("description",""),"Scenario purpose",12000),"changes":changes,"parameters":params,"profile":profile,"source_sha256":parent["source_sha256"],"actor":actor}
            body["sha256"] = digest(body)
            self._put(db,record_id,"edition",body,project_id)
            result = {"id":record_id,"project_id":project_id}
        elif action in ("edition.review","run.review"):
            kind = action.split(".")[0]
            subject = self._record(db,p["id"],kind)
            project_id = subject["project_id"]
            if kind == "edition":
                source = self._record(db,subject["source_id"],"source")
                sha,findings = subject["sha256"],source["findings"]
            else:
                from .native import completed_result
                native = completed_result(self,subject)
                sha,findings = digest(native),native["findings"]
            result = self._review(db,kind,subject,sha,p,actor,op,findings)
        elif action == "runtime.configure":
            from .native import inspect_runtime
            runtime = inspect_runtime(p,temp_root=self.directory)
            runtime.update({"actor":actor,"reason":text(p.get("reason"),"Runtime reason",4000,True),"configured_at":now()})
            db.execute("INSERT INTO meta VALUES('runtime',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json_text(runtime),))
            result = {"runtime_sha256":runtime["sha256"]}
        elif action == "run.create":
            edition = self._record(db,p["edition_id"],"edition")
            source = self._record(db,edition["source_id"],"source")
            project_id = edition["project_id"]
            if any(x.get("severity")=="blocking" for x in source["findings"]):
                raise Problem("source_incomplete","Resolve the original native source selection and missing references before running.")
            if edition["kind"] == "scenario":
                review = self._latest_review(db,"edition",edition["id"],edition["sha256"])
                if not review or review["decision"] != "approved":
                    raise Problem("scenario_review","Approve this exact immutable scenario before native execution.")
            meta = self._meta(db)
            if "runtime" not in meta:
                raise Problem("runtime_required","Configure the actual pinned native runtime first.")
            runtime = json.loads(meta["runtime"])
            record_id = self._id("run",op)
            application_files=[row for row in inventory(self.application) if not any(part in (".git",".venv","node_modules","__pycache__","build","dist") or part.endswith(".egg-info") for part in row["path"].split("/")) and not row["path"].endswith(".pyc")]
            for row in application_files:
                raw=(self.application/row["path"]).read_bytes()
                if digest(raw)!=row["sha256"] or len(raw)!=row["bytes"]:
                    raise Problem("application_source_changed","The original application changed while it was being captured.",path=row["path"])
                self.objects.put(raw)
            if not any(row["path"]=="groundwater_workspace/native_attempt.py" for row in application_files):
                raise Problem("application_source","The complete original native application must be installed before creating a run.")
            body = {"edition_id":edition["id"],"edition_sha256":edition["sha256"],"source_id":source["id"],"source_sha256":source["sha256"],"state":"queued","attempt":0,"reason":text(p.get("reason"),"Run purpose",8000,True),"actor":actor,"runtime":runtime,"runtime_sha256":runtime["sha256"],"application_sha256":digest(application_files),"application_files":application_files,"operation_id":op,"request_sha256":request_sha,"runtime_rebindings":[]}
            self._put(db,record_id,"run",body,project_id)
            result = {"id":record_id,"project_id":project_id,"state":"queued"}
        elif action in ("run.execute","run.resume"):
            from .native import prepare_launch
            run = self._record(db,p["id"],"run")
            project_id = run["project_id"]
            reason = text(p.get("reason"),"Run continuation reason",8000,True)
            retry = p.get("retry_incomplete",False)
            rebind = p.get("rebind_runtime",False)
            if not isinstance(retry,bool) or not isinstance(rebind,bool):
                raise Problem("boolean","Run continuation selections must be booleans.",400)
            run = prepare_launch(self,db,run,retry,rebind,actor,reason)
            effect = ("run",run["id"],{"retry_incomplete":retry})
            result = {"id":run["id"],"project_id":project_id,"state":run["state"]}
        elif action == "report.freeze":
            from .delivery import freeze_report
            result = freeze_report(self,db,p,actor,op,request_sha)
            project_id = result["project_id"]
        elif action == "receiver.save":
            directory = Path(text(p.get("directory"),"Receiving directory",4000,True)).expanduser()
            if not directory.is_absolute() or not directory.is_dir() or directory.is_symlink():
                raise Problem("receiver_directory","Select an existing absolute receiving directory.")
            directory = directory.resolve()
            if directory == self.directory or directory.is_relative_to(self.directory) or self.directory.is_relative_to(directory):
                raise Problem("receiver_directory","Select a receiving directory separate from this workspace.")
            record_id = p.get("id") or self._id("receiver",op)
            if p.get("id"):
                previous = self._record(db,record_id,"receiver")
                if p.get("expected_receiver_version") != previous["version"]:
                    raise Problem("receiver_version","The selected receiver configuration changed.",current_version=previous["version"])
                version = previous["version"]+1
            else:
                version = 1
            self._put(db,record_id,"receiver",{"name":text(p.get("name"),"Receiver name",300,True),"directory":str(directory),"version":version,"actor":actor})
            result = {"id":record_id}
        elif action == "report.deliver":
            report = self._record(db,p["report_id"],"report")
            receiver = self._record(db,p["receiver_id"],"receiver")
            from .delivery import verify_report
            verify_report(self,report)
            project_id = report["project_id"]
            record_id = self._id("delivery",op)
            body = {"report_id":report["id"],"receiver_id":receiver["id"],"receiver":receiver,"state":"queued","filename":report["id"]+".zip","sha256":report["archive"]["sha256"],"bytes":report["archive"]["bytes"],"report_sha256":report["sha256"],"actor":actor,"reason":text(p.get("reason"),"Delivery reason",8000,True),"operation_id":op}
            self._put(db,record_id,"delivery",body,project_id)
            result = {"id":record_id,"project_id":project_id,"state":"queued"}
            effect = ("delivery",record_id,{})
        elif action in ("delivery.resume","delivery.reconcile"):
            from .delivery import reconcile_delivery
            delivery = self._record(db,p["id"],"delivery")
            project_id = delivery["project_id"]
            if action == "delivery.resume":
                text(p.get("reason"),"Continuation reason",8000,True)
                effect = ("delivery",delivery["id"],{})
                result = {"id":delivery["id"],"project_id":project_id,"state":delivery["state"]}
            else:
                result = reconcile_delivery(self,db,delivery)
        elif action == "delivery.acknowledge":
            from .delivery import reconcile_delivery
            delivery = self._record(db,p["id"],"delivery")
            project_id = delivery["project_id"]
            reconciliation = reconcile_delivery(self,db,delivery)
            if reconciliation["state"] != "complete":
                raise Problem("delivery_unverified","Verify the complete original package before recording its receiving decision.")
            if p.get("decision") not in ("accepted","corrections_requested"):
                raise Problem("decision","Choose accepted or corrections_requested.",400)
            record_id = self._id("acknowledgment",op)
            body = {"delivery_id":delivery["id"],"report_sha256":delivery["report_sha256"],"package_sha256":delivery["sha256"],"decision":p["decision"],"by":text(p.get("by"),"Receiving reviewer",300,True),"occurred_on":timestamp(p.get("occurred_on")),"reference":text(p.get("reference"),"Receiving reference",4000,True),"reason":text(p.get("reason"),"Receiving decision reason",8000,True),"actor":actor}
            self._put(db,record_id,"acknowledgment",body,project_id)
            result = {"id":record_id,"project_id":project_id,"delivery_id":delivery["id"]}
        elif action in ("backup.create","backup.resume"):
            if action == "backup.create":
                record_id = self._id("backup",op)
                self._put(db,record_id,"backup",{"status":"queued","actor":actor,"reason":text(p.get("reason"),"Backup reason",8000,True),"operation_id":op,"request_sha256":request_sha})
            else:
                record_id = p["id"]
                backup = self._record(db,record_id,"backup")
                if backup["status"] == "external_archive":
                    raise Problem("external_archive","This is restored history of an archive held by its original receiver. Create a new backup for the current workspace.")
                text(p.get("reason"),"Backup continuation reason",8000,True)
            effect = ("backup",record_id,{})
            result = {"id":record_id,"status":"queued"}
        else:
            raise Problem("unknown_action","This groundwater action is not supported.",400,action=action)
        return result,effect,project_id
    def update_native(self,run_id,body):
        with Lock(self.directory/"workspace.lock"), self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = self._record(db,run_id,"run")
            self._put(db,run_id,"run",{**{k:v for k,v in prior.items() if k not in ("id","project_id","created","updated")},**body},prior["project_id"])
