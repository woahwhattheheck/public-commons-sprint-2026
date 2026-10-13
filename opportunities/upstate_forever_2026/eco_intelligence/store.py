"""Durable session, evidence, and guided-action state in an independent WAL database."""
from __future__ import annotations
import sqlite3
import uuid
from pathlib import Path
from contextlib import contextmanager
from .common import dumps, loads, now, digest, IntelligenceError

SCHEMA = '''
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,title TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_tenant ON sessions(tenant,created);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_session ON events(session,seq);
CREATE TABLE IF NOT EXISTS evidence(id TEXT NOT NULL,tenant TEXT NOT NULL,session TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(id,tenant,session));
CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,session TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests(tenant TEXT NOT NULL,session TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,body TEXT,PRIMARY KEY(tenant,session,id));
'''

class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.db() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(SCHEMA)

    @contextmanager
    def db(self):
        db = sqlite3.connect(str(self.path),timeout=30)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback(); raise
        finally:
            db.close()

    def create_session(self, tenant: str, title: str) -> dict:
        obj={'id':uuid.uuid4().hex,'tenant':tenant,'title':title,'created':now()}
        with self.db() as db:
            db.execute('INSERT INTO sessions VALUES (:id,:tenant,:title,:created)',obj)
        return obj

    def sessions(self, tenant: str) -> list:
        with self.db() as db:
            return [dict(r) for r in db.execute('SELECT * FROM sessions WHERE tenant=? ORDER BY created DESC',(tenant,))]

    def session(self, tenant: str, sid: str) -> dict:
        with self.db() as db:
            row=db.execute('SELECT * FROM sessions WHERE id=? AND tenant=?',(sid,tenant)).fetchone()
            if not row:
                raise IntelligenceError('Investigation not found for tenant.',404)
            obj=dict(row)
            obj['events']=[dict(r) | {'body':loads(r['body'])} for r in db.execute('SELECT * FROM events WHERE session=? ORDER BY seq',(sid,))]
            obj['evidence']=[loads(r['body']) | {'id':r['id'],'created':r['created']} for r in db.execute('SELECT * FROM evidence WHERE session=? AND tenant=? ORDER BY created,id',(sid,tenant))]
            obj['plans']=[dict(r) | {'body':loads(r['body']),'result':loads(r['result'])} for r in db.execute('SELECT * FROM plans WHERE session=? AND tenant=? ORDER BY created',(sid,tenant))]
        return obj

    def authorize(self, tenant: str, sid: str) -> None:
        # Log appends must not deserialize all earlier observations and reports.
        with self.db() as db:
            if db.execute('SELECT 1 FROM sessions WHERE tenant=? AND id=?',(tenant,sid)).fetchone() is None:
                raise IntelligenceError('Investigation not found for tenant.',404)

    def get_evidence(self, tenant: str, sid: str, eid: str) -> dict:
        self.authorize(tenant,sid)
        with self.db() as db:
            r=db.execute('SELECT body,created FROM evidence WHERE tenant=? AND session=? AND id=?',(tenant,sid,eid)).fetchone()
        if r is None: raise IntelligenceError('Evidence is not in this investigation.',404)
        return loads(r['body']) | {'id':eid,'created':r['created']}

    def event(self, tenant: str, sid: str, kind: str, body: dict):
        self.authorize(tenant,sid)
        with self.db() as db:
            db.execute('INSERT INTO events(session,kind,body,created) VALUES (?,?,?,?)',(sid,kind,dumps(body),now()))

    def evidence(self, tenant: str, sid: str, body: dict) -> dict:
        self.authorize(tenant,sid)
        eid='E'+digest(body)[:24]
        with self.db() as db:
            db.execute('INSERT OR IGNORE INTO evidence VALUES (?,?,?,?,?)',(eid,tenant,sid,dumps(body),now()))
        return {'id':eid,**body}

    def put_plan(self, tenant: str, sid: str, body: dict) -> dict:
        self.authorize(tenant,sid)
        pid=uuid.uuid4().hex
        with self.db() as db:
            db.execute('INSERT INTO plans VALUES (?,?,?,?,?,?,?,?)',(pid,tenant,sid,dumps(body),'ready',None,now(),now()))
        return self.plan(tenant,pid)

    def plan(self, tenant: str, pid: str) -> dict:
        with self.db() as db:
            r=db.execute('SELECT * FROM plans WHERE id=? AND tenant=?',(pid,tenant)).fetchone()
            if not r:
                raise IntelligenceError('Guided action not found for tenant.',404)
            return dict(r) | {'body':loads(r['body']),'result':loads(r['result'])}

    def begin_plan(self, tenant: str, pid: str) -> bool:
        with self.db() as db:
            result=db.execute("UPDATE plans SET status='executing',updated=? WHERE id=? AND tenant=? AND status='ready'",(now(),pid,tenant))
            return result.rowcount == 1

    def finish_plan(self, tenant: str, pid: str, status: str, result: dict):
        with self.db() as db:
            db.execute('UPDATE plans SET status=?,result=?,updated=? WHERE tenant=? AND id=?',(status,dumps(result),now(),tenant,pid))

    def request(self, tenant: str, sid: str, rid: str) -> dict | None:
        self.authorize(tenant,sid)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT status,body FROM requests WHERE tenant=? AND session=? AND id=?',(tenant,sid,rid)).fetchone()
            if row:
                if row['status']=='complete': return loads(row['body'])
                raise IntelligenceError('This request was already started. Its retained events remain available; use a new request ID for a new attempt.',409)
            db.execute('INSERT INTO requests VALUES (?,?,?,?,?)',(tenant,sid,rid,'running',None))
        return None

    def finish_request(self, tenant: str, sid: str, rid: str, value: dict, failed: bool=False):
        with self.db() as db:
            db.execute('UPDATE requests SET status=?,body=? WHERE tenant=? AND session=? AND id=?',('failed' if failed else 'complete',dumps(value),tenant,sid,rid))
