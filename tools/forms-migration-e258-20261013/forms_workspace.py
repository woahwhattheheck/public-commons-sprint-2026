"""Persistent source, mapping and edition workspace for the original forms engine."""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
from contextlib import closing
import argparse
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import tempfile
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from discovery_engine import DiscoveryError, require, parse_json_bytes, json_bytes, read_json, file_digest, validate_manifest
from migration_reconciliation import validate as validate_migration
import forms_capture as capture_engine
from forms_workbench import (APPLICATION, CLASSES, INTAKE, validate_plan, validate_bindings,
                            regular_under, relative, inventory_files, run_project,
                            verify_project, pack_project, receive_project)
from forms_server import complete_archive

HERE = Path(__file__).resolve().parent
SCHEMA = "tjlabs.forms-workspace.v1"
API = "tjlabs.forms-workspace.response.v1"
ARCHIVE = "tjlabs.forms-workspace.archive.v1"
ID = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,95}\Z")
BASE_EXTRAS = ("receiving.py","fixtures/demo-a/manifest.json","fixtures/demo-b/manifest.json",
               "fixtures/demo-a/enrolments.csv","fixtures/demo-b/enrolments.csv",
               "fixtures/demo-a/programmes.csv","fixtures/demo-b/programmes.csv")
WORKSPACE_FILES = ("forms_workspace.py","forms_workspace_server.py","forms_workspace_report.py",
                   "FORMS_WORKSPACE_API.json","FORMS_WORKSPACE.md",
                   "receiving_forms_workspace.py","receiving_forms_workspace_browser.mjs",
                   "forms_installation.py","FORMS_INSTALLATION.md")
SOFTWARE = tuple(APPLICATION) + BASE_EXTRAS + WORKSPACE_FILES
RAW_LIMIT = 128*1024*1024
MUTATIONS = {"capture.import","draft.create","draft.save","run.create"}
READS = {"workspace.describe","capture.list","capture.show","capture.assets","capture.worksheet",
         "capture.csv","draft.list","draft.show","draft.history","draft.validate",
         "run.list","run.show","request.show","request.status"}

def now():
    return datetime.now(timezone.utc).isoformat()

def identifier(value,label="identifier"):
    require(isinstance(value,str) and ID.fullmatch(value), "Invalid "+label)
    return value

def nonempty(value,label):
    require(isinstance(value,str) and value.strip(), label+" is required")
    return value

def number(value,label,minimum=0,maximum=None):
    require(type(value) is int and value>=minimum and (maximum is None or value<=maximum),
            "Invalid "+label)
    return value

def measured(path):
    path=Path(path)
    require(path.is_file() and not path.is_symlink(),"Selected regular file is missing")
    return {"bytes":path.stat().st_size,"sha256":file_digest(path)}

def immutable(path,raw):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        require(path.is_file() and not path.is_symlink() and path.read_bytes()==raw,
                "An original retained file differs: "+path.name)
        return
    temp=path.with_name("."+path.name+"-"+uuid.uuid4().hex)
    try:
        with temp.open("xb") as stream:
            os.chmod(temp,0o600)
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.link(temp,path)
    finally:
        if temp.exists():temp.unlink()

def source_files():
    rows=[]
    for name in SOFTWARE:
        path=regular_under(HERE,name)
        rows.append({"path":name,**measured(path)})
    return rows

def stream_rows(path):
    with Path(path).open(encoding="utf-8") as stream:
        for line in stream:
            yield parse_json_bytes(line.encode("utf-8"))

def pages(params):
    return number(params.get("offset",0),"offset"),number(params.get("limit",40),"limit",1,500)

def original_assets(root):
    rows=list(stream_rows(Path(root)/"assets.jsonl"))
    require(len({a["id"] for a in rows})==len(rows),"Repeated original capture asset identity")
    return rows

def source_difference(old,new):
    a={x["id"]:x for x in old};b={x["id"]:x for x in new}
    return [{"asset_id":key,"before":a.get(key),"after":b.get(key)}
            for key in sorted(set(a)|set(b)) if a.get(key)!=b.get(key)]

class Workspace:
    """One process owns the workspace writer; HTTP threads share the same mutex."""
    def __init__(self,directory,create=False,label=None):
        self.root=Path(directory).resolve()
        self.mutex=threading.RLock()
        self.db=None;self.lock=None;self._capture_cache={}
        require(not self.root.is_relative_to(HERE),"Private workspace must be outside selected software")
        if create:
            require(not self.root.exists(),"Choose a new private workspace directory")
            self.root.mkdir(parents=True,mode=0o700)
        require(self.root.is_dir() and not Path(directory).is_symlink(),"Existing ordinary workspace required")
        self.lock=(self.root/".workspace.lock").open("a+b")
        try:
            fcntl.flock(self.lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            selected=source_files()
            if create:
                meta={"schema":SCHEMA,"workspace_id":"workspace-"+uuid.uuid4().hex,
                      "label":nonempty(label,"workspace label"),"created_at":now(),"source_files":selected}
                immutable(self.root/"workspace.json",json_bytes(meta))
            self.meta=read_json(self.root/"workspace.json")
            require(self.meta.get("schema")==SCHEMA and self.meta["source_files"]==selected,
                    "Open this workspace with its complete original selected software")
            if (self.root/"software").exists():
                for entry in selected:
                    require(measured(regular_under(self.root/"software",entry["path"]))==
                            {"bytes":entry["bytes"],"sha256":entry["sha256"]},"Received selected software differs")
            for name in ("captures","runs","operations","incoming","cache"):
                (self.root/name).mkdir(exist_ok=True,mode=0o700)
            dbfile=self.root/"workspace.sqlite"
            require(create or dbfile.is_file(),"Original workspace database is missing")
            self.db=sqlite3.connect(dbfile,check_same_thread=False)
            self.db.row_factory=sqlite3.Row
            self.db.execute("PRAGMA journal_mode=DELETE")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("PRAGMA foreign_keys=ON")
            if create:
                self.db.executescript("""
CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE captures(id TEXT PRIMARY KEY,archive_sha TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
CREATE TABLE drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
CREATE TABLE draft_history(id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(id,revision));
CREATE TABLE runs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE requests(id TEXT PRIMARY KEY,digest TEXT NOT NULL,method TEXT NOT NULL,params TEXT NOT NULL,
 input TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL,finished_at TEXT);
""")
                self.db.execute("INSERT INTO state VALUES('revision','0')")
                self.db.execute("INSERT INTO state VALUES('workspace_id',?)",(self.meta["workspace_id"],))
                self.db.commit()
            require(self.db.execute("SELECT value FROM state WHERE key='workspace_id'").fetchone()[0]==
                    self.meta["workspace_id"],"Database belongs to another workspace")
        except BaseException:
            self.close();raise

    def close(self):
        if self.db is not None:self.db.close();self.db=None
        if self.lock is not None:self.lock.close();self.lock=None

    def __enter__(self):return self
    def __exit__(self,*args):self.close()

    def _revision(self):
        return int(self.db.execute("SELECT value FROM state WHERE key='revision'").fetchone()[0])

    def _bump(self):
        n=self._revision()+1
        self.db.execute("UPDATE state SET value=? WHERE key='revision'",(str(n),))
        return n

    def _item(self,table,identity):
        identifier(identity,table+" identity")
        require(table in ("captures","drafts","runs"),"Unknown original collection")
        row=self.db.execute("SELECT payload FROM "+table+" WHERE id=?",(identity,)).fetchone()
        require(row is not None,"Selected "+table+" record does not exist")
        return json.loads(row[0])

    def _capture_root(self,capture):
        root=self.root/relative(capture["directory"])/"capture"
        stamp=[]
        for path in sorted(root.rglob("*")):
            require(not path.is_symlink(),"Original capture contains a symbolic link")
            if path.is_file():
                value=path.stat()
                stamp.append((path.relative_to(root).as_posix(),value.st_dev,value.st_ino,
                              value.st_size,value.st_mtime_ns,value.st_ctime_ns))
            else:require(path.is_dir(),"Original capture contains a nonregular member")
        cached=self._capture_cache.get(capture["id"])
        if cached and cached[0]==stamp:
            return root
        verified=capture_engine.verify(root)
        require(verified["selection_sha256"]==capture["selection_sha256"],
                "Original capture selection differs")
        self._capture_cache[capture["id"]]=(stamp,verified)
        return root

    def _draft(self,params,check_revision=False):
        draft=self._item("drafts",params.get("draft_id"))
        if check_revision:
            require(number(params.get("expected_revision"),"expected revision",1)==draft["revision"],
                    "A later draft revision exists. Preserve this complete draft and compare current history.")
        return draft

    def _envelope(self,value):
        return {"schema":API,"workspace_id":self.meta["workspace_id"],
                "workspace_revision":self._revision(),"value":value}

    def dispatch(self,method,params=None,request_id=None):
        params={} if params is None else params
        require(isinstance(params,dict),"Complete parameters object required")
        if method=="request.status":
            rid=identifier(params.get("request_id"),"request ID")
            with closing(sqlite3.connect((self.root/"workspace.sqlite").as_uri()+"?mode=ro",uri=True,timeout=10)) as reader:
                row=reader.execute("SELECT method,status,created_at,finished_at,error FROM requests WHERE id=?",(rid,)).fetchone()
                require(row is not None,"Original request is missing")
                revision=int(reader.execute("SELECT value FROM state WHERE key='revision'").fetchone()[0])
            phases=[]
            phase_root=self.root/"operations"/rid
            if phase_root.exists():
                for path in sorted(phase_root.glob("phase-*.json")):
                    phases.append(read_json(path))
            return {"schema":API,"workspace_id":self.meta["workspace_id"],"workspace_revision":revision,
                    "value":{"request_id":rid,"method":row[0],"status":row[1],"created_at":row[2],
                             "finished_at":row[3],"error":json.loads(row[4]) if row[4] else None,"phases":phases}}
        with self.mutex:
            if method in READS:
                return self._envelope(self._read(method,params))
            require(method in MUTATIONS,"Unknown workspace operation")
            rid=identifier(request_id,"request ID")
            require(len(rid)<=64,"Request ID must contain at most64 characters")
            body=json_bytes({"method":method,"params":params})
            digest=hashlib.sha256(body).hexdigest()
            existing=self.db.execute("SELECT * FROM requests WHERE id=?",(rid,)).fetchone()
            if existing:
                require(existing["digest"]==digest,"Request ID is already bound to different original parameters")
                if existing["status"]=="COMPLETE":
                    return json.loads(existing["result"])
                if existing["status"]=="FAILED":
                    raise DiscoveryError(json.loads(existing["error"])["message"])
                frozen=json.loads(existing["input"])
            else:
                frozen=self._freeze(method,params,rid)
                self.db.execute("INSERT INTO requests VALUES(?,?,?,?,?,'RUNNING',NULL,NULL,?,NULL)",
                    (rid,digest,method,json.dumps(params,ensure_ascii=False),
                     json.dumps(frozen,ensure_ascii=False),now()))
                self.db.commit()
            try:
                with self.db:
                    value=self._apply(method,params,rid,frozen)
                    self._bump()
                    answer=self._envelope(value)
                    self.db.execute("UPDATE requests SET status='COMPLETE',result=?,finished_at=? WHERE id=?",
                        (json.dumps(answer,ensure_ascii=False),now(),rid))
                return answer
            except Exception as exc:
                message=str(exc) if isinstance(exc,DiscoveryError) else (
                    "Original native operation failed ("+type(exc).__name__+"). Retained inputs and outputs remain available.")
                # A known returned failure ends this request. A process loss leaves RUNNING,
                # permitting recovery of that exact frozen input and deterministic output.
                with self.db:
                    self.db.execute("UPDATE requests SET status='FAILED',error=?,finished_at=? WHERE id=?",
                        (json.dumps({"type":type(exc).__name__,"message":message}),now(),rid))
                raise DiscoveryError(message) from exc

    def _freeze(self,method,params,rid):
        if method=="capture.import":
            name=identifier(params.get("archive_name"),"incoming archive name")
            archive=regular_under(self.root/"incoming",name)
            return {"archive_name":name,"archive":measured(archive)}
        if method=="draft.create":
            capture=self._item("captures",params.get("capture_id"))
            self._capture_root(capture)
            base=None
            if params.get("base_draft_id"):
                base_id=identifier(params["base_draft_id"],"original base draft")
                revision=number(params.get("base_draft_revision"),"original selected base revision",1)
                row=self.db.execute("SELECT payload FROM draft_history WHERE id=? AND revision=?",(base_id,revision)).fetchone()
                require(row is not None,"Selected complete base draft revision is missing")
                base=json.loads(row[0])
            if base and base["capture_id"]!=capture["id"]:
                nonempty(params.get("rebind_reference"),"Explicit complete source rebind reference")
            return {"capture":capture,"base":base}
        draft=self._draft(params,True)
        if method=="draft.save":
            nonempty(params.get("name"),"draft name")
            require(isinstance(params.get("raw"),str) and len(params["raw"].encode("utf-8"))<=RAW_LIMIT,
                    "Complete raw draft must be UTF-8 text no larger than128MiB")
        else:
            validation=self._validate(draft)
            require(validation["valid"],"Resolve native intake validation: "+validation["errors"][0] if validation["errors"] else
                    "Resolve native intake validation")
        return {"draft":draft,"capture":self._item("captures",draft["capture_id"])}

    def _save_draft(self,draft):
        raw=json.dumps(draft,ensure_ascii=False)
        self.db.execute("INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",
                        (draft["id"],draft["revision"],raw))
        self.db.execute("INSERT INTO draft_history VALUES(?,?,?)",(draft["id"],draft["revision"],raw))
        return draft

    def _phase(self,rid,ordinal,status,details=None):
        path=self.root/"operations"/rid/("phase-"+str(ordinal).zfill(2)+".json")
        value={"request_id":rid,"status":status,"details":details or {}}
        immutable(path,json_bytes(value))

    def _apply(self,method,params,rid,frozen):
        if method=="capture.import":
            old=self.db.execute("SELECT payload FROM captures WHERE archive_sha=?",(frozen["archive"]["sha256"],)).fetchone()
            if old:return json.loads(old[0])
            dest=self.root/"captures"/("capture-"+rid)
            archive=regular_under(self.root/"incoming",frozen["archive_name"])
            require(measured(archive)==frozen["archive"],"Original selected incoming archive changed")
            self._phase(rid,1,"CAPTURE_RECEIVING",{"archive":frozen["archive"]})
            if not dest.exists():capture_engine.receive(archive,dest)
            self._phase(rid,2,"CAPTURE_RECEIVED")
            original=dest/"capture"
            require(read_json(dest/"receiving.json")["archive"]==frozen["archive"],
                    "Retained capture receiving belongs to another original archive")
            result=capture_engine.verify(original)
            item={"id":"capture-"+rid,"directory":dest.relative_to(self.root).as_posix(),
                  "archive":dict(frozen["archive"],path="incoming/"+frozen["archive_name"]),
                  "selection_sha256":result["selection_sha256"],"label":result["label"],
                  "edition":result["edition"],"data_class":result["data_class"],
                  "assets":result["assets"],"classes":result["classes"],"created_at":now(),
                  "original_request_id":rid}
            self.db.execute("INSERT INTO captures VALUES(?,?,?)",(item["id"],frozen["archive"]["sha256"],json.dumps(item,ensure_ascii=False)))
            return item
        if method=="draft.create":
            capture=frozen["capture"];root=self._capture_root(capture)
            assets=original_assets(root);worksheet=read_json(root/"mapping-worksheet.json")
            base=frozen["base"];review=None
            if base:
                if base["capture_id"]==capture["id"]:
                    raw=base["raw"]
                else:
                    plan=parse_json_bytes(base["raw"].encode("utf-8"))
                    review={"reference":params["rebind_reference"],"prior_draft_id":base["id"],
                            "prior_draft_revision":base["revision"],"prior_capture_id":base["capture_id"],
                            "selected_capture_id":capture["id"],"assets":source_difference(plan.get("assets",[]),assets),
                            "capture_before":self._item("captures",base["capture_id"]),"capture_after":capture}
                    plan["assets"]=assets;plan["edition"]=capture["edition"];plan["data_class"]=capture["data_class"]
                    if isinstance(plan.get("discovery_manifest"),dict):
                        plan["discovery_manifest"]["edition"]=capture["edition"]
                        plan["discovery_manifest"]["data_class"]=capture["data_class"]
                        by={a["id"]:a for a in assets}
                        for table in plan["discovery_manifest"].get("tables",[]):
                            selected=by.get(plan.get("table_assets",{}).get(table.get("id")))
                            if selected and selected["availability"]=="PRESENT":
                                table["path"]=selected["path"];table["sha256"]=selected["sha256"]
                    # Parent links remain explicit prior decisions; native receiving checks
                    # current actual rows. New/unavailable identities are never guessed.
                    raw=json_bytes(plan).decode("utf-8")
            else:
                plan={"schema":INTAKE,"label":capture["label"],"edition":capture["edition"],
                      "data_class":capture["data_class"],"interpretation_reference":"",
                      "classes":worksheet["classes"],"assets":assets,"table_assets":{},"pair_classes":{},
                      "discovery_manifest":{"schema":"commons.discovery.cohort-manifest.v1",
                          "edition":capture["edition"],"data_class":capture["data_class"],
                          "source_authorization":{"owner":"","reference":worksheet["authority_reference"]},"tables":[]},
                      "migration_selection":{"schema":"tjlabs.migration-reconciliation.selection.v1",
                          "label":capture["label"],"interpretation_reference":"","population_reference":"","pairs":[]},
                      "file_comparisons":[],"attachments":worksheet["attachments"],
                      "attachment_comparison":{"filename":True,"media_type":True,"reference":""}}
                raw=json_bytes(plan).decode("utf-8")
            draft={"id":"draft-"+rid,"revision":1,"name":nonempty(params.get("name"),"draft name"),
                   "capture_id":capture["id"],"raw":raw,"created_at":now(),"updated_at":now(),
                   "base_draft_id":base["id"] if base else None,"base_draft_revision":base["revision"] if base else None,
                   "source_review":review,"original_request_id":rid}
            return self._save_draft(draft)
        if method=="draft.save":
            old=frozen["draft"]
            current=self._item("drafts",old["id"])
            require(current["revision"]==old["revision"],"A later complete draft exists; preserve and compare the original saved history")
            draft=dict(old,revision=old["revision"]+1,name=params["name"],raw=params["raw"],updated_at=now(),
                       original_request_id=rid)
            return self._save_draft(draft)
        draft=frozen["draft"];capture=frozen["capture"]
        root=self._capture_root(capture)
        run_id="run-"+rid;base=self.root/"runs"/run_id
        base.mkdir(exist_ok=True,mode=0o700)
        immutable(base/"intake.json",draft["raw"].encode("utf-8"))
        immutable(base/"selection.json",json_bytes({"draft":draft,"capture":capture,"request_id":rid}))
        project=base/"project"
        self._phase(rid,1,"NATIVE_RUNNING",{"draft_id":draft["id"],"draft_revision":draft["revision"],"capture_id":capture["id"]})
        if not project.exists():run_project(base/"intake.json",project,root)
        self._phase(rid,2,"NATIVE_COMPUTED")
        _,result=verify_project(project,check_application=True)
        require(result["project_identity"]==hashlib.sha256(draft["raw"].encode("utf-8")).hexdigest(),
                "Original native output belongs to another selected intake")
        archive=base/"Forms_Project.zip"
        if not archive.exists():pack_project(project,archive)
        complete_archive(archive,project,result)
        self._phase(rid,3,"PROJECT_PACKED",measured(archive))
        received=base/"received"
        if not received.exists():receive_project(archive,received)
        _,returned=verify_project(received,check_application=True)
        require(returned["project_identity"]==result["project_identity"],"Independent received edition identity differs")
        self._phase(rid,4,"PROJECT_INDEPENDENTLY_RECEIVED",{"project_identity":result["project_identity"]})
        item={"id":run_id,"created_at":now(),"draft_id":draft["id"],"draft_revision":draft["revision"],
              "capture_id":capture["id"],"original_request_id":rid,
              "project":project.relative_to(self.root).as_posix(),"received":received.relative_to(self.root).as_posix(),
              "project_identity":result["project_identity"],"source_run_identity":result["migration"]["source_run_identity"],
              "archive":{"path":archive.relative_to(self.root).as_posix(),**measured(archive)},
              "data_class":result["data_class"],"edition":result["edition"],"label":result["label"],
              "classes":result["classes"],"assets":result["assets"],"attachments":result["attachments"],"findings":result["findings"],
              "meaning":"Calculated original selected edition and independently received archive; review decisions remain explicit."}
        self.db.execute("INSERT INTO runs VALUES(?,?)",(run_id,json.dumps(item,ensure_ascii=False)))
        return item

    def _validate(self,draft):
        try:
            capture=self._item("captures",draft["capture_id"]);root=self._capture_root(capture)
            plan=parse_json_bytes(draft["raw"].encode("utf-8"))
            require(isinstance(plan,dict),"The complete intake must be a JSON object")
            validate_plan(plan)
            expected=original_assets(root)
            require(plan["assets"]==expected,"Complete intake assets must equal the selected retained capture inventory")
            require(plan["data_class"]==capture["data_class"],"Draft data class differs from the original capture")
            validate_manifest(plan["discovery_manifest"])
            validate_migration(plan["migration_selection"],plan["discovery_manifest"])
            by={a["id"]:dict(a,asset_id=a["id"],retained_path=a.get("path")) for a in expected}
            validate_bindings(plan,by)
            for table in plan["discovery_manifest"]["tables"]:
                asset=by[plan["table_assets"][table["id"]]]
                require(asset["availability"]=="PRESENT" and table["path"]==asset["path"] and table["sha256"]==asset["sha256"],
                        "CSV table paths and hashes must match their complete selected original")
            return {"valid":True,"errors":[],"stage":"STRUCTURE_VALID",
                    "draft_id":draft["id"],"draft_revision":draft["revision"],
                    "intake_sha256":hashlib.sha256(draft["raw"].encode("utf-8")).hexdigest(),
                    "meaning":"Original schema/key/field and asset bindings validate. Full raw source quality, parent links and differences are calculated by Run edition."}
        except (DiscoveryError,KeyError,TypeError,ValueError,AttributeError,IndexError) as exc:
            return {"valid":False,"errors":[str(exc)],"stage":"DRAFT_REQUIRES_EDIT",
                    "draft_id":draft["id"],"draft_revision":draft["revision"]}

    def _list(self,table,params):
        offset,limit=pages(params)
        total=self.db.execute("SELECT count(*) FROM "+table).fetchone()[0]
        rows=[json.loads(r[0]) for r in self.db.execute("SELECT payload FROM "+table+" ORDER BY rowid LIMIT ? OFFSET ?",(limit,offset))]
        if table=="drafts":
            rows=[{k:v for k,v in d.items() if k!="raw"} for d in rows]
        return {"total":total,"offset":offset,"limit":limit,"rows":rows}

    def _read(self,method,params):
        if method=="workspace.describe":
            return dict(self.meta,revision=self._revision(),
                        counts={t:self.db.execute("SELECT count(*) FROM "+t).fetchone()[0] for t in ("captures","drafts","runs","requests")},
                        raw_draft_limit_bytes=RAW_LIMIT,source_read_only=True)
        if method=="capture.list":return self._list("captures",params)
        if method=="draft.list":return self._list("drafts",params)
        if method=="run.list":return self._list("runs",params)
        if method=="draft.show":
            if params.get("revision") is not None:
                rev=number(params["revision"],"historical revision",1)
                row=self.db.execute("SELECT payload FROM draft_history WHERE id=? AND revision=?",(identifier(params.get("draft_id")),rev)).fetchone()
                require(row is not None,"Original historical draft is missing")
                return json.loads(row[0])
            return self._draft(params)
        if method=="draft.history":
            draft=self._draft(params);offset,limit=pages(params)
            rows=[json.loads(r[0]) for r in self.db.execute("SELECT payload FROM draft_history WHERE id=? ORDER BY revision DESC LIMIT ? OFFSET ?",(draft["id"],limit,offset))]
            return {"total":draft["revision"],"offset":offset,"limit":limit,
                    "rows":[{k:v for k,v in d.items() if k!="raw"} for d in rows]}
        if method=="draft.validate":return self._validate(self._draft(params,params.get("expected_revision") is not None))
        if method=="run.show":
            run=self._item("runs",params.get("run_id"))
            _,result=verify_project(self.root/relative(run["project"]),check_application=True)
            require(result["project_identity"]==run["project_identity"],"Original run changed")
            require(measured(self.root/relative(run["archive"]["path"]))=={k:run["archive"][k] for k in ("bytes","sha256")},"Original project archive changed")
            return run
        if method=="request.show":
            row=self.db.execute("SELECT * FROM requests WHERE id=?",(identifier(params.get("request_id")),)).fetchone()
            require(row is not None,"Original request is missing")
            return {k:json.loads(row[k]) if row[k] and k in ("params","input","result","error") else row[k] for k in row.keys()}
        capture=self._item("captures",params.get("capture_id"));root=self._capture_root(capture)
        if method=="capture.show":return capture
        if method=="capture.worksheet":return read_json(root/"mapping-worksheet.json")
        if method=="capture.csv":return self._csv(capture,root,params)
        offset,limit=pages(params);search=params.get("search","")
        require(isinstance(search,str),"Search must be text")
        selected={k:params.get(k) for k in ("asset_class","side","availability") if params.get(k)}
        rows=[];total=0
        for asset in stream_rows(root/"assets.jsonl"):
            if any(asset.get(k)!=v for k,v in selected.items()):continue
            if search.casefold() not in json.dumps(asset,ensure_ascii=False).casefold():continue
            if offset<=total<offset+limit:rows.append(asset)
            total+=1
        return {"total":total,"offset":offset,"limit":limit,"rows":rows}

    def _csv(self,capture,root,params):
        aid=identifier(params.get("asset_id"),"asset ID")
        asset=next((x for x in stream_rows(root/"assets.jsonl") if x["id"]==aid),None)
        require(asset is not None and asset["availability"]=="PRESENT","Select a present original CSV asset")
        encoding=params.get("encoding","utf-8-sig")
        require(encoding in ("utf-8","utf-8-sig"),"Original engine supports UTF-8 or UTF-8 BOM")
        delimiter=params.get("delimiter",",");quotechar=params.get("quotechar",'"')
        require(isinstance(delimiter,str) and len(delimiter)==1 and
                isinstance(quotechar,str) and len(quotechar)==1,
                "Original CSV delimiter and quote character must each be one character")
        source=regular_under(root,asset["path"])
        offset,limit=pages(params)
        cache_key=hashlib.sha256(json_bytes([asset["sha256"],encoding,delimiter,quotechar])).hexdigest()
        cache=self.root/"cache"/(cache_key+".sqlite")
        if not cache.exists():
            stage=cache.with_name("."+cache.name+"-"+uuid.uuid4().hex)
            try:
                with closing(sqlite3.connect(stage)) as db:
                    db.execute("CREATE TABLE records(ordinal INTEGER PRIMARY KEY,payload TEXT NOT NULL)")
                    db.execute("CREATE TABLE info(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
                    csv.field_size_limit(16*1024*1024)
                    with source.open(encoding=encoding,newline="") as stream:
                        reader=csv.reader(stream,delimiter=delimiter,quotechar=quotechar,strict=True)
                        headers=next(reader,None)
                        require(headers is not None,"Original CSV is empty")
                        db.execute("INSERT INTO info VALUES('headers',?)",(json.dumps(headers,ensure_ascii=False),))
                        for ordinal,values in enumerate(reader,1):
                            db.execute("INSERT INTO records VALUES(?,?)",(ordinal,json.dumps(values,ensure_ascii=False)))
                    db.commit()
                os.rename(stage,cache)
            finally:
                if stage.exists():stage.unlink()
        with closing(sqlite3.connect(cache)) as db:
            headers=json.loads(db.execute("SELECT value FROM info WHERE key='headers'").fetchone()[0])
            total=db.execute("SELECT count(*) FROM records").fetchone()[0]
            rows=[{"record":r[0],"values":json.loads(r[1]),"width_valid":len(json.loads(r[1]))==len(headers)}
                  for r in db.execute("SELECT ordinal,payload FROM records ORDER BY ordinal LIMIT ? OFFSET ?",(limit,offset))]
        return {"capture_id":capture["id"],"asset_id":aid,"source":asset,"encoding":encoding,
                "headers":headers,"header_unique":len(set(headers))==len(headers),"delimiter":delimiter,"quotechar":quotechar,"total":total,
                "offset":offset,"limit":limit,"rows":rows,"meaning":"Raw CSV data ordinals after the original header; no inferred type, key, split or fill-down."}

    def stage_capture_archive(self,source):
        """Retain an explicitly selected whole local archive under its byte identity."""
        with self.mutex:
            source=Path(source)
            require(source.is_file() and not source.is_symlink(),"Select an existing ordinary complete capture ZIP")
            expected=measured(source)
            name="capture-"+expected["sha256"]+".zip"
            target=self.root/"incoming"/name
            if target.exists():
                require(measured(target)==expected,"Original incoming archive identity differs")
                return {"archive_name":name,**expected}
            with tempfile.TemporaryDirectory(prefix=".forms-capture-input-",dir=self.root.parent) as temporary:
                pending=Path(temporary)/name
                digest=hashlib.sha256();count=0
                with source.open("rb") as inp,pending.open("xb") as out:
                    os.chmod(pending,0o600)
                    for block in iter(lambda:inp.read(1024*1024),b""):
                        count+=len(block);require(count<=expected["bytes"],"Selected input changed during whole capture")
                        digest.update(block);out.write(block)
                    out.flush();os.fsync(out.fileno())
                require(count==expected["bytes"] and digest.hexdigest()==expected["sha256"],
                        "Selected complete capture bytes changed")
                os.link(pending,target)
            return {"archive_name":name,**expected}

    def export(self,destination):
        with self.mutex:
            destination=Path(destination).resolve()
            require(not destination.exists() and not destination.is_relative_to(self.root),
                    "Choose a new archive outside the original workspace")
            require(self.db.execute("SELECT count(*) FROM requests WHERE status='RUNNING'").fetchone()[0]==0,
                    "Recover the original pending request before full workspace handover")
            verify_contents(self.root,self.db,self.meta)
            with tempfile.TemporaryDirectory(prefix="forms-workspace-export-") as temp:
                stage=Path(temp);backup=stage/"workspace.sqlite"
                with closing(sqlite3.connect(backup)) as other:self.db.backup(other)
                entries={"workspace.sqlite":backup,"workspace.json":self.root/"workspace.json"}
                for folder in ("captures","runs","operations","incoming"):
                    for row in inventory_files(self.root/folder):
                        name=folder+"/"+row["path"];entries[name]=regular_under(self.root,name)
                for row in self.meta["source_files"]:entries["software/"+row["path"]]=regular_under(HERE,row["path"])
                manifest={"schema":ARCHIVE,"workspace_id":self.meta["workspace_id"],
                          "workspace_revision":self._revision(),"source_files":self.meta["source_files"],
                          "files":[{"path":name,**measured(path)} for name,path in sorted(entries.items())]}
                destination.parent.mkdir(parents=True,exist_ok=True)
                pending=destination.with_name("."+destination.name+"-"+uuid.uuid4().hex)
                try:
                    with zipfile.ZipFile(pending,"x",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
                        os.chmod(pending,0o600)
                        for name,path in sorted(entries.items()):
                            info=zipfile.ZipInfo(name);info.external_attr=(stat.S_IFREG|0o600)<<16
                            info.compress_type=zipfile.ZIP_DEFLATED
                            expected=next(x for x in manifest["files"] if x["path"]==name)
                            digest=hashlib.sha256();count=0
                            with path.open("rb") as inp,z.open(info,"w",force_zip64=True) as out:
                                for block in iter(lambda:inp.read(1024*1024),b""):
                                    out.write(block);digest.update(block);count+=len(block)
                            require(count==expected["bytes"] and digest.hexdigest()==expected["sha256"],
                                    "Original member changed during complete workspace handover")
                        z.writestr("archive-manifest.json",json_bytes(manifest))
                    with pending.open("rb") as inp:os.fsync(inp.fileno())
                    os.link(pending,destination)
                finally:
                    if pending.exists():pending.unlink()
            return {"schema":"tjlabs.forms-workspace.export.v1","workspace_id":self.meta["workspace_id"],
                    "workspace_revision":self._revision(),"archive":{"path":str(destination),**measured(destination)},
                    "members":len(manifest["files"])+1,"source_files":self.meta["source_files"]}

def verify_contents(root,db,meta):
    root=Path(root)
    require(read_json(root/"workspace.json")==meta,"Original workspace metadata changed")
    require(db.execute("PRAGMA integrity_check").fetchone()[0]=="ok","Original workspace database integrity differs")
    for row in db.execute("SELECT payload FROM captures"):
        capture=json.loads(row[0]);result=capture_engine.verify(root/relative(capture["directory"])/"capture")
        require(result["selection_sha256"]==capture["selection_sha256"],"Original captured source differs")
        require(measured(regular_under(root,capture["archive"]["path"]))=={k:capture["archive"][k] for k in ("bytes","sha256")},
                "Original capture archive differs")
    for row in db.execute("SELECT payload FROM runs"):
        run=json.loads(row[0]);project=root/relative(run["project"])
        _,result=verify_project(project,check_application=True)
        require(result["project_identity"]==run["project_identity"],"Original computed project differs")
        archive=regular_under(root,run["archive"]["path"])
        require(measured(archive)=={k:run["archive"][k] for k in ("bytes","sha256")},"Original selected project archive differs")
        complete_archive(archive,project,result)
        _,received=verify_project(root/relative(run["received"]),check_application=True)
        require(received["project_identity"]==run["project_identity"],"Original independently received project differs")
    return True

def receive_workspace(archive,destination,max_bytes=20*1024**3):
    archive=Path(archive).resolve();destination=Path(destination).resolve()
    require(not destination.exists(),"Choose a new complete receiving workspace")
    number(max_bytes,"expanded byte limit",1)
    destination.parent.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix="."+destination.name+"-",dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as z:
            members=z.infolist();names=[x.filename for x in members]
            require(len(names)==len(set(names)) and "archive-manifest.json" in names,"Complete unique archive members required")
            require(sum(x.file_size for x in members)<=max_bytes,"Expanded whole workspace exceeds explicit limit")
            manifest=parse_json_bytes(z.read("archive-manifest.json"))
            require(manifest.get("schema")==ARCHIVE,"Complete original workspace archive required")
            expected={r["path"]:r for r in manifest["files"]}
            require(len(expected)==len(manifest["files"]) and set(names)==set(expected)|{"archive-manifest.json"},
                    "Original complete workspace member set differs")
            selected={r["path"]:r for r in manifest["source_files"]}
            require(len(selected)==len(manifest["source_files"]) and set(selected)==set(SOFTWARE),
                    "Whole selected workspace program required")
            for info in members:
                name=info.filename
                rel=relative(name)
                if name=="archive-manifest.json":continue
                require(not info.is_dir() and stat.S_ISREG(info.external_attr>>16),"Only regular original files are receivable")
                row=expected[name]
                require(info.file_size==row["bytes"],"Original archive size differs")
                target=stage/rel;target.parent.mkdir(parents=True,exist_ok=True)
                digest=hashlib.sha256();count=0
                with z.open(info) as inp,target.open("xb") as out:
                    for block in iter(lambda:inp.read(1024*1024),b""):
                        count+=len(block);require(count<=row["bytes"],"Original member expands beyond declared bytes")
                        digest.update(block);out.write(block)
                    out.flush();os.fsync(out.fileno())
                require(count==row["bytes"] and digest.hexdigest()==row["sha256"],"Original member bytes differ")
            meta=read_json(stage/"workspace.json")
            require(meta["workspace_id"]==manifest["workspace_id"] and meta["source_files"]==manifest["source_files"],
                    "Selected workspace/source binding differs")
            for name,row in selected.items():
                require(measured(regular_under(stage/"software",name))=={"bytes":row["bytes"],"sha256":row["sha256"]},
                        "Complete received software changed")
            with closing(sqlite3.connect(stage/"workspace.sqlite")) as db:
                require(db.execute("SELECT value FROM state WHERE key='workspace_id'").fetchone()[0]==meta["workspace_id"],
                        "Received workspace database identity differs")
                require(int(db.execute("SELECT value FROM state WHERE key='revision'").fetchone()[0])==manifest["workspace_revision"],
                        "Received workspace revision differs")
                verify_contents(stage,db,meta)
            os.rename(stage,destination)
        return {"schema":"tjlabs.forms-workspace.receiving.v1","workspace_id":manifest["workspace_id"],
                "workspace_revision":manifest["workspace_revision"],"directory":str(destination),
                "archive":{"path":str(archive),**measured(archive)},"source_files":manifest["source_files"]}
    finally:
        shutil.rmtree(stage,ignore_errors=True)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="command",required=True)
    p=sub.add_parser("init");p.add_argument("--workspace",required=True);p.add_argument("--label",required=True)
    p=sub.add_parser("call");p.add_argument("--workspace",required=True);p.add_argument("--method",required=True)
    p.add_argument("--params",required=True);p.add_argument("--request-id")
    p=sub.add_parser("import-capture");p.add_argument("--workspace",required=True);p.add_argument("--archive",required=True);p.add_argument("--request-id",required=True)
    p=sub.add_parser("export");p.add_argument("--workspace",required=True);p.add_argument("--output",required=True)
    p=sub.add_parser("receive");p.add_argument("--archive",required=True);p.add_argument("--output",required=True)
    p.add_argument("--max-bytes",type=int,default=20*1024**3)
    args=parser.parse_args(argv)
    if args.command=="receive":result=receive_workspace(args.archive,args.output,args.max_bytes)
    else:
        with Workspace(args.workspace,create=args.command=="init",label=getattr(args,"label",None)) as workspace:
            if args.command=="init":result=workspace.dispatch("workspace.describe")
            elif args.command=="export":result=workspace.export(args.output)
            elif args.command=="import-capture":
                staged=workspace.stage_capture_archive(args.archive)
                result=workspace.dispatch("capture.import",{"archive_name":staged["archive_name"]},args.request_id)
            else:result=workspace.dispatch(args.method,read_json(args.params),args.request_id)
    print(json.dumps(result,ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
