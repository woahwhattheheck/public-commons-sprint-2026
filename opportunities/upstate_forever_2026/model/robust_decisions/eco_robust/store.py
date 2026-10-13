"""SQLite study/revision/job store. Original modeling project files are untouched.

Each read/write opens its own connection. Revisions are immutable. Conflicting
operator saves fail rather than clobbering another editor. Portable bundles
include every revision, result and its exact original input.
"""
from __future__ import annotations
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
from .schema import Study
from .engine import canonical_hash


def now():
    return datetime.now(timezone.utc).isoformat()


def dumps(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, workspace):
        self.root = Path(workspace).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "robust_decisions.sqlite3"
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS studies(id TEXT PRIMARY KEY, title TEXT NOT NULL, head INTEGER NOT NULL, created TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions(study_id TEXT NOT NULL, revision INTEGER NOT NULL, input TEXT NOT NULL, sha256 TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(study_id, revision));
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, study_id TEXT NOT NULL, revision INTEGER NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL, result TEXT, error TEXT);
            CREATE TABLE IF NOT EXISTS imports(study_id TEXT PRIMARY KEY, provenance TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operator_operations(operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_sha256 TEXT NOT NULL, result_id TEXT NOT NULL, result_revision INTEGER);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=30000")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _operator_result(db, operation_id, kind, request):
        if operation_id is None:
            return None
        if not isinstance(operation_id, str) or not operation_id.strip():
            raise ValueError("Retain the original operator operation identity")
        row = db.execute("SELECT * FROM operator_operations WHERE operation_id=?", (operation_id,)).fetchone()
        if row is not None and (row["kind"] != kind or row["request_sha256"] != canonical_hash(request)):
            raise Conflict("This operator operation already belongs to different decision inputs")
        return None if row is None else dict(row)

    @staticmethod
    def _remember_operator(db, operation_id, kind, request, result_id, revision=None):
        if operation_id is not None:
            db.execute("""INSERT INTO operator_operations VALUES(?,?,?,?,?)
                          ON CONFLICT(operation_id) DO UPDATE SET
                          result_id=excluded.result_id,result_revision=excluded.result_revision""",
                       (operation_id, kind, canonical_hash(request), result_id, revision))

    def operator_result(self, operation_id, kind, request):
        with self.connect() as db:
            return self._operator_result(db, operation_id, kind, request)

    def create(self, study: Study | dict, *, operation_id=None, operation_request=None):
        value = (study if isinstance(study, Study) else Study.model_validate(study)).model_dump()
        request = value if operation_request is None else operation_request
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._operator_result(db, operation_id, "create", request)
            if previous is None:
                sid = "study_" + uuid.uuid4().hex
                db.execute("INSERT INTO studies VALUES(?,?,?,?)", (sid, value["title"], 1, now()))
                db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", (sid, 1, dumps(value), canonical_hash(value), now()))
                self._remember_operator(db, operation_id, "create", request, sid, 1)
            else:
                sid = previous["result_id"]
        return self.read(sid, 1)

    def list(self):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM studies ORDER BY created DESC")]

    def read(self, sid, revision=None):
        with self.connect() as db:
            study = db.execute("SELECT * FROM studies WHERE id=?", (sid,)).fetchone()
            if study is None:
                raise KeyError(sid)
            rev = study["head"] if revision is None else revision
            row = db.execute("SELECT * FROM revisions WHERE study_id=? AND revision=?", (sid, rev)).fetchone()
            if row is None:
                raise KeyError(f"{sid}@{rev}")
            runs = [dict(r) for r in db.execute("SELECT * FROM runs WHERE study_id=? AND revision=? ORDER BY created", (sid, rev))]
        for run in runs:
            run["result"] = json.loads(run["result"]) if run["result"] else None
        return {"id": sid, "head": study["head"], "revision": rev, "sha256": row["sha256"], "study": json.loads(row["input"]), "runs": runs}

    def revise(self, sid, study, expected_revision, *, operation_id=None):
        value = (study if isinstance(study, Study) else Study.model_validate(study)).model_dump()
        request = {"study_id": sid, "study": value, "expected_revision": expected_revision}
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._operator_result(db, operation_id, "revise", request)
            if previous is not None:
                rev = previous["result_revision"]
            else:
                row = db.execute("SELECT head FROM studies WHERE id=?", (sid,)).fetchone()
                if row is None:
                    raise KeyError(sid)
                if row["head"] != expected_revision:
                    raise Conflict(f"study advanced to revision {row['head']}; refresh before saving")
                rev = expected_revision + 1
                db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", (sid, rev, dumps(value), canonical_hash(value), now()))
                db.execute("UPDATE studies SET title=?,head=? WHERE id=?", (value["title"], rev, sid))
                self._remember_operator(db, operation_id, "revise", request, sid, rev)
        return self.read(sid, rev)

    def start_run(self, sid, revision, objective, *, run_id=None, operation_id=None, operation_request=None):
        self.read(sid, revision)
        rid = run_id or "run_" + uuid.uuid4().hex
        request = operation_request or {"study_id": sid, "revision": revision, "objective": objective}
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._operator_result(db, operation_id, "calculation", request)
            if previous is not None:
                prior = db.execute("SELECT status FROM runs WHERE id=?", (previous["result_id"],)).fetchone()
                if prior is None:
                    raise Conflict("The original operator calculation record is missing")
                if prior["status"] in ("running", "completed"):
                    raise Conflict("This operator calculation is already running or completed")
            db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)", (rid, sid, revision, objective, "running", now(), None, None))
            self._remember_operator(db, operation_id, "calculation", request, rid, revision)
        return rid

    def finish_run(self, rid, result=None, error=None):
        with self.connect() as db:
            cur = db.execute("UPDATE runs SET status=?,result=?,error=? WHERE id=? AND status='running'",
                             ("failed" if error else "completed", None if result is None else dumps(result), error, rid))
            if cur.rowcount != 1:
                raise Conflict("run does not exist or has already completed")

    def read_run(self, sid, rid):
        with self.connect() as db:
            row = db.execute("SELECT * FROM runs WHERE study_id=? AND id=?", (sid, rid)).fetchone()
        if row is None:
            raise KeyError(rid)
        value = dict(row)
        value["result"] = None if value["result"] is None else json.loads(value["result"])
        return value

    def export(self, sid):
        with self.connect() as db:
            # One read transaction gives a consistent study/revision/run snapshot.
            db.execute("BEGIN")
            row = db.execute("SELECT * FROM studies WHERE id=?", (sid,)).fetchone()
            if row is None:
                raise KeyError(sid)
            revisions = []
            for rev in db.execute("SELECT * FROM revisions WHERE study_id=? ORDER BY revision", (sid,)):
                r = dict(rev); r["input"] = json.loads(r["input"]); revisions.append(r)
            runs = []
            for run in db.execute("SELECT * FROM runs WHERE study_id=? ORDER BY created", (sid,)):
                r = dict(run); r["result"] = json.loads(r["result"]) if r["result"] else None; runs.append(r)
            imported = db.execute("SELECT provenance FROM imports WHERE study_id=?", (sid,)).fetchone()
        payload = {"study": dict(row), "revisions": revisions, "runs": runs,
                   "import_provenance": None if imported is None else json.loads(imported["provenance"])}
        return {"schema_version": "ecosci.robust-project/1", "sha256": canonical_hash(payload), "payload": payload}

    def receive(self, bundle, *, operation_id=None):
        if bundle.get("schema_version") != "ecosci.robust-project/1":
            raise ValueError("unsupported project schema")
        payload = bundle["payload"]
        if canonical_hash(payload) != bundle.get("sha256"):
            raise ValueError("project digest mismatch")
        original = payload["study"]
        revs = payload["revisions"]
        if [r["revision"] for r in revs] != list(range(1, original["head"] + 1)):
            raise ValueError("project revisions must form the complete original history")
        if not revs:
            raise ValueError("project needs at least one study revision")
        for rev in revs:
            if rev.get("study_id") != original["id"]:
                raise ValueError("revision belongs to a different study")
            Study.model_validate(rev["input"])
            if canonical_hash(rev["input"]) != rev["sha256"]:
                raise ValueError("revision digest mismatch")
        revisions = {r["revision"]: r for r in revs}
        run_ids = set()
        for run in payload["runs"]:
            if run.get("study_id") != original["id"]:
                raise ValueError("run belongs to a different study")
            if run["id"] in run_ids or run["revision"] not in revisions:
                raise ValueError("duplicate run or unknown revision")
            run_ids.add(run["id"])
            result = run.get("result")
            if result is not None and result.get("study_sha256") != revisions[run["revision"]]["sha256"]:
                raise ValueError("result is not bound to its original study revision")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._operator_result(db, operation_id, "receive", bundle)
            if previous is None:
                sid = "study_" + uuid.uuid4().hex
                db.execute("INSERT INTO studies VALUES(?,?,?,?)", (sid, revs[-1]["input"]["title"], original["head"], now()))
                for r in revs:
                    db.execute("INSERT INTO revisions VALUES(?,?,?,?,?)", (sid, r["revision"], dumps(r["input"]), r["sha256"], r["created"]))
                for r in payload["runs"]:
                    # A received in-progress run cannot remain falsely live on a different host.
                    status = "interrupted_on_transfer" if r["status"] == "running" else r["status"]
                    db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)", ("run_" + uuid.uuid4().hex, sid, r["revision"], r["objective"], status,
                                                                          r["created"], None if r["result"] is None else dumps(r["result"]), r["error"]))
                db.execute("INSERT INTO imports VALUES(?,?)", (sid, dumps({"original_study_id": original["id"], "bundle_sha256": bundle["sha256"], "received_at": now(), "original_payload": payload})))
                self._remember_operator(db, operation_id, "receive", bundle, sid, original["head"])
            else:
                sid = previous["result_id"]
        return self.read(sid, original["head"])
