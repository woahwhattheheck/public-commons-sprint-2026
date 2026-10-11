"""Durable operator decisions beside, and never inside, the original buyer ledger."""
from __future__ import annotations

from contextlib import suppress
from pathlib import Path
import fcntl
import json
import os
import sqlite3
import stat
import threading

from domain import Problem, SCHEMA, now, canonical, identifier, text, day, digest, row_key, basis, native_changes, validate_coding, period_view
from native import capture_ledger, parse_labels

DDL = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, parent_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS captures_source ON captures(source_id,created_at,id);
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, request_id TEXT NOT NULL, capture_id TEXT NOT NULL, missing INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(source_id,request_id));
CREATE TABLE IF NOT EXISTS centers(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codings(id TEXT PRIMARY KEY, item_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coding_heads(item_id TEXT PRIMARY KEY, coding_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS periods(id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dispositions(id TEXT PRIMARY KEY, period_id TEXT NOT NULL, item_id TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS disposition_heads(period_id TEXT NOT NULL,item_id TEXT NOT NULL,code TEXT NOT NULL,disposition_id TEXT NOT NULL,PRIMARY KEY(period_id,item_id,code));
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, period_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS closes(id TEXT PRIMARY KEY, period_id TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL,UNIQUE(period_id,sequence));
CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL);
"""


def private_directory(path):
    value = path.stat()
    if not stat.S_ISDIR(value.st_mode) or value.st_mode & 0o077 or value.st_uid != os.getuid():
        raise Problem("PRIVATE_DIRECTORY_REQUIRED", "Use an operator-owned directory with mode 0700")


def private_file(path):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode) or value.st_mode & 0o077 or value.st_uid != os.getuid():
        raise Problem("PRIVATE_FILE_REQUIRED", "Use an operator-owned regular file with mode 0600")


def page(values, offset=0, limit=50):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
        raise Problem("INVALID_PAGE", "Use a nonnegative offset and page size from 1 to 200")
    return {"items": values[offset:offset + limit], "total": len(values), "offset": offset,
            "next": offset + limit if offset + limit < len(values) else None}


class Store:
    def __init__(self, directory):
        self.root = Path(directory).expanduser().resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        private_directory(self.root)
        self.lock = threading.RLock()
        self.closed = False
        self.connection = None
        self.lease = os.open(self.root / "operator.lock", os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            private_file(self.root / "operator.lock")
            try:
                fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise Problem("WORKSPACE_IN_USE", "The original expense workspace is already open in another process", 409) from exc
            database = self.root / "workspace.sqlite"
            if database.exists():
                private_file(database)
            elif any(p.name != "operator.lock" for p in self.root.iterdir()):
                raise Problem("NEW_DIRECTORY_REQUIRED", "Create the expense workspace in a new directory, separate from the buyer ledger")
            else:
                fd = os.open(database, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                os.close(fd)
            self.connection = sqlite3.connect(database, isolation_level=None, check_same_thread=False, timeout=10)
            self.connection.row_factory = sqlite3.Row
            if database.stat().st_size:
                known = self.connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").fetchone()
                mark = self.connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone() if known else None
                if not mark or mark[0] != SCHEMA:
                    raise Problem("WORKSPACE_SCHEMA", "This existing database is not a completed native expense workspace", 409)
            self.connection.execute("PRAGMA trusted_schema=OFF")
            self.connection.execute("PRAGMA foreign_keys=ON")
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA synchronous=FULL")
            self.connection.executescript(DDL)
            found = self.connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
            if found and found["value"] != SCHEMA:
                raise Problem("WORKSPACE_SCHEMA", "This workspace requires its original application version", 409)
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES('schema',?)", (SCHEMA,))
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES('revision','0')")
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES('id',?)", (identifier("workspace"),))
            self.connection.execute("INSERT OR IGNORE INTO meta VALUES('labels','[]')")
        except BaseException:
            if self.connection:
                self.connection.close()
            os.close(self.lease)
            self.closed = True
            raise

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            try:
                self.connection.close()
            finally:
                os.close(self.lease)

    def revision(self):
        return int(self.connection.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])

    def _get(self, table, ident):
        if table not in {"sources", "captures", "items", "centers", "codings", "periods", "reviews", "closes", "dispositions"}:
            raise AssertionError("fixed table required")
        value = self.connection.execute("SELECT body FROM " + table + " WHERE id=?", (ident,)).fetchone()
        if value is None:
            raise Problem("NOT_FOUND", "The selected retained record does not exist", 404)
        return json.loads(value[0])

    def _bodies(self, table):
        if table not in {"sources", "centers", "periods"}:
            raise AssertionError("fixed table required")
        return [json.loads(r[0]) for r in self.connection.execute("SELECT body FROM " + table + " ORDER BY id")]

    def _put(self, table, body):
        if table not in {"sources", "centers", "periods"}:
            raise AssertionError("fixed table required")
        self.connection.execute("INSERT INTO " + table + "(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                                (body["id"], canonical(body)))

    def _change(self, expected, action, operation):
        with self.lock:
            if self.closed:
                raise Problem("WORKSPACE_CLOSED", "The workspace is closing", 503)
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                revision = self.revision()
                if type(expected) is not int or expected != revision:
                    raise Problem("WORKSPACE_CHANGED", "The workspace changed. Refresh and review your preserved form before saving again", 409)
                result = operation()
                revision += 1
                self.connection.execute("UPDATE meta SET value=? WHERE key='revision'", (str(revision),))
                self.connection.execute("INSERT INTO events(created_at,action,body) VALUES(?,?,?)",
                                        (now(), action, canonical({"revision": revision, "record": result.get("id") if isinstance(result, dict) else None})))
                self.connection.execute("COMMIT")
                return {"revision": revision, "result": result}
            except BaseException:
                with suppress(sqlite3.Error):
                    if self.connection.in_transaction:
                        self.connection.execute("ROLLBACK")
                raise

    def _source_views(self):
        result = []
        for source in self._bodies("sources"):
            view = dict(source)
            view["pending"] = [r[0] for r in self.connection.execute("SELECT id FROM captures WHERE source_id=? AND status='PENDING' ORDER BY created_at,id", (source["id"],))]
            if source.get("current_capture"):
                captured = self._get("captures", source["current_capture"])
                report = captured["report"]
                view.update(capture_time=report["captured_at"], projection_sha256=report["source"]["projection_sha256"],
                            journal_events=report["source"]["journal_events"], last_sequence=report["source"]["last_sequence"],
                            rows=report["source"]["reservations"], portfolio=report["portfolio"])
            result.append(view)
        return result

    def _items(self):
        names = {s["id"]: s["name"] for s in self._bodies("sources")}
        heads = {r["item_id"]: json.loads(r["body"]) for r in self.connection.execute(
            "SELECT h.item_id,c.body FROM coding_heads h JOIN codings c ON c.id=h.coding_id")}
        items = []
        for value in self.connection.execute("SELECT * FROM items ORDER BY source_id,request_id"):
            row = json.loads(value["body"])
            item = {"id": value["id"], "source_id": value["source_id"], "source_name": names[value["source_id"]],
                    "capture_id": value["capture_id"], "missing": bool(value["missing"]), "row": row}
            item["basis"] = basis(row, item["missing"])
            item["coding"] = heads.get(item["id"])
            item["status"] = ("ABSENT" if item["missing"] else "RESERVED" if row["state"] == "reserved" else
                              "UNCODED" if not item["coding"] else "STALE" if item["coding"]["basis"] != item["basis"] else "CODED")
            items.append(item)
        return items

    def state(self):
        with self.lock:
            periods = sorted(self._bodies("periods"), key=lambda p: (p["from_day"], p["id"]), reverse=True)
            return {"schema": SCHEMA, "id": self.connection.execute("SELECT value FROM meta WHERE key='id'").fetchone()[0],
                    "revision": self.revision(), "sources": self._source_views(), "periods": periods,
                    "centers": self._bodies("centers"), "labels": json.loads(self.connection.execute("SELECT value FROM meta WHERE key='labels'").fetchone()[0])}

    def expenses(self, query="", source="", status="", offset=0, limit=50):
        with self.lock:
            query = text(query, "Search", maximum=300, optional=True).casefold()
            found = [i for i in self._items() if (not source or i["source_id"] == source) and (not status or i["status"] == status)
                     and (not query or query in " ".join([i["row"]["request_id"], i["source_name"], i["row"]["actor"], i["row"]["service"],
                                                         i["row"]["receipt_ref"], i.get("coding", {}).get("memo", "") if i.get("coding") else ""]).casefold())]
            return page(found, offset, limit)

    def item(self, ident):
        with self.lock:
            selected = next((i for i in self._items() if i["id"] == ident), None)
            if selected is None:
                raise Problem("NOT_FOUND", "Select an original native row", 404)
            selected["coding_history"] = [json.loads(r[0]) for r in self.connection.execute("SELECT body FROM codings WHERE item_id=? ORDER BY created_at DESC,id DESC", (ident,))]
            return selected

    def _new_capture(self, source, native):
        captured = {"id": identifier("capture"), "source_id": source["id"], "parent_id": source.get("current_capture"),
                    "status": "PENDING", "created_at": now(), "path": native["path"], "identity": native["identity"],
                    "snapshot": native["snapshot"], "report": native["report"]}
        previous = self._get("captures", source["current_capture"])["report"] if source.get("current_capture") else None
        captured["changes"] = native_changes(previous, native["report"])
        self.connection.execute("INSERT INTO captures VALUES(?,?,?,?,?,?)",
                                (captured["id"], source["id"], captured["parent_id"], "PENDING", captured["created_at"], canonical(captured)))
        return self._capture_summary(captured)

    def register_source(self, payload, expected):
        name = text(payload.get("name"), "Source name", maximum=160)
        path = text(payload.get("path"), "Original ledger path", maximum=4096)
        provenance = text(payload.get("provenance", ""), "Source provenance", maximum=6000, optional=True)
        native = capture_ledger(path)
        def operation():
            if any(s["path"] == native["path"] or s["identity"] == native["identity"] for s in self._bodies("sources")):
                raise Problem("SOURCE_ALREADY_REGISTERED", "This original ledger is already registered; refresh or rebind that source", 409)
            source = {"id": identifier("source"), "name": name, "path": native["path"], "identity": native["identity"],
                      "provenance": provenance, "created_at": now(), "current_capture": None}
            self._put("sources", source)
            return {"id": source["id"], "source": source, "capture": self._new_capture(source, native)}
        return self._change(expected, "source.register", operation)

    def capture(self, ident, expected):
        with self.lock:
            source = self._get("sources", ident)
        native = capture_ledger(source["path"])
        return self._change(expected, "source.capture", lambda: self._new_capture(self._get("sources", ident), native))

    def rebind(self, ident, payload, expected):
        path = text(payload.get("path"), "Original ledger path", maximum=4096)
        reason = text(payload.get("reason"), "Rebinding reason", maximum=3000)
        operator = text(payload.get("operator"), "Source owner", maximum=240)
        native = capture_ledger(path)
        def operation():
            source = self._get("sources", ident)
            if any(s["id"] != ident and (s["path"] == native["path"] or s["identity"] == native["identity"]) for s in self._bodies("sources")):
                raise Problem("SOURCE_ALREADY_REGISTERED", "This path belongs to another registered source", 409)
            if source.get("current_capture"):
                before = self._get("captures", source["current_capture"])["report"]["rows"]
                after = {r["request_id"]: r for r in native["report"]["rows"]}
                if any(r["request_id"] not in after or after[r["request_id"]]["request_digest"] != r["request_digest"] for r in before):
                    raise Problem("LEDGER_CONTINUITY", "This ledger does not retain the registered source's original request identities; register a distinct source instead", 409)
            source["rebindings"] = source.get("rebindings", []) + [{"from": source["path"], "to": native["path"], "reason": reason, "operator": operator, "at": now()}]
            source.update(path=native["path"], identity=native["identity"])
            self._put("sources", source)
            return {"id": ident, "capture": self._new_capture(source, native)}
        return self._change(expected, "source.rebind", operation)

    @staticmethod
    def _capture_summary(captured):
        return {k: captured.get(k) for k in ("id", "source_id", "parent_id", "status", "created_at", "reviewed_at", "operator", "reason")} | {
            "source": captured["report"]["source"], "captured_at": captured["report"]["captured_at"], "change_count": len(captured["changes"]),
            "change_counts": {kind: sum(c["kind"] == kind for c in captured["changes"]) for kind in ("ADDED", "CHANGED", "ABSENT")}}

    def captures(self, source_id, offset=0, limit=20):
        with self.lock:
            values = [self._capture_summary(json.loads(r[0])) for r in self.connection.execute(
                "SELECT body FROM captures WHERE source_id=? ORDER BY created_at DESC,id DESC", (source_id,))]
            return page(values, offset, limit)

    def inspect_capture(self, ident, offset=0, limit=20):
        with self.lock:
            saved = self._get("captures", ident)
            return self._capture_summary(saved) | {"changes": page(saved["changes"], offset, limit), "portfolio": saved["report"]["portfolio"]}

    def capture_original(self, ident):
        with self.lock:
            return self._get("captures", ident)

    def decide_capture(self, ident, payload, expected):
        decision = payload.get("decision")
        if decision not in ("ACCEPT", "REJECT"):
            raise Problem("CAPTURE_DECISION", "Accept the original capture or reject it with a reason")
        operator = text(payload.get("operator"), "Source reviewer", maximum=240)
        reason = text(payload.get("reason"), "Source review reason", maximum=3000)
        def operation():
            captured = self._get("captures", ident)
            source = self._get("sources", captured["source_id"])
            if captured["status"] != "PENDING":
                raise Problem("CAPTURE_REVIEWED", "This source edition already has a retained decision", 409)
            if decision == "ACCEPT":
                if captured["parent_id"] != source.get("current_capture"):
                    raise Problem("SOURCE_CHANGED", "A different source edition was accepted; capture again against that edition", 409)
                self.connection.execute("UPDATE items SET missing=1 WHERE source_id=?", (source["id"],))
                for row in captured["report"]["rows"]:
                    key = row_key(source["id"], row["request_id"])
                    self.connection.execute("INSERT INTO items VALUES(?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET capture_id=excluded.capture_id,missing=0,body=excluded.body",
                                            (key, source["id"], row["request_id"], ident, canonical(row)))
                source["current_capture"] = ident
                self._put("sources", source)
            captured.update(status="ACCEPTED" if decision == "ACCEPT" else "REJECTED", operator=operator, reason=reason, reviewed_at=now())
            self.connection.execute("UPDATE captures SET status=?,body=? WHERE id=?", (captured["status"], canonical(captured), ident))
            return self._capture_summary(captured)
        return self._change(expected, "source." + decision.lower(), operation)

    def save_center(self, payload, expected):
        def operation():
            ident = payload.get("id") or identifier("center")
            previous = self._get("centers", ident) if payload.get("id") else None
            code = text(payload.get("code"), "Cost center code", maximum=100)
            if any(c["id"] != ident and c["code"] == code for c in self._bodies("centers")):
                raise Problem("COST_CENTER_CODE", "Use a distinct cost-center code", 409)
            if type(payload.get("active", True)) is not bool:
                raise Problem("COST_CENTER_STATE", "Active must be true or false")
            body = {"id": ident, "code": code, "name": text(payload.get("name"), "Cost center name", maximum=200),
                    "active": payload.get("active", True), "created_at": previous["created_at"] if previous else now(), "updated_at": now()}
            self._put("centers", body)
            return body
        return self._change(expected, "center.save", operation)

    def save_labels(self, payload, expected):
        try:
            values = list(parse_labels({"assets": payload.get("assets")}).values())
        except (ValueError, TypeError) as exc:
            raise Problem("INVALID_LABELS", str(exc)) from exc
        return self._change(expected, "labels.save", lambda: self._set_labels(values))

    def _set_labels(self, values):
        self.connection.execute("UPDATE meta SET value=? WHERE key='labels'", (canonical(values),))
        return {"assets": values}

    def save_period(self, payload, expected):
        def operation():
            ident = payload.get("id") or identifier("period")
            previous = self._get("periods", ident) if payload.get("id") else None
            if previous and previous["state"] == "CLOSED":
                raise Problem("PERIOD_CLOSED", "Reopen the original period before changing it", 409)
            start, end = day(payload.get("from_day")), day(payload.get("through_day"))
            if start > end:
                raise Problem("PERIOD_DATES", "The first recognition date must be on or before the last")
            if any(p["id"] != ident and start <= p["through_day"] and end >= p["from_day"] for p in self._bodies("periods")):
                raise Problem("PERIOD_OVERLAP", "Expense periods cannot overlap; each recognition date belongs to one period", 409)
            body = dict(previous or {"id": ident, "state": "OPEN", "generation": 0, "latest_close": None, "created_at": now()})
            body.update(name=text(payload.get("name"), "Period name", maximum=200), from_day=start, through_day=end, updated_at=now())
            self._put("periods", body)
            return body
        return self._change(expected, "period.save", operation)

    def save_coding(self, ident, payload, expected):
        def operation():
            item = self.item(ident)
            centers = {c["id"]: c for c in self._bodies("centers")}
            coding = validate_coding(item, payload, centers)
            dates = [coding["recognition_date"]]
            if item.get("coding"):
                dates.append(item["coding"]["recognition_date"])
            if any(p["state"] == "CLOSED" and any(p["from_day"] <= d <= p["through_day"] for d in dates) for p in self._bodies("periods")):
                raise Problem("PERIOD_CLOSED", "Reopen the affected original period before changing an issued expense", 409)
            coding.update(id=identifier("coding"), created_at=now(), previous=item["coding"]["id"] if item.get("coding") else None)
            self.connection.execute("INSERT INTO codings VALUES(?,?,?,?)", (coding["id"], ident, coding["created_at"], canonical(coding)))
            self.connection.execute("INSERT INTO coding_heads VALUES(?,?) ON CONFLICT(item_id) DO UPDATE SET coding_id=excluded.coding_id", (ident, coding["id"]))
            return coding
        return self._change(expected, "expense.code", operation)

    def _dispositions(self, period_id):
        return [json.loads(r[0]) for r in self.connection.execute(
            "SELECT d.body FROM disposition_heads h JOIN dispositions d ON d.id=h.disposition_id WHERE h.period_id=? ORDER BY h.item_id,h.code", (period_id,))]

    def report(self, ident):
        with self.lock:
            period = self._get("periods", ident)
            view = period_view(period, self._items(), self._source_views(), {c["id"]: c for c in self._bodies("centers")}, self._dispositions(ident))
            labels = json.loads(self.connection.execute("SELECT value FROM meta WHERE key='labels'").fetchone()[0])
            view["labels"] = labels
            view["context_sha256"] = digest([view["context_sha256"], labels])
            return view

    def dispose(self, period_id, payload, expected):
        def operation():
            period = self._get("periods", period_id)
            if period["state"] == "CLOSED":
                raise Problem("PERIOD_CLOSED", "Reopen the period before changing its exception decisions", 409)
            current = self.report(period_id)
            issue = next((x for x in current["issues"] if x["item_id"] == payload.get("item_id") and x["code"] == payload.get("code")), None)
            if issue is None or issue["basis"] != payload.get("basis"):
                raise Problem("ISSUE_CHANGED", "The source exception changed; review its current detail", 409)
            kind = payload.get("kind")
            if kind not in issue["allowed_kinds"]:
                raise Problem("ISSUE_ACTION", "Use the original source review or one of this issue's displayed dispositions")
            value = {"id": identifier("disposition"), "period_id": period_id, "item_id": issue["item_id"], "code": issue["code"],
                     "basis": issue["basis"], "kind": kind, "reason": text(payload.get("reason"), "Disposition reason", maximum=4000),
                     "operator": text(payload.get("operator"), "Disposition owner", maximum=240), "created_at": now()}
            self.connection.execute("INSERT INTO dispositions VALUES(?,?,?,?,?,?)",
                                    (value["id"], period_id, value["item_id"], value["code"], value["created_at"], canonical(value)))
            self.connection.execute("INSERT INTO disposition_heads VALUES(?,?,?,?) ON CONFLICT(period_id,item_id,code) DO UPDATE SET disposition_id=excluded.disposition_id",
                                    (period_id, value["item_id"], value["code"], value["id"]))
            return value
        return self._change(expected, "period.disposition", operation)

    def review(self, ident, payload, expected):
        def operation():
            report = self.report(ident)
            if report["period"]["state"] != "OPEN":
                raise Problem("PERIOD_CLOSED", "This period already has an issued edition", 409)
            value = {"id": identifier("review"), "period_id": ident, "created_at": now(), "context_sha256": report["context_sha256"],
                     "reviewer": text(payload.get("reviewer"), "Review owner", maximum=240),
                     "role": text(payload.get("role"), "Review capacity", maximum=240),
                     "notes": text(payload.get("notes"), "Review conclusion", maximum=6000),
                     "decision": "READY" if report["ready"] else "REQUIRES_CORRECTION", "snapshot": report}
            self.connection.execute("INSERT INTO reviews VALUES(?,?,?,?)", (value["id"], ident, value["created_at"], canonical(value)))
            return value
        return self._change(expected, "period.review", operation)

    def close_period(self, ident, payload, expected):
        def operation():
            period = self._get("periods", ident)
            review = self._get("reviews", payload.get("review_id"))
            if review["period_id"] != ident:
                raise Problem("REVIEW_PERIOD", "Use a review of this exact period")
            if period["state"] == "CLOSED":
                saved = self._get("closes", period["latest_close"])
                if saved["review"]["id"] == review["id"]:
                    return saved | {"already_closed": True}
                raise Problem("PERIOD_CLOSED", "The original period is already closed", 409)
            report = self.report(ident)
            if review["context_sha256"] != report["context_sha256"]:
                raise Problem("REVIEW_STALE", "Source, coding, or exception decisions changed after review; review their current state", 409)
            if review["decision"] != "READY" or not report["ready"]:
                raise Problem("PERIOD_EXCEPTIONS", "Complete the displayed exception decisions before issuing this period", 409)
            sequence = self.connection.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM closes WHERE period_id=?", (ident,)).fetchone()[0]
            capture_ids = {s["current_capture"] for s in self._bodies("sources") if s.get("current_capture")}
            for rows in (report["allocations"], report["outstanding_reservations"], report["issues"]):
                capture_ids.update(r["source_capture"] for r in rows if r.get("source_capture"))
            value = dict(report)
            value.update(id=identifier("close"), status="CLOSED", sequence=sequence, created_at=now(),
                         previous=period.get("latest_close"), review={k: review[k] for k in ("id", "created_at", "reviewer", "role", "notes", "decision")},
                         native_captures=[self._get("captures", capture_id) for capture_id in sorted(capture_ids)],
                         labels=json.loads(self.connection.execute("SELECT value FROM meta WHERE key='labels'").fetchone()[0]))
            value["period"] = period | {"state": "CLOSED", "latest_close": value["id"]}
            self.connection.execute("INSERT INTO closes VALUES(?,?,?,?,?)", (value["id"], ident, sequence, value["created_at"], canonical(value)))
            period.update(state="CLOSED", latest_close=value["id"], updated_at=now())
            self._put("periods", period)
            return {"id": value["id"], "sequence": sequence, "period": period, "context_sha256": report["context_sha256"]}
        return self._change(expected, "period.close", operation)

    def reopen(self, ident, payload, expected):
        def operation():
            period = self._get("periods", ident)
            if period["state"] != "CLOSED":
                raise Problem("PERIOD_OPEN", "This period is already open", 409)
            entry = {"at": now(), "operator": text(payload.get("operator"), "Reopening owner", maximum=240),
                     "reason": text(payload.get("reason"), "Reopening reason", maximum=4000), "prior_close": period["latest_close"]}
            period.update(state="OPEN", generation=period["generation"] + 1, updated_at=now(),
                          reopenings=period.get("reopenings", []) + [entry])
            self._put("periods", period)
            return period
        return self._change(expected, "period.reopen", operation)

    def history(self, period_id, offset=0, limit=20):
        with self.lock:
            values = []
            for table, kind in (("reviews", "review"), ("closes", "close")):
                for value in self.connection.execute("SELECT body FROM " + table + " WHERE period_id=? ORDER BY created_at DESC,id DESC", (period_id,)):
                    body = json.loads(value[0])
                    values.append({k: body.get(k) for k in ("id", "created_at", "sequence", "decision", "context_sha256")} |
                                  {"kind": kind, "reviewer": body.get("reviewer") or body.get("review", {}).get("reviewer")})
            return page(sorted(values, key=lambda x: (x["created_at"], x["id"]), reverse=True), offset, limit)

    def issued(self, ident):
        with self.lock:
            return self._get("closes", ident)

    def saved_review(self, ident):
        with self.lock:
            return self._get("reviews", ident)

    def events(self, offset=0, limit=50):
        with self.lock:
            if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
                raise Problem("INVALID_PAGE", "Invalid activity page")
            total = self.connection.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            rows = [dict(x) for x in self.connection.execute("SELECT * FROM events ORDER BY sequence DESC LIMIT ? OFFSET ?", (limit, offset))]
            for row in rows:
                row["detail"] = json.loads(row.pop("body"))
            return {"items": rows, "total": total, "offset": offset, "next": offset + limit if offset + limit < total else None}

    def backup_to(self, destination):
        with self.lock:
            if self.closed:
                raise Problem("WORKSPACE_CLOSED", "The workspace is closed", 503)
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
            os.close(fd)
            target = sqlite3.connect(destination)
            try:
                self.connection.backup(target)
            finally:
                target.close()
            private_file(Path(destination))
