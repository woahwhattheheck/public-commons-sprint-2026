"""SQL Server operations joined to the original BI migration workspace."""
from __future__ import annotations
import base64
import copy
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import zipfile
from .store import Conflict, atomic_write, digest, encoded, identifier, now
from .compare import read_csv, csv_bytes

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "tools" / "sql-server"
DRIVER_REF = "f18c68077478e1cf7063e5c38be86f0edab39d7a"
SQL_KINDS = ("sql_profile", "sql_query", "sql_job", "sql_capture", "sql_mapping", "sql_delivery", "sql_receipt")
NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
SHA = re.compile(r"^[0-9a-f]{64}$")
_worker_module = None

def worker():
    global _worker_module
    if _worker_module is None:
        spec = importlib.util.spec_from_file_location("commons_bi_sql_native_worker", NATIVE / "SQL_SERVER_WORKER.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _worker_module = module
    return _worker_module

def text(value, label, maximum=1000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or "\0" in value:
        raise ValueError(label + " is required and must fit its declared length.")
    return value.strip()

def record_ref(record):
    return {"kind": record["kind"], "id": record["id"], "revision": record["revision"]}

def packed(files, schema):
    if len(files) > 2000 or sum(map(len, files.values())) > 512 * 1024 * 1024:
        raise ValueError("This portable package exceeds its supported receiving size.")
    manifest = {"schema": schema, "files": [
        {"path": name, "bytes": len(body), "sha256": digest(body)} for name, body in sorted(files.items())]}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, body in sorted(files.items()):
            worker().relative(name)
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, body)
        archive.writestr("MANIFEST.json", encoded(manifest).encode() + b"\n")
    if len(output.getvalue()) > 64 * 1024 * 1024:
        raise ValueError("The portable ZIP exceeds the 64 MiB receiving input limit.")
    return output.getvalue()

def unpacked(data, schema):
    if not isinstance(data, bytes) or len(data) > 64 * 1024 * 1024:
        raise ValueError("Select one complete portable ZIP of at most 64 MiB.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        items = archive.infolist()
        names = [worker().relative(i.filename) for i in items]
        if (len(items) > 2000 or len(names) != len(set(names))
            or any(i.is_dir() or (i.external_attr >> 16) & 0o170000 == 0o120000 or i.file_size > 64 * 1024 * 1024 for i in items)
            or sum(i.file_size for i in items) > 512 * 1024 * 1024):
            raise ValueError("The portable ZIP has invalid or excessive members.")
        files = {i.filename: archive.read(i) for i in items}
    manifest = json.loads(files.pop("MANIFEST.json").decode("utf-8"))
    expected = [{"path": n, "bytes": len(b), "sha256": digest(b)} for n, b in sorted(files.items())]
    if manifest.get("schema") != schema or manifest.get("files") != expected:
        raise ValueError("The complete portable file manifest differs.")
    return files

def connection(value):
    if not isinstance(value, dict) or set(value) - {"host", "port", "database", "user", "passwordEnv", "tls"}:
        raise ValueError("A connection stores server/database/user, TLS and a password environment NAME only.")
    result = copy.deepcopy(value)
    for key in ("host", "database", "user"):
        result[key] = text(result.get(key), "Connection " + key, 1024)
        if any(ord(c) < 32 for c in result[key]):
            raise ValueError("A connection value contains control characters.")
    if re.search(r"[\s/\\]", result["host"]):
        raise ValueError("Use the server host and a separate numeric TCP port.")
    result["port"] = int(result.get("port", 1433))
    if not 1 <= result["port"] <= 65535:
        raise ValueError("The SQL Server port is outside its range.")
    if not re.fullmatch(r"[A-Z_][A-Z0-9_]{0,127}", result.get("passwordEnv", "")):
        raise ValueError("Use the existing password's environment variable NAME.")
    result["tls"] = result.get("tls", "verify-full")
    if result["tls"] not in ("verify-full", "local-plaintext"):
        raise ValueError("Choose verified TLS or explicit local development plaintext.")
    if result["tls"] == "local-plaintext" and result["host"] not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Plaintext is supported only for an explicitly selected loopback database.")
    return result

def query_definition(value):
    if not isinstance(value, dict):
        raise ValueError("A query definition must be an object.")
    result = copy.deepcopy(value)
    if set(result) - {"sql", "parameters", "parameterOrder", "columns", "orderBy", "maxRows", "maxBytes", "timeoutMs"}:
        raise ValueError("The query contains an unknown native declaration field.")
    result["sql"] = text(result.get("sql"), "One reviewed SELECT query", 65536)
    if not re.match(r"(?is)^\s*SELECT\b", result["sql"]):
        raise ValueError("Use one explicit derived SELECT. The original driver performs final native validation.")
    columns = result.get("columns")
    if (not isinstance(columns, list) or not 1 <= len(columns) <= 64 or len(set(columns)) != len(columns)
        or any(not isinstance(c, str) or not NAME.fullmatch(c) for c in columns)):
        raise ValueError("Choose 1–64 unique projected aliases using letters, numbers and underscores.")
    params = result.get("parameters", {})
    if not isinstance(params, dict) or len(params) > 64:
        raise ValueError("Use at most 64 named native parameters.")
    for key, spec in params.items():
        if (not NAME.fullmatch(key) or key.startswith("__sf30_") or not isinstance(spec, dict)
            or spec.get("type") not in ("string", "integer", "number", "boolean", "decimal")):
            raise ValueError("Use the original named scalar or exact-decimal parameter contract.")
    result["parameters"] = params
    result["parameterOrder"] = result.get("parameterOrder", list(params))
    if (not isinstance(result["parameterOrder"], list) or len(result["parameterOrder"]) != len(params)
        or set(result["parameterOrder"]) != set(params)):
        raise ValueError("Parameter order must contain every declared parameter exactly once.")
    order = result.get("orderBy")
    if (not isinstance(order, list) or not 1 <= len(order) <= 4
        or any(not isinstance(k, dict) or k.get("column") not in columns or k.get("direction") not in ("ASC", "DESC") for k in order)
        or len({k["column"] for k in order}) != len(order)):
        raise ValueError("Select 1–4 distinct projected ordering fields and their exact directions.")
    for key, low, high, default in (("maxRows", 1, 1000, 1000), ("maxBytes", 1024, 917504, 917504), ("timeoutMs", 50, 30000, 10000)):
        result[key] = int(result.get(key, default))
        if not low <= result[key] <= high:
            raise ValueError(key + " is outside the released SQL Server source's native limit.")
    return result

def pagination(value, definition):
    value = copy.deepcopy(value or {"mode": "single"})
    if value.get("mode") not in ("single", "keyset"):
        raise ValueError("Choose a single page or a reviewed unique keyset cursor.")
    if value["mode"] == "keyset":
        keys = value.get("keys")
        if (not isinstance(keys, list) or not 1 <= len(keys) <= 4
            or [k.get("column") for k in keys] != [k["column"] for k in definition["orderBy"]]):
            raise ValueError("The cursor must contain the complete native ordering key.")
        for key in keys:
            if key.get("parameter") not in definition["parameters"]:
                raise ValueError("Every cursor field needs its exact declared parameter.")
        if value.get("start_parameter") not in definition["parameters"]:
            raise ValueError("The cursor needs its explicit first-page parameter.")
        value["review_reference"] = text(value.get("review_reference"), "Unique, nonnull cursor source/review", 4000)
    for key, low, high, default in (("max_pages", 1, 1000, 100), ("max_total_rows", 1, 1000000, 100000), ("max_total_bytes", 1024, 50331648, 50331648)):
        value[key] = int(value.get(key, default))
        if not low <= value[key] <= high:
            raise ValueError("The complete capture " + key + " is outside its declared limit.")
    return value

def type_parameter(column, *, nullable=False):
    native = str(column.get("baseType") or column.get("dataType") or "").lower()
    if native in ("tinyint", "smallint", "int", "bigint"):
        result = {"type": "integer"}
    elif native in ("decimal", "numeric", "money", "smallmoney"):
        scale = int(column.get("numericScale", 4 if "money" in native else 0))
        precision = int(column.get("numericPrecision", 19 if "money" in native else 38))
        result = {"type": "decimal", "maxScale": scale, "maxIntegerDigits": precision - scale}
    elif native == "bit":
        result = {"type": "boolean"}
    elif native in ("float", "real"):
        result = {"type": "number"}
    elif native in ("binary", "varbinary", "image", "timestamp", "rowversion", "sql_variant", "geometry", "geography", "hierarchyid"):
        raise ValueError("Use an explicit reviewed supported projection for this native filter/cursor type.")
    else:
        width = int(column.get("maxLength") or 4096)
        if native in ("nvarchar", "nchar"):
            width = width // 2 if width > 0 else 65536
        result = {"type": "string", "maxLength": min(65536, max(80, width if width > 0 else 65536))}
    if nullable:
        result.update(nullable=True, default=None)
    return result

def quote(value):
    return "[" + str(value).replace("]", "]]") + "]"

class SqlServer:
    def __init__(self, service):
        self.service, self.store = service, service.store
        self.root = self.store.root / "sql-jobs"
        self.root.mkdir(exist_ok=True, mode=0o700)
        self.children = {}
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self._loop, name="BI-SQL-operations", daemon=True)
        self.thread.start()

    def actions(self):
        return {
            "sql.profile.save": self.profile_save,
            "sql.query.save": self.query_save,
            "sql.query.from_table": self.query_from_table,
            "sql.query.review": self.query_review,
            "sql.job.prepare": self.prepare_job,
            "sql.job.launch": self.launch_job,
            "sql.job.cancel": self.cancel_job,
            "sql.job.inspect": self.inspect_job,
            "sql.result.import": self.import_result,
            "sql.mapping.save": self.mapping_save,
            "sql.mapping.apply": self.mapping_apply,
            "sql.handoff": self.handoff,
            "sql.receive.preview": self.receive_preview,
            "sql.receive.apply": self.receive_apply,
        }

    def close(self):
        self.stopping.set()
        self.thread.join(timeout=3)
        for child in self.children.values():
            if child.poll() is not None:
                child.wait()

    def _loop(self):
        while not self.stopping.wait(0.7):
            try:
                with self.service.lock:
                    self.poll()
            except Exception:
                # Individual jobs retain their own error; the owner UI remains available.
                continue

    def runtime(self):
        node = os.environ.get("BI_SQL_NODE") or shutil.which("node")
        driver = NATIVE / "core" / "mssql" / "node_modules" / "mssql" / "package.json"
        return {"node_available": bool(node), "driver_present_in_portable_profile": driver.is_file(),
                "driver_version": "12.7.4", "driver_ref": DRIVER_REF, "node_minimum": "22.16",
                "active_local_children": sum(p.poll() is None for p in self.children.values())}

    def profile_save(self, request):
        old = self.store.get("sql_profile", request["id"]) if request.get("id") else None
        payload = {"label": text(request.get("label"), "Connection label", 300),
                   "connection": connection(request.get("connection")),
                   "origin": request.get("origin", old["payload"].get("origin", "sqlserver") if old else "sqlserver"),
                   "description": str(request.get("description", ""))[:10000],
                   "limits": {"maxConnections": 1, "maxPending": 4, "connectTimeoutMs": 5000,
                              "idleTimeoutMs": 1000, "startupTimeoutMs": 15000}}
        if payload["origin"] not in ("sqlserver", "protocol-example"):
            raise ValueError("Choose a real SQL Server profile or a separately named protocol example.")
        if request.get("ca_base64"):
            data = base64.b64decode(request["ca_base64"], validate=True)
            if len(data) > 1048576 or b"BEGIN CERTIFICATE" not in data or b"PRIVATE KEY" in data:
                raise ValueError("Supply the original CA certificate only, at most 1 MiB.")
            if payload["connection"]["tls"] != "verify-full":
                raise ValueError("A CA belongs to the verified TLS profile.")
            payload["ca"] = self.store.blob(data, "sql-server-ca.pem", "application/x-pem-file")
        elif old and old["payload"].get("ca") and not request.get("remove_ca"):
            payload["ca"] = old["payload"]["ca"]
        return self.service.write("sql_profile", payload, old["id"] if old else None, request.get("expected", 0))

    def _profile(self, reference):
        return self.store.get("sql_profile", reference["id"], reference.get("revision"))

    def _query_hash(self, payload):
        profile = self._profile(payload["profile"])["payload"]
        return digest(encoded({"definition": payload["definition"], "pagination": payload["pagination"],
            "connection": profile["connection"], "ca": profile.get("ca", {}).get("digest"),
            "limits": profile["limits"], "origin": profile["origin"]}).encode())

    def query_save(self, request):
        old = self.store.get("sql_query", request["id"]) if request.get("id") else None
        profile = self.store.get("sql_profile", request["profile_id"], request.get("profile_revision"))
        definition = query_definition(request["definition"])
        payload = {"label": text(request.get("label"), "Query label", 300), "profile": record_ref(profile),
                   "definition": definition, "pagination": pagination(request.get("pagination"), definition),
                   "parameters": copy.deepcopy(request.get("parameters", {})),
                   "catalog": request.get("catalog"), "source_columns": request.get("source_columns", []),
                   "notes": str(request.get("notes", ""))[:10000], "review": None, "state": "draft"}
        if not isinstance(payload["parameters"], dict):
            raise ValueError("Use a typed parameter object.")
        payload["query_sha256"] = self._query_hash(payload)
        return self.service.write("sql_query", payload, old["id"] if old else None, request.get("expected", 0))

    def query_from_table(self, request):
        catalog_job = self.store.get("sql_job", request["catalog_job_id"])
        original = catalog_job["payload"]
        if original.get("status") != "complete" or original["document"]["action"] != "catalog":
            raise ValueError("Select the completed native table-column catalog capture.")
        result, _, state, _ = worker().read_result(self.store.bytes(original["result_bundle"]["digest"]))
        catalog = state.get("catalog", {})
        if not catalog.get("columns") or catalog.get("truncated"):
            raise ValueError("Select the complete columns for one native table or view.")
        columns = {c["name"]: c for c in catalog["columns"]}
        selected = request.get("columns") or [{"source": c["name"], "alias": re.sub(r"[^A-Za-z0-9_]", "_", c["name"])} for c in catalog["columns"]]
        aliases = {}
        for item in selected:
            if item.get("source") not in columns or not NAME.fullmatch(item.get("alias", "")):
                raise ValueError("Each selected native column needs its original name and a supported explicit alias.")
            if item["alias"] in aliases.values() or item["source"] in aliases:
                raise ValueError("Each selected native source and output alias must be unique.")
            aliases[item["source"]] = item["alias"]
        if not 1 <= len(aliases) <= 64:
            raise ValueError("Select 1–64 native columns.")
        ordered = request.get("key_columns") or [c["name"] for c in catalog["columns"] if c.get("keyKind") == "PRI"]
        if not 1 <= len(ordered) <= 4 or len(set(ordered)) != len(ordered):
            raise ValueError("Choose the complete unique ordering key, using one to four columns.")
        for name in ordered:
            if name not in aliases or columns[name].get("nullable") != "NO":
                raise ValueError("Every cursor key must be a selected, nonnull native column.")
            if type_parameter(columns[name])["type"] in ("number", "boolean"):
                raise ValueError("Select an exact integer, decimal, temporal or text cursor key.")
        native_primary = {c["name"] for c in catalog["columns"] if c.get("keyKind") == "PRI"}
        native_unique = bool(native_primary) and native_primary.issubset(set(ordered))
        review = ("Original complete primary key in " + catalog_job["id"] if native_unique
                  else text(request.get("uniqueness_reference"), "Explicit unique-key review/source", 4000))
        parameters = {"bi_page_started": {"type": "boolean", "default": False}}
        cursor_keys = []
        conditions = []
        for index, name in enumerate(ordered):
            pname = "bi_cursor_" + str(index)
            parameters[pname] = type_parameter(columns[name], nullable=True)
            cursor_keys.append({"column": aliases[name], "parameter": pname})
            equal = [quote(ordered[n]) + "=@bi_cursor_" + str(n) for n in range(index)]
            conditions.append("(" + " AND ".join(equal + [quote(name) + ">@" + pname]) + ")")
        where = ["(@bi_page_started=0 OR " + " OR ".join(conditions) + ")"]
        values = {}
        for index, item in enumerate(request.get("filters", [])):
            name, operator = item.get("column"), item.get("operator", "=")
            if name not in columns or operator not in ("=", "<>", ">", ">=", "<", "<=", "LIKE", "IS NULL", "IS NOT NULL"):
                raise ValueError("Use an observed native column and an explicit supported filter operator.")
            if operator in ("IS NULL", "IS NOT NULL"):
                where.append(quote(name) + " " + operator)
                continue
            pname = item.get("parameter") or "filter_" + str(index)
            if not NAME.fullmatch(pname) or pname in parameters:
                raise ValueError("Each typed filter needs a distinct parameter name.")
            parameters[pname] = type_parameter(columns[name])
            values[pname] = item["value"]
            where.append(quote(name) + " " + operator + " @" + pname)
        sql = ("SELECT " + ", ".join(quote(name) + " AS " + quote(alias) for name, alias in aliases.items())
               + " FROM " + quote(catalog["schemaName"]) + "." + quote(catalog["tableName"])
               + " WHERE " + " AND ".join(where))
        definition = {"sql": sql, "parameters": parameters, "parameterOrder": list(parameters),
                      "columns": list(aliases.values()), "orderBy": [{"column": aliases[n], "direction": "ASC"} for n in ordered],
                      "maxRows": int(request.get("page_rows", 1000)), "maxBytes": 917504, "timeoutMs": 10000}
        return self.query_save({"profile_id": original["profile"]["id"], "profile_revision": original["profile"]["revision"],
            "label": request.get("label") or catalog["table"] + " capture",
            "definition": definition, "parameters": values, "catalog": record_ref(catalog_job),
            "source_columns": [{"source": name, "alias": alias, "native": columns[name]} for name, alias in aliases.items()],
            "pagination": {"mode": "keyset", "keys": cursor_keys, "start_parameter": "bi_page_started",
                           "review_reference": review, **request.get("limits", {})}})

    def query_review(self, request):
        query = self.store.get("sql_query", request["id"])
        if query["revision"] != int(request["expected"]):
            raise Conflict("Reload the changed SQL query before reviewing it.")
        job = self.store.get("sql_job", request["preflight_job_id"])["payload"]
        if (job["status"] != "complete" or job["document"]["action"] != "preflight"
            or job["document"].get("query_sha256") != query["payload"]["query_sha256"]):
            raise ValueError("Run the exact current query's native preflight, then review that original result.")
        result, _, _, _ = worker().read_result(self.store.bytes(job["result_bundle"]["digest"]))
        if not result["column_types"]:
            raise ValueError("The native preflight lacks its exact projection metadata.")
        payload = copy.deepcopy(query["payload"])
        payload["expected_column_types"] = result["column_types"]
        payload["review"] = {"query_sha256": payload["query_sha256"], "preflight_job": request["preflight_job_id"],
                             "result_sha256": job["result_bundle"]["digest"], "reviewed_at": now(),
                             "reviewer": self.service.actor,
                             "note": text(request.get("note"), "Schema/cursor review note", 10000)}
        payload["state"] = "reviewed"
        return self.service.write("sql_query", payload, query["id"], query["revision"])

    def _source(self, profile, query=None):
        p = profile["payload"]
        conn = copy.deepcopy(p["connection"])
        files = {}
        if p.get("ca"):
            conn["caFile"] = "ca.pem"
            files["ca.pem"] = self.store.bytes(p["ca"]["digest"])
        definition = query["payload"]["definition"] if query else {
            "sql": "SELECT CONVERT(bigint,1) AS connection_probe", "parameters": {}, "columns": ["connection_probe"],
            "orderBy": [{"column": "connection_probe", "direction": "ASC"}], "maxRows": 1, "maxBytes": 1024, "timeoutMs": 5000}
        config = {"schema": "stellar-forge.mssql-source.v1", "connection": conn,
                  "queries": {"selected": definition}, **p["limits"]}
        files["source.json"] = encoded(config).encode() + b"\n"
        return config, files

    def _job_files(self, document, inputs):
        files = {"job.json": encoded(document).encode() + b"\n", **inputs}
        required = ["SQL_SERVER_WORKER.py", "capture.mjs", "core/mssql/config.mjs", "core/mssql/source.mjs",
                    "core/mssql/catalog.mjs", "core/mssql/declaration.mjs", "core/mssql/package.json",
                    "core/postgres/declaration.mjs", "core/postgres/decimal.mjs", "core/sqlite/parameters.mjs"]
        for name in required:
            files["worker/" + name] = (NATIVE / name).read_bytes()
        if (NATIVE / "GUIDE.md").is_file():
            files["worker/GUIDE.md"] = (NATIVE / "GUIDE.md").read_bytes()
        return files

    def prepare_job(self, request):
        action = request.get("action", "capture")
        if action not in ("catalog", "preflight", "capture"):
            raise ValueError("Choose catalog, preflight or a full capture.")
        query = self.store.get("sql_query", request["query_id"], request.get("query_revision")) if request.get("query_id") else None
        profile = self._profile(query["payload"]["profile"]) if query else self.store.get("sql_profile", request["profile_id"], request.get("profile_revision"))
        if action != "catalog" and query is None:
            raise ValueError("Select the original query revision.")
        if action == "capture":
            if not query["payload"].get("review") or query["payload"]["review"]["query_sha256"] != self._query_hash(query["payload"]):
                raise ValueError("Complete the current query's native preflight and explicit schema/cursor review.")
        _, inputs = self._source(profile, query)
        job_id = "sqljob-" + self.service.operation_id
        document = {"schema": "commons-bi-sql-server-job/1", "job_id": job_id,
            "operation_id": self.service.operation_id, "driver_ref": DRIVER_REF,
            "action": action, "origin": profile["payload"]["origin"],
            "profile": record_ref(profile), "query": record_ref(query) if query else None,
            "source_file": "source.json", "source_sha256": digest(inputs["source.json"]),
            "query_name": "selected", "query_sha256": query["payload"]["query_sha256"] if query else None,
            "parameters": copy.deepcopy(request.get("parameters", query["payload"].get("parameters", {}) if query else {})),
            "pagination": copy.deepcopy(query["payload"]["pagination"]) if query else {"mode": "single"},
            "expected_column_types": query["payload"].get("expected_column_types") if action == "capture" else None,
            "table": request.get("table") if action == "catalog" else None,
            "created_at": now(), "actor": self.service.actor,
            "label": str(request.get("label") or (query["payload"]["label"] if query else profile["payload"]["label"]) + " / " + action)[:300],
            "files": [{"path": name, "bytes": len(body), "sha256": digest(body)} for name, body in sorted(inputs.items())]}
        files = self._job_files(document, inputs)
        blob = self.store.blob(packed(files, "commons-bi-sql-job-files/1"), job_id + ".zip", "application/zip")
        raw = files["job.json"]
        return self.service.write("sql_job", {"label": document["label"], "document": document, "job_sha256": digest(raw),
            "profile": record_ref(profile), "query": record_ref(query) if query else None, "package": blob,
            "status": "queued" if request.get("start") else "prepared", "auto_start": bool(request.get("start")),
            "progress": {"rows": 0, "pages": 0}, "checkpoint": None, "result_bundle": None,
            "created_at": now(), "notes": str(request.get("notes", ""))[:10000]}, job_id, 0)

    def _materialize(self, job):
        p = job["payload"]
        files = unpacked(self.store.bytes(p["package"]["digest"]), "commons-bi-sql-job-files/1")
        if digest(files["job.json"]) != p["job_sha256"]:
            raise ValueError("The immutable original job bundle differs.")
        target = self.root / job["id"]
        target.mkdir(exist_ok=True, mode=0o700)
        for name, body in files.items():
            path = target / worker().relative(name)
            if path.exists():
                if worker().read(path) != body:
                    raise ValueError("Continue the retained original native worker/input; a materialized file differs.")
            else:
                atomic_write(path, body)
        operation = target / "operation"
        if not operation.exists() and p.get("checkpoint"):
            worker().restore_checkpoint(self.store.bytes(p["checkpoint"]["digest"]), target / "job.json", operation)
        return target

    def _launch(self, job, mode, actor):
        existing = self.children.get(job["id"])
        if existing is not None and existing.poll() is None:
            return job
        target = self._materialize(job)
        operation = target / "operation"
        operation.mkdir(exist_ok=True, mode=0o700)
        if job["payload"]["document"]["origin"] != "sqlserver":
            raise ValueError("This profile is an explicit protocol example; use its supplied Practice carrier.")
        node = os.environ.get("BI_SQL_NODE") or shutil.which("node")
        if not node:
            raise ValueError("Choose an existing Node22.16+ through BI_SQL_NODE before launching the native job.")
        number = int(job["payload"].get("launch_generation", 0)) + 1
        updated = {**job["payload"], "status": "starting", "auto_start": False, "launch_generation": number,
                   "last_mode": mode, "launch_requested_at": now(), "error": None}
        job = self.store.put("sql_job", updated, job["id"], job["revision"], actor)
        args = [sys.executable, str(target / "worker/SQL_SERVER_WORKER.py"), "--job", str(target / "job.json"),
                "--operation", str(operation), "--node", node, "--mode", mode]
        log = operation / ("host-" + str(number).zfill(4) + ".log")
        with log.open("ab") as output:
            os.chmod(log, 0o600)
            child = subprocess.Popen(args, cwd=target, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                     start_new_session=os.name != "nt")
        self.children[job["id"]] = child
        return self.store.put("sql_job", {**job["payload"], "status": "running", "local_pid": child.pid},
                              job["id"], job["revision"], actor)

    def launch_job(self, request):
        job = self.store.get("sql_job", request["id"])
        if request.get("expected") is not None and job["revision"] != int(request["expected"]):
            raise Conflict("The original job changed; reopen its current state.")
        if job["payload"]["status"] == "complete":
            return job
        mode = request.get("mode", "continue" if job["payload"]["status"] not in ("prepared", "queued") else "execute")
        if mode not in ("execute", "continue"):
            raise ValueError("Continue the original read job explicitly.")
        return self._launch(job, mode, self.service.actor)

    def cancel_job(self, request):
        job = self.store.get("sql_job", request["id"])
        if job["payload"]["status"] in ("complete", "canceled"):
            return job
        target = self._materialize(job)
        atomic_write(target / "operation/cancel.json", encoded({"job_sha256": job["payload"]["job_sha256"],
                     "requested_at": now(), "actor": self.service.actor, "note": str(request.get("note", "Operator canceled this read."))[:10000]}).encode())
        return self.service.write("sql_job", {**job["payload"], "status": "cancel_requested", "auto_start": False}, job["id"], job["revision"])

    def _batch(self, entries, actor):
        """All business records are committed together after complete input validation."""
        with self.store.lock, self.store.db:
            self.store.db.execute("BEGIN IMMEDIATE")
            for kind, ident, expected, payload in entries:
                row = self.store.db.execute("SELECT revision FROM heads WHERE kind=? AND id=?", (kind, ident)).fetchone()
                if (row["revision"] if row else 0) != expected:
                    raise Conflict("A receiving record changed before complete adoption.")
            for kind, ident, expected, payload in entries:
                self.store.db.execute("INSERT INTO revisions VALUES(?,?,?,?,?,?)",
                    (kind, ident, expected + 1, encoded(payload), now(), actor))
                self.store.db.execute("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision",
                    (kind, ident, expected + 1))
                self.store.event("sql_native_adoption", kind + "/" + ident, {"revision": expected + 1})
        return [self.store.get(k, i) for k, i, _, _ in entries]

    def _accept(self, job, data, actor):
        result, original, state, files = worker().read_result(data)
        p = job["payload"]
        immutable_files = unpacked(self.store.bytes(p["package"]["digest"]), "commons-bi-sql-job-files/1")
        if files["job.json"] != immutable_files["job.json"] or digest(files["job.json"]) != p["job_sha256"]:
            raise ValueError("Select the result from this exact original prepared native job.")
        if p.get("received_bundle_sha256") == digest(data):
            return job
        if p["status"] == "complete" and not result["complete"]:
            raise ValueError("An older partial result cannot replace this original completed job.")
        capture_id = "sqlcap-" + digest(job["id"].encode())[:32]
        dataset_id = "sqldata-" + digest(job["id"].encode())[:32]
        try:
            prior_capture = self.store.get("sql_capture", capture_id)
        except KeyError:
            prior_capture = None
        try:
            prior_dataset = self.store.get("dataset", dataset_id)
        except KeyError:
            prior_dataset = None
        if prior_dataset and result.get("capture") and prior_dataset["payload"]["file"]["digest"] != result["capture"]["sha256"]:
            raise Conflict("A completed native capture already exists under this original job; use a new capture job for changed source.")
        # Every hash, original job, native page and CSV has been preflighted above.
        bundle = self.store.blob(data, job["id"] + "-result.zip", "application/zip")
        native = self.store.blob(files["result.json"], job["id"] + "-native.json", "application/json")
        entries = []
        csv_file = None
        if result.get("capture"):
            csv_file = self.store.blob(files["capture/rows.csv"], job["id"] + ".csv", "text/csv")
            capture_payload = {"label": p["label"], "job": record_ref(job), "native_job_id": original["job_id"],
                "profile": p["profile"], "query": p["query"], "file": csv_file, "native": native,
                "bundle": bundle, "rows": result["rows"], "columns": result["columns"], "column_types": result["column_types"],
                "null_token": result["null_token"], "parameters": result["parameters"], "origin": result["origin"],
                "complete": result["complete"], "status": result["status"], "pages": result["pages"],
                "consistency": result["consistency"], "captured_at": result["captured_at"],
                "original_job_sha256": result["job_sha256"]}
            entries.append(("sql_capture", capture_id, prior_capture["revision"] if prior_capture else 0, capture_payload))
            if result["complete"] and not prior_dataset:
                entries.append(("dataset", dataset_id, 0, {"label": p["label"], "file": csv_file,
                    "columns": result["columns"], "rows": result["rows"], "null_token": result["null_token"],
                    "scope": "Complete native page collection across the retained capture window",
                    "origin": "SQL Server" if result["origin"] == "sqlserver" else "Explicit protocol example",
                    "source_url": "", "description": result["consistency"]["collection"], "parent": None,
                    "sql_capture": {"kind": "sql_capture", "id": capture_id, "revision": (prior_capture["revision"] if prior_capture else 0) + 1},
                    "sql_job": record_ref(job), "column_types": result["column_types"]}))
        updated = {**p, "status": result["status"], "complete": result["complete"], "auto_start": False,
            "result_bundle": bundle, "received_bundle_sha256": digest(data), "native_result": native,
            "progress": {"rows": result["rows"], "pages": result["pages"], "complete": result["complete"]},
            "error": result.get("error"), "received_at": now(),
            "capture_id": capture_id if csv_file else None,
            "dataset_id": dataset_id if csv_file and result["complete"] else None}
        entries.append(("sql_job", job["id"], job["revision"], updated))
        self._batch(entries, actor)
        return self.store.get("sql_job", job["id"])

    def import_result(self, request):
        job = self.store.get("sql_job", request["id"])
        data = base64.b64decode(request["base64"], validate=True)
        return self._accept(job, data, self.service.actor)

    def inspect_job(self, request):
        self.poll(only=request["id"], launch=False)
        return self.store.get("sql_job", request["id"])

    def poll(self, only=None, launch=True):
        jobs = [self.store.get("sql_job", only)] if only else self.store.list("sql_job", 10000)
        active = any(p.poll() is None for p in self.children.values())
        for job in jobs:
            p = job["payload"]
            try:
                if launch and not active and p.get("auto_start") and p["status"] == "queued":
                    job = self._launch(job, "execute", "SQL Server background worker")
                    active = True
                    p = job["payload"]
                target = self.root / job["id"] / "operation"
                result_path, state_path = target / "result.bundle.zip", target / "state.json"
                if result_path.is_file():
                    data = worker().read(result_path)
                    if digest(data) != p.get("received_bundle_sha256"):
                        job = self._accept(job, data, "Original SQL Server worker")
                        p = job["payload"]
                if state_path.is_file() and p["status"] != "complete":
                    state = worker().document(state_path)
                    if state.get("job_sha256") != p["job_sha256"]:
                        raise ValueError("The original native state has a different job digest.")
                    progress = {"rows": state.get("rows", 0), "pages": len(state.get("pages", [])), "complete": state.get("complete", False)}
                    if progress != p.get("progress") or state["status"] != p.get("observed_native_status"):
                        job = self.store.put("sql_job", {**p, "progress": progress,
                            "observed_native_status": state["status"], "native_updated_at": state["updated_at"]},
                            job["id"], job["revision"], "Original SQL Server worker")
                        p = job["payload"]
                child = self.children.get(job["id"])
                if child is not None and child.poll() is not None:
                    child.wait()
                    if p["status"] in ("running", "starting", "cancel_requested") and not result_path.exists():
                        self.store.put("sql_job", {**p, "status": "interrupted",
                            "error": {"code": "ORIGINAL_WORKER_ENDED_WITHOUT_RESULT"}, "auto_start": False},
                            job["id"], job["revision"], "Original SQL Server worker")
            except (ValueError, KeyError, OSError, TypeError, zipfile.BadZipFile) as exc:
                current = self.store.get("sql_job", job["id"])
                message = str(exc)[:1200]
                if current["payload"].get("observer_error") != message:
                    self.store.put("sql_job", {**current["payload"], "observer_error": message, "auto_start": False},
                                   current["id"], current["revision"], "SQL Server observation")

    def prepare_backup(self):
        """Include exact committed state/pages for any still-open native job in the existing encrypted backup."""
        self.poll(launch=False)
        for job in self.store.list("sql_job"):
            path = self.root / job["id"]
            if job["payload"].get("status") == "complete" or not (path / "operation/state.json").is_file():
                continue
            data, result, _ = worker().package_result(path / "job.json", path / "operation", checkpoint=True)
            if (job["payload"].get("checkpoint") or {}).get("digest") == digest(data):
                continue
            file = self.store.blob(data, job["id"] + "-checkpoint.zip", "application/zip")
            self.store.put("sql_job", {**job["payload"], "checkpoint": file,
                "checkpoint_status": result["status"], "checkpoint_rows": result["rows"]},
                job["id"], job["revision"], "Encrypted workspace checkpoint")

    def mapping_save(self, request):
        capture = self.store.get("sql_capture", request["capture_id"], request.get("capture_revision"))
        if not capture["payload"]["complete"]:
            raise ValueError("Use a complete capture when binding a full report/model table.")
        plan = self.store.get("plan", request["plan_id"], request.get("plan_revision"))
        table = next((t for t in plan["payload"]["project"]["tables"] if t["name"] == request["table"]), None)
        if table is None:
            raise ValueError("Select an actual table in the retained migration plan.")
        fields = request.get("fields", [])
        names = [c["name"] for c in table["columns"]]
        if (not isinstance(fields, list) or {f.get("target") for f in fields} != set(names) or len(fields) != len(names)
            or any(f.get("source") not in capture["payload"]["columns"] for f in fields)):
            raise ValueError("Map every model column exactly once to a retained native output field.")
        metadata = {c["name"]: c for c in capture["payload"]["column_types"]}
        findings = []
        for field in fields:
            column = next(c for c in table["columns"] if c["name"] == field["target"])
            native_type = metadata[field["source"]]["type"].lower()
            destination_type = str(column.get("data_type") or column.get("type") or "unknown")
            if native_type.startswith(("decimal", "numeric", "money", "bigint", "datetimeoffset", "binary", "varbinary")):
                findings.append({"source": field["source"], "native_type": native_type,
                                 "target": field["target"], "target_type": destination_type,
                                 "review": "Retain the exact server text/binary/offset and explicitly review the receiving model's conversion."})
        note = text(request.get("review_note"), "Native-to-model mapping and precision review", 10000)
        payload = {"label": str(request.get("label") or table["name"] + " SQL mapping")[:300],
            "capture": record_ref(capture), "plan": record_ref(plan), "table": table["name"],
            "fields": fields, "findings": findings, "review_note": note, "reviewer": self.service.actor,
            "reviewed_at": now(), "capture_sha256": capture["payload"]["file"]["digest"], "state": "reviewed"}
        return self.service.write("sql_mapping", payload)

    def mapping_apply(self, request):
        mapping = self.store.get("sql_mapping", request["id"])
        p = mapping["payload"]
        plan = self.store.get("plan", p["plan"]["id"])
        if plan["revision"] != p["plan"]["revision"]:
            raise Conflict("The model plan changed after this mapping review; review a new mapping against its current revision.")
        capture = self.store.get("sql_capture", p["capture"]["id"], p["capture"]["revision"])
        if capture["payload"]["file"]["digest"] != p["capture_sha256"] or not capture["payload"]["complete"]:
            raise ValueError("The original reviewed complete SQL capture differs.")
        headers, rows = read_csv(self.store.bytes(capture["payload"]["file"]["digest"]))
        fields = p["fields"]
        targets = [f["target"] for f in fields]
        mapped = [{f["target"]: row[f["source"]] for f in fields} for row in rows]
        blob = self.store.blob(csv_bytes(targets, mapped), p["table"] + "-sql-source.csv", "text/csv")
        value = copy.deepcopy(plan["payload"])
        value["bindings"][p["table"]] = {"kind": "csv", "digest": blob["digest"],
            "null_token": capture["payload"]["null_token"], "source": {"sql_mapping": record_ref(mapping),
            "sql_capture": p["capture"], "native_types": capture["payload"]["column_types"],
            "parameters": capture["payload"]["parameters"], "consistency": capture["payload"]["consistency"]}}
        value.setdefault("sql_mappings", []).append(record_ref(mapping))
        # The ordinary native builder consumes this exact mapped CSV and null marker.
        saved = self.service.write("plan", value, plan["id"], plan["revision"])
        return saved

    def handoff(self, request):
        from .sql_handoff import build_handoff
        return build_handoff(self, request)

    def receive_preview(self, request):
        from .sql_handoff import preview_handoff
        return preview_handoff(self, request)

    def receive_apply(self, request):
        from .sql_handoff import apply_handoff
        return apply_handoff(self, request)
