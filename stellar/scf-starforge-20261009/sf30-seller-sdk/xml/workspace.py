"""MIT. Retained XML editions, mappings, native builds and portable customer handoff."""
from __future__ import annotations

from contextlib import contextmanager
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import queue
import re
import shutil
import sqlite3
import stat
import subprocess
import tempfile
import threading
import time
import zipfile

from xml_source import InputError, MAX_SOURCE, inventory, validate_plan, extract, dataset_spec

HERE = Path(__file__).resolve().parent
HEX = re.compile(r"[0-9a-f]{64}\Z")
VERSION = "stellar-forge.xml-workspace.v1"
BUILD = "stellar-forge.xml-build.v1"
PACKET = "stellar-forge.xml-packet.v1"


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def load_json(data: bytes | str):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise InputError(f"Duplicate JSON field: {key}")
            result[key] = value
        return result
    def constant(_):
        raise InputError("Non-finite JSON numbers are not accepted")
    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError) as e:
        raise InputError("Invalid UTF-8 JSON") from e


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked_id(value: str) -> str:
    if not isinstance(value, str) or not HEX.fullmatch(value):
        raise InputError("Expected a complete retained source, mapping or build ID")
    return value


def private_write(path: Path, data: bytes):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def regular(path: Path, max_bytes: int = MAX_SOURCE):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > max_bytes:
        raise InputError("Expected a private single-link regular file within the size limit")
    if os.name == "posix" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
        raise InputError("Workspace files must be owned by the operator and private")
    return info


def file_digest(path: Path, limit: int = MAX_SOURCE) -> str:
    regular(path, limit)
    h = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        while block := stream.read(1048576):
            total += len(block)
            if total > limit:
                raise InputError("File exceeds its declared size limit")
            h.update(block)
    return h.hexdigest()


def sync_dir(path: Path):
    if os.name == "posix":
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


class NativeEngine:
    """One serialized original Node engine per workspace; discard it on timeout."""
    def __init__(self):
        self.process = None
        self.lock = threading.RLock()
        self.sequence = 0
        self.replies = queue.Queue(maxsize=2)
        self.errors = None

    def _start(self):
        self.replies = queue.Queue(maxsize=2)
        self.errors = tempfile.TemporaryFile()
        try:
            self.process = subprocess.Popen(
                [os.environ.get("SF30_XML_NODE", "node"), "--max-old-space-size=1024", str(HERE / "native.mjs")],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors, bufsize=-1)
        except OSError as e:
            self.errors.close()
            self.errors = None
            raise InputError("Node 22 is required for the original SF30 dataset engine; set SF30_XML_NODE if needed") from e
        process, replies = self.process, self.replies
        def read():
            try:
                while line := process.stdout.readline(2 * 1024 * 1024):
                    if not line.endswith(b"\n"):
                        raise InputError("Native response exceeded the protocol limit")
                    replies.put(line)
            except Exception:
                pass
            finally:
                try:
                    replies.put_nowait(None)
                except queue.Full:
                    pass
        threading.Thread(target=read, daemon=True).start()

    def query(self, config: Path, query: dict | None = None) -> dict:
        with self.lock:
            if self.process is None:
                self._start()
            self.sequence += 1
            request = json_bytes({"id": self.sequence, "config": str(config), "query": query or {}})
            if len(request) > 65536:
                raise InputError("Native query exceeds 64 KiB")
            try:
                self.process.stdin.write(request)
                self.process.stdin.flush()
                raw = self.replies.get(timeout=120)
                if raw is None:
                    raise InputError("Original dataset engine exited while loading; reduce declared data size or available-memory pressure")
                result = load_json(raw)
                if result.get("id") != self.sequence:
                    raise InputError("Native response identity mismatch")
                if not result.get("ok"):
                    raise InputError(result.get("error", "Original dataset engine rejected the input"))
                return result
            except queue.Empty as e:
                self.close()
                raise InputError("Original dataset operation exceeded 120 seconds; retained inputs remain available") from e
            except (OSError, InputError):
                self.close()
                raise

    def close(self):
        with self.lock:
            if self.process is not None:
                p, self.process = self.process, None
                try:
                    p.stdin.close()
                    p.wait(timeout=3)
                except (OSError, subprocess.TimeoutExpired):
                    p.kill()
                    p.wait()
                finally:
                    p.stdout.close()
            if self.errors is not None:
                self.errors.close()
                self.errors = None


class Workspace:
    def __init__(self, root: str | Path, create: bool = False):
        root = Path(root).expanduser().absolute()
        if create:
            root.mkdir(mode=0o700, parents=True, exist_ok=False)
            for name in ["sources", "plans", "builds", "comparisons", "tmp"]:
                (root / name).mkdir(mode=0o700)
            private_write(root / "workspace.json", json_bytes({"schema": VERSION}))
        self.root = root.resolve(strict=True)
        info = self.root.stat()
        if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise InputError("Use a private, operator-owned workspace directory (mode 0700)")
        regular(self.root / "workspace.json", 4096)
        if load_json((self.root / "workspace.json").read_bytes()) != {"schema": VERSION}:
            raise InputError("Unsupported XML workspace version")
        for name in ["sources", "plans", "builds", "comparisons", "tmp"]:
            p = self.root / name
            if p.is_symlink() or not p.is_dir():
                raise InputError("Workspace directories must be real directories")
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        self.lease = os.fdopen(os.open(self.root / ".lock", flags, 0o600), "r+b", buffering=0)
        try:
            if os.name == "posix":
                import fcntl
                fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            else:
                import msvcrt
                if not self.lease.read(1):
                    self.lease.write(b"0")
                self.lease.seek(0)
                msvcrt.locking(self.lease.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as e:
            self.lease.close()
            raise InputError("This XML workspace is already open; use its existing console or close that process") from e
        db_path = self.root / "workspace.sqlite"
        if not db_path.exists():
            private_write(db_path, b"")
        regular(db_path)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=DELETE;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,label TEXT NOT NULL,name TEXT NOT NULL,
                bytes INTEGER NOT NULL,inventory TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,body TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS builds(id TEXT PRIMARY KEY,source TEXT REFERENCES sources(id),
                plan TEXT REFERENCES plans(id),review TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,before_id TEXT REFERENCES builds(id),
                after_id TEXT REFERENCES builds(id),summary TEXT NOT NULL,created REAL NOT NULL);
        """)
        self.mutex = threading.RLock()
        self.native = NativeEngine()

    def close(self):
        self.native.close()
        self.db.close()
        self.lease.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    @contextmanager
    def scratch(self):
        path = Path(tempfile.mkdtemp(prefix="operation-", dir=self.root / "tmp"))
        try:
            yield path
        finally:
            shutil.rmtree(path, ignore_errors=True)

    def state(self) -> dict:
        with self.mutex:
            return {"schema": VERSION,
                "sources": [dict(r) for r in self.db.execute("SELECT id,label,name,bytes,created FROM sources ORDER BY created DESC")],
                "plans": [{"id": r["id"], "name": load_json(r["body"])["name"], "created": r["created"]}
                          for r in self.db.execute("SELECT * FROM plans ORDER BY created DESC")],
                "builds": [load_json(r["review"]) for r in self.db.execute("SELECT review FROM builds ORDER BY created DESC")],
                "comparisons": [load_json(r["summary"]) for r in self.db.execute("SELECT summary FROM comparisons ORDER BY created DESC")]}

    def source(self, ident: str) -> dict:
        with self.mutex:
            row = self.db.execute("SELECT * FROM sources WHERE id=?", (checked_id(ident),)).fetchone()
            if row is None:
                raise InputError("Unknown retained source")
            result = dict(row)
            result["inventory"] = load_json(result["inventory"])
            return result

    def add_source(self, stream, label: str = "XML source", name: str = "source.xml") -> dict:
        if not isinstance(label, str) or not label.strip() or len(label) > 160:
            raise InputError("Source label must be 1–160 characters")
        name = Path(name.replace("\\", "/")).name[:160]
        with self.mutex, self.scratch() as temp:
            target = temp / "source.xml"
            h, total = hashlib.sha256(), 0
            with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
                while block := stream.read(65536):
                    total += len(block)
                    if total > MAX_SOURCE:
                        raise InputError("XML source exceeds 256 MiB")
                    h.update(block)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            ident = h.hexdigest()
            if self.db.execute("SELECT 1 FROM sources WHERE id=?", (ident,)).fetchone():
                if file_digest(self.root / "sources" / (ident + ".xml")) != ident:
                    raise InputError("Retained source bytes were changed")
                return self.source(ident)
            with target.open("rb") as input_file:
                shape = inventory(input_file)
            destination = self.root / "sources" / (ident + ".xml")
            if destination.exists():
                if file_digest(destination) != ident:
                    raise InputError("Retained source path contains different bytes")
            else:
                os.replace(target, destination)
                sync_dir(destination.parent)
            with self.db:
                self.db.execute("INSERT INTO sources VALUES(?,?,?,?,?,?)", (ident, label, name, total,
                                json_bytes(shape).decode(), time.time()))
            return self.source(ident)

    def save_plan(self, raw: dict) -> dict:
        plan = validate_plan(raw)
        data = json_bytes(plan)
        if len(data) > 65536:
            raise InputError("Mapping exceeds 64 KiB")
        ident = digest(data)
        with self.mutex:
            path = self.root / "plans" / (ident + ".json")
            if path.exists():
                if file_digest(path, 65536) != ident:
                    raise InputError("Retained mapping bytes were changed")
            else:
                private_write(path, data)
                sync_dir(path.parent)
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO plans VALUES(?,?,?)", (ident, data.decode(), time.time()))
            return {"id": ident, "plan": plan}

    def plan(self, ident: str) -> dict:
        checked_id(ident)
        with self.mutex:
            if not self.db.execute("SELECT 1 FROM plans WHERE id=?", (ident,)).fetchone():
                raise InputError("Unknown retained mapping")
            path = self.root / "plans" / (ident + ".json")
            if file_digest(path, 65536) != ident:
                raise InputError("Retained mapping bytes were changed")
            return load_json(path.read_bytes())

    def build_view(self, ident: str) -> dict:
        checked_id(ident)
        with self.mutex:
            row = self.db.execute("SELECT review FROM builds WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise InputError("Unknown completed build")
            return load_json(row["review"])

    def _build_path(self, ident: str, name: str) -> Path:
        view = self.build_view(ident)
        limits = {"data.csv": MAX_SOURCE, "dataset.json": 65536, "review.json": 131072,
                  "rows.sqlite": 4 * MAX_SOURCE}
        if name not in limits:
            raise InputError("Unknown native build artifact")
        path = self.root / "builds" / ident / name
        regular(path, limits[name])
        if name == "review.json" and path.read_bytes() != json_bytes(view):
            raise InputError("Completed review bytes were changed")
        if name in view["files"] and file_digest(path, limits[name]) != view["files"][name]["sha256"]:
            raise InputError("Completed build artifact was changed")
        return path

    def build(self, source_id: str, plan_id: str, expected: dict | None = None) -> dict:
        with self.mutex:
            self.source(source_id)
            plan = self.plan(plan_id)
            ident = digest(json_bytes({"schema": BUILD, "source": source_id, "plan": plan_id}))
            if self.db.execute("SELECT 1 FROM builds WHERE id=?", (ident,)).fetchone():
                result = self.build_view(ident)
                for name in ["data.csv", "dataset.json", "rows.sqlite"]:
                    self._build_path(ident, name)
                self._expected(result, expected)
                return result
            source_path = self.root / "sources" / (source_id + ".xml")
            if file_digest(source_path) != source_id:
                raise InputError("Retained source bytes were changed")
            with self.scratch() as temp:
                data_path = temp / "data.csv"
                private_write(temp / "rows.sqlite", b"")
                index = sqlite3.connect(temp / "rows.sqlite")
                index.executescript("PRAGMA journal_mode=OFF; CREATE TABLE rows(ordinal INTEGER PRIMARY KEY,k TEXT UNIQUE NOT NULL,cells TEXT NOT NULL,values_json TEXT NOT NULL);")
                names = [c["name"] for c in plan["columns"]]
                key_indexes = [names.index(k) for k in plan["keys"]]
                stats = [{"column": name, "emptyCells": 0, "nullValues": 0} for name in names]
                try:
                    with os.fdopen(os.open(data_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8", newline="") as output:
                        writer = csv.writer(output, lineterminator="\n")
                        writer.writerow(names)
                        def record(ordinal, cells, values):
                            writer.writerow(cells)
                            if output.tell() > plan["maxBytes"]:
                                raise InputError("Projected CSV exceeds maxBytes")
                            key = [values[i] for i in key_indexes] if key_indexes else [ordinal]
                            if key_indexes and any(value is None or value == "" for value in key):
                                raise InputError(f"Record {ordinal}: edition key is empty")
                            try:
                                index.execute("INSERT INTO rows VALUES(?,?,?,?)", (ordinal,
                                    json_bytes(key).decode(), json_bytes(cells).decode(), json_bytes(values).decode()))
                            except sqlite3.IntegrityError as e:
                                raise InputError(f"Record {ordinal}: duplicate edition key; select a unique key or remove edition comparison") from e
                            for i, value in enumerate(values):
                                stats[i]["emptyCells"] += cells[i] == ""
                                stats[i]["nullValues"] += value is None
                        with source_path.open("rb") as stream:
                            count = extract(stream, plan, record)
                        output.flush()
                        os.fsync(output.fileno())
                    if count == 0 and not plan["allowEmpty"]:
                        raise InputError("Record selector matched zero elements; review the path or explicitly allow an empty edition")
                    index.commit()
                finally:
                    index.close()
                private_write(temp / "dataset.json", (json.dumps(dataset_spec(plan), ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode())
                native = self.native.query(temp / "dataset.json", {"limit": "1"})
                if native["response"]["status"] != 200 or native["dataset"]["rowCount"] != count:
                    raise InputError("Original SF30 engine did not accept the complete projection")
                files = {name: {"bytes": (temp / name).stat().st_size,
                                "sha256": file_digest(temp / name, 4 * MAX_SOURCE)}
                         for name in ["data.csv", "dataset.json", "rows.sqlite"]}
                result = {"schema": BUILD, "id": ident, "source": source_id, "plan": plan_id,
                          "rowCount": count, "keys": plan["keys"], "columns": stats,
                          "native": native["dataset"], "engineBlob": native["engineBlob"], "files": files}
                self._expected(result, expected)
                private_write(temp / "review.json", json_bytes(result))
                # A directory left by a crash is recovered only when every byte matches.
                destination = self.root / "builds" / ident
                if destination.exists():
                    if destination.is_symlink() or any(not (destination / n).is_file() or
                            file_digest(destination / n, 4 * MAX_SOURCE) != file_digest(temp / n, 4 * MAX_SOURCE)
                            for n in ["data.csv", "dataset.json", "rows.sqlite", "review.json"]):
                        raise InputError("An unfinished build conflicts with this deterministic build; preserve it for inspection")
                else:
                    os.replace(temp, destination)
                    sync_dir(destination.parent)
                with self.db:
                    self.db.execute("INSERT INTO builds VALUES(?,?,?,?,?)", (ident, source_id, plan_id, json_bytes(result).decode(), time.time()))
                return result

    @staticmethod
    def _expected(result, expected):
        if expected is not None and (result["files"]["data.csv"]["sha256"] != expected["files"]["data.csv"]["sha256"] or
                                    result["files"]["dataset.json"]["sha256"] != expected["files"]["dataset.json"]["sha256"] or
                                    result["native"]["snapshot"] != expected["native"]["snapshot"]):
            raise InputError("Packet reconstruction differs from the exported native dataset")

    def query(self, build_id: str, params: dict) -> dict:
        if not isinstance(params, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in params.items()):
            raise InputError("Native query parameters must be scalar strings")
        with self.mutex:
            # Byte checks happen before loading a new immutable native selection.
            config = self._build_path(build_id, "dataset.json")
            self._build_path(build_id, "data.csv")
            return self.native.query(config, params)

    @contextmanager
    def _comparison_connection(self, before_id: str, after_id: str):
        before, after = self.build_view(before_id), self.build_view(after_id)
        if before["plan"] != after["plan"] or not after["keys"]:
            raise InputError("Edition comparison requires the same mapping with explicit unique keys; build both editions with that mapping")
        before_path = self._build_path(before_id, "rows.sqlite")
        after_path = self._build_path(after_id, "rows.sqlite")
        db = sqlite3.connect(after_path.as_uri() + "?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        try:
            db.execute("ATTACH DATABASE ? AS old", (before_path.as_uri() + "?mode=ro",))
            db.execute("BEGIN")
            yield db, before, after
        finally:
            db.close()

    def compare(self, before_id: str, after_id: str) -> dict:
        with self.mutex:
            ident = digest(json_bytes({"schema": "stellar-forge.xml-comparison.v1", "before": before_id, "after": after_id}))
            existing = self.db.execute("SELECT summary FROM comparisons WHERE id=?", (ident,)).fetchone()
            if existing:
                return load_json(existing["summary"])
            with self._comparison_connection(before_id, after_id) as (db, before, after), self.scratch() as temp:
                counts = {"added": 0, "removed": 0, "changed": 0, "unchanged": 0}
                plan = self.plan(after["plan"])
                names = [c["name"] for c in plan["columns"]]
                sql = """SELECT a.k,a.cells AS after_cells,b.cells AS before_cells,a.ordinal AS after_row,b.ordinal AS before_row
                    FROM main.rows a LEFT JOIN old.rows b ON b.k=a.k
                    UNION ALL SELECT b.k,NULL,b.cells,NULL,b.ordinal FROM old.rows b
                    LEFT JOIN main.rows a ON a.k=b.k WHERE a.k IS NULL ORDER BY 1"""
                with os.fdopen(os.open(temp / "changes.jsonl", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                    for row in db.execute(sql):
                        if row["before_cells"] == row["after_cells"]:
                            counts["unchanged"] += 1
                            continue
                        kind = "added" if row["before_cells"] is None else "removed" if row["after_cells"] is None else "changed"
                        counts[kind] += 1
                        left = load_json(row["before_cells"]) if row["before_cells"] is not None else None
                        right = load_json(row["after_cells"]) if row["after_cells"] is not None else None
                        out.write(json_bytes({"kind": kind, "key": load_json(row["k"]),
                            "beforeRow": row["before_row"], "afterRow": row["after_row"],
                            "before": dict(zip(names, left)) if left is not None else None,
                            "after": dict(zip(names, right)) if right is not None else None,
                            "fields": [name for i, name in enumerate(names) if left is None or right is None or left[i] != right[i]]}))
                    out.flush()
                    os.fsync(out.fileno())
                summary = {"schema": "stellar-forge.xml-comparison.v1", "id": ident,
                    "before": before_id, "after": after_id, "plan": after["plan"], "keys": after["keys"],
                    "semantics": "exact projected CSV cells; record order changes are not field changes",
                    "counts": counts, "changesSha256": file_digest(temp / "changes.jsonl", 4 * MAX_SOURCE)}
                private_write(temp / "summary.json", json_bytes(summary))
                destination = self.root / "comparisons" / ident
                if destination.exists():
                    if destination.is_symlink() or (destination / "summary.json").read_bytes() != json_bytes(summary) or file_digest(destination / "changes.jsonl", 4 * MAX_SOURCE) != summary["changesSha256"]:
                        raise InputError("Retained comparison conflicts with this source pair")
                else:
                    os.replace(temp, destination)
                    sync_dir(destination.parent)
                with self.db:
                    self.db.execute("INSERT INTO comparisons VALUES(?,?,?,?,?)", (ident, before_id, after_id, json_bytes(summary).decode(), time.time()))
                return summary

    def comparison_file(self, ident: str) -> Path:
        checked_id(ident)
        with self.mutex:
            row = self.db.execute("SELECT summary FROM comparisons WHERE id=?", (ident,)).fetchone()
            if row is None:
                raise InputError("Unknown completed comparison")
            summary = load_json(row[0])
            path = self.root / "comparisons" / ident / "changes.jsonl"
            if file_digest(path, 4 * MAX_SOURCE) != summary["changesSha256"]:
                raise InputError("Retained comparison bytes changed")
            return path

    def comparison_page(self, ident: str, offset: int = 0, limit: int = 50) -> dict:
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 250:
            raise InputError("Invalid comparison page")
        rows, size, more = [], 0, False
        with self.comparison_file(ident).open("rb") as stream:
            for i, line in enumerate(stream):
                if i < offset:
                    continue
                if len(line) > 2 * 1024 * 1024 and not rows:
                    raise InputError("This change exceeds the interactive page size; download the complete changes file")
                if len(rows) == limit or size + len(line) > 2 * 1024 * 1024:
                    more = True
                    break
                rows.append(load_json(line))
                size += len(line)
        return {"rows": rows, "offset": offset, "nextOffset": offset + len(rows) if more else None}

    def export_dataset(self, build_id: str, destination: str | Path) -> dict:
        with self.mutex:
            view = self.build_view(build_id)
            destination = Path(destination).expanduser().absolute()
            destination.mkdir(mode=0o700, parents=False, exist_ok=False)
            try:
                for name in ["data.csv", "dataset.json"]:
                    source = self._build_path(build_id, name)
                    with source.open("rb") as inp, os.fdopen(os.open(destination / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                        shutil.copyfileobj(inp, out, 1048576)
                        out.flush(); os.fsync(out.fileno())
                private_write(destination / "xml-lineage.json", json_bytes(view))
                sync_dir(destination)
            except Exception:
                shutil.rmtree(destination)
                raise
            return {"directory": str(destination), "dataset": str(destination / "dataset.json"), "build": view}

    def export_packet(self, build_id: str, output: Path):
        with self.mutex:
            view = self.build_view(build_id)
            sources = {"source.xml": self.root / "sources" / (view["source"] + ".xml"),
                       "plan.json": self.root / "plans" / (view["plan"] + ".json"),
                       "data.csv": self._build_path(build_id, "data.csv"),
                       "dataset.json": self._build_path(build_id, "dataset.json"),
                       "review.json": self._build_path(build_id, "review.json")}
            entries = {name: {"bytes": regular(path).st_size, "sha256": file_digest(path)} for name, path in sources.items()}
            if entries["source.xml"]["sha256"] != view["source"] or entries["plan.json"]["sha256"] != view["plan"]:
                raise InputError("Retained source or mapping changed")
            manifest = {"schema": PACKET, "build": build_id, "files": entries}
            with os.fdopen(os.open(output, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600), "w+b") as out:
                try:
                    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                        archive.writestr("manifest.json", json_bytes(manifest))
                        for name, path in sources.items():
                            archive.write(path, name)
                    out.flush(); os.fsync(out.fileno())
                except Exception:
                    output.unlink(missing_ok=True)
                    raise
            return {"file": str(output), "bytes": output.stat().st_size, "sha256": file_digest(output, 2 * MAX_SOURCE), "build": build_id}

    def import_packet(self, path: Path) -> dict:
        limits = {"manifest.json": 16384, "source.xml": MAX_SOURCE, "plan.json": 65536,
                  "data.csv": MAX_SOURCE, "dataset.json": 65536, "review.json": 131072}
        with self.mutex, self.scratch() as temp:
            with zipfile.ZipFile(path) as archive:
                infos = archive.infolist()
                if len(infos) != len(limits) or {i.filename for i in infos} != set(limits):
                    raise InputError("Packet must contain exactly the six documented root files")
                for info in infos:
                    mode = info.external_attr >> 16
                    if info.flag_bits & 1 or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} or stat.S_ISLNK(mode) or info.is_dir() or info.file_size > limits[info.filename]:
                        raise InputError("Invalid packet member, compression, or size")
                    with archive.open(info) as inp, os.fdopen(os.open(temp / info.filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
                        size = 0
                        while block := inp.read(65536):
                            size += len(block)
                            if size > limits[info.filename]:
                                raise InputError("Packet member exceeds its size limit")
                            out.write(block)
                manifest = load_json((temp / "manifest.json").read_bytes())
                if not isinstance(manifest, dict) or manifest.get("schema") != PACKET or not isinstance(manifest.get("files"), dict) or set(manifest["files"]) != set(limits) - {"manifest.json"}:
                    raise InputError("Invalid packet manifest")
                for name, entry in manifest["files"].items():
                    if not isinstance(entry, dict) or entry != {"bytes": (temp / name).stat().st_size, "sha256": file_digest(temp / name)}:
                        raise InputError(f"Packet member failed its declared identity: {name}")
                expected = load_json((temp / "review.json").read_bytes())
                mapped_body = validate_plan(load_json((temp / "plan.json").read_bytes()))
                source_id = manifest["files"]["source.xml"]["sha256"]
                plan_id = digest(json_bytes(mapped_body))
                expected_id = digest(json_bytes({"schema": BUILD, "source": source_id, "plan": plan_id}))
                if (not isinstance(expected, dict) or expected.get("schema") != BUILD or
                    expected.get("source") != source_id or expected.get("plan") != plan_id or
                    expected.get("id") != expected_id or manifest.get("build") != expected_id or
                    not isinstance(expected.get("native"), dict) or not HEX.fullmatch(str(expected["native"].get("snapshot", ""))) or
                    not isinstance(expected.get("files"), dict) or
                    any(expected["files"].get(n) != manifest["files"][n] for n in ["data.csv", "dataset.json"])):
                    raise InputError("Packet source, mapping, dataset and review are not one consistent build")
                with (temp / "source.xml").open("rb") as source:
                    retained = self.add_source(source, "Imported XML edition", "source.xml")
                mapped = self.save_plan(load_json((temp / "plan.json").read_bytes()))
                if not isinstance(expected, dict) or expected.get("schema") != BUILD or expected.get("source") != retained["id"] or expected.get("plan") != mapped["id"] or expected.get("id") != manifest.get("build"):
                    raise InputError("Packet source, mapping and native review are not the same build")
                result = self.build(retained["id"], mapped["id"], expected=expected)
                if result["id"] != manifest["build"]:
                    raise InputError("Packet generator identity differs from this implementation")
                return {"source": retained["id"], "plan": mapped["id"], "build": result, "reconstructed": True}
