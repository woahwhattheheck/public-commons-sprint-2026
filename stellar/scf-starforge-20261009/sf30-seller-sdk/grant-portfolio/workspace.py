"""MIT. One private writer; retained sources, reviews, revisions and complete receiving."""
from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
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

from domain import *
from native_sources import file_info, run_projection

HERE = Path(__file__).resolve().parent
SDK = HERE.parent
PACKET = "stellar-forge.grant-portfolio-packet.v1"
WORKSPACE = "stellar-forge.grant-portfolio-workspace.v1"
ACTIONS = ("source.receive", "portfolio.save", "review.save", "portfolio.export", "portfolio.receive")


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def immutable(path, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and not path.is_symlink() and path.read_bytes() == data,
                "Retained original bytes differ: " + path.name, "RETAINED_FILE_CHANGED", 409)
        return
    fd, name = tempfile.mkstemp(prefix=".write-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(name, 0o600)
        os.link(name, path)
        sync_dir(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def rows_file(path):
    with Path(path).open("rb") as stream:
        for line in stream:
            require(len(line) <= 64 * 1024 * 1024, "One complete source record exceeds 64 MiB")
            yield parse(line)


class Workspace:
    def __init__(self, directory, create=False):
        raw = Path(directory).expanduser().absolute()
        if create:
            raw.mkdir(mode=0o700, parents=True, exist_ok=False)
            immutable(raw / "workspace.json", canonical({"schema": WORKSPACE,
                      "workspaceId": str(uuid.uuid4()), "createdAt": now()}))
        self.root = raw.resolve(strict=True)
        require(raw == self.root, "Use the original absolute workspace without path aliases")
        info = self.root.stat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077,
                "Use a private operator-owned workspace")
        self.marker = parse((self.root / "workspace.json").read_bytes())
        shape(self.marker, ("schema", "workspaceId", "createdAt"), ("schema", "workspaceId", "createdAt"))
        require(self.marker["schema"] == WORKSPACE, "Select an original grant portfolio workspace")
        identifier(self.marker["workspaceId"])
        lock_path = self.root / ".workspace.lock"
        self.lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            locked = os.fstat(self.lock)
            require(stat.S_ISREG(locked.st_mode) and locked.st_uid == os.getuid()
                    and not locked.st_mode & 0o077, "The original workspace lock must remain private")
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise InputError("This original workspace already has an active writer", "WORKSPACE_BUSY", 409) from error
            require((locked.st_dev, locked.st_ino) ==
                    (lock_path.stat().st_dev, lock_path.stat().st_ino), "The original lock changed while opening")
            for name in ("objects", "sources", "exports", "received", "tmp"):
                (self.root / name).mkdir(mode=0o700, exist_ok=True)
            database = self.root / "workspace.sqlite"
            if database.exists():
                before = database.lstat()
                require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                        and not before.st_mode & 0o077, "The original workspace database must remain private")
            self.db = sqlite3.connect(database, isolation_level=None, check_same_thread=False)
            database.chmod(0o600)
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS entities(source_id TEXT,entity_key TEXT,body TEXT NOT NULL,
                    PRIMARY KEY(source_id,entity_key));
                CREATE TABLE IF NOT EXISTS financial(source_id TEXT,row_key TEXT,entity_key TEXT,body TEXT NOT NULL,
                    PRIMARY KEY(source_id,row_key));
                CREATE TABLE IF NOT EXISTS portfolios(id TEXT,revision INTEGER,snapshot TEXT,body TEXT NOT NULL,
                    PRIMARY KEY(id,revision));
                CREATE TABLE IF NOT EXISTS derived(portfolio_id TEXT,revision INTEGER,table_name TEXT,row_key TEXT,
                    entity_key TEXT,source_id TEXT,status TEXT,standard TEXT,search TEXT,body TEXT NOT NULL,
                    PRIMARY KEY(portfolio_id,revision,table_name,row_key));
                CREATE INDEX IF NOT EXISTS derived_page ON derived(portfolio_id,revision,table_name,row_key);
                CREATE INDEX IF NOT EXISTS derived_entity ON derived(portfolio_id,revision,entity_key);
                CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,input_sha TEXT NOT NULL,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,body TEXT NOT NULL);
            """)
            self.db.execute("INSERT OR IGNORE INTO meta VALUES('workspaceId',?)", (self.marker["workspaceId"],))
            self.db.execute("INSERT OR IGNORE INTO meta VALUES('revision','0')")
            require(self.db.execute("SELECT value FROM meta WHERE key='workspaceId'").fetchone()[0]
                    == self.marker["workspaceId"], "The original workspace marker and database differ")
            self.mutex, self.execution = threading.RLock(), threading.Lock()
            self.closed = False
            # A previous process cannot still own a RUNNING request after this exact flock was acquired.
            with self.transaction():
                for row in self.db.execute("SELECT body FROM requests").fetchall():
                    request = parse(row[0])
                    if request["state"] == "RUNNING":
                        request.update(state="FAILED", updatedAt=now(), error={
                            "code": "PROCESS_INTERRUPTED", "message": "Resume this saved operation with its retained original input.",
                            "retryable": True})
                        self._store_request(request)
        except BaseException:
            if hasattr(self, "db"):
                self.db.close()
            os.close(self.lock)
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if getattr(self, "closed", True):
            return
        with self.execution, self.mutex:
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self.db.close()
            os.close(self.lock)
            self.closed = True

    @contextmanager
    def transaction(self):
        with self.mutex:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    @contextmanager
    def reader(self):
        db = sqlite3.connect("file:" + str(self.root / "workspace.sqlite") + "?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            db.execute("BEGIN")
            yield db
        finally:
            db.close()

    def current_revision(self, db=None):
        if db is not None:
            return int(db.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0])
        with self.reader() as reader:
            return self.current_revision(reader)

    def state(self):
        with self.reader() as db:
            sources = [parse(x[0]) for x in db.execute("SELECT body FROM sources ORDER BY id")]
            portfolios = [parse(x[0]) for x in db.execute(
                "SELECT p.body FROM portfolios p JOIN (SELECT id,MAX(revision) r FROM portfolios GROUP BY id) h "
                "ON p.id=h.id AND p.revision=h.r ORDER BY p.id")]
            requests = [parse(x[0]) for x in db.execute("SELECT body FROM requests ORDER BY rowid DESC")]
            return {"schema": SCHEMA, "workspaceId": self.marker["workspaceId"],
                    "revision": self.current_revision(db),
                    "sources": [{k: x[k] for k in ("id", "standard", "label", "coverage", "selection", "counts", "object")}
                                for x in sources],
                    "portfolios": [{k: x[k] for k in ("id", "revision", "snapshot", "name", "review", "counts", "updatedAt")}
                                   for x in portfolios],
                    "requests": [{k: x[k] for k in ("id", "state", "action", "inputSha256", "updatedAt", "error")
                                  if k in x} for x in requests]}

    def source(self, ident, db=None):
        sha(ident)
        if db is None:
            with self.reader() as reader:
                return self.source(ident, reader)
        row = db.execute("SELECT body FROM sources WHERE id=?", (ident,)).fetchone()
        require(row is not None, "Source edition was not found", "NOT_FOUND", 404)
        return parse(row[0])

    def portfolio(self, ident, version=None, db=None):
        identifier(ident)
        if version is not None:
            revision(version)
        if db is None:
            with self.reader() as reader:
                return self.portfolio(ident, version, reader)
        row = db.execute("SELECT body FROM portfolios WHERE id=? " +
            ("AND revision=? " if version else "") + "ORDER BY revision DESC LIMIT 1",
            (ident, version) if version else (ident,)).fetchone()
        require(row is not None, "Portfolio revision was not found", "NOT_FOUND", 404)
        return parse(row[0])

    def request(self, ident, db=None):
        operation(ident)
        if db is None:
            with self.reader() as reader:
                return self.request(ident, reader)
        row = db.execute("SELECT body FROM requests WHERE id=?", (ident,)).fetchone()
        require(row is not None, "Saved operation was not found", "NOT_FOUND", 404)
        return parse(row[0])

    def _store_request(self, request):
        self.db.execute("INSERT INTO requests VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                        (request["id"], request["inputSha256"], canonical(request).decode()))

    def admit(self, value):
        shape(value, ("operationId", "action", "payload", "expectedRevision"),
              ("operationId", "action", "payload"))
        require(len(canonical(value)) <= MAX_JSON, "The action input exceeds 1 MiB", "INPUT_TOO_LARGE", 413)
        ident = operation(value["operationId"])
        require(value["action"] in ACTIONS and isinstance(value["payload"], dict), "Select a supported complete action")
        if "expectedRevision" in value:
            require(type(value["expectedRevision"]) is int and value["expectedRevision"] >= 0, "Invalid workspace revision")
        input_sha = digest(value)
        with self.transaction():
            row = self.db.execute("SELECT body FROM requests WHERE id=?", (ident,)).fetchone()
            if row:
                original = parse(row[0])
                require(original["inputSha256"] == input_sha, "This operation already selects different input",
                        "OPERATION_INPUT_CONFLICT", 409)
                return original
            if "expectedRevision" in value:
                require(value["expectedRevision"] == self.current_revision(self.db),
                        "The workspace revision changed", "WORKSPACE_REVISION_CONFLICT", 409)
            timestamp = now()
            request = {"schema": SCHEMA + ".request", "id": ident, "state": "RUNNING",
                "action": value["action"], "input": value, "inputSha256": input_sha,
                "createdAt": timestamp, "updatedAt": timestamp,
                "context": {"portfolioId": str(uuid.uuid4()),
                            "decisionIds": [str(uuid.uuid4()) for _ in value["payload"].get("decisions", [])]}}
            self._store_request(request)
            return request

    def upload(self, stream, length=None):
        if length is not None:
            require(type(length) is int and 0 < length <= MAX_PACKET, "Select a complete packet within 4 GiB",
                    "INPUT_TOO_LARGE", 413)
        fd, name = tempfile.mkstemp(prefix="upload-", dir=self.root / "tmp")
        size, hasher = 0, hashlib.sha256()
        try:
            with os.fdopen(fd, "wb") as out:
                remaining = length
                while remaining is None or remaining:
                    block = stream.read(min(1024 * 1024, remaining) if remaining is not None else 1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    require(size <= MAX_PACKET, "Complete packet exceeds 4 GiB", "INPUT_TOO_LARGE", 413)
                    hasher.update(block)
                    out.write(block)
                    if remaining is not None:
                        remaining -= len(block)
                require(size and (length is None or size == length), "The complete upload body was interrupted")
                out.flush()
                os.fsync(out.fileno())
            ident = hasher.hexdigest()
            destination = self.root / "objects" / ident
            if destination.exists():
                require(file_info(destination) == {"sha256": ident, "bytes": size}, "Retained packet bytes changed")
            else:
                os.link(name, destination)
                sync_dir(destination.parent)
            return {"sha256": ident, "bytes": size, "filename": "source-packet.zip"}
        finally:
            Path(name).unlink(missing_ok=True)

    def object(self, ident):
        path = self.root / "objects" / sha(ident)
        require(path.is_file() and not path.is_symlink(), "Retained packet was not found", "NOT_FOUND", 404)
        require(file_info(path)["sha256"] == ident, "The original packet bytes changed", "RETAINED_FILE_CHANGED", 409)
        return path

    def _prepare_source(self, payload):
        shape(payload, ("object", "standard", "label", "coverage", "selection"),
              ("object", "standard", "label", "coverage"))
        sha(payload["object"])
        require(payload["standard"] in {"iati", "360giving"}, "Select an original source standard")
        label = short(payload["label"], "Source label", 240)
        coverage = shape(payload["coverage"], ("statement", "sourceUrl", "observedAt", "license"),
                         ("statement", "sourceUrl", "observedAt", "license"))
        for key, maximum in (("statement", 8000), ("sourceUrl", 4096), ("observedAt", 100), ("license", 1000)):
            short(coverage[key], "Source " + key, maximum)
        require(re.match(r"https?://", coverage["sourceUrl"]) is not None, "Retain the publisher source URL")
        try:
            observed = dt.datetime.fromisoformat(coverage["observedAt"].replace("Z", "+00:00"))
            require(observed.tzinfo is not None, "Retain the capture timezone")
        except ValueError as error:
            raise InputError("Retain a valid source capture time") from error
        selected = {"object": payload["object"], "standard": payload["standard"], "label": label,
                    "coverage": coverage, "selection": payload.get("selection", {})}
        require(isinstance(selected["selection"], dict), "Source selection must be an object")
        ident = digest(selected)
        try:
            return {"source": self.source(ident), "existing": True}
        except InputError as error:
            if error.code != "NOT_FOUND":
                raise
        packet = self.object(selected["object"])
        folder = self.root / "sources" / ident
        receipt = run_projection(packet, selected["standard"], selected["selection"], folder)
        counts = {table: sum(1 for _ in rows_file(folder / (table + ".jsonl")))
                  for table in ("entities", "financial")}
        source = {"schema": SCHEMA + ".source", "id": ident, **selected,
                  "object": {"sha256": selected["object"], **file_info(packet), "filename": "source-packet.zip"},
                  "native": receipt["native"], "program": receipt["program"],
                  "projection": receipt["files"], "counts": counts}
        immutable(folder / "descriptor.json", canonical(source))
        return {"source": source, "folder": folder, "existing": False}

    def _commit_source(self, prepared):
        source = prepared["source"]
        previous = self.db.execute("SELECT body FROM sources WHERE id=?", (source["id"],)).fetchone()
        if previous:
            require(parse(previous[0]) == source, "An existing source edition differs", "SOURCE_CONFLICT", 409)
            return source
        for table in ("entities", "financial"):
            path = prepared["folder"] / (table + ".jsonl")
            require(file_info(path) == source["projection"][table + ".jsonl"], "Complete source projection changed")
            for original in rows_file(path):
                row = {**original, "sourceId": source["id"]}
                sha(row["entityKey"])
                require(row["standard"] == source["standard"], "Source projection standard differs")
                if table == "entities":
                    require(row["sha256"] == digest(row["original"]), "Complete original entity identity differs")
                    self.db.execute("INSERT INTO entities VALUES(?,?,?)",
                                    (source["id"], row["entityKey"], canonical(row).decode()))
                else:
                    sha(row["rowKey"])
                    self.db.execute("INSERT INTO financial VALUES(?,?,?,?)",
                                    (source["id"], row["rowKey"], row["entityKey"], canonical(row).decode()))
        self.db.execute("INSERT INTO sources VALUES(?,?)", (source["id"], canonical(source).decode()))
        return source

    def _selected(self, source_ids, overrides=None):
        sources, entities, financial = [], [], []
        overrides = overrides or {}
        with self.reader() as db:
            for ident in source_ids:
                if ident in overrides and not overrides[ident].get("existing"):
                    prepared = overrides[ident]
                    source = prepared["source"]
                    entities.extend({**row, "sourceId": ident}
                                    for row in rows_file(prepared["folder"] / "entities.jsonl"))
                    financial.extend({**row, "sourceId": ident}
                                     for row in rows_file(prepared["folder"] / "financial.jsonl"))
                else:
                    source = self.source(ident, db)
                    entities.extend(parse(row[0]) for row in db.execute("SELECT body FROM entities WHERE source_id=?", (ident,)))
                    financial.extend(parse(row[0]) for row in db.execute("SELECT body FROM financial WHERE source_id=?", (ident,)))
                sources.append(source)
        return sources, entities, financial

    def _prepare_revision(self, action, payload, request, previous=None, overrides=None):
        if action == "portfolio.save":
            shape(payload, ("id", "expectedPortfolioRevision", "name", "notes", "sources", "sourceReplacements", "review"),
                  ("name", "sources", "review"))
            ident = identifier(payload["id"]) if payload.get("id") else request["context"]["portfolioId"]
            if previous is None and payload.get("id"):
                previous = self.portfolio(ident)
            if previous:
                require(payload.get("expectedPortfolioRevision") == previous["revision"],
                        "The portfolio revision changed", "PORTFOLIO_REVISION_CONFLICT", 409)
            else:
                require("expectedPortfolioRevision" not in payload, "A new portfolio has no earlier revision")
            sources = payload["sources"]
            require(isinstance(sources, list) and 1 <= len(sources) <= MAX_SOURCES
                    and len(set(sources)) == len(sources), "Select 1–64 distinct complete source editions")
            for item in sources:
                sha(item)
            sources = sorted(sources)
            review = shape(payload["review"], ("status", "reviewer", "note"), ("status", "reviewer", "note"))
            require(review["status"] in {"draft", "reviewed", "needs-correction"}, "Select a portfolio review state")
            short(review["reviewer"], "Reviewer", 240)
            short(review["note"], "Review note", 8000, empty=True)
            definition = {"name": short(payload["name"], "Portfolio name", 240),
                          "notes": short(payload.get("notes", ""), "Notes", 16000, empty=True),
                          "sources": sources, "review": review}
            replacements = payload.get("sourceReplacements", [])
            require(isinstance(replacements, list), "Source replacements must be an explicit array")
        else:
            shape(payload, ("portfolioId", "expectedPortfolioRevision", "reviewer", "decisions"),
                  ("portfolioId", "expectedPortfolioRevision", "reviewer", "decisions"))
            ident = identifier(payload["portfolioId"])
            previous = previous or self.portfolio(ident)
            require(payload["expectedPortfolioRevision"] == previous["revision"],
                    "The portfolio revision changed", "PORTFOLIO_REVISION_CONFLICT", 409)
            definition = previous["definition"]
            replacements = []
        replace = {}
        old_sources = set(previous["sources"]) if previous else set()
        for pair in replacements:
            shape(pair, ("before", "after"), ("before", "after"))
            require(pair["before"] in old_sources - set(definition["sources"])
                    and pair["after"] in set(definition["sources"]) - old_sources
                    and pair["before"] not in replace and pair["after"] not in replace.values(),
                    "Pair each removed source edition with one distinct selected replacement")
            replace[pair["before"]] = pair["after"]
        selected_sources, entities, financial = self._selected(definition["sources"], overrides)
        require(len({ref_key(row) for row in entities}) == len(entities), "The original source repeats an entity identity")
        lookup = {ref_key(row): row for row in entities}
        decisions = reconcile_decisions(previous["decisions"], lookup, replace) if previous else []
        edit_payload = dict(payload)
        if action == "review.save":
            reviewer = short(payload["reviewer"], "Reviewer", 240)
            require(isinstance(payload["decisions"], list) and payload["decisions"], "Provide complete review decisions")
            merged, seen, normalized = {row["id"]: row for row in decisions}, set(), []
            for index, raw in enumerate(payload["decisions"]):
                raw = dict(raw)
                if not raw.get("id"):
                    raw["id"] = request["context"]["decisionIds"][index]
                require(raw["id"] not in seen, "A review batch repeats a decision identity")
                seen.add(raw["id"])
                decision = validate_decision(raw, lookup, reviewer, request["createdAt"])
                merged[decision["id"]] = decision
                normalized.append(raw)
            decisions = list(merged.values())
            edit_payload["decisions"] = normalized
        # Conflicting duplicate decisions require reopening the original decision.
        targets = {}
        for decision in decisions:
            if decision["status"] != "CURRENT":
                continue
            if decision["type"] == "link":
                target = digest([decision["relation"], sorted([decision["left"], decision["right"]],
                                key=lambda ref: (ref["sourceId"], ref["entityKey"]))])
            else:
                target = digest(["record", decision["record"]])
            require(target not in targets or targets[target] == decision["id"],
                    "This record relation already has a decision; update its original decision id",
                    "REVIEW_ALREADY_EXISTS", 409)
            targets[target] = decision["id"]
        decisions.sort(key=lambda row: row["id"])
        entity_rows = [compact_entity(row) for row in entities]
        states = {}
        for decision in decisions:
            for ref in decision_refs(decision):
                if ref_key(ref) in lookup:
                    status = "STALE" if decision["status"] == "STALE" else (
                        "LINKED" if decision["type"] == "link" and decision["disposition"] == "confirmed"
                        else decision["disposition"].upper())
                    states[ref_key(ref)] = status
            for reason in decision.get("staleReasons", []):
                if reason.get("current"):
                    states[ref_key(reason["current"])] = "STALE"
        for entity in entity_rows:
            entity["status"] = states.get(ref_key(entity), "UNREVIEWED")
        old_entities = self._selected(previous["sources"], overrides)[1] if previous else []
        changes = make_changes(old_entities, entities, replace)
        if previous:
            earlier = {row["id"]: row for row in previous["decisions"]}
            changes.extend({"id": digest(["review", row]), "kind": "review-updated", "decisionId": row["id"],
                            "disposition": row["disposition"]}
                           for row in decisions if earlier.get(row["id"]) != row)
        source_rows = [{k: source[k] for k in ("id", "standard", "label", "coverage", "selection", "counts", "object")}
                       for source in selected_sources]
        tables = {"sources": source_rows, "entities": entity_rows, "financial": financial,
                  "decisions": decisions,
                  "links": [row for row in decisions if row["type"] == "link" and row["status"] == "CURRENT"
                            and row["disposition"] == "confirmed"],
                  "candidates": review_queue(suggest(entity_rows), decisions), "changes": changes}
        for table, rows in tables.items():
            rows.sort(key=lambda row: self._row_key(table, row))
        version = previous["revision"] + 1 if previous else 1
        body = {"schema": SCHEMA, "id": ident, "revision": version,
                "previousSnapshot": previous["snapshot"] if previous else None,
                "createdAt": previous["createdAt"] if previous else request["createdAt"],
                "updatedAt": request["createdAt"], "definition": definition, **definition,
                "sourceReplacements": replacements, "decisions": decisions,
                "counts": {table: len(rows) for table, rows in tables.items()},
                "financialTotals": financial_totals(financial),
                "tableSha256": {table: digest(b"".join(canonical(row) for row in rows)) for table, rows in tables.items()},
                "edit": {"action": action, "payload": edit_payload, "at": request["createdAt"],
                         "portfolioId": ident, "decisionIds": [row["id"] for row in edit_payload.get("decisions", [])]},
                "operationId": request["id"]}
        body["snapshot"] = digest(body)
        return {"portfolio": body, "tables": tables, "previous": previous}

    @staticmethod
    def _row_key(table, row):
        if table == "entities":
            return row["sourceId"] + ":" + row["entityKey"]
        if table == "financial":
            return row["sourceId"] + ":" + row["rowKey"]
        return row["id"]

    def _commit_revision(self, prepared):
        body, previous = prepared["portfolio"], prepared["previous"]
        existing = self.db.execute("SELECT body FROM portfolios WHERE id=? AND revision=?",
                                   (body["id"], body["revision"])).fetchone()
        if existing:
            require(parse(existing[0]) == body, "Incoming portfolio revision conflicts with the original",
                    "PORTFOLIO_REVISION_CONFLICT", 409)
            return body
        latest = self.db.execute("SELECT revision,snapshot FROM portfolios WHERE id=? ORDER BY revision DESC LIMIT 1",
                                 (body["id"],)).fetchone()
        require((latest is None and previous is None) or (latest and previous
                and latest["revision"] == previous["revision"] and latest["snapshot"] == previous["snapshot"]),
                "The original portfolio changed before saving", "PORTFOLIO_REVISION_CONFLICT", 409)
        self.db.execute("INSERT INTO portfolios VALUES(?,?,?,?)",
                        (body["id"], body["revision"], body["snapshot"], canonical(body).decode()))
        for table, rows in prepared["tables"].items():
            for row in rows:
                searchable = " ".join(str(row.get(key, "")) for key in
                                      ("title", "originalId", "name", "label", "rationale", "leftTitle", "rightTitle", "kind"))
                self.db.execute("INSERT INTO derived VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (body["id"], body["revision"], table, self._row_key(table, row),
                     row.get("entityKey", ""), row.get("sourceId", ""),
                     row.get("status", row.get("kind", "")), row.get("standard", ""),
                     searchable.casefold(), canonical(row).decode()))
        return body

    def rows(self, ident, version, table, offset=0, limit=50, search="", status="", standard="", entityKey=""):
        require(table in TABLES, "Select a portfolio table")
        require(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 250,
                "Use a nonnegative offset and a 1–250 row page")
        short(search, "Search", 1000, empty=True)
        where, args = "portfolio_id=? AND revision=? AND table_name=?", [identifier(ident), revision(version), table]
        for key, value in (("status", status), ("standard", standard), ("entity_key", entityKey)):
            if value:
                where += " AND " + key + "=?"
                args.append(value)
        if search:
            where += " AND instr(search,?)>0"
            args.append(search.casefold())
        with self.reader() as db:
            portfolio = self.portfolio(ident, version, db)
            total = db.execute("SELECT COUNT(*) FROM derived WHERE " + where, args).fetchone()[0]
            result = [parse(row[0]) for row in db.execute("SELECT body FROM derived WHERE " + where
                        + " ORDER BY row_key LIMIT ? OFFSET ?", [*args, limit, offset])]
            return {"rows": result, "total": total, "offset": offset,
                    "nextOffset": offset + len(result) if offset + len(result) < total else None,
                    "revision": version, "snapshot": portfolio["snapshot"]}

    def detail(self, ident, version, source_id, entity_key_value):
        sha(source_id), sha(entity_key_value)
        with self.reader() as db:
            portfolio = self.portfolio(ident, version, db)
            require(source_id in portfolio["sources"], "The source is outside this saved revision")
            row = db.execute("SELECT body FROM entities WHERE source_id=? AND entity_key=?",
                             (source_id, entity_key_value)).fetchone()
            require(row is not None, "Original record was not found", "NOT_FOUND", 404)
            return {"portfolioId": ident, "revision": version, "snapshot": portfolio["snapshot"],
                    "entity": parse(row[0]), "source": self.source(source_id, db),
                    "financial": [parse(item[0]) for item in db.execute(
                        "SELECT body FROM financial WHERE source_id=? AND entity_key=? ORDER BY row_key",
                        (source_id, entity_key_value))]}

    def execute(self, ident):
        with self.execution:
            request = self.request(ident)
            if request["state"] == "COMPLETED":
                return request
            original = request["input"]
            require(request["inputSha256"] == digest(original), "Saved operation input changed")
            with self.transaction():
                request.update(state="RUNNING", updatedAt=now())
                request.pop("error", None)
                self._store_request(request)
            try:
                expected = original.get("expectedRevision")
                if expected is not None:
                    require(expected == self.current_revision(), "The workspace revision changed",
                            "WORKSPACE_REVISION_CONFLICT", 409)
                action, payload = original["action"], original["payload"]
                if action == "source.receive":
                    prepared = self._prepare_source(payload)
                elif action in {"portfolio.save", "review.save"}:
                    prepared = self._prepare_revision(action, payload, request)
                elif action == "portfolio.export":
                    prepared = self._prepare_export(payload)
                else:
                    prepared = self._prepare_receive(payload)
                with self.transaction():
                    if expected is not None:
                        require(expected == self.current_revision(self.db), "The workspace revision changed",
                                "WORKSPACE_REVISION_CONFLICT", 409)
                    if action == "source.receive":
                        result = self._commit_source(prepared)
                    elif action in {"portfolio.save", "review.save"}:
                        result = self._commit_revision(prepared)
                    elif action == "portfolio.export":
                        result = prepared
                        self.db.execute("INSERT OR IGNORE INTO exports VALUES(?,?)",
                                        (result["sha256"], canonical(result).decode()))
                    else:
                        for source in prepared["sources"].values():
                            self._commit_source(source)
                        for item in prepared["history"]:
                            self._commit_revision(item)
                        result = prepared["result"]
                    self.db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
                    request.update(state="COMPLETED", updatedAt=now(), result=result,
                                   workspaceRevision=self.current_revision(self.db))
                    self._store_request(request)
                return request
            except BaseException as error:
                with self.transaction():
                    request.update(state="FAILED", updatedAt=now(), error={
                        "code": getattr(error, "code", type(error).__name__), "message": str(error),
                        "retryable": not isinstance(error, InputError) or error.code == "NATIVE_RECEIVING_FAILED"})
                    self._store_request(request)
                if isinstance(error, (KeyboardInterrupt, SystemExit)):
                    raise
                return request

    def _prepare_export(self, payload):
        shape(payload, ("portfolioId", "revision"), ("portfolioId", "revision"))
        selected = self.portfolio(payload["portfolioId"], payload["revision"])
        folder = self.root / "exports" / selected["snapshot"]
        folder.mkdir(mode=0o700, exist_ok=True)
        final = folder / "grant-portfolio-complete.zip"
        if final.exists():
            self._verify_packet(final)
            return {**file_info(final), "filename": "Grant_Portfolio_" + selected["id"] + "_r"
                    + str(selected["revision"]) + ".zip", "portfolioId": selected["id"],
                    "revision": selected["revision"], "snapshot": selected["snapshot"]}
        with self.reader() as db:
            history = [parse(row[0]) for row in db.execute(
                "SELECT body FROM portfolios WHERE id=? AND revision<=? ORDER BY revision",
                (selected["id"], selected["revision"]))]
            source_ids = sorted({source for item in history for source in item["sources"]})
            source_rows = [self.source(ident, db) for ident in source_ids]
            operation_ids = {item["operationId"] for item in history}
            requests = []
            for row in db.execute("SELECT body FROM requests ORDER BY id"):
                request = parse(row[0])
                if request["id"] in operation_ids or (request["action"] == "source.receive"
                    and request["state"] == "COMPLETED" and request["result"]["id"] in source_ids):
                    requests.append(request)
            files = {}
            def save(name, data):
                path = folder / "files" / PurePosixPath(name)
                immutable(path, data)
                files[name] = path
            save("history.json", canonical(history))
            save("requests.json", canonical(requests))
            for source in source_rows:
                prefix = "sources/" + source["id"] + "/"
                save(prefix + "descriptor.json", canonical(source))
                files[prefix + "source-packet.zip"] = self.object(source["object"]["sha256"])
            for item in history:
                for table in TABLES:
                    name = "rows/" + str(item["revision"]) + "/" + table + ".jsonl"
                    data = b"".join(row[0].encode() for row in db.execute(
                        "SELECT body FROM derived WHERE portfolio_id=? AND revision=? AND table_name=? ORDER BY row_key",
                        (item["id"], item["revision"], table)))
                    require(digest(data) == item["tableSha256"][table], "Saved portfolio table changed")
                    save(name, data)
        from managed import sourceFileList
        for name in sourceFileList():
            files["runtime/sf30-seller-sdk/" + name] = SDK / name
        save("README.md", ("# Complete grant portfolio\n\nUse runtime/sf30-seller-sdk/grant-portfolio/RECEIVING.md "
            "with the installed original application to receive this archive. Each source packet, complete revision, "
            "review decision and original financial record is retained. Financial groups preserve source, currency "
            "and meaning. Source links are reviewed relationships; linked amounts remain separately reported.\n").encode())
        manifest = {"schema": PACKET, "workspaceId": self.marker["workspaceId"], "portfolioId": selected["id"],
                    "revision": selected["revision"], "snapshot": selected["snapshot"],
                    "files": {name: file_info(path) for name, path in sorted(files.items())}}
        pending = folder / "grant-portfolio-complete.pending"
        with zipfile.ZipFile(pending, "w", allowZip64=True) as archive:
            for name, path in sorted(files.items()):
                info = zipfile.ZipInfo(name)
                info.external_attr = 0o100600 << 16
                with archive.open(info, "w", force_zip64=True) as output, path.open("rb") as source:
                    shutil.copyfileobj(source, output, 1024 * 1024)
            archive.writestr("manifest.json", canonical(manifest))
        require(pending.stat().st_size <= MAX_PACKET, "The complete handoff exceeds 4 GiB")
        self._verify_packet(pending)
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(pending, final)
        sync_dir(folder)
        return {**file_info(final), "filename": "Grant_Portfolio_" + selected["id"] + "_r"
                + str(selected["revision"]) + ".zip", "portfolioId": selected["id"],
                "revision": selected["revision"], "snapshot": selected["snapshot"]}

    def export_file(self, ident):
        with self.reader() as db:
            row = db.execute("SELECT body FROM exports WHERE id=?", (sha(ident),)).fetchone()
            require(row is not None, "Completed handoff was not found", "NOT_FOUND", 404)
            descriptor = parse(row[0])
        path = self.root / "exports" / descriptor["snapshot"] / "grant-portfolio-complete.zip"
        require(file_info(path) == {key: descriptor[key] for key in ("sha256", "bytes")},
                "The complete original handoff changed")
        return path, descriptor

    def _verify_packet(self, packet):
        require(packet.stat().st_size <= MAX_PACKET, "Complete handoff exceeds 4 GiB")
        with zipfile.ZipFile(packet) as archive:
            entries = archive.infolist()
            require(len(entries) <= 100000, "Complete handoff has too many members")
            names, total = set(), 0
            for entry in entries:
                name = entry.filename
                require(name not in names and name and "\\" not in name and not name.startswith("/")
                        and all(part not in ("", ".", "..") for part in name.split("/"))
                        and not any(ord(char) < 32 for char in name) and not entry.is_dir(),
                        "The complete handoff has an unsafe or repeated member")
                mode = entry.external_attr >> 16
                require(not stat.S_ISLNK(mode) and not entry.flag_bits & 1, "Use ordinary unencrypted handoff files")
                names.add(name)
                total += entry.file_size
            require(total <= 8 * MAX_PACKET, "The expanded complete handoff exceeds 32 GiB")
            require("manifest.json" in names and archive.getinfo("manifest.json").file_size <= 64 * 1024 * 1024,
                    "The complete handoff needs one bounded manifest")
            manifest = parse(archive.read("manifest.json"))
            shape(manifest, ("schema", "workspaceId", "portfolioId", "revision", "snapshot", "files"),
                  ("schema", "workspaceId", "portfolioId", "revision", "snapshot", "files"))
            require(manifest["schema"] == PACKET and isinstance(manifest["files"], dict), "Select a complete grant portfolio handoff")
            identifier(manifest["workspaceId"]), identifier(manifest["portfolioId"])
            revision(manifest["revision"]), sha(manifest["snapshot"])
            require(set(manifest["files"]) == names - {"manifest.json"}, "Every complete handoff member must be declared")
            for name, expected in manifest["files"].items():
                shape(expected, ("sha256", "bytes"), ("sha256", "bytes"))
                sha(expected["sha256"])
                require(type(expected["bytes"]) is int and expected["bytes"] == archive.getinfo(name).file_size,
                        "Complete handoff member length differs: " + name)
                count, hasher = 0, hashlib.sha256()
                with archive.open(name) as stream:
                    while block := stream.read(1024 * 1024):
                        count += len(block)
                        hasher.update(block)
                require({"bytes": count, "sha256": hasher.hexdigest()} == expected,
                        "Complete handoff member bytes differ: " + name)
        return manifest

    def _prepare_receive(self, payload):
        shape(payload, ("object",), ("object",))
        packet = self.object(payload["object"])
        manifest = self._verify_packet(packet)
        folder = self.root / "received" / payload["object"]
        folder.mkdir(mode=0o700, exist_ok=True)
        prepared_sources, prepared_history = {}, []
        with zipfile.ZipFile(packet) as archive:
            required = {"history.json", "requests.json", "README.md"}
            require(required <= set(manifest["files"]), "The complete history or receiving guide is missing")
            history = parse(archive.read("history.json"))
            requests = parse(archive.read("requests.json"))
            require(isinstance(history, list) and len(history) == manifest["revision"] and isinstance(requests, list),
                    "Retain the complete portfolio revision and request sequence")
            source_ids = sorted({source for item in history for source in item["sources"]})
            expected_data = set(required)
            for ident in source_ids:
                sha(ident)
                prefix = "sources/" + ident + "/"
                expected_data.update((prefix + "descriptor.json", prefix + "source-packet.zip"))
                source = parse(archive.read(prefix + "descriptor.json"))
                with archive.open(prefix + "source-packet.zip") as stream:
                    uploaded = self.upload(stream, archive.getinfo(prefix + "source-packet.zip").file_size)
                require(uploaded["sha256"] == source["object"]["sha256"] and source["id"] == ident,
                        "The retained original source packet selection differs")
                original_input = {key: source[key] for key in ("standard", "label", "coverage", "selection")}
                original_input["object"] = source["object"]["sha256"]
                prepared = self._prepare_source(original_input)
                # A receiving machine may have a different installed source closure; all native data must reconstruct.
                stable = ("schema", "id", "object", "standard", "label", "coverage", "selection", "counts", "projection")
                require(all(prepared["source"][key] == source[key] for key in stable),
                        "The original source does not reconstruct its complete native records")
                prepared_sources[ident] = prepared
            previous = None
            for version, original in enumerate(history, 1):
                require(original["id"] == manifest["portfolioId"] and original["revision"] == version
                        and original["schema"] == SCHEMA, "The complete portfolio history has an invalid sequence")
                require(original["snapshot"] == digest({k: v for k, v in original.items() if k != "snapshot"}),
                        "The saved original portfolio snapshot differs")
                edit = original["edit"]
                shape(edit, ("action", "payload", "at", "portfolioId", "decisionIds"),
                      ("action", "payload", "at", "portfolioId", "decisionIds"))
                require(edit["action"] in {"portfolio.save", "review.save"} and edit["portfolioId"] == original["id"],
                        "The saved original revision operation differs")
                request = {"id": operation(original["operationId"]), "createdAt": edit["at"],
                           "context": {"portfolioId": edit["portfolioId"], "decisionIds": edit["decisionIds"]}}
                rebuilt = self._prepare_revision(edit["action"], edit["payload"], request, previous, prepared_sources)
                require(rebuilt["portfolio"] == original, "The complete source, review and revision history does not reconstruct")
                for table in TABLES:
                    name = "rows/" + str(version) + "/" + table + ".jsonl"
                    expected_data.add(name)
                    require(name in manifest["files"] and digest(b"".join(canonical(row) for row in rebuilt["tables"][table]))
                            == manifest["files"][name]["sha256"] == original["tableSha256"][table],
                            "A complete receiving portfolio table differs: " + table)
                prepared_history.append(rebuilt)
                previous = original
            require(previous["snapshot"] == manifest["snapshot"], "The original final revision differs")
            from managed import sourceFileList
            require(all("runtime/sf30-seller-sdk/" + name in manifest["files"] for name in sourceFileList()),
                    "The complete original application source is missing")
            require({name for name in manifest["files"] if not name.startswith("runtime/")} == expected_data,
                    "The complete handoff has missing or undeclared domain members")
            for request in requests:
                require(request["inputSha256"] == digest(request["input"]) and request["state"] == "COMPLETED",
                        "The retained original request input or result differs")
                operation(request["id"])
            # Preserve the entire archive and original request history under its original identity.
            immutable(folder / "manifest.json", canonical(manifest))
            immutable(folder / "original-requests.json", canonical(requests))
        return {"sources": prepared_sources, "history": prepared_history,
                "result": {"schema": SCHEMA + ".received", "object": payload["object"],
                    "sourceWorkspaceId": manifest["workspaceId"], "workspaceId": self.marker["workspaceId"],
                    "portfolioId": manifest["portfolioId"], "revision": manifest["revision"],
                    "snapshot": manifest["snapshot"], "sources": len(prepared_sources),
                    "historyCount": len(prepared_history), "reconstructed": True}}
