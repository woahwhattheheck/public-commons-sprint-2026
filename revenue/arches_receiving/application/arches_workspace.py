#!/usr/bin/env python3
"""Arches edition review workspace. Original sources remain immutable; staff decisions select releases."""
from __future__ import annotations
import contextlib, datetime, hashlib, json, os, pathlib, shutil, sqlite3, tempfile, uuid, zipfile
from typing import Any
from arches_source import inspect_context, inspect_resource, iter_resources, canonical_json, loads_json
SCHEMA = "commons.arches-review-workspace.v1"
def canonical(value): return canonical_json(value)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def path_id(value): return "".join(chr(b) if (48<=b<=57 or 65<=b<=90 or 97<=b<=122 or b in (45,95)) else "%"+format(b,"02X") for b in str(value).encode("utf8"))
def file_hash(path):
    h=hashlib.sha256(); size=0
    with pathlib.Path(path).open("rb") as f:
        for block in iter(lambda:f.read(1024*1024), b""): h.update(block); size+=len(block)
    return h.hexdigest(),size
class Conflict(ValueError): pass
class Workspace:
    def __init__(self, root):
        self.root=pathlib.Path(root).resolve(); self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.sources=self.root/"sources"; self.sources.mkdir(exist_ok=True,mode=0o700)
        self.db=self.root/"workspace.sqlite3"
        with self.connect() as c:
            c.executescript("""
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,parent_release TEXT,scope_id TEXT NOT NULL,coverage TEXT NOT NULL,context_hash TEXT NOT NULL,manifest TEXT NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS records(snapshot TEXT NOT NULL,graph_id TEXT NOT NULL,resource_id TEXT NOT NULL,record_hash TEXT NOT NULL,record_json TEXT NOT NULL,labels TEXT NOT NULL,issues TEXT NOT NULL,blocking INTEGER NOT NULL,tiles INTEGER NOT NULL,PRIMARY KEY(snapshot,graph_id,resource_id));
            CREATE TABLE IF NOT EXISTS changes(snapshot TEXT NOT NULL,graph_id TEXT NOT NULL,resource_id TEXT NOT NULL,kind TEXT NOT NULL,before_hash TEXT,after_hash TEXT,blocking INTEGER NOT NULL,PRIMARY KEY(snapshot,graph_id,resource_id));
            CREATE TABLE IF NOT EXISTS decisions(snapshot TEXT NOT NULL,graph_id TEXT NOT NULL,resource_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,before_hash TEXT,after_hash TEXT,PRIMARY KEY(snapshot,graph_id,resource_id));
            CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,parent_release TEXT,scope_id TEXT NOT NULL,manifest TEXT NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS release_records(release_id TEXT NOT NULL,graph_id TEXT NOT NULL,resource_id TEXT NOT NULL,record_hash TEXT NOT NULL,record_json TEXT NOT NULL,context_snapshot TEXT NOT NULL,PRIMARY KEY(release_id,graph_id,resource_id));
            CREATE TABLE IF NOT EXISTS review_exchanges(operation_id TEXT PRIMARY KEY,snapshot TEXT NOT NULL,source_manifest TEXT NOT NULL,receipt TEXT NOT NULL,created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS changes_kind ON changes(snapshot,kind,graph_id,resource_id);
            CREATE INDEX IF NOT EXISTS records_hash ON records(snapshot,record_hash);
            """)
            c.execute("INSERT OR IGNORE INTO meta VALUES('schema',?)",(SCHEMA,))
            c.execute("INSERT OR IGNORE INTO meta VALUES('revision','0')")
            c.execute("INSERT OR IGNORE INTO meta VALUES('workspace_id',?)",(str(uuid.uuid4()),))
            if c.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0]!=SCHEMA: raise ValueError("Unsupported workspace schema")
    def connect(self):
        c=sqlite3.connect(self.db,timeout=30); c.row_factory=sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON"); c.execute("PRAGMA journal_mode=WAL"); c.execute("PRAGMA busy_timeout=30000")
        return c
    def status(self):
        with self.connect() as c:
            meta=dict(c.execute("SELECT key,value FROM meta").fetchall())
            return {"schema":SCHEMA,"workspace_id":meta["workspace_id"],"revision":int(meta["revision"]),
                    "snapshots":[dict(x) for x in c.execute("SELECT id,parent_release,scope_id,coverage,context_hash,created,actor FROM snapshots ORDER BY created DESC")],
                    "releases":[dict(x) for x in c.execute("SELECT id,snapshot,parent_release,scope_id,created,actor FROM releases ORDER BY created DESC")]}
    def _validate_actor(self,actor):
        if not isinstance(actor,str) or not actor.strip() or len(actor)>200: raise ValueError("A named staff actor is required")
        return actor.strip()
    @contextlib.contextmanager
    def _mutation(self,operation_id,request,expected_revision):
        if not isinstance(operation_id,str) or not operation_id or len(operation_id)>200: raise ValueError("A stable operation ID is required")
        c=self.connect()
        try:
            c.execute("BEGIN IMMEDIATE")
            prior=c.execute("SELECT * FROM operations WHERE id=?",(operation_id,)).fetchone()
            if prior:
                if prior["request_hash"]!=digest(request): raise Conflict("This operation ID belongs to a different request")
                yield c,json.loads(prior["result"]); c.rollback(); return
            current=int(c.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])
            if expected_revision is None or current!=int(expected_revision): raise Conflict("Workspace changed; reopen the current edition before saving")
            yield c,None
            c.commit()
        except BaseException:
            c.rollback(); raise
        finally: c.close()
    def _finish(self,c,op,request,result,actor,action):
        rev=int(c.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])+1
        result={**result,"revision":rev}
        c.execute("UPDATE meta SET value=? WHERE key='revision'",(str(rev),))
        c.execute("INSERT INTO operations VALUES(?,?,?)",(op,digest(request),canonical(result)))
        c.execute("INSERT INTO audit(at,actor,action,detail) VALUES(?,?,?,?)",(now(),actor,action,canonical(result)))
        return result
    def _retain(self,path,role):
        path=pathlib.Path(path)
        if path.is_symlink() or not path.is_file(): raise ValueError("Source must be an ordinary file")
        sha,size=file_hash(path); dest=self.sources/(sha+".json")
        if dest.exists():
            if file_hash(dest)!=(sha,size): raise ValueError("Retained source identity differs")
        else:
            temp=self.sources/(sha+"."+uuid.uuid4().hex+".part")
            try:
                with path.open("rb") as src,temp.open("xb") as out:
                    shutil.copyfileobj(src,out,1024*1024);out.flush();os.fsync(out.fileno())
                if file_hash(temp)!=(sha,size): raise ValueError("Source changed while receiving")
                os.replace(temp,dest)
            finally:
                if temp.exists(): temp.unlink()
        return {"role":role,"name":path.name,"sha256":sha,"bytes":size,"path":dest.relative_to(self.root).as_posix()}
    def import_candidate(self,*,source_paths,graph_paths,collection_paths,source_format,scope_id,coverage,parent_release=None,license_paths=(),actor,operation_id,expected_revision):
        actor=self._validate_actor(actor)
        if coverage not in ("complete","partial"): raise ValueError("Coverage must be complete or partial")
        if not isinstance(scope_id,str) or not scope_id.strip() or len(scope_id)>240: raise ValueError("An explicit unchanged selection scope is required")
        if source_format not in ("business_data","resource"): raise ValueError("Choose the original source envelope explicitly")
        if not source_paths or not graph_paths: raise ValueError("Resource and graph sources are required")
        sources=[self._retain(p,"resource") for p in source_paths]+[self._retain(p,"graph") for p in graph_paths]+[self._retain(p,"collection") for p in collection_paths]+[self._retain(p,"license") for p in license_paths]
        if len({(s["role"],s["sha256"]) for s in sources})!=len(sources): raise ValueError("Duplicate source files in receiving request")
        request={"action":"import","sources":[dict(s) for s in sources],"source_format":source_format,"scope_id":scope_id,"coverage":coverage,"parent_release":parent_release,"actor":actor}
        # Parsing and context resolution run before the short authoritative commit.
        with self.connect() as priorc:
            prior=priorc.execute("SELECT * FROM operations WHERE id=?",(operation_id,)).fetchone()
            if prior:
                if prior["request_hash"]!=digest(request): raise Conflict("This operation ID belongs to a different import")
                return json.loads(prior["result"])
            if parent_release:
                parent=priorc.execute("SELECT * FROM releases WHERE id=?",(parent_release,)).fetchone()
                if not parent or parent["scope_id"]!=scope_id: raise Conflict("The previous release must use the same explicit selection scope")
        context=inspect_context([self.root/s["path"] for s in sources if s["role"]=="graph"],[self.root/s["path"] for s in sources if s["role"]=="collection"])
        context_hash=digest({"graphs":sorted(s["sha256"] for s in sources if s["role"]=="graph"),"collections":sorted(s["sha256"] for s in sources if s["role"]=="collection")})
        if coverage=="partial" and parent_release:
            with self.connect() as c:
                old_context=c.execute("SELECT s.context_hash FROM releases r JOIN snapshots s ON s.id=r.snapshot WHERE r.id=?",(parent_release,)).fetchone()[0]
                if old_context!=context_hash:raise Conflict("Changed graph or vocabulary meanings require complete selection receiving")
        sid="edition-"+uuid.uuid4().hex
        temp_path=self.root/("receiving-"+uuid.uuid4().hex+".sqlite3")
        stage=sqlite3.connect(temp_path)
        try:
            stage.execute("CREATE TABLE incoming(graph_id TEXT,resource_id TEXT,record_hash TEXT,record_json TEXT,labels TEXT,issues TEXT,blocking INTEGER,tiles INTEGER,PRIMARY KEY(graph_id,resource_id))")
            count=0
            for source in (s for s in sources if s["role"]=="resource"):
                with iter_resources(self.root/source["path"],source_format=source_format) as stream:
                    for record in stream:
                        item=inspect_resource(record,context)
                        if not item.get("resource_id") or not item.get("graph_id"): raise ValueError("A resource lacks the stable graph/resource identity required for indexed receiving")
                        try:
                            stage.execute("INSERT INTO incoming VALUES(?,?,?,?,?,?,?,?)",(item["graph_id"],item["resource_id"],item["resource_sha256"],canonical(record),canonical(item.get("labels",{})),canonical(item.get("issues",[])),int(bool(item.get("blocking"))),int(item.get("tiles_count",0))))
                        except sqlite3.IntegrityError: raise ValueError("Duplicate graph/resource identity in the selected original sources")
                        count+=1
                        if count%1000==0:stage.commit()
                if stream.receipt is None:raise ValueError("Original source did not finish receiving")
                source["receipt"]=stream.receipt
            stage.commit();stage.close();stage=None
            if count==0: raise ValueError("The original source contains no resources; an empty replacement requires an explicit new source contract")
            manifest={"schema":"commons.arches-source-edition.v1","source_format":source_format,"sources":sources,"source_resources":count,"scope_id":scope_id,"coverage":coverage,"context_hash":context_hash,"adapter_context_digest":context.get("digest"),"adapter_source_manifest":[{k:v for k,v in item.items() if k not in ("path","original_path")} for item in context.get("source_manifest",[])]}
            with self._mutation(operation_id,request,expected_revision) as (c,prior):
                if prior:return prior
                if parent_release and not c.execute("SELECT 1 FROM releases WHERE id=? AND scope_id=?",(parent_release,scope_id)).fetchone():raise Conflict("Previous release disappeared")
                c.execute("ATTACH DATABASE ? AS incoming",(str(temp_path),))
                c.execute("INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?)",(sid,parent_release,scope_id,coverage,context_hash,canonical(manifest),now(),actor))
                # A partial selection retains every previously released resource outside the supplied selection.
                if coverage=="partial" and parent_release:
                    c.execute("""INSERT INTO records SELECT ?,r.graph_id,r.resource_id,r.record_hash,r.record_json,'{}','[]',0,0 FROM release_records r WHERE release_id=?""",(sid,parent_release))
                c.execute("INSERT OR REPLACE INTO records SELECT ?,graph_id,resource_id,record_hash,record_json,labels,issues,blocking,tiles FROM incoming.incoming",(sid,))
                c.execute("""INSERT INTO changes SELECT ?,n.graph_id,n.resource_id,CASE WHEN b.resource_id IS NULL THEN 'added' ELSE 'changed' END,b.record_hash,n.record_hash,n.blocking
                    FROM records n LEFT JOIN release_records b ON b.release_id=? AND b.graph_id=n.graph_id AND b.resource_id=n.resource_id
                    WHERE n.snapshot=? AND (b.resource_id IS NULL OR b.record_hash<>n.record_hash)""",(sid,parent_release,sid))
                if coverage=="complete" and parent_release:
                    c.execute("""INSERT INTO changes SELECT ?,b.graph_id,b.resource_id,'removed',b.record_hash,NULL,0 FROM release_records b
                        LEFT JOIN records n ON n.snapshot=? AND n.graph_id=b.graph_id AND n.resource_id=b.resource_id
                        WHERE b.release_id=? AND n.resource_id IS NULL""",(sid,sid,parent_release))
                # Meaning changes remain reviewable even if resource JSON is byte-equivalent.
                if parent_release:
                    parent=c.execute("SELECT s.context_hash FROM releases r JOIN snapshots s ON s.id=r.snapshot WHERE r.id=?",(parent_release,)).fetchone()
                    if parent and parent[0]!=context_hash:
                        c.execute("""INSERT OR IGNORE INTO changes SELECT ?,n.graph_id,n.resource_id,'meaning',b.record_hash,n.record_hash,n.blocking FROM records n JOIN release_records b
                            ON b.release_id=? AND b.graph_id=n.graph_id AND b.resource_id=n.resource_id WHERE n.snapshot=?""",(sid,parent_release,sid))
                counts=dict(c.execute("SELECT kind,COUNT(*) FROM changes WHERE snapshot=? GROUP BY kind",(sid,)).fetchall())
                result=self._finish(c,operation_id,request,{"snapshot":sid,"source_resources":count,"resources":c.execute("SELECT COUNT(*) FROM records WHERE snapshot=?",(sid,)).fetchone()[0],"changes":counts,"context_hash":context_hash},actor,"received")
            return result
        finally:
            if stage:stage.close()
            if temp_path.exists():temp_path.unlink()
    def edition(self,snapshot):
        with self.connect() as c:
            row=c.execute("SELECT * FROM snapshots WHERE id=?",(snapshot,)).fetchone()
            if not row:raise KeyError("Unknown edition")
            out=dict(row);out["manifest"]=json.loads(out["manifest"])
            out["counts"]=dict(c.execute("SELECT kind,COUNT(*) FROM changes WHERE snapshot=? GROUP BY kind",(snapshot,)).fetchall())
            out["resources"]=c.execute("SELECT COUNT(*) FROM records WHERE snapshot=?",(snapshot,)).fetchone()[0]
            out["decided"]=c.execute("SELECT COUNT(*) FROM decisions WHERE snapshot=?",(snapshot,)).fetchone()[0]
            out["blocking"]=c.execute("SELECT COUNT(*) FROM records WHERE snapshot=? AND blocking=1",(snapshot,)).fetchone()[0]
            return out
    def changes(self,snapshot,offset=0,limit=100,kind=None):
        limit=max(1,min(500,int(limit)));offset=max(0,int(offset))
        sql="""SELECT ch.*,d.decision,d.reason,d.actor,d.at,r.labels,r.issues FROM changes ch LEFT JOIN decisions d ON d.snapshot=ch.snapshot AND d.graph_id=ch.graph_id AND d.resource_id=ch.resource_id LEFT JOIN records r ON r.snapshot=ch.snapshot AND r.graph_id=ch.graph_id AND r.resource_id=ch.resource_id WHERE ch.snapshot=?"""
        args=[snapshot]
        if kind:
            if kind not in ("added","changed","removed","meaning"):raise ValueError("Unknown change kind")
            sql+=" AND ch.kind=?";args.append(kind)
        with self.connect() as c:
            total=c.execute("SELECT COUNT(*) FROM changes WHERE snapshot=?"+(" AND kind=?" if kind else ""),(snapshot,kind) if kind else (snapshot,)).fetchone()[0]
            rows=[dict(r) for r in c.execute(sql+" ORDER BY ch.graph_id,ch.resource_id LIMIT ? OFFSET ?",args+[limit,offset])]
        for r in rows:
            r["labels"]=json.loads(r["labels"] or "{}");r["issues"]=json.loads(r["issues"] or "[]")
        return {"rows":rows,"total":total,"offset":offset,"limit":limit,"next_offset":offset+len(rows) if offset+len(rows)<total else None}
    def resource(self,snapshot,graph_id,resource_id):
        with self.connect() as c:
            candidate=c.execute("SELECT * FROM records WHERE snapshot=? AND graph_id=? AND resource_id=?",(snapshot,graph_id,resource_id)).fetchone()
            parent=c.execute("SELECT parent_release FROM snapshots WHERE id=?",(snapshot,)).fetchone()
            if not parent:raise KeyError("Unknown edition")
            old=c.execute("SELECT * FROM release_records WHERE release_id=? AND graph_id=? AND resource_id=?",(parent[0],graph_id,resource_id)).fetchone() if parent[0] else None
            decision=c.execute("SELECT * FROM decisions WHERE snapshot=? AND graph_id=? AND resource_id=?",(snapshot,graph_id,resource_id)).fetchone()
            return {"graph_id":graph_id,"resource_id":resource_id,"before":loads_json(old["record_json"]) if old else None,"candidate":loads_json(candidate["record_json"]) if candidate else None,"issues":json.loads(candidate["issues"]) if candidate else [],"decision":dict(decision) if decision else None}
    def decide(self,*,snapshot,items,actor,operation_id,expected_revision):
        actor=self._validate_actor(actor)
        if not isinstance(items,list) or not items or len(items)>500:raise ValueError("Select one to 500 explicit changed resources")
        if len({(x.get("graph_id"),x.get("resource_id")) for x in items})!=len(items):raise ValueError("Duplicate decision identity")
        request={"action":"decide","snapshot":snapshot,"items":items,"actor":actor}
        with self._mutation(operation_id,request,expected_revision) as (c,prior):
            if prior:return prior
            if c.execute("SELECT 1 FROM releases WHERE snapshot=?",(snapshot,)).fetchone():raise Conflict("A released edition cannot be edited; receive the next edition")
            for x in items:
                if x.get("decision") not in ("approve","reject","defer"):raise ValueError("Decision must approve, reject or defer")
                if not isinstance(x.get("reason"),str) or not x["reason"].strip() or len(x["reason"])>4000:raise ValueError("A specific staff reason is required")
                change=c.execute("SELECT * FROM changes WHERE snapshot=? AND graph_id=? AND resource_id=?",(snapshot,x["graph_id"],x["resource_id"])).fetchone()
                if not change:raise Conflict("Decision does not name an actual change")
                if x.get("before_hash")!=change["before_hash"] or x.get("after_hash")!=change["after_hash"]:raise Conflict("The reviewed resource edition differs")
                if x["decision"]=="approve" and change["blocking"]:raise Conflict("Resolve the original resource contract issue in a new source edition, or reject this change")
                c.execute("INSERT OR REPLACE INTO decisions VALUES(?,?,?,?,?,?,?,?,?)",(snapshot,x["graph_id"],x["resource_id"],x["decision"],x["reason"].strip(),actor,now(),change["before_hash"],change["after_hash"]))
            return self._finish(c,operation_id,request,{"snapshot":snapshot,"decisions_saved":len(items)},actor,"reviewed")
    def release(self,*,snapshot,actor,operation_id,expected_revision):
        actor=self._validate_actor(actor);request={"action":"release","snapshot":snapshot,"actor":actor}
        with self._mutation(operation_id,request,expected_revision) as (c,prior):
            if prior:return prior
            snap=c.execute("SELECT * FROM snapshots WHERE id=?",(snapshot,)).fetchone()
            if not snap:raise KeyError("Unknown edition")
            if c.execute("SELECT 1 FROM releases WHERE snapshot=?",(snapshot,)).fetchone():raise Conflict("This edition already has a release")
            remaining=c.execute("""SELECT COUNT(*) FROM changes ch LEFT JOIN decisions d ON d.snapshot=ch.snapshot AND d.graph_id=ch.graph_id AND d.resource_id=ch.resource_id WHERE ch.snapshot=? AND (d.decision IS NULL OR d.decision='defer')""",(snapshot,)).fetchone()[0]
            if remaining:raise Conflict(str(remaining)+" changes still need an approval or rejection")
            latest=c.execute("SELECT id FROM releases WHERE scope_id=? ORDER BY created DESC,rowid DESC LIMIT 1",(snap["scope_id"],)).fetchone()
            if (latest[0] if latest else None)!=snap["parent_release"]:raise Conflict("A newer release exists for this selection; receive against it before publishing")
            rid="release-"+uuid.uuid4().hex
            manifest={"schema":"commons.arches-reviewed-release.v1","snapshot":snapshot,"scope_id":snap["scope_id"],"coverage":snap["coverage"],"context_hash":snap["context_hash"],"parent_release":snap["parent_release"]}
            c.execute("INSERT INTO releases VALUES(?,?,?,?,?,?,?)",(rid,snapshot,snap["parent_release"],snap["scope_id"],canonical(manifest),now(),actor))
            if snap["parent_release"]:
                c.execute("INSERT INTO release_records SELECT ?,graph_id,resource_id,record_hash,record_json,context_snapshot FROM release_records WHERE release_id=?",(rid,snap["parent_release"]))
            for change in c.execute("""SELECT ch.*,d.decision FROM changes ch JOIN decisions d ON d.snapshot=ch.snapshot AND d.graph_id=ch.graph_id AND d.resource_id=ch.resource_id WHERE ch.snapshot=?""",(snapshot,)):
                if change["decision"]!="approve":continue
                identity=(rid,change["graph_id"],change["resource_id"])
                if change["kind"]=="removed":c.execute("DELETE FROM release_records WHERE release_id=? AND graph_id=? AND resource_id=?",identity)
                else:c.execute("INSERT OR REPLACE INTO release_records SELECT ?,graph_id,resource_id,record_hash,record_json,snapshot FROM records WHERE snapshot=? AND graph_id=? AND resource_id=?",(rid,snapshot,change["graph_id"],change["resource_id"]))
            count=c.execute("SELECT COUNT(*) FROM release_records WHERE release_id=?",(rid,)).fetchone()[0]
            return self._finish(c,operation_id,request,{"release":rid,"snapshot":snapshot,"resources":count,"context_hash":snap["context_hash"]},actor,"released")
    def export_release(self,release_id,destination):
        destination=pathlib.Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as c:
            row=c.execute("SELECT * FROM releases WHERE id=?",(release_id,)).fetchone()
            if not row:raise KeyError("Unknown release")
            snap=c.execute("SELECT * FROM snapshots WHERE id=?",(row["snapshot"],)).fetchone()
            source_manifest=json.loads(snap["manifest"])
            with zipfile.ZipFile(destination,"w",compression=zipfile.ZIP_DEFLATED) as z:
                members=[]
                def put(name,data):
                    b=data.encode() if isinstance(data,str) else data
                    z.writestr(name,b);members.append({"path":name,"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()})
                # Resources remain original wrappers. Static publisher-compatible files are independent of the review UI.
                for r in c.execute("SELECT * FROM release_records WHERE release_id=? ORDER BY graph_id,resource_id",(release_id,)):
                    put("resources/"+path_id(r["graph_id"])+"/"+path_id(r["resource_id"])+".json",r["record_json"]+"\n")
                    members[-1].update(context_snapshot=r["context_snapshot"],graph_id=r["graph_id"],resource_id=r["resource_id"])
                # The original StaticFile receiver consumes business_data.resources.
                # Group by retained meaning context; rejected records can keep older graph/vocabulary editions.
                downstream=[]
                for (context_snapshot,) in c.execute("SELECT DISTINCT context_snapshot FROM release_records WHERE release_id=? ORDER BY context_snapshot",(release_id,)):
                    name="business_data/"+path_id(context_snapshot)+".json"
                    sha=hashlib.sha256();size=0;count=0
                    with z.open(name,"w",force_zip64=True) as out:
                        def emit(data):
                            nonlocal size
                            out.write(data);sha.update(data);size+=len(data)
                        emit(b'{"business_data":{"resources":[')
                        for item in c.execute("SELECT record_json FROM release_records WHERE release_id=? AND context_snapshot=? ORDER BY graph_id,resource_id",(release_id,context_snapshot)):
                            if count:emit(b",")
                            emit(item["record_json"].encode("utf8"));count+=1
                        emit(b']}}\n')
                    member={"path":name,"bytes":size,"sha256":sha.hexdigest(),"context_snapshot":context_snapshot,"source_format":"business_data","resources":count}
                    members.append(member);downstream.append(dict(member))
                contexts={}
                context_sources={}
                for (context_snapshot,) in c.execute("SELECT DISTINCT context_snapshot FROM release_records WHERE release_id=?",(release_id,)):
                    original=json.loads(c.execute("SELECT manifest FROM snapshots WHERE id=?",(context_snapshot,)).fetchone()[0])
                    contexts[context_snapshot]={"context_hash":original["context_hash"],"sources":[s for s in original["sources"] if s["role"] in ("graph","collection","license")]}
                    for s in contexts[context_snapshot]["sources"]:context_sources[s["sha256"]]=s
                for s in context_sources.values():
                    p=self.root/s["path"]
                    if file_hash(p)!=(s["sha256"],s["bytes"]):raise ValueError("Original context source differs")
                    put("context/"+s["sha256"]+".json",p.read_bytes())
                put("contexts.json",canonical(contexts)+"\n")
                put("downstream.json",canonical({"schema":"commons.arches-static-file-delivery.v1","release_id":release_id,"source_format":"business_data","selection":"accepted release records grouped by their selected original meaning context","files":downstream,"contexts":"contexts.json","resource_wrappers":"resources/"})+"\n")
                # Stream the complete decision history rather than materializing every row.
                review_sha=hashlib.sha256();review_size=0
                with z.open("review.json","w",force_zip64=True) as review:
                    def write_review(data):
                        nonlocal review_size
                        review.write(data);review_sha.update(data);review_size+=len(data)
                    write_review(('{"release":'+canonical(dict(row))+',"edition":'+canonical(source_manifest)+',"decisions":[').encode())
                    first=True
                    for decision in c.execute("SELECT * FROM decisions WHERE snapshot=? ORDER BY graph_id,resource_id",(row["snapshot"],)):
                        write_review((("" if first else ",")+canonical(dict(decision))).encode());first=False
                    write_review(b"]}\n")
                members.append({"path":"review.json","bytes":review_size,"sha256":review_sha.hexdigest()})
                exchanges=[]
                for exchange in c.execute("SELECT * FROM review_exchanges WHERE snapshot=? ORDER BY created,operation_id",(row["snapshot"],)):
                    source=json.loads(exchange["source_manifest"]);p=self.root/source["path"]
                    if file_hash(p)!=(source["sha256"],source["bytes"]):raise ValueError("Original staff review file differs")
                    name="staff-review/"+source["sha256"]+".csv"
                    if not any(member["path"]==name for member in members):
                        z.write(p,name);members.append({"path":name,"bytes":source["bytes"],"sha256":source["sha256"]})
                    exchanges.append({"operation_id":exchange["operation_id"],"source":source,"archive_path":name,"preview":json.loads(exchange["receipt"]),"created":exchange["created"]})
                put("review-exchanges.json",canonical({"schema":"commons.arches-review-exchanges.v1","exchanges":exchanges})+"\n")
                put("README.txt","Reviewed Arches release. resources/<graph>/<resource>.json contains the selected original resource wrappers for direct HTTP/static receiving. business_data/<context>.json contains the same accepted original wrappers in the business_data.resources envelope used by the original StaticFile receiver. downstream.json maps each complete streamed file to its exact selected meaning context. Load its graph and controlled-vocabulary files from contexts.json; keep groups separate when their meaning editions differ. review.json retains the original incoming edition and staff decisions. Original identifiers, numeric values, language keys and selected contexts are preserved.\n")
                put("MANIFEST.json",canonical({"schema":"commons.arches-release-package.v1","release_id":release_id,"members":members})+"\n")
        sha,size=file_hash(destination);return {"path":str(destination),"sha256":sha,"bytes":size,"release":release_id}
    def export_workspace(self,destination,application_paths=()):
        destination=pathlib.Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="arches-export-",dir=self.root) as temp:
            temp=pathlib.Path(temp);backup=temp/"workspace.sqlite3"
            with self.connect() as src,sqlite3.connect(backup) as dst:src.backup(dst)
            with zipfile.ZipFile(destination,"w",compression=zipfile.ZIP_DEFLATED) as z:
                members=[]
                def add(path,name):
                    sha,size=file_hash(path);z.write(path,name);members.append({"path":name,"bytes":size,"sha256":sha})
                add(backup,"workspace/workspace.sqlite3")
                with sqlite3.connect(backup) as c:
                    referenced={}
                    for (raw,) in c.execute("SELECT manifest FROM snapshots"):
                        for source in json.loads(raw)["sources"]:referenced[source["path"]]=source
                    for (raw,) in c.execute("SELECT source_manifest FROM review_exchanges"):
                        source=json.loads(raw);referenced[source["path"]]=source
                    for rel,source in sorted(referenced.items()):
                        p=self.root/rel
                        if file_hash(p)!=(source["sha256"],source["bytes"]):raise ValueError("Original retained source differs")
                        add(p,"workspace/"+rel)
                for p in application_paths:
                    p=pathlib.Path(p)
                    if p.is_file() and not p.is_symlink():add(p,"application/"+p.name)
                data=canonical({"schema":"commons.arches-workspace-package.v1","members":members})+"\n"
                z.writestr("MANIFEST.json",data)
        sha,size=file_hash(destination);return {"path":str(destination),"sha256":sha,"bytes":size,"workspace":self.status()["workspace_id"]}
    @staticmethod
    def restore(archive,destination):
        destination=pathlib.Path(destination)
        if destination.exists() and any(destination.iterdir()):raise Conflict("Receiving directory must be empty")
        destination.mkdir(parents=True,exist_ok=True,mode=0o700)
        with zipfile.ZipFile(archive) as z:
            names=z.namelist()
            if len(names)!=len(set(names)):raise ValueError("Duplicate archive member")
            manifest=json.loads(z.read("MANIFEST.json"))
            if manifest.get("schema")!="commons.arches-workspace-package.v1":raise ValueError("Unsupported workspace package")
            expected={x["path"]:x for x in manifest["members"]}
            if set(names)!=set(expected)|{"MANIFEST.json"}:raise ValueError("Archive membership differs")
            if sum(x["bytes"] for x in expected.values())>20*1024**3:raise ValueError("Receiving package exceeds the declared 20 GiB envelope")
            for name,m in expected.items():
                rel=pathlib.PurePosixPath(name)
                if rel.is_absolute() or ".." in rel.parts or (z.getinfo(name).external_attr>>16)&0o170000==0o120000:raise ValueError("Unsafe archive member")
                target=destination/rel;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                h=hashlib.sha256();n=0
                with z.open(name) as src,target.open("xb") as out:
                    for chunk in iter(lambda:src.read(1024*1024),b""):
                        n+=len(chunk)
                        if n>m["bytes"]:raise ValueError("Archive member length differs")
                        h.update(chunk);out.write(chunk)
                    out.flush();os.fsync(out.fileno())
                if n!=m["bytes"] or h.hexdigest()!=m["sha256"]:raise ValueError("Archive member identity differs")
        received=Workspace(destination/"workspace")
        with received.connect() as c:
            if c.execute("PRAGMA integrity_check").fetchone()[0]!="ok":raise ValueError("Received database is incomplete")
            for (raw,) in c.execute("SELECT manifest FROM snapshots"):
                for source in json.loads(raw)["sources"]:
                    if file_hash(received.root/source["path"])!=(source["sha256"],source["bytes"]):raise ValueError("Received original source differs")
            for (raw,) in c.execute("SELECT source_manifest FROM review_exchanges"):
                source=json.loads(raw)
                if file_hash(received.root/source["path"])!=(source["sha256"],source["bytes"]):raise ValueError("Received staff review source differs")
        return {"workspace":received.status(),"root":str(received.root),"application":str(destination/"application")}
