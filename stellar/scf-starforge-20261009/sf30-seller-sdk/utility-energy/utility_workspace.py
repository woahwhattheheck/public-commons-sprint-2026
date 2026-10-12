"""MIT. Retained utility receiving, review and native publishing workspace."""
from __future__ import annotations

from datetime import datetime,timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import uuid

from utility_shared import (HERE,SourceWorkspace,InputError,json_bytes,load_json,
                            private_write,file_digest,sync_dir)
import utility_source as source
import utility_analysis as analysis
from utility_delivery import DeliveryOperations
from utility_api import ApiOperations
from utility_publisher import Publisher

VERSION="stellar-forge.utility-workspace.v1"

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z")

def immutable(path,data):
    path=Path(path)
    if path.exists():
        if path.is_symlink() or path.read_bytes()!=data:raise InputError("Retained content differs: "+path.name)
        return
    fd,temporary=tempfile.mkstemp(prefix=".stage-",dir=path.parent)
    temporary=Path(temporary)
    try:
        with os.fdopen(fd,"wb") as out:
            os.chmod(temporary,0o600);out.write(data);out.flush();os.fsync(out.fileno())
        os.link(temporary,path,follow_symlinks=False)
        sync_dir(path.parent)
    finally:temporary.unlink(missing_ok=True)

def checked_id(value):
    if not isinstance(value,str) or not source.SHA.fullmatch(value):
        raise InputError("Choose a complete retained identifier")
    return value

class Workspace(DeliveryOperations,ApiOperations,SourceWorkspace):
    def __init__(self,root,create=False):
        super().__init__(root,create=create)
        self.publisher=Publisher(self.root/"publisher")
        try:
            for name in ("utility","exports"):
                path=self.root/name;path.mkdir(mode=0o700,exist_ok=True)
                if path.is_symlink() or not path.is_dir():raise InputError("Use original private utility directories")
            for name in ("originals","imports","previews","reviews","reconciliations","captures"):
                path=self.root/"utility"/name;path.mkdir(mode=0o700,exist_ok=True)
                if path.is_symlink() or not path.is_dir():raise InputError("Use original utility receiving directories")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS utility_meta(k TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_imports(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_records(id TEXT PRIMARY KEY,import_id TEXT NOT NULL REFERENCES utility_imports(id),
                    kind TEXT NOT NULL,meter TEXT NOT NULL,series TEXT NOT NULL,logical_key TEXT NOT NULL,
                    start_us INTEGER,end_us INTEGER,body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS utility_records_selection ON utility_records(import_id,kind,meter,series,start_us);
                CREATE TABLE IF NOT EXISTS utility_previews(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_reviews(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_reconciliations(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_captures(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_exports(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS utility_actions(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,body TEXT NOT NULL);
            """)
            if self.meta("application") is None:
                self.set_meta("application",VERSION);self.set_meta("revision",0)
            if self.meta("application")!=VERSION:raise InputError("Unsupported utility application workspace")
        except BaseException:
            self.publisher.close();super().close();raise

    def close(self):
        try:self.publisher.close()
        finally:super().close()

    def meta(self,key,default=None):
        row=self.db.execute("SELECT body FROM utility_meta WHERE k=?",(key,)).fetchone()
        return load_json(row[0]) if row else default

    def set_meta(self,key,value):
        with self.db:self.db.execute("INSERT OR REPLACE INTO utility_meta VALUES(?,?)",(key,json_bytes(value).decode()))

    def all(self,table):
        if table not in {"imports","previews","reviews","reconciliations","captures","exports","actions"}:
            raise InputError("Unknown utility collection")
        return [load_json(r[0]) for r in self.db.execute("SELECT body FROM utility_"+table+" ORDER BY rowid")]

    def saved(self,table,ident):
        if table not in {"imports","previews","reviews","reconciliations","captures","exports"}:
            raise InputError("Unknown retained utility collection")
        row=self.db.execute("SELECT body FROM utility_"+table+" WHERE id=?",(checked_id(ident),)).fetchone()
        if row is None:raise InputError("The retained utility selection was not found")
        value=load_json(row[0])
        if table in {"previews","reviews","reconciliations"}:
            path=self.root/"utility"/table/(ident+".json")
            if path.is_symlink() or path.read_bytes()!=json_bytes(value):raise InputError("Retained review bytes changed")
        return value

    def save(self,table,value):
        ident=checked_id(value["id"])
        if table in {"previews","reviews","reconciliations"}:
            immutable(self.root/"utility"/table/(ident+".json"),json_bytes(value))
        with self.db:self.db.execute("INSERT OR REPLACE INTO utility_"+table+" VALUES(?,?)",(ident,json_bytes(value).decode()))

    def state(self):
        with self.mutex:
            native=super().state()
            return {**native,"applicationSchema":VERSION,"revision":self.meta("revision",0),
                "imports":[{k:r.get(k) for k in ("id","name","provider","kind","source_sha256","bytes","counts","created_at","capture_id")} for r in self.all("imports")],
                "previews":[{k:r.get(k) for k in ("id","name","created_at","selected_rows","issue_count","can_build","can_export_load")} for r in self.all("previews")],
                "reviews":[{**{k:r.get(k) for k in ("id","name","preview_id","reviewer","note","created_at")},
                    "build_id":(self.meta("build:"+r["id"]) or {}).get("build_id")} for r in self.all("reviews")],
                "reconciliations":[{k:r.get(k) for k in ("id","review_id","created_at","bill_count")} for r in self.all("reconciliations")],
                "captures":self.all("captures"),"exports":[{k:r.get(k) for k in ("id","review_id","build_id","created_at","files","bytes")} for r in self.all("exports")],
                "active_review":self.meta("active_review"),"active_build":self.meta("active_build"),
                "merchant":self.meta("merchant"),"last_query":self.meta("last_query"),
                "received_export_manifests":self.meta("received_export_manifests",[]),
                "totals":dict(self.db.execute("SELECT kind,COUNT(*) FROM utility_records GROUP BY kind").fetchall()),
                "publisher":self.publisher.state()}

    def import_source(self,data,name,provider="auto",kind="auto",context=None,capture_id=None,retained=None):
        context=context or {}
        if not isinstance(context,dict) or len(json_bytes(context))>65536:
            raise InputError("Source context must be a short object")
        decoded=source.decode(data,provider,kind)
        metadata=decoded["metadata"]
        ident=source.sha(json_bytes({"provider":metadata["provider"],"kind":metadata.get("kind","atom-espi"),
                                   "source_sha256":metadata["source_sha256"]}))
        existing=self.db.execute("SELECT body FROM utility_imports WHERE id=?",(ident,)).fetchone()
        if existing:
            record=load_json(existing[0])
            self.original(record["id"])
            if retained is not None and retained!=record:raise InputError("Portable retained import differs")
            return record
        original_name=metadata["source_sha256"]+(".xml" if metadata["provider"]=="greenbutton" else ".json")
        immutable(self.root/"utility"/"originals"/original_name,data)
        record={"id":ident,"name":source.text(name,"Source label",160),"provider":metadata["provider"],
                "kind":metadata.get("kind","atom-espi"),"source_sha256":metadata["source_sha256"],
                "original_name":original_name,"bytes":len(data),"created_at":now(),"context":context,
                "metadata":metadata,"metadata_sha256":source.sha(json_bytes(metadata)),
                "counts":metadata["counts"],"capture_id":capture_id,"native_sources":{}}
        if retained is not None:
            for key in ("id","provider","kind","source_sha256","bytes","metadata_sha256","counts"):
                if retained.get(key)!=record[key]:raise InputError("Portable source reconstruction differs: "+key)
            record["created_at"]=retained["created_at"]
            record["capture_id"]=retained.get("capture_id")
        normalized=[]
        for collection in source.COLLECTIONS:
            for row in decoded[collection]:
                row["import_id"]=ident
                row["row_id"]=source.sha(json_bytes([ident,row["row_id"]]))
                if row["record_type"]=="charge":
                    row["bill_row_id"]=source.sha(json_bytes([ident,row["bill_row_id"]]))
                normalized.append(row)
            if decoded[collection]:
                encoded=b"".join(json_bytes(r) for r in decoded[collection])
                normalized_source=super().add_source(io.BytesIO(encoded),(record["name"]+" — "+collection)[:160],collection+".ndjson")
                record["native_sources"][collection]=normalized_source["id"]
        if retained is not None and record!=retained:raise InputError("Portable original import metadata differs")
        immutable(self.root/"utility"/"imports"/(ident+".json"),json_bytes(record))
        with self.db:
            self.db.execute("INSERT INTO utility_imports VALUES(?,?)",(ident,json_bytes(record).decode()))
            self.db.executemany("INSERT INTO utility_records VALUES(?,?,?,?,?,?,?,?,?)",
                [(r["row_id"],ident,r["record_type"],r.get("meter_id",""),r.get("series_id",""),r.get("logical_key",""),
                  r.get("start_us"),r.get("end_us"),json_bytes(r).decode()) for r in normalized])
        return record

    def original(self,import_id):
        record=self.saved("imports",import_id)
        path=self.root/"utility"/"originals"/record["original_name"]
        if file_digest(path)!=record["source_sha256"] or path.stat().st_size!=record["bytes"]:
            raise InputError("Original provider source bytes changed")
        return path

    def record(self,ident):
        row=self.db.execute("SELECT body FROM utility_records WHERE id=?",(checked_id(ident),)).fetchone()
        if row is None:raise InputError("Unknown original utility record")
        result=load_json(row[0]);self.original(result["import_id"])
        return result

    def records(self,kind="interval",*,import_ids=None,meter=None,series=None,offset=0,limit=100,full=False):
        if kind not in {"meter","bill","charge","interval","resource"}:raise InputError("Choose a retained utility record kind")
        if type(offset)is not int or offset<0 or type(limit)is not int or not 1<=limit<=1000:
            raise InputError("Choose a valid source offset and page size up to 1000")
        predicates=["kind=?"];args=[kind]
        if import_ids:
            import_ids=analysis.identifiers(import_ids,"Source imports")
            predicates.append("import_id IN ("+",".join("?" for _ in import_ids)+")");args.extend(import_ids)
        if meter is not None:predicates.append("meter=?");args.append(meter)
        if series is not None:predicates.append("series=?");args.append(series)
        where=" AND ".join(predicates)
        with self.mutex:
            count=self.db.execute("SELECT COUNT(*) FROM utility_records WHERE "+where,args).fetchone()[0]
            rows=[load_json(r[0]) for r in self.db.execute("SELECT body FROM utility_records WHERE "+where+
                " ORDER BY meter,series,start_us,id LIMIT ? OFFSET ?",[*args,limit,offset])]
            if not full:
                rows=[{k:v for k,v in r.items() if k not in {"raw_json","reading_raw_json"}} for r in rows]
            return {"kind":kind,"total":count,"offset":offset,"rows":rows,"next_offset":offset+len(rows) if offset+len(rows)<count else None}

    def series(self,import_ids=None):
        ids=analysis.identifiers(import_ids,"Source imports") if import_ids else []
        where="kind='interval'";args=[]
        if ids:
            where+=" AND import_id IN ("+",".join("?" for _ in ids)+")";args.extend(ids)
        with self.mutex:
            rows=self.db.execute("SELECT series,COUNT(*) AS n,MIN(start_us) AS first,MAX(end_us) AS last,MIN(body) AS body FROM utility_records WHERE "+where+" GROUP BY series ORDER BY series",args).fetchall()
            return {"series":[{**{key:load_json(row["body"]).get(key) for key in ("series_id","meter_id","channel","unit","measurement_meter","quantity_semantics")},
                "records":row["n"],"first_us":row["first"],"last_us":row["last"]} for row in rows]}

    def selected_records(self,kind,import_ids):
        ids=analysis.identifiers(import_ids,"Source imports")
        if not ids:return []
        return [load_json(r[0]) for r in self.db.execute("SELECT body FROM utility_records WHERE kind=? AND import_id IN ("+
            ",".join("?" for _ in ids)+") ORDER BY meter,series,start_us,id",[kind,*ids])]

    def preview(self,raw):
        imports=self.all("imports")
        normalized=analysis.selection(raw)
        for ident in normalized["import_ids"]:self.original(ident)
        rows=self.selected_records("interval",normalized["import_ids"])
        report,_=analysis.analyze(rows,normalized,imports)
        ident=report["sha256"]
        old=self.db.execute("SELECT body FROM utility_previews WHERE id=?",(ident,)).fetchone()
        if old:return self.saved("previews",ident)
        result={"id":ident,"name":normalized["name"],"created_at":now(),"selected_rows":report["selected_rows"],
                "issue_count":len(report["issues"]),"can_build":report["can_build"],"can_export_load":report["can_export_load"],
                "report":report}
        self.save("previews",result)
        return result

    def review(self,payload,request_id):
        preview=self.saved("previews",payload["preview_id"])
        if payload.get("expected_sha256")!=preview["report"]["sha256"]:
            raise InputError("Refresh the exact interval review before recording its decision")
        reviewer=source.text(payload.get("reviewer"),"Reviewer",160)
        note=source.text(payload.get("note"),"Review note",8192)
        acknowledgements=analysis.identifiers(payload.get("acknowledged_issue_ids",[]),"Reviewed exceptions",100000)
        if set(acknowledgements)-{i["id"] for i in preview["report"]["issues"]}:
            raise InputError("An acknowledged exception does not belong to this source selection")
        result={"id":source.sha(json_bytes({"request_id":request_id,"preview_id":preview["id"]})),
                "name":preview["name"],"preview_id":preview["id"],"preview_sha256":preview["report"]["sha256"],
                "reviewer":reviewer,"note":note,"acknowledged_issue_ids":acknowledgements,
                "created_at":now(),"build_id":None}
        self.save("reviews",result);self.set_meta("active_review",result["id"])
        return result

    def review_rows(self,review_id):
        reviewed=self.saved("reviews",review_id);preview=self.saved("previews",reviewed["preview_id"])
        for item in preview["report"]["sources"]:
            retained=self.saved("imports",item["id"]);self.original(item["id"])
            if retained["source_sha256"]!=item["source_sha256"] or retained["metadata_sha256"]!=item["metadata_sha256"]:
                raise InputError("The reviewed original source binding changed")
        rows=[]
        for ident in preview["report"]["selected_row_ids"]:
            row=self.db.execute("SELECT body FROM utility_records WHERE id=?",(ident,)).fetchone()
            if row is None:raise InputError("An original reviewed reading is missing")
            rows.append(load_json(row[0]))
        return reviewed,preview,rows

    def build_review(self,review_id):
        reviewed,preview,rows=self.review_rows(review_id)
        if not preview["report"]["can_build"]:
            raise InputError("Choose the corrected readings and valid time periods before building this interval dataset")
        equivalents={x["selected_row_id"]:x["row_ids"] for x in preview["report"]["equivalent_and_corrected"]}
        projected=[analysis.projection(r,{"row_ids":equivalents.get(r["row_id"],[r["row_id"]]),
            "source_import_id":r["import_id"]}) for r in rows]
        retained=super().add_source(io.BytesIO(b"".join(json_bytes(r) for r in projected)),reviewed["name"],"reviewed-intervals.ndjson")
        plan=super().save_plan(analysis.mapping())
        result=super().build(retained["id"],plan["id"])
        # Reviews remain immutable; a separate binding connects their native build.
        self.set_meta("build:"+review_id,{"build_id":result["id"],"source":retained["id"],"plan":plan["id"]})
        self.set_meta("active_build",result["id"]);self.set_meta("active_review",review_id)
        return result

    def reconcile(self,payload,request_id):
        reviewed,preview,rows=self.review_rows(payload["review_id"])
        ids=preview["report"]["selection"]["import_ids"]
        bills=self.selected_records("bill",ids);charges=self.selected_records("charge",ids)
        if payload.get("bill_row_ids"):
            selected=set(analysis.identifiers(payload["bill_row_ids"],"Bills",100000))
            if selected-{b["row_id"] for b in bills}:raise InputError("Choose original bills from the reviewed source set")
            bills=[b for b in bills if b["row_id"] in selected]
        report=analysis.bill_reconciliation(bills,charges,rows,bill_series=payload.get("bill_series"))
        result={"id":source.sha(json_bytes({"request_id":request_id,"review_id":reviewed["id"]})),
                "review_id":reviewed["id"],"preview_sha256":preview["report"]["sha256"],
                "created_at":now(),"bill_count":len(bills),"report":report}
        self.save("reconciliations",result);return result

    def query(self,build_id,params):
        result=super().query(build_id,params)
        response=result.get("response",{})
        if response.get("status")==200:
            self.set_meta("last_query",{"build_id":build_id,"query":params,"snapshot":result["dataset"]["snapshot"],
                                      "created_at":now(),"response":response})
        return result

    def execute(self,action,p,request_id):
        if action=="source.import":
            path=Path(p["path"]).expanduser().absolute()
            if path.is_symlink() or not path.is_file() or path.stat().st_size>source.MAX_BYTES:raise InputError("Use an original source file up to 256 MiB")
            data=path.read_bytes()
            if p.get("sha256") and source.sha(data)!=p["sha256"]:raise InputError("Source upload changed")
            return self.import_source(data,p.get("name",path.name),p.get("provider","auto"),p.get("kind","auto"),p.get("context"))
        if action=="analysis.preview":return self.preview(p)
        if action=="review.save":return self.review(p,request_id)
        if action=="edition.build":return self.build_review(p["review_id"])
        if action=="edition.compare":return super().compare(p["before_id"],p["after_id"])
        if action=="dataset.query":return self.query(p.get("build_id") or self.meta("active_build"),p.get("query",{}))
        if action=="bills.reconcile":return self.reconcile(p,request_id)
        if action=="capture.start":return self.capture_start(p,request_id)
        if action=="capture.advance":return self.capture_advance(p["capture_id"])
        if action=="capture.pause":return self.capture_pause(p["capture_id"])
        if action=="capture.resume":return self.capture_resume(p["capture_id"])
        if action=="merchant.configure":
            if set(p)!={"payment","origin","path"}:raise InputError("Supply payment terms, public origin and route")
            build=self.build_view(self.meta("active_build"))
            result=self.publisher.call("merchant.validate",{**p,"datasetConfig":str(self._build_path(build["id"],"dataset.json"))})
            self.set_meta("merchant",result);return result
        if action=="package.export":return self.export_customer(p["review_id"],request_id)
        if action=="package.restore":return self.restore_customer(Path(p["path"]),p.get("sha256"))
        if action=="publisher.prepare":
            export=self.verify_export(p["export_id"])
            return self.publisher.call(action,{"exportDirectory":str(self.root/"exports"/export["id"])})
        if action.startswith("publisher."):return self.publisher.call(action,p)
        raise InputError("Unknown utility workspace operation")

    def act(self,action,payload=None,expected_revision=None,request_id=None):
        if not isinstance(action,str) or not isinstance(payload or {},dict):raise InputError("Supply a named operation and object payload")
        request_id=request_id or str(uuid.uuid4())
        try:
            if str(uuid.UUID(request_id))!=request_id:raise ValueError()
        except (ValueError,TypeError,AttributeError) as error:
            raise InputError("Use a canonical operation request UUID") from error
        payload=dict(payload or {})
        if action in {"source.import","package.restore"} and "sha256" not in payload:
            incoming=Path(payload["path"]).expanduser().absolute()
            maximum=source.MAX_BYTES if action=="source.import" else 2*1024*1024*1024
            if incoming.is_symlink() or not incoming.is_file() or incoming.stat().st_size>maximum:
                raise InputError("Use an original file within the receiving capacity")
            h=hashlib.sha256()
            with incoming.open("rb") as stream:
                while block:=stream.read(1048576):h.update(block)
            payload["sha256"]=h.hexdigest()
        fingerprint_payload={k:v for k,v in payload.items() if not (action in {"source.import","package.restore"} and k=="path")}
        fingerprint=source.sha(json_bytes({"action":action,"payload":fingerprint_payload}))
        with self.mutex:
            prior=self.db.execute("SELECT fingerprint,body FROM utility_actions WHERE id=?",(request_id,)).fetchone()
            if prior:
                if prior["fingerprint"]!=fingerprint:raise InputError("This operation ID belongs to different input")
                retained=load_json(prior["body"])
                if retained["status"]=="COMPLETE":return {"result":retained["result"],"state":self.state(),"replayed":True,"received_history":request_id in self.meta("received_action_ids",[])}
                raise InputError("Read this original operation and its saved state before continuing with a new request")
            revision=self.meta("revision",0)
            if expected_revision is not None and (type(expected_revision)is not int or expected_revision!=revision):
                raise InputError("Refresh the original workspace revision before this operation")
            started={"request_id":request_id,"fingerprint":fingerprint,"action":action,"status":"RUNNING","started_at":now(),"revision":revision}
            with self.db:self.db.execute("INSERT INTO utility_actions VALUES(?,?,?)",(request_id,fingerprint,json_bytes(started).decode()))
            try:
                result=self.execute(action,payload,request_id)
                final={**started,"status":"COMPLETE","completed_at":now(),"revision":revision+1,"result":result}
                with self.db:
                    self.db.execute("UPDATE utility_actions SET body=? WHERE id=?",(json_bytes(final).decode(),request_id))
                    self.db.execute("INSERT OR REPLACE INTO utility_meta VALUES(?,?)",("revision",json_bytes(revision+1).decode()))
                return {"result":result,"state":self.state()}
            except Exception as error:
                try:
                    with self.db:
                        self.db.execute("UPDATE utility_actions SET body=? WHERE id=?",(json_bytes({**started,
                            "status":"FAILED","completed_at":now(),"error":str(error)}).decode(),request_id))
                        self.db.execute("INSERT OR REPLACE INTO utility_meta VALUES(?,?)",("revision",json_bytes(revision+1).decode()))
                except Exception:pass
                raise

    def operation(self,request_id):
        row=self.db.execute("SELECT body FROM utility_actions WHERE id=?",(request_id,)).fetchone()
        if row is None:raise InputError("Unknown retained utility operation")
        return load_json(row[0])
