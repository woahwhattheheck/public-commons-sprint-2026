#!/usr/bin/env python3
"""Receive complete period reports from the existing original PostgreSQL dataset.

The default run owns one restart of the caller's existing development database.
The receive/reopen phases also work with an already running PostgreSQL host.
The original immutable editions and selected application view supply every report.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime, timezone
from decimal import Decimal
import fcntl
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
from types import SimpleNamespace
from urllib.parse import urlsplit
import zipfile

SCHEMA = "stellar-forge.postgres-period-receiving.v1"
SELECTION = "stellar-forge.postgres-period-selection.v1"
LABELS = ("original", "alternate-alias", "quoted-identifiers")
TOTALS = {"ADDED": 0, "REMOVED": 0, "CHANGED": 0, "UNCHANGED": 32}
LIMIT = 32 * 1024 * 1024


def need(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()


def json_value(raw):
    return json.loads(raw, parse_float=Decimal)


def same_value(left, right):
    if isinstance(left, (date, datetime)):
        left = left.isoformat()
    if isinstance(right, (date, datetime)):
        right = right.isoformat()
    if left is None or right is None or isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
        return Decimal(str(left)) == Decimal(str(right))
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(same_value(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(same_value(a, b) for a, b in zip(left, right))
    return type(left) is type(right) and left == right


def file_identity(path):
    path = Path(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode), "Select an ordinary retained file: " + str(path))
    raw = path.read_bytes()
    after = path.stat()
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) ==
         (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns),
         "A receiving input changed while it was read: " + str(path))
    return {"path": str(path), "bytes": len(raw), "sha256": sha(raw)}


@contextmanager
def held(path):
    """Use the same normal flock contract as the original native operation."""
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        need(stat.S_ISREG(os.fstat(fd).st_mode), "The original operation lock is not a file.")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("The same original receiving operation is already running.") from None
        yield
    finally:
        os.close(fd)


def product(source):
    sys.path.insert(0, str(source))
    from stellar_forge_buyer import postgres_delivery, postgres_reports, processes, storage
    helper_path = source / "examples" / "postgres_semantic_receiving.py"
    spec = importlib.util.spec_from_file_location("_original_semantic_receiving", helper_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    need(postgres_reports.SELECTION_SCHEMA == SELECTION,
         "Install the current complete period-report product in the selected Python source.")
    return SimpleNamespace(delivery=postgres_delivery, reports=postgres_reports,
                           processes=processes, storage=storage, original=module)


def original_inputs(directory):
    paths = {name: directory / name for name in
             ("released-editions.json", "receiving.json", "upgrade-receiving.json", "operation.json")}
    raw = {name: path.read_bytes() for name, path in paths.items()}
    values = {name: json.loads(value) for name, value in raw.items()}
    released = values["released-editions.json"]
    received = values["receiving.json"]
    upgraded = values["upgrade-receiving.json"]
    operation = values["operation.json"]
    need(released.get("schema") == "stellar-forge.original-postgres-upgrade.v1"
         and released.get("warehouse_schema") == "sf_semantic_receiving",
         "Select the original released-edition receiving directory.")
    need(received.get("state") == upgraded.get("state") == operation.get("state") == "COMPLETE",
         "Complete the existing original receiving and upgrade before its period-report continuation.")
    need(received["warehouse_id"] == released["warehouse_id"]
         and received["warehouse_schema"] == released["warehouse_schema"],
         "The retained receiving and released warehouse differ.")
    editions = {row["label"]: row for row in released["editions"]}
    need(len(released["editions"]) == 3 and set(editions) == set(LABELS),
         "The three original retained editions are required.")
    need(all(editions[label]["rows"]["count"] == 32
             and editions[label]["rows"]["sha256"] == released["original_rows_sha256"]
             for label in LABELS), "Receive the complete original 32-row editions.")
    need([c["column"] for c in editions["quoted-identifiers"]["mapping"]["columns"]][:2]
         == ["Reading", "reading"], "The quoted original mapping differs.")
    need({row["label"]: row["version_id"] for row in received["editions"]} ==
         {label: editions[label]["version_id"] for label in LABELS[:2]},
         "The existing browser receiving selected different editions.")
    need(received["selection"]["version_id"] == released["selected_version"]
         and received["selection"]["revision"] == released["selected_revision"],
         "The original selected application view differs.")
    return {"warehouse_id": released["warehouse_id"],
            "warehouse_schema": released["warehouse_schema"],
            "original_rows_sha256": released["original_rows_sha256"],
            "dictionary_sha256": released["dictionary_sha256"],
            "editions": editions,
            "selected_version": released["selected_version"],
            "selected_revision": released["selected_revision"],
            "view_physical": released["view_physical"],
            "files": {name: {"path": str(paths[name]), "bytes": len(value), "sha256": sha(value)}
                      for name, value in raw.items()}}


def source_identity(args):
    rows = {}
    required = ["postgres_delivery.py", "postgres_operator.py", "postgres_http.py",
                "postgres_reports.py", "postgres_central.py", "postgres_cli.py",
                "_postgres_ui.py", "processes.py", "storage.py", "dataset_semantics.py"]
    for name in required:
        rows["stellar_forge_buyer/" + name] = file_identity(args.source / "stellar_forge_buyer" / name)
    rows["examples/postgres_semantic_receiving.py"] = file_identity(
        args.source / "examples" / "postgres_semantic_receiving.py")
    rows["examples/postgres_period_receiving.py"] = file_identity(Path(__file__).resolve())
    rows["examples/postgres_period_receiving_browser.mjs"] = file_identity(args.browser_driver)
    return rows


def physical(warehouse, table):
    with warehouse.connection_factory() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT c.oid,c.relfilenode FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname=%s AND c.relname=%s", (warehouse.schema, table))
        result = cursor.fetchone()
    need(result is not None, "An original relation is unavailable.")
    return {"oid": result[0], "relfilenode": result[1]}


def complete_rows(warehouse, version_id):
    after, rows = 0, []
    while True:
        page = warehouse.rows(version_id, after=after, limit=13, include_original=True)
        rows.extend(page["rows"])
        following = page["next_after"]
        if following is None:
            return rows
        need(following > after, "The original row cursor did not advance.")
        after = following


def snapshot(warehouse, original):
    versions, datasets, typed = {}, {}, {}
    for label in LABELS:
        retained = original["editions"][label]
        version = warehouse.version(retained["version_id"])
        rows = complete_rows(warehouse, retained["version_id"])
        raw = "".join(row["original_json"] + "\n" for row in rows).encode()
        need(version["row_count"] == len(rows) == 32 and sha(raw) == original["original_rows_sha256"],
             "The complete original dataset changed: " + label)
        need(version["mapping"] == retained["mapping"] and version["table"] == retained["table"]
             and physical(warehouse, version["table"]) == retained["physical"],
             "An original mapping or relation was replaced: " + label)
        need(version["semantics_status"] == "RETAINED", "Receive the original dictionaries first.")
        dictionary = warehouse.semantics_bytes(retained["version_id"])
        need(sha(dictionary) == original["dictionary_sha256"], "The original dictionary changed.")
        versions[label], datasets[label], typed[label] = version, raw, rows
    selected = warehouse.current("source_data")
    need(selected["revision"] == original["selected_revision"]
         and selected["version"]["version_id"] == original["selected_version"]
         and physical(warehouse, "source_data") == original["view_physical"],
         "The existing selected application view changed.")
    return versions, datasets, typed


def selection_for(original, current):
    return {"schema": SELECTION,
            "previous_version": original["editions"]["original"]["version_id"],
            "current_version": original["editions"][current]["version_id"],
            "previous_label": "Original SQL mapping",
            "current_label": "Alternate SQL alias" if current == "alternate-alias" else "Quoted SQL identifiers",
            "title": "Complete original data — " +
                     ("alternate alias" if current == "alternate-alias" else "quoted identifiers")}


def discard_response(launch, body):
    """Send the real request and close at its response headers without consuming its result."""
    address = urlsplit(launch)
    origin = address.scheme + "://" + address.netloc
    connection = http.client.HTTPConnection(address.hostname, address.port, timeout=300)
    try:
        connection.request("POST", "/api/period-reports", body=json_bytes(body),
                           headers={"Origin": origin, "X-Postgres-Capability": address.fragment,
                                    "Content-Type": "application/json"})
        response = connection.getresponse()
        need(response.status == 200, "The actual period-report request returned " + str(response.status))
        response.close()
        return {"status": response.status, "result_body_consumed": False}
    finally:
        connection.close()


class Receiver:
    def __init__(self, args, api):
        self.args, self.api, self.s = args, api, api.storage
        self.directory = self.s.private_directory(args.directory)
        self.original = original_inputs(self.directory)
        self.output = self.s.private_directory(self.directory / "period-receiving")
        self.path = self.output / "receiving.json"
        self.sources = source_identity(args)
        self.result = self.s.parse(self.s.read(self.path, LIMIT)) if self.path.exists() else {
            "schema": SCHEMA, "state": "PREPARED", "created_at": now(), "input": self.original,
            "reports": {}, "sources": self.sources,
        }
        need(self.result.get("schema") == SCHEMA and self.result["input"] == self.original,
             "Continue the same original receiving records and warehouse.")
        self.warehouse = api.delivery.PostgresWarehouse.from_environment(
            args.connection_env, schema=self.original["warehouse_schema"], create=False,
            expected_warehouse=self.original["warehouse_id"])
        self.result["sources"] = self.sources

    def save(self):
        self.s.dump(self.path, self.result)

    def exact(self, relative, raw):
        path = self.output / relative
        return self.api.original.exact_file(path, raw)

    def valid_request(self, record, selected, request_id):
        need(record["record_id"] == request_id and record["route"] == "/api/period-reports"
             and record["body"] == {"selection": selected, "request_id": request_id}
             and record["state"] == "COMPLETE",
             "The original period-report request differs or remains incomplete.")
        result = record["result"]
        need(result["state"] == "COMPLETE" and result["request_id"] == request_id
             and result["report"]["warehouse_id"] == self.original["warehouse_id"]
             and result["report"]["warehouse_schema"] == self.original["warehouse_schema"]
             and result["report"]["selection"] == selected and result["report"]["totals"] == TOTALS,
             "The complete report changed the original source selection or rows.")
        return result

    def receive_archive(self, request, label, record, versions, datasets, typed, suffix=""):
        selected = selection_for(self.original, label)
        value = self.valid_request(record, selected, record["record_id"])
        raw, headers = request("/api/period-reports/" + record["record_id"] + "/archive", raw=True)
        artifact = value["artifact"]
        need(len(raw) == artifact["bytes"] and sha(raw) == artifact["sha256"]
             and headers.get("X-Content-SHA256") == artifact["sha256"]
             and int(headers["Content-Length"]) == len(raw), "The complete HTTP report download differs.")
        saved = self.exact("reports/" + label + "/report.zip", raw)
        import csv
        with zipfile.ZipFile(io.BytesIO(raw)) as bundle:
            names = bundle.namelist()
            need(len(names) == len(set(names)), "The report has duplicate members.")
            manifest = json.loads(bundle.read("manifest.json"))
            index = {row["path"]: row for row in manifest["files"]}
            need(len(index) == len(manifest["files"]) and set(index) == set(names) - {"manifest.json"},
                 "The complete report inventory differs.")
            need(manifest["schema"] == "stellar-forge.postgres-period-bundle.v1"
                 and manifest["request_id"] == record["record_id"]
                 and manifest["selection_sha256"] == value["selection_sha256"],
                 "The downloaded bundle belongs to another request.")
            files = []
            for name in names:
                safe = PurePosixPath(name)
                need(not safe.is_absolute() and safe.as_posix() == name
                     and all(part not in {"", ".", ".."} for part in safe.parts),
                     "The report contains an invalid relative member.")
                content = bundle.read(name)
                if name != "manifest.json":
                    need(len(content) == index[name]["bytes"] and sha(content) == index[name]["sha256"],
                         "A complete report member differs: " + name)
                files.append(self.exact("reports/" + label + "/files/" + name, content))
            report = json.loads(bundle.read("report.json"))
            need(report == value["report"] and report["snapshot"] == "READ ONLY REPEATABLE READ",
                 "The retained machine-readable report differs.")
            need(report["totals"] == TOTALS and report["meanings"]["mapping_changed"]
                 and not report["meanings"]["definition_changed"]
                 and not report["meanings"]["capture_changed"],
                 "Alias changes were confused with original source value or definition changes.")
            need(bundle.read("changes.jsonl") == b"", "Alias-only editions produced changed rows.")
            changes = list(csv.reader(io.StringIO(bundle.read("changes.csv").decode(), newline="")))
            need(len(changes) == 1 and [json_value(cell) for cell in changes[0]] ==
                 ["kind", "previous_row", "current_row", "before", "after"],
                 "The exact empty change CSV differs.")
            for prefix, edition_label in (("previous", "original"), ("current", label)):
                edition = versions[edition_label]
                need(bundle.read(prefix + "/dataset.jsonl") == datasets[edition_label],
                     "A period omitted or changed original JSONL rows.")
                need(bundle.read(prefix + "/semantics.json") ==
                     self.warehouse.semantics_bytes(edition["version_id"]),
                     "A period dictionary differs from the retained original.")
                need(bundle.read(prefix + "/manifest.json") ==
                     self.warehouse.manifest_bytes(edition["version_id"]),
                     "A period manifest differs from the retained original.")
                mapping = json.loads(bundle.read(prefix + "/mapping.json"))
                need(mapping == edition["mapping"], "The complete reviewed mapping differs.")
                exported = json.loads(bundle.read(prefix + "/edition.json"))
                need(exported["version_id"] == edition["version_id"]
                     and exported["mapping"] == mapping and exported["jsonl"] == edition["jsonl"],
                     "The report changed the original edition identity.")
                cells = list(csv.reader(io.StringIO(bundle.read(prefix + "/columns.csv").decode(), newline="")))
                headers = [json_value(cell) for cell in cells[0]]
                expected_headers = ["_sf_row_number", *(column["column"] for column in mapping["columns"])]
                need(headers == expected_headers and len(cells) == 33,
                     "Typed CSV omitted a complete column or row.")
                for line, row in zip(cells[1:], typed[edition_label]):
                    decoded = [json_value(cell) for cell in line]
                    expected = [row["row_number"], *(row["values"][name] for name in headers[1:])]
                    need(same_value(decoded, expected),
                         "Typed CSV lost an original numeric, null, string or mapped value.")
                if edition_label == "quoted-identifiers":
                    need(headers[1:3] == ["Reading", "reading"],
                         "The complete CSV collapsed quoted PostgreSQL aliases.")
            meanings = json.loads(bundle.read("meaning-changes.json"))
            need(meanings["before_mapping"] == versions["original"]["mapping"]
                 and meanings["after_mapping"] == versions[label]["mapping"],
                 "The report meaning comparison omitted a complete mapping.")
            sql = bundle.read("comparison.sql").decode()
            need(versions["original"]["table"] in sql and versions[label]["table"] in sql
                 and "FULL OUTER JOIN" in sql and "IS DISTINCT FROM" in sql,
                 "The report did not retain its actual full comparison SQL.")
            if label == "quoted-identifiers":
                need('"Reading"' in sql and '"reading"' in sql,
                     "The comparison SQL lost case-sensitive quoted aliases.")
            need(b"<html" in bundle.read("report.html")
                 and b"Complete contents" in bundle.read("README.md"),
                 "The complete readable report or receiving guide is absent.")
            advertised = {row["path"]: (row["bytes"], row["sha256"]) for row in value["files"]}
            actual = {name: (len(bundle.read(name)), sha(bundle.read(name))) for name in names}
            need(advertised == actual, "The returned complete report file list differs.")
        return {"request_id": record["record_id"], "selection": selected,
                "artifact": saved, "files": files, "rows_per_period": 32,
                "totals": report["totals"], "csv_columns": len(versions[label]["mapping"]["columns"]),
                "reopened": bool(suffix)}

    def cli(self, name, command, request_id, *, selection_path=None):
        argv = [sys.executable, "-B", "-m", "stellar_forge_buyer.postgres_cli",
                "--connection-env", self.args.connection_env,
                "--schema", self.original["warehouse_schema"],
                "--expect-warehouse", self.original["warehouse_id"], command,
                "--workspace", str(self.directory / "operator"), "--request-id", request_id]
        if selection_path is not None:
            argv += ["--selection", str(selection_path)]
        completed = self.api.original.run_logged(argv, self.output / (name + ".log"),
                                                  timeout=300, text=False)
        need(completed.returncode == 0, "The original period CLI did not complete: " + name)
        value = self.s.parse(completed.stdout)
        saved = self.exact("cli/" + name + ".json", completed.stdout)
        return value, {"command": command, "request_id": request_id, "output": saved,
                       "processes": completed.owned_processes}

    def receive(self):
        need(self.args.node_modules and self.args.chromium,
             "Choose the host's existing Playwright package and Chromium.")
        self.result.update(state="RECEIVING", last_started_at=now())
        self.save()
        versions, datasets, typed = snapshot(self.warehouse, self.original)
        with self.api.original.opened(self.warehouse, self.directory / "operator") as (request, launch):
            self.result["operator_id"] = request("/api/state")["identity"]["operator_id"]
            for label in LABELS:
                downloads = []
                for route, filename in (("semantics-file", "semantics.json"), ("manifest", "manifest.json"),
                                        ("mapping", "mapping.json"), ("edition", "edition.json")):
                    raw, headers = request("/api/" + route + "?version_id=" + versions[label]["version_id"], raw=True)
                    need(headers.get("X-Content-SHA256") == sha(raw), "An original edition download differs.")
                    if route == "semantics-file":
                        need(sha(raw) == self.original["dictionary_sha256"], "A downloaded dictionary changed.")
                    downloads.append(self.exact("editions/" + label + "/" + filename, raw))
                self.result.setdefault("edition_downloads", {})[label] = downloads
                self.save()
            label = "alternate-alias"
            selected = selection_for(self.original, label)
            request_id = sha(("original32-period/" + self.original["warehouse_id"] + "/" +
                              selected["previous_version"] + "/" + selected["current_version"]).encode())[:32]
            body = {"selection": selected, "request_id": request_id}
            retained = self.result.get("api_intent")
            need(retained is None or retained == body, "The original API report intent changed.")
            self.result["api_intent"] = body
            self.save()
            existing = self.api.original.retained_request(request, request_id)
            if existing is None:
                self.result["lost_response"] = discard_response(launch, body)
                self.save()
            else:
                need(existing["route"] == "/api/period-reports" and existing["body"] == body,
                     "The native original report request changed.")
            record = request("/api/requests/" + request_id + "/resume", {})
            self.result["reports"][label] = self.receive_archive(request, label, record, versions, datasets, typed)
            self.save()
            selected_path = self.output / "alternate-alias-selection.json"
            self.exact(selected_path.relative_to(self.output), json_bytes(selected))
            # Close the private HTTP operator before the CLI acquires that same operator directory.
        cli_record, cli_result = self.cli("create-original-report", "period-report", request_id,
                                          selection_path=selected_path)
        self.valid_request(cli_record, selected, request_id)
        need(cli_record["result"]["artifact"]["sha256"] ==
             self.result["reports"][label]["artifact"]["sha256"], "CLI replay replaced the original report.")
        self.result.setdefault("cli", {})["create"] = cli_result
        self.save()
        with self.api.original.opened(self.warehouse, self.directory / "operator") as (request, launch):
            private = self.output / "browser-input.private.json"
            config = {"schema": "stellar-forge.postgres-period-browser-input.v1",
                      "url": launch, "directory": str(self.output / "browser"),
                      "node_modules": str(self.args.node_modules.resolve()),
                      "chromium": str(self.args.chromium.resolve()),
                      "warehouse_id": self.original["warehouse_id"],
                      "warehouse_schema": self.original["warehouse_schema"],
                      "selection": selection_for(self.original, "quoted-identifiers"),
                      "expected_rows": 32, "source_sha256": self.sources[
                          "examples/postgres_period_receiving_browser.mjs"]["sha256"]}
            self.s.dump(private, config)
            try:
                child = self.api.original.run_logged(
                    [self.args.node, str(self.args.browser_driver), str(private)],
                    self.output / "browser.log", timeout=600)
                need(child.returncode == 0, "Open the retained browser log for the period-report receiving failure.")
                browser = self.s.parse(self.s.read(self.output / "browser" / "receiving.json", LIMIT))
                need(browser["state"] == "COMPLETE" and browser["browser_closed"],
                     "The complete original report browser did not close.")
                self.result["browser"] = {**browser, "processes": child.owned_processes}
            finally:
                private.unlink(missing_ok=True)
            body = browser["request"]
            need(body["selection"] == config["selection"], "The browser selected another original period.")
            record = request("/api/requests/" + body["request_id"] + "/resume", {})
            received = self.receive_archive(request, "quoted-identifiers", record, versions, datasets, typed)
            need(all(row["sha256"] == received["artifact"]["sha256"] for row in browser["downloads"]),
                 "The complete browser report download differs from the native retained report.")
            self.result["reports"]["quoted-identifiers"] = received
            snapshot(self.warehouse, self.original)
        self.result.update(state="RECEIVED", received_at=now(), http_closed=True)
        self.save()

    def reopen(self):
        need(self.result["state"] in {"RECEIVED", "COMPLETE"}
             and set(self.result["reports"]) == set(LABELS[1:]),
             "Finish both complete reports before reopening the same database.")
        versions, datasets, typed = snapshot(self.warehouse, self.original)
        with self.api.original.opened(self.warehouse, self.directory / "operator") as (request, _):
            need(request("/api/state")["identity"]["operator_id"] == self.result["operator_id"],
                 "The original operator identity changed after reopen.")
            for label in LABELS[1:]:
                original = self.result["reports"][label]
                record = request("/api/requests/" + original["request_id"] + "/resume", {})
                current = self.receive_archive(request, label, record, versions, datasets, typed, suffix="reopen")
                need(current["artifact"] == original["artifact"] and current["files"] == original["files"],
                     "The original complete report changed after database restart.")
                self.result["reports"][label]["reopened"] = True
        for label in LABELS[1:]:
            report = self.result["reports"][label]
            record, observed = self.cli("reopen-" + label, "resume", report["request_id"])
            self.valid_request(record, report["selection"], report["request_id"])
            need(record["result"]["artifact"]["sha256"] == report["artifact"]["sha256"],
                 "CLI reopen changed the complete report identity.")
            self.result.setdefault("cli", {})[label] = observed
        snapshot(self.warehouse, self.original)
        self.result.update(state="COMPLETE", reopened_at=now(), http_closed=True)
        self.save()


def run_database(args, api):
    original = original_inputs(args.directory)
    with held(args.directory / ".original-native.lock"):
        return run_database_locked(args, api, original)


def run_database_locked(args, api, original):
    need(args.runtime is not None and (args.directory / "database").is_dir()
         and any((args.directory / "database").iterdir()),
         "Select the original owned runtime and its existing receiving database.")
    sys.path.insert(0, str(args.runtime))
    from streaming_pglite import StreamingPGlite
    output = api.storage.private_directory(args.directory / "period-receiving")
    operation_path = output / "operation.json"
    previous = api.storage.parse(api.storage.read(operation_path, LIMIT)) if operation_path.exists() else None
    bindings = {"input": original, "source": source_identity(args),
                "runtime": {name: file_identity(args.runtime / name) for name in
                            ("streaming_pglite.py", "pglite_stream_worker.mjs", "native_postgres.py")}}
    if previous:
        need(previous["bindings"]["input"] == original, "The original native receiving input changed.")
        if previous["state"] == "COMPLETE" and previous["bindings"] == bindings:
            retained = file_identity(output / "receiving.json")
            need(retained == previous["receiving"], "The complete original receiving result changed.")
            receiving = api.storage.parse(api.storage.read(output / "receiving.json", LIMIT))
            need(receiving["state"] == "COMPLETE", "The retained report receiving is incomplete.")
            files = [row for rows in receiving["edition_downloads"].values() for row in rows]
            for report in receiving["reports"].values():
                files += [report["artifact"], *report["files"]]
                original_archive = args.directory / "operator" / "period-reports" / report["request_id"] / "report.zip"
                native = file_identity(original_archive)
                need(all(native[key] == report["artifact"][key] for key in ("bytes", "sha256")),
                     "The retained original operator report changed.")
            files += receiving["browser"]["downloads"] + receiving["browser"]["screenshots"]
            for row in files:
                actual = file_identity(row["path"])
                need(all(actual[key] == row[key] for key in ("bytes", "sha256")),
                     "An original completed receiving file changed: " + row["path"])
            print(json.dumps({"state": "COMPLETE", "retained_completion": True,
                              "operation": str(operation_path), "receiving": retained,
                              "warehouse_id": original["warehouse_id"]}), flush=True)
            return
    host = StreamingPGlite(temporary_parent=args.temporary_parent,
                          data_directory=args.directory / "database", node=args.node,
                          transport="loopback" if args.transport == "tcp" else "unix")
    result = {"schema": "stellar-forge.postgres-period-native-operation.v1",
              "state": "RUNNING", "started_at": now(), "bindings": bindings,
              "phases": [], "prior_attempts": (previous.get("prior_attempts", []) +
                  [{key: previous.get(key) for key in ("state", "started_at", "completed_at", "error", "phases")}])
                  if previous else []}
    api.storage.dump(operation_path, result)

    def phase(name):
        command = [sys.executable, "-B", str(Path(__file__).resolve()),
                   "--phase", name, "--source", str(args.source), "--directory", str(args.directory),
                   "--connection-env", args.connection_env, "--node", args.node,
                   "--node-modules", str(args.node_modules), "--chromium", str(args.chromium),
                   "--browser-driver", str(args.browser_driver)]
        print(json.dumps({"phase": name, "state": "RUNNING"}), flush=True)
        completed = None
        try:
            completed = host.run(command, timeout=900, extra_environment={
                "PYTHONPATH": str(args.source) + ":" + host.environment["PYTHONPATH"],
                "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": str(host.base),
                args.connection_env: host.environment["SF_BUYER_POSTGRES_DSN"]})
            raw = (completed.stdout + completed.stderr).encode()
            api.storage.write(output / ("native-" + name + ".log"), raw)
            row = {"name": name, "returncode": completed.returncode,
                   "log": file_identity(output / ("native-" + name + ".log")),
                   "processes": completed.owned_processes}
            result["phases"].append(row)
            api.storage.dump(operation_path, result)
            need(completed.returncode == 0, "The original period receiving phase failed: " + name)
        except BaseException as error:
            if completed is None:
                out = getattr(error, "stdout", getattr(error, "output", b"")) or b""
                err = getattr(error, "stderr", b"") or b""
                raw = (out.encode() if isinstance(out, str) else out) + (err.encode() if isinstance(err, str) else err)
                api.storage.write(output / ("native-" + name + ".log"), raw)
                result["phases"].append({"name": name, "state": "INTERRUPTED",
                                         "log": file_identity(output / ("native-" + name + ".log"))})
            raise

    try:
        with host:
            receiving_path = output / "receiving.json"
            state = api.storage.parse(api.storage.read(receiving_path, LIMIT)) if receiving_path.exists() else None
            if (state is None or state.get("state") not in {"RECEIVED", "COMPLETE"}
                    or state.get("sources") != bindings["source"]):
                phase("receive")
            host.restart()
            phase("reopen")
        receiving = api.storage.parse(api.storage.read(output / "receiving.json", LIMIT))
        need(receiving["state"] == "COMPLETE" and receiving["browser"]["browser_closed"]
             and receiving["http_closed"] and host.exits == [0, 0] and len(host.starts) == 2
             and len(host.stops) == 2, "The original report operation did not finish and close.")
        result.update(state="COMPLETE", completed_at=now(), receiving=file_identity(output / "receiving.json"),
                      warehouse_id=original["warehouse_id"], rows_per_period=32,
                      report_requests={key: row["request_id"] for key, row in receiving["reports"].items()},
                      teardown={"postgresql_exits": host.exits, "starts": host.starts,
                                "stops": host.stops, "sessions": len(host.sessions),
                                "browser_closed": True, "http_closed": True})
    except BaseException as error:
        result.update(state="INTERRUPTED", error=str(error),
                      teardown={"postgresql_exits": host.exits, "starts": host.starts,
                                "stops": host.stops, "sessions": len(host.sessions)})
        api.storage.dump(operation_path, result)
        raise
    api.storage.dump(operation_path, result)
    print(json.dumps({"state": "COMPLETE", "operation": str(operation_path),
                      "receiving": result["receiving"], "warehouse_id": original["warehouse_id"],
                      "reports": result["report_requests"], "teardown": result["teardown"]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--directory", type=Path, required=True,
                        help="existing complete original32 receiving directory")
    parser.add_argument("--phase", choices=("run", "receive", "reopen"), default="run")
    parser.add_argument("--runtime", type=Path, help="existing original streaming PostgreSQL runtime directory")
    parser.add_argument("--transport", choices=("unix", "tcp"), default="unix")
    parser.add_argument("--temporary-parent", type=Path)
    parser.add_argument("--connection-env", default="SF_BUYER_POSTGRES_DSN")
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node"))
    parser.add_argument("--node-modules", type=Path)
    parser.add_argument("--chromium", type=Path)
    parser.add_argument("--browser-driver", type=Path,
                        default=Path(__file__).with_name("postgres_period_receiving_browser.mjs"))
    args = parser.parse_args()
    os.umask(0o077)
    sys.dont_write_bytecode = True
    args.source, args.directory = args.source.resolve(strict=True), args.directory.resolve(strict=True)
    args.browser_driver = args.browser_driver.resolve(strict=True)
    if args.runtime:
        args.runtime = args.runtime.resolve(strict=True)
    need(args.phase == "reopen" or args.node and args.node_modules and args.chromium
         and args.chromium.is_file() and os.access(args.chromium, os.X_OK)
         and (args.node_modules / "playwright" / "package.json").is_file(),
         "Choose the host's existing Node, Playwright and Chromium for full receiving.")
    api = product(args.source)
    with api.processes.cancellation():
        if args.phase == "run":
            run_database(args, api)
        else:
            output = api.storage.private_directory(args.directory / "period-receiving")
            with held(output / ".receiving.lock"):
                receiving = Receiver(args, api)
                try:
                    receiving.reopen() if args.phase == "reopen" else receiving.receive()
                except BaseException as error:
                    receiving.result.update(state="INTERRUPTED", error=str(error), interrupted_at=now())
                    receiving.save()
                    raise
            print(json.dumps({"state": receiving.result["state"], "receiving": str(receiving.path),
                              "warehouse_id": receiving.original["warehouse_id"]}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
