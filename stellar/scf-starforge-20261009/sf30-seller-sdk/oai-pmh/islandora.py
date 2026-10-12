"""MIT. Islandora commissioning in the original retained OAI workspace."""
from __future__ import annotations
import base64
import csv
import hashlib
from functools import wraps
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
from urllib.parse import urlsplit, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
import uuid
import zipfile
from bridge import storage
from harvest import InputError, decode, jbytes, sha, stamp, plain, page_values

FIELD = re.compile(r"[a-z][a-z0-9_]{0,127}\Z")
SCHEMA = "stellar-forge.oai-islandora-job.v1"
TABLE = "oai_islandora_jobs"
SECRET_KEYS = {"password", "authorization", "cookie", "credentials_file_path",
               "credentials_key_file_path"}
CONFIG_KEYS = {"content_type", "username", "subdelimiter", "allow_adding_terms",
    "protected_vocabularies", "text_format_id", "field_text_format_ids",
    "standalone_media_url", "media_types_override", "media_type_file_fields",
    "node_exists_verification_view_endpoint", "max_node_title_length",
    "require_entity_reference_views", "entity_reference_view_endpoints",
    "log_file_path", "allow_missing_files"}

def host_url(value):
    value=plain(value,"the target Islandora URL").rstrip("/")
    u=urlsplit(value)
    if u.scheme not in {"https","http"} or not u.netloc or u.username or u.password or u.query or u.fragment:
        raise InputError("Use the target base URL, without credentials, query or fragment")
    return value

def path_under(root,value):
    p=Path(value)
    if p.is_absolute() or ".." in p.parts or "\\" in value:
        raise InputError("Use a relative package member")
    candidate=root/p
    if candidate.is_symlink() or root.resolve() not in candidate.resolve().parents:
        raise InputError("The file must belong to this saved job")
    return candidate

def values(value):
    if value is None or value=="": return []
    if isinstance(value,list): result=value
    elif isinstance(value,str) and value.startswith("["):
        try: result=json.loads(value)
        except ValueError: result=[value]
        if not isinstance(result,list):result=[value]
    else: result=[value]
    if any(not isinstance(x,(str,int,float)) or isinstance(x,bool) for x in result):
        raise InputError("Map scalar or repeated scalar metadata values")
    return [str(x) for x in result]

def csv_bytes(headers,rows):
    out=io.StringIO(newline="")
    writer=csv.DictWriter(out,fieldnames=headers,extrasaction="raise",lineterminator="\n")
    writer.writeheader()
    for row in rows:writer.writerow(row)
    return out.getvalue().encode("utf-8")

def file_sha(path,limit=1024**4):
    path=Path(path)
    if not path.is_file():raise InputError("The selected file is not a regular file")
    h=hashlib.sha256();size=0
    with path.open("rb") as source:
        while chunk:=source.read(1024*1024):
            size+=len(chunk)
            if size>limit:raise InputError("The file exceeds the declared size limit")
            h.update(chunk)
    return h.hexdigest()

def put_file(path,body):
    path=Path(path)
    if path.is_symlink():raise InputError("Saved migration files must be real files")
    tmp=path.with_name("."+path.name+"."+uuid.uuid4().hex+".tmp")
    try:
        storage.private_write(tmp,body)
        os.replace(tmp,path)
        storage.sync_dir(path.parent)
    finally:
        if tmp.exists():tmp.unlink()

def csv_records(body):
    text=body.decode("utf-8-sig") if isinstance(body,bytes) else body
    reader=csv.DictReader(io.StringIO(text,newline=""))
    if not reader.fieldnames or len(reader.fieldnames)!=len(set(reader.fieldnames)):
        raise InputError("CSV needs unique column names")
    for row in reader:
        if None in row:raise InputError("CSV row contains more cells than its header")
        # Workbench export includes two instructional rows before actual nodes.
        if row.get("REMOVE THIS COLUMN (KEEP THIS ROW)"):
            continue
        yield row

def exclusive(method):
    @wraps(method)
    def call(self,*args,**kwargs):
        if not self.operation_lock.acquire(blocking=False):
            raise InputError("The current operation is still using this migration workspace")
        try:return method(self,*args,**kwargs)
        finally:self.operation_lock.release()
    return call

class IslandoraDesk:
    def __init__(self,workspace):
        self.ws=workspace
        self.root=workspace.area/"islandora"
        self.root.mkdir(mode=0o700,exist_ok=True)
        if self.root.is_symlink():raise InputError("Islandora workspace must be a real directory")
        with self.ws.mutex,self.ws.db:
            self.ws.db.executescript("""
                CREATE TABLE IF NOT EXISTS oai_islandora_jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS oai_islandora_records(
                    job_id TEXT NOT NULL,identifier TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,
                    PRIMARY KEY(job_id,identifier));
                CREATE INDEX IF NOT EXISTS oai_islandora_record_status
                    ON oai_islandora_records(job_id,state,identifier);
            """)
        self.worker=None
        self.process=None
        self.stop_event=threading.Event()
        self.worker_lock=threading.Lock()
        self.operation_lock=threading.RLock()
        with self.ws.mutex,self.ws.db:
            for item in self.ws.db.execute("SELECT body FROM oai_islandora_jobs").fetchall():
                job=decode(item[0])
                if job.get("status")=="RUNNING":
                    job["status"]="CONTINUE"
                    for run in job.get("runs",[]):
                        if run.get("status")=="RUNNING":
                            run.update(status="CONTINUE",reopenedAt=stamp(),
                                error="Previous console ended before saving this native result")
                    self._save(job)

    def job(self,identity):
        with self.ws.mutex:return self.ws._get(TABLE,identity)

    def _save(self,job):
        job["updatedAt"]=stamp()
        return self.ws._put(TABLE,job)

    def directory(self,identity):
        if not re.fullmatch(r"[0-9a-f]{32}",identity):raise InputError("Unknown migration job")
        p=self.root/identity
        if p.is_symlink():raise InputError("Migration directory must be a real directory")
        return p

    def state(self):
        with self.ws.mutex:
            items=[decode(r[0]) for r in self.ws.db.execute(
                "SELECT body FROM oai_islandora_jobs ORDER BY rowid DESC")]
        return {"items":items,"running":bool(self.worker and self.worker.is_alive()),
                "error":getattr(self,"last_error",None)}

    def record(self,job_id,identifier):
        with self.ws.mutex:
            row=self.ws.db.execute("SELECT body FROM oai_islandora_records WHERE job_id=? AND identifier=?",
                                  (job_id,identifier)).fetchone()
            if row is None:raise InputError("This identifier is not in the migration")
            return decode(row[0])

    def records(self,job_id,offset=0,limit=100,kind="",query=""):
        page_values(offset,limit);self.job(job_id)
        clause="job_id=?";args=[job_id]
        if kind:clause+=" AND state=?";args.append(kind)
        if query:clause+=" AND instr(identifier,?)>0";args.append(query)
        with self.ws.mutex:
            total=self.ws.db.execute("SELECT COUNT(*) FROM oai_islandora_records WHERE "+clause,args).fetchone()[0]
            rows=self.ws.db.execute("SELECT body FROM oai_islandora_records WHERE "+clause+
                " ORDER BY identifier LIMIT ? OFFSET ?",args+[limit,offset]).fetchall()
        return {"total":total,"offset":offset,"next":offset+len(rows) if offset+len(rows)<total else None,
                "items":[decode(r[0]) for r in rows]}

    def _rows(self,identity):
        for row in self.ws.db.execute("SELECT body FROM oai_islandora_records WHERE job_id=? ORDER BY identifier",(identity,)):
            yield decode(row[0])

    def _put_record(self,job_id,row):
        self.ws.db.execute("INSERT INTO oai_islandora_records VALUES(?,?,?,?) "+
            "ON CONFLICT(job_id,identifier) DO UPDATE SET state=excluded.state,body=excluded.body",
            (job_id,row["identifier"],row["state"],jbytes(row).decode()))

    def inventory(self,build_id):
        with self.ws.mutex:
            build=self.ws._get("oai_builds",build_id)
            p=self.ws._build_file(build,"data.csv")
            with p.open(encoding="utf-8-sig",newline="") as source:
                reader=csv.DictReader(source);headers=reader.fieldnames
                samples=[]
                for _,row in zip(range(3),reader):samples.append(row)
            return {"build":build,"columns":headers,"examples":samples}

    def default_plan(self,build_id):
        inv=self.inventory(build_id);columns=inv["columns"]
        fields=[]
        for source,target,mode in (
            ("dc_title","title","single"),("dc_description","field_description","join"),
            ("dc_identifier","field_identifier","repeat"),("dc_rights","field_rights","join")):
            if source in columns:fields.append({"source":source,"target":target,"mode":mode,
                "separator":"\n\n" if mode=="join" else "|","required":target=="title"})
        return {"schema":"stellar-forge.islandora-crosswalk.v1","fields":fields,
                "constants":{},"identifierField":"","titleLimit":255}

    @exclusive
    def create(self,build_id,label,host,config=None,plan=None,baseline=None):
        host=host_url(host);config=dict(config or {})
        if set(config)-CONFIG_KEYS:raise InputError("Unsupported or credential-bearing Workbench setting")
        config.setdefault("content_type","islandora_object");config.setdefault("subdelimiter","|")
        if not FIELD.fullmatch(config["content_type"]):raise InputError("Use the actual Drupal content type machine name")
        if not isinstance(config["subdelimiter"],str) or not config["subdelimiter"]:
            raise InputError("Supply Workbench's repeat delimiter")
        prior=self.job(baseline) if baseline else None
        if prior and prior["target"]["host"]!=host:raise InputError("A baseline belongs to the same target host")
        if prior and prior["status"]!="COMPLETE":raise InputError("Finish receiving the selected migration before using it as the baseline")
        identity=uuid.uuid4().hex;root=self.directory(identity);root.mkdir(mode=0o700)
        try:
            exported=self.ws.export_source(build_id,root/"source")
            with self.ws.mutex,self.ws.db:
                build=self.ws._get("oai_builds",build_id);edition=self.ws.edition(build["editionId"])
                if prior and prior["repositoryId"]!=edition["repository"]["id"]:
                    raise InputError("A migration baseline belongs to this exact source repository")
                job={"schema":SCHEMA,"id":identity,"label":plain(label,"a migration name",256),
                    "buildId":build_id,"editionId":build["editionId"],"repositoryId":edition["repository"]["id"],
                    "source":exported,"target":{"host":host,**config},"crosswalk":plan or self.default_plan(build_id),
                    "baseline":baseline,"status":"DRAFT","createdAt":stamp(),"counts":{},"runs":[],
                    "assetCount":0,"relationshipCount":0,"review":None}
                self._save(job)
            return self.rebuild(identity,job["crosswalk"])
        except Exception:
            # Retain the complete source on a failed preparation for local recovery.
            raise

    @exclusive
    def configure(self,identity,host=None,config=None):
        job=self.job(identity);old=dict(job["target"])
        settings={k:v for k,v in old.items() if k!="host"}
        if config is not None:
            if not isinstance(config,dict) or set(config)-CONFIG_KEYS:
                raise InputError("Use supported Workbench settings; the password belongs in the process environment")
            settings.update(config)
        target={"host":host_url(host or old["host"]),**settings}
        if not FIELD.fullmatch(target["content_type"]):raise InputError("Use the target content type machine name")
        if not isinstance(target["subdelimiter"],str) or not target["subdelimiter"]:
            raise InputError("Supply the target repeat delimiter")
        written=any(not run["check"] and run["task"]!="export_csv" for run in job.get("runs",[]))
        if written and any(target[key]!=old[key] for key in ("host","content_type","subdelimiter")):
            raise InputError("A native migration keeps its target host, content type and repeat delimiter")
        if job.get("baseline") and target["host"]!=old["host"]:
            raise InputError("A source refresh uses the original baseline target")
        with self.ws.mutex,self.ws.db:
            if target["host"]!=old["host"]:
                for row in list(self._rows(identity)):
                    row.update(nodeId=None,nodeUUID=None,target=None,before=None,managedParentIds=[])
                    for key in ("nativeInspectedAt","parentsVerifiedAt"):row.pop(key,None)
                    for asset in row["assets"]:
                        for key in ("verifiedAt","targetMediaId","targetURL","verification"):asset.pop(key,None)
                    self._put_record(identity,self._classify(row))
                mapping=self.directory(identity)/"batches"/"native-node-map.sqlite"
                if mapping.exists():
                    old_maps=self.directory(identity)/"receiving"
                    old_maps.mkdir(mode=0o700,exist_ok=True)
                    os.replace(mapping,old_maps/(uuid.uuid4().hex+"-previous-host-map.sqlite"))
            job.setdefault("targetHistory",[]).append({"target":old,"changedAt":stamp()})
            job["target"]=target;job["review"]=None;job["batches"]=[]
            self._save(job)
        if written:
            with self.ws.mutex,self.ws.db:return self._summary(job)
        return self.rebuild(identity,job["crosswalk"])

    def _map(self,job,source):
        fields={};errors=[];delimiter=job["target"]["subdelimiter"]
        seen=set()
        for rule in job["crosswalk"]["fields"]:
            target=rule.get("target","")
            if not FIELD.fullmatch(target) or target in seen or target in {"id","node_id","file"}:
                raise InputError("Use distinct target field machine names; node/file columns are generated")
            seen.add(target)
            source_name=rule.get("source")
            if source_name not in source:raise InputError("Source column not found: "+str(source_name))
            vals=values(source[source_name]);mode=rule.get("mode","single")
            if mode=="lookup":
                table=rule.get("lookup",{});missing=[x for x in vals if x not in table]
                if missing:errors.append({"field":target,"issue":"Unmapped controlled values","values":missing})
                vals=[str(table[x]) for x in vals if x in table]
                mode="repeat"
            if mode=="single":
                if len(vals)>1:errors.append({"field":target,"issue":"Select a repeat or join rule for multiple values","values":vals})
                rendered=vals[0] if vals else ""
            elif mode=="first":rendered=vals[0] if vals else ""
            elif mode=="join":rendered=rule.get("separator","\n\n").join(vals)
            elif mode=="repeat":
                if any(delimiter in x for x in vals):
                    errors.append({"field":target,"issue":"A source value contains the target repeat delimiter","values":vals})
                rendered=delimiter.join(vals)
            else:raise InputError("Choose single, first, join, repeat or lookup mapping")
            if rule.get("required") and not rendered:
                errors.append({"field":target,"issue":"Required target value is empty"})
            fields[target]=rendered
        for target,value in job["crosswalk"].get("constants",{}).items():
            if not FIELD.fullmatch(target) or target in {"id","node_id","file"}:
                raise InputError("Use a target field machine name for each constant")
            fields[target]=str(value)
        identifier_field=job["crosswalk"].get("identifierField","")
        if identifier_field:
            if not FIELD.fullmatch(identifier_field):raise InputError("Use the source identifier target field machine name")
            fields[identifier_field]=source["identifier"]
        if "published" in fields:
            published=fields["published"].strip().lower()
            if published in {"1","true"}:fields["published"]="1"
            elif published in {"0","false"}:fields["published"]="0"
            elif published:errors.append({"field":"published","issue":"Publication state must be 1 or 0"})
        if not fields.get("title"):errors.append({"field":"title","issue":"A node needs its title"})
        if len(fields.get("title",""))>int(job["crosswalk"].get("titleLimit",255)):
            errors.append({"field":"title","issue":"Title exceeds the selected target field length"})
        return fields,errors

    def _classify(self,row):
        errors=list(row.get("mappingErrors",[]));conflicts=[];updates={};deletes=[]
        desired={**row["desired"],**row.get("overrides",{})}
        before=row.get("before");target=row.get("target");choices=row.get("choices",{})
        if not row.get("nodeId"):
            row.update(state="REVIEW" if errors else "CREATE",updates=desired,deletes=[],conflicts=[])
            return row
        if target is None:
            row.update(state="READ_TARGET",updates={},deletes=[],conflicts=[])
            return row
        for field,new in desired.items():
            old=(before or {}).get(field,"");live=target.get(field,"")
            if new==old or live==new:continue
            decision=choices.get(field)
            if decision=="target":continue
            if live==old or decision=="source":
                if new=="":deletes.append(field)
                else:updates[field]=new
            else:conflicts.append({"field":field,"previousSource":old,"newSource":new,"currentTarget":live})
        if row.get("sourceStatus")=="deleted":
            decision=choices.get("$withdrawal")
            if decision=="unpublish":
                if str(target.get("published","")).lower() not in {"0","false"}:updates["published"]="0"
            elif decision!="keep":
                conflicts.append({"field":"$withdrawal","issue":"Original source explicitly withdrew this record"})
        row.update(updates=updates,deletes=deletes,conflicts=conflicts,
                   state="REVIEW" if errors or conflicts else "UPDATE" if updates or deletes else "UNCHANGED")
        return row

    @exclusive
    def rebuild(self,identity,plan):
        job=self.job(identity)
        if any(not r["check"] and r["task"]!="export_csv" for r in job.get("runs",[])):
            raise InputError("Create a new edition from this migration to change its crosswalk after target changes")
        if not isinstance(plan,dict) or not isinstance(plan.get("fields"),list):raise InputError("Supply a field crosswalk")
        job["crosswalk"]=plan
        source=self.directory(identity)/"source"/"capture"/"data.csv"
        with self.ws.mutex,self.ws.db:
            existing={r["identifier"]:r for r in self._rows(identity)}
            self.ws.db.execute("DELETE FROM oai_islandora_records WHERE job_id=?",(identity,))
            with source.open(encoding="utf-8-sig",newline="") as f:
                for item in csv.DictReader(f):
                    if not item.get("identifier"):raise InputError("Project the exact OAI identifier into the source dataset")
                    desired,errors=self._map(job,item);prior=None
                    if job["baseline"]:
                        p=self.ws.db.execute("SELECT body FROM oai_islandora_records WHERE job_id=? AND identifier=?",
                            (job["baseline"],item["identifier"])).fetchone()
                        prior=decode(p[0]) if p else None
                    row={"identifier":item["identifier"],"source":item,"sourceStatus":"active",
                        "desired":desired,"mappingErrors":errors,"overrides":{},"choices":{},
                        "nodeId":prior.get("nodeId") if prior else None,
                        "nodeUUID":prior.get("nodeUUID") if prior else None,
                        "before":{**prior["desired"],**prior.get("overrides",{})} if prior else None,
                        "target":None,"assets":[{**{k:v for k,v in a.items() if k not in
                            {"verifiedAt","targetMediaId","targetURL","verification"}},
                            "originJob":a.get("originJob",job["baseline"])}
                            for a in prior.get("assets",[])] if prior else [],
                        "parents":list(prior.get("parents",[])) if prior else [],
                        "managedParentIds":list(prior.get("managedParentIds",[])) if prior else []}
                    saved=existing.get(item["identifier"])
                    if saved:
                        row["assets"]=saved.get("assets",[]);row["parents"]=saved.get("parents",[])
                        for key in ("nodeId","nodeUUID","before","managedParentIds"):
                            if key in saved:row[key]=saved[key]
                        row["overrides"]={k:v for k,v in saved.get("overrides",{}).items() if k in desired}
                    self._override_errors(job,row)
                    self._put_record(identity,self._classify(row))
            # Only retained explicit deletion headers create withdrawal decisions.
            edition_records=self.ws.db.execute("""SELECT e.identifier,o.status FROM oai_edition_records e
                JOIN oai_observations o ON o.id=e.observation_id WHERE e.edition_id=? AND o.status='deleted'""",
                (job["editionId"],)).fetchall()
            for item in edition_records:
                if not job["baseline"]:continue
                p=self.ws.db.execute("SELECT body FROM oai_islandora_records WHERE job_id=? AND identifier=?",
                    (job["baseline"],item["identifier"])).fetchone()
                if p:
                    prior=decode(p[0]);row={**prior,"sourceStatus":"deleted","target":None,"choices":{},
                        "assets":[{**a,"originJob":a.get("originJob",job["baseline"])} for a in prior.get("assets",[])],
                        "before":{**prior["desired"],**prior.get("overrides",{})}}
                    self._put_record(identity,self._classify(row))
            return self._summary(job)

    def _review_digest(self,job):
        h=hashlib.sha256()
        h.update(jbytes({k:job.get(k) for k in ("buildId","baseline","target","crosswalk")}))
        for row in self._rows(job["id"]):
            intent={k:row.get(k) for k in ("identifier","sourceStatus","desired","overrides","choices","parents")}
            intent["assets"]=[{k:asset.get(k) for k in
                ("path","sha256","mediaType","mediaUse","role")} for asset in row["assets"]]
            h.update(jbytes(intent))
        return h.hexdigest()

    def _override_errors(self,job,row):
        _,errors=self._map(job,row["source"])
        row["mappingErrors"]=[e for e in errors if e["field"] not in row.get("overrides",{})]
        fields={**row["desired"],**row.get("overrides",{})}
        required={r["target"] for r in job["crosswalk"]["fields"] if r.get("required")}|{"title"}
        for field in required:
            if not fields.get(field):
                row["mappingErrors"].append({"field":field,"issue":"Required target value is empty"})
        if len(fields.get("title",""))>int(job["crosswalk"].get("titleLimit",255)):
            row["mappingErrors"].append({"field":"title","issue":"Title exceeds the selected target field length"})

    def _summary(self,job):
        counts={r[0]:r[1] for r in self.ws.db.execute(
            "SELECT state,COUNT(*) FROM oai_islandora_records WHERE job_id=? GROUP BY state",(job["id"],))}
        job["counts"]=counts
        job["assetCount"]=sum(len(r.get("assets",[])) for r in self._rows(job["id"]))
        job["relationshipCount"]=sum(len(r.get("parents",[])) for r in self._rows(job["id"]))
        if job["status"]!="RUNNING":job["status"]="REVIEW" if counts.get("REVIEW") else "READ_TARGET" if counts.get("READ_TARGET") else "PREPARED"
        review=job.get("review")
        if review and (counts.get("REVIEW") or review["sha256"]!=self._review_digest(job)):
            job["review"]=None
        return self._save(job)

    @exclusive
    def edit(self,identity,identifier,overrides=None,choices=None):
        with self.ws.mutex,self.ws.db:
            job=self.job(identity)
            if job["status"]=="RUNNING":raise InputError("Wait for this native operation to finish before editing")
            row=self.record(identity,identifier)
            if overrides is not None:
                if any(k not in row["desired"] or not isinstance(v,str) for k,v in overrides.items()):
                    raise InputError("Overrides apply to mapped target fields and use text values")
                row["overrides"]=dict(overrides)
                if "published" in row["overrides"]:
                    value=row["overrides"]["published"].strip().lower()
                    if value not in {"","0","1","true","false"}:raise InputError("Publication state must be 1 or 0")
                    row["overrides"]["published"]={"true":"1","false":"0"}.get(value,value)
                self._override_errors(job,row)
            if choices is not None:
                if any(v not in {"source","target","unpublish","keep"} for v in choices.values()):
                    raise InputError("Choose source, target, unpublish or keep")
                row["choices"]=choices
            self._put_record(identity,self._classify(row));self._summary(job)
            return row

    @exclusive
    def attach(self,identity,entries,asset_root):
        job=self.job(identity)
        if job["status"]=="RUNNING":raise InputError("Finish native execution before changing the file selection")
        asset_root=Path(asset_root).resolve()
        with self.ws.mutex,self.ws.db:
            for entry in entries:
                row=self.record(identity,entry["identifier"])
                source=(asset_root/entry["path"]).resolve()
                if not source.is_file() or asset_root not in source.parents:
                    raise InputError("Each original file must be inside the selected asset directory")
                digest=file_sha(source,1024**4)
                if entry.get("sha256") and entry["sha256"]!=digest:raise InputError("Original file differs from its manifest")
                name=Path(entry["path"]).name
                dest=self.directory(identity)/"assets"/digest/name
                dest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                if not dest.exists():
                    shutil.copyfile(source,dest);os.chmod(dest,0o600)
                asset={"path":dest.relative_to(self.directory(identity)).as_posix(),"sha256":digest,
                    "bytes":source.stat().st_size,"name":name,"mediaType":entry.get("mediaType","file"),
                    "mediaUse":str(entry.get("mediaUse","http://pcdm.org/use#OriginalFile")),
                    "role":entry.get("role","primary"),"sourceURL":entry.get("sourceURL","")}
                if not FIELD.fullmatch(asset["mediaType"]):raise InputError("Use an actual target media type machine name")
                row["assets"]=[a for a in row["assets"] if a["path"]!=asset["path"]]+[asset]
                self._put_record(identity,row)
            job["assetCount"]=sum(len(x["assets"]) for x in self._rows(identity))
            return self._summary(job)

    @exclusive
    def relationships(self,identity,relations):
        job=self.job(identity)
        with self.ws.mutex,self.ws.db:
            if job["status"]=="RUNNING":raise InputError("Wait for native execution before changing relationships")
            for item in relations:
                child=self.record(identity,item["child"]);self.record(identity,item["parent"])
                if item["child"]==item["parent"]:raise InputError("An object cannot be its own parent")
                child["parents"]=list(dict.fromkeys([*child["parents"],item["parent"]]))
                child.pop("parentsVerifiedAt",None)
                self._put_record(identity,child)
            # Validate the complete parent graph before generating any target changes.
            graph={r["identifier"]:r["parents"] for r in self._rows(identity)}
            done=set();active=set()
            def visit(node):
                if node in active:raise InputError("Collection relationships contain a cycle")
                if node in done:return
                active.add(node)
                for parent in graph.get(node,[]):visit(parent)
                active.remove(node);done.add(node)
            for node in graph:visit(node)
            job["relationshipCount"]=sum(len(x) for x in graph.values())
            return self._summary(job)

    @exclusive
    def receive(self,identity,body,kind="target",host=None):
        job=self.job(identity)
        if host_url(host or job["target"]["host"])!=job["target"]["host"]:
            raise InputError("Returned target records belong to the selected host")
        rows=list(csv_records(body));by_node={};by_id={}
        for item in rows:
            node=str(item.get("node_id",""))
            if not node.isdigit() or int(node)<1:raise InputError("Native target CSV needs positive node_id values")
            if node in by_node:raise InputError("Native target CSV contains duplicate node IDs")
            by_node[node]=item
            ident=item.get("id",item.get("identifier",""))
            if ident:
                if ident in by_id:raise InputError("Native result contains duplicate source identifiers")
                by_id[ident]=item
        receipt_id=uuid.uuid4().hex
        output=self.directory(identity)/"receiving";output.mkdir(mode=0o700,exist_ok=True)
        put_file(output/(receipt_id+".csv"),body.encode() if isinstance(body,str) else body)
        matched=0
        with self.ws.mutex,self.ws.db:
            for row in list(self._rows(identity)):
                item=by_id.get(row["identifier"]) or by_node.get(str(row.get("nodeId") or ""))
                if item is None:continue
                if row.get("nodeId") and str(row["nodeId"])!=str(item["node_id"]):
                    raise InputError("Native returned node differs from the saved source-to-target map")
                row["nodeId"]=str(item["node_id"])
                if kind=="target":row["target"]={k:item.get(k,"") for k in [*row["desired"],"published","field_member_of"]}
                self._put_record(identity,self._classify(row));matched+=1
            job["receiving"]={"id":receipt_id,"kind":kind,"rows":len(rows),"matched":matched,
                               "sha256":sha(body.encode() if isinstance(body,str) else body),"at":stamp()}
            self._summary(job)
        return {"job":job,"matched":matched,"received":len(rows)}

    @exclusive
    def review(self,identity,reviewer,note):
        with self.ws.mutex,self.ws.db:
            job=self.job(identity)
            if job["status"]=="RUNNING":raise InputError("Native execution is still running")
            unresolved=job["counts"].get("REVIEW",0)+job["counts"].get("READ_TARGET",0)
            if unresolved:raise InputError("Finish the "+str(unresolved)+" source/target decisions in Records")
            job["review"]={"reviewer":plain(reviewer,"the operator name",256),
                "note":plain(note,"the commissioning note",4096),"at":stamp(),"sha256":self._review_digest(job)}
            job["status"]="READY";return self._save(job)

    def _config(self,job,root,task,csv_path,**extra):
        target=dict(job["target"]);host=target.pop("host")
        target.pop("log_file_path",None)
        return {**target,"host":host,"task":task,"input_dir":str(root),"input_csv":str(csv_path),
            "id_field":"id","csv_id_to_node_id_map_dir":str(root),
            "csv_id_to_node_id_map_filename":"native-node-map.sqlite",
            "csv_id_to_node_id_map_path":str(root/"native-node-map.sqlite"),
            "csv_id_to_node_id_map_allowed_hosts":[job["target"]["host"]],
            "check_for_workbench_updates":False,"log_file_path":str(root/"workbench.log"),
            "remind_user_to_run_check":False,
            "rollback_config_file_path":str(root/"rollback.yml"),
            "rollback_csv_file_path":str(root/"rollback.csv"),**extra}

    def _preparation_digest(self,job,rows):
        digest=hashlib.sha256(jbytes({"buildId":job["buildId"],"target":job["target"],
            "crosswalk":job["crosswalk"],"baseline":job.get("baseline")}))
        for row in rows:digest.update(jbytes(row))
        return digest.hexdigest()

    def asset_path(self,identity,asset):
        origin=asset.get("originJob") or identity
        path=path_under(self.directory(origin),asset["path"])
        if not path.is_file() or file_sha(path)!=asset["sha256"]:
            raise InputError("A retained original file changed or is missing")
        return path.resolve()

    def _write_batch(self,job,root,name,task,headers,rows,**extra):
        if not rows:return None
        csv_path=root/(name+".csv");cfg=root/(name+".yml")
        put_file(csv_path,csv_bytes(headers,rows))
        put_file(cfg,jbytes(self._config(job,root,task,csv_path,**extra)))
        return {"name":name,"task":task,"rows":len(rows),"csv":csv_path.name,"config":cfg.name,
                "csvSha256":file_sha(csv_path),"configSha256":file_sha(cfg)}

    @exclusive
    def prepare(self,identity):
        with self.ws.mutex,self.ws.db:
            job=self.job(identity)
            if job["status"]=="RUNNING":raise InputError("Native execution owns this migration")
            root=path_under(self.directory(identity),"batches").resolve()
            root.mkdir(mode=0o700,exist_ok=True)
            rows=list(self._rows(identity));batches=[]
            creates=[r for r in rows if r["state"]=="CREATE"]
            headers=list(dict.fromkeys(k for r in creates for k in r["updates"]))
            create_groups={}
            for row in creates:
                primary=[x for x in row["assets"] if x["role"]=="primary"]
                if len(primary)>1:raise InputError("Select one primary file per object; retain others as supplemental files")
                file=str(self.asset_path(identity,primary[0])) if primary else ""
                kind=primary[0]["mediaType"] if primary else "nodes"
                use=primary[0]["mediaUse"] if primary else "http://pcdm.org/use#OriginalFile"
                create_groups.setdefault(kind,[]).append({"id":row["identifier"],"file":file,
                    "media_use_tid":use,**row["updates"]})
            for kind,create_rows in sorted(create_groups.items()):
                name="create-"+kind
                extra={"nodes_only":kind=="nodes"}
                if kind!="nodes":extra["media_type"]=kind
                b=self._write_batch(job,root,name,"create",["id","file","media_use_tid",*headers],create_rows,
                    output_csv=str(root/(name+"-result.csv")),output_csv_include_input_csv=True,**extra)
                if b:batches.append(b)
            groups={}
            for row in rows:
                if row["state"]!="UPDATE":continue
                for field,value in row["updates"].items():
                    groups.setdefault(("replace",field),[]).append({"node_id":row["nodeId"],field:value})
                for field in row["deletes"]:
                    groups.setdefault(("delete",field),[]).append({"node_id":row["nodeId"],field:""})
            for (mode,field),items in sorted(groups.items()):
                b=self._write_batch(job,root,"update-"+mode+"-"+field,"update",["node_id",field],items,update_mode=mode)
                if b:batches.append(b)
            known=[{"node_id":r["nodeId"]} for r in rows if r.get("nodeId")]
            fields=list(dict.fromkeys(k for r in rows for k in r["desired"]))
            b=self._write_batch(job,root,"read-target","export_csv",["node_id"],known,
                export_csv_file_path=str(root/"current-target.csv"),
                export_csv_field_list=list(dict.fromkeys([*fields,"published","field_member_of"])),export_file_url_instead_of_download=True)
            if b:batches.append(b)
            # Parent links resolve only to actual returned native node IDs.
            by_id={r["identifier"]:r for r in rows};parents=[];clear_parents=[]
            for row in rows:
                if not row.get("nodeId") or row["target"] is None:continue
                if not all(by_id[p].get("nodeId") for p in row["parents"]):continue
                current=set(filter(None,row["target"].get("field_member_of","").split(job["target"]["subdelimiter"])))
                wanted=self._parent_values(identity,row,current)
                if wanted==current:continue
                item={"node_id":row["nodeId"],"field_member_of":job["target"]["subdelimiter"].join(sorted(wanted,key=int))}
                (parents if wanted else clear_parents).append(item)
            for name,mode,items in (("relationships","replace",parents),("relationships-remove","delete",clear_parents)):
                b=self._write_batch(job,root,name,"update",["node_id","field_member_of"],items,update_mode=mode)
                if b:batches.append(b)
            media={}
            for row in rows:
                if not row.get("nodeId"):continue
                for asset in row["assets"]:
                    if asset.get("verifiedAt"):continue
                    if asset["role"]=="primary" and not row.get("nativeInspectedAt"):continue
                    media.setdefault(asset["mediaType"],[]).append({"node_id":row["nodeId"],
                        "file":str(self.asset_path(identity,asset)),"media_use_tid":asset["mediaUse"]})
            for kind,items in media.items():
                b=self._write_batch(job,root,"media-"+kind,"add_media",["node_id","file","media_use_tid"],items,media_type=kind)
                if b:batches.append(b)
            job["batches"]=batches
            job["preparation"]={"directory":str(root),"stateSha256":self._preparation_digest(job,rows)}
            job["packageAt"]=stamp();self._save(job)
            return {"job":job,"directory":str(root),"batches":batches}

    @exclusive
    def import_native_map(self,identity):
        job=self.job(identity);path=path_under(self.directory(identity),"batches/native-node-map.sqlite")
        if not path.exists():return {"matched":0}
        db=sqlite3.connect(path.resolve().as_uri()+"?mode=ro",uri=True)
        try:
            entries=db.execute("SELECT csv_id,node_id,host FROM csv_id_to_node_id_map").fetchall()
        finally:db.close()
        mapping={}
        for ident,node,host in entries:
            if host!=job["target"]["host"]:continue
            if ident in mapping and mapping[ident]!=node:raise InputError("Native map has multiple nodes for one source identifier")
            mapping[ident]=node
        with self.ws.mutex:
            known={r["identifier"]:str(r.get("nodeId") or "") for r in self._rows(identity)}
        matched=sum(ident in known for ident in mapping)
        if all(ident not in known or known[ident]==str(node) for ident,node in mapping.items()):
            return {"matched":matched,"received":len(mapping),"unchanged":True}
        return self.receive(identity,csv_bytes(["id","node_id"],[{"id":k,"node_id":v} for k,v in mapping.items()]),"map")

    def _verify_batch(self,identity,batch):
        root=path_under(self.directory(identity),"batches").resolve()
        config=path_under(root,batch["config"]);data=path_under(root,batch["csv"])
        if file_sha(config)!=batch["configSha256"] or file_sha(data)!=batch["csvSha256"]:
            raise InputError("Native inputs changed after preparation; prepare the selected edition again")
        return config,data

    def _current_batch(self,identity,batch_name):
        job=self.job(identity)
        batch=next((b for b in job.get("batches",[]) if b["name"]==batch_name),None)
        if not batch:raise InputError("Prepare this native batch first")
        self._verify_batch(identity,batch)
        # Receive the copied native map before choosing the remaining work. This
        # also continues a writer whose process ended before its IDs were saved.
        self.import_native_map(identity)
        job=self.job(identity)
        with self.ws.mutex:
            current={"directory":str(path_under(self.directory(identity),"batches").resolve()),
                     "stateSha256":self._preparation_digest(job,self._rows(identity))}
        if job.get("preparation")!=current:
            self.prepare(identity);job=self.job(identity)
            batch=next((b for b in job["batches"] if b["name"]==batch_name),None)
            if not batch:
                raise InputError("The selected batch is no longer current; choose from this job's prepared batches")
        self._verify_batch(identity,batch)
        return job,batch

    def _snapshot_native_map(self,identity):
        root=self.directory(identity).resolve();source=path_under(root,"batches/native-node-map.sqlite")
        if not source.exists():return None
        saved=path_under(root,"native-maps");saved.mkdir(mode=0o700,exist_ok=True)
        tmp=saved/(uuid.uuid4().hex+".sqlite")
        reader=writer=None
        try:
            reader=sqlite3.connect(source.resolve().as_uri()+"?mode=ro",uri=True)
            writer=sqlite3.connect(tmp);os.chmod(tmp,0o600)
            reader.backup(writer)
            writer.close();writer=None
            reader.close();reader=None
            digest=file_sha(tmp);destination=saved/(digest+".sqlite")
            if destination.exists():
                if destination.is_symlink() or file_sha(destination)!=digest:
                    raise InputError("A retained native map snapshot changed")
                tmp.unlink()
            else:
                os.replace(tmp,destination);storage.sync_dir(saved)
            return {"path":destination.relative_to(root).as_posix(),
                    "bytes":destination.stat().st_size,"sha256":digest}
        finally:
            if writer is not None:writer.close()
            if reader is not None:reader.close()
            if tmp.exists():tmp.unlink()

    def _run_inputs(self,identity,batch,run_dir):
        root=self.directory(identity).resolve();prepared,data=self._verify_batch(identity,batch)
        prepared_body=prepared.read_bytes()
        put_file(run_dir/"prepared.yml",prepared_body)
        shutil.copyfile(data,run_dir/"input.csv");os.chmod(run_dir/"input.csv",0o600)
        if file_sha(run_dir/"input.csv")!=batch["csvSha256"]:
            raise InputError("The native CSV changed while retaining this run")
        settings=decode(prepared_body)
        # These are the exact paths the new native process will receive. The
        # active map stays with this job; input, results and rollback stay with
        # this invocation and survive later batch regeneration.
        settings.update(input_dir=str(run_dir),input_csv=str(run_dir/"input.csv"),
            csv_id_to_node_id_map_dir=str((root/"batches").resolve()),
            csv_id_to_node_id_map_filename="native-node-map.sqlite",
            csv_id_to_node_id_map_path=str((root/"batches"/"native-node-map.sqlite").resolve()),
            log_file_path=str(run_dir/"workbench.log"),
            rollback_config_file_path=str(run_dir/"rollback.yml"),
            rollback_csv_file_path=str(run_dir/"rollback.csv"))
        for key,name in (("output_csv","created-nodes.csv"),("export_csv_file_path","current-target.csv")):
            if key in settings:settings[key]=str(run_dir/name)
        put_file(run_dir/"config.yml",jbytes(settings))
        inputs={}
        for key,name in (("config","config.yml"),("csv","input.csv"),("preparedConfig","prepared.yml")):
            path=run_dir/name
            inputs[key]={"path":path.relative_to(root).as_posix(),
                         "bytes":path.stat().st_size,"sha256":file_sha(path)}
        return settings,inputs

    @exclusive
    def execute(self,identity,batch_name,workbench,python=None,check=False):
        workbench=Path(workbench).resolve();python=str(Path(python or sys.executable).resolve())
        if not workbench.is_file():raise InputError("Select the installed original Islandora workbench script")
        job,batch=self._current_batch(identity,batch_name)
        if not check and batch["task"]!="export_csv" and not job.get("review"):
            raise InputError("Review the current complete migration before applying target changes")
        if batch["task"]=="add_media" and not check:
            self.inspect_target(identity)
            prepared=self.prepare(identity);job=self.job(identity)
            batch=next((b for b in prepared["batches"] if b["name"]==batch_name),None)
            if not batch:return {"batch":batch_name,"status":"COMPLETE","received":True,"at":stamp()}
            if not job.get("review"):raise InputError("Resolve the newly received source/target decisions before applying changes")
        if not check and batch["task"]!="export_csv":
            checked=self.execute(identity,batch_name,workbench,python,check=True)
            if checked.get("exitCode")!=0:return {"status":"CONTINUE","check":checked,"batch":batch_name}
            job,batch=self._current_batch(identity,batch_name)
            if not job.get("review"):raise InputError("Review the current complete migration before applying target changes")
        root=self.directory(identity).resolve()
        run_id=uuid.uuid4().hex;runs=path_under(root,"runs");runs.mkdir(mode=0o700,exist_ok=True)
        run_dir=runs/run_id;run_dir.mkdir(mode=0o700)
        settings,inputs=self._run_inputs(identity,batch,run_dir)
        map_before=self._snapshot_native_map(identity)
        command=[python,str(workbench),"--config",str(run_dir/"config.yml")]
        if check:command.append("--check")
        elif batch["task"]=="create" and map_before:
            db=sqlite3.connect(path_under(root,map_before["path"]).resolve().as_uri()+"?mode=ro",uri=True)
            try:
                ids=[int(x[0]) for x in db.execute("SELECT node_id FROM csv_id_to_node_id_map WHERE host=?",
                    (job["target"]["host"],)) if str(x[0]).isdigit() and int(x[0])>0]
            finally:db.close()
            if ids:command.extend(["--recovery_mode_starting_from_node_id",str(min(ids))])
        run={"id":run_id,"batch":batch_name,"task":batch["task"],"check":bool(check),
             "inputSha256":inputs["csv"]["sha256"],"configSha256":inputs["config"]["sha256"],
             "inputs":inputs,"mapBefore":map_before,"review":job.get("review"),
             "command":command,"startedAt":stamp(),"status":"RUNNING",
             "workbenchSha256":file_sha(workbench),"log":(run_dir.relative_to(root)/"native.log").as_posix()}
        put_file(run_dir/"invocation.json",jbytes(run))
        with self.ws.mutex,self.ws.db:
            job["runs"].append(run);job["status"]="RUNNING";self._save(job)
        env=os.environ.copy();env["PYTHONUNBUFFERED"]="1"
        code=None
        try:
            if self.stop_event.is_set():raise InputError("Native operation was cancelled before launch")
            with (run_dir/"native.log").open("xb") as log:
                os.chmod(run_dir/"native.log",0o600)
                self.process=subprocess.Popen(command,cwd=str(workbench.parent),stdin=subprocess.DEVNULL,
                    stdout=log,stderr=subprocess.STDOUT,env=env,
                    **({"pass_fds":(self.ws.xml.lease.fileno(),)} if os.name=="posix" else {}))
                if self.stop_event.is_set():self.process.terminate()
                run["pid"]=self.process.pid
                with self.ws.mutex,self.ws.db:self._save(job)
                code=self.process.wait()
            run.update(exitCode=code,status="COMPLETE" if code==0 else "CONTINUE",finishedAt=stamp())
        except BaseException as exc:
            run.update(status="CONTINUE",error=str(exc),finishedAt=stamp())
            raise
        finally:
            self.process=None
            try:run["mapAfter"]=self._snapshot_native_map(identity)
            except Exception as exc:run["mapSnapshotError"]=str(exc)
            with self.ws.mutex,self.ws.db:
                job=self.job(identity)
                job["runs"]=[run if r["id"]==run_id else r for r in job["runs"]]
                job["status"]="PREPARED" if code==0 else "CONTINUE"
                self._save(job)
            put_file(run_dir/"result.json",jbytes(run))
        if not check:
            if batch["task"]=="create":
                self.import_native_map(identity)
                result=Path(settings["output_csv"])
                # Native create output can overlay source CSV values on its
                # returned fields; use its IDs and receive metadata via export_csv.
                if result.exists():self.receive(identity,result.read_bytes(),"map")
            elif batch["task"]=="export_csv":
                result=Path(settings["export_csv_file_path"])
                if result.exists():self.receive(identity,result.read_bytes(),"target")
                if code==0:self.inspect_target(identity)
        return run

    def start(self,*args,**kwargs):
        with self.worker_lock:
            if self.worker and self.worker.is_alive():raise InputError("This console already has a native migration running")
            self.stop_event.clear()
            def run():
                try:self.execute(*args,**kwargs)
                except Exception as error:self.last_error=str(error)
            self.last_error=None
            self.worker=threading.Thread(target=run,name="islandora-workbench",daemon=False)
            self.worker.start()
        return {"running":True,"jobId":args[0]}

    def start_inspection(self,identity):
        with self.worker_lock:
            if self.worker and self.worker.is_alive():raise InputError("This console already has a native migration running")
            self.stop_event.clear();self.last_error=None
            def run():
                try:self.inspect_target(identity)
                except Exception as error:self.last_error=str(error)
            self.worker=threading.Thread(target=run,name="islandora-receiving",daemon=False)
            self.worker.start()
        return {"running":True,"jobId":identity}

    def stop(self):
        self.stop_event.set()
        if self.process and self.process.poll() is None:self.process.terminate()
        return {"stopping":bool(self.worker and self.worker.is_alive()) or bool(self.process)}


    @exclusive
    def associations(self,identity,identifier,assets=None,parents=None):
        with self.ws.mutex,self.ws.db:
            job=self.job(identity)
            if job["status"]=="RUNNING":raise InputError("Finish native execution before correcting associations")
            row=self.record(identity,identifier)
            if assets is not None:
                known={a["path"]:a for a in row["assets"]}
                if any(path not in known for path in assets):raise InputError("Select from this record's retained original files")
                row["assets"]=[known[path] for path in dict.fromkeys(assets)]
            if parents is not None:
                for parent in parents:
                    if parent==identifier:raise InputError("A record cannot be its own parent")
                    self.record(identity,parent)
                row["parents"]=list(dict.fromkeys(parents));row.pop("parentsVerifiedAt",None)
            self._put_record(identity,row)
            graph={r["identifier"]:r["parents"] for r in self._rows(identity)}
            seen=set();active=set()
            def visit(node):
                if node in active:raise InputError("Collection relationships contain a cycle")
                if node in seen:return
                active.add(node)
                for parent in graph.get(node,[]):visit(parent)
                active.remove(node);seen.add(node)
            for node in graph:visit(node)
            self._summary(job);return row

    def _request(self,job,url,*,binary=False):
        parsed=urlsplit(url);origin=urlsplit(job["target"]["host"])
        if parsed.scheme not in {"http","https"} or parsed.username or parsed.password:
            raise InputError("Native target returned an invalid HTTP resource URL")
        headers={"Accept":"application/json" if not binary else "application/octet-stream"}
        password=os.environ.get("ISLANDORA_WORKBENCH_PASSWORD")
        username=job["target"].get("username")
        if username and password and (parsed.scheme,parsed.netloc)==(origin.scheme,origin.netloc):
            headers["Authorization"]="Basic "+base64.b64encode((username+":"+password).encode()).decode()
        class Redirect(HTTPRedirectHandler):
            def redirect_request(self,req,fp,code,msg,response_headers,newurl):
                next_request=super().redirect_request(req,fp,code,msg,response_headers,newurl)
                if next_request and (urlsplit(newurl).scheme,urlsplit(newurl).netloc)!=(urlsplit(req.full_url).scheme,urlsplit(req.full_url).netloc):
                    next_request.remove_header("Authorization")
                return next_request
        response=build_opener(Redirect()).open(Request(url,headers=headers),timeout=60)
        if response.status!=200:
            response.close();raise InputError("Native target returned HTTP "+str(response.status))
        if binary:return response
        with response:
            body=response.read(32*1024*1024+1)
            if len(body)>32*1024*1024:raise InputError("Target metadata response exceeds 32 MiB")
            folder=self.directory(job["id"])/"target-responses";folder.mkdir(mode=0o700,exist_ok=True)
            digest=sha(body);path=folder/(digest+".json")
            if not path.exists():put_file(path,body)
            return decode(body)

    def _term(self,job,uri):
        if str(uri).isdigit():return str(uri)
        for endpoint,parameter in (("/term_from_uri","uri"),("/term_from_authority_link","authority_link")):
            try:
                answer=self._request(job,job["target"]["host"]+endpoint+"?"+urlencode({"_format":"json",parameter:uri}))
                if isinstance(answer,list) and len(answer)==1:
                    return str(answer[0]["tid"][0]["value"])
            except (HTTPError,KeyError,IndexError,ValueError):pass
        raise InputError("Resolve the original media-use URI on this target: "+str(uri))

    def _read_file_hash(self,job,item):
        uri=item.get("url");file_uuid=item.get("target_uuid")
        if file_uuid:
            try:
                answer=self._request(job,job["target"]["host"]+"/islandora_workbench_integration/file_hash?"+
                    urlencode({"file_uuid":file_uuid,"algorithm":"sha256"}))
                digest=answer[0]["checksum"]
                if isinstance(digest,str) and re.fullmatch(r"[0-9a-fA-F]{64}",digest):
                    return digest.lower(),"native-file-hash"
            except (HTTPError,KeyError,IndexError,TypeError,ValueError):pass
        if not uri:raise InputError("Native media has no downloadable file URL")
        if uri.startswith("/"):uri=job["target"]["host"]+uri
        h=hashlib.sha256()
        with self._request(job,uri,binary=True) as response:
            while chunk:=response.read(1024*1024):
                if self.stop_event.is_set():raise InputError("Native file receiving was cancelled")
                h.update(chunk)
        return h.hexdigest(),"downloaded-file-bytes"

    def _parent_values(self,identity,row,current):
        previous=set(map(str,row.get("managedParentIds",[])))
        desired={str(self.record(identity,parent).get("nodeId") or "") for parent in row["parents"]}
        if "" in desired:raise InputError("Receive parent node IDs before their relationships")
        # Apply source membership additions/removals while retaining staff-only
        # additions or removals made since the preceding source edition.
        return (current-(previous-desired))|(desired-previous)

    @exclusive
    def inspect_target(self,identity):
        job=self.job(identity);root=job["target"]["host"]
        observed=0;asset_count=0
        # Missing IDs after an interrupted create can be recovered from the same
        # native unique-identifier View used by Workbench's create operation.
        lookup=job["target"].get("node_exists_verification_view_endpoint",[])
        if isinstance(lookup,dict):lookup=[lookup]
        field_endpoint=list(lookup[-1].items())[-1] if lookup else None
        with self.ws.mutex:identifiers=[r["identifier"] for r in self._rows(identity)]
        for ident in identifiers:
            if self.stop_event.is_set():raise InputError("Native target receiving was cancelled")
            row=self.record(identity,ident)
            if not row.get("nodeId") and field_endpoint:
                field,endpoint=field_endpoint;value={**row["desired"],**row.get("overrides",{})}.get(field,"")
                if value:
                    answer=self._request(job,root+endpoint+"?"+urlencode({field:value}))
                    if len(answer)>1:raise InputError("Target lookup returned multiple nodes for "+ident)
                    if answer:row["nodeId"]=str(answer[0]["nid"])
            if not row.get("nodeId"):continue
            answer=self._request(job,root+"/node/"+str(row["nodeId"])+"?_format=json")
            if str(answer.get("nid",[{}])[0].get("value"))!=str(row["nodeId"]):
                raise InputError("Target response differs from the requested node ID")
            node_uuid=answer.get("uuid",[{}])[0].get("value")
            if row.get("nodeUUID") and row["nodeUUID"]!=node_uuid:
                raise InputError("The target node has been replaced since its original receiving")
            row["nodeUUID"]=node_uuid
            # Workbench serializes typed metadata in its original CSV export.
            # Native JSON adds publication state and relationship IDs exactly.
            if row["target"] is not None:
                row["target"]["published"]="1" if answer.get("status",[{}])[0].get("value") else "0"
                row["target"]["field_member_of"]=job["target"]["subdelimiter"].join(
                    str(p["target_id"]) for p in answer.get("field_member_of",[]) if "target_id" in p)
            if row["parents"] or row.get("managedParentIds"):
                with self.ws.mutex:
                    known=all(self.record(identity,parent).get("nodeId") for parent in row["parents"])
                    actual={str(p["target_id"]) for p in answer.get("field_member_of",[]) if "target_id" in p}
                    matches=known and self._parent_values(identity,row,actual)==actual
                if matches:row["parentsVerifiedAt"]=stamp()
                else:row.pop("parentsVerifiedAt",None)
            if row["assets"]:
                media=self._request(job,root+"/node/"+str(row["nodeId"])+"/media?_format=json")
                file_fields={"field_media_file","field_media_image","field_media_document",
                             "field_media_audio_file","field_media_video_file"}
                file_fields.update(job["target"].get("media_type_file_fields",{}).values())
                native=[]
                for entity in media:
                    media_type=entity.get("bundle",[{}])[0].get("target_id",entity.get("type",[{}])[0].get("target_id"))
                    uses={str(x["target_id"]) for x in entity.get("field_media_use",[]) if "target_id" in x}
                    for field in file_fields:
                        for item in entity.get(field,[]):
                            digest,method=self._read_file_hash(job,item)
                            native.append({"sha256":digest,"method":method,"mediaType":media_type,
                                "uses":uses,"mediaId":str(entity.get("mid",[{}])[0].get("value","")),"url":item.get("url")})
                terms={}
                for asset in row["assets"]:
                    use=asset["mediaUse"]
                    if use not in terms:terms[use]=self._term(job,use)
                    matches=[n for n in native if n["sha256"]==asset["sha256"] and terms[use] in n["uses"]
                             and n["mediaType"]==asset["mediaType"]]
                    if matches:
                        asset.update(verifiedAt=stamp(),targetMediaId=matches[0]["mediaId"],
                            targetURL=matches[0]["url"],verification=matches[0]["method"])
                        asset_count+=1
                    else:
                        for key in ("verifiedAt","targetMediaId","targetURL","verification"):asset.pop(key,None)
            row["nativeInspectedAt"]=stamp()
            with self.ws.mutex,self.ws.db:
                self._put_record(identity,self._classify(row));observed+=1
        with self.ws.mutex,self.ws.db:
            job=self.job(identity)
            job["nativeReceiving"]={"at":stamp(),"nodes":observed,"matchedFiles":asset_count}
            self._summary(job)
        return {"job":job,"nodes":observed,"matchedFiles":asset_count}

    @exclusive
    def finish(self,identity,operator,note):
        with self.ws.mutex,self.ws.db:
            job=self.job(identity);rows=list(self._rows(identity))
            pending=[r["identifier"] for r in rows if not r.get("nodeId") or r["target"] is None]
            if pending:raise InputError("Receive original target IDs and readback for all "+str(len(pending))+" remaining records")
            mismatches=[r["identifier"] for r in rows if r["state"] in {"REVIEW","UPDATE","READ_TARGET","CREATE"}]
            if mismatches:raise InputError("Finish target changes or source/target decisions for "+str(len(mismatches))+" records")
            missing_assets=[r["identifier"] for r in rows if any(not a.get("verifiedAt") for a in r["assets"])]
            missing_parents=[r["identifier"] for r in rows if (r["parents"] or r.get("managedParentIds")) and not r.get("parentsVerifiedAt")]
            if missing_assets or missing_parents:
                raise InputError("Receive native media and relationships for "+str(len(set(missing_assets+missing_parents)))+" records")
            for row in rows:
                row["before"]={**row["desired"],**row.get("overrides",{})}
                row["managedParentIds"]=[str(self.record(identity,parent)["nodeId"]) for parent in row["parents"]]
                self._put_record(identity,row)
            job["status"]="COMPLETE";job["handover"]={"operator":plain(operator,"the receiving operator",256),
                "note":plain(note,"the handover note",4096),"at":stamp(),"records":len(rows),
                "assets":job["assetCount"],"relationships":job["relationshipCount"]}
            return self._save(job)

    @exclusive
    def export(self,identity,destination):
        job=self.job(identity)
        if job["status"]=="RUNNING":raise InputError("Complete or stop native execution before saving the package")
        root=self.directory(identity);destination=Path(destination)
        with self.ws.mutex:
            records=b"".join(jbytes(r) for r in self._rows(identity))
            guide=Path(__file__).with_name("ISLANDORA_OPERATOR_GUIDE.md")
            if guide.is_file():put_file(root/guide.name,guide.read_bytes())
            put_file(root/"migration.json",jbytes(job))
            put_file(root/"records.jsonl",records)
            files=[]
            inherited={a["path"]:a for r in self._rows(identity) for a in r["assets"]
                       if a.get("originJob") and a["originJob"]!=identity}
            with destination.open("xb") as output:
                os.chmod(destination,0o600)
                with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                    for path in sorted(root.rglob("*")):
                        if path.is_symlink():raise InputError("Migration package cannot contain symbolic links")
                        if path.is_file():
                            name=path.relative_to(root).as_posix()
                            files.append({"file":name,"bytes":path.stat().st_size,"sha256":file_sha(path,1024**4)})
                            archive.write(path,name)
                    names={x["file"] for x in files}
                    for name,asset in inherited.items():
                        if name in names:continue
                        path=self.asset_path(identity,asset)
                        files.append({"file":name,"bytes":path.stat().st_size,"sha256":file_sha(path,1024**4)})
                        archive.write(path,name)
                    archive.writestr("package.json",jbytes({"schema":"stellar-forge.islandora-delivery.v1",
                        "jobId":identity,"createdAt":stamp(),"files":files}))
            return {"path":str(destination),"bytes":destination.stat().st_size,
                    "sha256":file_sha(destination,1024**4),"files":len(files)}
