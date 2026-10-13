"""Original command, revision, source-byte and first-result custody."""
import contextlib, os, sqlite3, threading
from pathlib import Path
from .common import *
from . import domain
from . import dispatch
DATABASE_SCHEMA="geocove.highway-sqlite.v1"
class Workspace:
    def __init__(self,directory,*,create=False,workspace_id=None,title=None,created_at=None):
        self.directory=canonical_directory(directory,create=create)
        self.lock=threading.RLock(); self.db=None
        path=self.directory/"workspace.sqlite3"
        require(not path.is_symlink(),"SYMLINK","Workspace database cannot be a symbolic link.")
        exists=path.exists()
        if create:
            identifier(workspace_id);timestamp(created_at);text(title,"Workspace title",200)
            atomic_file(self.directory/"creation.json",canonical({"schema":"geocove.highway-creation.v1","id":workspace_id,"title":title,"createdAt":created_at}),immutable=True)
        require(exists or create,"WORKSPACE_MISSING","Original workspace database is unavailable.")
        try:
            self.db=sqlite3.connect(path,timeout=20,isolation_level=None,check_same_thread=False)
            self.db.row_factory=sqlite3.Row
            self.db.execute("PRAGMA foreign_keys=ON")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("PRAGMA journal_mode=DELETE")
            tables=self.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
            if not tables:
                require(create,"WORKSPACE_MISSING","Original workspace initialization is incomplete.")
                identifier(workspace_id);timestamp(created_at);text(title,"Workspace title",200)
                state=domain.new_state(workspace_id,title,created_at)
                body=canonical(state)
                self.db.execute("BEGIN IMMEDIATE")
                for sql in (
                    "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
                    "CREATE TABLE states(revision INTEGER PRIMARY KEY,sha256 TEXT NOT NULL,body BLOB NOT NULL)",
                    "CREATE TABLE commands(request_id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,revision INTEGER NOT NULL UNIQUE,envelope BLOB NOT NULL,result BLOB NOT NULL,previous_sha256 TEXT NOT NULL,sha256 TEXT NOT NULL,FOREIGN KEY(revision) REFERENCES states(revision))",
                    "CREATE TABLE blobs(sha256 TEXT PRIMARY KEY,bytes INTEGER NOT NULL,body BLOB NOT NULL)",
                    "CREATE TABLE publications(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,request_sha256 TEXT NOT NULL,body BLOB NOT NULL,FOREIGN KEY(revision) REFERENCES states(revision))"
                ): self.db.execute(sql)
                self.db.executemany("INSERT INTO metadata VALUES(?,?)",[("schema",DATABASE_SCHEMA),("id",workspace_id),("createdAt",created_at)])
                self.db.execute("INSERT INTO states VALUES(0,?,?)",(sha(body),body))
                self.db.execute("COMMIT")
                os.chmod(path,0o600);fsync_directory(self.directory)
            require(self.db.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()[0]==DATABASE_SCHEMA,"WRONG_WORKSPACE","This is not a Highway workspace.")
            require(self.db.execute("PRAGMA quick_check").fetchone()[0]=="ok","DATABASE_INVALID","Original workspace integrity check failed.")
            self.current()
        except BaseException:
            if self.db:
                try: self.db.close()
                finally: self.db=None
            raise
    def close(self):
        with self.lock:
            if self.db: self.db.close();self.db=None
    def __enter__(self): return self
    def __exit__(self,*args): self.close()
    def _active(self): require(self.db is not None,"CLOSED","Workspace is closed.")
    def current(self):
        with self.lock:
            self._active()
            row=self.db.execute("SELECT * FROM states ORDER BY revision DESC LIMIT 1").fetchone()
            require(row is not None and sha(bytes(row["body"]))==row["sha256"],"STATE_CHANGED","Saved state identity does not match.")
            return {"revision":row["revision"],"sha256":row["sha256"],"state":loads(row["body"])}
    def read_blob(self,key):
        sha_id(key);self._active()
        row=self.db.execute("SELECT bytes,body FROM blobs WHERE sha256=?",(key,)).fetchone()
        require(row is not None,"SOURCE_MISSING","Retained source bytes are unavailable.")
        data=bytes(row["body"]);require(len(data)==row["bytes"] and sha(data)==key,"SOURCE_CHANGED","Retained source hash does not match.")
        return data
    def put_blob(self,data,expected_sha256=None):
        require(isinstance(data,bytes) and len(data)<=MAX_BLOB,"FILE_LIMIT","Source object exceeds its allowance.")
        key=sha(data)
        if expected_sha256 is not None: require(key==sha_id(expected_sha256),"SOURCE_CHANGED","Uploaded bytes do not match the selected source.")
        with self.lock:
            self._active();self.db.execute("BEGIN IMMEDIATE")
            try:
                old=self.db.execute("SELECT bytes FROM blobs WHERE sha256=?",(key,)).fetchone()
                if old:
                    require(self.read_blob(key)==data,"HASH_CONFLICT","Saved source identity conflicts.")
                else:
                    total=self.db.execute("SELECT COALESCE(SUM(bytes),0) FROM blobs").fetchone()[0]
                    require(total+len(data)<=MAX_BLOBS,"WORKSPACE_CAPACITY","Full source-byte allowance exceeded.")
                    self.db.execute("INSERT INTO blobs VALUES(?,?,?)",(key,len(data),data))
                self.db.execute("COMMIT")
            except BaseException:
                if self.db.in_transaction:self.db.execute("ROLLBACK")
                raise
        return {"sha256":key,"bytes":len(data),"reused":old is not None}
    def execute(self,command,expected_revision):
        require(type(expected_revision) is int and expected_revision>=0,"REVISION","An exact saved revision is required.")
        require(isinstance(command,dict) and set(command)=={"requestId","kind","actor","at","body"},"COMMAND","Use the complete command envelope.")
        identifier(command["requestId"]);timestamp(command["at"]);text(command["kind"],"Command",80)
        require(isinstance(command["actor"],dict) and set(command["actor"])=={"id","name"},"ACTOR","Use a named original operator.")
        text(command["actor"]["id"],"Operator ID",128);text(command["actor"]["name"],"Operator name",160)
        envelope={"expectedRevision":expected_revision,"command":command};raw=canonical(envelope);request_sha=sha(raw)
        require(len(raw)<=8*1024*1024,"COMMAND_CAPACITY","Command is too large.")
        with self.lock:
            self._active();self.db.execute("BEGIN IMMEDIATE")
            try:
                old=self.db.execute("SELECT request_sha256,result FROM commands WHERE request_id=?",(command["requestId"],)).fetchone()
                if old:
                    require(old["request_sha256"]==request_sha,"REQUEST_CONFLICT","This request ID already belongs to different original input.")
                    result=loads(old["result"]);self.db.execute("COMMIT")
                    return {"reused":True,**result}
                current=self.current()
                require(expected_revision==current["revision"],"REVISION_CONFLICT","The workspace changed. Preserve the draft and review the current revision.")
                require(current["revision"]<10000,"HISTORY_CAPACITY","Workspace revision allowance reached.")
                if command["kind"]=="field.issue":
                    body=command["body"]
                    require(isinstance(body,dict) and isinstance(body.get("document"),dict),
                            "FIELD_ISSUE","Use the complete originally prepared field issue.")
                    issued=loads(self.read_blob(sha_id(body["document"].get("sha256"))))
                    require(issued.get("workspaceRevision")==expected_revision,
                            "FIELD_REVISION","The issued field copy must retain this exact original workspace revision.")
                if command["kind"].startswith("dispatch."):
                    next_state,outcome=dispatch.apply_dispatch(loads(canonical(current["state"])),command,self.read_blob)
                else:
                    next_state,outcome=domain.apply(loads(canonical(current["state"])),command,self.read_blob)
                require(next_state["id"]==current["state"]["id"],"WORKSPACE_CHANGED","A command cannot replace workspace identity.")
                domain.validate_state(next_state,self.read_blob)
                state_body=canonical(next_state);state_sha=sha(state_body);revision=current["revision"]+1
                require(len(state_body)<=8*1024*1024,"STATE_CAPACITY","Workspace state exceeds portable capacity.")
                result={"requestId":command["requestId"],"revision":revision,"sha256":state_sha,"outcome":outcome}
                result_body=canonical(result)
                size=self.db.execute("SELECT COALESCE(SUM(length(body)),0) FROM states").fetchone()[0]
                size+=self.db.execute("SELECT COALESCE(SUM(length(envelope)+length(result)),0) FROM commands").fetchone()[0]
                size+=self.db.execute("SELECT COALESCE(SUM(length(body)),0) FROM publications").fetchone()[0]
                require(size+len(state_body)+len(raw)+len(result_body)+2048<=MAX_HISTORY,"HISTORY_CAPACITY","This change would exceed the full portable history allowance.")
                self.db.execute("INSERT INTO states VALUES(?,?,?)",(revision,state_sha,state_body))
                event_sha=digest({"requestSha256":request_sha,"previousSha256":current["sha256"],"stateSha256":state_sha,"result":result})
                self.db.execute("INSERT INTO commands VALUES(?,?,?,?,?,?,?)",(command["requestId"],request_sha,revision,raw,result_body,current["sha256"],event_sha))
                self.db.execute("COMMIT")
                return {"reused":False,**result}
            except BaseException:
                if self.db.in_transaction:self.db.execute("ROLLBACK")
                raise
    def history(self,offset=0,limit=50):
        require(type(offset) is int and offset>=0 and type(limit) is int and 1<=limit<=100,"PAGE","Use a bounded history page.")
        with self.lock:
            self._active()
            rows=self.db.execute("SELECT revision,request_id,request_sha256,envelope,result,previous_sha256,sha256 FROM commands ORDER BY revision LIMIT ? OFFSET ?",(limit,offset)).fetchall()
            total=self.db.execute("SELECT COUNT(*) FROM commands").fetchone()[0]
            return {"offset":offset,"total":total,"nextOffset":offset+len(rows) if offset+len(rows)<total else None,"items":[{"revision":r["revision"],"requestId":r["request_id"],"requestSha256":r["request_sha256"],"envelope":loads(r["envelope"]),"result":loads(r["result"]),"previousSha256":r["previous_sha256"],"sha256":r["sha256"]} for r in rows]}
    def request(self,request_id):
        identifier(request_id)
        with self.lock:
            row=self.db.execute("SELECT envelope,result,request_sha256 FROM commands WHERE request_id=?",(request_id,)).fetchone()
            return None if row is None else {"envelope":loads(row["envelope"]),"result":loads(row["result"]),"requestSha256":row["request_sha256"]}
    def publication(self,publication_id,revision=None):
        identifier(publication_id)
        with self.lock:
            self._active();self.db.execute("BEGIN IMMEDIATE")
            try:
                old=self.db.execute("SELECT * FROM publications WHERE id=?",(publication_id,)).fetchone()
                if old:
                    if revision is not None:require(old["revision"]==revision,"PUBLICATION_CONFLICT","Export identity is already bound to another revision.")
                    result=loads(old["body"]);self.db.execute("COMMIT");return result
                current=self.current()
                if revision is None: revision=current["revision"]
                require(type(revision) is int and 0<=revision<=current["revision"],"REVISION","Select a retained revision.")
                row=self.db.execute("SELECT sha256,body FROM states WHERE revision=?",(revision,)).fetchone()
                blobs=[{"sha256":r["sha256"],"bytes":r["bytes"]} for r in self.db.execute("SELECT sha256,bytes FROM blobs ORDER BY sha256")]
                prior=[r["id"] for r in self.db.execute("SELECT id FROM publications WHERE revision<=? ORDER BY id",(revision,))]
                result={"schema":"geocove.highway-publication.v1","id":publication_id,"workspaceId":current["state"]["id"],"revision":revision,"stateSha256":row["sha256"],"blobInventory":blobs,"publicationIds":sorted(prior+[publication_id])}
                body=canonical(result)
                used=self.db.execute("SELECT COALESCE(SUM(length(body)),0) FROM states").fetchone()[0]+self.db.execute("SELECT COALESCE(SUM(length(envelope)+length(result)),0) FROM commands").fetchone()[0]+self.db.execute("SELECT COALESCE(SUM(length(body)),0) FROM publications").fetchone()[0]
                require(used+len(body)+2048<=MAX_HISTORY,"HISTORY_CAPACITY","This publication would exceed portable history capacity.")
                self.db.execute("INSERT INTO publications VALUES(?,?,?,?)",(publication_id,revision,digest({"id":publication_id,"revision":revision}),body))
                self.db.execute("COMMIT");return result
            except BaseException:
                if self.db.in_transaction:self.db.execute("ROLLBACK")
                raise
    def snapshot(self,publication_id,revision=None):
        """Freeze a full logical prefix without including SQLite runtime files."""
        with self.lock:
            pub=self.publication(publication_id,revision)
            revision=pub["revision"]
            self.db.execute("BEGIN")
            try:
                states=[{"revision":r["revision"],"sha256":r["sha256"],"state":loads(r["body"])} for r in self.db.execute("SELECT * FROM states WHERE revision<=? ORDER BY revision",(revision,))]
                commands=[{"requestSha256":r["request_sha256"],"revision":r["revision"],"envelope":loads(r["envelope"]),"result":loads(r["result"]),"previousSha256":r["previous_sha256"],"sha256":r["sha256"]} for r in self.db.execute("SELECT * FROM commands WHERE revision<=? ORDER BY revision",(revision,))]
                # All original blobs are retained, including unreferenced received source bytes.
                blobs=pub["blobInventory"]
                publication_ids=set(pub["publicationIds"])
                publications=[loads(r["body"]) for r in self.db.execute("SELECT id,body FROM publications WHERE revision<=? ORDER BY id",(revision,)) if r["id"] in publication_ids]
                result={"schema":"geocove.highway-history.v1","workspaceId":states[0]["state"]["id"],"publication":pub,"states":states,"commands":commands,"blobs":blobs,"publications":publications}
                require(len(canonical(result))<=MAX_HISTORY,"HISTORY_CAPACITY","Full history exceeds its receiving allowance.")
                self.db.execute("COMMIT");return result
            except BaseException:
                if self.db.in_transaction:self.db.execute("ROLLBACK")
                raise
