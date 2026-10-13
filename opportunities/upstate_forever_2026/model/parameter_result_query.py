"""Page exact retained parameter-result JSON without reparsing its full matrix.

The derivative SQLite index retains byte spans and original row hashes. Scientific
values continue to come from the retained JSON, with its original descriptor.
"""
from __future__ import annotations

from collections import OrderedDict
import codecs
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading

from .common import canonical, digest, held, identifier, relative_file
from .model_selection import selected
from .parameter_studies import _bind_state
from .record_catalog import ProjectedFileCache

EDITION = "parameter-result-query/1"
CHUNK = 256 * 1024
_ARRAYS = {"rows", "ranges", "cases"}
_METADATA = ("title", "purpose", "design", "models", "mass_basis",
             "completed_cases", "total_cases", "areas", "comparison_basis",
             "range_basis", "invest_version", "invest_version_basis",
             "baseline_selection", "native_versions", "native_run_selections",
             "native_version_labels", "native_version_guides", "aggregation")
_ALLOWED = set(_METADATA) | {"schema", "experiment_id", "workspace_id", "selection"}


def _signature(stat):
    return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns]


def _integer(value, default, *, maximum=None):
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        raise ValueError("Use nonnegative whole numbers for result pages")
    try:
        parsed = int(value)
    except (ValueError, TypeError, OverflowError):
        raise ValueError("Use nonnegative whole numbers for result pages") from None
    if parsed < 0 or str(parsed) != str(value) or (maximum is not None and parsed > maximum):
        raise ValueError("The result page is outside its supported page-size range")
    return parsed


class _JSON:
    """Incremental UTF-8 JSON reader, tracking exact original byte offsets."""
    def __init__(self, stream, offset=0):
        self.stream, self.sha, self.read_bytes = stream, hashlib.sha256(), 0
        remaining = offset
        while remaining:
            body = stream.read(min(CHUNK, remaining))
            if not body:
                raise ValueError("The retained result ended before its saved index checkpoint")
            self.sha.update(body)
            self.read_bytes += len(body)
            remaining -= len(body)
        self.decoder = codecs.getincrementaldecoder("utf-8")("strict")
        self.json = json.JSONDecoder(parse_constant=self._invalid_constant)
        self.buffer, self.position, self.offset, self.eof = "", 0, offset, False

    @staticmethod
    def _invalid_constant(value):
        raise ValueError("The original scientific JSON contains a nonfinite value: " + value)

    def _fill(self):
        if self.eof:
            return False
        if self.position:
            self.buffer = self.buffer[self.position:]
            self.position = 0
        body = self.stream.read(CHUNK)
        self.sha.update(body)
        self.read_bytes += len(body)
        self.eof = not body
        self.buffer += self.decoder.decode(body, final=self.eof)
        return bool(body)

    def _consume(self, end):
        raw = self.buffer[self.position:end].encode("utf-8")
        self.offset += len(raw)
        self.position = end
        return raw

    def space(self):
        while True:
            start = self.position
            while self.position < len(self.buffer) and self.buffer[self.position] in " \t\r\n":
                self.position += 1
            self.offset += self.position - start
            if self.position < len(self.buffer) or self.eof:
                return
            self._fill()

    def peek(self):
        self.space()
        return self.buffer[self.position:self.position + 1]

    def take(self, wanted):
        if self.peek() != wanted:
            raise ValueError("The retained result JSON has an unexpected delimiter")
        self._consume(self.position + 1)

    def value(self, *, key=False):
        self.space()
        start = self.offset
        while True:
            try:
                value, end = self.json.raw_decode(self.buffer, self.position)
                tail = self.buffer[end:end + 1]
                # A number can be split at a chunk boundary. Wait for its actual delimiter.
                delimiters = " \t\r\n,]}" + (":" if key else "")
                if not self.eof and (end == len(self.buffer) or (tail and tail not in delimiters)):
                    self._fill()
                    continue
                if tail and tail not in delimiters:
                    raise ValueError("The retained JSON value has an invalid delimiter")
                raw = self._consume(end)
                return value, start, raw
            except json.JSONDecodeError:
                if not self._fill():
                    raise ValueError("The retained result JSON is incomplete or invalid") from None

    def finish(self):
        if self.peek():
            raise ValueError("The retained scientific JSON has trailing content")
        return self.read_bytes, self.sha.hexdigest()


def _set(db, name, value):
    db.execute("INSERT OR REPLACE INTO metadata(name,body) VALUES (?,?)",
               (name, canonical(value).decode("utf-8")))


def _get(db, name):
    row = db.execute("SELECT body FROM metadata WHERE name=?", (name,)).fetchone()
    return json.loads(row[0]) if row else None


def _checkpoint(db, reader, cursor, metadata):
    cursor["offset"] = reader.offset
    _set(db, "cursor", cursor)
    _set(db, "result", metadata)
    db.commit()


def _build(path, source, identity, fingerprint):
    """Continue an exact source-bound parser checkpoint; publish only after full hashing."""
    if path.is_symlink():
        raise ValueError("The result query index must be an ordinary derivative file")
    db = sqlite3.connect(path)
    try:
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY,body TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS spans(kind TEXT NOT NULL, ordinal INTEGER NOT NULL,"
                   "area_id TEXT NOT NULL,pollutant TEXT NOT NULL,start INTEGER NOT NULL,"
                   "length INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(kind,ordinal))")
        existing = _get(db, "identity")
        if existing is not None and existing != identity:
            raise ValueError("The partial result index belongs to another original result")
        _set(db, "identity", identity)
        cursor = _get(db, "cursor")
        metadata = _get(db, "result") or {}
        if cursor is None:
            cursor = {"offset": 0, "phase": "start", "allow_end": True,
                      "seen": [], "ordinals": {"rows": 0, "ranges": 0, "cases": 0}}
        with source.open("rb") as stream:
            before = _signature(os.fstat(stream.fileno()))
            if before != fingerprint:
                raise ValueError("The original result changed before indexing")
            reader = _JSON(stream, cursor["offset"])
            pending = 0
            while cursor["phase"] != "done":
                phase = cursor["phase"]
                if phase == "start":
                    reader.take("{")
                    cursor.update(phase="root", allow_end=True)
                    continue
                if phase == "root":
                    if reader.peek() == "}":
                        if not cursor["allow_end"]:
                            raise ValueError("The retained result has a trailing object comma")
                        reader.take("}")
                        cursor["phase"] = "done"
                        break
                    key, _, _ = reader.value(key=True)
                    if not isinstance(key, str) or key in cursor["seen"]:
                        raise ValueError("The retained result must have distinct JSON member names")
                    cursor["seen"].append(key)
                    reader.take(":")
                    if key in _ARRAYS:
                        reader.take("[")
                        cursor.update(phase=key, allow_end=True)
                        continue
                    value, _, _ = reader.value()
                    if key in _ALLOWED:
                        if key == "aggregation" and isinstance(value, dict):
                            value = {name: item for name, item in value.items() if name != "pairs"}
                        metadata[key] = value
                    pending += 1
                elif phase in _ARRAYS:
                    if reader.peek() == "]":
                        if not cursor["allow_end"]:
                            raise ValueError("The retained result has a trailing array comma")
                        reader.take("]")
                        cursor["phase"] = "root"
                    else:
                        value, start, raw = reader.value()
                        if not isinstance(value, dict):
                            raise ValueError("The retained result arrays must contain original row objects")
                        if phase != "cases":
                            if not all(isinstance(value.get(name), str) for name in ("area_id", "pollutant")):
                                raise ValueError("The original result row has no area/pollutant identity")
                            db.execute("INSERT INTO spans VALUES (?,?,?,?,?,?,?)", (
                                phase, cursor["ordinals"][phase], value["area_id"], value["pollutant"],
                                start, len(raw), hashlib.sha256(raw).hexdigest()))
                        cursor["ordinals"][phase] += 1
                        pending += 1
                        delimiter = reader.peek()
                        if delimiter == ",":
                            reader.take(",")
                            cursor["allow_end"] = False
                            if pending >= 500:
                                _checkpoint(db, reader, cursor, metadata)
                                pending = 0
                            continue
                        if delimiter != "]":
                            raise ValueError("The retained result array is not terminated")
                        reader.take("]")
                        cursor["phase"] = "root"
                else:
                    raise ValueError("The saved result index parser checkpoint is invalid")
                delimiter = reader.peek()
                if delimiter == ",":
                    reader.take(",")
                    cursor.update(phase="root", allow_end=False)
                elif delimiter == "}":
                    reader.take("}")
                    cursor["phase"] = "done"
                else:
                    raise ValueError("The retained result object is not terminated")
                if pending >= 500:
                    _checkpoint(db, reader, cursor, metadata)
                    pending = 0
            size, checksum = reader.finish()
            if _signature(os.fstat(stream.fileno())) != before:
                raise ValueError("The original result changed while indexing")
        if _signature(source.stat()) != fingerprint:
            raise ValueError("The original result was replaced while indexing")
        if size != identity["artifact"]["bytes"] or checksum != identity["artifact"]["sha256"]:
            raise ValueError("The retained scientific result differs from its original descriptor")
        if (metadata.get("schema") != "upstate.parameter-experiment-results/v1"
                or metadata.get("experiment_id") != identity["experiment_id"]
                or metadata.get("workspace_id") != identity["workspace_id"]
                or not {"rows", "ranges", "areas"}.issubset(cursor["seen"])):
            raise ValueError("The scientific result belongs to another saved study")
        metadata["row_count"] = cursor["ordinals"]["rows"]
        metadata["range_count"] = cursor["ordinals"]["ranges"]
        metadata["pollutants"] = [row[0] for row in db.execute(
            "SELECT DISTINCT pollutant FROM spans WHERE kind='rows' ORDER BY pollutant")]
        db.execute("CREATE INDEX IF NOT EXISTS spans_area ON spans(kind,area_id,ordinal)")
        db.execute("CREATE INDEX IF NOT EXISTS spans_pollutant ON spans(kind,pollutant,ordinal)")
        db.execute("CREATE INDEX IF NOT EXISTS spans_both ON spans(kind,area_id,pollutant,ordinal)")
        db.execute("CREATE TABLE IF NOT EXISTS counts(kind TEXT,area_id TEXT,pollutant TEXT,n INTEGER)")
        db.execute("DELETE FROM counts")
        db.execute("INSERT INTO counts SELECT kind,area_id,pollutant,count(*) FROM spans "
                   "GROUP BY kind,area_id,pollutant")
        _set(db, "fingerprint", fingerprint)
        _set(db, "complete", True)
        _checkpoint(db, reader, cursor, metadata)
    finally:
        db.close()
    with path.open("rb") as incoming:
        os.fsync(incoming.fileno())


class ParameterResults:
    """Bounded metadata cache and persistent source-relative row indexes."""
    def __init__(self):
        self.records = ProjectedFileCache(max_bytes=16 * 1024 * 1024)
        self._verified, self._guard = OrderedDict(), threading.RLock()

    def checkpoint(self, workspace, key):
        key = identifier(key)
        spec_path = workspace.root / "experiment-specs" / (key + ".json")
        def spec_projection(value):
            if digest(value) != key:
                raise ValueError("Retained parameter-study specification changed")
            return {**value, "id": key}
        spec = self.records.read(spec_path, spec_projection)
        def projection(value):
            result = dict(_bind_state(workspace, key, spec, value))
            result["case_count"] = len(result.get("cases", []))
            result.pop("cases", None)
            return result
        state = self.records.read(workspace.root / "experiments" / key / "experiment.json", projection)
        return _bind_state(workspace, key, spec, state)

    @staticmethod
    def _open(path):
        if path.is_symlink() or not path.is_file():
            raise ValueError("The retained query index is not an ordinary file")
        return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)

    def _source_verified(self, source, fingerprint, identity, retained):
        cache_key = (str(source), identity["artifact"]["sha256"])
        with self._guard:
            known = self._verified.get(cache_key)
        if fingerprint == retained or known == fingerprint:
            return
        sha, size = hashlib.sha256(), 0
        with source.open("rb") as incoming:
            before = _signature(os.fstat(incoming.fileno()))
            for body in iter(lambda: incoming.read(CHUNK), b""):
                sha.update(body)
                size += len(body)
            after = _signature(os.fstat(incoming.fileno()))
        if (before != fingerprint or after != before or _signature(source.stat()) != before
                or sha.hexdigest() != identity["artifact"]["sha256"]
                or size != identity["artifact"]["bytes"]):
            raise ValueError("The original scientific result changed after its query index was saved")
        with self._guard:
            self._verified[cache_key] = fingerprint
            self._verified.move_to_end(cache_key)
            while len(self._verified) > 128:
                self._verified.popitem(last=False)

    def _index(self, workspace, key, artifact):
        if (type(artifact.get("bytes")) is not int or artifact["bytes"] < 0
                or not re.fullmatch(r"[0-9a-f]{64}", artifact.get("sha256", ""))):
            raise ValueError("The saved result needs its original byte and SHA256 descriptor")
        directory = workspace.root / "experiments" / key
        source = relative_file(directory, artifact["path"])
        fingerprint = _signature(source.stat())
        if fingerprint[2] != artifact["bytes"]:
            raise ValueError("The saved scientific result byte length changed")
        identity = {"edition": EDITION, "workspace_id": workspace.project["id"],
                    "experiment_id": key, "artifact": {
                        name: artifact[name] for name in ("path", "bytes", "sha256")}}
        root = directory / "result-queries"
        final = root / (digest(identity) + ".sqlite")
        if not final.exists():
            # Native summary publication uses this original lock. Existing complete
            # indexes remain readable while later calculations are running.
            with held(directory / ".experiment.lock", blocking=False):
                with held(root / ".query-index.lock", blocking=False):
                    if not final.exists():
                        current = self.checkpoint(workspace, key).get("artifacts", {}).get("results")
                        if current != artifact:
                            raise ValueError("The saved result edition changed; reopen its current results")
                        partial = final.with_suffix(".partial.sqlite")
                        _build(partial, source, identity, fingerprint)
                        os.replace(partial, final)
                        if os.name != "nt":
                            fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                            try:
                                os.fsync(fd)
                            finally:
                                os.close(fd)
        db = self._open(final)
        try:
            if _get(db, "identity") != identity or _get(db, "complete") is not True:
                raise ValueError("The derivative index belongs to another original result edition")
            self._source_verified(source, fingerprint, identity, _get(db, "fingerprint"))
            return db, source, fingerprint, _get(db, "result")
        except BaseException:
            db.close()
            raise

    @staticmethod
    def _where(kind, area_id, pollutant):
        clauses, values = ["kind=?"], [kind]
        for field, value in (("area_id", area_id), ("pollutant", pollutant)):
            if value:
                clauses.append(field + "=?")
                values.append(value)
        return " AND ".join(clauses), values

    def _page(self, db, stream, kind, area_id, pollutant, offset, limit):
        where, params = self._where(kind, area_id, pollutant)
        total = db.execute("SELECT coalesce(sum(n),0) FROM counts WHERE " + where, params).fetchone()[0]
        if limit is not None and offset >= total:
            offset = max(0, ((total - 1) // limit) * limit)
        query = "SELECT start,length,sha256,area_id,pollutant FROM spans WHERE " + where + " ORDER BY ordinal"
        if limit is not None:
            query += " LIMIT ? OFFSET ?"
            params += [limit, offset]
        rows = []
        for start, length, checksum, area, substance in db.execute(query, params):
            if start < 0 or length < 0:
                raise ValueError("The retained result index contains an invalid byte span")
            stream.seek(start)
            body = stream.read(length)
            if len(body) != length or hashlib.sha256(body).hexdigest() != checksum:
                raise ValueError("An original result row differs from its retained query span")
            row = json.loads(body)
            if row.get("area_id") != area or row.get("pollutant") != substance:
                raise ValueError("An indexed result row differs from its original filter identity")
            rows.append(row)
        return rows, total, offset

    def read(self, workspace, key, *, area_id=None, pollutant=None, offset=0, limit=100,
             range_offset=0, range_limit=None, expected_artifact_sha256=None):
        key = identifier(key)
        offset, limit = _integer(offset, 0), _integer(limit, 100, maximum=1000)
        range_offset = _integer(range_offset, 0)
        range_limit = _integer(range_limit, None, maximum=1000)
        if limit == 0 or range_limit == 0:
            raise ValueError("Result and range page sizes must be positive")
        state = self.checkpoint(workspace, key)
        artifact = state.get("artifacts", {}).get("results")
        if not artifact:
            raise FileNotFoundError("Run or summarize completed cases to create study results")
        reset = bool(expected_artifact_sha256 and expected_artifact_sha256 != artifact["sha256"])
        if reset:
            offset = range_offset = 0
        db, source, signature, result = self._index(workspace, key, artifact)
        try:
            area_ids = {area["id"] for area in result["areas"]}
            if area_id and area_id not in area_ids:
                if reset:
                    area_id = None
                else:
                    raise ValueError("Choose a reporting area from this saved result")
            if pollutant and pollutant not in result["pollutants"]:
                if reset:
                    pollutant = None
                else:
                    raise ValueError("Choose a pollutant from this saved result")
            with source.open("rb") as stream:
                if _signature(os.fstat(stream.fileno())) != signature:
                    raise ValueError("The original result changed before reading its page")
                rows, filtered, offset = self._page(db, stream, "rows", area_id, pollutant, offset, limit)
                ranges, filtered_ranges, range_offset = self._page(
                    db, stream, "ranges", area_id, pollutant, range_offset, range_limit)
                if _signature(os.fstat(stream.fileno())) != signature or _signature(source.stat()) != signature:
                    raise ValueError("The original scientific result changed while reading its page")
            current = self.checkpoint(workspace, key)
            if current.get("artifacts", {}).get("results") != artifact:
                raise ValueError("A newer scientific summary was published; refresh its result page")
            return {
                **{name: result[name] for name in _METADATA if name in result},
                "experiment_id": key, "models": result.get("models") or list(selected(result["baseline_selection"])),
                "mass_basis": result.get("mass_basis", "Sum of retained annual mass per pixel."),
                "pollutants": result["pollutants"], "rows": rows, "ranges": ranges,
                "total_rows": result["row_count"], "filtered_rows": filtered,
                "offset": offset, "limit": limit,
                "total_ranges": result["range_count"], "filtered_ranges": filtered_ranges,
                "range_offset": range_offset, "range_limit": range_limit,
                "area_id": area_id or "", "pollutant": pollutant or "",
                "artifact_sha256": artifact["sha256"], "artifact_bytes": artifact["bytes"],
                "edition_changed": reset, "query_edition": EDITION,
                "saved_study_state": current["state"], "saved_study_progress": current.get("progress"),
            }
        finally:
            db.close()


DEFAULT_RESULTS = ParameterResults()
