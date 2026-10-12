"""MIT. Retained SDMX editions, exact observations, analyst revisions and native delivery."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import threading
import uuid
import zipfile

from sdmx_source import InputError, MAX_SOURCE, MAX_METADATA, parse_source, period_bounds, canonical

HERE = Path(__file__).resolve().parent
XML = HERE.parent / "xml"
spec = importlib.util.spec_from_file_location("_sf30_sdmx_xml_workspace", XML / "workspace.py")
_original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(_original)
NativeEngine = _original.NativeEngine
json_bytes, load_json = _original.json_bytes, _original.load_json
private_write, regular, file_digest, sync_dir = (
    _original.private_write, _original.regular, _original.file_digest, _original.sync_dir)

VERSION = "stellar-forge.sdmx-workspace.v1"
BUILD = "stellar-forge.sdmx-build.v1"
PACKET = "stellar-forge.sdmx-packet.v1"
LINEAGE = "stellar-forge.sdmx-lineage.v1"
HEX = re.compile(r"[0-9a-f]{64}\Z")
PROJECT_ID = re.compile(r"[0-9a-f]{32}\Z")
MAX_PACKET = 1024 * 1024 * 1024


def digest(value):
    return hashlib.sha256(value).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def identity(value, pattern=HEX):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise InputError("Use the complete retained identity")
    return value


def text(value, label, maximum=160, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()) or "\x00" in value:
        raise InputError(f"{label} must be {'0' if empty else '1'}–{maximum} characters")
    return value


def page(offset, limit):
    if isinstance(offset, bool) or isinstance(limit, bool):
        raise InputError("Pagination needs integer offset and limit")
    try:
        offset, limit = int(offset), int(limit)
    except (TypeError, ValueError) as error:
        raise InputError("Pagination needs integer offset and limit") from error
    if offset < 0 or limit < 1 or limit > 1000:
        raise InputError("Use a nonnegative offset and a limit from 1 to 1000")
    return offset, limit


def qualified(item):
    return item.get("agency_id", "") + ":" + item["id"] + "(" + item.get("version", "") + ")"


def same_flow(value, flow):
    if not value:
        return True
    if not isinstance(value, str):
        return False
    if value in {flow["id"], qualified(flow), "urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow=" + qualified(flow)}:
        return True
    parts = value.split(",")
    return (len(parts) in {2, 3} and parts[0] in {flow["agency_id"], "", "all"}
            and parts[1] == flow["id"]
            and (len(parts) == 2 or parts[2] in {flow["version"], "", "latest"}))


def semantic_digest(index):
    result = hashlib.sha256()
    for key, body in index.execute("SELECT k,body FROM rows ORDER BY series_key,period,k"):
        result.update(json_bytes([key, load_json(body)]))
    return result.hexdigest()


def source_info(row):
    value = load_json(row["info"])
    value["id"] = value["sha256"] = row["id"]
    return value


class Workspace:
    def __init__(self, root, create=False):
        root = Path(root).expanduser().absolute()
        if create:
            root.mkdir(mode=0o700, parents=True, exist_ok=False)
            for name in ("sources", "builds", "tmp"):
                (root / name).mkdir(mode=0o700)
            private_write(root / "workspace.json", json_bytes(
                {"schema": VERSION, "id": uuid.uuid4().hex, "created_at": now()}))
        self.root = root.resolve(strict=True)
        info = self.root.stat()
        if os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise InputError("Use an operator-owned private workspace directory, mode 0700")
        regular(self.root / "workspace.json", 8192)
        self.info = load_json((self.root / "workspace.json").read_bytes())
        if self.info.get("schema") != VERSION:
            raise InputError("Unsupported SDMX workspace schema")
        for name in ("sources", "builds", "tmp"):
            path = self.root / name
            if path.is_symlink() or not path.is_dir():
                raise InputError("Workspace subdirectories must be real directories")
        self.lease = os.fdopen(os.open(self.root / ".lock",
            os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600), "r+b", buffering=0)
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
        except OSError as error:
            self.lease.close()
            raise InputError("This workspace is already open; use its existing operator console") from error
        try:
            db_path = self.root / "workspace.sqlite"
            if not db_path.exists():
                private_write(db_path, b"")
            regular(db_path, 4 * MAX_PACKET)
            self.db = sqlite3.connect(db_path, check_same_thread=False)
            self.db.row_factory = sqlite3.Row
            self.db.executescript("""
                PRAGMA journal_mode=DELETE;
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,info TEXT NOT NULL,parsed TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS acquisitions(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES sources(id),body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS series(source TEXT NOT NULL,id TEXT NOT NULL,k TEXT NOT NULL,n INTEGER NOT NULL,
                    body TEXT NOT NULL,PRIMARY KEY(source,id));
                CREATE INDEX IF NOT EXISTS series_key ON series(source,k);
                CREATE TABLE IF NOT EXISTS observations(source TEXT NOT NULL,ordinal INTEGER NOT NULL,series TEXT NOT NULL,
                    period TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(source,ordinal));
                CREATE INDEX IF NOT EXISTS observations_series ON observations(source,series,ordinal);
                CREATE TABLE IF NOT EXISTS groups(source TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,
                    PRIMARY KEY(source,ordinal));
                CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS revisions(project TEXT NOT NULL,revision INTEGER NOT NULL,
                    body TEXT NOT NULL,build TEXT NOT NULL,PRIMARY KEY(project,revision));
                CREATE TABLE IF NOT EXISTS builds(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,request_sha256 TEXT NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS comparison_rows(comparison TEXT NOT NULL,ordinal INTEGER NOT NULL,
                    body TEXT NOT NULL,PRIMARY KEY(comparison,ordinal));
            """)
            self.mutex = threading.RLock()
            self.native = NativeEngine()
            self._closed = False
        except Exception:
            self.lease.close()
            raise

    def close(self):
        if not getattr(self, "_closed", True):
            self._closed = True
            try:
                self.native.close()
            finally:
                try:
                    self.db.close()
                finally:
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

    def state(self):
        with self.mutex:
            sources = [source_info(row) for row in self.db.execute("SELECT * FROM sources ORDER BY rowid DESC")]
            projects = [load_json(row["body"]) for row in self.db.execute(
                "SELECT r.body FROM projects p JOIN revisions r ON r.project=p.id AND r.revision=p.revision ORDER BY p.rowid DESC")]
            comparisons = [load_json(row["body"]) for row in self.db.execute("SELECT body FROM comparisons ORDER BY rowid DESC")]
            return {"schema": VERSION, "workspace": {**self.info, "path": str(self.root)},
                    "sources": sources, "projects": projects, "comparisons": comparisons}

    def source(self, ident):
        with self.mutex:
            row = self.db.execute("SELECT * FROM sources WHERE id=?", (identity(ident),)).fetchone()
            if row is None:
                raise InputError("Unknown retained source")
            result = load_json(row["parsed"])
            result["source"] = source_info(row)
            result["acquisitions"] = [load_json(r["body"]) for r in self.db.execute(
                "SELECT body FROM acquisitions WHERE source=? ORDER BY rowid", (ident,))]
            return result

    def _source_path(self, ident):
        self.source(ident)
        path = self.root / "sources" / (ident + ".raw")
        if file_digest(path) != ident:
            raise InputError("Retained source bytes differ from their original content")
        return path

    def add_source(self, stream, metadata):
        if not isinstance(metadata, dict) or set(metadata) - {"name", "label", "origin", "kind", "media_type", "coverage", "receipt"}:
            raise InputError("Unsupported source metadata")
        name = text(metadata.get("name", "source.xml"), "Source filename")
        if Path(name.replace("\\", "/")).name != name:
            raise InputError("Provide a filename without directory components")
        label = text(metadata.get("label", name), "Source label")
        origin = text(metadata.get("origin", ""), "Original source URL", 4096, empty=True)
        if origin and not re.match(r"https?://", origin):
            raise InputError("Original source URL must use HTTP or HTTPS")
        media = text(metadata.get("media_type", ""), "Media type", 160, empty=True)
        with self.mutex, self.scratch() as temporary:
            raw = temporary / "source.raw"
            h, size = hashlib.sha256(), 0
            with os.fdopen(os.open(raw, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as out:
                while block := stream.read(65536):
                    size += len(block)
                    if size > MAX_SOURCE:
                        raise InputError("A retained SDMX source may contain at most 256 MiB")
                    h.update(block)
                    out.write(block)
                out.flush()
                os.fsync(out.fileno())
            if not size:
                raise InputError("Retain a nonempty provider source document")
            ident = h.hexdigest()
            acquisition = {"source_id": ident, **metadata}
            aid = digest(json_bytes(acquisition))
            existing = self.db.execute("SELECT 1 FROM sources WHERE id=?", (ident,)).fetchone()
            if existing:
                self._source_path(ident)
                with self.db:
                    self.db.execute("INSERT OR IGNORE INTO acquisitions VALUES(?,?,?)", (aid, ident, json_bytes(acquisition).decode()))
                return self.source(ident)["source"]
            group_count = 0
            with self.db:
                def series(item):
                    self.db.execute("""INSERT INTO series VALUES(?,?,?,?,?) ON CONFLICT(source,id)
                        DO UPDATE SET n=series.n+excluded.n,body=excluded.body""",
                        (ident, item["id"], item["series_key"], item["observation_count"], json_bytes(item).decode()))
                def observation(item):
                    self.db.execute("INSERT INTO observations VALUES(?,?,?,?,?)", (
                        ident, item["ordinal"], item["series_id"], item["time_period"], json_bytes(item).decode()))
                def group(item):
                    nonlocal group_count
                    group_count += 1
                    self.db.execute("INSERT INTO groups VALUES(?,?,?)", (ident, group_count, json_bytes(item).decode()))
                try:
                    parsed = parse_source(raw, metadata, series, observation, group)
                except (UnicodeError, csv.Error) as error:
                    raise InputError("Source is not supported UTF-8 SDMX XML or CSV: " + str(error)) from error
                parsed["series_count"] = self.db.execute("SELECT count(*) FROM series WHERE source=?", (ident,)).fetchone()[0]
                info = {"id": ident, "sha256": ident, "name": name, "label": label, "origin": origin,
                        "media_type": media, "kind": parsed["kind"], "format": parsed["format"], "bytes": size,
                        "created_at": now(), "coverage": parsed["coverage"],
                        "series_count": parsed["series_count"], "observation_count": parsed["observation_count"]}
                destination = self.root / "sources" / (ident + ".raw")
                if destination.exists():
                    if file_digest(destination) != ident:
                        raise InputError("A recovered source path contains different bytes")
                else:
                    os.replace(raw, destination)
                    sync_dir(destination.parent)
                self.db.execute("INSERT INTO sources VALUES(?,?,?)", (ident, json_bytes(info).decode(), json_bytes(parsed).decode()))
                self.db.execute("INSERT INTO acquisitions VALUES(?,?,?)", (aid, ident, json_bytes(acquisition).decode()))
            return self.source(ident)["source"]

    def series(self, source_id, offset=0, limit=50, query=""):
        offset, limit = page(offset, limit)
        query = text(query, "Series search", 300, empty=True)
        with self.mutex:
            self.source(source_id)
            pattern = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where = "source=? AND (k LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')"
            args = (source_id, pattern, pattern)
            total = self.db.execute("SELECT count(*) FROM series WHERE " + where, args).fetchone()[0]
            rows = []
            for row in self.db.execute("SELECT * FROM series WHERE " + where + " ORDER BY k,id LIMIT ? OFFSET ?", (*args, limit, offset)):
                item = load_json(row["body"])
                item["observation_count"] = row["n"]
                rows.append(item)
            return {"rows": rows, "total": total, "offset": offset, "limit": limit}

    def observations(self, source_id, series_key=None, offset=0, limit=50):
        offset, limit = page(offset, limit)
        with self.mutex:
            source = self.source(source_id)
            where, params = "o.source=?", [source_id]
            if series_key is not None:
                text(series_key, "Series key", 4096)
                where += " AND (s.k=? OR s.id=?)"
                params.extend((series_key, series_key))
            join = " FROM observations o JOIN series s ON s.source=o.source AND s.id=o.series WHERE " + where
            total = self.db.execute("SELECT count(*)" + join, params).fetchone()[0]
            datasets = {d["id"]: d for d in source["datasets"]}
            rows = []
            for row in self.db.execute("SELECT o.body,s.body AS series_body" + join +
                    " ORDER BY o.ordinal LIMIT ? OFFSET ?", (*params, limit, offset)):
                item, series = load_json(row["body"]), load_json(row["series_body"])
                item["series_attributes"] = series["attributes"]
                item["series_raw_attributes"] = series["raw_attributes"]
                item["dataset_attributes"] = datasets[item["dataset_id"]]["attributes"]
                rows.append(item)
            return {"rows": rows, "total": total, "offset": offset, "limit": limit}

    def _metadata(self, source_ids, flow_id):
        merged = {key: {} for key in ("flows", "structures", "codelists")}
        for sid in source_ids:
            source = self.source(sid)
            for key in merged:
                for item in source[key]:
                    ident = qualified(item)
                    if ident in merged[key] and merged[key][ident] != item:
                        raise InputError(f"Selected metadata sources disagree on {key} {ident}; select the intended retained structure edition")
                    merged[key][ident] = item
        candidates = [f for f in merged["flows"].values() if flow_id in {f["id"], qualified(f)}]
        if len(candidates) != 1:
            raise InputError("Select one retained dataflow, using its qualified identity when multiple agencies or versions exist")
        flow = candidates[0]
        ref = flow["structure"]
        structures = [s for s in merged["structures"].values() if s["id"] == ref.get("id")
                      and (not ref.get("agency_id") or s["agency_id"] == ref["agency_id"])
                      and (not ref.get("version") or s["version"] == ref["version"])]
        if len(structures) != 1:
            raise InputError("Retain the selected dataflow's complete DSD and referenced codelists before building its observations")
        structure = structures[0]
        referenced = [c.get("codelist", {}) for c in structure["dimensions"] + structure["attributes"] + structure["measures"]]
        lists = []
        for ref in referenced:
            if not ref.get("id"):
                continue
            candidates = [c for c in merged["codelists"].values() if c["id"] == ref["id"]
                          and (not ref.get("agency_id") or c["agency_id"] == ref["agency_id"])
                          and (not ref.get("version") or c["version"] == ref["version"])]
            if len(candidates) != 1:
                raise InputError("Retain the exact referenced codelist " + ref["id"])
            if candidates[0] not in lists:
                lists.append(candidates[0])
        metadata = {"flows": [flow], "structures": [structure], "codelists": sorted(lists, key=qualified),
                    "dimensions": structure["dimensions"]}
        metadata["sha256"] = digest(json_bytes(metadata))
        metadata["source_ids"] = list(source_ids)
        metadata["attribution"] = "Source: ECB statistics." if flow["agency_id"] == "ECB" else "Source: " + flow["agency_id"] + "."
        return metadata

    def _request(self, body):
        fields = {"operation_id", "id", "expected_revision", "title", "data_source_id", "metadata_source_ids",
                  "flow_id", "selection", "notes"}
        if not isinstance(body, dict) or set(body) - fields:
            raise InputError("Unsupported project fields")
        operation_id = text(body.get("operation_id"), "Operation identity", 160)
        title = text(body.get("title"), "Project title", 128)
        data = identity(body.get("data_source_id"))
        ids = body.get("metadata_source_ids", [])
        if not isinstance(ids, list) or len(ids) > 32 or any(not isinstance(v, str) for v in ids) or len(ids) != len(set(ids)):
            raise InputError("Select up to 32 distinct retained metadata sources")
        ids = sorted(identity(x) for x in ids)
        flow = text(body.get("flow_id"), "Dataflow identity", 300)
        selection = body.get("selection", {"series_keys": []})
        if not isinstance(selection, dict) or set(selection) - {"series_keys", "dataset_ids"}:
            raise InputError("Selection supports explicit series_keys and dataset_ids")
        selected = {}
        for key, maximum in (("series_keys", 4096), ("dataset_ids", 160)):
            values = selection.get(key, [])
            if not isinstance(values, list) or len(values) > 10000 or any(not isinstance(v, str) for v in values):
                raise InputError("Selection fields must be arrays of original series or dataset identities")
            selected[key] = sorted(set(text(v, "Selected identity", maximum) for v in values))
        notes = text(body.get("notes", ""), "Analyst notes", 32000, empty=True)
        ident = body.get("id")
        if ident is not None:
            identity(ident, PROJECT_ID)
        expected = body.get("expected_revision")
        if expected is not None and (isinstance(expected, bool) or not isinstance(expected, int) or expected < 0):
            raise InputError("Expected revision must be a nonnegative integer")
        return {"operation_id": operation_id, "id": ident, "expected_revision": expected, "title": title,
                "data_source_id": data, "metadata_source_ids": ids, "flow_id": flow,
                "selection": selected, "notes": notes}

    def save_project(self, body):
        return self._save_revision(self._request(body))

    def _save_revision(self, request, retained=None, expected_build=None):
        with self.mutex:
            request_sha = digest(json_bytes(request))
            old_operation = self.db.execute("SELECT * FROM operations WHERE id=?", (request["operation_id"],)).fetchone()
            if old_operation:
                if old_operation["request_sha256"] != request_sha:
                    raise InputError("This operation identity already belongs to a different saved request")
                result = load_json(old_operation["result"])
                self._build_file(result["build"]["id"], "data.csv")
                return result
            ident = request["id"] or digest(json_bytes({"operation_id": request["operation_id"]}))[:32]
            existing = self.db.execute("SELECT revision FROM projects WHERE id=?", (ident,)).fetchone()
            current = existing["revision"] if existing else 0
            if (current and request["expected_revision"] != current) or (
                    not current and request["expected_revision"] not in {None, 0}):
                raise InputError(f"Project revision changed; current revision is {current}")
            source = self.source(request["data_source_id"])
            if source["kind"] != "data" or source["observation_count"] == 0:
                raise InputError("Select a retained data response containing observations")
            self._source_path(request["data_source_id"])
            metadata_ids = sorted(set(request["metadata_source_ids"] + [request["data_source_id"]]))
            metadata = self._metadata(metadata_ids, request["flow_id"])
            build = self._build(request, metadata)
            if expected_build:
                self._check_portable_build(build, expected_build)
            stamp = now()
            created = self.project(ident)["project"]["created_at"] if current else stamp
            project = {"id": ident, "revision": current + 1, "title": request["title"],
                       "data_source_id": request["data_source_id"], "metadata_source_ids": request["metadata_source_ids"],
                       "flow_id": request["flow_id"], "selection": request["selection"], "notes": request["notes"],
                       "operation_id": request["operation_id"], "created_at": created, "updated_at": stamp,
                       "build_id": build["id"]}
            if retained is not None:
                for key in project:
                    if key not in {"created_at", "updated_at"} and project[key] != retained.get(key):
                        raise InputError("Portable project identity or revision differs from its original request")
                project = retained
            result = {"project": project, "build": build}
            with self.db:
                self.db.execute("INSERT INTO revisions VALUES(?,?,?,?)",
                    (ident, project["revision"], json_bytes(project).decode(), build["id"]))
                self.db.execute("INSERT INTO projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision",
                    (ident, project["revision"]))
                self.db.execute("INSERT INTO operations VALUES(?,?,?,?)",
                    (request["operation_id"], request_sha, json_bytes(request).decode(), json_bytes(result).decode()))
            return result

    def project(self, ident, revision=None):
        identity(ident, PROJECT_ID)
        with self.mutex:
            current = self.db.execute("SELECT revision FROM projects WHERE id=?", (ident,)).fetchone()
            if current is None:
                raise InputError("Unknown project")
            if revision is None:
                revision = current["revision"]
            if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
                raise InputError("Use an existing positive project revision")
            row = self.db.execute("SELECT body,build FROM revisions WHERE project=? AND revision=?", (ident, revision)).fetchone()
            if row is None:
                raise InputError("Unknown project revision")
            p = load_json(row["body"])
            build = self._build_view(row["build"])
            sources = [self.source(s)["source"] for s in sorted(set([p["data_source_id"]] + p["metadata_source_ids"]))]
            revisions = [{"revision": r["revision"], "updated_at": load_json(r["body"])["updated_at"],
                          "title": load_json(r["body"])["title"]} for r in self.db.execute(
                              "SELECT revision,body FROM revisions WHERE project=? ORDER BY revision", (ident,))]
            return {"project": p, "build": build, "sources": sources, "metadata": build["metadata"],
                    "revisions": revisions, "current_revision": current["revision"]}

    def _build_view(self, ident):
        row = self.db.execute("SELECT body FROM builds WHERE id=?", (identity(ident),)).fetchone()
        if row is None:
            raise InputError("Unknown completed build")
        return load_json(row["body"])

    def _build_file(self, ident, name):
        build = self._build_view(ident)
        if name not in build["files"]:
            raise InputError("Unknown retained build file")
        path = self.root / "builds" / ident / name
        if file_digest(path, 4 * MAX_SOURCE) != build["files"][name]["sha256"]:
            raise InputError("Retained build bytes differ from the original accepted projection")
        return path

    def _portable_build(self, build):
        # SQLite's writer version and page layout are host-dependent. Keep its exact
        # local hash for corruption checks, and bind portable revisions to the native
        # delivery bytes and the ordered semantic observation records instead.
        path = self._build_file(build["id"], "rows.sqlite")
        index = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
        try:
            semantic = semantic_digest(index)
        finally:
            index.close()
        if build.get("semantic_sha256", semantic) != semantic:
            raise InputError("Retained observation index differs from its semantic identity")
        files = {}
        for name in ("data.csv", "dataset.json"):
            self._build_file(build["id"], name)
            files[name] = build["files"][name]
        return {"id": build["id"], "snapshot": build["snapshot"], "files": files,
                "semantic_sha256": semantic}

    def _check_portable_build(self, build, expected):
        actual = self._portable_build(build)
        files = expected.get("files", {}) if isinstance(expected, dict) else {}
        if (not isinstance(expected, dict) or not isinstance(files, dict)
                or any(actual[key] != expected.get(key) for key in ("id", "snapshot"))
                or any(actual["files"][name] != files.get(name) for name in actual["files"])
                or ("semantic_sha256" in expected and actual["semantic_sha256"] != expected["semantic_sha256"])):
            raise InputError("Reconstructed dataset differs from the exported original build")

    def _resolved(self, request, metadata):
        source = self.source(request["data_source_id"])
        structure = metadata["structures"][0]
        flow = metadata["flows"][0]
        coverage = source["coverage"]
        selection = coverage.get("selection", {})
        flow_references = [coverage.get("flow")]
        if isinstance(selection, dict):
            flow_references.append(selection.get("flow"))
        if any(not same_flow(value, flow) for value in flow_references):
            raise InputError("Selected dataflow differs from the retained source request's flow identity")
        dimension_ids = [d["id"] for d in structure["dimensions"] if d["role"] != "time"]
        attribute_ids = {a["id"] for a in structure["attributes"]}
        datasets = {d["id"]: d for d in source["datasets"]}
        groups = [load_json(r["body"]) for r in self.db.execute(
            "SELECT body FROM groups WHERE source=? ORDER BY ordinal", (request["data_source_id"],))]
        selected_keys = set(request["selection"]["series_keys"])
        selected_datasets = set(request["selection"].get("dataset_ids", []))
        matched_keys, matched_datasets = set(), set()
        lists = {qualified(c): {v["id"] for v in c["codes"]} for c in metadata["codelists"]}
        def validate_code(component, value):
            ref = component.get("codelist", {})
            if value and ref.get("id"):
                matches = [codes for key, codes in lists.items() if key == qualified(ref)]
                if matches and value not in matches[0]:
                    raise InputError(f"Source code {component['id']}={value!r} is absent from its selected codelist")
        for row in self.db.execute("""SELECT o.body,s.body AS series_body FROM observations o
                JOIN series s ON s.source=o.source AND s.id=o.series
                WHERE o.source=? ORDER BY o.ordinal""", (request["data_source_id"],)):
            obs, sr = load_json(row["body"]), load_json(row["series_body"])
            ds = datasets[obs["dataset_id"]]
            if selected_datasets and ds["id"] not in selected_datasets:
                continue
            ref = ds.get("structure_reference", {})
            if ref and (ref.get("id") != structure["id"] or (ref.get("agency_id") and ref["agency_id"] != structure["agency_id"]) or (ref.get("version") and ref["version"] != structure["version"])):
                raise InputError("Selected metadata differs from the source Header DSD identity")
            ds_ref = ds["raw_attributes"].get("structureRef")
            if not ref and ds_ref and ds_ref not in {structure["id"], qualified(structure)}:
                raise InputError("A selected dataset names a different DSD; select its actual dataset and dataflow")
            if not same_flow(ds["raw_attributes"].get("flow"), flow):
                raise InputError("Selected dataflow differs from the source dataset's flow identity")
            dims = dict(ds.get("dimensions", {}))
            dims.update(sr["dimensions"])
            if not sr["dimensions"]:
                dims.update({k: v for k, v in sr["raw_attributes"].items() if k in dimension_ids})
            dims.update(obs.get("dimensions", {}))
            missing = [d for d in dimension_ids if not dims.get(d)]
            extra = set(dims) - set(dimension_ids)
            if missing or extra:
                raise InputError("Observation dimensions differ from selected DSD: missing=" + ",".join(missing) +
                                 "; extra=" + ",".join(sorted(extra)))
            dims = {key: dims[key] for key in dimension_ids}
            key = ".".join(dims.values())
            if selected_keys and key not in selected_keys:
                continue
            matched_keys.add(key)
            matched_datasets.add(ds["id"])
            attrs = {k: v for k, v in ds["raw_attributes"].items() if k in attribute_ids}
            attrs.update(ds["attributes"])
            group_attrs = {}
            for group in groups:
                if group["dataset_id"] != ds["id"]:
                    continue
                group_key = group["key"] or {k: v for k, v in group["raw_attributes"].items() if k in dimension_ids}
                if all(dims.get(k) == v for k, v in group_key.items()):
                    incoming = {k: v for k, v in group["raw_attributes"].items() if k in attribute_ids}
                    incoming.update(group["attributes"])
                    if any(k in group_attrs and group_attrs[k] != v for k, v in incoming.items()):
                        raise InputError("Two matching source groups declare different values for one attribute")
                    group_attrs.update(incoming)
            attrs.update(group_attrs)
            attrs.update({k: v for k, v in sr["raw_attributes"].items() if k in attribute_ids})
            attrs.update(sr["attributes"])
            attrs.update(obs["attributes"])
            # A blank SDMX-CSV attribute cell means unspecified. Exact source cells and
            # XML attachment levels remain retained in the source and observation index.
            attrs = {k: v for k, v in attrs.items() if v != ""}
            for component in structure["dimensions"]:
                if component["id"] in dims:
                    validate_code(component, dims[component["id"]])
            for component in structure["attributes"]:
                if component["id"] in attrs:
                    validate_code(component, attrs[component["id"]])
            value = obs["value"]
            kind = "absent" if not obs["value_present"] else "nil" if value is None else "empty" if value == "" else "literal"
            semantic = {"flow": qualified(metadata["flows"][0]), "series_key": key,
                        "time_period": obs["time_period"], "dimensions": dims,
                        "value": value, "value_present": obs["value_present"], "value_kind": kind,
                        "attributes": attrs, "action": obs["action"]}
            yield semantic
        if selected_keys - matched_keys:
            raise InputError("Selected series are absent from this retained source: " + ", ".join(sorted(selected_keys - matched_keys)[:20]))
        if selected_datasets - matched_datasets:
            raise InputError("Selected datasets are absent or have no selected observations: " + ", ".join(sorted(selected_datasets - matched_datasets)))

    def _build(self, request, metadata):
        projection = {"schema": BUILD, "source": request["data_source_id"],
                      "metadata_sha256": metadata["sha256"], "title": request["title"],
                      "flow": qualified(metadata["flows"][0]), "selection": request["selection"]}
        ident = digest(json_bytes(projection))
        if self.db.execute("SELECT 1 FROM builds WHERE id=?", (ident,)).fetchone():
            for name in ("data.csv", "dataset.json", "rows.sqlite"):
                self._build_file(ident, name)
            return self._build_view(ident)
        dims = [d["id"] for d in metadata["dimensions"] if d["role"] != "time"]
        dimension_columns = {}
        used = set()
        for key in dims:
            name = "dim_" + re.sub(r"[^A-Za-z0-9_]", "_", key).lower()
            if len(name) > 48 or name in used:
                name = name[:37] + "_" + digest(key.encode())[:10]
            dimension_columns[key] = name
            used.add(name)
        base = ["observation_key", "flow", "series_key", "time_period", "frequency", "observation_value",
                "value_present", "value_kind", "observation_action", "period_start", "period_end",
                "observation_status", "unit", "unit_multiplier", "decimals"]
        names = base + list(dimension_columns.values()) + ["attributes_json", "metadata_sha256"]
        if len(names) > 64:
            raise InputError("The selected DSD exceeds the original dataset engine's 64-column projection limit")
        nullable = {"observation_value", "period_start", "period_end", "observation_status", "unit", "unit_multiplier", "decimals"}
        columns = {name: {"type": "boolean" if name == "value_present" else "string", "nullable": name in nullable}
                   for name in names}
        config = {"schema": "stellar-forge.csv-dataset.v1", "file": "data.csv", "name": request["title"],
                  "columns": columns,
                  "filters": ["flow", "series_key", "frequency", "observation_status"] + list(dimension_columns.values())[:4],
                  "ranges": ["period_start", "period_end"],
                  "sorts": ["series_key", "time_period", "period_start"],
                  "defaultLimit": 50, "maxLimit": 250, "maxBytes": MAX_SOURCE,
                  "maxRows": 1000000, "maxCellChars": 1048576}
        with self.scratch() as temporary:
            private_write(temporary / "rows.sqlite", b"")
            index = sqlite3.connect(temporary / "rows.sqlite")
            count, frequencies, units, selected_series = 0, {}, set(), set()
            try:
                index.execute("PRAGMA journal_mode=OFF")
                index.execute("CREATE TABLE rows(k TEXT PRIMARY KEY,series_key TEXT NOT NULL,period TEXT NOT NULL,body TEXT NOT NULL)")
                for row in self._resolved(request, metadata):
                    key = digest(json_bytes([row["flow"], row["dimensions"], row["time_period"]]))
                    try:
                        index.execute("INSERT INTO rows VALUES(?,?,?,?)",
                            (key, row["series_key"], row["time_period"], json_bytes(row).decode()))
                    except sqlite3.IntegrityError as error:
                        raise InputError("Source contains more than one observation for the same series and period; retain the source history and select one original dataset edition with selection.dataset_ids") from error
                    count += 1
                    selected_series.add(row["series_key"])
                    frequency = row["dimensions"].get("FREQ", "")
                    frequencies[frequency] = frequencies.get(frequency, 0) + 1
                    if row["attributes"].get("UNIT"):
                        units.add(row["attributes"]["UNIT"])
                if count == 0:
                    raise InputError("The project selection has no observations")
                index.commit()
                semantic_sha = semantic_digest(index)
                with os.fdopen(os.open(temporary / "data.csv", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                               "w", encoding="utf-8", newline="") as out:
                    writer = csv.writer(out, lineterminator="\n")
                    writer.writerow(names)
                    for key, _, _, body in index.execute("SELECT * FROM rows ORDER BY series_key,period,k"):
                        row = load_json(body)
                        frequency = row["dimensions"].get("FREQ", "")
                        start, end = period_bounds(row["time_period"], frequency)
                        attrs = row["attributes"]
                        cells = {"observation_key": key, "flow": row["flow"], "series_key": row["series_key"],
                                 "time_period": row["time_period"], "frequency": frequency,
                                 "observation_value": row["value"] if row["value"] is not None else "",
                                 "value_present": "true" if row["value_present"] else "false",
                                 "value_kind": row["value_kind"], "observation_action": row["action"],
                                 "period_start": start or "", "period_end": end or "",
                                 "observation_status": attrs.get("OBS_STATUS", ""), "unit": attrs.get("UNIT", ""),
                                 "unit_multiplier": attrs.get("UNIT_MULT", ""), "decimals": attrs.get("DECIMALS", ""),
                                 "attributes_json": canonical(attrs), "metadata_sha256": metadata["sha256"]}
                        cells.update({dimension_columns[k]: v for k, v in row["dimensions"].items()})
                        writer.writerow([cells[n] for n in names])
                        if out.tell() > MAX_SOURCE:
                            raise InputError("Projected CSV exceeds the original engine's 256 MiB ceiling")
                    out.flush()
                    os.fsync(out.fileno())
            finally:
                index.close()
            # Preserve schema column order. json_bytes sorts keys for metadata identities,
            # whereas native CSV column declaration order must match the actual header.
            private_write(temporary / "dataset.json",
                (json.dumps(config, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode())
            native = self.native.query(temporary / "dataset.json", {"limit": "1"})
            if native["response"]["status"] != 200 or native["dataset"]["rowCount"] != count:
                raise InputError("Original SF30 engine did not accept the complete SDMX projection")
            files = {name: {"bytes": (temporary / name).stat().st_size,
                            "sha256": file_digest(temporary / name, 4 * MAX_SOURCE)}
                     for name in ("data.csv", "dataset.json", "rows.sqlite")}
            build = {"schema": BUILD, "id": ident, "snapshot": native["dataset"]["snapshot"],
                     "dataset": native["dataset"], "native": native["dataset"], "engineBlob": native["engineBlob"],
                     "rowCount": count, "row_count": count, "series_count": len(selected_series),
                     "frequencies": frequencies, "units": sorted(units), "files": files,
                     "semantic_sha256": semantic_sha,
                     "metadata": metadata, "projection": projection, "dimension_columns": dimension_columns}
            private_write(temporary / "build.json", json_bytes(build))
            destination = self.root / "builds" / ident
            if destination.exists():
                for name in (*files, "build.json"):
                    if file_digest(destination / name, 4 * MAX_SOURCE) != file_digest(temporary / name, 4 * MAX_SOURCE):
                        raise InputError("Recovered immutable build differs from its retained source")
            else:
                os.replace(temporary, destination)
                sync_dir(destination.parent)
            with self.db:
                self.db.execute("INSERT INTO builds VALUES(?,?)", (ident, json_bytes(build).decode()))
            return build

    def query(self, ident, params, revision=None):
        if not isinstance(params, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in params.items()):
            raise InputError("Native query parameters must be scalar strings")
        with self.mutex:
            build = self.project(ident, revision)["build"]
            self._build_file(build["id"], "data.csv")
            return self.native.query(self._build_file(build["id"], "dataset.json"), params)

    def compare(self, before_project, after_project, before_revision=None, after_revision=None):
        with self.mutex:
            before = self.project(before_project, before_revision)
            after = self.project(after_project, after_revision)
            left, right = before["project"], after["project"]
            identity_body = {"schema": "stellar-forge.sdmx-comparison.v1",
                             "before": [left["id"], left["revision"]], "after": [right["id"], right["revision"]]}
            ident = digest(json_bytes(identity_body))
            old = self.db.execute("SELECT body FROM comparisons WHERE id=?", (ident,)).fetchone()
            if old:
                return load_json(old["body"])
            if before["metadata"]["flows"][0]["id"] != after["metadata"]["flows"][0]["id"] or (
                    before["metadata"]["flows"][0]["agency_id"] != after["metadata"]["flows"][0]["agency_id"]):
                raise InputError("Compare retained editions of the same provider dataflow")
            a = self._build_file(before["build"]["id"], "rows.sqlite")
            b = self._build_file(after["build"]["id"], "rows.sqlite")
            comparison = sqlite3.connect(b.as_uri() + "?mode=ro", uri=True)
            comparison.execute("ATTACH DATABASE ? AS old", (a.as_uri() + "?mode=ro",))
            counts = {"added": 0, "absent": 0, "changed": 0, "unchanged": 0}
            ordinal = 0
            try:
                with self.db:
                    sql = """SELECT n.k,n.body,o.body FROM main.rows n LEFT JOIN old.rows o ON o.k=n.k
                             UNION ALL SELECT o.k,NULL,o.body FROM old.rows o LEFT JOIN main.rows n ON n.k=o.k WHERE n.k IS NULL"""
                    for _, new_body, old_body in comparison.execute(sql):
                        old_row = load_json(old_body) if old_body else None
                        new_row = load_json(new_body) if new_body else None
                        kind = "added" if old_row is None else "absent" if new_row is None else "unchanged" if old_row == new_row else "changed"
                        counts[kind] += 1
                        if kind == "unchanged":
                            continue
                        row = new_row or old_row
                        changed_fields = [key for key in sorted(set(old_row or {}) | set(new_row or {}))
                                          if (old_row or {}).get(key) != (new_row or {}).get(key)]
                        ordinal += 1
                        detail = {"kind": kind, "series_key": row["series_key"], "time_period": row["time_period"],
                                  "before": old_row, "after": new_row, "changed_fields": changed_fields}
                        self.db.execute("INSERT INTO comparison_rows VALUES(?,?,?)", (ident, ordinal, json_bytes(detail).decode()))
                    old_coverage = self.source(left["data_source_id"])["coverage"]
                    new_coverage = self.source(right["data_source_id"])["coverage"]
                    selection_equivalent = (left["selection"] == right["selection"]
                        and old_coverage.get("selection") == new_coverage.get("selection")
                        and old_coverage.get("completeness") == new_coverage.get("completeness")
                        and old_coverage.get("updated_after") == new_coverage.get("updated_after"))
                    notes = ["Absent observations are absent in the supplied edition; provider deletions require explicit source actions."]
                    if not selection_equivalent:
                        notes.append("The retained source selections or update coverage differ. Compare the declared coverage before interpreting additions or absence.")
                    if old_coverage.get("completeness") != "selected_response" or new_coverage.get("completeness") != "selected_response":
                        notes.append("At least one source does not declare a complete selected response.")
                    summary = {**identity_body, "id": ident,
                        "before": {"project_id": left["id"], "revision": left["revision"], "snapshot": before["build"]["snapshot"],
                                   "source_id": left["data_source_id"], "coverage": old_coverage},
                        "after": {"project_id": right["id"], "revision": right["revision"], "snapshot": after["build"]["snapshot"],
                                  "source_id": right["data_source_id"], "coverage": new_coverage},
                        "counts": counts, "total": ordinal, "selection_equivalent": selection_equivalent,
                        "metadata_changed": before["metadata"]["sha256"] != after["metadata"]["sha256"],
                        "notes": notes, "created_at": now()}
                    self.db.execute("INSERT INTO comparisons VALUES(?,?)", (ident, json_bytes(summary).decode()))
            finally:
                comparison.close()
            return summary

    def comparison_page(self, ident, offset=0, limit=50):
        offset, limit = page(offset, limit)
        with self.mutex:
            row = self.db.execute("SELECT body FROM comparisons WHERE id=?", (identity(ident),)).fetchone()
            if row is None:
                raise InputError("Unknown retained comparison")
            summary = load_json(row["body"])
            rows = [load_json(r["body"]) for r in self.db.execute(
                "SELECT body FROM comparison_rows WHERE comparison=? ORDER BY ordinal LIMIT ? OFFSET ?", (ident, limit, offset))]
            return {"comparison": summary, "rows": rows, "total": summary["total"], "offset": offset, "limit": limit}

    def _lineage(self, project, build, files):
        sources = [self.source(s)["source"] for s in sorted(set(
            [project["data_source_id"]] + project["metadata_source_ids"]))]
        return {"schema": LINEAGE, "project": {"id": project["id"], "revision": project["revision"], "title": project["title"]},
                "snapshot": build["snapshot"], "files": files, "sources": sources,
                "selection": project["selection"], "metadata": build["metadata"], "created_at": project["updated_at"],
                "analyst_notes": project["notes"], "build_id": build["id"], "engineBlob": build["engineBlob"],
                "original_values": "Source value strings, dimensions and statistical attributes are preserved without rescaling or rounding."}

    def export_dataset(self, ident, output, revision=None):
        with self.mutex:
            selected = self.project(ident, revision)
            project, build = selected["project"], selected["build"]
            output = Path(output).expanduser().absolute()
            files = {name: build["files"][name] for name in ("data.csv", "dataset.json")}
            lineage = json_bytes(self._lineage(project, build, files))
            if output.exists():
                if output.is_symlink() or not output.is_dir():
                    raise InputError("Dataset output must be a real directory")
                if set(p.name for p in output.iterdir()) != {"data.csv", "dataset.json", "sdmx-lineage.json"}:
                    raise InputError("An existing export contains a different file set")
                for name, expected in files.items():
                    if file_digest(output / name) != expected["sha256"]:
                        raise InputError("An existing export differs from this exact project revision")
                if (output / "sdmx-lineage.json").read_bytes() != lineage:
                    raise InputError("An existing export has different project lineage")
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                temporary = Path(tempfile.mkdtemp(prefix=".sdmx-export-", dir=output.parent))
                try:
                    for name in files:
                        shutil.copyfile(self._build_file(build["id"], name), temporary / name)
                        os.chmod(temporary / name, 0o600)
                    private_write(temporary / "sdmx-lineage.json", lineage)
                    os.rename(temporary, output)
                    sync_dir(output.parent)
                finally:
                    if temporary.exists():
                        shutil.rmtree(temporary)
            return {"directory": str(output), "project": {"id": project["id"], "revision": project["revision"]},
                    "snapshot": build["snapshot"], "config": str(output / "dataset.json"),
                    "csv": str(output / "data.csv"), "lineage": str(output / "sdmx-lineage.json"), "files": files}

    def export_packet(self, ident, output, revision=None):
        with self.mutex:
            selected = self.project(ident, revision)
            selected_revision = selected["project"]["revision"]
            history = [load_json(row["body"]) for row in self.db.execute(
                "SELECT body FROM revisions WHERE project=? AND revision<=? ORDER BY revision", (ident, selected_revision))]
            sources = sorted({sid for p in history for sid in [p["data_source_id"]] + p["metadata_source_ids"]})
            packet = {"schema": PACKET, "project_id": ident, "revision": selected_revision, "sources": [],
                      "revisions": [], "comparisons": [], "files": {}}
            retained = {}
            for sid in sources:
                source = self.source(sid)
                name = "sources/" + sid + ".raw"
                path = self._source_path(sid)
                retained[name] = path
                packet["files"][name] = {"bytes": path.stat().st_size, "sha256": sid}
                packet["sources"].append({"id": sid, "source": source["source"],
                                          "acquisitions": source["acquisitions"]})
            for p in history:
                build = self._build_view(p["build_id"])
                operation = self.db.execute("SELECT * FROM operations WHERE id=?", (p["operation_id"],)).fetchone()
                packet["revisions"].append({"project": p, "build": self._portable_build(build),
                                            "request": load_json(operation["request"])})
            for row in self.db.execute("SELECT body FROM comparisons"):
                comparison = load_json(row["body"])
                if (comparison["before"]["project_id"] == ident and comparison["after"]["project_id"] == ident
                        and comparison["before"]["revision"] <= selected_revision
                        and comparison["after"]["revision"] <= selected_revision):
                    packet["comparisons"].append({"before_revision": comparison["before"]["revision"],
                                                   "after_revision": comparison["after"]["revision"],
                                                   "counts": comparison["counts"]})
            manifest = json_bytes(packet)
            if len(manifest) > MAX_METADATA:
                raise InputError("Portable project manifest exceeds 32 MiB")
            output = Path(output).expanduser().absolute()
            output.parent.mkdir(parents=True, exist_ok=True)
            with self.scratch() as temporary:
                archive = temporary / "packet.zip"
                with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                    def entry(name):
                        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                        info.compress_type = zipfile.ZIP_DEFLATED
                        info.create_system = 3
                        info.external_attr = 0o100600 << 16
                        return info
                    z.writestr(entry("sdmx-packet.json"), manifest)
                    for name, path in sorted(retained.items()):
                        with path.open("rb") as input_file, z.open(entry(name), "w") as target:
                            shutil.copyfileobj(input_file, target, 65536)
                os.chmod(archive, 0o600)
                archive_sha = file_digest(archive, MAX_PACKET)
                archive_bytes = archive.stat().st_size
                if output.exists():
                    if file_digest(output, MAX_PACKET) != archive_sha:
                        raise InputError("An existing packet output belongs to a different project revision")
                else:
                    fd, staged_name = tempfile.mkstemp(prefix=".sdmx-packet-", dir=output.parent)
                    staged = Path(staged_name)
                    try:
                        with os.fdopen(fd, "wb") as out, archive.open("rb") as inp:
                            shutil.copyfileobj(inp, out, 65536)
                            out.flush()
                            os.fsync(out.fileno())
                        try:
                            os.link(staged, output)
                        except FileExistsError:
                            if file_digest(output, MAX_PACKET) != archive_sha:
                                raise InputError("An existing packet output belongs to a different project revision")
                        sync_dir(output.parent)
                    finally:
                        staged.unlink(missing_ok=True)
            return {"path": str(output), "bytes": archive_bytes, "sha256": archive_sha,
                    "project": {"id": ident, "revision": selected_revision}, "snapshot": selected["build"]["snapshot"],
                    "source_count": len(sources), "revision_count": len(history)}

    def import_packet(self, path):
        path = Path(path).expanduser().absolute()
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_PACKET:
            raise InputError("Select a regular SDMX project packet within 1 GiB")
        with self.mutex, zipfile.ZipFile(path) as z:
            items = z.infolist()
            if len(items) > 4096 or len({i.filename for i in items}) != len(items):
                raise InputError("Packet contains repeated or excessive members")
            if "sdmx-packet.json" not in z.namelist():
                raise InputError("Packet manifest is missing")
            manifest_info = z.getinfo("sdmx-packet.json")
            if manifest_info.file_size > MAX_METADATA:
                raise InputError("Packet manifest exceeds 32 MiB")
            manifest = load_json(z.read("sdmx-packet.json"))
            if manifest.get("schema") != PACKET:
                raise InputError("Unsupported SDMX project packet")
            declared = manifest.get("files")
            if not isinstance(declared, dict) or set(z.namelist()) != set(declared) | {"sdmx-packet.json"}:
                raise InputError("Packet file set differs from its manifest")
            total = 0
            for item in items:
                if (item.is_dir() or item.filename.startswith("/") or "\\" in item.filename
                        or any(part in {"", ".", ".."} for part in item.filename.split("/"))
                        or stat.S_IFMT(item.external_attr >> 16) not in {0, stat.S_IFREG}
                        or item.flag_bits & 1):
                    raise InputError("Packet paths must be unencrypted regular files")
                total += item.file_size
                if total > MAX_PACKET or item.file_size > MAX_SOURCE:
                    raise InputError("Packet expands beyond its declared source limits")
                if item.filename == "sdmx-packet.json":
                    continue
                expected = declared[item.filename]
                if item.file_size != expected.get("bytes") or not HEX.fullmatch(expected.get("sha256", "")):
                    raise InputError("Packet member size or identity differs from its declaration")
                h, observed = hashlib.sha256(), 0
                with z.open(item) as stream:
                    while block := stream.read(65536):
                        observed += len(block)
                        h.update(block)
                if observed != item.file_size or h.hexdigest() != expected["sha256"]:
                    raise InputError("Packet source bytes differ from their original content")
            sources, revisions = manifest.get("sources"), manifest.get("revisions")
            if not isinstance(sources, list) or not isinstance(revisions, list) or not revisions:
                raise InputError("Packet has no retained source and project history")
            identity(manifest.get("project_id"), PROJECT_ID)
            if [r["project"]["revision"] for r in revisions] != list(range(1, manifest["revision"] + 1)):
                raise InputError("Packet must contain the complete ordered project history")
            for record in sources:
                sid = identity(record["id"])
                info = record["source"]
                source_path = "sources/" + sid + ".raw"
                if (info.get("sha256") != sid or source_path not in declared
                        or declared[source_path].get("sha256") != sid
                        or declared[source_path].get("bytes") != info.get("bytes")):
                    raise InputError("Packet source reference differs from its original bytes")
            # Preflight every exact original request before applying its recoverable history.
            for record in revisions:
                p, request = record["project"], self._request(record["request"])
                if p["id"] != manifest["project_id"] or request != record["request"]:
                    raise InputError("Packet project history contains a different or unnormalized request")
                old = self.db.execute("SELECT body FROM revisions WHERE project=? AND revision=?",
                                      (p["id"], p["revision"])).fetchone()
                if old and load_json(old["body"]) != p:
                    raise InputError("This workspace retains a different project revision under that identity")
            for record in sources:
                sid, info = record["id"], record["source"]
                meta = {key: info[key] for key in ("name", "label", "origin", "kind", "media_type")}
                meta["coverage"] = {key: info["coverage"][key] for key in (
                    "start_period", "end_period", "updated_after", "completeness", "selection") if key in info["coverage"]}
                with z.open("sources/" + sid + ".raw") as stream:
                    already_retained = self.db.execute("SELECT 1 FROM sources WHERE id=?", (sid,)).fetchone()
                    imported = self.add_source(stream, meta)
                if imported["id"] != sid:
                    raise InputError("Imported source has a different identity")
                with self.db:
                    # Preserve the original acquisition and source timestamps, not import time.
                    if not already_retained:
                        for field in ("sha256", "bytes", "kind", "format", "series_count", "observation_count"):
                            if imported[field] != info.get(field):
                                raise InputError("Packet source summary differs from its actual parsed bytes")
                        self.db.execute("UPDATE sources SET info=? WHERE id=?", (json_bytes(info).decode(), sid))
                    for acquisition in record.get("acquisitions", []):
                        aid = digest(json_bytes(acquisition))
                        self.db.execute("INSERT OR IGNORE INTO acquisitions VALUES(?,?,?)",
                            (aid, sid, json_bytes(acquisition).decode()))
            for record in revisions:
                p = record["project"]
                old = self.db.execute("SELECT 1 FROM revisions WHERE project=? AND revision=?", (p["id"], p["revision"])).fetchone()
                if old:
                    build = self.project(p["id"], p["revision"])["build"]
                    self._check_portable_build(build, record["build"])
                else:
                    self._save_revision(record["request"], retained=p, expected_build=record["build"])
            for item in manifest.get("comparisons", []):
                comparison = self.compare(manifest["project_id"], manifest["project_id"],
                                          item["before_revision"], item["after_revision"])
                if comparison["counts"] != item["counts"]:
                    raise InputError("Reconstructed comparison differs from its original retained result")
            result = self.project(manifest["project_id"], manifest["revision"])
            packet_digest = hashlib.sha256()
            with path.open("rb") as stream:
                while block := stream.read(65536):
                    packet_digest.update(block)
            return {"project": result["project"], "build": result["build"],
                    "source_count": len(sources), "revision_count": len(revisions),
                    "packet_sha256": packet_digest.hexdigest()}

