"""Persistent HDF5 sources, exact selections, native result editions and receiving."""
from __future__ import annotations
import contextlib, csv, fcntl, hashlib, io, json, os, signal, sqlite3, stat, subprocess, sys, tempfile, threading, time, uuid, zipfile
from pathlib import Path
from core import *

class Workspace:
    def __init__(self, root, create=False):
        self.root=directory(root,create=create)
        self.lock=os.open(self.root/".workspace.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        try: fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:
            os.close(self.lock); raise InputError("This workspace is already open; use its existing operator", "HDF5_WORKSPACE_OPEN",409)
        self.db=None; self.closed=False; self.mutex=threading.RLock(); self.operation_locks={}; self.children={}; self.worker_slot=threading.Semaphore(1)
        try:
            if create: immutable(self.root/"workspace.json",encode({"schema":SCHEMA}))
            if parse(read(self.root/"workspace.json",4096))!={"schema":SCHEMA}: raise InputError("Unsupported HDF5 workspace")
            for name in ("objects","selections","editions","operations","deliveries","intake"):
                directory(self.root/name,create=True)
            db_path=self.root/"workspace.sqlite"
            if db_path.is_symlink(): raise InputError("Workspace database may not be an alias")
            self.db=sqlite3.connect(db_path,check_same_thread=False,timeout=10)
            os.chmod(db_path,0o600); self.db.row_factory=sqlite3.Row
            self.db.executescript("""
                PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,label TEXT NOT NULL,head TEXT,created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),body TEXT NOT NULL,created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS selections(id TEXT PRIMARY KEY,source_version TEXT NOT NULL REFERENCES versions(id),body TEXT NOT NULL,created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,source_version TEXT NOT NULL REFERENCES versions(id),selection_id TEXT NOT NULL REFERENCES selections(id),body TEXT NOT NULL,created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,action TEXT NOT NULL,request TEXT NOT NULL,request_sha TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,edition TEXT NOT NULL REFERENCES editions(id),body TEXT NOT NULL,created REAL NOT NULL);
            """)
            with self.db:
                self.db.execute("UPDATE operations SET state='interrupted',updated=? WHERE state IN ('running','queued','committing')",(time.time(),))
        except Exception:
            if self.db:self.db.close()
            os.close(self.lock); raise

    def close(self):
        with self.mutex:
            if self.closed:return
            self.closed=True
            children=list(self.children.values())
        for child in children:
            if child.poll() is None: child.terminate()
        for child in children:
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired: child.kill(); child.wait()
        with self.mutex:
            self.db.close(); os.close(self.lock)

    def state(self,offset=0,limit=50):
        offset=integer(offset);limit=integer(limit,1,200)
        with self.mutex:
            counts={name:self.db.execute("SELECT COUNT(*) FROM "+name).fetchone()[0] for name in ("sources","versions","selections","editions","operations","deliveries")}
            return {"schema":SCHEMA,"counts":counts,
                    "sources":[dict(row) for row in self.db.execute("SELECT * FROM sources ORDER BY created,id LIMIT ? OFFSET ?",(limit,offset))],
                    "next":str(offset+limit) if offset+limit<counts["sources"] else None,
                    "limits":{"sourceBytes":MAX_SOURCE,"elements":MAX_ELEMENTS,"serializedResultBytes":MAX_OUTPUT,"nativeSeconds":120},
                    "engine":"native h5py; external and virtual value dependencies require a separately bound source workflow"}

    def list_records(self,kind,offset=0,limit=50,source=None):
        if kind not in ("versions","selections","editions","operations","deliveries"):raise InputError("Unknown record collection")
        offset=integer(offset);limit=integer(limit,1,200)
        with self.mutex:
            clause=" WHERE source_id=?" if source is not None and kind=="versions" else ""
            args=(identifier(source),) if clause else ()
            order="updated,id" if kind=="operations" else "created,id"
            rows=self.db.execute("SELECT * FROM "+kind+clause+" ORDER BY "+order+" LIMIT ? OFFSET ?",args+(limit+1,offset)).fetchall()
            items=[]
            for row in rows[:limit]:
                value=dict(row)
                for field in ("body","request","result","error"):
                    if value.get(field) is not None:value[field]=parse(value[field])
                items.append(value)
            return {"items":items,"next":str(offset+limit) if len(rows)>limit else None}

    def source(self,source):
        with self.mutex:
            row=self.db.execute("SELECT * FROM sources WHERE id=?",(identifier(source),)).fetchone()
            if row is None:raise InputError("Unknown retained source",status=404)
            return dict(row)

    def version(self,ident):
        with self.mutex:
            row=self.db.execute("SELECT body FROM versions WHERE id=?",(hash_id(ident),)).fetchone()
            if row is None:raise InputError("Unknown source version",status=404)
            body=parse(row[0]); path=self.root/"objects"/(body["file"]["sha256"]+".h5")
            if file_hash(path)!=body["file"]:raise InputError("Retained HDF5 bytes changed","HDF5_SOURCE_CHANGED",409)
            return body,path

    def selection(self,ident):
        with self.mutex:
            row=self.db.execute("SELECT body FROM selections WHERE id=?",(hash_id(ident),)).fetchone()
            if row is None:raise InputError("Unknown saved selection",status=404)
            body=parse(row[0])
            if read(self.root/"selections"/(ident+".json"))!=encode(body):raise InputError("Saved selection bytes changed","HDF5_SELECTION_CHANGED",409)
            return body

    def operation(self,ident):
        with self.mutex:
            row=self.db.execute("SELECT * FROM operations WHERE id=?",(identifier(ident),)).fetchone()
            if row is None:raise InputError("Unknown original operation",status=404)
            value=dict(row)
            for field in ("request","result","error"):
                if value[field] is not None:value[field]=parse(value[field])
            marker=self.root/"operations"/ident/"commit-started.json"
            value["commitStarted"]=False
            if marker.exists():
                expected={"schema":"stellar-forge.hdf5-commit-started.v1","operationId":ident,"requestSha256":value["request_sha"]}
                if parse(read(marker,4096))!=expected:raise InputError("Original operation commit binding changed","HDF5_OPERATION_CHANGED",409)
                value["commitStarted"]=True
            return value

    @contextlib.contextmanager
    def operation_scope(self,ident,action,request):
        identifier(ident)
        with self.mutex:lock=self.operation_locks.setdefault(ident,threading.Lock())
        if not lock.acquire(blocking=False):raise InputError("The same original operation is still running","HDF5_OPERATION_RUNNING",409)
        try:
            root=directory(self.root/"operations"/ident,create=True)
            bound={"action":action,"request":request}; request_sha=fingerprint(bound)
            immutable(root/"request.json",encode(bound))
            with self.mutex:
                row=self.db.execute("SELECT request_sha,state,result FROM operations WHERE id=?",(ident,)).fetchone()
                if row and row["request_sha"]!=request_sha:raise InputError("Operation ID belongs to another exact request","HDF5_OPERATION_CHANGED",409)
                if row and row["state"]=="completed":
                    yield {"reuse":parse(row["result"]),"root":root};return
                with self.db:
                    self.db.execute("INSERT INTO operations VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state='queued',error=NULL,updated=excluded.updated",
                                    (ident,action,encode(request).decode(),request_sha,"queued",None,None,time.time()))
            try:yield {"root":root,"reuse":None}
            except BaseException as exc:
                with self.mutex,self.db:
                    self.db.execute("UPDATE operations SET state=?,error=?,updated=? WHERE id=?",
                                    ("cancelled" if getattr(exc,"code","")=="HDF5_CANCELLED" else "interrupted",
                                     encode({"code":getattr(exc,"code","HDF5_OPERATION_ERROR"),"message":str(exc)[:2000]}).decode(),time.time(),ident))
                raise
        finally:lock.release()

    def start_commit(self,ident):
        """The last cancellation boundary. Adoption after this point is reconciled, never called cancelled."""
        with self.mutex,self.db:
            original=self.operation(ident)
            if original["state"]=="cancelled" and not original["commitStarted"]:
                raise InputError("Original operation cancelled before adoption","HDF5_CANCELLED",409)
            immutable(self.root/"operations"/ident/"commit-started.json",
                      encode({"schema":"stellar-forge.hdf5-commit-started.v1","operationId":ident,"requestSha256":original["request_sha"]}))
            self.db.execute("UPDATE operations SET state='committing',updated=? WHERE id=?",(time.time(),ident))

    def complete(self,ident,result,transaction=False):
        immutable(self.root/"operations"/ident/"result.json",encode(result))
        with self.mutex:
            def update():
                self.db.execute("UPDATE operations SET state='completed',result=?,error=NULL,updated=? WHERE id=?",
                                (encode(result).decode(),time.time(),ident))
            if transaction:update()
            else:
                with self.db:update()
        return result

    def native(self,source,action,payload,*,target=None,operation=None):
        request={"source":str(source),"action":action,"payload":payload}
        if target is not None:request["target"]=str(target)
        with self.worker_slot:
            with self.mutex:
                if self.closed:raise InputError("Workspace is closing","HDF5_CLOSING",409)
                if operation:
                    state=self.operation(operation)["state"]
                    if state=="cancelled":raise InputError("Original operation was cancelled","HDF5_CANCELLED",409)
                    with self.db:self.db.execute("UPDATE operations SET state='running',updated=? WHERE id=?",(time.time(),operation))
            environment=dict(os.environ);environment.update(OPENBLAS_NUM_THREADS="1",OMP_NUM_THREADS="1",MKL_NUM_THREADS="1",HDF5_PLUGIN_PRELOAD="::",PYTHONDONTWRITEBYTECODE="1")
            environment["HDF5_WORKBENCH_PARENT_PID"]=str(os.getpid())
            child=subprocess.Popen([sys.executable,"-B",str(Path(__file__).with_name("native.py"))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                                   env=environment)
            key=operation or str(uuid.uuid4())
            with self.mutex:
                self.children[key]=child
                if self.closed or operation and self.operation(operation)["state"]=="cancelled":
                    try:child.terminate()
                    except ProcessLookupError:pass
            try:
                try:stdout,stderr=child.communicate(encode(request),timeout=120)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    try:stdout,stderr=child.communicate(timeout=5)
                    except subprocess.TimeoutExpired:child.kill();stdout,stderr=child.communicate()
                    raise InputError("Native HDF5 work exceeded its 120-second limit","HDF5_NATIVE_TIMEOUT",408)
                if len(stdout)>MAX_JSON or len(stderr)>1048576:raise InputError("Native output exceeded the response limit")
                with self.mutex:
                    if operation and self.operation(operation)["state"]=="cancelled":raise InputError("Original operation cancelled","HDF5_CANCELLED",409)
                try:response=parse(stdout)
                except InputError:raise InputError("Native HDF5 process ended without a complete response (exit "+str(child.returncode)+")","HDF5_NATIVE_INTERRUPTED",422)
                if child.returncode or "error" in response:raise InputError(response.get("message","Native HDF5 request failed"),response.get("error","HDF5_NATIVE_ERROR"),response.get("status",422))
                return response["result"]
            finally:
                if child.poll() is None:child.kill();child.wait()
                with self.mutex:self.children.pop(key,None)

    def cancel(self,operation):
        with self.mutex:
            current=self.operation(operation)
            if current["commitStarted"] or current["state"] in ("completed","cancelled","committing"):return current
            with self.db:self.db.execute("UPDATE operations SET state='cancelled',updated=? WHERE id=?",(time.time(),operation))
            child=self.children.get(operation)
            if child is not None and child.poll() is None:child.terminate()
            return self.operation(operation)

    def import_source(self,operation,source_id,path,label,expected_head=None,origin=None):
        source_id=identifier(source_id)
        if not isinstance(label,str) or not label.strip() or len(label)>160:raise InputError("Source label must be 1–160 characters")
        if origin is None:origin={}
        only(origin,["url","description","name"])
        if any(not isinstance(value,str) or len(value)>4000 for value in origin.values()):raise InputError("Source provenance must be bounded text")
        original=Path(path).expanduser().absolute()
        request={"sourceId":source_id,"path":str(original),"label":label,"expectedHead":expected_head,"origin":origin}
        with self.operation_scope(operation,"source.import",request) as op:
            if op["reuse"] is not None:return op["reuse"]
            capture=op["root"]/"capture.json"
            if capture.exists():
                captured=parse(read(capture)); retained=self.root/"objects"/(captured["file"]["sha256"]+".h5")
                if file_hash(retained)!=captured["file"]:raise InputError("Original captured bytes changed")
            else:
                staging=op["root"]/"original-source.h5"
                info=file_hash(staging) if staging.exists() else copied(original,staging)
                immutable(op["root"]/"original-source-identity.json",encode(info))
                if info["bytes"]<8:raise InputError("Empty or incomplete HDF5 source")
                inventory=self.native(staging,"inspect",{"path":"/","limit":50},operation=operation)
                retained=self.root/"objects"/(info["sha256"]+".h5");copied(staging,retained,info)
                captured={"file":info,"inventory":inventory};immutable(capture,encode(captured))
                staging.unlink();sync_dir(staging.parent)
            body={"schema":SOURCE,"sourceId":source_id,"file":captured["file"],"origin":origin,"previous":expected_head}
            version=fingerprint(body);body={"id":version,**body}
            self.start_commit(operation)
            with self.mutex,self.db:
                previous=self.db.execute("SELECT head FROM sources WHERE id=?",(source_id,)).fetchone()
                actual=previous["head"] if previous else None
                if actual not in (expected_head,version):raise InputError("Source head changed; review the current original source before updating","HDF5_SOURCE_HEAD_CHANGED",409)
                if previous is None:self.db.execute("INSERT INTO sources VALUES(?,?,?,?)",(source_id,label,version,time.time()))
                self.db.execute("INSERT OR IGNORE INTO versions VALUES(?,?,?,?)",(version,source_id,encode(body).decode(),time.time()))
                self.db.execute("UPDATE sources SET label=?,head=? WHERE id=?",(label,version,source_id))
                return self.complete(operation,{"source":{"id":source_id,"label":label,"head":version},"version":body,
                                                "inventory":captured["inventory"]},transaction=True)

    def inspect(self,version,path="/",offset=0,limit=50):
        body,source=self.version(version)
        result=self.native(source,"inspect",{"path":path,"offset":offset,"limit":limit})
        return {"sourceVersion":version,"source":body["file"],**result}

    def attributes(self,version,path="/",offset=0,limit=50,name=None):
        body,source=self.version(version)
        payload={"path":path,"offset":offset,"limit":limit}
        if name is not None:payload={"path":path,"name":name}
        return {"sourceVersion":version,**self.native(source,"attribute" if name is not None else "attributes",payload)}

    def save_selection(self,operation,version,selection):
        request={"sourceVersion":version,"selection":selection}
        with self.operation_scope(operation,"selection.save",request) as op:
            if op["reuse"] is not None:return op["reuse"]
            body,source=self.version(version);normalized=self.native(source,"normalize",selection,operation=operation)
            selected={"schema":SELECTION,"sourceVersion":version,"sourceFile":body["file"],"selection":normalized}
            ident=fingerprint(selected)
            self.start_commit(operation)
            immutable(self.root/"selections"/(ident+".json"),encode(selected))
            with self.mutex,self.db:self.db.execute("INSERT OR IGNORE INTO selections VALUES(?,?,?,?)",(ident,version,encode(selected).decode(),time.time()))
            return self.complete(operation,{"id":ident,**selected})

    def edition(self,ident,verify=True):
        with self.mutex:
            row=self.db.execute("SELECT body FROM editions WHERE id=?",(hash_id(ident),)).fetchone()
            if row is None:raise InputError("Unknown retained result edition",status=404)
            body=parse(row[0])
        root=self.root/"editions"/ident
        if read(root/"edition.json")!=encode(body):raise InputError("Edition manifest changed","HDF5_EDITION_CHANGED",409)
        if verify:
            for name,expected in body["files"].items():
                if file_hash(root/name,MAX_OUTPUT)!=expected:raise InputError("Edition member changed: "+name,"HDF5_EDITION_CHANGED",409)
        return body

    def extract(self,operation,selection_id):
        request={"selectionId":selection_id}
        with self.operation_scope(operation,"selection.extract",request) as op:
            if op["reuse"] is not None:
                self.edition(op["reuse"]["id"]);return op["reuse"]
            selected=self.selection(selection_id);source_body,source=self.version(selected["sourceVersion"])
            binding={"schema":EDITION,"sourceVersion":selected["sourceVersion"],"selectionId":selection_id,"engine":"stellar-forge.hdf5-engine.v1"}
            ident=fingerprint(binding);target=self.root/"editions"/ident
            if not target.exists():
                staging=directory(op["root"]/("attempt-"+str(uuid.uuid4())),create=True)
                metadata=self.native(source,"extract",selected["selection"],target=staging,operation=operation)
                members={name:file_hash(staging/name,MAX_OUTPUT) for name in ("values.jsonl","array.json","dataset.csv","dataset.json")}
                body={"id":ident,**binding,"sourceFile":source_body["file"],"selection":selected["selection"],
                      "array":metadata,"files":members}
                immutable(staging/"edition.json",encode(body));sync_dir(staging)
                self.start_commit(operation)
                with self.mutex:
                    if target.exists():raise InputError("Another result adopted this edition; reopen the original operation","HDF5_EDITION_EXISTS",409)
                    os.rename(staging,target);sync_dir(target.parent)
            self.start_commit(operation)
            body=parse(read(target/"edition.json"))
            if {k:body[k] for k in binding}!=binding or body.get("id")!=ident:raise InputError("Retained result binding differs")
            for name,expected in body["files"].items():
                if file_hash(target/name,MAX_OUTPUT)!=expected:raise InputError("Retained native result differs")
            sync_dir(target.parent)
            with self.mutex,self.db:self.db.execute("INSERT OR IGNORE INTO editions VALUES(?,?,?,?,?)",(ident,selected["sourceVersion"],selection_id,encode(body).decode(),time.time()))
            return self.complete(operation,body)

    def result_page(self,edition,offset=0,limit=25):
        body=self.edition(edition);offset=integer(offset);limit=integer(limit,1,250)
        rows=[]
        with (self.root/"editions"/edition/"values.jsonl").open("rb") as stream:
            for number,line in enumerate(stream):
                if number<offset:continue
                if len(rows)>=limit:break
                rows.append(parse(line))
        total=int(body["array"]["rows"])
        if offset>total:raise InputError("Result offset exceeds the retained edition")
        return {"editionId":edition,"sourceVersion":body["sourceVersion"],"dtype":body["array"]["dtype"],"shape":body["array"]["shape"],
                "rows":rows,"total":str(total),"next":str(offset+len(rows)) if offset+len(rows)<total else None}

    def artifact(self,edition,name):
        body=self.edition(edition)
        if name=="source.h5":
            _,path=self.version(body["sourceVersion"]);expected=body["sourceFile"]
        elif name=="edition.json":
            path=self.root/"editions"/edition/name;expected=file_hash(path)
        elif name in body["files"]:path=self.root/"editions"/edition/name;expected=body["files"][name]
        else:raise InputError("Unknown exact edition member")
        return {"editionId":edition,"name":name,"path":str(path),**expected}

    def export(self,operation,edition,destination):
        destination=Path(destination).expanduser().absolute();directory(destination.parent)
        request={"editionId":edition,"destination":str(destination)}
        with self.operation_scope(operation,"edition.export",request) as op:
            if op["reuse"] is not None:
                if file_hash(destination,2*MAX_SOURCE)!=op["reuse"]["archive"]:raise InputError("Original delivery archive changed")
                return op["reuse"]
            body=self.edition(edition);version,source=self.version(body["sourceVersion"]);selected=self.selection(body["selectionId"])
            entries={"source.h5":source,**{name:self.root/"editions"/edition/name for name in body["files"]},
                     "edition.json":self.root/"editions"/edition/"edition.json"}
            inline={"source.json":encode(version),"selection.json":encode(selected)}
            identities={name:file_hash(path) for name,path in entries.items()}
            identities.update({name:{"bytes":len(data),"sha256":sha(data)} for name,data in inline.items()})
            manifest={"schema":PACKET,"editionId":edition,"files":identities}
            temporary=op["root"]/("packet-"+str(uuid.uuid4())+".zip")
            with temporary.open("x+b") as output:
                os.chmod(temporary,0o600)
                with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                    def item(name):
                        info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=(stat.S_IFREG|0o600)<<16
                        return info
                    archive.writestr(item("manifest.json"),encode(manifest))
                    for name in sorted(identities):
                        if name in inline:archive.writestr(item(name),inline[name])
                        else:
                            with archive.open(item(name),"w",force_zip64=True) as out,entries[name].open("rb") as inp:
                                while block:=inp.read(1048576):out.write(block)
                output.flush();os.fsync(output.fileno())
            info=file_hash(temporary,2*MAX_SOURCE)
            self.start_commit(operation)
            copied(temporary,destination,info,2*MAX_SOURCE);temporary.unlink();sync_dir(destination.parent)
            result={"schema":"stellar-forge.hdf5-delivery.v1","id":fingerprint({"edition":edition,"archive":info}),"editionId":edition,
                    "archive":info,"path":str(destination),"members":identities}
            with self.mutex,self.db:self.db.execute("INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?)",(result["id"],edition,encode(result).decode(),time.time()))
            return self.complete(operation,result)

    def receive(self,operation,archive_path,expected_sha):
        expected_sha=hash_id(expected_sha);archive_path=Path(archive_path).expanduser().absolute()
        request={"archive":str(archive_path),"expectedSha256":expected_sha}
        with self.operation_scope(operation,"edition.receive",request) as op:
            if op["reuse"] is not None:self.edition(op["reuse"]["editionId"]);return op["reuse"]
            original=file_hash(archive_path,2*MAX_SOURCE)
            if original["sha256"]!=expected_sha:raise InputError("Archive differs from its selected whole-file SHA")
            stage=directory(op["root"]/"received",create=True)
            expected_names={"manifest.json","source.h5","source.json","selection.json","edition.json","array.json","values.jsonl","dataset.csv","dataset.json"}
            with zipfile.ZipFile(archive_path) as archive:
                infos=archive.infolist()
                if len(infos)!=len(expected_names) or {info.filename for info in infos}!=expected_names:raise InputError("HDF5 packet must contain exactly its nine documented root files")
                for info in infos:
                    maximum=MAX_SOURCE if info.filename=="source.h5" else MAX_OUTPUT
                    if info.flag_bits&1 or info.is_dir() or stat.S_ISLNK(info.external_attr>>16) or info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED) or info.file_size>maximum:
                        raise InputError("Invalid archive member")
                    with archive.open(info) as inp:
                        data=inp.read(maximum+1)
                        if len(data)>maximum:raise InputError("Archive member exceeds its byte limit")
                        immutable(stage/info.filename,data)
            manifest=parse(read(stage/"manifest.json"))
            if manifest.get("schema")!=PACKET or set(manifest.get("files",{}))!=expected_names-{"manifest.json"}:raise InputError("Invalid original packet manifest")
            for name,expected in manifest["files"].items():
                if file_hash(stage/name)!=expected:raise InputError("Original archive member differs: "+name)
            version=parse(read(stage/"source.json"));selection=parse(read(stage/"selection.json"));edition=parse(read(stage/"edition.json"))
            if version.get("schema")!=SOURCE or version.get("file")!=manifest["files"]["source.h5"]:raise InputError("Packet source binding differs")
            if version.get("id")!=fingerprint({k:v for k,v in version.items() if k!="id"}):raise InputError("Source version identity differs")
            if selection.get("schema")!=SELECTION or selection.get("sourceVersion")!=version["id"] or selection.get("sourceFile")!=version["file"]:raise InputError("Saved selection source differs")
            selection_id=fingerprint(selection);binding={"schema":EDITION,"sourceVersion":version["id"],"selectionId":selection_id,"engine":"stellar-forge.hdf5-engine.v1"}
            edition_id=fingerprint(binding)
            if manifest.get("editionId")!=edition_id or edition.get("id")!=edition_id or any(edition.get(k)!=v for k,v in binding.items()):raise InputError("Packet edition identity differs")
            if edition.get("sourceFile")!=version["file"] or edition.get("selection")!=selection["selection"]:
                raise InputError("Edition source file or selected axes differ from the exact source/selection")
            if set(edition)!={"id","schema","sourceVersion","selectionId","engine","sourceFile","selection","array","files"}:
                raise InputError("Unsupported edition fields")
            if edition.get("files")!={k:manifest["files"][k] for k in ("array.json","values.jsonl","dataset.csv","dataset.json")}:raise InputError("Packet output closure differs")
            # Independently rerun the exact native selection from the retained original file.
            native_stage=directory(op["root"]/("reconstructed-"+str(uuid.uuid4())),create=True)
            actual=self.native(stage/"source.h5","extract",selection["selection"],target=native_stage,operation=operation)
            for name,expected in edition["files"].items():
                if file_hash(native_stage/name)!=expected:raise InputError("Native reconstruction differs from the offered result: "+name,"HDF5_RECONSTRUCTION_CHANGED",409)
            if actual!=edition["array"]:raise InputError("Native array metadata differs from the offered result")
            if file_hash(archive_path,2*MAX_SOURCE)!=original:raise InputError("Original archive changed during receiving")
            self.start_commit(operation)
            copied(stage/"source.h5",self.root/"objects"/(version["file"]["sha256"]+".h5"),version["file"])
            immutable(self.root/"selections"/(selection_id+".json"),encode(selection))
            target=directory(self.root/"editions"/edition_id,create=True)
            for name in edition["files"]:copied(stage/name,target/name,edition["files"][name])
            immutable(target/"edition.json",encode(edition))
            with self.mutex,self.db:
                # Receiving keeps the immutable historical version; it does not move an existing live source head.
                self.db.execute("INSERT OR IGNORE INTO sources VALUES(?,?,?,?)",(identifier(version["sourceId"]),"Received HDF5 source",version["id"],time.time()))
                self.db.execute("INSERT OR IGNORE INTO versions VALUES(?,?,?,?)",(version["id"],version["sourceId"],encode(version).decode(),time.time()))
                self.db.execute("INSERT OR IGNORE INTO selections VALUES(?,?,?,?)",(selection_id,version["id"],encode(selection).decode(),time.time()))
                self.db.execute("INSERT OR IGNORE INTO editions VALUES(?,?,?,?,?)",(edition_id,version["id"],selection_id,encode(edition).decode(),time.time()))
            return self.complete(operation,{"schema":"stellar-forge.hdf5-received.v1","editionId":edition_id,"sourceVersion":version["id"],
                                             "archive":original,"reconstructed":True,"rows":actual["rows"],"sourceHeadMoved":False})

    def resume(self,ident):
        original=self.operation(ident);r=original["request"];action=original["action"]
        if action=="source.import":args={"operation":ident,"source_id":r["sourceId"],"path":r["path"],"label":r["label"],"expected_head":r["expectedHead"],"origin":r["origin"]}
        elif action=="selection.save":args={"operation":ident,"version":r["sourceVersion"],"selection":r["selection"]}
        elif action=="selection.extract":args={"operation":ident,"selection_id":r["selectionId"]}
        elif action=="edition.export":args={"operation":ident,"edition":r["editionId"],"destination":r["destination"]}
        elif action=="edition.receive":args={"operation":ident,"archive_path":r["archive"],"expected_sha":r["expectedSha256"]}
        else:raise InputError("This original operation has no native continuation")
        return self.dispatch(action,args)

    def dispatch(self,action,payload):
        only(payload,{
            "status":["offset","limit"],"version.get":["ident"],"records":["kind","offset","limit","source"],"source.get":["source"],
            "source.import":["operation","source_id","path","label","expected_head","origin"],
            "inspect":["version","path","offset","limit"],"attributes":["version","path","offset","limit","name"],
            "selection.get":["ident"],"selection.save":["operation","version","selection"],
            "selection.extract":["operation","selection_id"],"edition.get":["ident"],"result.page":["edition","offset","limit"],
            "artifact":["edition","name"],"edition.export":["operation","edition","destination"],
            "edition.receive":["operation","archive_path","expected_sha"],"operation.get":["ident"],"operation.resume":["ident"],"operation.cancel":["operation"]
        }.get(action,[]))
        methods={"version.get":lambda ident:self.version(ident)[0],"status":self.state,"records":self.list_records,"source.get":self.source,"source.import":self.import_source,
                 "inspect":self.inspect,"attributes":self.attributes,"selection.get":self.selection,"selection.save":self.save_selection,
                 "selection.extract":self.extract,"edition.get":self.edition,"result.page":self.result_page,"artifact":self.artifact,
                 "edition.export":self.export,"edition.receive":self.receive,"operation.get":self.operation,"operation.resume":self.resume,"operation.cancel":self.cancel}
        if action not in methods:raise InputError("Unknown HDF5 workspace action")
        return methods[action](**payload)
