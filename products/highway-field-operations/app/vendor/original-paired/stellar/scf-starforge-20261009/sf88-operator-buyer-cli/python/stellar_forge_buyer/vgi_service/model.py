"""Durable VGI publications in the original purchased-result warehouse.

Acquisition, paid delivery, query execution and native backup remain with the
original buyer. A publication reads one completed retained export and stores
bounded, ordered Arrow IPC batches in that same DuckDB transaction.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat

from stellar_forge_buyer.duckdb_agent import read_identity
from stellar_forge_buyer.duckdb_dataset import SCHEMA as WORKSPACE_SCHEMA, _name
from stellar_forge_buyer.errors import StateError
from stellar_forge_buyer.storage import parse

SCHEMA = "stellar-forge.sf100.vgi-service.v1"
_HEX = re.compile(r"[0-9a-f]{64}")
_REQUEST = re.compile(r"[0-9a-f]{32}")
_CHUNK = 1024 * 1024
_MAX_JSON = 16 * 1024 * 1024
_MAX_COLUMNS = 2048
_MAX_FILES = 4096
_MAX_BATCHES = 100000
LIMITS = {
    "input_batch_rows": 4096,
    "ipc_batch_bytes": 4 * 1024 * 1024,
    "parquet_row_group_uncompressed_bytes": 128 * 1024 * 1024,
    "schema_bytes": 1024 * 1024,
    "metadata_file_bytes": _MAX_JSON,
    "publication_batches": _MAX_BATCHES,
}


def _fail(code):
    raise StateError(code)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _json(value):
    try:
        value = json.dumps(value, ensure_ascii=False, allow_nan=False,
                           sort_keys=True, separators=(",", ":"))
        if len(value.encode("utf-8")) > _MAX_JSON:
            _fail("VGI_RECORD_TOO_LARGE")
        return value
    except (ValueError, UnicodeError, TypeError):
        _fail("VGI_JSON_VALUE_INVALID")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _copy(value):
    return parse(_json(value).encode())


def _fields(value, required, optional=()):
    if (not isinstance(value, dict) or not set(required).issubset(value)
            or set(value) - set(required) - set(optional)):
        _fail("VGI_REQUEST_FIELDS_INVALID")


def _integer(value, minimum=0, maximum=2**63 - 1):
    if type(value) is not int or not minimum <= value <= maximum:
        _fail("VGI_INTEGER_INVALID")
    return value


def _hex(value):
    if not isinstance(value, str) or not _HEX.fullmatch(value):
        _fail("VGI_SHA256_REQUIRED")
    return value


def _request_id(value):
    if not isinstance(value, str) or not _REQUEST.fullmatch(value):
        _fail("VGI_REQUEST_ID_REQUIRED")
    return value


def _text(value, limit=512, *, empty=False):
    if not isinstance(value, str) or (not value and not empty) or "\x00" in value:
        _fail("VGI_TEXT_INVALID")
    try:
        if len(value.encode("utf-8")) > limit:
            _fail("VGI_TEXT_INVALID")
    except UnicodeError:
        _fail("VGI_TEXT_INVALID")
    return value


def _configuration(value):
    _fields(value, ("catalog_name", "label", "principals", "allow_local"))
    _name(value["catalog_name"])
    _text(value["label"], 1024)
    names = value["principals"]
    if not isinstance(names, list) or len(names) > 1024 or type(value["allow_local"]) is not bool:
        _fail("VGI_CONFIGURATION_INVALID")
    for name in names:
        _text(name)
        if name != name.strip():
            _fail("VGI_EXACT_PRINCIPAL_REQUIRED")
    if len(set(names)) != len(names):
        _fail("VGI_DUPLICATE_PRINCIPAL")
    return {"catalog_name": value["catalog_name"], "label": value["label"],
            "principals": list(names), "allow_local": value["allow_local"]}


def _member_name(value):
    _text(value, 4096)
    pure = PurePosixPath(value)
    if (pure.is_absolute() or str(pure) != value or "\\" in value
            or any(part in {"", ".", ".."} for part in value.split("/"))):
        _fail("VGI_EXPORT_MEMBER_NAME_INVALID")
    return value


def _descriptor(value):
    if not isinstance(value, dict):
        _fail("VGI_EXPORT_DESCRIPTOR_INVALID")
    name = _member_name(value.get("name"))
    return {"name": name, "bytes": _integer(value.get("bytes")),
            "sha256": _hex(value.get("sha256")),
            "mime": _text(value.get("mime", "application/octet-stream"), 256)}


def _fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _private_regular(info, expected_size):
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_mode & 0o077 or info.st_size != expected_size):
        _fail("VGI_EXPORT_MEMBER_CHANGED")


@contextmanager
def _member(directory_fd, descriptor):
    """Open each selected component without following a symlink."""
    parent_fd = os.dup(directory_fd)
    stream = None
    try:
        parts = descriptor["name"].split("/")
        for part in parts[:-1]:
            new_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=parent_fd)
            os.close(parent_fd)
            parent_fd = new_fd
            info = os.fstat(parent_fd)
            if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
                _fail("VGI_PRIVATE_EXPORT_DIRECTORY_REQUIRED")
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        stream = os.fdopen(fd, "rb")
        before = os.fstat(stream.fileno())
        _private_regular(before, descriptor["bytes"])
        checksum = hashlib.sha256()
        total = 0
        while block := stream.read(_CHUNK):
            total += len(block)
            checksum.update(block)
        after = os.fstat(stream.fileno())
        if (total != descriptor["bytes"] or checksum.hexdigest() != descriptor["sha256"]
                or _fingerprint(before) != _fingerprint(after)):
            _fail("VGI_EXPORT_MEMBER_CHANGED")
        stream.seek(0)
        yield stream
        after = os.fstat(stream.fileno())
        named = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
        if (_fingerprint(before) != _fingerprint(after)
                or _fingerprint(after) != _fingerprint(named)):
            _fail("VGI_EXPORT_MEMBER_CHANGED")
    except OSError:
        _fail("VGI_EXPORT_FILE_UNAVAILABLE")
    finally:
        if stream is not None:
            stream.close()
        os.close(parent_fd)


def _arrow():
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        _fail("VGI_PYARROW_DEPENDENCY_REQUIRED")
    return pa, pq


def _schema_info(schema):
    raw = schema.serialize().to_pybytes()
    if len(raw) > LIMITS["schema_bytes"] or not 1 <= len(schema) <= _MAX_COLUMNS:
        _fail("VGI_ARROW_SCHEMA_LIMIT")
    if len({field.name.casefold() for field in schema}) != len(schema):
        _fail("VGI_ARROW_UNIQUE_COLUMN_NAMES_REQUIRED")
    for field in schema:
        _text(field.name, 240)
    return {"arrow_schema_base64": base64.b64encode(raw).decode("ascii"),
            "arrow_schema_sha256": _sha(raw),
            "arrow_columns": [{"name": field.name, "type": str(field.type),
                               "nullable": field.nullable} for field in schema]}


def _ipc_parts(batch, pa):
    """Split by retained row positions; never cast or rescan the result."""
    if batch.num_rows == 0:
        return
    if batch.num_rows > 1 and batch.nbytes > LIMITS["ipc_batch_bytes"] - 65536:
        middle = batch.num_rows // 2
        yield from _ipc_parts(batch.slice(0, middle), pa)
        yield from _ipc_parts(batch.slice(middle), pa)
        return
    if batch.num_rows == 1 and batch.nbytes > LIMITS["ipc_batch_bytes"]:
        _fail("VGI_SINGLE_ROW_EXCEEDS_IPC_LIMIT")
    sink = pa.BufferOutputStream()
    options = pa.ipc.IpcWriteOptions(metadata_version=pa.ipc.MetadataVersion.V5,
                                     use_legacy_format=False, use_threads=False)
    with pa.ipc.new_stream(sink, batch.schema, options=options) as writer:
        writer.write_batch(batch)
    raw = sink.getvalue().to_pybytes()
    if len(raw) > LIMITS["ipc_batch_bytes"]:
        if batch.num_rows == 1:
            _fail("VGI_SINGLE_ROW_EXCEEDS_IPC_LIMIT")
        middle = batch.num_rows // 2
        yield from _ipc_parts(batch.slice(0, middle), pa)
        yield from _ipc_parts(batch.slice(middle), pa)
        return
    yield raw, batch.num_rows


class VgiService:
    """One catalog inside DuckDBWorkspace, with its original lock and identity.

    export_locations is a trusted receiving-time placement map. Original export
    rows and manifests retain their original paths and hashes. This map selects
    only where to read those exact members on the receiving host.
    """

    def __init__(self, workspace, *, export_locations=None):
        if not callable(getattr(workspace, "_guard", None)) or not callable(
                getattr(workspace, "_connection", None)):
            _fail("VGI_ORIGINAL_WORKSPACE_REQUIRED")
        self.workspace = workspace
        self.export_locations = {}
        if export_locations is not None:
            if not isinstance(export_locations, dict):
                _fail("VGI_EXPORT_LOCATIONS_INVALID")
            for identity, directory in export_locations.items():
                _hex(identity)
                if not isinstance(directory, (str, Path)):
                    _fail("VGI_EXPORT_LOCATION_INVALID")
                selected = Path(directory).expanduser().absolute()
                self.export_locations[identity] = selected
        with workspace._guard(), workspace._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_meta(key VARCHAR PRIMARY KEY,value VARCHAR NOT NULL)")
                prior = db.execute("SELECT value FROM sf_vgi_meta WHERE key='schema'").fetchone()
                if prior and prior[0] != SCHEMA:
                    _fail("VGI_SERVICE_SCHEMA_MISMATCH")
                identity = read_identity(db)
                for key, value in (("schema", SCHEMA), ("workspace_id", identity),
                                   ("service_id", secrets.token_hex(16)), ("revision", "0")):
                    db.execute("INSERT INTO sf_vgi_meta VALUES(?,?) ON CONFLICT DO NOTHING", [key, value])
                config = {"catalog_name": "purchased_results", "label": "Purchased results",
                          "principals": [], "allow_local": False}
                db.execute("INSERT INTO sf_vgi_meta VALUES('configuration',?) ON CONFLICT DO NOTHING", [_json(config)])
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_secrets(name VARCHAR PRIMARY KEY,content BLOB NOT NULL)")
                db.execute("INSERT INTO sf_vgi_secrets VALUES('state-signing-key',?) ON CONFLICT DO NOTHING",
                           [secrets.token_bytes(32)])
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_tables(name VARCHAR PRIMARY KEY,folded_name VARCHAR UNIQUE NOT NULL,head_revision BIGINT NOT NULL,publication_id VARCHAR NOT NULL,active BOOLEAN NOT NULL,created_at VARCHAR NOT NULL,updated_at VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_publications(id VARCHAR PRIMARY KEY,table_name VARCHAR NOT NULL,created_at VARCHAR NOT NULL,record VARCHAR NOT NULL,record_sha256 VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_batches(publication_id VARCHAR,batch_index BIGINT,row_count BIGINT NOT NULL,byte_count BIGINT NOT NULL,sha256 VARCHAR NOT NULL,content BLOB NOT NULL,PRIMARY KEY(publication_id,batch_index))")
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_reviews(id VARCHAR PRIMARY KEY,export_id VARCHAR NOT NULL,record VARCHAR NOT NULL,created_at VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_requests(id VARCHAR PRIMARY KEY,operation VARCHAR NOT NULL,digest VARCHAR NOT NULL,request VARCHAR NOT NULL,result VARCHAR NOT NULL,completed_at VARCHAR NOT NULL)")
                db.execute("CREATE TABLE IF NOT EXISTS sf_vgi_history(sequence BIGINT PRIMARY KEY,at VARCHAR NOT NULL,request_id VARCHAR NOT NULL,operation VARCHAR NOT NULL,record VARCHAR NOT NULL)")
                self._meta(db)
                key = db.execute("SELECT content FROM sf_vgi_secrets WHERE name='state-signing-key'").fetchone()
                if not key or not isinstance(key[0], bytes) or len(key[0]) != 32:
                    _fail("VGI_SIGNING_KEY_INVALID")
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def _meta(self, db):
        values = dict(db.execute("SELECT key,value FROM sf_vgi_meta").fetchall())
        if values.get("schema") != SCHEMA or values.get("workspace_id") != read_identity(db):
            _fail("VGI_WORKSPACE_IDENTITY_CHANGED")
        if not _REQUEST.fullmatch(values.get("service_id", "")):
            _fail("VGI_SERVICE_IDENTITY_INVALID")
        revision = values.get("revision", "")
        if not re.fullmatch(r"0|[1-9][0-9]*", revision):
            _fail("VGI_SERVICE_REVISION_INVALID")
        return {"schema": SCHEMA, "version": 1, "workspace_id": values["workspace_id"],
                "service_id": values["service_id"], "revision": _integer(int(revision)),
                "configuration": _configuration(parse(values["configuration"].encode()))}

    @staticmethod
    def _tables(db):
        return [dict(zip(("name", "head_revision", "publication_id", "active", "created_at", "updated_at"), row))
                for row in db.execute("SELECT name,head_revision,publication_id,active,created_at,updated_at FROM sf_vgi_tables ORDER BY folded_name").fetchall()]

    @staticmethod
    def _table(db, name):
        row = db.execute("SELECT name,head_revision,publication_id,active,created_at,updated_at FROM sf_vgi_tables WHERE folded_name=?",
                         [name.casefold()]).fetchone()
        if row is None:
            return None
        result = dict(zip(("name", "head_revision", "publication_id", "active", "created_at", "updated_at"), row))
        if result["name"] != name:
            _fail("VGI_TABLE_CASE_COLLISION")
        return result

    def _publication(self, db, publication_id):
        row = db.execute("SELECT table_name,record,record_sha256 FROM sf_vgi_publications WHERE id=?",
                         [_hex(publication_id)]).fetchone()
        if not row:
            _fail("VGI_PUBLICATION_NOT_FOUND")
        raw = row[1].encode()
        if _sha(raw) != row[2]:
            _fail("VGI_RETAINED_PUBLICATION_CHANGED")
        record = parse(raw)
        meta = self._meta(db)
        if (record.get("publication_id") != publication_id or record.get("table_name") != row[0]
                or record.get("workspace_id") != meta["workspace_id"]
                or record.get("service_id") != meta["service_id"]):
            _fail("VGI_RETAINED_PUBLICATION_CHANGED")
        return record

    def state(self):
        with self.workspace._guard(), self.workspace._connection() as db:
            db.execute("BEGIN")
            try:
                state = self._meta(db)
                state["tables"] = self._tables(db)
                state["limits"] = dict(LIMITS)
                state["publications"] = []
                for (identity,) in db.execute("SELECT id FROM sf_vgi_publications ORDER BY created_at,id").fetchall():
                    p = self._publication(db, identity)
                    state["publications"].append({key: p[key] for key in (
                        "publication_id", "table_name", "created_at", "rows", "batch_count",
                        "arrow_schema_sha256", "source", "review_sha256")})
                db.commit()
                return state
            except BaseException:
                db.rollback()
                raise

    def snapshot(self):
        """Catalog heads and all active-alias cursors in one native snapshot."""
        with self.workspace._guard(), self.workspace._connection() as db:
            db.execute("BEGIN")
            try:
                value = self._meta(db)
                value["tables"] = self._tables(db)
                active = {item["name"]: item for item in value["tables"] if item["active"]}
                value["publications"] = [self._publication(db, row["publication_id"]) for row in active.values()]
                value["retained_publications"] = []
                for identity, name in db.execute("SELECT id,table_name FROM sf_vgi_publications ORDER BY created_at,id").fetchall():
                    if name in active:
                        value["retained_publications"].append(self._publication(db, identity))
                value["limits"] = dict(LIMITS)
                db.commit()
                return value
            except BaseException:
                db.rollback()
                raise

    def signing_key(self):
        with self.workspace._guard(), self.workspace._connection() as db:
            self._meta(db)
            row = db.execute("SELECT content FROM sf_vgi_secrets WHERE name='state-signing-key'").fetchone()
            if not row or not isinstance(row[0], bytes) or len(row[0]) != 32:
                _fail("VGI_SIGNING_KEY_INVALID")
            return bytes(row[0])

    @staticmethod
    def _authorize(meta, principal, local):
        if type(local) is not bool:
            _fail("VGI_LOCAL_AUTHENTICATION_INVALID")
        if principal is not None:
            _text(principal)
        config = meta["configuration"]
        if not ((local and config["allow_local"])
                or (principal is not None and principal in config["principals"])):
            _fail("VGI_SERVICE_ACCESS_DENIED")

    def authorize_service(self, principal=None, local=False):
        with self.workspace._guard(), self.workspace._connection() as db:
            meta = self._meta(db)
            self._authorize(meta, principal, local)
            return {key: meta[key] for key in ("workspace_id", "service_id", "revision")}

    def _authorized_publication(self, db, identity, principal, local):
        meta = self._meta(db)
        self._authorize(meta, principal, local)
        publication = self._publication(db, identity)
        table = self._table(db, publication["table_name"])
        if not table or not table["active"]:
            _fail("VGI_TABLE_RETIRED")
        return publication

    def authorize(self, publication_id, principal=None, local=False):
        with self.workspace._guard(), self.workspace._connection() as db:
            value = self._authorized_publication(db, _hex(publication_id), principal, local)
            return {"publication_id": value["publication_id"], "table_name": value["table_name"],
                    "workspace_id": value["workspace_id"], "service_id": value["service_id"]}

    def publication(self, publication_id):
        with self.workspace._guard(), self.workspace._connection() as db:
            return self._publication(db, publication_id)

    def read_batch(self, publication_id, index, principal=None, local=False):
        index = _integer(index)
        with self.workspace._guard(), self.workspace._connection() as db:
            value = self._authorized_publication(db, _hex(publication_id), principal, local)
            if index > value["batch_count"]:
                _fail("VGI_BATCH_CURSOR_INVALID")
            if index == value["batch_count"]:
                return None
            expected = value["batches"][index]
            row = db.execute("SELECT row_count,byte_count,sha256,content FROM sf_vgi_batches WHERE publication_id=? AND batch_index=?",
                             [publication_id, index]).fetchone()
            if (not row or expected["index"] != index or row[0] != expected["rows"]
                    or row[1] != expected["bytes"] or row[2] != expected["sha256"]
                    or not isinstance(row[3], bytes) or len(row[3]) != row[1]
                    or _sha(row[3]) != row[2] or row[1] > LIMITS["ipc_batch_bytes"]):
                _fail("VGI_RETAINED_BATCH_CHANGED")
            return bytes(row[3])

    def _transaction(self, operation, body, apply):
        original = _copy(body)
        request_id = _request_id(original.get("request_id"))
        selected = _json({"operation": operation, "request": original})
        checksum = _sha(selected.encode())
        with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                meta = self._meta(db)
                previous = db.execute("SELECT digest,result FROM sf_vgi_requests WHERE id=?", [request_id]).fetchone()
                if previous:
                    if previous[0] != checksum:
                        _fail("VGI_ORIGINAL_REQUEST_CHANGED")
                    result = parse(previous[1].encode())
                    db.commit()
                    return result
                details = apply(db, meta)
                revision = meta["revision"] + 1
                _integer(revision)
                completed = _now()
                result = {"workspace_id": meta["workspace_id"], "service_id": meta["service_id"],
                          "request_id": request_id, "revision": revision, **details}
                encoded = _json(result)
                db.execute("UPDATE sf_vgi_meta SET value=? WHERE key='revision'", [str(revision)])
                db.execute("INSERT INTO sf_vgi_requests VALUES(?,?,?,?,?,?)",
                           [request_id, operation, checksum, selected, encoded, completed])
                event = {key: result[key] for key in ("workspace_id", "service_id", "request_id", "revision")}
                event.update({key: result[key] for key in ("table", "publication_id", "configuration") if key in result})
                db.execute("INSERT INTO sf_vgi_history VALUES(?,?,?,?,?)",
                           [revision, completed, request_id, operation, _json(event)])
                db.commit()
                return result
            except BaseException:
                db.rollback()
                raise

    def configure(self, request):
        request = _copy(request)
        _fields(request, ("request_id", "expected_revision", "configuration"))
        expected = _integer(request["expected_revision"])
        config = _configuration(request["configuration"])
        body = {**request, "configuration": config}

        def apply(db, meta):
            if meta["revision"] != expected:
                _fail("VGI_SERVICE_REVISION_CONFLICT")
            db.execute("UPDATE sf_vgi_meta SET value=? WHERE key='configuration'", [_json(config)])
            return {"configuration": config}
        return self._transaction("configure", body, apply)

    @contextmanager
    def _export(self, db, export_id, *, batch_rows=4096):
        """Verify the complete original export before and after native reading."""
        batch_rows = _integer(batch_rows, 1, LIMITS["input_batch_rows"])
        selected_limits = {**LIMITS, "input_batch_rows": batch_rows}
        pa, pq = _arrow()
        row = db.execute("SELECT record FROM sf_exports WHERE id=?", [_hex(export_id)]).fetchone()
        if not row:
            _fail("VGI_COMPLETED_EXPORT_REQUIRED")
        if len(row[0].encode()) > _MAX_JSON:
            _fail("VGI_EXPORT_RECORD_TOO_LARGE")
        record = parse(row[0].encode())
        if (record.get("schema") != WORKSPACE_SCHEMA + ".query-export"
                or record.get("state") != "COMPLETE" or record.get("export_id") != export_id):
            _fail("VGI_COMPLETED_EXPORT_REQUIRED")
        _integer(record.get("rows"))
        files = record.get("files")
        if not isinstance(files, list) or not 5 <= len(files) <= _MAX_FILES:
            _fail("VGI_EXPORT_MEMBERS_INVALID")
        descriptors = [_descriptor(item) for item in files]
        names = [item["name"] for item in descriptors]
        if len(set(names)) != len(names) or not set(
                ("manifest.json", "request.json", "execution.json", "result.parquet", "result.csv")).issubset(names):
            _fail("VGI_EXPORT_MEMBERS_INVALID")
        original_directory = Path(_text(record.get("directory"), 16384))
        if not original_directory.is_absolute():
            _fail("VGI_EXPORT_DIRECTORY_INVALID")
        for item in files:
            original_path = item.get("path")
            if original_path is not None and Path(original_path) != original_directory.joinpath(*PurePosixPath(item["name"]).parts):
                _fail("VGI_EXPORT_DESCRIPTOR_PATH_CHANGED")
        directory = self.export_locations.get(export_id, original_directory)
        directory_fd = None
        parquet = None
        try:
            directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            directory_info = os.fstat(directory_fd)
            if not stat.S_ISDIR(directory_info.st_mode) or directory_info.st_mode & 0o077:
                _fail("VGI_PRIVATE_EXPORT_DIRECTORY_REQUIRED")
            exact = {}
            for descriptor in descriptors:
                with _member(directory_fd, descriptor) as stream:
                    if descriptor["name"] in {"manifest.json", "request.json", "execution.json"}:
                        if descriptor["bytes"] > _MAX_JSON:
                            _fail("VGI_EXPORT_METADATA_TOO_LARGE")
                        exact[descriptor["name"]] = stream.read()
            manifest = parse(exact["manifest.json"])
            saved = {**record, "files": [item for item in files if item["name"] != "manifest.json"]}
            if manifest != saved:
                _fail("VGI_EXPORT_MANIFEST_CHANGED")
            request = parse(exact["request.json"])
            execution = parse(exact["execution.json"])
            for key in ("schema", "workspace", "query", "views", "directory", "export_id", "created_at"):
                if request.get(key) != record.get(key):
                    _fail("VGI_EXPORT_REQUEST_CHANGED")
            for key in ("export_id", "rows", "columns", "views"):
                if execution.get(key) != record.get(key):
                    _fail("VGI_EXPORT_EXECUTION_CHANGED")
            query = record.get("query")
            if not isinstance(query, dict):
                _fail("VGI_EXPORT_QUERY_INVALID")
            _hex(query.get("query_id"))
            _integer(query.get("revision"), 1)
            columns = record.get("columns")
            query_columns = record.get("query_columns", columns)
            encodings = record.get("column_encodings", [])
            if (not isinstance(columns, list) or not 1 <= len(columns) <= _MAX_COLUMNS
                    or not isinstance(query_columns, list) or len(query_columns) != len(columns)
                    or not isinstance(encodings, list) or len(encodings) not in (0, len(columns))
                    or query_columns != execution.get("query_columns", columns)
                    or encodings != execution.get("column_encodings", [])):
                _fail("VGI_EXPORT_COLUMN_CONTRACT_CHANGED")
            column_names = []
            for column in columns:
                if not isinstance(column, dict):
                    _fail("VGI_EXPORT_COLUMN_CONTRACT_CHANGED")
                column_names.append(_text(column.get("name"), 240))
                _text(column.get("type"), 8192)
            if len({name.casefold() for name in column_names}) != len(column_names):
                _fail("VGI_EXPORT_COLUMN_CONTRACT_CHANGED")
            if [column.get("name") for column in query_columns] != column_names:
                _fail("VGI_EXPORT_COLUMN_CONTRACT_CHANGED")
            if encodings and [column.get("name") for column in encodings] != column_names:
                _fail("VGI_EXPORT_COLUMN_CONTRACT_CHANGED")
            views = record.get("views")
            if not isinstance(views, list):
                _fail("VGI_EXPORT_VIEW_CONTRACT_CHANGED")
            for view in views:
                if not isinstance(view, dict):
                    _fail("VGI_EXPORT_VIEW_CONTRACT_CHANGED")
                _name(view.get("name"))
                _hex(view.get("edition_id"))
                _integer(view.get("revision"), 1)
            editions = sorted({view["edition_id"] for view in views})
            if editions != record.get("source_editions"):
                _fail("VGI_EXPORT_EDITION_CONTRACT_CHANGED")
            by_name = {item["name"]: item for item in descriptors}
            for key, name in (("parquet", "result.parquet"), ("csv", "result.csv")):
                if _descriptor(execution.get(key)) != by_name[name]:
                    _fail("VGI_EXPORT_EXECUTION_MEMBER_CHANGED")
            parquet_descriptor = by_name["result.parquet"]
            with _member(directory_fd, parquet_descriptor) as stream:
                parquet = pq.ParquetFile(stream, memory_map=False, pre_buffer=False,
                    thrift_string_size_limit=_MAX_JSON, thrift_container_size_limit=1048576,
                    page_checksum_verification=True)
                metadata = parquet.metadata
                if metadata.num_rows != record["rows"] or metadata.num_columns < 1:
                    _fail("VGI_PARQUET_ROW_CONTRACT_CHANGED")
                row_groups = []
                for index in range(metadata.num_row_groups):
                    group = metadata.row_group(index)
                    size = group.total_byte_size
                    if type(size) is not int or size < 0 or size > LIMITS["parquet_row_group_uncompressed_bytes"]:
                        _fail("VGI_PARQUET_ROW_GROUP_LIMIT")
                    row_groups.append({"index": index, "rows": group.num_rows,
                                       "uncompressed_bytes": size})
                schema = parquet.schema_arrow
                schema_info = _schema_info(schema)
                if schema.names != column_names:
                    _fail("VGI_PARQUET_COLUMN_CONTRACT_CHANGED")
                meta = self._meta(db)
                source = {"export_id": export_id,
                          "manifest_sha256": by_name["manifest.json"]["sha256"],
                          "query_id": query["query_id"], "query_revision": query["revision"],
                          "source_editions": editions, "views": views,
                          "members": descriptors,
                          "source_meanings": record.get("source_meanings")}
                reviewed = {"schema": SCHEMA + ".review", "workspace_id": meta["workspace_id"],
                            "service_id": meta["service_id"], "export_id": export_id,
                            "rows": record["rows"], "columns": columns, "query_columns": query_columns,
                            "column_encodings": encodings, "source": source, **schema_info,
                            "parquet_row_groups": row_groups, "limits": selected_limits}
                # Timestamp and host placement are deliberately outside this
                # immutable source selection. Exact bytes bind both hosts.
                checksum = _sha(_json(reviewed).encode())
                yield {"review": reviewed, "review_sha256": checksum,
                       "parquet": parquet, "schema": schema, "pa": pa}
                # Hash all original members again before admitting the result.
                # This also detects writes while Arrow used its retained fd.
                for descriptor in descriptors:
                    with _member(directory_fd, descriptor):
                        pass
                current_directory = os.stat(directory, follow_symlinks=False)
                if ((current_directory.st_dev, current_directory.st_ino)
                        != (directory_info.st_dev, directory_info.st_ino)):
                    _fail("VGI_EXPORT_DIRECTORY_CHANGED")
        except OSError:
            _fail("VGI_EXPORT_FILE_UNAVAILABLE")
        finally:
            if parquet is not None:
                parquet.close()
            if directory_fd is not None:
                os.close(directory_fd)

    def review_export(self, export_id, *, batch_rows=4096):
        with self.workspace._guard(), self.workspace._connection(writeable=True) as db:
            db.execute("BEGIN")
            try:
                with self._export(db, export_id, batch_rows=batch_rows) as source:
                    review = source["review"]
                    checksum = source["review_sha256"]
                    record = _json(review)
                old = db.execute("SELECT record,created_at FROM sf_vgi_reviews WHERE id=?", [checksum]).fetchone()
                if old:
                    if old[0] != record:
                        _fail("VGI_RETAINED_REVIEW_CHANGED")
                    created = old[1]
                else:
                    created = _now()
                    db.execute("INSERT INTO sf_vgi_reviews VALUES(?,?,?,?)",
                               [checksum, export_id, record, created])
                db.commit()
                return {**review, "review_sha256": checksum, "reviewed_at": created}
            except BaseException:
                db.rollback()
                raise

    def publish(self, request):
        request = _copy(request)
        _fields(request, ("request_id", "table_name", "export_id", "review_sha256", "expected_head_revision"))
        name = _name(request["table_name"])
        export_id = _hex(request["export_id"])
        checksum = _hex(request["review_sha256"])
        expected = _integer(request["expected_head_revision"])

        def apply(db, meta):
            table = self._table(db, name)
            head = table["head_revision"] if table else 0
            if head != expected:
                _fail("VGI_TABLE_REVISION_CONFLICT")
            previous = self._publication(db, table["publication_id"]) if table else None
            selected = db.execute("SELECT export_id,record FROM sf_vgi_reviews WHERE id=?", [checksum]).fetchone()
            if not selected or selected[0] != export_id or _sha(selected[1].encode()) != checksum:
                _fail("VGI_ORIGINAL_REVIEW_REQUIRED")
            publication_id = _sha(_json({"schema": SCHEMA + ".publication",
                "workspace_id": meta["workspace_id"], "service_id": meta["service_id"],
                "request": request}).encode())
            batch_rows = _integer(parse(selected[1].encode())["limits"]["input_batch_rows"], 1, LIMITS["input_batch_rows"])
            batches = []
            rows = 0
            with self._export(db, export_id, batch_rows=batch_rows) as source:
                if source["review_sha256"] != checksum or _json(source["review"]) != selected[1]:
                    _fail("VGI_REVIEWED_EXPORT_CHANGED")
                review = source["review"]
                if previous and previous["arrow_schema_base64"] != review["arrow_schema_base64"]:
                    _fail("VGI_ALIAS_SCHEMA_CHANGE_REQUIRES_NEW_TABLE")
                for batch in source["parquet"].iter_batches(
                        batch_size=batch_rows, use_threads=False):
                    if not batch.schema.equals(source["schema"], check_metadata=True):
                        _fail("VGI_PARQUET_SCHEMA_CHANGED")
                    batch.validate(full=True)
                    for raw, count in _ipc_parts(batch, source["pa"]):
                        if len(batches) >= _MAX_BATCHES:
                            _fail("VGI_PUBLICATION_BATCH_LIMIT")
                        index = len(batches)
                        descriptor = {"index": index, "rows": count,
                                      "bytes": len(raw), "sha256": _sha(raw)}
                        db.execute("INSERT INTO sf_vgi_batches VALUES(?,?,?,?,?,?)",
                                   [publication_id, index, count, len(raw), descriptor["sha256"], raw])
                        batches.append(descriptor)
                        rows += count
                if rows != review["rows"]:
                    _fail("VGI_PUBLISHED_ROW_COUNT_CHANGED")
                value = {"schema": SCHEMA + ".publication", "workspace_id": meta["workspace_id"],
                         "service_id": meta["service_id"], "publication_id": publication_id,
                         "table_name": name, "created_at": _now(), "request_id": request["request_id"],
                         "review_sha256": checksum, "rows": rows, "batch_count": len(batches),
                         "batches": batches, "source": review["source"],
                         "columns": review["columns"], "query_columns": review["query_columns"],
                         "column_encodings": review["column_encodings"],
                         "arrow_columns": review["arrow_columns"],
                         "arrow_schema_base64": review["arrow_schema_base64"],
                         "arrow_schema_sha256": review["arrow_schema_sha256"],
                         "limits": review["limits"]}
            encoded = _json(value)
            db.execute("INSERT INTO sf_vgi_publications VALUES(?,?,?,?,?)",
                       [publication_id, name, value["created_at"], encoded, _sha(encoded.encode())])
            changed = value["created_at"]
            created = table["created_at"] if table else changed
            db.execute("INSERT INTO sf_vgi_tables VALUES(?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET head_revision=excluded.head_revision,publication_id=excluded.publication_id,active=excluded.active,updated_at=excluded.updated_at",
                       [name, name.casefold(), head + 1, publication_id, True, created, changed])
            return {"table": self._table(db, name), "publication_id": publication_id, "publication": value}
        return self._transaction("publish", request, apply)

    def activate(self, request):
        request = _copy(request)
        _fields(request, ("request_id", "table_name", "publication_id", "expected_head_revision", "active"))
        name = _name(request["table_name"])
        identity = _hex(request["publication_id"])
        expected = _integer(request["expected_head_revision"], 1)
        if type(request["active"]) is not bool:
            _fail("VGI_TABLE_ACTIVE_FLAG_INVALID")

        def apply(db, meta):
            table = self._table(db, name)
            if not table or table["head_revision"] != expected:
                _fail("VGI_TABLE_REVISION_CONFLICT")
            publication = self._publication(db, identity)
            if publication["table_name"] != name:
                _fail("VGI_PUBLICATION_TABLE_MISMATCH")
            current = self._publication(db, table["publication_id"])
            if publication["arrow_schema_base64"] != current["arrow_schema_base64"]:
                _fail("VGI_ALIAS_SCHEMA_CHANGE_REQUIRES_NEW_TABLE")
            db.execute("UPDATE sf_vgi_tables SET head_revision=?,publication_id=?,active=?,updated_at=? WHERE name=?",
                       [expected + 1, identity, request["active"], _now(), name])
            return {"table": self._table(db, name), "publication_id": identity, "publication": publication}
        return self._transaction("activate", request, apply)

    def operation(self, request_id):
        with self.workspace._guard(), self.workspace._connection() as db:
            self._meta(db)
            row = db.execute("SELECT operation,request,result,completed_at FROM sf_vgi_requests WHERE id=?",
                             [_request_id(request_id)]).fetchone()
            if not row:
                _fail("VGI_OPERATION_NOT_FOUND")
            return {"operation": row[0], "request": parse(row[1].encode()),
                    "result": parse(row[2].encode()), "completed_at": row[3]}

    def history(self, *, before=None, limit=100):
        _integer(limit, 1, 1000)
        if before is not None:
            _integer(before, 1)
        with self.workspace._guard(), self.workspace._connection() as db:
            self._meta(db)
            rows = db.execute("SELECT sequence,at,request_id,operation,record FROM sf_vgi_history WHERE (? IS NULL OR sequence < ?) ORDER BY sequence DESC LIMIT ?",
                              [before, before, limit + 1]).fetchall()
            selected = rows[:limit]
            return {"events": [{"sequence": seq, "at": at, "request_id": req,
                                "operation": op, "result": parse(record.encode())}
                               for seq, at, req, op, record in selected],
                    "next_before": selected[-1][0] if len(rows) > limit else None}
