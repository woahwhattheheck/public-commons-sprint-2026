#!/usr/bin/env python3
# MIT. Retained native Apache Superset 6.1 example using the original Census workbooks.
import argparse
import contextlib
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal

SCHEMA = "stellar-forge.superset-native-fixture.v1"
PIN = "c83fb2bb1dcfac41ac51bcebd82471f4a7180d18"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
COLS = ["source_row", "topic", "lower_meaning", "lower_value", "upper_meaning", "upper_value"]
INPUTS = {
    "before": ("c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807", 2023),
    "after": ("14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5", 2024),
}

def raw_json(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def write_json(path, value, *, replace=False):
    raw = raw_json(value)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() and not replace:
        if path.read_bytes() != raw:
            raise ValueError("Retained fixture identity differs: " + path.name)
        return
    fd, temporary = tempfile.mkstemp(prefix=".fixture-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            try:
                os.link(temporary, path)
            except FileExistsError:
                if path.read_bytes() != raw:
                    raise ValueError("Concurrent fixture identity differs")
        sync_dir(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)

@contextlib.contextmanager
def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a+b") as stream:
        os.chmod(path, 0o600)
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)

def read_workbook(path, cohort):
    raw = path.read_bytes()
    expected, year = INPUTS[cohort]
    if digest(raw) != expected:
        raise ValueError("Select the exact retained " + str(year) + " Census JAM workbook")
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS):
                shared.append("".join(node.text or "" for node in item.iterfind(".//s:t", NS)))
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relation = {item.attrib["Id"]: item.attrib["Target"] for item in rels}
        sheet = next((item for item in workbook.findall("s:sheets/s:sheet", NS)
                      if item.attrib.get("name") == "JamValues"), None)
        if sheet is None:
            raise ValueError("The retained workbook does not contain JamValues")
        rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = relation[rid]
        name = target.lstrip("/") if target.startswith("/") else "xl/" + target
        parts = []
        for part in name.split("/"):
            if part == "..":
                if not parts:
                    raise ValueError("Invalid native worksheet path")
                parts.pop()
            elif part not in ("", "."):
                parts.append(part)
        document = ET.fromstring(archive.read("/".join(parts)))
        cells = {cell.attrib["r"]: cell for cell in document.findall("s:sheetData/s:row/s:c", NS)}
        evidence, rows = [], []
        for row in range(21, 37):
            values = {"source_row": row}
            for column, field in [("A", "topic"), ("B", "lower_meaning"), ("D", "lower_value"),
                                  ("E", "upper_meaning"), ("G", "upper_value")]:
                address = column + str(row)
                cell = cells.get(address)
                if cell is None:
                    raise ValueError("A selected original cell is absent: " + address)
                value = cell.find("s:v", NS)
                kind = cell.attrib.get("t", "n")
                token = value.text if value is not None else None
                formula = cell.find("s:f", NS)
                if kind == "s":
                    decoded = shared[int(token)]
                elif kind == "inlineStr":
                    decoded = "".join(node.text or "" for node in cell.iterfind(".//s:t", NS))
                elif kind in ("str", "d"):
                    decoded = token
                elif kind == "n" and token is not None:
                    number = Decimal(token)
                    if not number.is_finite() or number != number.to_integral_value():
                        raise ValueError("The original selected numeric cell is not integral")
                    decoded = int(number)
                else:
                    raise ValueError("Unsupported original selected cell type at " + address)
                if field.endswith("_value"):
                    if type(decoded) is not int:
                        raise ValueError("Expected the original integer value at " + address)
                elif not isinstance(decoded, str):
                    raise ValueError("Expected original text at " + address)
                values[field] = decoded
                evidence.append({"address": address, "nativeType": kind, "savedValueToken": token,
                                 "formula": formula.text if formula is not None else None, "value": decoded})
            rows.append(values)
    return {"schema": "stellar-forge.superset-native-source-rows.v1", "year": year,
            "workbook": {"name": path.name, "bytes": len(raw), "sha256": expected},
            "sheet": "JamValues", "range": "A20:G36", "selectedColumns": ["A", "B", "D", "E", "G"],
            "key": "source_row", "keyMeaning": "Original worksheet row number", "columns": COLS,
            "rows": rows, "cells": evidence}

def prepare_environment(directory):
    os.environ["SUPERSET_CONFIG_PATH"] = str(directory / "superset_config.py")
    os.environ["SUPERSET_HOME"] = str(directory)
    os.environ["FLASK_APP"] = "superset"
    # Superset's service processes inherit the same private, retained configuration.
    os.environ["SCF_SUPERSET_NATIVE_ROOT"] = str(directory)

def configure(directory, redis_port):
    private = directory / "secrets.json"
    if not private.exists():
        write_json(private, {"secret": secrets.token_urlsafe(48), "asyncSecret": secrets.token_urlsafe(48),
                             "username": "scf-native-customer", "password": secrets.token_urlsafe(36)})
    os.chmod(private, 0o600)
    configuration = (
        "import json, os\nfrom pathlib import Path\n"
        "ROOT=Path(os.environ['SCF_SUPERSET_NATIVE_ROOT'])\n"
        "PRIVATE=json.loads((ROOT/'secrets.json').read_text())\n"
        "SECRET_KEY=PRIVATE['secret']\n"
        "SQLALCHEMY_DATABASE_URI='sqlite:///'+str(ROOT/'superset.db')\n"
        "SQLALCHEMY_TRACK_MODIFICATIONS=False\n"
        "WTF_CSRF_ENABLED=True\n"
        "PREVENT_UNSAFE_DB_CONNECTIONS=False\n"
        "FEATURE_FLAGS={'GLOBAL_ASYNC_QUERIES':True}\n"
        "GLOBAL_ASYNC_QUERIES_JWT_SECRET=PRIVATE['asyncSecret']\n"
        "GLOBAL_ASYNC_QUERIES_TRANSPORT='polling'\n"
        "GLOBAL_ASYNC_QUERIES_JWT_COOKIE_SECURE=False\n"
        "GLOBAL_ASYNC_QUERIES_REGISTER_REQUEST_HANDLERS=True\n"
        + "REDIS_PORT=" + str(redis_port) + "\n"
        "REDIS_URL='redis://127.0.0.1:'+str(REDIS_PORT)\n"
        "DATA_CACHE_CONFIG={'CACHE_TYPE':'RedisCache','CACHE_REDIS_URL':REDIS_URL+'/1','CACHE_KEY_PREFIX':'scf-data-','CACHE_DEFAULT_TIMEOUT':300}\n"
        "CACHE_CONFIG={'CACHE_TYPE':'RedisCache','CACHE_REDIS_URL':REDIS_URL+'/1','CACHE_KEY_PREFIX':'scf-native-','CACHE_DEFAULT_TIMEOUT':300}\n"
        "GLOBAL_ASYNC_QUERIES_CACHE_BACKEND={'CACHE_TYPE':'RedisCache','CACHE_REDIS_HOST':'127.0.0.1','CACHE_REDIS_PORT':REDIS_PORT,'CACHE_REDIS_DB':1,'CACHE_DEFAULT_TIMEOUT':300}\n"
        "class CeleryConfig:\n"
        "    broker_url=REDIS_URL+'/0'\n"
        "    result_backend=REDIS_URL+'/0'\n"
        "    imports=('superset.tasks.async_queries',)\n"
        "    worker_prefetch_multiplier=1\n"
        "    task_acks_late=False\n"
        "CELERY_CONFIG=CeleryConfig\n"
        "TALISMAN_ENABLED=False\n"
        "SESSION_COOKIE_SECURE=False\n"
        "SESSION_COOKIE_HTTPONLY=True\n"
        "SESSION_COOKIE_SAMESITE='Lax'\n"
        "ENABLE_PROXY_FIX=False\n"
        "SUPERSET_WEBSERVER_TIMEOUT=120\n"
    )
    target = directory / "superset_config.py"
    if target.exists() and target.read_text() != configuration:
        raise ValueError("Use the retained exact native Superset configuration")
    if not target.exists():
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write(configuration)
            stream.flush()
            os.fsync(stream.fileno())
        sync_dir(directory)

def set_cohort(directory, cohort):
    if cohort not in INPUTS:
        raise ValueError("Choose a retained original source cohort")
    raw = (directory / (cohort + ".json")).read_bytes()
    intent = json.loads((directory / "input.json").read_text())
    bound = intent["sourceDocuments"][cohort]
    if len(raw) != bound["bytes"] or digest(raw) != bound["sha256"]:
        raise ValueError("The retained source document differs from its original workbook binding")
    selection = json.loads(raw)
    if selection["workbook"] != intent[cohort] or selection["workbook"]["sha256"] != INPUTS[cohort][0]:
        raise ValueError("The selected native source belongs to another original workbook")
    rows = selection["rows"]
    expected = digest(raw_json(rows))
    if expected != bound["rowsSha256"]:
        raise ValueError("The retained native source rows differ from their original selection")
    with locked(directory / "source-writer.lease"):
        with sqlite3.connect(directory / "source.sqlite3") as database:
            database.execute("PRAGMA busy_timeout=10000")
            database.execute("CREATE TABLE IF NOT EXISTS source_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), cohort TEXT NOT NULL, rows_sha256 TEXT NOT NULL)")
            current = database.execute("SELECT cohort,rows_sha256 FROM source_identity WHERE singleton=1").fetchone()
            if current == (cohort, expected):
                actual = database.execute("SELECT " + ",".join(COLS) + " FROM census_jam ORDER BY source_row").fetchall()
                if [dict(zip(COLS, row)) for row in actual] != rows:
                    raise ValueError("Native retained datasource differs from its committed selection")
                return {"cohort": cohort, "rowsSha256": expected, "rows": len(rows), "reused": True}
            database.execute("CREATE TABLE IF NOT EXISTS census_jam (source_row INTEGER PRIMARY KEY, topic TEXT NOT NULL, lower_meaning TEXT NOT NULL, lower_value INTEGER NOT NULL, upper_meaning TEXT NOT NULL, upper_value INTEGER NOT NULL)")
            database.execute("DELETE FROM census_jam")
            database.executemany("INSERT INTO census_jam VALUES(?,?,?,?,?,?)", [tuple(row[name] for name in COLS) for row in rows])
            database.execute("INSERT INTO source_identity VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET cohort=excluded.cohort,rows_sha256=excluded.rows_sha256", (cohort, expected))
        return {"cohort": cohort, "rowsSha256": expected, "rows": len(rows), "reused": False}

def bootstrap(args):
    directory = Path(args.directory).resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    with locked(directory / "bootstrap.lease"):
        version = importlib.metadata.version("apache-superset")
        if version != "6.1.0":
            raise ValueError("Use the original Apache Superset 6.1.0 environment; found " + version)
        before, after = read_workbook(Path(args.before).resolve(), "before"), read_workbook(Path(args.after).resolve(), "after")
        intent = {"schema": SCHEMA, "officialCommit": PIN, "supersetVersion": version,
                  "before": before["workbook"], "after": after["workbook"], "columns": COLS, "redisPort": args.redis_port,
                  "sourceDocuments": {name: {"bytes": len(raw_json(selection)), "sha256": digest(raw_json(selection)),
                                              "rowsSha256": digest(raw_json(selection["rows"]))}
                                      for name, selection in (("before", before), ("after", after))}}
        write_json(directory / "input.json", intent)
        write_json(directory / "before.json", before)
        write_json(directory / "after.json", after)
        configure(directory, args.redis_port)
        prepare_environment(directory)
        # A resumed setup preserves the existing selected datasource cohort.
        cohort = None
        if (directory / "source.sqlite3").exists():
            with sqlite3.connect(directory / "source.sqlite3") as source_db:
                present = source_db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_identity'").fetchone()
                if present:
                    current = source_db.execute("SELECT cohort FROM source_identity WHERE singleton=1").fetchone()
                    cohort = current[0] if current else None
        if cohort not in (None, "before", "after"):
            raise ValueError("The retained native datasource has an unknown cohort")
        set_cohort(directory, cohort or "before")
        marker = directory / "migration-complete.json"
        if not marker.exists():
            with (directory / "setup.log").open("ab") as log:
                for arguments in (["db", "upgrade"], ["init"]):
                    subprocess.run([sys.executable, "-c", "from superset.cli.main import superset; superset()", *arguments],
                                   env=os.environ.copy(), stdout=log, stderr=log, check=True, timeout=600)
            write_json(marker, {"schema": SCHEMA, "supersetVersion": version})
        from superset.app import create_app
        from superset import security_manager
        from superset.extensions import db
        from superset.models.core import Database
        from superset.connectors.sqla.models import SqlaTable
        from superset.models.slice import Slice
        from superset.models.dashboard import Dashboard
        application = create_app()
        private = json.loads((directory / "secrets.json").read_text())
        with application.app_context():
            admin = security_manager.find_user(username=private["username"])
            if admin is None:
                admin = security_manager.add_user(username=private["username"], first_name="SCF", last_name="Customer",
                    email="scf-customer@example.invalid", role=security_manager.find_role("Admin"), password=private["password"])
                if not admin:
                    raise RuntimeError("The original security manager did not retain the fixture administrator")
            database = db.session.query(Database).filter_by(database_name="SCF Census customer").one_or_none()
            if database is None:
                database = Database(database_name="SCF Census customer", expose_in_sqllab=True, allow_run_async=False)
                database.set_sqlalchemy_uri("sqlite:///" + str(directory / "source.sqlite3"))
                db.session.add(database)
                db.session.flush()
            elif database.sqlalchemy_uri != "sqlite:///" + str(directory / "source.sqlite3"):
                raise ValueError("The native database binding belongs to another retained datasource")
            table = db.session.query(SqlaTable).filter_by(database_id=database.id, table_name="census_jam").one_or_none()
            if table is None:
                table = SqlaTable(table_name="census_jam", database=database, owners=[admin])
                db.session.add(table)
                db.session.flush()
                table.fetch_metadata()
            queries = [{"columns": COLS, "metrics": [], "filters": [], "orderby": [["source_row", True]],
                        "row_limit": limit, "row_offset": 0, "order_desc": False, "is_timeseries": False,
                        "time_range": "No filter", "extras": {"where": "", "having": ""}}
                       for limit in (100, 3)]
            context = {"datasource": {"id": table.id, "type": "table"}, "queries": queries,
                       "result_format": "json", "result_type": "full"}
            context_text = json.dumps(context, separators=(",", ":"))
            params = json.dumps({"datasource": str(table.id) + "__table", "viz_type": "table", "query_mode": "raw",
                                 "all_columns": COLS, "row_limit": 100, "time_range": "No filter"}, separators=(",", ":"))
            chart = db.session.query(Slice).filter_by(slice_name="SCF Census JAM native saved report").one_or_none()
            if chart is None:
                chart = Slice(slice_name="SCF Census JAM native saved report", datasource_id=table.id,
                    datasource_type="table", datasource_name="census_jam", viz_type="table", params=params,
                    query_context=context_text, owners=[admin], description="Exact original US Census JAM worksheet values. The second native result intentionally retains a three-row limit.")
                db.session.add(chart)
                db.session.flush()
            elif chart.query_context != context_text or chart.params != params:
                raise ValueError("The saved native chart was edited; retain its reviewed query context")
            dashboard = db.session.query(Dashboard).filter_by(dashboard_title="SCF Census native customer").one_or_none()
            if dashboard is None:
                dashboard = Dashboard(dashboard_title="SCF Census native customer", slices=[chart], owners=[admin], published=True,
                                      json_metadata="{}", position_json="{}")
                db.session.add(dashboard)
            db.session.commit()
            result = {**intent, "chartId": chart.id, "chartUuid": str(chart.uuid), "dashboardId": dashboard.id,
                      "datasetId": table.id, "queryCount": 2, "expectedRows": len(before["rows"]),
                      "limitedQueryRows": 3, "usernameEnv": "SCF_SUPERSET_USERNAME", "passwordEnv": "SCF_SUPERSET_PASSWORD",
                      "queryContextSha256": digest(context_text.encode()), "beforeRowsSha256": digest(raw_json(before["rows"])),
                      "afterRowsSha256": digest(raw_json(after["rows"]))}
            write_json(directory / "fixture.json", result)
            return result

def main():
    parser = argparse.ArgumentParser(description="Operate one retained official Superset 6.1 saved-chart fixture.")
    parser.add_argument("action", choices=["bootstrap", "serve", "promote", "restore", "inspect"])
    parser.add_argument("--directory", required=True)
    parser.add_argument("--before")
    parser.add_argument("--after")
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--redis-port", type=int, default=6388)
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    if args.action == "bootstrap":
        if not args.before or not args.after or not 1 <= args.redis_port <= 65535:
            parser.error("bootstrap requires both exact original workbooks and a valid retained Redis port")
        result = bootstrap(args)
    else:
        prepare_environment(directory)
        if args.action == "serve":
            if not 1 <= args.port <= 65535:
                parser.error("Choose one retained loopback service port")
            with locked(directory / "server.lease"):
                from superset.app import create_app
                create_app().run(host="127.0.0.1", port=args.port, threaded=True, use_reloader=False, debug=False)
            return
        if args.action in ("promote", "restore"):
            result = set_cohort(directory, "after" if args.action == "promote" else "before")
        else:
            result = json.loads((directory / "fixture.json").read_text())
            with sqlite3.connect(directory / "source.sqlite3") as database:
                row = database.execute("SELECT cohort,rows_sha256 FROM source_identity WHERE singleton=1").fetchone()
                result["nativeSource"] = {"cohort": row[0], "rowsSha256": row[1]}
    print(json.dumps(result, separators=(",", ":"), ensure_ascii=False), flush=True)

if __name__ == "__main__":
    main()
